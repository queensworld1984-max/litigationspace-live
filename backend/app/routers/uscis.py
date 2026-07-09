"""USCIS Case Status API integration with cron job."""
import json
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends

from app.database import get_db
from app.utils.auth import get_current_user, generate_id

router = APIRouter(prefix="/api/uscis", tags=["uscis"])

# USCIS API simulation for MVP (real API requires registration)
USCIS_API_BASE = "https://egov.uscis.gov/casestatus/mycasestatus.do"


async def _check_uscis_status(receipt_number: str) -> dict:
    """Check USCIS case status. In production, this would call the real USCIS API.
    For MVP, we simulate the response."""
    # Simulate USCIS status check
    # In production: httpx.AsyncClient() to call USCIS API
    statuses = {
        "EAC": "Case Was Received",
        "WAC": "Case Is Being Actively Reviewed",
        "LIN": "Request for Additional Evidence Was Sent",
        "SRC": "Case Was Approved",
        "MSC": "Card Is Being Produced",
        "IOE": "New Card Is Being Produced",
    }
    prefix = receipt_number[:3] if len(receipt_number) >= 3 else "EAC"
    status_text = statuses.get(prefix, "Case Was Received")

    return {
        "receipt_number": receipt_number,
        "status": status_text,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "details": f"Your case {receipt_number} - {status_text}. "
                   f"Please check back later for updates."
    }


@router.get("/status/{receipt_number}")
async def check_status(receipt_number: str, current_user: dict = Depends(get_current_user)):
    """Check USCIS case status by receipt number."""
    result = await _check_uscis_status(receipt_number)
    return result


@router.post("/refresh-all")
async def refresh_all_uscis_statuses(current_user: dict = Depends(get_current_user)):
    """Manually trigger USCIS status refresh for all cases with receipt numbers."""
    tenant_id = current_user["tenant_id"]
    updated_count = 0

    with get_db() as db:
        cases = db.execute(
            "SELECT id, uscis_receipt_number FROM cases WHERE tenant_id = ? AND uscis_receipt_number IS NOT NULL",
            (tenant_id,)
        ).fetchall()

        for case in cases:
            result = await _check_uscis_status(case["uscis_receipt_number"])
            db.execute(
                "UPDATE cases SET uscis_status = ?, uscis_last_checked = ? WHERE id = ?",
                (result["status"], result["last_updated"], case["id"])
            )
            updated_count += 1

    return {"updated_cases": updated_count}


async def run_uscis_cron():
    """Cron job to check USCIS status for all cases with receipt numbers."""
    with get_db() as db:
        cases = db.execute(
            "SELECT id, tenant_id, uscis_receipt_number FROM cases WHERE uscis_receipt_number IS NOT NULL"
        ).fetchall()

        for case in cases:
            try:
                result = await _check_uscis_status(case["uscis_receipt_number"])
                old_status = db.execute(
                    "SELECT uscis_status FROM cases WHERE id = ?", (case["id"],)
                ).fetchone()

                db.execute(
                    "UPDATE cases SET uscis_status = ?, uscis_last_checked = ? WHERE id = ?",
                    (result["status"], result["last_updated"], case["id"])
                )

                # Create notification if status changed
                if old_status and old_status["uscis_status"] != result["status"]:
                    notif_id = generate_id()
                    assigned = db.execute(
                        "SELECT assigned_attorney_id FROM cases WHERE id = ?", (case["id"],)
                    ).fetchone()
                    if assigned and assigned["assigned_attorney_id"]:
                        db.execute(
                            """INSERT INTO notifications (id, user_id, tenant_id, type, title, message, data)
                               VALUES (?, ?, ?, ?, ?, ?, ?)""",
                            (notif_id, assigned["assigned_attorney_id"], case["tenant_id"],
                             "uscis_update", "USCIS Status Update",
                             f"Case {case['uscis_receipt_number']}: {result['status']}",
                             json.dumps({"case_id": case["id"], "receipt": case["uscis_receipt_number"]}))
                        )
            except Exception as e:
                print(f"Error checking USCIS status for {case['uscis_receipt_number']}: {e}")
