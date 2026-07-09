"""
Router for the Legal Drafting Room.
Handles: court rules, enhanced drafts with versioning, lifecycle transitions,
sentinel validation, AI trim, comments, research sidecar.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form, Body
from pydantic import BaseModel
from typing import Optional, List
import uuid
import json
import re
import html
import os
from datetime import datetime, timezone, timedelta
import secrets
import httpx

from app.database import get_db
from app.utils.auth import get_current_user
from app.services.ai_client import call_claude, call_claude_json, call_openai_json, get_ai_provider
from app.services.caption_engine import generate_caption_html, generate_caption_for_docx
from app.services.interest_calc import calculate_simple_interest, substitute_financial_tokens
from app.services.docx_builder import build_docx
from app.services.document_processor import (
    extract_text_from_bytes, is_supported_file, is_image_file, is_audio_file,
    transcribe_audio, MAX_FILES, MAX_TOTAL_SIZE, ALL_SUPPORTED,
)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

router = APIRouter(prefix="/api/drafting", tags=["drafting"])


# ═══════════════════════════════════════════════════════════
# SCHEMAS
# ═══════════════════════════════════════════════════════════

class DraftCreateRequest(BaseModel):
    title: str
    case_id: Optional[str] = None
    document_type: str = "motion"
    content: Optional[str] = ""
    format_preset: Optional[str] = "standard"

class DraftUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    document_type: Optional[str] = None
    format_preset: Optional[str] = None
    word_count: Optional[int] = None
    page_count: Optional[int] = None

class DraftAutoSaveRequest(BaseModel):
    content: str
    word_count: Optional[int] = 0
    page_count: Optional[int] = 0

class DraftTransitionRequest(BaseModel):
    target_status: str
    notes: Optional[str] = None
    override_reason: Optional[str] = None

class CommentCreateRequest(BaseModel):
    content: str
    selection_start: Optional[int] = None
    selection_end: Optional[int] = None
    selected_text: Optional[str] = None

class ResearchSearchRequest(BaseModel):
    query: str
    jurisdiction: Optional[str] = None
    case_type: Optional[str] = None

class InsertCitationRequest(BaseModel):
    case_name: str
    citation: str
    court: Optional[str] = None
    year: Optional[int] = None
    good_law_status: str = "unknown"
    courtlistener_url: Optional[str] = None
    courtlistener_id: Optional[str] = None
    snippet: Optional[str] = None
    applicability_score: str = "medium"

class AITrimRequest(BaseModel):
    selected_text: Optional[str] = None
    target_reduction_percent: int = 20
    trim_engine: str = "rules"

class AIGenerateRequest(BaseModel):
    facts: str
    document_type: str = "motion"
    jurisdiction: Optional[str] = None
    court_name: Optional[str] = None
    case_type: Optional[str] = None
    party_names: Optional[str] = None
    additional_instructions: Optional[str] = None
    # Enhanced fields for smart intake
    parties: Optional[List[dict]] = None
    reliefs: Optional[List[str]] = None
    legal_basis: Optional[str] = None
    ai_style: Optional[str] = "standard"  # standard, aggressive, conservative
    ai_mode: Optional[str] = "court_ready"  # court_ready, draft_only
    filing_rule: Optional[str] = None
    district: Optional[str] = None
    division: Optional[str] = None
    location: Optional[str] = None
    state: Optional[str] = None
    case_number: Optional[str] = None
    in_the_matter_of: Optional[str] = None
    financial_data: Optional[dict] = None
    case_id: Optional[str] = None
    # Signature block fields
    filer_name: Optional[str] = None
    filer_title: Optional[str] = None
    filer_bar_number: Optional[str] = None
    filer_firm: Optional[str] = None
    filer_address: Optional[str] = None
    filer_phone: Optional[str] = None
    filer_email: Optional[str] = None
    incorporate_exhibits: Optional[bool] = None
    exhibits: Optional[List[dict]] = None


class AIAnalyzeFactsRequest(BaseModel):
    facts: str
    document_type: str = "motion"
    jurisdiction: Optional[str] = None
    uploaded_text: Optional[str] = None


class AIEditRequest(BaseModel):
    instruction: str
    current_content: str
    document_type: Optional[str] = None
    jurisdiction: Optional[str] = None
    court_name: Optional[str] = None


class AISuggestLawsRequest(BaseModel):
    facts: str
    jurisdiction: str = "US"
    document_type: str = "motion"
    case_type: Optional[str] = None


class TemplateUploadRequest(BaseModel):
    template_name: str
    jurisdiction_code: Optional[str] = None
    court_name: Optional[str] = None
    document_type: str = "motion"
    template_data: dict = {}

class AISuggestRequest(BaseModel):
    selected_text: Optional[str] = None
    mode: str = "strengthen"  # "strengthen" or "whats_missing"
    full_content: Optional[str] = None
    document_type: Optional[str] = None
    jurisdiction: Optional[str] = None

class AIAskRequest(BaseModel):
    question: str
    draft_content: Optional[str] = None
    selected_text: Optional[str] = None
    document_type: Optional[str] = None
    jurisdiction: Optional[str] = None
    court_name: Optional[str] = None

class AIVerifyRequest(BaseModel):
    content: Optional[str] = None
    document_type: Optional[str] = None
    jurisdiction: Optional[str] = None

class AIContinueRequest(BaseModel):
    content_before_cursor: str
    document_type: Optional[str] = None
    jurisdiction: Optional[str] = None
    court_name: Optional[str] = None
    facts_context: Optional[str] = None

class CourtRuleCreateRequest(BaseModel):
    jurisdiction_id: str
    court_name: str
    pleading_paper: bool = False
    default_font: str = "Times New Roman"
    font_size: int = 12
    line_spacing: float = 2.0
    margin_top: float = 1.0
    margin_bottom: float = 1.0
    margin_left: float = 1.0
    margin_right: float = 1.0
    doc_type_limits: Optional[dict] = None
    word_limit: Optional[int] = None
    caption_format: Optional[str] = None
    pleading_caption_template: Optional[str] = None
    requires_toc: bool = False
    toc_threshold_pages: int = 25
    requires_toa: bool = False
    toa_threshold_pages: int = 25
    requires_certificate_of_service: bool = True


# ═══════════════════════════════════════════════════════════
# COURT RULES
# ═══════════════════════════════════════════════════════════

@router.get("/court-rules")
async def list_court_rules(
    jurisdiction_id: Optional[str] = None,
    court_name: Optional[str] = None,
    user=Depends(get_current_user)
):
    """List all court rules, optionally filtered."""
    with get_db() as db:
        if jurisdiction_id:
            rules = db.execute(
                "SELECT * FROM court_rules WHERE jurisdiction_id = ?", (jurisdiction_id,)
            ).fetchall()
        elif court_name:
            rules = db.execute(
                "SELECT * FROM court_rules WHERE court_name LIKE ?", (f"%{court_name}%",)
            ).fetchall()
        else:
            rules = db.execute("SELECT * FROM court_rules ORDER BY court_name").fetchall()
        result = []
        for r in rules:
            d = dict(r)
            if isinstance(d.get("doc_type_limits"), str):
                d["doc_type_limits"] = json.loads(d["doc_type_limits"])
            if isinstance(d.get("additional_rules"), str):
                d["additional_rules"] = json.loads(d["additional_rules"])
            result.append(d)
        return result


@router.get("/court-rules/{rule_id}")
async def get_court_rule(rule_id: str, user=Depends(get_current_user)):
    """Get a specific court rule by ID."""
    with get_db() as db:
        rule = db.execute("SELECT * FROM court_rules WHERE id = ?", (rule_id,)).fetchone()
        if not rule:
            raise HTTPException(404, "Court rule not found")
        d = dict(rule)
        if isinstance(d.get("doc_type_limits"), str):
            d["doc_type_limits"] = json.loads(d["doc_type_limits"])
        if isinstance(d.get("additional_rules"), str):
            d["additional_rules"] = json.loads(d["additional_rules"])
        return d


@router.get("/court-rules/lookup/{court_name}")
async def lookup_court_rule(court_name: str, user=Depends(get_current_user)):
    """Lookup court rules by court name (fuzzy match). Used when opening a draft."""
    with get_db() as db:
        # Try exact match first
        rule = db.execute(
            "SELECT * FROM court_rules WHERE court_name = ?", (court_name,)
        ).fetchone()
        if not rule:
            # Fuzzy match
            rule = db.execute(
                "SELECT * FROM court_rules WHERE court_name LIKE ?", (f"%{court_name}%",)
            ).fetchone()
        if not rule:
            return {"found": False, "message": "Court rules not found. Manual entry required.", "rules": None}
        d = dict(rule)
        if isinstance(d.get("doc_type_limits"), str):
            d["doc_type_limits"] = json.loads(d["doc_type_limits"])
        if isinstance(d.get("additional_rules"), str):
            d["additional_rules"] = json.loads(d["additional_rules"])
        return {"found": True, "rules": d}


@router.post("/court-rules")
async def create_court_rule(data: CourtRuleCreateRequest, user=Depends(get_current_user)):
    """Create a new court rule (admin/attorney only for manual entry)."""
    if user["role"] not in ("admin", "attorney"):
        raise HTTPException(403, "Only admin or attorney can create court rules")
    rule_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        db.execute(
            """INSERT INTO court_rules (id, jurisdiction_id, court_name, pleading_paper, default_font,
               font_size, line_spacing, margin_top, margin_bottom, margin_left, margin_right,
               doc_type_limits, word_limit, caption_format, pleading_caption_template,
               requires_toc, toc_threshold_pages, requires_toa, toa_threshold_pages,
               requires_certificate_of_service, is_verified)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (rule_id, data.jurisdiction_id, data.court_name, int(data.pleading_paper),
             data.default_font, data.font_size, data.line_spacing,
             data.margin_top, data.margin_bottom, data.margin_left, data.margin_right,
             json.dumps(data.doc_type_limits or {}), data.word_limit,
             data.caption_format, data.pleading_caption_template,
             int(data.requires_toc), data.toc_threshold_pages,
             int(data.requires_toa), data.toa_threshold_pages,
             int(data.requires_certificate_of_service))
        )
    return {"id": rule_id, "message": "Court rule created"}


# ═══════════════════════════════════════════════════════════
# ENHANCED DRAFTS (replaces old simple CRUD)
# ═══════════════════════════════════════════════════════════

@router.get("/drafts")
async def list_drafts(
    case_id: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user)
):
    """List drafts with optional filters."""
    with get_db() as db:
        query = "SELECT * FROM legal_drafts WHERE tenant_id = ?"
        params: list = [user["tenant_id"]]
        if case_id:
            query += " AND case_id = ?"
            params.append(case_id)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY updated_at DESC"
        drafts = db.execute(query, params).fetchall()
        return [dict(r) for r in drafts]


@router.post("/drafts")
async def create_draft(data: DraftCreateRequest, user=Depends(get_current_user)):
    """Create a new draft. Auto-applies court rules from case metadata."""
    draft_id = str(uuid.uuid4())[:12]
    jurisdiction_id = None
    court_name_val = None
    page_limit = None
    word_limit_val = None

    # Auto-lookup court rules from case metadata
    if data.case_id:
        with get_db() as db:
            case_row = db.execute(
                "SELECT court, case_type FROM cases WHERE id = ? AND tenant_id = ?",
                (data.case_id, user["tenant_id"])
            ).fetchone()
            if case_row and case_row["court"]:
                court_name_val = case_row["court"]
                rule = db.execute(
                    "SELECT * FROM court_rules WHERE court_name LIKE ?",
                    (f"%{case_row['court']}%",)
                ).fetchone()
                if rule:
                    jurisdiction_id = rule["jurisdiction_id"]
                    court_name_val = rule["court_name"]
                    # Get limits for the document type
                    doc_limits = json.loads(rule["doc_type_limits"]) if rule["doc_type_limits"] else {}
                    doc_type_key = data.document_type.lower()
                    if doc_type_key in doc_limits:
                        limits = doc_limits[doc_type_key]
                        page_limit = limits.get("pages")
                        word_limit_val = limits.get("words") or rule["word_limit"]
                    elif rule["word_limit"]:
                        word_limit_val = rule["word_limit"]

    with get_db() as db:
        db.execute(
            """INSERT INTO legal_drafts (id, case_id, tenant_id, title, content, format_preset,
               document_type, status, jurisdiction_id, court_name, page_limit, word_limit_value,
               version, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 1, ?)""",
            (draft_id, data.case_id, user["tenant_id"], data.title, data.content or "",
             data.format_preset, data.document_type, jurisdiction_id, court_name_val,
             page_limit, word_limit_val, user["sub"])
        )
        # Create initial version
        ver_id = str(uuid.uuid4())[:12]
        db.execute(
            """INSERT INTO draft_versions (id, draft_id, version, content, word_count, change_summary, created_by)
               VALUES (?, ?, 1, ?, 0, 'Initial draft created', ?)""",
            (ver_id, draft_id, data.content or "", user["sub"])
        )
    return {"id": draft_id, "message": "Draft created", "jurisdiction_id": jurisdiction_id, "court_name": court_name_val}


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: str, user=Depends(get_current_user)):
    """Get a draft with its court rules and metadata."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")
        result = dict(draft)

        # Attach court rules if jurisdiction exists
        if result.get("jurisdiction_id"):
            rule = db.execute(
                "SELECT * FROM court_rules WHERE jurisdiction_id = ?",
                (result["jurisdiction_id"],)
            ).fetchone()
            if rule:
                rule_dict = dict(rule)
                if isinstance(rule_dict.get("doc_type_limits"), str):
                    rule_dict["doc_type_limits"] = json.loads(rule_dict["doc_type_limits"])
                if isinstance(rule_dict.get("additional_rules"), str):
                    rule_dict["additional_rules"] = json.loads(rule_dict["additional_rules"])
                result["court_rules"] = rule_dict
            else:
                result["court_rules"] = None
        else:
            result["court_rules"] = None

        # Attach comments
        comments = db.execute(
            "SELECT dc.*, u.full_name as author_name FROM draft_comments dc LEFT JOIN users u ON dc.user_id = u.id WHERE dc.draft_id = ? ORDER BY dc.created_at ASC",
            (draft_id,)
        ).fetchall()
        result["comments"] = [dict(c) for c in comments]

        # Parse override_log
        if isinstance(result.get("override_log"), str):
            try:
                result["override_log"] = json.loads(result["override_log"])
            except (json.JSONDecodeError, TypeError):
                result["override_log"] = []

        return result


@router.patch("/drafts/{draft_id}")
async def update_draft(draft_id: str, data: DraftUpdateRequest, user=Depends(get_current_user)):
    """Update draft fields (title, content, document_type, etc.)."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        # Check if draft is editable
        if draft["status"] in ("finalized", "served_filed"):
            raise HTTPException(403, "Cannot edit a finalized or filed document")

        updates = {}
        if data.title is not None:
            updates["title"] = data.title
        if data.content is not None:
            updates["content"] = data.content
        if data.document_type is not None:
            updates["document_type"] = data.document_type
            # Re-lookup limits if document type changed
            if draft["jurisdiction_id"]:
                rule = db.execute(
                    "SELECT doc_type_limits, word_limit FROM court_rules WHERE jurisdiction_id = ?",
                    (draft["jurisdiction_id"],)
                ).fetchone()
                if rule:
                    doc_limits = json.loads(rule["doc_type_limits"]) if rule["doc_type_limits"] else {}
                    dt_key = data.document_type.lower()
                    if dt_key in doc_limits:
                        updates["page_limit"] = doc_limits[dt_key].get("pages")
                        updates["word_limit_value"] = doc_limits[dt_key].get("words") or rule["word_limit"]
        if data.format_preset is not None:
            updates["format_preset"] = data.format_preset
        if data.word_count is not None:
            updates["word_count"] = data.word_count
        if data.page_count is not None:
            updates["page_count"] = data.page_count

        if not updates:
            raise HTTPException(400, "No fields to update")

        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [draft_id, user["tenant_id"]]
        db.execute(f"UPDATE legal_drafts SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Draft updated"}


@router.post("/drafts/{draft_id}/autosave")
async def autosave_draft(draft_id: str, data: DraftAutoSaveRequest, user=Depends(get_current_user)):
    """Auto-save endpoint (called every 30 seconds from frontend)."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id, status FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")
        if draft["status"] in ("finalized", "served_filed"):
            raise HTTPException(403, "Cannot edit a finalized document")

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE legal_drafts SET content = ?, word_count = ?, page_count = ?, last_auto_save = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
            (data.content, data.word_count, data.page_count, now, now, draft_id, user["tenant_id"])
        )
    return {"message": "Auto-saved", "timestamp": now}


@router.post("/drafts/{draft_id}/save-version")
async def save_version(draft_id: str, change_summary: str = "Manual save", user=Depends(get_current_user)):
    """Save a new version snapshot (on manual save)."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        new_version = (draft["version"] or 1) + 1
        ver_id = str(uuid.uuid4())[:12]

        # Count words
        text_content = _strip_html(draft["content"] or "")
        word_count = len(text_content.split()) if text_content.strip() else 0

        db.execute(
            """INSERT INTO draft_versions (id, draft_id, version, content, word_count, change_summary, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ver_id, draft_id, new_version, draft["content"], word_count, change_summary, user["sub"])
        )
        db.execute(
            "UPDATE legal_drafts SET version = ?, word_count = ?, updated_at = ? WHERE id = ?",
            (new_version, word_count, datetime.now(timezone.utc).isoformat(), draft_id)
        )
    return {"version": new_version, "version_id": ver_id, "word_count": word_count}


@router.get("/drafts/{draft_id}/versions")
async def list_versions(draft_id: str, user=Depends(get_current_user)):
    """List all version snapshots for a draft."""
    with get_db() as db:
        # Verify access
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        versions = db.execute(
            "SELECT dv.*, u.full_name as author_name FROM draft_versions dv LEFT JOIN users u ON dv.created_by = u.id WHERE dv.draft_id = ? ORDER BY dv.version DESC",
            (draft_id,)
        ).fetchall()
        return [dict(v) for v in versions]


@router.get("/drafts/{draft_id}/versions/{version_id}")
async def get_version(draft_id: str, version_id: str, user=Depends(get_current_user)):
    """Get a specific version's content."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        version = db.execute(
            "SELECT * FROM draft_versions WHERE id = ? AND draft_id = ?",
            (version_id, draft_id)
        ).fetchone()
        if not version:
            raise HTTPException(404, "Version not found")
        return dict(version)


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, user=Depends(get_current_user)):
    """Delete a draft and all associated data."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id, status FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")
        if draft["status"] in ("finalized", "served_filed"):
            raise HTTPException(403, "Cannot delete a finalized or filed document")

        db.execute("DELETE FROM draft_versions WHERE draft_id = ?", (draft_id,))
        db.execute("DELETE FROM draft_comments WHERE draft_id = ?", (draft_id,))
        db.execute("DELETE FROM research_citations WHERE draft_id = ?", (draft_id,))
        db.execute("DELETE FROM legal_drafts WHERE id = ?", (draft_id,))
    return {"message": "Draft deleted"}


# ═══════════════════════════════════════════════════════════
# LIFECYCLE / STATE MACHINE
# ═══════════════════════════════════════════════════════════

VALID_TRANSITIONS = {
    "draft": ["internal_review"],
    "internal_review": ["draft", "pending_fixes", "client_review"],
    "pending_fixes": ["draft", "internal_review"],
    "client_review": ["approved", "internal_review"],
    "approved": ["finalized", "internal_review"],
    "finalized": ["served_filed"],
    "served_filed": [],
}

ATTORNEY_ONLY_TARGETS = {"client_review", "approved", "finalized", "served_filed"}

@router.post("/drafts/{draft_id}/transition")
async def transition_draft(draft_id: str, data: DraftTransitionRequest, user=Depends(get_current_user)):
    """Transition a draft through the lifecycle state machine."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        current = draft["status"] or "draft"
        target = data.target_status

        # Validate transition
        if target not in VALID_TRANSITIONS.get(current, []):
            raise HTTPException(400, f"Cannot transition from '{current}' to '{target}'")

        # Permission check
        if target in ATTORNEY_ONLY_TARGETS and user["role"] not in ("attorney", "admin"):
            raise HTTPException(403, f"Only attorney or admin can advance to '{target}'")

        updates = {"status": target, "updated_at": datetime.now(timezone.utc).isoformat()}

        # Handle specific transitions
        if target == "client_review":
            token = secrets.token_urlsafe(32)
            expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            updates["client_review_token"] = token
            updates["client_review_expires"] = expires

        if target == "approved":
            updates["signed_at"] = datetime.now(timezone.utc).isoformat()

        if target == "finalized":
            # Check sentinel limits (page/word) unless attorney override
            word_count = draft["word_count"] or 0
            word_limit = draft["word_limit_value"]
            page_limit = draft["page_limit"]
            page_count = draft["page_count"] or 0

            over_limit = False
            if word_limit and word_count > word_limit:
                over_limit = True
            if page_limit and page_count > page_limit:
                over_limit = True

            if over_limit and not data.override_reason:
                raise HTTPException(
                    400,
                    f"Document exceeds limits (words: {word_count}/{word_limit}, pages: {page_count}/{page_limit}). "
                    "Provide override_reason to proceed."
                )

            if over_limit and data.override_reason:
                override_log = json.loads(draft["override_log"] or "[]")
                override_log.append({
                    "user_id": user["sub"],
                    "user_role": user["role"],
                    "action": "finalize_override",
                    "reason": data.override_reason,
                    "word_count": word_count,
                    "word_limit": word_limit,
                    "page_count": page_count,
                    "page_limit": page_limit,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })
                updates["override_log"] = json.dumps(override_log)

            updates["finalized_at"] = datetime.now(timezone.utc).isoformat()

        if target == "served_filed":
            updates["filed_at"] = datetime.now(timezone.utc).isoformat()

        if target == "pending_fixes":
            updates["assigned_reviewer"] = user["sub"]

        # Log audit
        audit_id = str(uuid.uuid4())[:12]
        db.execute(
            """INSERT INTO audit_log (id, tenant_id, user_id, action, entity_type, entity_id, details)
               VALUES (?, ?, ?, ?, 'draft', ?, ?)""",
            (audit_id, user["tenant_id"], user["sub"],
             f"transition_{current}_to_{target}", draft_id,
             json.dumps({"notes": data.notes, "override_reason": data.override_reason}))
        )

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [draft_id, user["tenant_id"]]
        db.execute(f"UPDATE legal_drafts SET {set_clause} WHERE id = ? AND tenant_id = ?", values)

    return {
        "message": f"Draft transitioned to '{target}'",
        "new_status": target,
        "client_review_token": updates.get("client_review_token")
    }


# ═══════════════════════════════════════════════════════════
# SENTINEL VALIDATOR
# ═══════════════════════════════════════════════════════════

@router.get("/drafts/{draft_id}/sentinel")
async def check_sentinel(draft_id: str, user=Depends(get_current_user)):
    """Check page/word limits for a draft. Returns sentinel status."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        word_count = draft["word_count"] or 0
        page_count = draft["page_count"] or 0
        word_limit = draft["word_limit_value"]
        page_limit = draft["page_limit"]

        # Determine status
        status = "green"
        messages = []

        if word_limit:
            word_pct = word_count / word_limit if word_limit > 0 else 0
            if word_count > word_limit:
                status = "red"
                messages.append(f"Over word limit: {word_count}/{word_limit} words")
            elif word_pct >= 0.9:
                status = "yellow" if status != "red" else "red"
                messages.append(f"Approaching word limit: {word_count}/{word_limit} words ({int(word_pct*100)}%)")

        if page_limit:
            pages_remaining = page_limit - page_count
            if page_count > page_limit:
                status = "red"
                messages.append(f"Over page limit: {page_count}/{page_limit} pages")
            elif pages_remaining <= 3:
                status = "yellow" if status != "red" else "red"
                messages.append(f"Approaching page limit: {page_count}/{page_limit} pages ({pages_remaining} remaining)")

        if not word_limit and not page_limit:
            messages.append("No page/word limits configured for this court and document type")
            status = "unknown"

        # Estimate pages from word count
        estimated_pages = max(1, round(word_count / 250)) if word_count > 0 else 0

        return {
            "status": status,
            "word_count": word_count,
            "word_limit": word_limit,
            "page_count": page_count,
            "page_limit": page_limit,
            "estimated_pages": estimated_pages,
            "messages": messages,
            "can_finalize": status != "red"
        }


# ═══════════════════════════════════════════════════════════
# AI TRIM SERVICE
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/trim")
async def ai_trim(draft_id: str, data: AITrimRequest, user=Depends(get_current_user)):
    """AI-powered text trimming. Preserves citations and legal meaning."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    text_to_trim = data.selected_text or draft["content"] or ""
    if not text_to_trim.strip():
        raise HTTPException(400, "No text to trim")

    if data.trim_engine == "ai" and OPENAI_API_KEY:
        trimmed = await _ai_trim_text(text_to_trim, data.target_reduction_percent)
    else:
        trimmed = _rule_based_trim(text_to_trim, data.target_reduction_percent)

    original_words = len(_strip_html(text_to_trim).split())
    trimmed_words = len(_strip_html(trimmed).split())

    return {
        "original_text": text_to_trim,
        "trimmed_text": trimmed,
        "original_word_count": original_words,
        "trimmed_word_count": trimmed_words,
        "reduction_percent": round((1 - trimmed_words / max(original_words, 1)) * 100, 1),
        "engine_used": data.trim_engine
    }


def _rule_based_trim(text: str, target_percent: int) -> str:
    """Rule-based text compression. Preserves citations."""
    # Protect citations (patterns like "Smith v. Jones, 123 F.3d 456 (9th Cir. 2020)")
    citation_pattern = r'(\b\w+\s+v\.\s+\w+[\w\s,]*\d+\s+\w+\.?\s*\d*[a-z]*\s*\d*\s*\([^)]+\))'
    citations = re.findall(citation_pattern, text)
    placeholders = {}
    for i, cite in enumerate(citations):
        ph = f"__CITE_{i}__"
        placeholders[ph] = cite
        text = text.replace(cite, ph, 1)

    # Rule-based compression techniques
    # 1. Remove redundant phrases
    redundant = [
        (r'\bit is clear that\b', ''),
        (r'\bit should be noted that\b', ''),
        (r'\bit is important to note that\b', ''),
        (r'\bin order to\b', 'to'),
        (r'\bfor the purpose of\b', 'to'),
        (r'\bwith respect to\b', 'regarding'),
        (r'\bin the event that\b', 'if'),
        (r'\bat this point in time\b', 'now'),
        (r'\bin light of the fact that\b', 'because'),
        (r'\bdue to the fact that\b', 'because'),
        (r'\bnotwithstanding the fact that\b', 'although'),
        (r'\bit is worth mentioning that\b', ''),
        (r'\bas a matter of fact\b', ''),
        (r'\bthe fact that\b', 'that'),
        (r'\bin the instant case\b', 'here'),
        (r'\bin the case at bar\b', 'here'),
        (r'\bthe court finds that\b', ''),
        (r'\bit is well established that\b', ''),
        (r'\bas previously stated\b', ''),
        (r'\bas mentioned above\b', ''),
    ]
    for pattern, replacement in redundant:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    # 2. Tighten double spaces
    text = re.sub(r'  +', ' ', text)
    text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)

    # 3. Remove trailing commas before periods
    text = re.sub(r',\s*\.', '.', text)

    # Restore citations
    for ph, cite in placeholders.items():
        text = text.replace(ph, cite)

    return text.strip()


def _strip_html(text: str) -> str:
    """Remove HTML tags from text for word counting."""
    clean = re.sub(r'<[^>]+>', '', text)
    clean = html.unescape(clean)
    return clean


async def _call_ai(system_prompt: str, user_message: str, max_tokens: int = 8000, temperature: float = 0.3) -> str:
    """Call Claude API (primary) for legal drafting. Raises HTTPException on failure."""
    try:
        return await call_claude(system_prompt, user_message, max_tokens, temperature)
    except RuntimeError as e:
        raise HTTPException(502, f"AI service error: {e}")


async def _call_ai_json(system_prompt: str, user_message: str, max_tokens: int = 8000, temperature: float = 0.2) -> dict:
    """Call Claude API and parse JSON response."""
    try:
        return await call_claude_json(system_prompt, user_message, max_tokens, temperature)
    except RuntimeError as e:
        raise HTTPException(502, f"AI service error: {e}")


# Jurisdiction language mapping
JURISDICTION_LANGUAGE = {
    "US": "American English", "UK": "British English", "UG": "British English",
    "NG": "British English", "KE": "British English", "IN": "British English",
    "ZA": "British English", "GH": "British English", "CA": "Canadian English",
    "AU": "Australian English", "HK": "British English", "IE": "British English",
}

# Document type section structures per jurisdiction family
DOC_STRUCTURES = {
    "petition": {
        "common_law_africa": ["HEADING AND CAPTION", "INTRODUCTION", "JURISDICTION AND STANDING", "STATEMENT OF FACTS", "GROUNDS OF THE PETITION", "LEGAL ARGUMENTS", "PRAYERS/RELIEFS SOUGHT", "VERIFICATION/DECLARATION"],
        "us": ["CAPTION", "INTRODUCTION", "JURISDICTION AND VENUE", "PARTIES", "STATEMENT OF FACTS", "CLAIMS FOR RELIEF", "PRAYER FOR RELIEF", "VERIFICATION"],
        "uk": ["HEADING", "INTRODUCTION", "PARTIES", "FACTS", "GROUNDS", "RELIEF SOUGHT", "STATEMENT OF TRUTH"],
        "default": ["HEADING", "INTRODUCTION", "JURISDICTION", "FACTS", "LEGAL GROUNDS", "RELIEF SOUGHT", "VERIFICATION"],
    },
    "motion": {
        "us": ["CAPTION", "INTRODUCTION", "STATEMENT OF RELEVANT FACTS", "LEGAL STANDARD", "ARGUMENT", "CONCLUSION", "CERTIFICATE OF SERVICE"],
        "uk": ["HEADING", "INTRODUCTION", "BACKGROUND", "GROUNDS", "SUBMISSIONS", "RELIEF SOUGHT"],
        "common_law_africa": ["HEADING AND CAPTION", "INTRODUCTION", "FACTUAL BACKGROUND", "LEGAL GROUNDS", "ARGUMENT", "ORDERS SOUGHT"],
        "default": ["HEADING", "INTRODUCTION", "FACTS", "LEGAL ARGUMENT", "RELIEF SOUGHT"],
    },
    "brief": {
        "us": ["CAPTION", "TABLE OF CONTENTS", "TABLE OF AUTHORITIES", "STATEMENT OF ISSUES", "STATEMENT OF THE CASE", "STATEMENT OF FACTS", "SUMMARY OF ARGUMENT", "ARGUMENT", "CONCLUSION", "CERTIFICATE OF SERVICE"],
        "uk": ["HEADING", "INTRODUCTION", "ISSUES", "FACTUAL BACKGROUND", "LEGAL FRAMEWORK", "SUBMISSIONS", "CONCLUSION"],
        "default": ["HEADING", "INTRODUCTION", "ISSUES", "FACTS", "ARGUMENTS", "CONCLUSION"],
    },
    "complaint": {
        "us": ["CAPTION", "INTRODUCTION", "JURISDICTION AND VENUE", "PARTIES", "FACTUAL ALLEGATIONS", "CAUSES OF ACTION", "PRAYER FOR RELIEF", "JURY DEMAND"],
        "uk": ["HEADING", "PARTIES", "FACTS", "PARTICULARS OF CLAIM", "RELIEF SOUGHT", "STATEMENT OF TRUTH"],
        "common_law_africa": ["HEADING AND CAPTION", "PARTIES", "FACTUAL BACKGROUND", "CAUSE OF ACTION", "PARTICULARS OF CLAIM", "RELIEFS SOUGHT", "VERIFICATION"],
        "default": ["HEADING", "PARTIES", "FACTS", "CLAIMS", "RELIEF SOUGHT"],
    },
    "statement_of_claim": {
        "us": ["CAPTION", "PRELIMINARY STATEMENT", "JURISDICTION AND VENUE", "PARTIES", "FACTUAL ALLEGATIONS", "CAUSES OF ACTION", "PRAYER FOR RELIEF", "JURY DEMAND"],
        "uk": ["HEADING", "PARTIES", "FACTS", "PARTICULARS OF CLAIM", "RELIEF SOUGHT", "STATEMENT OF TRUTH"],
        "common_law_africa": ["HEADING AND CAPTION", "PARTIES", "FACTUAL BACKGROUND", "CAUSE OF ACTION", "PARTICULARS OF CLAIM", "RELIEFS SOUGHT", "VERIFICATION"],
        "default": ["HEADING", "PARTIES", "FACTS", "CLAIMS", "RELIEF SOUGHT"],
    },
    "demand_for_arbitration": {
        "us": ["CAPTION", "PRELIMINARY STATEMENT", "THE PARTIES", "ARBITRATION AGREEMENT AND GOVERNING RULES", "FACTUAL BACKGROUND", "CLAIMS AND LEGAL BASIS", "DAMAGES AND RELIEF SOUGHT", "PRAYER FOR RELIEF"],
        "default": ["HEADING", "INTRODUCTION", "THE PARTIES", "ARBITRATION CLAUSE", "FACTS", "CLAIMS", "RELIEF SOUGHT"],
    },
    "response": {
        "us": ["CAPTION", "INTRODUCTION", "STATEMENT OF FACTS", "ARGUMENT IN OPPOSITION", "CONCLUSION"],
        "default": ["HEADING", "INTRODUCTION", "RESPONSE TO FACTS", "LEGAL ARGUMENTS", "CONCLUSION"],
    },
    "reply": {
        "us": ["CAPTION", "INTRODUCTION", "REPLY TO OPPOSITION ARGUMENTS", "CONCLUSION"],
        "default": ["HEADING", "REPLY ARGUMENTS", "CONCLUSION"],
    },
    "affidavit": {
        "common_law_africa": ["HEADING AND CAPTION", "DEPONENT DETAILS", "FACTS WITHIN KNOWLEDGE", "SUPPORTING EVIDENCE", "VERIFICATION/OATH"],
        "us": ["CAPTION", "AFFIANT IDENTIFICATION", "FACTUAL STATEMENTS", "VERIFICATION UNDER PENALTY OF PERJURY"],
        "default": ["HEADING", "DEPONENT DETAILS", "FACTS", "VERIFICATION"],
    },
    "memorandum_of_law": {
        "us": ["CAPTION", "PRELIMINARY STATEMENT", "STATEMENT OF FACTS", "LEGAL STANDARD", "ARGUMENT", "CONCLUSION"],
        "default": ["HEADING", "INTRODUCTION", "FACTS", "LEGAL FRAMEWORK", "ARGUMENT", "CONCLUSION"],
    },
    "summary_judgment": {
        "us": ["CAPTION", "INTRODUCTION", "STATEMENT OF UNDISPUTED MATERIAL FACTS", "LEGAL STANDARD", "ARGUMENT", "CONCLUSION", "CERTIFICATE OF SERVICE"],
        "default": ["HEADING", "INTRODUCTION", "UNDISPUTED FACTS", "LEGAL STANDARD", "ARGUMENT", "CONCLUSION"],
    },
    "injunction": {
        "us": ["CAPTION", "INTRODUCTION", "PARTIES", "FACTUAL BACKGROUND", "LEGAL STANDARD FOR INJUNCTIVE RELIEF", "ARGUMENT", "PRAYER FOR INJUNCTIVE RELIEF"],
        "default": ["HEADING", "INTRODUCTION", "FACTS", "LEGAL BASIS", "RELIEF SOUGHT"],
    },
    "discovery": {
        "us": ["CAPTION", "PRELIMINARY STATEMENT", "DEFINITIONS", "INSTRUCTIONS", "INTERROGATORIES", "REQUESTS FOR PRODUCTION", "REQUESTS FOR ADMISSION"],
        "default": ["HEADING", "DEFINITIONS", "REQUESTS"],
    },
}

def _get_jurisdiction_family(jurisdiction: str) -> str:
    """Map jurisdiction code to family for section structures."""
    if not jurisdiction:
        return "default"
    j = jurisdiction.upper()
    if j == "US":
        return "us"
    if j == "UK":
        return "uk"
    if j in ("UG", "NG", "KE", "GH", "ZA"):
        return "common_law_africa"
    return "default"


def _get_sections(doc_type: str, jurisdiction: str) -> list:
    """Get section headings for a document type + jurisdiction."""
    family = _get_jurisdiction_family(jurisdiction)
    type_map = DOC_STRUCTURES.get(doc_type.lower(), DOC_STRUCTURES.get("motion", {}))
    return type_map.get(family, type_map.get("default", ["HEADING", "INTRODUCTION", "FACTS", "ARGUMENTS", "CONCLUSION"]))


async def _ai_trim_text(text: str, target_percent: int) -> str:
    """Use Claude to intelligently trim legal text."""
    system_prompt = "You are an expert legal editor. Your task is to tighten legal prose while preserving all citations, legal arguments, statutory references, and legal meaning. Maintain the same tone and formality. Return ONLY the trimmed text with no commentary."
    user_message = f"Reduce the following legal text by approximately {target_percent}%. Preserve all case citations, statutory references, and core legal arguments. Remove redundancy, tighten phrasing, and eliminate filler without changing meaning.\n\nText to trim:\n{text}"
    return await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.2)


# ═══════════════════════════════════════════════════════════
# AI GENERATE FIRST DRAFT
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/ai-generate")
async def ai_generate_draft(draft_id: str, data: AIGenerateRequest, user=Depends(get_current_user)):
    """Generate a full first draft using Claude API with caption engine integration.

    Flow:
    1. Caption Engine generates the court-compliant header (system-generated, never AI)
    2. Claude generates the document body starting from INTRODUCTION
    3. Financial tokens are substituted programmatically
    4. Caption + Body are assembled into the final document
    """
    provider = get_ai_provider()
    if provider == "none":
        raise HTTPException(500, "No AI provider configured. Set ANTHROPIC_API_KEY.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    # Get court rules if available
    court_rules_info = ""
    if data.court_name:
        with get_db() as db:
            rule = db.execute(
                "SELECT * FROM court_rules WHERE court_name LIKE ?",
                (f"%{data.court_name}%",)
            ).fetchone()
            if rule:
                rule_d = dict(rule)
                court_rules_info = f"""Court formatting rules:
- Font: {rule_d['default_font']} {rule_d['font_size']}pt
- Line spacing: {rule_d['line_spacing']}
- Margins: {rule_d['margin_top']}" top, {rule_d['margin_bottom']}" bottom, {rule_d['margin_left']}" left, {rule_d['margin_right']}" right
- Requires Table of Contents: {'Yes' if rule_d.get('requires_toc') else 'No'}
- Requires Table of Authorities: {'Yes' if rule_d.get('requires_toa') else 'No'}
- Requires Certificate of Service: {'Yes' if rule_d.get('requires_certificate_of_service') else 'No'}"""

    lang = JURISDICTION_LANGUAGE.get((data.jurisdiction or "US").upper(), "English")
    sections = _get_sections(data.document_type, data.jurisdiction)
    # Remove CAPTION/HEADING from sections — caption is system-generated
    body_sections = [s for s in sections if s.upper() not in ("CAPTION", "HEADING", "HEADING AND CAPTION")]
    sections_str = "\n".join(f"- {s}" for s in body_sections)

    # Build parties string for prompt
    parties_str = data.party_names or ""
    if data.parties and not parties_str:
        parties_str = "; ".join(f"{p.get('name', '')} ({p.get('role', '')})" for p in data.parties)

    # Build reliefs string
    reliefs_str = ""
    if data.reliefs:
        reliefs_str = f"\nReliefs sought: {', '.join(data.reliefs)}"

    # Build legal basis string
    legal_basis_str = ""
    if data.legal_basis:
        legal_basis_str = f"\nLegal basis / statutes: {data.legal_basis}"

    # Filing rule
    filing_rule_str = ""
    if data.filing_rule:
        filing_rule_str = f"\nFiling rule: {data.filing_rule}"

    # AI style instructions
    style_instructions = {
        "standard": "Write in a balanced, professional legal tone.",
        "aggressive": "Write with maximum persuasive force. Use assertive language, strong authority citations, and leave no room for opposing arguments.",
        "conservative": "Write cautiously and conservatively. Hedge appropriately, acknowledge counterarguments, and maintain measured tone.",
    }
    style_note = style_instructions.get(data.ai_style or "standard", style_instructions["standard"])

    # Financial token instructions
    financial_note = ""
    if data.financial_data:
        financial_note = """
CRITICAL: For any monetary amounts, interest calculations, or damages figures, use these exact placeholder tokens:
{{PRINCIPAL}}, {{TOTAL_INTEREST}}, {{TOTAL_DUE}}, {{MONTHLY_AMOUNT}}, {{FULL_MONTHS}}, {{REMAINING_DAYS}}, {{DAILY_RATE}}, {{TRIGGER_DATE}}, {{CALC_DATE}}, {{TOTAL_DAMAGES}}
These will be replaced with programmatically computed values. NEVER invent financial figures."""

    # Build analyzed documents context if available
    analyzed_docs_str = ""
    if data.additional_instructions and "ANALYZED DOCUMENTS:" in data.additional_instructions:
        analyzed_docs_str = data.additional_instructions
        data.additional_instructions = ""

    system_prompt = f"""You are a senior litigation attorney with 25+ years of experience drafting court filings in {data.jurisdiction or 'United States'} jurisdictions. You produce COURT-READY legal documents that comply with all applicable rules of civil procedure, local court rules, and substantive law.

{style_note}

YOU MUST FOLLOW THESE MANDATORY DRAFTING RULES:

1. LANGUAGE: Write in {lang}. Use precise, formal legal terminology appropriate for the jurisdiction and court. NEVER use generic or colloquial language.

2. CAPTION/HEADING: DO NOT generate any document caption, heading, court name, case number, or party listing at the top. The caption is generated separately by the system. Start your output directly with the first substantive section.

3. CAUSES OF ACTION: Analyze the facts and identify ALL viable causes of action. Each cause of action MUST be a separately numbered COUNT with its own heading.

4. GOVERNING LAW: Every cause of action MUST cite the specific governing statute, rule, or established case law. If uncertain about a specific statute number, use the correct statute NAME and mark the number as [VERIFY STATUTE].

5. ELEMENTS OF EACH CLAIM: For each cause of action, state the legal elements, allege specific facts satisfying EACH element, cite the governing authority, and tie allegations to specific parties.

6. PRAYER FOR RELIEF: Include a separately numbered paragraph for EACH cause of action, plus compensatory damages, consequential damages, pre/post-judgment interest (citing the applicable statute), punitive damages where supported, attorney's fees, and equitable relief where applicable.

7. INTEREST CALCULATIONS: If the facts involve contracts with interest provisions, include a detailed interest calculation in an HTML table with styled borders and clear columns.

8. FACTUAL ALLEGATIONS: Write detailed, numbered paragraphs. Each paragraph should contain ONE factual allegation. Reference ALL relevant documents and evidence.

9. STRUCTURE: Use HTML format — <h2> for main sections, <h3> for COUNT sub-headings, <p> for paragraphs, <ol>/<li> for lists, <strong> for emphasis, <em> for case names, <blockquote> for quoted provisions, <table> for calculations.

10. COMPLETENESS: Minimum 20+ numbered factual allegations, ALL viable causes of action (minimum 3-5 counts), each count 3+ paragraphs, prayer matching every count.

11. NO FABRICATION: Never fabricate case citations. Mark uncertain citations as [VERIFY CITATION].

12. OUTPUT: Output ONLY the document body HTML. No commentary, no code fences.
{financial_note}"""

    user_prompt = f"""Draft the COMPLETE BODY of a {data.document_type.upper().replace('_', ' ')} to be filed in:

Jurisdiction: {data.jurisdiction or 'United States'}
Court: {data.court_name or 'Not specified'}
Case Type: {data.case_type or 'General Civil'}
Parties: {parties_str or 'Not specified'}
{reliefs_str}
{legal_basis_str}
{filing_rule_str}

Required document sections (generate each with the exact heading as <h2>):
{sections_str}

IMPORTANT: Within the CAUSES OF ACTION section, create separately numbered COUNTs for EVERY viable cause of action supported by the facts. Analyze the facts and identify ALL legally viable claims.

{court_rules_info}

STATEMENT OF FACTS / FACTUAL BASIS:
{data.facts}

{analyzed_docs_str}

{('ADDITIONAL INSTRUCTIONS FROM FILER: ' + data.additional_instructions) if data.additional_instructions else ''}

REMINDER:
- Do NOT generate any caption or heading — start directly with the first section.
- Every COUNT must cite its governing statute, rule, or case law.
- The Prayer for Relief must have a separate paragraph for each COUNT.
- Use precise legal terminology — never generic language.
- Number every factual allegation paragraph.
- This document must be ready for filing — not a skeleton or outline.

Generate the complete document body now."""

    generated_body = await _call_ai(system_prompt, user_prompt, max_tokens=16000, temperature=0.3)

    # Strip markdown code fences
    generated_body = re.sub(r'^```(?:html)?\s*\n?', '', generated_body.strip())
    generated_body = re.sub(r'\n?```\s*$', '', generated_body.strip())

    # Substitute financial tokens if financial data provided
    if data.financial_data:
        try:
            fin = calculate_simple_interest(
                principal=data.financial_data.get("principal", 0),
                monthly_rate=data.financial_data.get("monthly_rate", 0),
                trigger_date=data.financial_data.get("trigger_date", ""),
                calc_date=data.financial_data.get("calc_date", ""),
            )
            generated_body = substitute_financial_tokens(generated_body, fin)
        except Exception:
            pass  # If financial calc fails, leave tokens as-is for manual fill

    # Generate caption using Caption Engine (system-generated, never AI)
    caption_html = ""
    if data.parties or data.jurisdiction:
        caption_html = generate_caption_html(
            jurisdiction=data.jurisdiction or "US",
            court_name=data.court_name or "",
            court_level=data.court_name or "",
            division=data.division or "",
            location=data.location or "",
            district=data.district or "",
            state=data.state or "",
            parties=data.parties or [],
            case_number=data.case_number or "",
            document_type=data.document_type,
            document_title=draft["title"],
            in_the_matter_of=data.in_the_matter_of or "",
        )

    # Combine caption + body
    full_content = caption_html + "\n" + generated_body if caption_html else generated_body

    # Update the draft
    word_count = len(_strip_html(generated_body).split())
    page_count = max(1, word_count // 250)

    with get_db() as db:
        db.execute(
            """UPDATE legal_drafts SET content = ?, word_count = ?, page_count = ?,
               caption_html = ?, body_sections_json = ?, parties_json = ?, reliefs_json = ?,
               legal_basis = ?, facts_text = ?, ai_style = ?, ai_mode = ?,
               financial_data_json = ?, filing_rule = ?, district = ?, division = ?,
               location = ?, state = ?, case_number_text = ?, in_the_matter_of = ?,
               ai_provider = ?, updated_at = ?
               WHERE id = ? AND tenant_id = ?""",
            (full_content, word_count, page_count,
             caption_html, json.dumps(body_sections), json.dumps(data.parties or []),
             json.dumps(data.reliefs or []), data.legal_basis or "", data.facts,
             data.ai_style or "standard", data.ai_mode or "court_ready",
             json.dumps(data.financial_data or {}), data.filing_rule or "",
             data.district or "", data.division or "", data.location or "",
             data.state or "", data.case_number or "", data.in_the_matter_of or "",
             "claude", datetime.now(timezone.utc).isoformat(),
             draft_id, user["tenant_id"])
        )

    return {
        "content": full_content,
        "caption_html": caption_html,
        "body_html": generated_body,
        "word_count": word_count,
        "page_count": page_count,
        "sections_used": body_sections,
        "language": lang,
        "ai_provider": "claude",
    }


@router.post("/ai-generate-preview")
async def ai_generate_preview(data: AIGenerateRequest, user=Depends(get_current_user)):
    """Generate a draft preview BEFORE creating the draft (used in create flow)."""
    provider = get_ai_provider()
    if provider == "none":
        raise HTTPException(500, "No AI provider configured.")

    lang = JURISDICTION_LANGUAGE.get((data.jurisdiction or "US").upper(), "English")
    sections = _get_sections(data.document_type, data.jurisdiction)
    body_sections = [s for s in sections if s.upper() not in ("CAPTION", "HEADING", "HEADING AND CAPTION")]
    sections_str = "\n".join(f"- {s}" for s in body_sections)

    # Get court rules
    court_rules_info = ""
    if data.court_name:
        with get_db() as db:
            rule = db.execute(
                "SELECT * FROM court_rules WHERE court_name LIKE ?",
                (f"%{data.court_name}%",)
            ).fetchone()
            if rule:
                rule_d = dict(rule)
                court_rules_info = f"Court: {rule_d['court_name']} | Font: {rule_d['default_font']} {rule_d['font_size']}pt | Spacing: {rule_d['line_spacing']}"

    parties_str = data.party_names or ""
    if data.parties and not parties_str:
        parties_str = "; ".join(f"{p.get('name', '')} ({p.get('role', '')})" for p in data.parties)

    system_prompt = f"""You are an expert litigation attorney. Draft legal documents in {lang} that are court-ready.
DO NOT generate the caption/heading — it is generated separately by the system.
Start from INTRODUCTION. Output in HTML format (<h2>, <p>, <ol>, <li>, <blockquote>).
Do NOT include commentary — output ONLY the document body."""

    user_prompt = f"""Generate the body of a {data.document_type.upper()}.

Jurisdiction: {data.jurisdiction or 'Not specified'}
Court: {data.court_name or 'Not specified'}
Case Type: {data.case_type or 'Not specified'}
Parties: {parties_str or 'Not specified'}

Required sections:
{sections_str}

{court_rules_info}

FACTS:
{data.facts}

{('Instructions: ' + data.additional_instructions) if data.additional_instructions else ''}"""

    generated_content = await _call_ai(system_prompt, user_prompt, max_tokens=8000, temperature=0.4)

    # Strip markdown code fences
    generated_content = re.sub(r'^```(?:html)?\s*\n?', '', generated_content.strip())
    generated_content = re.sub(r'\n?```\s*$', '', generated_content.strip())

    word_count = len(_strip_html(generated_content).split())

    return {
        "content": generated_content,
        "word_count": word_count,
        "page_count": max(1, word_count // 250),
        "sections_used": body_sections,
        "language": lang,
        "ai_provider": "claude",
    }


# ═══════════════════════════════════════════════════════════
# AI GENERATE (standalone — creates draft + generates in one call)
# ═══════════════════════════════════════════════════════════

@router.post("/ai-generate")
async def ai_generate_standalone(data: AIGenerateRequest, user=Depends(get_current_user)):
    """Standalone generate: creates a new draft and generates content in one call.
    This is the endpoint the frontend Smart Intake Page calls."""
    provider = get_ai_provider()
    if provider == "none":
        raise HTTPException(500, "No AI provider configured. Set ANTHROPIC_API_KEY.")

    # Auto-create a draft record
    draft_id = str(uuid.uuid4())

    # Build a proper document title from the document_type
    doc_type_labels = {
        "motion": "Motion",
        "complaint": "Complaint and Statement of Claim",
        "brief": "Brief",
        "petition": "Petition",
        "affidavit": "Affidavit",
        "demand_letter": "Demand Letter",
        "discovery": "Discovery Request",
        "response": "Response and Opposition",
        "reply": "Reply",
        "order": "Proposed Order",
        "stipulation": "Stipulation and Agreement",
        "contract": "Contract",
        "settlement": "Settlement Agreement",
        "demand_arbitration": "Demand for Arbitration and Statement of Claim",
    }
    doc_label = doc_type_labels.get(data.document_type, data.document_type.replace("_", " ").title())
    title = doc_label

    # If parties are provided, include them in the title
    if data.parties:
        plaintiffs = [p.get("name", "") for p in data.parties if p.get("role") == "plaintiff" and p.get("name")]
        defendants = [p.get("name", "") for p in data.parties if p.get("role") == "defendant" and p.get("name")]
        if plaintiffs and defendants:
            title = f"{doc_label} — {plaintiffs[0]} v. {defendants[0]}"
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute(
            """INSERT INTO legal_drafts (id, tenant_id, created_by, title, document_type, jurisdiction_id,
               court_name, status, content, created_at, updated_at, case_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', '', ?, ?, ?)""",
            (draft_id, user["tenant_id"], user["sub"], title, data.document_type,
             data.jurisdiction or "US", data.court_name or "", now, now,
             data.case_id or None)
        )

    # Get court rules if available
    court_rules_info = ""
    if data.court_name:
        with get_db() as db:
            rule = db.execute(
                "SELECT * FROM court_rules WHERE court_name LIKE ?",
                (f"%{data.court_name}%",)
            ).fetchone()
            if rule:
                rule_d = dict(rule)
                court_rules_info = f"""Court formatting rules:
- Font: {rule_d['default_font']} {rule_d['font_size']}pt
- Line spacing: {rule_d['line_spacing']}
- Margins: {rule_d['margin_top']}" top, {rule_d['margin_bottom']}" bottom, {rule_d['margin_left']}" left, {rule_d['margin_right']}" right
- Requires Table of Contents: {'Yes' if rule_d.get('requires_toc') else 'No'}
- Requires Table of Authorities: {'Yes' if rule_d.get('requires_toa') else 'No'}
- Requires Certificate of Service: {'Yes' if rule_d.get('requires_certificate_of_service') else 'No'}"""

    lang = JURISDICTION_LANGUAGE.get((data.jurisdiction or "US").upper(), "English")
    sections = _get_sections(data.document_type, data.jurisdiction)
    body_sections = [s for s in sections if s.upper() not in ("CAPTION", "HEADING", "HEADING AND CAPTION")]
    sections_str = "\n".join(f"- {s}" for s in body_sections)

    parties_str = data.party_names or ""
    if data.parties and not parties_str:
        parties_str = "; ".join(f"{p.get('name', '')} ({p.get('role', '')})" for p in data.parties)

    reliefs_str = ""
    if data.reliefs:
        reliefs_str = f"\nReliefs sought: {', '.join(data.reliefs)}"

    legal_basis_str = ""
    if data.legal_basis:
        legal_basis_str = f"\nLegal basis / statutes: {data.legal_basis}"

    filing_rule_str = ""
    if data.filing_rule:
        filing_rule_str = f"\nFiling rule: {data.filing_rule}"

    style_instructions = {
        "standard": "Write in a balanced, professional legal tone.",
        "aggressive": "Write with maximum persuasive force. Use assertive language, strong authority citations, and leave no room for opposing arguments.",
        "conservative": "Write cautiously and conservatively. Hedge appropriately, acknowledge counterarguments, and maintain measured tone.",
    }
    style_note = style_instructions.get(data.ai_style or "standard", style_instructions["standard"])

    financial_note = ""
    if data.financial_data:
        financial_note = """
CRITICAL: For any monetary amounts, interest calculations, or damages figures, use these exact placeholder tokens:
{{PRINCIPAL}}, {{TOTAL_INTEREST}}, {{TOTAL_DUE}}, {{MONTHLY_AMOUNT}}, {{FULL_MONTHS}}, {{REMAINING_DAYS}}, {{DAILY_RATE}}, {{TRIGGER_DATE}}, {{CALC_DATE}}, {{TOTAL_DAMAGES}}
These will be replaced with programmatically computed values. NEVER invent financial figures."""

    # Signature block instruction
    signature_block_str = ""
    if data.filer_name:
        sig_parts = []
        if data.filer_name: sig_parts.append(f"Name: {data.filer_name}")
        if data.filer_title: sig_parts.append(f"Title: {data.filer_title}")
        if data.filer_bar_number: sig_parts.append(f"Bar Number: {data.filer_bar_number}")
        if data.filer_firm: sig_parts.append(f"Firm: {data.filer_firm}")
        if data.filer_address: sig_parts.append(f"Address: {data.filer_address}")
        if data.filer_phone: sig_parts.append(f"Phone: {data.filer_phone}")
        if data.filer_email: sig_parts.append(f"Email: {data.filer_email}")
        signature_block_str = "\n\nINCLUDE A SIGNATURE BLOCK at the end with:\n" + "\n".join(sig_parts)

    # Build analyzed documents context if available
    analyzed_docs_str = ""
    if data.additional_instructions and "ANALYZED DOCUMENTS:" in data.additional_instructions:
        analyzed_docs_str = data.additional_instructions
        data.additional_instructions = ""  # Don't duplicate in additional instructions

    # Build exhibits context
    exhibits_instruction = ""
    if data.exhibits and len(data.exhibits) > 0:
        exhibit_lines = []
        for ex in data.exhibits:
            exhibit_lines.append(f"- {ex.get('label', 'Exhibit')}: {ex.get('description', '')} (Source: {ex.get('filename', 'unknown')}, Type: {ex.get('document_type', 'document')})")
        exhibit_list_str = "\n".join(exhibit_lines)

        if data.incorporate_exhibits:
            exhibits_instruction = f"""\n\nEXHIBITS TO INCORPORATE INTO THE DOCUMENT:
The following exhibits have been identified from uploaded documents. You MUST:
1. Reference each relevant exhibit inline in the factual allegations (e.g., "See Exhibit A, attached hereto")
2. Quote or cite specific content from exhibits where it supports factual allegations
3. Include an EXHIBIT LIST section at the end of the document listing all exhibits
4. Mark each exhibit with its label exactly as shown below

{exhibit_list_str}"""
        else:
            exhibits_instruction = f"""\n\nEXHIBITS (ATTACHED SEPARATELY — DO NOT INCORPORATE INLINE):
The following exhibits exist but should NOT be incorporated into the document body.
Instead, include an EXHIBIT LIST section at the end listing all exhibits for separate attachment.
You may still reference exhibits by label (e.g., "as evidenced by Exhibit A") but do not quote their contents inline.

{exhibit_list_str}"""

    system_prompt = f"""You are a senior litigation attorney with 25+ years of experience drafting court filings in {data.jurisdiction or 'United States'} jurisdictions. You produce COURT-READY legal documents that comply with all applicable rules of civil procedure, local court rules, and substantive law.

{style_note}

YOU MUST FOLLOW THESE MANDATORY DRAFTING RULES:

1. LANGUAGE: Write in {lang}. Use precise, formal legal terminology appropriate for the jurisdiction and court. NEVER use generic or colloquial language. Every sentence must read as if written by a practicing attorney filing in this court.

2. CAPTION/HEADING: DO NOT generate any document caption, heading, court name, case number, or party listing at the top. The caption is generated separately by the system. Start your output directly with the first substantive section.

3. CAUSES OF ACTION: You MUST analyze the facts provided and identify ALL viable causes of action — not just the obvious ones. For a breach of contract case, also analyze whether the facts support:
   - Breach of the implied covenant of good faith and fair dealing
   - Fraud / fraudulent misrepresentation / fraudulent inducement
   - Negligent misrepresentation
   - Unjust enrichment / quantum meruit
   - Conversion
   - Piercing the corporate veil — MANDATORY when BOTH an individual owner/officer AND their company/LLC/corporation are named as defendants. The individual must be alleged to have used the entity as an alter ego, commingled funds, or maintained inadequate corporate formalities. Cite the applicable veil-piercing test for the jurisdiction.
   - Tortious interference with contract or business relations
   - Civil conspiracy
   - Violations of consumer protection statutes (e.g., state DTPA, UDAP)
   - Breach of fiduciary duty (if fiduciary relationship exists)
   - Promissory estoppel / detrimental reliance
   - Accounting
   Each cause of action MUST be a separately numbered COUNT with its own heading.

4. GOVERNING LAW: Every cause of action MUST cite the specific governing statute, rule, or established case law. For example:
   - "Pursuant to [State] Code § [section]..."
   - "Under the Restatement (Second) of Contracts § [section]..."
   - "As established in [Case Name], [Citation]..."
   - "Pursuant to Fed. R. Civ. P. [Rule]..."
   - "Under the [State] Uniform Commercial Code § [section]..."
   If you are unsure about a specific statute number, use the correct statute NAME and mark the number as [VERIFY STATUTE]. NEVER omit the legal authority entirely.

5. ELEMENTS OF EACH CLAIM: For each cause of action, you MUST:
   a) State the legal elements required to prove the claim
   b) Allege specific facts satisfying EACH element
   c) Cite the governing authority (statute, rule, or case law)
   d) Tie the factual allegations to the specific parties involved

6. PRAYER FOR RELIEF: The Prayer for Relief MUST include a separately numbered paragraph for EACH cause of action, plus general relief. Include:
   - Compensatory damages (with specific amounts if calculable from the facts)
   - Consequential and incidental damages
   - Pre-judgment and post-judgment interest (citing the applicable interest statute)
   - Punitive/exemplary damages (where supported by fraud, willful conduct, etc.)
   - Attorney's fees and costs (citing the contractual provision or fee-shifting statute)
   - Equitable relief (injunction, specific performance, accounting) where applicable
   - Any other relief the court deems just and proper

7. INTEREST CALCULATIONS: If the facts involve a contract with interest provisions, unpaid amounts, or statutory interest:
   - Include a detailed interest calculation section
   - Format interest calculations in an HTML table with clear columns (Principal, Rate, Period, Amount)
   - Use <table> with styled borders, header row in bold, alternating row colors
   - Show the calculation methodology step by step
   - Cite the applicable interest statute or contractual provision

8. FACTUAL ALLEGATIONS: Write detailed, numbered paragraphs (use <p> tags with paragraph numbers like "1.", "2.", etc.). Each paragraph should contain ONE factual allegation. Reference ALL relevant documents, communications, and evidence mentioned in the facts. Never summarize when you can be specific.

9. DOCUMENT REFERENCES: If exhibits or documents are mentioned in the facts or uploaded documents, reference them as "Exhibit [X]" and describe their contents specifically. Every relevant document must be cited.

10. STRUCTURE: Use proper HTML formatting:
    - <h2> for main section headings (INTRODUCTION, JURISDICTION AND VENUE, etc.)
    - <h3> for sub-headings (COUNT I, COUNT II, etc.)
    - <p> for paragraphs with proper legal paragraph numbering
    - <ol> and <li> for enumerated lists
    - <strong> for emphasis on key terms and party names
    - <em> for case names and legal terms of art
    - <blockquote> for quoted statutory or contractual language
    - <table> with proper styling for financial calculations

11. COMPLETENESS: The document must be COMPREHENSIVE. Minimum requirements:
    - 20+ numbered factual allegation paragraphs
    - ALL viable causes of action identified from the facts (minimum 3-5 counts)
    - Each count must be 3+ paragraphs with elements, facts, and authority
    - Prayer for relief matching every count
    - Jury demand (if applicable)
    - Verification/certification (if required by jurisdiction)

12. NO FABRICATION: Never fabricate case citations. Use real statutes and rules. If you are uncertain about a citation, mark it [VERIFY CITATION]. It is better to cite the correct legal principle with [VERIFY CITATION] than to omit the authority entirely.

13. OUTPUT: Output ONLY the document body HTML. No commentary, no meta-instructions, no markdown code fences, no explanatory notes.
{financial_note}"""

    user_prompt = f"""Draft the COMPLETE BODY of a {data.document_type.upper().replace('_', ' ')} to be filed in:

Jurisdiction: {data.jurisdiction or 'United States'}
Court: {data.court_name or 'Not specified'}
Case Type: {data.case_type or 'General Civil'}
Parties: {parties_str or 'Not specified'}
{reliefs_str}
{legal_basis_str}
{filing_rule_str}

Required document sections (generate each with the exact heading as <h2>):
{sections_str}

IMPORTANT: Within the CAUSES OF ACTION section, you must create separately numbered COUNTs (as <h3> sub-headings) for EVERY viable cause of action supported by the facts below. Do NOT limit yourself to only the causes of action the user may have mentioned — analyze the facts and identify ALL legally viable claims.

{court_rules_info}

STATEMENT OF FACTS / FACTUAL BASIS:
{data.facts}

{analyzed_docs_str}
{exhibits_instruction}

{('ADDITIONAL INSTRUCTIONS FROM FILER: ' + data.additional_instructions) if data.additional_instructions else ''}
{signature_block_str}

REMINDER:
- Do NOT generate any caption or heading — start directly with the first section.
- Every COUNT must cite its governing statute, rule, or case law.
- The Prayer for Relief must have a separate paragraph for each COUNT.
- Use precise legal terminology — never generic language.
- Number every factual allegation paragraph.
- Reference ALL exhibits and documents mentioned in the facts.
- This document must be ready for filing — not a skeleton or outline.

Generate the complete document body now."""

    generated_body = await _call_ai(system_prompt, user_prompt, max_tokens=16000, temperature=0.3)

    # Strip markdown code fences
    generated_body = re.sub(r'^```(?:html)?\s*\n?', '', generated_body.strip())
    generated_body = re.sub(r'\n?```\s*$', '', generated_body.strip())

    # Substitute financial tokens if financial data provided
    if data.financial_data:
        try:
            fin = calculate_simple_interest(
                principal=data.financial_data.get("principal", 0),
                monthly_rate=data.financial_data.get("monthly_rate", 0),
                trigger_date=data.financial_data.get("trigger_date", ""),
                calc_date=data.financial_data.get("calc_date", ""),
            )
            generated_body = substitute_financial_tokens(generated_body, fin)
        except Exception:
            pass

    # Generate caption using Caption Engine
    caption_html = ""
    if data.parties or data.jurisdiction:
        caption_html = generate_caption_html(
            jurisdiction=data.jurisdiction or "US",
            court_name=data.court_name or "",
            court_level=data.court_name or "",
            division=data.division or "",
            location=data.location or "",
            district=data.district or "",
            state=data.state or "",
            parties=data.parties or [],
            case_number=data.case_number or "",
            document_type=data.document_type,
            document_title=title,
            in_the_matter_of=data.in_the_matter_of or "",
        )

    full_content = caption_html + "\n" + generated_body if caption_html else generated_body

    word_count = len(_strip_html(generated_body).split())
    page_count = max(1, word_count // 250)

    with get_db() as db:
        db.execute(
            """UPDATE legal_drafts SET content = ?, word_count = ?, page_count = ?,
               caption_html = ?, body_sections_json = ?, parties_json = ?, reliefs_json = ?,
               legal_basis = ?, facts_text = ?, ai_style = ?, ai_mode = ?,
               financial_data_json = ?, filing_rule = ?, district = ?, division = ?,
               location = ?, state = ?, case_number_text = ?, in_the_matter_of = ?,
               ai_provider = ?, updated_at = ?
               WHERE id = ? AND tenant_id = ?""",
            (full_content, word_count, page_count,
             caption_html, json.dumps(body_sections), json.dumps(data.parties or []),
             json.dumps(data.reliefs or []), data.legal_basis or "", data.facts,
             data.ai_style or "standard", data.ai_mode or "court_ready",
             json.dumps(data.financial_data or {}), data.filing_rule or "",
             data.district or "", data.division or "", data.location or "",
             data.state or "", data.case_number or "", data.in_the_matter_of or "",
             "claude", datetime.now(timezone.utc).isoformat(),
             draft_id, user["tenant_id"])
        )

    return {
        "draft_id": draft_id,
        "content": full_content,
        "caption_html": caption_html,
        "body_html": generated_body,
        "word_count": word_count,
        "page_count": page_count,
        "sections": body_sections,
        "language": lang,
        "ai_provider": "claude",
    }


# ═══════════════════════════════════════════════════════════
# AI SUGGEST (Strengthen / What's Missing)
# ═══════════════════════════════════════════════════════════

async def _search_courtlistener(query: str, jurisdiction: str = "") -> list:
    """Search CourtListener for real case law."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            params = {"q": query, "type": "o", "order_by": "score desc"}
            if jurisdiction:
                jmap = {"US": "", "UK": "", "UG": "", "NG": "", "KE": "", "IN": "", "ZA": "", "GH": "", "CA": "", "AU": "", "HK": "", "IE": ""}
                if jurisdiction.upper() in jmap:
                    params["q"] = f"{query}"
            resp = await client.get("https://www.courtlistener.com/api/rest/v3/search/", params=params)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for r in data.get("results", [])[:5]:
                    results.append({
                        "case_name": r.get("caseName", ""),
                        "citation": r.get("citation", [r.get("caseName", "")])[0] if r.get("citation") else r.get("caseName", ""),
                        "court": r.get("court", ""),
                        "date": r.get("dateFiled", ""),
                        "snippet": r.get("snippet", "")[:300],
                        "url": f"https://www.courtlistener.com{r.get('absolute_url', '')}",
                    })
                return results
    except Exception:
        pass
    return []


@router.post("/drafts/{draft_id}/ai-suggest")
async def ai_suggest(draft_id: str, data: AISuggestRequest, user=Depends(get_current_user)):
    """AI-powered suggestions: strengthen text or find what's missing."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    doc_type = data.document_type or draft["document_type"] or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    if data.mode == "strengthen":
        text = data.selected_text or ""
        # If no text selected, use the full draft content
        if not text.strip():
            text = _strip_html(data.full_content or draft["content"] or "")
        if not text.strip():
            raise HTTPException(400, "No text to strengthen. Write some content first.")

        # Search for relevant case law to include in strengthened version
        case_law = await _search_courtlistener(text[:200], jurisdiction)
        case_law_context = ""
        if case_law:
            case_law_context = "\n\nRelevant case law you may cite (use these if applicable):\n"
            for c in case_law[:3]:
                case_law_context += f"- {c['case_name']} ({c['date']}) - {c['snippet'][:150]}\n"

        system_prompt = f"""You are an elite litigation attorney and legal editor. Your job is to make legal text significantly more persuasive, authoritative, and court-ready.

When strengthening text:
1. Add REAL case law citations where they support the arguments (from the provided case law or well-known precedents)
2. Use stronger legal terms of art (e.g., "clearly established" instead of "known", "well-settled law" instead of "common")
3. Add statutory references where applicable
4. Sharpen logical structure — lead with your strongest argument
5. Remove hedging language ("it seems", "perhaps", "may") and replace with assertive language
6. Add authority — cite rules of procedure, constitutional provisions, or statutory authority

Write in {lang}. Output in HTML format (<p>, <strong>, <em> tags) so it can be inserted directly into the editor.
Format your response as JSON:
{{{{
  "strengthened_text": "<p>...HTML formatted strengthened text with citations...</p>",
  "notes": ["note explaining change 1", "note explaining change 2", "note explaining change 3"],
  "citations_added": ["Case Name, Citation (Year)", ...]
}}}}"""
        user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n{case_law_context}\n\nText to strengthen:\n{text[:4000]}"
    else:  # whats_missing
        content = data.full_content or draft["content"] or ""
        if not content.strip():
            raise HTTPException(400, "Draft has no content to analyze")

        sections = _get_sections(doc_type, jurisdiction)
        sections_str = ", ".join(sections)
        clean_content = _strip_html(content)

        # Search for case law related to the draft topic
        case_law = await _search_courtlistener(clean_content[:200], jurisdiction)
        case_law_context = ""
        if case_law:
            case_law_context = "\n\nRelevant case law the draft should consider citing:\n"
            for c in case_law[:3]:
                case_law_context += f"- {c['case_name']} ({c['date']}) - {c['snippet'][:150]}\n"

        system_prompt = f"""You are an elite litigation attorney reviewing a {doc_type} for completeness, strength, and legal accuracy.

Analyze thoroughly and identify:
1. Missing sections (expected: {sections_str})
2. Weak arguments that need citations, stronger language, or better logic
3. Missing procedural elements (verification, certificate of service, jurisdictional statement, etc.)
4. Missing or incorrect case law citations — suggest REAL case citations that should be included
5. Legal vulnerabilities an opposing counsel could exploit
6. Specific actionable improvements with exact text suggestions

Be specific and actionable — don't just say "add more citations", say WHICH citations and WHERE.

Write in {lang}.
Format as JSON:
{{{{
  "missing_sections": ["Section name — what it should contain"],
  "weak_points": ["Specific weakness — how to fix it"],
  "procedural_gaps": ["Missing element — why it matters"],
  "suggested_citations": ["Case Name, Citation (Year) — relevant for [topic]"],
  "suggestions": ["Specific actionable improvement"]
}}}}"""
        user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n{case_law_context}\n\nDraft content:\n{clean_content[:6000]}"

    try:
        parsed = await _call_ai_json(system_prompt, user_message, max_tokens=4000, temperature=0.3)
    except Exception:
        result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.3)
        parsed = {"raw_response": result}

    return {"mode": data.mode, "suggestions": parsed}


# ═══════════════════════════════════════════════════════════
# AI CONTINUE WRITING
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/ai-continue")
async def ai_continue(draft_id: str, data: AIContinueRequest, user=Depends(get_current_user)):
    """AI continues writing from where the cursor is placed."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    doc_type = data.document_type or draft["document_type"] or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    # Only use the last ~3000 chars of content before cursor to keep context manageable
    context = data.content_before_cursor[-3000:] if len(data.content_before_cursor) > 3000 else data.content_before_cursor
    clean_context = _strip_html(context)

    facts_section = ""
    if data.facts_context:
        facts_section = f"\nOriginal facts/story for this case:\n{data.facts_context[:2000]}"

    system_prompt = f"""You are an expert litigation attorney writing a {doc_type} in {lang}.
Continue writing from exactly where the text ends. Write 2-3 substantive paragraphs that:
1. Flow naturally from the preceding text
2. Advance the legal argument logically
3. Include relevant legal reasoning and citations where appropriate (mark uncertain citations as [CITE NEEDED])
4. Match the existing writing style and tone

Output ONLY the continuation in HTML format (<p>, <h2>, <ol>, <li> tags). Do NOT repeat any existing text. Do NOT add commentary."""

    user_message = f"""Court: {data.court_name or 'Not specified'}
Document type: {doc_type}
Jurisdiction: {jurisdiction}
{facts_section}

Existing text (continue from the end):
{clean_context}

Continue writing:"""

    continuation = await _call_ai(system_prompt, user_message, max_tokens=2000, temperature=0.4)

    # Strip markdown code fences
    continuation = re.sub(r'^```(?:html)?\s*\n?', '', continuation.strip())
    continuation = re.sub(r'\n?```\s*$', '', continuation.strip())

    word_count = len(_strip_html(continuation).split())

    return {"continuation": continuation, "word_count": word_count}


# ═══════════════════════════════════════════════════════════
# ASK AI — Inline research, case law lookup, instructions
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/ai-ask")
async def ai_ask(draft_id: str, data: AIAskRequest, user=Depends(get_current_user)):
    """Ask AI anything — research case law, get legal advice, request changes to the draft."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    doc_type = data.document_type or draft["document_type"] or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    # Search CourtListener for case law if the question seems to need it
    case_law = []
    research_keywords = ["case law", "citation", "cite", "precedent", "authority", "ruling", "decision", "statute", "law", "act", "section", "research"]
    if any(kw in data.question.lower() for kw in research_keywords):
        search_query = data.question[:200]
        if data.selected_text:
            search_query = data.selected_text[:200]
        case_law = await _search_courtlistener(search_query, jurisdiction)

    case_law_context = ""
    if case_law:
        case_law_context = "\n\nRelevant case law from CourtListener (REAL cases — use these):\n"
        for c in case_law:
            case_law_context += f"- {c['case_name']} ({c['court']}, {c['date']}) — {c['snippet'][:200]}\n  URL: {c['url']}\n"

    draft_context = ""
    if data.draft_content:
        draft_context = f"\n\nCurrent draft content:\n{_strip_html(data.draft_content)[:4000]}"
    elif draft["content"]:
        draft_context = f"\n\nCurrent draft content:\n{_strip_html(draft['content'])[:4000]}"

    selected_context = ""
    if data.selected_text:
        selected_context = f"\n\nSelected text the user is asking about:\n{data.selected_text[:2000]}"

    system_prompt = f"""You are an elite litigation attorney and legal research assistant working inside a legal drafting tool.

You have deep expertise in {jurisdiction or 'international'} law and procedure. You help lawyers by:
1. Researching and citing REAL case law (prefer citations from the provided case law database)
2. Explaining legal concepts and procedure
3. Suggesting specific text to add to their draft (output in HTML when suggesting text: <p>, <h2>, <strong>, <em>)
4. Answering questions about jurisdiction-specific rules
5. Finding relevant statutes and regulations

When citing cases: use REAL citations only. If you're unsure of a citation, clearly mark it as [VERIFY CITATION].
When suggesting draft text: format as HTML so it can be inserted directly into the editor.
Write in {lang}.
{case_law_context}"""

    user_message = f"""Document type: {doc_type}
Jurisdiction: {jurisdiction}
Court: {data.court_name or 'Not specified'}
{draft_context}
{selected_context}

My question:
{data.question}"""

    result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.3)

    # Strip code fences if present
    result = re.sub(r'^```(?:html|json)?\s*\n?', '', result.strip())
    result = re.sub(r'\n?```\s*$', '', result.strip())

    return {
        "answer": result,
        "case_law_results": case_law,
        "question": data.question,
    }


# ═══════════════════════════════════════════════════════════
# AI VERIFY — Self-verification of draft quality and accuracy
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/ai-verify")
async def ai_verify(draft_id: str, data: AIVerifyRequest, user=Depends(get_current_user)):
    """AI reviews the draft for legal accuracy, citation validity, and completeness."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    content = data.content or draft["content"] or ""
    if not content.strip():
        raise HTTPException(400, "Draft has no content to verify")

    doc_type = data.document_type or draft["document_type"] or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"
    clean_content = _strip_html(content)

    # Search for case law mentioned in the draft to verify citations
    case_law = await _search_courtlistener(clean_content[:300], jurisdiction)

    system_prompt = f"""You are an elite appellate judge and legal quality reviewer. You are reviewing a {doc_type} for accuracy, completeness, and legal soundness.

Perform a comprehensive verification:

1. **Citation Verification**: Check every case citation, statute reference, and rule citation. Flag any that appear incorrect, incomplete, or potentially fabricated. For each, state whether it's VERIFIED, UNVERIFIED, or LIKELY INCORRECT.

2. **Legal Accuracy**: Check whether the legal standards cited are correct for the jurisdiction ({jurisdiction or 'not specified'}). Flag any misstatements of law.

3. **Structural Completeness**: Verify all required sections are present and substantive. Flag any that are too thin or missing.

4. **Logical Consistency**: Check that arguments follow logically, that facts support the legal theories, and that there are no internal contradictions.

5. **Procedural Compliance**: Verify procedural requirements (standing, jurisdiction, timeliness, proper parties, required certifications).

6. **Overall Score**: Rate the draft 1-10 on: Legal Accuracy, Persuasiveness, Completeness, Professional Quality.

Write in {lang}.
Format as JSON:
{{{{
  "overall_score": {{"accuracy": 8, "persuasiveness": 7, "completeness": 6, "quality": 7}},
  "citation_issues": [{{"citation": "...", "status": "VERIFIED|UNVERIFIED|LIKELY INCORRECT", "note": "..."}}],
  "legal_accuracy_issues": ["issue description"],
  "structural_issues": ["missing or weak section"],
  "logic_issues": ["inconsistency or gap"],
  "procedural_issues": ["missing requirement"],
  "strengths": ["what the draft does well"],
  "priority_fixes": ["most important fix 1", "most important fix 2", "most important fix 3"]
}}}}"""

    user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n\nFull draft:\n{clean_content[:8000]}"

    try:
        parsed = await _call_ai_json(system_prompt, user_message, max_tokens=4000, temperature=0.2)
    except Exception:
        result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.2)
        parsed = {"raw_response": result}

    return {"verification": parsed, "case_law_checked": case_law}


# ═══════════════════════════════════════════════════════════
# AI ANALYZE FACTS — Smart intake (Claude reads facts, suggests fields)
# ═══════════════════════════════════════════════════════════

@router.post("/ai-analyze-facts")
async def ai_analyze_facts(data: AIAnalyzeFactsRequest, user=Depends(get_current_user)):
    """Claude analyzes statement of facts and suggests jurisdiction, parties, reliefs, and legal basis.

    This powers the Smart Intake Form. User enters facts first (the anchor),
    then Claude suggests all other fields which user confirms or overrides.
    """
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    facts = data.facts.strip()
    if not facts:
        raise HTTPException(400, "Facts text is required")

    # Include uploaded document text if provided
    extra_context = ""
    if data.uploaded_text:
        extra_context = f"\n\nAdditional uploaded document text:\n{data.uploaded_text[:4000]}"

    system_prompt = """You are an expert legal analyst. Analyze the following statement of facts and extract structured information for a legal filing.

You MUST respond with valid JSON only. No commentary, no explanation — just the JSON object.

Required JSON structure:
{
  "suggested_jurisdiction": {
    "country": "US|UG|GB|KE|NG|GH|ZA|IN|CA|AU|HK|IE",
    "country_name": "United States",
    "state": "New Jersey (if applicable)",
    "confidence": "high|medium|low",
    "reasoning": "Brief explanation of why this jurisdiction"
  },
  "suggested_court": {
    "court_name": "Superior Court of New Jersey",
    "court_level": "state|federal|high_court|magistrate|district|supreme|appeals",
    "division": "Law Division, Civil Part",
    "location": "Essex County",
    "confidence": "high|medium|low"
  },
  "suggested_document_type": {
    "type": "complaint|motion|brief|petition|affidavit|demand_letter|discovery|response|reply|order|stipulation|contract|settlement",
    "reasoning": "Why this document type fits"
  },
  "suggested_parties": [
    {"name": "John Doe", "role": "plaintiff", "entity_type": "individual|corporation|government|organization|estate|trust", "address": "if mentioned"},
    {"name": "ABC Corp", "role": "defendant", "entity_type": "corporation", "address": "if mentioned"}
  ],
  "additional_parties_note": "Mention of any other potential parties not explicitly named",
  "suggested_reliefs": ["Damages", "Specific Performance", "Injunctive Relief", "Interest", "Attorney Fees", "Costs"],
  "suggested_legal_basis": [
    {"statute": "N.J.S.A. 2A:15-1", "description": "Breach of contract", "confidence": "high|medium|low"},
    {"statute": "UCC § 2-714", "description": "Damages for breach of warranty", "confidence": "medium"}
  ],
  "suggested_case_type": "breach_of_contract|personal_injury|employment|landlord_tenant|family|criminal|immigration|ip|real_estate|probate|commercial|election|other",
  "key_dates": [
    {"date": "2023-04-01", "description": "Contract breach date"},
    {"date": "2023-06-15", "description": "Demand letter sent"}
  ],
  "financial_amounts": {
    "principal": 0,
    "monthly_rate": 0,
    "trigger_date": "",
    "has_financial_claim": true
  },
  "filing_rules_note": "Any relevant filing rules, deadlines, or requirements based on jurisdiction and document type",
  "summary": "2-3 sentence summary of the case"
}"""

    user_message = f"""Analyze these facts for a {data.document_type} filing:

{facts}
{extra_context}

{f'User indicated jurisdiction might be: {data.jurisdiction}' if data.jurisdiction else 'Jurisdiction not specified by user — please suggest based on facts.'}

Respond with JSON only."""

    try:
        parsed = await _call_ai_json(system_prompt, user_message, max_tokens=4000, temperature=0.2)
    except Exception:
        result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.2)
        parsed = {"raw_response": result, "error": "Could not parse structured response"}

    return {"analysis": parsed, "facts_length": len(facts)}


# ═══════════════════════════════════════════════════════════
# AI EDIT — Iterative editing via chat instructions (Dual-Pane)
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/ai-edit")
async def ai_edit(draft_id: str, data: AIEditRequest, user=Depends(get_current_user)):
    """Apply an edit instruction to the current document content.

    Used in the dual-pane editing mode: user types instruction in Legal Brain chat (left),
    document updates on the right. Each instruction is saved as a chat message.
    """
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    current_content = data.current_content or draft["content"] or ""
    if not current_content.strip():
        raise HTTPException(400, "No content to edit")

    doc_type = data.document_type or draft["document_type"] or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    # ─── INSTRUCTION CLASSIFICATION ───────────────────────────
    # Three modes: ADVISORY (suggestions only), TARGETED EDIT (paragraph-level), FULL REWRITE (rare)
    advisory_keywords = [
        "suggest", "which", "what should", "can you recommend", "should i remove",
        "should i delete", "should i change", "advise", "review", "analyze",
        "what do you think", "is there", "are there", "identify", "find",
        "which paragraph", "which section", "what's wrong", "what is wrong",
        "help me decide", "opinion", "feedback", "evaluate", "assess",
        "should be removed", "can be removed", "to be removed", "not important",
        "not very important", "unnecessary", "redundant", "irrelevant",
        "recommend", "thoughts", "do you think", "how can i", "how should",
        "tell me", "list", "show me", "point out", "highlight",
    ]
    full_rewrite_keywords = [
        "rewrite entire", "rewrite the entire", "rewrite whole", "rewrite the whole",
        "redraft entire", "redraft the entire", "redo entire", "redo the entire",
        "start over", "rewrite from scratch", "completely rewrite", "full rewrite",
    ]
    instruction_lower = data.instruction.lower()
    is_advisory = any(kw in instruction_lower for kw in advisory_keywords)
    is_full_rewrite = any(kw in instruction_lower for kw in full_rewrite_keywords)
    is_undo = any(kw in instruction_lower for kw in ["undo", "revert", "restore", "bring back", "put back"])

    # Explicit execution commands ALWAYS override advisory classification
    execution_keywords = ["execute", "apply", "do it", "go ahead", "make the changes", "make those changes",
                          "proceed", "implement", "carry out", "perform", "just do it", "do all",
                          "execute all", "apply all", "make all", "do the changes", "yes do it",
                          "yes remove", "yes delete", "go ahead and remove", "go ahead and delete",
                          "now remove", "now delete", "please remove", "please delete"]
    is_execution = any(kw in instruction_lower for kw in execution_keywords)
    if is_execution:
        is_advisory = False  # Execution commands override advisory

    # If instruction contains BOTH advisory keywords AND action words, check more carefully
    if is_advisory:
        action_keywords = ["remove", "delete", "add", "insert", "change", "replace", "rewrite", "redraft", "fix", "correct", "update", "modify"]
        has_action = any(kw in instruction_lower for kw in action_keywords)
        if has_action:
            direct_action_patterns = ["remove paragraph", "delete paragraph", "remove section", "delete section",
                                       "add a paragraph", "insert a paragraph", "change paragraph", "fix paragraph",
                                       "rewrite paragraph", "redraft paragraph", "update paragraph", "modify paragraph"]
            is_direct_action = any(p in instruction_lower for p in direct_action_patterns)
            if is_direct_action:
                is_advisory = False  # Override: this is a targeted edit

    if is_undo:
        system_prompt = f"""You are an expert litigation attorney editing a legal document.

The user wants to UNDO a previous edit. You MUST return the COMPLETE document as-is without removing anything.
If content was previously deleted, you cannot restore it — return the current document unchanged.

CRITICAL: Do NOT delete or remove ANY content. Return the ENTIRE document exactly as provided.
Output in HTML format. Write in {lang}."""
    elif is_advisory:
        system_prompt = f"""You are an expert litigation attorney reviewing a legal document.

The user is asking for your ADVICE or SUGGESTIONS. You are in SUGGESTION MODE.

## ABSOLUTE RULES — VIOLATION IS FORBIDDEN:
1. You MUST NOT return any HTML document content.
2. You MUST NOT modify, delete, remove, or rewrite ANY part of the document.
3. You MUST NOT return the document or any portion of it.
4. You MUST ONLY return your analysis, recommendations, and suggestions as plain text.

## WHAT TO DO:
- If the user asks which paragraphs to remove: LIST them by number and quote their first few words. Explain WHY each could be removed.
- If the user asks for improvements: DESCRIBE what changes you would recommend, paragraph by paragraph.
- If the user asks for analysis: PROVIDE your expert legal analysis.
- Always reference specific paragraph numbers, section headings, or quote the opening words.
- Let the USER decide what to actually change — you are an ADVISOR, not an editor.

Return ONLY your advisory text. Use markdown formatting for readability.
Write in {lang}."""
    elif is_full_rewrite:
        system_prompt = f"""You are an expert litigation attorney performing a FULL REWRITE of a legal document.

The user has explicitly requested a complete rewrite. You may restructure and rewrite the entire document.

RULES:
1. Return the COMPLETE rewritten document in HTML format.
2. Preserve all factual content, party names, dates, and case details.
3. Improve structure, legal argumentation, and prose quality.
4. Do NOT fabricate case citations. Mark uncertain ones as [VERIFY CITATION].
5. Do NOT add commentary — return ONLY the rewritten document HTML.
6. Write in {lang}."""
    else:
        system_prompt = f"""You are an expert litigation attorney editing a legal document inside a WYSIWYG editor.

You are in TARGETED EDIT MODE. The user has given you a specific editing instruction.

## ABSOLUTE RULES — VIOLATION IS FORBIDDEN:
1. ONLY modify the specific paragraph(s) or section(s) the user mentioned.
2. Return the ENTIRE document with ONLY the targeted edit applied.
3. Do NOT touch, modify, delete, or rearrange ANY section the user did not mention.
4. Do NOT remove entire pages or large sections unless the user EXPLICITLY names each one.
5. The output document must contain ALL paragraphs from the input document, except those the user explicitly asked to remove by name.
6. Count the paragraphs in the input and verify your output has the same count (minus any the user asked to remove).

## OUTPUT RULES:
7. Output in HTML format (<h2>, <p>, <ol>, <li>, <blockquote>, <strong>, <em> tags).
8. The caption/heading section at the top IS editable — include it in your output if present.
9. Preserve all existing formatting, citations, and structure.
10. Never fabricate case citations. Mark uncertain ones as [VERIFY CITATION].
11. Do NOT add commentary or explanations — return ONLY the updated document HTML.
12. Write in {lang}."""

    user_message = f"""Document type: {doc_type}
Jurisdiction: {jurisdiction}
Court: {data.court_name or 'Not specified'}

EDITING INSTRUCTION: {data.instruction}

CURRENT DOCUMENT:
{current_content[:12000]}"""

    edited_content = await _call_ai(system_prompt, user_message, max_tokens=8000, temperature=0.3)

    # Strip markdown code fences
    edited_content = re.sub(r'^```(?:html)?\s*\n?', '', edited_content.strip())
    edited_content = re.sub(r'\n?```\s*$', '', edited_content.strip())

    if is_advisory:
        # SUGGESTION MODE: return suggestions in chat, do NOT modify the document
        msg_id = str(uuid.uuid4())[:12]
        assistant_msg_id = str(uuid.uuid4())[:12]
        with get_db() as db:
            db.execute(
                """INSERT INTO draft_chat_messages (id, draft_id, user_id, role, content, edit_applied)
                   VALUES (?, ?, ?, 'user', ?, 0)""",
                (msg_id, draft_id, user["sub"], data.instruction)
            )
            db.execute(
                """INSERT INTO draft_chat_messages (id, draft_id, user_id, role, content, edit_applied)
                   VALUES (?, ?, ?, 'assistant', ?, 0)""",
                (assistant_msg_id, draft_id, user["sub"], edited_content)
            )
        return {
            "content": current_content,  # Keep document unchanged
            "word_count": len(_strip_html(current_content).split()),
            "instruction": data.instruction,
            "message_id": msg_id,
            "advisory": edited_content,
        }

    word_count = len(_strip_html(edited_content).split())

    # Save chat message
    msg_id = str(uuid.uuid4())[:12]
    assistant_msg_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        # Save user instruction
        db.execute(
            """INSERT INTO draft_chat_messages (id, draft_id, user_id, role, content, edit_applied)
               VALUES (?, ?, ?, 'user', ?, 1)""",
            (msg_id, draft_id, user["sub"], data.instruction)
        )
        # Save assistant response summary
        db.execute(
            """INSERT INTO draft_chat_messages (id, draft_id, user_id, role, content, edit_applied)
               VALUES (?, ?, ?, 'assistant', ?, 1)""",
            (assistant_msg_id, draft_id, user["sub"], f"Applied edit: {data.instruction[:200]}")
        )
        # Update draft content
        db.execute(
            """UPDATE legal_drafts SET content = ?, word_count = ?, page_count = ?,
               updated_at = ? WHERE id = ? AND tenant_id = ?""",
            (edited_content, word_count, max(1, word_count // 250),
             datetime.now(timezone.utc).isoformat(), draft_id, user["tenant_id"])
        )

    return {
        "content": edited_content,
        "word_count": word_count,
        "instruction": data.instruction,
        "message_id": msg_id,
    }


# ═══════════════════════════════════════════════════════════
# AI SUGGEST LAWS — Claude suggests relevant statutes
# ═══════════════════════════════════════════════════════════

@router.post("/ai-suggest-laws")
async def ai_suggest_laws(data: AISuggestLawsRequest, user=Depends(get_current_user)):
    """Use OpenAI GPT-4o to suggest relevant statutes, rules, and case law based on facts and jurisdiction."""

    system_prompt = """You are an elite legal research assistant with encyclopedic knowledge of statutes, regulations, case law, and rules of civil procedure across all jurisdictions.

Based on the facts and jurisdiction provided, identify ALL relevant:
1. Governing statutes and codes (with exact section numbers)
2. Rules of civil procedure
3. Landmark case law citations
4. Restatement sections
5. Regulatory provisions

For each suggestion, provide:
- "statute": The full citation (e.g., "42 U.S.C. § 1983", "Fed. R. Civ. P. 56(a)", "Restatement (Second) of Contracts § 235")
- "description": What the statute/rule covers and its title
- "relevance": How it specifically applies to the facts provided

Be thorough — suggest 8-15 items covering all viable legal theories. Include both substantive law and procedural rules.

Respond with JSON only — no commentary, no markdown:
[
  {"statute": "...", "description": "...", "relevance": "..."},
  {"statute": "...", "description": "...", "relevance": "..."}
]"""

    user_message = f"""Jurisdiction: {data.jurisdiction}
Document type: {data.document_type}
Case type: {data.case_type or 'Not specified'}

FACTS:
{data.facts[:6000]}

Suggest all relevant statutes, rules of civil procedure, case law, and restatement sections. JSON array only."""

    try:
        # Use OpenAI GPT-4o for law suggestions (better at structured legal research)
        parsed = await call_openai_json(system_prompt, user_message, max_tokens=4000, temperature=0.2)

        # Normalize response — handle both array and object formats
        if isinstance(parsed, list):
            suggestions = parsed
        elif isinstance(parsed, dict):
            # Check common keys
            suggestions = parsed.get("items", parsed.get("statutes", parsed.get("suggestions", [])))
            # If it returned nested objects, flatten them
            if suggestions and isinstance(suggestions[0], dict) and "citation" in suggestions[0] and "statute" not in suggestions[0]:
                suggestions = [
                    {"statute": s.get("citation", ""), "description": s.get("title", s.get("description", "")), "relevance": s.get("relevance", "")}
                    for s in suggestions
                ]
        else:
            suggestions = []

        return {"suggestions": suggestions}
    except Exception as e:
        logger.error(f"OpenAI suggest laws failed: {e}")
        # Fallback to Claude
        try:
            parsed = await _call_ai_json(system_prompt, user_message, max_tokens=4000, temperature=0.2)
            if isinstance(parsed, list):
                return {"suggestions": parsed}
            elif isinstance(parsed, dict):
                suggestions = parsed.get("items", parsed.get("statutes", parsed.get("suggestions", [])))
                if suggestions and isinstance(suggestions[0], dict) and "citation" in suggestions[0] and "statute" not in suggestions[0]:
                    suggestions = [
                        {"statute": s.get("citation", ""), "description": s.get("title", s.get("description", "")), "relevance": s.get("relevance", "")}
                        for s in suggestions
                    ]
                return {"suggestions": suggestions}
        except Exception:
            pass
        raise HTTPException(502, f"AI service error: {e}")


# ═══════════════════════════════════════════════════════════
# STANDALONE AI ENDPOINTS (no draft_id required)
# Used by the dual-pane editor when draft hasn't been saved yet
# ═══════════════════════════════════════════════════════════

@router.post("/ai-edit")
async def ai_edit_standalone(data: AIEditRequest, user=Depends(get_current_user)):
    """Apply an edit instruction to the current document content (standalone, no draft_id needed)."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    current_content = data.current_content or ""
    if not current_content.strip():
        raise HTTPException(400, "No content to edit")

    doc_type = data.document_type or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    # ─── INSTRUCTION CLASSIFICATION ───────────────────────────
    # Three modes: ADVISORY (suggestions only), TARGETED EDIT (paragraph-level), FULL REWRITE (rare)
    advisory_keywords = [
        "suggest", "which", "what should", "can you recommend", "should i remove",
        "should i delete", "should i change", "advise", "review", "analyze",
        "what do you think", "is there", "are there", "identify", "find",
        "which paragraph", "which section", "what's wrong", "what is wrong",
        "help me decide", "opinion", "feedback", "evaluate", "assess",
        "should be removed", "can be removed", "to be removed", "not important",
        "not very important", "unnecessary", "redundant", "irrelevant",
        "recommend", "thoughts", "do you think", "how can i", "how should",
        "tell me", "list", "show me", "point out", "highlight",
    ]
    full_rewrite_keywords = [
        "rewrite entire", "rewrite the entire", "rewrite whole", "rewrite the whole",
        "redraft entire", "redraft the entire", "redo entire", "redo the entire",
        "start over", "rewrite from scratch", "completely rewrite", "full rewrite",
    ]
    instruction_lower = data.instruction.lower()
    is_advisory = any(kw in instruction_lower for kw in advisory_keywords)
    is_full_rewrite = any(kw in instruction_lower for kw in full_rewrite_keywords)
    is_undo = any(kw in instruction_lower for kw in ["undo", "revert", "restore", "bring back", "put back"])

    # Explicit execution commands ALWAYS override advisory classification
    execution_keywords = ["execute", "apply", "do it", "go ahead", "make the changes", "make those changes",
                          "proceed", "implement", "carry out", "perform", "just do it", "do all",
                          "execute all", "apply all", "make all", "do the changes", "yes do it",
                          "yes remove", "yes delete", "go ahead and remove", "go ahead and delete",
                          "now remove", "now delete", "please remove", "please delete"]
    is_execution = any(kw in instruction_lower for kw in execution_keywords)
    if is_execution:
        is_advisory = False  # Execution commands override advisory

    # If instruction contains BOTH advisory keywords AND action words, check more carefully
    if is_advisory:
        action_keywords = ["remove", "delete", "add", "insert", "change", "replace", "rewrite", "redraft", "fix", "correct", "update", "modify"]
        has_action = any(kw in instruction_lower for kw in action_keywords)
        if has_action:
            direct_action_patterns = ["remove paragraph", "delete paragraph", "remove section", "delete section",
                                       "add a paragraph", "insert a paragraph", "change paragraph", "fix paragraph",
                                       "rewrite paragraph", "redraft paragraph", "update paragraph", "modify paragraph"]
            is_direct_action = any(p in instruction_lower for p in direct_action_patterns)
            if is_direct_action:
                is_advisory = False  # Override: this is a targeted edit

    if is_undo:
        system_prompt = f"""You are an expert litigation attorney editing a legal document.

The user wants to UNDO a previous edit. You MUST return the COMPLETE document as-is without removing anything.
If content was previously deleted, you cannot restore it — return the current document unchanged.

CRITICAL: Do NOT delete or remove ANY content. Return the ENTIRE document exactly as provided.
Output in HTML format. Write in {lang}."""
    elif is_advisory:
        system_prompt = f"""You are an expert litigation attorney reviewing a legal document.

The user is asking for your ADVICE or SUGGESTIONS. You are in SUGGESTION MODE.

## ABSOLUTE RULES — VIOLATION IS FORBIDDEN:
1. You MUST NOT return any HTML document content.
2. You MUST NOT modify, delete, remove, or rewrite ANY part of the document.
3. You MUST NOT return the document or any portion of it.
4. You MUST ONLY return your analysis, recommendations, and suggestions as plain text.

## WHAT TO DO:
- If the user asks which paragraphs to remove: LIST them by number and quote their first few words. Explain WHY each could be removed.
- If the user asks for improvements: DESCRIBE what changes you would recommend, paragraph by paragraph.
- If the user asks for analysis: PROVIDE your expert legal analysis.
- Always reference specific paragraph numbers, section headings, or quote the opening words.
- Let the USER decide what to actually change — you are an ADVISOR, not an editor.

Return ONLY your advisory text. Use markdown formatting for readability.
Write in {lang}."""
    elif is_full_rewrite:
        system_prompt = f"""You are an expert litigation attorney performing a FULL REWRITE of a legal document.

The user has explicitly requested a complete rewrite. You may restructure and rewrite the entire document.

RULES:
1. Return the COMPLETE rewritten document in HTML format.
2. Preserve all factual content, party names, dates, and case details.
3. Improve structure, legal argumentation, and prose quality.
4. Do NOT fabricate case citations. Mark uncertain ones as [VERIFY CITATION].
5. Do NOT add commentary — return ONLY the rewritten document HTML.
6. Write in {lang}."""
    else:
        system_prompt = f"""You are an expert litigation attorney editing a legal document inside a WYSIWYG editor.

You are in TARGETED EDIT MODE. The user has given you a specific editing instruction.

## ABSOLUTE RULES — VIOLATION IS FORBIDDEN:
1. ONLY modify the specific paragraph(s) or section(s) the user mentioned.
2. Return the ENTIRE document with ONLY the targeted edit applied.
3. Do NOT touch, modify, delete, or rearrange ANY section the user did not mention.
4. Do NOT remove entire pages or large sections unless the user EXPLICITLY names each one.
5. The output document must contain ALL paragraphs from the input document, except those the user explicitly asked to remove by name.
6. Count the paragraphs in the input and verify your output has the same count (minus any the user asked to remove).

## OUTPUT RULES:
7. Output in HTML format (<h2>, <p>, <ol>, <li>, <blockquote>, <strong>, <em> tags).
8. The caption/heading section at the top IS editable — include it in your output if present.
9. Preserve all existing formatting, citations, and structure.
10. Never fabricate case citations. Mark uncertain ones as [VERIFY CITATION].
11. Do NOT add commentary or explanations — return ONLY the updated document HTML.
12. Write in {lang}."""

    user_message = f"""Document type: {doc_type}
Jurisdiction: {jurisdiction}
Court: {data.court_name or 'Not specified'}

EDITING INSTRUCTION: {data.instruction}

CURRENT DOCUMENT:
{current_content[:12000]}"""

    edited_content = await _call_ai(system_prompt, user_message, max_tokens=8000, temperature=0.3)
    edited_content = re.sub(r'^```(?:html)?\s*\n?', '', edited_content.strip())
    edited_content = re.sub(r'\n?```\s*$', '', edited_content.strip())

    if is_advisory:
        # SUGGESTION MODE: return suggestions in chat, do NOT modify the document
        return {
            "updated_content": current_content,  # Keep document unchanged
            "changes_summary": edited_content,    # Put the advice in the summary
        }

    return {
        "updated_content": edited_content,
        "changes_summary": f"Applied edit: {data.instruction[:200]}",
    }


@router.post("/ai-continue")
async def ai_continue_standalone(data: AIContinueRequest, user=Depends(get_current_user)):
    """AI continues writing from where the cursor is placed (standalone, no draft_id needed)."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    doc_type = data.document_type or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    context = data.content_before_cursor[-3000:] if len(data.content_before_cursor) > 3000 else data.content_before_cursor
    clean_context = _strip_html(context)

    facts_section = ""
    if data.facts_context:
        facts_section = f"\nOriginal facts/story for this case:\n{data.facts_context[:2000]}"

    system_prompt = f"""You are an expert litigation attorney writing a {doc_type} in {lang}.
Continue writing from exactly where the text ends. Write 2-3 substantive paragraphs that:
1. Flow naturally from the preceding text
2. Advance the legal argument logically
3. Include relevant legal reasoning and citations where appropriate (mark uncertain citations as [CITE NEEDED])
4. Match the existing writing style and tone

Output ONLY the continuation in HTML format (<p>, <h2>, <ol>, <li> tags). Do NOT repeat any existing text. Do NOT add commentary."""

    user_message = f"""Court: {data.court_name or 'Not specified'}
Document type: {doc_type}
Jurisdiction: {jurisdiction}
{facts_section}

Existing text (continue from the end):
{clean_context}

Continue writing:"""

    continuation = await _call_ai(system_prompt, user_message, max_tokens=2000, temperature=0.4)
    continuation = re.sub(r'^```(?:html)?\s*\n?', '', continuation.strip())
    continuation = re.sub(r'\n?```\s*$', '', continuation.strip())

    return {"continuation": continuation, "word_count": len(_strip_html(continuation).split())}


@router.post("/ai-ask")
async def ai_ask_standalone(data: AIAskRequest, user=Depends(get_current_user)):
    """Ask AI anything — research case law, get legal advice (standalone, no draft_id needed)."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    doc_type = data.document_type or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    case_law = []
    research_keywords = ["case law", "citation", "cite", "precedent", "authority", "ruling", "decision", "statute", "law", "act", "section", "research"]
    if any(kw in data.question.lower() for kw in research_keywords):
        search_query = data.question[:200]
        if data.selected_text:
            search_query = data.selected_text[:200]
        case_law = await _search_courtlistener(search_query, jurisdiction)

    case_law_context = ""
    if case_law:
        case_law_context = "\n\nRelevant case law from CourtListener (REAL cases — use these):\n"
        for c in case_law:
            case_law_context += f"- {c['case_name']} ({c['court']}, {c['date']}) — {c['snippet'][:200]}\n  URL: {c['url']}\n"

    draft_context = ""
    if data.draft_content:
        draft_context = f"\n\nCurrent draft content:\n{_strip_html(data.draft_content)[:4000]}"

    selected_context = ""
    if data.selected_text:
        selected_context = f"\n\nSelected text the user is asking about:\n{data.selected_text[:2000]}"

    system_prompt = f"""You are an elite litigation attorney and legal research assistant working inside a legal drafting tool.

You have deep expertise in {jurisdiction or 'international'} law and procedure. You help lawyers by:
1. Researching and citing REAL case law (prefer citations from the provided case law database)
2. Explaining legal concepts and procedure
3. Suggesting specific text to add to their draft (output in HTML when suggesting text: <p>, <h2>, <strong>, <em>)
4. Answering questions about jurisdiction-specific rules
5. Finding relevant statutes and regulations

When citing cases: use REAL citations only. If you're unsure of a citation, clearly mark it as [VERIFY CITATION].
When suggesting draft text: format as HTML so it can be inserted directly into the editor.
Write in {lang}.
{case_law_context}"""

    user_message = f"""Document type: {doc_type}
Jurisdiction: {jurisdiction}
Court: {data.court_name or 'Not specified'}
{draft_context}
{selected_context}

My question:
{data.question}"""

    result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.3)
    result = re.sub(r'^```(?:html|json)?\s*\n?', '', result.strip())
    result = re.sub(r'\n?```\s*$', '', result.strip())

    return {"answer": result, "case_law_results": case_law, "question": data.question}


@router.post("/ai-verify")
async def ai_verify_standalone(data: AIVerifyRequest, user=Depends(get_current_user)):
    """AI reviews the draft for legal accuracy (standalone, no draft_id needed)."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    content = data.content or ""
    if not content.strip():
        raise HTTPException(400, "No content to verify")

    doc_type = data.document_type or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"
    clean_content = _strip_html(content)

    system_prompt = f"""You are an elite appellate judge and legal quality reviewer. You are reviewing a {doc_type} for accuracy, completeness, and legal soundness.

Perform a comprehensive verification and return a list of issues found.

For each issue, provide:
- "type": category (citation, legal_accuracy, structure, logic, procedural)
- "description": clear description of the issue and how to fix it
- "severity": "high", "medium", or "low"

Write in {lang}.
Format as JSON:
{{{{"issues": [{{"type": "...", "description": "...", "severity": "..."}}]}}}}"""

    user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n\nFull draft:\n{clean_content[:8000]}"

    try:
        parsed = await _call_ai_json(system_prompt, user_message, max_tokens=4000, temperature=0.2)
        issues = parsed.get("issues", []) if isinstance(parsed, dict) else []
    except Exception:
        result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.2)
        issues = [{"type": "review", "description": result, "severity": "medium"}]

    return {"issues": issues}


@router.post("/ai-suggest")
async def ai_suggest_standalone(data: AISuggestRequest, user=Depends(get_current_user)):
    """AI-powered suggestions: strengthen text or find what's missing (standalone, no draft_id needed)."""
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    doc_type = data.document_type or "motion"
    jurisdiction = data.jurisdiction or ""
    lang = JURISDICTION_LANGUAGE.get(jurisdiction.upper(), "English") if jurisdiction else "English"

    if data.mode == "strengthen":
        text = data.selected_text or ""
        if not text.strip():
            text = _strip_html(data.full_content or "")
        if not text.strip():
            raise HTTPException(400, "No text to strengthen.")

        system_prompt = f"""You are an elite litigation attorney. Strengthen the legal text to be more persuasive and authoritative.
Add case law citations, stronger legal terms, and sharpen the argument.
Write in {lang}. Return a single string with the strengthened analysis."""

        user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n\nText to strengthen:\n{text[:4000]}"
    else:
        content = data.full_content or ""
        if not content.strip():
            raise HTTPException(400, "No content to analyze")

        clean_content = _strip_html(content)
        system_prompt = f"""You are an elite litigation attorney reviewing a {doc_type} for completeness.
Identify missing sections, weak arguments, missing citations, and procedural gaps.
Be specific and actionable. Write in {lang}. Return a single string summary."""

        user_message = f"Document type: {doc_type}\nJurisdiction: {jurisdiction}\n\nDraft content:\n{clean_content[:6000]}"

    result = await _call_ai(system_prompt, user_message, max_tokens=4000, temperature=0.3)
    return {"suggestions": result}


# ═══════════════════════════════════════════════════════════
# CAPTION PREVIEW — Generate live caption HTML from form data
# ═══════════════════════════════════════════════════════════

@router.post("/caption-preview")
async def caption_preview(data: dict = Body(...), user=Depends(get_current_user)):
    """Generate a live caption preview as the user fills in the intake form.

    This is called on every form field change to update the right-panel preview.
    Pure template logic — no AI call needed, instant response.
    """
    caption_html = generate_caption_html(
        jurisdiction=data.get("jurisdiction", "US"),
        court_name=data.get("court_name", ""),
        court_level=data.get("court_level", ""),
        division=data.get("division", ""),
        location=data.get("location", ""),
        district=data.get("district", ""),
        state=data.get("state", ""),
        parties=data.get("parties", []),
        case_number=data.get("case_number", ""),
        document_type=data.get("document_type", "motion"),
        document_title=data.get("document_title", ""),
        in_the_matter_of=data.get("in_the_matter_of", ""),
    )

    return {"caption_html": caption_html}


# ═══════════════════════════════════════════════════════════
# DOCX EXPORT — Generate court-ready DOCX from draft
# ═══════════════════════════════════════════════════════════

@router.post("/drafts/{draft_id}/export-docx")
async def export_docx(draft_id: str, user=Depends(get_current_user)):
    """Export draft as a court-ready DOCX file using the DOCX builder engine."""
    from fastapi.responses import StreamingResponse
    import io

    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

    draft_d = dict(draft)

    # Parse stored JSON fields
    parties = []
    try:
        parties = json.loads(draft_d.get("parties_json", "[]") or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    caption_data = {}
    try:
        caption_data = json.loads(draft_d.get("caption_data_json", "{}") or "{}")
    except (json.JSONDecodeError, TypeError):
        pass

    financial_data = {}
    try:
        financial_data = json.loads(draft_d.get("financial_data_json", "{}") or "{}")
    except (json.JSONDecodeError, TypeError):
        pass

    # Generate caption data for DOCX if not already stored
    if not caption_data and parties:
        caption_data = generate_caption_for_docx(
            jurisdiction=draft_d.get("jurisdiction", "US") or "US",
            court_name=draft_d.get("court_name", ""),
            court_level=draft_d.get("court_name", ""),
            division=draft_d.get("division", ""),
            location=draft_d.get("location", ""),
            district=draft_d.get("district", ""),
            state=draft_d.get("state", ""),
            parties=parties,
            case_number=draft_d.get("case_number_text", ""),
            document_type=draft_d.get("document_type", "motion"),
            document_title=draft_d.get("title", ""),
            in_the_matter_of=draft_d.get("in_the_matter_of", ""),
        )

    # Build body sections from content HTML using the HTML-to-sections parser
    from app.services.docx_builder import html_to_sections

    body_sections = []

    # First try to get the raw HTML content (which Claude generates)
    content_html = draft_d.get("content", "")

    # Strip the caption HTML from the content to get just the body
    caption_html_stored = draft_d.get("caption_html", "")
    if caption_html_stored and content_html.startswith(caption_html_stored):
        body_html = content_html[len(caption_html_stored):].strip()
    else:
        body_html = content_html

    # Parse HTML into structured sections that _render_body() understands
    if body_html:
        body_sections = html_to_sections(body_html)

    # Fallback: try stored JSON sections if HTML parsing yielded nothing
    if not body_sections:
        try:
            stored = json.loads(draft_d.get("body_sections_json", "[]") or "[]")
            # Only use if they're actual structured sections (dicts), not just section names (strings)
            if stored and isinstance(stored[0], dict):
                body_sections = stored
        except (json.JSONDecodeError, TypeError, IndexError):
            pass

    # Last resort: plain text fallback
    if not body_sections and content_html:
        body_sections = [{
            "type": "paragraph",
            "content": _strip_html(content_html),
        }]

    # Compute financial values if applicable
    financial_values = {}
    if financial_data and financial_data.get("principal"):
        try:
            financial_values = calculate_simple_interest(
                principal=financial_data.get("principal", 0),
                monthly_rate=financial_data.get("monthly_rate", 0),
                trigger_date=financial_data.get("trigger_date", ""),
                calc_date=financial_data.get("calc_date", ""),
            )
        except Exception:
            pass

    # Build DOCX
    doc_buffer = build_docx(
        caption_data=caption_data,
        body_sections=body_sections,
        financials=financial_values if financial_values else None,
    )

    raw_title = draft_d.get('title', 'document').replace(' ', '_')
    # Sanitize filename to ASCII-safe characters for Content-Disposition header
    filename = re.sub(r'[^\w\-.]', '_', raw_title) + ".docx"

    return StreamingResponse(
        io.BytesIO(doc_buffer),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═══════════════════════════════════════════════════════════
# TEMPLATE MANAGEMENT — Upload/retrieve court templates
# ═══════════════════════════════════════════════════════════

@router.post("/templates")
async def upload_template(data: TemplateUploadRequest, user=Depends(get_current_user)):
    """Save a user-uploaded court template."""
    template_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        db.execute(
            """INSERT INTO user_templates (id, user_id, tenant_id, template_name,
               jurisdiction_code, court_name, document_type, template_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (template_id, user["sub"], user["tenant_id"], data.template_name,
             data.jurisdiction_code or "", data.court_name or "",
             data.document_type, json.dumps(data.template_data))
        )
    return {"id": template_id, "message": "Template saved"}


@router.get("/templates")
async def list_templates(user=Depends(get_current_user)):
    """List user's saved templates."""
    with get_db() as db:
        templates = db.execute(
            "SELECT * FROM user_templates WHERE tenant_id = ? ORDER BY created_at DESC",
            (user["tenant_id"],)
        ).fetchall()
    return [dict(t) for t in templates]


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user=Depends(get_current_user)):
    """Get a specific template."""
    with get_db() as db:
        template = db.execute(
            "SELECT * FROM user_templates WHERE id = ? AND tenant_id = ?",
            (template_id, user["tenant_id"])
        ).fetchone()
        if not template:
            raise HTTPException(404, "Template not found")
    return dict(template)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user=Depends(get_current_user)):
    """Delete a template."""
    with get_db() as db:
        db.execute(
            "DELETE FROM user_templates WHERE id = ? AND tenant_id = ?",
            (template_id, user["tenant_id"])
        )
    return {"message": "Template deleted"}


# ═══════════════════════════════════════════════════════════
# CHAT MESSAGES — Dual-pane editing chat history
# ═══════════════════════════════════════════════════════════

@router.get("/drafts/{draft_id}/chat")
async def list_chat_messages(draft_id: str, user=Depends(get_current_user)):
    """List all chat messages for a draft's dual-pane editing session."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        messages = db.execute(
            "SELECT * FROM draft_chat_messages WHERE draft_id = ? ORDER BY created_at ASC",
            (draft_id,)
        ).fetchall()
    return [dict(m) for m in messages]


# ═══════════════════════════════════════════════════════════
# CAPTION TEMPLATES — System-level jurisdiction templates
# ═══════════════════════════════════════════════════════════

@router.get("/caption-templates")
async def list_caption_templates(
    jurisdiction: Optional[str] = None,
    user=Depends(get_current_user)
):
    """List available caption templates, optionally filtered by jurisdiction."""
    with get_db() as db:
        if jurisdiction:
            templates = db.execute(
                "SELECT * FROM caption_templates WHERE jurisdiction_code = ? ORDER BY is_default DESC, court_name ASC",
                (jurisdiction.upper(),)
            ).fetchall()
        else:
            templates = db.execute(
                "SELECT * FROM caption_templates ORDER BY jurisdiction_code ASC, is_default DESC, court_name ASC"
            ).fetchall()
    return [dict(t) for t in templates]


# ═══════════════════════════════════════════════════════════
# MULTI-DOCUMENT UPLOAD & AI ANALYSIS
# ═══════════════════════════════════════════════════════════

@router.post("/upload-documents")
async def upload_documents(
    files: List[UploadFile] = File(...),
    document_type: str = Form("motion"),
    jurisdiction: str = Form(""),
    case_id: str = Form(""),
    user=Depends(get_current_user),
):
    """Upload up to 20 documents. Extract text from each.
    Supports PDF, DOCX, TXT, images (JPG/PNG/TIFF — OCR via OpenAI Vision).
    Returns extracted text per file for AI analysis.
    """
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Maximum {MAX_FILES} files allowed. You uploaded {len(files)}.")

    results = []
    total_size = 0
    errors = []

    for i, file in enumerate(files):
        if not file.filename:
            errors.append({"index": i, "error": "No filename"})
            continue

        if not is_supported_file(file.filename):
            ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "unknown"
            errors.append({
                "index": i,
                "filename": file.filename,
                "error": f"Unsupported file type: .{ext}. Supported: {', '.join(sorted(ALL_SUPPORTED))}",
            })
            continue

        content = await file.read()
        total_size += len(content)

        if total_size > MAX_TOTAL_SIZE:
            errors.append({
                "index": i,
                "filename": file.filename,
                "error": "Total upload size exceeds 100MB limit",
            })
            break

        try:
            text = extract_text_from_bytes(content, file.filename)
            results.append({
                "index": i,
                "filename": file.filename,
                "text": text,
                "char_count": len(text),
                "word_count": len(text.split()),
                "is_image": is_image_file(file.filename),
                "file_size": len(content),
            })
        except Exception as e:
            errors.append({
                "index": i,
                "filename": file.filename,
                "error": str(e),
            })

    return {
        "files": results,
        "total_files": len(results),
        "total_chars": sum(r["char_count"] for r in results),
        "total_words": sum(r["word_count"] for r in results),
        "errors": errors,
    }


@router.post("/upload-voice")
async def upload_voice(
    audio: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Upload voice recording and transcribe via OpenAI Whisper.
    Supports: webm, mp3, wav, m4a, ogg, mp4.
    Returns transcribed text for use as facts input.
    """
    if not audio.filename:
        raise HTTPException(400, "No audio file provided")

    if not is_audio_file(audio.filename or "recording.webm"):
        raise HTTPException(400, "Unsupported audio format. Use webm, mp3, wav, m4a, ogg, or mp4.")

    content = await audio.read()
    if len(content) > 25 * 1024 * 1024:  # Whisper limit is 25MB
        raise HTTPException(400, "Audio file exceeds 25MB limit")

    text = await transcribe_audio(content, audio.filename or "recording.webm")
    return {
        "text": text,
        "word_count": len(text.split()),
        "char_count": len(text),
        "filename": audio.filename,
    }


@router.post("/ai-analyze-documents")
async def ai_analyze_documents(data: dict = Body(...), user=Depends(get_current_user)):
    """Claude analyzes extracted text from multiple documents to generate:
    1. A comprehensive Statement of Facts with chronological timeline
    2. An exhibit list with proper labels per jurisdiction convention

    Input: { "documents": [{"filename": "...", "text": "..."}], "document_type": "...",
             "jurisdiction": "...", "case_id": "..." }
    """
    if get_ai_provider() == "none":
        raise HTTPException(500, "No AI provider configured.")

    documents = data.get("documents", [])
    if not documents:
        raise HTTPException(400, "No documents provided for analysis")

    document_type = data.get("document_type", "motion")
    jurisdiction = data.get("jurisdiction", "US")
    case_id = data.get("case_id", "")

    # Build combined document text for Claude
    doc_texts = []
    for i, doc in enumerate(documents):
        fname = doc.get("filename", f"Document {i+1}")
        text = doc.get("text", "")
        if text.strip():
            doc_texts.append(f"=== DOCUMENT {i+1}: {fname} ===\n{text}\n")

    if not doc_texts:
        raise HTTPException(400, "No extractable text found in any document")

    combined_text = "\n".join(doc_texts)

    # Determine exhibit labeling convention based on jurisdiction
    exhibit_convention = "letters"  # Default: Exhibit A, B, C
    if jurisdiction in ("UG", "KE", "NG", "GH"):
        exhibit_convention = "annexure"  # Annexure 1, 2, 3
    elif jurisdiction in ("GB", "AU"):
        exhibit_convention = "numbered"  # Exhibit 1, 2, 3

    # Also check case-level exhibit numbering preference
    if case_id:
        try:
            with get_db() as db:
                case_row = db.execute(
                    "SELECT exhibit_numbering FROM cases WHERE id = ?", (case_id,)
                ).fetchone()
                if case_row and case_row["exhibit_numbering"]:
                    exhibit_convention = case_row["exhibit_numbering"]
        except Exception:
            pass

    system_prompt = f"""You are an elite litigation attorney and legal analyst with decades of experience drafting court filings. You have been given {len(documents)} documents related to a legal matter.

YOUR PRIMARY TASK: Read EVERY document thoroughly, understand the FULL PICTURE of the dispute, and generate a comprehensive, detailed Statement of Facts that a court would accept without editing.

STEP 1 — DEEP READING & UNDERSTANDING:
- Read EVERY document from start to finish. Do NOT skim or skip any document.
- IDENTIFY THE PARTIES: From contracts, emails, letters — determine who is suing whom and why.
- IDENTIFY THE DISPUTE: From the documents themselves, determine the nature of the legal dispute (breach of contract, fraud, employment, etc.). The documents TELL THE STORY — a contract between two parties + breach correspondence = breach of contract case. Emails exchanged between parties reveal the timeline of events. READ AND UNDERSTAND.
- CROSS-REFERENCE: Connect facts across documents. If Document 1 is a contract and Document 5 is an email about that contract, connect them. If Document 3 shows a payment and Document 7 shows a demand for that payment, connect them.

STEP 2 — EXTRACT EVERY MATERIAL FACT:
From EACH document, extract:
- Specific dates (exact dates, not approximations when the document provides them)
- Specific dollar amounts, percentages, rates
- Names of all persons, entities, and their roles
- Contractual provisions, section numbers, specific obligations
- Actions taken or not taken by each party
- Communications: who said what to whom and when
- Government orders, regulations, or legal requirements referenced
- Failures, breaches, defaults, or omissions by any party

STEP 3 — STATEMENT OF FACTS:
- Write in FORMAL LEGAL LANGUAGE with numbered paragraphs (1, 2, 3, etc.)
- Organize CHRONOLOGICALLY, grouped by logical phases (e.g., "A. Background", "B. Execution of Agreement", "C. Performance", "D. Breach", "E. Demands and Escalation")
- CITE EVERY EXHIBIT: Every factual statement MUST reference the specific exhibit it comes from using (Exhibit A), (Exhibit B), etc. or (See Exhibit A, Exhibit B) for facts supported by multiple documents.
- Be COMPREHENSIVE: The Statement of Facts should contain 20-50+ numbered paragraphs for complex cases. Include EVERY material fact from EVERY document.
- Quote specific contract provisions, email language, and letter text where relevant.
- Include specific amounts, dates, deadlines, interest rates, and calculations found in the documents.
- DO NOT SUMMARIZE VAGUELY. Instead of "the parties communicated," write "On February 4, 2026, ERTC's counsel Diana Campos sent correspondence to Tracy Cowan regarding breach of the Agreement (Exhibit M)."

STEP 4 — EXHIBIT LIST:
- Assign an exhibit label to EVERY uploaded document. If a user uploaded 18 documents, there should be up to 18 exhibits (Exhibit A through Exhibit R).
- ONLY exclude a document if it is a TRUE DUPLICATE of another document already listed, or is completely blank/unreadable.
- When in doubt, INCLUDE the document. Users uploaded these documents for a reason — they are evidence.
- Each exhibit gets a detailed description including what the document is, who created it, when, and what it proves.

EXHIBIT LABELING CONVENTION for this jurisdiction ({jurisdiction}):
- {"Letters: Exhibit A, Exhibit B, Exhibit C, etc." if exhibit_convention == "letters" else ""}
- {"Numbers: Annexure 1, Annexure 2, Annexure 3, etc." if exhibit_convention == "annexure" else ""}
- {"Numbers: Exhibit 1, Exhibit 2, Exhibit 3, etc." if exhibit_convention == "numbered" else ""}

You MUST respond with valid JSON only:
{{
  "dispute_summary": "2-3 sentence summary of what this case is about, derived entirely from reading the documents. Example: 'This is a breach of contract action arising from Defendant's failure to pay consulting fees owed under an ERC Consulting Services Agreement dated May 17, 2023.'",
  "statement_of_facts": "A highly detailed, chronological statement of facts written in formal legal language. Use numbered paragraphs. Organize into lettered subsections (A, B, C, etc.) for logical grouping. Reference EVERY exhibit inline like (Exhibit A) or (See Exhibit A, Exhibit B). Extract SPECIFIC dates, amounts, names, provisions, and obligations from EVERY document. This should be 20-50+ paragraphs for complex cases. DO NOT skip any document's contents.",
  "timeline": [
    {{"date": "YYYY-MM-DD or approximate", "event": "Description of what happened", "source_document": "filename"}}
  ],
  "exhibits": [
    {{
      "label": "Exhibit A or Annexure 1",
      "filename": "original filename",
      "description": "Detailed description (e.g., 'ERC Consulting Services Agreement between ERTC Funding LLC and Robinson Kidz Learning Center LLC, dated May 17, 2023, establishing the scope of services and 20% contingency fee structure')",
      "relevance": "Specific explanation of what this exhibit proves (e.g., 'Establishes the contractual obligations of both parties and the payment terms that were breached')",
      "key_facts_extracted": "List of specific facts extracted from this document",
      "document_type": "contract|email|letter|receipt|photo|medical_record|police_report|invoice|bank_statement|certification|tax_form|legal_memo|demand_letter|correspondence|financial_record|government_order|other"
    }}
  ],
  "excluded_documents": [
    {{
      "filename": "original filename",
      "reason": "Brief explanation — ONLY exclude true duplicates or blank/unreadable documents"
    }}
  ],
  "key_parties": [
    {{"name": "Full Name", "role": "plaintiff|defendant|witness|third_party|counsel", "entity_type": "individual|corporation|llc|government|law_firm|other", "description": "Brief description of this party's role in the dispute"}}
  ],
  "key_amounts": {{
    "principal": 0,
    "has_financial_claim": false,
    "amounts_mentioned": ["$X for Y — specific amounts with context"],
    "interest_details": "Any interest rates, accrual periods, or calculations found in documents",
    "total_claimed": "Total amount being claimed if determinable"
  }},
  "contractual_provisions": ["Key contract terms, section numbers, and obligations identified"],
  "suggested_reliefs": ["Damages", "Specific Performance", "Interest", "Attorney Fees"],
  "suggested_causes_of_action": ["Breach of Contract", "Breach of Implied Covenant of Good Faith"],
  "document_gaps": ["Any missing documents or evidence that should be obtained"],
  "word_count": 0
}}"""

    user_message = f"""You have {len(documents)} documents to analyze for a {document_type} filing in {jurisdiction} jurisdiction.

CRITICAL INSTRUCTIONS:
1. READ EVERY DOCUMENT COMPLETELY. Do not skim. Do not skip.
2. UNDERSTAND THE STORY: These documents together tell the story of a legal dispute. Figure out what happened from the documents themselves.
3. INCLUDE EVERY DOCUMENT as an exhibit unless it is a true duplicate or completely blank. Users uploaded these documents because they are evidence.
4. EXTRACT SPECIFIC FACTS: Dates, amounts, names, provisions, obligations, breaches. Not vague summaries.
5. CROSS-REFERENCE: Connect facts across documents. Show how exhibits relate to each other.
6. COMPREHENSIVE OUTPUT: The Statement of Facts should be DETAILED with 20-50+ numbered paragraphs for complex cases. Each paragraph should cite its source exhibit(s).

DOCUMENTS:
{combined_text[:120000]}

Generate a comprehensive, court-ready Statement of Facts and complete Exhibit List. Every document should be accounted for. Respond with JSON only."""

    try:
        parsed = await _call_ai_json(system_prompt, user_message, max_tokens=16000, temperature=0.2)
    except Exception:
        result = await _call_ai(system_prompt, user_message, max_tokens=16000, temperature=0.2)
        parsed = {"raw_response": result, "error": "Could not parse structured response"}

    return {
        "analysis": parsed,
        "document_count": len(documents),
        "exhibit_convention": exhibit_convention,
    }


# ═══════════════════════════════════════════════════════════
# AI EXTRACT TEXT FROM UPLOADED FILE (legacy single-file)
# ═══════════════════════════════════════════════════════════

@router.post("/ai-extract-text")
async def extract_text_from_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    """Extract text from uploaded PDF/DOCX/TXT for facts input."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = file.filename.lower().rsplit('.', 1)[-1] if '.' in file.filename else ''
    content = await file.read()

    if ext == 'txt' or ext == 'rtf':
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            text = content.decode('latin-1')
    elif ext == 'pdf':
        # Simple PDF text extraction
        try:
            text = _extract_pdf_text(content)
        except Exception:
            text = "[Could not extract text from PDF. Please paste your facts manually.]"
    elif ext in ('docx', 'doc'):
        try:
            text = _extract_docx_text(content)
        except Exception:
            text = "[Could not extract text from document. Please paste your facts manually.]"
    else:
        raise HTTPException(400, f"Unsupported file type: .{ext}. Use .txt, .pdf, or .docx")

    return {"text": text.strip(), "filename": file.filename, "char_count": len(text.strip())}


def _extract_pdf_text(content: bytes) -> str:
    """Basic PDF text extraction without heavy dependencies."""
    import io
    text_parts = []
    # Try to find text between BT and ET operators (basic extraction)
    raw = content.decode('latin-1')
    # Look for text in parentheses after Tj/TJ operators
    matches = re.findall(r'\(([^)]+)\)', raw)
    if matches:
        text_parts = [m for m in matches if len(m) > 1 and not m.startswith('\\')]
    if text_parts:
        return ' '.join(text_parts)
    # Fallback: extract any readable text
    readable = re.sub(r'[^\x20-\x7E\n]', '', raw)
    lines = [l.strip() for l in readable.split('\n') if len(l.strip()) > 20]
    return '\n'.join(lines[:200]) if lines else "[Could not extract text from PDF. Please paste your facts manually.]"


def _extract_docx_text(content: bytes) -> str:
    """Extract text from DOCX (ZIP containing XML)."""
    import zipfile
    import io
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            if 'word/document.xml' in zf.namelist():
                xml_content = zf.read('word/document.xml').decode('utf-8')
                # Extract text between <w:t> tags
                texts = re.findall(r'<w:t[^>]*>([^<]+)</w:t>', xml_content)
                return ' '.join(texts)
    except Exception:
        pass
    return "[Could not extract text from document. Please paste your facts manually.]"


# ═══════════════════════════════════════════════════════════
# COMMENTS
# ═══════════════════════════════════════════════════════════

@router.get("/drafts/{draft_id}/comments")
async def list_comments(draft_id: str, user=Depends(get_current_user)):
    """List all comments on a draft."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        comments = db.execute(
            "SELECT dc.*, u.full_name as author_name FROM draft_comments dc LEFT JOIN users u ON dc.user_id = u.id WHERE dc.draft_id = ? ORDER BY dc.created_at ASC",
            (draft_id,)
        ).fetchall()
        return [dict(c) for c in comments]


@router.post("/drafts/{draft_id}/comments")
async def create_comment(draft_id: str, data: CommentCreateRequest, user=Depends(get_current_user)):
    """Add a comment to a draft."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        comment_id = str(uuid.uuid4())[:12]
        db.execute(
            """INSERT INTO draft_comments (id, draft_id, user_id, content, selection_start, selection_end, selected_text)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (comment_id, draft_id, user["sub"], data.content,
             data.selection_start, data.selection_end, data.selected_text)
        )
    return {"id": comment_id, "message": "Comment added"}


@router.patch("/drafts/comments/{comment_id}/resolve")
async def resolve_comment(comment_id: str, user=Depends(get_current_user)):
    """Mark a comment as resolved."""
    with get_db() as db:
        db.execute(
            "UPDATE draft_comments SET resolved = 1 WHERE id = ?", (comment_id,)
        )
    return {"message": "Comment resolved"}


# ═══════════════════════════════════════════════════════════
# RESEARCH SIDECAR (CourtListener Integration)
# ═══════════════════════════════════════════════════════════

@router.post("/research/search")
async def search_case_law(data: ResearchSearchRequest, user=Depends(get_current_user)):
    """Search CourtListener for case law. Returns ONLY verified cases."""
    results = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://www.courtlistener.com/api/rest/v4/search/",
                params={"q": data.query, "type": "o", "order_by": "score desc"},
                headers={"User-Agent": "LitigationSpace/1.0"}
            )
            if resp.status_code == 200:
                api_data = resp.json()
                for item in (api_data.get("results") or [])[:10]:
                    case_name = item.get("caseName") or item.get("case_name") or "Unknown"
                    citation_str = _format_citation(item)
                    court_name = item.get("court") or ""
                    year = None
                    date_filed = item.get("dateFiled") or item.get("date_filed") or ""
                    if date_filed:
                        try:
                            year = int(date_filed[:4])
                        except (ValueError, IndexError):
                            pass

                    # Determine applicability
                    app_score = _calculate_applicability(
                        court_name, data.jurisdiction, data.case_type
                    )

                    opinion_id = item.get("id") or item.get("cluster_id")
                    cl_url = f"https://www.courtlistener.com/opinion/{opinion_id}/" if opinion_id else None

                    results.append({
                        "case_name": case_name,
                        "citation": citation_str,
                        "court": court_name,
                        "year": year,
                        "good_law_status": "unknown",  # Would need citation graph API for full check
                        "courtlistener_url": cl_url,
                        "courtlistener_id": str(opinion_id) if opinion_id else None,
                        "snippet": (item.get("snippet") or "")[:500],
                        "applicability_score": app_score,
                        "verified": cl_url is not None,
                    })
    except Exception:
        # If CourtListener is down, return empty results rather than error
        pass

    return {"results": results, "query": data.query, "source": "courtlistener"}


@router.post("/drafts/{draft_id}/citations")
async def insert_citation(draft_id: str, data: InsertCitationRequest, user=Depends(get_current_user)):
    """Insert a verified citation into a draft's citation list."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        cit_id = str(uuid.uuid4())[:12]
        db.execute(
            """INSERT INTO research_citations (id, draft_id, case_name, citation, court, year,
               good_law_status, courtlistener_url, courtlistener_id, snippet, applicability_score)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cit_id, draft_id, data.case_name, data.citation, data.court, data.year,
             data.good_law_status, data.courtlistener_url, data.courtlistener_id,
             data.snippet, data.applicability_score)
        )
    return {"id": cit_id, "message": "Citation added"}


@router.get("/drafts/{draft_id}/citations")
async def list_citations(draft_id: str, user=Depends(get_current_user)):
    """List all citations for a draft."""
    with get_db() as db:
        draft = db.execute(
            "SELECT id FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")

        citations = db.execute(
            "SELECT * FROM research_citations WHERE draft_id = ? ORDER BY inserted_at DESC",
            (draft_id,)
        ).fetchall()
        return [dict(c) for c in citations]


@router.delete("/drafts/citations/{citation_id}")
async def delete_citation(citation_id: str, user=Depends(get_current_user)):
    """Remove a citation."""
    with get_db() as db:
        db.execute("DELETE FROM research_citations WHERE id = ?", (citation_id,))
    return {"message": "Citation removed"}


# ═══════════════════════════════════════════════════════════
# CLIENT REVIEW (public endpoint — token-based, no auth)
# ═══════════════════════════════════════════════════════════

@router.get("/review/{token}")
async def get_client_review(token: str):
    """Public endpoint: client views a draft via secure token."""
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE client_review_token = ?", (token,)
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Review link not found or expired")

        # Check expiry
        if draft["client_review_expires"]:
            try:
                expires = datetime.fromisoformat(draft["client_review_expires"])
                if datetime.now(timezone.utc) > expires:
                    raise HTTPException(410, "Review link has expired")
            except (ValueError, TypeError):
                pass

        # Return limited view
        return {
            "title": draft["title"],
            "content": draft["content"],
            "document_type": draft["document_type"],
            "status": draft["status"],
            "court_name": draft["court_name"],
            "word_count": draft["word_count"],
            "version": draft["version"],
        }


# ═══════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════

def _format_citation(item: dict) -> str:
    """Format a CourtListener result into approximate Bluebook citation."""
    case_name = item.get("caseName") or item.get("case_name") or "Unknown"
    citation = item.get("citation") or ""
    if isinstance(citation, list) and citation:
        citation = citation[0]
    elif isinstance(citation, list):
        citation = ""

    # Try to build from available fields
    if not citation:
        court = item.get("court") or ""
        date_filed = item.get("dateFiled") or item.get("date_filed") or ""
        year = date_filed[:4] if date_filed else ""
        citation = f"{case_name}"
        if court or year:
            citation += f" ({court} {year})".strip()

    return citation


def _calculate_applicability(case_court: str, search_jurisdiction: str, case_type: str) -> str:
    """Calculate applicability score based on jurisdiction and topic match."""
    score = 0

    if search_jurisdiction and case_court:
        # Direct jurisdiction match
        if search_jurisdiction.lower() in case_court.lower():
            score += 3
        # Same state/circuit
        elif any(part in case_court.lower() for part in search_jurisdiction.lower().split("_")):
            score += 2
        # Federal court (broadly applicable)
        elif "supreme" in case_court.lower() or "circuit" in case_court.lower():
            score += 1

    # Higher courts are more authoritative
    if "supreme" in (case_court or "").lower():
        score += 2
    elif "circuit" in (case_court or "").lower() or "appeals" in (case_court or "").lower():
        score += 1

    if score >= 4:
        return "high"
    elif score >= 2:
        return "medium"
    return "low"
