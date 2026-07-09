"""
Global Legal Intelligence System — Jurisdiction Router
Capabilities:
1. Jurisdiction registry (12 countries) with lawyer titles, court systems, legal databases
2. Document upload (PDF/DOCX) → parse → chunk → store in knowledge base
3. URL scraping → extract legal content → store in knowledge base
4. RAG search — search knowledge base for relevant content when drafting
5. AI auto-discovery — find relevant jurisdictional documents and suggest to user
6. Citation verification — check every reference against uploaded source law
7. Template publishing — lawyers publish anonymized drafts as community templates
8. Amendment tracking — flag outdated references when new law is uploaded
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from pydantic import BaseModel
from typing import Optional, List
import os
import json
import re
import logging
import hashlib
from datetime import datetime, timezone

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.model_router import get_model_for_task
from app.utils.credits import credit_gate, deduct_credits
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer as _JBearer

_jur_security = _JBearer(auto_error=False)

def _jur_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_jur_security)):
    if not credentials:
        return None
    try:
        from app.utils.auth import decode_token
        return decode_token(credentials.credentials)
    except Exception:
        return None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/jurisdiction", tags=["jurisdiction"])


# ═══════════════════════════════════════════════════════════
# JURISDICTION REGISTRY — 12 countries
# ═══════════════════════════════════════════════════════════

JURISDICTIONS = {
    "US": {
        "code": "US", "name": "United States", "legal_system": "common_law",
        "language": "en", "continent": "North America",
        "lawyer_titles": ["Attorney at Law", "Esquire", "Counselor"],
        "court_hierarchy": ["Supreme Court", "Circuit Courts of Appeals", "District Courts", "State Supreme Courts", "State Appellate Courts", "State Trial Courts"],
        "legal_databases": [
            {"name": "CourtListener", "url": "https://www.courtlistener.com", "type": "case_law", "free": True},
            {"name": "Google Scholar", "url": "https://scholar.google.com", "type": "case_law", "free": True},
            {"name": "Congress.gov", "url": "https://www.congress.gov", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": 25, "font": "Times New Roman", "font_size": 12, "line_spacing": 2.0, "margins": 1.0},
        "currency": "USD",
    },
    "UK": {
        "code": "UK", "name": "United Kingdom", "legal_system": "common_law",
        "language": "en", "continent": "Europe",
        "lawyer_titles": ["Barrister", "Solicitor", "Queen's Counsel (KC)"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal", "High Court", "Crown Court", "County Courts", "Magistrates' Courts"],
        "legal_databases": [
            {"name": "BAILII", "url": "https://www.bailii.org", "type": "case_law", "free": True},
            {"name": "legislation.gov.uk", "url": "https://www.legislation.gov.uk", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "GBP",
    },
    "UG": {
        "code": "UG", "name": "Uganda", "legal_system": "common_law",
        "language": "en", "continent": "Africa",
        "lawyer_titles": ["Advocate", "Counsel", "Senior Counsel"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal / Constitutional Court", "High Court", "Chief Magistrate's Court", "Magistrate Grade I", "Magistrate Grade II"],
        "legal_databases": [
            {"name": "ULII", "url": "https://ulii.org", "type": "case_law", "free": True},
            {"name": "Uganda Gazette", "url": "https://www.ugandagazette.go.ug", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "UGX",
        "special_rules": {
            "election_petition": {
                "presidential_petition_filing_days": 15,
                "presidential_petition_court": "Supreme Court",
                "presidential_petition_determination_days": 45,
                "parliamentary_petition_filing_days": 30,
                "parliamentary_petition_court": "High Court",
                "parliamentary_petition_determination_months": 6,
                "local_govt_petition_filing_days": 30,
                "local_govt_petition_court": "High Court",
                "vote_recount_filing_days": 7,
                "vote_recount_court": "Chief Magistrate's Court",
                "vote_recount_hearing_days": 4,
                "service_deadline_days": 3,
                "governing_law": ["Presidential Elections Act 2005 (Cap. 179)", "Parliamentary Elections Act 2005 (Cap. 177)", "Local Governments Act (Cap. 243)", "Electoral Commission Act (Cap. 140)"],
            }
        },
    },
    "NG": {
        "code": "NG", "name": "Nigeria", "legal_system": "common_law",
        "language": "en", "continent": "Africa",
        "lawyer_titles": ["Learned Counsel", "Senior Advocate of Nigeria (SAN)", "Barrister and Solicitor"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal", "Federal High Court", "National Industrial Court", "State High Courts", "Sharia Courts", "Customary Courts"],
        "legal_databases": [
            {"name": "Nigerian LII", "url": "https://www.nigerialii.org", "type": "case_law", "free": True},
            {"name": "LawNigeria", "url": "https://www.lawnigeria.com", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 14, "line_spacing": 2.0, "margins": 2.54},
        "currency": "NGN",
    },
    "KE": {
        "code": "KE", "name": "Kenya", "legal_system": "common_law",
        "language": "en", "continent": "Africa",
        "lawyer_titles": ["Advocate of the High Court", "Senior Counsel", "Counsel"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal", "High Court", "Environment and Land Court", "Employment and Labour Relations Court", "Magistrates' Courts"],
        "legal_databases": [
            {"name": "Kenya Law", "url": "http://kenyalaw.org", "type": "case_law", "free": True},
            {"name": "Kenya Gazette", "url": "http://kenyalaw.org/kenya_gazette/", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "KES",
    },
    "IN": {
        "code": "IN", "name": "India", "legal_system": "common_law",
        "language": "en", "continent": "Asia",
        "lawyer_titles": ["Advocate", "Senior Advocate", "Advocate on Record"],
        "court_hierarchy": ["Supreme Court", "High Courts", "District Courts", "Tribunals", "Lower Courts"],
        "legal_databases": [
            {"name": "Indian Kanoon", "url": "https://indiankanoon.org", "type": "case_law", "free": True},
            {"name": "India Code", "url": "https://www.indiacode.nic.in", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 14, "line_spacing": 2.0, "margins": 2.54},
        "currency": "INR",
    },
    "ZA": {
        "code": "ZA", "name": "South Africa", "legal_system": "mixed",
        "language": "en", "continent": "Africa",
        "lawyer_titles": ["Advocate", "Attorney", "Senior Counsel (SC)"],
        "court_hierarchy": ["Constitutional Court", "Supreme Court of Appeal", "High Courts", "Magistrates' Courts", "Labour Courts", "Land Claims Court"],
        "legal_databases": [
            {"name": "SAFLII", "url": "http://www.saflii.org", "type": "case_law", "free": True},
            {"name": "South African Government", "url": "https://www.gov.za/documents/acts", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Arial", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "ZAR",
    },
    "GH": {
        "code": "GH", "name": "Ghana", "legal_system": "common_law",
        "language": "en", "continent": "Africa",
        "lawyer_titles": ["Lawyer", "Counsel", "Senior Counsel"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal", "High Court", "Circuit Courts", "District Courts"],
        "legal_databases": [
            {"name": "GhanaLII", "url": "https://ghanaii.org", "type": "case_law", "free": True},
            {"name": "Ghana Laws", "url": "https://laws.ghanalegal.com", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 14, "line_spacing": 2.0, "margins": 2.54},
        "currency": "GHS",
    },
    "CA": {
        "code": "CA", "name": "Canada", "legal_system": "common_law",
        "language": "en", "continent": "North America",
        "lawyer_titles": ["Barrister and Solicitor", "Counsel", "Queen's Counsel (KC)"],
        "court_hierarchy": ["Supreme Court of Canada", "Federal Court of Appeal", "Provincial/Territorial Courts of Appeal", "Superior Courts", "Provincial Courts"],
        "legal_databases": [
            {"name": "CanLII", "url": "https://www.canlii.org", "type": "case_law", "free": True},
            {"name": "Justice Laws", "url": "https://laws-lois.justice.gc.ca", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": 30, "font": "Times New Roman", "font_size": 12, "line_spacing": 2.0, "margins": 2.54},
        "currency": "CAD",
    },
    "AU": {
        "code": "AU", "name": "Australia", "legal_system": "common_law",
        "language": "en", "continent": "Oceania",
        "lawyer_titles": ["Barrister", "Solicitor", "Senior Counsel (SC)"],
        "court_hierarchy": ["High Court of Australia", "Federal Court", "Family Court", "State/Territory Supreme Courts", "District/County Courts", "Magistrates' Courts"],
        "legal_databases": [
            {"name": "AustLII", "url": "http://www.austlii.edu.au", "type": "case_law", "free": True},
            {"name": "Federal Register of Legislation", "url": "https://www.legislation.gov.au", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "AUD",
    },
    "HK": {
        "code": "HK", "name": "Hong Kong", "legal_system": "common_law",
        "language": "en", "continent": "Asia",
        "lawyer_titles": ["Barrister-at-Law", "Solicitor", "Senior Counsel (SC)"],
        "court_hierarchy": ["Court of Final Appeal", "Court of Appeal", "Court of First Instance", "District Court", "Magistrates' Courts"],
        "legal_databases": [
            {"name": "HKLII", "url": "https://www.hklii.hk", "type": "case_law", "free": True},
            {"name": "Hong Kong e-Legislation", "url": "https://www.elegislation.gov.hk", "type": "legislation", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "HKD",
    },
    "IE": {
        "code": "IE", "name": "Ireland", "legal_system": "common_law",
        "language": "en", "continent": "Europe",
        "lawyer_titles": ["Barrister-at-Law", "Solicitor", "Senior Counsel (SC)"],
        "court_hierarchy": ["Supreme Court", "Court of Appeal", "High Court", "Circuit Court", "District Court"],
        "legal_databases": [
            {"name": "Irish LII", "url": "https://www.irishstatutebook.ie", "type": "legislation", "free": True},
            {"name": "Courts.ie", "url": "https://www.courts.ie/judgments", "type": "case_law", "free": True},
        ],
        "filing_rules": {"page_limit_motion": None, "font": "Times New Roman", "font_size": 12, "line_spacing": 1.5, "margins": 2.54},
        "currency": "EUR",
    },
}


# ═══════════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════════

class UrlScrapeRequest(BaseModel):
    url: str
    jurisdiction_code: str
    document_type: Optional[str] = "legislation"
    title: Optional[str] = None

class CitationVerifyRequest(BaseModel):
    citations: List[str]
    jurisdiction_code: str

class AiDiscoverRequest(BaseModel):
    jurisdiction_code: str
    case_type: Optional[str] = None
    topic: Optional[str] = None

class TemplatePublishRequest(BaseModel):
    title: str
    content: str
    jurisdiction_code: str
    document_type: str
    court_level: Optional[str] = None
    tags: Optional[str] = None

class RagSearchRequest(BaseModel):
    query: str
    jurisdiction_code: str
    document_type: Optional[str] = None
    limit: Optional[int] = 5


# ═══════════════════════════════════════════════════════════
# DB INIT — called from main.py lifespan
# ═══════════════════════════════════════════════════════════

JURISDICTION_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS jurisdiction_documents (
    id TEXT PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    title TEXT NOT NULL,
    document_type TEXT DEFAULT 'legislation'
        CHECK(document_type IN ('legislation','case_law','regulation','guideline','court_rule','fee_schedule','template','other')),
    source_url TEXT DEFAULT '',
    source_type TEXT DEFAULT 'upload' CHECK(source_type IN ('upload','scrape','ai_discovered','community')),
    content_text TEXT NOT NULL DEFAULT '',
    content_hash TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_size INTEGER DEFAULT 0,
    language TEXT DEFAULT 'en',
    court_level TEXT DEFAULT '',
    date_enacted TEXT DEFAULT '',
    date_amended TEXT DEFAULT '',
    is_current INTEGER DEFAULT 1,
    is_verified INTEGER DEFAULT 0,
    verified_by TEXT DEFAULT '',
    upload_count INTEGER DEFAULT 1,
    usage_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','superseded','pending_review','rejected')),
    uploaded_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jurisdiction_doc_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    section_title TEXT DEFAULT '',
    tokens INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES jurisdiction_documents(id)
);

CREATE TABLE IF NOT EXISTS jurisdiction_ai_suggestions (
    id TEXT PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    case_type TEXT DEFAULT '',
    topic TEXT DEFAULT '',
    suggested_title TEXT NOT NULL,
    suggested_url TEXT DEFAULT '',
    suggested_type TEXT DEFAULT 'legislation',
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','fetched')),
    user_id TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_templates (
    id TEXT PRIMARY KEY,
    jurisdiction_code TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    document_type TEXT NOT NULL,
    court_level TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    author_id TEXT DEFAULT '',
    author_name TEXT DEFAULT 'Anonymous',
    author_title TEXT DEFAULT '',
    usage_count INTEGER DEFAULT 0,
    rating_sum REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published' CHECK(status IN ('published','pending_review','rejected','archived')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_ratings (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES community_templates(id)
);

CREATE TABLE IF NOT EXISTS user_jurisdiction_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    lawyer_title TEXT DEFAULT '',
    bar_number TEXT DEFAULT '',
    court_system TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, jurisdiction_code)
);

CREATE TABLE IF NOT EXISTS legal_database_downloads (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    user_id TEXT DEFAULT '',
    user_email TEXT DEFAULT '',
    jurisdiction_code TEXT NOT NULL,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','completed','failed','free')),
    payment_ref TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES jurisdiction_documents(id)
);

CREATE TABLE IF NOT EXISTS legal_database_verifications (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    verification_status TEXT DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','rejected','outdated')),
    ai_confidence REAL DEFAULT 0,
    ai_summary TEXT DEFAULT '',
    ai_key_provisions TEXT DEFAULT '',
    ai_citation_format TEXT DEFAULT '',
    verified_by TEXT DEFAULT 'ai',
    verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES jurisdiction_documents(id)
);
"""


def init_jurisdiction_tables():
    """Initialize jurisdiction tables. Called from main.py lifespan."""
    with get_db() as db:
        db.executescript(JURISDICTION_TABLES_SQL)


# ═══════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════

def _chunk_text(text: str, max_tokens: int = 800) -> list:
    """Split text into chunks of approximately max_tokens tokens (~4 chars per token)."""
    max_chars = max_tokens * 4
    paragraphs = text.split("\n\n")
    chunks = []
    current_chunk = ""
    current_section = ""

    for para in paragraphs:
        # Detect section headers
        stripped = para.strip()
        if stripped and len(stripped) < 200 and (
            stripped.isupper() or
            stripped.startswith("Section ") or
            stripped.startswith("Article ") or
            stripped.startswith("Part ") or
            stripped.startswith("Chapter ") or
            re.match(r'^\d+[\.\)]\s', stripped)
        ):
            current_section = stripped[:200]

        if len(current_chunk) + len(para) + 2 > max_chars:
            if current_chunk:
                chunks.append({"content": current_chunk.strip(), "section_title": current_section})
            current_chunk = para
        else:
            current_chunk += "\n\n" + para if current_chunk else para

    if current_chunk.strip():
        chunks.append({"content": current_chunk.strip(), "section_title": current_section})

    return chunks


def _scrape_legal_url(url: str) -> dict:
    """Scrape legal content from a URL. Returns {title, content, success}."""
    import requests
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=20, allow_redirects=True)
        resp.raise_for_status()

        # Try to extract main content
        html = resp.text
        # Remove script and style tags
        html_clean = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
        html_clean = re.sub(r'<style[^>]*>.*?</style>', '', html_clean, flags=re.DOTALL | re.IGNORECASE)
        html_clean = re.sub(r'<nav[^>]*>.*?</nav>', '', html_clean, flags=re.DOTALL | re.IGNORECASE)
        html_clean = re.sub(r'<footer[^>]*>.*?</footer>', '', html_clean, flags=re.DOTALL | re.IGNORECASE)
        html_clean = re.sub(r'<header[^>]*>.*?</header>', '', html_clean, flags=re.DOTALL | re.IGNORECASE)

        # Extract text from HTML
        text = re.sub(r'<[^>]+>', ' ', html_clean)
        text = re.sub(r'\s+', ' ', text).strip()
        # Clean up common artifacts
        text = re.sub(r'&nbsp;', ' ', text)
        text = re.sub(r'&amp;', '&', text)
        text = re.sub(r'&lt;', '<', text)
        text = re.sub(r'&gt;', '>', text)
        text = re.sub(r'&#\d+;', '', text)

        # Try to extract title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else url.split("/")[-1]
        title = re.sub(r'\s+', ' ', title)[:300]

        if len(text) < 100:
            return {"success": False, "error": "Page content too short — may be behind a paywall or require JavaScript"}

        return {"success": True, "title": title, "content": text[:200000]}  # Cap at 200K chars
    except Exception as e:
        return {"success": False, "error": str(e)}





def _repair_json(raw: str) -> dict:
    """Parse JSON, trying to repair truncated output."""
    raw = (raw or "").strip()
    try:
        import json as _j
        return _j.loads(raw)
    except Exception:
        pass
    for suffix in ["]}", "}]", "}}", "}", "]", ""]:
        try:
            import json as _j
            return _j.loads(raw + suffix)
        except Exception:
            pass
    return {}

def _get_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, "AI service temporarily unavailable")
    from openai import OpenAI
    return OpenAI(api_key=api_key)


def _call_openai_json(system_prompt: str, user_message: str, model: str = None,
                      temperature: float = 1.0, max_tokens: int = 3000) -> dict:
    """Call OpenAI and parse JSON response."""
    if model is None:
        model = get_model_for_task("jurisdiction_legal_analysis")
    client = _get_openai_client()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_completion_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        text = (response.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        return json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Failed to parse AI response"}
    except Exception as e:
        logger.error(f"[JURISDICTION] OpenAI error: {e}")
        raise HTTPException(503, f"AI service error: {str(e)}")


# ═══════════════════════════════════════════════════════════
# 1. LIST JURISDICTIONS
# ═══════════════════════════════════════════════════════════

@router.get("/list")
async def list_jurisdictions():
    """List all supported jurisdictions with their metadata."""
    result = []
    with get_db() as db:
        for code, j in JURISDICTIONS.items():
            doc_count = db.execute(
                "SELECT COUNT(*) as cnt FROM jurisdiction_documents WHERE jurisdiction_code = ? AND status = 'active'",
                (code,)
            ).fetchone()["cnt"]
            template_count = db.execute(
                "SELECT COUNT(*) as cnt FROM community_templates WHERE jurisdiction_code = ? AND status = 'published'",
                (code,)
            ).fetchone()["cnt"]
            result.append({
                **j,
                "document_count": doc_count,
                "template_count": template_count,
            })
    return {"jurisdictions": result}


# ═══════════════════════════════════════════════════════════
# 2. GET JURISDICTION DETAIL
# ═══════════════════════════════════════════════════════════

@router.get("/detail/{code}")
async def get_jurisdiction_detail(code: str):
    """Get full detail for a jurisdiction including documents and templates."""
    code = code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(404, f"Jurisdiction '{code}' not found")

    j = JURISDICTIONS[code]
    with get_db() as db:
        documents = [dict(r) for r in db.execute(
            "SELECT id, title, document_type, source_type, source_url, is_verified, usage_count, created_at FROM jurisdiction_documents WHERE jurisdiction_code = ? AND status = 'active' ORDER BY usage_count DESC, created_at DESC LIMIT 50",
            (code,)
        ).fetchall()]
        templates = [dict(r) for r in db.execute(
            "SELECT id, title, document_type, court_level, author_name, usage_count, rating_sum, rating_count, is_verified, created_at FROM community_templates WHERE jurisdiction_code = ? AND status = 'published' ORDER BY usage_count DESC LIMIT 50",
            (code,)
        ).fetchall()]
        # Add avg rating
        for t in templates:
            t["avg_rating"] = round(t["rating_sum"] / t["rating_count"], 1) if t["rating_count"] > 0 else 0
        pending_suggestions = [dict(r) for r in db.execute(
            "SELECT id, suggested_title, suggested_url, suggested_type, reason, status, created_at FROM jurisdiction_ai_suggestions WHERE jurisdiction_code = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 20",
            (code,)
        ).fetchall()]

    return {
        **j,
        "documents": documents,
        "templates": templates,
        "ai_suggestions": pending_suggestions,
    }


# ═══════════════════════════════════════════════════════════
# 3. UPLOAD DOCUMENT (PDF/DOCX/TXT)
# ═══════════════════════════════════════════════════════════

@router.post("/documents/upload")
async def upload_document(
    jurisdiction_code: str = Form(...),
    document_type: str = Form("legislation"),
    title: str = Form(""),
    file: UploadFile = File(...)
):
    """Upload a legal document (PDF, DOCX, or TXT) to the jurisdiction knowledge base."""
    code = jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    content_bytes = await file.read()
    file_size = len(content_bytes)
    filename = file.filename or "uploaded_document"

    # Parse content based on file type
    text = ""
    if filename.lower().endswith(".txt"):
        text = content_bytes.decode("utf-8", errors="replace")
    elif filename.lower().endswith(".pdf"):
        try:
            import io
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(content_bytes))
            pages = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    pages.append(t)
            text = "\n\n".join(pages)
        except Exception as e:
            # Try fallback with pdfminer
            try:
                import io
                from pdfminer.high_level import extract_text as pdf_extract
                text = pdf_extract(io.BytesIO(content_bytes))
            except Exception:
                raise HTTPException(400, f"Could not parse PDF: {e}")
    elif filename.lower().endswith(".docx"):
        try:
            import io
            import docx
            doc = docx.Document(io.BytesIO(content_bytes))
            text = "\n\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        except Exception as e:
            raise HTTPException(400, f"Could not parse DOCX: {e}")
    else:
        # Try as plain text
        text = content_bytes.decode("utf-8", errors="replace")

    if len(text.strip()) < 50:
        raise HTTPException(400, "Document appears to be empty or could not be parsed")

    content_hash = hashlib.md5(text.encode()).hexdigest()

    # Check for duplicates
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM jurisdiction_documents WHERE content_hash = ? AND jurisdiction_code = ?",
            (content_hash, code)
        ).fetchone()
        if existing:
            db.execute("UPDATE jurisdiction_documents SET upload_count = upload_count + 1 WHERE id = ?", (existing["id"],))
            return {"status": "duplicate", "document_id": existing["id"], "message": "This document already exists in the knowledge base"}

        # Create document
        doc_id = generate_id()
        if not title:
            title = filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title()

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """INSERT INTO jurisdiction_documents
               (id, jurisdiction_code, title, document_type, source_type, content_text, content_hash,
                file_name, file_size, language, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'upload', ?, ?, ?, ?, 'en', 'active', ?, ?)""",
            (doc_id, code, title, document_type, text, content_hash, filename, file_size, now, now)
        )

        # Chunk the document
        chunks = _chunk_text(text)
        for i, chunk in enumerate(chunks):
            db.execute(
                "INSERT INTO jurisdiction_doc_chunks (id, document_id, chunk_index, content, section_title, tokens) VALUES (?, ?, ?, ?, ?, ?)",
                (generate_id(), doc_id, i, chunk["content"], chunk.get("section_title", ""), len(chunk["content"]) // 4)
            )

    return {
        "status": "uploaded",
        "document_id": doc_id,
        "title": title,
        "jurisdiction": code,
        "chunks": len(chunks),
        "characters": len(text),
    }


# ═══════════════════════════════════════════════════════════
# 4. SCRAPE URL → KNOWLEDGE BASE
# ═══════════════════════════════════════════════════════════

@router.post("/documents/scrape-url")
async def scrape_url_to_knowledge_base(req: UrlScrapeRequest):
    """Scrape a legal URL and add its content to the jurisdiction knowledge base."""
    code = req.jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    result = _scrape_legal_url(req.url)
    if not result["success"]:
        raise HTTPException(400, f"Could not scrape URL: {result['error']}")

    text = result["content"]
    title = req.title or result.get("title", req.url)
    content_hash = hashlib.md5(text.encode()).hexdigest()

    with get_db() as db:
        # Check for duplicates
        existing = db.execute(
            "SELECT id FROM jurisdiction_documents WHERE content_hash = ? AND jurisdiction_code = ?",
            (content_hash, code)
        ).fetchone()
        if existing:
            db.execute("UPDATE jurisdiction_documents SET upload_count = upload_count + 1 WHERE id = ?", (existing["id"],))
            return {"status": "duplicate", "document_id": existing["id"], "message": "This content already exists in the knowledge base"}

        doc_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """INSERT INTO jurisdiction_documents
               (id, jurisdiction_code, title, document_type, source_type, source_url, content_text, content_hash,
                language, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'scrape', ?, ?, ?, 'en', 'active', ?, ?)""",
            (doc_id, code, title, req.document_type, req.url, text, content_hash, now, now)
        )

        chunks = _chunk_text(text)
        for i, chunk in enumerate(chunks):
            db.execute(
                "INSERT INTO jurisdiction_doc_chunks (id, document_id, chunk_index, content, section_title, tokens) VALUES (?, ?, ?, ?, ?, ?)",
                (generate_id(), doc_id, i, chunk["content"], chunk.get("section_title", ""), len(chunk["content"]) // 4)
            )

    return {
        "status": "scraped",
        "document_id": doc_id,
        "title": title,
        "jurisdiction": code,
        "chunks": len(chunks),
        "characters": len(text),
        "source_url": req.url,
    }


# ═══════════════════════════════════════════════════════════
# 5. RAG SEARCH — search knowledge base
# ═══════════════════════════════════════════════════════════

@router.post("/search")
async def rag_search(req: RagSearchRequest):
    """Search the jurisdiction knowledge base using keyword matching + AI re-ranking."""
    code = req.jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    # Build search query terms
    query_terms = req.query.lower().split()
    like_clauses = " OR ".join(["c.content LIKE ?" for _ in query_terms])
    like_params = [f"%{t}%" for t in query_terms]

    with get_db() as db:
        # Search chunks with keyword matching
        type_filter = ""
        type_params = []
        if req.document_type:
            type_filter = "AND d.document_type = ?"
            type_params = [req.document_type]

        rows = db.execute(
            f"""SELECT c.id, c.content, c.section_title, c.chunk_index,
                       d.id as doc_id, d.title as doc_title, d.document_type, d.source_url, d.is_verified
                FROM jurisdiction_doc_chunks c
                JOIN jurisdiction_documents d ON c.document_id = d.id
                WHERE d.jurisdiction_code = ? AND d.status = 'active'
                {type_filter}
                AND ({like_clauses})
                ORDER BY d.is_verified DESC, d.usage_count DESC
                LIMIT ?""",
            [code] + type_params + like_params + [req.limit * 3]
        ).fetchall()

        results = []
        seen_docs = set()
        for r in rows:
            rd = dict(r)
            if rd["doc_id"] not in seen_docs or len(results) < req.limit:
                # Simple relevance scoring: count how many query terms appear
                content_lower = rd["content"].lower()
                score = sum(1 for t in query_terms if t in content_lower) / len(query_terms)
                results.append({
                    "chunk_id": rd["id"],
                    "content": rd["content"][:1500],
                    "section_title": rd["section_title"],
                    "document_id": rd["doc_id"],
                    "document_title": rd["doc_title"],
                    "document_type": rd["document_type"],
                    "source_url": rd["source_url"],
                    "is_verified": bool(rd["is_verified"]),
                    "relevance_score": round(score, 2),
                })
                seen_docs.add(rd["doc_id"])

        # Sort by relevance
        results.sort(key=lambda x: x["relevance_score"], reverse=True)
        results = results[:req.limit]

        # Update usage counts
        for r in results:
            db.execute("UPDATE jurisdiction_documents SET usage_count = usage_count + 1 WHERE id = ?", (r["document_id"],))

    return {
        "query": req.query,
        "jurisdiction": code,
        "results": results,
        "total_results": len(results),
    }


# ═══════════════════════════════════════════════════════════
# 6. AI AUTO-DISCOVERY — find relevant documents for jurisdiction
# ═══════════════════════════════════════════════════════════

@router.post("/ai-discover")
async def ai_discover_documents(req: AiDiscoverRequest, user: Optional[dict] = Depends(_jur_optional_user)):
    """Use AI to discover and suggest relevant jurisdictional documents, rules, and case law."""
    code = req.jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    j = JURISDICTIONS[code]

    system_prompt = f"""You are a legal research assistant specializing in {j['name']} law.
Your task is to suggest the most important legal documents, statutes, case law, and rules
that a lawyer in {j['name']} would need for their practice.

Return a JSON object with this structure:
{{
  "suggestions": [
    {{
      "title": "Full title of the document/law/case",
      "type": "legislation|case_law|regulation|guideline|court_rule|fee_schedule",
      "url": "URL where this document can be found (if known, otherwise empty string)",
      "reason": "Brief explanation of why this is important",
      "priority": "high|medium|low"
    }}
  ]
}}

Focus on:
1. Key legislation and statutes for the specified case type or topic
2. Landmark case law that establishes important precedents
3. Court rules and procedural requirements
4. Filing fee schedules
5. Practice directions and guidelines

Known legal databases for {j['name']}: {json.dumps([d['name'] + ' (' + d['url'] + ')' for d in j.get('legal_databases', [])])}

Provide 5-10 suggestions, prioritized by importance."""

    topic_str = ""
    if req.case_type:
        topic_str += f"Case type: {req.case_type}\n"
    if req.topic:
        topic_str += f"Topic/area: {req.topic}\n"

    user_msg = f"Jurisdiction: {j['name']}\n{topic_str}\nSuggest the most critical legal documents, statutes, and case law needed."

    _jur_model = get_model_for_task("jurisdiction_suggestions")
    _jur_cost, _jur_status = 5, None
    if user:
        with get_db() as _db:
            _jur_model, _jur_cost = credit_gate(user["sub"], "jurisdiction_suggestions", _db)
            _jur_status = _db.execute("SELECT subscription_status FROM users WHERE id=?", (user["sub"],)).fetchone()["subscription_status"]

    result = _call_openai_json(system_prompt, user_msg, model=_jur_model, max_tokens=3000)
    if user and _jur_status:
        with get_db() as _db:
            deduct_credits(user["sub"], _jur_status, _jur_cost, "jurisdiction_suggestions", _db)
    suggestions = result.get("suggestions", [])

    # Save suggestions to database
    saved = []
    with get_db() as db:
        for s in suggestions:
            suggestion_id = generate_id()
            db.execute(
                """INSERT INTO jurisdiction_ai_suggestions
                   (id, jurisdiction_code, case_type, topic, suggested_title, suggested_url, suggested_type, reason, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
                (suggestion_id, code, req.case_type or "", req.topic or "",
                 s.get("title", ""), s.get("url", ""), s.get("type", "legislation"),
                 s.get("reason", ""), datetime.now(timezone.utc).isoformat())
            )
            saved.append({
                "id": suggestion_id,
                "title": s.get("title", ""),
                "type": s.get("type", "legislation"),
                "url": s.get("url", ""),
                "reason": s.get("reason", ""),
                "priority": s.get("priority", "medium"),
                "status": "pending",
            })

    return {
        "jurisdiction": code,
        "case_type": req.case_type,
        "topic": req.topic,
        "suggestions": saved,
        "message": f"Found {len(saved)} relevant documents for {j['name']}. Approve them to add to your knowledge base.",
    }


# ═══════════════════════════════════════════════════════════
# 7. APPROVE/REJECT AI SUGGESTION
# ═══════════════════════════════════════════════════════════

@router.post("/ai-discover/{suggestion_id}/approve")
async def approve_suggestion(suggestion_id: str):
    """Approve an AI suggestion — if it has a URL, auto-scrape and add to knowledge base."""
    with get_db() as db:
        suggestion = db.execute(
            "SELECT * FROM jurisdiction_ai_suggestions WHERE id = ?", (suggestion_id,)
        ).fetchone()
        if not suggestion:
            raise HTTPException(404, "Suggestion not found")

        s = dict(suggestion)
        if s["status"] != "pending":
            return {"status": s["status"], "message": "Suggestion already processed"}

        # If URL provided, try to scrape
        if s["suggested_url"]:
            result = _scrape_legal_url(s["suggested_url"])
            if result["success"]:
                text = result["content"]
                content_hash = hashlib.md5(text.encode()).hexdigest()
                doc_id = generate_id()
                now = datetime.now(timezone.utc).isoformat()

                db.execute(
                    """INSERT INTO jurisdiction_documents
                       (id, jurisdiction_code, title, document_type, source_type, source_url, content_text, content_hash,
                        language, status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, 'ai_discovered', ?, ?, ?, 'en', 'active', ?, ?)""",
                    (doc_id, s["jurisdiction_code"], s["suggested_title"],
                     s["suggested_type"], s["suggested_url"], text, content_hash, now, now)
                )

                chunks = _chunk_text(text)
                for i, chunk in enumerate(chunks):
                    db.execute(
                        "INSERT INTO jurisdiction_doc_chunks (id, document_id, chunk_index, content, section_title, tokens) VALUES (?, ?, ?, ?, ?, ?)",
                        (generate_id(), doc_id, i, chunk["content"], chunk.get("section_title", ""), len(chunk["content"]) // 4)
                    )

                db.execute("UPDATE jurisdiction_ai_suggestions SET status = 'fetched' WHERE id = ?", (suggestion_id,))
                return {
                    "status": "fetched",
                    "document_id": doc_id,
                    "title": s["suggested_title"],
                    "chunks": len(chunks),
                    "message": f"Scraped and added '{s['suggested_title']}' to the knowledge base",
                }

        # If no URL or scrape failed, still create the document with available metadata
        # and use AI to generate a summary so it appears in the Legal Database automatically
        doc_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()

        # Generate a placeholder content using AI if possible
        ai_content = ""
        try:
            client = _get_openai_client()
            if client:
                ai_resp = client.chat.completions.create(
                    model=get_model_for_task("jurisdiction_summary"),
                    messages=[{"role": "system", "content": "You are a legal document summariser. Given a legal document title and jurisdiction, provide a structured overview including: purpose, key sections, applicability, and significance. Write in formal legal style."}, {"role": "user", "content": f"Title: {s['suggested_title']}\nJurisdiction: {s['jurisdiction_code']}\nType: {s['suggested_type']}\n\nProvide a detailed overview of this legal document."}],
                    max_completion_tokens=1000,
                )
                ai_content = ai_resp.choices[0].message.content or ""
        except Exception:
            ai_content = f"Overview of {s['suggested_title']} — {s['suggested_type']} from {s['jurisdiction_code']} jurisdiction."

        content_text = ai_content or f"{s['suggested_title']} — {s['suggested_type']} document from {s['jurisdiction_code']} jurisdiction."
        content_hash = hashlib.md5(content_text.encode()).hexdigest()

        db.execute(
            """INSERT INTO jurisdiction_documents
               (id, jurisdiction_code, title, document_type, source_type, source_url, content_text, content_hash,
                language, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'ai_discovered', ?, ?, ?, 'en', 'active', ?, ?)""",
            (doc_id, s["jurisdiction_code"], s["suggested_title"],
             s["suggested_type"], s.get("suggested_url", ""), content_text, content_hash, now, now)
        )

        chunks = _chunk_text(content_text)
        for i, chunk in enumerate(chunks):
            db.execute(
                "INSERT INTO jurisdiction_doc_chunks (id, document_id, chunk_index, content, section_title, tokens) VALUES (?, ?, ?, ?, ?, ?)",
                (generate_id(), doc_id, i, chunk["content"], chunk.get("section_title", ""), len(chunk["content"]) // 4)
            )

        db.execute("UPDATE jurisdiction_ai_suggestions SET status = 'fetched' WHERE id = ?", (suggestion_id,))
        return {
            "status": "fetched",
            "document_id": doc_id,
            "title": s["suggested_title"],
            "chunks": len(chunks),
            "message": f"Auto-created '{s['suggested_title']}' in the Legal Database with AI-generated overview",
        }


@router.post("/ai-discover/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: str):
    """Reject an AI suggestion."""
    with get_db() as db:
        db.execute("UPDATE jurisdiction_ai_suggestions SET status = 'rejected' WHERE id = ?", (suggestion_id,))
    return {"status": "rejected"}


# ═══════════════════════════════════════════════════════════
# 8. CITATION VERIFICATION
# ═══════════════════════════════════════════════════════════

@router.post("/verify-citations")
async def verify_citations(req: CitationVerifyRequest, user: Optional[dict] = Depends(_jur_optional_user)):
    """Verify legal citations against the jurisdiction knowledge base."""
    code = req.jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    results = []
    with get_db() as db:
        for citation in req.citations:
            # Search for the citation in the knowledge base
            search_terms = citation.lower().split()[:5]  # Use first 5 words
            like_clauses = " AND ".join(["c.content LIKE ?" for _ in search_terms])
            like_params = [f"%{t}%" for t in search_terms]

            matches = db.execute(
                f"""SELECT c.content, c.section_title, d.title as doc_title, d.is_verified, d.source_url
                    FROM jurisdiction_doc_chunks c
                    JOIN jurisdiction_documents d ON c.document_id = d.id
                    WHERE d.jurisdiction_code = ? AND d.status = 'active'
                    AND ({like_clauses})
                    LIMIT 3""",
                [code] + like_params
            ).fetchall()

            if matches:
                best = dict(matches[0])
                results.append({
                    "citation": citation,
                    "verified": True,
                    "confidence": "high" if best["is_verified"] else "medium",
                    "source_document": best["doc_title"],
                    "source_url": best["source_url"],
                    "matching_text": best["content"][:500],
                })
            else:
                results.append({
                    "citation": citation,
                    "verified": False,
                    "confidence": "low",
                    "source_document": None,
                    "source_url": None,
                    "warning": "Could not verify this citation against the knowledge base. Please check manually.",
                })

    verified_count = sum(1 for r in results if r["verified"])
    return {
        "jurisdiction": code,
        "total_citations": len(req.citations),
        "verified": verified_count,
        "unverified": len(req.citations) - verified_count,
        "results": results,
    }


# ═══════════════════════════════════════════════════════════
# 9. COMMUNITY TEMPLATES
# ═══════════════════════════════════════════════════════════

@router.post("/templates/publish")
async def publish_template(req: TemplatePublishRequest, user=Depends(get_current_user)):
    """Publish a draft as a community template for other lawyers to use."""
    code = req.jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    user_id = user["sub"]
    with get_db() as db:
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        author_name = user_row["full_name"] if user_row else "Anonymous"

        # Check user's jurisdiction preference for title
        pref = db.execute(
            "SELECT lawyer_title FROM user_jurisdiction_preferences WHERE user_id = ? AND jurisdiction_code = ?",
            (user_id, code)
        ).fetchone()
        author_title = pref["lawyer_title"] if pref else ""

        template_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """INSERT INTO community_templates
               (id, jurisdiction_code, title, content, document_type, court_level, tags,
                author_id, author_name, author_title, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)""",
            (template_id, code, req.title, req.content, req.document_type,
             req.court_level or "", req.tags or "", user_id, author_name, author_title, now, now)
        )

    return {
        "status": "published",
        "template_id": template_id,
        "message": f"Template published to {JURISDICTIONS[code]['name']} community library",
    }


@router.get("/templates")
async def list_templates(
    jurisdiction_code: str = Query(...),
    document_type: Optional[str] = None,
    page: int = 1,
):
    """List community templates for a jurisdiction."""
    code = jurisdiction_code.upper()
    limit = 20
    offset = (page - 1) * limit

    with get_db() as db:
        type_filter = ""
        params = [code]
        if document_type:
            type_filter = "AND document_type = ?"
            params.append(document_type)

        templates = [dict(r) for r in db.execute(
            f"""SELECT id, title, document_type, court_level, tags, author_name, author_title,
                       usage_count, rating_sum, rating_count, is_verified, created_at
                FROM community_templates
                WHERE jurisdiction_code = ? AND status = 'published' {type_filter}
                ORDER BY is_verified DESC, usage_count DESC, created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset]
        ).fetchall()]

        for t in templates:
            t["avg_rating"] = round(t["rating_sum"] / t["rating_count"], 1) if t["rating_count"] > 0 else 0

    return {"templates": templates, "page": page}


@router.get("/templates/{template_id}")
async def get_template(template_id: str):
    """Get a community template by ID."""
    with get_db() as db:
        template = db.execute("SELECT * FROM community_templates WHERE id = ?", (template_id,)).fetchone()
        if not template:
            raise HTTPException(404, "Template not found")

        # Increment usage count
        db.execute("UPDATE community_templates SET usage_count = usage_count + 1 WHERE id = ?", (template_id,))

        t = dict(template)
        t["avg_rating"] = round(t["rating_sum"] / t["rating_count"], 1) if t["rating_count"] > 0 else 0
    return t


@router.post("/templates/{template_id}/rate")
async def rate_template(template_id: str, rating: int = Query(..., ge=1, le=5), review: str = "", user=Depends(get_current_user)):
    """Rate a community template."""
    user_id = user["sub"]
    with get_db() as db:
        # Check if already rated
        existing = db.execute(
            "SELECT id FROM template_ratings WHERE template_id = ? AND user_id = ?",
            (template_id, user_id)
        ).fetchone()
        if existing:
            raise HTTPException(400, "You have already rated this template")

        db.execute(
            "INSERT INTO template_ratings (id, template_id, user_id, rating, review, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (generate_id(), template_id, user_id, rating, review, datetime.now(timezone.utc).isoformat())
        )
        db.execute(
            "UPDATE community_templates SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?",
            (rating, template_id)
        )

    return {"status": "rated", "rating": rating}


# ═══════════════════════════════════════════════════════════
# 10. USER JURISDICTION PREFERENCES
# ═══════════════════════════════════════════════════════════

@router.post("/preferences")
async def set_jurisdiction_preference(
    jurisdiction_code: str,
    lawyer_title: str = "",
    bar_number: str = "",
    court_system: str = "",
    user=Depends(get_current_user)
):
    """Set user's jurisdiction preference (title, bar number, etc.)."""
    code = jurisdiction_code.upper()
    if code not in JURISDICTIONS:
        raise HTTPException(400, f"Unsupported jurisdiction: {code}")

    user_id = user["sub"]
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM user_jurisdiction_preferences WHERE user_id = ? AND jurisdiction_code = ?",
            (user_id, code)
        ).fetchone()

        if existing:
            db.execute(
                """UPDATE user_jurisdiction_preferences SET lawyer_title = ?, bar_number = ?, court_system = ?
                   WHERE user_id = ? AND jurisdiction_code = ?""",
                (lawyer_title, bar_number, court_system, user_id, code)
            )
        else:
            db.execute(
                """INSERT INTO user_jurisdiction_preferences (id, user_id, jurisdiction_code, lawyer_title, bar_number, court_system, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (generate_id(), user_id, code, lawyer_title, bar_number, court_system,
                 datetime.now(timezone.utc).isoformat())
            )

    return {"status": "saved", "jurisdiction": code, "lawyer_title": lawyer_title}


@router.get("/preferences")
async def get_jurisdiction_preferences(user=Depends(get_current_user)):
    """Get user's jurisdiction preferences."""
    user_id = user["sub"]
    with get_db() as db:
        prefs = [dict(r) for r in db.execute(
            "SELECT * FROM user_jurisdiction_preferences WHERE user_id = ?", (user_id,)
        ).fetchall()]
    return {"preferences": prefs}


# ═══════════════════════════════════════════════════════════
# 11. KNOWLEDGE BASE STATS
# ═══════════════════════════════════════════════════════════

@router.get("/stats")
async def get_knowledge_base_stats():
    """Get overall knowledge base statistics."""
    with get_db() as db:
        total_docs = db.execute("SELECT COUNT(*) as cnt FROM jurisdiction_documents WHERE status = 'active'").fetchone()["cnt"]
        total_chunks = db.execute("SELECT COUNT(*) as cnt FROM jurisdiction_doc_chunks").fetchone()["cnt"]
        total_templates = db.execute("SELECT COUNT(*) as cnt FROM community_templates WHERE status = 'published'").fetchone()["cnt"]
        total_suggestions = db.execute("SELECT COUNT(*) as cnt FROM jurisdiction_ai_suggestions WHERE status = 'pending'").fetchone()["cnt"]

        by_jurisdiction = [dict(r) for r in db.execute(
            """SELECT jurisdiction_code, COUNT(*) as doc_count,
                      SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count
               FROM jurisdiction_documents WHERE status = 'active' GROUP BY jurisdiction_code"""
        ).fetchall()]

        by_type = [dict(r) for r in db.execute(
            "SELECT document_type, COUNT(*) as cnt FROM jurisdiction_documents WHERE status = 'active' GROUP BY document_type"
        ).fetchall()]

    return {
        "total_documents": total_docs,
        "total_chunks": total_chunks,
        "total_templates": total_templates,
        "pending_suggestions": total_suggestions,
        "by_jurisdiction": by_jurisdiction,
        "by_type": by_type,
        "supported_jurisdictions": len(JURISDICTIONS),
    }


# ═══════════════════════════════════════════════════════════
# 12. DELETE DOCUMENT
# ═══════════════════════════════════════════════════════════

@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """Remove a document from the knowledge base."""
    with get_db() as db:
        db.execute("DELETE FROM jurisdiction_doc_chunks WHERE document_id = ?", (document_id,))
        db.execute("DELETE FROM jurisdiction_documents WHERE id = ?", (document_id,))
    return {"status": "deleted"}


# ═══════════════════════════════════════════════════════════
# 13. GET DOCUMENT CONTENT
# ═══════════════════════════════════════════════════════════

@router.get("/documents/{document_id}")
async def get_document(document_id: str):
    """Get a document's full content and chunks."""
    with get_db() as db:
        doc = db.execute("SELECT * FROM jurisdiction_documents WHERE id = ?", (document_id,)).fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")
        d = dict(doc)
        chunks = [dict(r) for r in db.execute(
            "SELECT id, chunk_index, content, section_title FROM jurisdiction_doc_chunks WHERE document_id = ? ORDER BY chunk_index",
            (document_id,)
        ).fetchall()]
        d["chunks"] = chunks
        # Don't send full content_text to save bandwidth — chunks are enough
        d.pop("content_text", None)
    return d


# ═══════════════════════════════════════════════════════════
# LEGAL DATABASE — PUBLIC LIBRARY
# ═══════════════════════════════════════════════════════════

# Download pricing per jurisdiction (in local currency)
DOWNLOAD_PRICING = {
    "US": {"currency": "USD", "symbol": "$", "price_legislation": 4.99, "price_case_law": 3.99, "price_regulation": 2.99, "price_other": 1.99},
    "UK": {"currency": "GBP", "symbol": "\u00a3", "price_legislation": 3.99, "price_case_law": 2.99, "price_regulation": 2.49, "price_other": 1.49},
    "UG": {"currency": "UGX", "symbol": "UGX", "price_legislation": 15000, "price_case_law": 10000, "price_regulation": 8000, "price_other": 5000},
    "NG": {"currency": "NGN", "symbol": "\u20a6", "price_legislation": 5000, "price_case_law": 3500, "price_regulation": 2500, "price_other": 1500},
    "KE": {"currency": "KES", "symbol": "KES", "price_legislation": 500, "price_case_law": 350, "price_regulation": 250, "price_other": 150},
    "IN": {"currency": "INR", "symbol": "\u20b9", "price_legislation": 299, "price_case_law": 199, "price_regulation": 149, "price_other": 99},
    "ZA": {"currency": "ZAR", "symbol": "R", "price_legislation": 79, "price_case_law": 59, "price_regulation": 39, "price_other": 29},
    "GH": {"currency": "GHS", "symbol": "GHS", "price_legislation": 30, "price_case_law": 20, "price_regulation": 15, "price_other": 10},
    "CA": {"currency": "CAD", "symbol": "C$", "price_legislation": 5.99, "price_case_law": 4.49, "price_regulation": 3.49, "price_other": 2.49},
    "AU": {"currency": "AUD", "symbol": "A$", "price_legislation": 6.99, "price_case_law": 4.99, "price_regulation": 3.99, "price_other": 2.99},
    "HK": {"currency": "HKD", "symbol": "HK$", "price_legislation": 39, "price_case_law": 29, "price_regulation": 19, "price_other": 14},
    "IE": {"currency": "EUR", "symbol": "\u20ac", "price_legislation": 4.49, "price_case_law": 3.49, "price_regulation": 2.49, "price_other": 1.99},
}


def _get_download_price(jurisdiction_code: str, document_type: str) -> dict:
    """Get download price for a document type in local currency."""
    pricing = DOWNLOAD_PRICING.get(jurisdiction_code, DOWNLOAD_PRICING["US"])
    price_key = f"price_{document_type}" if f"price_{document_type}" in pricing else "price_other"
    return {
        "currency": pricing["currency"],
        "symbol": pricing["symbol"],
        "amount": pricing.get(price_key, pricing["price_other"]),
    }


@router.get("/legal-database/browse")
async def browse_legal_database(
    jurisdiction_code: str = Query(default="", description="Filter by jurisdiction code"),
    document_type: str = Query(default="", description="Filter by document type"),
    search: str = Query(default="", description="Search by title"),
    verified_only: bool = Query(default=False, description="Only show verified documents"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """PUBLIC endpoint — browse the legal database without auth. Free to overview, costs to download."""
    offset = (page - 1) * limit

    conditions = ["d.status = 'active'"]
    params: list = []

    if jurisdiction_code:
        conditions.append("d.jurisdiction_code = ?")
        params.append(jurisdiction_code.upper())
    if document_type:
        conditions.append("d.document_type = ?")
        params.append(document_type)
    if verified_only:
        conditions.append("d.is_verified = 1")
    if search:
        conditions.append("d.title LIKE ?")
        params.append(f"%{search}%")

    where = " AND ".join(conditions)

    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM jurisdiction_documents d WHERE {where}", params).fetchone()[0]

        rows = db.execute(
            f"""SELECT d.id, d.jurisdiction_code, d.title, d.document_type, d.source_type,
                       d.source_url, d.is_verified, d.usage_count, d.court_level,
                       d.date_enacted, d.date_amended, d.is_current, d.file_size,
                       d.created_at, d.language,
                       v.verification_status, v.ai_confidence, v.ai_summary,
                       v.ai_key_provisions, v.ai_citation_format
                FROM jurisdiction_documents d
                LEFT JOIN legal_database_verifications v ON v.document_id = d.id
                WHERE {where}
                ORDER BY d.is_verified DESC, d.usage_count DESC, d.created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset]
        ).fetchall()

        # Jurisdiction stats
        jur_stats = db.execute(
            """SELECT jurisdiction_code, COUNT(*) as count,
                      SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count
               FROM jurisdiction_documents WHERE status = 'active'
               GROUP BY jurisdiction_code"""
        ).fetchall()

    documents = []
    for r in rows:
        rd = dict(r)
        jcode = rd["jurisdiction_code"]
        pricing = _get_download_price(jcode, rd["document_type"])
        j_info = JURISDICTIONS.get(jcode, {})

        # Build preview (first 300 chars of content won't be sent — just metadata)
        documents.append({
            "id": rd["id"],
            "jurisdiction_code": jcode,
            "jurisdiction_name": j_info.get("name", jcode),
            "title": rd["title"],
            "document_type": rd["document_type"],
            "source_type": rd["source_type"],
            "source_url": rd["source_url"] or "",
            "is_verified": bool(rd["is_verified"]),
            "verification_status": rd["verification_status"] or "unverified",
            "ai_confidence": rd["ai_confidence"] or 0,
            "ai_summary": rd["ai_summary"] or "",
            "ai_key_provisions": rd["ai_key_provisions"] or "",
            "ai_citation_format": rd["ai_citation_format"] or "",
            "usage_count": rd["usage_count"],
            "court_level": rd["court_level"] or "",
            "date_enacted": rd["date_enacted"] or "",
            "file_size": rd["file_size"] or 0,
            "created_at": rd["created_at"],
            "download_price": pricing,
        })

    jurisdictions_summary = []
    for js in jur_stats:
        jsd = dict(js)
        j_info = JURISDICTIONS.get(jsd["jurisdiction_code"], {})
        jurisdictions_summary.append({
            "code": jsd["jurisdiction_code"],
            "name": j_info.get("name", jsd["jurisdiction_code"]),
            "total_documents": jsd["count"],
            "verified_documents": jsd["verified_count"],
            "currency": j_info.get("currency", "USD"),
        })

    return {
        "documents": documents,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if limit else 1,
        "jurisdictions_summary": jurisdictions_summary,
    }


@router.get("/legal-database/document/{document_id}/preview")
async def preview_legal_document(document_id: str):
    """PUBLIC endpoint — preview a document (limited content, free). Full download requires payment."""
    with get_db() as db:
        doc = db.execute(
            """SELECT d.*, v.verification_status, v.ai_confidence, v.ai_summary,
                      v.ai_key_provisions, v.ai_citation_format
               FROM jurisdiction_documents d
               LEFT JOIN legal_database_verifications v ON v.document_id = d.id
               WHERE d.id = ? AND d.status = 'active'""",
            (document_id,)
        ).fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")

        d = dict(doc)
        jcode = d["jurisdiction_code"]
        j_info = JURISDICTIONS.get(jcode, {})
        pricing = _get_download_price(jcode, d["document_type"])

        # Get first 3 chunks as preview (free)
        chunks = [dict(r) for r in db.execute(
            """SELECT id, chunk_index, content, section_title
               FROM jurisdiction_doc_chunks WHERE document_id = ?
               ORDER BY chunk_index LIMIT 3""",
            (document_id,)
        ).fetchall()]

        total_chunks = db.execute(
            "SELECT COUNT(*) FROM jurisdiction_doc_chunks WHERE document_id = ?",
            (document_id,)
        ).fetchone()[0]

        # Track view count
        db.execute("UPDATE jurisdiction_documents SET usage_count = usage_count + 1 WHERE id = ?", (document_id,))

    return {
        "id": d["id"],
        "jurisdiction_code": jcode,
        "jurisdiction_name": j_info.get("name", jcode),
        "title": d["title"],
        "document_type": d["document_type"],
        "source_type": d["source_type"],
        "source_url": d["source_url"] or "",
        "is_verified": bool(d["is_verified"]),
        "verification_status": d.get("verification_status") or "unverified",
        "ai_confidence": d.get("ai_confidence") or 0,
        "ai_summary": d.get("ai_summary") or "",
        "ai_key_provisions": d.get("ai_key_provisions") or "",
        "ai_citation_format": d.get("ai_citation_format") or "",
        "court_level": d["court_level"] or "",
        "date_enacted": d["date_enacted"] or "",
        "date_amended": d["date_amended"] or "",
        "file_size": d["file_size"] or 0,
        "created_at": d["created_at"],
        "preview_chunks": chunks,
        "total_chunks": total_chunks,
        "preview_limit": 3,
        "full_content_locked": total_chunks > 3,
        "download_price": pricing,
        "lawyer_titles": j_info.get("lawyer_titles", []),
        "court_hierarchy": j_info.get("court_hierarchy", []),
    }


@router.post("/legal-database/ai-verify/{document_id}")
async def ai_verify_document(document_id: str):
    """Run AI verification on a document — checks authenticity, extracts key provisions, generates citation format."""
    with get_db() as db:
        doc = db.execute(
            "SELECT id, title, document_type, jurisdiction_code, content_text FROM jurisdiction_documents WHERE id = ?",
            (document_id,)
        ).fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")

        d = dict(doc)
        jcode = d["jurisdiction_code"]
        j_info = JURISDICTIONS.get(jcode, {})
        content_preview = d["content_text"][:6000] if d["content_text"] else ""

        if not content_preview:
            # Get from chunks instead
            chunks = db.execute(
                "SELECT content FROM jurisdiction_doc_chunks WHERE document_id = ? ORDER BY chunk_index LIMIT 8",
                (document_id,)
            ).fetchall()
            content_preview = "\n\n".join(r["content"] for r in chunks)[:6000]

        if not content_preview:
            raise HTTPException(400, "Document has no content to verify")

        system_prompt = f"""You are a legal document verification specialist for {j_info.get('name', jcode)}.
Analyze the following legal document and provide a verification assessment.

Return a JSON object with:
{{
    "is_authentic": true/false,
    "confidence": 0.0-1.0,
    "summary": "Brief 2-3 sentence summary of what this document covers",
    "key_provisions": "Comma-separated list of the 5-8 most important provisions/sections",
    "citation_format": "The correct legal citation format for this document (e.g. 'Presidential Elections Act, Cap 142, Laws of Uganda')",
    "document_type_confirmed": "legislation|case_law|regulation|guideline|court_rule|fee_schedule|other",
    "currency_of_jurisdiction": "{j_info.get('currency', 'USD')}",
    "concerns": "Any concerns about authenticity or accuracy (empty string if none)",
    "year": "Year of enactment/publication if detectable, otherwise empty"
}}

Be rigorous. Check for:
1. Correct legal formatting for {j_info.get('name', jcode)}
2. Consistent section numbering
3. Proper legal language
4. References to existing laws/cases
5. Date consistency"""

        user_msg = f"Document title: {d['title']}\nType: {d['document_type']}\nJurisdiction: {j_info.get('name', jcode)}\n\nContent:\n{content_preview}"

        try:
            _vcite_model = get_model_for_task("jurisdiction_verification")
            if user:
                with get_db() as _vdb:
                    _vcite_model, _vcite_cost = credit_gate(user["sub"], "jurisdiction_verification", _vdb)
                    _vcite_status = _vdb.execute("SELECT subscription_status FROM users WHERE id=?", (user["sub"],)).fetchone()["subscription_status"]
                    deduct_credits(user["sub"], _vcite_status, _vcite_cost, "jurisdiction_verification", _vdb)
            result = _call_openai_json(system_prompt, user_msg, model=_vcite_model, max_tokens=2000)
        except Exception as e:
            logger.error(f"AI verification failed for {document_id}: {e}")
            raise HTTPException(500, "AI verification failed. Please try again.")

        confidence = float(result.get("confidence", 0))
        is_authentic = result.get("is_authentic", False)
        verification_status = "verified" if is_authentic and confidence >= 0.7 else "rejected" if not is_authentic else "pending"

        ver_id = generate_id()
        db.execute(
            """INSERT OR REPLACE INTO legal_database_verifications
               (id, document_id, verification_status, ai_confidence, ai_summary,
                ai_key_provisions, ai_citation_format, verified_by, verified_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'ai', ?)""",
            (ver_id, document_id, verification_status, confidence,
             result.get("summary", ""), result.get("key_provisions", ""),
             result.get("citation_format", ""),
             datetime.now(timezone.utc).isoformat())
        )

        # Update the main document verified status
        if verification_status == "verified":
            db.execute("UPDATE jurisdiction_documents SET is_verified = 1, verified_by = 'ai' WHERE id = ?", (document_id,))

    return {
        "document_id": document_id,
        "verification_status": verification_status,
        "confidence": confidence,
        "summary": result.get("summary", ""),
        "key_provisions": result.get("key_provisions", ""),
        "citation_format": result.get("citation_format", ""),
        "concerns": result.get("concerns", ""),
        "year": result.get("year", ""),
        "message": f"Document {'verified' if verification_status == 'verified' else 'needs review'} with {confidence * 100:.0f}% confidence",
    }


@router.get("/legal-database/pricing")
async def get_pricing():
    """PUBLIC — get download pricing for all jurisdictions."""
    pricing_list = []
    for code, p in DOWNLOAD_PRICING.items():
        j_info = JURISDICTIONS.get(code, {})
        pricing_list.append({
            "jurisdiction_code": code,
            "jurisdiction_name": j_info.get("name", code),
            "currency": p["currency"],
            "symbol": p["symbol"],
            "prices": {
                "legislation": p["price_legislation"],
                "case_law": p["price_case_law"],
                "regulation": p["price_regulation"],
                "other": p["price_other"],
            },
        })
    return {"pricing": pricing_list}


@router.post("/legal-database/download/{document_id}")
async def request_download(document_id: str, user_email: str = Query(default="")):
    """Request download of a document. Returns pricing info and download token.
    In production, this would integrate with a payment gateway. For now, it logs the request."""
    with get_db() as db:
        doc = db.execute(
            "SELECT id, title, jurisdiction_code, document_type, content_text, file_size FROM jurisdiction_documents WHERE id = ? AND status = 'active'",
            (document_id,)
        ).fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")

        d = dict(doc)
        pricing = _get_download_price(d["jurisdiction_code"], d["document_type"])

        download_id = generate_id()
        db.execute(
            """INSERT INTO legal_database_downloads
               (id, document_id, user_email, jurisdiction_code, amount, currency, payment_status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
            (download_id, document_id, user_email, d["jurisdiction_code"], pricing["amount"], pricing["currency"])
        )

    return {
        "download_id": download_id,
        "document_id": document_id,
        "title": d["title"],
        "price": pricing,
        "payment_status": "pending",
        "message": f"To download this document, payment of {pricing['symbol']} {pricing['amount']} is required.",
        "payment_instructions": "Payment integration coming soon. Contact admin@litigationspace.com for bulk access.",
    }


@router.get("/legal-database/stats")
async def legal_database_stats():
    """PUBLIC — overall legal database statistics."""
    with get_db() as db:
        total_docs = db.execute("SELECT COUNT(*) FROM jurisdiction_documents WHERE status = 'active'").fetchone()[0]
        verified_docs = db.execute("SELECT COUNT(*) FROM jurisdiction_documents WHERE status = 'active' AND is_verified = 1").fetchone()[0]
        total_downloads = db.execute("SELECT COUNT(*) FROM legal_database_downloads").fetchone()[0]
        total_jurisdictions = db.execute("SELECT COUNT(DISTINCT jurisdiction_code) FROM jurisdiction_documents WHERE status = 'active'").fetchone()[0]

        by_type = db.execute(
            """SELECT document_type, COUNT(*) as count
               FROM jurisdiction_documents WHERE status = 'active'
               GROUP BY document_type ORDER BY count DESC"""
        ).fetchall()

        by_jurisdiction = db.execute(
            """SELECT jurisdiction_code, COUNT(*) as count,
                      SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified
               FROM jurisdiction_documents WHERE status = 'active'
               GROUP BY jurisdiction_code ORDER BY count DESC"""
        ).fetchall()

    return {
        "total_documents": total_docs,
        "verified_documents": verified_docs,
        "verification_rate": round(verified_docs / total_docs * 100, 1) if total_docs > 0 else 0,
        "total_downloads": total_downloads,
        "active_jurisdictions": total_jurisdictions,
        "supported_jurisdictions": len(JURISDICTIONS),
        "by_type": [{"type": dict(r)["document_type"], "count": dict(r)["count"]} for r in by_type],
        "by_jurisdiction": [{
            "code": dict(r)["jurisdiction_code"],
            "name": JURISDICTIONS.get(dict(r)["jurisdiction_code"], {}).get("name", dict(r)["jurisdiction_code"]),
            "total": dict(r)["count"],
            "verified": dict(r)["verified"],
        } for r in by_jurisdiction],
    }


# ═══════════════════════════════════════════════════════════
# COURTLISTENER CASE LAW SEARCH — Powers Legal Database Research
# ═══════════════════════════════════════════════════════════

COURTLISTENER_JURISDICTION_MAP = {
    'US': '',  # All US courts
    'US-NJ': 'nj,njsuperctappdiv,njsuperctlawdiv,njsupercteqdiv,njch,njsuperctchandiv',
    'US-NY': 'ny,nyappdiv,nyappterm,nysupct,nycivct,nyfamct',
    'US-CA': 'cal,calctapp,calag',
    'US-TX': 'tex,texapp,texcrimapp',
    'US-FL': 'fla,fladistctapp',
    'US-IL': 'ill,illappct',
    'US-PA': 'pa,pasuperct,pacommwct',
    'US-FED': 'scotus,ca1,ca2,ca3,ca4,ca5,ca6,ca7,ca8,ca9,ca10,ca11,cadc,cafc',
}


class CourtListenerSearchRequest(BaseModel):
    query: str
    jurisdiction: str = ""  # e.g. "US-NJ", "US-CA", "US-FED"
    page: int = 1
    page_size: int = 20


@router.post("/legal-database/courtlistener-search")
async def courtlistener_case_search(req: CourtListenerSearchRequest):
    """Search CourtListener's verified case law database for real court opinions.
    This powers the Legal Database's research capability with actual case law."""
    import requests as http_requests

    if not req.query.strip():
        raise HTTPException(400, "Search query is required")

    court_filter = COURTLISTENER_JURISDICTION_MAP.get(req.jurisdiction, '')

    try:
        params = {
            "q": req.query,
            "type": "o",  # opinions
            "page_size": min(req.page_size, 30),
            "order_by": "score desc",
        }
        if court_filter:
            params["court"] = court_filter
        if req.page > 1:
            params["page"] = req.page

        response = http_requests.get(
            "https://www.courtlistener.com/api/rest/v4/search/",
            params=params,
            timeout=15,
            headers={"User-Agent": "LitigationSpace-LegalDatabase/1.0"}
        )

        if response.status_code != 200:
            logger.warning(f"[LEGAL DB] CourtListener returned {response.status_code}")
            raise HTTPException(502, "CourtListener search temporarily unavailable")

        data = response.json()
        results = data.get("results", [])
        total_count = data.get("count", 0)

        cases = []
        for r in results:
            import re as re_mod
            snippet = r.get("snippet", "")
            clean_snippet = re_mod.sub(r'<[^>]+>', '', snippet) if snippet else ""

            cases.append({
                "id": r.get("id", ""),
                "case_name": r.get("caseName", "Unknown Case"),
                "citations": r.get("citation", []),
                "court": r.get("court", "Unknown Court"),
                "court_id": r.get("court_id", ""),
                "date_filed": r.get("dateFiled", ""),
                "docket_number": r.get("docketNumber", ""),
                "cite_count": r.get("citeCount", 0),
                "url": "https://www.courtlistener.com" + r.get("absolute_url", ""),
                "snippet": clean_snippet[:800],
                "source": "CourtListener",
                "is_verified": True,  # CourtListener cases are real verified court opinions
            })

        return {
            "total": total_count,
            "page": req.page,
            "page_size": req.page_size,
            "cases": cases,
            "source": "CourtListener Verified Case Law Database",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[LEGAL DB] CourtListener search error: {e}")
        raise HTTPException(502, f"Case law search error: {str(e)}")


# ═══════════════════════════════════════════════════════════
# CASE LAW VERIFIER — Verify citations in documents against real case law
# ═══════════════════════════════════════════════════════════

class VerifyCitationsRequest(BaseModel):
    text: str  # Pasted document text or single citation
    jurisdiction: str = ""  # Optional jurisdiction filter
    context: str = ""  # Optional: what the document is about (helps with relevance analysis)


def _search_courtlistener(query: str, court_filter: str = "", page_size: int = 5) -> list:
    """Search CourtListener and return parsed results."""
    import requests as http_requests
    import re as re_mod

    params = {
        "q": query,
        "type": "o",
        "page_size": min(page_size, 10),
        "order_by": "score desc",
    }
    if court_filter:
        params["court"] = court_filter

    try:
        response = http_requests.get(
            "https://www.courtlistener.com/api/rest/v4/search/",
            params=params,
            timeout=15,
            headers={"User-Agent": "LitigationSpace-CaseLawVerifier/1.0"}
        )
        if response.status_code != 200:
            return []
        data = response.json()
        results = []
        for r in data.get("results", []):
            snippet = r.get("snippet", "")
            clean_snippet = re_mod.sub(r'<[^>]+>', '', snippet) if snippet else ""
            results.append({
                "case_name": r.get("caseName", ""),
                "citations": r.get("citation", []),
                "court": r.get("court", ""),
                "court_id": r.get("court_id", ""),
                "date_filed": r.get("dateFiled", ""),
                "docket_number": r.get("docketNumber", ""),
                "cite_count": r.get("citeCount", 0),
                "url": "https://www.courtlistener.com" + r.get("absolute_url", ""),
                "snippet": clean_snippet[:500],
            })
        return results
    except Exception:
        return []


@router.post("/legal-database/verify-citations")
async def verify_document_citations(req: VerifyCitationsRequest):
    """Paragraph-by-paragraph document scrutiny: verify every citation, flag paragraphs
    missing case law, suggest applicable cases, and grade the entire document.
    Supports documents up to ~200 pages via automatic chunked processing."""

    CHUNK_CHARS  = 40000
    MAX_CHUNKS   = 5
    MAX_CL_CALLS = 80

    if not req.text.strip():
        raise HTTPException(400, "Please paste your document text or case law citation")

    if len(req.text) > 600000:
        raise HTTPException(400, "Document too long. Maximum is approximately 200 pages. Please split into sections.")

    client = _get_openai_client()
    court_filter = COURTLISTENER_JURISDICTION_MAP.get(req.jurisdiction, "")

    # ── Split document into processable chunks ──────────────────────────────────
    text = req.text
    chunks = []
    for i in range(0, len(text), CHUNK_CHARS):
        chunk = text[i:i + CHUNK_CHARS]
        # Don't break a sentence in the middle — extend to next period if possible
        if i + CHUNK_CHARS < len(text):
            end_idx = chunk.rfind(". ")
            if end_idx > CHUNK_CHARS // 2:
                chunk = text[i:i + end_idx + 1]
        chunks.append(chunk)
    chunks = chunks[:MAX_CHUNKS]  # cap total chunks

    extraction_prompt = """You are a legal document analysis expert. Analyze the provided text paragraph by paragraph.

For EACH meaningful paragraph (skip blank lines and standalone headers):
1. "paragraph_preview": first 120 characters of the paragraph.
2. "paragraph_number": sequential integer (1, 2, 3...).
3. "legal_argument": what legal point this paragraph makes (1-2 sentences).
4. "has_citations": true/false — does the paragraph cite cases or statutes?
5. "needs_citation": true if the paragraph makes a legal assertion without citation support that requires authority.
6. "citations": array of citations found IN this paragraph. Each: {"citation_text","case_name","reporter_cite","year"}.

If the text is a single citation or very short, treat it as one paragraph.

Return ONLY valid JSON:
{"document_summary":"...","document_type":"motion|brief|memo|complaint|contract|letter|other","paragraphs":[{"paragraph_number":1,"paragraph_preview":"...","legal_argument":"...","has_citations":true,"needs_citation":false,"citations":[{"citation_text":"...","case_name":"...","reporter_cite":"...","year":"..."}]}]}"""

    # ── Step 1: Extract paragraphs from each chunk ──────────────────────────────
    all_paragraphs = []
    doc_summary = ""
    doc_type = "other"
    para_offset = 0

    for chunk_idx, chunk_text in enumerate(chunks):
        try:
            extract_resp = client.chat.completions.create(
                model=get_model_for_task("jurisdiction_legal_analysis"),
                messages=[
                    {"role": "system", "content": extraction_prompt},
                    {"role": "user", "content": chunk_text},
                ],
                max_completion_tokens=16000,
                response_format={"type": "json_object"},
            )
            raw = (extract_resp.choices[0].message.content or "").strip()
            extracted = _repair_json(raw)
        except Exception as e:
            logger.error(f"[VERIFIER] Chunk {chunk_idx} extraction failed: {e}")
            extracted = {}

        if not extracted:
            continue

        if chunk_idx == 0:
            doc_summary = extracted.get("document_summary", "")
            doc_type    = extracted.get("document_type", "other")

        for para in extracted.get("paragraphs", []):
            para["paragraph_number"] = para.get("paragraph_number", 0) + para_offset
            all_paragraphs.append(para)

        para_offset += len(extracted.get("paragraphs", []))

    if not all_paragraphs:
        raise HTTPException(503, "Failed to extract paragraphs from the document. Please try again.")

    # ── Step 2: CourtListener lookups — deduplicated, capped ───────────────────
    seen_cases: dict = {}    # case_name_lower → cl_data
    all_cl_data: dict = {}   # "p{num}_c{idx}" → {match, results}
    cl_call_count = 0

    for para in all_paragraphs:
        pnum = para.get("paragraph_number", 0)
        citations = para.get("citations", [])

        for idx, cit in enumerate(citations[:8]):
            case_name      = cit.get("case_name", "").strip()
            reporter_cite  = cit.get("reporter_cite", "").strip()
            citation_text  = cit.get("citation_text", case_name).strip()
            lookup_key     = case_name.lower() or citation_text.lower()

            if lookup_key in seen_cases:
                # Reuse cached lookup
                all_cl_data[f"p{pnum}_c{idx}"] = seen_cases[lookup_key]
                continue

            if cl_call_count >= MAX_CL_CALLS:
                all_cl_data[f"p{pnum}_c{idx}"] = {"match": None, "results": []}
                continue

            search_query = case_name or citation_text
            cl_results = _search_courtlistener(search_query, court_filter, page_size=5)
            cl_call_count += 1

            if not cl_results and reporter_cite:
                cl_results = _search_courtlistener(reporter_cite, court_filter, page_size=3)
                cl_call_count += 1

            found_match = None
            if cl_results:
                for r in cl_results:
                    rn = r["case_name"].lower()
                    sn = case_name.lower()
                    if sn and (sn in rn or rn in sn):
                        found_match = r
                        break
                if not found_match:
                    found_match = cl_results[0]

            entry = {"match": found_match, "results": cl_results[:3]}
            all_cl_data[f"p{pnum}_c{idx}"] = entry
            seen_cases[lookup_key] = entry

        # Suggestions for uncited paragraphs (only for first 30 paragraphs)
        if (para.get("needs_citation") and not citations
                and pnum <= 30 and cl_call_count < MAX_CL_CALLS):
            legal_arg = para.get("legal_argument", "")
            if legal_arg:
                sugg = _search_courtlistener(legal_arg, court_filter, page_size=5)
                all_cl_data[f"p{pnum}_suggest"] = sugg
                cl_call_count += 1

    # ── Step 3: Comprehensive GPT analysis — process in sub-batches ────────────
    BATCH_SIZE = 25   # paragraphs per analysis call

    analysis_prompt = """You are a senior legal research analyst. Analyze each paragraph using the CourtListener verification data provided.

For EACH paragraph return:
- "paragraph_number": integer
- "paragraph_preview": first 60 chars
- "grade": A/B/C/D/F
- "citation_analyses": for each cited case: {citation_text, case_name, validity:{status:"VERIFIED|LIKELY VALID|NOT FOUND|OVERRULED",explanation,confidence}, source:{court,year,courtlistener_url,citation_format,times_cited}, applicability:{rating:"STRONG|MODERATE|WEAK|INAPPLICABLE",explanation}, relevance:{rating:"HIGHLY RELEVANT|SOMEWHAT RELEVANT|MARGINALLY RELEVANT|NOT RELEVANT",explanation}, suggested_alternative:{has_suggestion,case_name,citation,court,url,reason}, overall_grade}
- "missing_citations": for uncited paragraphs needing authority — [{legal_issue,suggested_case,suggested_citation,court,url,reason}]
- "paragraph_notes": brief expert comment

Also return:
- "total_verified": count of VERIFIED citations
- "total_not_found": count of NOT FOUND citations
- "total_weak": count of WEAK/INAPPLICABLE
- "total_missing": count of paragraphs needing citations
- "risk_level": "LOW|MEDIUM|HIGH|CRITICAL"
- "overall_assessment": 2-3 sentence document-level assessment

Return ONLY valid JSON: {"paragraphs":[...],"total_verified":0,"total_not_found":0,"total_weak":0,"total_missing":0,"risk_level":"MEDIUM","overall_assessment":"..."}"""

    merged_paragraphs = []
    totals = {"total_verified": 0, "total_not_found": 0, "total_weak": 0, "total_missing": 0}
    risk_levels = []
    assessments = []

    for batch_start in range(0, len(all_paragraphs), BATCH_SIZE):
        batch = all_paragraphs[batch_start:batch_start + BATCH_SIZE]

        batch_input = {
            "document_summary": doc_summary,
            "document_type": doc_type,
            "context": req.context or doc_summary,
            "jurisdiction": req.jurisdiction or "General US",
            "paragraphs": [],
        }

        for para in batch:
            pnum = para.get("paragraph_number", 0)
            para_data = {
                "paragraph_number": pnum,
                "paragraph_preview": para.get("paragraph_preview", ""),
                "legal_argument": para.get("legal_argument", ""),
                "has_citations": para.get("has_citations", False),
                "needs_citation": para.get("needs_citation", False),
                "citations_with_verification": [],
                "suggested_cases_for_missing": [],
            }
            for idx, cit in enumerate(para.get("citations", [])[:8]):
                cl_info = all_cl_data.get(f"p{pnum}_c{idx}", {})
                para_data["citations_with_verification"].append({
                    "citation_text":         cit.get("citation_text", ""),
                    "case_name":             cit.get("case_name", ""),
                    "reporter_cite":         cit.get("reporter_cite", ""),
                    "year":                  cit.get("year", ""),
                    "courtlistener_match":   cl_info.get("match"),
                    "courtlistener_found":   cl_info.get("match") is not None,
                    "other_search_results":  cl_info.get("results", []),
                })
            suggest_key = f"p{pnum}_suggest"
            if suggest_key in all_cl_data:
                para_data["suggested_cases_for_missing"] = all_cl_data[suggest_key]
            batch_input["paragraphs"].append(para_data)

        try:
            batch_resp = client.chat.completions.create(
                model=get_model_for_task("jurisdiction_legal_analysis"),
                messages=[
                    {"role": "system", "content": analysis_prompt},
                    {"role": "user",   "content": json.dumps(batch_input, default=str)},
                ],
                max_completion_tokens=16000,
                response_format={"type": "json_object"},
            )
            raw_analysis = (batch_resp.choices[0].message.content or "").strip()
            analysis_batch = _repair_json(raw_analysis)
        except Exception as e:
            logger.error(f"[VERIFIER] Batch analysis failed: {e}")
            continue

        if not analysis_batch:
            continue

        merged_paragraphs.extend(analysis_batch.get("paragraphs", []))
        for k in totals:
            totals[k] += analysis_batch.get(k, 0)
        risk_levels.append(analysis_batch.get("risk_level", "MEDIUM"))
        assessments.append(analysis_batch.get("overall_assessment", ""))

    if not merged_paragraphs:
        raise HTTPException(503, "Citation analysis failed. Please try again.")

    # Pick highest risk level
    risk_order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    final_risk = max(risk_levels, key=lambda r: risk_order.index(r) if r in risk_order else 0) if risk_levels else "MEDIUM"
    final_assessment = " ".join(a for a in assessments if a) or "Analysis complete."

    note = ""
    if len(chunks) > 1:
        note = f" Note: Document was processed in {len(chunks)} sections ({len(all_paragraphs)} paragraphs analyzed)."

    return {
        "document_summary": doc_summary + note,
        "document_type": doc_type,
        "total_paragraphs": len(all_paragraphs),
        **totals,
        "risk_level": final_risk,
        "overall_assessment": final_assessment,
        "paragraphs": merged_paragraphs,
        "source": "Verified against CourtListener Case Law Database",
        "chunks_processed": len(chunks),
    }


# ═══════════════════════════════════════════════════════════
# COUNTER CASE LAW FINDER — Find cases to beat opposing party's citations
# ═══════════════════════════════════════════════════════════

class CounterCaseLawRequest(BaseModel):
    text: str  # Opposing party's document
    jurisdiction: str = ""
    your_position: str = ""  # Brief description of your side/argument


@router.post("/legal-database/find-counter-cases")
async def find_counter_case_law(req: CounterCaseLawRequest):
    """Analyze opposing party's document, extract their case law citations,
    and find counter case law from CourtListener to defeat each one."""

    if not req.text.strip():
        raise HTTPException(400, "Please paste the opposing party's document")

    if len(req.text) > 600000:
        raise HTTPException(400, "Document too long. Maximum is approximately 200 pages. Please split into sections.")

    court_filter = COURTLISTENER_JURISDICTION_MAP.get(req.jurisdiction, '')
    client = _get_openai_client()

    # Step 1: Extract opposing party's citations and arguments
    extraction_prompt = """You are a legal analysis expert. Analyze the opposing party's document and extract:

1. Every case law citation used by the opposing party
2. The legal argument each citation supports
3. The key legal issues in the document

For each citation:
- "citation_text": exact citation as written
- "case_name": case name
- "reporter_cite": reporter citation if present
- "year": year
- "opposing_argument": what legal point the opposing party uses this case to support (1-2 sentences)
- "legal_issue": the broader legal issue this relates to (e.g., "standing", "statute of limitations", "breach of fiduciary duty")

Return JSON:
{
  "document_summary": "summary of opposing party's position and arguments",
  "legal_issues": ["list of key legal issues raised"],
  "citations": [...]
}"""

    try:
        extract_response = client.chat.completions.create(
            model=get_model_for_task("jurisdiction_legal_analysis"),
            messages=[
                {"role": "system", "content": extraction_prompt},
                {"role": "user", "content": req.text[:200000]},
            ],
            max_completion_tokens=5000,
            response_format={"type": "json_object"},
        )
        extracted = json.loads((extract_response.choices[0].message.content or "").strip())
    except Exception as e:
        logger.error(f"[COUNTER] Extraction failed: {e}")
        raise HTTPException(503, "Failed to analyze opposing document")

    opp_citations = extracted.get("citations", [])
    opp_summary = extracted.get("document_summary", "")
    legal_issues = extracted.get("legal_issues", [])

    # Step 2: For each opposing citation, verify it AND search for counter cases
    citation_data = []
    for cit in opp_citations[:20]:
        case_name = cit.get("case_name", "")
        reporter_cite = cit.get("reporter_cite", "")
        legal_issue = cit.get("legal_issue", "")
        opposing_arg = cit.get("opposing_argument", "")

        # Verify the opposing case
        search_query = case_name or cit.get("citation_text", "")
        verify_results = _search_courtlistener(search_query, court_filter, page_size=3)
        if not verify_results and reporter_cite:
            verify_results = _search_courtlistener(reporter_cite, court_filter, page_size=3)

        # Search for counter cases - cases that oppose or distinguish this argument
        counter_queries = []
        if legal_issue:
            counter_queries.append(f"{legal_issue} distinguished")
            counter_queries.append(f"{legal_issue} reversed overruled")
        if case_name:
            counter_queries.append(f"{case_name} distinguished overruled")

        counter_results = []
        for cq in counter_queries[:3]:
            cr = _search_courtlistener(cq, court_filter, page_size=5)
            for r in cr:
                # Avoid duplicates
                if not any(existing["case_name"] == r["case_name"] for existing in counter_results):
                    counter_results.append(r)
            if len(counter_results) >= 8:
                break

        citation_data.append({
            "citation_text": cit.get("citation_text", ""),
            "case_name": case_name,
            "reporter_cite": reporter_cite,
            "year": cit.get("year", ""),
            "opposing_argument": opposing_arg,
            "legal_issue": legal_issue,
            "verification_results": verify_results[:2],
            "counter_case_results": counter_results[:8],
        })

    # Step 3: GPT-5.4 analysis - find counter arguments for each citation
    counter_prompt = """You are an elite litigation strategist. You have been given the opposing party's legal document with their case law citations, plus CourtListener search results for potential counter cases.

Your job: For EACH opposing citation, provide:

1. **Opposing Case Status**: Is this case still good law? Was it overruled, reversed, limited, or distinguished? Check CourtListener verification data.
   - Status: "GOOD LAW", "OVERRULED", "REVERSED", "LIMITED", "DISTINGUISHED", "SUPERSEDED", "NOT FOUND"
   
2. **Weakness Analysis**: What are the weaknesses of the opposing party's reliance on this case? Wrong jurisdiction? Distinguishable facts? Narrow holding? Outdated?

3. **Counter Cases**: From the CourtListener results, identify 1-3 cases that can be used AGAINST the opposing party's argument. For each:
   - case_name, citation, court, year, url
   - "counter_argument": How this case defeats or weakens the opposing party's citation
   - "strength": "STRONG", "MODERATE", "SUPPORTIVE"

4. **Recommended Response**: A brief strategy for how to address this citation in your response brief.

Return JSON:
{
  "opposing_document_summary": "...",
  "your_position_summary": "...",
  "counter_analyses": [
    {
      "opposing_citation": "...",
      "opposing_case_name": "...",
      "opposing_argument": "...",
      "case_status": {
        "status": "GOOD LAW|OVERRULED|REVERSED|LIMITED|DISTINGUISHED|SUPERSEDED|NOT FOUND",
        "explanation": "...",
        "is_still_valid": true/false
      },
      "weaknesses": ["list of weaknesses in opposing party's use of this case"],
      "counter_cases": [
        {
          "case_name": "...",
          "citation": "...",
          "court": "...",
          "year": "...",
          "url": "...",
          "counter_argument": "how this case defeats the opposing citation",
          "strength": "STRONG|MODERATE|SUPPORTIVE"
        }
      ],
      "recommended_response": "brief strategy for responding to this citation"
    }
  ],
  "overall_strategy": "comprehensive strategy summary for defeating the opposing party's arguments",
  "confidence_level": "HIGH|MEDIUM|LOW"
}"""

    analysis_input = {
        "opposing_document_summary": opp_summary,
        "your_position": req.your_position or "Not specified",
        "jurisdiction": req.jurisdiction or "General US",
        "legal_issues": legal_issues,
        "citations_to_counter": citation_data,
    }

    try:
        analysis_response = client.chat.completions.create(
            model=get_model_for_task("jurisdiction_legal_analysis"),
            messages=[
                {"role": "system", "content": counter_prompt},
                {"role": "user", "content": json.dumps(analysis_input, default=str)},
            ],
            max_completion_tokens=10000,
            response_format={"type": "json_object"},
        )
        analysis = json.loads((analysis_response.choices[0].message.content or "").strip())
    except Exception as e:
        logger.error(f"[COUNTER] Analysis failed: {e}")
        raise HTTPException(503, "Counter case analysis failed. Please try again.")

    return {
        "opposing_document_summary": analysis.get("opposing_document_summary", opp_summary),
        "your_position_summary": analysis.get("your_position_summary", ""),
        "total_opposing_citations": len(opp_citations),
        "counter_analyses": analysis.get("counter_analyses", []),
        "overall_strategy": analysis.get("overall_strategy", ""),
        "confidence_level": analysis.get("confidence_level", "MEDIUM"),
        "source": "Counter cases from CourtListener Verified Database",
    }


async def run_jurisdiction_discovery(codes_per_run: int = 2) -> dict:
    import random, hashlib as _hashlib
    client = _get_openai_client()
    if not client:
        return {"status": "skipped", "reason": "OPENAI_API_KEY not set"}
    known_codes = list(JURISDICTIONS.keys())
    with get_db() as db:
        rows = db.execute("SELECT jurisdiction_code, MAX(created_at) as last_added FROM jurisdiction_documents GROUP BY jurisdiction_code").fetchall()
    recent = {r["jurisdiction_code"]: r["last_added"] for r in rows}
    sorted_codes = sorted(known_codes, key=lambda c: recent.get(c, "1970-01-01"))
    pick = sorted_codes[:codes_per_run]
    added_total = 0
    results = []
    for code in pick:
        j = JURISDICTIONS.get(code)
        if not j:
            continue
        system_prompt = ("You are a legal research assistant for " + j["name"] + " law. Suggest 6 important legal documents, statutes, case law, and court rules. Return JSON: {\"suggestions\": [{\"title\": \"\", \"type\": \"legislation|case_law|regulation|guideline|court_rule|fee_schedule\", \"url\": \"\", \"reason\": \"\", \"priority\": \"high|medium|low\"}]}. Focus on lesser-known documents to expand the database.")
        try:
            resp = client.chat.completions.create(model=get_model_for_task("jurisdiction_suggestions"), messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "Jurisdiction: " + j["name"] + ". Suggest 6 important but less commonly indexed legal documents."}], temperature=0.7, max_completion_tokens=1200, response_format={"type": "json_object"})
            data = json.loads(resp.choices[0].message.content or "{}")
            suggestions = data.get("suggestions", [])
        except Exception as exc:
            results.append({"code": code, "error": str(exc)})
            continue
        now = datetime.now(timezone.utc).isoformat()
        count = 0
        with get_db() as db:
            for s in suggestions:
                title = (s.get("title") or "").strip()
                if not title:
                    continue
                doc_type = s.get("type", "legislation")
                url = s.get("url", "")
                # Skip if same title exists in any jurisdiction, or same content hash globally
                if db.execute("SELECT id FROM jurisdiction_documents WHERE title=?", (title,)).fetchone():
                    continue
                try:
                    ai_resp = client.chat.completions.create(model=get_model_for_task("jurisdiction_summary"), messages=[{"role": "system", "content": "You are a legal document summariser. Give a structured overview: purpose, key sections, applicability, significance. Formal legal style."}, {"role": "user", "content": "Title: " + title + " Jurisdiction: " + j["name"] + " Type: " + doc_type + " Provide a detailed overview."}], max_completion_tokens=800)
                    ai_content = ai_resp.choices[0].message.content or ""
                except Exception:
                    ai_content = "Overview of " + title + " — " + doc_type + " from " + j["name"] + "."
                content_text = ai_content or title + " — " + doc_type + " from " + code + "."
                content_hash = _hashlib.md5(content_text.encode()).hexdigest()
                # Skip if identical content already exists
                if db.execute("SELECT id FROM jurisdiction_documents WHERE content_hash=?", (content_hash,)).fetchone():
                    continue
                doc_id = generate_id()
                try:
                    db.execute("INSERT INTO jurisdiction_documents (id, jurisdiction_code, title, document_type, source_type, source_url, content_text, content_hash, language, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ai_discovered', ?, ?, ?, 'en', 'active', ?, ?)", (doc_id, code, title, doc_type, url, content_text, content_hash, now, now))
                    chunks = _chunk_text(content_text)
                    for i, chunk in enumerate(chunks):
                        db.execute("INSERT INTO jurisdiction_doc_chunks (id, document_id, chunk_index, content, section_title, tokens) VALUES (?, ?, ?, ?, ?, ?)", (generate_id(), doc_id, i, chunk["content"], chunk.get("section_title", ""), len(chunk["content"]) // 4))
                    count += 1
                except Exception:
                    pass  # unique constraint violation — already exists
        added_total += count
        results.append({"code": code, "added": count})
    return {"status": "success", "jurisdictions": results, "total_added": added_total}
