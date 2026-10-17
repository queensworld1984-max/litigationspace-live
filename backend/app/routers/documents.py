"""Documents router - file sharing with pre-signed URLs."""
import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import FileResponse

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.email import (
    send_document_review_email,
    send_reviewer_update_email,
    send_review_received_sender_email,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])


def _resolve_document_sender(db, doc) -> Optional[dict]:
    """Find who should receive 'review submitted' emails for this document.

    Prefers the uploader; falls back to a tenant admin / any active user.
    Returns dict with email, full_name, user_id — or None.
    """
    doc = dict(doc) if not isinstance(doc, dict) else doc
    tenant_id = doc.get("tenant_id")
    uploaded_by = doc.get("uploaded_by")

    def _user_row(sql, params):
        row = db.execute(sql, params).fetchone()
        return dict(row) if row else None

    user = None
    if uploaded_by:
        user = _user_row(
            "SELECT id, email, full_name, role, status FROM users WHERE id = ?",
            (uploaded_by,),
        )
    if (not user or not (user.get("email") or "").strip()) and tenant_id:
        user = _user_row(
            """SELECT id, email, full_name, role, status FROM users
               WHERE tenant_id = ? AND COALESCE(status,'active') != 'disabled'
                 AND email IS NOT NULL AND TRIM(email) != ''
               ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'owner' THEN 0 ELSE 1 END,
                        created_at ASC
               LIMIT 1""",
            (tenant_id,),
        )
    if not user:
        return None
    email = (user.get("email") or "").strip()
    if not email or "@" not in email:
        return None
    return {
        "user_id": user.get("id"),
        "email": email,
        "full_name": (user.get("full_name") or "").strip() or "there",
    }


def _case_url_for_doc(doc) -> str:
    """Deep link into the case vault for the document, when possible."""
    frontend = (
        os.environ.get("FRONTEND_URL")
        or os.environ.get("LS_PUBLIC_URL")
        or "https://litigationspace.com"
    ).rstrip("/")
    case_id = None
    try:
        case_id = doc["case_id"] if not isinstance(doc, dict) else doc.get("case_id")
    except Exception:
        case_id = None
    if case_id:
        return f"{frontend}/cases/{case_id}"
    return f"{frontend}/cases"


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
_UPLOAD_FALLBACKS = (
    UPLOAD_BASE_DIR,
    "/var/www/litigationspace-staging/uploads",
    "/var/www/litigationspace-staging/data/uploads",
    "/var/www/litigationspace/uploads",
    "/var/www/litigationspace/data/uploads",
)


def _resolve_upload_path(relative_path: str) -> Optional[Path]:
    """Resolve a stored document path across known upload roots."""
    if not relative_path:
        return None
    if relative_path.startswith("/") and Path(relative_path).exists():
        return Path(relative_path)
    seen = set()
    for root in _UPLOAD_FALLBACKS:
        if not root:
            continue
        p = Path(root) / relative_path
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.exists():
            return p
    return None


def _frontend_base() -> str:
    return (
        os.environ.get("FRONTEND_URL")
        or os.environ.get("LS_PUBLIC_URL")
        or "https://litigationspace.com"
    ).rstrip("/")


def _api_base() -> str:
    return (
        os.environ.get("API_PUBLIC_URL")
        or os.environ.get("BASE_URL")
        or "https://litigationspace.com"
    ).rstrip("/")


def _generate_share_token(doc_id: str) -> str:
    """Generate a secure share token."""
    token = secrets.token_urlsafe(32)
    signature = hmac.new(
        SHARE_SECRET.encode(), f"{doc_id}:{token}".encode(), hashlib.sha256
    ).hexdigest()[:16]
    return f"{token}.{signature}"


def _share_payload(doc, share_token: str, expires_at: Optional[str]) -> dict:
    frontend = _frontend_base()
    api = _api_base()
    # Full review page (preview + comments + download)
    share_url = f"{frontend}/review/{share_token}"
    # Client download-only landing page (clean page, no distorted text extract)
    download_page_url = f"{frontend}/review/{share_token}?mode=download"
    # Direct file URL — ?download=1 forces attachment; bare URL is inline for PDF viewer
    file_url = f"{api}/api/documents/shared/{share_token}/file"
    download_url = f"{file_url}?download=1"
    return {
        "share_url": share_url,
        "review_url": share_url,
        "download_page_url": download_page_url,
        "download_url": download_url,
        "view_url": file_url,
        "token": share_token,
        "expires_at": expires_at,
        "document_id": doc["id"],
        "filename": doc["filename"],
        "is_shared": True,
    }


def _token_still_valid(doc) -> bool:
    if not doc.get("is_shared") or not doc.get("share_token"):
        return False
    exp = doc.get("share_expires_at")
    if not exp:
        return True
    try:
        expires = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < expires
    except Exception:
        return False


@router.get("/{doc_id}/share")
async def generate_share_link(
    doc_id: str,
    hours: int = Query(168, ge=1, le=720, description="Link lifetime in hours (default 7 days, max 30)"),
    refresh: bool = Query(False, description="Force a new token even if one is still valid"),
    current_user: dict = Depends(get_current_user)
):
    """Generate (or reuse) a no-login share/download link for a document.

    Default lifetime is 7 days. Reuses an unexpired token so previously
    emailed links are not silently invalidated.
    """
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        doc = dict(doc)

        # Reuse existing valid token unless refresh requested
        if not refresh and _token_still_valid(doc):
            return _share_payload(doc, doc["share_token"], doc.get("share_expires_at"))

        share_token = _generate_share_token(doc_id)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

        db.execute(
            "UPDATE documents SET share_token = ?, share_expires_at = ?, is_shared = 1 WHERE id = ?",
            (share_token, expires_at, doc_id)
        )

        return _share_payload(doc, share_token, expires_at)


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
    exp_raw = doc["share_expires_at"]
    if exp_raw:
        try:
            expires = datetime.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires:
                raise HTTPException(status_code=410, detail="Share link has expired")
        except HTTPException:
            raise
        except Exception:
            # Bad expiry format — treat as still valid rather than blocking reviews
            logger.warning("share token expiry parse failed token=%s exp=%r", share_token[:16], exp_raw)
    return doc


@router.get("/shared/{share_token}")
async def access_shared_document(share_token: str):
    """Access a shared document via pre-signed URL — returns metadata + existing reviews."""
    with get_db() as db:
        doc = dict(_validate_share_token(db, share_token))
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
        relative_path = doc.get("file_path")
        resolved = _resolve_upload_path(relative_path or "")
        has_file = bool(resolved and resolved.exists())
        fname = doc.get("filename") or "document.pdf"
        mime = (doc.get("mime_type") or "").strip()
        if not mime or mime == "application/octet-stream":
            lower = fname.lower()
            if lower.endswith(".pdf"):
                mime = "application/pdf"
            elif lower.endswith(".docx"):
                mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            elif lower.endswith(".doc"):
                mime = "application/msword"
            else:
                mime = "application/octet-stream"
        is_pdf = mime == "application/pdf" or fname.lower().endswith(".pdf")
        file_size = doc.get("file_size")
        if not file_size and has_file and resolved is not None:
            try:
                file_size = resolved.stat().st_size
            except OSError:
                file_size = None
        return {
            "document_id": doc["id"],
            "filename": fname,
            "file_path": doc.get("file_path"),
            "category": doc.get("category"),
            "mime_type": mime,
            # Only send text extracts for non-PDFs — PDF must use the original file
            "content_text": None if is_pdf else doc.get("content_text"),
            "content_html": None if is_pdf else doc.get("content_html"),
            "has_file": has_file,
            "download_url": f"/api/documents/shared/{share_token}/file?download=1",
            "view_url": f"/api/documents/shared/{share_token}/file",
            "file_size": file_size,
            "created_at": doc.get("created_at"),
            "approval_status": approval_status,
            "reviews": [dict(r) for r in reviews],
        }


@router.get("/shared/{share_token}/file")
async def download_shared_file(
    share_token: str,
    download: int = Query(0, description="1 = force download (attachment); 0 = inline for PDF viewer"),
):
    """Serve shared file — no login.

    Default is *inline* so browser PDF viewers render colors/formatting correctly
    inside iframes. Pass ?download=1 to force a file download.
    """
    with get_db() as db:
        doc = _validate_share_token(db, share_token)
        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="File not found on server")
        full = _resolve_upload_path(relative_path)
        if not full or not full.exists():
            logger.error(
                "shared download missing file doc=%s relative=%r UPLOAD_BASE_DIR=%r",
                doc["id"], relative_path, UPLOAD_BASE_DIR,
            )
            raise HTTPException(status_code=404, detail="File not found on server")
        fname = doc["filename"] or full.name or "document.pdf"
        mime = (doc["mime_type"] or "").strip()
        if not mime or mime == "application/octet-stream":
            if fname.lower().endswith(".pdf"):
                mime = "application/pdf"
            else:
                mime = "application/octet-stream"
        # Inline for in-browser PDF preview; attachment only when client wants a save
        disposition = "attachment" if download else "inline"
        return FileResponse(
            str(full),
            media_type=mime,
            filename=fname,
            content_disposition_type=disposition,
            headers={
                # Allow iframe embedding of the PDF viewer
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=120",
            },
        )


@router.post("/shared/{share_token}/review")
async def add_review(share_token: str, req: ReviewComment):
    """Add a comment or approval/rejection to a shared document (no login)."""
    valid_actions = {"comment", "approve", "reject", "request_changes"}
    action = (req.action or "comment").strip().lower()
    if action not in valid_actions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action. Must be one of: {', '.join(sorted(valid_actions))}",
        )
    name = (req.reviewer_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Reviewer name is required")
    comment = (req.comment or "").strip()
    try:
        with get_db() as db:
            # Ensure reviews table exists (older DBs / partial migrations)
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS doc_reviews (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    share_token TEXT,
                    reviewer_name TEXT NOT NULL,
                    page_number INTEGER,
                    comment TEXT,
                    action TEXT DEFAULT 'comment',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            doc = _validate_share_token(db, share_token)
            doc = dict(doc)
            review_id = generate_id()
            db.execute(
                """INSERT INTO doc_reviews
                   (id, document_id, share_token, reviewer_name, page_number, comment, action)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    review_id,
                    doc["id"],
                    share_token,
                    name,
                    req.page_number,
                    comment,
                    action,
                ),
            )
            # Resolve sender now (while DB is open) for post-commit notify
            sender = _resolve_document_sender(db, doc)
            case_url = _case_url_for_doc(doc)
            doc_filename = doc.get("filename") or "Document"

        # Email the document owner / firm sender on every review (default)
        email_sent = False
        if sender and sender.get("email"):
            try:
                email_sent = bool(
                    send_review_received_sender_email(
                        to_email=sender["email"],
                        sender_name=sender.get("full_name") or "there",
                        reviewer_name=name,
                        doc_filename=doc_filename,
                        action=action,
                        comment=comment,
                        case_url=case_url,
                        page_number=req.page_number,
                    )
                )
                if email_sent:
                    logger.info(
                        "review notify sent to %s for doc %s action=%s",
                        sender["email"], doc.get("id"), action,
                    )
                else:
                    logger.warning(
                        "review notify failed (send returned false) to %s doc=%s",
                        sender["email"], doc.get("id"),
                    )
            except Exception as mail_err:
                # Never fail the client review if email delivery fails
                logger.exception(
                    "review notify exception to %s: %s",
                    sender.get("email"), mail_err,
                )
        else:
            logger.warning(
                "review saved but no sender email for doc=%s tenant=%s",
                doc.get("id"), doc.get("tenant_id"),
            )

        return {
            "id": review_id,
            "document_id": doc["id"],
            "reviewer_name": name,
            "page_number": req.page_number,
            "comment": comment,
            "action": action,
            "status": "ok",
            "sender_notified": email_sent,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("add_review failed token=%s: %s", share_token[:20], e)
        raise HTTPException(
            status_code=500,
            detail="Could not save your review. Please try again in a moment.",
        )


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
        doc = dict(doc)

        # Generate or reuse share token (7 days)
        if _token_still_valid(doc):
            share_token = doc["share_token"]
            expires_at = doc.get("share_expires_at")
        else:
            share_token = _generate_share_token(doc_id)
            expires_at = (datetime.now(timezone.utc) + timedelta(hours=168)).isoformat()
            db.execute(
                "UPDATE documents SET share_token = ?, share_expires_at = ?, is_shared = 1 WHERE id = ?",
                (share_token, expires_at, doc_id)
            )

        payload = _share_payload(doc, share_token, expires_at)
        review_url = payload["share_url"]

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
        return {
            "status": "sent",
            "to": req.to_email,
            "review_url": review_url,
            "download_url": payload["download_url"],
            "expires_at": expires_at,
        }


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
