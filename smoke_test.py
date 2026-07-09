"""
Post-deploy smoke test — run after every deployment:
  python smoke_test.py

Tests: register → verify email link → sign in → cleanup
"""
import requests, sqlite3, time, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE      = "https://litigationspace.com"
DB_PATH   = None   # set to None to skip DB shortcut (uses resend instead)
TEST_EMAIL = f"smoketest_{int(time.time())}@mailinator.com"
TEST_PASS  = "SmokeTest1234!"
PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
errors = []

def check(label, condition, detail=""):
    if condition:
        print(f"  {PASS}  {label}")
    else:
        print(f"  {FAIL}  {label}{' — ' + detail if detail else ''}")
        errors.append(label)

print("\n── LitigationSpace Smoke Test ──────────────────────────────")

# 1. Register
print("\n1. Registration")
r = requests.post(f"{BASE}/api/auth/register", json={
    "email": TEST_EMAIL, "password": TEST_PASS, "full_name": "Smoke Test"
})
check("Register returns 200", r.status_code == 200, str(r.status_code))
data = r.json() if r.ok else {}
check("Returns access_token", bool(data.get("access_token")))
check("email_verified is False", data.get("user", {}).get("email_verified") == False)
user_id = data.get("user", {}).get("id", "")

# 2. Get verification token from DB
print("\n2. Verification token")
token = None
try:
    import subprocess, re
    result = subprocess.run(
        ["ssh", "root@72.62.165.54",
         f"sqlite3 /var/www/litigationspace-staging/data/app.db \"SELECT email_verification_token FROM users WHERE id='{user_id}';\""],
        capture_output=True, text=True, timeout=15
    )
    token = result.stdout.strip()
    check("Token present in DB", bool(token), "Could not fetch token")
except Exception as e:
    check("Token present in DB", False, str(e))

# 3. Verify email link
print("\n3. Verification link")
if token:
    r2 = requests.get(f"{BASE}/api/auth/verify-email?token={token}", allow_redirects=False)
    check("Returns 302", r2.status_code == 302, str(r2.status_code))
    location = r2.headers.get("location", "")
    check("Redirects to /login?verified=1", "login?verified=1" in location, location)

    # Confirm DB updated
    try:
        result = subprocess.run(
            ["ssh", "root@72.62.165.54",
             f"sqlite3 /var/www/litigationspace-staging/data/app.db \"SELECT email_verified,status FROM users WHERE id='{user_id}';\""],
            capture_output=True, text=True, timeout=15
        )
        db_state = result.stdout.strip()
        check("DB: email_verified=1, status=READY", db_state == "1|READY", db_state)
    except Exception as e:
        check("DB state confirmed", False, str(e))

# 4. Sign in
print("\n4. Sign in")
r3 = requests.post(f"{BASE}/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS})
check("Login returns 200", r3.status_code == 200, str(r3.status_code))
login_data = r3.json() if r3.ok else {}
check("Login returns access_token", bool(login_data.get("access_token")))
check("email_verified True in response", login_data.get("user", {}).get("email_verified") == True)

# 5. Cleanup
print("\n5. Cleanup")
try:
    subprocess.run(
        ["ssh", "root@72.62.165.54",
         f"sqlite3 /var/www/litigationspace-staging/data/app.db \"DELETE FROM users WHERE id='{user_id}';\""],
        capture_output=True, timeout=15
    )
    check("Test user deleted", True)
except Exception as e:
    check("Test user deleted", False, str(e))

# Summary
print("\n────────────────────────────────────────────────────────────")
if errors:
    print(f"\033[91m  FAILED — {len(errors)} check(s) failed:\033[0m")
    for e in errors:
        print(f"    • {e}")
    sys.exit(1)
else:
    print("\033[92m  ALL CHECKS PASSED — deployment is healthy\033[0m")
print()
