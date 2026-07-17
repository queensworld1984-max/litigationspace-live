"""Email utility for sending verification and password reset emails via SMTP."""
import html as html_escape
import os
import re
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

SMTP_HOST = os.environ.get("SMTP_HOST", "localhost")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_USER_MARKETING = os.environ.get("SMTP_USER_MARKETING", "")
SMTP_PASS_MARKETING = os.environ.get("SMTP_PASS_MARKETING", "")
SMTP_USER_BILLING   = os.environ.get("SMTP_USER_BILLING",   "")
SMTP_PASS_BILLING   = os.environ.get("SMTP_PASS_BILLING",   "")
SMTP_USER_SALES     = os.environ.get("SMTP_USER_SALES",     "")
SMTP_PASS_SALES     = os.environ.get("SMTP_PASS_SALES",     "")
SMTP_FROM           = os.environ.get("SMTP_FROM",           "info@litigationspace.com")
SMTP_FROM_BILLING   = os.environ.get("SMTP_FROM_BILLING",   "billing@litigationspace.com")
SMTP_FROM_MARKETING = os.environ.get("SMTP_FROM_MARKETING", "marketing@litigationspace.com")
SMTP_FROM_SALES     = os.environ.get("SMTP_FROM_SALES",     "sales@litigationspace.com")
BASE_URL = os.environ.get("BASE_URL", "https://litigationspace.com")

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def parse_recipients(raw) -> list:
    """Split a recipient field into a clean list of valid addresses.
    Accepts a single address, a comma/semicolon-separated string (e.g. someone
    typed "a@x.com, b@x.com" into a single-recipient box), or a list. Invalid
    entries are dropped rather than passed to smtplib, where a comma-joined
    string is rejected outright as a single malformed RFC 5321 address."""
    if not raw:
        return []
    parts = raw if isinstance(raw, (list, tuple)) else re.split(r'[;,]', str(raw))
    out, seen = [], set()
    for p in parts:
        addr = (p or "").strip()
        if addr and _EMAIL_RE.match(addr) and addr.lower() not in seen:
            seen.add(addr.lower())
            out.append(addr)
    return out


def _send_email(to_email, subject: str, html_body: str, sender: str = None, cc=None) -> tuple:
    """Send an email via SMTP. Returns (success, detail) — detail explains
    failures (invalid address, auth error, bounce reason) instead of hiding them.
    Supports local Postfix (localhost:25 no auth) and remote SMTP (with TLS+auth).
    `cc`, if given, is added to the envelope recipients (so it's actually
    delivered, not just displayed) and de-duped against the To list."""
    recipients = parse_recipients(to_email)
    if not recipients:
        detail = f"No valid recipient address found in {to_email!r}"
        print(f"[EMAIL] {detail}")
        return False, detail

    cc_recipients = [c for c in parse_recipients(cc) if c.lower() not in {r.lower() for r in recipients}]
    envelope_recipients = recipients + cc_recipients

    if not SMTP_HOST:
        print(f"[EMAIL] SMTP not configured. Would send to {recipients} (cc {cc_recipients}): {subject}")
        print(f"[EMAIL] Body preview: {html_body[:200]}")
        return False, "SMTP not configured"

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        _from = sender or SMTP_FROM
        msg["From"] = f"LitigationSpace <{_from}>"
        msg["To"] = ", ".join(recipients)
        if cc_recipients:
            msg["Cc"] = ", ".join(cc_recipients)
        msg["Reply-To"] = "support@litigationspace.com"
        import re as _re
        plain_text = _re.sub(r'<[^>]+>', ' ', html_body)
        plain_text = _re.sub(r'  +', ' ', plain_text).strip()
        msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        if SMTP_HOST in ("localhost", "127.0.0.1") and not SMTP_USER:
            # Local Postfix — no auth/TLS needed
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                failures = server.sendmail(_from, envelope_recipients, msg.as_string())
        else:
            # Remote SMTP — TLS + auth
            context = ssl.create_default_context()
            # Select credentials based on sender address — each of our sending
            # identities (billing@, marketing@, sales@) has its own SMTP login;
            # falling through to the default info@ credentials here would
            # authenticate as the wrong account for that From address.
            if _from == SMTP_FROM_MARKETING and SMTP_USER_MARKETING:
                _user, _pass = SMTP_USER_MARKETING, SMTP_PASS_MARKETING
            elif _from == SMTP_FROM_SALES and SMTP_USER_SALES:
                _user, _pass = SMTP_USER_SALES, SMTP_PASS_SALES
            elif _from == SMTP_FROM_BILLING and SMTP_USER_BILLING:
                _user, _pass = SMTP_USER_BILLING, SMTP_PASS_BILLING
            else:
                _user, _pass = SMTP_USER, SMTP_PASS
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(_user, _pass)
                failures = server.sendmail(_from, envelope_recipients, msg.as_string())

        if failures:
            # Partial failure — smtplib only raises when ALL recipients are refused.
            sent_to = [r for r in envelope_recipients if r not in failures]
            detail = f"Delivered to {sent_to or 'none'}; refused: {failures}"
            print(f"[EMAIL] Partial send for {subject}: {detail}")
            return bool(sent_to), detail

        print(f"[EMAIL] Sent successfully to {envelope_recipients}: {subject}")
        return True, ""
    except Exception as e:
        detail = str(e)
        print(f"[EMAIL ERROR] Failed to send to {recipients}: {detail}")
        return False, detail


def send_verification_email(to_email: str, token: str, full_name: str) -> bool:
    """Send email verification link."""
    verify_url = f"{BASE_URL}/api/auth/verify-email?token={token}"
    subject = "Please confirm your email address – LitigationSpace"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">The Operating System for Litigation</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Verify your email address</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {full_name},</p>
            <p style="color: #475569; line-height: 1.6;">Welcome to LitigationSpace. Please verify your email address to activate your account.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{verify_url}" style="display: inline-block; background-color: #4f46e5; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Verify Email Address</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {verify_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_document_review_email(to_email: str, reviewer_name: str, sender_name: str,
                                doc_filename: str, review_url: str, instruction_message: str) -> bool:
    """Send a document review invitation email."""
    subject = f"{sender_name} shared a document for your review"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Document Review Request</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Document Review</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {reviewer_name},</p>
            <p style="color: #475569; line-height: 1.6;">{instruction_message}</p>
            <div style="background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #0369a1; font-size: 14px; margin: 0; font-weight: 600;">Document: {doc_filename}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{review_url}" style="display: inline-block; background-color: #4f46e5; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review Document</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">Click the button above to open the document, leave comments on specific pages, and approve or request changes.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {review_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_reviewer_update_email(to_email: str, reviewer_name: str, sender_name: str,
                                doc_filename: str, review_url: str, message: str) -> bool:
    """Send email notifying reviewer that a document has been updated and is ready for re-review."""
    subject = f"{sender_name} updated a document — please re-review"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Document Updated — Re-Review Requested</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Document Updated</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {reviewer_name},</p>
            <p style="color: #475569; line-height: 1.6;">{message}</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 14px; margin: 0; font-weight: 600;">Updated Document: {doc_filename}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{review_url}" style="display: inline-block; background-color: #d97706; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Re-Review Document</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">The document has been revised based on your previous feedback. Please review the updates and approve or provide further comments.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {review_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_signature_request_email(to_email: str, signer_name: str, sender_name: str,
                                  doc_filename: str, sign_url: str, message: str,
                                  page_count: int = 1) -> bool:
    """Send a signature request email to a signer."""
    subject = f"{sender_name} requests your signature"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Signature Request</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Signature Required</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {signer_name},</p>
            <p style="color: #475569; line-height: 1.6;">{message}</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 14px; margin: 0; font-weight: 600;">Document: {doc_filename}</p>
                <p style="color: #92400e; font-size: 13px; margin: 4px 0 0 0;">Signature required on {page_count} page{'s' if page_count > 1 else ''}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{sign_url}" style="display: inline-block; background-color: #d97706; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review & Sign Document</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">You can review the full document before signing. When ready, click "Sign" and the system will walk you through each page that needs your signature.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {sign_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_signature_completed_email(to_email: str, signer_name: str,
                                    doc_filename: str, download_url: str) -> bool:
    """Send email to signer with the completed signed document."""
    subject = f"Signed document ready — {doc_filename}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Signature Completed</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">Document Signed Successfully</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {signer_name},</p>
            <p style="color: #475569; line-height: 1.6;">Your signature has been applied to <strong>{doc_filename}</strong>. You can download the signed copy below for your records.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{download_url}" style="display: inline-block; background-color: #16a34a; background: linear-gradient(135deg, #22c55e, #16a34a); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Download Signed Document</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">A copy has also been saved to the document owner's case file.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_document_uploaded_thankyou_email(to_email: str, signer_name: str,
                                           doc_filename: str, firm_name: str) -> bool:
    """Thank a recipient for downloading, hand-signing, and uploading a
    document back — the wet-sign flow's equivalent of send_signature_completed_email
    (that one is for the in-browser canvas e-sign flow)."""
    subject = f"Thank you — we received your signed {doc_filename}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Document Received</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">Thank you, {signer_name}</h2>
            <p style="color: #475569; line-height: 1.6;">{firm_name} has received your signed copy of <strong>{doc_filename}</strong>. No further action is needed from you on this document.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_document_signed_firm_notify_email(to_email: str, staff_name: str, contact_name: str,
                                            doc_filename: str, case_title: str, download_url: str) -> bool:
    """Notify the internal staff member who sent a document link that the
    recipient has completed and returned it — the firm-side counterpart to
    send_signature_completed_email/send_document_uploaded_thankyou_email,
    which only notify the recipient."""
    subject = f"✓ {contact_name} signed and returned: {doc_filename}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Document Signed</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ {contact_name} completed this document</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {staff_name},</p>
            <p style="color: #475569; line-height: 1.6;">{contact_name} has signed and returned <strong>{doc_filename}</strong>{f' on {case_title}' if case_title else ''}. Any remaining scheduled follow-up emails for this contact have been automatically stopped.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{download_url}" style="display: inline-block; background-color: #16a34a; background: linear-gradient(135deg, #22c55e, #16a34a); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Signed Document</a>
            </div>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_scope_approval_email(to_email, client_name: str, sender_name: str,
                               task_title: str, task_description: str, entity_name: str,
                               approval_url: str, cc: str = None) -> tuple:
    """Send a Gate 1 scope-approval request — client approves the task description
    and which entity it's for before any work begins."""
    subject = f"{sender_name} needs your approval to start: {task_title}"
    # Escape + convert newlines to <br> so a pasted numbered/lettered scope
    # keeps its line breaks in the email exactly as it does on the actual
    # approval page (which already renders this field with white-space:
    # pre-wrap) — plain HTML collapses raw "\n" characters otherwise.
    task_description_html = html_escape.escape(task_description or "").replace("\n", "<br>\n")
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Scope Approval Requested</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Approve this task before work starts</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {client_name},</p>
            <p style="color: #475569; line-height: 1.6;">{sender_name} wants to confirm this task is authorized before beginning any work:</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: #1e40af; font-size: 14px; margin: 8px 0 0 0; white-space: pre-wrap;">{task_description_html}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{approval_url}" style="display: inline-block; background-color: #2563eb; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Approve Scope</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">No work begins until you approve. Your decision and timestamp are recorded.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {approval_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING, cc=cc)


def send_scope_reminder_email(to_email, client_name: str, sender_name: str,
                               task_title: str, entity_name: str,
                               approval_url: str, days_pending: int, cc: str = None) -> tuple:
    """Nudge email for a Gate 1 scope-approval request that's already been sent
    but hasn't been acted on yet — reuses the same approval link."""
    subject = f"Reminder: still waiting on your approval — {task_title}"
    pending_note = (
        f"This has been waiting for your review for {days_pending} day{'s' if days_pending != 1 else ''} now."
        if days_pending > 0 else "This is still waiting for your review."
    )
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Reminder — Scope Approval Pending</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Still waiting on your approval</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {client_name},</p>
            <p style="color: #475569; line-height: 1.6;">Just a reminder from {sender_name} — no work has started on this task yet because it's still waiting on your sign-off. {pending_note}</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{approval_url}" style="display: inline-block; background-color: #2563eb; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Approve Scope</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">No work begins until you approve. Your decision and timestamp are recorded.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {approval_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING, cc=cc)


def send_billing_reminder_email(to_email, client_name: str, sender_name: str,
                                 task_title: str, entity_name: str, amount: float,
                                 approval_url: str, days_pending: int, cc: str = None) -> tuple:
    """Nudge email for a Gate 2 billing-approval request that's already been
    sent but hasn't been acted on yet — reuses the same approval link."""
    subject = f"Reminder: bill awaiting your approval — {task_title}"
    pending_note = (
        f"This bill has been waiting for your approval for {days_pending} day{'s' if days_pending != 1 else ''} now."
        if days_pending > 0 else "This bill is still waiting for your approval."
    )
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Reminder — Billing Approval Pending</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Still waiting on your approval</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {client_name},</p>
            <p style="color: #475569; line-height: 1.6;">Just a reminder from {sender_name} — this bill can't be invoiced until it's approved. {pending_note}</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #92400e; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: #92400e; font-size: 20px; margin: 8px 0 0 0; font-weight: 700;">${amount:,.2f}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{approval_url}" style="display: inline-block; background-color: #d97706; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Approve Bill</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This exact amount, once approved, will be included on your next invoice. Your decision and timestamp are recorded.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {approval_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING, cc=cc)


def send_campaign_approval_email(to_email, approver_name: str, sender_name: str,
                                  case_title: str, campaign_type_label: str,
                                  recipient_names: str, step_count: int,
                                  approval_url: str) -> tuple:
    """Send an outreach campaign to a named approver (e.g. a supervisor with
    no LitigationSpace login) for review before any of its emails send —
    no account required, the token in the link is the credential."""
    subject = f"{sender_name} needs your approval to send: {campaign_type_label}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Email Campaign Approval Requested</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Approve this email sequence before it sends</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {approver_name},</p>
            <p style="color: #475569; line-height: 1.6;">{sender_name} has staged a {step_count}-step email sequence and needs your approval before anything is sent:</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Case: {case_title}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{campaign_type_label}</p>
                <p style="color: #1e40af; font-size: 14px; margin: 8px 0 0 0;">To: {recipient_names}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{approval_url}" style="display: inline-block; background-color: #2563eb; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Approve Campaign</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">No emails go out until you approve. You'll be able to see exactly what the first message says before deciding. Your decision and timestamp are recorded.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {approval_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)


def send_campaign_approved_notify_email(to_email, requester_name: str, approver_name: str,
                                         case_title: str, campaign_type_label: str) -> bool:
    """Notify whoever requested the campaign approval that it was approved —
    step 1 is now sending on schedule."""
    subject = f"Approved: {campaign_type_label} — {case_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Campaign Approved</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ {approver_name} approved this campaign</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {requester_name},</p>
            <p style="color: #475569; line-height: 1.6;">The {campaign_type_label} sequence for <strong>{case_title}</strong> has been authorized. Step 1 is ready to send.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_campaign_rejected_notify_email(to_email, requester_name: str, approver_name: str,
                                         case_title: str, campaign_type_label: str, reason: str = "") -> bool:
    """Notify whoever requested the campaign approval that it was rejected."""
    subject = f"Rejected: {campaign_type_label} — {case_title}"
    reason_block = (
        f"""<div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #991b1b; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Reason given</p>
                <p style="color: #7f1d1d; font-size: 14px; margin: 0; white-space: pre-wrap;">{reason}</p>
            </div>"""
        if reason else ""
    )
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Campaign Rejected</p>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 32px;">
            <h2 style="color: #991b1b; font-size: 20px; margin-top: 0;">{approver_name} rejected this campaign</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {requester_name},</p>
            <p style="color: #475569; line-height: 1.6;">The {campaign_type_label} sequence for <strong>{case_title}</strong> was not authorized. No emails will be sent.</p>
            {reason_block}
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_billing_approval_email(to_email, client_name: str, sender_name: str,
                                 task_title: str, entity_name: str, fee_description: str,
                                 amount: float,
                                 approval_url: str, attachment_count: int = 0, cc: str = None) -> tuple:
    """Send a Gate 2 billing-approval request — client approves the exact dollar
    amount for completed work before it can roll into an invoice."""
    subject = f"{sender_name} sent you a bill for approval: {task_title}"
    attachment_note = (
        f"""<p style="color: #475569; line-height: 1.6;">📎 {attachment_count} finished document{'s' if attachment_count != 1 else ''} attached — view and download {'them' if attachment_count != 1 else 'it'} on the approval page.</p>"""
        if attachment_count > 0 else ""
    )
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Billing Approval Requested</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Approve this bill</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {client_name},</p>
            <p style="color: #475569; line-height: 1.6;">{sender_name} completed the previously approved task below and is requesting approval of the amount owed:</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #92400e; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: #92400e; font-size: 14px; margin: 8px 0 0 0;">{fee_description}</p>
                <p style="color: #92400e; font-size: 20px; margin: 8px 0 0 0; font-weight: 700;">${amount:,.2f}</p>
            </div>
            {attachment_note}
            <div style="text-align: center; margin: 30px 0;">
                <a href="{approval_url}" style="display: inline-block; background-color: #d97706; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review &amp; Approve Bill</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This exact amount, once approved, will be included on your next invoice. Your decision and timestamp are recorded.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {approval_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING, cc=cc)


def send_scope_query_contractor_email(to_email: str, contractor_name: str, task_title: str,
                                       entity_name: str, client_name: str, query_note: str,
                                       dashboard_url: str) -> bool:
    """Notify the contractor that the client sent the scope request back with
    a question — not a rejection, just needs clarification before they'll approve."""
    subject = f"{client_name} has a question before approving: {task_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Question Before Approval</p>
        </div>
        <div style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 12px; padding: 32px;">
            <h2 style="color: #92400e; font-size: 20px; margin-top: 0;">{client_name} sent this back with a question</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {contractor_name},</p>
            <p style="color: #475569; line-height: 1.6;">Before approving the task below, {client_name} wants clarification:</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
            </div>
            <div style="background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #9a3412; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Their note</p>
                <p style="color: #7c2d12; font-size: 14px; margin: 0; white-space: pre-wrap;">{query_note}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboard_url}" style="display: inline-block; background-color: #d97706; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review in Dashboard</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">Update the task if needed and resend it for approval once you've addressed this.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_scope_rejected_contractor_email(to_email: str, contractor_name: str, task_title: str,
                                          entity_name: str, client_name: str, reason: str,
                                          dashboard_url: str) -> bool:
    """Notify the contractor that the client rejected the scope request."""
    subject = f"{client_name} rejected: {task_title}"
    reason_block = (
        f"""<div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #991b1b; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">Reason given</p>
                <p style="color: #7f1d1d; font-size: 14px; margin: 0; white-space: pre-wrap;">{reason}</p>
            </div>"""
        if reason else ""
    )
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Scope Rejected</p>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 32px;">
            <h2 style="color: #991b1b; font-size: 20px; margin-top: 0;">{client_name} rejected this task</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {contractor_name},</p>
            <p style="color: #475569; line-height: 1.6;">Work should not begin — this task was not authorized:</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
            </div>
            {reason_block}
            <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboard_url}" style="display: inline-block; background-color: #dc2626; background: linear-gradient(135deg, #ef4444, #dc2626); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review in Dashboard</a>
            </div>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_scope_approved_contractor_email(to_email: str, contractor_name: str, task_title: str,
                                          entity_name: str, approved_by_name: str) -> bool:
    """Notify the contractor that the client approved the scope — they can begin work."""
    subject = f"Scope approved — you can start: {task_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Scope Approved</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ {approved_by_name} approved the scope</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {contractor_name},</p>
            <p style="color: #475569; line-height: 1.6;">The scope of work below has been authorized. You're clear to begin.</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">Once work is complete, send the bill for approval to lock in the final amount.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_scope_approved_confirm_client_email(to_email: str, client_name: str, task_title: str,
                                              entity_name: str) -> bool:
    """Confirm to the client/supervisor that their scope approval was recorded."""
    subject = f"You approved: {task_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Approval Confirmed</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ Thank you, {client_name}</h2>
            <p style="color: #475569; line-height: 1.6;">You've authorized the task below to begin.</p>
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e3a8a; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e3a8a; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">Once the work is complete, you'll receive a separate request to approve the exact billed amount before any invoice is issued.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_billing_approved_contractor_email(to_email: str, contractor_name: str, task_title: str,
                                            entity_name: str, amount: float, approved_by_name: str) -> bool:
    """Notify the contractor that the client approved the bill — ready to invoice."""
    subject = f"Bill approved — ready to invoice: {task_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Bill Approved</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ {approved_by_name} approved the bill</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {contractor_name},</p>
            <p style="color: #475569; line-height: 1.6;">The amount below is locked in and ready to be added to an invoice.</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #92400e; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: #92400e; font-size: 20px; margin: 8px 0 0 0; font-weight: 700;">${amount:,.2f}</p>
            </div>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_billing_approved_confirm_client_email(to_email: str, client_name: str, task_title: str,
                                                entity_name: str, amount: float) -> bool:
    """Confirm to the client/supervisor that their billing approval was recorded — invoice coming."""
    subject = f"You approved the bill — invoice coming shortly: {task_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Approval Confirmed</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 32px;">
            <h2 style="color: #166534; font-size: 20px; margin-top: 0;">✓ Thank you, {client_name}</h2>
            <p style="color: #475569; line-height: 1.6;">You've approved the amount below for the task:</p>
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #92400e; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #92400e; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: #92400e; font-size: 20px; margin: 8px 0 0 0; font-weight: 700;">${amount:,.2f}</p>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">You should expect an invoice for this task shortly.</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_deadline_reminder_contractor_email(to_email: str, contractor_name: str, task_title: str,
                                             entity_name: str, target_end_date: str, overdue: bool) -> bool:
    """Remind the contractor that a task's target completion date is approaching or has passed."""
    subject = (f"Overdue: {task_title}" if overdue else f"Due soon: {task_title}")
    status_line = "This task's target completion date has passed." if overdue else "This task's target completion date is coming up."
    color = "#dc2626" if overdue else "#d97706"
    bg = "#fef2f2" if overdue else "#fffbeb"
    border = "#fca5a5" if overdue else "#fbbf24"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Deadline Reminder</p>
        </div>
        <div style="background: {bg}; border: 1px solid {border}; border-radius: 12px; padding: 32px;">
            <h2 style="color: {color}; font-size: 20px; margin-top: 0;">{status_line}</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {contractor_name},</p>
            <div style="background: #ffffff; border: 1px solid {border}; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: {color}; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e293b; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: {color}; font-size: 14px; margin: 8px 0 0 0; font-weight: 700;">Target completion: {target_end_date}</p>
            </div>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_deadline_reminder_client_email(to_email: str, client_name: str, task_title: str,
                                         entity_name: str, target_end_date: str, overdue: bool) -> bool:
    """Remind the client/supervisor that a task's target completion date is approaching or has passed."""
    subject = (f"Overdue: {task_title}" if overdue else f"Due soon: {task_title}")
    status_line = "This task's target completion date has passed." if overdue else "This task's target completion date is coming up."
    color = "#dc2626" if overdue else "#d97706"
    bg = "#fef2f2" if overdue else "#fffbeb"
    border = "#fca5a5" if overdue else "#fbbf24"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Deadline Reminder</p>
        </div>
        <div style="background: {bg}; border: 1px solid {border}; border-radius: 12px; padding: 32px;">
            <h2 style="color: {color}; font-size: 20px; margin-top: 0;">{status_line}</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {client_name},</p>
            <div style="background: #ffffff; border: 1px solid {border}; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: {color}; font-size: 13px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">For: {entity_name}</p>
                <p style="color: #1e293b; font-size: 15px; margin: 0; font-weight: 600;">{task_title}</p>
                <p style="color: {color}; font-size: 14px; margin: 8px 0 0 0; font-weight: 700;">Target completion: {target_end_date}</p>
            </div>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html, sender=SMTP_FROM_BILLING)[0]


def send_password_reset_email(to_email: str, token: str, full_name: str) -> bool:
    """Send password reset link."""
    reset_url = f"{BASE_URL}/reset-password?token={token}"
    subject = "Reset your LitigationSpace password"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">The Operating System for Litigation</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">Reset your password</h2>
            <p style="color: #475569; line-height: 1.6;">Hi {full_name},</p>
            <p style="color: #475569; line-height: 1.6;">We received a request to reset your password. Click the button below to choose a new password.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{reset_url}" style="display: inline-block; background-color: #4f46e5; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This link expires in 60 minutes. If you didn't request a password reset, you can safely ignore this email.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {reset_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_team_invitation_email(to_email: str, inviter_name: str, tenant_name: str,
                                role: str, token: str, message: str = None) -> bool:
    """Send a team invitation email."""
    invite_url = f"{BASE_URL}/join?token={token}"
    role_display = role.replace("_", " ").title()
    custom_msg = f'<p style="color: #475569; line-height: 1.6; font-style: italic;">"{message}"</p>' if message else ""
    subject = f"{inviter_name} invited you to join {tenant_name} on LitigationSpace"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">The Operating System for Litigation</p>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">You're invited to join {tenant_name}</h2>
            <p style="color: #475569; line-height: 1.6;"><strong>{inviter_name}</strong> has invited you to join <strong>{tenant_name}</strong> as a <strong>{role_display}</strong> on LitigationSpace.</p>
            {custom_msg}
            <div style="background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #0369a1; font-size: 14px; margin: 0;"><strong>Your Role:</strong> {role_display}</p>
                <p style="color: #0369a1; font-size: 14px; margin: 4px 0 0 0;"><strong>Team:</strong> {tenant_name}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{invite_url}" style="display: inline-block; background: linear-gradient(135deg, #d4a843, #b8922e); color: #000; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Accept Invitation</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This invitation expires in 7 days. If you don't know {inviter_name}, you can safely ignore this email.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {invite_url}</p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">&copy; 2026 LitigationSpace. All rights reserved.</p>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def send_case_invitation_email(to_email: str, inviter_name: str, case_title: str,
                                role: str, token: str, message: str = None) -> bool:
    """Send a per-case collaborator invitation email (Case Team & Access panel)."""
    invite_url = f"{BASE_URL}/case-invite/{token}"
    role_display = role.replace("_", " ").title()
    custom_msg = f'<p style="color: #475569; line-height: 1.6; font-style: italic;">"{message}"</p>' if message else ""
    subject = f"{inviter_name} invited you to collaborate on {case_title}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="{BASE_URL}/logo.png" alt="LitigationSpace" style="height: 36px; display: inline-block;" />
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <h2 style="color: #1e293b; font-size: 20px; margin-top: 0;">You're invited to collaborate</h2>
            <p style="color: #475569; line-height: 1.6;"><strong>{inviter_name}</strong> has invited you to collaborate on <strong>{case_title}</strong> as a <strong>{role_display}</strong>.</p>
            {custom_msg}
            <div style="background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #0369a1; font-size: 14px; margin: 0;"><strong>Case:</strong> {case_title}</p>
                <p style="color: #0369a1; font-size: 14px; margin: 4px 0 0 0;"><strong>Your Role:</strong> {role_display}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{invite_url}" style="display: inline-block; background: linear-gradient(135deg, #d4a843, #b8922e); color: #000; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Accept Invitation</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">This invitation expires in 7 days. If you don't know {inviter_name}, you can safely ignore this email.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; word-break: break-all;">Or copy this link: {invite_url}</p>
        </div>
    </div>
    """
    return _send_email(to_email, subject, html)[0]


def _safe(text: str) -> str:
    """Replace characters not supported by Helvetica with ASCII equivalents."""
    return (str(text or "")
            .replace("—", "-").replace("–", "-")   # em/en dash
            .replace("‘", "'").replace("’", "'")   # smart quotes
            .replace("“", '"').replace("”", '"')
            .replace("•", "*").replace(" ", " ")   # bullet, nbsp
            .encode("latin-1", errors="replace").decode("latin-1"))


def build_invoice_pdf(
    from_name: str, from_firm: str, from_address: str, from_city: str,
    from_state: str, from_zip: str, from_phone: str, from_email_addr: str, from_bar: str,
    client_name: str, client_email: str, client_address: str, client_city: str,
    client_state: str, client_zip: str,
    invoice_number: str, issued: str, due_date: str,
    line_items: list, subtotal: float, tax_rate: float, tax_amount: float, total: float,
    payment_link: str, notes: str, status: str,
) -> bytes:
    """Generate a clean invoice PDF using fpdf2. Returns PDF bytes."""
    try:
        from fpdf import FPDF

        def m(v):
            return f"${float(v or 0):,.2f}"

        class PDF(FPDF):
            def header(self):
                pass
            def footer(self):
                self.set_y(-12)
                self.set_font("Helvetica", "I", 8)
                self.set_text_color(150, 160, 170)
                self.cell(0, 8, "Generated by LitigationSpace", align="C")

        pdf = PDF(orientation="P", unit="mm", format="A4")
        pdf.set_auto_page_break(auto=True, margin=18)
        pdf.add_page()
        pw = pdf.w - pdf.l_margin - pdf.r_margin

        # ── Header bar ──────────────────────────────────────────────
        LOGO_PATH = "/var/www/litigationspace-staging/frontend/logo.png"
        pdf.set_fill_color(10, 61, 107)
        pdf.rect(0, 0, pdf.w, 52, "F")

        # Logo top-left
        import os as _os
        if _os.path.exists(LOGO_PATH):
            pdf.image(LOGO_PATH, x=pdf.l_margin, y=8, h=14)

        # INVOICE label + status badge on the right
        is_paid = str(status).lower() == "paid"
        badge = "PAID" if is_paid else "AWAITING PAYMENT"
        pdf.set_y(9)
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "B", 26)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(pw * 0.55, 12, "", ln=0)  # spacer for logo area
        pdf.set_font("Helvetica", "B", 22)
        pdf.cell(pw * 0.28, 12, "INVOICE", align="R", ln=0)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(255, 235, 59)
        pdf.cell(pw * 0.17, 12, badge, align="R", ln=1)

        pdf.set_x(pdf.l_margin + pw * 0.55)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(180, 200, 220)
        pdf.cell(pw * 0.28, 6, f"Invoice #{invoice_number}", align="R", ln=0)
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(255, 235, 59)
        pdf.cell(pw * 0.17, 6, m(total), align="R", ln=1)

        pdf.set_x(pdf.l_margin + pw * 0.55)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(150, 175, 200)
        info_parts = []
        if issued:
            info_parts.append(f"Issued: {issued}")
        if due_date:
            info_parts.append(f"Due: {due_date}")
        pdf.cell(pw * 0.45, 6, "   ".join(info_parts), align="R", ln=1)

        pdf.set_y(58)

        # ── From / Bill To ──────────────────────────────────────────
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(46, 125, 50)  # green
        pdf.set_x(pdf.l_margin)
        pdf.cell(pw * 0.48, 5, "FROM", ln=0)
        pdf.set_text_color(2, 119, 189)  # blue
        pdf.cell(pw * 0.52, 5, "BILL TO", ln=1)

        pdf.set_draw_color(46, 125, 50)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + pw * 0.44, pdf.get_y())
        pdf.set_draw_color(2, 119, 189)
        pdf.line(pdf.l_margin + pw * 0.52, pdf.get_y(), pdf.l_margin + pw, pdf.get_y())
        pdf.ln(2)

        def addr_col(x, lines):
            pdf.set_x(x)
            for text, bold, size, color in lines:
                if not text:
                    continue
                pdf.set_font("Helvetica", "B" if bold else "", size)
                pdf.set_text_color(*color)
                pdf.set_x(x)
                pdf.cell(pw * 0.46, 5, _safe(text), ln=1)

        y_before = pdf.get_y()
        from_lines = [
            (from_name, True,  12, (26, 46, 68)),
            (from_firm, False, 10, (55, 65, 81)),
            (from_address, False, 9, (84, 110, 122)),
            (" ".join(filter(None, [from_city, from_state, from_zip])), False, 9, (84, 110, 122)),
            (from_phone, False, 9, (84, 110, 122)),
            (from_email_addr, False, 9, (21, 101, 192)),
            ((f"Bar # {from_bar}" if from_bar else ""), False, 8, (130, 140, 150)),
        ]
        addr_col(pdf.l_margin, from_lines)
        y_after_from = pdf.get_y()

        pdf.set_y(y_before)
        to_lines = [
            (client_name, True,  12, (26, 46, 68)),
            (client_email, False, 9, (21, 101, 192)),
            (client_address, False, 9, (84, 110, 122)),
            (" ".join(filter(None, [client_city, client_state, client_zip])), False, 9, (84, 110, 122)),
        ]
        addr_col(pdf.l_margin + pw * 0.52, to_lines)
        y_after_to = pdf.get_y()

        pdf.set_y(max(y_after_from, y_after_to) + 6)

        # ── Line items table ────────────────────────────────────────
        col_x = [0, pw * 0.17, pw * 0.62, pw * 0.75, pw * 0.88]
        col_w = [pw * 0.17, pw * 0.45, pw * 0.13, pw * 0.13, pw * 0.12]
        headers = ["Date", "Task / Description", "Hours", "Rate", "Amount"]

        pdf.set_fill_color(15, 52, 96)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 9)
        hdr_aligns = ["C", "L", "R", "R", "R"]
        for i, h in enumerate(headers):
            pdf.set_x(pdf.l_margin + col_x[i])
            pdf.cell(col_w[i], 8, h, fill=True, align=hdr_aligns[i])
        pdf.ln()

        row_colors = [(245, 248, 255), (255, 255, 255)]
        import re as _re
        for ri, item in enumerate(line_items or []):
            fill_rgb = row_colors[ri % 2]
            _raw = _safe(item.get("task_title") or item.get("description") or "-")
            _dm = _re.match(r'^(.*?) \((\d{4}-\d{2}-\d{2})\)$', _raw)
            _task = (_dm.group(1) if _dm else _raw)[:60]
            _date = _dm.group(2) if _dm else ""
            _entity = _safe(item.get("entity_name") or "")
            qty  = item.get("quantity", 0)
            rate = item.get("rate", 0)
            amt  = item.get("amount", 0)
            is_hourly = str(item.get("item_type", "hourly")).lower() == "hourly"
            qty_display = f"{float(qty):.2f} hrs" if is_hourly else "Flat Fee"

            # total row height: entity label (5mm) + task line (7mm) + padding (4mm) = 16mm
            # plain row (no entity): 14mm
            row_h = 16 if _entity else 14
            row_y = pdf.get_y()

            # fill background across full row
            pdf.set_fill_color(*fill_rgb)
            pdf.rect(pdf.l_margin, row_y, sum(col_w), row_h, "F")

            # draw border line at bottom
            pdf.set_draw_color(220, 228, 240)
            pdf.line(pdf.l_margin, row_y + row_h, pdf.l_margin + sum(col_w), row_y + row_h)

            # DATE column — centred vertically
            pdf.set_xy(pdf.l_margin + col_x[0], row_y + (row_h - 5) / 2)
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(100, 116, 139)
            pdf.cell(col_w[0], 5, _date, align="C")

            # TASK column — entity label + task title stacked
            task_x = pdf.l_margin + col_x[1]
            if _entity:
                pdf.set_xy(task_x + 2, row_y + 3)
                pdf.set_font("Helvetica", "B", 7.5)
                pdf.set_text_color(71, 85, 105)
                pdf.cell(col_w[1] - 4, 5, _entity, align="L")
                pdf.set_xy(task_x + 2, row_y + 8)
                pdf.set_font("Helvetica", "", 9)
                pdf.set_text_color(15, 23, 42)
                pdf.cell(col_w[1] - 4, 5, _task, align="L")
            else:
                pdf.set_xy(task_x + 2, row_y + (row_h - 5) / 2)
                pdf.set_font("Helvetica", "", 9)
                pdf.set_text_color(15, 23, 42)
                pdf.cell(col_w[1] - 4, 5, _task, align="L")

            # HOURS, RATE, AMOUNT columns — centred vertically
            right_vals = [qty_display, f"${float(rate):.2f}/hr", m(amt)]
            right_bold = [False, False, True]
            for i, (val, bold) in enumerate(zip(right_vals, right_bold)):
                pdf.set_xy(pdf.l_margin + col_x[i + 2], row_y + (row_h - 5) / 2)
                pdf.set_font("Helvetica", "B" if bold else "", 9)
                pdf.set_text_color(15, 23, 42)
                pdf.cell(col_w[i + 2], 5, val, align="R")

            pdf.set_y(row_y + row_h)

        pdf.ln(3)

        # ── Totals ──────────────────────────────────────────────────
        tot_x = pdf.l_margin + pw * 0.55
        tot_w = pw * 0.45

        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(84, 110, 122)
        pdf.set_x(tot_x)
        pdf.cell(tot_w * 0.6, 6, "Subtotal", ln=0)
        pdf.set_text_color(26, 46, 68)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(tot_w * 0.4, 6, m(subtotal), align="R", ln=1)

        if tax_rate:
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(84, 110, 122)
            pdf.set_x(tot_x)
            pdf.cell(tot_w * 0.6, 6, f"Tax ({tax_rate}%)", ln=0)
            pdf.set_text_color(26, 46, 68)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(tot_w * 0.4, 6, m(tax_amount), align="R", ln=1)

        pdf.ln(1)
        pdf.set_fill_color(26, 35, 126)
        total_y = pdf.get_y()
        pdf.set_x(tot_x)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(tot_w * 0.6, 9, "TOTAL DUE", fill=True, align="L", ln=0)
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(255, 235, 59)
        pdf.cell(tot_w * 0.4, 9, m(total), fill=True, align="R", ln=1)

        # ── Payment link ─────────────────────────────────────────────
        if payment_link and not is_paid:
            pdf.ln(4)
            pdf.set_fill_color(227, 242, 253)
            pdf.set_draw_color(144, 202, 249)
            pdf.set_x(pdf.l_margin)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(13, 71, 161)
            pdf.cell(0, 7, f"Pay online: {payment_link}", fill=True, ln=1)

        # ── Notes ────────────────────────────────────────────────────
        if notes:
            pdf.ln(4)
            pdf.set_font("Helvetica", "B", 8)
            pdf.set_text_color(84, 110, 122)
            pdf.set_x(pdf.l_margin)
            pdf.cell(0, 5, "NOTES", ln=1)
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(55, 71, 79)
            pdf.set_x(pdf.l_margin)
            pdf.multi_cell(0, 5, _safe(notes))

        return bytes(pdf.output())
    except Exception as e:
        print(f"[PDF ERROR] {e}")
        return b""


def send_invoice_email(
    to_emails: list,
    cc_emails: list,
    from_name: str,
    from_firm: str,
    from_email: str = "",
    from_address: str = "", from_city: str = "", from_state: str = "",
    from_zip: str = "", from_phone: str = "", from_bar: str = "",
    client_name: str = "",
    client_email: str = "",
    client_address: str = "", client_city: str = "", client_state: str = "", client_zip: str = "",
    invoice_number: str = "",
    issued: str = "",
    due_date: str = "",
    total: float = 0,
    payment_link: str = "",
    public_url: str = "",
    custom_message: str = "",
    line_items: list = None,
    subtotal: float = 0,
    tax_rate: float = 0,
    tax_amount: float = 0,
    notes: str = "",
    status: str = "sent",
) -> bool:
    """Send invoice email to client and CC recipients with payment CTA."""
    if not to_emails:
        return False

    def fmt_money(n):
        return f"${n:,.2f}"

    items_html = ""
    if line_items:
        rows = ""
        for idx, item in enumerate(line_items):
            bg = "#f9fafb" if idx % 2 == 0 else "#ffffff"
            import re as _re2
            _raw2 = str(item.get("task_title") or item.get("description", "—"))
            _dm2 = _re2.match(r'^(.*?) \((\d{4}-\d{2}-\d{2})\)$', _raw2)
            _task2 = _dm2.group(1) if _dm2 else _raw2
            _date2 = _dm2.group(2) if _dm2 else ""
            _entity2 = item.get("entity_name", "")
            rate = item.get("rate", 0)
            amt = item.get("amount", 0)
            qty = item.get("quantity", 0)
            is_hourly = str(item.get("item_type", "hourly")).lower() == "hourly"
            qty_display = f"{float(qty):.2f} hrs" if is_hourly else "Flat Fee"
            task_cell = f'<span style="color:#6b7280;font-size:11px;display:block;margin-bottom:2px;">{_entity2}</span>{_task2}' if _entity2 else _task2
            rows += f"""
            <tr style="background:{bg};">
              <td style="padding:10px 12px;color:#6b7280;font-size:12px;text-align:center;border-bottom:1px solid #f3f4f6;white-space:nowrap;">{_date2}</td>
              <td style="padding:10px 12px;color:#1f2937;font-size:13px;border-bottom:1px solid #f3f4f6;">{task_cell}</td>
              <td style="padding:10px 12px;color:#6b7280;font-size:13px;text-align:right;border-bottom:1px solid #f3f4f6;white-space:nowrap;">{qty_display}</td>
              <td style="padding:10px 12px;color:#6b7280;font-size:13px;text-align:right;border-bottom:1px solid #f3f4f6;">${float(rate):.2f}</td>
              <td style="padding:10px 12px;font-weight:600;color:#1f2937;font-size:13px;text-align:right;border-bottom:1px solid #f3f4f6;">{fmt_money(float(amt))}</td>
            </tr>"""
        items_html = f"""
        <table style="width:100%;border-collapse:collapse;margin:24px 0;">
          <thead>
            <tr style="background:#1e293b;">
              <th style="padding:10px 12px;color:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;text-align:center;width:90px;">Date</th>
              <th style="padding:10px 12px;color:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;text-align:left;">Task</th>
              <th style="padding:10px 12px;color:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;text-align:right;width:80px;">Hours</th>
              <th style="padding:10px 12px;color:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;text-align:right;width:90px;">Rate</th>
              <th style="padding:10px 12px;color:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;text-align:right;width:100px;">Amount</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <table style="width:260px;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 12px;color:#6b7280;font-size:13px;">Subtotal</td>
              <td style="padding:6px 12px;color:#374151;font-size:13px;font-weight:600;text-align:right;">{fmt_money(subtotal)}</td>
            </tr>
            {"<tr><td style='padding:6px 12px;color:#6b7280;font-size:13px;'>Tax (" + str(tax_rate) + "%)</td><td style='padding:6px 12px;color:#374151;font-size:13px;font-weight:600;text-align:right;'>" + fmt_money(tax_amount) + "</td></tr>" if tax_rate else ""}
            <tr style="background:#fef9ee;">
              <td style="padding:10px 12px;color:#92400e;font-size:15px;font-weight:800;border-top:2px solid #fbbf24;">TOTAL DUE</td>
              <td style="padding:10px 12px;color:#b45309;font-size:17px;font-weight:900;text-align:right;border-top:2px solid #fbbf24;">{fmt_money(total)}</td>
            </tr>
          </table>
        </div>"""

    pay_btn = ""
    if payment_link:
        pay_btn = f"""
        <div style="text-align:center;margin:32px 0 20px;">
          <a href="{payment_link}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;text-decoration:none;padding:16px 40px;border-radius:10px;font-weight:800;font-size:16px;letter-spacing:0.01em;">
            💳 Pay Now — {fmt_money(total)}
          </a>
        </div>"""

    view_btn = f"""
    <div style="text-align:center;margin:16px 0;">
      <a href="{public_url}" style="display:inline-block;background:#1e293b;color:#f1f5f9;text-decoration:none;padding:11px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        📄 View Full Invoice
      </a>
    </div>"""

    msg_block = f'<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;font-style:italic;">{custom_message}</p>' if custom_message else ""
    sender_display = f"{from_name}" + (f" · {from_firm}" if from_firm else "")
    subject = f"Invoice #{invoice_number} — {fmt_money(total)} due {due_date} — {from_name}"

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:32px 20px;background:#f8fafc;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:12px 12px 0 0;padding:24px 32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height:36px;max-width:180px;object-fit:contain;">
          <span style="color:#f59e0b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:rgba(245,158,11,0.15);padding:4px 10px;border-radius:20px;border:1px solid rgba(245,158,11,0.3);">Invoice</span>
        </div>
        <div style="text-align:center;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">From {sender_display}</p>
          <p style="margin:0;color:#f59e0b;font-size:30px;font-weight:900;">{fmt_money(total)}</p>
          <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;">Due {due_date} · Invoice #{invoice_number}</p>
        </div>
      </div>

      <!-- Body -->
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px 32px;">
        <p style="color:#1e293b;font-size:15px;margin:0 0 4px;">Hi {client_name},</p>
        <p style="color:#475569;font-size:14px;line-height:1.7;margin:8px 0 16px;">
          Please find your invoice attached. Review the details below and use the button to make your payment.
        </p>
        {msg_block}
        {items_html}
        {pay_btn}
        {view_btn}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">
          Questions? Reply to this email or contact {from_name}{(' at ' + from_firm) if from_firm else ''}.
          <br>This invoice was sent via <strong>LitigationSpace</strong>.
        </p>
      </div>
    </div>"""

    primary = to_emails[0]
    import smtplib as _smtp
    import ssl as _ssl
    from email.mime.multipart import MIMEMultipart as _MP
    from email.mime.text import MIMEText as _MT
    from email.mime.base import MIMEBase as _MB
    from email import encoders as _enc

    try:
        # Outer container supports attachment
        msg = _MP("mixed")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} via LitigationSpace <{SMTP_FROM_BILLING}>"
        msg["To"] = primary
        if cc_emails:
            msg["Cc"] = ", ".join(cc_emails)
        msg["Reply-To"] = from_email if from_email else SMTP_FROM_BILLING

        # HTML body
        body = _MP("alternative")
        body.attach(_MT(html, "html"))
        msg.attach(body)

        # PDF attachment
        pdf_bytes = build_invoice_pdf(
            from_name=from_name, from_firm=from_firm,
            from_address=from_address, from_city=from_city,
            from_state=from_state, from_zip=from_zip,
            from_phone=from_phone, from_email_addr=from_email,
            from_bar=from_bar,
            client_name=client_name, client_email=client_email,
            client_address=client_address, client_city=client_city,
            client_state=client_state, client_zip=client_zip,
            invoice_number=invoice_number, issued=issued, due_date=due_date,
            line_items=line_items or [], subtotal=subtotal,
            tax_rate=tax_rate, tax_amount=tax_amount, total=total,
            payment_link=payment_link, notes=notes, status=status,
        )
        if pdf_bytes:
            part = _MB("application", "pdf")
            part.set_payload(pdf_bytes)
            _enc.encode_base64(part)
            part.add_header("Content-Disposition", "attachment",
                            filename=f"Invoice-{invoice_number}.pdf")
            msg.attach(part)

        all_recipients = list(to_emails) + list(cc_emails)

        if SMTP_HOST in ("localhost", "127.0.0.1") and not SMTP_USER:
            with _smtp.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.sendmail(SMTP_FROM_BILLING, all_recipients, msg.as_string())
        else:
            ctx = _ssl.create_default_context()
            with _smtp.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo(); server.starttls(context=ctx); server.ehlo()
                _bill_user = SMTP_USER_BILLING or SMTP_USER
                _bill_pass = SMTP_PASS_BILLING or SMTP_PASS
                server.login(_bill_user, _bill_pass)
                server.sendmail(SMTP_FROM_BILLING, all_recipients, msg.as_string())

        print(f"[INVOICE EMAIL] Sent #{invoice_number} to {all_recipients} (PDF attached: {bool(pdf_bytes)})")
        return True
    except Exception as e:
        print(f"[INVOICE EMAIL ERROR] {e}")
        return False
