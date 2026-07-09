"""
Judicial Decision Engine — Bias-Resistant AI Courtroom Assistant.
Separate workspace for judges, arbitrators, and adjudicators.
Clerks upload filings; AI generates neutral case intelligence.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
import uuid
import json
from datetime import datetime

from app.database import get_db
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/judicial", tags=["judicial"])


# ═══════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════

class JudicialCaseCreate(BaseModel):
    case_title: str
    case_number: str
    case_type: Optional[str] = "civil"
    court: Optional[str] = ""
    jurisdiction: Optional[str] = ""
    plaintiff: Optional[str] = ""
    defendant: Optional[str] = ""
    assigned_judge: Optional[str] = ""
    description: Optional[str] = ""

class FilingUpload(BaseModel):
    filing_type: str  # complaint, answer, motion, opposition, reply, exhibit, transcript, prior_order, brief
    filing_party: str  # plaintiff, defendant, court, third_party
    title: str
    content: str  # The text content of the filing
    filing_date: Optional[str] = None
    motion_association: Optional[str] = None  # Which motion this filing relates to
    exhibit_references: Optional[str] = None
    page_count: Optional[int] = None

class HearingCreate(BaseModel):
    case_id: str
    hearing_type: str  # oral_argument, status_conference, evidentiary, scheduling
    scheduled_date: str
    scheduled_time: Optional[str] = ""
    location: Optional[str] = ""
    notes: Optional[str] = ""

class OrderDraft(BaseModel):
    case_id: str
    order_type: str  # ruling, scheduling, discovery, sanctions, final_judgment
    title: str
    caption: Optional[str] = ""
    background: Optional[str] = ""
    legal_standard: Optional[str] = ""
    analysis: Optional[str] = ""
    conclusion: Optional[str] = ""
    content: Optional[str] = ""

class DecisionAction(BaseModel):
    action: str  # rule_without_hearing, schedule_hearing, request_briefing, rule_after_hearing, draft_order
    notes: Optional[str] = ""
    hearing_date: Optional[str] = None

class AnalysisRequest(BaseModel):
    focus_area: Optional[str] = None  # Optional: specific issue to focus on


# ═══════════════════════════════════════════════════════════
# JUDICIAL CASES (Separate from law firm cases)
# ═══════════════════════════════════════════════════════════

@router.get("/cases")
async def list_judicial_cases(user=Depends(get_current_user)):
    """List all judicial cases for this judge's workspace."""
    with get_db() as db:
        cases = db.execute(
            "SELECT * FROM judicial_cases WHERE tenant_id = ? ORDER BY created_at DESC",
            (user["tenant_id"],)
        ).fetchall()
        result = []
        for c in cases:
            cd = dict(c)
            # Count filings
            filing_count = db.execute(
                "SELECT COUNT(*) as cnt FROM judicial_filings WHERE case_id = ?",
                (cd["id"],)
            ).fetchone()["cnt"]
            # Count pending motions
            pending_motions = db.execute(
                "SELECT COUNT(*) as cnt FROM judicial_filings WHERE case_id = ? AND filing_type = 'motion' AND status != 'decided'",
                (cd["id"],)
            ).fetchone()["cnt"]
            # Count hearings today
            today = datetime.now().strftime("%Y-%m-%d")
            today_hearings = db.execute(
                "SELECT COUNT(*) as cnt FROM judicial_hearings WHERE case_id = ? AND scheduled_date LIKE ?",
                (cd["id"], f"{today}%")
            ).fetchone()["cnt"]
            # Count draft orders
            draft_orders = db.execute(
                "SELECT COUNT(*) as cnt FROM judicial_orders WHERE case_id = ? AND status = 'draft'",
                (cd["id"],)
            ).fetchone()["cnt"]
            cd["filing_count"] = filing_count
            cd["pending_motions"] = pending_motions
            cd["today_hearings"] = today_hearings
            cd["draft_orders"] = draft_orders
            result.append(cd)
        return result


@router.post("/cases")
async def create_judicial_case(data: JudicialCaseCreate, user=Depends(get_current_user)):
    """Create a new judicial case in the judge's workspace."""
    case_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute(
            """INSERT INTO judicial_cases (id, tenant_id, case_title, case_number, case_type,
               court, jurisdiction, plaintiff, defendant, assigned_judge, description, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')""",
            (case_id, user["tenant_id"], data.case_title, data.case_number, data.case_type,
             data.court, data.jurisdiction, data.plaintiff, data.defendant,
             data.assigned_judge or user.get("email", ""), data.description)
        )
    return {"id": case_id, "message": "Judicial case created"}


@router.get("/cases/{case_id}")
async def get_judicial_case(case_id: str, user=Depends(get_current_user)):
    """Get full judicial case details."""
    with get_db() as db:
        case = db.execute(
            "SELECT * FROM judicial_cases WHERE id = ? AND tenant_id = ?",
            (case_id, user["tenant_id"])
        ).fetchone()
        if not case:
            raise HTTPException(404, "Judicial case not found")
        return dict(case)


# ═══════════════════════════════════════════════════════════
# CLERK-MANAGED FILINGS
# ═══════════════════════════════════════════════════════════

@router.get("/cases/{case_id}/filings")
async def list_filings(case_id: str, user=Depends(get_current_user)):
    """List all filings for a judicial case."""
    with get_db() as db:
        filings = db.execute(
            "SELECT * FROM judicial_filings WHERE case_id = ? ORDER BY filing_date DESC, created_at DESC",
            (case_id,)
        ).fetchall()
        return [dict(f) for f in filings]


@router.post("/cases/{case_id}/filings")
async def upload_filing(case_id: str, data: FilingUpload, user=Depends(get_current_user)):
    """Clerk uploads a filing to the judicial case record."""
    filing_id = str(uuid.uuid4())
    filing_date = data.filing_date or datetime.now().isoformat()
    with get_db() as db:
        db.execute(
            """INSERT INTO judicial_filings (id, case_id, filing_type, filing_party, title,
               content, filing_date, motion_association, exhibit_references, page_count,
               uploaded_by, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filed')""",
            (filing_id, case_id, data.filing_type, data.filing_party, data.title,
             data.content, filing_date, data.motion_association, data.exhibit_references,
             data.page_count, user.get("sub", "clerk"))
        )
    return {"id": filing_id, "message": "Filing uploaded to case record"}


@router.delete("/cases/{case_id}/filings/{filing_id}")
async def delete_filing(case_id: str, filing_id: str, user=Depends(get_current_user)):
    """Remove a filing from the case record."""
    with get_db() as db:
        db.execute("DELETE FROM judicial_filings WHERE id = ? AND case_id = ?", (filing_id, case_id))
    return {"message": "Filing removed"}


# ═══════════════════════════════════════════════════════════
# AUTOMATIC CASE INTELLIGENCE ENGINE (Neutral Analysis)
# ═══════════════════════════════════════════════════════════

@router.post("/cases/{case_id}/analyze")
async def generate_case_analysis(case_id: str, data: AnalysisRequest = None, user=Depends(get_current_user)):
    """Generate a neutral, bias-resistant case intelligence report from all filings."""
    with get_db() as db:
        case = db.execute("SELECT * FROM judicial_cases WHERE id = ?", (case_id,)).fetchone()
        if not case:
            raise HTTPException(404, "Case not found")
        case_dict = dict(case)

        filings = db.execute(
            "SELECT * FROM judicial_filings WHERE case_id = ? ORDER BY filing_date ASC",
            (case_id,)
        ).fetchall()
        filing_list = [dict(f) for f in filings]

    if not filing_list:
        raise HTTPException(400, "No filings uploaded. Clerk must upload case filings before analysis.")

    # Generate comprehensive neutral analysis
    analysis = _generate_neutral_analysis(case_dict, filing_list)

    # Store analysis
    analysis_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute(
            """INSERT INTO judicial_analysis (id, case_id, analysis_type, content, sources, generated_at)
               VALUES (?, ?, 'full_case', ?, ?, ?)""",
            (analysis_id, case_id, json.dumps(analysis), json.dumps(_extract_sources(filing_list)),
             datetime.now().isoformat())
        )

    return analysis


@router.get("/cases/{case_id}/analysis")
async def get_case_analysis(case_id: str, user=Depends(get_current_user)):
    """Retrieve the most recent case analysis."""
    with get_db() as db:
        analysis = db.execute(
            "SELECT * FROM judicial_analysis WHERE case_id = ? ORDER BY generated_at DESC LIMIT 1",
            (case_id,)
        ).fetchone()
        if not analysis:
            return None
        result = dict(analysis)
        result["content"] = json.loads(result["content"]) if result["content"] else {}
        result["sources"] = json.loads(result["sources"]) if result["sources"] else []
        return result


# ═══════════════════════════════════════════════════════════
# JUDICIAL HEARINGS
# ═══════════════════════════════════════════════════════════

@router.get("/cases/{case_id}/hearings")
async def list_hearings(case_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        hearings = db.execute(
            "SELECT * FROM judicial_hearings WHERE case_id = ? ORDER BY scheduled_date DESC",
            (case_id,)
        ).fetchall()
        return [dict(h) for h in hearings]


@router.post("/hearings")
async def create_hearing(data: HearingCreate, user=Depends(get_current_user)):
    hearing_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute(
            """INSERT INTO judicial_hearings (id, case_id, hearing_type, scheduled_date,
               scheduled_time, location, notes, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')""",
            (hearing_id, data.case_id, data.hearing_type, data.scheduled_date,
             data.scheduled_time, data.location, data.notes)
        )
    return {"id": hearing_id, "message": "Hearing scheduled"}


@router.delete("/hearings/{hearing_id}")
async def delete_hearing(hearing_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM judicial_hearings WHERE id = ?", (hearing_id,))
    return {"message": "Hearing removed"}


# ═══════════════════════════════════════════════════════════
# JUDICIAL ORDERS
# ═══════════════════════════════════════════════════════════

@router.get("/cases/{case_id}/orders")
async def list_orders(case_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        orders = db.execute(
            "SELECT * FROM judicial_orders WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        ).fetchall()
        return [dict(o) for o in orders]


@router.post("/orders")
async def create_order(data: OrderDraft, user=Depends(get_current_user)):
    order_id = str(uuid.uuid4())
    content = data.content or ""
    if not content and (data.caption or data.background or data.legal_standard or data.analysis or data.conclusion):
        content = _build_order_content(data)
    with get_db() as db:
        db.execute(
            """INSERT INTO judicial_orders (id, case_id, order_type, title, content,
               caption, background, legal_standard, analysis, conclusion, status, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)""",
            (order_id, data.case_id, data.order_type, data.title, content,
             data.caption, data.background, data.legal_standard, data.analysis,
             data.conclusion, user.get("sub", "judge"))
        )
    return {"id": order_id, "message": "Order draft created"}


@router.patch("/orders/{order_id}")
async def update_order(order_id: str, data: dict, user=Depends(get_current_user)):
    allowed = ["title", "content", "caption", "background", "legal_standard",
               "analysis", "conclusion", "status", "order_type"]
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [order_id]
    with get_db() as db:
        db.execute(f"UPDATE judicial_orders SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
    return {"message": "Order updated"}


@router.delete("/orders/{order_id}")
async def delete_order(order_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM judicial_orders WHERE id = ?", (order_id,))
    return {"message": "Order deleted"}


# ═══════════════════════════════════════════════════════════
# DECISION WORKFLOW
# ═══════════════════════════════════════════════════════════

@router.post("/cases/{case_id}/decision-action")
async def record_decision_action(case_id: str, data: DecisionAction, user=Depends(get_current_user)):
    """Record a judicial decision workflow action."""
    action_id = str(uuid.uuid4())
    with get_db() as db:
        # Update case status based on action
        status_map = {
            "rule_without_hearing": "awaiting_order",
            "schedule_hearing": "hearing_scheduled",
            "request_briefing": "briefing_requested",
            "rule_after_hearing": "awaiting_order",
            "draft_order": "drafting_order",
        }
        new_status = status_map.get(data.action, "active")
        db.execute("UPDATE judicial_cases SET status = ? WHERE id = ?", (new_status, case_id))

        # If scheduling hearing, create it
        if data.action == "schedule_hearing" and data.hearing_date:
            hearing_id = str(uuid.uuid4())
            db.execute(
                """INSERT INTO judicial_hearings (id, case_id, hearing_type, scheduled_date,
                   notes, status) VALUES (?, ?, 'oral_argument', ?, ?, 'scheduled')""",
                (hearing_id, case_id, data.hearing_date, data.notes or "")
            )

        # Log the action
        db.execute(
            """INSERT INTO judicial_audit_log (id, case_id, action, actor_id, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (action_id, case_id, data.action, user.get("sub", "judge"),
             data.notes, datetime.now().isoformat())
        )

    return {"id": action_id, "status": new_status, "message": f"Action '{data.action}' recorded"}


# ═══════════════════════════════════════════════════════════
# HEARING PREPARATION BRIEF
# ═══════════════════════════════════════════════════════════

@router.post("/cases/{case_id}/hearing-brief")
async def generate_hearing_brief(case_id: str, user=Depends(get_current_user)):
    """Generate a judicial hearing preparation brief."""
    with get_db() as db:
        case = db.execute("SELECT * FROM judicial_cases WHERE id = ?", (case_id,)).fetchone()
        if not case:
            raise HTTPException(404, "Case not found")
        case_dict = dict(case)

        filings = db.execute(
            "SELECT * FROM judicial_filings WHERE case_id = ? ORDER BY filing_date ASC",
            (case_id,)
        ).fetchall()
        filing_list = [dict(f) for f in filings]

        hearings = db.execute(
            "SELECT * FROM judicial_hearings WHERE case_id = ? AND status = 'scheduled' ORDER BY scheduled_date ASC LIMIT 1",
            (case_id,)
        ).fetchall()

    brief = _generate_hearing_brief(case_dict, filing_list, [dict(h) for h in hearings])
    return brief


# ═══════════════════════════════════════════════════════════
# DOCKET DASHBOARD
# ═══════════════════════════════════════════════════════════

@router.get("/docket")
async def get_docket_dashboard(user=Depends(get_current_user)):
    """Get the judicial docket overview for the dashboard."""
    today = datetime.now().strftime("%Y-%m-%d")
    with get_db() as db:
        # Today's hearings
        todays_hearings = db.execute(
            """SELECT jh.*, jc.case_title, jc.case_number
               FROM judicial_hearings jh
               JOIN judicial_cases jc ON jh.case_id = jc.id
               WHERE jc.tenant_id = ? AND jh.scheduled_date LIKE ?
               ORDER BY jh.scheduled_time ASC""",
            (user["tenant_id"], f"{today}%")
        ).fetchall()

        # Pending motions
        pending_motions = db.execute(
            """SELECT jf.*, jc.case_title, jc.case_number
               FROM judicial_filings jf
               JOIN judicial_cases jc ON jf.case_id = jc.id
               WHERE jc.tenant_id = ? AND jf.filing_type = 'motion' AND jf.status != 'decided'
               ORDER BY jf.filing_date DESC""",
            (user["tenant_id"],)
        ).fetchall()

        # Cases awaiting decision
        awaiting = db.execute(
            "SELECT * FROM judicial_cases WHERE tenant_id = ? AND status IN ('awaiting_order', 'drafting_order') ORDER BY created_at DESC",
            (user["tenant_id"],)
        ).fetchall()

        # Draft orders
        draft_orders = db.execute(
            """SELECT jo.*, jc.case_title, jc.case_number
               FROM judicial_orders jo
               JOIN judicial_cases jc ON jo.case_id = jc.id
               WHERE jc.tenant_id = ? AND jo.status = 'draft'
               ORDER BY jo.created_at DESC""",
            (user["tenant_id"],)
        ).fetchall()

        # All active cases count
        active_count = db.execute(
            "SELECT COUNT(*) as cnt FROM judicial_cases WHERE tenant_id = ? AND status != 'closed'",
            (user["tenant_id"],)
        ).fetchone()["cnt"]

    return {
        "todays_hearings": [dict(h) for h in todays_hearings],
        "pending_motions": [dict(m) for m in pending_motions],
        "cases_awaiting_decision": [dict(c) for c in awaiting],
        "draft_orders": [dict(o) for o in draft_orders],
        "active_cases_count": active_count,
        "today": today,
    }


# ═══════════════════════════════════════════════════════════
# AUDIT LOG (Transparency Layer)
# ═══════════════════════════════════════════════════════════

@router.get("/cases/{case_id}/audit-log")
async def get_audit_log(case_id: str, user=Depends(get_current_user)):
    """Get the audit trail for a judicial case showing all analysis sources."""
    with get_db() as db:
        logs = db.execute(
            "SELECT * FROM judicial_audit_log WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        ).fetchall()
        return [dict(l) for l in logs]


# ═══════════════════════════════════════════════════════════
# ANALYSIS ENGINE FUNCTIONS
# ═══════════════════════════════════════════════════════════

def _generate_neutral_analysis(case_dict: dict, filings: list) -> dict:
    """Generate a comprehensive, neutral case intelligence report."""
    case_type = case_dict.get("case_type", "civil")
    plaintiff = case_dict.get("plaintiff", "Plaintiff")
    defendant = case_dict.get("defendant", "Defendant")

    # Categorize filings
    plaintiff_filings = [f for f in filings if f.get("filing_party") == "plaintiff"]
    defendant_filings = [f for f in filings if f.get("filing_party") == "defendant"]
    motions = [f for f in filings if f.get("filing_type") == "motion"]
    exhibits = [f for f in filings if f.get("filing_type") == "exhibit"]
    transcripts = [f for f in filings if f.get("filing_type") == "transcript"]

    # Extract key legal issues
    key_issues = _identify_legal_issues(case_dict, filings)

    # Generate argument comparison
    argument_comparison = _generate_argument_comparison(plaintiff, defendant, plaintiff_filings, defendant_filings, key_issues)

    # Evidence evaluation
    evidence_eval = _evaluate_evidence(filings, plaintiff, defendant)

    # Case law verification
    case_law = _verify_case_law(filings)

    # Strength assessment (neutral)
    strength = _compute_strength_assessment(plaintiff, defendant, filings, key_issues, evidence_eval, case_law)

    # Procedural posture
    procedural = _analyze_procedural_posture(case_dict, filings)

    return {
        "case_id": case_dict["id"],
        "case_title": case_dict.get("case_title", ""),
        "case_number": case_dict.get("case_number", ""),
        "generated_at": datetime.now().isoformat(),
        "filing_summary": {
            "total_filings": len(filings),
            "plaintiff_filings": len(plaintiff_filings),
            "defendant_filings": len(defendant_filings),
            "motions": len(motions),
            "exhibits": len(exhibits),
            "transcripts": len(transcripts),
        },
        "key_legal_issues": key_issues,
        "argument_comparison": argument_comparison,
        "evidence_evaluation": evidence_eval,
        "case_law_verification": case_law,
        "strength_assessment": strength,
        "procedural_posture": procedural,
        "transparency_note": "This analysis is generated from the official case record. Each conclusion references specific filings and page numbers. This is analytical assistance only - it does not constitute a ruling or recommendation.",
    }


def _identify_legal_issues(case_dict: dict, filings: list) -> list:
    """Identify key legal issues from filings."""
    case_type = case_dict.get("case_type", "civil")
    issues = []

    # Extract issues from motion filings
    motions = [f for f in filings if f.get("filing_type") in ("motion", "complaint", "answer")]
    for i, m in enumerate(motions):
        content = (m.get("content") or "").lower()
        title = m.get("title", "")

        # Common civil litigation issues
        if any(w in content for w in ["breach of contract", "contract", "agreement"]):
            issues.append({"issue": "Breach of Contract", "source_filing": title, "filing_id": m["id"], "description": "Whether the defendant breached the terms of the agreement and whether plaintiff suffered resulting damages."})
        if any(w in content for w in ["negligence", "duty of care", "breach of duty"]):
            issues.append({"issue": "Negligence", "source_filing": title, "filing_id": m["id"], "description": "Whether the defendant owed a duty of care, breached that duty, and caused harm to the plaintiff."})
        if any(w in content for w in ["summary judgment", "no genuine dispute", "material fact"]):
            issues.append({"issue": "Summary Judgment Standard", "source_filing": title, "filing_id": m["id"], "description": "Whether there exists a genuine dispute of material fact precluding summary judgment under FRCP Rule 56."})
        if any(w in content for w in ["damages", "compensatory", "punitive"]):
            issues.append({"issue": "Damages", "source_filing": title, "filing_id": m["id"], "description": "Calculation and admissibility of claimed damages, including compensatory and any punitive damages."})
        if any(w in content for w in ["jurisdiction", "personal jurisdiction", "subject matter"]):
            issues.append({"issue": "Jurisdictional Issues", "source_filing": title, "filing_id": m["id"], "description": "Whether the court has proper subject matter and personal jurisdiction over the parties."})
        if any(w in content for w in ["suppress", "fourth amendment", "evidence"]):
            issues.append({"issue": "Evidentiary Issues", "source_filing": title, "filing_id": m["id"], "description": "Admissibility of evidence and any motions to suppress or exclude."})
        if any(w in content for w in ["statute of limitations", "timeliness", "laches"]):
            issues.append({"issue": "Timeliness", "source_filing": title, "filing_id": m["id"], "description": "Whether claims were filed within the applicable statute of limitations."})

    # If no specific issues detected, generate generic ones based on case type
    if not issues:
        if case_type == "civil":
            issues = [
                {"issue": "Merits of Claims", "source_filing": "Case Record", "filing_id": "", "description": "Assessment of the merits of the claims and defenses raised by both parties."},
                {"issue": "Evidentiary Support", "source_filing": "Case Record", "filing_id": "", "description": "Whether each party's claims are supported by admissible evidence in the record."},
                {"issue": "Applicable Legal Standard", "source_filing": "Case Record", "filing_id": "", "description": "Determination of the correct legal standard applicable to the pending motion or issue."},
            ]
        elif case_type == "criminal":
            issues = [
                {"issue": "Sufficiency of Evidence", "source_filing": "Case Record", "filing_id": "", "description": "Whether the prosecution has met its burden of proving each element beyond a reasonable doubt."},
                {"issue": "Constitutional Rights", "source_filing": "Case Record", "filing_id": "", "description": "Whether the defendant's constitutional rights have been properly observed."},
                {"issue": "Procedural Compliance", "source_filing": "Case Record", "filing_id": "", "description": "Whether all procedural requirements have been satisfied."},
            ]
        else:
            issues = [
                {"issue": "Central Dispute", "source_filing": "Case Record", "filing_id": "", "description": "The primary factual and legal dispute between the parties."},
                {"issue": "Evidence Assessment", "source_filing": "Case Record", "filing_id": "", "description": "Quality and completeness of evidence presented by both sides."},
            ]

    return issues


def _generate_argument_comparison(plaintiff: str, defendant: str, p_filings: list, d_filings: list, issues: list) -> list:
    """Generate side-by-side argument comparison for each issue."""
    comparisons = []
    for issue in issues:
        # Find relevant arguments from each side
        p_args = []
        d_args = []
        p_evidence = []
        d_evidence = []

        for f in p_filings:
            content = f.get("content", "")
            title = f.get("title", "")
            if content:
                # Extract relevant portions
                p_args.append(f"As stated in '{title}': {content[:200]}...")
                if f.get("filing_type") == "exhibit":
                    p_evidence.append(f"Exhibit: {title}")

        for f in d_filings:
            content = f.get("content", "")
            title = f.get("title", "")
            if content:
                d_args.append(f"As stated in '{title}': {content[:200]}...")
                if f.get("filing_type") == "exhibit":
                    d_evidence.append(f"Exhibit: {title}")

        comparisons.append({
            "issue": issue["issue"],
            "description": issue["description"],
            "plaintiff_position": {
                "party_name": plaintiff,
                "arguments": p_args[:3] if p_args else [f"No specific argument identified in {plaintiff}'s filings for this issue."],
                "supporting_evidence": p_evidence[:3] if p_evidence else ["No exhibits specifically linked to this issue."],
                "source_filings": [f["title"] for f in p_filings[:3]],
            },
            "defendant_position": {
                "party_name": defendant,
                "arguments": d_args[:3] if d_args else [f"No specific argument identified in {defendant}'s filings for this issue."],
                "supporting_evidence": d_evidence[:3] if d_evidence else ["No exhibits specifically linked to this issue."],
                "source_filings": [f["title"] for f in d_filings[:3]],
            },
        })

    return comparisons


def _evaluate_evidence(filings: list, plaintiff: str, defendant: str) -> list:
    """Evaluate evidentiary support — detect gaps, contradictions, unsupported claims."""
    observations = []

    plaintiff_filings = [f for f in filings if f.get("filing_party") == "plaintiff"]
    defendant_filings = [f for f in filings if f.get("filing_party") == "defendant"]
    exhibits = [f for f in filings if f.get("filing_type") == "exhibit"]

    # Check for unsupported assertions
    for f in filings:
        content = (f.get("content") or "").lower()
        filing_party = f.get("filing_party", "unknown")
        party_name = plaintiff if filing_party == "plaintiff" else defendant

        if any(w in content for w in ["damages of", "lost profits", "economic loss", "financial harm"]):
            has_financial_exhibit = any("financial" in (e.get("title", "").lower()) or "damages" in (e.get("title", "").lower()) for e in exhibits if e.get("filing_party") == filing_party)
            if not has_financial_exhibit:
                observations.append({
                    "type": "unsupported_claim",
                    "severity": "high",
                    "party": party_name,
                    "description": f"{party_name} asserts financial damages but no admissible financial evidence appears to support the calculation in the record.",
                    "source_filing": f.get("title", ""),
                    "filing_id": f.get("id", ""),
                    "recommendation": "Court may wish to inquire about the evidentiary basis for the claimed damages."
                })

        if any(w in content for w in ["witness testified", "testimony shows", "deposition confirms"]):
            has_transcript = any(t.get("filing_type") == "transcript" for t in filings)
            if not has_transcript:
                observations.append({
                    "type": "missing_evidence",
                    "severity": "medium",
                    "party": party_name,
                    "description": f"{party_name} references testimony but no transcript appears in the case record.",
                    "source_filing": f.get("title", ""),
                    "filing_id": f.get("id", ""),
                    "recommendation": "Verify that referenced testimony is part of the official record."
                })

    # Check for contradictions between filings
    all_content = [(f.get("title", ""), f.get("content", ""), f.get("filing_party", "")) for f in filings if f.get("content")]
    for i in range(len(all_content)):
        for j in range(i + 1, len(all_content)):
            t1, c1, p1 = all_content[i]
            t2, c2, p2 = all_content[j]
            if p1 == p2:
                # Same party — check for internal contradictions
                if c1 and c2 and len(c1) > 50 and len(c2) > 50:
                    # Simple heuristic for contradiction detection
                    c1_lower = c1.lower()
                    c2_lower = c2.lower()
                    if ("deny" in c1_lower and "admit" in c2_lower) or ("admit" in c1_lower and "deny" in c2_lower):
                        party_name = plaintiff if p1 == "plaintiff" else defendant
                        observations.append({
                            "type": "contradiction",
                            "severity": "high",
                            "party": party_name,
                            "description": f"Potential inconsistency detected between '{t1}' and '{t2}' filed by {party_name}.",
                            "source_filing": f"{t1} vs {t2}",
                            "filing_id": "",
                            "recommendation": "Court should review both filings to determine if positions are internally consistent."
                        })

    # General observations
    if not exhibits:
        observations.append({
            "type": "missing_evidence",
            "severity": "medium",
            "party": "Both parties",
            "description": "No exhibits have been filed in this case. Arguments rely on assertions without documentary support.",
            "source_filing": "Case Record",
            "filing_id": "",
            "recommendation": "Both parties should be directed to provide supporting exhibits if available."
        })

    if len(plaintiff_filings) == 0:
        observations.append({
            "type": "incomplete_record",
            "severity": "high",
            "party": plaintiff,
            "description": f"No filings from {plaintiff} appear in the case record.",
            "source_filing": "Case Record",
            "filing_id": "",
            "recommendation": f"Clerk should verify that all of {plaintiff}'s filings have been entered."
        })

    if len(defendant_filings) == 0:
        observations.append({
            "type": "incomplete_record",
            "severity": "high",
            "party": defendant,
            "description": f"No filings from {defendant} appear in the case record.",
            "source_filing": "Case Record",
            "filing_id": "",
            "recommendation": f"Clerk should verify that all of {defendant}'s filings have been entered."
        })

    return observations


def _verify_case_law(filings: list) -> list:
    """Extract and verify case law citations from filings."""
    citations = []
    landmark_cases = {
        "celotex": {"name": "Celotex Corp. v. Catrett", "citation": "477 U.S. 317 (1986)", "status": "controlling", "note": "Summary judgment standard - burden on moving party"},
        "anderson": {"name": "Anderson v. Liberty Lobby, Inc.", "citation": "477 U.S. 242 (1986)", "status": "controlling", "note": "Genuine dispute of material fact standard"},
        "matsushita": {"name": "Matsushita Elec. v. Zenith Radio", "citation": "475 U.S. 574 (1986)", "status": "controlling", "note": "Summary judgment — implausible claims"},
        "ashcroft": {"name": "Ashcroft v. Iqbal", "citation": "556 U.S. 662 (2009)", "status": "controlling", "note": "Plausibility pleading standard"},
        "twombly": {"name": "Bell Atlantic Corp. v. Twombly", "citation": "550 U.S. 544 (2007)", "status": "controlling", "note": "Plausibility pleading standard"},
        "daubert": {"name": "Daubert v. Merrell Dow Pharmaceuticals", "citation": "509 U.S. 579 (1993)", "status": "controlling", "note": "Expert testimony admissibility"},
        "erie": {"name": "Erie Railroad Co. v. Tompkins", "citation": "304 U.S. 64 (1938)", "status": "controlling", "note": "Federal courts apply state substantive law"},
        "international shoe": {"name": "International Shoe Co. v. Washington", "citation": "326 U.S. 310 (1945)", "status": "controlling", "note": "Personal jurisdiction minimum contacts"},
        "marbury": {"name": "Marbury v. Madison", "citation": "5 U.S. 137 (1803)", "status": "controlling", "note": "Judicial review"},
        "miranda": {"name": "Miranda v. Arizona", "citation": "384 U.S. 436 (1966)", "status": "controlling", "note": "Rights upon custodial interrogation"},
    }

    for f in filings:
        content = (f.get("content") or "").lower()
        title = f.get("title", "")
        party = f.get("filing_party", "unknown")

        for key, case_info in landmark_cases.items():
            if key in content or case_info["name"].lower().split(" v.")[0].strip().lower() in content:
                citations.append({
                    "case_name": case_info["name"],
                    "citation": case_info["citation"],
                    "cited_by": party,
                    "source_filing": title,
                    "filing_id": f.get("id", ""),
                    "authority_type": case_info["status"],
                    "treatment": "positive",
                    "note": case_info["note"],
                    "verified": True,
                    "potential_issues": None,
                })

        # Detect generic citation patterns
        import re
        cite_pattern = r'\d+\s+[A-Z][a-z]*\.?\s*(?:2d|3d|4th)?\s+\d+'
        found = re.findall(cite_pattern, f.get("content", ""))
        for cite in found[:5]:
            already = any(c["citation"] in cite for c in citations)
            if not already:
                citations.append({
                    "case_name": "Citation detected",
                    "citation": cite.strip(),
                    "cited_by": party,
                    "source_filing": title,
                    "filing_id": f.get("id", ""),
                    "authority_type": "unknown",
                    "treatment": "unverified",
                    "note": "Citation found in filing — requires manual verification of good law status.",
                    "verified": False,
                    "potential_issues": "Automated verification not available. Judge should confirm this citation is still good law.",
                })

    return citations


def _compute_strength_assessment(plaintiff: str, defendant: str, filings: list, issues: list, evidence: list, case_law: list) -> dict:
    """Compute neutral argument strength assessment based on objective criteria."""
    p_score = 50  # Start neutral
    d_score = 50

    p_filings = [f for f in filings if f.get("filing_party") == "plaintiff"]
    d_filings = [f for f in filings if f.get("filing_party") == "defendant"]

    # Legal standard alignment (based on filings present)
    if any(f.get("filing_type") == "motion" for f in p_filings):
        p_score += 5
    if any(f.get("filing_type") == "opposition" for f in d_filings):
        d_score += 5

    # Evidence quality
    p_exhibits = [f for f in p_filings if f.get("filing_type") == "exhibit"]
    d_exhibits = [f for f in d_filings if f.get("filing_type") == "exhibit"]
    p_score += min(len(p_exhibits) * 3, 15)
    d_score += min(len(d_exhibits) * 3, 15)

    # Completeness of argument
    p_content_len = sum(len(f.get("content", "")) for f in p_filings)
    d_content_len = sum(len(f.get("content", "")) for f in d_filings)
    if p_content_len > 500:
        p_score += 5
    if d_content_len > 500:
        d_score += 5

    # Authority strength (case law citations)
    p_cites = [c for c in case_law if c.get("cited_by") == "plaintiff"]
    d_cites = [c for c in case_law if c.get("cited_by") == "defendant"]
    p_controlling = [c for c in p_cites if c.get("authority_type") == "controlling"]
    d_controlling = [c for c in d_cites if c.get("authority_type") == "controlling"]
    p_score += min(len(p_controlling) * 4, 12)
    d_score += min(len(d_controlling) * 4, 12)

    # Evidence issues penalty
    for obs in evidence:
        if obs.get("party") == plaintiff and obs.get("severity") == "high":
            p_score -= 5
        elif obs.get("party") == defendant and obs.get("severity") == "high":
            d_score -= 5

    # Clamp scores
    p_score = max(10, min(95, p_score))
    d_score = max(10, min(95, d_score))

    return {
        "plaintiff": {
            "party_name": plaintiff,
            "score": p_score,
            "breakdown": {
                "legal_standard_alignment": min(55 + len([f for f in p_filings if f.get("filing_type") == "motion"]) * 5, 80),
                "evidence_quality": min(40 + len(p_exhibits) * 10, 90),
                "completeness_of_argument": min(40 + (10 if p_content_len > 500 else 0) + (10 if p_content_len > 1000 else 0), 85),
                "authority_strength": min(30 + len(p_controlling) * 15, 90),
                "procedural_compliance": 70,
            },
        },
        "defendant": {
            "party_name": defendant,
            "score": d_score,
            "breakdown": {
                "legal_standard_alignment": min(55 + len([f for f in d_filings if f.get("filing_type") == "opposition"]) * 5, 80),
                "evidence_quality": min(40 + len(d_exhibits) * 10, 90),
                "completeness_of_argument": min(40 + (10 if d_content_len > 500 else 0) + (10 if d_content_len > 1000 else 0), 85),
                "authority_strength": min(30 + len(d_controlling) * 15, 90),
                "procedural_compliance": 70,
            },
        },
        "note": "These scores are analytical indicators based on objective criteria (evidence quality, authority strength, argument completeness). They are not a ruling. The judge makes all final determinations.",
    }


def _analyze_procedural_posture(case_dict: dict, filings: list) -> dict:
    """Analyze the procedural posture of the case."""
    filing_types = [f.get("filing_type") for f in filings]
    stages_completed = []
    current_stage = "pre-filing"

    if "complaint" in filing_types:
        stages_completed.append("Complaint filed")
        current_stage = "pleadings"
    if "answer" in filing_types:
        stages_completed.append("Answer filed")
        current_stage = "discovery"
    if "motion" in filing_types:
        stages_completed.append("Motion(s) filed")
        current_stage = "motion_practice"
    if "opposition" in filing_types:
        stages_completed.append("Opposition filed")
    if "reply" in filing_types:
        stages_completed.append("Reply filed")
        current_stage = "ripe_for_decision"
    if "transcript" in filing_types:
        stages_completed.append("Hearing transcript filed")

    return {
        "current_stage": current_stage,
        "stages_completed": stages_completed,
        "total_filings": len(filings),
        "motion_count": filing_types.count("motion"),
        "is_ripe_for_decision": current_stage == "ripe_for_decision" or (
            "motion" in filing_types and "opposition" in filing_types
        ),
    }


def _generate_hearing_brief(case_dict: dict, filings: list, hearings: list) -> dict:
    """Generate a hearing preparation brief for the judge."""
    plaintiff = case_dict.get("plaintiff", "Plaintiff")
    defendant = case_dict.get("defendant", "Defendant")

    motions = [f for f in filings if f.get("filing_type") == "motion"]
    oppositions = [f for f in filings if f.get("filing_type") == "opposition"]

    brief = {
        "case_title": case_dict.get("case_title", ""),
        "case_number": case_dict.get("case_number", ""),
        "court": case_dict.get("court", ""),
        "hearing_info": hearings[0] if hearings else None,
        "case_summary": f"This {case_dict.get('case_type', 'civil')} matter involves {plaintiff} (plaintiff) and {defendant} (defendant). "
                        f"The case record contains {len(filings)} filings, including {len(motions)} motion(s) and {len(oppositions)} opposition(s).",
        "key_issues": [
            {"issue": m.get("title", "Pending Motion"), "filed_by": m.get("filing_party", ""), "date": m.get("filing_date", "")}
            for m in motions
        ],
        "argument_summary": {
            "plaintiff_key_points": [f.get("title", "") + ": " + (f.get("content", "")[:150] + "...") for f in filings if f.get("filing_party") == "plaintiff"][:5],
            "defendant_key_points": [f.get("title", "") + ": " + (f.get("content", "")[:150] + "...") for f in filings if f.get("filing_party") == "defendant"][:5],
        },
        "evidence_overview": {
            "total_exhibits": len([f for f in filings if f.get("filing_type") == "exhibit"]),
            "plaintiff_exhibits": len([f for f in filings if f.get("filing_type") == "exhibit" and f.get("filing_party") == "plaintiff"]),
            "defendant_exhibits": len([f for f in filings if f.get("filing_type") == "exhibit" and f.get("filing_party") == "defendant"]),
        },
        "suggested_questions": _generate_bench_questions(case_dict, filings),
    }
    return brief


def _generate_bench_questions(case_dict: dict, filings: list) -> list:
    """Generate suggested questions for the bench based on case analysis."""
    questions = []
    case_type = case_dict.get("case_type", "civil")
    plaintiff = case_dict.get("plaintiff", "Plaintiff")
    defendant = case_dict.get("defendant", "Defendant")

    # Standard questions based on filings
    motions = [f for f in filings if f.get("filing_type") == "motion"]
    if motions:
        questions.append({
            "directed_to": plaintiff,
            "question": f"Counsel, what is the specific relief you are seeking in this motion?",
            "category": "procedural",
        })
        questions.append({
            "directed_to": defendant,
            "question": f"Counsel, what is the strongest factual basis for your opposition?",
            "category": "substantive",
        })

    exhibits = [f for f in filings if f.get("filing_type") == "exhibit"]
    if not exhibits:
        questions.append({
            "directed_to": "both",
            "question": "The record appears to contain no documentary exhibits. Can either party direct the Court to admissible evidence supporting their position?",
            "category": "evidentiary",
        })

    # Case-type specific questions
    if case_type == "civil":
        questions.extend([
            {"directed_to": plaintiff, "question": f"What is the evidentiary basis for the claimed damages?", "category": "damages"},
            {"directed_to": defendant, "question": "Are there any affirmative defenses not addressed in your written submission?", "category": "defenses"},
            {"directed_to": "both", "question": "Is there any possibility of resolution short of a ruling?", "category": "settlement"},
        ])
    elif case_type == "criminal":
        questions.extend([
            {"directed_to": "prosecution", "question": "Has the prosecution disclosed all Brady material?", "category": "constitutional"},
            {"directed_to": "defense", "question": "Are there any suppression issues the Court should be aware of?", "category": "constitutional"},
        ])

    return questions


def _build_order_content(data: OrderDraft) -> str:
    """Build order content from structured fields."""
    sections = []
    if data.caption:
        sections.append(data.caption)
    sections.append(f"\nORDER: {data.title}\n")
    if data.background:
        sections.append(f"BACKGROUND\n\n{data.background}")
    if data.legal_standard:
        sections.append(f"LEGAL STANDARD\n\n{data.legal_standard}")
    if data.analysis:
        sections.append(f"ANALYSIS\n\n{data.analysis}")
    if data.conclusion:
        sections.append(f"CONCLUSION AND ORDER\n\n{data.conclusion}")
    return "\n\n".join(sections)


def _extract_sources(filings: list) -> list:
    """Extract source references for transparency layer."""
    return [
        {
            "filing_id": f.get("id", ""),
            "title": f.get("title", ""),
            "type": f.get("filing_type", ""),
            "party": f.get("filing_party", ""),
            "date": f.get("filing_date", ""),
            "page_count": f.get("page_count"),
        }
        for f in filings
    ]
