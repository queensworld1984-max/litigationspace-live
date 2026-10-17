"""Live Bench workers — real legal professionals who join free, go Open when
they are ready for work, and get hired from the Live Bench directory.

A worker is a `users` row (role expert_active) plus a `live_bench_profiles`
row with source='member' and the SAME id, so the existing bench engagement,
messaging and professional-dashboard endpoints work unchanged.

Availability: OPEN (green, hireable now) / BUSY / OFFLINE. OPEN only lasts
while the worker's dashboard keeps sending heartbeats; a stale OPEN is shown
as OFFLINE (see effective_availability).

Verification (phone, ID document, payout details) never blocks going live.
Suspicious sign-ups are flagged for admin review instead.
"""
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.database import get_db
from app.utils.admin_config import require_internal_dashboard
from app.utils.auth import create_access_token, generate_id, get_current_user, hash_password
from app.utils.email import _send_email, send_verification_email

router = APIRouter(prefix="/api/livebench", tags=["live-bench-workers"])

ADMIN_NOTIFY_EMAIL = os.getenv("LIVEBENCH_ADMIN_EMAIL", "info@litigationspace.com")
SITE_URL = os.getenv("FRONTEND_URL", "https://litigationspace.com").rstrip("/")
ID_UPLOAD_DIR = Path(os.getenv(
    "LIVEBENCH_ID_DIR",
    str(Path(__file__).resolve().parents[3] / "uploads" / "livebench_ids"),
))
OPEN_TIMEOUT = timedelta(minutes=3)
HIDE_SAMPLES_AT = 100  # once this many real workers have joined, sample profiles are hidden

ROLES = [
    "Attorney (Contract / Freelance)", "Co-Counsel", "Immigration Attorney", "Appellate Attorney",
    "Paralegal", "Immigration Paralegal / Forms Preparer", "Immigration Consultant",
    "Legal Assistant / Virtual Assistant", "Case Manager", "Legal Researcher",
    "Brief & Motion Writer", "Document Reviewer / e-Discovery", "Legal Translator",
    "Court Interpreter", "Process Server", "Court Reporter", "Notary Public",
    "Private Investigator", "Expert Witness", "Mediator", "Arbitrator", "Retired Judge",
    "Trial Consultant", "Legal Billing / Bookkeeper", "Litigation Support / Tech", "Other",
]

_MEMBER_COLUMNS = {
    "user_id": "TEXT", "email": "TEXT", "phone": "TEXT", "country": "TEXT", "city": "TEXT",
    "currency": "TEXT DEFAULT 'USD'", "languages": "TEXT", "bar_number": "TEXT",
    "availability": "TEXT DEFAULT 'OFFLINE'", "last_heartbeat": "TEXT",
    "phone_status": "TEXT DEFAULT 'unverified'", "id_status": "TEXT DEFAULT 'none'",
    "id_doc_path": "TEXT", "payout_status": "TEXT DEFAULT 'none'",
    "flagged": "INTEGER DEFAULT 0", "flag_reasons": "TEXT", "suspended": "INTEGER DEFAULT 0",
    "signup_ip": "TEXT", "updated_at": "TEXT",
}
# Never sent to the public directory.
PRIVATE_FIELDS = ("email", "phone", "user_id", "id_doc_path", "signup_ip", "flag_reasons",
                  "flagged", "suspended", "last_heartbeat", "bar_number")

_DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
    "yopmail.com", "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com",
    "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "emailondeck.com",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_member_columns(db) -> None:
    have = {r["name"] for r in db.execute("PRAGMA table_info(live_bench_profiles)").fetchall()}
    for col, ddl in _MEMBER_COLUMNS.items():
        if col not in have:
            db.execute(f"ALTER TABLE live_bench_profiles ADD COLUMN {col} {ddl}")


def effective_availability(row: dict) -> str:
    """OPEN only counts while heartbeats are fresh; otherwise the worker is OFFLINE."""
    avail = (row.get("availability") or "OFFLINE").upper()
    if avail != "OPEN":
        return avail
    try:
        last = datetime.fromisoformat(row.get("last_heartbeat") or "")
    except ValueError:
        return "OFFLINE"
    return "OPEN" if datetime.now(timezone.utc) - last <= OPEN_TIMEOUT else "OFFLINE"


def member_count(db) -> int:
    ensure_member_columns(db)
    return db.execute(
        "SELECT COUNT(*) FROM live_bench_profiles WHERE source='member' AND COALESCE(suspended,0)=0"
    ).fetchone()[0]


def samples_hidden(db) -> bool:
    return member_count(db) >= HIDE_SAMPLES_AT


def public_profile(row: dict) -> dict:
    d = dict(row)
    is_member = d.get("source") == "member"
    d["is_member"] = is_member
    if is_member:
        d["availability"] = effective_availability(d)
        d["phone_verified"] = d.get("phone_status") == "verified"
        d["id_verified"] = d.get("id_status") == "verified"
        d["payout_ready"] = d.get("payout_status") == "added"
    else:
        d.pop("availability", None)
    for f in PRIVATE_FIELDS + ("phone_status", "id_status", "payout_status"):
        d.pop(f, None)
    try:
        d["jurisdictions"] = json.loads(d.get("jurisdictions_json") or "[]")
    except Exception:
        d["jurisdictions"] = []
    d.pop("jurisdictions_json", None)
    return d


def _flag_reasons(db, *, email: str, name: str, bio: str, rate: float, phone: str, ip: str) -> list[str]:
    reasons = []
    domain = email.rsplit("@", 1)[-1].lower()
    if domain in _DISPOSABLE:
        reasons.append("disposable email domain")
    if re.search(r"\d", name) or len(name.split()) < 2:
        reasons.append("name looks incomplete or contains digits")
    if re.search(r"https?://|www\.|@[A-Za-z0-9-]+\.|\+?\d[\d\s().-]{8,}\d|whatsapp|telegram", bio, re.I):
        reasons.append("bio contains off-platform contact details")
    if len(bio.strip()) < 40:
        reasons.append("very short bio")
    if rate and (rate < 5 or rate > 2000):
        reasons.append(f"unusual hourly rate ({rate:g})")
    if phone:
        digits = re.sub(r"\D", "", phone)
        dup = db.execute(
            "SELECT COUNT(*) FROM live_bench_profiles WHERE source='member' AND REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE ?",
            (f"%{digits[-9:]}",),
        ).fetchone()[0] if len(digits) >= 9 else 0
        if dup:
            reasons.append("phone number already used by another worker")
    if ip:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        same_ip = db.execute(
            "SELECT COUNT(*) FROM live_bench_profiles WHERE source='member' AND signup_ip=? AND created_at>=?",
            (ip, since),
        ).fetchone()[0]
        if same_ip >= 2:
            reasons.append(f"{same_ip + 1} sign-ups from the same network in 24h")
    return reasons


def _esc(s) -> str:
    return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _shell(title: str, body: str) -> str:
    return f"""<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;color:#1e293b;">
<h2 style="font-family:Georgia,serif;color:#0a1628;margin:0 0 16px;">{title}</h2>{body}
<p style="color:#94a3b8;font-size:12px;margin-top:28px;">LitigationSpace.org is a nonprofit program of Build Champions, a 501(c)(3).</p></div>"""


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or ""


# ── Public ────────────────────────────────────────────────────────────────────

class JoinRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: str
    specialty: Optional[str] = None
    country: str
    city: Optional[str] = None
    jurisdictions: Optional[str] = None
    languages: Optional[str] = None
    currency: Optional[str] = "USD"
    hourly_rate: Optional[float] = None
    phone: Optional[str] = None
    bar_number: Optional[str] = None
    years_experience: Optional[int] = None
    bio: str
    website: Optional[str] = None  # honeypot


@router.get("/roles")
async def list_roles():
    return {"roles": ROLES}


@router.get("/stats")
async def public_stats():
    with get_db() as db:
        ensure_member_columns(db)
        rows = db.execute(
            "SELECT availability, last_heartbeat FROM live_bench_profiles WHERE source='member' AND COALESCE(suspended,0)=0"
        ).fetchall()
    open_now = sum(1 for r in rows if effective_availability(dict(r)) == "OPEN")
    return {"members": len(rows), "open_now": open_now, "hide_samples_at": HIDE_SAMPLES_AT}


@router.post("/join")
async def join(req: JoinRequest, request: Request):
    if req.website:
        raise HTTPException(400, "Application failed.")
    email = req.email.strip().lower()
    name = req.full_name.strip()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "Please enter a valid email address.")
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if not name or not req.role.strip() or not req.country.strip() or not req.bio.strip():
        raise HTTPException(400, "Name, role, country and bio are required.")

    ip = _client_ip(request)
    now = _now()
    with get_db() as db:
        ensure_member_columns(db)
        if db.execute("SELECT id FROM users WHERE LOWER(email)=?", (email,)).fetchone():
            raise HTTPException(400, "This email already has an account. Sign in, then open Live Bench > My Worker Dashboard.")

        reasons = _flag_reasons(db, email=email, name=name, bio=req.bio, rate=req.hourly_rate or 0,
                                phone=req.phone or "", ip=ip)

        tenant_id = generate_id()
        db.execute("INSERT INTO tenants (id, name, type) VALUES (?, ?, ?)",
                   (tenant_id, f"{name} - Live Bench", "solo_practitioner"))
        user_id = generate_id()
        vtoken = secrets.token_urlsafe(48)
        vexp = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        specializations = "; ".join(x for x in [req.role.strip(), (req.specialty or "").strip()] if x)
        db.execute(
            """INSERT INTO users (id, tenant_id, email, password_hash, full_name, role,
               bar_number, jurisdiction, specializations, hourly_rate, bio, status,
               email_verified, email_verification_token, email_verification_expires_at)
               VALUES (?, ?, ?, ?, ?, 'expert_active', ?, ?, ?, ?, ?, 'LOCKED', 0, ?, ?)""",
            (user_id, tenant_id, email, hash_password(req.password), name,
             req.bar_number, req.jurisdictions, specializations, req.hourly_rate, req.bio, vtoken, vexp),
        )
        jur = [j.strip() for j in re.split(r"[,;]", req.jurisdictions or "") if j.strip()] or [req.country.strip()]
        location = ", ".join(x for x in [(req.city or "").strip(), req.country.strip()] if x)
        db.execute(
            """INSERT INTO live_bench_profiles
               (id, name, role, specialty, location, rate, status, rating, cases, experience, photo_url, bio,
                jurisdictions_json, featured, source, created_at,
                user_id, email, phone, country, city, currency, languages, bar_number, availability,
                phone_status, id_status, payout_status, flagged, flag_reasons, suspended, signup_ip, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'BUSY', 0, 0, ?, '', ?, ?, 0, 'member', ?,
                       ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', 'unverified', 'none', 'none', ?, ?, 0, ?, ?)""",
            (user_id, name, req.role.strip(), (req.specialty or req.role).strip(), location,
             int(req.hourly_rate or 0), int(req.years_experience or 0), req.bio.strip(), json.dumps(jur), now,
             user_id, email, (req.phone or "").strip(), req.country.strip(), (req.city or "").strip(),
             (req.currency or "USD").upper()[:3], (req.languages or "").strip(), req.bar_number,
             1 if reasons else 0, json.dumps(reasons), ip, now),
        )
        total = member_count(db)

    send_verification_email(email, vtoken, name)
    _send_email(email, "Welcome to Live Bench — you're live", _shell(
        f"Welcome to Live Bench, {_esc(name.split()[0])}",
        f"""<p>Your profile as <b>{_esc(req.role)}</b> is live in the Live Bench directory. Joining is free.</p>
<p><b>To get hired:</b> open your worker dashboard and switch to <b>Open</b> whenever you are ready to take work.
Lawyers see Open professionals first and can send you a task request right away.</p>
<p><a href="{SITE_URL}/live-bench/me" style="display:inline-block;background:#F5A623;color:#000;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Open my worker dashboard</a></p>
<p>Next, finish verification in the dashboard (phone, ID document and payout details) so clients can see you are verified.
Please also confirm your email using the separate verification email we just sent.</p>"""))
    _send_email(ADMIN_NOTIFY_EMAIL,
                f"[Live Bench] New worker: {name} — {req.role}" + (" ⚠ FLAGGED" if reasons else ""),
                _shell("New Live Bench worker", f"""
<p><b>{_esc(name)}</b> ({_esc(email)}) joined as <b>{_esc(req.role)}</b>, {_esc(location)}.</p>
<p>Rate: {_esc(req.currency or 'USD')} {_esc(req.hourly_rate or '—')}/hr · Phone: {_esc(req.phone or '—')} · Bar #: {_esc(req.bar_number or '—')}</p>
<p>Bio: {_esc(req.bio)}</p>
<p><b>Flags:</b> {_esc(', '.join(reasons) if reasons else 'none')}</p>
<p>Real workers so far: {total} (sample profiles hide automatically at {HIDE_SAMPLES_AT}).</p>
<p><a href="{SITE_URL}/admin/live-bench">Review in admin</a></p>"""))

    token = create_access_token(user_id, tenant_id, "expert_active", email)
    return {
        "access_token": token,
        "user": {"id": user_id, "tenant_id": tenant_id, "email": email, "full_name": name,
                 "role": "expert_active", "email_verified": False},
        "profile_id": user_id,
        "status": "live",
    }


# ── Worker (signed in) ────────────────────────────────────────────────────────

def _my_profile(db, uid: str) -> dict:
    ensure_member_columns(db)
    row = db.execute("SELECT * FROM live_bench_profiles WHERE id=? AND source='member'", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, "No Live Bench worker profile for this account.")
    return dict(row)


def _me_payload(p: dict) -> dict:
    out = dict(p)
    out["availability"] = effective_availability(p)
    try:
        out["jurisdictions"] = json.loads(p.get("jurisdictions_json") or "[]")
    except Exception:
        out["jurisdictions"] = []
    out["has_id_document"] = bool(p.get("id_doc_path"))
    for f in ("id_doc_path", "signup_ip", "flag_reasons", "flagged", "jurisdictions_json"):
        out.pop(f, None)
    return out


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        return _me_payload(_my_profile(db, current_user["sub"]))


class AvailabilityRequest(BaseModel):
    availability: str


@router.post("/me/availability")
async def set_availability(req: AvailabilityRequest, current_user: dict = Depends(get_current_user)):
    a = req.availability.upper()
    if a not in ("OPEN", "BUSY", "OFFLINE"):
        raise HTTPException(400, "availability must be OPEN, BUSY or OFFLINE")
    now = _now()
    with get_db() as db:
        p = _my_profile(db, current_user["sub"])
        if p.get("suspended"):
            raise HTTPException(403, "Your profile is paused while our team reviews it. Contact info@litigationspace.com.")
        db.execute(
            "UPDATE live_bench_profiles SET availability=?, status=?, last_heartbeat=?, updated_at=? WHERE id=?",
            (a, "READY" if a == "OPEN" else "BUSY", now, now, p["id"]),
        )
        db.execute("UPDATE users SET status=?, last_heartbeat=? WHERE id=?",
                   ("READY" if a == "OPEN" else ("BUSY" if a == "BUSY" else "LOCKED"), now, p["id"]))
    return {"availability": a, "last_heartbeat": now}


@router.post("/me/heartbeat")
async def heartbeat(current_user: dict = Depends(get_current_user)):
    now = _now()
    with get_db() as db:
        p = _my_profile(db, current_user["sub"])
        db.execute("UPDATE live_bench_profiles SET last_heartbeat=? WHERE id=?", (now, p["id"]))
    return {"ok": True, "last_heartbeat": now}


class ProfileUpdate(BaseModel):
    role: Optional[str] = None
    specialty: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    jurisdictions: Optional[str] = None
    languages: Optional[str] = None
    currency: Optional[str] = None
    hourly_rate: Optional[float] = None
    phone: Optional[str] = None
    bio: Optional[str] = None
    years_experience: Optional[int] = None


@router.put("/me")
async def update_me(req: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        p = _my_profile(db, current_user["sub"])
        sets, vals = [], []
        simple = {"role": req.role, "specialty": req.specialty, "city": req.city, "country": req.country,
                  "languages": req.languages, "bio": req.bio}
        for k, v in simple.items():
            if v is not None:
                sets.append(f"{k}=?"); vals.append(v.strip())
        if req.currency is not None:
            sets.append("currency=?"); vals.append(req.currency.upper()[:3])
        if req.hourly_rate is not None:
            sets.append("rate=?"); vals.append(int(req.hourly_rate))
        if req.years_experience is not None:
            sets.append("experience=?"); vals.append(int(req.years_experience))
        if req.phone is not None and req.phone.strip() != (p.get("phone") or ""):
            sets += ["phone=?", "phone_status='unverified'"]; vals.append(req.phone.strip())
        if req.jurisdictions is not None:
            sets.append("jurisdictions_json=?")
            vals.append(json.dumps([j.strip() for j in re.split(r"[,;]", req.jurisdictions) if j.strip()]))
        if req.city is not None or req.country is not None:
            city = req.city if req.city is not None else p.get("city") or ""
            country = req.country if req.country is not None else p.get("country") or ""
            sets.append("location=?"); vals.append(", ".join(x for x in [city.strip(), country.strip()] if x))
        if not sets:
            return _me_payload(p)
        sets.append("updated_at=?"); vals.append(_now())
        db.execute(f"UPDATE live_bench_profiles SET {', '.join(sets)} WHERE id=?", vals + [p["id"]])
        return _me_payload(_my_profile(db, p["id"]))


_ALLOWED_ID_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@router.post("/me/id-document")
async def upload_id(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    ext = _ALLOWED_ID_TYPES.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(400, "Upload a PDF, JPG, PNG or WEBP of your government ID or bar card.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File is larger than 10 MB.")
    if not data:
        raise HTTPException(400, "The file is empty.")
    with get_db() as db:
        p = _my_profile(db, current_user["sub"])
        folder = ID_UPLOAD_DIR / p["id"]
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"id-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{ext}"
        path.write_bytes(data)
        os.chmod(path, 0o600)
        db.execute("UPDATE live_bench_profiles SET id_doc_path=?, id_status='submitted', updated_at=? WHERE id=?",
                   (str(path), _now(), p["id"]))
    _send_email(ADMIN_NOTIFY_EMAIL, f"[Live Bench] ID submitted: {p['name']}",
                _shell("ID document submitted", f"<p>{_esc(p['name'])} ({_esc(p.get('email'))}) uploaded an ID document.</p>"
                       f"<p><a href=\"{SITE_URL}/admin/live-bench\">Review in admin</a></p>"))
    return {"id_status": "submitted"}


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/admin/workers")
async def admin_workers(flagged: Optional[bool] = None, _: dict = Depends(require_internal_dashboard)):
    with get_db() as db:
        ensure_member_columns(db)
        q = "SELECT * FROM live_bench_profiles WHERE source='member'"
        if flagged:
            q += " AND flagged=1"
        rows = [dict(r) for r in db.execute(q + " ORDER BY created_at DESC").fetchall()]
        samples = db.execute("SELECT COUNT(*) FROM live_bench_profiles WHERE COALESCE(source,'')!='member'").fetchone()[0]
    out = []
    for r in rows:
        r["availability"] = effective_availability(r)
        try:
            r["flag_reasons"] = json.loads(r.get("flag_reasons") or "[]")
        except Exception:
            r["flag_reasons"] = []
        r["has_id_document"] = bool(r.get("id_doc_path"))
        r.pop("id_doc_path", None)
        out.append(r)
    return {"workers": out, "members": len(out), "sample_profiles": samples,
            "samples_hidden": len([w for w in out if not w.get("suspended")]) >= HIDE_SAMPLES_AT,
            "hide_samples_at": HIDE_SAMPLES_AT}


class AdminAction(BaseModel):
    action: str  # verify_id | reject_id | verify_phone | suspend | unsuspend | clear_flag | flag
    note: Optional[str] = None


@router.post("/admin/workers/{worker_id}")
async def admin_action(worker_id: str, req: AdminAction, _: dict = Depends(require_internal_dashboard)):
    updates = {
        "verify_id": "id_status='verified'",
        "reject_id": "id_status='rejected'",
        "verify_phone": "phone_status='verified'",
        "suspend": "suspended=1, availability='OFFLINE', status='BUSY'",
        "unsuspend": "suspended=0",
        "clear_flag": "flagged=0, flag_reasons='[]'",
    }
    with get_db() as db:
        ensure_member_columns(db)
        row = db.execute("SELECT * FROM live_bench_profiles WHERE id=? AND source='member'", (worker_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Worker not found")
        if req.action == "flag":
            reasons = json.loads(dict(row).get("flag_reasons") or "[]")
            reasons.append(req.note or "flagged by admin")
            db.execute("UPDATE live_bench_profiles SET flagged=1, flag_reasons=? WHERE id=?",
                       (json.dumps(reasons), worker_id))
        elif req.action in updates:
            db.execute(f"UPDATE live_bench_profiles SET {updates[req.action]}, updated_at=? WHERE id=?",
                       (_now(), worker_id))
        else:
            raise HTTPException(400, "Unknown action")
    return {"ok": True}


@router.get("/admin/workers/{worker_id}/id-document")
async def admin_id_document(worker_id: str, _: dict = Depends(require_internal_dashboard)):
    with get_db() as db:
        ensure_member_columns(db)
        row = db.execute("SELECT id_doc_path FROM live_bench_profiles WHERE id=?", (worker_id,)).fetchone()
    path = row and row["id_doc_path"]
    if not path or not Path(path).is_file():
        raise HTTPException(404, "No ID document")
    return FileResponse(path)


def notify_worker_of_request(db, professional_id: str, client_name: str, title: str) -> None:
    """Called when a lawyer sends a task request; emails real workers only."""
    try:
        ensure_member_columns(db)
        row = db.execute("SELECT name, email FROM live_bench_profiles WHERE id=? AND source='member'",
                         (professional_id,)).fetchone()
        if not row or not row["email"]:
            return
        _send_email(row["email"], f"New Live Bench task request: {title}", _shell(
            "You have a new task request",
            f"<p>{_esc(client_name)} sent you a task request: <b>{_esc(title)}</b>.</p>"
            f"<p>Accept, counter or decline it from your worker dashboard.</p>"
            f"<p><a href=\"{SITE_URL}/live-bench/me\" style=\"display:inline-block;background:#F5A623;color:#000;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;\">Open my dashboard</a></p>"))
    except Exception as e:  # never block the hire on email
        print(f"[LIVEBENCH] worker notify failed: {e}")
