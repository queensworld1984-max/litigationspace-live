"""Expert / Live Bench Marketplace router."""
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_db
from app.models.schemas import ExpertStatusUpdate, ExpertHireRequest, WaitlistJoinRequest
from app.utils.auth import get_current_user, generate_id, hash_password

router = APIRouter(prefix="/api/experts", tags=["experts"])

# In-memory waitlist (Redis replacement for MVP)
_waitlists: dict[str, list[dict]] = {}


class ExpertApplicationRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role_type: str  # Lawyer, Paralegal, Case Manager, etc.
    practice_areas: Optional[str] = None
    years_experience: Optional[int] = None
    hourly_rate: Optional[float] = None
    jurisdictions: Optional[str] = None
    bar_number: Optional[str] = None
    linkedin_url: Optional[str] = None
    bio: Optional[str] = None


@router.post("/apply")
async def apply_as_expert(req: ExpertApplicationRequest):
    """Public endpoint for experts to apply to join Live Bench.
    Creates account with role: expert_pending. Expert is invisible to marketplace until approved."""
    with get_db() as db:
        # Check if email already exists
        existing = db.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered. Please sign in instead.")

        # Create tenant for the expert
        tenant_id = generate_id()
        db.execute(
            "INSERT INTO tenants (id, name, type) VALUES (?, ?, ?)",
            (tenant_id, f"{req.full_name} - Expert", "solo_practitioner")
        )

        # Create user with expert_pending role
        user_id = generate_id()
        password_hash = hash_password(req.password)
        specializations = req.practice_areas or ""
        if req.role_type:
            specializations = f"{req.role_type}; {specializations}" if specializations else req.role_type

        db.execute(
            """INSERT INTO users (id, tenant_id, email, password_hash, full_name, role,
               bar_number, jurisdiction, specializations, hourly_rate, bio, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, tenant_id, req.email, password_hash, req.full_name, "expert_pending",
             req.bar_number, req.jurisdictions, specializations, req.hourly_rate,
             req.bio, "LOCKED")
        )

        return {
            "status": "submitted",
            "user_id": user_id,
            "message": "Your application has been submitted. Our team will review your credentials and notify you once approved.",
            "role": "expert_pending"
        }


@router.get("")
async def list_experts(
    status: str = None,
    specialization: str = None,
    current_user: dict = Depends(get_current_user)
):
    """List all experts with live status. Visible across tenants for marketplace."""
    with get_db() as db:
        query = """
            SELECT id, tenant_id, email, full_name, role, bar_number, jurisdiction,
                   specializations, hourly_rate, status, bio, avatar_url, last_heartbeat, created_at
            FROM users WHERE role = 'expert'
        """
        params: list = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if specialization:
            query += " AND specializations LIKE ?"
            params.append(f"%{specialization}%")
        query += " ORDER BY status ASC, full_name ASC"
        experts = db.execute(query, params).fetchall()
        result = []
        for e in experts:
            expert_dict = dict(e)
            # Calculate if expert should be auto-locked
            if expert_dict["status"] == "READY" and expert_dict["last_heartbeat"]:
                last_hb = datetime.fromisoformat(expert_dict["last_heartbeat"])
                if datetime.now(timezone.utc) - last_hb > timedelta(minutes=15):
                    # Auto-lock
                    db.execute(
                        "UPDATE users SET status = 'LOCKED' WHERE id = ?",
                        (expert_dict["id"],)
                    )
                    expert_dict["status"] = "LOCKED"
            expert_dict["waitlist_count"] = len(_waitlists.get(expert_dict["id"], []))
            result.append(expert_dict)
        return result


@router.patch("/{expert_id}/status")
async def update_expert_status(
    expert_id: str,
    req: ExpertStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Toggle expert status: READY, BUSY, LOCKED."""
    if req.status not in ("READY", "BUSY", "LOCKED"):
        raise HTTPException(status_code=400, detail="Invalid status. Must be READY, BUSY, or LOCKED")

    with get_db() as db:
        expert = db.execute("SELECT * FROM users WHERE id = ? AND role = 'expert'", (expert_id,)).fetchone()
        if not expert:
            raise HTTPException(status_code=404, detail="Expert not found")

        # Only the expert themselves or an admin can change status
        if current_user["sub"] != expert_id and current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE users SET status = ?, last_heartbeat = ? WHERE id = ?",
            (req.status, now, expert_id)
        )

        old_status = expert["status"]

        # If transitioning from LOCKED to READY, notify waitlist
        if old_status == "LOCKED" and req.status == "READY":
            _notify_waitlist(expert_id, db)

        return {"id": expert_id, "status": req.status, "previous_status": old_status}


@router.post("/{expert_id}/heartbeat")
async def expert_heartbeat(
    expert_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Heartbeat ping to keep expert READY status alive."""
    if current_user["sub"] != expert_id:
        raise HTTPException(status_code=403, detail="Can only send heartbeat for yourself")

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            "UPDATE users SET last_heartbeat = ? WHERE id = ?",
            (now, expert_id)
        )
    return {"status": "ok", "heartbeat": now}


@router.post("/{expert_id}/hire")
async def hire_expert(
    expert_id: str,
    req: ExpertHireRequest,
    current_user: dict = Depends(get_current_user)
):
    """Hire an expert - assigns them to a case with time-limited access."""
    with get_db() as db:
        expert = db.execute(
            "SELECT * FROM users WHERE id = ? AND role = 'expert'", (expert_id,)
        ).fetchone()
        if not expert:
            raise HTTPException(status_code=404, detail="Expert not found")
        if expert["status"] != "READY":
            raise HTTPException(status_code=400, detail="Expert is not available (not READY)")

        # Verify case exists and belongs to requester's tenant
        case = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (req.case_id, current_user["tenant_id"])
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # Grant access
        access_id = generate_id()
        expires = (datetime.now(timezone.utc) + timedelta(hours=req.hours or 24)).isoformat()
        db.execute(
            """INSERT INTO case_experts (id, case_id, expert_id, role, access_level, expires_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (access_id, req.case_id, expert_id, req.role, req.access_level, expires)
        )

        # Set expert to BUSY
        db.execute("UPDATE users SET status = 'BUSY' WHERE id = ?", (expert_id,))

        # Create notification
        notif_id = generate_id()
        db.execute(
            """INSERT INTO notifications (id, user_id, tenant_id, type, title, message, data)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (notif_id, expert_id, expert["tenant_id"], "hire",
             "You've been hired!",
             f"You've been assigned to case: {case['title']}",
             json.dumps({"case_id": req.case_id, "access_id": access_id}))
        )

        return {
            "access_id": access_id,
            "expert_id": expert_id,
            "case_id": req.case_id,
            "access_level": req.access_level,
            "expires_at": expires,
            "status": "hired"
        }


@router.get("/{expert_id}/waitlist")
async def get_waitlist(expert_id: str, current_user: dict = Depends(get_current_user)):
    """Get the waitlist for an expert."""
    return _waitlists.get(expert_id, [])


@router.post("/{expert_id}/waitlist")
async def join_waitlist(
    expert_id: str,
    req: WaitlistJoinRequest,
    current_user: dict = Depends(get_current_user)
):
    """Join waitlist for a locked expert."""
    with get_db() as db:
        expert = db.execute(
            "SELECT * FROM users WHERE id = ? AND role = 'expert'", (expert_id,)
        ).fetchone()
        if not expert:
            raise HTTPException(status_code=404, detail="Expert not found")

    if expert_id not in _waitlists:
        _waitlists[expert_id] = []

    # Check if already in waitlist
    for entry in _waitlists[expert_id]:
        if entry["requester_id"] == current_user["sub"]:
            raise HTTPException(status_code=400, detail="Already in waitlist")

    position = len(_waitlists[expert_id]) + 1
    entry = {
        "id": generate_id(),
        "expert_id": expert_id,
        "requester_id": current_user["sub"],
        "case_id": req.case_id,
        "position": position,
        "status": "waiting",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    _waitlists[expert_id].append(entry)

    return {"position": position, "entry": entry}


def _notify_waitlist(expert_id: str, db):
    """Notify first person in waitlist when expert becomes READY."""
    waitlist = _waitlists.get(expert_id, [])
    if not waitlist:
        return

    first = waitlist[0]
    notif_id = generate_id()
    db.execute(
        """INSERT INTO notifications (id, user_id, tenant_id, type, title, message, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (notif_id, first["requester_id"], "", "waitlist_ready",
         "Expert is now available!",
         f"An expert you were waiting for is now READY.",
         json.dumps({"expert_id": expert_id}))
    )
    first["status"] = "notified"
"""
Live Bench booking endpoints.
Appended to experts.py router.
POST /api/experts/bench/book    — create pending booking, return Zeffy URL
POST /api/experts/bench/confirm — mark booking confirmed (after Zeffy payment)
GET  /api/experts/bench/bookings — list user's bookings
"""
import json as _json


@router.post("/bench/book")
async def initiate_bench_booking(
    req: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a pending Live Bench booking and return the expert's Zeffy payment URL.

    Request body:
      profile_id   str   — live_bench_profiles.id
      expert_name  str   — display name (for reference)
      case_id      str   — linked case (optional)
      hours        float — session length in hours (0.5 = 30 min, 1 = 60 min)
      price        float — agreed price in USD
    """
    profile_id  = req.get("profile_id", "")
    expert_name = req.get("expert_name", "Expert")
    case_id     = req.get("case_id") or None
    hours       = float(req.get("hours", 1.0))
    price       = float(req.get("price", 0))

    if not profile_id:
        raise HTTPException(status_code=400, detail="profile_id is required")

    user_id   = current_user["sub"]
    tenant_id = current_user["tenant_id"]
    now       = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        # Look up the expert profile
        profile = db.execute(
            "SELECT * FROM live_bench_profiles WHERE id = ?",
            (profile_id,)
        ).fetchone()

        if not profile:
            raise HTTPException(status_code=404, detail="Expert profile not found")

        profile_d = dict(profile)

        # Get Zeffy link from profile, or fall back to env / default
        zeffy_url = (
            profile_d.get("zeffy_link")
            or os.environ.get("LIVE_BENCH_ZEFFY_URL", "")
            or "https://www.zeffy.com/en-US/ticketing/live-bench-expert"
        )

        # Ensure bench_bookings table exists
        db.execute("""
            CREATE TABLE IF NOT EXISTS bench_bookings (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                tenant_id   TEXT NOT NULL,
                profile_id  TEXT NOT NULL,
                expert_name TEXT NOT NULL,
                case_id     TEXT,
                hours       REAL NOT NULL DEFAULT 1.0,
                price       REAL NOT NULL DEFAULT 0,
                status      TEXT NOT NULL DEFAULT 'pending',
                zeffy_url   TEXT,
                paid_at     TEXT,
                notes       TEXT,
                created_at  TEXT NOT NULL
            )
        """)

        booking_id = generate_id()
        db.execute(
            """INSERT INTO bench_bookings
               (id, user_id, tenant_id, profile_id, expert_name, case_id,
                hours, price, status, zeffy_url, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (booking_id, user_id, tenant_id, profile_id, expert_name,
             case_id, hours, price, zeffy_url, now)
        )

    logger.info(
        f"[BENCH BOOKING] Created booking {booking_id} for user {user_id} "
        f"— expert: {expert_name} ({hours}h @ ${price})"
    )

    return {
        "booking_id": booking_id,
        "zeffy_url":  zeffy_url,
        "expert_name": expert_name,
        "hours":  hours,
        "price":  price,
        "status": "pending",
        "message": "Booking created. Complete payment on Zeffy to confirm.",
    }


@router.post("/bench/confirm")
async def confirm_bench_booking(
    req: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Mark a bench booking as confirmed (called after Zeffy payment).
    Can be called manually by the user after paying, or auto-called by webhook.
    """
    booking_id = req.get("booking_id", "")
    if not booking_id:
        raise HTTPException(status_code=400, detail="booking_id is required")

    user_id   = current_user["sub"]
    tenant_id = current_user["tenant_id"]
    now       = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        booking = db.execute(
            "SELECT * FROM bench_bookings WHERE id = ? AND user_id = ? AND tenant_id = ?",
            (booking_id, user_id, tenant_id)
        ).fetchone()

        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")

        db.execute(
            "UPDATE bench_bookings SET status = 'confirmed', paid_at = ? WHERE id = ?",
            (now, booking_id)
        )

    logger.info(f"[BENCH BOOKING] Confirmed booking {booking_id} for user {user_id}")

    return {
        "booking_id": booking_id,
        "status": "confirmed",
        "message": "Booking confirmed. The expert will be in touch shortly.",
    }


@router.get("/bench/bookings")
async def list_bench_bookings(
    current_user: dict = Depends(get_current_user),
):
    """List current user's Live Bench bookings."""
    user_id   = current_user["sub"]
    tenant_id = current_user["tenant_id"]

    with get_db() as db:
        try:
            bookings = db.execute(
                """SELECT * FROM bench_bookings
                   WHERE user_id = ? AND tenant_id = ?
                   ORDER BY created_at DESC LIMIT 50""",
                (user_id, tenant_id)
            ).fetchall()
            return {"bookings": [dict(b) for b in bookings]}
        except Exception:
            return {"bookings": []}
