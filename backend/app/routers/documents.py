"""Documents router - file sharing with pre-signed URLs."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.email import send_document_review_email, send_reviewer_update_email

router = APIRouter(prefix="/api/documents", tags=["documents"])


class ReviewComment(BaseModel):
    reviewer_name: str
    page_number: Optional[int] = None
    comment: Optional[str] = None
    action: str = "comment"  # comment | approve | reject | request_changes


class EmailShareRequest(BaseModel):
    to_email: str
    reviewer_name: str
    instruction_message: str


class NotifyReviewerRequest(BaseModel):
    to_email: str
    reviewer_name: str
    message: Optional[str] = None

# For MVP, we simulate pre-signed URLs without actual S3
SHARE_SECRET = os.environ.get("SHARE_SECRET", "omni-legal-share-secret")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
UPLOAD_BASE_DIR = os.environ.get("UPLOAD_DIR", "/var/www/litigationspace/data/uploads")


def _generate_share_token(doc_id: str) -> str:
    """Generate a secure share token."""
    token = secrets.token_urlsafe(32)
    signature = hmac.new(
        SHARE_SECRET.encode(), f"{doc_id}:{token}".encode(), hashlib.sha256
    ).hexdigest()[:16]
    return f"{token}.{signature}"


@router.get("/{doc_id}/share")
async def generate_share_link(
    doc_id: str,
    hours: int = 24,
    current_user: dict = Depends(get_current_user)
):
    """Generate a pre-signed share URL for a document (One-Click Share)."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        share_token = _generate_share_token(doc_id)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

        db.execute(
            "UPDATE documents SET share_token = ?, share_expires_at = ?, is_shared = 1 WHERE id = ?",
            (share_token, expires_at, doc_id)
        )

        # Point to frontend review page (not raw API)
        frontend_base = os.environ.get("FRONTEND_URL", BASE_URL)
        share_url = f"{frontend_base}/review/{share_token}"

        return {
            "share_url": share_url,
            "token": share_token,
            "expires_at": expires_at,
            "document_id": doc_id,
            "filename": doc["filename"],
        }


@router.delete("/{doc_id}/share")
async def revoke_share(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke share access for a document (kill-switch)."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        db.execute(
            "UPDATE documents SET share_token = NULL, share_expires_at = NULL, is_shared = 0 WHERE id = ?",
            (doc_id,)
        )
        return {"status": "revoked", "document_id": doc_id}


def _validate_share_token(db, share_token: str):
    """Validate a share token and return the document row, or raise HTTPException."""
    doc = db.execute(
        "SELECT * FROM documents WHERE share_token = ? AND is_shared = 1",
        (share_token,)
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Invalid or expired share link")
    if doc["share_expires_at"]:
        expires = datetime.fromisoformat(doc["share_expires_at"])
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=410, detail="Share link has expired")
    return doc


@router.get("/shared/{share_token}")
async def access_shared_document(share_token: str):
    """Access a shared document via pre-signed URL — returns metadata + existing reviews."""
    with get_db() as db:
        doc = _validate_share_token(db, share_token)
        reviews = db.execute(
            "SELECT * FROM doc_reviews WHERE document_id = ? ORDER BY created_at ASC",
            (doc["id"],)
        ).fetchall()
        approval_status = "pending"
        for r in reviews:
            if r["action"] == "approve":
                approval_status = "approved"
            elif r["action"] == "reject":
                approval_status = "rejected"
            elif r["action"] == "request_changes":
                approval_status = "changes_requested"
        relative_path = doc["file_path"]
        has_file = bool(relative_path and os.path.exists(
            os.path.join(UPLOAD_BASE_DIR, relative_path)
        ))
        return {
            "document_id": doc["id"],
            "filename": doc["filename"],
            "file_path": doc["file_path"],
            "category": doc["category"],
            "content_text": doc["content_text"],
            "content_html": doc["content_html"] if "content_html" in doc.keys() else None,
            "has_file": has_file,
            "created_at": doc["created_at"],
            "approval_status": approval_status,
            "reviews": [dict(r) for r in reviews],
        }


@router.get("/shared/{share_token}/file")
async def download_shared_file(share_token: str):
    """Download the actual file for a shared document (for PDF viewer)."""
    with get_db() as db:
        doc = _validate_share_token(db, share_token)
        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="File not found on server")
        # file_path in DB is relative; prepend upload base dir
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found on server")
        return FileResponse(
            full_path,
            media_type=doc["mime_type"] or "application/pdf",
            filename=doc["filename"],
        )


@router.post("/shared/{share_token}/review")
async def add_review(share_token: str, req: ReviewComment):
    """Add a comment or approval/rejection to a shared document."""
    valid_actions = {"comment", "approve", "reject", "request_changes"}
    if req.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action. Must be one of: {', '.join(sorted(valid_actions))}")
    if not req.reviewer_name or not req.reviewer_name.strip():
        raise HTTPException(status_code=400, detail="Reviewer name is required")
    with get_db() as db:
        doc = _validate_share_token(db, share_token)
        review_id = generate_id()
        db.execute(
            """INSERT INTO doc_reviews (id, document_id, share_token, reviewer_name, page_number, comment, action)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (review_id, doc["id"], share_token, req.reviewer_name.strip(),
             req.page_number, (req.comment or "").strip(), req.action)
        )
        return {
            "id": review_id,
            "document_id": doc["id"],
            "reviewer_name": req.reviewer_name.strip(),
            "page_number": req.page_number,
            "comment": (req.comment or "").strip(),
            "action": req.action,
        }


@router.post("/{doc_id}/share-email")
async def share_via_email(doc_id: str, req: EmailShareRequest, current_user: dict = Depends(get_current_user)):
    """Share a document for review via email — generates share link and sends email."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # Generate or reuse share token
        share_token = doc["share_token"]
        if not share_token or not doc["is_shared"]:
            share_token = _generate_share_token(doc_id)
            expires_at = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
            db.execute(
                "UPDATE documents SET share_token = ?, share_expires_at = ?, is_shared = 1 WHERE id = ?",
                (share_token, expires_at, doc_id)
            )

        frontend_base = os.environ.get("FRONTEND_URL", BASE_URL)
        review_url = f"{frontend_base}/review/{share_token}"

        success = send_document_review_email(
            to_email=req.to_email.strip(),
            reviewer_name=req.reviewer_name.strip(),
            sender_name=current_user.get("full_name", "A colleague"),
            doc_filename=doc["filename"],
            review_url=review_url,
            instruction_message=req.instruction_message.strip(),
        )
        if not success:
            raise HTTPException(status_code=500, detail="Failed to send email. Please try sharing via link instead.")
        return {"status": "sent", "to": req.to_email, "review_url": review_url}


@router.get("/{doc_id}/reviews")
async def get_document_reviews(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Get all reviews/comments for a document (owner view)."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        reviews = db.execute(
            "SELECT * FROM doc_reviews WHERE document_id = ? ORDER BY created_at ASC",
            (doc_id,)
        ).fetchall()
        approval_status = "pending"
        for r in reviews:
            if r["action"] == "approve":
                approval_status = "approved"
            elif r["action"] == "reject":
                approval_status = "rejected"
            elif r["action"] == "request_changes":
                approval_status = "changes_requested"
        return {
            "document_id": doc_id,
            "approval_status": approval_status,
            "reviews": [dict(r) for r in reviews],
        }


@router.post("/{doc_id}/notify-reviewer")
async def notify_reviewer(doc_id: str, req: NotifyReviewerRequest, current_user: dict = Depends(get_current_user)):
    """Notify a reviewer that a document has been updated and is ready for re-review."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        if not doc["is_shared"] or not doc["share_token"]:
            raise HTTPException(status_code=400, detail="Document is not currently shared. Please share it first.")

        frontend_base = os.environ.get("FRONTEND_URL", BASE_URL)
        review_url = f"{frontend_base}/review/{doc['share_token']}"
        sender_name = current_user.get("full_name", "The document owner")
        default_msg = f"{sender_name} has revised the document based on your feedback. Please review the updated version and provide your approval or additional comments."

        success = send_reviewer_update_email(
            to_email=req.to_email.strip(),
            reviewer_name=req.reviewer_name.strip(),
            sender_name=sender_name,
            doc_filename=doc["filename"],
            review_url=review_url,
            message=(req.message or "").strip() or default_msg,
        )
        if not success:
            raise HTTPException(status_code=500, detail="Failed to send notification email.")
        return {"status": "sent", "to": req.to_email, "review_url": review_url}


@router.post("/{doc_id}/reextract-text")
async def reextract_document_text(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Re-extract and save content_text for an existing document (fixes documents uploaded before the text-save bug was fixed)."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="No file path on record")
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found on server")

        from pathlib import Path
        ext = Path(doc["filename"]).suffix.lower()
        file_bytes = Path(full_path).read_bytes()

        from app.routers.cases import (
            _extract_text_from_pdf, _extract_text_from_docx,
            _generate_html_from_pdf, _generate_html_from_docx,
        )
        import html as _html_mod

        text = ""
        content_html = ""
        if ext == ".pdf":
            text = _extract_text_from_pdf(file_bytes)
            content_html = _generate_html_from_pdf(file_bytes)
        elif ext in (".docx", ".doc"):
            text = _extract_text_from_docx(file_bytes)
            content_html = _generate_html_from_docx(file_bytes)
        elif ext == ".txt":
            text = file_bytes.decode("utf-8", errors="ignore")[:500_000]
            content_html = "".join(
                f"<p>{_html_mod.escape(line)}</p>"
                for line in text.splitlines() if line.strip()
            )

        db.execute(
            "UPDATE documents SET content_text = ?, content_html = ? WHERE id = ?",
            (text, content_html, doc_id)
        )
        return {"document_id": doc_id, "chars_extracted": len(text), "html_chars": len(content_html)}


@router.get("/review-alerts/pending")
async def get_review_alerts(current_user: dict = Depends(get_current_user)):
    """Get all shared documents with pending review activity for the dashboard."""
    with get_db() as db:
        # Get all shared documents owned by this user that have reviews
        shared_docs = db.execute(
            """SELECT d.id, d.filename, d.case_id, d.is_merged,
                      c.title as case_title
               FROM documents d
               LEFT JOIN cases c ON d.case_id = c.id
               WHERE d.tenant_id = ? AND d.is_shared = 1 AND d.share_token IS NOT NULL""",
            (current_user["tenant_id"],)
        ).fetchall()

        alerts = []
        for doc in shared_docs:
            reviews = db.execute(
                "SELECT * FROM doc_reviews WHERE document_id = ? ORDER BY created_at DESC",
                (doc["id"],)
            ).fetchall()
            if not reviews:
                continue

            # Determine latest status
            approval_status = "pending"
            for r in reviews:
                if r["action"] == "approve":
                    approval_status = "approved"
                    break
                elif r["action"] == "reject":
                    approval_status = "rejected"
                    break
                elif r["action"] == "request_changes":
                    approval_status = "changes_requested"
                    break

            latest_review = reviews[0]  # most recent
            alerts.append({
                "document_id": doc["id"],
                "filename": doc["filename"],
                "case_id": doc["case_id"],
                "case_title": doc["case_title"],
                "is_merged": doc["is_merged"],
                "approval_status": approval_status,
                "review_count": len(reviews),
                "latest_reviewer": latest_review["reviewer_name"],
                "latest_action": latest_review["action"],
                "latest_comment": latest_review["comment"],
                "latest_at": latest_review["created_at"],
            })

        # Sort: changes_requested first, then rejected, then pending, then approved
        priority = {"changes_requested": 0, "rejected": 1, "pending": 2, "approved": 3}
        alerts.sort(key=lambda a: (priority.get(a["approval_status"], 4), a["latest_at"]))
        return alerts
