"""
Billing Router — Contracts, Time Tracking, Invoices, Earnings Dashboard.
Also owns the subscription/status endpoint and Zeffy webhook handler.
"""
from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import os
import secrets
import uuid
import logging

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.email import (
    send_invoice_email, send_scope_approval_email, send_billing_approval_email,
    send_scope_approved_contractor_email, send_scope_approved_confirm_client_email,
    send_billing_approved_contractor_email, send_billing_approved_confirm_client_email,
    send_deadline_reminder_contractor_email, send_deadline_reminder_client_email,
    send_scope_query_contractor_email, send_scope_rejected_contractor_email,
    send_scope_reminder_email, send_billing_reminder_email,
    parse_recipients,
)
from app.utils.subscription import resolve_subscription, init_trial, PLAN_MONTHLY_CREDITS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://litigationspace.com")
APPROVAL_TOKEN_EXPIRY_HOURS = 168  # 7 days
REMINDER_MIN_INTERVAL_HOURS = 24  # don't let a reminder go out more than once a day for the same task

# Documents attached to a task when sending it for billing approval —
# stored alongside the case-document uploads, same base dir.
UPLOAD_BASE_DIR = os.environ.get("UPLOAD_DIR", "/var/www/litigationspace/data/uploads")
MAX_TASK_ATTACHMENTS = 20
MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024  # 100MB per file
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".xlsx", ".csv", ".xls", ".pptx", ".ppt", ".tiff", ".tif", ".bmp", ".svg",
    ".heic", ".heif", ".msg", ".eml", ".pages", ".numbers", ".key", ".zip",
}


# ──────────────────────────────────────────
# Request Models
# ──────────────────────────────────────────

class ContractCreate(BaseModel):
    title: str
    client_name: str
    client_email: str = ""
    client_user_id: Optional[str] = None
    case_id: Optional[str] = None
    description: str = ""
    billing_type: str = "mixed"
    hourly_rate: Optional[float] = 0
    flat_rate_amount: Optional[float] = 0
    max_hours_per_day: Optional[float] = 0
    max_hours_per_week: Optional[float] = 0
    status: str = "active"
    contract_file_url: str = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    payment_link: str = ""
    notes: str = ""
    amount_paid: Optional[float] = 0
    rate_locked: Optional[bool] = False

class ContractUpdate(BaseModel):
    title: Optional[str] = None
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    description: Optional[str] = None
    billing_type: Optional[str] = None
    hourly_rate: Optional[float] = None
    max_hours_per_day: Optional[float] = None
    max_hours_per_week: Optional[float] = None
    status: Optional[str] = None
    payment_link: Optional[str] = None
    notes: Optional[str] = None
    amount_paid: Optional[float] = None
    flat_rate_amount: Optional[float] = None
    rate_locked: Optional[bool] = None

class TaskCreate(BaseModel):
    contract_id: str
    title: str
    description: str = ""
    entity_name: Optional[str] = None  # required, but falls back to the contract's client_name if omitted
    billing_type: str = "flat_fee"
    flat_fee_amount: float = 0
    hourly_rate: Optional[float] = None  # defaults to the contract's rate; ignored if the contract has rate_locked=True
    estimated_hours: float = 0
    case_id: Optional[str] = None
    task_date: Optional[str] = None  # YYYY-MM-DD; used for dedup (same title + same date = same task) — start date
    target_end_date: Optional[str] = None  # YYYY-MM-DD; expected completion date, shown to the client

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    entity_name: Optional[str] = None
    target_end_date: Optional[str] = None
    status: Optional[str] = None
    billing_type: Optional[str] = None
    flat_fee_amount: Optional[float] = None
    hourly_rate: Optional[float] = None  # rejected if the task's contract has rate_locked=True
    estimated_hours: Optional[float] = None
    task_date: Optional[str] = None

class TimeEntryCreate(BaseModel):
    contract_id: Optional[str] = None
    task_id: Optional[str] = None
    case_id: Optional[str] = None
    description: str = ""
    duration_minutes: float = 0
    hourly_rate: float = 0
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    billable: bool = True

class ApprovalRejection(BaseModel):
    reason: str = ""

class ScopeQuery(BaseModel):
    # Required — the whole point of "send back for explanation" is that the
    # contractor gets a concrete note to act on, unlike a reject reason which
    # is optional context.
    note: str

class ApprovalSendRequest(BaseModel):
    # Override the contract's on-file client name/email for this specific send —
    # e.g. sending to a named supervisor at the client company rather than a
    # generic company inbox. Falls back to the contract's client_name/client_email
    # when omitted.
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    # Pasted work summary shown alongside the bill — Gate 2 only.
    summary_text: Optional[str] = None

class TimeEntryUpdate(BaseModel):
    description: Optional[str] = None
    duration_minutes: Optional[float] = None
    end_time: Optional[str] = None
    status: Optional[str] = None

class InvoiceCreate(BaseModel):
    contract_id: Optional[str] = None
    contract_ids: List[str] = []
    client_name: str
    client_email: str = ""
    client_user_id: Optional[str] = None
    due_date: Optional[str] = None
    payment_link: str = ""
    notes: str = ""
    tax_rate: float = 0
    items: List[dict] = []
    # Extra fields stored in metadata JSON
    client_address: str = ""
    client_city: str = ""
    client_state: str = ""
    client_zip: str = ""
    from_name: str = ""
    from_firm: str = ""
    from_address: str = ""
    from_city: str = ""
    from_state: str = ""
    from_zip: str = ""
    from_phone: str = ""
    from_email: str = ""
    from_bar: str = ""

class InvoiceUpdate(BaseModel):
    client_name: Optional[str] = None
    client_email: str = ""
    due_date: Optional[str] = None
    payment_link: str = ""
    notes: str = ""
    tax_rate: float = 0
    items: List[dict] = []
    client_address: str = ""
    client_city: str = ""
    client_state: str = ""
    client_zip: str = ""
    from_name: str = ""
    from_firm: str = ""
    from_address: str = ""
    from_city: str = ""
    from_state: str = ""
    from_zip: str = ""
    from_phone: str = ""
    from_email: str = ""
    from_bar: str = ""

class InvoiceStatusUpdate(BaseModel):
    status: str

class InvoiceSend(BaseModel):
    to_emails: List[str]
    cc_emails: List[str] = []
    message: str = ""


# ──────────────────────────────────────────
# Contracts
# ──────────────────────────────────────────

@router.post("/contracts")
async def create_contract(req: ContractCreate, current_user: dict = Depends(get_current_user)):
    """Create a new contract."""
    tenant_id = current_user["tenant_id"]
    contract_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        db.execute(
            """INSERT INTO contracts (id, tenant_id, client_user_id, client_name, client_email,
               created_by, title, description, billing_type, hourly_rate, flat_rate_amount,
               max_hours_per_day, max_hours_per_week, status, contract_file_url,
               start_date, end_date, payment_link, notes, case_id, amount_paid, rate_locked, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (contract_id, tenant_id, req.client_user_id, req.client_name, req.client_email,
             current_user["sub"], req.title, req.description, req.billing_type,
             req.hourly_rate or 0, req.flat_rate_amount or 0,
             req.max_hours_per_day or 0, req.max_hours_per_week or 0,
             req.status, req.contract_file_url,
             req.start_date, req.end_date, req.payment_link, req.notes, req.case_id or None,
             req.amount_paid or 0, int(bool(req.rate_locked)), now, now)
        )
    return {"id": contract_id, "message": "Contract created"}


@router.get("/contracts")
async def list_contracts(status: Optional[str] = None, case_id: Optional[str] = None,
                          current_user: dict = Depends(get_current_user)):
    """List all contracts for tenant. Optionally filter by case_id."""
    tenant_id = current_user["tenant_id"]
    conditions = ["c.tenant_id = ?"]
    params: list = [tenant_id]
    if status:
        conditions.append("c.status = ?")
        params.append(status)
    if case_id:
        conditions.append("c.case_id = ?")
        params.append(case_id)
    where = " AND ".join(conditions)
    with get_db() as db:
        rows = db.execute(
            f"""SELECT c.*,
                  COUNT(DISTINCT ct.id) AS total_task_count,
                  COUNT(DISTINCT CASE WHEN ct.invoice_id IS NULL THEN ct.id END) AS unbilled_task_count,
                  COUNT(DISTINCT i.id) AS invoice_count
               FROM contracts c
               LEFT JOIN contract_tasks ct ON ct.contract_id = c.id AND ct.tenant_id = c.tenant_id
               LEFT JOIN invoices i ON i.contract_id = c.id AND i.tenant_id = c.tenant_id
               WHERE {where}
               GROUP BY c.id
               ORDER BY c.created_at DESC""",
            params
        ).fetchall()
        return {"contracts": [dict(r) for r in rows]}


@router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single contract with its tasks."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        contract = db.execute(
            "SELECT * FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        tasks = db.execute(
            "SELECT * FROM contract_tasks WHERE contract_id = ? AND tenant_id = ? ORDER BY created_at",
            (contract_id, tenant_id)
        ).fetchall()
        return {"contract": dict(contract), "tasks": [dict(t) for t in tasks]}


@router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, req: ContractUpdate, current_user: dict = Depends(get_current_user)):
    """Update a contract."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Contract not found")
        updates = {k: v for k, v in req.dict().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [contract_id, tenant_id]
        db.execute(f"UPDATE contracts SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Contract updated"}


@router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a contract and its tasks."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Contract not found")
        db.execute("DELETE FROM contract_tasks WHERE contract_id = ? AND tenant_id = ?", (contract_id, tenant_id))
        db.execute("DELETE FROM contracts WHERE id = ? AND tenant_id = ?", (contract_id, tenant_id))
    return {"message": "Contract deleted"}


# ──────────────────────────────────────────
# Contract Tasks
# ──────────────────────────────────────────

@router.post("/tasks")
async def create_task(req: TaskCreate, current_user: dict = Depends(get_current_user)):
    """Create a task under a contract. Deduplicates by title+date — returns existing task if match found."""
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    task_date = req.task_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    entity_name = (req.entity_name or "").strip()

    with get_db() as db:
        contract = db.execute(
            "SELECT id, client_name, hourly_rate, rate_locked FROM contracts WHERE id = ? AND tenant_id = ?",
            (req.contract_id, tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        # Entity is required, but callers that don't have a more specific one
        # (e.g. an auto-saved task from a stopped timer) fall back to the
        # contract's own client — same precedent as convert-to-task.
        if not entity_name:
            entity_name = (contract["client_name"] or "").strip()
        if not entity_name:
            raise HTTPException(status_code=400, detail="entity_name is required — every task must be attributed to a company/client")

        # Dedup: same title + same date on same contract = same task
        existing = db.execute(
            "SELECT * FROM contract_tasks WHERE contract_id = ? AND tenant_id = ? AND LOWER(title) = LOWER(?) AND task_date = ?",
            (req.contract_id, tenant_id, req.title.strip(), task_date)
        ).fetchone()
        if existing:
            return {"id": existing["id"], "message": "Task already exists", "duplicate": True, "task": dict(existing)}

        # Most clients let the contractor set a custom rate per task (defaulting
        # to the contract's rate). But a contract can be marked rate_locked — set
        # once on the client relationship — which forces every task under it to
        # use the contract's rate, no exceptions, so the figure can't be disputed.
        if contract["rate_locked"]:
            if req.hourly_rate is not None and req.hourly_rate != contract["hourly_rate"]:
                raise HTTPException(status_code=400, detail="This contract's rate is locked — tasks cannot use a different hourly rate")
            task_hourly_rate = contract["hourly_rate"] or 0
        else:
            task_hourly_rate = req.hourly_rate if req.hourly_rate is not None else (contract["hourly_rate"] or 0)

        task_id = generate_id()
        db.execute(
            """INSERT INTO contract_tasks (id, contract_id, tenant_id, title, description, entity_name,
               billing_type, flat_fee_amount, hourly_rate, estimated_hours, status, case_id, task_date,
               target_end_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (task_id, req.contract_id, tenant_id, req.title, req.description, entity_name,
             req.billing_type, req.flat_fee_amount, task_hourly_rate, req.estimated_hours,
             req.case_id, task_date, req.target_end_date, now)
        )
    return {"id": task_id, "message": "Task created", "duplicate": False}


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, req: TaskUpdate, current_user: dict = Depends(get_current_user)):
    """Update a contract task."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id, contract_id FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        updates = {k: v for k, v in req.dict().items() if v is not None}
        if "entity_name" in updates and not updates["entity_name"].strip():
            raise HTTPException(status_code=400, detail="entity_name cannot be blank")
        if "hourly_rate" in updates:
            contract = db.execute(
                "SELECT hourly_rate, rate_locked FROM contracts WHERE id = ? AND tenant_id = ?",
                (existing["contract_id"], tenant_id)
            ).fetchone()
            if contract and contract["rate_locked"] and updates["hourly_rate"] != contract["hourly_rate"]:
                raise HTTPException(status_code=400, detail="This contract's rate is locked — tasks cannot use a different hourly rate")
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        if "status" in updates and updates["status"] == "completed":
            updates["completed_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [task_id, tenant_id]
        db.execute(f"UPDATE contract_tasks SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Task updated"}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a contract task."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        db.execute("DELETE FROM contract_tasks WHERE id = ? AND tenant_id = ?", (task_id, tenant_id))
    return {"message": "Task deleted"}


@router.post("/tasks/{task_id}/log-time")
async def log_time_to_task(task_id: str, req: dict, current_user: dict = Depends(get_current_user)):
    """Add hours directly to an existing billable task — e.g. when a timer started
    against this specific task is stopped. Atomic server-side increment so this
    is safe even if multiple sessions are logging time concurrently."""
    tenant_id = current_user["tenant_id"]
    hours = float(req.get("hours") or 0)
    if hours <= 0:
        raise HTTPException(status_code=400, detail="hours must be greater than 0")
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        db.execute(
            "UPDATE contract_tasks SET estimated_hours = COALESCE(estimated_hours, 0) + ? WHERE id = ? AND tenant_id = ?",
            (hours, task_id, tenant_id)
        )
        updated = db.execute("SELECT estimated_hours FROM contract_tasks WHERE id = ?", (task_id,)).fetchone()
    return {"message": "Time logged to task", "estimated_hours": updated["estimated_hours"]}


@router.get("/contracts/{contract_id}/tasks")
async def list_contract_tasks(contract_id: str, current_user: dict = Depends(get_current_user)):
    """List ALL tasks on a contract (billed and unbilled), for case-scoped task management."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        contract = db.execute(
            "SELECT id FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        tasks = db.execute(
            "SELECT * FROM contract_tasks WHERE contract_id = ? AND tenant_id = ? ORDER BY task_date DESC, created_at DESC",
            (contract_id, tenant_id)
        ).fetchall()
    return {"tasks": [dict(t) for t in tasks]}


# ──────────────────────────────────────────
# Two-gate task approval (scope, then billing)
#
# Gate 1 (scope): client approves the task description + entity before any
# work starts. Gate 2 (billing): client approves the exact dollar amount
# after work is logged. Both gates support the same token-based no-login
# flow used for e-signatures (see signatures.py) AND an authenticated
# client-portal flow — both paths funnel through the same helpers below so
# approving via either route has identical effect.
# ──────────────────────────────────────────

def _validate_task_token(db, token: str, gate: str) -> dict:
    """Look up a contract_task by its scope/billing token, validating status + expiry."""
    token_col = "scope_token" if gate == "scope" else "billing_token"
    expires_col = "scope_token_expires_at" if gate == "scope" else "billing_token_expires_at"
    status_col = "scope_status" if gate == "scope" else "billing_status"

    task = db.execute(f"SELECT * FROM contract_tasks WHERE {token_col} = ?", (token,)).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Approval link not found")
    task_d = dict(task)

    if task_d[status_col] != "sent":
        raise HTTPException(status_code=410, detail=f"This request is already {task_d[status_col]}, not pending review")

    expires_at = task_d.get(expires_col)
    if expires_at and datetime.now(timezone.utc) > datetime.fromisoformat(expires_at):
        raise HTTPException(status_code=410, detail="This approval link has expired — ask your contractor to resend it")

    return task_d


def _approve_task_gate(db, task: dict, gate: str, ip: str):
    now = datetime.now(timezone.utc).isoformat()
    if gate == "scope":
        db.execute(
            "UPDATE contract_tasks SET scope_status='approved', scope_approved_at=?, scope_approved_ip=? WHERE id=?",
            (now, ip, task["id"])
        )
    else:
        db.execute(
            "UPDATE contract_tasks SET billing_status='approved', billing_approved_at=?, billing_approved_ip=? WHERE id=?",
            (now, ip, task["id"])
        )


def _reject_task_gate(db, task: dict, gate: str, ip: str, reason: str):
    now = datetime.now(timezone.utc).isoformat()
    if gate == "scope":
        db.execute(
            """UPDATE contract_tasks SET scope_status='rejected', scope_approved_at=?,
               scope_approved_ip=?, scope_rejected_reason=? WHERE id=?""",
            (now, ip, reason, task["id"])
        )
    else:
        db.execute(
            """UPDATE contract_tasks SET billing_status='rejected', billing_approved_at=?,
               billing_approved_ip=?, billing_rejected_reason=? WHERE id=?""",
            (now, ip, reason, task["id"])
        )


def _query_scope_gate(db, task: dict, ip: str, note: str):
    """Client sends the scope request back with a question — distinct from a
    reject: the task isn't dead, it just can't be approved as-is. The
    contractor edits and resends via the normal scope/send endpoint, which
    overwrites the token regardless of current status."""
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """UPDATE contract_tasks SET scope_status='queried', scope_query_note=?,
           scope_queried_at=?, scope_approved_ip=? WHERE id=?""",
        (note, now, ip, task["id"])
    )


def _notify_contractor_scope_query(task: dict, note: str):
    """Best-effort notification — the dashboard (scope_status='queried' +
    scope_query_note, both already persisted before this runs) is the
    reliable record even if this email fails to send."""
    contractor_email = task.get("scope_requested_by_email")
    if not contractor_email:
        return
    try:
        send_scope_query_contractor_email(
            to_email=contractor_email,
            contractor_name=task.get("scope_requested_by") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
            client_name=task.get("scope_recipient_name") or "Your client",
            query_note=note,
            dashboard_url=f"{FRONTEND_URL}/dashboard/billing",
        )
    except Exception as e:
        logger.warning(f"Scope query notification email failed for task {task.get('id')}: {e}")


def _notify_contractor_scope_rejected(task: dict, reason: str):
    """Best-effort notification — see _notify_contractor_scope_query: the DB
    write already happened, this is a convenience on top of it."""
    contractor_email = task.get("scope_requested_by_email")
    if not contractor_email:
        return
    try:
        send_scope_rejected_contractor_email(
            to_email=contractor_email,
            contractor_name=task.get("scope_requested_by") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
            client_name=task.get("scope_recipient_name") or "Your client",
            reason=reason or "",
            dashboard_url=f"{FRONTEND_URL}/dashboard/billing",
        )
    except Exception as e:
        logger.warning(f"Scope rejection notification email failed for task {task.get('id')}: {e}")


def _send_scope_approved_emails(task: dict):
    """Fire-and-forget notifications once scope is approved: contractor can
    start work, and the approving client/supervisor gets a confirmation."""
    contractor_email = task.get("scope_requested_by_email")
    if contractor_email:
        send_scope_approved_contractor_email(
            to_email=contractor_email,
            contractor_name=task.get("scope_requested_by") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
            approved_by_name=task.get("scope_recipient_name") or "Your client",
        )
    client_email = task.get("scope_recipient_email")
    if client_email:
        send_scope_approved_confirm_client_email(
            to_email=client_email,
            client_name=task.get("scope_recipient_name") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
        )


def _send_billing_approved_emails(task: dict):
    """Fire-and-forget notifications once billing is approved: contractor can
    invoice, and the approving client/supervisor gets a confirmation."""
    amount = task.get("billing_amount") or 0
    contractor_email = task.get("billing_requested_by_email")
    if contractor_email:
        send_billing_approved_contractor_email(
            to_email=contractor_email,
            contractor_name=task.get("billing_requested_by") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
            amount=amount,
            approved_by_name=task.get("billing_recipient_name") or "Your client",
        )
    client_email = task.get("billing_recipient_email")
    if client_email:
        send_billing_approved_confirm_client_email(
            to_email=client_email,
            client_name=task.get("billing_recipient_name") or "there",
            task_title=task["title"],
            entity_name=task.get("entity_name") or "",
            amount=amount,
        )


# ─── Gate 1: Scope approval ──────────────────────────────────────────

@router.post("/tasks/{task_id}/scope/send")
async def send_scope_approval(task_id: str, req: ApprovalSendRequest = ApprovalSendRequest(), current_user: dict = Depends(get_current_user)):
    """Send the client (or a named supervisor at the client) a scope-approval
    request for this task — required before work starts."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task_d = dict(task)

        contract = db.execute(
            "SELECT * FROM contracts WHERE id = ? AND tenant_id = ?",
            (task_d["contract_id"], tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract_d = dict(contract)

        raw_recipient = req.recipient_email or contract_d.get("client_email") or ""
        recipients = parse_recipients(raw_recipient)
        recipient_name = (req.recipient_name or contract_d.get("client_name") or "there").strip()
        if not recipients:
            raise HTTPException(status_code=400, detail="No valid recipient email — enter a supervisor email or add one to the contract")
        # Store the cleaned, deduped form (not whatever raw text was typed in) —
        # keeps the contract/task's on-file address valid for the next send too.
        recipient_email = ", ".join(recipients)

        # Look up the real name of whoever is sending this — the JWT only carries
        # sub/role/email, not full_name, so this can't be trusted from current_user.
        requester = db.execute("SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)).fetchone()
        requester_name = (requester["full_name"] if requester else None) or current_user.get("email", "Your contractor")

        requester_email = current_user.get("email", "")

        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=APPROVAL_TOKEN_EXPIRY_HOURS)).isoformat()
        db.execute(
            """UPDATE contract_tasks SET scope_status='sent', scope_token=?, scope_token_expires_at=?,
               scope_requested_by=?, scope_requested_by_email=?, scope_recipient_name=?, scope_recipient_email=?,
               scope_sent_at=?, scope_reminder_count=0, scope_last_reminded_at=NULL
               WHERE id=?""",
            (token, expires_at, requester_name, requester_email, recipient_name, recipient_email,
             datetime.now(timezone.utc).isoformat(), task_id)
        )

        approval_url = f"{FRONTEND_URL}/approve-scope/{token}"
        ok, detail = send_scope_approval_email(
            to_email=recipients,
            client_name=recipient_name,
            sender_name=requester_name,
            task_title=task_d["title"],
            task_description=task_d.get("description") or "",
            entity_name=task_d.get("entity_name") or "",
            approval_url=approval_url,
        )
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Saved, but the email failed to send ({detail}). "
                f"Share this link with {recipient_name} directly: {approval_url}"
            ),
        )
    return {"message": "Scope approval request sent", "approval_url": approval_url, "sent_to": recipients}


@router.get("/scope/{token}")
async def get_scope_for_approval(token: str):
    """Public: fetch task scope details for the client to review before approving. No auth required."""
    with get_db() as db:
        task = db.execute("SELECT * FROM contract_tasks WHERE scope_token = ?", (token,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Approval link not found")
        task_d = dict(task)
        contract = db.execute(
            "SELECT client_name, title FROM contracts WHERE id = ?",
            (task_d["contract_id"],)
        ).fetchone()
        return {
            "task_id": task_d["id"],
            "title": task_d["title"],
            "description": task_d.get("description"),
            "entity_name": task_d.get("entity_name"),
            "status": task_d["scope_status"],
            "requested_by": task_d.get("scope_requested_by"),
            "start_date": task_d.get("task_date"),
            "target_end_date": task_d.get("target_end_date"),
            "contract_title": contract["title"] if contract else None,
            "client_name": contract["client_name"] if contract else None,
        }


@router.post("/scope/{token}/approve")
async def approve_scope(token: str, request: Request):
    """Public: client approves the task scope. No auth required — the token is the credential."""
    with get_db() as db:
        task = _validate_task_token(db, token, "scope")
        ip = request.client.host if request.client else ""
        _approve_task_gate(db, task, "scope", ip)
    _send_scope_approved_emails(task)
    return {"message": "Scope approved"}


@router.post("/scope/{token}/reject")
async def reject_scope(token: str, req: ApprovalRejection, request: Request):
    """Public: client rejects the task scope. No auth required — the token is the credential."""
    with get_db() as db:
        task = _validate_task_token(db, token, "scope")
        ip = request.client.host if request.client else ""
        _reject_task_gate(db, task, "scope", ip, req.reason)
    _notify_contractor_scope_rejected(task, req.reason)
    return {"message": "Scope rejected"}


@router.post("/scope/{token}/query")
async def query_scope(token: str, req: ScopeQuery, request: Request):
    """Public: client sends the scope request back with a question, without
    rejecting it outright. No auth required — the token is the credential."""
    note = (req.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Add a note explaining what needs clarifying before sending this back.")
    with get_db() as db:
        task = _validate_task_token(db, token, "scope")
        ip = request.client.host if request.client else ""
        _query_scope_gate(db, task, ip, note)
    _notify_contractor_scope_query(task, note)
    return {"message": "Question sent back to your contractor"}


@router.post("/tasks/{task_id}/scope/remind")
async def remind_scope_approval(task_id: str, current_user: dict = Depends(get_current_user)):
    """Resend the existing Gate 1 approval link as a nudge, for a supervisor
    who hasn't acted on it yet. Reuses the original link (refreshing it if it
    expired) rather than starting a new request. Throttled so it can't be
    fired more than once a day for the same task."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task_d = dict(task)

        if task_d.get("scope_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending scope approval to remind about")
        if not task_d.get("scope_recipient_email"):
            raise HTTPException(status_code=400, detail="No recipient on file for this request")

        now = datetime.now(timezone.utc)
        last_reminded = task_d.get("scope_last_reminded_at")
        if last_reminded:
            elapsed_hours = (now - datetime.fromisoformat(last_reminded)).total_seconds() / 3600
            if elapsed_hours < REMINDER_MIN_INTERVAL_HOURS:
                wait_hours = round(REMINDER_MIN_INTERVAL_HOURS - elapsed_hours, 1)
                raise HTTPException(status_code=429, detail=f"A reminder was already sent recently — wait {wait_hours}h before sending another")

        token = task_d.get("scope_token")
        expires_at = task_d.get("scope_token_expires_at")
        if not token or not expires_at or datetime.fromisoformat(expires_at) <= now:
            token = secrets.token_urlsafe(32)
            expires_at = (now + timedelta(hours=APPROVAL_TOKEN_EXPIRY_HOURS)).isoformat()

        sent_at = task_d.get("scope_sent_at") or now.isoformat()
        days_pending = max(0, (now - datetime.fromisoformat(sent_at)).days)
        reminder_count = (task_d.get("scope_reminder_count") or 0) + 1

        db.execute(
            """UPDATE contract_tasks SET scope_token=?, scope_token_expires_at=?,
               scope_reminder_count=?, scope_last_reminded_at=? WHERE id=?""",
            (token, expires_at, reminder_count, now.isoformat(), task_id)
        )

        approval_url = f"{FRONTEND_URL}/approve-scope/{token}"
        ok, detail = send_scope_reminder_email(
            to_email=task_d["scope_recipient_email"],
            client_name=task_d.get("scope_recipient_name") or "there",
            sender_name=task_d.get("scope_requested_by") or current_user.get("email", "Your contractor"),
            task_title=task_d["title"],
            entity_name=task_d.get("entity_name") or "",
            approval_url=approval_url,
            days_pending=days_pending,
        )
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=f"Saved, but the reminder email failed to send ({detail}). Share this link directly: {approval_url}",
        )
    return {"message": "Reminder sent", "approval_url": approval_url, "sent_to": task_d["scope_recipient_email"], "reminder_count": reminder_count}


# ─── Task attachments — finished documents sent along with a bill ────

@router.post("/tasks/{task_id}/attachments")
async def upload_task_attachments(task_id: str, files: List[UploadFile] = File(...), current_user: dict = Depends(get_current_user)):
    """Attach finished work documents to a task (up to 20 total) before sending
    it for billing approval. The supervisor can download these from the
    approval page."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT id FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        existing_count = db.execute(
            "SELECT COUNT(*) as n FROM task_attachments WHERE task_id = ?", (task_id,)
        ).fetchone()["n"]
        if existing_count + len(files) > MAX_TASK_ATTACHMENTS:
            raise HTTPException(
                status_code=400,
                detail=f"Too many attachments — max {MAX_TASK_ATTACHMENTS} per task ({existing_count} already attached)"
            )

        upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / "billing_attachments" / task_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        saved = []
        for file in files:
            filename = file.filename or "unnamed_file"
            ext = Path(filename).suffix.lower()
            if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed on '{filename}'")

            file_bytes = await file.read()
            if len(file_bytes) > MAX_ATTACHMENT_SIZE:
                raise HTTPException(status_code=400, detail=f"'{filename}' is too large — max {MAX_ATTACHMENT_SIZE // (1024*1024)}MB per file")
            if len(file_bytes) == 0:
                raise HTTPException(status_code=400, detail=f"'{filename}' is empty")

            attachment_id = generate_id()
            safe_filename = f"{attachment_id}_{filename}"
            file_path = upload_dir / safe_filename
            file_path.write_bytes(file_bytes)
            relative_path = f"{tenant_id}/billing_attachments/{task_id}/{safe_filename}"
            mime_type = file.content_type or "application/octet-stream"

            db.execute(
                """INSERT INTO task_attachments (id, task_id, tenant_id, filename, file_path, mime_type, size_bytes, uploaded_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (attachment_id, task_id, tenant_id, filename, relative_path, mime_type, len(file_bytes), current_user["sub"])
            )
            saved.append({"id": attachment_id, "filename": filename, "size_bytes": len(file_bytes), "mime_type": mime_type})

    return {"attachments": saved}


@router.get("/tasks/{task_id}/attachments")
async def list_task_attachments(task_id: str, current_user: dict = Depends(get_current_user)):
    """List documents currently attached to a task (owner view)."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            "SELECT id, filename, mime_type, size_bytes, created_at FROM task_attachments WHERE task_id = ? AND tenant_id = ? ORDER BY created_at ASC",
            (task_id, tenant_id)
        ).fetchall()
        return {"attachments": [dict(r) for r in rows]}


@router.delete("/tasks/{task_id}/attachments/{attachment_id}")
async def delete_task_attachment(task_id: str, attachment_id: str, current_user: dict = Depends(get_current_user)):
    """Remove an attachment from a task before it's sent (or resend with a corrected set)."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        att = db.execute(
            "SELECT * FROM task_attachments WHERE id = ? AND task_id = ? AND tenant_id = ?",
            (attachment_id, task_id, tenant_id)
        ).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment not found")
        full_path = Path(UPLOAD_BASE_DIR) / att["file_path"]
        full_path.unlink(missing_ok=True)
        db.execute("DELETE FROM task_attachments WHERE id = ?", (attachment_id,))
    return {"message": "Attachment removed"}


@router.get("/billing-approval/{token}/attachments/{attachment_id}/download")
async def download_billing_attachment(token: str, attachment_id: str):
    """Public: download an attachment from a sent bill. No auth required — the
    token on the bill itself is the credential, same as the approval link."""
    with get_db() as db:
        task = db.execute("SELECT id FROM contract_tasks WHERE billing_token = ?", (token,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Approval link not found")
        att = db.execute(
            "SELECT * FROM task_attachments WHERE id = ? AND task_id = ?",
            (attachment_id, task["id"])
        ).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment not found")
        full_path = Path(UPLOAD_BASE_DIR) / att["file_path"]
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found on server")
        return FileResponse(full_path, media_type=att["mime_type"] or "application/octet-stream", filename=att["filename"])


# ─── Gate 2: Billing approval ────────────────────────────────────────

@router.post("/tasks/{task_id}/billing/send")
async def send_billing_approval(task_id: str, req: ApprovalSendRequest = ApprovalSendRequest(), current_user: dict = Depends(get_current_user)):
    """Send the client (or a named supervisor at the client) a billing-approval
    request with the exact amount owed for this task. Only allowed once the
    scope has already been approved."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task_d = dict(task)

        if task_d.get("scope_status") != "approved":
            raise HTTPException(status_code=400, detail="Scope must be approved before sending a bill for this task")

        contract = db.execute(
            "SELECT * FROM contracts WHERE id = ? AND tenant_id = ?",
            (task_d["contract_id"], tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract_d = dict(contract)

        raw_recipient = req.recipient_email or contract_d.get("client_email") or ""
        recipients = parse_recipients(raw_recipient)
        recipient_name = (req.recipient_name or contract_d.get("client_name") or "there").strip()
        if not recipients:
            raise HTTPException(status_code=400, detail="No valid recipient email — enter a supervisor email or add one to the contract")
        recipient_email = ", ".join(recipients)

        rate = task_d.get("hourly_rate") or 0
        if task_d.get("billing_type") == "hourly":
            # Prefer the hours entered directly on the task (the common path —
            # tasks created via the Add Task form carry their own estimated_hours).
            # Fall back to summing linked time-tracker entries if the task itself
            # has no hours but time was tracked against it via the timer.
            hours = task_d.get("estimated_hours") or 0
            if not hours:
                total_minutes = db.execute(
                    """SELECT COALESCE(SUM(duration_minutes), 0) as mins FROM billing_time_entries
                       WHERE task_id = ? AND tenant_id = ? AND status IN ('completed', 'invoiced')""",
                    (task_id, tenant_id)
                ).fetchone()["mins"]
                hours = round((total_minutes or 0) / 60.0, 2)
            amount = round(hours * rate, 2)
        else:
            hours = 0
            amount = task_d.get("flat_fee_amount") or 0

        if amount <= 0:
            raise HTTPException(status_code=400, detail="No billable time or amount logged for this task yet")

        requester = db.execute("SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)).fetchone()
        requester_name = (requester["full_name"] if requester else None) or current_user.get("email", "Your contractor")
        requester_email = current_user.get("email", "")

        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=APPROVAL_TOKEN_EXPIRY_HOURS)).isoformat()
        summary_text = (req.summary_text or "").strip()
        db.execute(
            """UPDATE contract_tasks SET billing_status='sent', billing_token=?, billing_token_expires_at=?, billing_amount=?,
               billing_requested_by=?, billing_requested_by_email=?, billing_recipient_name=?, billing_recipient_email=?,
               billing_summary_text=?, billing_sent_at=?, billing_reminder_count=0, billing_last_reminded_at=NULL
               WHERE id=?""",
            (token, expires_at, amount, requester_name, requester_email, recipient_name, recipient_email, summary_text,
             datetime.now(timezone.utc).isoformat(), task_id)
        )

        attachment_count = db.execute(
            "SELECT COUNT(*) as n FROM task_attachments WHERE task_id = ?", (task_id,)
        ).fetchone()["n"]

        approval_url = f"{FRONTEND_URL}/approve-bill/{token}"
        ok, detail = send_billing_approval_email(
            to_email=recipients,
            client_name=recipient_name,
            sender_name=requester_name,
            task_title=task_d["title"],
            entity_name=task_d.get("entity_name") or "",
            hours=hours,
            hourly_rate=rate,
            amount=amount,
            approval_url=approval_url,
            attachment_count=attachment_count,
        )
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Saved, but the email failed to send ({detail}). "
                f"Share this link with {recipient_name} directly: {approval_url}"
            ),
        )
    return {"message": "Billing approval request sent", "amount": amount, "approval_url": approval_url, "sent_to": recipients}


@router.post("/tasks/{task_id}/billing/remind")
async def remind_billing_approval(task_id: str, current_user: dict = Depends(get_current_user)):
    """Resend the existing Gate 2 approval link as a nudge, for a supervisor
    who hasn't approved the bill yet. Reuses the original link (refreshing it
    if it expired) rather than starting a new request. Throttled so it can't
    be fired more than once a day for the same task."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task_d = dict(task)

        if task_d.get("billing_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending billing approval to remind about")
        if not task_d.get("billing_recipient_email"):
            raise HTTPException(status_code=400, detail="No recipient on file for this request")

        now = datetime.now(timezone.utc)
        last_reminded = task_d.get("billing_last_reminded_at")
        if last_reminded:
            elapsed_hours = (now - datetime.fromisoformat(last_reminded)).total_seconds() / 3600
            if elapsed_hours < REMINDER_MIN_INTERVAL_HOURS:
                wait_hours = round(REMINDER_MIN_INTERVAL_HOURS - elapsed_hours, 1)
                raise HTTPException(status_code=429, detail=f"A reminder was already sent recently — wait {wait_hours}h before sending another")

        token = task_d.get("billing_token")
        expires_at = task_d.get("billing_token_expires_at")
        if not token or not expires_at or datetime.fromisoformat(expires_at) <= now:
            token = secrets.token_urlsafe(32)
            expires_at = (now + timedelta(hours=APPROVAL_TOKEN_EXPIRY_HOURS)).isoformat()

        sent_at = task_d.get("billing_sent_at") or now.isoformat()
        days_pending = max(0, (now - datetime.fromisoformat(sent_at)).days)
        reminder_count = (task_d.get("billing_reminder_count") or 0) + 1

        db.execute(
            """UPDATE contract_tasks SET billing_token=?, billing_token_expires_at=?,
               billing_reminder_count=?, billing_last_reminded_at=? WHERE id=?""",
            (token, expires_at, reminder_count, now.isoformat(), task_id)
        )

        approval_url = f"{FRONTEND_URL}/approve-bill/{token}"
        ok, detail = send_billing_reminder_email(
            to_email=task_d["billing_recipient_email"],
            client_name=task_d.get("billing_recipient_name") or "there",
            sender_name=task_d.get("billing_requested_by") or current_user.get("email", "Your contractor"),
            task_title=task_d["title"],
            entity_name=task_d.get("entity_name") or "",
            amount=task_d.get("billing_amount") or 0,
            approval_url=approval_url,
            days_pending=days_pending,
        )
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=f"Saved, but the reminder email failed to send ({detail}). Share this link directly: {approval_url}",
        )
    return {"message": "Reminder sent", "approval_url": approval_url, "sent_to": task_d["billing_recipient_email"], "reminder_count": reminder_count}


@router.get("/billing-approval/{token}")
async def get_billing_for_approval(token: str):
    """Public: fetch the bill details for the client to review before approving. No auth required."""
    with get_db() as db:
        task = db.execute("SELECT * FROM contract_tasks WHERE billing_token = ?", (token,)).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Approval link not found")
        task_d = dict(task)
        contract = db.execute(
            "SELECT client_name FROM contracts WHERE id = ?",
            (task_d["contract_id"],)
        ).fetchone()
        attachments = db.execute(
            "SELECT id, filename, mime_type, size_bytes FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC",
            (task_d["id"],)
        ).fetchall()
        return {
            "task_id": task_d["id"],
            "title": task_d["title"],
            "entity_name": task_d.get("entity_name"),
            "hourly_rate": task_d.get("hourly_rate"),
            "amount": task_d.get("billing_amount"),
            "status": task_d["billing_status"],
            "requested_by": task_d.get("billing_requested_by"),
            "start_date": task_d.get("task_date"),
            "target_end_date": task_d.get("target_end_date"),
            "client_name": contract["client_name"] if contract else None,
            "summary_text": task_d.get("billing_summary_text") or "",
            "attachments": [dict(a) for a in attachments],
        }


@router.post("/billing-approval/{token}/approve")
async def approve_billing(token: str, request: Request):
    """Public: client approves the exact billed amount. No auth required — the token is the credential."""
    with get_db() as db:
        task = _validate_task_token(db, token, "billing")
        ip = request.client.host if request.client else ""
        _approve_task_gate(db, task, "billing", ip)
    _send_billing_approved_emails(task)
    return {"message": "Bill approved"}


@router.post("/billing-approval/{token}/reject")
async def reject_billing(token: str, req: ApprovalRejection, request: Request):
    """Public: client rejects the billed amount. No auth required — the token is the credential."""
    with get_db() as db:
        task = _validate_task_token(db, token, "billing")
        ip = request.client.host if request.client else ""
        _reject_task_gate(db, task, "billing", ip, req.reason)
    return {"message": "Bill rejected"}


@router.get("/contracts/{contract_id}/tasks/unbilled")
async def get_unbilled_tasks(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Return all tasks on a contract that have not yet been included in any invoice.
    Use this to build the next invoice without duplicating already-billed work."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        contract = db.execute(
            "SELECT * FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        tasks = db.execute(
            """SELECT * FROM contract_tasks
               WHERE contract_id = ? AND tenant_id = ? AND invoice_id IS NULL
               ORDER BY task_date ASC, created_at ASC""",
            (contract_id, tenant_id)
        ).fetchall()

        # Also return unbilled time entries on this contract
        time_entries = db.execute(
            """SELECT * FROM billing_time_entries
               WHERE contract_id = ? AND tenant_id = ? AND status = 'completed'
               ORDER BY start_time ASC""",
            (contract_id, tenant_id)
        ).fetchall()

    return {
        "contract": dict(contract),
        "unbilled_tasks": [dict(t) for t in tasks],
        "unbilled_time_entries": [dict(e) for e in time_entries],
        "summary": {
            "task_count": len(tasks),
            "time_entry_count": len(time_entries),
            "task_total": sum(t["flat_fee_amount"] for t in tasks if t["billing_type"] == "flat_fee"),
            "time_total": sum(e["amount"] for e in time_entries),
        }
    }


@router.get("/clients")
async def list_clients(current_user: dict = Depends(get_current_user)):
    """Return distinct clients who already have contracts — so you can pick an existing client
    without creating a new contract from scratch."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        clients = db.execute(
            """SELECT client_name, client_email, client_user_id,
                      COUNT(*) as contract_count,
                      MAX(created_at) as last_contract_at,
                      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_contracts
               FROM contracts
               WHERE tenant_id = ?
               GROUP BY LOWER(client_email), client_name
               ORDER BY last_contract_at DESC""",
            (tenant_id,)
        ).fetchall()
    return {"clients": [dict(c) for c in clients]}


# ──────────────────────────────────────────
# Time Entries
# ──────────────────────────────────────────

@router.post("/time-entries")
async def create_time_entry(req: TimeEntryCreate, current_user: dict = Depends(get_current_user)):
    """Log a time entry (manual or start timer)."""
    tenant_id = current_user["tenant_id"]
    entry_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()
    start = req.start_time or now
    amount = (req.duration_minutes / 60.0) * req.hourly_rate if req.duration_minutes and req.hourly_rate else 0
    status = "completed" if req.duration_minutes else "running"

    with get_db() as db:
        db.execute(
            """INSERT INTO billing_time_entries (id, contract_id, task_id, case_id, tenant_id, user_id,
               start_time, end_time, duration_minutes, description, hourly_rate, amount, billable, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry_id, req.contract_id, req.task_id, req.case_id, tenant_id, current_user["sub"],
             start, req.end_time, req.duration_minutes, req.description, req.hourly_rate,
             amount, 1 if req.billable else 0, status, now)
        )
    return {"id": entry_id, "message": "Time entry created", "amount": amount}


@router.get("/time-entries")
async def list_time_entries(contract_id: Optional[str] = None, case_id: Optional[str] = None,
                             status: Optional[str] = None, limit: int = 100, offset: int = 0,
                             current_user: dict = Depends(get_current_user)):
    """List time entries with optional filters."""
    tenant_id = current_user["tenant_id"]
    conditions = ["tenant_id = ?"]
    params: list = [tenant_id]

    # Clients can only see entries on their contracts
    if current_user["role"] == "client":
        conditions.append("contract_id IN (SELECT id FROM contracts WHERE client_user_id = ? AND tenant_id = ?)")
        params.extend([current_user["sub"], tenant_id])

    if contract_id:
        conditions.append("contract_id = ?")
        params.append(contract_id)
    if case_id:
        conditions.append("case_id = ?")
        params.append(case_id)
    if status:
        conditions.append("status = ?")
        params.append(status)

    where = " AND ".join(conditions)
    params.extend([min(limit, 200), offset])

    with get_db() as db:
        entries = db.execute(
            f"SELECT * FROM billing_time_entries WHERE {where} ORDER BY start_time DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as cnt FROM billing_time_entries WHERE {where}",
            params[:-2]
        ).fetchone()["cnt"]
    return {"entries": [dict(e) for e in entries], "total": total}


@router.put("/time-entries/{entry_id}")
async def update_time_entry(entry_id: str, req: TimeEntryUpdate, current_user: dict = Depends(get_current_user)):
    """Update a time entry (e.g., stop timer)."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ?",
            (entry_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Time entry not found")

        updates = {k: v for k, v in req.dict().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        # If stopping a timer, calculate duration and amount
        if "end_time" in updates and existing["status"] == "running":
            from datetime import datetime as dt
            try:
                start = dt.fromisoformat(existing["start_time"].replace("Z", "+00:00"))
                end = dt.fromisoformat(updates["end_time"].replace("Z", "+00:00"))
                duration = (end - start).total_seconds() / 60.0
                updates["duration_minutes"] = round(duration, 2)
                updates["amount"] = round((duration / 60.0) * existing["hourly_rate"], 2)
                updates["status"] = "completed"
            except (ValueError, TypeError):
                pass

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [entry_id, tenant_id]
        db.execute(f"UPDATE billing_time_entries SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Time entry updated"}


@router.delete("/time-entries/{entry_id}")
async def delete_time_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a time entry."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id, status FROM billing_time_entries WHERE id = ? AND tenant_id = ?",
            (entry_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Time entry not found")
        if existing["status"] == "invoiced":
            raise HTTPException(status_code=400, detail="Cannot delete an invoiced time entry")
        db.execute("DELETE FROM billing_time_entries WHERE id = ? AND tenant_id = ?", (entry_id, tenant_id))
    return {"message": "Time entry deleted"}


# ──────────────────────────────────────────
# Auto-Timer (start/stop/heartbeat/active)
# ──────────────────────────────────────────

@router.get("/timer/active")
async def get_active_timer(case_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get the currently running timer for the user (optionally filtered by case)."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    conditions = ["tenant_id = ?", "user_id = ?", "status = 'running'"]
    params: list = [tenant_id, user_id]
    if case_id:
        conditions.append("case_id = ?")
        params.append(case_id)
    where = " AND ".join(conditions)
    with get_db() as db:
        entry = db.execute(
            f"SELECT * FROM billing_time_entries WHERE {where} ORDER BY start_time DESC LIMIT 1",
            params
        ).fetchone()
    if entry:
        return {"active": True, "entry": dict(entry)}
    return {"active": False, "entry": None}


@router.post("/timer/start")
async def start_timer(case_id: str = "unassigned", description: str = "Auto-tracked time",
                      hourly_rate: float = 0, contract_id: Optional[str] = None,
                      task_id: Optional[str] = None,
                      current_user: dict = Depends(get_current_user)):
    """Start an auto-timer for a case (optionally tied to a specific contract and/or
    existing billable task). Stops any existing running timer first."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        # Stop any existing running timer for this user
        running = db.execute(
            "SELECT * FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND status = 'running'",
            (tenant_id, user_id)
        ).fetchall()
        for r in running:
            try:
                start = datetime.fromisoformat(r["start_time"].replace("Z", "+00:00"))
                end = datetime.now(timezone.utc)
                duration = (end - start).total_seconds() / 60.0
                amount = round((duration / 60.0) * (r["hourly_rate"] or 0), 2)
                db.execute(
                    "UPDATE billing_time_entries SET end_time = ?, duration_minutes = ?, amount = ?, status = 'completed' WHERE id = ?",
                    (now, round(duration, 2), amount, r["id"])
                )
            except (ValueError, TypeError):
                db.execute(
                    "UPDATE billing_time_entries SET end_time = ?, status = 'completed' WHERE id = ?",
                    (now, r["id"])
                )

        # Start new timer
        entry_id = generate_id()
        db.execute(
            """INSERT INTO billing_time_entries (id, contract_id, task_id, case_id, tenant_id, user_id,
               start_time, end_time, duration_minutes, description, hourly_rate, amount, billable, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 0, 1, 'running', ?)""",
            (entry_id, contract_id, task_id, case_id, tenant_id, user_id, now, description, hourly_rate, now)
        )
    return {"id": entry_id, "message": "Timer started", "start_time": now, "task_id": task_id}


def _add_hours_to_task(db, task_id: Optional[str], tenant_id: str, duration_minutes: float) -> float:
    """Atomically add tracked time to a task's running hour total when a timer
    tied to that task is stopped. Runs in the same transaction as completing
    the time entry, so the task total can never drift from what was actually
    saved (previously this was a separate follow-up request from the browser
    that could silently fail — e.g. on page unload — leaving the entry saved
    but the task's hours never incremented)."""
    if not task_id or duration_minutes < 0.5:
        return 0
    hours = round(duration_minutes / 60.0, 4)
    db.execute(
        "UPDATE contract_tasks SET estimated_hours = COALESCE(estimated_hours, 0) + ? WHERE id = ? AND tenant_id = ?",
        (hours, task_id, tenant_id)
    )
    return hours


@router.post("/timer/stop")
async def stop_timer(entry_id: Optional[str] = None, case_id: Optional[str] = None,
                     current_user: dict = Depends(get_current_user)):
    """Stop a running timer by entry_id or by case_id (stops the active timer for that case)."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        if entry_id:
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ? AND user_id = ?",
                (entry_id, tenant_id, user_id)
            ).fetchone()
        elif case_id:
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE case_id = ? AND tenant_id = ? AND user_id = ? AND status = 'running' ORDER BY start_time DESC LIMIT 1",
                (case_id, tenant_id, user_id)
            ).fetchone()
        else:
            # Stop any running timer
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND status = 'running' ORDER BY start_time DESC LIMIT 1",
                (tenant_id, user_id)
            ).fetchone()

        if not entry:
            return {"message": "No running timer found", "stopped": False}

        if entry["status"] != "running":
            return {"message": "Timer already stopped", "stopped": False}

        try:
            start = datetime.fromisoformat(entry["start_time"].replace("Z", "+00:00"))
            end = datetime.now(timezone.utc)
            duration = (end - start).total_seconds() / 60.0
            amount = round((duration / 60.0) * (entry["hourly_rate"] or 0), 2)
            db.execute(
                "UPDATE billing_time_entries SET end_time = ?, duration_minutes = ?, amount = ?, status = 'completed' WHERE id = ?",
                (now, round(duration, 2), amount, entry["id"])
            )
        except (ValueError, TypeError):
            db.execute(
                "UPDATE billing_time_entries SET end_time = ?, status = 'completed' WHERE id = ?",
                (now, entry["id"])
            )
            duration = 0
            amount = 0

        hours_added = _add_hours_to_task(db, entry["task_id"], tenant_id, duration)

    return {"message": "Timer stopped", "stopped": True, "duration_minutes": round(duration, 2), "amount": amount, "task_hours_added": hours_added}


@router.post("/timer/heartbeat")
async def timer_heartbeat(entry_id: Optional[str] = None, case_id: Optional[str] = None,
                          current_user: dict = Depends(get_current_user)):
    """Heartbeat to keep a running timer alive. Returns current elapsed time."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]

    with get_db() as db:
        if entry_id:
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'running'",
                (entry_id, tenant_id, user_id)
            ).fetchone()
        elif case_id:
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE case_id = ? AND tenant_id = ? AND user_id = ? AND status = 'running' ORDER BY start_time DESC LIMIT 1",
                (case_id, tenant_id, user_id)
            ).fetchone()
        else:
            entry = db.execute(
                "SELECT * FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND status = 'running' ORDER BY start_time DESC LIMIT 1",
                (tenant_id, user_id)
            ).fetchone()
        if not entry:
            return {"alive": False, "message": "No running timer found"}
        entry_id = entry["id"]

        try:
            start = datetime.fromisoformat(entry["start_time"].replace("Z", "+00:00"))
            elapsed = (datetime.now(timezone.utc) - start).total_seconds() / 60.0
        except (ValueError, TypeError):
            elapsed = 0

    return {"alive": True, "entry_id": entry_id, "elapsed_minutes": round(elapsed, 2)}


@router.post("/timer/persist")
async def timer_persist(entry_id: str, elapsed_minutes: float, current_user: dict = Depends(get_current_user)):
    """Persist the current elapsed time to the DB so billing dashboard shows live data."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    with get_db() as db:
        entry = db.execute(
            "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'running'",
            (entry_id, tenant_id, user_id)
        ).fetchone()
        if not entry:
            return {"ok": False, "message": "No running timer found"}
        amount = round((elapsed_minutes / 60.0) * (entry["hourly_rate"] or 0), 2)
        db.execute(
            "UPDATE billing_time_entries SET duration_minutes = ?, amount = ? WHERE id = ?",
            (round(elapsed_minutes, 2), amount, entry_id)
        )
    return {"ok": True, "duration_minutes": round(elapsed_minutes, 2), "amount": amount}


@router.post("/timer/stop-beacon")
async def stop_timer_beacon(entry_id: str, token: str):
    """Stop a running timer via sendBeacon (no auth header — token passed as query param).
    Used on page unload when sendBeacon can't send auth headers."""
    from app.utils.auth import decode_token
    try:
        user_data = decode_token(token)
        tenant_id = user_data["tenant_id"]
        user_id = user_data["sub"]
    except Exception:
        return {"stopped": False, "message": "Invalid token"}

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        entry = db.execute(
            "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'running'",
            (entry_id, tenant_id, user_id)
        ).fetchone()
        if not entry:
            return {"stopped": False}
        try:
            start = datetime.fromisoformat(entry["start_time"].replace("Z", "+00:00"))
            duration = (datetime.now(timezone.utc) - start).total_seconds() / 60.0
            amount = round((duration / 60.0) * (entry["hourly_rate"] or 0), 2)
            db.execute(
                "UPDATE billing_time_entries SET end_time = ?, duration_minutes = ?, amount = ?, status = 'completed' WHERE id = ?",
                (now, round(duration, 2), amount, entry["id"])
            )
        except (ValueError, TypeError):
            db.execute(
                "UPDATE billing_time_entries SET end_time = ?, status = 'completed' WHERE id = ?",
                (now, entry["id"])
            )
            duration = 0

        _add_hours_to_task(db, entry["task_id"], tenant_id, duration)
    return {"stopped": True}


# ──────────────────────────────────────────
# Invoices
# ──────────────────────────────────────────

def _build_invoice(db, tenant_id: str, contract_id: Optional[str], items: list,
                    issued_by_id: str, issued_by_name: str,
                    client_user_id: Optional[str] = None, client_name: str = "",
                    client_email: str = "", status: str = "draft",
                    due_date: Optional[str] = None, payment_link: str = "",
                    notes: str = "", tax_rate: float = 0, metadata: str = "") -> dict:
    """Build invoice_items from `items`, insert the invoice, and mark linked
    tasks/time entries as invoiced. Shared by manual invoice creation and the
    weekly auto-rollup so both paths produce identical, correctly-linked invoices.

    Each item dict may include: description, item_type, quantity, rate,
    time_entry_id, task_id, entity_name. If entity_name is omitted but task_id
    is present, it's looked up from contract_tasks so the entity always ends
    up on the invoice line item.
    """
    invoice_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()

    last = db.execute(
        "SELECT MAX(invoice_number) as max_num FROM invoices WHERE tenant_id = ?",
        (tenant_id,)
    ).fetchone()
    invoice_number = (last["max_num"] or 0) + 1

    subtotal = 0.0
    item_records = []
    for item in items:
        qty = float(item.get("quantity", 1))
        rate = float(item.get("rate", 0))
        amt = round(float(item["amount"]), 2) if item.get("amount") is not None else round(qty * rate, 2)
        subtotal += amt

        entity_name = item.get("entity_name")
        if not entity_name and item.get("task_id"):
            task_row = db.execute("SELECT entity_name FROM contract_tasks WHERE id = ?", (item["task_id"],)).fetchone()
            entity_name = task_row["entity_name"] if task_row else ""

        item_records.append({
            "id": generate_id(),
            "invoice_id": invoice_id,
            "description": item.get("description", ""),
            "item_type": item.get("item_type", "hourly"),
            "quantity": qty,
            "rate": rate,
            "amount": amt,
            "time_entry_id": item.get("time_entry_id"),
            "task_id": item.get("task_id"),
            "entity_name": entity_name or "",
        })

    tax_amount = round(subtotal * (tax_rate / 100.0), 2) if tax_rate else 0
    total = round(subtotal + tax_amount, 2)
    public_token = str(uuid.uuid4())

    db.execute(
        """INSERT INTO invoices (id, tenant_id, contract_id, invoice_number, client_user_id,
           client_name, client_email, issued_by_id, issued_by_name,
           subtotal, tax_rate, tax_amount, total, status, due_date,
           payment_link, notes, metadata, public_token, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (invoice_id, tenant_id, contract_id, invoice_number, client_user_id,
         client_name, client_email, issued_by_id, issued_by_name,
         subtotal, tax_rate, tax_amount, total, status, due_date,
         payment_link, notes, metadata, public_token, now, now)
    )

    for item in item_records:
        db.execute(
            """INSERT INTO invoice_items (id, invoice_id, description, item_type, quantity, rate, amount,
               time_entry_id, task_id, entity_name, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item["id"], item["invoice_id"], item["description"], item["item_type"],
             item["quantity"], item["rate"], item["amount"],
             item["time_entry_id"], item["task_id"], item["entity_name"], now)
        )

        if item["time_entry_id"]:
            db.execute(
                "UPDATE billing_time_entries SET status = 'invoiced' WHERE id = ?",
                (item["time_entry_id"],)
            )
        if item["task_id"]:
            db.execute(
                "UPDATE contract_tasks SET invoice_id = ?, invoiced_at = ? WHERE id = ? AND tenant_id = ?",
                (invoice_id, now, item["task_id"], tenant_id)
            )

    return {"id": invoice_id, "invoice_number": invoice_number, "total": total, "public_token": public_token}


def generate_weekly_invoices(tenant_id: Optional[str] = None) -> list:
    """Auto-rollup: for every active contract (optionally scoped to one tenant),
    find tasks that have cleared BOTH approval gates and aren't on an invoice
    yet, and group them into a draft invoice per contract. Drafts are left for
    the contractor to review and send manually — not auto-sent — since the
    whole point of this feature is restoring trust with a client who disputed
    being billed without authorization."""
    created = []
    with get_db() as db:
        contract_conditions = ["status = 'active'"]
        contract_params: list = []
        if tenant_id:
            contract_conditions.append("tenant_id = ?")
            contract_params.append(tenant_id)
        contracts = db.execute(
            f"SELECT * FROM contracts WHERE {' AND '.join(contract_conditions)}",
            contract_params
        ).fetchall()

        for contract in contracts:
            contract_d = dict(contract)
            tasks = db.execute(
                """SELECT * FROM contract_tasks
                   WHERE contract_id = ? AND tenant_id = ? AND invoice_id IS NULL
                     AND scope_status = 'approved' AND billing_status = 'approved'
                   ORDER BY task_date ASC, created_at ASC""",
                (contract_d["id"], contract_d["tenant_id"])
            ).fetchall()
            if not tasks:
                continue

            issuer = db.execute("SELECT full_name FROM users WHERE id = ?", (contract_d["created_by"],)).fetchone()
            issued_by_name = issuer["full_name"] if issuer else ""

            items = []
            for t in tasks:
                t_d = dict(t)
                if t_d.get("billing_type") == "hourly":
                    rate = t_d.get("hourly_rate") or 0
                    amount = t_d.get("billing_amount") or 0
                    qty = round(amount / rate, 2) if rate else 0
                else:
                    rate = 0
                    qty = 1
                    amount = t_d.get("flat_fee_amount") or 0
                items.append({
                    "description": f"{t_d['title']} ({t_d.get('task_date') or ''})".strip(),
                    "item_type": t_d.get("billing_type", "hourly"),
                    "quantity": qty,
                    "rate": rate,
                    "amount": amount,
                    "task_id": t_d["id"],
                    "entity_name": t_d.get("entity_name"),
                })

            invoice = _build_invoice(
                db, contract_d["tenant_id"], contract_d["id"], items,
                issued_by_id=contract_d["created_by"], issued_by_name=issued_by_name,
                client_user_id=contract_d.get("client_user_id"), client_name=contract_d.get("client_name", ""),
                client_email=contract_d.get("client_email", ""), status="draft",
            )
            created.append({"contract_id": contract_d["id"], **invoice})

    return created


def send_deadline_reminders(tenant_id: Optional[str] = None) -> list:
    """Remind both the contractor and the client/supervisor when a task's
    target completion date is due tomorrow or has already passed. Sends once
    per task (deadline_reminder_sent_at) — re-run safely on any cron cadence."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    reminded = []
    with get_db() as db:
        conditions = [
            "target_end_date IS NOT NULL", "target_end_date != ''",
            "target_end_date <= ?", "deadline_reminder_sent_at IS NULL", "invoice_id IS NULL",
        ]
        params: list = [tomorrow]
        if tenant_id:
            conditions.append("tenant_id = ?")
            params.append(tenant_id)
        tasks = db.execute(
            f"SELECT * FROM contract_tasks WHERE {' AND '.join(conditions)}",
            params
        ).fetchall()

        for task in tasks:
            t_d = dict(task)
            overdue = t_d["target_end_date"] < today
            entity_name = t_d.get("entity_name") or ""

            contract = db.execute("SELECT * FROM contracts WHERE id = ?", (t_d["contract_id"],)).fetchone()
            contract_d = dict(contract) if contract else {}

            contractor_email = t_d.get("billing_requested_by_email") or t_d.get("scope_requested_by_email")
            contractor_name = t_d.get("billing_requested_by") or t_d.get("scope_requested_by")
            if not contractor_email and contract_d.get("created_by"):
                creator = db.execute("SELECT full_name, email FROM users WHERE id = ?", (contract_d["created_by"],)).fetchone()
                if creator:
                    contractor_email = creator["email"]
                    contractor_name = contractor_name or creator["full_name"]

            client_email = t_d.get("billing_recipient_email") or t_d.get("scope_recipient_email") or contract_d.get("client_email")
            client_name = t_d.get("billing_recipient_name") or t_d.get("scope_recipient_name") or contract_d.get("client_name")

            if contractor_email:
                send_deadline_reminder_contractor_email(
                    to_email=contractor_email, contractor_name=contractor_name or "there",
                    task_title=t_d["title"], entity_name=entity_name,
                    target_end_date=t_d["target_end_date"], overdue=overdue,
                )
            if client_email:
                send_deadline_reminder_client_email(
                    to_email=client_email, client_name=client_name or "there",
                    task_title=t_d["title"], entity_name=entity_name,
                    target_end_date=t_d["target_end_date"], overdue=overdue,
                )

            db.execute(
                "UPDATE contract_tasks SET deadline_reminder_sent_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), t_d["id"])
            )
            reminded.append({"task_id": t_d["id"], "title": t_d["title"], "overdue": overdue})

    return reminded


@router.post("/tasks/{task_id}/add-to-invoice")
async def add_task_to_invoice(task_id: str, current_user: dict = Depends(get_current_user)):
    """Manually create a draft invoice for a single fully-approved task right
    now, instead of waiting for the weekly auto-rollup."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
            (task_id, tenant_id)
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task_d = dict(task)

        if task_d.get("scope_status") != "approved" or task_d.get("billing_status") != "approved":
            raise HTTPException(status_code=400, detail="Both scope and billing must be approved before invoicing this task")
        if task_d.get("invoice_id"):
            raise HTTPException(status_code=400, detail="This task is already on an invoice")

        contract = db.execute(
            "SELECT * FROM contracts WHERE id = ? AND tenant_id = ?",
            (task_d["contract_id"], tenant_id)
        ).fetchone()
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract_d = dict(contract)

        if task_d.get("billing_type") == "hourly":
            rate = task_d.get("hourly_rate") or 0
            amount = task_d.get("billing_amount") or 0
            qty = round(amount / rate, 2) if rate else 0
        else:
            rate = 0
            qty = 1
            amount = task_d.get("flat_fee_amount") or 0

        items = [{
            "description": f"{task_d['title']} ({task_d.get('task_date') or ''})".strip(),
            "item_type": task_d.get("billing_type", "hourly"),
            "quantity": qty,
            "rate": rate,
            "amount": amount,
            "task_id": task_d["id"],
            "entity_name": task_d.get("entity_name"),
        }]

        issuer = db.execute("SELECT full_name FROM users WHERE id = ?", (contract_d["created_by"],)).fetchone()
        issued_by_name = issuer["full_name"] if issuer else current_user.get("email", "")

        invoice = _build_invoice(
            db, tenant_id, contract_d["id"], items,
            issued_by_id=contract_d["created_by"], issued_by_name=issued_by_name,
            client_user_id=contract_d.get("client_user_id"), client_name=contract_d.get("client_name", ""),
            client_email=contract_d.get("client_email", ""), status="draft",
        )
    return {**invoice, "message": "Task added to a new draft invoice"}


@router.post("/invoices")
async def create_invoice(req: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Create a new invoice with line items."""
    tenant_id = current_user["tenant_id"]
    user_name = current_user.get("full_name", current_user.get("email", ""))

    import json as _json
    metadata = _json.dumps({
        "client_address": req.client_address,
        "client_city": req.client_city,
        "client_state": req.client_state,
        "client_zip": req.client_zip,
        "from_name": req.from_name,
        "from_firm": req.from_firm,
        "from_address": req.from_address,
        "from_city": req.from_city,
        "from_state": req.from_state,
        "from_zip": req.from_zip,
        "from_phone": req.from_phone,
        "from_email": req.from_email,
        "from_bar": req.from_bar,
        "contract_ids": req.contract_ids,
    })

    with get_db() as db:
        invoice = _build_invoice(
            db, tenant_id, req.contract_id, req.items,
            issued_by_id=current_user["sub"], issued_by_name=user_name,
            client_user_id=req.client_user_id, client_name=req.client_name,
            client_email=req.client_email, status="draft", due_date=req.due_date,
            payment_link=req.payment_link, notes=req.notes, tax_rate=req.tax_rate,
            metadata=metadata,
        )

    return {**invoice, "message": "Invoice created"}


@router.get("/invoices")
async def list_invoices(status: Optional[str] = None, contract_id: Optional[str] = None,
                         limit: int = 50, offset: int = 0,
                         current_user: dict = Depends(get_current_user)):
    """List invoices. Clients only see their own invoices."""
    tenant_id = current_user["tenant_id"]
    conditions = ["tenant_id = ?"]
    params: list = [tenant_id]

    if current_user["role"] == "client":
        conditions.append("client_user_id = ?")
        params.append(current_user["sub"])

    if status:
        conditions.append("status = ?")
        params.append(status)
    if contract_id:
        conditions.append("contract_id = ?")
        params.append(contract_id)

    where = " AND ".join(conditions)
    params_count = list(params)
    params.extend([min(limit, 200), offset])

    with get_db() as db:
        invoices = db.execute(
            f"SELECT * FROM invoices WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as cnt FROM invoices WHERE {where}",
            params_count
        ).fetchone()["cnt"]
    return {"invoices": [dict(i) for i in invoices], "total": total}


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single invoice with its items."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        invoice = db.execute(
            "SELECT * FROM invoices WHERE id = ? AND tenant_id = ?",
            (invoice_id, tenant_id)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        # Client can only view their own invoices
        if current_user["role"] == "client" and invoice["client_user_id"] != current_user["sub"]:
            raise HTTPException(status_code=403, detail="Access denied")

        items = db.execute(
            "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
            (invoice_id,)
        ).fetchall()
    return {"invoice": dict(invoice), "items": [dict(i) for i in items]}


@router.put("/invoices/{invoice_id}/status")
async def update_invoice_status(invoice_id: str, req: InvoiceStatusUpdate,
                                 current_user: dict = Depends(get_current_user)):
    """Update invoice status (send, mark paid, etc.)."""
    tenant_id = current_user["tenant_id"]
    valid_statuses = ("draft", "sent", "paid", "overdue", "cancelled")
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

    with get_db() as db:
        invoice = db.execute(
            "SELECT id, status FROM invoices WHERE id = ? AND tenant_id = ?",
            (invoice_id, tenant_id)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        updates = {"status": req.status, "updated_at": datetime.now(timezone.utc).isoformat()}
        if req.status == "paid":
            updates["paid_date"] = datetime.now(timezone.utc).isoformat()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [invoice_id]
        db.execute(f"UPDATE invoices SET {set_clause} WHERE id = ?", values)

        # When recalling to draft, free all tasks and time entries so they
        # appear as unbilled and can be re-selected when the invoice is edited.
        if req.status == "draft" and dict(invoice).get("status") in ("sent", "overdue", "cancelled"):
            # Free contract_tasks linked to this invoice
            db.execute(
                "UPDATE contract_tasks SET invoice_id = NULL, invoiced_at = NULL WHERE invoice_id = ? AND tenant_id = ?",
                (invoice_id, tenant_id)
            )
            # Free billing_time_entries linked to this invoice
            db.execute(
                "UPDATE billing_time_entries SET invoice_id = NULL WHERE invoice_id = ? AND tenant_id = ?",
                (invoice_id, tenant_id)
            )
            # Delete the old invoice_items so they can be re-built on edit
            db.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
            logger.info(f"[BILLING] Recalled invoice {invoice_id} to draft — tasks and items freed")

    freed_msg = " All linked tasks reset to unbilled." if req.status == "draft" else ""
    return {"message": f"Invoice status updated to {req.status}.{freed_msg}"}


@router.get("/public/invoices/{public_token}")
async def get_public_invoice(public_token: str):
    """Public invoice view — no authentication required."""
    try:
        with get_db() as db:
            invoice = db.execute(
                "SELECT * FROM invoices WHERE public_token = ?", (public_token,)
            ).fetchone()
            if not invoice:
                raise HTTPException(status_code=404, detail="Invoice not found")
            items = db.execute(
                "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
                (invoice["id"],)
            ).fetchall()
        return {"invoice": dict(invoice), "items": [dict(i) for i in items]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invoices/{invoice_id}/send")
async def send_invoice(invoice_id: str, req: InvoiceSend,
                        current_user: dict = Depends(get_current_user)):
    """Send invoice email to client and optional CC recipients, mark as sent."""
    import os as _os
    tenant_id = current_user["tenant_id"]
    base_url = _os.environ.get("BASE_URL", "https://litigationspace.com")

    with get_db() as db:
        invoice = db.execute(
            "SELECT * FROM invoices WHERE id = ? AND tenant_id = ?",
            (invoice_id, tenant_id)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        items = db.execute(
            "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
            (invoice_id,)
        ).fetchall()

        inv = dict(invoice)
        meta = {}
        try:
            meta = json.loads(inv.get("metadata") or "{}")
        except Exception:
            pass

        public_token = inv.get("public_token", "")
        public_url = f"{base_url}/invoice/{public_token}" if public_token else base_url
        inv_num = str(inv.get("invoice_number", "")).zfill(4)
        due = (inv.get("due_date") or "").split("T")[0]
        total = float(inv.get("total") or 0)
        subtotal = float(inv.get("subtotal") or 0)
        tax_rate = float(inv.get("tax_rate") or 0)
        tax_amount = float(inv.get("tax_amount") or 0)

        line_items = [dict(i) for i in items]
        for li in line_items:
            if li.get("task_id"):
                task_row = db.execute(
                    "SELECT entity_name, title FROM contract_tasks WHERE id = ?",
                    (li["task_id"],)
                ).fetchone()
                if task_row:
                    li["entity_name"] = task_row["entity_name"] or ""
                    li["task_title"] = task_row["title"] or li.get("description", "")

        issued = (inv.get("created_at") or "").split("T")[0]

        sent = send_invoice_email(
            to_emails=req.to_emails,
            cc_emails=req.cc_emails,
            from_name=meta.get("from_name") or inv.get("issued_by_name") or "Your Attorney",
            from_firm=meta.get("from_firm", ""),
            from_email=meta.get("from_email", ""),
            from_address=meta.get("from_address", ""),
            from_city=meta.get("from_city", ""),
            from_state=meta.get("from_state", ""),
            from_zip=meta.get("from_zip", ""),
            from_phone=meta.get("from_phone", ""),
            from_bar=meta.get("from_bar", ""),
            client_name=inv.get("client_name") or req.to_emails[0],
            client_email=inv.get("client_email") or req.to_emails[0],
            client_address=meta.get("client_address", ""),
            client_city=meta.get("client_city", ""),
            client_state=meta.get("client_state", ""),
            client_zip=meta.get("client_zip", ""),
            invoice_number=inv_num,
            issued=issued,
            due_date=due,
            total=total,
            payment_link=inv.get("payment_link") or "",
            public_url=public_url,
            custom_message=req.message,
            line_items=line_items,
            subtotal=subtotal,
            tax_rate=tax_rate,
            tax_amount=tax_amount,
            notes=inv.get("notes") or "",
            status=inv.get("status") or "sent",
        )

        # Mark as sent regardless of email delivery
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE invoices SET status='sent', updated_at=? WHERE id=?",
            (now, invoice_id)
        )

    return {"sent": sent, "message": "Invoice sent" if sent else "Invoice marked sent (email delivery failed)"}


@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, req: InvoiceUpdate,
                          current_user: dict = Depends(get_current_user)):
    """Update a draft invoice (edit before sending)."""
    import json as _json
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        invoice = db.execute(
            "SELECT id, status FROM invoices WHERE id = ? AND tenant_id = ?",
            (invoice_id, tenant_id)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice["status"] not in ("draft",):
            raise HTTPException(status_code=400, detail="Only draft invoices can be edited")

        subtotal = 0.0
        item_records = []
        for item in req.items:
            qty = float(item.get("quantity", 1))
            rate = float(item.get("rate", 0))
            amt = float(item.get("amount", round(qty * rate, 2)))
            subtotal += amt
            item_records.append({
                "id": generate_id(),
                "invoice_id": invoice_id,
                "description": item.get("description", ""),
                "item_type": item.get("item_type", "hourly"),
                "quantity": qty,
                "rate": rate,
                "amount": amt,
                "time_entry_id": item.get("time_entry_id"),
                "task_id": item.get("task_id"),
            })

        tax_amount = round(subtotal * (req.tax_rate / 100.0), 2) if req.tax_rate else 0
        total = round(subtotal + tax_amount, 2)

        metadata = _json.dumps({
            "client_address": req.client_address,
            "client_city": req.client_city,
            "client_state": req.client_state,
            "client_zip": req.client_zip,
            "from_name": req.from_name,
            "from_firm": req.from_firm,
            "from_address": req.from_address,
            "from_city": req.from_city,
            "from_state": req.from_state,
            "from_zip": req.from_zip,
            "from_phone": req.from_phone,
            "from_email": req.from_email,
            "from_bar": req.from_bar,
        })

        try:
            db.execute("ALTER TABLE invoices ADD COLUMN metadata TEXT DEFAULT ''")
        except Exception:
            pass

        db.execute(
            """UPDATE invoices SET
               client_name=?, client_email=?, due_date=?, payment_link=?, notes=?,
               tax_rate=?, tax_amount=?, subtotal=?, total=?, metadata=?, updated_at=?
               WHERE id=?""",
            (req.client_name, req.client_email, req.due_date, req.payment_link, req.notes,
             req.tax_rate, tax_amount, subtotal, total, metadata, now, invoice_id)
        )

        # Replace line items
        db.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
        for item in item_records:
            db.execute(
                """INSERT INTO invoice_items (id, invoice_id, description, item_type, quantity, rate, amount,
                   time_entry_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (item["id"], item["invoice_id"], item["description"], item["item_type"],
                 item["quantity"], item["rate"], item["amount"],
                 item["time_entry_id"], item["task_id"], now)
            )

    return {"id": invoice_id, "total": total, "message": "Invoice updated"}


@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a draft invoice."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        invoice = db.execute(
            "SELECT id, status FROM invoices WHERE id = ? AND tenant_id = ?",
            (invoice_id, tenant_id)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice["status"] not in ("draft",):
            raise HTTPException(status_code=400, detail="Only draft invoices can be deleted")

        # Un-mark time entries and tasks so they return to unbilled
        items = db.execute("SELECT time_entry_id, task_id FROM invoice_items WHERE invoice_id = ?", (invoice_id,)).fetchall()
        for item in items:
            if item["time_entry_id"]:
                db.execute(
                    "UPDATE billing_time_entries SET status = 'completed' WHERE id = ?",
                    (item["time_entry_id"],)
                )
            if item["task_id"]:
                db.execute(
                    "UPDATE contract_tasks SET invoice_id = NULL, invoiced_at = NULL WHERE id = ?",
                    (item["task_id"],)
                )

        db.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
        db.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
    return {"message": "Invoice deleted"}


class InvoiceMergeRequest(BaseModel):
    target_invoice_id: str
    source_invoice_ids: List[str]


@router.post("/invoices/merge")
async def merge_invoices(req: InvoiceMergeRequest, current_user: dict = Depends(get_current_user)):
    """Merge one or more draft invoices into a single target draft invoice —
    e.g. when separate billable tasks for the same client each rolled onto
    their own invoice and should go out as one. The target keeps its own
    invoice number; the source invoices' line items move over and the
    sources are removed."""
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    source_ids = [s for s in dict.fromkeys(req.source_invoice_ids) if s != req.target_invoice_id]
    if not source_ids:
        raise HTTPException(status_code=400, detail="No other invoices to merge")

    with get_db() as db:
        target = db.execute(
            "SELECT * FROM invoices WHERE id = ? AND tenant_id = ?",
            (req.target_invoice_id, tenant_id)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Target invoice not found")
        if target["status"] != "draft":
            raise HTTPException(status_code=400, detail="Only draft invoices can be merged")

        for sid in source_ids:
            source = db.execute(
                "SELECT * FROM invoices WHERE id = ? AND tenant_id = ?",
                (sid, tenant_id)
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="One of the source invoices was not found")
            if source["status"] != "draft":
                raise HTTPException(status_code=400, detail=f"Invoice #{source['invoice_number']} is {source['status']} — only drafts can be merged")

            db.execute("UPDATE invoice_items SET invoice_id = ? WHERE invoice_id = ?", (req.target_invoice_id, sid))
            db.execute(
                "UPDATE contract_tasks SET invoice_id = ? WHERE invoice_id = ? AND tenant_id = ?",
                (req.target_invoice_id, sid, tenant_id)
            )
            db.execute("DELETE FROM invoices WHERE id = ?", (sid,))

        agg = db.execute(
            "SELECT COALESCE(SUM(amount), 0) as subtotal FROM invoice_items WHERE invoice_id = ?",
            (req.target_invoice_id,)
        ).fetchone()
        subtotal = round(agg["subtotal"], 2)
        tax_rate = target["tax_rate"] or 0
        tax_amount = round(subtotal * (tax_rate / 100.0), 2) if tax_rate else 0
        total = round(subtotal + tax_amount, 2)
        db.execute(
            "UPDATE invoices SET subtotal = ?, tax_amount = ?, total = ?, updated_at = ? WHERE id = ?",
            (subtotal, tax_amount, total, now, req.target_invoice_id)
        )

    return {
        "id": req.target_invoice_id, "subtotal": subtotal, "tax_amount": tax_amount, "total": total,
        "message": f"Merged {len(source_ids)} invoice(s) into #{target['invoice_number']}",
    }


# ──────────────────────────────────────────
# Earnings Dashboard
# ──────────────────────────────────────────

@router.get("/earnings")
async def get_earnings(current_user: dict = Depends(get_current_user)):
    """Get earnings summary for the current user. Private to the user."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc)
    week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    month_start = now.strftime("%Y-%m-01")

    with get_db() as db:
        # Total earned (all time) from completed/invoiced entries
        total_earned = db.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND status IN ('completed', 'invoiced')",
            (tenant_id, user_id)
        ).fetchone()["total"]

        # This week
        week_earned = db.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND start_time >= ? AND status IN ('completed', 'invoiced')",
            (tenant_id, user_id, week_start)
        ).fetchone()["total"]

        # This month
        month_earned = db.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND start_time >= ? AND status IN ('completed', 'invoiced')",
            (tenant_id, user_id, month_start)
        ).fetchone()["total"]

        # Total hours
        total_hours = db.execute(
            "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM billing_time_entries WHERE tenant_id = ? AND user_id = ? AND status IN ('completed', 'invoiced')",
            (tenant_id, user_id)
        ).fetchone()["total"] / 60.0

        # Flat fee earnings from completed tasks
        flat_fee_earned = db.execute(
            "SELECT COALESCE(SUM(flat_fee_amount), 0) as total FROM contract_tasks WHERE tenant_id = ? AND status = 'completed' AND billing_type = 'flat_fee'",
            (tenant_id,)
        ).fetchone()["total"]

        # Pending invoices (sent but not paid)
        pending_amount = db.execute(
            "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE tenant_id = ? AND issued_by_id = ? AND status = 'sent'",
            (tenant_id, user_id)
        ).fetchone()["total"]

        # Overdue invoices
        overdue_amount = db.execute(
            "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE tenant_id = ? AND issued_by_id = ? AND status = 'overdue'",
            (tenant_id, user_id)
        ).fetchone()["total"]

        # Paid invoices
        paid_amount = db.execute(
            "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE tenant_id = ? AND issued_by_id = ? AND status = 'paid'",
            (tenant_id, user_id)
        ).fetchone()["total"]

        # Active contracts count
        active_contracts = db.execute(
            "SELECT COUNT(*) as cnt FROM contracts WHERE tenant_id = ? AND status = 'active'",
            (tenant_id,)
        ).fetchone()["cnt"]

        # Earnings by day for the last 30 days (for chart)
        thirty_days_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        daily_earnings = db.execute(
            """SELECT DATE(start_time) as day, COALESCE(SUM(amount), 0) as total
               FROM billing_time_entries
               WHERE tenant_id = ? AND user_id = ? AND start_time >= ? AND status IN ('completed', 'invoiced')
               GROUP BY DATE(start_time) ORDER BY day""",
            (tenant_id, user_id, thirty_days_ago)
        ).fetchall()

        # Earnings by client
        earnings_by_client = db.execute(
            """SELECT c.client_name, COALESCE(SUM(t.amount), 0) as total
               FROM billing_time_entries t
               JOIN contracts c ON t.contract_id = c.id
               WHERE t.tenant_id = ? AND t.user_id = ? AND t.status IN ('completed', 'invoiced')
               GROUP BY c.client_name ORDER BY total DESC LIMIT 10""",
            (tenant_id, user_id)
        ).fetchall()

    return {
        "total_earned": round(total_earned + flat_fee_earned, 2),
        "hourly_earned": round(total_earned, 2),
        "flat_fee_earned": round(flat_fee_earned, 2),
        "week_earned": round(week_earned, 2),
        "month_earned": round(month_earned, 2),
        "total_hours": round(total_hours, 2),
        "pending_invoices": round(pending_amount, 2),
        "overdue_invoices": round(overdue_amount, 2),
        "paid_invoices": round(paid_amount, 2),
        "active_contracts": active_contracts,
        "daily_earnings": [{"day": d["day"], "total": round(d["total"], 2)} for d in daily_earnings],
        "earnings_by_client": [{"client": e["client_name"], "total": round(e["total"], 2)} for e in earnings_by_client],
    }


# ──────────────────────────────────────────
# Client Portal
# ──────────────────────────────────────────

@router.get("/client-portal")
async def get_client_portal(current_user: dict = Depends(get_current_user)):
    """Client portal view — shows the client their contracts, invoices, and work done."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]

    with get_db() as db:
        # Contracts where this user is the client
        contracts = db.execute(
            "SELECT * FROM contracts WHERE tenant_id = ? AND client_user_id = ? ORDER BY created_at DESC",
            (tenant_id, user_id)
        ).fetchall()

        # All invoices for this client
        invoices = db.execute(
            "SELECT * FROM invoices WHERE tenant_id = ? AND client_user_id = ? ORDER BY created_at DESC",
            (tenant_id, user_id)
        ).fetchall()

        # Time entries on their contracts
        contract_ids = [c["id"] for c in contracts]
        time_entries = []
        if contract_ids:
            placeholders = ",".join("?" * len(contract_ids))
            time_entries = db.execute(
                f"""SELECT t.*, u.full_name as worker_name
                    FROM billing_time_entries t
                    LEFT JOIN users u ON t.user_id = u.id
                    WHERE t.contract_id IN ({placeholders}) AND t.tenant_id = ?
                    ORDER BY t.start_time DESC LIMIT 100""",
                contract_ids + [tenant_id]
            ).fetchall()

        # Tasks on their contracts
        tasks = []
        if contract_ids:
            tasks = db.execute(
                f"SELECT * FROM contract_tasks WHERE contract_id IN ({placeholders}) AND tenant_id = ? ORDER BY created_at DESC",
                contract_ids + [tenant_id]
            ).fetchall()

        # Totals
        total_invoiced = sum(i["total"] for i in invoices)
        total_paid = sum(i["total"] for i in invoices if i["status"] == "paid")
        total_pending = sum(i["total"] for i in invoices if i["status"] in ("sent", "overdue"))

    return {
        "contracts": [dict(c) for c in contracts],
        "invoices": [dict(i) for i in invoices],
        "time_entries": [dict(e) for e in time_entries],
        "tasks": [dict(t) for t in tasks],
        "summary": {
            "total_invoiced": round(total_invoiced, 2),
            "total_paid": round(total_paid, 2),
            "total_pending": round(total_pending, 2),
            "total_contracts": len(contracts),
        }
    }


# ─── Client portal: scope/billing approvals (authenticated alternative to the token-link flow) ───

def _get_task_for_client(db, task_id: str, current_user: dict) -> dict:
    """Fetch a contract_task, ensuring the current authenticated client owns it via the parent contract."""
    if current_user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client access only")
    task = db.execute(
        "SELECT * FROM contract_tasks WHERE id = ? AND tenant_id = ?",
        (task_id, current_user["tenant_id"])
    ).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task_d = dict(task)
    contract = db.execute(
        "SELECT client_user_id FROM contracts WHERE id = ?",
        (task_d["contract_id"],)
    ).fetchone()
    if not contract or contract["client_user_id"] != current_user["sub"]:
        raise HTTPException(status_code=403, detail="This task does not belong to you")
    return task_d


@router.get("/client-portal/pending-approvals")
async def client_portal_pending_approvals(current_user: dict = Depends(get_current_user)):
    """List tasks awaiting this client's scope or billing approval."""
    if current_user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client access only")
    with get_db() as db:
        rows = db.execute(
            """SELECT ct.*, c.client_name, c.title as contract_title
               FROM contract_tasks ct
               JOIN contracts c ON c.id = ct.contract_id
               WHERE c.client_user_id = ? AND ct.tenant_id = ?
                 AND (ct.scope_status = 'sent' OR ct.billing_status = 'sent')
               ORDER BY ct.created_at DESC""",
            (current_user["sub"], current_user["tenant_id"])
        ).fetchall()
    return {"tasks": [dict(r) for r in rows]}


@router.post("/client-portal/tasks/{task_id}/scope/approve")
async def client_approve_scope(task_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        task = _get_task_for_client(db, task_id, current_user)
        if task.get("scope_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending scope approval")
        ip = request.client.host if request.client else ""
        _approve_task_gate(db, task, "scope", ip)
    _send_scope_approved_emails(task)
    return {"message": "Scope approved"}


@router.post("/client-portal/tasks/{task_id}/scope/reject")
async def client_reject_scope(task_id: str, req: ApprovalRejection, request: Request, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        task = _get_task_for_client(db, task_id, current_user)
        if task.get("scope_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending scope approval")
        ip = request.client.host if request.client else ""
        _reject_task_gate(db, task, "scope", ip, req.reason)
    _notify_contractor_scope_rejected(task, req.reason)
    return {"message": "Scope rejected"}


@router.post("/client-portal/tasks/{task_id}/billing/approve")
async def client_approve_billing(task_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        task = _get_task_for_client(db, task_id, current_user)
        if task.get("billing_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending billing approval")
        ip = request.client.host if request.client else ""
        _approve_task_gate(db, task, "billing", ip)
    _send_billing_approved_emails(task)
    return {"message": "Bill approved"}


@router.post("/client-portal/tasks/{task_id}/billing/reject")
async def client_reject_billing(task_id: str, req: ApprovalRejection, request: Request, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        task = _get_task_for_client(db, task_id, current_user)
        if task.get("billing_status") != "sent":
            raise HTTPException(status_code=400, detail="This task has no pending billing approval")
        ip = request.client.host if request.client else ""
        _reject_task_gate(db, task, "billing", ip, req.reason)
    return {"message": "Bill rejected"}


# ═══════════════════════════════════════════════════════════════════════════════
# SUBSCRIPTION STATUS & ZEFFY WEBHOOK
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/subscription/status")
async def get_subscription_status(current_user: dict = Depends(get_current_user)):
    """
    Return the current user's full subscription state.
    Frontend polls this on every dashboard load to determine:
      - Which features to show/lock
      - What banner to display (trial, grace, expired)
      - Credit balance
    """
    user_id = current_user["sub"]
    with get_db() as db:
        state = resolve_subscription(user_id, db)
    return state


@router.get("/subscription/admin/{user_id}")
async def admin_get_subscription(user_id: str, current_user: dict = Depends(get_current_user)):
    """Admin: view any user's subscription state. Requires admin role."""
    if current_user.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin access required")
    with get_db() as db:
        state = resolve_subscription(user_id, db)
    return state


class AdminOverrideRequest(BaseModel):
    subscription_status: str          # trial | active | grace | restricted | payg
    plan: str = "none"                # none | basic | elite | chambers | enterprise | payg
    days_extension: Optional[int] = None   # extend trial by N days
    credits_top_up: Optional[int] = None   # add N credits to trial balance
    payg_credits_add: Optional[int] = None # add N PAYG credits


@router.post("/subscription/admin/{user_id}/override")
async def admin_override_subscription(
    user_id: str,
    req: AdminOverrideRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Admin: manually set a user's subscription status.
    Used when Zeffy payment email doesn't match account email,
    or to extend a trial for a VIP user.
    """
    if current_user.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin access required")

    with get_db() as db:
        user = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        updates = ["subscription_status = ?", "plan = ?"]
        params  = [req.subscription_status, req.plan]

        if req.subscription_status == "active":
            monthly = PLAN_MONTHLY_CREDITS.get(req.plan, 0)
            updates += [
                "subscription_activated_at = ?",
                "subscription_credits_total = ?",
                "subscription_credits_remaining = ?",
                "credits_reset_at = ?",
            ]
            params += [
                datetime.now(timezone.utc).isoformat(),
                monthly,
                monthly,
                datetime.now(timezone.utc).isoformat(),
            ]

        if req.days_extension:
            from datetime import timedelta
            new_end = (datetime.now(timezone.utc) + timedelta(days=req.days_extension)).isoformat()
            updates.append("trial_end_date = ?")
            params.append(new_end)

        if req.credits_top_up:
            updates.append("trial_credits_total = trial_credits_total + ?")
            params.append(req.credits_top_up)

        if req.payg_credits_add:
            updates.append("payg_credits = payg_credits + ?")
            params.append(req.payg_credits_add)

        params.append(user_id)
        db.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
            params
        )

    logger.info(f"[ADMIN OVERRIDE] user={user_id} status={req.subscription_status} plan={req.plan}")
    return {"ok": True, "user_id": user_id, "new_status": req.subscription_status}


# ── Zeffy plan name → internal plan key ───────────────────────────────────────
_ZEFFY_TICKET_TO_PLAN: dict[str, str] = {
    "basic-plan":        "basic",
    "ls-elite-plan":     "elite",
    "chambers":          "chambers",
    "pay-as-you-go":     "payg",
    "starter-plan":      "basic",    # legacy alias
}

# PAYG bundle: zeffy ticket slug → credit amount
_PAYG_BUNDLES: dict[str, int] = {
    # These map to the Zeffy ticket types for PAYG purchases.
    # Amounts match the confirmed bundle table.
    "payg-10":   100,
    "payg-25":   300,
    "payg-50":   700,
    "payg-100":  1500,
    "payg-250":  4000,
    "payg-500":  10000,
    "pay-as-you-go": 100,   # default single bundle
}


@router.post("/zeffy-webhook")
async def zeffy_webhook(request: Request):
    """
    Receive Zeffy payment completion webhook.
    Activates the matching user account based on buyer email + ticket type.

    Zeffy sends a POST with JSON body. We look for:
      - formResponse.fields[email]  or  buyer.email
      - formType / ticketType / slug identifying which plan was purchased

    Returns 200 always so Zeffy does not retry on our processing errors.
    """
    try:
        body = await request.json()
    except Exception:
        logger.warning("[ZEFFY WEBHOOK] Could not parse JSON body")
        return {"ok": False, "error": "invalid_json"}

    logger.info(f"[ZEFFY WEBHOOK] Received: {json.dumps(body)[:500]}")

    # Extract buyer email — Zeffy uses several possible paths
    email = (
        body.get("email")
        or body.get("buyerEmail")
        or (body.get("buyer") or {}).get("email")
        or _zeffy_extract_email_from_form(body)
    )

    if not email:
        logger.warning("[ZEFFY WEBHOOK] No email found in payload")
        return {"ok": False, "error": "no_email"}

    email = email.strip().lower()

    # Extract ticket/plan slug
    slug = (
        body.get("ticketType")
        or body.get("formSlug")
        or body.get("slug")
        or (body.get("form") or {}).get("slug", "")
        or ""
    ).lower().strip()

    plan = _ZEFFY_TICKET_TO_PLAN.get(slug)
    payg_credits_to_add = _PAYG_BUNDLES.get(slug, 0) if slug.startswith("payg") or slug == "pay-as-you-go" else 0

    if not plan and not payg_credits_to_add:
        logger.warning(f"[ZEFFY WEBHOOK] Unknown slug '{slug}' — cannot map to plan")
        return {"ok": False, "error": f"unknown_slug:{slug}"}

    with get_db() as db:
        user = db.execute(
            "SELECT id, subscription_status FROM users WHERE LOWER(email) = ?",
            (email,)
        ).fetchone()

        if not user:
            logger.warning(f"[ZEFFY WEBHOOK] No user found for email {email}")
            return {"ok": False, "error": "user_not_found", "email": email}

        user_id = user["id"]
        now     = datetime.now(timezone.utc).isoformat()

        if plan == "payg" or payg_credits_to_add:
            # Add purchased PAYG credits (never expire)
            db.execute(
                """UPDATE users SET
                     subscription_status = 'payg',
                     plan                = 'payg',
                     payg_credits        = payg_credits + ?
                   WHERE id = ?""",
                (payg_credits_to_add or 100, user_id)
            )
            logger.info(f"[ZEFFY WEBHOOK] PAYG +{payg_credits_to_add} credits → {email}")
        else:
            # Activate paid subscription
            monthly = PLAN_MONTHLY_CREDITS.get(plan, 0)
            db.execute(
                """UPDATE users SET
                     subscription_status              = 'active',
                     plan                             = ?,
                     subscription_activated_at        = ?,
                     subscription_credits_total       = ?,
                     subscription_credits_remaining   = ?,
                     credits_reset_at                 = ?
                   WHERE id = ?""",
                (plan, now, monthly, monthly, now, user_id)
            )
            logger.info(f"[ZEFFY WEBHOOK] Activated plan={plan} for {email} ({monthly} credits/mo)")

    return {"ok": True, "email": email, "plan": plan or "payg"}


def _zeffy_extract_email_from_form(body: dict) -> Optional[str]:
    """Try to extract email from Zeffy's nested formResponse structure."""
    try:
        fields = body.get("formResponse", {}).get("fields", [])
        for field in fields:
            if "email" in (field.get("label", "") or "").lower():
                return field.get("value")
            if field.get("type") == "email":
                return field.get("value")
    except Exception:
        pass
    return None

@router.get("/tasks/unbilled-all")
async def get_all_unbilled_tasks(current_user: dict = Depends(get_current_user)):
    """Return ALL unbilled tasks across all contracts, grouped by contract."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        tasks = db.execute(
            """SELECT ct.*, c.title as contract_title, c.client_name, c.client_email,
                      c.billing_type as contract_billing_type, c.hourly_rate as contract_hourly_rate
               FROM contract_tasks ct
               JOIN contracts c ON ct.contract_id = c.id
               WHERE ct.tenant_id = ? AND ct.invoice_id IS NULL
               ORDER BY c.client_name, c.title, ct.task_date ASC, ct.created_at ASC""",
            (tenant_id,)
        ).fetchall()
    return {"tasks": [dict(t) for t in tasks]}

@router.post("/time-entries/{entry_id}/convert-to-task")
async def convert_entry_to_task(
    entry_id: str,
    req: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Convert an unlinked time entry into a billable contract_task.
    Body: { "contract_id": "...", "title": "...", "entity_name": "TAPDash" }
    """
    tenant_id = current_user["tenant_id"]
    user_id   = current_user["sub"]
    now       = datetime.now(timezone.utc).isoformat()

    contract_id  = req.get("contract_id", "")
    title        = req.get("title", "").strip()
    entity_name  = req.get("entity_name", "").strip()

    if not contract_id:
        raise HTTPException(400, "contract_id is required")

    with get_db() as db:
        # Verify the contract belongs to this tenant
        ctr = db.execute(
            "SELECT id, client_name FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()
        if not ctr:
            raise HTTPException(404, "Contract not found")

        # A time entry converted under a specific contract is unambiguously for
        # that contract's client — default to it rather than requiring callers
        # (like the case-timer flow) to know about entity attribution.
        if not entity_name:
            entity_name = ctr["client_name"] or ""

        # Fetch the time entry
        entry = db.execute(
            "SELECT * FROM billing_time_entries WHERE id = ? AND tenant_id = ?",
            (entry_id, tenant_id)
        ).fetchone()
        if not entry:
            raise HTTPException(404, "Time entry not found")

        entry_d = dict(entry)
        duration_minutes = entry_d.get("duration_minutes") or 0
        hours = round((duration_minutes / 60) * 4) / 4  # nearest 0.25h
        if hours <= 0:
            hours = round(duration_minutes / 60, 2)

        desc    = entry_d.get("description") or title or "Time entry"
        rate    = entry_d.get("hourly_rate") or 0  # preserve the rate the time was actually tracked at
        date_val = (entry_d.get("start_time") or entry_d.get("created_at") or now)[:10]

        if not title:
            title = desc

        # Create the contract_task
        task_id = generate_id()
        db.execute(
            """INSERT INTO contract_tasks
               (id, contract_id, tenant_id, title, description, entity_name, billing_type,
                hourly_rate, estimated_hours, task_date, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'hourly', ?, ?, ?, 'pending', ?)""",
            (task_id, contract_id, tenant_id, title, desc, entity_name, rate, hours, date_val, now)
        )

        # Link the time entry to the contract so it no longer floats
        db.execute(
            "UPDATE billing_time_entries SET contract_id=?, hourly_rate=? WHERE id=? AND tenant_id=?",
            (contract_id, rate, entry_id, tenant_id)
        )

    return {
        "task_id":      task_id,
        "contract_id":  contract_id,
        "title":        title,
        "hours":        hours,
        "hourly_rate":  rate,
        "message":      f"Time entry converted to billable task ({hours}h @ ${rate}/hr)"
    }

@router.post("/tasks/merge")
async def merge_tasks(
    req: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Merge two or more billable tasks (contract_tasks) into one.
    All selected tasks must belong to the same contract.

    Body:
      task_ids:     list[str]  — IDs of tasks to merge (2+)
      title:        str        — title for the merged task (optional, defaults to first task title)
      billing_type: str        — 'hourly' or 'flat_fee' (optional, defaults to first task type)
      hourly_rate:  float      — rate for the merged task (optional)
      flat_fee:     float      — flat fee if billing_type='flat_fee' (optional)
      task_date:    str        — date for merged task (optional, defaults to latest date)
      description:  str        — description for merged task (optional)
    """
    tenant_id = current_user["tenant_id"]
    task_ids  = req.get("task_ids", [])

    if len(task_ids) < 2:
        raise HTTPException(400, "Select at least 2 tasks to merge")

    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        # Fetch all tasks
        placeholders = ",".join("?" * len(task_ids))
        tasks = db.execute(
            f"SELECT * FROM contract_tasks WHERE id IN ({placeholders}) AND tenant_id = ?",
            task_ids + [tenant_id]
        ).fetchall()

        if len(tasks) != len(task_ids):
            raise HTTPException(404, "One or more tasks not found")

        task_dicts = [dict(t) for t in tasks]

        # All must be from the same contract
        contract_ids = set(t["contract_id"] for t in task_dicts)
        if len(contract_ids) > 1:
            raise HTTPException(400, "All tasks must belong to the same contract to merge")

        # None can be already invoiced
        invoiced = [t for t in task_dicts if t.get("invoice_id")]
        if invoiced:
            raise HTTPException(400, f"{len(invoiced)} task(s) are already invoiced and cannot be merged. Recall the invoice first.")

        # None can already be in/past the approval pipeline — merging would erase the approval trail
        approved = [
            t for t in task_dicts
            if t.get("scope_status") in ("sent", "approved") or t.get("billing_status") in ("sent", "approved")
        ]
        if approved:
            raise HTTPException(400, f"{len(approved)} task(s) already have a scope or billing approval in progress and cannot be merged.")

        contract_id = task_dicts[0]["contract_id"]
        contract = db.execute(
            "SELECT hourly_rate, rate_locked FROM contracts WHERE id = ? AND tenant_id = ?",
            (contract_id, tenant_id)
        ).fetchone()

        # Entity attribution: carry over if all merged tasks share one entity, otherwise require it explicitly
        entity_names = {(t.get("entity_name") or "").strip() for t in task_dicts}
        entity_names.discard("")
        merged_entity_name = (req.get("entity_name") or "").strip()
        if not merged_entity_name:
            if len(entity_names) == 1:
                merged_entity_name = next(iter(entity_names))
            else:
                raise HTTPException(400, "Merged tasks span different entities — specify entity_name explicitly")

        # Determine merged values
        # Sum hours for hourly tasks
        total_hours = sum(
            float(t.get("estimated_hours") or 0)
            for t in task_dicts
            if t.get("billing_type") == "hourly"
        )
        # Sum flat fees for flat tasks
        total_flat = sum(
            float(t.get("flat_fee_amount") or 0)
            for t in task_dicts
            if t.get("billing_type") == "flat_fee"
        )

        # Use provided values or sensible defaults
        first = task_dicts[0]
        billing_type = req.get("billing_type") or first.get("billing_type") or "hourly"
        title       = (req.get("title") or first.get("title") or "Merged task").strip()
        description = req.get("description") or "; ".join(
            t.get("description") or "" for t in task_dicts if t.get("description")
        ) or None

        # Latest task date
        dates = sorted([t.get("task_date") or "" for t in task_dicts if t.get("task_date")], reverse=True)
        task_date = req.get("task_date") or (dates[0] if dates else now[:10])

        if billing_type == "hourly":
            if contract and contract["rate_locked"]:
                # Same rate-lock rule as task creation — no override allowed.
                if req.get("hourly_rate") is not None and float(req.get("hourly_rate")) != contract["hourly_rate"]:
                    raise HTTPException(400, "This contract's rate is locked — merged task cannot use a different hourly rate")
                hourly_rate = contract["hourly_rate"] or 0
            else:
                hourly_rate = float(req.get("hourly_rate") or first.get("hourly_rate") or 0)
            estimated_hours = float(req.get("estimated_hours") or total_hours)
            flat_fee_amount = 0
        else:
            hourly_rate     = 0
            estimated_hours = 0
            flat_fee_amount = float(req.get("flat_fee") or total_flat)

        # Create the merged task
        merged_id = generate_id()
        db.execute(
            """INSERT INTO contract_tasks
               (id, contract_id, tenant_id, title, description, entity_name, billing_type,
                hourly_rate, estimated_hours, flat_fee_amount, task_date, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (merged_id, contract_id, tenant_id, title, description, merged_entity_name,
             billing_type, hourly_rate, estimated_hours, flat_fee_amount,
             task_date, now)
        )

        # Delete the original tasks
        db.execute(
            f"DELETE FROM contract_tasks WHERE id IN ({placeholders}) AND tenant_id = ?",
            task_ids + [tenant_id]
        )

        merged_amount = (estimated_hours * hourly_rate) if billing_type == "hourly" else flat_fee_amount

    return {
        "merged_task_id":  merged_id,
        "title":           title,
        "billing_type":    billing_type,
        "estimated_hours": estimated_hours,
        "hourly_rate":     hourly_rate,
        "flat_fee_amount": flat_fee_amount,
        "merged_amount":   merged_amount,
        "task_date":       task_date,
        "tasks_merged":    len(task_ids),
        "message":         f"{len(task_ids)} tasks merged into one ({estimated_hours}h total)",
    }
