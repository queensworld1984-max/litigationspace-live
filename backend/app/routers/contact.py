"""Contact form — AI auto-reply first, human team notified in parallel."""
import html as _html
import os
from fastapi import APIRouter
from pydantic import BaseModel, EmailStr
from openai import AsyncOpenAI
from app.utils.email import _send_email
from app.utils.model_router import get_model_for_task

router = APIRouter(prefix="/api/contact", tags=["contact"])
_client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

_SYSTEM = (
    "You are Queen, the LitigationSpace AI assistant. Someone just submitted a contact form. "
    "Write a warm, helpful, professional email reply that directly and specifically answers their question. "
    "LitigationSpace is an AI-powered legal operations platform. Key features: AI Legal Brain (case research), "
    "AI Drafting (motions/briefs/contracts), War Room (case command center), Case Vault (case management), "
    "Live Bench (lawyer marketplace), Win Simulator (outcome prediction), Document Analyzer, Document Signing, "
    "and Jurisdiction Intelligence. "
    "Pricing: Free tier (core tools, no card); Pro ~$29/mo (full suite); Team plans; Nonprofit discounts. "
    "Contact: info@litigationspace.com | +1 (202) 567-7753 | litigationspace.com. "
    "RULES: Start with 'Hi {name},' — no subject line. Be specific to their message. Under 200 words. "
    "End with one sentence mentioning our team will also follow up if needed."
)

# Rule-based instant answers — fire before API for speed & reliability
_RULES = [
    (("price", "pricing", "cost", "plan", "subscription", "pay", "payment", "how much", "fee", "billing", "charge"),
     "LitigationSpace has flexible pricing for every budget:\n\n"
     "• **Free** — Motion Analyzer, Win Simulator, Document Analyzer & limited Legal Brain (no card required)\n"
     "• **Pro** (~$29/mo) — Full AI suite, unlimited drafting, Case Vault & all premium features\n"
     "• **Team** — Multi-user workspace with collaboration & admin controls\n"
     "• **Nonprofit** — Discounted access; just tell us about your organization\n\n"
     "Get started free at litigationspace.com right now!"),

    (("legal brain", "ai research", "case research", "legal research"),
     "The AI Legal Brain is our core research engine — it analyzes case law, statutes, and precedents "
     "in seconds to help you build stronger arguments and strategy. Available on all plans, with unlimited "
     "queries and deeper analysis on Pro."),

    (("draft", "drafting", "motion", "brief", "contract", "demand letter", "pleading"),
     "The AI Drafting tool creates legal documents — motions, briefs, contracts, demand letters, and more — "
     "based on your instructions and case facts. Most drafts are ready in under 2 minutes. Available on Pro and Team plans."),

    (("free", "trial", "no cost", "without paying", "no credit card"),
     "Yes — several tools are completely free with no credit card needed: "
     "Motion Analyzer, Win Simulator, Document Analyzer, and limited Legal Brain. "
     "Start immediately at litigationspace.com."),

    (("war room", "case command", "warroom"),
     "War Room is LitigationSpace's case command center — a unified workspace where you manage strategy, "
     "deadlines, evidence, and AI analysis for a single case. Available on Pro and Team plans."),

    (("sign", "signature", "esign", "e-sign", "electronic sign"),
     "LitigationSpace has built-in document e-signing. Send documents for electronic signature directly "
     "from the platform — recipients sign online without needing an account. Available on Pro."),

    (("nonprofit", "non-profit", "ngo", "legal aid", "public defender", "charity", "donate"),
     "We believe in access to justice! We offer discounted plans for nonprofits, legal aid organizations, "
     "and public defenders. Reply with a brief description of your organization and we'll get you set up."),

    (("login", "password", "forgot", "reset", "access", "account", "sign in"),
     "For account access issues, go to litigationspace.com/forgot-password to reset your password. "
     "If you're still locked out, email info@litigationspace.com with your registered email address "
     "and our team will restore access within a few hours."),
]


def _quick_answer(message: str) -> str | None:
    msg_lower = message.lower()
    for keywords, answer in _RULES:
        if any(kw in msg_lower for kw in keywords):
            return answer
    return None


def _md_to_html(text: str) -> str:
    """Convert minimal markdown (bold, newlines) to safe HTML for email."""
    import re
    safe = _html.escape(text)
    # **bold** → <strong>
    safe = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', safe)
    # Bullet lines starting with •
    lines = safe.split('\n')
    html_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('•'):
            html_lines.append(f'<li style="margin:4px 0;color:#1e293b;">{stripped[1:].strip()}</li>')
        else:
            html_lines.append(stripped)
    # Wrap consecutive <li> in <ul>
    result, in_list = [], False
    for line in html_lines:
        if line.startswith('<li'):
            if not in_list:
                result.append('<ul style="padding-left:20px;margin:10px 0;">')
                in_list = True
            result.append(line)
        else:
            if in_list:
                result.append('</ul>')
                in_list = False
            if line:
                result.append(f'<p style="margin:8px 0;color:#1e293b;line-height:1.7;">{line}</p>')
    if in_list:
        result.append('</ul>')
    return ''.join(result)


class ContactPayload(BaseModel):
    name: str
    email: EmailStr
    subject: str = "General Enquiry"
    message: str


@router.post("")
async def submit_contact(payload: ContactPayload):
    """Receive contact form: generate AI reply → email user → notify team."""

    # ── 1. Generate AI answer ─────────────────────────────────────────────────
    ai_reply = _quick_answer(payload.message)

    if not ai_reply:
        try:
            model = get_model_for_task("contact_auto_reply")
            prompt = _SYSTEM.replace("{name}", _html.escape(payload.name))
            completion = await _client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Subject: {payload.subject}\n\nMessage: {payload.message}"},
                ],
                max_completion_tokens=300,
                temperature=0.7,
            )
            ai_reply = (completion.choices[0].message.content or "").strip()
        except Exception as exc:
            print(f"[CONTACT AI] OpenAI error: {exc}")
            ai_reply = ""

    # ── 2. Notify support team ────────────────────────────────────────────────
    esc_name  = _html.escape(payload.name)
    esc_email = _html.escape(str(payload.email))
    esc_subj  = _html.escape(payload.subject)
    esc_msg   = _html.escape(payload.message).replace('\n', '<br>')
    esc_reply = _html.escape(ai_reply).replace('\n', '<br>') if ai_reply else "<em>(no AI reply generated)</em>"

    internal_html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:32px 20px;">
      <h2 style="margin:0 0 8px;color:#0a1628;">New Contact Form Submission</h2>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px;">Queen sent an AI reply to the user automatically.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:8px 0;color:#64748b;width:110px;vertical-align:top;">Name</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">{esc_name}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Email</td><td style="padding:8px 0;"><a href="mailto:{esc_email}" style="color:#2563eb;">{esc_email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Subject</td><td style="padding:8px 0;color:#1e293b;">{esc_subj}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Message</td><td style="padding:8px 0;color:#1e293b;">{esc_msg}</td></tr>
      </table>
      <div style="background:#fffbf0;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;">
        <p style="color:#92400e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px;">Queen's auto-reply sent to user</p>
        <div style="color:#1e293b;font-size:14px;line-height:1.7;">{esc_reply}</div>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px;">
        If the user needs further help that Queen couldn't address, reply directly to <a href="mailto:{esc_email}">{esc_email}</a>.
      </p>
    </div>
    """
    _send_email(
        "info@litigationspace.com",
        f"[Contact] {payload.subject} — {payload.name}",
        internal_html,
    )

    # ── 3. AI reply to the user ───────────────────────────────────────────────
    if ai_reply:
        reply_body_html = _md_to_html(ai_reply)
        user_html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
          <div style="text-align:center;margin-bottom:28px;">
            <h1 style="color:#0a1628;font-size:22px;margin:0 0 4px;">LitigationSpace</h1>
            <p style="color:#64748b;font-size:13px;margin:0;">The Operating System for Litigation</p>
          </div>
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f1f5f9;">
              <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#0d1e38,#0f2a50);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">👑</div>
              <div>
                <div style="font-weight:700;color:#0a1628;font-size:15px;">Queen</div>
                <div style="color:#64748b;font-size:12px;">LitigationSpace AI Assistant</div>
              </div>
            </div>
            <div style="font-size:15px;color:#475569;margin-bottom:16px;">Hi {esc_name},</div>
            <div style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:20px;">
              Thanks for reaching out about <strong style="color:#1e293b;">{esc_subj}</strong>. Here's my answer:
            </div>
            <div style="background:#fffbf0;border-left:4px solid #F5A623;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:20px;">
              {reply_body_html}
            </div>
            <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0;">
              If you need further help or have follow-up questions, you can reply to this email,
              start a live chat at <a href="https://litigationspace.com" style="color:#F5A623;">litigationspace.com</a>,
              or call us at <a href="tel:+12025677753" style="color:#F5A623;">+1 (202) 567-7753</a>.
              A member of our team will also follow up within 24 hours.
            </p>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:20px;">
            © 2026 LitigationSpace · <a href="https://litigationspace.com" style="color:#94a3b8;">litigationspace.com</a>
          </p>
        </div>
        """
    else:
        # Fallback when AI unavailable
        user_html = f"""
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
          <div style="text-align:center;margin-bottom:28px;">
            <h1 style="color:#0a1628;font-size:22px;margin:0 0 4px;">LitigationSpace</h1>
            <p style="color:#64748b;font-size:13px;margin:0;">The Operating System for Litigation</p>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
            <h2 style="color:#0a1628;font-size:18px;margin-top:0;">We received your message</h2>
            <p style="color:#475569;line-height:1.7;">Hi {esc_name},</p>
            <p style="color:#475569;line-height:1.7;">Thank you for reaching out about <strong>{esc_subj}</strong>. We've received your message and a member of our team will reply within 24 hours.</p>
            <p style="color:#475569;font-size:14px;margin-top:20px;">
              📞 <a href="tel:+12025677753" style="color:#2563eb;">+1 (202) 567-7753</a><br>
              ✉ <a href="mailto:info@litigationspace.com" style="color:#2563eb;">info@litigationspace.com</a>
            </p>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:20px;">© 2026 LitigationSpace. All rights reserved.</p>
        </div>
        """

    _send_email(
        payload.email,
        f"Re: {payload.subject} — LitigationSpace",
        user_html,
    )

    return {"ok": True, "message": "We've sent you an immediate reply — check your inbox!"}
