"""
AI-powered support chat — streaming + live human handoff.

Public endpoints (no auth):
  POST /api/support/chat/stream   — streaming AI chat (SSE)
  POST /api/support/chat          — non-streaming AI chat (fallback)
  POST /api/support/live          — request live human agent
  GET  /api/support/live/{id}/status   — poll session status
  GET  /api/support/live/{id}/messages — poll messages
  POST /api/support/live/{id}/message  — user sends message

Admin endpoints (JWT required — protected by middleware):
  GET  /api/support/admin/live          — list sessions
  POST /api/support/admin/live/{id}/join    — agent joins
  POST /api/support/admin/live/{id}/message — agent sends
  POST /api/support/admin/live/{id}/close   — close session

Knowledge base (admin):
  POST /api/support/knowledge
  GET  /api/support/knowledge
  DEL  /api/support/knowledge/{id}
  GET  /api/support/sessions
  GET  /api/support/sessions/{id}
  POST /api/support/sessions/{id}/learn
"""
import json
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.database import get_db
from app.utils.auth import generate_id

router = APIRouter(prefix="/api/support", tags=["support"])

# ── System prompt / knowledge base ────────────────────────────────────────────

_BASE_PROMPT = """
You are Queen, the LitigationSpace AI assistant — professional, warm, and concise.
You represent LitigationSpace, built by Build Champions, a 501(c)(3) nonprofit. American-made. Serving 12+ countries.

━━━ PLATFORM FEATURES ━━━
• Legal Brain — AI legal research with case citations. Public + case-context for paid users.
• Legal Database — Federal/state case law, statutes, regulations.
• Case Vault — Case management, conflict-of-interest checks, deadlines, team collaboration.
• War Room — Litigation strategy center: visual timeline, event tracking, collaboration.
• Drafting Engine — AI drafting of motions, briefs, contracts, pleadings. Clause library.
• Live Bench (Marketplace) — On-demand verified legal experts and consultants.
• Judicial Workspace — Judicial profile research, court pattern tracking.
• Document Analyzer — AI document review and deep analysis.
• Global Legal Intel — Legal intelligence across 12+ international jurisdictions.
• Motion Analyzer (FREE, no login) — Upload any motion → weaknesses, win probability, citations.
• Win Simulator (FREE, no login) — Simulate case win probability.

━━━ PRICING ━━━
Pay As You Go   $0.10/credit  · 1 seat  ·  1 GB  — no subscription, credits as needed
Solo            $129/mo       · 1 seat  · 25 GB  — every feature, unlimited. Solo attorneys.
Small Team      $179/user/mo  · 10 seats · 100 GB — boutique firms. MOST POPULAR.
Growth          $239/user/mo  · 50 seats · 500 GB — analytics, API, webhooks, acct manager.
Enterprise      $349+/user/mo · unlimited · custom — custom deploy, SLA, white label.
Annual billing saves 20%. Solo annual ≈ $103.50/mo ($1,242/year billed once).

━━━ CONTACT ━━━
Phone  +1 (202) 567-7753  Mon–Fri 9am–6pm ET
Email  info@litigationspace.com  (reply within 24 hours)
Form   litigationspace.com/contact
Nonprofit/donations  donate@buildchampions.org

━━━ RESPONSE RULES ━━━
1. Be concise — under 100 words unless the question genuinely needs more.
2. Give exact dollar amounts for pricing questions.
3. Never invent features or prices not listed above.
4. For the user's specific legal case questions: clarify you handle platform support;
   suggest Legal Brain for legal research.
5. For account bugs or billing disputes: recommend human contact warmly.
6. If you don't know something: say so; direct to info@litigationspace.com.
7. When the user seems frustrated or needs complex help: recommend escalating to a human.
"""

# ── Lazy table init ───────────────────────────────────────────────────────────

_TABLES_READY = False


def _ensure_tables(db):
    global _TABLES_READY
    if _TABLES_READY:
        return
    db.executescript("""
        CREATE TABLE IF NOT EXISTS support_sessions (
            id         TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_messages (
            id         TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
            content    TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES support_sessions(id)
        );
        CREATE TABLE IF NOT EXISTS support_knowledge (
            id             TEXT PRIMARY KEY,
            question       TEXT NOT NULL,
            answer         TEXT NOT NULL,
            keywords       TEXT DEFAULT '',
            category       TEXT DEFAULT 'general',
            human_verified INTEGER DEFAULT 1,
            use_count      INTEGER DEFAULT 0,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_live_sessions (
            id            TEXT PRIMARY KEY,
            ai_session_id TEXT,
            user_name     TEXT DEFAULT 'Anonymous',
            user_email    TEXT,
            status        TEXT DEFAULT 'waiting'
                          CHECK(status IN ('waiting','active','closed')),
            agent_name    TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_live_messages (
            id              TEXT PRIMARY KEY,
            live_session_id TEXT NOT NULL,
            sender          TEXT NOT NULL CHECK(sender IN ('user','agent','system')),
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (live_session_id) REFERENCES support_live_sessions(id)
        );
    """)
    _TABLES_READY = True


# ── AI helpers ────────────────────────────────────────────────────────────────

def _fetch_knowledge(question: str, db) -> str:
    try:
        words = [w for w in question.lower().split() if len(w) > 3][:6]
        if not words:
            return ""
        clauses = " OR ".join(
            "(LOWER(question) LIKE ? OR LOWER(answer) LIKE ? OR LOWER(keywords) LIKE ?)"
            for _ in words
        )
        params = [p for w in words for p in (f"%{w}%", f"%{w}%", f"%{w}%")]
        rows = db.execute(
            f"SELECT question, answer FROM support_knowledge "
            f"WHERE human_verified=1 AND ({clauses}) "
            f"ORDER BY use_count DESC LIMIT 5",
            params,
        ).fetchall()
        if not rows:
            return ""
        block = "\n\n━━ VERIFIED ANSWERS FROM SUPPORT TEAM ━━\n"
        for r in rows:
            block += f"Q: {r['question']}\nA: {r['answer']}\n\n"
        return block
    except Exception:
        return ""


def _build_messages(req_messages, extra: str) -> list:
    msgs = [{"role": "system", "content": _BASE_PROMPT + extra}]
    for m in req_messages:
        msgs.append({"role": m.role, "content": m.content})
    return msgs


_UNAVAILABLE = (
    "I'm not available right now. "
    "Please email **info@litigationspace.com** "
    "or call **+1 (202) 567-7753** and we'll reply within 24 hours."
)

# ── Rule-based fast answers (work without any API key) ────────────────────────

_RULES: list[tuple[list[str], str]] = [
    (
        ["payment", "pay ", "paying", "subscribe", "subscription", "pricing", "price",
         "how much", "cost", "plan", "plans", "billing", "invoice", "charge"],
        """Here are our plans:

**Pay As You Go** — from $0.10/credit, no subscription, buy credits as needed
**Solo** — $129/month · 1 seat · 25 GB · every feature, unlimited *(best for solo attorneys)*
**Small Team** — $179/user/month · up to 10 seats · 100 GB *(most popular)*
**Growth** — $239/user/month · up to 50 seats · analytics, API access
**Enterprise** — $349+/user/month · unlimited seats · custom deployment & SLA

💡 **Annual billing saves 20%.** Solo annual = ~$103.50/month ($1,242/year).

To subscribe, click **Sign Up** at the top of the page or visit our [Pricing page](/pricing). Questions? Call **+1 (202) 567-7753** or email **info@litigationspace.com**."""
    ),
    (
        ["refund", "cancel", "cancellation", "money back"],
        """To cancel your subscription or request a refund, please contact us directly:

📧 **info@litigationspace.com**
📞 **+1 (202) 567-7753** (Mon–Fri, 9 am–6 pm ET)

You can also review our full [Refund Policy](/refund-policy). We'll sort it out quickly."""
    ),
    (
        ["free tool", "free ", "motion analyzer", "win simulator", "no login", "without account"],
        """We offer **two free tools** — no account needed:

🔍 **Motion Analyzer** — Upload any motion and get instant analysis: weaknesses, risk flags, win probability score, and landmark case citations. [Try it free →](/motion-analyzer)

📊 **Win Simulator** — Model your case win probability based on key factors. [Try it free →](/win-simulator)

**Legal Brain** and **Legal Database** also have free public access with no login required."""
    ),
    (
        ["legal brain", "ai research", "case citations", "legal question", "research"],
        """**Legal Brain** is our AI legal research assistant.

You can:
- Ask any legal question and get answers with case citations
- Analyze documents and get actionable guidance
- Use it **free** without logging in at [/legal-brain](/legal-brain)
- Get full case-context AI Q&A on paid plans (Solo and above)

It covers federal and state law across all 12+ countries we serve."""
    ),
    (
        ["drafting", "draft", "motion", "brief", "contract", "pleading", "document"],
        """**Drafting Engine** helps you create court-ready documents with AI assistance.

- Draft motions, briefs, contracts, and pleadings
- Built-in clause library
- Brand templates (Small Team plan and above)
- Available on all paid plans (Solo $129/month and up)

Start at [/drafting/new](/drafting/new) after logging in."""
    ),
    (
        ["war room", "strategy", "timeline", "case strategy", "litigation strategy"],
        """**War Room** is your litigation strategy command center.

- Visual timeline builder
- Event tracking and deadline management
- Real-time team collaboration
- Available on Solo plan ($129/month) and above

Access it from your dashboard after logging in."""
    ),
    (
        ["case vault", "case management", "organize", "cases", "conflict"],
        """**Case Vault** keeps all your cases organized in one place.

- Store and manage unlimited cases (paid plans)
- Conflict-of-interest checking
- Deadline tracking
- Team collaboration and role-based access (Small Team and above)

Available on all paid plans starting at $129/month."""
    ),
    (
        ["live bench", "expert", "marketplace", "consultant", "specialist"],
        """**Live Bench** is our on-demand expert marketplace.

- Connect with verified legal experts, consultants, and specialists instantly
- Post a matter and get matched based on practice area
- Available at [/live-bench](/live-bench)

Experts can apply to join at [/join-live-bench](/join-live-bench)."""
    ),
    (
        ["sign up", "register", "create account", "get started", "how to start", "new account"],
        """Getting started is easy:

1. Click **Sign Up** at the top of the page (or go to [/register](/register))
2. Create your account — it only takes 2 minutes
3. Choose a plan on the [Pricing page](/pricing) or start with our free tools

Need help? Call **+1 (202) 567-7753** or email **info@litigationspace.com**."""
    ),
    (
        ["login", "log in", "sign in", "password", "forgot", "access account"],
        """To log in, go to [/login](/login) or click **Sign In** at the top of the page.

Forgot your password? Use the [Forgot Password](/forgot-password) link on the login page and we'll send a reset email.

Still having trouble? Email **info@litigationspace.com** with your account email and we'll help you in."""
    ),
    (
        ["contact", "phone", "email", "reach", "speak", "talk to", "human", "person", "support team"],
        """Here's how to reach us:

📞 **Phone:** +1 (202) 567-7753 (Mon–Fri, 9 am–6 pm ET)
📧 **Email:** info@litigationspace.com *(reply within 24 hours)*
📝 **Contact form:** [litigationspace.com/contact](/contact)

For nonprofit/donation inquiries: **donate@buildchampions.org**

Or click **"Connect with a real person"** below to start a live chat."""
    ),
    (
        ["nonprofit", "donate", "donation", "build champions", "501", "charity", "partnership"],
        """LitigationSpace is built by **Build Champions**, a registered 501(c)(3) nonprofit dedicated to democratizing access to justice.

💛 **Donate:** [/donate](/donate)
📧 **Partnership inquiries:** donate@buildchampions.org
ℹ️ **Learn more:** [/about-build-champions](/about-build-champions)

Donations are tax-deductible to the extent permitted by law."""
    ),
    (
        ["security", "encryption", "data", "privacy", "compliance", "hipaa", "soc"],
        """LitigationSpace takes security seriously:

🔐 **AES-256 encryption** on all data at rest and in transit
✅ **SOC 2 compliant** infrastructure
🇺🇸 **USA-based servers**
🔒 **SSO/SAML 2.0** available on Growth and Enterprise plans

Read our full [Privacy Policy](/privacy) and [Compliance page](/compliance)."""
    ),
]


def _rule_answer(question: str) -> str | None:
    """Return a pre-written answer if the question matches a known pattern."""
    q = question.lower()
    for keywords, answer in _RULES:
        if any(kw in q for kw in keywords):
            return answer
    return None


# ── Pydantic models ───────────────────────────────────────────────────────────

class ChatMsg(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMsg]
    session_id: Optional[str] = None


class KnowledgeEntry(BaseModel):
    question: str
    answer: str
    keywords: str = ""
    category: str = "general"


class LiveSessionReq(BaseModel):
    ai_session_id: Optional[str] = None
    user_name: Optional[str] = "Anonymous"
    user_email: Optional[str] = None


class LiveMsgReq(BaseModel):
    content: str


class JoinReq(BaseModel):
    agent_name: str = "Support Agent"


# ── Streaming AI chat ─────────────────────────────────────────────────────────

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Streaming SSE AI chat endpoint."""
    # All DB work before the async generator
    with get_db() as db:
        _ensure_tables(db)
        session_id = req.session_id
        if not session_id:
            session_id = generate_id()
            db.execute(
                "INSERT INTO support_sessions (id, created_at) VALUES (?,?)",
                (session_id, datetime.now(timezone.utc).isoformat()),
            )
        user_msgs = [m for m in req.messages if m.role == "user"]
        last_q = user_msgs[-1].content if user_msgs else ""
        extra = _fetch_knowledge(last_q, db)

    chat_messages = _build_messages(req.messages, extra)
    # Try rule-based answer first (fast, no API needed)
    rule_reply = _rule_answer(last_q) if last_q else None

    async def generate():
        nonlocal rule_reply
        if rule_reply:
            # Stream the rule reply character by character for the live feel
            for char in rule_reply:
                yield f"data: {json.dumps({'delta': char})}\n\n"
            now = datetime.now(timezone.utc).isoformat()
            try:
                with get_db() as db:
                    if last_q:
                        db.execute(
                            "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                            (generate_id(), session_id, "user", last_q, now),
                        )
                    db.execute(
                        "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                        (generate_id(), session_id, "assistant", rule_reply, now),
                    )
            except Exception:
                pass
            yield f"data: {json.dumps({'done': True, 'session_id': session_id})}\n\n"
            return

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            yield f"data: {json.dumps({'delta': _UNAVAILABLE})}\n\n"
            yield f"data: {json.dumps({'done': True, 'session_id': session_id})}\n\n"
            return

        full_reply = ""
        try:
            from openai import AsyncOpenAI
            from app.utils.model_router import get_model_for_task

            client = AsyncOpenAI(api_key=api_key)
            model = get_model_for_task("support_chat")

            stream = await client.chat.completions.create(
                model=model,
                messages=chat_messages,
                temperature=0.3,
                max_completion_tokens=400,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_reply += delta
                    yield f"data: {json.dumps({'delta': delta})}\n\n"

        except Exception:
            err = "I'm having trouble connecting. Please email info@litigationspace.com."
            full_reply = err
            yield f"data: {json.dumps({'delta': err})}\n\n"

        # Persist messages
        now = datetime.now(timezone.utc).isoformat()
        try:
            with get_db() as db:
                if last_q:
                    db.execute(
                        "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                        (generate_id(), session_id, "user", last_q, now),
                    )
                if full_reply:
                    db.execute(
                        "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                        (generate_id(), session_id, "assistant", full_reply, now),
                    )
        except Exception:
            pass

        yield f"data: {json.dumps({'done': True, 'session_id': session_id})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Non-streaming AI chat (fallback) ─────────────────────────────────────────

@router.post("/chat")
def chat(req: ChatRequest):
    with get_db() as db:
        _ensure_tables(db)
        session_id = req.session_id
        if not session_id:
            session_id = generate_id()
            db.execute(
                "INSERT INTO support_sessions (id, created_at) VALUES (?,?)",
                (session_id, datetime.now(timezone.utc).isoformat()),
            )
        user_msgs = [m for m in req.messages if m.role == "user"]
        last_q = user_msgs[-1].content if user_msgs else ""
        extra = _fetch_knowledge(last_q, db)

    # Rule-based answer first
    rule_reply = _rule_answer(last_q) if last_q else None
    if rule_reply:
        reply = rule_reply
    else:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            reply = _UNAVAILABLE
        else:
            try:
                from openai import OpenAI
                from app.utils.model_router import get_model_for_task

                client = OpenAI(api_key=api_key)
                model = get_model_for_task("support_chat")
                resp = client.chat.completions.create(
                    model=model,
                    messages=_build_messages(req.messages, extra),
                    temperature=0.3,
                    max_completion_tokens=400,
                )
                reply = resp.choices[0].message.content or "Sorry, I couldn't generate a response."
            except Exception:
                reply = _UNAVAILABLE

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        if last_q:
            db.execute(
                "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                (generate_id(), session_id, "user", last_q, now),
            )
        db.execute(
            "INSERT INTO support_messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), session_id, "assistant", reply, now),
        )

    return {"reply": reply, "session_id": session_id}


# ── Live chat — user endpoints ────────────────────────────────────────────────

@router.post("/live")
def create_live_session(req: LiveSessionReq):
    """User requests a human agent."""
    with get_db() as db:
        _ensure_tables(db)
        live_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "INSERT INTO support_live_sessions "
            "(id,ai_session_id,user_name,user_email,status,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (live_id, req.ai_session_id, req.user_name or "Anonymous",
             req.user_email, "waiting", now, now),
        )
        db.execute(
            "INSERT INTO support_live_messages (id,live_session_id,sender,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), live_id, "system",
             f"Chat started by {req.user_name or 'Anonymous'}. Waiting for a support agent…", now),
        )

    # Email notification to admin
    try:
        from app.utils.email import _send_email
        _send_email(
            "info@litigationspace.com",
            f"[Live Support] New request from {req.user_name or 'Anonymous'}",
            f"""<div style="font-family:sans-serif;max-width:500px;padding:24px;">
              <h2 style="color:#0a1628;">New Live Support Request</h2>
              <p><strong>Name:</strong> {req.user_name or 'Anonymous'}</p>
              <p><strong>Email:</strong> {req.user_email or 'Not provided'}</p>
              <p><strong>Session ID:</strong> {live_id}</p>
              <a href="https://litigationspace.com/admin/support"
                 style="background:#F5A623;color:#000;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:12px;">
                Open Admin Panel
              </a>
            </div>""",
        )
    except Exception:
        pass

    return {"live_session_id": live_id, "status": "waiting"}


@router.get("/live/{live_id}/status")
def get_live_status(live_id: str):
    with get_db() as db:
        row = db.execute(
            "SELECT status, agent_name FROM support_live_sessions WHERE id=?", (live_id,)
        ).fetchone()
    if not row:
        return {"status": "not_found"}
    return {"status": row["status"], "agent_name": row["agent_name"]}


@router.get("/live/{live_id}/messages")
def get_live_messages(live_id: str, since: Optional[str] = None):
    with get_db() as db:
        if since:
            rows = db.execute(
                "SELECT * FROM support_live_messages WHERE live_session_id=? AND created_at>? ORDER BY created_at ASC",
                (live_id, since),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM support_live_messages WHERE live_session_id=? ORDER BY created_at ASC",
                (live_id,),
            ).fetchall()
    return {"messages": [dict(r) for r in rows]}


@router.post("/live/{live_id}/message")
def send_live_message(live_id: str, msg: LiveMsgReq):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            "INSERT INTO support_live_messages (id,live_session_id,sender,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), live_id, "user", msg.content, now),
        )
        db.execute(
            "UPDATE support_live_sessions SET updated_at=? WHERE id=?", (now, live_id)
        )
    return {"ok": True}


# ── Live chat — admin endpoints (protected by middleware) ─────────────────────

@router.get("/admin/live")
def admin_list_sessions():
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            "SELECT s.id, s.user_name, s.user_email, s.status, s.agent_name, "
            "s.created_at, s.updated_at, COUNT(m.id) as message_count "
            "FROM support_live_sessions s "
            "LEFT JOIN support_live_messages m ON m.live_session_id=s.id "
            "GROUP BY s.id "
            "ORDER BY CASE s.status WHEN 'waiting' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, "
            "s.created_at DESC LIMIT 100"
        ).fetchall()
    return {"sessions": [dict(r) for r in rows]}


@router.post("/admin/live/{live_id}/join")
def admin_join(live_id: str, req: JoinReq):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            "UPDATE support_live_sessions SET status='active', agent_name=?, updated_at=? WHERE id=?",
            (req.agent_name, now, live_id),
        )
        db.execute(
            "INSERT INTO support_live_messages (id,live_session_id,sender,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), live_id, "system", f"✅ {req.agent_name} has joined the chat.", now),
        )
    return {"ok": True}


@router.post("/admin/live/{live_id}/message")
def admin_send_message(live_id: str, msg: LiveMsgReq):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            "INSERT INTO support_live_messages (id,live_session_id,sender,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), live_id, "agent", msg.content, now),
        )
        db.execute(
            "UPDATE support_live_sessions SET updated_at=? WHERE id=?", (now, live_id)
        )
    return {"ok": True}


@router.post("/admin/live/{live_id}/close")
def admin_close(live_id: str):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            "UPDATE support_live_sessions SET status='closed', updated_at=? WHERE id=?",
            (now, live_id),
        )
        db.execute(
            "INSERT INTO support_live_messages (id,live_session_id,sender,content,created_at) VALUES (?,?,?,?,?)",
            (generate_id(), live_id, "system", "Chat session ended.", now),
        )
    return {"ok": True}


# ── Knowledge base ────────────────────────────────────────────────────────────

@router.post("/knowledge")
def add_knowledge(entry: KnowledgeEntry):
    with get_db() as db:
        _ensure_tables(db)
        now = datetime.now(timezone.utc).isoformat()
        eid = generate_id()
        db.execute(
            "INSERT INTO support_knowledge "
            "(id,question,answer,keywords,category,human_verified,use_count,created_at,updated_at) "
            "VALUES (?,?,?,?,?,1,0,?,?)",
            (eid, entry.question.strip(), entry.answer.strip(),
             entry.keywords.strip(), entry.category, now, now),
        )
    return {"ok": True, "id": eid}


@router.get("/knowledge")
def list_knowledge():
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            "SELECT * FROM support_knowledge ORDER BY use_count DESC, created_at DESC"
        ).fetchall()
    return {"entries": [dict(r) for r in rows]}


@router.delete("/knowledge/{entry_id}")
def delete_knowledge(entry_id: str):
    with get_db() as db:
        db.execute("DELETE FROM support_knowledge WHERE id=?", (entry_id,))
    return {"ok": True}


@router.get("/sessions")
def list_sessions():
    with get_db() as db:
        _ensure_tables(db)
        rows = db.execute(
            "SELECT s.id, s.created_at, COUNT(m.id) as message_count "
            "FROM support_sessions s "
            "LEFT JOIN support_messages m ON m.session_id=s.id "
            "GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100"
        ).fetchall()
    return {"sessions": [dict(r) for r in rows]}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    with get_db() as db:
        msgs = db.execute(
            "SELECT * FROM support_messages WHERE session_id=? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()
    return {"messages": [dict(m) for m in msgs]}


@router.post("/sessions/{session_id}/learn")
def learn_from_session(session_id: str, entry: KnowledgeEntry):
    with get_db() as db:
        _ensure_tables(db)
        now = datetime.now(timezone.utc).isoformat()
        eid = generate_id()
        db.execute(
            "INSERT INTO support_knowledge "
            "(id,question,answer,keywords,category,human_verified,use_count,created_at,updated_at) "
            "VALUES (?,?,?,?,?,1,0,?,?)",
            (eid, entry.question.strip(), entry.answer.strip(),
             entry.keywords.strip(), entry.category, now, now),
        )
    return {"ok": True, "id": eid}
