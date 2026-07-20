"""Signatures router - separate signature request workflow."""
import base64
import io
import json
import os
import re
import secrets
import shutil
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.email import send_signature_request_email, send_signature_completed_email, send_document_signed_firm_notify_email

router = APIRouter(prefix="/api/signatures", tags=["signatures"])

UPLOAD_BASE_DIR = os.environ.get("UPLOAD_DIR", "/var/www/litigationspace/data/uploads")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://litigationspace.com")


class CreateSignatureRequest(BaseModel):
    document_id: str
    signer_name: str
    signer_email: str
    signature_pages: List[int]  # e.g. [5, 12]
    message: Optional[str] = None
    hours: int = 72  # expiration


class DetectSignaturePagesResponse(BaseModel):
    suggested_pages: List[int]
    total_pages: int
    reasons: dict  # page_number -> reason string


class SubmitPageSignature(BaseModel):
    page_number: int
    signature_data: str  # base64 data URL


class SubmitAllSignatures(BaseModel):
    signatures: List[SubmitPageSignature]
    form_field_values: Optional[dict] = None


# ─── Signature page detection patterns ──────────────────────────────
SIGNATURE_PATTERNS = [
    r'(?i)\bsignature\b',
    r'(?i)\bsigned?\b[:\s]',
    r'(?i)\bsign\s+here\b',
    r'(?i)\bsign\s+below\b',
    r'(?i)\bauthorized\s+sign',
    r'(?i)\bnotary\b',
    r'(?i)\bwitness\b.*\bsign',
    r'(?i)\bdate\b.*\bsign',
    r'(?i)\baffiant\b',
    r'(?i)\bsworn\b',
    r'(?i)\backnowledg',
    r'(?i)\bexecut(?:e|ed|ion)\b',
    r'(?i)\battest',
    r'(?i)\binitials?\b',
    r'(?i)_{5,}',           # long underlines (signature lines)
    r'(?i)x\s*_{3,}',       # X followed by underlines
    r'(?i)\bprint\s+name\b',
    r'(?i)\bfull\s+name\b.*\bsign',
    r'(?i)\bby:\s*$',
    r'(?i)\brespectfully\s+submitted\b',
    r'(?i)\bcertif(?:y|ied|ication)\b',
    r'(?i)\bdeclar(?:e|ation|ant)\b',
    r'(?i)\bunder\s+penalty\s+of\s+perjury\b',
    r'(?i)\bcounsel\s+for\b',
]


# ─── Owner endpoints (authenticated) ────────────────────────────────

@router.get("/detect-pages/{doc_id}")
async def detect_signature_pages(doc_id: str, current_user: dict = Depends(get_current_user)):
    """AI-detect pages that likely need signatures by scanning text for signature patterns."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF processing library not available")

    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="File not found")
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found on server")

    try:
        pdf = fitz.open(full_path)
        total_pages = len(pdf)
        suggested_pages = []
        reasons = {}

        for page_idx in range(total_pages):
            page = pdf[page_idx]
            text = page.get_text("text")
            page_num = page_idx + 1

            matched_reasons = []
            for pattern in SIGNATURE_PATTERNS:
                matches = re.findall(pattern, text)
                if matches:
                    # Clean up the matched text for the reason
                    match_text = matches[0].strip()[:50]
                    matched_reasons.append(match_text)

            if matched_reasons:
                suggested_pages.append(page_num)
                reasons[str(page_num)] = f"Found: {', '.join(matched_reasons[:3])}"

        pdf.close()

        return {
            "suggested_pages": suggested_pages,
            "total_pages": total_pages,
            "reasons": reasons,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze document: {str(e)}")


@router.get("/preview/{doc_id}/page/{page_num}")
async def get_document_page_preview(doc_id: str, page_num: int, current_user: dict = Depends(get_current_user)):
    """Render a single page of the document as a PNG image for preview."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF processing library not available")

    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="File not found")
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found on server")

    try:
        pdf = fitz.open(full_path)
        if page_num < 1 or page_num > len(pdf):
            pdf.close()
            raise HTTPException(status_code=400, detail=f"Page {page_num} out of range (1-{len(pdf)})")

        page = pdf[page_num - 1]
        # Render at 1.5x zoom for decent quality preview
        mat = fitz.Matrix(1.5, 1.5)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        pdf.close()

        return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render page: {str(e)}")


@router.post("/request")
async def create_signature_request(req: CreateSignatureRequest, current_user: dict = Depends(get_current_user)):
    """Create a new signature request for a document."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (req.document_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        if not req.signature_pages:
            raise HTTPException(status_code=400, detail="At least one signature page is required")

        sign_token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=req.hours)).isoformat()
        req_id = generate_id()

        db.execute(
            """INSERT INTO signature_requests
               (id, document_id, tenant_id, signer_name, signer_email, sign_token,
                signature_pages, status, message, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (req_id, req.document_id, current_user["tenant_id"],
             req.signer_name.strip(), req.signer_email.strip(), sign_token,
             json.dumps(req.signature_pages), (req.message or "").strip(), expires_at)
        )

        sign_url = f"{FRONTEND_URL}/sign/{sign_token}"
        sender_name = current_user.get("full_name", "The document owner")

        send_signature_request_email(
            to_email=req.signer_email.strip(),
            signer_name=req.signer_name.strip(),
            sender_name=sender_name,
            doc_filename=doc["filename"],
            sign_url=sign_url,
            message=(req.message or "").strip() or f"{sender_name} has requested your signature on this document.",
            page_count=len(req.signature_pages),
        )

        return {
            "id": req_id,
            "sign_token": sign_token,
            "sign_url": sign_url,
            "expires_at": expires_at,
            "signer_name": req.signer_name.strip(),
            "signer_email": req.signer_email.strip(),
            "signature_pages": req.signature_pages,
        }


@router.get("/document/{doc_id}")
async def get_signature_requests_for_doc(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Get all signature requests for a document (owner view)."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        requests = db.execute(
            "SELECT * FROM signature_requests WHERE document_id = ? ORDER BY created_at DESC",
            (doc_id,)
        ).fetchall()

        result = []
        for r in requests:
            sigs = db.execute(
                "SELECT * FROM page_signatures WHERE signature_request_id = ?",
                (r["id"],)
            ).fetchall()
            result.append({
                **dict(r),
                "signature_pages": json.loads(r["signature_pages"]),
                "completed_pages": [dict(s) for s in sigs],
                "pages_signed": len(sigs),
                "pages_total": len(json.loads(r["signature_pages"])),
            })
        return result


# ─── Public endpoints (token-based, no auth) ────────────────────────

def _validate_sign_token(db, sign_token: str):
    """Validate a sign token and return the request row, or raise HTTPException."""
    req = db.execute(
        "SELECT * FROM signature_requests WHERE sign_token = ?",
        (sign_token,)
    ).fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="Invalid signature link")
    if req["status"] == "signed":
        raise HTTPException(status_code=400, detail="This document has already been signed")
    if req["status"] == "declined":
        raise HTTPException(status_code=400, detail="This signature request was declined")
    if req["expires_at"]:
        expires = datetime.fromisoformat(req["expires_at"])
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=410, detail="This signature link has expired")
    return req


@router.get("/sign/{sign_token}")
async def get_signature_request(sign_token: str, request: Request):
    """Get signature request details + document metadata (public, for signer)."""
    with get_db() as db:
        req = _validate_sign_token(db, sign_token)
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (req["document_id"],)).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # If this signature request originated from Outreach (case_id/contact_id
        # set), log the first view as a thread event — deferred import avoids
        # a module-level circular dependency between the two routers.
        if "case_id" in req.keys() and req["case_id"] and req["contact_id"]:
            link = db.execute(
                "SELECT id, status FROM outreach_document_links WHERE sign_token = ?", (sign_token,)
            ).fetchone()
            if link and link["status"] == "sent":
                from app.routers.outreach import _log_thread_event, _notify_thread_watchers
                db.execute("UPDATE outreach_document_links SET status = 'opened', view_count = view_count + 1 WHERE id = ?", (link["id"],))
                ip = request.client.host if request.client else None
                ua = request.headers.get("user-agent", "")
                _log_thread_event(db, req["tenant_id"], req["case_id"], req["contact_id"], "signature_started",
                                   actor_type="contact", actor_id=req["contact_id"], actor_name=req["signer_name"],
                                   document_link_id=link["id"], ip_address=ip, user_agent=ua)
                _notify_thread_watchers(db, req["tenant_id"], req["case_id"], req["contact_id"],
                                         "signature_started", req["signer_name"], detail=doc["filename"])

        # Get already completed signatures for this request
        completed = db.execute(
            "SELECT page_number FROM page_signatures WHERE signature_request_id = ?",
            (req["id"],)
        ).fetchall()
        completed_pages = [r["page_number"] for r in completed]

        form_fields_schema = json.loads(req["form_fields_schema"]) if req["form_fields_schema"] else None
        submitted_values = json.loads(req["form_field_values"]) if req["form_field_values"] else {}
        if form_fields_schema:
            for f in form_fields_schema:
                if f["key"] in submitted_values:
                    f["value"] = submitted_values[f["key"]]

        # For a real fillable form, tell the frontend exactly where each
        # field (and the signature box, if the PDF has one) sits on the
        # page — lets it overlay real inputs directly on top of a rendered
        # image of the actual document, instead of a disconnected list of
        # inputs above it.
        page_layout = None
        if form_fields_schema:
            page_layout = _get_form_field_layout(doc, form_fields_schema)

        return {
            "request_id": req["id"],
            "document_id": req["document_id"],
            "filename": doc["filename"],
            "signer_name": req["signer_name"],
            "signature_pages": json.loads(req["signature_pages"]),
            "completed_pages": completed_pages,
            "message": req["message"],
            "status": req["status"],
            "created_at": req["created_at"],
            "form_fields_schema": form_fields_schema,
            "page_layout": page_layout,
        }


def _get_form_field_layout(doc: dict, form_fields_schema: list) -> dict | None:
    """Opens the PDF once to find each schema field's real widget rect +
    page number (matched by field_names, same lookup _embed_form_field_values
    uses at submit time), plus the "signature" widget's rect if present, and
    each involved page's size in PDF points — everything the frontend needs
    to position overlay inputs on top of a rendered image of the actual page."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return None

    full_path = os.path.join(UPLOAD_BASE_DIR, doc["file_path"] or "")
    if not os.path.exists(full_path):
        return None

    try:
        pdf = fitz.open(full_path)
        fields, pages = {}, {}
        wanted = set()
        for f in form_fields_schema:
            wanted.update(f.get("field_names", []))
        wanted.add("signature")

        for page_idx, page in enumerate(pdf):
            for widget in (page.widgets() or []):
                if widget.field_name in wanted:
                    page_num = page_idx + 1
                    r = widget.rect
                    fields[widget.field_name] = {"page": page_num, "rect": [r.x0, r.y0, r.x1, r.y1]}
                    if page_num not in pages:
                        pages[page_num] = {"width": page.rect.width, "height": page.rect.height}
        pdf.close()
        if not fields:
            return None
        return {"fields": fields, "pages": pages}
    except Exception as e:
        print(f"[SIGNATURES] Failed to read form field layout: {e}")
        return None


@router.get("/sign/{sign_token}/page-image")
async def get_sign_page_image(sign_token: str, page: int = 1):
    """Render one page of the document as a PNG (public, no login) — the
    background image the signer's browser overlays real input fields on
    top of, so filling the form looks and behaves like filling the actual
    document instead of a disconnected list of fields."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF processing library not available")

    with get_db() as db:
        req = db.execute("SELECT * FROM signature_requests WHERE sign_token = ?", (sign_token,)).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Invalid signing link")
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (req["document_id"],)).fetchone()
        if not doc or not doc["file_path"]:
            raise HTTPException(status_code=404, detail="Document not found")

    full_path = os.path.join(UPLOAD_BASE_DIR, doc["file_path"])
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found on server")

    try:
        pdf = fitz.open(full_path)
        if page < 1 or page > len(pdf):
            pdf.close()
            raise HTTPException(status_code=400, detail=f"Page {page} out of range (1-{len(pdf)})")
        pdf_page = pdf[page - 1]
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        img_bytes = pix.tobytes("png")
        pdf.close()
        return StreamingResponse(io.BytesIO(img_bytes), media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render page: {str(e)}")


@router.get("/sign/{sign_token}/file")
async def get_signature_file(sign_token: str):
    """Download the document file for signing (public)."""
    with get_db() as db:
        req = db.execute(
            "SELECT * FROM signature_requests WHERE sign_token = ?",
            (sign_token,)
        ).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Invalid signature link")
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (req["document_id"],)).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        relative_path = doc["file_path"]
        if not relative_path:
            raise HTTPException(status_code=404, detail="File not found")
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found on server")
        return FileResponse(
            full_path,
            media_type=doc["mime_type"] or "application/pdf",
            filename=doc["filename"],
        )


@router.post("/sign/{sign_token}/submit")
async def submit_signatures(sign_token: str, req: SubmitAllSignatures):
    """Submit all signatures for a signing request — embeds into PDF and completes."""
    with get_db() as db:
        sig_req = _validate_sign_token(db, sign_token)
        required_pages = json.loads(sig_req["signature_pages"])

        # Validate all required pages are present
        submitted_pages = {s.page_number for s in req.signatures}
        missing = set(required_pages) - submitted_pages
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing signatures for pages: {sorted(missing)}")

        # If this request requires form fields, every one must have a value
        # (submitted now, or already prefilled) before the form can be
        # considered complete — the user must fill the form, not just sign it.
        form_fields_schema = json.loads(sig_req["form_fields_schema"]) if sig_req["form_fields_schema"] else None
        merged_values = {}
        if form_fields_schema:
            prior_values = json.loads(sig_req["form_field_values"]) if sig_req["form_field_values"] else {}
            submitted_values = req.form_field_values or {}
            missing_fields = []
            for f in form_fields_schema:
                val = (submitted_values.get(f["key"]) or prior_values.get(f["key"]) or "").strip()
                if not val:
                    missing_fields.append(f["label"])
                merged_values[f["key"]] = val
            if missing_fields:
                raise HTTPException(status_code=400, detail=f"Please fill in: {', '.join(missing_fields)}")
            db.execute(
                "UPDATE signature_requests SET form_field_values = ? WHERE id = ?",
                (json.dumps(merged_values), sig_req["id"])
            )

        # Save each page signature
        for sig in req.signatures:
            if sig.page_number not in required_pages:
                continue
            sig_id = generate_id()
            db.execute(
                "INSERT INTO page_signatures (id, signature_request_id, page_number, signature_data) VALUES (?, ?, ?, ?)",
                (sig_id, sig_req["id"], sig.page_number, sig.signature_data)
            )

        # Mark request as signed
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE signature_requests SET status = 'signed', signed_at = ? WHERE id = ?",
            (now, sig_req["id"])
        )

        # Embed signatures (+ typed form field values, if this request has
        # any) into PDF
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (sig_req["document_id"],)).fetchone()
        signed_path = None
        if doc:
            signed_path = _embed_signatures_in_pdf(
                db, doc, req.signatures, sig_req,
                form_fields_schema=form_fields_schema, form_field_values=merged_values,
            )

        # If outreach-originated, log completion as a permanent thread event
        firm_notify_email, firm_notify_name, case_title, review_url = None, None, "", None
        if "case_id" in sig_req.keys() and sig_req["case_id"] and sig_req["contact_id"]:
            from app.routers.outreach import _log_thread_event, _notify_thread_watchers, _stop_remaining_campaign_steps
            link = db.execute(
                "SELECT id, token, created_by FROM outreach_document_links WHERE sign_token = ?", (sign_token,)
            ).fetchone()
            db.execute("UPDATE outreach_document_links SET status = 'signed' WHERE sign_token = ?", (sign_token,))
            _log_thread_event(db, sig_req["tenant_id"], sig_req["case_id"], sig_req["contact_id"], "signature_completed",
                               actor_type="contact", actor_id=sig_req["contact_id"], actor_name=sig_req["signer_name"],
                               document_link_id=link["id"] if link else None,
                               metadata={"pages_signed": len(req.signatures)})
            _notify_thread_watchers(db, sig_req["tenant_id"], sig_req["case_id"], sig_req["contact_id"],
                                     "signature_completed", sig_req["signer_name"],
                                     detail=doc["filename"] if doc else "")

            # Stop any remaining not-yet-sent campaign stages — they've
            # already signed, so a later "you still haven't responded"
            # follow-up would be pointless and undermine the good-faith record.
            stopped = _stop_remaining_campaign_steps(db, sig_req["tenant_id"], sig_req["case_id"], sig_req["contact_id"])
            if stopped:
                _log_thread_event(db, sig_req["tenant_id"], sig_req["case_id"], sig_req["contact_id"],
                                   "sequence_stopped", actor_type="system", actor_name="System",
                                   metadata={"reason": "document_signed", "stages_cancelled": stopped})
                _notify_thread_watchers(db, sig_req["tenant_id"], sig_req["case_id"], sig_req["contact_id"],
                                         "sequence_stopped", sig_req["signer_name"], detail=f"{stopped} remaining email(s) cancelled")

            if link and link["created_by"]:
                creator = db.execute("SELECT full_name, email FROM users WHERE id = ?", (link["created_by"],)).fetchone()
                if creator and creator["email"]:
                    firm_notify_email, firm_notify_name = creator["email"], creator["full_name"] or "there"
                case_row = db.execute("SELECT title FROM cases WHERE id = ?", (sig_req["case_id"],)).fetchone()
                case_title = case_row["title"] if case_row else ""
                review_url = f"{FRONTEND_URL}/outreach-document/{link['token']}"

        # Send completed email to signer
        sign_url = f"{FRONTEND_URL}/sign/{sign_token}"
        send_signature_completed_email(
            to_email=sig_req["signer_email"],
            signer_name=sig_req["signer_name"],
            doc_filename=doc["filename"] if doc else "document",
            download_url=f"{FRONTEND_URL}/api/signatures/sign/{sign_token}/download",
        )
        if firm_notify_email:
            send_document_signed_firm_notify_email(
                to_email=firm_notify_email, staff_name=firm_notify_name, contact_name=sig_req["signer_name"],
                doc_filename=doc["filename"] if doc else "document", case_title=case_title,
                download_url=review_url or f"{FRONTEND_URL}/api/signatures/sign/{sign_token}/download",
            )

        return {
            "status": "signed",
            "signed_at": now,
            "pages_signed": len(req.signatures),
            "signed_file_available": signed_path is not None,
        }


@router.get("/sign/{sign_token}/download")
async def download_signed_document(sign_token: str):
    """Download the signed PDF with embedded signatures."""
    with get_db() as db:
        sig_req = db.execute(
            "SELECT * FROM signature_requests WHERE sign_token = ?",
            (sign_token,)
        ).fetchone()
        if not sig_req:
            raise HTTPException(status_code=404, detail="Invalid signature link")

        doc = db.execute("SELECT * FROM documents WHERE id = ?", (sig_req["document_id"],)).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # Check for signed version
        relative_path = doc["file_path"]
        base_name = os.path.splitext(relative_path)[0]
        signed_path = os.path.join(UPLOAD_BASE_DIR, f"{base_name}_signed_{sig_req['id'][:8]}.pdf")

        if os.path.exists(signed_path):
            return FileResponse(signed_path, media_type="application/pdf",
                                filename=f"SIGNED_{doc['filename']}")

        # Fallback: return original
        full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(full_path, media_type="application/pdf", filename=doc["filename"])


def _embed_form_field_values(pdf, form_fields_schema: list, form_field_values: dict) -> None:
    """Fill typed values into a PDF's real AcroForm text widgets by field
    name (the correct way to fill a genuine fillable PDF — the form's own
    highlighted fill-in boxes are annotation widgets that render on top of
    the page content, so drawing free text onto the page underneath them
    is invisible; setting the widget's own value is what actually shows).

    A field can list more than one field_name (e.g. "company" appears both
    inline in the recital and again in the signature block, as two separate
    widgets) — the same value is written into every matching widget.

    Falls back to text-search placement (`anchors`, if given) for any field
    whose field_names aren't found as real widgets — keeps this usable for
    a future document that has descriptive labels but isn't a true AcroForm."""
    import fitz  # PyMuPDF
    for field in form_fields_schema:
        value = form_field_values.get(field["key"], "")
        if not value:
            continue
        matched_by_widget = False
        for page in pdf:
            for widget in page.widgets() or []:
                if widget.field_name in field.get("field_names", []):
                    widget.field_value = value
                    widget.update()
                    matched_by_widget = True
        if matched_by_widget:
            continue
        for anchor in field.get("anchors", []):
            for page in pdf:
                hits = page.search_for(anchor)
                for rect in hits:
                    x0 = rect.x1 + 4
                    y0 = rect.y0 - 1
                    text_rect = fitz.Rect(x0, y0, min(x0 + 220, page.rect.width - 20), rect.y1 + 3)
                    page.insert_textbox(text_rect, value, fontsize=9, color=(0, 0, 0.6), align=0)


def _embed_signatures_in_pdf(db, doc: dict, signatures: List[SubmitPageSignature], sig_req: dict,
                              form_fields_schema: list = None, form_field_values: dict = None) -> str | None:
    """Embed signature images (+ typed form field values, if any) into PDF
    pages using PyMuPDF (fitz). Takes the caller's already-open db connection
    for the signed-document insert rather than opening a second one — a
    second connection attempting to write while the caller's transaction is
    still open deadlocks under SQLite's WAL mode (no busy_timeout is set),
    which silently failed every signed-document save before this fix."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("[SIGNATURES] PyMuPDF not available — cannot embed signatures")
        return None

    relative_path = doc["file_path"]
    full_path = os.path.join(UPLOAD_BASE_DIR, relative_path)
    if not os.path.exists(full_path):
        return None

    try:
        pdf = fitz.open(full_path)

        if form_fields_schema and form_field_values:
            _embed_form_field_values(pdf, form_fields_schema, form_field_values)
            # Auto-stamp today's date next to a "Date:" label, if present —
            # the signer isn't asked to type this, it's filled automatically
            # the same way the signature itself is dated below.
            today_str = datetime.now(timezone.utc).strftime("%m/%d/%Y")
            _embed_form_field_values(pdf, [{"key": "_auto_date", "field_names": ["date"], "anchors": ["Date:"]}], {"_auto_date": today_str})

        for sig in signatures:
            page_idx = sig.page_number - 1  # 0-indexed
            if page_idx < 0 or page_idx >= len(pdf):
                continue

            page = pdf[page_idx]
            page_rect = page.rect

            # Decode the base64 signature image
            sig_data = sig.signature_data
            if sig_data.startswith("data:image"):
                sig_data = sig_data.split(",", 1)[1]
            img_bytes = base64.b64decode(sig_data)

            # If this page has a real "signature" AcroForm field (a genuine
            # fillable form), place the drawn signature image inside that
            # exact box instead of guessing a generic bottom-of-page spot —
            # the field's own "Signature:" label already gives it context,
            # so no extra line/caption is added on top of it. It's a Text
            # widget (there's no image-type field to set a value on), and
            # widget annotations render on top of page content — so the
            # widget itself is deleted first, or the image would be drawn
            # underneath its highlighted box and never actually show.
            sig_widget_rect = None
            for widget in (page.widgets() or []):
                if widget.field_name == "signature":
                    sig_widget_rect = widget.rect
                    page.delete_widget(widget)
                    break

            if sig_widget_rect:
                pad = 2
                sig_rect = fitz.Rect(sig_widget_rect.x0 + pad, sig_widget_rect.y0 + pad,
                                     sig_widget_rect.x1 - pad, sig_widget_rect.y1 - pad)
                page.insert_image(sig_rect, stream=img_bytes)
            else:
                # Generic fallback: bottom-center of the page, with a drawn
                # line and signer/date caption for context.
                sig_width = page_rect.width * 0.35
                sig_height = sig_width * 0.25
                x_center = (page_rect.width - sig_width) / 2
                y_bottom = page_rect.height - sig_height - 60  # 60pt from bottom

                sig_rect = fitz.Rect(x_center, y_bottom, x_center + sig_width, y_bottom + sig_height)

                page.draw_line(
                    fitz.Point(x_center, y_bottom + sig_height + 5),
                    fitz.Point(x_center + sig_width, y_bottom + sig_height + 5),
                    color=(0, 0, 0), width=0.5
                )
                label_rect = fitz.Rect(x_center, y_bottom + sig_height + 8,
                                       x_center + sig_width, y_bottom + sig_height + 22)
                page.insert_textbox(
                    label_rect,
                    f"{sig_req['signer_name']} — Signed {datetime.now(timezone.utc).strftime('%m/%d/%Y')}",
                    fontsize=7, color=(0.3, 0.3, 0.3), align=1  # center
                )
                page.insert_image(sig_rect, stream=img_bytes)

        # Save signed PDF
        base_name = os.path.splitext(relative_path)[0]
        signed_filename = f"{base_name}_signed_{sig_req['id'][:8]}.pdf"
        signed_full_path = os.path.join(UPLOAD_BASE_DIR, signed_filename)
        os.makedirs(os.path.dirname(signed_full_path), exist_ok=True)
        pdf.save(signed_full_path)
        pdf.close()

        # Also save a copy as a new document in the case's "signed" folder —
        # reuses the caller's open connection/transaction (see docstring).
        signed_doc_id = generate_id()
        original_name = doc["filename"]
        signed_doc_name = f"SIGNED_{original_name}"
        db.execute(
            """INSERT INTO documents
               (id, case_id, tenant_id, filename, file_path, mime_type, file_size, category, is_merged, exhibit_label)
               VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, 'ready', 0, 'Signed')""",
            (signed_doc_id, doc["case_id"], doc["tenant_id"], signed_doc_name,
             signed_filename, os.path.getsize(signed_full_path))
        )

        print(f"[SIGNATURES] Embedded signatures into {signed_full_path}")
        return signed_full_path

    except Exception as e:
        print(f"[SIGNATURES ERROR] Failed to embed signatures: {e}")
        return None
