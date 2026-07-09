"""War Room router - timeline, contradictions, intelligence junction, and motion strategy engine."""
import json
import os
import random
import hashlib
import httpx
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.database import get_db
from app.models.schemas import TimelineEventCreate, TimelineEventUpdate, ContradictionCreate
from app.utils.auth import get_current_user, generate_id
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer as _HTTPBearer

_war_security = _HTTPBearer(auto_error=False)

def _get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_war_security)):
    if not credentials:
        return None
    try:
        from app.utils.auth import decode_token
        return decode_token(credentials.credentials)
    except Exception:
        return None

router = APIRouter(prefix="/api/warroom", tags=["warroom"])


@router.get("/{case_id}/timeline")
async def get_timeline(case_id: str, current_user: dict = Depends(get_current_user)):
    """Get chronological fact-map timeline for a case."""
    with get_db() as db:
        events = db.execute(
            "SELECT * FROM case_timeline WHERE case_id = ? ORDER BY event_date ASC",
            (case_id,)
        ).fetchall()
        return [dict(e) for e in events]


@router.post("/{case_id}/timeline")
async def add_timeline_event(
    case_id: str,
    req: TimelineEventCreate,
    current_user: dict = Depends(get_current_user)
):
    """Add an event to the chronological fact-map."""
    event_id = generate_id()
    with get_db() as db:
        db.execute(
            """INSERT INTO case_timeline (id, case_id, tenant_id, event_date, title, description,
               event_type, evidence_ids, created_by, position_x, position_y)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (event_id, case_id, current_user["tenant_id"], req.event_date, req.title,
             req.description, req.event_type, req.evidence_ids, current_user["sub"],
             req.position_x, req.position_y)
        )
        return {
            "id": event_id, "case_id": case_id, "event_date": req.event_date,
            "title": req.title, "event_type": req.event_type
        }


@router.patch("/{case_id}/timeline/{event_id}")
async def update_timeline_event(
    case_id: str,
    event_id: str,
    req: TimelineEventUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a timeline event (supports drag-and-drop repositioning)."""
    with get_db() as db:
        event = db.execute(
            "SELECT * FROM case_timeline WHERE id = ? AND case_id = ?",
            (event_id, case_id)
        ).fetchone()
        if not event:
            raise HTTPException(status_code=404, detail="Timeline event not found")

        updates = {}
        for field, value in req.model_dump(exclude_unset=True).items():
            if value is not None:
                updates[field] = value

        if not updates:
            return dict(event)

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [event_id]
        db.execute(f"UPDATE case_timeline SET {set_clause} WHERE id = ?", values)

        updated = db.execute("SELECT * FROM case_timeline WHERE id = ?", (event_id,)).fetchone()
        return dict(updated)


@router.delete("/{case_id}/timeline/{event_id}")
async def delete_timeline_event(
    case_id: str,
    event_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a timeline event."""
    with get_db() as db:
        db.execute("DELETE FROM case_timeline WHERE id = ? AND case_id = ?", (event_id, case_id))
        return {"status": "deleted", "id": event_id}


# Contradictions / Intelligence Junction
@router.get("/{case_id}/contradictions")
async def get_contradictions(case_id: str, current_user: dict = Depends(get_current_user)):
    """Get all flagged contradictions for a case."""
    with get_db() as db:
        contradictions = db.execute(
            "SELECT * FROM contradictions WHERE case_id = ? ORDER BY severity DESC",
            (case_id,)
        ).fetchall()
        return [dict(c) for c in contradictions]


@router.post("/{case_id}/contradictions")
async def create_contradiction(
    case_id: str,
    req: ContradictionCreate,
    current_user: dict = Depends(get_current_user)
):
    """Flag a contradiction between two evidence sources."""
    contradiction_id = generate_id()
    with get_db() as db:
        db.execute(
            """INSERT INTO contradictions (id, case_id, tenant_id, source_a_type, source_a_id,
               source_a_text, source_b_type, source_b_id, source_b_text, severity, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (contradiction_id, case_id, current_user["tenant_id"], req.source_a_type,
             req.source_a_id, req.source_a_text, req.source_b_type, req.source_b_id,
             req.source_b_text, req.severity, req.notes)
        )
        return {
            "id": contradiction_id,
            "case_id": case_id,
            "severity": req.severity,
            "status": "flagged"
        }


@router.patch("/{case_id}/contradictions/{contradiction_id}/resolve")
async def resolve_contradiction(
    case_id: str,
    contradiction_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark a contradiction as resolved."""
    with get_db() as db:
        db.execute(
            "UPDATE contradictions SET resolved = 1 WHERE id = ? AND case_id = ?",
            (contradiction_id, case_id)
        )
        return {"status": "resolved", "id": contradiction_id}


# ═══════════════════════════════════════════════════════════
# MOTION STRATEGY ENGINE
# ═══════════════════════════════════════════════════════════

class MotionAnalysisRequest(BaseModel):
    motion_title: str
    motion_type: Optional[str] = "motion"
    our_arguments: Optional[str] = None
    their_arguments: Optional[str] = None
    our_evidence: Optional[str] = None
    their_evidence: Optional[str] = None
    our_case_citations: Optional[str] = None
    their_case_citations: Optional[str] = None
    key_facts: Optional[str] = None
    court_name: Optional[str] = None
    judge_name: Optional[str] = None


class OralArgSimRequest(BaseModel):
    motion_title: str
    motion_type: Optional[str] = "motion"
    context: Optional[str] = None
    user_response: Optional[str] = None
    question_index: Optional[int] = 0


# ---- Case law knowledge base for analysis ----
LANDMARK_CASES = {
    "summary_judgment": [
        {"name": "Celotex Corp. v. Catrett", "citation": "477 U.S. 317 (1986)", "principle": "Moving party need not negate opponent's claim; need only show absence of genuine issue of material fact.", "court": "U.S. Supreme Court"},
        {"name": "Anderson v. Liberty Lobby, Inc.", "citation": "477 U.S. 242 (1986)", "principle": "Standard mirrors directed verdict: whether evidence presents sufficient disagreement for trial.", "court": "U.S. Supreme Court"},
        {"name": "Matsushita Elec. v. Zenith Radio", "citation": "475 U.S. 574 (1986)", "principle": "Non-moving party must show more than metaphysical doubt about material facts.", "court": "U.S. Supreme Court"},
        {"name": "Scott v. Harris", "citation": "550 U.S. 372 (2007)", "principle": "Court may consider video evidence at summary judgment to determine if genuine dispute exists.", "court": "U.S. Supreme Court"},
    ],
    "motion_to_dismiss": [
        {"name": "Bell Atlantic Corp. v. Twombly", "citation": "550 U.S. 544 (2007)", "principle": "Complaint must state plausible claim; formulaic recitation of elements insufficient.", "court": "U.S. Supreme Court"},
        {"name": "Ashcroft v. Iqbal", "citation": "556 U.S. 662 (2009)", "principle": "Two-step analysis: discard conclusory allegations, then assess plausibility.", "court": "U.S. Supreme Court"},
        {"name": "Conley v. Gibson", "citation": "355 U.S. 41 (1957)", "principle": "Historical 'no set of facts' standard (superseded by Twombly/Iqbal).", "court": "U.S. Supreme Court"},
    ],
    "motion_to_suppress": [
        {"name": "Mapp v. Ohio", "citation": "367 U.S. 643 (1961)", "principle": "Exclusionary rule applies to states through 14th Amendment.", "court": "U.S. Supreme Court"},
        {"name": "Terry v. Ohio", "citation": "392 U.S. 1 (1968)", "principle": "Stop and frisk requires reasonable suspicion of criminal activity.", "court": "U.S. Supreme Court"},
        {"name": "Miranda v. Arizona", "citation": "384 U.S. 436 (1966)", "principle": "Custodial interrogation requires Miranda warnings.", "court": "U.S. Supreme Court"},
        {"name": "Carpenter v. United States", "citation": "585 U.S. 296 (2018)", "principle": "Cell-site location information requires a warrant under 4th Amendment.", "court": "U.S. Supreme Court"},
    ],
    "preliminary_injunction": [
        {"name": "Winter v. NRDC", "citation": "555 U.S. 7 (2008)", "principle": "Four-factor test: likelihood of success, irreparable harm, balance of equities, public interest.", "court": "U.S. Supreme Court"},
        {"name": "eBay Inc. v. MercExchange", "citation": "547 U.S. 388 (2006)", "principle": "Same four-factor test applies to permanent injunctions; no categorical rules.", "court": "U.S. Supreme Court"},
    ],
    "default": [
        {"name": "Celotex Corp. v. Catrett", "citation": "477 U.S. 317 (1986)", "principle": "Burden of production on moving party in dispositive motions.", "court": "U.S. Supreme Court"},
        {"name": "Daubert v. Merrell Dow", "citation": "509 U.S. 579 (1993)", "principle": "Judge acts as gatekeeper for expert testimony reliability.", "court": "U.S. Supreme Court"},
        {"name": "Markman v. Westview Instruments", "citation": "517 U.S. 370 (1996)", "principle": "Claim construction is a matter of law for the court.", "court": "U.S. Supreme Court"},
    ],
}


def _get_motion_category(motion_type: str, motion_title: str) -> str:
    """Determine the motion category for case law lookup."""
    combined = (motion_type + " " + motion_title).lower()
    if "summary judgment" in combined or "msj" in combined:
        return "summary_judgment"
    if "dismiss" in combined or "12(b)" in combined:
        return "motion_to_dismiss"
    if "suppress" in combined:
        return "motion_to_suppress"
    if "injunction" in combined or "tro" in combined or "restraining" in combined:
        return "preliminary_injunction"
    return "default"


def _deterministic_seed(case_id: str, motion_title: str) -> int:
    """Create a deterministic seed so the same case+motion always gets consistent analysis."""
    h = hashlib.md5(f"{case_id}:{motion_title}".encode()).hexdigest()
    return int(h[:8], 16)


def _generate_argument_map(case_data: dict, motion_title: str, our_args: str, their_args: str, our_evidence: str, their_evidence: str) -> list:
    """Generate side-by-side argument map."""
    case_type = case_data.get("case_type", "").replace("_", " ").title()
    court = case_data.get("court", "")

    # Parse user-provided arguments or generate from case context
    our_arg_list = [a.strip() for a in (our_args or "").split("\n") if a.strip()]
    their_arg_list = [a.strip() for a in (their_args or "").split("\n") if a.strip()]
    our_ev_list = [e.strip() for e in (our_evidence or "").split("\n") if e.strip()]
    their_ev_list = [e.strip() for e in (their_evidence or "").split("\n") if e.strip()]

    # Generate default arguments based on case type if not provided
    if not our_arg_list:
        if "civil" in case_type.lower():
            our_arg_list = [
                "Plaintiff has established all elements of the claim with documentary evidence",
                "Defendant's conduct caused direct and proximate harm",
                "Damages are supported by financial records and expert testimony",
                "No genuine dispute of material fact exists on liability",
            ]
        elif "criminal" in case_type.lower():
            our_arg_list = [
                "Evidence was obtained in violation of the Fourth Amendment",
                "The defendant's constitutional rights were not properly preserved",
                "The prosecution's key evidence lacks proper foundation",
                "Witness testimony contains material inconsistencies",
            ]
        else:
            our_arg_list = [
                "The moving party has met all required legal elements",
                "The evidence supports our position on each disputed issue",
                "Controlling authority supports the relief requested",
                "The balance of equities favors our position",
            ]

    if not their_arg_list:
        if "civil" in case_type.lower():
            their_arg_list = [
                "Material factual disputes exist that preclude summary disposition",
                "Plaintiff has not established causation with admissible evidence",
                "Damages calculation is speculative and unsupported",
                "Defendant raises affirmative defenses that create triable issues",
            ]
        elif "criminal" in case_type.lower():
            their_arg_list = [
                "Evidence was obtained pursuant to valid warrant or recognized exception",
                "All constitutional protections were properly observed",
                "The evidence is reliable and properly authenticated",
                "Witness testimony is consistent and corroborated",
            ]
        else:
            their_arg_list = [
                "The opposing party fails to meet the applicable legal standard",
                "Genuine disputes of material fact exist",
                "The cited authority is distinguishable from the present case",
                "The requested relief is overbroad or unwarranted",
            ]

    issues = []
    max_len = max(len(our_arg_list), len(their_arg_list))
    strengths = ["strong", "moderate", "weak"]

    for i in range(max_len):
        our_arg = our_arg_list[i] if i < len(our_arg_list) else "No argument presented on this issue"
        their_arg = their_arg_list[i] if i < len(their_arg_list) else "No argument presented on this issue"
        our_ev = our_ev_list[i] if i < len(our_ev_list) else "See documentary evidence in record"
        their_ev = their_ev_list[i] if i < len(their_ev_list) else "Relies on declarations and testimony"

        # Determine relative strength
        our_has_arg = i < len(our_arg_list)
        their_has_arg = i < len(their_arg_list)
        our_has_ev = i < len(our_ev_list)

        if our_has_arg and our_has_ev and not their_has_arg:
            our_strength = "strong"
            their_strength = "weak"
            advantage = "ours"
        elif their_has_arg and not our_has_arg:
            our_strength = "weak"
            their_strength = "strong"
            advantage = "theirs"
        elif our_has_ev:
            our_strength = "strong"
            their_strength = "moderate"
            advantage = "ours"
        else:
            our_strength = "moderate"
            their_strength = "moderate"
            advantage = "neutral"

        issues.append({
            "issue_number": i + 1,
            "element": f"Issue {i + 1}: {our_arg[:60]}..." if len(our_arg) > 60 else f"Issue {i + 1}: {our_arg}",
            "our_argument": our_arg,
            "their_argument": their_arg,
            "our_evidence": our_ev,
            "their_evidence": their_ev,
            "our_strength": our_strength,
            "their_strength": their_strength,
            "advantage": advantage,
        })

    return issues


def _generate_evidence_analysis(case_data: dict, our_evidence: str, their_evidence: str, contradictions: list) -> list:
    """Analyze evidence quality and identify weaknesses."""
    issues = []

    # Check for contradictions in case data
    for c in contradictions:
        if not c.get("resolved"):
            issues.append({
                "type": "contradictory_testimony",
                "severity": c.get("severity", "medium"),
                "description": f"Contradiction detected: {c.get('source_a_text', 'Source A')} vs {c.get('source_b_text', 'Source B')}",
                "recommendation": "Exploit this contradiction in cross-examination. Prepare impeachment materials.",
                "source": f"{c.get('source_a_type', 'Unknown')} vs {c.get('source_b_type', 'Unknown')}",
            })

    # Analyze their evidence for weaknesses
    their_ev_list = [e.strip() for e in (their_evidence or "").split("\n") if e.strip()]
    if not their_ev_list:
        issues.append({
            "type": "unsupported_assertions",
            "severity": "high",
            "description": "Opposing counsel has not identified specific evidence supporting their position.",
            "recommendation": "Challenge the sufficiency of opposing party's evidence. Move to strike unsupported assertions.",
            "source": "Opposition filing",
        })
    
    our_ev_list = [e.strip() for e in (our_evidence or "").split("\n") if e.strip()]
    if not our_ev_list:
        issues.append({
            "type": "missing_exhibits",
            "severity": "medium",
            "description": "Our evidence inventory has not been documented in War Room. Ensure all exhibits are catalogued.",
            "recommendation": "Upload and catalogue all supporting exhibits before hearing.",
            "source": "Internal review",
        })

    # Always add common evidence analysis items
    case_type = case_data.get("case_type", "").lower()
    if "civil" in case_type:
        issues.extend([
            {
                "type": "hearsay_risk",
                "severity": "medium",
                "description": "Review all declarations for potential hearsay statements that may be challenged under FRE 801-807.",
                "recommendation": "Ensure all statements qualify under a hearsay exception or are offered for non-hearsay purpose.",
                "source": "Evidence review",
            },
            {
                "type": "authentication_gap",
                "severity": "low",
                "description": "Verify all documentary exhibits have proper authentication under FRE 901-902.",
                "recommendation": "Prepare authenticating declarations for all business records and electronic evidence.",
                "source": "Evidence review",
            },
        ])
    elif "criminal" in case_type:
        issues.extend([
            {
                "type": "chain_of_custody",
                "severity": "high",
                "description": "Verify chain of custody documentation for all physical evidence.",
                "recommendation": "Challenge any gaps in chain of custody. Request detailed custody logs.",
                "source": "Evidence review",
            },
            {
                "type": "brady_material",
                "severity": "critical",
                "description": "Confirm all Brady/Giglio material has been disclosed by prosecution.",
                "recommendation": "File supplemental Brady request if any exculpatory evidence appears to be withheld.",
                "source": "Discovery review",
            },
        ])

    return issues


def _generate_case_law_analysis(motion_category: str, our_citations: str, their_citations: str) -> list:
    """Analyze case law citations from both sides."""
    results = []
    landmark = LANDMARK_CASES.get(motion_category, LANDMARK_CASES["default"])

    # Analyze their citations
    their_cite_list = [c.strip() for c in (their_citations or "").split("\n") if c.strip()]
    if their_cite_list:
        for cite in their_cite_list[:5]:
            results.append({
                "cited_by": "opposing",
                "case_name": cite,
                "citation": "",
                "authority_type": "persuasive",
                "treatment": "Review required",
                "analysis": f"Opposing counsel cites {cite}. Verify current treatment and determine if distinguishable from present facts.",
                "counter_suggestion": landmark[0]["name"] if landmark else None,
                "counter_citation": landmark[0]["citation"] if landmark else None,
                "counter_principle": landmark[0]["principle"] if landmark else None,
            })
    else:
        results.append({
            "cited_by": "opposing",
            "case_name": "No citations provided",
            "citation": "",
            "authority_type": "none",
            "treatment": "N/A",
            "analysis": "Opposing party has not cited specific authority. This may indicate a weak legal position.",
            "counter_suggestion": None,
            "counter_citation": None,
            "counter_principle": None,
        })

    # Add controlling authority recommendations
    for case in landmark:
        results.append({
            "cited_by": "recommended",
            "case_name": case["name"],
            "citation": case["citation"],
            "authority_type": "controlling",
            "treatment": "good_law",
            "analysis": case["principle"],
            "counter_suggestion": None,
            "counter_citation": None,
            "counter_principle": None,
        })

    return results


def _generate_factual_disputes(case_data: dict, contradictions: list, timeline: list, our_evidence: str, their_evidence: str) -> list:
    """Identify factual disputes between the parties."""
    disputes = []

    # Generate from contradictions
    for c in contradictions:
        if not c.get("resolved"):
            disputes.append({
                "disputed_fact": c.get("notes", "Factual dispute identified"),
                "our_evidence": c.get("source_a_text", "See record"),
                "our_evidence_type": c.get("source_a_type", "document"),
                "their_evidence": c.get("source_b_text", "See record"),
                "their_evidence_type": c.get("source_b_type", "testimony"),
                "strength_assessment": "Our evidence stronger" if c.get("severity") in ("high", "critical") else "Requires further analysis",
                "recommendation": "Documentary evidence generally preferred over testimonial evidence. Prepare impeachment materials.",
            })

    # Generate common dispute patterns based on case type
    case_type = case_data.get("case_type", "").lower()
    opposing = case_data.get("opposing_party", "Opposing Party")

    if "civil" in case_type:
        if not disputes:
            disputes.extend([
                {
                    "disputed_fact": "Whether the alleged breach caused the claimed damages",
                    "our_evidence": "Financial records and expert report (Exhibits A-D)",
                    "our_evidence_type": "documentary",
                    "their_evidence": f"{opposing}'s declaration denying causation (Para. 8-12)",
                    "their_evidence_type": "testimonial",
                    "strength_assessment": "Our evidence stronger — documentary proof with expert analysis",
                    "recommendation": "Lead with documentary evidence. Highlight lack of opposing expert report.",
                },
                {
                    "disputed_fact": "Timeline of key events and communications",
                    "our_evidence": "Email correspondence chain with timestamps (Exhibit E)",
                    "our_evidence_type": "documentary",
                    "their_evidence": f"{opposing}'s recollection in declaration",
                    "their_evidence_type": "testimonial",
                    "strength_assessment": "Our evidence stronger — contemporaneous records vs. after-the-fact recollection",
                    "recommendation": "Emphasize that contemporaneous documents are more reliable than later testimony.",
                },
            ])
    elif "criminal" in case_type:
        if not disputes:
            disputes.extend([
                {
                    "disputed_fact": "Whether the evidence was lawfully obtained",
                    "our_evidence": "Body camera footage and officer testimony timeline gaps",
                    "our_evidence_type": "documentary",
                    "their_evidence": "Officer declaration asserting proper procedure",
                    "their_evidence_type": "testimonial",
                    "strength_assessment": "Requires closer analysis — video evidence may be dispositive",
                    "recommendation": "Focus on any discrepancies between video evidence and officer's written report.",
                },
            ])

    return disputes


def _generate_motion_score(argument_map: list, evidence_issues: list, disputes: list, case_law: list) -> dict:
    """Generate a motion strength score from 0-100."""
    score = 50  # Base score

    # Argument advantage scoring
    our_advantages = sum(1 for a in argument_map if a["advantage"] == "ours")
    their_advantages = sum(1 for a in argument_map if a["advantage"] == "theirs")
    neutral = sum(1 for a in argument_map if a["advantage"] == "neutral")
    total_issues = len(argument_map) or 1

    score += (our_advantages / total_issues) * 25
    score -= (their_advantages / total_issues) * 20

    # Evidence quality scoring
    critical_issues = sum(1 for e in evidence_issues if e["severity"] == "critical")
    high_issues = sum(1 for e in evidence_issues if e["severity"] == "high")
    score -= critical_issues * 8
    score -= high_issues * 4

    # Dispute scoring - having strong documentary evidence helps
    strong_disputes = sum(1 for d in disputes if "stronger" in d.get("strength_assessment", "").lower())
    score += strong_disputes * 5

    # Case law scoring
    controlling = sum(1 for c in case_law if c["authority_type"] == "controlling")
    score += min(controlling * 3, 15)

    # Clamp to 0-100
    score = max(0, min(100, int(score)))

    # Determine risk areas
    risk_areas = []
    if critical_issues > 0:
        risk_areas.append("Critical evidence issues detected")
    if high_issues > 0:
        risk_areas.append("High-severity evidence concerns")
    if their_advantages > our_advantages:
        risk_areas.append("Opponent holds advantage on more issues")
    if not any(c["authority_type"] == "controlling" for c in case_law):
        risk_areas.append("No controlling authority identified yet")
    for d in disputes:
        if "requires" in d.get("strength_assessment", "").lower():
            risk_areas.append("Factual disputes need further analysis")
            break

    # Confidence band
    if score >= 75:
        confidence = "high"
    elif score >= 50:
        confidence = "moderate"
    else:
        confidence = "low"

    return {
        "score": score,
        "confidence": confidence,
        "risk_areas": risk_areas[:5],
        "breakdown": {
            "argument_advantage": our_advantages,
            "argument_disadvantage": their_advantages,
            "argument_neutral": neutral,
            "evidence_issues_critical": critical_issues,
            "evidence_issues_high": high_issues,
            "strong_factual_positions": strong_disputes,
            "controlling_authority_count": controlling,
        },
    }


def _generate_judge_questions(motion_category: str, argument_map: list, evidence_issues: list, disputes: list, case_data: dict) -> list:
    """Predict questions a judge is likely to ask during oral argument."""
    questions = []
    case_type = case_data.get("case_type", "").lower()

    # Questions based on motion type
    if motion_category == "summary_judgment":
        questions.extend([
            {
                "question": "Counsel, can you point me to the specific evidence in the record that establishes the absence of a genuine dispute of material fact?",
                "suggested_answer": "Your Honor, we direct the Court to Exhibits A through D, which provide documentary evidence on each contested element. The opposition relies solely on conclusory declarations without specific factual support.",
                "category": "evidentiary",
            },
            {
                "question": "What is the genuine dispute of material fact that precludes summary judgment here?",
                "suggested_answer": "Your Honor, there is no genuine dispute. The opposing party's assertions are conclusory and unsupported by admissible evidence. Under Celotex and Anderson, the non-moving party must identify specific facts showing a genuine issue for trial.",
                "category": "legal_standard",
            },
        ])
    elif motion_category == "motion_to_dismiss":
        questions.extend([
            {
                "question": "Taking all well-pleaded facts as true, how does the complaint fail to state a plausible claim?",
                "suggested_answer": "Your Honor, while the complaint recites legal conclusions, it fails under Twombly and Iqbal because it does not allege specific facts supporting the essential elements of the claim.",
                "category": "legal_standard",
            },
        ])
    elif motion_category == "motion_to_suppress":
        questions.extend([
            {
                "question": "What is the specific constitutional violation you allege, and what evidence do you seek to suppress as a result?",
                "suggested_answer": "Your Honor, we allege a Fourth Amendment violation. The search exceeded the scope of the warrant, and the fruits of that unlawful search — specifically the items found in the secondary search area — must be suppressed under the exclusionary rule.",
                "category": "constitutional",
            },
        ])

    # Universal questions based on weaknesses
    for issue in evidence_issues[:2]:
        if issue["severity"] in ("critical", "high"):
            questions.append({
                "question": f"Counsel, how do you address the {issue['type'].replace('_', ' ')} issue identified in the record?",
                "suggested_answer": f"Your Honor, {issue['recommendation']}",
                "category": "evidentiary",
            })

    # Questions about disputed facts
    for dispute in disputes[:2]:
        questions.append({
            "question": f"How does the Court resolve the dispute regarding: {dispute['disputed_fact']}?",
            "suggested_answer": f"Your Honor, our position is supported by {dispute['our_evidence_type']} evidence: {dispute['our_evidence']}. {dispute['recommendation']}",
            "category": "factual",
        })

    # Always include a damages/remedy question for civil cases
    if "civil" in case_type:
        questions.append({
            "question": "Where in the record is the evidence supporting your damages calculation?",
            "suggested_answer": "Your Honor, our damages are calculated based on the financial records at Exhibit C and the expert report at Exhibit D, which detail the methodology and amount of damages with reasonable certainty.",
            "category": "damages",
        })

    # Add a procedural question
    questions.append({
        "question": "Is there any reason the Court should not decide this motion on the papers without oral argument?",
        "suggested_answer": "Your Honor, we believe the motion can be decided on the papers, but we welcome the opportunity to address any questions the Court may have about the record.",
        "category": "procedural",
    })

    return questions[:8]


def _generate_attack_strategy(argument_map: list, evidence_issues: list, case_law: list, disputes: list) -> list:
    """Generate prioritized attack points for oral argument."""
    attacks = []
    priority = 1

    # Attack unsupported assertions first
    for issue in evidence_issues:
        if issue["severity"] == "critical":
            attacks.append({
                "priority": priority,
                "target": issue["type"].replace("_", " ").title(),
                "description": issue["description"],
                "action": issue["recommendation"],
                "impact": "high",
            })
            priority += 1

    # Attack weak arguments
    for arg in argument_map:
        if arg["their_strength"] == "weak":
            attacks.append({
                "priority": priority,
                "target": f"Weak Opposing Argument (Issue {arg['issue_number']})",
                "description": f"Opposing counsel's position on '{arg['their_argument'][:80]}' lacks adequate support.",
                "action": f"Challenge directly with our evidence: {arg['our_evidence'][:100]}",
                "impact": "high",
            })
            priority += 1

    # Attack distinguishable case law
    for case in case_law:
        if case["cited_by"] == "opposing" and case["counter_suggestion"]:
            attacks.append({
                "priority": priority,
                "target": f"Distinguishable Authority: {case['case_name']}",
                "description": case["analysis"],
                "action": f"Counter with {case['counter_suggestion']} ({case['counter_citation']}): {case['counter_principle']}",
                "impact": "medium",
            })
            priority += 1

    # Attack contradictory evidence
    for dispute in disputes:
        if "stronger" in dispute.get("strength_assessment", "").lower():
            attacks.append({
                "priority": priority,
                "target": f"Factual Weakness: {dispute['disputed_fact'][:60]}",
                "description": f"Their evidence ({dispute['their_evidence_type']}) is weaker than ours ({dispute['our_evidence_type']}).",
                "action": dispute["recommendation"],
                "impact": "medium",
            })
            priority += 1

    # Always add evidence sufficiency attack for high issues
    for issue in evidence_issues:
        if issue["severity"] == "high" and len(attacks) < 7:
            attacks.append({
                "priority": priority,
                "target": issue["type"].replace("_", " ").title(),
                "description": issue["description"],
                "action": issue["recommendation"],
                "impact": "medium",
            })
            priority += 1

    return attacks[:7]


ORAL_ARG_QUESTIONS_BY_TYPE = {
    "summary_judgment": [
        "Counsel, what is the specific genuine issue of material fact you contend exists here?",
        "Can you direct me to where in the record the non-moving party has met their burden under Celotex?",
        "If I view the evidence in the light most favorable to the non-moving party, does a triable issue remain?",
        "How do you distinguish the Anderson standard from what's before me today?",
        "Assuming I deny the motion, what issues would go to trial?",
        "What is the appropriate remedy if I grant the motion in part?",
    ],
    "motion_to_dismiss": [
        "Taking all well-pleaded facts as true, where does the complaint fail under Twombly/Iqbal?",
        "Is there any set of facts consistent with the complaint that would state a plausible claim?",
        "Should I grant leave to amend if I dismiss?",
        "Which specific element of the cause of action is not adequately pleaded?",
        "How do you respond to the argument that discovery would cure the pleading deficiency?",
    ],
    "motion_to_suppress": [
        "What is the specific constitutional violation you allege?",
        "Was there a valid warrant, and if so, did the search exceed its scope?",
        "Does any exception to the warrant requirement apply here?",
        "What evidence would be excluded if I grant the suppression motion?",
        "Can the government establish inevitable discovery or independent source?",
    ],
    "default": [
        "What is the strongest point in your favor, Counsel?",
        "What is the weakest point in your opponent's position?",
        "If I rule against you on this motion, what is the prejudice to your client?",
        "How does the controlling authority support your position?",
        "Is there a procedural issue I should address before reaching the merits?",
        "What relief specifically are you requesting?",
    ],
}


@router.post("/{case_id}/analyze-motion")
async def analyze_motion(
    case_id: str,
    req: MotionAnalysisRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Full motion strategy analysis engine.
    Generates: Argument Map, Evidence Analysis, Case Law Analysis,
    Factual Disputes, Motion Score, Judge Questions, Attack Strategy.
    """
    with get_db() as db:
        # Get case data
        case_row = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, current_user["tenant_id"])
        ).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        case_data = dict(case_row)

        # Get contradictions
        contradictions_rows = db.execute(
            "SELECT * FROM contradictions WHERE case_id = ? ORDER BY severity DESC",
            (case_id,)
        ).fetchall()
        contradictions = [dict(c) for c in contradictions_rows]

        # Get timeline
        timeline_rows = db.execute(
            "SELECT * FROM case_timeline WHERE case_id = ? ORDER BY event_date ASC",
            (case_id,)
        ).fetchall()
        timeline = [dict(t) for t in timeline_rows]

        # Get documents
        docs_rows = db.execute(
            "SELECT * FROM documents WHERE case_id = ? AND tenant_id = ?",
            (case_id, current_user["tenant_id"])
        ).fetchall()
        documents = [dict(d) for d in docs_rows]

        # Get witnesses
        witnesses_rows = db.execute(
            "SELECT * FROM witnesses WHERE case_id = ? AND tenant_id = ?",
            (case_id, current_user["tenant_id"])
        ).fetchall()
        witnesses = [dict(w) for w in witnesses_rows]

    motion_category = _get_motion_category(req.motion_type or "motion", req.motion_title)

    # Generate all 7 analysis layers
    argument_map = _generate_argument_map(
        case_data, req.motion_title,
        req.our_arguments, req.their_arguments,
        req.our_evidence, req.their_evidence
    )

    evidence_analysis = _generate_evidence_analysis(
        case_data, req.our_evidence, req.their_evidence, contradictions
    )

    case_law_analysis = _generate_case_law_analysis(
        motion_category, req.our_case_citations, req.their_case_citations
    )

    factual_disputes = _generate_factual_disputes(
        case_data, contradictions, timeline,
        req.our_evidence, req.their_evidence
    )

    motion_score = _generate_motion_score(
        argument_map, evidence_analysis, factual_disputes, case_law_analysis
    )

    judge_questions = _generate_judge_questions(
        motion_category, argument_map, evidence_analysis, factual_disputes, case_data
    )

    attack_strategy = _generate_attack_strategy(
        argument_map, evidence_analysis, case_law_analysis, factual_disputes
    )

    return {
        "case_id": case_id,
        "motion_title": req.motion_title,
        "motion_type": req.motion_type,
        "motion_category": motion_category,
        "case_title": case_data.get("title", ""),
        "case_type": case_data.get("case_type", ""),
        "court": case_data.get("court", ""),
        "judge": case_data.get("judge", ""),
        "opposing_party": case_data.get("opposing_party", ""),
        "analysis": {
            "argument_map": argument_map,
            "evidence_analysis": evidence_analysis,
            "case_law_analysis": case_law_analysis,
            "factual_disputes": factual_disputes,
            "motion_score": motion_score,
            "judge_questions": judge_questions,
            "attack_strategy": attack_strategy,
        },
        "summary": {
            "total_issues": len(argument_map),
            "our_advantages": sum(1 for a in argument_map if a["advantage"] == "ours"),
            "their_advantages": sum(1 for a in argument_map if a["advantage"] == "theirs"),
            "evidence_concerns": len(evidence_analysis),
            "factual_disputes_count": len(factual_disputes),
            "controlling_cases": sum(1 for c in case_law_analysis if c["authority_type"] == "controlling"),
            "attack_points": len(attack_strategy),
            "documents_on_file": len(documents),
            "witnesses_registered": len(witnesses),
            "timeline_events": len(timeline),
            "contradictions_flagged": len([c for c in contradictions if not c.get("resolved")]),
        },
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/{case_id}/oral-argument-sim")
async def oral_argument_simulation(
    case_id: str,
    req: OralArgSimRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Simulate oral argument. Judge asks questions, lawyer practices responses.
    Returns the next question and evaluates the user's response if provided.
    """
    with get_db() as db:
        case_row = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, current_user["tenant_id"])
        ).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")
        case_data = dict(case_row)

    motion_category = _get_motion_category(req.motion_type or "motion", req.motion_title)
    questions = ORAL_ARG_QUESTIONS_BY_TYPE.get(motion_category, ORAL_ARG_QUESTIONS_BY_TYPE["default"])

    idx = req.question_index or 0
    evaluation = None

    # Evaluate user's response to previous question if provided
    if req.user_response and idx > 0:
        prev_question = questions[idx - 1] if idx - 1 < len(questions) else "Previous question"
        response_lower = req.user_response.lower()

        # Simple evaluation heuristics
        strengths = []
        improvements = []

        if len(req.user_response) > 100:
            strengths.append("Substantive response with adequate detail")
        else:
            improvements.append("Consider providing more specific detail and record citations")

        if any(w in response_lower for w in ["exhibit", "record", "page", "paragraph", "evidence"]):
            strengths.append("Good use of record citations")
        else:
            improvements.append("Include specific record citations (exhibit numbers, page references)")

        if any(w in response_lower for w in ["your honor", "court", "honor"]):
            strengths.append("Appropriate courtroom decorum")
        else:
            improvements.append("Address the court as 'Your Honor'")

        if any(w in response_lower for w in ["because", "therefore", "accordingly", "thus"]):
            strengths.append("Logical reasoning structure")
        else:
            improvements.append("Strengthen logical connectors in your argument")

        score = 50
        score += len(strengths) * 12
        score -= len(improvements) * 8
        score = max(20, min(95, score))

        evaluation = {
            "question_answered": prev_question,
            "score": score,
            "strengths": strengths,
            "improvements": improvements,
            "suggested_stronger_response": f"Your Honor, {req.user_response[:50]}... I would add specific record citations and controlling authority to strengthen this response.",
        }

    # Get next question
    if idx < len(questions):
        next_question = {
            "index": idx,
            "question": questions[idx],
            "total_questions": len(questions),
            "remaining": len(questions) - idx - 1,
        }
    else:
        next_question = None

    return {
        "case_id": case_id,
        "motion_title": req.motion_title,
        "motion_category": motion_category,
        "evaluation": evaluation,
        "next_question": next_question,
        "completed": idx >= len(questions),
        "judge_name": case_data.get("judge", "The Court"),
    }


# ─── Simulation Engine + AI Analysis (standalone, no case_id required) ────────

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
from app.utils.model_router import get_model_for_task as _get_war_model
from app.utils.credits import credit_gate, deduct_credits
OPENAI_MODEL = _get_war_model("war_room")  # default (paid) — overridden per-request

_JUDGE_STYLE_INSTRUCTIONS = {
    "textualist": "You focus on the plain text of statutes, rules, and contracts. You ask for exact textual support. You are skeptical of purposive or policy-based arguments unless the text is genuinely ambiguous. You give no weight to legislative intent unless the text is unclear.",
    "pragmatist": "You weigh real-world consequences. You ask how the ruling would actually work in practice. You are open to policy arguments where law permits but require legal grounding. You look for workable, administrable outcomes.",
    "originalist": "You seek the original public meaning of constitutional and statutory text at the time of enactment. You are skeptical of novel interpretations and ask for historical practice and founding-era sources.",
    "moderate": "You balance competing legal doctrines and equitable considerations. You ask about fairness, proportionality, and workability. You are open to both doctrinal and practical arguments.",
    "equity-focused": "You look beyond technical legal argument to underlying justice and good faith. You ask about proportionality, unconscionable conduct, and whether the outcome is fair. You weigh equitable defenses seriously.",
}

_ROLE_LABEL_PRESETS = [
    {"left": "Appellant",   "right": "Appellee",  "keywords": ["appeal", "appellate", "court of appeals", "reviewing court"]},
    {"left": "Petitioner",  "right": "Respondent","keywords": ["petition", "habeas", "mandamus", "certiorari", "election", "family", "divorce", "custody", "immigration"]},
    {"left": "Applicant",   "right": "Respondent","keywords": ["judicial review", "administrative review", "licensing", "planning", "zoning"]},
    {"left": "Claimant",    "right": "Respondent","keywords": ["arbitration", "adr", "icc", "aaa", "icsid", "siac"]},
    {"left": "Prosecution", "right": "Accused",   "keywords": ["criminal", "indictment", "information", "people v", "state v", "commonwealth v"]},
    {"left": "Complainant", "right": "Respondent","keywords": ["disciplinary", "bar complaint", "professional conduct"]},
    {"left": "Claimant",    "right": "Defendant", "keywords": ["insurance claim", "workers compensation"]},
    {"left": "Plaintiff",   "right": "Defendant", "keywords": []},  # fallback
]


async def _call_openai_warroom(messages: list, max_tokens: int = 3000, temperature: float = 0.2, model: str = None) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not configured")
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={"model": model or OPENAI_MODEL, "messages": messages, "max_completion_tokens": max_tokens, "temperature": temperature},
        )
        if resp.status_code != 200:
            raise ValueError(f"OpenAI API error: {resp.status_code} {resp.text[:200]}")
        return resp.json()["choices"][0]["message"]["content"]


class SimulateRequest(BaseModel):
    case_title: str
    case_type: Optional[str] = "civil"
    jurisdiction: Optional[str] = "Federal"
    adjudication_mode: Optional[str] = "single_judge"
    judge_name: Optional[str] = "Hon. Margaret D. Hartwell"
    judge_style: Optional[str] = "textualist"
    left_label: Optional[str] = "Plaintiff"
    right_label: Optional[str] = "Defendant"
    left_party: Optional[str] = None
    right_party: Optional[str] = None
    left_counsel: Optional[str] = None
    right_counsel: Optional[str] = None
    left_arguments: Optional[str] = None
    right_arguments: Optional[str] = None
    left_evidence: Optional[str] = None
    right_evidence: Optional[str] = None
    key_issues: Optional[str] = None
    motion_type: Optional[str] = "motion"
    # Legacy field aliases (backward compat)
    plaintiff_party: Optional[str] = None
    defendant_party: Optional[str] = None
    plaintiff_counsel: Optional[str] = None
    defendant_counsel: Optional[str] = None
    plaintiff_arguments: Optional[str] = None
    defendant_arguments: Optional[str] = None
    plaintiff_evidence: Optional[str] = None
    defendant_evidence: Optional[str] = None


class CourtOrderRequest(BaseModel):
    case_title: str
    case_type: Optional[str] = "civil"
    court_name: Optional[str] = "United States District Court"
    judge_name: Optional[str] = "Hon. Margaret D. Hartwell"
    left_label: Optional[str] = "Plaintiff"
    right_label: Optional[str] = "Defendant"
    left_party: Optional[str] = None
    right_party: Optional[str] = None
    jurisdiction: Optional[str] = "Federal"
    adjudication_mode: Optional[str] = "single_judge"
    ruling: Optional[str] = "mixed"
    key_findings: Optional[str] = None
    key_issues: Optional[str] = None
    # Legacy aliases
    plaintiff_party: Optional[str] = None
    defendant_party: Optional[str] = None


class BenchQuestionRequest(BaseModel):
    case_title: str
    motion_type: Optional[str] = "motion"
    judge_name: Optional[str] = "Hon. Margaret D. Hartwell"
    judge_style: Optional[str] = "textualist"
    left_label: Optional[str] = "Plaintiff"
    right_label: Optional[str] = "Defendant"
    party: Optional[str] = "plaintiff"
    argument_presented: str


class DocumentAnalysisRequest(BaseModel):
    raw_text: str
    title: Optional[str] = None
    case_title: Optional[str] = None
    case_type: Optional[str] = "civil"
    jurisdiction: Optional[str] = None
    left_label: Optional[str] = "Plaintiff"
    right_label: Optional[str] = "Defendant"


class RoleLabelRequest(BaseModel):
    case_type: Optional[str] = None
    proceeding_type: Optional[str] = None
    court_type: Optional[str] = None
    jurisdiction: Optional[str] = None
    motion_type: Optional[str] = None


@router.post("/simulate")
async def simulate_hearing(req: SimulateRequest, user: Optional[dict] = Depends(_get_optional_user)):
    """
    Full virtual courtroom simulation. Returns transcript, bench questions, rulings,
    leanings, verdict, and jury data. AI is strictly record-grounded — no hallucination.
    """
    # Resolve legacy field aliases
    left_label = req.left_label or "Plaintiff"
    right_label = req.right_label or "Defendant"
    left_party = req.left_party or req.plaintiff_party or left_label
    right_party = req.right_party or req.defendant_party or right_label
    left_counsel = req.left_counsel or req.plaintiff_counsel or "Counsel"
    right_counsel = req.right_counsel or req.defendant_counsel or "Counsel"
    left_args = req.left_arguments or req.plaintiff_arguments or ""
    right_args = req.right_arguments or req.defendant_arguments or ""
    left_evidence = req.left_evidence or req.plaintiff_evidence or ""
    right_evidence = req.right_evidence or req.defendant_evidence or ""

    adj_mode = req.adjudication_mode or "single_judge"
    num_judges = 5 if "panel_5" in adj_mode else 3 if "panel_3" in adj_mode else 1
    has_jury = "jury" in adj_mode
    style_key = (req.judge_style or "textualist").lower().replace("-", "_").replace(" ", "_")
    style_instructions = _JUDGE_STYLE_INSTRUCTIONS.get(style_key, _JUDGE_STYLE_INSTRUCTIONS["textualist"])

    record_summary = f"""RECORD BEFORE THE COURT:
Case: {req.case_title}
Proceeding / Motion: {req.motion_type}
Jurisdiction: {req.jurisdiction}
Court Type: {req.case_type}

{left_label}: {left_party} | Counsel: {left_counsel}
{right_label}: {right_party} | Counsel: {right_counsel}

{left_label.upper()} ARGUMENTS (as submitted by counsel — not independently verified):
{left_args if left_args else "No arguments provided for this side."}

{right_label.upper()} ARGUMENTS (as submitted by counsel — not independently verified):
{right_args if right_args else "No arguments provided for this side."}

{left_label.upper()} EVIDENCE (as identified by counsel — contents not independently verified):
{left_evidence if left_evidence else "No evidence identified for this side."}

{right_label.upper()} EVIDENCE (as identified by counsel — contents not independently verified):
{right_evidence if right_evidence else "No evidence identified for this side."}

KEY ISSUES FOR ADJUDICATION:
{req.key_issues if req.key_issues else "Not specified — derive from arguments presented."}

IMPORTANT: Your entire analysis must be limited to the record above. Do not supplement with assumed or invented facts."""

    system_prompt = f"""You are the AI engine for a virtual courtroom simulation. Simulate a {adj_mode.replace("_", " ")} hearing.
Presiding: {req.judge_name} | Judicial Philosophy: {style_key.upper()}

{style_instructions}

MANDATORY JUDICIAL RULES — ABSOLUTE, NO EXCEPTIONS:
1. NEVER invent facts, exhibits, witness names, case citations, dates, or legal holdings not in the provided record.
2. If the record is thin or ambiguous, REDUCE confidence — never fabricate support.
3. APPLY EQUAL SCRUTINY TO BOTH SIDES. Do not favor the side with more material.
4. In transcript and rulings, LABEL assertions accurately:
   - "{left_label} argues..." (not "{left_label} has established...")
   - "{right_label} contends..." (not "{right_label} has proven...")
   - "The record shows..." only when something is genuinely in the record.
5. Bench questions must probe WEAKNESSES on BOTH sides, not just one.
6. A tentative ruling must say "TENTATIVELY" or "PRELIMINARY" unless the record clearly supports finality.
7. Do not cite legal cases or statutes by name unless they appear in the provided arguments.
8. If evidence on an issue is absent, the ruling on that issue must acknowledge the gap.
9. Jury leanings (if applicable) must reflect what a reasonable person would think from the actual evidence — not assumed facts.
10. {f"Generate {num_judges} judge personas with distinct perspectives for the panel." if num_judges > 1 else "Single judge bench."}

SCORING GUIDELINES:
- Award stronger leaning only when the record actually supports it
- Refuse to give either side >70% leaning unless the opposing arguments are genuinely absent or very weak from the record
- Mixed/close verdicts are appropriate when both sides have substantive record support

{record_summary}

Return ONLY valid JSON, no preamble or explanation:
{{
  "transcript": [
    {{"id": "t1", "speaker": "...", "role": "judge|{left_label.lower()}|{right_label.lower()}|clerk|system", "text": "...", "type": "statement|argument|question|ruling|order|system", "timestamp": 0}}
  ],
  "bench_questions": [
    {{"id": "bq1", "judge": "...", "question": "...", "directed_at": "plaintiff|defendant", "answered": false, "answer": "", "evaluation": "", "score": 0}}
  ],
  "preliminary_rulings": [
    {{"id": "r1", "judge": "...", "issue": "...", "decision": "TENTATIVE: ...", "reasoning": "...", "favors": "plaintiff|defendant|neutral"}}
  ],
  "leanings": {{"plaintiff": 50, "defendant": 50}},
  "verdict": "plaintiff|defendant|mixed",
  "verdict_text": "...",
  "jury": []
}}

Transcript: 8-14 entries including opening, questioning, and tentative ruling announcement.
Bench questions: 4-6 questions, mix of both sides, probing real weaknesses.
Preliminary rulings: one per key issue, clearly labeled tentative.
Jury: {"Array of 12 juror objects: {id, seat, name, background, leaning(-100 to 100), engaged(bool)}" if has_jury else "Empty array []"}.
"""

    # Credit gate
    _war_model, _war_cost, _war_status = OPENAI_MODEL, 30, None
    if user:
        with get_db() as _db:
            _war_model, _war_cost = credit_gate(user["sub"], "war_room", _db)
            _war_status = _db.execute("SELECT subscription_status FROM users WHERE id=?", (user["sub"],)).fetchone()["subscription_status"]

    try:
        raw = await _call_openai_warroom(
            [{"role": "system", "content": system_prompt}],
            max_tokens=3500,
            model=_war_model,
        )
        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.rsplit("```", 1)[0]
        result = json.loads(raw)
        if user and _war_status:
            with get_db() as _db:
                deduct_credits(user["sub"], _war_status, _war_cost, "war_room", _db)
        return result
    except Exception as e:
        # Deterministic fallback — no AI required
        seed = int(hashlib.md5(f"{req.case_title}:{left_args}:{right_args}".encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        left_strength = 50
        if left_args: left_strength += 8
        if left_evidence: left_strength += 7
        if right_args: left_strength -= 6
        if right_evidence: left_strength -= 8
        if not left_args and not left_evidence: left_strength -= 12
        left_pct = max(28, min(72, left_strength + rng.randint(-5, 5)))
        right_pct = 100 - left_pct
        verdict = "plaintiff" if left_pct >= 58 else "defendant" if right_pct >= 58 else "mixed"
        issues = [i.strip() for i in (req.key_issues or "Primary Legal Issue").split("\n") if i.strip()]
        rulings = [
            {"id": f"r{i}", "judge": req.judge_name, "issue": iss,
             "decision": f"TENTATIVE: Court {'INCLINED TO GRANT' if (left_pct + i*3) > 52 else 'INCLINED TO DENY'} on this issue",
             "reasoning": "Based on the record presented. Final ruling pending full briefing.",
             "favors": "plaintiff" if (left_pct + i*3) > 52 else "defendant"}
            for i, iss in enumerate(issues[:4])
        ]
        bqs = [
            {"id": "bq0", "judge": req.judge_name, "question": f"Counsel for {left_party}, what is the strongest item in the record supporting your position on the primary issue?", "directed_at": "plaintiff", "answered": False, "answer": "", "evaluation": "", "score": 0},
            {"id": "bq1", "judge": req.judge_name, "question": f"Counsel for {right_party}, how do you address the {left_label}'s primary argument?", "directed_at": "defendant", "answered": False, "answer": "", "evaluation": "", "score": 0},
            {"id": "bq2", "judge": req.judge_name, "question": f"What is the controlling legal authority, and where exactly is it in the record?", "directed_at": "plaintiff", "answered": False, "answer": "", "evaluation": "", "score": 0},
            {"id": "bq3", "judge": req.judge_name, "question": f"Counsel for {right_party}, what genuine dispute of material fact do you contend remains?", "directed_at": "defendant", "answered": False, "answer": "", "evaluation": "", "score": 0},
        ]
        jury_data = []
        if has_jury:
            jury_data = [{"id": i+1, "seat": i+1, "name": f"Juror {i+1}", "background": "Member of the public", "leaning": rng.randint(-80, 80), "engaged": rng.random() > 0.1} for i in range(12)]
        verdict_text = (
            f"The Court is TENTATIVELY INCLINED to rule in favor of {left_party}. The record as presented leans toward the {left_label}'s position, though this is subject to further argument and briefing." if verdict == "plaintiff"
            else f"The Court is TENTATIVELY INCLINED to rule in favor of {right_party}. The {right_label} has, on balance, the stronger position in the current record." if verdict == "defendant"
            else "The Court's preliminary assessment is MIXED. The record presents genuine questions on both sides. Neither party has established a clearly dominant position at this stage."
        )
        return {
            "transcript": [
                {"id": "t0", "speaker": "THE CLERK", "role": "clerk", "text": f"All rise. The matter of {req.case_title} is called for hearing before this Court.", "type": "system", "timestamp": 0},
                {"id": "t1", "speaker": "THE COURT", "role": "judge", "text": "Be seated. Are counsel ready to proceed?", "type": "statement", "timestamp": 1},
                {"id": "t2", "speaker": f"COUNSEL FOR {left_party.upper()}", "role": "plaintiff", "text": "Ready, Your Honor.", "type": "statement", "timestamp": 2},
                {"id": "t3", "speaker": f"COUNSEL FOR {right_party.upper()}", "role": "defendant", "text": "Ready, Your Honor.", "type": "statement", "timestamp": 3},
                {"id": "t4", "speaker": "THE COURT", "role": "judge", "text": f"Counsel for {left_party}, you may proceed with your opening argument.", "type": "order", "timestamp": 4},
                {"id": "t5", "speaker": f"COUNSEL FOR {left_party.upper()}", "role": "plaintiff", "text": f"Your Honor, {left_party} respectfully submits: {left_args[:350] if left_args else 'the record supports the relief requested.'}", "type": "argument", "timestamp": 5},
                {"id": "t6", "speaker": "THE COURT", "role": "judge", "text": bqs[0]["question"], "type": "question", "timestamp": 6},
                {"id": "t7", "speaker": f"COUNSEL FOR {right_party.upper()}", "role": "defendant", "text": f"Your Honor, {right_party} respectfully opposes: {right_args[:350] if right_args else 'the motion lacks merit on the record presented.'}", "type": "argument", "timestamp": 7},
                {"id": "t8", "speaker": "THE COURT", "role": "judge", "text": f"The Court has reviewed the papers. A preliminary assessment follows. {verdict_text}", "type": "ruling", "timestamp": 8},
                {"id": "t9", "speaker": "THE COURT", "role": "judge", "text": "These are tentative findings only. Counsel will have opportunity to address the bench questions before final ruling.", "type": "statement", "timestamp": 9},
            ],
            "bench_questions": bqs,
            "preliminary_rulings": rulings,
            "leanings": {"plaintiff": left_pct, "defendant": right_pct},
            "verdict": verdict,
            "verdict_text": verdict_text,
            "jury": jury_data,
        }


@router.post("/court-order")
async def generate_court_order(req: CourtOrderRequest):
    """
    Generate a formal judicial order. Strictly record-grounded — no invented findings.
    """
    left_label = req.left_label or "Plaintiff"
    right_label = req.right_label or "Defendant"
    left_party = req.left_party or req.plaintiff_party or left_label
    right_party = req.right_party or req.defendant_party or right_label

    system_prompt = f"""You are drafting a formal judicial order. This is a legal record. Apply the highest drafting standards.

MANDATORY DRAFTING RULES — NO EXCEPTIONS:
1. Every finding must be traceable to the record provided. Do not invent facts or holdings.
2. Do not cite specific case law or statutes unless they appear in the provided key findings or issues.
   Where authority is needed but not provided, use: "[Applicable governing law]" or "[Cite authority]".
3. Use placeholders for items not in the record: "[Case No. TBD]", "[DATE]", "[Court Address]".
4. Distinguish: ORDERED (dispositive), NOTED (procedural/contextual), RESERVED (not decided).
5. Where the record does not support a confident finding, qualify it: "subject to further briefing", "tentatively", "as reflected in the hearing record".
6. Party names must come from the record provided — do not invent names.
7. The order must be formal, judicially restrained, and legally precise. No rhetoric.
8. Label each section with standard headings.

RECORD PROVIDED:
Case: {req.case_title}
Court: {req.court_name}
Judge: {req.judge_name}
{left_label}: {left_party}
{right_label}: {right_party}
Jurisdiction: {req.jurisdiction}
Proceeding Type: {req.case_type}
Adjudication Mode: {req.adjudication_mode}
Simulation Verdict: {req.ruling}

KEY ISSUES AND FINDINGS FROM HEARING RECORD:
{req.key_findings if req.key_findings else "See hearing record — findings to be incorporated."}

KEY ISSUES PRESENTED:
{req.key_issues if req.key_issues else "As identified in the hearing record."}

Write a complete formal court order as plain text (no JSON). Include:
1. CAPTION (Court, Case No. placeholder, Parties, Nature of Proceeding)
2. APPEARANCES
3. NATURE OF PROCEEDING
4. FACTUAL AND PROCEDURAL BACKGROUND (from record only)
5. ISSUES PRESENTED (numbered)
6. LEGAL STANDARD
7. ANALYSIS (per issue — mark tentative findings clearly)
8. ORDER / DECRETAL LANGUAGE (specific, unambiguous directives)
9. SO ORDERED line with judge name and date placeholder
"""

    try:
        order_text = await _call_openai_warroom(
            [{"role": "system", "content": system_prompt}],
            max_tokens=2500,
        )
        return {"order_text": order_text}
    except Exception:
        # Deterministic fallback
        issues_list = [i.strip() for i in (req.key_issues or "Primary Issue").split("\n") if i.strip()]
        findings_list = [f.strip() for f in (req.key_findings or "").split("\n") if f.strip()]
        issues_formatted = "\n".join(f"   {i+1}. {iss}" for i, iss in enumerate(issues_list))
        findings_formatted = "\n".join(f"   {i+1}. {f}" for i, f in enumerate(findings_list[:6]))
        ruling_word = "GRANTED" if req.ruling == "plaintiff" else "DENIED" if req.ruling == "defendant" else "GRANTED IN PART AND DENIED IN PART"
        order_text = f"""
                        {req.court_name.upper()}

IN THE MATTER OF:

{left_party.upper()},
     {left_label},

     v.                                Case No. [TO BE ASSIGNED]

{right_party.upper()},
     {right_label}.

─────────────────────────────────────────────
                    ORDER
─────────────────────────────────────────────

JUDGE: {req.judge_name}
DATE: [DATE]
PROCEEDING: {req.case_type} — Hearing on {req.adjudication_mode.replace("_", " ").title()}

APPEARANCES:
   For {left_party}: [Counsel of Record]
   For {right_party}: [Counsel of Record]

─── NATURE OF PROCEEDING ───────────────────

This matter came before the Court for hearing. The Court having reviewed the submissions of the
parties, heard oral argument, and considered the record presented, now issues this Order.

─── ISSUES PRESENTED ───────────────────────

The following issues were identified for adjudication:
{issues_formatted}

─── ANALYSIS ────────────────────────────────

The Court has reviewed the record as presented. The following reflects the Court's assessment
based solely on the materials submitted. These findings are TENTATIVE pending final briefing
unless otherwise stated.

{findings_formatted if findings_formatted else "   [Findings to be incorporated from hearing record.]"}

─── ORDER ────────────────────────────────────

Based on the foregoing analysis, and for the reasons stated on the record,

IT IS HEREBY ORDERED that the {req.case_type} matter is {ruling_word}.

IT IS FURTHER ORDERED that the parties comply with all applicable local rules regarding
any further proceedings.

RESERVED: Any issues not addressed in this Order are reserved pending further briefing
or hearing.

─────────────────────────────────────────────

SO ORDERED.

{req.judge_name}
{req.court_name}

Dated: [DATE]
"""
        return {"order_text": order_text.strip()}


@router.post("/bench-question")
async def evaluate_bench_response(req: BenchQuestionRequest):
    """
    Evaluate a lawyer's response to a bench question. Strictly merit-based — no flattery.
    """
    left_label = req.left_label or "Plaintiff"
    right_label = req.right_label or "Defendant"

    system_prompt = f"""You are {req.judge_name}, evaluating a lawyer's response to a bench question during oral argument.
Judicial philosophy: {req.judge_style}

EVALUATION RULES — MANDATORY:
1. Base your evaluation ONLY on what the lawyer actually said. Do not award credit for arguments not made.
2. A legally correct but record-unsupported answer must be flagged — not praised as strong.
3. If the lawyer dodges the question, say so clearly.
4. If the lawyer cites a case, note whether it actually answers the question.
5. Identify real strengths AND real weaknesses. Do not soften the evaluation to be encouraging.
6. SCORING:
   - 85-100: Precisely answers the question with specific record citations and controlling authority
   - 65-84: Responsive with some record grounding but missing citations or depth
   - 45-64: Relevant but general — lacks specific record support
   - 25-44: Partially responsive — significant gaps or evasion
   - Below 25: Does not answer the question or makes claims unsupported by any record
7. A short, precise, record-supported answer can and should outscore a lengthy general argument.
8. This is a judicial evaluation, not a coaching session. Be honest.

Case: {req.case_title}
Motion: {req.motion_type}
Responding party: {left_label if req.party == "plaintiff" else right_label}

Return ONLY valid JSON:
{{
  "score": 0,
  "evaluation": {{
    "strengths": ["..."],
    "improvements": ["..."],
    "judicial_observation": "brief direct comment from the bench"
  }}
}}"""

    try:
        raw = await _call_openai_warroom(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Lawyer's response: {req.argument_presented}"},
            ],
            max_tokens=600,
        )
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"): raw = raw[4:]
            raw = raw.rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception:
        # Heuristic fallback
        resp = req.argument_presented
        strengths, improvements = [], []
        score = 50
        if len(resp) > 150: strengths.append("Substantive response with sufficient detail"); score += 8
        else: improvements.append("Response is brief — provide more specific legal reasoning and record citations"); score -= 5
        if any(w in resp.lower() for w in ["exhibit", "record", "page", "paragraph", "section", "your honor"]): strengths.append("References the record or addresses the court directly"); score += 12
        else: improvements.append("Cite specific record references — exhibit numbers, page references, or document titles"); score -= 10
        if any(w in resp.lower() for w in ["because", "therefore", "accordingly", "thus", "therefore"]): strengths.append("Uses logical connectors"); score += 5
        else: improvements.append("Strengthen the logical structure of the argument — connect premise to conclusion explicitly")
        if any(w in resp.lower() for w in ["argue", "contend", "submit", "respectfully"]): strengths.append("Appropriate advocacy register")
        else: improvements.append("Frame argument in advocacy terms — 'counsel submits' or 'the record establishes'")
        score = max(20, min(92, score))
        return {
            "score": score,
            "evaluation": {
                "strengths": strengths or ["Response was provided"],
                "improvements": improvements or ["Consider adding specific record citations"],
                "judicial_observation": "Counsel, the Court expects specific record citations and controlling authority — a general argument is insufficient at this stage.",
            }
        }


@router.post("/analyze-document")
async def analyze_document(req: DocumentAnalysisRequest):
    """
    Analyze an uploaded or pasted legal document. AI is strictly record-grounded.
    Returns: classification, summary, extracted arguments, key facts, cited authorities.
    """
    left_label = req.left_label or "Plaintiff"
    right_label = req.right_label or "Defendant"
    text_truncated = req.raw_text[:12000]  # truncate for token safety

    system_prompt = f"""You are a legal document analyst. Analyze this legal document with strict intellectual discipline.

ABSOLUTE RULES — NO EXCEPTIONS:
1. NEVER invent facts, case citations, names, dates, exhibits, legal holdings, or any content not present in the provided text.
2. If an assertion lacks evidentiary support in the text, label it "alleged" or "argued" — not "established".
3. If you cannot determine something from the text, say "not determinable from text" — do not guess.
4. Report ONLY what is actually in the document. Do not supplement with general legal knowledge presented as document content.
5. Confidence scores must reflect actual textual support:
   - 85-100: Explicitly and clearly stated
   - 65-84: Strongly implied with minimal inference
   - 40-64: Reasonably inferable but interpretive
   - Below 40: Speculative or minimally evidenced
6. Distinguish document sections: ARGUMENT vs. FACTUAL ALLEGATION vs. EVIDENCE REFERENCE vs. LEGAL AUTHORITY.
7. If this is an advocacy document, note that all factual assertions are ALLEGATIONS until proven.
8. Do not infer the outcome of any legal argument — describe what the document argues, not whether it succeeds.

Context: Case titled "{req.case_title or "unknown"}". {left_label} v. {right_label}. Jurisdiction: {req.jurisdiction or "unspecified"}.

Return ONLY valid JSON:
{{
  "document_type": "motion|opposition|reply|pleading|affidavit|judgment|order|transcript|exhibit|contract|correspondence|statute|memorandum|other",
  "detected_side": "left|right|neutral|unknown",
  "confidence_note": "brief note on confidence in classification",
  "summary_short": "1-2 sentence summary of what this document is and what it seeks to accomplish",
  "summary_detailed": "3-5 sentence summary including: document type, party filing it, legal posture, main argument, and relief requested",
  "procedural_notes": "procedural history mentioned in the document, or null if none",
  "relief_requested": "specific relief sought as stated in document, or null if not determinable",
  "main_arguments": [
    {{
      "id": "arg1",
      "title": "concise descriptive title",
      "summary": "what is argued and on what basis",
      "detected_side": "left|right|neutral|unknown",
      "confidence": 0,
      "support_status": "established|argued|alleged|inferred|insufficient_record",
      "source_span": "brief direct quote or section heading from the document"
    }}
  ],
  "key_facts": ["factual assertion 1 as stated in document", "..."],
  "cited_authorities": ["citation as it appears in document", "..."],
  "analysis_warnings": ["gap, inconsistency, or weakness noted in the document's own reasoning"]
}}"""

    try:
        raw = await _call_openai_warroom(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"DOCUMENT TO ANALYZE:\n\n{text_truncated}"},
            ],
            max_tokens=2000,
        )
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"): raw = raw[4:]
            raw = raw.rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception:
        # Client-safe fallback: basic keyword analysis without inventing content
        text = req.raw_text
        text_lower = text.lower()
        import re
        doc_type = "other"
        for kw, dt in [("motion for", "motion"), ("in opposition", "opposition"), ("reply brief", "reply"), ("reply in support", "reply"), ("complaint", "pleading"), ("petition for", "pleading"), ("affidavit", "affidavit"), ("it is hereby ordered", "order"), ("judgment is entered", "judgment"), ("this agreement", "contract"), ("memorandum of law", "memorandum")]:
            if kw in text_lower: doc_type = dt; break

        left_cnt = len(re.findall(re.escape(left_label.split()[0].lower()), text_lower))
        right_cnt = len(re.findall(re.escape(right_label.split()[0].lower()), text_lower))
        detected_side = "left" if left_cnt > right_cnt * 1.5 else "right" if right_cnt > left_cnt * 1.5 else "unknown"

        arg_spans = re.findall(r'(?:argues?|contends?|submits?|asserts?)[,:]?\s+(?:that\s+)?(.{20,200})', text, re.IGNORECASE)
        main_args = [{"id": f"arg{i}", "title": f"Argument {i+1}", "summary": s.strip()[:200], "detected_side": detected_side, "confidence": 40, "support_status": "argued", "source_span": None} for i, s in enumerate(arg_spans[:5])]

        return {
            "document_type": doc_type,
            "detected_side": detected_side,
            "confidence_note": "Client-side keyword extraction — AI analysis unavailable. Review manually.",
            "summary_short": f"[AI unavailable — basic extraction] Document classified as '{doc_type}' based on keyword matching.",
            "summary_detailed": text[:400].replace("\n", " ").strip() + ("..." if len(text) > 400 else ""),
            "procedural_notes": None,
            "relief_requested": None,
            "main_arguments": main_args,
            "key_facts": [],
            "cited_authorities": re.findall(r'\d+\s+(?:U\.S\.|F\.\d|F\.Supp\.|Cal\.|N\.Y\.)[^\s,;]{0,30}', text)[:5],
            "analysis_warnings": ["AI analysis was unavailable. This is a keyword-only extraction. Review the full document manually."],
        }


@router.post("/suggest-role-labels")
async def suggest_role_labels(req: RoleLabelRequest):
    """
    Suggest left/right party role labels based on case type, proceeding, and court.
    Deterministic — no AI required.
    """
    combined = " ".join(filter(None, [
        req.case_type or "", req.proceeding_type or "",
        req.court_type or "", req.motion_type or "", req.jurisdiction or "",
    ])).lower()

    for preset in _ROLE_LABEL_PRESETS:
        if any(k in combined for k in preset["keywords"] if k):
            return {
                "left_label": preset["left"],
                "right_label": preset["right"],
                "source": "auto",
                "basis": f"Matched keyword pattern for {preset['left']}/{preset['right']} proceedings",
                "all_presets": [{"left": p["left"], "right": p["right"]} for p in _ROLE_LABEL_PRESETS],
            }

    return {
        "left_label": "Plaintiff",
        "right_label": "Defendant",
        "source": "default",
        "basis": "No specific proceeding pattern matched — defaulting to Plaintiff/Defendant",
        "all_presets": [{"left": p["left"], "right": p["right"]} for p in _ROLE_LABEL_PRESETS],
    }
