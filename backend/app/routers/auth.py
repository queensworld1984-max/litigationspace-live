"""Authentication router - register, login, profile, forgot password, email verification."""
from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.utils.auth import decode_token
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import secrets
import os

from app.database import get_db
from app.models.schemas import RegisterRequest, LoginRequest, TokenResponse
from app.utils.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, generate_id
)
from app.utils.email import send_verification_email, send_password_reset_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Request schemas ---
class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

class ResendVerificationRequest(BaseModel):
    email: str


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _generate_token() -> str:
    return secrets.token_urlsafe(48)


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest):
    # Honeypot — bots fill hidden fields, humans leave them empty
    if req.website:
        raise HTTPException(status_code=400, detail="Registration failed.")

    email = _normalize_email(req.email)
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM users WHERE LOWER(email) = ?", (email,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        tenant_id = generate_id()
        tenant_name = req.tenant_name or f"{req.full_name}'s Firm"
        db.execute(
            "INSERT INTO tenants (id, name, type) VALUES (?, ?, ?)",
            (tenant_id, tenant_name, req.tenant_type)
        )

        user_id = generate_id()
        pw_hash = hash_password(req.password)
        verification_token = _generate_token()
        verification_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

        db.execute(
            """INSERT INTO users (id, tenant_id, email, password_hash, full_name, role,
               bar_number, jurisdiction, specializations, hourly_rate, bio, status,
               email_verified, email_verification_token, email_verification_expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, tenant_id, email, pw_hash, req.full_name, req.role,
             req.bar_number, req.jurisdiction, req.specializations, req.hourly_rate,
             req.bio, "READY" if os.getenv('STAGING', '').lower() in ('1', 'true', 'yes') else "LOCKED",
             1 if os.getenv('STAGING', '').lower() in ('1', 'true', 'yes') else 0, verification_token, verification_expires)
        )

        _seed_workflow_templates(db)

        # Initialise 7-day trial + 200 credits for every new account
        from app.utils.subscription import init_trial
        init_trial(user_id, db)

        send_verification_email(email, verification_token, req.full_name)

        token = create_access_token(user_id, tenant_id, req.role, email)
        return TokenResponse(
            access_token=token,
            user={
                "id": user_id,
                "tenant_id": tenant_id,
                "email": email,
                "full_name": req.full_name,
                "role": req.role,
                "email_verified": True if os.getenv('STAGING', '').lower() in ('1', 'true', 'yes') else False,
            }
        )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    email = _normalize_email(req.email)
    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE LOWER(email) = ?", (email,)
        ).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        email_verified = user["email_verified"] if "email_verified" in user.keys() else 1
        if not email_verified and not os.getenv('STAGING', '').lower() in ('1', 'true', 'yes'):
            raise HTTPException(
                status_code=403,
                detail="Please verify your email before signing in. Check your inbox or request a new verification link."
            )

        token = create_access_token(user["id"], user["tenant_id"], user["role"], user["email"])
        return TokenResponse(
            access_token=token,
            user={
                "id": user["id"],
                "tenant_id": user["tenant_id"],
                "email": user["email"],
                "full_name": user["full_name"],
                "role": user["role"],
                "status": user["status"],
                "email_verified": bool(email_verified),
            }
        )


@router.get("/verify-email")
async def verify_email(token: str):
    from fastapi.responses import RedirectResponse

    with get_db() as db:
        user = db.execute(
            "SELECT id, email, full_name, email_verification_token, email_verification_expires_at FROM users WHERE email_verification_token = ?",
            (token,)
        ).fetchone()
        if not user:
            return RedirectResponse(url="/login?error=link_invalid", status_code=302)

        expires_at = user["email_verification_expires_at"]
        if expires_at:
            try:
                exp_dt = datetime.fromisoformat(expires_at)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp_dt:
                    return RedirectResponse(url="/login?error=link_expired", status_code=302)
            except ValueError:
                pass

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE users SET email_verified = 1, status = 'READY', email_verification_token = NULL, email_verification_expires_at = NULL, verified_at = ? WHERE id = ?",
            (now, user["id"])
        )

    return RedirectResponse(url="/login?verified=1", status_code=302)


@router.post("/resend-verification")
async def resend_verification(req: ResendVerificationRequest):
    email = _normalize_email(req.email)
    with get_db() as db:
        user = db.execute(
            "SELECT id, email, full_name, email_verified FROM users WHERE LOWER(email) = ?",
            (email,)
        ).fetchone()
        if not user:
            return {"message": "If an account exists with that email, a verification link has been sent."}
        if user["email_verified"]:
            return {"message": "Email is already verified. You can sign in."}

        new_token = _generate_token()
        new_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        db.execute(
            "UPDATE users SET email_verification_token = ?, email_verification_expires_at = ? WHERE id = ?",
            (new_token, new_expires, user["id"])
        )
        send_verification_email(user["email"], new_token, user["full_name"])
    return {"message": "If an account exists with that email, a verification link has been sent."}


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    email = _normalize_email(req.email)
    with get_db() as db:
        user = db.execute(
            "SELECT id, email, full_name, password_change_locked FROM users WHERE LOWER(email) = ?",
            (email,)
        ).fetchone()
        if not user:
            return {"message": "If an account exists with that email, a password reset link has been sent."}
        if user["password_change_locked"]:
            raise HTTPException(status_code=403, detail="Password changes are locked on this account. Contact your administrator.")

        reset_token = _generate_token()
        reset_expires = (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat()
        db.execute(
            "UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?",
            (reset_token, reset_expires, user["id"])
        )
        send_password_reset_email(user["email"], reset_token, user["full_name"])
    return {"message": "If an account exists with that email, a password reset link has been sent."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    with get_db() as db:
        user = db.execute(
            "SELECT id, password_reset_token, password_reset_expires_at, password_change_locked FROM users WHERE password_reset_token = ?",
            (req.token,)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
        if user["password_change_locked"]:
            raise HTTPException(status_code=403, detail="Password changes are locked on this account. Contact your administrator.")

        expires_at = user["password_reset_expires_at"]
        if expires_at:
            try:
                exp_dt = datetime.fromisoformat(expires_at)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp_dt:
                    raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")
            except ValueError:
                pass

        if len(req.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

        new_hash = hash_password(req.password)
        db.execute(
            "UPDATE users SET password_hash = ?, email_verified = 1, status = 'READY', verified_at = datetime('now'), password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = ?",
            (new_hash, user["id"])
        )
    return {"message": "Password reset successfully. You can now sign in with your new password."}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        user = db.execute(
            "SELECT id, tenant_id, email, full_name, role, bar_number, jurisdiction, "
            "specializations, hourly_rate, status, bio, avatar_url, created_at, email_verified "
            "FROM users WHERE id = ?",
            (current_user["sub"],)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        result = dict(user)
        result["email_verified"] = bool(result.get("email_verified", 1))
        return result


def _seed_workflow_templates(db):
    """Seed workflow templates if they don't exist."""
    import json
    existing = db.execute("SELECT COUNT(*) as cnt FROM workflow_templates").fetchone()
    if existing["cnt"] > 0:
        return

    templates = [
        {
            "name": "H-1B Visa Application",
            "case_type": "immigration_h1b",
            "tasks": [
                "Collect employer information and job details",
                "Verify prevailing wage determination (LCA)",
                "Prepare Form I-129 petition",
                "Gather supporting evidence (degrees, experience letters)",
                "Draft support letter from employer",
                "Compile credential evaluations",
                "Review complete petition package",
                "File with USCIS",
                "Track receipt notice",
                "Respond to any RFE (Request for Evidence)",
                "Monitor approval/denial",
                "Process visa stamping (if applicable)",
                "Prepare I-94 arrival record",
                "Set up compliance monitoring",
                "Calendar renewal dates",
                "Document filing for records",
                "Client notification of status changes",
                "Post-approval compliance review",
                "Annual LCA compliance check",
                "Prepare amendment if job changes"
            ]
        },
        {
            "name": "O-1 Extraordinary Ability",
            "case_type": "immigration_o1",
            "tasks": [
                "Initial eligibility assessment",
                "Identify qualifying criteria categories",
                "Collect evidence: Awards and prizes",
                "Collect evidence: Membership in associations",
                "Collect evidence: Published material about the beneficiary",
                "Collect evidence: Judging the work of others",
                "Collect evidence: Original contributions",
                "Collect evidence: Scholarly articles",
                "Collect evidence: Employment in critical capacity",
                "Collect evidence: High salary/remuneration",
                "Draft advisory opinion letter",
                "Prepare petition letter",
                "Compile exhibit list with Bates stamping",
                "Review and finalize petition",
                "File Form I-129 with USCIS",
                "Track case status",
                "Respond to RFE if issued",
                "Process approval notification",
                "Coordinate visa stamping",
                "Set renewal reminders"
            ]
        },
        {
            "name": "General Litigation",
            "case_type": "litigation",
            "tasks": [
                "Initial case assessment and conflict check",
                "Draft engagement letter",
                "Conduct preliminary investigation",
                "Draft and file complaint/answer",
                "Serve opposing party",
                "Prepare initial disclosures",
                "Draft discovery requests (interrogatories, RFPs, RFAs)",
                "Review and respond to opposing discovery",
                "Schedule and prepare for depositions",
                "Retain expert witnesses",
                "File/respond to dispositive motions",
                "Prepare pre-trial brief",
                "Organize trial exhibits",
                "Prepare witness examination outlines",
                "Conduct mock trial/jury research",
                "Trial preparation and logistics",
                "Post-trial motions",
                "Appeal assessment",
                "Case closure and archiving",
                "Final billing reconciliation"
            ]
        }
    ]

    for t in templates:
        db.execute(
            "INSERT INTO workflow_templates (id, name, case_type, tasks_json) VALUES (?, ?, ?, ?)",
            (generate_id(), t["name"], t["case_type"], json.dumps(t["tasks"]))
        )


# ══════════════════════════════════════════════════════════════
# ADMIN — User Management
# ══════════════════════════════════════════════════════════════

@router.get("/admin/users")
async def admin_list_users(
    status: str = None,
    verified: str = None,
    search: str = None,
    limit: int = 100,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Admin: list all users with optional filters."""
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    query = "SELECT id, email, full_name, role, status, email_verified, created_at, verified_at FROM users WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if verified == "0":
        query += " AND email_verified = 0"
    elif verified == "1":
        query += " AND email_verified = 1"
    if search:
        query += " AND (LOWER(email) LIKE ? OR LOWER(full_name) LIKE ?)"
        params += [f"%{search.lower()}%", f"%{search.lower()}%"]
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as db:
        rows = db.execute(query, params).fetchall()
    return {"users": [dict(r) for r in rows], "total": len(rows)}


@router.post("/admin/users/{user_id}/verify")
async def admin_verify_user(
    user_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Admin: manually verify and unlock a user account."""
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    with get_db() as db:
        user = db.execute("SELECT id, email, full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        db.execute(
            "UPDATE users SET email_verified=1, status='READY', "
            "email_verification_token=NULL, email_verification_expires_at=NULL, "
            "verified_at=datetime('now') WHERE id=?",
            (user_id,)
        )
    return {"ok": True, "user_id": user_id, "email": user["email"]}


@router.post("/admin/users/{user_id}/resend-verification")
async def admin_resend_verification(
    user_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Admin: generate a fresh verification token and resend the email."""
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    with get_db() as db:
        user = db.execute("SELECT id, email, full_name, email_verified FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        if user["email_verified"]:
            raise HTTPException(400, "User is already verified")
        new_token = _generate_token()
        expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        db.execute(
            "UPDATE users SET email_verification_token=?, email_verification_expires_at=? WHERE id=?",
            (new_token, expires, user_id)
        )

    send_verification_email(user["email"], new_token, user["full_name"])
    return {"ok": True, "email": user["email"]}


@router.post("/admin/users/{user_id}/delete")
async def admin_delete_user(
    user_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Admin: permanently delete a user account."""
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    with get_db() as db:
        user = db.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True, "deleted": user["email"]}


@router.post("/admin/users/{user_id}/toggle-password-lock")
async def admin_toggle_password_lock(
    user_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Admin: lock or unlock password changes for a specific user."""
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    with get_db() as db:
        user = db.execute("SELECT id, email, password_change_locked FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        new_state = 0 if user["password_change_locked"] else 1
        db.execute("UPDATE users SET password_change_locked = ? WHERE id = ?", (new_state, user_id))
    return {"ok": True, "email": user["email"], "password_change_locked": bool(new_state)}
