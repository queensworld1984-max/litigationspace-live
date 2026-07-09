"""
Router for new features: Discovery Tracker, Witnesses, AI Chat (OpenAI-powered), Legal Drafts.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid
import os
import json
import logging
from datetime import datetime

from app.database import get_db
from app.utils.auth import get_current_user
from app.utils.model_router import get_model_for_user_task
from app.utils.credits import credit_gate, deduct_credits
from app.utils.case_auth import resolve_case_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["features"])


# ═══════════════════════════════════════════════════════════
# DISCOVERY TRACKER
# ═══════════════════════════════════════════════════════════

class DiscoveryItemCreate(BaseModel):
    item_number: str
    item_description: str
    party: Optional[str] = "plaintiff"
    date_served: Optional[str] = None
    date_due: Optional[str] = None
    status: Optional[str] = "pending"
    notes: Optional[str] = None


@router.get("/cases/{case_id}/discovery")
async def list_discovery_items(case_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        case = resolve_case_access(case_id, user, db, required_permission="view_discovery")
        items = db.execute(
            "SELECT * FROM discovery_items WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC",
            (case_id, case["tenant_id"])
        ).fetchall()
        return [dict(r) for r in items]


@router.post("/cases/{case_id}/discovery")
async def create_discovery_item(case_id: str, data: DiscoveryItemCreate, user=Depends(get_current_user)):
    item_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        case = resolve_case_access(case_id, user, db, required_permission="view_discovery")
        db.execute(
            """INSERT INTO discovery_items (id, case_id, tenant_id, item_number, item_description, party, date_served, date_due, status, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item_id, case_id, case["tenant_id"], data.item_number, data.item_description,
             data.party, data.date_served, data.date_due, data.status, data.notes)
        )
    return {"id": item_id, "message": "Discovery item created"}


@router.patch("/cases/discovery/{item_id}")
async def update_discovery_item(item_id: str, data: dict, user=Depends(get_current_user)):
    allowed = ["item_number", "item_description", "party", "date_served", "date_due", "status", "notes"]
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [item_id, user["tenant_id"]]
    with get_db() as db:
        db.execute(f"UPDATE discovery_items SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Updated"}


@router.delete("/cases/discovery/{item_id}")
async def delete_discovery_item(item_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM discovery_items WHERE id = ? AND tenant_id = ?", (item_id, user["tenant_id"]))
    return {"message": "Deleted"}


# ═══════════════════════════════════════════════════════════
# WITNESS ROSTER
# ═══════════════════════════════════════════════════════════

class WitnessCreate(BaseModel):
    name: str
    witness_type: Optional[str] = "fact"
    contact_info: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    deposition_date: Optional[str] = None
    deposition_summary: Optional[str] = None
    key_admissions: Optional[str] = None
    cross_exam_questions: Optional[str] = None
    notes: Optional[str] = None


@router.get("/cases/{case_id}/witnesses")
async def list_witnesses(case_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        case = resolve_case_access(case_id, user, db, required_permission="view_witnesses")
        witnesses = db.execute(
            "SELECT * FROM witnesses WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC",
            (case_id, case["tenant_id"])
        ).fetchall()
        return [dict(r) for r in witnesses]


@router.post("/cases/{case_id}/witnesses")
async def create_witness(case_id: str, data: WitnessCreate, user=Depends(get_current_user)):
    witness_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        case = resolve_case_access(case_id, user, db, required_permission="view_witnesses")
        db.execute(
            """INSERT INTO witnesses (id, case_id, tenant_id, name, witness_type, contact_info, phone, email,
               deposition_date, deposition_summary, key_admissions, cross_exam_questions, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (witness_id, case_id, case["tenant_id"], data.name, data.witness_type,
             data.contact_info, data.phone, data.email, data.deposition_date,
             data.deposition_summary, data.key_admissions, data.cross_exam_questions, data.notes)
        )
    return {"id": witness_id, "message": "Witness added"}


@router.patch("/cases/witnesses/{witness_id}")
async def update_witness(witness_id: str, data: dict, user=Depends(get_current_user)):
    allowed = ["name", "witness_type", "contact_info", "phone", "email", "deposition_date",
               "deposition_summary", "key_admissions", "cross_exam_questions", "notes"]
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [witness_id, user["tenant_id"]]
    with get_db() as db:
        db.execute(f"UPDATE witnesses SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Updated"}


@router.delete("/cases/witnesses/{witness_id}")
async def delete_witness(witness_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM witnesses WHERE id = ? AND tenant_id = ?", (witness_id, user["tenant_id"]))
    return {"message": "Deleted"}


# ═══════════════════════════════════════════════════════════
# AI CHATBOT (Case Navigator)
# ═══════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    content: str


@router.get("/cases/{case_id}/chat")
async def get_chat_history(case_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        messages = db.execute(
            "SELECT * FROM chat_messages WHERE case_id = ? AND tenant_id = ? ORDER BY created_at ASC",
            (case_id, user["tenant_id"])
        ).fetchall()
        return [dict(r) for r in messages]


@router.post("/cases/{case_id}/chat")
async def send_chat_message(case_id: str, data: ChatMessage, user=Depends(get_current_user)):
    """Send a message to the AI Case Navigator. Uses OpenAI with tiered models:
    GPT-5.4 for paid subscribers, GPT-5.4 for free users."""

    # Save user message
    user_msg_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        db.execute(
            "INSERT INTO chat_messages (id, case_id, tenant_id, user_id, role, content) VALUES (?, ?, ?, ?, 'user', ?)",
            (user_msg_id, case_id, user["tenant_id"], user["sub"], data.content)
        )

        # Get case context
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, user["tenant_id"])).fetchone()
        tasks = db.execute("SELECT title, status FROM tasks WHERE case_id = ? AND tenant_id = ?", (case_id, user["tenant_id"])).fetchall()
        docs = db.execute("SELECT filename, category FROM documents WHERE case_id = ? AND tenant_id = ?", (case_id, user["tenant_id"])).fetchall()
        witnesses_list = db.execute("SELECT name, witness_type FROM witnesses WHERE case_id = ? AND tenant_id = ?", (case_id, user["tenant_id"])).fetchall()
        discovery_list = db.execute("SELECT item_description, status FROM discovery_items WHERE case_id = ? AND tenant_id = ?", (case_id, user["tenant_id"])).fetchall()

        # Get chat history for context (last 10 messages)
        recent_messages = db.execute(
            "SELECT role, content FROM chat_messages WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 10",
            (case_id, user["tenant_id"])
        ).fetchall()

        # Check subscription tier via subscription_status (not the READY/LOCKED status column)
        user_row = db.execute("SELECT subscription_status FROM users WHERE id = ?", (user["sub"],)).fetchone()
        _nav_sub_status = user_row["subscription_status"] if user_row else "trial"
        is_paid = _nav_sub_status in ("active", "payg")
        # Credit gate — blocks restricted users and checks balance
        _nav_task = "case_navigator_paid" if is_paid else "case_navigator_free"
        _nav_model, _nav_cost = credit_gate(user["sub"], _nav_task, db)

    if not case_row:
        raise HTTPException(404, "Case not found")

    case_dict = dict(case_row)
    task_list = [dict(t) for t in tasks]
    doc_list = [dict(d) for d in docs]
    witness_data = [dict(w) for w in witnesses_list]
    disco_data = [dict(d) for d in discovery_list]
    chat_history = [dict(m) for m in reversed(recent_messages)]

    # Build case context summary
    pending_tasks = [t["title"] for t in task_list if t["status"] == "pending"]
    completed_tasks = [t["title"] for t in task_list if t["status"] == "completed"]
    total_tasks = len(task_list)
    done_tasks = len(completed_tasks)
    completion = round((done_tasks / total_tasks * 100) if total_tasks > 0 else 0)
    case_type = case_dict.get("case_type", "").replace("_", " ").title()
    case_title = case_dict.get("title", "this case")

    # Generate AI response (OpenAI if available, fallback to keyword-based)
    ai_response = await _generate_ai_response_openai(
        data.content, case_dict, case_type, case_title,
        pending_tasks, completed_tasks, completion, total_tasks,
        doc_list, witness_data, disco_data, chat_history, is_paid
    )

    # Save AI response and deduct credits
    ai_msg_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        db.execute(
            "INSERT INTO chat_messages (id, case_id, tenant_id, user_id, role, content) VALUES (?, ?, ?, ?, 'assistant', ?)",
            (ai_msg_id, case_id, user["tenant_id"], user["sub"], ai_response)
        )
        deduct_credits(user["sub"], _nav_sub_status, _nav_cost, _nav_task, db)

    return {
        "user_message": {"id": user_msg_id, "role": "user", "content": data.content},
        "ai_message": {"id": ai_msg_id, "role": "assistant", "content": ai_response},
    }


def _build_case_context(case_dict: dict, case_type: str, case_title: str,
                        pending_tasks: list, completed_tasks: list, completion: int,
                        total_tasks: int, doc_list: list, witness_data: list, disco_data: list) -> str:
    """Build a structured case context string for the OpenAI system prompt."""
    deadline = case_dict.get("filing_deadline", "")
    court = case_dict.get("court", "")
    trial_date = case_dict.get("trial_date", "")

    ctx = f"CASE: \"{case_title}\"\n"
    ctx += f"Type: {case_type}\n"
    if court:
        ctx += f"Court/Venue: {court}\n"
    if deadline:
        ctx += f"Filing Deadline: {deadline}\n"
    if trial_date:
        ctx += f"Trial Date: {trial_date}\n"
    ctx += f"Progress: {completion}% ({len(completed_tasks)}/{total_tasks} tasks done)\n"

    if pending_tasks:
        ctx += f"\nPending Tasks ({len(pending_tasks)}):\n"
        for t in pending_tasks[:10]:
            ctx += f"  - {t}\n"

    if doc_list:
        ctx += f"\nDocuments ({len(doc_list)}):\n"
        for d in doc_list[:10]:
            ctx += f"  - {d['filename']} ({d.get('category', 'general')})\n"
    else:
        ctx += "\nDocuments: None uploaded yet\n"

    if witness_data:
        ctx += f"\nWitnesses ({len(witness_data)}):\n"
        for w in witness_data[:10]:
            ctx += f"  - {w['name']} ({w.get('witness_type', 'fact')} witness)\n"

    if disco_data:
        pending_disco = [d for d in disco_data if d.get("status") == "pending"]
        overdue_disco = [d for d in disco_data if d.get("status") == "overdue"]
        ctx += f"\nDiscovery Items: {len(disco_data)} total, {len(pending_disco)} pending, {len(overdue_disco)} overdue\n"

    return ctx


async def _generate_ai_response_openai(query: str, case_dict: dict, case_type: str, case_title: str,
                                         pending_tasks: list, completed_tasks: list, completion: int,
                                         total_tasks: int, doc_list: list, witness_data: list,
                                         disco_data: list, chat_history: list, is_paid: bool) -> str:
    """Generate AI response using OpenAI. Falls back to keyword-based if OpenAI unavailable."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Fallback to keyword-based response
        return _generate_ai_response_fallback(
            query.lower(), case_dict, case_type, case_title,
            pending_tasks, completed_tasks, completion, total_tasks,
            doc_list, witness_data, disco_data
        )

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        # Select model based on subscription tier via central router
        model = _nav_model  # already resolved by credit_gate above

        # Build case context
        case_context = _build_case_context(
            case_dict, case_type, case_title,
            pending_tasks, completed_tasks, completion, total_tasks,
            doc_list, witness_data, disco_data
        )

        system_prompt = f"""You are the LitigationSpace AI Case Navigator — an expert legal assistant embedded in a litigation management platform.

You have access to the following case data:
{case_context}

Your capabilities:
1. **Case Analysis**: Provide detailed status updates, identify gaps, assess risks
2. **Legal Research**: Cite relevant case law, statutes, and procedural rules (with jurisdiction awareness)
3. **Document Guidance**: Recommend missing documents, flag gaps in evidence
4. **Deadline Management**: Track filing deadlines, suggest timeline priorities
5. **Drafting Help**: Guide motion drafting, suggest argument structures, identify weaknesses
6. **Witness Strategy**: Help prepare deposition outlines and cross-examination questions
7. **Discovery Review**: Analyze discovery completeness, flag overdue items
8. **Procedural Guidance**: Advise on court rules, filing requirements, and procedural steps

Rules:
- Be specific to THIS case's facts, type, and jurisdiction when possible
- Use markdown formatting for readability (bold headers, bullet lists, etc.)
- When citing case law, note the citation and relevance
- If the user asks about something not in the case data, provide general legal guidance and recommend adding the data
- Be concise but thorough — lawyers value precision
- Always end with a concrete next step or actionable recommendation
- Never provide advice that could be construed as unauthorized practice of law — frame as "legal analysis support"
"""

        # Build messages with chat history
        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_history[:-1]:  # Exclude the message we just saved
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": query})

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.3,
            max_completion_tokens=1500,
        )

        ai_text = (response.choices[0].message.content or "").strip()
        if not ai_text:
            raise ValueError("Empty response from OpenAI")

        # Add model indicator for transparency
        ai_text += f"\n\n---\n*Powered by LitigationSpace AI Case Navigator*"
        return ai_text

    except Exception as e:
        logger.error(f"[LEGAL BRAIN] OpenAI error: {e}")
        # Fallback to keyword-based response
        return _generate_ai_response_fallback(
            query.lower(), case_dict, case_type, case_title,
            pending_tasks, completed_tasks, completion, total_tasks,
            doc_list, witness_data, disco_data
        )


def _generate_ai_response_fallback(query, case_dict, case_type, case_title, pending_tasks, completed_tasks, completion, total_tasks, doc_list, witness_data, disco_data):
    """Fallback keyword-based AI response when OpenAI is unavailable."""
    deadline = case_dict.get("filing_deadline", "")
    court = case_dict.get("court", "")

    if any(w in query for w in ["status", "progress", "how", "update", "overview"]):
        response = f"**Case Status for \"{case_title}\"**\n\n"
        response += f"- **Type:** {case_type}\n"
        if court:
            response += f"- **Court/Venue:** {court}\n"
        response += f"- **Completion:** {completion}% ({len(completed_tasks)}/{total_tasks} tasks done)\n"
        if deadline:
            response += f"- **Filing Deadline:** {deadline}\n"
        response += f"- **Documents:** {len(doc_list)} uploaded\n"
        response += f"- **Witnesses:** {len(witness_data)} registered\n"
        response += f"- **Discovery Items:** {len(disco_data)} tracked\n"
        if pending_tasks:
            response += f"\n**Next pending tasks:**\n"
            for t in pending_tasks[:5]:
                response += f"- {t}\n"
        return response

    if any(w in query for w in ["deadline", "date", "when", "calendar", "schedule"]):
        response = f"**Deadline & Schedule for \"{case_title}\"**\n\n"
        if deadline:
            response += f"- **Filing Deadline:** {deadline}\n"
        else:
            response += "- No filing deadline has been set for this case.\n"
        trial = case_dict.get("trial_date", "")
        if trial:
            response += f"- **Trial Date:** {trial}\n"
        if pending_tasks:
            response += f"\n**{len(pending_tasks)} tasks still pending** — prioritize these:\n"
            for t in pending_tasks[:5]:
                response += f"- {t}\n"
        return response

    # Default response
    response = f"**Case Navigator — \"{case_title}\"**\n\n"
    response += f"I'm your AI assistant for this {case_type} case. Here's what I can help with:\n\n"
    response += "- **\"What's the status?\"** — Get a full case overview\n"
    response += "- **\"What evidence is missing?\"** — Document gap analysis\n"
    response += "- **\"What are the deadlines?\"** — Schedule and deadline review\n"
    response += "- **\"Tell me about witnesses\"** — Witness roster summary\n"
    response += "- **\"Discovery status\"** — Discovery tracker overview\n"
    response += "- **\"Help me draft a motion\"** — Drafting assistance\n"
    response += f"\nCurrently at **{completion}% completion** with {len(pending_tasks)} pending tasks."
    if deadline:
        response += f" Filing deadline: **{deadline}**."
    response += "\n\n*Note: Connect OpenAI API key for advanced AI-powered responses.*"
    return response


# ═══════════════════════════════════════════════════════════
# LEGAL DRAFTS
# ═══════════════════════════════════════════════════════════

class DraftCreate(BaseModel):
    title: str
    content: Optional[str] = ""
    case_id: Optional[str] = None
    format_preset: Optional[str] = "standard"


class DraftUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    format_preset: Optional[str] = None


@router.get("/drafts")
async def list_drafts(case_id: Optional[str] = None, user=Depends(get_current_user)):
    with get_db() as db:
        if case_id:
            drafts = db.execute(
                "SELECT * FROM legal_drafts WHERE tenant_id = ? AND case_id = ? ORDER BY updated_at DESC",
                (user["tenant_id"], case_id)
            ).fetchall()
        else:
            drafts = db.execute(
                "SELECT * FROM legal_drafts WHERE tenant_id = ? ORDER BY updated_at DESC",
                (user["tenant_id"],)
            ).fetchall()
        return [dict(r) for r in drafts]


@router.post("/drafts")
async def create_draft(data: DraftCreate, user=Depends(get_current_user)):
    draft_id = str(uuid.uuid4())[:12]
    with get_db() as db:
        db.execute(
            """INSERT INTO legal_drafts (id, case_id, tenant_id, title, content, format_preset, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (draft_id, data.case_id, user["tenant_id"], data.title, data.content, data.format_preset, user["sub"])
        )
    return {"id": draft_id, "message": "Draft created"}


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        draft = db.execute(
            "SELECT * FROM legal_drafts WHERE id = ? AND tenant_id = ?",
            (draft_id, user["tenant_id"])
        ).fetchone()
        if not draft:
            raise HTTPException(404, "Draft not found")
        return dict(draft)


@router.patch("/drafts/{draft_id}")
async def update_draft(draft_id: str, data: DraftUpdate, user=Depends(get_current_user)):
    updates = {}
    if data.title is not None:
        updates["title"] = data.title
    if data.content is not None:
        updates["content"] = data.content
    if data.format_preset is not None:
        updates["format_preset"] = data.format_preset
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [draft_id, user["tenant_id"]]
    with get_db() as db:
        db.execute(f"UPDATE legal_drafts SET {set_clause} WHERE id = ? AND tenant_id = ?", values)
    return {"message": "Draft updated"}


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, user=Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM legal_drafts WHERE id = ? AND tenant_id = ?", (draft_id, user["tenant_id"]))
    return {"message": "Draft deleted"}
