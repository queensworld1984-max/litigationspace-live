"""
Outreach & Email module for case-based client communication.
Supports contacts management, bulk email sending with templates,
delivery/open tracking, and pipeline stage management.
"""
import os
import json
import uuid
import secrets
import logging
import html as html_escape
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.email import (
    send_document_review_email, send_signature_request_email,
    send_campaign_approval_email, send_campaign_approved_notify_email, send_campaign_rejected_notify_email,
    send_document_uploaded_thankyou_email, send_document_signed_firm_notify_email,
    parse_recipients,
)
from app.services.ai_client import call_claude

APPROVAL_TOKEN_EXPIRY_HOURS = 168  # 7 days

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/outreach", tags=["outreach"])

BASE_URL = os.environ.get("BASE_URL", "https://litigationspace.com")
FRONTEND_URL = os.environ.get("FRONTEND_URL", BASE_URL)
UPLOAD_BASE_DIR = os.environ.get("UPLOAD_DIR", "/var/www/litigationspace/data/uploads")
LOGO_SUBDIR = "signature-logos"
ALLOWED_LOGO_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_LOGO_SIZE = 3 * 1024 * 1024  # 3MB

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ContactCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    company: Optional[str] = None
    contact_title: Optional[str] = None  # CEO, CFO, Owner, Managing Director, etc.
    party_role: Optional[str] = None  # claimant, respondent, witness, attorney, third_party
    amount_owed: Optional[float] = None
    currency: str = "USD"
    notes: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    address_line3: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    contact_title: Optional[str] = None
    party_role: Optional[str] = None
    amount_owed: Optional[float] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    address_line3: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None

class EmailSendRequest(BaseModel):
    contact_ids: List[str]
    template_type: str = "custom"  # initial_demand, follow_up, final_notice, custom
    subject: str
    body_html: str
    from_name: Optional[str] = None

class BulkEmailRequest(BaseModel):
    contact_ids: List[str]
    template_type: str = "initial_demand"
    from_name: Optional[str] = None
    custom_subject: Optional[str] = None
    custom_body: Optional[str] = None
    # Template variables
    firm_name: Optional[str] = None
    firm_address: Optional[str] = None
    firm_phone: Optional[str] = None
    response_deadline_days: int = 14
    additional_notes: Optional[str] = None
    # Documents to attach as tokenized review/sign links — used by the
    # "Request to Execute Required Document" template.
    document_ids: Optional[List[str]] = None

class PipelineUpdate(BaseModel):
    stage: str  # onboarding, active_outreach, responsive, unresponsive, litigation, resolved
    auto_escalation_enabled: Optional[bool] = None
    escalation_after_days: Optional[int] = None
    max_attempts: Optional[int] = None


class SendDocumentRequest(BaseModel):
    document_id: str
    mode: str = "review"  # review | sign
    allow_download: bool = True
    message: Optional[str] = None
    signature_pages: Optional[List[int]] = None  # required when mode == "sign"
    hours: int = 168  # link validity — 7 days default

class DocumentCommentRequest(BaseModel):
    commenter_name: str
    comment: Optional[str] = None
    page_number: Optional[int] = None
    action: str = "comment"  # comment | approve | reject | request_changes

class ViewHeartbeatRequest(BaseModel):
    seconds: int

class AddParticipantRequest(BaseModel):
    user_id: str

class AddThreadNoteRequest(BaseModel):
    note: str


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------

def _build_email_header(firm_name: str, subtitle: str = "", logo_url: str = "") -> str:
    # When a logo is on file (from the default signature), it replaces the
    # text firm name entirely as the letterhead — not shown alongside it.
    brand_html = (
        f'<img src="{logo_url}" alt="{firm_name}" style="max-height: 60px; max-width: 280px; display: block;" />'
        if logo_url else
        f'<h1 style="color: #1e3a5f; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 0.5px;">{firm_name}</h1>'
    )
    return f"""
    <div style="font-family: 'Georgia', 'Times New Roman', Times, serif; max-width: 680px; margin: 0 auto; background: #ffffff;">
        <!-- Firm Header -->
        <div style="border-bottom: 3px solid #1e3a5f; padding: 30px 40px 20px 40px;">
            {brand_html}
            {f'<p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0; font-style: italic;">{subtitle}</p>' if subtitle else ''}
        </div>
    """

def _signature_firm_identity(sig_row) -> tuple:
    """(firm_name, firm_address, firm_phone, logo_url) derived from the
    tenant's default signature — templates no longer have their own separate
    firm-identity settings form, so this is the single source of truth for
    "who is sending this." Returns empty strings if there's no default
    signature on file."""
    if not sig_row:
        return "", "", "", ""
    s = dict(sig_row)
    addr = ", ".join(filter(None, [
        s.get("address_line1"), s.get("address_line2"),
        s.get("city"), s.get("state"), s.get("postal_code"), s.get("country"),
    ]))
    return s.get("company_name") or "", addr, s.get("sender_phone") or "", s.get("logo_url") or ""


def _campaign_type_label(campaign_type: str) -> str:
    """Human-readable label for a campaign_type value, shared by every
    campaign summary/detail endpoint so the mapping only lives in one place."""
    return (
        "Request to Execute Required Document" if campaign_type == "document_execution_request"
        else "PEO Authorization" if campaign_type == "peo_authorization"
        else "Outstanding Amount"
    )


def _build_email_footer(firm_name: str, firm_address: str = "", firm_phone: str = "") -> str:
    contact_line = ""
    if firm_address or firm_phone:
        parts = []
        if firm_address:
            parts.append(firm_address)
        if firm_phone:
            parts.append(f"Tel: {firm_phone}")
        contact_line = f'<p style="color: #9ca3af; font-size: 11px; margin: 4px 0;">{" | ".join(parts)}</p>'

    return f"""
        <!-- Footer -->
        <div style="border-top: 1px solid #e5e7eb; padding: 20px 40px; background: #f9fafb;">
            <p style="color: #6b7280; font-size: 11px; margin: 0; line-height: 1.5;">
                This communication is from <strong>{firm_name}</strong> and may contain information that is privileged, 
                confidential, or otherwise protected from disclosure. If you are not the intended recipient, please 
                notify the sender immediately and delete this message.
            </p>
            {contact_line}
            <div style="text-align: center; margin-top: 16px;">
                <a href="https://litigationspace.com" style="text-decoration: none;">
                    <img src="https://litigationspace.com/logo.png" alt="LitigationSpace" style="height: 32px; display: inline-block;" />
                </a>
                <p style="color: #d1d5db; font-size: 10px; margin: 6px 0 0 0;">Legal Case Management Platform</p>
            </div>
        </div>
    </div>
    """


def _format_address_block(addr1: str = "", addr2: str = "", city: str = "",
                           state: str = "", postal: str = "", country: str = "") -> str:
    """Format a contact's address fields into an HTML <br>-joined block for
    the "ATTN" line at the top of a demand letter. Returns "" if all blank."""
    parts = []
    if addr1:
        parts.append(addr1)
    if addr2:
        parts.append(addr2)
    line2 = ", ".join(p for p in [city, state] if p)
    if postal:
        line2 = f"{line2} {postal}".strip()
    if line2:
        parts.append(line2)
    if country:
        parts.append(country)
    return "<br>".join(parts)


def _attn_block(contact_name: str, recipient_address: str = "", extra_line: str = "") -> str:
    """The recipient block used at the top of every demand letter — name,
    then (if on file) their full mailing address, matching formal-letter
    convention of addressing the recipient before the salutation."""
    addr_html = (
        f'<p style="color: #374151; font-size: 13px; margin: 2px 0 16px 0; line-height: 1.5;">{recipient_address}</p>'
        if recipient_address else ''
    )
    return (
        f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>ATTN:</strong> {contact_name}</p>'
        + addr_html + extra_line
    )


def _on_behalf_of_line(client_name: str = "") -> str:
    """Shown just below the sender's signature block — who this demand is
    actually being sent for (the creditor/client), distinct from the sending
    attorney/firm named directly above it."""
    if not client_name:
        return ''
    return f'<p style="color: #6b7280; font-size: 12px; margin: 8px 0 0 0; font-style: italic;">On behalf of: {client_name}</p>'


def _template_outstanding_amount(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 14,
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for the "Outstanding Amount" template —
    used when the recipient owes money under the ERC Consulting Services
    Agreement. Wording is exact per firm requirements — do not paraphrase."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = "Outstanding Contractual Balance"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Despite previous communications, the amount described below remains due and payable under the terms of your ERC Consulting Services Agreement.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Outstanding Amount</p>
                <p style="color: #78350f; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Payment is now overdue. We request that the outstanding balance be paid within {response_deadline_days} days of receipt of this notice.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to resolve this matter may result in referral to legal counsel for arbitration or litigation to recover all amounts due,
                together with any contractual interest, attorney's fees, court costs, and any other remedies available under the Agreement or applicable law.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _build_document_link_buttons(document_links: list) -> str:
    """Render one "Review & Sign" button per attached document link. Each
    link dict is {filename, review_url}."""
    if not document_links:
        return ""
    buttons = "".join(
        f"""<div style="margin: 12px 0;">
                <a href="{dl['review_url']}" style="display: inline-block; background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                    ✒ Review &amp; Sign — {dl['filename']}
                </a>
            </div>"""
        for dl in document_links
    )
    return f"""
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
            <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">Action Required</p>
            <p style="color: #1e40af; font-size: 13px; margin: 0 0 4px 0;">No account or login is required — click below to review and sign securely.</p>
            {buttons}
        </div>"""


def _template_document_execution_request(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 14,
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for the "Request to Execute Required
    Document" template — used when the recipient has failed to execute a
    required document. Wording is exact per firm requirements — do not
    paraphrase. document_links renders as one "Review & Sign" button per
    attached document (a real tokenized sign link per document)."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = "Request to Execute Required Document"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Our records indicate that a required document remains outstanding and has not been executed despite previous requests.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This document is required under your ERC Consulting Services Agreement and is necessary for ERTC Funding to verify your ERC claim,
                protect its contractual rights, and complete the administration of your file.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Please review and execute the attached document within {response_deadline_days} days from the date of this notice.
            </p>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to execute the required document may constitute a breach of your contractual obligations and may result in ERTC Funding
                pursuing all remedies available under the Agreement, including arbitration or litigation where appropriate.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_document_execution_followup(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 7,
    case_title: str = "", case_number: str = "", attempt_number: int = 2,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Document Execution Follow-Up —
    stage 2 of the document-execution escalation sequence, mirroring
    _template_follow_up's structure and tone."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"Follow-Up: Required Document Not Yet Executed - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 20px; margin: 0 0 24px 0; border-radius: 0 8px 8px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    FOLLOW-UP NOTICE &mdash; ATTEMPT #{attempt_number}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as a follow-up to our previous correspondence regarding the required document below,
                which remains unexecuted. As of the date of this letter, we have not received the executed document
                or a response to our prior communication.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We urge you to treat this matter with urgency. You have <strong>{response_deadline_days} days</strong> from
                receipt of this notice to execute the required document or contact our office to discuss any concerns.
            </p>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to respond may result in referral to legal counsel for arbitration or litigation without further notice,
                which may include additional costs and fees.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_document_execution_escalation(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", attempt_number: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Document Execution Escalation Warning —
    stage 3, mirroring _template_follow_up_2's structure and tone."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"URGENT: Escalation Warning - Required Document Unexecuted - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #fef2f2; border: 2px solid #ef4444; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #991b1b; font-size: 14px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    &#9888; ESCALATION WARNING &mdash; ATTEMPT #{attempt_number}
                </p>
                <p style="color: #991b1b; font-size: 12px; margin: 6px 0 0 0;">
                    This matter is being reviewed for formal legal proceedings
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We write with growing concern regarding the required document below, which remains unexecuted. Despite our
                previous <strong>{attempt_number - 1} communications</strong>, we have received no executed document or response from you.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>Please be advised that this matter has been escalated within our office.</strong>
                If we do not receive the executed document or a substantive response within
                <strong>{response_deadline_days} days</strong>, we will have no choice but to recommend
                that ERTC Funding initiate formal legal proceedings.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Such proceedings would include seeking all remedies available under the Agreement, including attorney fees
                and all costs of collection. A formal Demand for Arbitration or Complaint will be filed without further notice.
            </p>

            {_build_document_link_buttons(document_links)}

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">LAST OPPORTUNITY</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    This is your opportunity to resolve this matter before formal escalation.
                    Please execute the document above or contact our office immediately.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This communication serves as formal notice of intent to escalate. All prior correspondence
                    has been documented and may be used as evidence of good faith efforts to resolve this matter.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_document_execution_final_notice(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", total_attempts: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Document Execution Final Notice —
    stage 4, mirroring _template_final_notice's structure and tone."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"FINAL NOTICE: Required Document Unexecuted Before Legal Action - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #7f1d1d; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px; text-align: center;">
                <p style="color: #ffffff; font-size: 15px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    FINAL NOTICE BEFORE LEGAL PROCEEDINGS
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>This is our final correspondence before initiating formal legal proceedings.</strong>
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We have made <strong>{total_attempts} documented attempts</strong> to obtain your execution of the required
                document below. Each communication has been recorded and will serve as evidence of ERTC Funding's
                good faith efforts to resolve this matter amicably.
            </p>

            <div style="background: #fecaca; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #991b1b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
                <p style="color: #7f1d1d; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
                <p style="color: #991b1b; font-size: 12px; margin: 8px 0 0 0;">Response required within {response_deadline_days} days</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Unless we receive the executed document or a written response proposing a concrete resolution
                within <strong>{response_deadline_days} days</strong> of this notice, ERTC Funding
                will proceed with the following:
            </p>

            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 16px 0;">
                <ol style="color: #374151; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                    <li>Filing a formal <strong>Demand for Arbitration</strong> or initiating litigation proceedings</li>
                    <li>Seeking recovery of all amounts due under the Agreement, plus <strong>accrued interest</strong></li>
                    <li>Seeking recovery of all <strong>attorney fees and legal costs</strong></li>
                    <li>Submitting this documented communication trail as evidence of good faith attempts</li>
                </ol>
            </div>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We strongly urge you to execute the document immediately to avoid the additional expense
                and burden of formal legal proceedings. This remains your final opportunity to
                resolve this matter without litigation.
            </p>

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">RESPOND IMMEDIATELY</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    Execute the document above, reply to this email, or contact our office directly. Time is of the essence.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This letter constitutes a final demand and formal notice of intent to pursue legal remedies.
                    All prior correspondence has been documented and preserved. This communication and its
                    contents may be introduced as evidence in any subsequent legal proceedings.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_document_execution_notice_of_intent(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", attempt_number: int = 4,
    litigation_type: str = "Demand for Arbitration",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Document Execution Notice of Intent —
    stage 5, mirroring _template_notice_of_intent's structure and tone."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #1e1b4b; border: 3px solid #4338ca; padding: 20px 28px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #e0e7ff; font-size: 16px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    &#9878; NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS
                </p>
                <p style="color: #c7d2fe; font-size: 12px; margin: 8px 0 0 0;">
                    Type: {litigation_type} &bull; Reference: {case_number or case_title}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as <strong>formal notice</strong> that, having exhausted all good-faith efforts
                to obtain your execution of the required document below, ERTC Funding has instructed us
                to proceed with <strong>{litigation_type}</strong>.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Over the course of {attempt_number} prior communications, we have attempted in good faith to
                resolve this matter amicably. Despite these efforts, we have received no executed document, no substantive
                response, and no indication of willingness to engage.
            </p>

            <div style="background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; text-transform: uppercase;">FINAL OPPORTUNITY TO RESOLVE</p>
                <p style="color: #991b1b; font-size: 13px; margin: 0; line-height: 1.6;">
                    You have <strong>{response_deadline_days} calendar days</strong> from receipt of this notice
                    to execute the required document or submit a written proposal for resolution.
                    After this period, we will file a <strong>{litigation_type}</strong> without further notice.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; font-weight: 600;">
                Upon filing, ERTC Funding will seek recovery of:
            </p>
            <ul style="color: #374151; font-size: 14px; line-height: 2; padding-left: 20px;">
                <li>All amounts and remedies available under the Agreement</li>
                <li>Pre-judgment and post-judgment interest at the applicable statutory rate</li>
                <li>All attorney fees and legal costs incurred</li>
                <li>Filing fees, service fees, and all costs of collection</li>
                <li>Any additional damages or remedies available under applicable law</li>
            </ul>

            {_build_document_link_buttons(document_links)}

            <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #166534; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">RESOLUTION REMAINS POSSIBLE</p>
                <p style="color: #166534; font-size: 13px; margin: 0; line-height: 1.6;">
                    We remain willing to discuss a resolution to avoid formal proceedings.
                    Please execute the document above or contact our office immediately to discuss.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This constitutes formal notice of intent to initiate legal proceedings pursuant to applicable law.
                    All prior correspondence has been preserved and will be submitted as evidence of good-faith
                    attempts to resolve this matter. This letter may be presented to the tribunal or court as
                    evidence of compliance with pre-action protocol requirements.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_peo_authorization_request(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 10,
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for the "PEO Authorization" template —
    used when a client's payroll may have been administered through a
    Professional Employer Organization and the firm needs the client to
    identify the PEO and authorize it to communicate directly."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = "PEO Authorization Required — Employee Retention Credit Claim"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                {firm_name} performed ERC consulting services on your behalf, including evaluating your eligibility for the
                Employee Retention Credit (&ldquo;ERC&rdquo;) and preparing supporting documentation for your claim.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Upon information and belief, your company may have utilized a Professional Employer Organization (&ldquo;PEO&rdquo;)
                to administer payroll and file its federal employment tax returns. If so, {firm_name} has been unable to
                determine whether your ERC claim has been filed, whether additional information is required, or whether
                any ERC refund, credit, or other benefit has been received.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Authorization</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Please provide your PEO's information and execute the enclosed PEO Authorization within {response_deadline_days} days
                from the date of this notice, so that your PEO may communicate directly with {firm_name} regarding your ERC claim.
            </p>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Your continued failure to cooperate prevents {firm_name} from determining the status of your ERC claim and may
                result in {firm_name} pursuing all remedies available under the Agreement.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_peo_authorization_followup(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 7,
    case_title: str = "", case_number: str = "", attempt_number: int = 2,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for PEO Authorization Follow-Up — stage 2
    of the PEO authorization escalation sequence."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"Follow-Up: PEO Authorization Not Yet Received - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 20px; margin: 0 0 24px 0; border-radius: 0 8px 8px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    FOLLOW-UP NOTICE &mdash; ATTEMPT #{attempt_number}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as a follow-up to our previous correspondence regarding the required PEO Authorization below,
                which remains outstanding. As of the date of this letter, we have not received your PEO information, the
                executed authorization, or a response to our prior communication.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Authorization</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We urge you to treat this matter with urgency. You have <strong>{response_deadline_days} days</strong> from
                receipt of this notice to provide your PEO information and execute the authorization, or contact our office
                to discuss any concerns.
            </p>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to respond may result in referral to legal counsel for arbitration or litigation without further notice,
                which may include additional costs and fees.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_peo_authorization_escalation(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", attempt_number: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for PEO Authorization Escalation Warning —
    stage 3."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"URGENT: Escalation Warning - PEO Authorization Outstanding - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #fef2f2; border: 2px solid #ef4444; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #991b1b; font-size: 14px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    &#9888; ESCALATION WARNING &mdash; ATTEMPT #{attempt_number}
                </p>
                <p style="color: #991b1b; font-size: 12px; margin: 6px 0 0 0;">
                    This matter is being reviewed for formal legal proceedings
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We write with growing concern regarding the required PEO Authorization below, which remains outstanding. Despite our
                previous <strong>{attempt_number - 1} communications</strong>, we have received no PEO information, executed
                authorization, or response from you.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Authorization</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>Please be advised that this matter has been escalated within our office.</strong>
                If we do not receive your PEO information and the executed authorization, or a substantive response, within
                <strong>{response_deadline_days} days</strong>, we will have no choice but to recommend
                that {firm_name} initiate formal legal proceedings.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Such proceedings would include seeking all remedies available under the Agreement, including attorney fees
                and all costs of collection.
            </p>

            {_build_document_link_buttons(document_links)}

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">LAST OPPORTUNITY</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    This is your opportunity to resolve this matter before formal escalation.
                    Please provide your PEO information and execute the authorization above, or contact our office immediately.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_peo_authorization_final_notice(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", total_attempts: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for PEO Authorization Final Notice — stage 4."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"FINAL NOTICE: PEO Authorization Outstanding Before Legal Action - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #7f1d1d; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px; text-align: center;">
                <p style="color: #ffffff; font-size: 15px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    FINAL NOTICE BEFORE LEGAL PROCEEDINGS
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>This is {firm_name}&rsquo;s final correspondence before initiating formal legal proceedings.</strong>
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                {firm_name} has made <strong>{total_attempts} documented attempts</strong> to obtain your PEO information and the
                executed authorization below. Each communication has been recorded and will serve as evidence of {firm_name}&rsquo;s
                good faith efforts to resolve this matter amicably.
            </p>

            <div style="background: #fecaca; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #991b1b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Authorization</p>
                <p style="color: #7f1d1d; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
                <p style="color: #991b1b; font-size: 12px; margin: 8px 0 0 0;">Response required within {response_deadline_days} days</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Unless we receive your PEO information and the executed authorization, or a written response proposing a
                concrete resolution, within <strong>{response_deadline_days} days</strong> of this notice, {firm_name}
                will proceed with the following:
            </p>

            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 16px 0;">
                <ol style="color: #374151; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                    <li>Filing a formal <strong>Demand for Arbitration</strong> or initiating litigation proceedings</li>
                    <li>Seeking recovery of all amounts due under the Agreement, plus <strong>accrued interest</strong></li>
                    <li>Seeking recovery of all <strong>attorney fees and legal costs</strong></li>
                    <li>Submitting this documented communication trail as evidence of good faith attempts</li>
                </ol>
            </div>

            {_build_document_link_buttons(document_links)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We strongly urge you to respond immediately to avoid the additional expense and burden of formal legal
                proceedings. This remains your final opportunity to resolve this matter without litigation.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_peo_authorization_notice_of_intent(
    contact_name: str, document_name: str, document_links: list,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    case_title: str = "", case_number: str = "", attempt_number: int = 4,
    litigation_type: str = "Demand for Arbitration",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for PEO Authorization Notice of Intent — stage 5."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")

    subject = f"NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <div style="background: #1e1b4b; border: 3px solid #4338ca; padding: 20px 28px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #e0e7ff; font-size: 16px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    &#9878; NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS
                </p>
                <p style="color: #c7d2fe; font-size: 12px; margin: 8px 0 0 0;">
                    Type: {litigation_type} &bull; Reference: {case_number or case_title}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as <strong>formal notice</strong> that, having exhausted all good-faith efforts
                to obtain your PEO information and the executed authorization below, {firm_name} has instructed
                us to proceed with <strong>{litigation_type}</strong>.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Authorization</p>
                <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{document_name}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Over the course of {attempt_number} prior communications, we have attempted in good faith to
                resolve this matter amicably. Despite these efforts, we have received no PEO information, no executed
                authorization, and no indication of willingness to engage.
            </p>

            <div style="background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; text-transform: uppercase;">FINAL OPPORTUNITY TO RESOLVE</p>
                <p style="color: #991b1b; font-size: 13px; margin: 0; line-height: 1.6;">
                    You have <strong>{response_deadline_days} calendar days</strong> from receipt of this notice
                    to provide your PEO information and execute the authorization, or submit a written proposal for resolution.
                    After this period, we will file a <strong>{litigation_type}</strong> without further notice.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; font-weight: 600;">
                Upon filing, {firm_name} will seek recovery of:
            </p>
            <ul style="color: #374151; font-size: 14px; line-height: 2; padding-left: 20px;">
                <li>All amounts and remedies available under the Agreement</li>
                <li>Pre-judgment and post-judgment interest at the applicable statutory rate</li>
                <li>All attorney fees and legal costs incurred</li>
                <li>Filing fees, service fees, and all costs of collection</li>
                <li>Any additional damages or remedies available under applicable law</li>
            </ul>

            {_build_document_link_buttons(document_links)}

            <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #166534; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">RESOLUTION REMAINS POSSIBLE</p>
                <p style="color: #166534; font-size: 13px; margin: 0; line-height: 1.6;">
                    We remain willing to discuss a resolution to avoid formal proceedings.
                    Please provide your PEO information and execute the authorization above, or contact our office immediately to discuss.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_general_letter(
    contact_name: str, subject_line: str, body_text: str,
    firm_name: str, sender_name: str,
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for a general-purpose letter — same
    branded letterhead/ATTN/footer as the demand letters, but the body is
    whatever the sender writes. For correspondence that isn't a debt
    collection notice: status updates, document requests, general notices —
    any case type, not just debt collection."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = subject_line or f"Correspondence from {firm_name}"
    # Reuse the same paragraph/list renderer every other editable template
    # uses: it escapes the text (this used to insert body_text completely
    # raw and unescaped) and keeps single "\n" line breaks and any pasted
    # "1. "/"- " list lines intact instead of silently dropping them (plain
    # "\n\n".split() left lone "\n"s inside one <p>, which HTML collapses).
    body_html = _render_plaintext_body(body_text or "", {}) or '<p style="color: #374151; font-size: 14px; line-height: 1.7;"></p>'

    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            {body_html}

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_settlement_offer(
    contact_name: str, amount_offered: float, currency: str, terms: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 14,
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for a settlement offer — proposing
    resolution terms, not demanding payment. Any case type."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_offered:,.2f}" if amount_offered else ""
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = f"Settlement Offer — {case_title or firm_name}"
    amount_box = (
        f"""<div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #166534; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Proposed Settlement Amount</p>
                <p style="color: #14532d; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
            </div>""" if amount_str else ""
    )

    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                In the interest of resolving this matter amicably, we are pleased to extend the following settlement offer:
            </p>

            {amount_box}

            {_render_plaintext_body(terms, {}) if terms else ''}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Please respond within <strong>{response_deadline_days} days</strong> to accept these terms or to discuss further.
                This offer is made without admission of liability and is confidential settlement communication.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This communication is a confidential settlement offer and shall not be construed as an admission of liability
                    by either party. It is inadmissible as evidence of liability in any subsequent proceeding.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_initial_demand(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 14,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Initial Good Faith Demand."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    deadline = f"{response_deadline_days} days from receipt of this letter"
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title} (Ref: {case_number})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {case_title}</p>'

    subject = f"Important: Outstanding Balance Notice - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <!-- Body -->
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address, '<p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>VIA EMAIL</strong></p>')}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We write on behalf of our client regarding the outstanding balance of 
                <strong style="color: #1e3a5f;">{amount_str}</strong> currently due and owing. 
                Despite previous communications, this amount remains unpaid.
            </p>

            <!-- Amount Box -->
            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Outstanding Amount</p>
                <p style="color: #78350f; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                In good faith, we are providing you with this formal notice and an opportunity to resolve 
                this matter amicably before any further action is taken. We kindly request that you remit 
                payment of the full outstanding amount within <strong>{deadline}</strong>.
            </p>

            {_render_plaintext_body(additional_notes, {}) if additional_notes else ''}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                If payment is not received within the stated period, our client reserves the right to 
                pursue all available legal remedies, including but not limited to initiating formal 
                arbitration or litigation proceedings to recover the outstanding amount, plus any 
                applicable interest, costs, and attorney fees.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We strongly encourage you to contact us at your earliest convenience to discuss 
                this matter and avoid further escalation. We remain open to discussing a reasonable 
                resolution.
            </p>

            <!-- Action Box -->
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">HOW TO RESPOND</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    Please reply directly to this email or contact our office to arrange payment 
                    or discuss a resolution plan.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <!-- Legal Notice -->
            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This letter constitutes a good faith attempt to resolve this matter prior to formal legal proceedings.
                    It shall not be construed as a waiver of any rights or remedies available to our client under applicable law.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_follow_up(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 7,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 2,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Follow-up Reminder."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"Follow-Up: Outstanding Balance - Action Required - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <!-- Urgency Banner -->
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px 20px; margin: 0 0 24px 0; border-radius: 0 8px 8px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    FOLLOW-UP NOTICE &mdash; ATTEMPT #{attempt_number}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as a follow-up to our previous correspondence regarding 
                the outstanding balance of <strong style="color: #dc2626;">{amount_str}</strong>. 
                As of the date of this letter, we have not received payment or a response to our 
                prior communication.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Amount Due</p>
                <p style="color: #78350f; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We urge you to treat this matter with urgency. You have 
                <strong>{response_deadline_days} days</strong> from receipt of this notice to 
                remit payment or contact our office to discuss a resolution.
            </p>

            {_render_plaintext_body(additional_notes, {}) if additional_notes else ''}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to respond may result in our client pursuing formal legal action without 
                further notice, which may include additional costs and fees.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _template_final_notice(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", total_attempts: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Final Notice Before Arbitration."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"FINAL NOTICE: Demand for Payment Before Legal Action - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <!-- Final Notice Banner -->
            <div style="background: #7f1d1d; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px; text-align: center;">
                <p style="color: #ffffff; font-size: 15px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    FINAL NOTICE BEFORE LEGAL PROCEEDINGS
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>This is our final correspondence before initiating formal legal proceedings.</strong>
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We have made <strong>{total_attempts} documented attempts</strong> to reach you regarding 
                the outstanding balance of <strong style="color: #dc2626;">{amount_str}</strong>. 
                Each communication has been recorded and will serve as evidence of our client's 
                good faith efforts to resolve this matter amicably.
            </p>

            <div style="background: #fecaca; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #991b1b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Final Demand Amount</p>
                <p style="color: #7f1d1d; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
                <p style="color: #991b1b; font-size: 12px; margin: 8px 0 0 0;">Response required within {response_deadline_days} days</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Unless we receive full payment or a written response proposing a concrete resolution 
                plan within <strong>{response_deadline_days} days</strong> of this notice, our client 
                will proceed with the following:
            </p>

            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 16px 0;">
                <ol style="color: #374151; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                    <li>Filing a formal <strong>Demand for Arbitration</strong> or initiating litigation proceedings</li>
                    <li>Seeking recovery of the full outstanding amount plus <strong>accrued interest</strong></li>
                    <li>Seeking recovery of all <strong>attorney fees and legal costs</strong></li>
                    <li>Submitting this documented communication trail as evidence of good faith attempts</li>
                </ol>
            </div>

            {_render_plaintext_body(additional_notes, {}) if additional_notes else ''}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We strongly urge you to contact us immediately to avoid the additional expense 
                and burden of formal legal proceedings. This remains your final opportunity to 
                resolve this matter without litigation.
            </p>

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">RESPOND IMMEDIATELY</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    Reply to this email or contact our office directly. Time is of the essence.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This letter constitutes a final demand and formal notice of intent to pursue legal remedies.
                    All prior correspondence has been documented and preserved. This communication and its 
                    contents may be introduced as evidence in any subsequent legal proceedings.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_follow_up_2(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 3,
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Follow-up #2 (Escalation Warning)."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"URGENT: Escalation Warning - Outstanding Balance - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <!-- Escalation Warning Banner -->
            <div style="background: #fef2f2; border: 2px solid #ef4444; padding: 16px 24px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #991b1b; font-size: 14px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                    &#9888; ESCALATION WARNING &mdash; ATTEMPT #{attempt_number}
                </p>
                <p style="color: #991b1b; font-size: 12px; margin: 6px 0 0 0;">
                    This matter is being reviewed for formal legal proceedings
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                We write with growing concern regarding the outstanding balance of
                <strong style="color: #dc2626;">{amount_str}</strong>. Despite our previous
                <strong>{attempt_number - 1} communications</strong>, we have received no response or
                payment from you.
            </p>

            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Outstanding Balance</p>
                <p style="color: #78350f; font-size: 28px; font-weight: 700; margin: 0;">{amount_str}</p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                <strong>Please be advised that this matter has been escalated within our office.</strong>
                If we do not receive payment or a substantive response within
                <strong>{response_deadline_days} days</strong>, we will have no choice but to recommend
                that our client initiate formal legal proceedings.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Such proceedings would include seeking recovery of the outstanding amount, plus interest,
                attorney fees, and all costs of collection. A formal Demand for Arbitration or Complaint
                will be filed without further notice.
            </p>

            {_render_plaintext_body(additional_notes, {}) if additional_notes else ''}

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">LAST OPPORTUNITY</p>
                <p style="color: #1e40af; font-size: 13px; margin: 0; line-height: 1.6;">
                    This is your opportunity to resolve this matter before formal escalation.
                    Please reply immediately or contact our office to discuss a resolution.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This communication serves as formal notice of intent to escalate. All prior correspondence
                    has been documented and may be used as evidence of good faith efforts to resolve this matter.
                </p>
            </div>
        </div>
    """

    return subject, html


def _template_notice_of_intent(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 4,
    litigation_type: str = "Demand for Arbitration",
    recipient_address: str = "", client_name: str = "", logo_url: str = "",
) -> tuple:
    """Returns (subject, html_body) for Notice of Intent to Initiate Litigation."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {_attn_block(contact_name, recipient_address)}

            <!-- LEGAL PROCEEDINGS BANNER -->
            <div style="background: #1e1b4b; border: 3px solid #4338ca; padding: 20px 28px; margin: 0 0 24px 0; border-radius: 8px;">
                <p style="color: #e0e7ff; font-size: 16px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
                    &#9878; NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS
                </p>
                <p style="color: #c7d2fe; font-size: 12px; margin: 8px 0 0 0;">
                    Type: {litigation_type} &bull; Reference: {case_number or case_title}
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {contact_name},</p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                This letter serves as <strong>formal notice</strong> that, having exhausted all good-faith efforts
                to resolve the outstanding matter of <strong style="color: #dc2626;">{amount_str}</strong>,
                our client has instructed us to proceed with <strong>{litigation_type}</strong>.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Over the course of {attempt_number} prior communications, we have attempted in good faith to
                resolve this matter amicably. Despite these efforts, we have received no payment, no substantive
                response, and no indication of willingness to engage.
            </p>

            <div style="background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #991b1b; font-size: 13px; font-weight: 700; margin: 0 0 8px 0; text-transform: uppercase;">FINAL OPPORTUNITY TO RESOLVE</p>
                <p style="color: #991b1b; font-size: 13px; margin: 0; line-height: 1.6;">
                    You have <strong>{response_deadline_days} calendar days</strong> from receipt of this notice
                    to respond with either full payment of {amount_str} or a written proposal for resolution.
                    After this period, we will file a <strong>{litigation_type}</strong> without further notice.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; font-weight: 600;">
                Upon filing, our client will seek recovery of:
            </p>
            <ul style="color: #374151; font-size: 14px; line-height: 2; padding-left: 20px;">
                <li>The full outstanding balance of {amount_str}</li>
                <li>Pre-judgment and post-judgment interest at the applicable statutory rate</li>
                <li>All attorney fees and legal costs incurred</li>
                <li>Filing fees, service fees, and all costs of collection</li>
                <li>Any additional damages or remedies available under applicable law</li>
            </ul>

            {_render_plaintext_body(additional_notes, {}) if additional_notes else ''}

            <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="color: #166534; font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">SETTLEMENT REMAINS POSSIBLE</p>
                <p style="color: #166534; font-size: 13px; margin: 0; line-height: 1.6;">
                    We remain willing to discuss a resolution to avoid formal proceedings.
                    Please contact our office immediately at {firm_phone or '[firm phone]'} to discuss settlement options.
                </p>
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">
                <em>Govern yourself accordingly.</em>
            </p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 16px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
            {_on_behalf_of_line(client_name)}

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This constitutes formal notice of intent to initiate legal proceedings pursuant to applicable law.
                    All prior correspondence has been preserved and will be submitted as evidence of good-faith
                    attempts to resolve this matter. This letter may be presented to the tribunal or court as
                    evidence of compliance with pre-action protocol requirements.
                </p>
            </div>
        </div>
    """

    return subject, html


# ---------------------------------------------------------------------------
# Plain-text editable templates
#
# Non-technical users edit the letter body as plain English paragraphs with
# [Bracket Token] placeholders instead of raw HTML — no markup, no risk of
# breaking the letter's layout. A saved override is plain TEXT, never a
# fully-rendered snapshot, so it substitutes correctly for every future
# recipient (Compose, Bulk Send, Campaigns) instead of freezing one contact's
# name/amount into the template.
#
# Only the narrative body (between "Dear X," and "Respectfully,") is
# editable. Date, Re: line, ATTN block, salutation, sign-off, signature and
# footer stay system-generated so an edit can't accidentally break required
# legal boilerplate. Two paragraph tokens render as visual callouts when
# placed alone on their own line: [Amount Owed] and [Document Name] become
# highlighted boxes, [Document Links] becomes the real "Review & Sign"
# button(s) for the attached document(s).
# ---------------------------------------------------------------------------

DEFAULT_PLAINTEXT_TEMPLATES = {
    "outstanding_amount": {
        "subject": "Outstanding Contractual Balance",
        "body": """Despite previous communications, the amount described below remains due and payable under the terms of your ERC Consulting Services Agreement.

[Amount Owed]

Payment is now overdue. We request that the outstanding balance be paid within [Response Deadline Days] days of receipt of this notice.

Failure to resolve this matter may result in referral to legal counsel for arbitration or litigation to recover all amounts due, together with any contractual interest, attorney's fees, court costs, and any other remedies available under the Agreement or applicable law.""",
    },
    "document_execution_request": {
        "subject": "Request to Execute Required Document",
        "body": """Our records indicate that a required document remains outstanding and has not been executed despite previous requests.

[Document Name]

This document is required under your ERC Consulting Services Agreement and is necessary for ERTC Funding to verify your ERC claim, protect its contractual rights, and complete the administration of your file.

Please review and execute the attached document within [Response Deadline Days] days from the date of this notice.

[Document Links]

Failure to execute the required document may constitute a breach of your contractual obligations and may result in ERTC Funding pursuing all remedies available under the Agreement, including arbitration or litigation where appropriate.""",
    },
    "document_execution_followup": {
        "subject": "Follow-Up: Required Document Not Yet Executed - [Firm Name]",
        "body": """FOLLOW-UP NOTICE — ATTEMPT #[Attempt Number]

This letter serves as a follow-up to our previous correspondence regarding the required document below, which remains unexecuted. As of the date of this letter, we have not received the executed document or a response to our prior communication.

[Document Name]

We urge you to treat this matter with urgency. You have [Response Deadline Days] days from receipt of this notice to execute the required document or contact our office to discuss any concerns.

[Document Links]

Failure to respond may result in referral to legal counsel for arbitration or litigation without further notice, which may include additional costs and fees.""",
    },
    "document_execution_escalation": {
        "subject": "URGENT: Escalation Warning - Required Document Unexecuted - [Firm Name]",
        "body": """ESCALATION WARNING — ATTEMPT #[Attempt Number]. This matter is being reviewed for formal legal proceedings.

We write with growing concern regarding the required document below, which remains unexecuted. Despite our previous communications, we have received no executed document or response from you.

[Document Name]

Please be advised that this matter has been escalated within our office. If we do not receive the executed document or a substantive response within [Response Deadline Days] days, we will have no choice but to recommend that ERTC Funding initiate formal legal proceedings.

Such proceedings would include seeking all remedies available under the Agreement, including attorney fees and all costs of collection. A formal Demand for Arbitration or Complaint will be filed without further notice.

[Document Links]

LAST OPPORTUNITY: This is your opportunity to resolve this matter before formal escalation. Please execute the document above or contact our office immediately.

This communication serves as formal notice of intent to escalate. All prior correspondence has been documented and may be used as evidence of good faith efforts to resolve this matter.""",
    },
    "document_execution_final_notice": {
        "subject": "FINAL NOTICE: Required Document Unexecuted Before Legal Action - [Firm Name]",
        "body": """FINAL NOTICE BEFORE LEGAL PROCEEDINGS

This is our final correspondence before initiating formal legal proceedings.

We have made multiple documented attempts to obtain your execution of the required document below. Each communication has been recorded and will serve as evidence of ERTC Funding's good faith efforts to resolve this matter amicably.

[Document Name]

Unless we receive the executed document or a written response proposing a concrete resolution within [Response Deadline Days] days of this notice, ERTC Funding will proceed with the following:
1. Filing a formal Demand for Arbitration or initiating litigation proceedings
2. Seeking recovery of all amounts due under the Agreement, plus accrued interest
3. Seeking recovery of all attorney fees and legal costs
4. Submitting this documented communication trail as evidence of good faith attempts

[Document Links]

We strongly urge you to execute the document immediately to avoid the additional expense and burden of formal legal proceedings. This remains your final opportunity to resolve this matter without litigation.

RESPOND IMMEDIATELY: Execute the document above, reply to this email, or contact our office directly. Time is of the essence.

Govern yourself accordingly.

This letter constitutes a final demand and formal notice of intent to pursue legal remedies. All prior correspondence has been documented and preserved. This communication and its contents may be introduced as evidence in any subsequent legal proceedings.""",
    },
    "document_execution_notice_of_intent": {
        "subject": "NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - [Firm Name]",
        "body": """NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS — Type: [Litigation Type]

This letter serves as formal notice that, having exhausted all good-faith efforts to obtain your execution of the required document below, ERTC Funding has instructed us to proceed with [Litigation Type].

[Document Name]

Over the course of our prior communications, we have attempted in good faith to resolve this matter amicably. Despite these efforts, we have received no executed document, no substantive response, and no indication of willingness to engage.

FINAL OPPORTUNITY TO RESOLVE: You have [Response Deadline Days] calendar days from receipt of this notice to execute the required document or submit a written proposal for resolution. After this period, we will file a [Litigation Type] without further notice.

Upon filing, ERTC Funding will seek recovery of:
1. All amounts and remedies available under the Agreement
2. Pre-judgment and post-judgment interest at the applicable statutory rate
3. All attorney fees and legal costs incurred
4. Filing fees, service fees, and all costs of collection
5. Any additional damages or remedies available under applicable law

[Document Links]

RESOLUTION REMAINS POSSIBLE: We remain willing to discuss a resolution to avoid formal proceedings. Please execute the document above or contact our office immediately to discuss.

Govern yourself accordingly.

This constitutes formal notice of intent to initiate legal proceedings pursuant to applicable law. All prior correspondence has been preserved and will be submitted as evidence of good-faith attempts to resolve this matter. This letter may be presented to the tribunal or court as evidence of compliance with pre-action protocol requirements.""",
    },
    "peo_authorization": {
        "subject": "PEO Authorization Required — Employee Retention Credit Claim",
        "body": """ERTC Funding performed ERC consulting services on your behalf, including evaluating your eligibility for the Employee Retention Credit ("ERC") and preparing supporting documentation for your claim.

Upon information and belief, your company may have utilized a Professional Employer Organization ("PEO") to administer payroll and file its federal employment tax returns. If so, ERTC Funding has been unable to determine whether your ERC claim has been filed, whether additional information is required, or whether any ERC refund, credit, or other benefit has been received.

[Document Name]

Please provide your PEO's information and execute the enclosed PEO Authorization within [Response Deadline Days] days from the date of this notice, so that your PEO may communicate directly with ERTC Funding regarding your ERC claim.

[Document Links]

Your continued failure to cooperate prevents ERTC Funding from determining the status of your ERC claim and may result in ERTC Funding pursuing all remedies available under the Agreement.""",
    },
    "initial_demand": {
        "subject": "Important: Outstanding Balance Notice - [Firm Name]",
        "body": """We write on behalf of our client regarding the outstanding balance described below, currently due and owing. Despite previous communications, this amount remains unpaid.

[Amount Owed]

In good faith, we are providing you with this formal notice and an opportunity to resolve this matter amicably before any further action is taken. We kindly request that you remit payment of the full outstanding amount within [Response Deadline Days] days from receipt of this letter.

If payment is not received within the stated period, our client reserves the right to pursue all available legal remedies, including but not limited to initiating formal arbitration or litigation proceedings to recover the outstanding amount, plus any applicable interest, costs, and attorney fees.

We strongly encourage you to contact us at your earliest convenience to discuss this matter and avoid further escalation. We remain open to discussing a reasonable resolution.

HOW TO RESPOND: Please reply directly to this email or contact our office to arrange payment or discuss a resolution plan.

This letter constitutes a good faith attempt to resolve this matter prior to formal legal proceedings. It shall not be construed as a waiver of any rights or remedies available to our client under applicable law.""",
    },
    "follow_up": {
        "subject": "Follow-Up: Outstanding Balance - Action Required - [Firm Name]",
        "body": """FOLLOW-UP NOTICE — ATTEMPT #[Attempt Number]

This letter serves as a follow-up to our previous correspondence regarding the outstanding balance below. As of the date of this letter, we have not received payment or a response to our prior communication.

[Amount Owed]

We urge you to treat this matter with urgency. You have [Response Deadline Days] days from receipt of this notice to remit payment or contact our office to discuss a resolution.

Failure to respond may result in our client pursuing formal legal action without further notice, which may include additional costs and fees.""",
    },
    "follow_up_2": {
        "subject": "URGENT: Escalation Warning - Outstanding Balance - [Firm Name]",
        "body": """ESCALATION WARNING — ATTEMPT #[Attempt Number]. This matter is being reviewed for formal legal proceedings.

We write with growing concern regarding the outstanding balance below. Despite our previous communications, we have received no response or payment from you.

[Amount Owed]

Please be advised that this matter has been escalated within our office. If we do not receive payment or a substantive response within [Response Deadline Days] days, we will have no choice but to recommend that our client initiate formal legal proceedings.

Such proceedings would include seeking recovery of the outstanding amount, plus interest, attorney fees, and all costs of collection. A formal Demand for Arbitration or Complaint will be filed without further notice.

LAST OPPORTUNITY: This is your opportunity to resolve this matter before formal escalation. Please reply immediately or contact our office to discuss a resolution.

This communication serves as formal notice of intent to escalate. All prior correspondence has been documented and may be used as evidence of good faith efforts to resolve this matter.""",
    },
    "final_notice": {
        "subject": "FINAL NOTICE: Demand for Payment Before Legal Action - [Firm Name]",
        "body": """FINAL NOTICE BEFORE LEGAL PROCEEDINGS

This is our final correspondence before initiating formal legal proceedings.

We have made multiple documented attempts to reach you regarding the outstanding balance below. Each communication has been recorded and will serve as evidence of our client's good faith efforts to resolve this matter amicably.

[Amount Owed]

Unless we receive full payment or a written response proposing a concrete resolution plan within [Response Deadline Days] days of this notice, our client will proceed with the following:
1. Filing a formal Demand for Arbitration or initiating litigation proceedings
2. Seeking recovery of the full outstanding amount plus accrued interest
3. Seeking recovery of all attorney fees and legal costs
4. Submitting this documented communication trail as evidence of good faith attempts

We strongly urge you to contact us immediately to avoid the additional expense and burden of formal legal proceedings. This remains your final opportunity to resolve this matter without litigation.

RESPOND IMMEDIATELY: Reply to this email or contact our office directly. Time is of the essence.

Govern yourself accordingly.

This letter constitutes a final demand and formal notice of intent to pursue legal remedies. All prior correspondence has been documented and preserved. This communication and its contents may be introduced as evidence in any subsequent legal proceedings.""",
    },
    "notice_of_intent": {
        "subject": "NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - [Firm Name]",
        "body": """NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS — Type: [Litigation Type]

This letter serves as formal notice that, having exhausted all good-faith efforts to resolve the outstanding matter below, our client has instructed us to proceed with [Litigation Type].

[Amount Owed]

Over the course of our prior communications, we have attempted in good faith to resolve this matter amicably. Despite these efforts, we have received no payment, no substantive response, and no indication of willingness to engage.

FINAL OPPORTUNITY TO RESOLVE: You have [Response Deadline Days] calendar days from receipt of this notice to respond with either full payment or a written proposal for resolution. After this period, we will file a [Litigation Type] without further notice.

Upon filing, our client will seek recovery of:
1. The full outstanding balance
2. Pre-judgment and post-judgment interest at the applicable statutory rate
3. All attorney fees and legal costs incurred
4. Filing fees, service fees, and all costs of collection
5. Any additional damages or remedies available under applicable law

SETTLEMENT REMAINS POSSIBLE: We remain willing to discuss a resolution to avoid formal proceedings. Please contact our office immediately at [Firm Phone] to discuss settlement options.

Govern yourself accordingly.""",
    },
    "general_letter": {
        "subject": "Correspondence from [Firm Name]",
        "body": """We are writing to update you regarding your matter. Please let us know if you have any questions.""",
    },
    "settlement_offer": {
        "subject": "Settlement Offer — [Case Title]",
        "body": """In the interest of resolving this matter amicably, we are pleased to extend the following settlement offer:

[Amount Owed]

Please respond within [Response Deadline Days] days to accept these terms or to discuss further. This offer is made without admission of liability and is confidential settlement communication.""",
    },
}

_TOKEN_RE = __import__("re").compile(r"\[([A-Za-z][A-Za-z '’]*)\]")


def _template_tokens_used(template_type: str) -> list:
    """Which [Bracket Token]s actually appear in a template's default subject
    + body — shown to the user as the "available fields" legend so they know
    what to leave alone when editing."""
    tpl = DEFAULT_PLAINTEXT_TEMPLATES.get(template_type)
    if not tpl:
        return []
    text = tpl["subject"] + "\n" + tpl["body"]
    seen, out = set(), []
    for m in _TOKEN_RE.finditer(text):
        tok = m.group(0)
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def _substitute_tokens(text: str, tokens: dict) -> str:
    for tok, val in tokens.items():
        text = text.replace(tok, val if val is not None else "")
    return text


# Prose categories, in narrative order, that make up an assembled letter
# body. signature_block/cta_config are deliberately excluded here — the
# letter shell (_render_plaintext_template) already provides its own
# closing/signature, and CTA/document-sign links are handled by the
# existing document_links machinery, not simple prose text.
_CLAUSE_BODY_CATEGORIES = [
    "factual_background", "contractual_obligations", "requested_action",
    "cure_period", "consequences", "remedies_sought", "reservation_of_rights",
]


def _assemble_clause_body(db, tenant_id: str, tokens: dict) -> Optional[str]:
    """Assemble a plaintext template body from the tenant's own saved clause
    library instead of the hardcoded DEFAULT_PLAINTEXT_TEMPLATES wording —
    the actual replacement for "the AI/tenant fills in a fixed Python
    template" described in the tenant-owned-outreach requirements.

    Uses whichever clause is flagged is_default_for_category per category;
    categories with no saved clause are simply skipped (not a blank
    paragraph). Returns None if the tenant hasn't saved any default clauses
    yet, so the caller can fall back to the built-in generic wording rather
    than sending an empty letter."""
    rows = db.execute(
        "SELECT category, body FROM outreach_clauses WHERE tenant_id = ? AND is_default_for_category = 1",
        (tenant_id,)
    ).fetchall()
    if not rows:
        return None
    by_category = {r["category"]: r["body"] for r in rows if (r["body"] or "").strip()}
    if not by_category:
        return None
    paragraphs = [
        _substitute_tokens(by_category[cat], tokens)
        for cat in _CLAUSE_BODY_CATEGORIES if cat in by_category
    ]
    return "\n\n".join(paragraphs)


def _amount_box(label: str, amount_str: str) -> str:
    return f"""<div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">{label}</p>
        <p style="color: #78350f; font-size: 28px; font-weight: 700; margin: 0;">{html_escape.escape(amount_str)}</p>
    </div>"""


def _document_name_box(document_name: str) -> str:
    return f"""<div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="color: #92400e; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0; font-weight: 600;">Required Document</p>
        <p style="color: #78350f; font-size: 20px; font-weight: 700; margin: 0;">{html_escape.escape(document_name)}</p>
    </div>"""


_BULLET_RE = __import__("re").compile(r"^[-•]\s+")
_NUMBERED_RE = __import__("re").compile(r"^\d+[.)]\s+")


def _render_plaintext_body(body_text: str, tokens: dict, document_links: list = None) -> str:
    """Turn a [Token]-substituted plain-text body into the same paragraph
    styling every template uses. A paragraph consisting only of
    [Amount Owed] / [Document Name] / [Document Links] (before substitution)
    renders as the matching visual callout instead of plain prose.

    Within a paragraph block, lines starting with "- " or "1. " are kept
    as their own indented lines, exactly as typed/pasted — plain-text
    conventions non-technical editors already know from Word/Docs, instead
    of requiring HTML <ul>/<li> markup. Numbers are never stripped or
    renumbered: a real <ol> would let the browser auto-number sequentially
    (1, 2, 3, ...) and silently discard whatever the user actually pasted
    (e.g. 1, 2, 5), so list lines render as literal <p> tags instead."""
    parts = []
    for raw_para in body_text.split("\n\n"):
        stripped = raw_para.strip()
        if not stripped:
            continue
        if stripped == "[Amount Owed]":
            parts.append(_amount_box("Amount", tokens.get("[Amount Owed]", "")))
            continue
        if stripped == "[Document Name]":
            parts.append(_document_name_box(tokens.get("[Document Name]", "")))
            continue
        if stripped == "[Document Links]":
            parts.append(_build_document_link_buttons(document_links or []))
            continue

        # Group consecutive lines by kind — an intro sentence followed by
        # bullet/numbered lines (all within one blank-line-separated block)
        # renders as its own <p> immediately followed by a real <ul>/<ol>,
        # rather than requiring every line in the block to be a list item.
        lines = [ln.strip() for ln in stripped.split("\n") if ln.strip()]
        groups: list = []
        for ln in lines:
            if _BULLET_RE.match(ln):
                kind = "ul"
            elif _NUMBERED_RE.match(ln):
                kind = "ol"
            else:
                kind = "prose"
            if groups and groups[-1][0] == kind:
                groups[-1][1].append(ln)
            else:
                groups.append((kind, [ln]))

        for kind, glines in groups:
            if kind == "prose":
                substituted = _substitute_tokens("\n".join(glines), tokens)
                escaped = html_escape.escape(substituted).replace("\n", "<br>\n")
                parts.append(f'<p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0 0 16px 0;">{escaped}</p>')
            else:
                # Literal <p> per line — not <ol>/<li> — so whatever the
                # user typed or pasted (their own numbers, letters, dashes)
                # renders and copy/pastes back out exactly as-is, instead of
                # being stripped and replaced with browser auto-numbering.
                items = "".join(
                    f'<p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0 0 6px 0; padding-left: 22px;">{html_escape.escape(_substitute_tokens(ln, tokens))}</p>'
                    for ln in glines
                )
                parts.append(items)
    return "\n".join(parts)


def _render_plaintext_template(
    template_type: str, tokens: dict, contact_name: str, sender_name: str,
    firm_name: str, client_name: str = "", recipient_address: str = "",
    case_title: str = "", case_number: str = "", logo_url: str = "",
    document_links: list = None, custom_subject: str = None, custom_body: str = None,
    tenant_id: str = "",
) -> tuple:
    """Render a template from its saved plain-text override (or the tenant's
    own clause library, or the built-in default plain-text version if
    neither exists) — the single render path used by preview, bulk send,
    and campaigns for any of the 9 editable templates."""
    default = DEFAULT_PLAINTEXT_TEMPLATES.get(template_type, {"subject": "", "body": ""})
    subject_tpl = custom_subject if custom_subject is not None else default["subject"]
    body_tpl = custom_body
    if body_tpl is None and tenant_id:
        with get_db() as db:
            body_tpl = _assemble_clause_body(db, tenant_id, tokens)
    if body_tpl is None:
        body_tpl = default["body"]

    subject = _substitute_tokens(subject_tpl, tokens)
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    ref_line = ""
    if case_number:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {html_escape.escape(case_title)} (Ref: {html_escape.escape(case_number)})</p>'
    elif case_title:
        ref_line = f'<p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>Re:</strong> {html_escape.escape(case_title)}</p>'

    body_html = _render_plaintext_body(body_tpl, tokens, document_links)

    # If the editable body already ends with its own closing ("Sincerely,",
    # "Respectfully,", etc.), don't stack a second, hardcoded one under it —
    # only add the default "Respectfully," when the user hasn't written one.
    _KNOWN_CLOSINGS = ("sincerely", "respectfully", "regards", "best regards", "yours truly", "cordially")
    last_line = [ln.strip() for ln in body_tpl.strip().split("\n") if ln.strip()]
    has_own_closing = bool(last_line) and last_line[-1].rstrip(",.").lower() in _KNOWN_CLOSINGS
    closing_html = "" if has_own_closing else '<p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>'

    html = _build_email_header(firm_name, "Attorneys & Counselors at Law", logo_url) + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            {_attn_block(contact_name, recipient_address)}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">Dear {html_escape.escape(contact_name)},</p>

            {body_html}

            {closing_html}
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{html_escape.escape(sender_name)}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{html_escape.escape(firm_name)}</p>
            {_on_behalf_of_line(client_name)}
        </div>
    """

    return subject, html


def _get_custom_template(db, tenant_id: str, template_type: str):
    """Returns the saved plain-text override row for this template, or None
    if the tenant hasn't customized it (falls back to the default wording)."""
    return db.execute(
        "SELECT * FROM email_template_custom WHERE tenant_id = ? AND template_type = ?",
        (tenant_id, template_type),
    ).fetchone()


# The template types that go through the plain-text override system —
# every template listed in the "Email Templates" tab except General Letter,
# which is already free-typed per send (needsCustomBody) and has no fixed
# default wording to override.
_PLAINTEXT_TEMPLATE_TYPES = {
    "outstanding_amount", "document_execution_request", "peo_authorization",
    "initial_demand", "follow_up", "follow_up_2", "final_notice", "notice_of_intent",
    "settlement_offer",
}


def _build_plaintext_tokens(
    firm_name: str = "", sender_name: str = "", client_name: str = "",
    case_title: str = "", response_deadline_days: int = 14, firm_phone: str = "",
    amount_str: str = "", document_name: str = "", litigation_type: str = "Demand for Arbitration",
    attempt_number: int = 1, recipient_company: str = "",
) -> dict:
    """Builds the [Token] -> value map used to substitute a plain-text
    template body/subject. Unused tokens for a given template type are
    harmless no-ops (they simply don't appear in that template's text)."""
    return {
        "[Firm Name]": firm_name or "",
        "[Sender Name]": sender_name or "",
        "[Client Name]": client_name or "",
        "[Case Title]": case_title or firm_name or "",
        "[Response Deadline Days]": str(response_deadline_days),
        "[Firm Phone]": firm_phone or "",
        "[Amount Owed]": amount_str or "",
        "[Document Name]": document_name or "",
        "[Litigation Type]": litigation_type or "Demand for Arbitration",
        "[Attempt Number]": str(attempt_number),
        "[Recipient Company]": recipient_company or "",
    }


def _build_advanced_html_tokens(
    base_tokens: dict, contact_name: str = "", recipient_address: str = "",
    sender_title: str = "", sender_email: str = "", firm_website: str = "", logo_url: str = "",
    firm_address: str = "", signature_sender_name: str = "",
    filed_quarters: str = "", additional_quarter: str = "", contingency_fee_text: str = "",
) -> dict:
    """Extra [Token]s only needed by a fully custom, designer-authored raw
    HTML letter — the plain-text renderer doesn't need these since it
    auto-generates the salutation/ATTN/date/signature lines itself, but a
    self-contained custom HTML letter has to substitute them inline.

    [Sender Name] is overridden from the default Email Signature's sender
    name (the firm's actual designated correspondent, e.g. its CFO) rather
    than the app user who happens to be composing/sending — a signature
    block should show who the firm holds out as the signer, not whoever is
    operating the software that day."""
    return {
        **base_tokens,
        "[Sender Name]": signature_sender_name or base_tokens.get("[Sender Name]", ""),
        "[Recipient Name]": contact_name or "",
        "[Recipient Address]": recipient_address or "",
        "[Today's Date]": datetime.now(timezone.utc).strftime("%B %d, %Y"),
        "[Sender Title]": sender_title or "",
        "[Sender Email]": sender_email or "",
        "[Firm Website]": firm_website or "",
        "[Firm Logo URL]": logo_url or "",
        "[Firm Address]": firm_address or "",
        "[Filed Quarters]": filed_quarters or "",
        "[Additional Quarter]": additional_quarter or "",
        "[Contingency Fee]": contingency_fee_text or "",
    }


def _render_custom_html_template(html_tpl: str, tokens: dict, document_links: list = None) -> str:
    """Token-substitutes a fully custom, designer-authored HTML letter
    verbatim — no auto-appended header/signature/footer, since this HTML is
    expected to already be complete and self-contained (already inline-
    styled, since <style> blocks and CSS classes are stripped by most email
    clients, especially Outlook desktop). [Sign URL] resolves to the first
    attached document's review/sign link."""
    html = html_tpl
    if document_links:
        html = html.replace("[Sign URL]", document_links[0].get("review_url", ""))
    for tok, val in tokens.items():
        html = html.replace(tok, val if val is not None else "")
    return html


# ---------------------------------------------------------------------------
# Helper: send one email via SMTP
# ---------------------------------------------------------------------------

def _send_outreach_email(to_email: str, subject: str, html_body: str,
                         from_name: str = "", tracking_id: str = "", cc: str = "") -> bool:
    """Send an outreach email. Adds tracking pixel if tracking_id provided.
    `cc`, if given, is added to the actual envelope recipients (not just a
    display header) — used to copy the sender/creator on their own outbound
    correspondence, so there's a real delivered record of what went out."""
    from app.utils.email import _send_email, SMTP_FROM

    # Insert tracking pixel before closing </div>
    if tracking_id:
        pixel_url = f"{BASE_URL}/api/outreach/track/{tracking_id}/open.png"
        tracking_pixel = f'<img src="{pixel_url}" width="1" height="1" style="display:none;" alt="" />'
        html_body = html_body.replace("</div>\n    </div>", f'{tracking_pixel}</div>\n    </div>', 1)

    # Override the From header with the sender name
    import smtplib
    import ssl
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from app.utils.email import (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
        SMTP_FROM_SALES, SMTP_USER_SALES, SMTP_PASS_SALES)
    DEFAULT_FROM = SMTP_FROM_SALES or SMTP_USER_SALES or "sales@litigationspace.com"
    _auth_user   = SMTP_USER_SALES or SMTP_USER
    _auth_pass   = SMTP_PASS_SALES or SMTP_PASS

    if not SMTP_HOST:
        logger.info(f"[OUTREACH] SMTP not configured. Would send to {to_email}: {subject}")
        return False

    try:
        to_recipients = parse_recipients(to_email)
        cc_recipients = [c for c in parse_recipients(cc) if c.lower() not in {r.lower() for r in to_recipients}]
        envelope_recipients = to_recipients + cc_recipients

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        display_name = from_name if from_name else "LitigationSpace"
        msg["From"] = f"{display_name} <{DEFAULT_FROM}>"
        msg["To"] = to_email
        if cc_recipients:
            msg["Cc"] = ", ".join(cc_recipients)
        msg["Reply-To"] = DEFAULT_FROM
        msg.attach(MIMEText(html_body, "html"))

        if SMTP_HOST in ("localhost", "127.0.0.1") and not SMTP_USER:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.sendmail(DEFAULT_FROM, envelope_recipients, msg.as_string())
        else:
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(_auth_user, _auth_pass)
                server.sendmail(DEFAULT_FROM, envelope_recipients, msg.as_string())

        logger.info(f"[OUTREACH] Sent to {envelope_recipients}: {subject}")
        return True
    except Exception as e:
        logger.error(f"[OUTREACH] Failed to send to {to_email}: {e}")
        return False


# ---------------------------------------------------------------------------
# Thread events — the append-only evidence/timeline backbone
# ---------------------------------------------------------------------------

def _log_thread_event(db, tenant_id: str, case_id: str, contact_id: str, event_type: str,
                       actor_type: str = "system", actor_id: str = None, actor_name: str = "",
                       email_id: str = None, document_link_id: str = None,
                       ip_address: str = None, user_agent: str = None,
                       metadata: dict = None) -> str:
    """Insert one permanent, append-only thread event. This single call is
    what feeds the thread timeline UI, the litigation evidence export, and
    (via _notify_thread_watchers) internal notifications — never update or
    delete a row here, only insert."""
    event_id = generate_id()
    db.execute(
        """INSERT INTO outreach_thread_events
           (id, tenant_id, case_id, contact_id, event_type, actor_type, actor_id, actor_name,
            email_id, document_link_id, ip_address, user_agent, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (event_id, tenant_id, case_id, contact_id, event_type, actor_type, actor_id,
         actor_name, email_id, document_link_id, ip_address, user_agent,
         json.dumps(metadata or {}))
    )
    return event_id


_EVENT_NOTIFICATION_COPY = {
    "email_opened":        ("outreach_email_opened", "Email opened"),
    "document_opened":     ("outreach_document_opened", "Document opened"),
    "document_downloaded": ("outreach_document_downloaded", "Document downloaded"),
    "signature_started":   ("outreach_signature_started", "Signature started"),
    "signature_completed": ("outreach_signature_completed", "Document signed"),
    "comment_added":       ("outreach_comment_added", "Comment left on document"),
    "sequence_stopped":    ("outreach_sequence_stopped", "Follow-up sequence stopped"),
}

def _notify_thread_watchers(db, tenant_id: str, case_id: str, contact_id: str,
                             event_type: str, contact_name: str, detail: str = ""):
    """Push an in-app notification (existing bell/notifications table) to
    every internal user watching this contact's thread, for the event types
    worth interrupting someone over. Best-effort — never raises."""
    copy = _EVENT_NOTIFICATION_COPY.get(event_type)
    if not copy:
        return
    notif_type, title = copy
    try:
        watchers = db.execute(
            "SELECT user_id FROM outreach_thread_participants WHERE contact_id = ? AND tenant_id = ?",
            (contact_id, tenant_id)
        ).fetchall()
        message = f"{contact_name}: {title}" + (f" — {detail}" if detail else "")
        for w in watchers:
            db.execute(
                """INSERT INTO notifications (id, user_id, tenant_id, type, title, message, data)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (generate_id(), w["user_id"], tenant_id, notif_type, title, message,
                 json.dumps({"case_id": case_id, "contact_id": contact_id}))
            )
    except Exception as e:
        logger.warning(f"Thread watcher notification failed: {e}")


def _stop_remaining_campaign_steps(db, tenant_id: str, case_id: str, contact_id: str) -> int:
    """When a recipient signs/executes a document, any not-yet-sent stages
    of an active campaign to them are pointless (and embarrassing — a
    follow-up letter accusing someone of not responding, sent after they
    already complied, undermines the whole evidentiary record). Cancels
    every staged/ready/scheduled campaign_emails row for this contact across
    that case's active campaigns and returns how many were stopped."""
    rows = db.execute(
        """SELECT ce.id FROM campaign_emails ce
           JOIN case_campaigns cc ON ce.campaign_id = cc.id
           WHERE ce.contact_id = ? AND cc.case_id = ? AND cc.tenant_id = ?
             AND cc.status IN ('pending_approval', 'approved')
             AND ce.status IN ('staged', 'ready', 'scheduled')""",
        (contact_id, case_id, tenant_id)
    ).fetchall()
    if not rows:
        return 0
    db.execute(
        """UPDATE campaign_emails SET status = 'cancelled'
           WHERE id IN (%s)""" % ",".join("?" * len(rows)),
        [r["id"] for r in rows]
    )
    return len(rows)


# ---------------------------------------------------------------------------
# CONTACTS CRUD
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/contacts")
async def list_contacts(case_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM case_contacts WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC",
            (case_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.post("/cases/{case_id}/contacts")
async def create_contact(case_id: str, req: ContactCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    contact_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            """INSERT INTO case_contacts (id, case_id, tenant_id, name, email, phone, company,
               contact_title, party_role, amount_owed, currency, notes, address_line1, address_line2,
               address_line3, city, state, postal_code, country, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (contact_id, case_id, tenant_id, req.name, req.email, req.phone, req.company,
             req.contact_title, req.party_role, req.amount_owed, req.currency, req.notes,
             req.address_line1, req.address_line2, req.address_line3, req.city, req.state,
             req.postal_code, req.country, now, now)
        )
    return {"data": {"id": contact_id, "name": req.name, "email": req.email}}


@router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, req: ContactUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    updates = {}
    for field in ["name", "email", "phone", "company", "contact_title", "party_role",
                  "amount_owed", "currency", "notes", "status",
                  "address_line1", "address_line2", "address_line3", "city", "state", "postal_code", "country"]:
        val = getattr(req, field, None)
        if val is not None:
            updates[field] = val
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = now
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [contact_id, tenant_id]
    with get_db() as db:
        db.execute(f"UPDATE case_contacts SET {set_clause} WHERE id = ? AND tenant_id = ?", vals)
        row = db.execute("SELECT * FROM case_contacts WHERE id = ?", (contact_id,)).fetchone()
    return {"data": dict(row) if row else {}}


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        # Remove campaign_emails referencing this contact before deleting (FK constraint)
        db.execute("DELETE FROM campaign_emails WHERE contact_id = ?", (contact_id,))
        db.execute("DELETE FROM case_contacts WHERE id = ? AND tenant_id = ?", (contact_id, tenant_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# IMPORT CONTACTS (CSV-style bulk add)
# ---------------------------------------------------------------------------

class BulkContactImport(BaseModel):
    contacts: List[ContactCreate]

@router.post("/cases/{case_id}/contacts/bulk")
async def bulk_import_contacts(case_id: str, req: BulkContactImport, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    created = []
    with get_db() as db:
        for c in req.contacts:
            cid = generate_id()
            db.execute(
                """INSERT INTO case_contacts (id, case_id, tenant_id, name, email, phone, company,
                   amount_owed, currency, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (cid, case_id, tenant_id, c.name, c.email, c.phone, c.company,
                 c.amount_owed, c.currency, c.notes, now, now)
            )
            created.append({"id": cid, "name": c.name, "email": c.email})
    return {"data": created, "count": len(created)}


def _require_default_signature(db, tenant_id: str):
    """Block sending until the tenant has configured a default email
    signature — outreach emails must never go out unsigned."""
    row = db.execute(
        "SELECT id FROM email_signatures WHERE tenant_id = ? AND is_default = 1 LIMIT 1",
        (tenant_id,)
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=400,
            detail="Create and set a default Email Signature before sending outreach emails (Outreach → Email Signatures).",
        )


# ---------------------------------------------------------------------------
# SEND EMAILS
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/emails/send")
async def send_emails(case_id: str, req: EmailSendRequest, current_user: dict = Depends(get_current_user)):
    """Send custom email to one or more contacts."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as _sig_check_db:
        _require_default_signature(_sig_check_db, tenant_id)
    results = []

    with get_db() as db:
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        sender_name = req.from_name or (user_row["full_name"] if user_row else "Attorney")

        for contact_id in req.contact_ids:
            contact = db.execute(
                "SELECT * FROM case_contacts WHERE id = ? AND tenant_id = ?",
                (contact_id, tenant_id)
            ).fetchone()
            if not contact:
                results.append({"contact_id": contact_id, "status": "not_found"})
                continue

            email_id = generate_id()
            tracking_id = str(uuid.uuid4())

            # Send the email
            success = _send_outreach_email(
                to_email=contact["email"],
                subject=req.subject,
                html_body=req.body_html,
                from_name=sender_name,
                tracking_id=tracking_id,
                cc=current_user.get("email", ""),
            )

            status = "sent" if success else "failed"
            db.execute(
                """INSERT INTO case_emails (id, case_id, tenant_id, contact_id, sender_user_id,
                   template_type, subject, body_html, from_name, status, tracking_id, sent_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (email_id, case_id, tenant_id, contact_id, user_id,
                 req.template_type, req.subject, req.body_html, sender_name,
                 status, tracking_id, now if success else None, now)
            )

            # Log tracking event
            if success:
                db.execute(
                    "INSERT INTO email_tracking_events (id, email_id, event_type, created_at) VALUES (?, ?, 'sent', ?)",
                    (generate_id(), email_id, now)
                )
                db.execute(
                    """UPDATE case_contacts SET total_emails_sent = total_emails_sent + 1,
                       last_contacted_at = ?, updated_at = ? WHERE id = ?""",
                    (now, now, contact_id)
                )
                _log_thread_event(db, tenant_id, case_id, contact_id, "email_sent",
                                   actor_type="internal_user", actor_id=user_id, actor_name=sender_name,
                                   email_id=email_id, metadata={"subject": req.subject})

            results.append({"contact_id": contact_id, "email_id": email_id, "status": status})

    return {"data": results, "sent": sum(1 for r in results if r["status"] == "sent")}


@router.post("/cases/{case_id}/emails/bulk-send")
async def bulk_send_template(case_id: str, req: BulkEmailRequest, current_user: dict = Depends(get_current_user)):
    """Send template-based emails to multiple contacts."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    results = []

    with get_db() as db:
        _require_default_signature(db, tenant_id)
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        sender_name = req.from_name or (user_row["full_name"] if user_row else "Attorney")

        # Get case info for reference — client_name is the creditor this demand
        # is being sent on behalf of, shown below the signature in the template.
        case_row = db.execute("SELECT title, case_number, client_name FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        case_title = case_row["title"] if case_row else ""
        case_number = case_row["case_number"] if case_row else ""
        client_name = (case_row["client_name"] if case_row else "") or case_title

        # The tenant's default email signature — appended to every template
        # send below so switching the default actually changes what goes out,
        # instead of only affecting the separate Compose Email flow. It's also
        # now the source of firm name/address/phone, replacing the old
        # separate Template Settings form.
        default_sig_row = db.execute(
            "SELECT * FROM email_signatures WHERE tenant_id = ? AND is_default = 1 LIMIT 1",
            (tenant_id,)
        ).fetchone()
        default_sig_html = ""
        if default_sig_row:
            sig_d = dict(default_sig_row)
            default_sig_html = sig_d.get("custom_html") or _build_signature_html(sig_d)
        sig_firm_name, sig_firm_address, sig_firm_phone, sig_logo_url = _signature_firm_identity(default_sig_row)
        firm_name = req.firm_name or sig_firm_name or "Law Office"
        firm_address = req.firm_address or sig_firm_address
        firm_phone = req.firm_phone or sig_firm_phone
        logo_url = sig_logo_url

        custom_row = _get_custom_template(db, tenant_id, req.template_type) if req.template_type in _PLAINTEXT_TEMPLATE_TYPES else None
        custom_subject_tpl = custom_row["custom_subject"] if custom_row else None
        custom_body_tpl = custom_row["custom_body"] if custom_row else None

        for contact_id in req.contact_ids:
            contact = db.execute(
                "SELECT * FROM case_contacts WHERE id = ? AND tenant_id = ?",
                (contact_id, tenant_id)
            ).fetchone()
            if not contact:
                results.append({"contact_id": contact_id, "status": "not_found"})
                continue

            amount = contact["amount_owed"] or 0
            currency = contact["currency"] or "USD"
            attempt = (contact["total_emails_sent"] or 0) + 1
            recipient_address = _format_address_block(
                contact["address_line1"] or "", contact["address_line2"] or "",
                contact["city"] or "", contact["state"] or "",
                contact["postal_code"] or "", contact["country"] or "",
            )

            # Generate from template
            amount_str = f"{currency} {amount:,.2f}" if amount else "the outstanding balance"
            used_advanced_html = False
            if req.template_type in ("document_execution_request", "peo_authorization"):
                document_links = []
                document_names = []
                for doc_id in (req.document_ids or []):
                    doc_row = db.execute(
                        "SELECT * FROM documents WHERE id = ? AND tenant_id = ?", (doc_id, tenant_id)
                    ).fetchone()
                    if not doc_row:
                        continue
                    dlink = _create_outreach_document_link(
                        db, tenant_id, case_id, contact_id, doc_id,
                        contact["name"], contact["email"] or "", created_by=user_id,
                        message=f"{sender_name} has requested your signature on this document.",
                        mode="wet_sign", allow_download=True, signature_pages=[1],
                    )
                    document_links.append({"filename": doc_row["filename"], "review_url": dlink["review_url"]})
                    document_names.append(doc_row["filename"])
                if not document_links:
                    results.append({"contact_id": contact_id, "status": "failed", "subject": "No valid documents provided"})
                    continue
                tokens = _build_plaintext_tokens(
                    firm_name=firm_name, sender_name=sender_name, client_name=client_name,
                    case_title=case_title, response_deadline_days=req.response_deadline_days,
                    firm_phone=firm_phone, document_name=", ".join(document_names),
                    recipient_company=contact["company"] or "", amount_str=amount_str,
                )
                if custom_row and custom_row["custom_html"]:
                    sig_extra = dict(default_sig_row) if default_sig_row else {}
                    adv_tokens = _build_advanced_html_tokens(
                        tokens, contact_name=contact["name"], recipient_address=recipient_address,
                        sender_title=sig_extra.get("sender_title", ""), sender_email=sig_extra.get("sender_email", ""),
                        firm_website=sig_extra.get("website_url", ""), logo_url=logo_url, firm_address=firm_address,
                        signature_sender_name=sig_extra.get("sender_name", ""),
                    )
                    subject = _substitute_tokens(custom_subject_tpl or "", adv_tokens)
                    html = _render_custom_html_template(custom_row["custom_html"], adv_tokens, document_links)
                    used_advanced_html = True
                else:
                    subject, html = _render_plaintext_template(
                        req.template_type, tokens, contact["name"], sender_name, firm_name,
                        client_name=client_name, recipient_address=recipient_address, case_title=case_title,
                        case_number=case_number, logo_url=logo_url, document_links=document_links,
                        custom_subject=custom_subject_tpl, custom_body=custom_body_tpl,
                        tenant_id=tenant_id,
                    )
            elif req.template_type in _PLAINTEXT_TEMPLATE_TYPES:
                tokens = _build_plaintext_tokens(
                    firm_name=firm_name, sender_name=sender_name, client_name=client_name,
                    case_title=case_title, response_deadline_days=req.response_deadline_days,
                    firm_phone=firm_phone, amount_str=amount_str, attempt_number=attempt,
                    recipient_company=contact["company"] or "",
                )
                subject, html = _render_plaintext_template(
                    req.template_type, tokens, contact["name"], sender_name, firm_name,
                    client_name=client_name, recipient_address=recipient_address, case_title=case_title,
                    case_number=case_number, logo_url=logo_url,
                    custom_subject=custom_subject_tpl, custom_body=custom_body_tpl,
                    tenant_id=tenant_id,
                )
            elif req.template_type == "general_letter":
                subject, html = _template_general_letter(
                    contact["name"], req.custom_subject or "", req.custom_body or "", firm_name, sender_name,
                    case_title=case_title, case_number=case_number,
                    recipient_address=recipient_address, client_name=client_name, logo_url=logo_url,
                )
            else:
                # Custom
                subject = req.custom_subject or f"Important Notice - {firm_name}"
                html = req.custom_body or "<p>No content provided.</p>"

            if req.custom_subject:
                subject = req.custom_subject

            if not used_advanced_html and req.template_type in ("initial_demand", "follow_up", "follow_up_2", "final_notice",
                                      "general_letter", "settlement_offer", "outstanding_amount",
                                      "document_execution_request", "peo_authorization"):
                # Signature, then footer last — footer's own markup is what
                # closes the wrapper div _build_email_header left open, so it
                # must come after the signature, not before it. Skipped
                # entirely for advanced HTML mode, which is self-contained.
                if default_sig_html:
                    html += default_sig_html
                html += _build_email_footer(firm_name, firm_address, firm_phone)

            email_id = generate_id()
            tracking_id = str(uuid.uuid4())

            success = _send_outreach_email(
                to_email=contact["email"],
                subject=subject,
                html_body=html,
                from_name=sender_name,
                tracking_id=tracking_id,
                cc=current_user.get("email", ""),
            )

            status = "sent" if success else "failed"
            db.execute(
                """INSERT INTO case_emails (id, case_id, tenant_id, contact_id, sender_user_id,
                   template_type, subject, body_html, from_name, status, tracking_id, sent_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (email_id, case_id, tenant_id, contact_id, user_id,
                 req.template_type, subject, html, sender_name,
                 status, tracking_id, now if success else None, now)
            )

            if success:
                db.execute(
                    "INSERT INTO email_tracking_events (id, email_id, event_type, created_at) VALUES (?, ?, 'sent', ?)",
                    (generate_id(), email_id, now)
                )
                db.execute(
                    """UPDATE case_contacts SET total_emails_sent = total_emails_sent + 1,
                       last_contacted_at = ?, updated_at = ? WHERE id = ?""",
                    (now, now, contact_id)
                )
                _log_thread_event(db, tenant_id, case_id, contact_id, "email_sent",
                                   actor_type="internal_user", actor_id=user_id, actor_name=sender_name,
                                   email_id=email_id, metadata={"subject": subject, "template_type": req.template_type})

            results.append({"contact_id": contact_id, "email_id": email_id, "status": status, "subject": subject})

    return {"data": results, "sent": sum(1 for r in results if r["status"] == "sent")}


# ---------------------------------------------------------------------------
# DOCUMENT LINKS — secure no-login review/sign, per recipient, fully tracked
# ---------------------------------------------------------------------------

def _create_outreach_document_link(db, tenant_id: str, case_id: str, contact_id: str, document_id: str,
                                    contact_name: str, contact_email: str, created_by: str, message: str = "",
                                    mode: str = "sign", allow_download: bool = True, hours: int = 168,
                                    signature_pages: list = None) -> dict:
    """Create a tokenized per-recipient document link (+ bridging signature
    request when mode='sign') without sending an email — the caller decides
    how/when to notify (a standalone send, or embedded as one of several
    buttons in a larger templated email). Reuses an existing still-pending
    link for the same contact+document+mode instead of minting a new one —
    matters because this is called on every template preview/reload, not
    just on an actual send."""
    existing = db.execute(
        """SELECT * FROM outreach_document_links
           WHERE contact_id = ? AND document_id = ? AND mode = ? AND status = 'sent'
           ORDER BY created_at DESC LIMIT 1""",
        (contact_id, document_id, mode)
    ).fetchone()
    if existing and existing["expires_at"] and datetime.now(timezone.utc) < datetime.fromisoformat(existing["expires_at"]):
        return {
            "id": existing["id"], "token": existing["token"], "sign_token": existing["sign_token"],
            "expires_at": existing["expires_at"],
            "review_url": f"{FRONTEND_URL}/outreach-document/{existing['token']}",
            "sign_url": f"{FRONTEND_URL}/sign/{existing['sign_token']}" if existing["sign_token"] else None,
        }

    import secrets as _secrets
    token = _secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    link_id = generate_id()

    sign_token = None
    if mode == "sign":
        sign_token = _secrets.token_urlsafe(32)
        sig_req_id = generate_id()
        db.execute(
            """INSERT INTO signature_requests
               (id, document_id, tenant_id, signer_name, signer_email, sign_token,
                signature_pages, status, message, expires_at, case_id, contact_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (sig_req_id, document_id, tenant_id, contact_name, contact_email or "",
             sign_token, json.dumps(signature_pages or [1]), message, expires_at, case_id, contact_id)
        )

    db.execute(
        """INSERT INTO outreach_document_links
           (id, tenant_id, case_id, contact_id, document_id, token, mode, allow_download,
            sign_token, created_by, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (link_id, tenant_id, case_id, contact_id, document_id, token, mode,
         1 if allow_download else 0, sign_token, created_by, expires_at)
    )

    return {
        "id": link_id, "token": token, "sign_token": sign_token, "expires_at": expires_at,
        "review_url": f"{FRONTEND_URL}/outreach-document/{token}",
        "sign_url": f"{FRONTEND_URL}/sign/{sign_token}" if sign_token else None,
    }


@router.post("/cases/{case_id}/contacts/{contact_id}/send-document")
async def send_document_to_contact(case_id: str, contact_id: str, req: SendDocumentRequest,
                                    current_user: dict = Depends(get_current_user)):
    """Attach a case document to this contact as a secure, no-login review or
    sign link. mode='review' lets them read/comment/download; mode='sign'
    additionally requires completing a signature (bridges to the existing
    e-signature flow in signatures.py) before the request is satisfied."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]

    with get_db() as db:
        contact = db.execute(
            "SELECT * FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (contact_id, case_id, tenant_id)
        ).fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (req.document_id, tenant_id)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        if req.mode not in ("review", "sign", "wet_sign"):
            raise HTTPException(status_code=400, detail="mode must be 'review', 'sign', or 'wet_sign'")
        if req.mode == "sign" and not req.signature_pages:
            raise HTTPException(status_code=400, detail="signature_pages is required when mode='sign'")

        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        sender_name = user_row["full_name"] if user_row else "Your contractor"
        message = (req.message or "").strip() or f"{sender_name} has shared a document for your review."

        link = _create_outreach_document_link(
            db, tenant_id, case_id, contact_id, req.document_id,
            contact["name"], contact["email"] or "", created_by=user_id, message=message,
            mode=req.mode, allow_download=req.allow_download, hours=req.hours,
            signature_pages=req.signature_pages,
        )
        link_id, token, sign_token, review_url, expires_at = link["id"], link["token"], link["sign_token"], link["review_url"], link["expires_at"]

        if req.mode == "sign":
            send_signature_request_email(
                to_email=contact["email"], signer_name=contact["name"], sender_name=sender_name,
                doc_filename=doc["filename"], sign_url=link["sign_url"], message=message,
                page_count=len(req.signature_pages),
            )
        else:
            send_document_review_email(
                to_email=contact["email"], reviewer_name=contact["name"], sender_name=sender_name,
                doc_filename=doc["filename"], review_url=review_url, instruction_message=message,
            )

        _log_thread_event(db, tenant_id, case_id, contact_id, "document_sent",
                           actor_type="internal_user", actor_id=user_id, actor_name=sender_name,
                           document_link_id=link_id,
                           metadata={"document_id": req.document_id, "filename": doc["filename"], "mode": req.mode})

    return {"data": {"id": link_id, "token": token, "review_url": review_url,
                      "sign_token": sign_token, "mode": req.mode, "expires_at": expires_at}}


def _validate_document_link_token(db, token: str):
    link = db.execute("SELECT * FROM outreach_document_links WHERE token = ?", (token,)).fetchone()
    if not link:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    if link["expires_at"]:
        expires = datetime.fromisoformat(link["expires_at"])
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=410, detail="This link has expired")
    return link


@router.get("/document-links/{token}")
async def get_document_link(token: str, request: Request):
    """Public: fetch document metadata + prior comments for the review page.
    No auth — the token is the credential. Logs a document_opened event on
    every load (each open is separately evidentiary)."""
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")
    with get_db() as db:
        link = _validate_document_link_token(db, token)
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (link["document_id"],)).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        contact = db.execute("SELECT name FROM case_contacts WHERE id = ?", (link["contact_id"],)).fetchone()
        contact_name = contact["name"] if contact else "Contact"

        db.execute(
            """UPDATE outreach_document_links SET view_count = view_count + 1,
               status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END WHERE id = ?""",
            (link["id"],)
        )
        event_id = _log_thread_event(db, link["tenant_id"], link["case_id"], link["contact_id"],
                                      "document_opened", actor_type="contact", actor_id=link["contact_id"],
                                      actor_name=contact_name, document_link_id=link["id"],
                                      ip_address=ip, user_agent=ua)
        _notify_thread_watchers(db, link["tenant_id"], link["case_id"], link["contact_id"],
                                 "document_opened", contact_name, detail=doc["filename"])

        comment_rows = db.execute(
            """SELECT actor_name, metadata, created_at FROM outreach_thread_events
               WHERE document_link_id = ? AND event_type = 'comment_added' ORDER BY created_at ASC""",
            (link["id"],)
        ).fetchall()
        comments = []
        for r in comment_rows:
            meta = json.loads(r["metadata"] or "{}")
            comments.append({
                "commenter_name": r["actor_name"], "comment": meta.get("comment", ""),
                "page_number": meta.get("page_number"), "action": meta.get("action", "comment"),
                "created_at": r["created_at"],
            })

        return {
            "document_id": doc["id"], "filename": doc["filename"], "category": doc["category"],
            "mode": link["mode"], "allow_download": bool(link["allow_download"]),
            "status": "opened" if link["status"] == "sent" else link["status"],
            "sign_token": link["sign_token"] if link["mode"] == "sign" else None,
            "view_event_id": event_id, "comments": comments,
        }


@router.get("/document-links/{token}/file")
async def download_document_link_file(token: str, download: bool = False, request: Request = None):
    """Public: serve the file itself. download=true marks it as an explicit
    download (distinct evidence from merely viewing it inline)."""
    with get_db() as db:
        link = _validate_document_link_token(db, token)
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (link["document_id"],)).fetchone()
        if not doc or not doc["file_path"]:
            raise HTTPException(status_code=404, detail="File not found on server")
        if download and not link["allow_download"]:
            raise HTTPException(status_code=403, detail="Downloading this document is not permitted")
        full_path = Path(UPLOAD_BASE_DIR) / doc["file_path"]
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found on server")

        if download:
            contact = db.execute("SELECT name FROM case_contacts WHERE id = ?", (link["contact_id"],)).fetchone()
            contact_name = contact["name"] if contact else "Contact"
            db.execute("UPDATE outreach_document_links SET download_count = download_count + 1 WHERE id = ?", (link["id"],))
            ip = request.client.host if request and request.client else None
            ua = request.headers.get("user-agent", "") if request else ""
            _log_thread_event(db, link["tenant_id"], link["case_id"], link["contact_id"],
                               "document_downloaded", actor_type="contact", actor_id=link["contact_id"],
                               actor_name=contact_name, document_link_id=link["id"],
                               ip_address=ip, user_agent=ua)
            _notify_thread_watchers(db, link["tenant_id"], link["case_id"], link["contact_id"],
                                     "document_downloaded", contact_name, detail=doc["filename"])

        return FileResponse(full_path, media_type=doc["mime_type"] or "application/pdf", filename=doc["filename"])


@router.post("/document-links/{token}/heartbeat")
async def document_link_heartbeat(token: str, req: ViewHeartbeatRequest):
    """Public: accumulate time-spent-viewing, reported periodically by the
    review page while it's open. Best-effort, never blocks the viewer."""
    with get_db() as db:
        link = db.execute("SELECT id FROM outreach_document_links WHERE token = ?", (token,)).fetchone()
        if link:
            db.execute(
                "UPDATE outreach_document_links SET total_view_seconds = total_view_seconds + ? WHERE id = ?",
                (max(0, min(req.seconds, 300)), link["id"])  # clamp per-ping to 5 min to resist abuse
            )
    return {"ok": True}


@router.post("/document-links/{token}/upload-signed")
async def upload_signed_document(token: str, request: Request, file: UploadFile = File(...)):
    """Public: for mode='wet_sign' links — the recipient downloads the blank
    form, hand-signs it, and uploads a scan/photo back here. A canvas-drawn
    e-signature is not IRS-valid for a form filed by mail/fax (see Form 8821
    instructions), so documents requiring a handwritten signature use this
    upload flow instead of the /sign/{token} canvas."""
    with get_db() as db:
        link = _validate_document_link_token(db, token)
        if link["mode"] != "wet_sign":
            raise HTTPException(status_code=400, detail="This document does not use the upload-signed-copy flow")

        ext = Path(file.filename or "signed.pdf").suffix.lower() or ".pdf"
        if ext not in {".pdf", ".jpg", ".jpeg", ".png"}:
            raise HTTPException(status_code=400, detail="Please upload a PDF, JPG, or PNG of the signed document")
        file_bytes = await file.read()
        if len(file_bytes) == 0:
            raise HTTPException(status_code=400, detail="File is empty")
        if len(file_bytes) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large. Maximum size is 15MB")

        upload_dir = Path(UPLOAD_BASE_DIR) / link["tenant_id"] / link["case_id"] / "signed"
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{link['id']}_signed{ext}"
        (upload_dir / safe_name).write_bytes(file_bytes)
        relative_path = f"{link['tenant_id']}/{link['case_id']}/signed/{safe_name}"

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """UPDATE outreach_document_links
               SET status = 'signed', signed_file_path = ?, signed_uploaded_at = ?
               WHERE id = ?""",
            (relative_path, now, link["id"])
        )

        contact = db.execute("SELECT name, email FROM case_contacts WHERE id = ?", (link["contact_id"],)).fetchone()
        contact_name = contact["name"] if contact else "Contact"
        doc = db.execute("SELECT filename FROM documents WHERE id = ?", (link["document_id"],)).fetchone()
        doc_filename = doc["filename"] if doc else "document"
        ip = request.client.host if request.client else None
        ua = request.headers.get("user-agent", "")
        _log_thread_event(db, link["tenant_id"], link["case_id"], link["contact_id"],
                           "signature_completed", actor_type="contact", actor_id=link["contact_id"],
                           actor_name=contact_name, document_link_id=link["id"],
                           metadata={"filename": doc_filename, "method": "wet_sign_upload"},
                           ip_address=ip, user_agent=ua)
        _notify_thread_watchers(db, link["tenant_id"], link["case_id"], link["contact_id"],
                                 "signature_completed", contact_name, detail=doc_filename)

        # Stop any remaining not-yet-sent campaign stages for this contact —
        # they've already complied, so a later "you still haven't responded"
        # follow-up would be both pointless and embarrassing.
        stopped = _stop_remaining_campaign_steps(db, link["tenant_id"], link["case_id"], link["contact_id"])
        if stopped:
            _log_thread_event(db, link["tenant_id"], link["case_id"], link["contact_id"],
                               "sequence_stopped", actor_type="system", actor_name="System",
                               metadata={"reason": "document_signed", "stages_cancelled": stopped})
            _notify_thread_watchers(db, link["tenant_id"], link["case_id"], link["contact_id"],
                                     "sequence_stopped", contact_name, detail=f"{stopped} remaining email(s) cancelled")

        default_sig_row = db.execute(
            "SELECT * FROM email_signatures WHERE tenant_id = ? AND is_default = 1 LIMIT 1", (link["tenant_id"],)
        ).fetchone()
        firm_name = (default_sig_row["company_name"] if default_sig_row else "") or "our office"
        creator = db.execute("SELECT full_name, email FROM users WHERE id = ?", (link["created_by"],)).fetchone()
        case_row = db.execute("SELECT title FROM cases WHERE id = ?", (link["case_id"],)).fetchone()
        case_title = case_row["title"] if case_row else ""
        review_url = f"{FRONTEND_URL}/outreach-document/{link['token']}"

    if contact and contact["email"]:
        send_document_uploaded_thankyou_email(
            to_email=contact["email"], signer_name=contact_name, doc_filename=doc_filename, firm_name=firm_name,
        )
    if creator and creator["email"]:
        send_document_signed_firm_notify_email(
            to_email=creator["email"], staff_name=creator["full_name"] or "there", contact_name=contact_name,
            doc_filename=doc_filename, case_title=case_title, download_url=review_url,
        )
    return {"ok": True}


@router.get("/document-links/{token}/signed-file")
async def download_signed_document(token: str):
    """Public: lets the recipient re-download the signed copy they already
    uploaded, to confirm what was received."""
    with get_db() as db:
        link = _validate_document_link_token(db, token)
        if not link["signed_file_path"]:
            raise HTTPException(status_code=404, detail="No signed copy has been uploaded yet")
        full_path = Path(UPLOAD_BASE_DIR) / link["signed_file_path"]
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found on server")
        return FileResponse(full_path, filename=Path(link["signed_file_path"]).name)


@router.post("/document-links/{token}/comment")
async def comment_on_document_link(token: str, req: DocumentCommentRequest, request: Request):
    """Public: leave a comment (or approve/reject/request_changes) on the
    document. No auth — the token is the credential."""
    valid_actions = {"comment", "approve", "reject", "request_changes"}
    if req.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action. Must be one of: {', '.join(sorted(valid_actions))}")
    if not req.commenter_name or not req.commenter_name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")
    with get_db() as db:
        link = _validate_document_link_token(db, token)
        event_id = _log_thread_event(
            db, link["tenant_id"], link["case_id"], link["contact_id"], "comment_added",
            actor_type="contact", actor_id=link["contact_id"], actor_name=req.commenter_name.strip(),
            document_link_id=link["id"], ip_address=ip, user_agent=ua,
            metadata={"comment": (req.comment or "").strip(), "page_number": req.page_number, "action": req.action},
        )
        doc = db.execute("SELECT filename FROM documents WHERE id = ?", (link["document_id"],)).fetchone()
        _notify_thread_watchers(db, link["tenant_id"], link["case_id"], link["contact_id"], "comment_added",
                                 req.commenter_name.strip(), detail=(req.comment or "")[:80])
        return {"id": event_id, "commenter_name": req.commenter_name.strip(),
                "comment": (req.comment or "").strip(), "page_number": req.page_number, "action": req.action}


# ---------------------------------------------------------------------------
# THREAD — timeline, internal collaborators, notes, evidence export
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/contacts/{contact_id}/thread")
async def get_contact_thread(case_id: str, contact_id: str, current_user: dict = Depends(get_current_user)):
    """The unified, chronological, append-only communication thread for one
    contact: every sent email (with full content), every tracked event
    (opens, clicks, document views/downloads, signatures, comments, notes),
    merged and sorted by time. This is both the timeline UI's data source
    and the raw material for the litigation evidence export."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        contact = db.execute(
            "SELECT * FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (contact_id, case_id, tenant_id)
        ).fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        emails = db.execute(
            """SELECT id, subject, body_html, template_type, from_name, status,
                      sent_at, opened_at, open_count, created_at
               FROM case_emails WHERE contact_id = ? AND tenant_id = ? ORDER BY created_at ASC""",
            (contact_id, tenant_id)
        ).fetchall()

        events = db.execute(
            """SELECT id, event_type, actor_type, actor_id, actor_name, email_id,
                      document_link_id, ip_address, user_agent, metadata, created_at
               FROM outreach_thread_events WHERE contact_id = ? AND tenant_id = ? ORDER BY created_at ASC""",
            (contact_id, tenant_id)
        ).fetchall()

        participants = db.execute(
            """SELECT p.user_id, u.full_name, u.email, p.created_at as added_at
               FROM outreach_thread_participants p JOIN users u ON p.user_id = u.id
               WHERE p.contact_id = ? AND p.tenant_id = ?""",
            (contact_id, tenant_id)
        ).fetchall()

        timeline = []
        for e in emails:
            timeline.append({
                "kind": "email", "id": e["id"], "at": e["created_at"],
                "subject": e["subject"], "body_html": e["body_html"], "template_type": e["template_type"],
                "from_name": e["from_name"], "status": e["status"],
                "opened_at": e["opened_at"], "open_count": e["open_count"],
            })
        for ev in events:
            timeline.append({
                "kind": "event", "id": ev["id"], "at": ev["created_at"],
                "event_type": ev["event_type"], "actor_type": ev["actor_type"],
                "actor_name": ev["actor_name"], "email_id": ev["email_id"],
                "document_link_id": ev["document_link_id"],
                "ip_address": ev["ip_address"], "user_agent": ev["user_agent"],
                "metadata": json.loads(ev["metadata"] or "{}"),
            })
        timeline.sort(key=lambda x: x["at"])

        return {
            "contact": dict(contact),
            "timeline": timeline,
            "participants": [dict(p) for p in participants],
        }


@router.get("/cases/{case_id}/contacts/{contact_id}/participants")
async def list_thread_participants(case_id: str, contact_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            """SELECT p.id, p.user_id, u.full_name, u.email, p.added_by, p.created_at
               FROM outreach_thread_participants p JOIN users u ON p.user_id = u.id
               WHERE p.contact_id = ? AND p.tenant_id = ? ORDER BY p.created_at ASC""",
            (contact_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.post("/cases/{case_id}/contacts/{contact_id}/participants")
async def add_thread_participant(case_id: str, contact_id: str, req: AddParticipantRequest,
                                  current_user: dict = Depends(get_current_user)):
    """Add an internal LitigationSpace user as a watcher/collaborator on this
    contact's thread — never a debtor/external contact. They'll get in-app
    notifications on key events from here on."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    with get_db() as db:
        contact = db.execute(
            "SELECT name FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (contact_id, case_id, tenant_id)
        ).fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        target_user = db.execute(
            "SELECT full_name FROM users WHERE id = ? AND tenant_id = ?",
            (req.user_id, tenant_id)
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found on this team")

        existing = db.execute(
            "SELECT id FROM outreach_thread_participants WHERE contact_id = ? AND user_id = ?",
            (contact_id, req.user_id)
        ).fetchone()
        if existing:
            return {"data": {"id": existing["id"], "already_added": True}}

        p_id = generate_id()
        db.execute(
            """INSERT INTO outreach_thread_participants (id, tenant_id, case_id, contact_id, user_id, added_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (p_id, tenant_id, case_id, contact_id, req.user_id, user_id)
        )
        adder = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        _log_thread_event(db, tenant_id, case_id, contact_id, "participant_added",
                           actor_type="internal_user", actor_id=user_id,
                           actor_name=adder["full_name"] if adder else "",
                           metadata={"added_user_id": req.user_id, "added_user_name": target_user["full_name"]})
        db.execute(
            """INSERT INTO notifications (id, user_id, tenant_id, type, title, message, data)
               VALUES (?, ?, ?, 'outreach_thread_added', 'Added to a communication thread', ?, ?)""",
            (generate_id(), req.user_id, tenant_id, f"You were added to {contact['name']}'s thread",
             json.dumps({"case_id": case_id, "contact_id": contact_id}))
        )
    return {"data": {"id": p_id, "already_added": False}}


@router.delete("/cases/{case_id}/contacts/{contact_id}/participants/{user_id}")
async def remove_thread_participant(case_id: str, contact_id: str, user_id: str,
                                     current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute(
            "DELETE FROM outreach_thread_participants WHERE contact_id = ? AND user_id = ? AND tenant_id = ?",
            (contact_id, user_id, tenant_id)
        )
    return {"message": "Removed"}


@router.post("/cases/{case_id}/contacts/{contact_id}/notes")
async def add_thread_note(case_id: str, contact_id: str, req: AddThreadNoteRequest,
                           current_user: dict = Depends(get_current_user)):
    """Add an internal note to the thread — visible only to internal users,
    permanent, part of the same append-only timeline as everything else."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    if not req.note or not req.note.strip():
        raise HTTPException(status_code=400, detail="Note text is required")
    with get_db() as db:
        contact = db.execute(
            "SELECT name FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (contact_id, case_id, tenant_id)
        ).fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        author_name = user_row["full_name"] if user_row else "Team member"
        event_id = _log_thread_event(db, tenant_id, case_id, contact_id, "note_added",
                                      actor_type="internal_user", actor_id=user_id, actor_name=author_name,
                                      metadata={"note": req.note.strip()})
    return {"data": {"id": event_id, "note": req.note.strip(), "author_name": author_name}}


# ---------------------------------------------------------------------------
# EMAIL HISTORY & TRACKING
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/emails")
async def list_emails(case_id: str, contact_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """List all emails for a case, optionally filtered by contact."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        if contact_id:
            rows = db.execute(
                """SELECT e.*, c.name as contact_name, c.email as contact_email
                   FROM case_emails e JOIN case_contacts c ON e.contact_id = c.id
                   WHERE e.case_id = ? AND e.tenant_id = ? AND e.contact_id = ?
                   ORDER BY e.created_at DESC""",
                (case_id, tenant_id, contact_id)
            ).fetchall()
        else:
            rows = db.execute(
                """SELECT e.*, c.name as contact_name, c.email as contact_email
                   FROM case_emails e JOIN case_contacts c ON e.contact_id = c.id
                   WHERE e.case_id = ? AND e.tenant_id = ?
                   ORDER BY e.created_at DESC""",
                (case_id, tenant_id)
            ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.get("/emails/{email_id}/events")
async def get_email_events(email_id: str, current_user: dict = Depends(get_current_user)):
    """Get tracking events for a specific email."""
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM email_tracking_events WHERE email_id = ? ORDER BY created_at ASC",
            (email_id,)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# TRACKING PIXEL (open tracking - no auth needed)
# ---------------------------------------------------------------------------

@router.get("/track/{tracking_id}/open.png")
async def track_open(tracking_id: str, request: Request):
    """1x1 transparent pixel for email open tracking."""
    now = datetime.now(timezone.utc).isoformat()
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")

    try:
        with get_db() as db:
            email_row = db.execute("SELECT id, contact_id, case_id, tenant_id FROM case_emails WHERE tracking_id = ?", (tracking_id,)).fetchone()
            if email_row:
                email_id = email_row["id"]
                contact_id = email_row["contact_id"]
                case_id = email_row["case_id"]
                tenant_id = email_row["tenant_id"]
                # Log event
                db.execute(
                    """INSERT INTO email_tracking_events (id, email_id, event_type, ip_address, user_agent, created_at)
                       VALUES (?, ?, 'opened', ?, ?, ?)""",
                    (generate_id(), email_id, ip, ua, now)
                )
                # Update email status
                db.execute(
                    """UPDATE case_emails SET status = CASE WHEN status IN ('sent', 'delivered') THEN 'opened' ELSE status END,
                       opened_at = COALESCE(opened_at, ?), open_count = open_count + 1 WHERE tracking_id = ?""",
                    (now, tracking_id)
                )
                # Update contact stats
                db.execute(
                    "UPDATE case_contacts SET total_emails_opened = total_emails_opened + 1, updated_at = ? WHERE id = ?",
                    (now, contact_id)
                )
                contact_row = db.execute("SELECT name FROM case_contacts WHERE id = ?", (contact_id,)).fetchone()
                contact_name = contact_row["name"] if contact_row else "Contact"
                _log_thread_event(db, tenant_id, case_id, contact_id, "email_opened",
                                   actor_type="contact", actor_id=contact_id, actor_name=contact_name,
                                   email_id=email_id, ip_address=ip, user_agent=ua)
                _notify_thread_watchers(db, tenant_id, case_id, contact_id, "email_opened", contact_name)
    except Exception as e:
        logger.warning(f"Tracking pixel error: {e}")

    # Return 1x1 transparent PNG
    pixel = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    return Response(content=pixel, media_type="image/png", headers={"Cache-Control": "no-store, no-cache, must-revalidate"})


# ---------------------------------------------------------------------------
# PIPELINE MANAGEMENT
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/pipeline")
async def get_pipeline(case_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM case_pipeline WHERE case_id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not row:
            # Create default pipeline entry
            pip_id = generate_id()
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """INSERT INTO case_pipeline (id, case_id, tenant_id, stage, created_at, updated_at)
                   VALUES (?, ?, ?, 'onboarding', ?, ?)""",
                (pip_id, case_id, tenant_id, now, now)
            )
            row = db.execute("SELECT * FROM case_pipeline WHERE id = ?", (pip_id,)).fetchone()
    return {"data": dict(row)}


@router.put("/cases/{case_id}/pipeline")
async def update_pipeline(case_id: str, req: PipelineUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()

    valid_stages = {"onboarding", "active_outreach", "responsive", "unresponsive", "litigation", "resolved"}
    if req.stage not in valid_stages:
        raise HTTPException(400, f"Invalid stage. Must be one of: {', '.join(valid_stages)}")

    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM case_pipeline WHERE case_id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()

        if existing:
            updates = {"stage": req.stage, "stage_changed_at": now, "updated_at": now}
            if req.auto_escalation_enabled is not None:
                updates["auto_escalation_enabled"] = 1 if req.auto_escalation_enabled else 0
            if req.escalation_after_days is not None:
                updates["escalation_after_days"] = req.escalation_after_days
            if req.max_attempts is not None:
                updates["max_attempts"] = req.max_attempts
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            vals = list(updates.values()) + [case_id, tenant_id]
            db.execute(f"UPDATE case_pipeline SET {set_clause} WHERE case_id = ? AND tenant_id = ?", vals)
        else:
            pip_id = generate_id()
            db.execute(
                """INSERT INTO case_pipeline (id, case_id, tenant_id, stage, stage_changed_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (pip_id, case_id, tenant_id, req.stage, now, now, now)
            )

        row = db.execute("SELECT * FROM case_pipeline WHERE case_id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
    return {"data": dict(row)}


# ---------------------------------------------------------------------------
# DASHBOARD STATS
# ---------------------------------------------------------------------------

@router.get("/dashboard/stats")
async def outreach_stats(current_user: dict = Depends(get_current_user)):
    """Get outreach pipeline stats across all cases for the tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        stages = db.execute(
            """SELECT stage, COUNT(*) as count FROM case_pipeline
               WHERE tenant_id = ? GROUP BY stage""",
            (tenant_id,)
        ).fetchall()

        total_contacts = db.execute(
            "SELECT COUNT(*) as cnt FROM case_contacts WHERE tenant_id = ?", (tenant_id,)
        ).fetchone()["cnt"]

        total_emails = db.execute(
            "SELECT COUNT(*) as cnt FROM case_emails WHERE tenant_id = ?", (tenant_id,)
        ).fetchone()["cnt"]

        open_rate_row = db.execute(
            """SELECT
                 COUNT(CASE WHEN status = 'opened' OR status = 'replied' THEN 1 END) as opened,
                 COUNT(CASE WHEN status != 'queued' AND status != 'failed' THEN 1 END) as sent
               FROM case_emails WHERE tenant_id = ?""",
            (tenant_id,)
        ).fetchone()

        opened = open_rate_row["opened"] if open_rate_row else 0
        sent = open_rate_row["sent"] if open_rate_row else 0
        open_rate = round((opened / sent * 100), 1) if sent > 0 else 0

    return {
        "data": {
            "pipeline": {dict(s)["stage"]: dict(s)["count"] for s in stages},
            "total_contacts": total_contacts,
            "total_emails_sent": total_emails,
            "open_rate": open_rate,
        }
    }


# ---------------------------------------------------------------------------
# EMAIL TEMPLATE PREVIEWS
# ---------------------------------------------------------------------------

@router.post("/templates/preview")
async def preview_template(req: BulkEmailRequest, current_user: dict = Depends(get_current_user)):
    """Preview a template. Uses the real selected contact's name/amount/address
    (and their case's client_name) when contact_ids includes one — e.g. when
    composing and choosing who the receiver/debtor is — falling back to
    placeholder sample data only when no contact is selected yet, such as
    browsing templates generically from the Templates tab."""
    tenant_id = current_user["tenant_id"]
    sender_name = req.from_name or "Attorney"

    with get_db() as db:
        default_sig_row = db.execute(
            "SELECT * FROM email_signatures WHERE tenant_id = ? AND is_default = 1 LIMIT 1",
            (tenant_id,)
        ).fetchone()
    sig_firm_name, sig_firm_address, sig_firm_phone, sig_logo_url = _signature_firm_identity(default_sig_row)
    firm_name = req.firm_name or sig_firm_name or "Law Office"
    firm_address = req.firm_address or sig_firm_address
    firm_phone = req.firm_phone or sig_firm_phone
    logo_url = sig_logo_url

    real_contact = None
    real_case = None
    if req.contact_ids:
        with get_db() as db:
            real_contact = db.execute(
                "SELECT * FROM case_contacts WHERE id = ? AND tenant_id = ?",
                (req.contact_ids[0], tenant_id)
            ).fetchone()
            if real_contact and real_contact["case_id"]:
                real_case = db.execute(
                    "SELECT title, client_name FROM cases WHERE id = ? AND tenant_id = ?",
                    (real_contact["case_id"], tenant_id)
                ).fetchone()

    if real_contact:
        contact_name = real_contact["name"]
        amount = real_contact["amount_owed"] or 0
        currency = real_contact["currency"] or "USD"
        recipient_address = _format_address_block(
            real_contact["address_line1"] or "", real_contact["address_line2"] or "",
            real_contact["city"] or "", real_contact["state"] or "",
            real_contact["postal_code"] or "", real_contact["country"] or "",
        )
        client_name = ((real_case["client_name"] if real_case else "") or (real_case["title"] if real_case else "")) or "Sample Client LLC"
        recipient_company = real_contact["company"] or ""
    else:
        contact_name = "John Doe"
        amount = 5000.00
        currency = "USD"
        recipient_address = _format_address_block("123 Main Street, Suite 400", "", "New York", "NY", "10001", "")
        client_name = "Sample Client LLC"
        recipient_company = "Sample Company LLC"

    case_title = real_case["title"] if real_case else ""
    amount_str = f"{currency} {amount:,.2f}" if amount else "the outstanding balance"
    custom_row = None
    if req.template_type in _PLAINTEXT_TEMPLATE_TYPES:
        with get_db() as db:
            custom_row = _get_custom_template(db, tenant_id, req.template_type)

    if req.template_type in ("document_execution_request", "peo_authorization"):
        # Real, tokenized links only when a real contact is selected — a
        # generic preview (no contact chosen yet) shows a non-functional
        # sample button instead of minting real signature requests.
        document_links = []
        document_names = []
        if real_contact and req.document_ids:
            with get_db() as db:
                for doc_id in req.document_ids:
                    doc_row = db.execute(
                        "SELECT * FROM documents WHERE id = ? AND tenant_id = ?", (doc_id, tenant_id)
                    ).fetchone()
                    if not doc_row:
                        continue
                    link = _create_outreach_document_link(
                        db, tenant_id, real_contact["case_id"], real_contact["id"], doc_id,
                        contact_name, real_contact["email"] or "", created_by=current_user["sub"],
                        message=f"{sender_name} has requested your signature on this document.",
                        mode="wet_sign", allow_download=True, signature_pages=[1],
                    )
                    document_links.append({"filename": doc_row["filename"], "review_url": link["review_url"]})
                    document_names.append(doc_row["filename"])
        else:
            document_links = [{"filename": "Sample Document.pdf", "review_url": "#"}]
            document_names = ["Sample Document.pdf"]
        tokens = _build_plaintext_tokens(
            firm_name=firm_name, sender_name=sender_name, client_name=client_name,
            case_title=case_title, response_deadline_days=req.response_deadline_days,
            firm_phone=firm_phone, document_name=", ".join(document_names) or "Required Document",
            recipient_company=recipient_company, amount_str=amount_str,
        )
        if custom_row and custom_row["custom_html"]:
            sig_extra = dict(default_sig_row) if default_sig_row else {}
            adv_tokens = _build_advanced_html_tokens(
                tokens, contact_name=contact_name, recipient_address=recipient_address,
                sender_title=sig_extra.get("sender_title", ""), sender_email=sig_extra.get("sender_email", ""),
                firm_website=sig_extra.get("website_url", ""), logo_url=logo_url, firm_address=firm_address,
                        signature_sender_name=sig_extra.get("sender_name", ""),
            )
            subject = _substitute_tokens(custom_row["custom_subject"] or "", adv_tokens)
            html = _render_custom_html_template(custom_row["custom_html"], adv_tokens, document_links)
            return {"subject": subject, "html": html}
        subject, html = _render_plaintext_template(
            req.template_type, tokens, contact_name, sender_name, firm_name,
            client_name=client_name, recipient_address=recipient_address, case_title=case_title,
            logo_url=logo_url, document_links=document_links,
            custom_subject=(custom_row["custom_subject"] if custom_row else None),
            custom_body=(custom_row["custom_body"] if custom_row else None),
            tenant_id=tenant_id,
        )
    elif req.template_type in _PLAINTEXT_TEMPLATE_TYPES:
        tokens = _build_plaintext_tokens(
            firm_name=firm_name, sender_name=sender_name, client_name=client_name,
            case_title=case_title, response_deadline_days=req.response_deadline_days,
            firm_phone=firm_phone, amount_str=amount_str, recipient_company=recipient_company,
        )
        subject, html = _render_plaintext_template(
            req.template_type, tokens, contact_name, sender_name, firm_name,
            client_name=client_name, recipient_address=recipient_address, case_title=case_title,
            logo_url=logo_url,
            custom_subject=(custom_row["custom_subject"] if custom_row else None),
            custom_body=(custom_row["custom_body"] if custom_row else None),
            tenant_id=tenant_id,
        )
    elif req.template_type == "general_letter":
        subject, html = _template_general_letter(
            contact_name, req.custom_subject or "", req.custom_body or "", firm_name, sender_name,
            case_title=case_title, case_number="",
            recipient_address=recipient_address, client_name=client_name, logo_url=logo_url,
        )
    else:
        subject = req.custom_subject or "Custom Email"
        html = req.custom_body or "<p>Custom email content</p>"

    if req.template_type in ("initial_demand", "follow_up", "follow_up_2", "final_notice", "notice_of_intent",
                              "general_letter", "settlement_offer", "outstanding_amount", "document_execution_request",
                              "peo_authorization"):
        # Signature, then footer last — footer's own markup is what closes
        # the wrapper div _build_email_header left open, so it must come
        # after the signature, not before it.
        if default_sig_row:
            sig_d = dict(default_sig_row)
            html += sig_d.get("custom_html") or _build_signature_html(sig_d)
        html += _build_email_footer(firm_name, firm_address, firm_phone)

    return {"subject": subject, "html": html}


@router.post("/template-download")
async def download_template(req: dict, current_user: dict = Depends(get_current_user)):
    """Download a rendered email template (HTML) as a Word or PDF document,
    preserving its original design, colors, and fonts.

    Uses LibreOffice headless conversion, which handles complex pasted
    email-signature HTML (nested tables, currentcolor, etc.) far more
    robustly than xhtml2pdf/htmldocx.
    """
    import re as _re
    import subprocess
    import tempfile
    import uuid
    from bs4 import BeautifulSoup

    html = req.get("html", "")
    title = req.get("title", "Email Template")
    fmt = req.get("format", "pdf")
    safe_title = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip().replace(" ", "_")[:60] or "template"

    # LibreOffice's HTML->Writer conversion draws a separate border around
    # each wrapped text line of a bordered <div> instead of one box around
    # the whole block. Wrapping such divs in a single-cell table fixes this.
    border_re = _re.compile(r"\bborder\s*:", _re.I)
    soup = BeautifulSoup(html, "html.parser")
    for div in soup.find_all("div"):
        style = div.get("style", "")
        if border_re.search(style):
            table = soup.new_tag("table")
            table["style"] = "width:100%; border-collapse:collapse;"
            tr = soup.new_tag("tr")
            td = soup.new_tag("td")
            td["style"] = style
            for child in list(div.children):
                td.append(child.extract())
            tr.append(td)
            table.append(tr)
            div.replace_with(table)
    html = str(soup)

    full_html = f"<html><head><meta charset='utf-8'><title>{title}</title></head><body>{html}</body></html>"

    with tempfile.TemporaryDirectory() as tmpdir:
        in_path = os.path.join(tmpdir, "input.html")
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(full_html)

        profile_dir = os.path.join(tmpdir, f"loprofile-{uuid.uuid4().hex}")
        cmd = [
            "libreoffice", "--headless",
            f"-env:UserInstallation=file://{profile_dir}",
        ]
        if fmt == "pdf":
            cmd += ["--convert-to", "pdf", "--outdir", tmpdir, in_path]
            out_path = os.path.join(tmpdir, "input.pdf")
            media_type = "application/pdf"
        else:
            cmd += ["--infilter=HTML (StarWriter)", "--convert-to", "docx", "--outdir", tmpdir, in_path]
            out_path = os.path.join(tmpdir, "input.docx")
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HTTPException(status_code=500, detail=f"Document conversion failed: {e}")

        if not os.path.exists(out_path):
            raise HTTPException(status_code=500, detail="Document conversion failed: no output produced")

        with open(out_path, "rb") as f:
            content = f.read()

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.{fmt}"'},
    )


# ---------------------------------------------------------------------------
# EXPORT COMMUNICATION LOG (proof of good faith)
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/export-log")
async def export_communication_log(case_id: str, contact_id: Optional[str] = None,
                                    current_user: dict = Depends(get_current_user)):
    """Export full communication log for a case (or specific contact) as structured data."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        if contact_id:
            contacts = db.execute(
                "SELECT * FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
                (contact_id, case_id, tenant_id)
            ).fetchall()
        else:
            contacts = db.execute(
                "SELECT * FROM case_contacts WHERE case_id = ? AND tenant_id = ?",
                (case_id, tenant_id)
            ).fetchall()

        log = []
        for contact in contacts:
            emails = db.execute(
                """SELECT e.*, GROUP_CONCAT(et.event_type || ':' || et.created_at, '; ') as events
                   FROM case_emails e
                   LEFT JOIN email_tracking_events et ON e.id = et.email_id
                   WHERE e.contact_id = ? AND e.case_id = ?
                   GROUP BY e.id
                   ORDER BY e.created_at ASC""",
                (contact["id"], case_id)
            ).fetchall()

            log.append({
                "contact": dict(contact),
                "emails": [dict(e) for e in emails],
                "total_attempts": len(emails),
                "last_status": dict(emails[-1])["status"] if emails else "none",
            })

    return {
        "case": {"id": case_row["id"], "title": case_row["title"], "case_number": case_row["case_number"]},
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "contacts": log,
        "total_contacts": len(log),
        "total_emails": sum(len(c["emails"]) for c in log),
    }


# ---------------------------------------------------------------------------
# SAVED ADDRESSES (reusable across cases)
# ---------------------------------------------------------------------------

class SavedAddressCreate(BaseModel):
    label: str  # e.g. "ABC Corp HQ", "John Smith Home"
    address_line1: str
    address_line2: Optional[str] = None
    address_line3: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None


@router.get("/saved-addresses")
async def list_saved_addresses(current_user: dict = Depends(get_current_user)):
    """List all saved addresses for the tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM saved_addresses WHERE tenant_id = ? ORDER BY label ASC",
            (tenant_id,)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.post("/saved-addresses")
async def create_saved_address(req: SavedAddressCreate, current_user: dict = Depends(get_current_user)):
    """Save an address for reuse across contacts."""
    tenant_id = current_user["tenant_id"]
    addr_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            """INSERT INTO saved_addresses (id, tenant_id, label, address_line1, address_line2,
               address_line3, city, state, postal_code, country, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (addr_id, tenant_id, req.label, req.address_line1, req.address_line2,
             req.address_line3, req.city, req.state, req.postal_code, req.country, now)
        )
    return {"data": {"id": addr_id, "label": req.label}}


@router.delete("/saved-addresses/{address_id}")
async def delete_saved_address(address_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a saved address."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute("DELETE FROM saved_addresses WHERE id = ? AND tenant_id = ?", (address_id, tenant_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# TEMPLATE CUSTOMIZATION — Colors, logo, manual/AI editing
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# EMAIL SIGNATURES — Auto-designed, reusable across cases
# ---------------------------------------------------------------------------

class EmailSignatureCreate(BaseModel):
    name: str = "My Signature"
    sender_name: str
    sender_title: Optional[str] = None
    sender_email: Optional[str] = None
    sender_phone: Optional[str] = None
    company_name: Optional[str] = None
    logo_url: Optional[str] = None
    website_url: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    accent_color: str = "#C8992A"
    layout: str = "horizontal"  # horizontal, vertical, minimal
    include_social: bool = False
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    is_default: bool = False
    custom_html: Optional[str] = None  # If user wants fully custom HTML


def _build_signature_html(sig: dict) -> str:
    """Auto-generate a polished HTML email signature from fields. Stays
    email-client-safe (tables + inline styles, no flex/grid/box-shadow) since
    Outlook desktop renders with Word's engine, not a browser engine."""
    accent = sig.get("accent_color", "#C8992A")
    layout = sig.get("layout", "horizontal")
    name = sig.get("sender_name", "")
    title = sig.get("sender_title", "")
    email = sig.get("sender_email", "")
    phone = sig.get("sender_phone", "")
    company = sig.get("company_name", "")
    logo = sig.get("logo_url", "")
    website = sig.get("website_url", "")
    addr1 = sig.get("address_line1", "")
    addr2 = sig.get("address_line2", "")
    city = sig.get("city", "")
    state = sig.get("state", "")
    postal = sig.get("postal_code", "")
    country = sig.get("country", "")
    linkedin = sig.get("linkedin_url", "")
    twitter = sig.get("twitter_url", "")
    custom_line = sig.get("custom_line", "")

    FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

    address_html = _format_address_block(addr1, addr2, city, state, postal, country)

    logo_html = ""
    if logo:
        logo_html = (
            f'<img src="{logo}" alt="{company or name}" '
            f'style="max-height:64px;max-width:180px;border-radius:6px;display:block;" />'
        )

    def pill(label: str, href: str) -> str:
        return (
            f'<a href="{href}" style="display:inline-block;text-decoration:none;'
            f'color:{accent};font-size:11px;font-weight:600;letter-spacing:0.02em;'
            f'border:1px solid {accent}55;border-radius:20px;padding:3px 11px;margin:0 6px 0 0;">{label}</a>'
        )

    social_html = ""
    if linkedin or twitter:
        pills = (pill("LinkedIn", linkedin) if linkedin else "") + (pill("Twitter", twitter) if twitter else "")
        social_html = f'<div style="margin-top:10px;">{pills}</div>'

    def contact_row(icon: str, text: str, href: str = "") -> str:
        body = f'<a href="{href}" style="color:#374151;text-decoration:none;">{text}</a>' if href else f'<span style="color:#374151;">{text}</span>'
        return (
            f'<tr><td style="padding:2px 0;font-size:12.5px;">'
            f'<span style="display:inline-block;width:18px;color:{accent};">{icon}</span>{body}</td></tr>'
        )

    contact_rows = ""
    if phone:
        contact_rows += contact_row("&#9742;", phone)
    if email:
        contact_rows += contact_row("&#9993;", email, f"mailto:{email}")
    if website:
        contact_rows += contact_row("&#127760;", website.replace("https://", "").replace("http://", ""), website)
    contact_table = f'<table cellpadding="0" cellspacing="0" border="0">{contact_rows}</table>' if contact_rows else ""

    title_badge = (
        f'<span style="display:inline-block;color:{accent};font-size:12.5px;font-weight:700;'
        f'letter-spacing:0.01em;margin-top:2px;">{title}</span>'
        if title else ''
    )
    company_line = f'<div style="color:#4b5563;font-size:12.5px;margin-top:1px;">{company}</div>' if company else ''
    custom_html = f'<div style="color:#9ca3af;font-size:11px;margin-top:8px;font-style:italic;">{custom_line}</div>' if custom_line else ''
    address_block = f'<div style="color:#9ca3af;font-size:11px;line-height:1.5;margin-top:8px;">&#128205; {address_html}</div>' if address_html else ''

    if layout == "minimal":
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:{FONT};margin-top:18px;max-width:520px;">
          <tr><td style="border-top:2px solid {accent};padding-top:12px;">
            <strong style="color:#111827;font-size:14.5px;">{name}</strong>
            {f'<span style="color:{accent};font-size:12.5px;font-weight:600;"> &middot; {title}</span>' if title else ''}
            {f'<span style="color:#6b7280;font-size:12.5px;"> &middot; {company}</span>' if company else ''}
            <div style="margin-top:5px;color:#4b5563;font-size:12.5px;">
              {' &nbsp;|&nbsp; '.join(x for x in [f'<a href="mailto:{email}" style="color:#4b5563;text-decoration:none;">{email}</a>' if email else '', phone, f'<a href="{website}" style="color:{accent};text-decoration:none;">{website}</a>' if website else ''] if x)}
            </div>
          </td></tr>
        </table>"""

    elif layout == "vertical":
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:{FONT};margin-top:18px;max-width:340px;background:{accent}0d;border-radius:10px;">
          <tr><td style="padding:18px 20px;border-top:3px solid {accent};border-radius:10px 10px 0 0;">
            {f'<div style="margin-bottom:12px;">{logo_html}</div>' if logo_html else ''}
            <div style="color:#111827;font-size:16px;font-weight:700;">{name}</div>
            {title_badge}
            {company_line}
            <div style="height:1px;background:{accent}33;margin:12px 0;"></div>
            {contact_table}
            {address_block}
            {custom_html}
            {social_html}
          </td></tr>
        </table>"""

    else:  # horizontal (default) — logo/name left, accent divider, details right
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:{FONT};margin-top:18px;max-width:520px;">
          <tr>
            <td style="vertical-align:top;padding-right:18px;">
              {logo_html}
              {'' if logo_html else f'<div style="width:4px;height:56px;background:{accent};border-radius:2px;"></div>'}
            </td>
            <td style="vertical-align:top;padding-left:18px;border-left:1px solid #e5e7eb;">
              <div style="color:#111827;font-size:16px;font-weight:700;">{name}</div>
              {title_badge}
              {company_line}
              <div style="margin-top:10px;">{contact_table}</div>
              {address_block}
              {custom_html}
              {social_html}
            </td>
          </tr>
        </table>"""


@router.post("/email-signatures/upload-logo")
async def upload_signature_logo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload a logo image for use in an email signature — returns a public
    URL. Must be publicly fetchable (no auth) since it's the recipient's own
    email client, not our frontend, that loads the image when the signed
    email is opened."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_LOGO_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported image type — use one of: {', '.join(sorted(ALLOWED_LOGO_EXT))}")
    contents = await file.read()
    if len(contents) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="Logo image too large — max 3MB")
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    logo_dir = Path(UPLOAD_BASE_DIR) / LOGO_SUBDIR
    logo_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{current_user['tenant_id']}-{generate_id()}{ext}"
    with open(logo_dir / filename, "wb") as f:
        f.write(contents)

    return {"data": {"logo_url": f"{BASE_URL}/api/outreach/logos/{filename}"}}


@router.get("/logos/{filename}")
async def get_signature_logo(filename: str):
    """Public: serve an uploaded signature logo. No auth required — email
    clients fetch this anonymously when rendering a sent signature."""
    safe_name = os.path.basename(filename)  # prevent path traversal
    full_path = Path(UPLOAD_BASE_DIR) / LOGO_SUBDIR / safe_name
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(full_path)


@router.get("/email-signatures")
async def list_email_signatures(current_user: dict = Depends(get_current_user)):
    """List all email signatures for this tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM email_signatures WHERE tenant_id = ? ORDER BY is_default DESC, created_at DESC",
            (tenant_id,)
        ).fetchall()
        sigs = []
        for r in rows:
            d = dict(r)
            # Auto-generate HTML preview if no custom_html
            if not d.get("custom_html"):
                d["generated_html"] = _build_signature_html(d)
            else:
                d["generated_html"] = d["custom_html"]
            sigs.append(d)
        return {"data": sigs}


@router.post("/email-signatures")
async def create_email_signature(body: EmailSignatureCreate, current_user: dict = Depends(get_current_user)):
    """Create a new email signature. Auto-generates professional HTML."""
    tenant_id = current_user["tenant_id"]
    user_email = current_user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()
    sig_id = generate_id()

    with get_db() as db:
        # If is_default, unset other defaults
        if body.is_default:
            db.execute("UPDATE email_signatures SET is_default = 0 WHERE tenant_id = ?", (tenant_id,))

        db.execute("""
            INSERT INTO email_signatures
                (id, tenant_id, name, is_default, sender_name, sender_title, sender_email,
                 sender_phone, company_name, logo_url, website_url, address_line1, address_line2,
                 city, state, postal_code, country, accent_color, layout,
                 include_social, linkedin_url, twitter_url, custom_html, created_at, updated_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (sig_id, tenant_id, body.name, 1 if body.is_default else 0,
              body.sender_name, body.sender_title, body.sender_email, body.sender_phone,
              body.company_name, body.logo_url, body.website_url,
              body.address_line1, body.address_line2, body.city, body.state,
              body.postal_code, body.country, body.accent_color, body.layout,
              1 if body.include_social else 0, body.linkedin_url, body.twitter_url,
              body.custom_html, now, now, user_email))
        db.commit()

    # Return the created signature with generated HTML
    sig_dict = body.dict()
    sig_dict["id"] = sig_id
    sig_dict["generated_html"] = body.custom_html if body.custom_html else _build_signature_html(sig_dict)
    return {"ok": True, "data": sig_dict}


@router.get("/email-signatures/{sig_id}")
async def get_email_signature(sig_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single email signature with generated HTML."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM email_signatures WHERE id = ? AND tenant_id = ?",
            (sig_id, tenant_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Signature not found")
        d = dict(row)
        if not d.get("custom_html"):
            d["generated_html"] = _build_signature_html(d)
        else:
            d["generated_html"] = d["custom_html"]
        return {"data": d}


@router.put("/email-signatures/{sig_id}")
async def update_email_signature(sig_id: str, body: EmailSignatureCreate, current_user: dict = Depends(get_current_user)):
    """Update an email signature."""
    tenant_id = current_user["tenant_id"]
    user_email = current_user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM email_signatures WHERE id = ? AND tenant_id = ?",
            (sig_id, tenant_id)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Signature not found")
        if body.is_default:
            db.execute("UPDATE email_signatures SET is_default = 0 WHERE tenant_id = ?", (tenant_id,))
        db.execute("""
            UPDATE email_signatures SET
                name=?, is_default=?, sender_name=?, sender_title=?, sender_email=?,
                sender_phone=?, company_name=?, logo_url=?, website_url=?,
                address_line1=?, address_line2=?, city=?, state=?, postal_code=?, country=?,
                accent_color=?, layout=?, include_social=?, linkedin_url=?, twitter_url=?,
                custom_html=?, updated_at=?
            WHERE id=? AND tenant_id=?
        """, (body.name, 1 if body.is_default else 0, body.sender_name, body.sender_title,
              body.sender_email, body.sender_phone, body.company_name, body.logo_url,
              body.website_url, body.address_line1, body.address_line2, body.city,
              body.state, body.postal_code, body.country, body.accent_color, body.layout,
              1 if body.include_social else 0, body.linkedin_url, body.twitter_url,
              body.custom_html, now, sig_id, tenant_id))
        db.commit()
    sig_dict = body.dict()
    sig_dict["id"] = sig_id
    sig_dict["generated_html"] = body.custom_html if body.custom_html else _build_signature_html(sig_dict)
    return {"ok": True, "data": sig_dict}


@router.delete("/email-signatures/{sig_id}")
async def delete_email_signature(sig_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an email signature."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute("DELETE FROM email_signatures WHERE id = ? AND tenant_id = ?", (sig_id, tenant_id))
        db.commit()
    return {"ok": True}


@router.post("/email-signatures/{sig_id}/set-default")
async def set_default_signature(sig_id: str, current_user: dict = Depends(get_current_user)):
    """Set a signature as the default for this tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute("UPDATE email_signatures SET is_default = 0 WHERE tenant_id = ?", (tenant_id,))
        db.execute("UPDATE email_signatures SET is_default = 1 WHERE id = ? AND tenant_id = ?", (sig_id, tenant_id))
        db.commit()
    return {"ok": True}


@router.post("/email-signatures/from-contact/{contact_id}")
async def create_signature_from_contact(contact_id: str, case_id: str, current_user: dict = Depends(get_current_user)):
    """Auto-create an email signature from an existing party/contact's details."""
    tenant_id = current_user["tenant_id"]
    user_email = current_user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        contact = db.execute(
            "SELECT * FROM case_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (contact_id, case_id, tenant_id)
        ).fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        c = dict(contact)
        sig_id = generate_id()
        sig_name = f"Signature - {c.get('name', 'Unknown')}"
        db.execute("""
            INSERT INTO email_signatures
                (id, tenant_id, name, is_default, sender_name, sender_title, sender_email,
                 sender_phone, company_name, logo_url, website_url, address_line1, address_line2,
                 city, state, postal_code, country, accent_color, layout,
                 include_social, linkedin_url, twitter_url, custom_html, created_at, updated_at, created_by)
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, '#C8992A', 'horizontal', 0, NULL, NULL, NULL, ?, ?, ?)
        """, (sig_id, tenant_id, sig_name, c.get("name", ""),
              c.get("contact_title", ""), c.get("email", ""), c.get("phone", ""),
              c.get("company", ""), c.get("address_line1", ""), c.get("address_line2", ""),
              c.get("city", ""), c.get("state", ""), c.get("postal_code", ""),
              c.get("country", ""), now, now, user_email))
        db.commit()

    sig_dict = {
        "id": sig_id, "name": sig_name, "sender_name": c.get("name", ""),
        "sender_title": c.get("contact_title", ""), "sender_email": c.get("email", ""),
        "sender_phone": c.get("phone", ""), "company_name": c.get("company", ""),
        "address_line1": c.get("address_line1", ""), "address_line2": c.get("address_line2", ""),
        "city": c.get("city", ""), "state": c.get("state", ""),
        "postal_code": c.get("postal_code", ""), "country": c.get("country", ""),
        "accent_color": "#C8992A", "layout": "horizontal"
    }
    sig_dict["generated_html"] = _build_signature_html(sig_dict)
    return {"ok": True, "data": sig_dict}


@router.get("/email-signatures/preview-html")
async def preview_signature_html(
    sender_name: str, sender_title: str = "", sender_email: str = "",
    sender_phone: str = "", company_name: str = "", logo_url: str = "",
    accent_color: str = "#C8992A", layout: str = "horizontal",
    address_line1: str = "", city: str = "", state: str = "",
    postal_code: str = "", country: str = "",
    current_user: dict = Depends(get_current_user)
):
    """Preview auto-generated signature HTML without saving."""
    sig = {
        "sender_name": sender_name, "sender_title": sender_title,
        "sender_email": sender_email, "sender_phone": sender_phone,
        "company_name": company_name, "logo_url": logo_url,
        "accent_color": accent_color, "layout": layout,
        "address_line1": address_line1, "city": city, "state": state,
        "postal_code": postal_code, "country": country
    }
    return {"html": _build_signature_html(sig)}


class TemplateSettingsSave(BaseModel):
    header_color: str = "#1e3a5f"
    accent_color: str = "#C8992A"
    text_color: str = "#1f2937"
    bg_color: str = "#ffffff"
    footer_bg: str = "#f9fafb"
    logo_url: Optional[str] = None
    firm_name: str = "Law Office"
    firm_address: Optional[str] = None
    firm_phone: Optional[str] = None
    email_signature: Optional[str] = None
    custom_css: Optional[str] = None

class TemplateCustomText(BaseModel):
    template_type: str
    custom_subject: str
    custom_body: str
    # Optional escape hatch for a fully bespoke, designer-authored letter —
    # when set, this raw (already inline-styled) HTML is used verbatim with
    # [Token] substitution, bypassing the plain-text renderer and the
    # auto-appended signature/footer entirely (the HTML is self-contained).
    custom_html: Optional[str] = None

class AITemplateEditRequest(BaseModel):
    template_type: str
    current_body: str
    instructions: str


@router.get("/template-settings")
async def get_template_settings(current_user: dict = Depends(get_current_user)):
    """Get saved template customization settings for this tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM email_template_settings WHERE tenant_id = ?",
            (tenant_id,)
        ).fetchone()
        if not row:
            return {"data": None}
        return {"data": dict(row)}


@router.post("/template-settings")
async def save_template_settings(body: TemplateSettingsSave, current_user: dict = Depends(get_current_user)):
    """Save or update template customization settings."""
    tenant_id = current_user["tenant_id"]
    user_email = current_user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM email_template_settings WHERE tenant_id = ?", (tenant_id,)
        ).fetchone()
        if existing:
            db.execute("""
                UPDATE email_template_settings SET
                    header_color=?, accent_color=?, text_color=?, bg_color=?, footer_bg=?,
                    logo_url=?, firm_name=?, firm_address=?, firm_phone=?,
                    email_signature=?, custom_css=?, updated_at=?, updated_by=?
                WHERE tenant_id=?
            """, (body.header_color, body.accent_color, body.text_color, body.bg_color,
                  body.footer_bg, body.logo_url, body.firm_name, body.firm_address,
                  body.firm_phone, body.email_signature, body.custom_css, now, user_email,
                  tenant_id))
        else:
            db.execute("""
                INSERT INTO email_template_settings
                    (id, tenant_id, header_color, accent_color, text_color, bg_color, footer_bg,
                     logo_url, firm_name, firm_address, firm_phone, email_signature, custom_css,
                     created_at, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (generate_id(), tenant_id, body.header_color, body.accent_color,
                  body.text_color, body.bg_color, body.footer_bg, body.logo_url,
                  body.firm_name, body.firm_address, body.firm_phone,
                  body.email_signature, body.custom_css, now, now, user_email))
        db.commit()
    return {"ok": True, "message": "Template settings saved"}


@router.get("/template-custom/{template_type}/default")
async def get_default_template(template_type: str, current_user: dict = Depends(get_current_user)):
    """Default plain-text subject/body for a template type, plus the
    [Bracket Token]s it uses — pre-fills the Edit modal when the tenant
    hasn't customized this template yet."""
    tpl = DEFAULT_PLAINTEXT_TEMPLATES.get(template_type)
    if not tpl:
        raise HTTPException(status_code=404, detail="Unknown template type")
    return {"subject": tpl["subject"], "body": tpl["body"], "tokens": _template_tokens_used(template_type)}


@router.get("/template-custom/{template_type}")
async def get_custom_template(template_type: str, current_user: dict = Depends(get_current_user)):
    """Get the saved plain-text override for a specific template type."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM email_template_custom WHERE tenant_id = ? AND template_type = ?",
            (tenant_id, template_type)
        ).fetchone()
        if not row:
            return {"data": None}
        return {"data": dict(row)}


@router.post("/template-custom")
async def save_custom_template(body: TemplateCustomText, current_user: dict = Depends(get_current_user)):
    """Save a plain-text subject/body override for a template. Stored as
    text with [Bracket Token]s intact — substituted with real per-recipient
    values at send time, never a pre-rendered snapshot — so the edit applies
    correctly everywhere (Compose, Bulk Send, Campaigns), not just Preview."""
    tenant_id = current_user["tenant_id"]
    user_email = current_user.get("email", "unknown")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM email_template_custom WHERE tenant_id = ? AND template_type = ?",
            (tenant_id, body.template_type)
        ).fetchone()
        if existing:
            db.execute("""
                UPDATE email_template_custom SET custom_subject=?, custom_body=?, custom_html=?, updated_at=?, updated_by=?
                WHERE tenant_id=? AND template_type=?
            """, (body.custom_subject, body.custom_body, body.custom_html, now, user_email, tenant_id, body.template_type))
        else:
            db.execute("""
                INSERT INTO email_template_custom
                    (id, tenant_id, template_type, custom_subject, custom_body, custom_html, created_at, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (generate_id(), tenant_id, body.template_type, body.custom_subject, body.custom_body, body.custom_html,
                  now, now, user_email))
        db.commit()
    return {"ok": True}


@router.delete("/template-custom/{template_type}")
async def delete_custom_template(template_type: str, current_user: dict = Depends(get_current_user)):
    """Delete the plain-text override, reverting to the default wording."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute(
            "DELETE FROM email_template_custom WHERE tenant_id = ? AND template_type = ?",
            (tenant_id, template_type)
        )
        db.commit()
    return {"ok": True}


_AI_TEMPLATE_EDIT_SYSTEM_PROMPT = """You are an expert legal correspondence editor. You will be given the plain-text body of a demand/notice letter and instructions to modify it.

Rules:
- Return ONLY the modified plain-text body — no explanations, no markdown, no HTML.
- Paragraphs are separated by a blank line.
- Preserve every [Bracket Token] exactly as written (e.g. [Amount Owed], [Recipient Name], [Response Deadline Days], [Document Links]) — these are placeholders filled in automatically per recipient and must not be renamed, translated, or removed unless the user explicitly asks to remove that information.
- Keep the tone professional and legally appropriate."""


@router.post("/template-ai-edit")
async def ai_edit_template(body: AITemplateEditRequest, current_user: dict = Depends(get_current_user)):
    """Use AI (Claude, via the shared ai_client) to edit a template's
    plain-text body based on user instructions."""
    try:
        new_body = await call_claude(
            _AI_TEMPLATE_EDIT_SYSTEM_PROMPT,
            f"CURRENT BODY:\n{body.current_body}\n\nUSER INSTRUCTIONS:\n{body.instructions}\n\nReturn the modified plain-text body only:",
            max_tokens=2048,
        )
        if new_body.startswith("```"):
            lines = new_body.split("\n")
            new_body = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
        return {"body": new_body}
    except Exception as e:
        logger.error(f"AI template edit failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI editing failed: {str(e)}")


# ---------------------------------------------------------------------------
# PROCEEDING TYPES — tenant-owned matter/proceeding-type definitions
# (Milestone 1: replaces the old hardcoded 3-value campaign_type enum)
# ---------------------------------------------------------------------------

_DEFAULT_PROCEEDING_TYPE_PRESETS = [
    ("demand_letter", "Demand Letter"),
    ("collection_notice", "Collection Notice"),
    ("request_for_documents", "Request for Documents"),
    ("notice_of_default", "Notice of Default"),
    ("notice_of_intent_to_sue", "Notice of Intent to Sue"),
    ("notice_of_intent_to_arbitrate", "Notice of Intent to Arbitrate"),
    ("settlement_proposal", "Settlement Proposal"),
    ("pre_litigation_notice", "Pre-Litigation Notice"),
]


def _slugify_proceeding_key(label: str) -> str:
    import re
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or generate_id()[:8]


def _ensure_default_proceeding_types(db, tenant_id: str):
    """Lazily seed the 8 preset proceeding types the first time a tenant
    touches this feature. Seeded per-tenant — not one shared global row —
    so every tenant's copy is independently editable/deletable without
    affecting any other tenant's presets.

    Guarded on preset rows specifically (not "any row exists") — a tenant
    like ERTC Funding, migrated in with 2 custom types already present
    before ever hitting this endpoint, must still get the 8 presets rather
    than being silently skipped forever because a row already existed."""
    existing = db.execute(
        "SELECT COUNT(*) as n FROM outreach_proceeding_types WHERE tenant_id = ? AND is_preset = 1",
        (tenant_id,)
    ).fetchone()["n"]
    if existing > 0:
        return
    for i, (key, label) in enumerate(_DEFAULT_PROCEEDING_TYPE_PRESETS):
        db.execute(
            "INSERT INTO outreach_proceeding_types (id, tenant_id, key, label, is_preset, is_active, sort_order) "
            "VALUES (?, ?, ?, ?, 1, 1, ?)",
            (generate_id(), tenant_id, key, label, i)
        )
    db.commit()


class ProceedingTypeCreate(BaseModel):
    label: str
    key: Optional[str] = None
    description: Optional[str] = ""


class ProceedingTypeUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


@router.get("/proceeding-types")
async def list_proceeding_types(current_user: dict = Depends(get_current_user)):
    """List this tenant's proceeding types — the picker used when creating a
    campaign. Seeds the 8 presets on first use for this tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        _ensure_default_proceeding_types(db, tenant_id)
        rows = db.execute(
            "SELECT * FROM outreach_proceeding_types WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, label",
            (tenant_id,)
        ).fetchall()
        return {"data": [dict(r) for r in rows]}


@router.post("/proceeding-types")
async def create_proceeding_type(req: ProceedingTypeCreate, current_user: dict = Depends(get_current_user)):
    """Add a tenant-defined custom proceeding type — the spec's "(i) a
    custom proceeding or outreach type entered by the tenant." Used exactly
    the same as a preset; there is no code path that treats presets
    differently from custom types after creation."""
    tenant_id = current_user["tenant_id"]
    label = req.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")
    key = _slugify_proceeding_key(req.key or label)
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM outreach_proceeding_types WHERE tenant_id = ? AND key = ?",
            (tenant_id, key)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"A proceeding type with key '{key}' already exists")
        max_sort = db.execute(
            "SELECT COALESCE(MAX(sort_order), -1) as m FROM outreach_proceeding_types WHERE tenant_id = ?",
            (tenant_id,)
        ).fetchone()["m"]
        new_id = generate_id()
        db.execute(
            "INSERT INTO outreach_proceeding_types "
            "(id, tenant_id, key, label, description, is_preset, is_active, sort_order, created_by) "
            "VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)",
            (new_id, tenant_id, key, label, req.description or "", max_sort + 1, current_user["sub"])
        )
        db.commit()
        row = db.execute("SELECT * FROM outreach_proceeding_types WHERE id = ?", (new_id,)).fetchone()
        return dict(row)


@router.patch("/proceeding-types/{type_id}")
async def update_proceeding_type(type_id: str, req: ProceedingTypeUpdate, current_user: dict = Depends(get_current_user)):
    """Edit a proceeding type — including a preset. There's no lock on
    presets; a tenant can rename/retire "Demand Letter" just as freely as
    their own custom type."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM outreach_proceeding_types WHERE id = ? AND tenant_id = ?",
            (type_id, tenant_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Proceeding type not found")
        updates = {}
        if req.label is not None:
            stripped = req.label.strip()
            if not stripped:
                raise HTTPException(status_code=400, detail="label cannot be blank")
            updates["label"] = stripped
        if req.description is not None:
            updates["description"] = req.description
        if req.is_active is not None:
            updates["is_active"] = 1 if req.is_active else 0
        if req.sort_order is not None:
            updates["sort_order"] = req.sort_order
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(
                f"UPDATE outreach_proceeding_types SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (*updates.values(), type_id)
            )
            db.commit()
        row = db.execute("SELECT * FROM outreach_proceeding_types WHERE id = ?", (type_id,)).fetchone()
        return dict(row)


@router.delete("/proceeding-types/{type_id}")
async def delete_proceeding_type(type_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a proceeding type. Existing campaigns keep displaying correctly
    afterward — case_campaigns.campaign_type is a denormalized snapshot of
    the key, not a live join, so nothing about a past campaign breaks."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT id FROM outreach_proceeding_types WHERE id = ? AND tenant_id = ?",
            (type_id, tenant_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Proceeding type not found")
        db.execute("DELETE FROM outreach_proceeding_types WHERE id = ?", (type_id,))
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# CLAUSE LIBRARY — tenant-owned reusable letter building blocks
# (Milestone 2: replaces hardcoded Python template wording for the
# plain-text fallback path — never touches a tenant's custom_html override)
# ---------------------------------------------------------------------------

_CLAUSE_CATEGORIES = _CLAUSE_BODY_CATEGORIES + ["signature_block", "cta_config"]


class ClauseCreate(BaseModel):
    category: str
    name: str
    body: str = ""
    is_default_for_category: bool = False
    proceeding_type_id: Optional[str] = None


class ClauseUpdate(BaseModel):
    name: Optional[str] = None
    body: Optional[str] = None
    is_default_for_category: Optional[bool] = None
    proceeding_type_id: Optional[str] = None


@router.get("/clauses")
async def list_clauses(current_user: dict = Depends(get_current_user)):
    """List this tenant's saved clauses, grouped by category."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM outreach_clauses WHERE tenant_id = ? ORDER BY category, created_at DESC",
            (tenant_id,)
        ).fetchall()
        return {"data": [dict(r) for r in rows]}


@router.post("/clauses")
async def create_clause(req: ClauseCreate, current_user: dict = Depends(get_current_user)):
    """Save a new reusable clause. Setting is_default_for_category unsets
    any other clause currently flagged default in the same category — only
    one clause per category is ever "live" for letter assembly at a time."""
    tenant_id = current_user["tenant_id"]
    if req.category not in _CLAUSE_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of: {', '.join(_CLAUSE_CATEGORIES)}")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    with get_db() as db:
        new_id = generate_id()
        if req.is_default_for_category:
            db.execute(
                "UPDATE outreach_clauses SET is_default_for_category = 0 WHERE tenant_id = ? AND category = ?",
                (tenant_id, req.category)
            )
        db.execute(
            "INSERT INTO outreach_clauses "
            "(id, tenant_id, category, name, body, is_default_for_category, proceeding_type_id, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id, tenant_id, req.category, req.name.strip(), req.body,
             1 if req.is_default_for_category else 0, req.proceeding_type_id, current_user["sub"])
        )
        db.commit()
        row = db.execute("SELECT * FROM outreach_clauses WHERE id = ?", (new_id,)).fetchone()
        return dict(row)


@router.patch("/clauses/{clause_id}")
async def update_clause(clause_id: str, req: ClauseUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM outreach_clauses WHERE id = ? AND tenant_id = ?",
            (clause_id, tenant_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Clause not found")
        if req.is_default_for_category:
            db.execute(
                "UPDATE outreach_clauses SET is_default_for_category = 0 WHERE tenant_id = ? AND category = ? AND id != ?",
                (tenant_id, row["category"], clause_id)
            )
        updates = {}
        if req.name is not None:
            stripped = req.name.strip()
            if not stripped:
                raise HTTPException(status_code=400, detail="name cannot be blank")
            updates["name"] = stripped
        if req.body is not None:
            updates["body"] = req.body
        if req.is_default_for_category is not None:
            updates["is_default_for_category"] = 1 if req.is_default_for_category else 0
        if req.proceeding_type_id is not None:
            updates["proceeding_type_id"] = req.proceeding_type_id
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(
                f"UPDATE outreach_clauses SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (*updates.values(), clause_id)
            )
            db.commit()
        row = db.execute("SELECT * FROM outreach_clauses WHERE id = ?", (clause_id,)).fetchone()
        return dict(row)


@router.delete("/clauses/{clause_id}")
async def delete_clause(clause_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        row = db.execute(
            "SELECT id FROM outreach_clauses WHERE id = ? AND tenant_id = ?",
            (clause_id, tenant_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Clause not found")
        db.execute("DELETE FROM outreach_clauses WHERE id = ?", (clause_id,))
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# EMAIL CAMPAIGNS — Staged sequences with supervisor approval
# ---------------------------------------------------------------------------

class CampaignCreate(BaseModel):
    contact_ids: List[str]
    firm_name: str = "Law Office"
    firm_address: Optional[str] = None
    firm_phone: Optional[str] = None
    from_name: Optional[str] = None
    additional_notes: Optional[str] = None
    litigation_type: str = "Demand for Arbitration"  # or "Intent to Sue", etc.
    # ERC-specific facts for the "document_execution_request" wording track —
    # which quarters were already filed/validated vs. newly identified, and
    # the contingency rate — vary per client, so they're filled in per
    # campaign rather than baked into the tenant's saved template.
    filed_quarters: Optional[str] = None      # e.g. "the second and third quarters of 2021"
    additional_quarter: Optional[str] = None  # e.g. "the first quarter of 2021"
    contingency_fee_text: Optional[str] = None  # e.g. "thirty percent (30%)"
    # Which 5-stage wording track drives all 5 emails — never mixed within
    # one campaign. "document_execution_request" requires document_ids.
    campaign_type: str = "outstanding_amount"  # or "document_execution_request"
    # Optional link to the tenant's own outreach_proceeding_types row (the
    # picker the tenant actually sees). Purely denormalized/informational in
    # Milestone 1 — campaign_type above still drives which wording track
    # renders; this just records which named proceeding type the tenant
    # selected for display purposes, ahead of Milestone 3 wiring it into
    # rendering.
    proceeding_type_id: Optional[str] = None
    document_ids: Optional[List[str]] = None
    # Schedule: days after campaign creation to send each email
    schedule_day_1: int = 0     # Initial Demand — immediately after approval
    schedule_day_2: int = 14    # Follow-Up #1
    schedule_day_3: int = 28    # Follow-Up #2 (Escalation Warning)
    schedule_day_4: int = 42    # Final Notice
    schedule_day_5: int = 49    # Notice of Intent to Initiate Litigation


class DebtorResponseCreate(BaseModel):
    contact_id: str
    campaign_id: Optional[str] = None
    response_type: str  # payment, partial_payment, dispute, negotiation, acknowledgment, other
    response_method: str = "email"  # email, phone, letter, in_person, other
    summary: str
    amount_offered: Optional[float] = None
    notes: Optional[str] = None


class CaseEscalation(BaseModel):
    reason: str
    supervisor_email: Optional[str] = None
    notes: Optional[str] = None
    priority: str = "high"  # low, medium, high, urgent


class CaseSettlement(BaseModel):
    settlement_type: str  # full_payment, partial_payment, payment_plan, mutual_release, other
    amount_settled: Optional[float] = None
    currency: str = "USD"
    terms: Optional[str] = None
    notes: Optional[str] = None


class CaseUpgradeRequest(BaseModel):
    new_case_type: str = "civil_litigation"  # civil_litigation, arbitration, etc.
    litigation_type: str = "Demand for Arbitration"  # specific type
    reason: str = "Debtor failed to respond to pre-litigation outreach"
    notes: Optional[str] = None


class CampaignApproval(BaseModel):
    action: str  # approve, reject
    notes: Optional[str] = None


@router.post("/cases/{case_id}/campaigns")
async def create_campaign(case_id: str, req: CampaignCreate, current_user: dict = Depends(get_current_user)):
    """Create a staged email campaign for a case. All 5 emails are pre-generated and staged for supervisor approval."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        case_row = db.execute("SELECT title, case_number, client_name FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")
        case_title = case_row["title"]
        case_number = case_row["case_number"] or ""
        client_name = case_row["client_name"] or case_title

        default_sig_row = db.execute(
            "SELECT * FROM email_signatures WHERE tenant_id = ? AND is_default = 1 LIMIT 1",
            (tenant_id,)
        ).fetchone()
        default_sig_html = ""
        if default_sig_row:
            sig_d = dict(default_sig_row)
            default_sig_html = sig_d.get("custom_html") or _build_signature_html(sig_d)
        # The signature is the source of truth for firm identity now — prefer
        # it over firm_name, whose pydantic default ("Law Office") would
        # otherwise always win since it's never empty/falsy.
        sig_firm_name, sig_firm_address, sig_firm_phone, sig_logo_url = _signature_firm_identity(default_sig_row)
        firm_name = sig_firm_name or req.firm_name or "Law Office"
        firm_address = req.firm_address or sig_firm_address
        firm_phone = req.firm_phone or sig_firm_phone
        logo_url = sig_logo_url
        # The signature is also the source of truth for who's signing —
        # falls back to the logged-in user only when no default signature
        # (or no sender name on it) exists yet.
        sig_sender_name = (default_sig_row["sender_name"] or "").strip() if default_sig_row else ""
        sender_name = req.from_name or sig_sender_name or (user_row["full_name"] if user_row else "Attorney")

        campaign_type = req.campaign_type if req.campaign_type in (
            "outstanding_amount", "document_execution_request", "peo_authorization"
        ) else "outstanding_amount"
        # Both wording tracks below need a signable document staged first —
        # the letter itself asks the recipient to review & sign it.
        _SIGNABLE_CAMPAIGN_TYPES = ("document_execution_request", "peo_authorization")
        if campaign_type in _SIGNABLE_CAMPAIGN_TYPES and not req.document_ids:
            label = "Document Execution Request" if campaign_type == "document_execution_request" else "PEO Authorization"
            raise HTTPException(400, f"document_ids is required for a {label} campaign")
        # These three substitute directly into the tenant's saved letter — left
        # blank, the letter ships with dangling "for ;" sentences. A prior
        # campaign went out this way and was rejected by the client's approver
        # for exactly that reason, so this is enforced server-side, not just
        # in the form.
        if campaign_type == "document_execution_request" and not (
            (req.filed_quarters or "").strip() and (req.additional_quarter or "").strip() and (req.contingency_fee_text or "").strip()
        ):
            raise HTTPException(400, "filed_quarters, additional_quarter, and contingency_fee_text are all required for a Document Execution Request campaign")

        # Follow-up stage template_types for each signable-document wording
        # track — stage 1 always shares its template_type with campaign_type.
        _FOLLOWUP_STAGE_TYPES = {
            "document_execution_request": (
                "document_execution_followup", "document_execution_escalation",
                "document_execution_final_notice", "document_execution_notice_of_intent",
            ),
            "peo_authorization": (
                "peo_authorization_followup", "peo_authorization_escalation",
                "peo_authorization_final_notice", "peo_authorization_notice_of_intent",
            ),
        }

        # Stage 1 (outstanding_amount / document_execution_request /
        # peo_authorization) can have a saved plain-text or advanced-HTML
        # override, same as the Templates tab. Stages 2-5 of a signable-
        # document campaign can also have a saved advanced-HTML override (no
        # Edit UI yet — set via the same /template-custom API) so the whole
        # 5-stage sequence can share one consistent document design; falls
        # back to the fixed built-in wording otherwise.
        stage1_custom = _get_custom_template(db, tenant_id, campaign_type)
        stage1_custom_subject = stage1_custom["custom_subject"] if stage1_custom else None
        stage1_custom_body = stage1_custom["custom_body"] if stage1_custom else None
        doc_exec_custom = {
            t: _get_custom_template(db, tenant_id, t)
            for t in _FOLLOWUP_STAGE_TYPES.get(campaign_type, ())
        } if campaign_type in _FOLLOWUP_STAGE_TYPES else {}

        # If the tenant picked a proceeding type but the underlying wording
        # track (campaign_type) wasn't explicitly set to match, fall back to
        # the proceeding type's own key — lets the New Campaign flow start
        # driving campaign_type from the tenant-owned picker without a
        # separate migration step.
        proceeding_type_row = None
        if req.proceeding_type_id:
            proceeding_type_row = db.execute(
                "SELECT * FROM outreach_proceeding_types WHERE id = ? AND tenant_id = ?",
                (req.proceeding_type_id, tenant_id)
            ).fetchone()

        campaign_id = generate_id()
        db.execute(
            """INSERT INTO case_campaigns (id, case_id, tenant_id, created_by, firm_name, firm_address,
               firm_phone, from_name, additional_notes, status, litigation_type, campaign_type,
               proceeding_type_id, schedule_day_1, schedule_day_2, schedule_day_3, schedule_day_4, schedule_day_5,
               created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (campaign_id, case_id, tenant_id, user_id, firm_name, firm_address,
             firm_phone, sender_name, req.additional_notes or "",
             req.litigation_type, campaign_type,
             proceeding_type_row["id"] if proceeding_type_row else None,
             req.schedule_day_1, req.schedule_day_2, req.schedule_day_3, req.schedule_day_4,
             req.schedule_day_5, now, now)
        )

        # Pre-generate all 5 emails for each contact — the whole sequence uses
        # exactly one wording track (campaign_type), never mixed, per stage.
        if campaign_type == "document_execution_request":
            templates = [
                ("document_execution_request", req.schedule_day_1, _template_document_execution_request),
                ("document_execution_followup", req.schedule_day_2, _template_document_execution_followup),
                ("document_execution_escalation", req.schedule_day_3, _template_document_execution_escalation),
                ("document_execution_final_notice", req.schedule_day_4, _template_document_execution_final_notice),
                ("document_execution_notice_of_intent", req.schedule_day_5, _template_document_execution_notice_of_intent),
            ]
        elif campaign_type == "peo_authorization":
            templates = [
                ("peo_authorization", req.schedule_day_1, _template_peo_authorization_request),
                ("peo_authorization_followup", req.schedule_day_2, _template_peo_authorization_followup),
                ("peo_authorization_escalation", req.schedule_day_3, _template_peo_authorization_escalation),
                ("peo_authorization_final_notice", req.schedule_day_4, _template_peo_authorization_final_notice),
                ("peo_authorization_notice_of_intent", req.schedule_day_5, _template_peo_authorization_notice_of_intent),
            ]
        else:
            # Stage 1 uses the exact "Outstanding Amount" wording; stages 2-5
            # reuse the existing proven escalation stages (same money-owed
            # subject matter, no need to re-invent them).
            templates = [
                ("outstanding_amount", req.schedule_day_1, _template_outstanding_amount),
                ("follow_up", req.schedule_day_2, _template_follow_up),
                ("follow_up_2", req.schedule_day_3, _template_follow_up_2),
                ("final_notice", req.schedule_day_4, _template_final_notice),
                ("notice_of_intent", req.schedule_day_5, _template_notice_of_intent),
            ]

        for contact_id in req.contact_ids:
            contact = db.execute(
                "SELECT * FROM case_contacts WHERE id = ? AND tenant_id = ?",
                (contact_id, tenant_id)
            ).fetchone()
            if not contact:
                continue

            amount = contact["amount_owed"] or 0
            currency = contact["currency"] or "USD"
            amount_str = f"{currency} {amount:,.2f}" if amount else "the outstanding balance"
            recipient_address = _format_address_block(
                contact["address_line1"] or "", contact["address_line2"] or "",
                contact["city"] or "", contact["state"] or "",
                contact["postal_code"] or "", contact["country"] or "",
            )

            # For document-execution campaigns, the sign link(s) are created
            # ONCE per contact and carried through all 5 escalation stages —
            # it's the same document being requested throughout, not a new
            # request each stage.
            document_links = []
            document_names = []
            if campaign_type in _SIGNABLE_CAMPAIGN_TYPES:
                for doc_id in req.document_ids:
                    doc_row = db.execute(
                        "SELECT * FROM documents WHERE id = ? AND tenant_id = ?", (doc_id, tenant_id)
                    ).fetchone()
                    if not doc_row:
                        continue
                    dlink = _create_outreach_document_link(
                        db, tenant_id, case_id, contact_id, doc_id,
                        contact["name"], contact["email"] or "", created_by=user_id,
                        message=f"{sender_name} has requested your signature on this document.",
                        mode="wet_sign", allow_download=True, signature_pages=[1],
                    )
                    document_links.append({"filename": doc_row["filename"], "review_url": dlink["review_url"]})
                    document_names.append(doc_row["filename"])
                if not document_links:
                    continue  # no valid documents for this contact — skip rather than send a broken campaign
            document_name_str = ", ".join(document_names)

            for step_num, (tpl_type, send_day, tpl_func) in enumerate(templates, 1):
                used_advanced_html = False
                if campaign_type in _SIGNABLE_CAMPAIGN_TYPES:
                    if tpl_type == campaign_type:
                        tokens = _build_plaintext_tokens(
                            firm_name=firm_name, sender_name=sender_name, client_name=client_name,
                            case_title=case_title, response_deadline_days=14, firm_phone=firm_phone,
                            document_name=document_name_str, recipient_company=contact["company"] or "",
                            amount_str=amount_str,
                        )
                        if stage1_custom and stage1_custom["custom_html"]:
                            sig_extra = dict(default_sig_row) if default_sig_row else {}
                            adv_tokens = _build_advanced_html_tokens(
                                tokens, contact_name=contact["name"], recipient_address=recipient_address,
                                sender_title=sig_extra.get("sender_title", ""), sender_email=sig_extra.get("sender_email", ""),
                                firm_website=sig_extra.get("website_url", ""), logo_url=logo_url, firm_address=firm_address,
                        signature_sender_name=sig_extra.get("sender_name", ""),
                                filed_quarters=req.filed_quarters or "", additional_quarter=req.additional_quarter or "",
                                contingency_fee_text=req.contingency_fee_text or "",
                            )
                            subject = _substitute_tokens(stage1_custom_subject or "", adv_tokens)
                            html = _render_custom_html_template(stage1_custom["custom_html"], adv_tokens, document_links)
                            used_advanced_html = True
                        else:
                            subject, html = _render_plaintext_template(
                                campaign_type, tokens, contact["name"], sender_name, firm_name,
                                client_name=client_name, recipient_address=recipient_address, case_title=case_title,
                                case_number=case_number, logo_url=logo_url, document_links=document_links,
                                custom_subject=stage1_custom_subject, custom_body=stage1_custom_body,
                                tenant_id=tenant_id,
                            )
                    elif tpl_type in _FOLLOWUP_STAGE_TYPES.get(campaign_type, ()):
                        _stage_deadlines = {"document_execution_followup": 7, "document_execution_escalation": 5,
                                             "document_execution_final_notice": 5, "document_execution_notice_of_intent": 5,
                                             "peo_authorization_followup": 7, "peo_authorization_escalation": 5,
                                             "peo_authorization_final_notice": 5, "peo_authorization_notice_of_intent": 5}
                        _stage_attempts = {"document_execution_followup": 2, "document_execution_escalation": 3,
                                            "document_execution_final_notice": 3, "document_execution_notice_of_intent": 4,
                                            "peo_authorization_followup": 2, "peo_authorization_escalation": 3,
                                            "peo_authorization_final_notice": 3, "peo_authorization_notice_of_intent": 4}
                        stage_deadline = _stage_deadlines[tpl_type]
                        stage_attempt = _stage_attempts[tpl_type]
                        custom_row = doc_exec_custom.get(tpl_type)
                        if custom_row and custom_row["custom_html"]:
                            tokens = _build_plaintext_tokens(
                                firm_name=firm_name, sender_name=sender_name, client_name=client_name,
                                case_title=case_title, response_deadline_days=stage_deadline, firm_phone=firm_phone,
                                document_name=document_name_str, recipient_company=contact["company"] or "",
                                attempt_number=stage_attempt, litigation_type=req.litigation_type,
                            )
                            sig_extra = dict(default_sig_row) if default_sig_row else {}
                            adv_tokens = _build_advanced_html_tokens(
                                tokens, contact_name=contact["name"], recipient_address=recipient_address,
                                sender_title=sig_extra.get("sender_title", ""), sender_email=sig_extra.get("sender_email", ""),
                                firm_website=sig_extra.get("website_url", ""), logo_url=logo_url, firm_address=firm_address,
                                signature_sender_name=sig_extra.get("sender_name", ""),
                            )
                            subject = _substitute_tokens(custom_row["custom_subject"] or "", adv_tokens)
                            html = _render_custom_html_template(custom_row["custom_html"], adv_tokens, document_links)
                            used_advanced_html = True
                        elif tpl_type in ("document_execution_notice_of_intent", "peo_authorization_notice_of_intent"):
                            subject, html = tpl_func(
                                contact["name"], document_name_str, document_links, firm_name, sender_name,
                                stage_deadline, case_title, case_number, stage_attempt, req.litigation_type,
                                recipient_address, client_name, logo_url,
                            )
                        else:
                            subject, html = tpl_func(
                                contact["name"], document_name_str, document_links, firm_name, sender_name,
                                stage_deadline, case_title, case_number, stage_attempt, recipient_address, client_name, logo_url,
                            )
                elif tpl_type == "outstanding_amount":
                    amount_str = f"{currency} {amount:,.2f}" if amount else "the outstanding balance"
                    tokens = _build_plaintext_tokens(
                        firm_name=firm_name, sender_name=sender_name, client_name=client_name,
                        case_title=case_title, response_deadline_days=14, firm_phone=firm_phone,
                        amount_str=amount_str,
                    )
                    subject, html = _render_plaintext_template(
                        "outstanding_amount", tokens, contact["name"], sender_name, firm_name,
                        client_name=client_name, recipient_address=recipient_address, case_title=case_title,
                        case_number=case_number, logo_url=logo_url,
                        custom_subject=stage1_custom_subject, custom_body=stage1_custom_body,
                        tenant_id=tenant_id,
                    )
                elif tpl_type == "follow_up":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, firm_name, sender_name,
                        7, firm_address, firm_phone,
                        req.additional_notes or "", case_title, case_number, 2,
                        recipient_address, client_name, logo_url,
                    )
                elif tpl_type == "follow_up_2":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, firm_name, sender_name,
                        5, firm_address, firm_phone,
                        req.additional_notes or "", case_title, case_number, 3,
                        recipient_address, client_name, logo_url,
                    )
                elif tpl_type == "final_notice":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, firm_name, sender_name,
                        5, firm_address, firm_phone,
                        req.additional_notes or "", case_title, case_number, 4,
                        recipient_address, client_name, logo_url,
                    )
                elif tpl_type == "notice_of_intent":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, firm_name, sender_name,
                        5, firm_address, firm_phone,
                        req.additional_notes or "", case_title, case_number, 5,
                        req.litigation_type, recipient_address, client_name, logo_url,
                    )
                else:
                    subject, html = tpl_func(
                        contact["name"], amount, currency, firm_name, sender_name,
                        14, firm_address, firm_phone,
                        req.additional_notes or "", case_title, case_number,
                        recipient_address, client_name, logo_url,
                    )

                # Signature, then footer last — footer's own markup is what
                # closes the wrapper div _build_email_header left open, so it
                # must come after the signature, not before it. Skipped for
                # advanced HTML mode, which is already self-contained.
                if not used_advanced_html:
                    if default_sig_html:
                        html += default_sig_html
                    html += _build_email_footer(firm_name, firm_address, firm_phone)

                email_id = generate_id()
                db.execute(
                    """INSERT INTO campaign_emails (id, campaign_id, contact_id, step_number, template_type,
                       send_day, subject, body_html, status, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)""",
                    (email_id, campaign_id, contact_id, step_num, tpl_type, send_day, subject, html, now)
                )

    return {"data": {"id": campaign_id, "status": "pending_approval", "message": "Campaign created and staged for supervisor approval"}}


@router.get("/cases/{case_id}/campaigns")
async def list_campaigns(case_id: str, current_user: dict = Depends(get_current_user)):
    """List all email campaigns for a case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        campaigns = db.execute(
            "SELECT * FROM case_campaigns WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC",
            (case_id, tenant_id)
        ).fetchall()
        result = []
        for c in campaigns:
            emails = db.execute(
                """SELECT ce.*, cc.name as contact_name, cc.email as contact_email, cc.party_role
                   FROM campaign_emails ce
                   JOIN case_contacts cc ON ce.contact_id = cc.id
                   WHERE ce.campaign_id = ? ORDER BY ce.step_number, cc.name""",
                (c["id"],)
            ).fetchall()
            creator = db.execute("SELECT full_name FROM users WHERE id = ?", (c["created_by"],)).fetchone()
            result.append({
                **dict(c),
                "created_by_name": creator["full_name"] if creator else "Unknown",
                "emails": [dict(e) for e in emails],
                "total_emails": len(emails),
            })
    return {"data": result}


@router.get("/cases/{case_id}/campaigns/{campaign_id}")
async def get_campaign(case_id: str, campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single campaign with all staged emails."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        c = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not c:
            raise HTTPException(404, "Campaign not found")

        emails = db.execute(
            """SELECT ce.*, cc.name as contact_name, cc.email as contact_email, cc.company as contact_company,
                      cc.contact_title, cc.party_role
               FROM campaign_emails ce
               JOIN case_contacts cc ON ce.contact_id = cc.id
               WHERE ce.campaign_id = ? ORDER BY ce.step_number, cc.name""",
            (campaign_id,)
        ).fetchall()
        creator = db.execute("SELECT full_name FROM users WHERE id = ?", (c["created_by"],)).fetchone()

    return {"data": {
        **dict(c),
        "created_by_name": creator["full_name"] if creator else "Unknown",
        "emails": [dict(e) for e in emails],
    }}


@router.put("/cases/{case_id}/campaigns/{campaign_id}/approve")
async def approve_campaign(case_id: str, campaign_id: str, req: CampaignApproval,
                           current_user: dict = Depends(get_current_user)):
    """Approve or reject a staged campaign. Only the first email (Initial Demand) sends immediately on approval."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        campaign = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] not in ("pending_approval",):
            raise HTTPException(400, f"Campaign is already {campaign['status']}")

        if req.action == "reject":
            db.execute(
                "UPDATE case_campaigns SET status = 'rejected', approved_by = ?, approval_notes = ?, updated_at = ? WHERE id = ?",
                (user_id, req.notes or "", now, campaign_id)
            )
            db.execute(
                "UPDATE campaign_emails SET status = 'cancelled' WHERE campaign_id = ?",
                (campaign_id,)
            )
            return {"data": {"status": "rejected", "message": "Campaign rejected. No emails will be sent."}}

        # Approve: mark campaign as approved, schedule all emails
        db.execute(
            "UPDATE case_campaigns SET status = 'approved', approved_by = ?, approval_notes = ?, approved_at = ?, updated_at = ? WHERE id = ?",
            (user_id, req.notes or "", now, now, campaign_id)
        )

        # Mark step 1 emails as 'ready' (to send now), others as 'scheduled'
        db.execute(
            "UPDATE campaign_emails SET status = 'ready' WHERE campaign_id = ? AND step_number = 1",
            (campaign_id,)
        )
        db.execute(
            "UPDATE campaign_emails SET status = 'scheduled' WHERE campaign_id = ? AND step_number > 1",
            (campaign_id,)
        )

    return {"data": {"status": "approved", "message": "Campaign approved. Step 1 (Initial Demand) is ready to send."}}


class CampaignApprovalSendRequest(BaseModel):
    recipient_email: str
    recipient_name: Optional[str] = None


@router.post("/cases/{case_id}/campaigns/{campaign_id}/send-for-approval")
async def send_campaign_for_approval(case_id: str, campaign_id: str, req: CampaignApprovalSendRequest,
                                      current_user: dict = Depends(get_current_user)):
    """Email a named approver (e.g. a supervisor with no LitigationSpace
    login) a no-account-required link to review and approve/reject this
    campaign — same pattern as the Gate 1/Gate 2 billing approval emails."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    with get_db() as db:
        campaign = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] != "pending_approval":
            raise HTTPException(400, f"Campaign is already {campaign['status']}")

        recipients = parse_recipients(req.recipient_email)
        if not recipients:
            raise HTTPException(400, "Enter a valid approver email address")
        # "there" is only ever appropriate as a greeting ("Hi there,") — it
        # must never be stored/displayed as if it were the approver's name
        # (e.g. "there approved this campaign"), so keep the two separate.
        provided_name = (req.recipient_name or "").strip()
        greeting_name = provided_name or "there"
        recipient_name = provided_name or None

        case_row = db.execute("SELECT title FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        case_title = case_row["title"] if case_row else "this case"

        contact_names = db.execute(
            """SELECT DISTINCT cc.name FROM campaign_emails ce
               JOIN case_contacts cc ON ce.contact_id = cc.id
               WHERE ce.campaign_id = ?""",
            (campaign_id,)
        ).fetchall()
        recipient_names = ", ".join(r["name"] for r in contact_names) or "recipient"
        step_count = db.execute(
            "SELECT COUNT(DISTINCT step_number) as n FROM campaign_emails WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()["n"]

        requester = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        requester_name = (requester["full_name"] if requester else None) or current_user.get("email", "Your colleague")
        requester_email = current_user.get("email", "")

        campaign_type_label = _campaign_type_label(campaign["campaign_type"])

        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=APPROVAL_TOKEN_EXPIRY_HOURS)).isoformat()
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """UPDATE case_campaigns SET approval_token = ?, approval_token_expires_at = ?,
               approval_requested_by_name = ?, approval_requested_by_email = ?,
               approval_recipient_name = ?, approval_recipient_email = ?, updated_at = ?
               WHERE id = ?""",
            (token, expires_at, requester_name, requester_email, recipient_name,
             ", ".join(recipients), now, campaign_id)
        )

        approval_url = f"{FRONTEND_URL}/approve-campaign/{token}"
        ok, detail = send_campaign_approval_email(
            to_email=recipients, approver_name=greeting_name, sender_name=requester_name,
            case_title=case_title, campaign_type_label=campaign_type_label,
            recipient_names=recipient_names, step_count=step_count, approval_url=approval_url,
        )
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=f"Saved, but the email failed to send ({detail}). Share this link with {greeting_name} directly: {approval_url}"
        )
    return {"message": "Approval request sent", "approval_url": approval_url, "sent_to": recipients}


def _validate_campaign_approval_token(db, token: str):
    campaign = db.execute("SELECT * FROM case_campaigns WHERE approval_token = ?", (token,)).fetchone()
    if not campaign:
        raise HTTPException(status_code=404, detail="Approval link not found")
    if campaign["approval_token_expires_at"]:
        expires = datetime.fromisoformat(campaign["approval_token_expires_at"])
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=410, detail="This approval link has expired")
    return campaign


@router.get("/campaigns/approval/{token}")
async def get_campaign_for_approval(token: str):
    """Public: fetch campaign summary + a previewable copy of every stage
    for the approver to review before deciding — not just step 1. No auth
    required — the token is the credential."""
    with get_db() as db:
        campaign = _validate_campaign_approval_token(db, token)
        case_row = db.execute("SELECT title FROM cases WHERE id = ?", (campaign["case_id"],)).fetchone()

        emails = db.execute(
            """SELECT ce.step_number, ce.send_day, ce.subject, ce.body_html, cc.name as contact_name
               FROM campaign_emails ce JOIN case_contacts cc ON ce.contact_id = cc.id
               WHERE ce.campaign_id = ? ORDER BY ce.step_number, cc.name""",
            (campaign["id"],)
        ).fetchall()
        recipient_names = sorted({e["contact_name"] for e in emails})

        # One representative copy per step (the same template regardless of
        # which recipient it happens to be — that's what the approver is
        # reviewing, not every individual contact's copy).
        by_step = {}
        for e in emails:
            by_step.setdefault(e["step_number"], e)
        steps = [
            {"step_number": n, "send_day": e["send_day"], "subject": e["subject"], "preview_html": e["body_html"]}
            for n, e in sorted(by_step.items())
        ]

        campaign_type_label = _campaign_type_label(campaign["campaign_type"])

        return {
            "campaign_id": campaign["id"],
            "status": campaign["status"],
            "case_title": case_row["title"] if case_row else None,
            "campaign_type_label": campaign_type_label,
            "requested_by": campaign["approval_requested_by_name"],
            "recipient_names": recipient_names,
            "steps": steps,
        }


@router.post("/campaigns/approval/{token}/approve")
async def approve_campaign_by_token(token: str):
    """Public: approver authorizes the campaign. No auth required — the
    token is the credential. Mirrors the internal /approve endpoint's
    effect (step 1 -> ready, steps 2-5 -> scheduled)."""
    with get_db() as db:
        campaign = _validate_campaign_approval_token(db, token)
        if campaign["status"] != "pending_approval":
            raise HTTPException(400, f"Campaign is already {campaign['status']}")
        # Prefer the name they were sent under; fall back to their email
        # (still a real, identifying value) rather than a vague placeholder —
        # this becomes the permanent "approved_by" record.
        approver_display = campaign["approval_recipient_name"] or campaign["approval_recipient_email"] or "External approver"
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE case_campaigns SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?",
            (approver_display, now, now, campaign["id"])
        )
        db.execute("UPDATE campaign_emails SET status = 'ready' WHERE campaign_id = ? AND step_number = 1", (campaign["id"],))
        db.execute("UPDATE campaign_emails SET status = 'scheduled' WHERE campaign_id = ? AND step_number > 1", (campaign["id"],))

        case_row = db.execute("SELECT title FROM cases WHERE id = ?", (campaign["case_id"],)).fetchone()
        campaign_type_label = _campaign_type_label(campaign["campaign_type"])
        requester_email = campaign["approval_requested_by_email"]
    if requester_email:
        send_campaign_approved_notify_email(
            to_email=requester_email, requester_name=campaign["approval_requested_by_name"] or "there",
            approver_name=approver_display,
            case_title=case_row["title"] if case_row else "this case", campaign_type_label=campaign_type_label,
        )
    return {"message": "Campaign approved"}


class CampaignApprovalRejection(BaseModel):
    reason: Optional[str] = None


@router.post("/campaigns/approval/{token}/reject")
async def reject_campaign_by_token(token: str, req: CampaignApprovalRejection):
    """Public: approver rejects the campaign. No auth required — the token
    is the credential."""
    with get_db() as db:
        campaign = _validate_campaign_approval_token(db, token)
        if campaign["status"] != "pending_approval":
            raise HTTPException(400, f"Campaign is already {campaign['status']}")
        approver_display = campaign["approval_recipient_name"] or campaign["approval_recipient_email"] or "External approver"
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE case_campaigns SET status = 'rejected', approved_by = ?, approval_notes = ?, updated_at = ? WHERE id = ?",
            (approver_display, req.reason or "", now, campaign["id"])
        )
        db.execute("UPDATE campaign_emails SET status = 'cancelled' WHERE campaign_id = ?", (campaign["id"],))

        case_row = db.execute("SELECT title FROM cases WHERE id = ?", (campaign["case_id"],)).fetchone()
        campaign_type_label = _campaign_type_label(campaign["campaign_type"])
        requester_email = campaign["approval_requested_by_email"]
    if requester_email:
        send_campaign_rejected_notify_email(
            to_email=requester_email, requester_name=campaign["approval_requested_by_name"] or "there",
            approver_name=approver_display,
            case_title=case_row["title"] if case_row else "this case", campaign_type_label=campaign_type_label,
            reason=req.reason or "",
        )
    return {"message": "Campaign rejected"}


@router.delete("/cases/{case_id}/campaigns/{campaign_id}/contacts/{contact_id}")
async def remove_campaign_contact(case_id: str, campaign_id: str, contact_id: str,
                                   current_user: dict = Depends(get_current_user)):
    """Remove one recipient's staged emails from a still-pending campaign —
    corrects a wrong recipient (e.g. the client/creditor's own contact
    getting swept in by the "select all contacts" default) before anything
    has sent. Only allowed while the campaign hasn't been approved yet."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        campaign = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] != "pending_approval":
            raise HTTPException(400, "Can only remove a recipient before the campaign is approved")
        cur = db.execute(
            "DELETE FROM campaign_emails WHERE campaign_id = ? AND contact_id = ?",
            (campaign_id, contact_id)
        )
        db.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Recipient not found in this campaign")
    return {"ok": True, "removed": cur.rowcount}


@router.delete("/cases/{case_id}/campaigns/{campaign_id}")
async def delete_campaign(case_id: str, campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a campaign entirely, regardless of its approval status —
    including already-approved/rejected/completed ones (e.g. test campaigns).
    This only removes the LitigationSpace record; it can't un-send any
    step that already went out."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        campaign = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        db.execute("DELETE FROM campaign_emails WHERE campaign_id = ?", (campaign_id,))
        db.execute("DELETE FROM case_campaigns WHERE id = ?", (campaign_id,))
        db.commit()
    return {"ok": True}


@router.post("/cases/{case_id}/campaigns/{campaign_id}/send-step")
async def send_campaign_step(case_id: str, campaign_id: str, step_number: int = 1,
                              current_user: dict = Depends(get_current_user)):
    """Send all emails for a specific step of an approved campaign."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        campaign = db.execute(
            "SELECT * FROM case_campaigns WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (campaign_id, case_id, tenant_id)
        ).fetchone()
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        if campaign["status"] not in ("approved",):
            raise HTTPException(400, "Campaign must be approved before sending")

        emails_to_send = db.execute(
            "SELECT ce.*, cc.email as to_email FROM campaign_emails ce JOIN case_contacts cc ON ce.contact_id = cc.id WHERE ce.campaign_id = ? AND ce.step_number = ? AND ce.status IN ('ready', 'scheduled')",
            (campaign_id, step_number)
        ).fetchall()

        if not emails_to_send:
            return {"data": [], "message": "No emails ready to send for this step"}

        results = []
        for email in emails_to_send:
            tracking_id = str(uuid.uuid4())
            success = _send_outreach_email(
                to_email=email["to_email"],
                subject=email["subject"],
                html_body=email["body_html"],
                from_name=campaign["from_name"],
                tracking_id=tracking_id,
                cc=current_user.get("email", ""),
            )
            status = "sent" if success else "failed"
            db.execute(
                "UPDATE campaign_emails SET status = ?, sent_at = ?, tracking_id = ? WHERE id = ?",
                (status, now if success else None, tracking_id, email["id"])
            )

            # Also record in case_emails for the communication log
            case_email_id = generate_id()
            db.execute(
                """INSERT INTO case_emails (id, case_id, tenant_id, contact_id, sender_user_id,
                   template_type, subject, body_html, from_name, status, tracking_id, sent_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (case_email_id, case_id, tenant_id, email["contact_id"], user_id,
                 email["template_type"], email["subject"], email["body_html"], campaign["from_name"],
                 status, tracking_id, now if success else None, now)
            )

            if success:
                db.execute(
                    "INSERT INTO email_tracking_events (id, email_id, event_type, created_at) VALUES (?, ?, 'sent', ?)",
                    (generate_id(), case_email_id, now)
                )
                db.execute(
                    """UPDATE case_contacts SET total_emails_sent = total_emails_sent + 1,
                       last_contacted_at = ?, updated_at = ? WHERE id = ?""",
                    (now, now, email["contact_id"])
                )

            results.append({"email_id": email["id"], "contact_id": email["contact_id"], "status": status})

        # If current step sent, mark next step as ready
        if step_number < 5:
            next_ready = db.execute(
                "SELECT COUNT(*) as cnt FROM campaign_emails WHERE campaign_id = ? AND step_number = ? AND status = 'scheduled'",
                (campaign_id, step_number + 1)
            ).fetchone()
            if next_ready and next_ready["cnt"] > 0:
                db.execute(
                    "UPDATE campaign_emails SET status = 'ready' WHERE campaign_id = ? AND step_number = ?",
                    (campaign_id, step_number + 1)
                )

        # Check if campaign is complete
        remaining = db.execute(
            "SELECT COUNT(*) as cnt FROM campaign_emails WHERE campaign_id = ? AND status IN ('staged', 'ready', 'scheduled')",
            (campaign_id,)
        ).fetchone()
        if remaining and remaining["cnt"] == 0:
            db.execute("UPDATE case_campaigns SET status = 'completed', updated_at = ? WHERE id = ?", (now, campaign_id))

    return {"data": results, "sent": sum(1 for r in results if r["status"] == "sent")}


@router.put("/campaigns/emails/{email_id}/edit")
async def edit_campaign_email(email_id: str, subject: Optional[str] = None, body_html: Optional[str] = None,
                               current_user: dict = Depends(get_current_user)):
    """Edit a staged/scheduled campaign email before it's sent."""
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        email = db.execute("SELECT ce.*, ec.tenant_id FROM campaign_emails ce JOIN case_campaigns ec ON ce.campaign_id = ec.id WHERE ce.id = ?", (email_id,)).fetchone()
        if not email or email["tenant_id"] != tenant_id:
            raise HTTPException(404, "Email not found")
        if email["status"] in ("sent", "cancelled"):
            raise HTTPException(400, "Cannot edit a sent or cancelled email")

        updates = []
        params = []
        if subject:
            updates.append("subject = ?")
            params.append(subject)
        if body_html:
            updates.append("body_html = ?")
            params.append(body_html)
        if not updates:
            raise HTTPException(400, "No changes provided")

        updates.append("updated_at = ?")
        params.append(now)
        params.append(email_id)
        db.execute(f"UPDATE campaign_emails SET {', '.join(updates)} WHERE id = ?", params)

    return {"ok": True, "message": "Email updated"}


# ---------------------------------------------------------------------------
# DEBTOR RESPONSES — Track when debtors respond to outreach
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/responses")
async def log_debtor_response(case_id: str, req: DebtorResponseCreate,
                               current_user: dict = Depends(get_current_user)):
    """Log a debtor/client response to outreach emails."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    resp_id = generate_id()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        contact = db.execute("SELECT * FROM case_contacts WHERE id = ? AND tenant_id = ?",
                             (req.contact_id, tenant_id)).fetchone()
        if not contact:
            raise HTTPException(404, "Contact not found")

        db.execute(
            """INSERT INTO debtor_responses (id, case_id, tenant_id, contact_id, campaign_id,
               response_type, response_method, summary, amount_offered, notes,
               logged_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (resp_id, case_id, tenant_id, req.contact_id, req.campaign_id,
             req.response_type, req.response_method, req.summary,
             req.amount_offered, req.notes or "", user_id, now)
        )

        # Update contact status
        db.execute(
            "UPDATE case_contacts SET pipeline_stage = 'responded', updated_at = ? WHERE id = ?",
            (now, req.contact_id)
        )

        # Add timeline event
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'debtor_response', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"Debtor Response: {req.response_type.replace('_', ' ').title()}",
             f"{contact['name']} responded via {req.response_method}: {req.summary}",
             user_id, now)
        )

    return {"data": {"id": resp_id, "message": "Response logged successfully"}}


@router.get("/cases/{case_id}/responses")
async def list_debtor_responses(case_id: str, current_user: dict = Depends(get_current_user)):
    """List all debtor responses for a case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            """SELECT dr.*, cc.name as contact_name, cc.email as contact_email, cc.company as contact_company,
                      u.full_name as logged_by_name
               FROM debtor_responses dr
               JOIN case_contacts cc ON dr.contact_id = cc.id
               LEFT JOIN users u ON dr.logged_by = u.id
               WHERE dr.case_id = ? AND dr.tenant_id = ?
               ORDER BY dr.created_at DESC""",
            (case_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# CASE ESCALATION — Escalate to supervisor
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/escalate")
async def escalate_case(case_id: str, req: CaseEscalation,
                         current_user: dict = Depends(get_current_user)):
    """Escalate a case to supervisor for review."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    esc_id = generate_id()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        user_row = db.execute("SELECT full_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        escalator_name = user_row["full_name"] if user_row else "Unknown"

        db.execute(
            """INSERT INTO case_escalations (id, case_id, tenant_id, escalated_by, reason,
               supervisor_email, notes, priority, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (esc_id, case_id, tenant_id, user_id, req.reason,
             req.supervisor_email or "", req.notes or "", req.priority, now)
        )

        # Update case priority
        db.execute(
            "UPDATE cases SET priority = ?, updated_at = ? WHERE id = ?",
            (req.priority, now, case_id)
        )

        # Add timeline event
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'escalation', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"Case Escalated to Supervisor ({req.priority.upper()})",
             f"Escalated by {escalator_name}: {req.reason}" + (f"\nNotes: {req.notes}" if req.notes else ""),
             user_id, now)
        )

        # Send email notification to supervisor if email provided
        if req.supervisor_email:
            try:
                _send_outreach_email(
                    to_email=req.supervisor_email,
                    subject=f"Case Escalation: {case_row['title']} [{req.priority.upper()}]",
                    html_body=f"""
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #dc2626;">Case Escalation Notice</h2>
                        <p><strong>Case:</strong> {case_row['title']}</p>
                        <p><strong>Escalated by:</strong> {escalator_name}</p>
                        <p><strong>Priority:</strong> {req.priority.upper()}</p>
                        <p><strong>Reason:</strong> {req.reason}</p>
                        {f'<p><strong>Notes:</strong> {req.notes}</p>' if req.notes else ''}
                        <p><a href="{BASE_URL}/cases/{case_id}">View Case</a></p>
                    </div>
                    """,
                    from_name="LitigationSpace",
                    cc=current_user.get("email", ""),
                )
            except Exception as e:
                logger.error(f"Failed to send escalation email: {e}")

    return {"data": {"id": esc_id, "status": "pending", "message": "Case escalated to supervisor"}}


@router.get("/cases/{case_id}/escalations")
async def list_escalations(case_id: str, current_user: dict = Depends(get_current_user)):
    """List all escalations for a case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            """SELECT ce.*, u.full_name as escalated_by_name
               FROM case_escalations ce
               LEFT JOIN users u ON ce.escalated_by = u.id
               WHERE ce.case_id = ? AND ce.tenant_id = ?
               ORDER BY ce.created_at DESC""",
            (case_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.put("/cases/{case_id}/escalations/{escalation_id}")
async def update_escalation(case_id: str, escalation_id: str,
                              status: str = "resolved", resolution_notes: str = "",
                              current_user: dict = Depends(get_current_user)):
    """Update escalation status (resolved, in_progress, dismissed)."""
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        db.execute(
            "UPDATE case_escalations SET status = ?, resolution_notes = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (status, resolution_notes, now, current_user["sub"], escalation_id, case_id, tenant_id)
        )

    return {"ok": True, "message": f"Escalation marked as {status}"}


# ---------------------------------------------------------------------------
# CASE SETTLEMENT — Settle/resolve a pre-litigation case
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/settle")
async def settle_case(case_id: str, req: CaseSettlement,
                       current_user: dict = Depends(get_current_user)):
    """Record a settlement for a case. Changes case status to 'settled'."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    settlement_id = generate_id()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()

        db.execute(
            """INSERT INTO case_settlements (id, case_id, tenant_id, settlement_type, amount_settled,
               currency, terms, notes, settled_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (settlement_id, case_id, tenant_id, req.settlement_type,
             req.amount_settled, req.currency, req.terms or "", req.notes or "", user_id, now)
        )

        # Update case status to closed/settled
        db.execute(
            "UPDATE cases SET status = 'closed', updated_at = ? WHERE id = ?",
            (now, case_id)
        )

        # Cancel any pending campaign emails
        db.execute(
            """UPDATE campaign_emails SET status = 'cancelled'
               WHERE campaign_id IN (SELECT id FROM case_campaigns WHERE case_id = ? AND status IN ('pending_approval', 'approved'))
               AND status IN ('staged', 'ready', 'scheduled')""",
            (case_id,)
        )
        db.execute(
            "UPDATE case_campaigns SET status = 'completed', updated_at = ? WHERE case_id = ? AND status IN ('pending_approval', 'approved')",
            (now, case_id)
        )

        # Add timeline event
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'settlement', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"Case Settled: {req.settlement_type.replace('_', ' ').title()}",
             f"Settlement recorded by {user_row['full_name'] if user_row else 'Unknown'}. "
             + (f"Amount: {req.currency} {req.amount_settled:,.2f}. " if req.amount_settled else "")
             + (f"Terms: {req.terms}" if req.terms else ""),
             user_id, now)
        )

    return {"data": {"id": settlement_id, "status": "settled", "message": "Case settled successfully. All pending emails cancelled."}}


@router.get("/cases/{case_id}/settlements")
async def list_settlements(case_id: str, current_user: dict = Depends(get_current_user)):
    """List all settlements for a case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        rows = db.execute(
            """SELECT cs.*, u.full_name as settled_by_name
               FROM case_settlements cs
               LEFT JOIN users u ON cs.settled_by = u.id
               WHERE cs.case_id = ? AND cs.tenant_id = ?
               ORDER BY cs.created_at DESC""",
            (case_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# CASE UPGRADE — Escalate from Pre-Litigation to Litigation
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/upgrade-to-litigation")
async def upgrade_case_to_litigation(case_id: str, req: CaseUpgradeRequest,
                                      current_user: dict = Depends(get_current_user)):
    """Upgrade a pre-litigation case to full litigation. Changes case type, generates litigation tasks."""
    import json
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        old_type = case_row["case_type"]
        old_status = case_row["status"]

        # Update case type and status
        db.execute(
            "UPDATE cases SET case_type = ?, status = 'active', updated_at = ? WHERE id = ?",
            (req.new_case_type, now, case_id)
        )

        # Cancel any pending campaign emails
        db.execute(
            """UPDATE campaign_emails SET status = 'cancelled'
               WHERE campaign_id IN (SELECT id FROM case_campaigns WHERE case_id = ? AND status IN ('pending_approval', 'approved'))
               AND status IN ('staged', 'ready', 'scheduled')""",
            (case_id,)
        )
        db.execute(
            "UPDATE case_campaigns SET status = 'completed', updated_at = ? WHERE case_id = ? AND status IN ('pending_approval', 'approved')",
            (now, case_id)
        )

        # Generate litigation tasks from workflow template
        tasks_added = 0
        template = db.execute(
            "SELECT * FROM workflow_templates WHERE case_type = ?",
            (req.new_case_type,)
        ).fetchone()
        if template:
            tasks = json.loads(template["tasks_json"])
            for task_title in tasks:
                task_id = generate_id()
                db.execute(
                    """INSERT INTO tasks (id, case_id, tenant_id, title, status, priority)
                       VALUES (?, ?, ?, ?, 'pending', 'high')""",
                    (task_id, case_id, tenant_id, task_title)
                )
                tasks_added += 1
        else:
            # Default litigation tasks if no template exists
            default_tasks = [
                "Review pre-litigation file and outreach history",
                "Draft Statement of Claim / Complaint",
                "Prepare demand for arbitration or summons",
                "File with court or arbitration body",
                "Serve respondent / defendant",
                "Prepare evidence bundle (exhibits, correspondence)",
                "Identify and prepare witnesses",
                "Draft legal memorandum / brief",
                "Attend preliminary hearing / case management conference",
                "Discovery: Request documents from opposing party",
                "Discovery: Respond to opposing party requests",
                "Prepare for mediation (if ordered)",
                "Draft settlement proposal",
                "Prepare for trial / hearing",
                "Attend trial / hearing",
                "Post-trial motions / enforcement",
            ]
            for task_title in default_tasks:
                task_id = generate_id()
                db.execute(
                    """INSERT INTO tasks (id, case_id, tenant_id, title, status, priority)
                       VALUES (?, ?, ?, ?, 'pending', 'high')""",
                    (task_id, case_id, tenant_id, task_title)
                )
                tasks_added += 1

        # Add timeline event
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'case_upgrade', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"Case Upgraded to {req.new_case_type.replace('_', ' ').title()}",
             f"Upgraded from {old_type} ({old_status}) to {req.new_case_type}. "
             f"Reason: {req.reason}. {tasks_added} litigation tasks added. "
             f"Litigation type: {req.litigation_type}."
             + (f" Notes: {req.notes}" if req.notes else ""),
             user_id, now)
        )

    return {"data": {
        "case_id": case_id,
        "old_type": old_type,
        "new_type": req.new_case_type,
        "tasks_added": tasks_added,
        "message": f"Case upgraded to {req.new_case_type.replace('_', ' ').title()}. {tasks_added} litigation tasks added."
    }}


# ---------------------------------------------------------------------------
# SUPERVISOR INSTRUCTIONS — Leave notes, instructions, assign tasks
# ---------------------------------------------------------------------------

class SupervisorInstructionCreate(BaseModel):
    instruction_type: str = "instruction"  # instruction, note, task_assignment, direction
    content: str
    priority: str = "normal"  # low, normal, high, urgent
    assigned_to_email: Optional[str] = None
    due_date: Optional[str] = None
    escalation_id: Optional[str] = None


@router.post("/cases/{case_id}/supervisor-instructions")
async def create_supervisor_instruction(case_id: str, req: SupervisorInstructionCreate,
                                         current_user: dict = Depends(get_current_user)):
    """Supervisor leaves instructions, notes, or assigns tasks within a case."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    instr_id = generate_id()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        user_row = db.execute("SELECT full_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        author_name = user_row["full_name"] if user_row else "Supervisor"

        # Create the supervisor_instructions table if it doesn't exist
        db.execute("""CREATE TABLE IF NOT EXISTS supervisor_instructions (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            instruction_type TEXT DEFAULT 'instruction',
            content TEXT NOT NULL,
            priority TEXT DEFAULT 'normal',
            assigned_to_email TEXT,
            due_date TEXT,
            escalation_id TEXT,
            status TEXT DEFAULT 'open',
            completed_at TEXT,
            completed_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
        )""")

        db.execute(
            """INSERT INTO supervisor_instructions (id, case_id, tenant_id, author_id, instruction_type,
               content, priority, assigned_to_email, due_date, escalation_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)""",
            (instr_id, case_id, tenant_id, user_id, req.instruction_type,
             req.content, req.priority, req.assigned_to_email, req.due_date,
             req.escalation_id, now, now)
        )

        # If it's a task assignment, also create it as a case task
        task_id = None
        if req.instruction_type == "task_assignment":
            task_id = generate_id()
            db.execute(
                """INSERT INTO tasks (id, case_id, tenant_id, title, status, priority, due_date)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
                (task_id, case_id, tenant_id, req.content, req.priority, req.due_date)
            )

        # Add timeline event
        type_label = req.instruction_type.replace("_", " ").title()
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'supervisor_instruction', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"Supervisor {type_label}",
             f"{author_name}: {req.content[:200]}",
             user_id, now)
        )

        # Send email notification if assigned to someone
        if req.assigned_to_email:
            try:
                _send_outreach_email(
                    to_email=req.assigned_to_email,
                    subject=f"Supervisor {type_label}: {case_row['title']}",
                    html_body=f"""
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #C8992A;">Supervisor {type_label}</h2>
                        <p><strong>Case:</strong> {case_row['title']}</p>
                        <p><strong>From:</strong> {author_name}</p>
                        <p><strong>Priority:</strong> {req.priority.upper()}</p>
                        <div style="background: #f8f9fa; padding: 16px; border-left: 4px solid #C8992A; margin: 16px 0;">
                            {req.content}
                        </div>
                        {f'<p><strong>Due:</strong> {req.due_date}</p>' if req.due_date else ''}
                        <p><a href="{BASE_URL}/cases/{case_id}">View Case</a></p>
                    </div>
                    """,
                    from_name="LitigationSpace Supervisor",
                    cc=current_user.get("email", ""),
                )
            except Exception as e:
                logger.error(f"Failed to send supervisor notification: {e}")

    return {"data": {"id": instr_id, "task_id": task_id, "message": f"Supervisor {type_label.lower()} added successfully"}}


@router.get("/cases/{case_id}/supervisor-instructions")
async def list_supervisor_instructions(case_id: str, current_user: dict = Depends(get_current_user)):
    """List all supervisor instructions/notes for a case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        # Create table if not exists
        db.execute("""CREATE TABLE IF NOT EXISTS supervisor_instructions (
            id TEXT PRIMARY KEY, case_id TEXT, tenant_id TEXT, author_id TEXT,
            instruction_type TEXT, content TEXT, priority TEXT, assigned_to_email TEXT,
            due_date TEXT, escalation_id TEXT, status TEXT, completed_at TEXT,
            completed_by TEXT, created_at TEXT, updated_at TEXT
        )""")
        rows = db.execute(
            """SELECT si.*, u.full_name as author_name, u.email as author_email
               FROM supervisor_instructions si
               LEFT JOIN users u ON si.author_id = u.id
               WHERE si.case_id = ? AND si.tenant_id = ?
               ORDER BY si.created_at DESC""",
            (case_id, tenant_id)
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@router.put("/cases/{case_id}/supervisor-instructions/{instruction_id}")
async def update_supervisor_instruction(case_id: str, instruction_id: str,
                                          status: str = "completed",
                                          current_user: dict = Depends(get_current_user)):
    """Mark a supervisor instruction as completed or update its status."""
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            """UPDATE supervisor_instructions SET status = ?, completed_at = ?, completed_by = ?, updated_at = ?
               WHERE id = ? AND case_id = ? AND tenant_id = ?""",
            (status, now if status == "completed" else None, current_user["sub"] if status == "completed" else None,
             now, instruction_id, case_id, tenant_id)
        )
    return {"ok": True, "message": f"Instruction marked as {status}"}


@router.delete("/cases/{case_id}/supervisor-instructions/{instruction_id}")
async def delete_supervisor_instruction(case_id: str, instruction_id: str,
                                          current_user: dict = Depends(get_current_user)):
    """Delete a supervisor instruction."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute(
            "DELETE FROM supervisor_instructions WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (instruction_id, case_id, tenant_id)
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# COMPOSE EMAIL — Send ad-hoc emails by category (onboarding, service, attorney, judge, general)
# ---------------------------------------------------------------------------

class ComposeEmailRequest(BaseModel):
    category: str  # client_onboarding, service_of_documents, attorney_communication, judge_communication, general_litigation
    to_email: str
    to_name: Optional[str] = None
    subject: str
    body_html: str
    cc_emails: Optional[List[str]] = None
    contact_id: Optional[str] = None
    signature_id: Optional[str] = None


@router.post("/cases/{case_id}/compose-email")
async def compose_and_send_email(case_id: str, req: ComposeEmailRequest,
                                   current_user: dict = Depends(get_current_user)):
    """Compose and send an ad-hoc email in any category (onboarding, service of documents, attorney, judge, general)."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    with get_db() as db:
        case_row = db.execute("SELECT * FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")

        user_row = db.execute("SELECT full_name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        sender_name = user_row["full_name"] if user_row else "LitigationSpace"

        # Append email signature if signature_id provided
        final_html = req.body_html
        if req.signature_id:
            sig = db.execute("SELECT signature_html FROM email_signatures WHERE id = ? AND tenant_id = ?",
                             (req.signature_id, tenant_id)).fetchone()
            if sig and sig["signature_html"]:
                final_html += '<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">' + sig["signature_html"] + '</div>'

        tracking_id = str(uuid.uuid4())
        success = _send_outreach_email(
            to_email=req.to_email,
            subject=req.subject,
            html_body=final_html,
            from_name=sender_name,
            tracking_id=tracking_id,
            cc=current_user.get("email", ""),
        )

        # Record in case_emails
        email_id = generate_id()
        db.execute(
            """INSERT INTO case_emails (id, case_id, tenant_id, contact_id, sender_user_id,
               template_type, subject, body_html, from_name, status, tracking_id, sent_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (email_id, case_id, tenant_id, req.contact_id, user_id,
             req.category, req.subject, final_html, sender_name,
             "sent" if success else "failed", tracking_id, now if success else None, now)
        )

        if success:
            db.execute(
                "INSERT INTO email_tracking_events (id, email_id, event_type, created_at) VALUES (?, ?, 'sent', ?)",
                (generate_id(), email_id, now)
            )

        # Add timeline event
        category_label = req.category.replace("_", " ").title()
        db.execute(
            """INSERT INTO timeline_events (id, case_id, tenant_id, event_type, title, description, created_by, created_at)
               VALUES (?, ?, ?, 'email_sent', ?, ?, ?, ?)""",
            (generate_id(), case_id, tenant_id,
             f"{category_label} Email {'Sent' if success else 'Failed'}",
             f"To: {req.to_name or req.to_email} | Subject: {req.subject}",
             user_id, now)
        )

    return {"data": {"id": email_id, "status": "sent" if success else "failed", "tracking_id": tracking_id}}


@router.get("/cases/{case_id}/emails-by-category")
async def list_emails_by_category(case_id: str, category: Optional[str] = None,
                                    current_user: dict = Depends(get_current_user)):
    """List emails for a case, optionally filtered by category."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        if category:
            rows = db.execute(
                """SELECT ce.*, u.full_name as sender_name
                   FROM case_emails ce
                   LEFT JOIN users u ON ce.sender_user_id = u.id
                   WHERE ce.case_id = ? AND ce.tenant_id = ? AND ce.template_type = ?
                   ORDER BY ce.created_at DESC""",
                (case_id, tenant_id, category)
            ).fetchall()
        else:
            rows = db.execute(
                """SELECT ce.*, u.full_name as sender_name
                   FROM case_emails ce
                   LEFT JOIN users u ON ce.sender_user_id = u.id
                   WHERE ce.case_id = ? AND ce.tenant_id = ?
                   ORDER BY ce.created_at DESC""",
                (case_id, tenant_id)
            ).fetchall()
    return {"data": [dict(r) for r in rows]}
