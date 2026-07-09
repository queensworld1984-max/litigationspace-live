"""
Live Bench Marketplace API
Remote legal talent marketplace — engagements, negotiations, time logs,
deliveries, disputes, and reviews.
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json as _json
import os

from app.database import get_db
from app.utils.auth import get_current_user, generate_id

router = APIRouter(prefix="/api/bench", tags=["bench-marketplace"])

logger = __import__('logging').getLogger(__name__)

# ── Status state machine ──────────────────────────────────────────────────────
ENGAGEMENT_STATUSES = [
    "draft",              # client drafting request
    "sent",               # sent to professional
    "countered",          # professional countered terms
    "accepted",           # client accepted / terms agreed
    "payment_pending",    # awaiting payment/authorization
    "authorized",         # payment authorized, work may begin
    "in_progress",        # professional working
    "submitted",          # professional submitted delivery
    "revision_requested", # client requested revision
    "approved",           # client approved delivery
    "paid_out",           # payment released to professional
    "disputed",           # dispute opened
    "cancelled",          # cancelled by either party
]

WORK_TYPES = [
    "consultation_30min",
    "consultation_60min",
    "document_review",
    "drafting_support",
    "case_strategy",
    "expert_opinion",
    "research_assignment",
    "filing_preparation",
    "case_management",
    "mediation_arbitration",
    "hourly_ongoing",
    "fixed_scope",
]

START_OPTIONS = ["immediately", "today", "this_week", "scheduled", "custom"]

# ── Schema creation ───────────────────────────────────────────────────────────

def _ensure_tables(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS bench_engagements (
            id                      TEXT PRIMARY KEY,
            client_id               TEXT NOT NULL,
            client_tenant_id        TEXT NOT NULL,
            professional_id         TEXT NOT NULL,
            professional_name       TEXT NOT NULL,
            professional_rate       REAL,
            work_type               TEXT NOT NULL,
            title                   TEXT NOT NULL,
            description             TEXT,
            status                  TEXT NOT NULL DEFAULT 'draft',
            payment_type            TEXT NOT NULL DEFAULT 'hourly',
            hourly_rate             REAL,
            fixed_fee               REAL,
            requested_start         TEXT,
            requested_deadline      TEXT,
            estimated_hours         REAL,
            max_approved_hours      REAL,
            delivery_due_date       TEXT,
            milestones_json         TEXT,
            counter_message         TEXT,
            counter_hours           REAL,
            counter_rate            REAL,
            counter_deadline        TEXT,
            counter_deposit         REAL,
            client_approved_hours   REAL,
            payment_authorized_at   TEXT,
            work_started_at         TEXT,
            submitted_at            TEXT,
            approved_at             TEXT,
            paid_out_at             TEXT,
            cancelled_at            TEXT,
            case_id                 TEXT,
            notes                   TEXT,
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bench_time_logs (
            id                  TEXT PRIMARY KEY,
            engagement_id       TEXT NOT NULL,
            professional_id     TEXT NOT NULL,
            client_id           TEXT NOT NULL,
            work_date           TEXT NOT NULL,
            hours_submitted     REAL NOT NULL,
            work_description    TEXT NOT NULL,
            notes               TEXT,
            evidence_files_json TEXT,
            client_status       TEXT NOT NULL DEFAULT 'pending',
            approved_hours      REAL,
            reviewed_at         TEXT,
            review_note         TEXT,
            created_at          TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bench_deliveries (
            id              TEXT PRIMARY KEY,
            engagement_id   TEXT NOT NULL,
            professional_id TEXT NOT NULL,
            client_id       TEXT NOT NULL,
            message         TEXT NOT NULL,
            files_json      TEXT,
            milestone       TEXT,
            client_status   TEXT NOT NULL DEFAULT 'pending',
            revision_note   TEXT,
            reviewed_at     TEXT,
            created_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bench_disputes (
            id              TEXT PRIMARY KEY,
            engagement_id   TEXT NOT NULL,
            opened_by       TEXT NOT NULL,
            reason          TEXT NOT NULL,
            explanation     TEXT NOT NULL,
            professional_response TEXT,
            admin_resolution TEXT,
            resolution_type TEXT,
            status          TEXT NOT NULL DEFAULT 'open',
            created_at      TEXT NOT NULL,
            resolved_at     TEXT
        );

        CREATE TABLE IF NOT EXISTS bench_reviews (
            id                  TEXT PRIMARY KEY,
            engagement_id       TEXT NOT NULL,
            reviewer_id         TEXT NOT NULL,
            reviewee_id         TEXT NOT NULL,
            reviewer_role       TEXT NOT NULL,
            overall_rating      REAL NOT NULL,
            communication       REAL,
            quality             REAL,
            timeliness          REAL,
            professionalism     REAL,
            written_feedback    TEXT,
            would_hire_again    INTEGER DEFAULT 1,
            tags_json           TEXT,
            created_at          TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bench_messages (
            id              TEXT PRIMARY KEY,
            engagement_id   TEXT NOT NULL,
            sender_id       TEXT NOT NULL,
            sender_role     TEXT NOT NULL,
            content         TEXT NOT NULL,
            files_json      TEXT,
            created_at      TEXT NOT NULL
        );
    """)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _eng_or_404(db, engagement_id: str, user_id: str):
    """Return engagement if user is client or professional, else 404."""
    e = db.execute(
        "SELECT * FROM bench_engagements WHERE id = ? AND (client_id = ? OR professional_id = ?)",
        (engagement_id, user_id, user_id)
    ).fetchone()
    if not e:
        raise HTTPException(404, "Engagement not found")
    return dict(e)


# ─────────────────────────────────────────────────────────────────────────────
#  ENGAGEMENTS
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/engagements")
async def create_engagement(req: dict, current_user: dict = Depends(get_current_user)):
    """Client creates a new engagement request (status=draft → sent)."""
    client_id   = current_user["sub"]
    tenant_id   = current_user["tenant_id"]
    now         = _now()
    eid         = generate_id()

    professional_id   = req.get("professional_id", "")
    professional_name = req.get("professional_name", "Professional")
    if not professional_id:
        raise HTTPException(400, "professional_id is required")

    with get_db() as db:
        _ensure_tables(db)

        # Look up the professional's rate
        profile = db.execute(
            "SELECT rate FROM live_bench_profiles WHERE id = ?",
            (professional_id,)
        ).fetchone()
        prof_rate = dict(profile)["rate"] if profile else req.get("hourly_rate")

        db.execute(
            """INSERT INTO bench_engagements
               (id, client_id, client_tenant_id, professional_id, professional_name,
                professional_rate, work_type, title, description, status,
                payment_type, hourly_rate, fixed_fee,
                requested_start, requested_deadline, estimated_hours, max_approved_hours,
                delivery_due_date, milestones_json, case_id, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,'sent',?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (eid, client_id, tenant_id, professional_id, professional_name,
             prof_rate,
             req.get("work_type", "fixed_scope"),
             req.get("title", "Legal Task Request"),
             req.get("description"),
             req.get("payment_type", "hourly"),
             req.get("hourly_rate") or prof_rate,
             req.get("fixed_fee"),
             req.get("requested_start", "this_week"),
             req.get("requested_deadline"),
             req.get("estimated_hours"),
             req.get("max_approved_hours"),
             req.get("delivery_due_date"),
             _json.dumps(req.get("milestones", [])),
             req.get("case_id"),
             req.get("notes"),
             now, now)
        )
    return {"engagement_id": eid, "status": "sent", "message": "Request sent to professional."}


@router.get("/engagements")
async def list_engagements(
    role: str = "client",
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """List engagements for the current user as client or professional."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        field = "client_id" if role == "client" else "professional_id"
        cond  = f"WHERE {field} = ?"
        params: list = [uid]
        if status:
            cond += " AND status = ?"
            params.append(status)
        rows = db.execute(
            f"SELECT * FROM bench_engagements {cond} ORDER BY updated_at DESC LIMIT 100",
            params
        ).fetchall()
        return {"engagements": [dict(r) for r in rows]}


@router.get("/engagements/{engagement_id}")
async def get_engagement(engagement_id: str, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        # Include time logs, deliveries, messages
        logs  = db.execute("SELECT * FROM bench_time_logs WHERE engagement_id = ? ORDER BY created_at", (engagement_id,)).fetchall()
        dels  = db.execute("SELECT * FROM bench_deliveries WHERE engagement_id = ? ORDER BY created_at DESC", (engagement_id,)).fetchall()
        msgs  = db.execute("SELECT * FROM bench_messages WHERE engagement_id = ? ORDER BY created_at", (engagement_id,)).fetchall()
        revs  = db.execute("SELECT * FROM bench_reviews WHERE engagement_id = ?", (engagement_id,)).fetchall()
        return {
            **e,
            "time_logs":  [dict(r) for r in logs],
            "deliveries": [dict(r) for r in dels],
            "messages":   [dict(r) for r in msgs],
            "reviews":    [dict(r) for r in revs],
        }


@router.post("/engagements/{engagement_id}/counter")
async def counter_engagement(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Professional counters client's request with different terms."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["professional_id"] != uid:
            raise HTTPException(403, "Only the professional can counter")
        if e["status"] not in ("sent", "draft"):
            raise HTTPException(400, f"Cannot counter — status is '{e['status']}'")
        db.execute(
            """UPDATE bench_engagements SET status='countered',
               counter_message=?, counter_hours=?, counter_rate=?,
               counter_deadline=?, counter_deposit=?, updated_at=?
               WHERE id=?""",
            (req.get("message"), req.get("hours"), req.get("rate"),
             req.get("deadline"), req.get("deposit"), now, engagement_id)
        )
    return {"status": "countered", "message": "Counter proposal sent to client."}


@router.post("/engagements/{engagement_id}/accept")
async def accept_engagement(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Client accepts terms (original or countered). Moves to payment_pending."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["client_id"] != uid:
            raise HTTPException(403, "Only the client can accept")
        if e["status"] not in ("sent", "countered"):
            raise HTTPException(400, f"Cannot accept — status is '{e['status']}'")
        db.execute(
            "UPDATE bench_engagements SET status='payment_pending', updated_at=? WHERE id=?",
            (now, engagement_id)
        )
    return {"status": "payment_pending", "message": "Terms accepted. Awaiting payment authorization."}


@router.post("/engagements/{engagement_id}/authorize-payment")
async def authorize_payment(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Mark payment as authorized (Zeffy/Stripe payment completed). Moves to authorized → in_progress."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["status"] not in ("payment_pending", "accepted"):
            raise HTTPException(400, f"Payment cannot be authorized at status '{e['status']}'")
        db.execute(
            """UPDATE bench_engagements
               SET status='authorized', payment_authorized_at=?, work_started_at=?, updated_at=?
               WHERE id=?""",
            (now, now, now, engagement_id)
        )
    return {"status": "authorized", "message": "Payment authorized. Professional may begin work."}


@router.post("/engagements/{engagement_id}/cancel")
async def cancel_engagement(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    now = _now()
    reason = req.get("reason", "Cancelled by user")
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["status"] in ("paid_out", "cancelled"):
            raise HTTPException(400, "Cannot cancel a completed or already cancelled engagement")
        db.execute(
            "UPDATE bench_engagements SET status='cancelled', cancelled_at=?, notes=?, updated_at=? WHERE id=?",
            (now, (e.get("notes") or "") + f"\nCancelled: {reason}", now, engagement_id)
        )
    return {"status": "cancelled"}


# ── Messages ──────────────────────────────────────────────────────────────────

@router.post("/engagements/{engagement_id}/messages")
async def send_message(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        role = "client" if e["client_id"] == uid else "professional"
        mid = generate_id()
        db.execute(
            "INSERT INTO bench_messages (id, engagement_id, sender_id, sender_role, content, files_json, created_at) VALUES (?,?,?,?,?,?,?)",
            (mid, engagement_id, uid, role, req.get("content", ""), _json.dumps(req.get("files", [])), _now())
        )
    return {"message_id": mid}


# ─────────────────────────────────────────────────────────────────────────────
#  TIME LOGS
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/engagements/{engagement_id}/time-logs")
async def submit_time_log(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Professional submits a time log for hourly work."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["professional_id"] != uid:
            raise HTTPException(403, "Only the professional can submit time logs")
        if e["status"] not in ("authorized", "in_progress"):
            raise HTTPException(400, "Can only log time when work is in progress")
        # Mark as in_progress if still authorized
        if e["status"] == "authorized":
            db.execute("UPDATE bench_engagements SET status='in_progress', updated_at=? WHERE id=?", (_now(), engagement_id))

        lid = generate_id()
        db.execute(
            """INSERT INTO bench_time_logs
               (id, engagement_id, professional_id, client_id, work_date,
                hours_submitted, work_description, notes, evidence_files_json, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (lid, engagement_id, uid, e["client_id"],
             req.get("work_date", _now()[:10]),
             float(req.get("hours_submitted", 0)),
             req.get("work_description", ""),
             req.get("notes"),
             _json.dumps(req.get("files", [])),
             _now())
        )
    return {"log_id": lid, "status": "pending_client_approval"}


@router.post("/engagements/{engagement_id}/time-logs/{log_id}/review")
async def review_time_log(engagement_id: str, log_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Client approves/rejects a time log."""
    uid    = current_user["sub"]
    action = req.get("action")  # "approve" | "reject" | "partial"
    if action not in ("approve", "reject", "partial"):
        raise HTTPException(400, "action must be approve, reject, or partial")
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["client_id"] != uid:
            raise HTTPException(403, "Only the client can review time logs")
        approved_hours = req.get("approved_hours")
        status_map = {"approve": "approved", "reject": "rejected", "partial": "partial"}
        db.execute(
            """UPDATE bench_time_logs
               SET client_status=?, approved_hours=?, reviewed_at=?, review_note=?
               WHERE id=? AND engagement_id=?""",
            (status_map[action], approved_hours, _now(), req.get("note"), log_id, engagement_id)
        )
    return {"log_id": log_id, "status": status_map[action]}


# ─────────────────────────────────────────────────────────────────────────────
#  DELIVERIES
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/engagements/{engagement_id}/deliveries")
async def submit_delivery(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Professional submits completed work for client review."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["professional_id"] != uid:
            raise HTTPException(403, "Only the professional can submit deliveries")
        if e["status"] not in ("authorized", "in_progress", "revision_requested"):
            raise HTTPException(400, f"Cannot submit delivery at status '{e['status']}'")

        did = generate_id()
        db.execute(
            """INSERT INTO bench_deliveries
               (id, engagement_id, professional_id, client_id, message, files_json, milestone, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (did, engagement_id, uid, e["client_id"],
             req.get("message", ""),
             _json.dumps(req.get("files", [])),
             req.get("milestone"),
             now)
        )
        db.execute(
            "UPDATE bench_engagements SET status='submitted', submitted_at=?, updated_at=? WHERE id=?",
            (now, now, engagement_id)
        )
    return {"delivery_id": did, "status": "submitted", "message": "Delivery submitted for client review."}


@router.post("/engagements/{engagement_id}/deliveries/{delivery_id}/approve")
async def approve_delivery(engagement_id: str, delivery_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Client approves delivery and releases payment."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["client_id"] != uid:
            raise HTTPException(403, "Only the client can approve delivery")
        if e["status"] != "submitted":
            raise HTTPException(400, "Delivery must be in 'submitted' status to approve")

        db.execute(
            "UPDATE bench_deliveries SET client_status='approved', reviewed_at=? WHERE id=? AND engagement_id=?",
            (now, delivery_id, engagement_id)
        )
        db.execute(
            "UPDATE bench_engagements SET status='approved', approved_at=?, updated_at=? WHERE id=?",
            (now, now, engagement_id)
        )
    return {"status": "approved", "message": "Delivery approved. Payment will be released to professional."}


@router.post("/engagements/{engagement_id}/deliveries/{delivery_id}/request-revision")
async def request_revision(engagement_id: str, delivery_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["client_id"] != uid:
            raise HTTPException(403, "Only the client can request revisions")
        db.execute(
            "UPDATE bench_deliveries SET client_status='revision_requested', revision_note=?, reviewed_at=? WHERE id=? AND engagement_id=?",
            (req.get("note", ""), now, delivery_id, engagement_id)
        )
        db.execute(
            "UPDATE bench_engagements SET status='revision_requested', updated_at=? WHERE id=?",
            (now, engagement_id)
        )
    return {"status": "revision_requested"}


@router.post("/engagements/{engagement_id}/release-payment")
async def release_payment(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Admin or approved flow: release payment to professional."""
    uid = current_user["sub"]
    now = _now()
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["status"] != "approved":
            raise HTTPException(400, "Payment can only be released after delivery approval")
        db.execute(
            "UPDATE bench_engagements SET status='paid_out', paid_out_at=?, updated_at=? WHERE id=?",
            (now, now, engagement_id)
        )
    return {"status": "paid_out", "message": "Payment released to professional."}


# ─────────────────────────────────────────────────────────────────────────────
#  DISPUTES
# ─────────────────────────────────────────────────────────────────────────────

DISPUTE_REASONS = [
    "work_not_delivered", "poor_quality", "missed_deadline",
    "excessive_hours", "wrong_assignment", "unauthorized_work",
    "professional_misconduct", "client_nonpayment"
]

@router.post("/engagements/{engagement_id}/disputes")
async def open_dispute(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    now = _now()
    reason = req.get("reason", "")
    if reason not in DISPUTE_REASONS:
        raise HTTPException(400, f"Invalid reason. Must be one of: {', '.join(DISPUTE_REASONS)}")
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        did = generate_id()
        db.execute(
            """INSERT INTO bench_disputes
               (id, engagement_id, opened_by, reason, explanation, status, created_at)
               VALUES (?,?,?,?,?,'open',?)""",
            (did, engagement_id, uid, reason, req.get("explanation", ""), now)
        )
        db.execute(
            "UPDATE bench_engagements SET status='disputed', updated_at=? WHERE id=?",
            (now, engagement_id)
        )
    return {"dispute_id": did, "status": "open"}


@router.post("/engagements/{engagement_id}/disputes/{dispute_id}/respond")
async def respond_to_dispute(engagement_id: str, dispute_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        _eng_or_404(db, engagement_id, uid)
        db.execute(
            "UPDATE bench_disputes SET professional_response=? WHERE id=? AND engagement_id=?",
            (req.get("response", ""), dispute_id, engagement_id)
        )
    return {"status": "responded"}


# ─────────────────────────────────────────────────────────────────────────────
#  REVIEWS
# ─────────────────────────────────────────────────────────────────────────────

REVIEW_TAGS = [
    "Fast Delivery", "Strong Legal Analysis", "Excellent Communication",
    "Court Knowledge", "Affordable", "Strategic Thinker",
    "Detail Oriented", "Highly Professional", "Responsive", "Expert in Field"
]

@router.post("/engagements/{engagement_id}/reviews")
async def submit_review(engagement_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        e = _eng_or_404(db, engagement_id, uid)
        if e["status"] not in ("approved", "paid_out"):
            raise HTTPException(400, "Reviews can only be submitted after completed paid work")

        # Determine who is reviewing whom
        if e["client_id"] == uid:
            reviewer_role = "client"
            reviewee_id   = e["professional_id"]
        else:
            reviewer_role = "professional"
            reviewee_id   = e["client_id"]

        # Check not already reviewed
        existing = db.execute(
            "SELECT id FROM bench_reviews WHERE engagement_id=? AND reviewer_id=?",
            (engagement_id, uid)
        ).fetchone()
        if existing:
            raise HTTPException(400, "You have already submitted a review for this engagement")

        rid = generate_id()
        db.execute(
            """INSERT INTO bench_reviews
               (id, engagement_id, reviewer_id, reviewee_id, reviewer_role,
                overall_rating, communication, quality, timeliness, professionalism,
                written_feedback, would_hire_again, tags_json, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (rid, engagement_id, uid, reviewee_id, reviewer_role,
             float(req.get("overall_rating", 5)),
             req.get("communication"), req.get("quality"),
             req.get("timeliness"), req.get("professionalism"),
             req.get("written_feedback"),
             1 if req.get("would_hire_again", True) else 0,
             _json.dumps(req.get("tags", [])),
             _now())
        )
    return {"review_id": rid, "message": "Review submitted. Thank you."}


# ─────────────────────────────────────────────────────────────────────────────
#  DASHBOARDS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/dashboard/client")
async def client_dashboard(current_user: dict = Depends(get_current_user)):
    """Client dashboard — all their engagements grouped by status."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            "SELECT * FROM bench_engagements WHERE client_id=? ORDER BY updated_at DESC",
            (uid,)
        ).fetchall()
        engs = [dict(r) for r in rows]

    grouped = {
        "drafts":              [e for e in engs if e["status"] == "draft"],
        "pending_offers":      [e for e in engs if e["status"] in ("sent", "countered")],
        "active_hires":        [e for e in engs if e["status"] in ("authorized", "in_progress")],
        "awaiting_payment":    [e for e in engs if e["status"] == "payment_pending"],
        "submitted_deliveries":[e for e in engs if e["status"] == "submitted"],
        "revision_requested":  [e for e in engs if e["status"] == "revision_requested"],
        "completed":           [e for e in engs if e["status"] in ("approved", "paid_out")],
        "disputed":            [e for e in engs if e["status"] == "disputed"],
        "cancelled":           [e for e in engs if e["status"] == "cancelled"],
    }
    return {"engagements": engs, "grouped": grouped, "total": len(engs)}


@router.get("/dashboard/professional")
async def professional_dashboard(current_user: dict = Depends(get_current_user)):
    """Professional dashboard — incoming requests, active work, earnings."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            "SELECT * FROM bench_engagements WHERE professional_id=? ORDER BY updated_at DESC",
            (uid,)
        ).fetchall()
        engs = [dict(r) for r in rows]
        # Total earnings from paid_out engagements
        paid = [e for e in engs if e["status"] == "paid_out"]
        total_earned = sum(
            (e.get("fixed_fee") or (e.get("client_approved_hours", 0) or e.get("estimated_hours", 0)) * (e.get("hourly_rate") or 0))
            for e in paid
        )

    grouped = {
        "incoming_requests": [e for e in engs if e["status"] in ("sent",)],
        "pending_negotiation":[e for e in engs if e["status"] == "countered"],
        "accepted_work":     [e for e in engs if e["status"] in ("accepted", "payment_pending")],
        "active_tasks":      [e for e in engs if e["status"] in ("authorized", "in_progress")],
        "submitted":         [e for e in engs if e["status"] == "submitted"],
        "revision_needed":   [e for e in engs if e["status"] == "revision_requested"],
        "pending_payment":   [e for e in engs if e["status"] == "approved"],
        "completed":         [e for e in engs if e["status"] == "paid_out"],
        "disputed":          [e for e in engs if e["status"] == "disputed"],
    }
    return {"engagements": engs, "grouped": grouped, "total": len(engs), "total_earned": total_earned}


# ─────────────────────────────────────────────────────────────────────────────
#  PROFILE ENHANCEMENTS — remote-first fields
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/profiles")
async def list_profiles(
    remote_only: bool = True,
    work_type: Optional[str] = None,
    timezone_filter: Optional[str] = None,
    languages: Optional[str] = None,
    available: Optional[str] = None,   # "now" | "today" | "this_week"
    payment_type: Optional[str] = None, # "hourly" | "fixed"
    min_rate: Optional[float] = None,
    max_rate: Optional[float] = None,
    role: Optional[str] = None,
    jurisdiction: Optional[str] = None,
    page: int = 1,
    limit: int = 15,
):
    """List Live Bench profiles with remote-first filters."""
    with get_db() as db:
        conditions = ["status = 'READY'"]
        params: list = []

        if role:
            conditions.append("role LIKE ?")
            params.append(f"%{role}%")
        if min_rate is not None:
            conditions.append("rate >= ?")
            params.append(min_rate)
        if max_rate is not None:
            conditions.append("rate <= ?")
            params.append(max_rate)
        if jurisdiction:
            conditions.append("(jurisdictions_json LIKE ? OR location LIKE ?)")
            params.extend([f"%{jurisdiction}%", f"%{jurisdiction}%"])

        where = " AND ".join(conditions)
        offset = (page - 1) * limit
        rows = db.execute(
            f"SELECT * FROM live_bench_profiles WHERE {where} ORDER BY featured DESC, rating DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        total = db.execute(f"SELECT COUNT(*) FROM live_bench_profiles WHERE {where}", params).fetchone()[0]

        profiles = []
        for r in rows:
            d = dict(r)
            # Add remote-first computed fields
            d["remote_available"] = True
            d["accepts_negotiation"] = True
            d["available_start"]  = "Immediately"
            d["estimated_response"] = "< 2 hours"
            d["minimum_booking"] = "30 minutes"
            d["completed_jobs"]  = 0
            try:
                d["jurisdictions"] = _json.loads(d.get("jurisdictions_json") or "[]")
            except Exception:
                d["jurisdictions"] = []
            profiles.append(d)

        return {"profiles": profiles, "total": total, "page": page, "pages": -(-total // limit)}



# ─────────────────────────────────────────────────────────────────────────────
#  INBOX — all conversations for the current user
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/inbox")
async def get_inbox(current_user: dict = Depends(get_current_user)):
    """Return all engagement threads the user is part of, newest first."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            """SELECT e.*,
               (SELECT content FROM bench_messages WHERE engagement_id=e.id ORDER BY created_at DESC LIMIT 1) as last_message,
               (SELECT created_at FROM bench_messages WHERE engagement_id=e.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
               (SELECT COUNT(*) FROM bench_messages WHERE engagement_id=e.id) as message_count
               FROM bench_engagements e
               WHERE e.client_id=? OR e.professional_id=?
               ORDER BY COALESCE(last_message_at, e.updated_at) DESC
               LIMIT 100""",
            (uid, uid)
        ).fetchall()
        return {"threads": [dict(r) for r in rows], "total": len(rows)}


@router.get("/inbox/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    """Quick unread count for sidebar badge."""
    uid = current_user["sub"]
    with get_db() as db:
        _ensure_tables(db)
        action_statuses = ("sent", "countered", "submitted", "revision_requested")
        cnt = db.execute(
            """SELECT COUNT(*) FROM bench_engagements
               WHERE (client_id=? OR professional_id=?)
               AND status IN (?,?,?,?)""",
            (uid, uid, *action_statuses)
        ).fetchone()[0]
        return {"count": cnt}


@router.post("/direct-message")
async def send_direct_message(req: dict, current_user: dict = Depends(get_current_user)):
    """Send a direct message to a professional — creates a lightweight engagement thread."""
    uid       = current_user["sub"]
    tenant_id = current_user["tenant_id"]
    now       = _now()
    eid       = generate_id()

    professional_id   = req.get("professional_id", "")
    professional_name = req.get("professional_name", "Professional")
    message_text      = req.get("message", "").strip()

    if not professional_id or not message_text:
        raise HTTPException(400, "professional_id and message are required")

    with get_db() as db:
        _ensure_tables(db)
        db.execute(
            """INSERT INTO bench_engagements
               (id, client_id, client_tenant_id, professional_id, professional_name,
                professional_rate, work_type, title, description, status,
                payment_type, created_at, updated_at)
               VALUES (?,?,?,?,?,NULL,'direct_message','Direct Message',?,'sent','none',?,?)""",
            (eid, uid, tenant_id, professional_id, professional_name, message_text, now, now)
        )
        mid = generate_id()
        db.execute(
            "INSERT INTO bench_messages (id, engagement_id, sender_id, sender_role, content, files_json, created_at) VALUES (?,?,?,?,?,?,?)",
            (mid, eid, uid, "client", message_text, "[]", now)
        )
    return {"engagement_id": eid, "message_id": mid, "status": "sent"}
