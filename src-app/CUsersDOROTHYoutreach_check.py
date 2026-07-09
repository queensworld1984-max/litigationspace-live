"""
Outreach & Email module for case-based client communication.
Supports contacts management, bulk email sending with templates,
delivery/open tracking, and pipeline stage management.
"""
import os
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.utils.auth import get_current_user, generate_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/outreach", tags=["outreach"])

BASE_URL = os.environ.get("BASE_URL", "https://litigationspace.com")

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

class PipelineUpdate(BaseModel):
    stage: str  # onboarding, active_outreach, responsive, unresponsive, litigation, resolved
    auto_escalation_enabled: Optional[bool] = None
    escalation_after_days: Optional[int] = None
    max_attempts: Optional[int] = None


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------

def _build_email_header(firm_name: str, subtitle: str = "") -> str:
    return f"""
    <div style="font-family: 'Georgia', 'Times New Roman', Times, serif; max-width: 680px; margin: 0 auto; background: #ffffff;">
        <!-- Firm Header -->
        <div style="border-bottom: 3px solid #1e3a5f; padding: 30px 40px 20px 40px;">
            <h1 style="color: #1e3a5f; font-size: 22px; margin: 0; font-weight: 700; letter-spacing: 0.5px;">{firm_name}</h1>
            {f'<p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0; font-style: italic;">{subtitle}</p>' if subtitle else ''}
        </div>
    """

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
            <p style="color: #d1d5db; font-size: 10px; margin: 12px 0 0 0;">
                Sent via <a href="https://litigationspace.com" style="color: #9ca3af; text-decoration: none;">LitigationSpace</a> 
                &mdash; Legal Case Management Platform
            </p>
        </div>
    </div>
    """


def _template_initial_demand(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 14,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "",
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
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law") + f"""
        <!-- Body -->
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            {ref_line}
            <p style="color: #374151; font-size: 14px; margin: 0 0 4px 0;"><strong>ATTN:</strong> {contact_name}</p>
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>VIA EMAIL</strong></p>

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

            {f'<p style="color: #374151; font-size: 14px; line-height: 1.7;">{additional_notes}</p>' if additional_notes else ''}

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

            <!-- Legal Notice -->
            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This letter constitutes a good faith attempt to resolve this matter prior to formal legal proceedings. 
                    It shall not be construed as a waiver of any rights or remedies available to our client under applicable law.
                </p>
            </div>
        </div>
    """ + _build_email_footer(firm_name, firm_address, firm_phone)

    return subject, html


def _template_follow_up(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 7,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 2,
) -> tuple:
    """Returns (subject, html_body) for Follow-up Reminder."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"Follow-Up: Outstanding Balance - Action Required - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law") + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>ATTN:</strong> {contact_name}</p>

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

            {f'<p style="color: #374151; font-size: 14px; line-height: 1.7;">{additional_notes}</p>' if additional_notes else ''}

            <p style="color: #374151; font-size: 14px; line-height: 1.7;">
                Failure to respond may result in our client pursuing formal legal action without 
                further notice, which may include additional costs and fees.
            </p>

            <p style="color: #374151; font-size: 14px; line-height: 1.7; margin-top: 24px;">Respectfully,</p>
            <p style="color: #1e3a5f; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">{sender_name}</p>
            <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0 0;">{firm_name}</p>
        </div>
    """ + _build_email_footer(firm_name, firm_address, firm_phone)

    return subject, html


def _template_final_notice(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", total_attempts: int = 3,
) -> tuple:
    """Returns (subject, html_body) for Final Notice Before Arbitration."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"FINAL NOTICE: Demand for Payment Before Legal Action - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law") + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>ATTN:</strong> {contact_name}</p>

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

            {f'<p style="color: #374151; font-size: 14px; line-height: 1.7;">{additional_notes}</p>' if additional_notes else ''}

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

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This letter constitutes a final demand and formal notice of intent to pursue legal remedies. 
                    All prior correspondence has been documented and preserved. This communication and its 
                    contents may be introduced as evidence in any subsequent legal proceedings.
                </p>
            </div>
        </div>
    """ + _build_email_footer(firm_name, firm_address, firm_phone)

    return subject, html


def _template_follow_up_2(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 3,
) -> tuple:
    """Returns (subject, html_body) for Follow-up #2 (Escalation Warning)."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"URGENT: Escalation Warning - Outstanding Balance - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law") + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>ATTN:</strong> {contact_name}</p>

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

            {f'<p style="color: #374151; font-size: 14px; line-height: 1.7;">{additional_notes}</p>' if additional_notes else ''}

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

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This communication serves as formal notice of intent to escalate. All prior correspondence
                    has been documented and may be used as evidence of good faith efforts to resolve this matter.
                </p>
            </div>
        </div>
    """ + _build_email_footer(firm_name, firm_address, firm_phone)

    return subject, html


def _template_notice_of_intent(
    contact_name: str, amount_owed: float, currency: str,
    firm_name: str, sender_name: str, response_deadline_days: int = 5,
    firm_address: str = "", firm_phone: str = "", additional_notes: str = "",
    case_title: str = "", case_number: str = "", attempt_number: int = 4,
    litigation_type: str = "Demand for Arbitration",
) -> tuple:
    """Returns (subject, html_body) for Notice of Intent to Initiate Litigation."""
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    amount_str = f"{currency} {amount_owed:,.2f}" if amount_owed else "the outstanding balance"

    subject = f"NOTICE OF INTENT TO INITIATE LEGAL PROCEEDINGS - {firm_name}"
    html = _build_email_header(firm_name, "Attorneys & Counselors at Law") + f"""
        <div style="padding: 30px 40px;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 20px 0;">{today}</p>
            <p style="color: #374151; font-size: 14px; margin: 0 0 20px 0;"><strong>ATTN:</strong> {contact_name}</p>

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

            {f'<p style="color: #374151; font-size: 14px; line-height: 1.7;">{additional_notes}</p>' if additional_notes else ''}

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

            <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 0;">
                    This constitutes formal notice of intent to initiate legal proceedings pursuant to applicable law.
                    All prior correspondence has been preserved and will be submitted as evidence of good-faith
                    attempts to resolve this matter. This letter may be presented to the tribunal or court as
                    evidence of compliance with pre-action protocol requirements.
                </p>
            </div>
        </div>
    """ + _build_email_footer(firm_name, firm_address, firm_phone)

    return subject, html


# ---------------------------------------------------------------------------
# Helper: send one email via SMTP
# ---------------------------------------------------------------------------

def _send_outreach_email(to_email: str, subject: str, html_body: str,
                         from_name: str = "", tracking_id: str = "") -> bool:
    """Send an outreach email. Adds tracking pixel if tracking_id provided."""
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
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        display_name = from_name if from_name else "LitigationSpace"
        msg["From"] = f"{display_name} <{DEFAULT_FROM}>"
        msg["To"] = to_email
        msg["Reply-To"] = DEFAULT_FROM
        msg.attach(MIMEText(html_body, "html"))

        if SMTP_HOST in ("localhost", "127.0.0.1") and not SMTP_USER:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.sendmail(DEFAULT_FROM, to_email, msg.as_string())
        else:
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(_auth_user, _auth_pass)
                server.sendmail(DEFAULT_FROM, to_email, msg.as_string())

        logger.info(f"[OUTREACH] Sent to {to_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"[OUTREACH] Failed to send to {to_email}: {e}")
        return False


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


# ---------------------------------------------------------------------------
# SEND EMAILS
# ---------------------------------------------------------------------------

@router.post("/cases/{case_id}/emails/send")
async def send_emails(case_id: str, req: EmailSendRequest, current_user: dict = Depends(get_current_user)):
    """Send custom email to one or more contacts."""
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()
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
        user_row = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        sender_name = req.from_name or (user_row["full_name"] if user_row else "Attorney")
        firm_name = req.firm_name or "Law Office"

        # Get case info for reference
        case_row = db.execute("SELECT title, case_number FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        case_title = case_row["title"] if case_row else ""
        case_number = case_row["case_number"] if case_row else ""

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

            # Generate from template
            if req.template_type == "initial_demand":
                subject, html = _template_initial_demand(
                    contact["name"], amount, currency, firm_name, sender_name,
                    req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
                    req.additional_notes or "", case_title, case_number,
                )
            elif req.template_type == "follow_up":
                subject, html = _template_follow_up(
                    contact["name"], amount, currency, firm_name, sender_name,
                    req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
                    req.additional_notes or "", case_title, case_number, attempt,
                )
            elif req.template_type == "follow_up_2":
                subject, html = _template_follow_up_2(
                    contact["name"], amount, currency, firm_name, sender_name,
                    req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
                    req.additional_notes or "", case_title, case_number, attempt,
                )
            elif req.template_type == "final_notice":
                subject, html = _template_final_notice(
                    contact["name"], amount, currency, firm_name, sender_name,
                    req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
                    req.additional_notes or "", case_title, case_number, attempt,
                )
            else:
                # Custom
                subject = req.custom_subject or f"Important Notice - {firm_name}"
                html = req.custom_body or "<p>No content provided.</p>"

            if req.custom_subject:
                subject = req.custom_subject

            email_id = generate_id()
            tracking_id = str(uuid.uuid4())

            success = _send_outreach_email(
                to_email=contact["email"],
                subject=subject,
                html_body=html,
                from_name=sender_name,
                tracking_id=tracking_id,
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

            results.append({"contact_id": contact_id, "email_id": email_id, "status": status, "subject": subject})

    return {"data": results, "sent": sum(1 for r in results if r["status"] == "sent")}


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
            email_row = db.execute("SELECT id, contact_id FROM case_emails WHERE tracking_id = ?", (tracking_id,)).fetchone()
            if email_row:
                email_id = email_row["id"]
                contact_id = email_row["contact_id"]
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
    """Preview a template with sample data."""
    firm_name = req.firm_name or "Law Office"
    sender_name = req.from_name or "Attorney"
    sample_name = "John Doe"
    sample_amount = 5000.00

    if req.template_type == "initial_demand":
        subject, html = _template_initial_demand(
            sample_name, sample_amount, "USD", firm_name, sender_name,
            req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
        )
    elif req.template_type == "follow_up":
        subject, html = _template_follow_up(
            sample_name, sample_amount, "USD", firm_name, sender_name,
            req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
        )
    elif req.template_type == "follow_up_2":
        subject, html = _template_follow_up_2(
            sample_name, sample_amount, "USD", firm_name, sender_name,
            req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
        )
    elif req.template_type == "final_notice":
        subject, html = _template_final_notice(
            sample_name, sample_amount, "USD", firm_name, sender_name,
            req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
        )
    elif req.template_type == "notice_of_intent":
        subject, html = _template_notice_of_intent(
            sample_name, sample_amount, "USD", firm_name, sender_name,
            req.response_deadline_days, req.firm_address or "", req.firm_phone or "",
        )
    else:
        subject = req.custom_subject or "Custom Email"
        html = req.custom_body or "<p>Custom email content</p>"

    return {"subject": subject, "html": html}


@router.post("/template-download")
async def download_template(req: dict, current_user: dict = Depends(get_current_user)):
    """Download a rendered email template (HTML) as a Word or PDF document,
    preserving its original design, colors, and fonts."""
    import io as _io
    import re as _re

    html = req.get("html", "")
    title = req.get("title", "Email Template")
    fmt = req.get("format", "pdf")
    safe_title = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip().replace(" ", "_")[:60] or "template"

    # xhtml2pdf/reportlab can't parse modern CSS color keywords like
    # "currentcolor" (common in pasted email signatures) - neutralize them.
    html = _re.sub(r"(?i)currentcolor", "#000000", html)

    if fmt == "pdf":
        from xhtml2pdf import pisa
        full_html = f"<html><head><meta charset='utf-8'></head><body>{html}</body></html>"
        buf = _io.BytesIO()
        pisa.CreatePDF(full_html, dest=buf, encoding="utf-8")
        buf.seek(0)
        return Response(
            content=buf.read(),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
        )
    else:
        from htmldocx import HtmlToDocx
        from docx import Document as DocxDocument
        doc = DocxDocument()
        doc.core_properties.title = title
        HtmlToDocx().add_html_to_document(html, doc)
        buf = _io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        return Response(
            content=buf.read(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
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
    """Auto-generate a professional HTML email signature from fields."""
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

    # Build address string
    addr_parts = []
    if addr1:
        addr_parts.append(addr1)
    if addr2:
        addr_parts.append(addr2)
    city_line = ", ".join(p for p in [city, state] if p)
    if postal:
        city_line = f"{city_line} {postal}".strip()
    if city_line:
        addr_parts.append(city_line)
    if country:
        addr_parts.append(country)
    address_html = "<br>".join(addr_parts)

    # Logo section
    logo_html = ""
    if logo:
        logo_html = f'<img src="{logo}" alt="{company or name}" style="max-height:50px;max-width:160px;margin-bottom:8px;" />'

    # Social links
    social_html = ""
    if linkedin or twitter:
        links = []
        if linkedin:
            links.append(f'<a href="{linkedin}" style="color:{accent};text-decoration:none;font-size:12px;margin-right:12px;">LinkedIn</a>')
        if twitter:
            links.append(f'<a href="{twitter}" style="color:{accent};text-decoration:none;font-size:12px;">Twitter</a>')
        social_html = f'<div style="margin-top:8px;">{"".join(links)}</div>'

    # Contact details
    contact_lines = []
    if phone:
        contact_lines.append(f'<span style="color:#6b7280;font-size:12px;">Tel: {phone}</span>')
    if email:
        contact_lines.append(f'<a href="mailto:{email}" style="color:{accent};font-size:12px;text-decoration:none;">{email}</a>')
    if website:
        contact_lines.append(f'<a href="{website}" style="color:{accent};font-size:12px;text-decoration:none;">{website}</a>')
    contact_html = '<br>'.join(contact_lines)

    if layout == "minimal":
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;margin-top:16px;">
          <tr><td colspan="2" style="border-top:2px solid {accent};padding-top:10px;">
            <strong style="color:#1f2937;font-size:14px;">{name}</strong>
            {f'<span style="color:#6b7280;font-size:12px;"> | {title}</span>' if title else ''}
            {f'<span style="color:#6b7280;font-size:12px;"> | {company}</span>' if company else ''}
          </td></tr>
          <tr><td style="padding-top:4px;">{contact_html}</td></tr>
        </table>"""

    elif layout == "vertical":
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;margin-top:16px;border-top:3px solid {accent};padding-top:12px;">
          {f'<tr><td style="padding-bottom:10px;">{logo_html}</td></tr>' if logo_html else ''}
          <tr><td><strong style="color:#1f2937;font-size:15px;">{name}</strong></td></tr>
          {f'<tr><td style="color:{accent};font-size:13px;font-weight:600;">{title}</td></tr>' if title else ''}
          {f'<tr><td style="color:#374151;font-size:13px;">{company}</td></tr>' if company else ''}
          <tr><td style="padding-top:8px;">{contact_html}</td></tr>
          {f'<tr><td style="padding-top:6px;color:#9ca3af;font-size:11px;line-height:1.4;">{address_html}</td></tr>' if address_html else ''}
          {f'<tr><td>{social_html}</td></tr>' if social_html else ''}
        </table>"""

    else:  # horizontal (default)
        return f"""
        <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;margin-top:16px;">
          <tr>
            {f'<td style="padding-right:14px;border-right:3px solid {accent};vertical-align:top;">{logo_html}</td>' if logo_html else f'<td style="padding-right:14px;border-right:3px solid {accent};vertical-align:top;"></td>'}
            <td style="padding-left:14px;vertical-align:top;">
              <strong style="color:#1f2937;font-size:15px;display:block;">{name}</strong>
              {f'<span style="color:{accent};font-size:13px;font-weight:600;display:block;">{title}</span>' if title else ''}
              {f'<span style="color:#374151;font-size:13px;display:block;margin-bottom:6px;">{company}</span>' if company else '<span style="display:block;margin-bottom:6px;"></span>'}
              {contact_html}
              {f'<div style="margin-top:6px;color:#9ca3af;font-size:11px;line-height:1.4;">{address_html}</div>' if address_html else ''}
              {social_html}
            </td>
          </tr>
        </table>"""


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
            "SELECT * FROM outreach_contacts WHERE id = ? AND case_id = ? AND tenant_id = ?",
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

class TemplateCustomHTML(BaseModel):
    template_type: str
    custom_html: str

class AITemplateEditRequest(BaseModel):
    template_type: str
    current_html: str
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


@router.get("/template-custom/{template_type}")
async def get_custom_template(template_type: str, current_user: dict = Depends(get_current_user)):
    """Get custom HTML override for a specific template type."""
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
async def save_custom_template(body: TemplateCustomHTML, current_user: dict = Depends(get_current_user)):
    """Save a custom HTML override for a specific template."""
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
                UPDATE email_template_custom SET custom_html=?, updated_at=?, updated_by=?
                WHERE tenant_id=? AND template_type=?
            """, (body.custom_html, now, user_email, tenant_id, body.template_type))
        else:
            db.execute("""
                INSERT INTO email_template_custom
                    (id, tenant_id, template_type, custom_html, created_at, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (generate_id(), tenant_id, body.template_type, body.custom_html,
                  now, now, user_email))
        db.commit()
    return {"ok": True}


@router.delete("/template-custom/{template_type}")
async def delete_custom_template(template_type: str, current_user: dict = Depends(get_current_user)):
    """Delete custom HTML override, reverting to default template."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        db.execute(
            "DELETE FROM email_template_custom WHERE tenant_id = ? AND template_type = ?",
            (tenant_id, template_type)
        )
        db.commit()
    return {"ok": True}


@router.post("/template-ai-edit")
async def ai_edit_template(body: AITemplateEditRequest, current_user: dict = Depends(get_current_user)):
    """Use AI (Anthropic) to edit a template based on user instructions."""
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="No AI provider configured. Set ANTHROPIC_API_KEY.")

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": f"""You are an expert email template designer for a legal firm.
You will be given an HTML email template and instructions to modify it.
Return ONLY the modified HTML — no explanations, no markdown code fences, just pure HTML.
Keep the template professional, legally appropriate, and well-formatted.
Maintain all template variables like {{contact_name}}, {{amount_owed}}, etc.

CURRENT HTML:
{body.current_html}

USER INSTRUCTIONS:
{body.instructions}

Return the modified HTML only:"""
            }]
        )
        new_html = message.content[0].text.strip()
        # Remove markdown fences if AI accidentally adds them
        if new_html.startswith("```"):
            lines = new_html.split("\n")
            new_html = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
        return {"html": new_html}
    except Exception as e:
        logger.error(f"AI template edit failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI editing failed: {str(e)}")


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
        sender_name = req.from_name or (user_row["full_name"] if user_row else "Attorney")
        case_row = db.execute("SELECT title, case_number FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case_row:
            raise HTTPException(404, "Case not found")
        case_title = case_row["title"]
        case_number = case_row["case_number"] or ""

        campaign_id = generate_id()
        db.execute(
            """INSERT INTO case_campaigns (id, case_id, tenant_id, created_by, firm_name, firm_address,
               firm_phone, from_name, additional_notes, status, litigation_type,
               schedule_day_1, schedule_day_2, schedule_day_3, schedule_day_4, schedule_day_5,
               created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?)""",
            (campaign_id, case_id, tenant_id, user_id, req.firm_name, req.firm_address or "",
             req.firm_phone or "", sender_name, req.additional_notes or "",
             req.litigation_type,
             req.schedule_day_1, req.schedule_day_2, req.schedule_day_3, req.schedule_day_4,
             req.schedule_day_5, now, now)
        )

        # Pre-generate all 5 emails for each contact
        templates = [
            ("initial_demand", req.schedule_day_1, _template_initial_demand),
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

            for step_num, (tpl_type, send_day, tpl_func) in enumerate(templates, 1):
                if tpl_type == "follow_up":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, req.firm_name, sender_name,
                        7, req.firm_address or "", req.firm_phone or "",
                        req.additional_notes or "", case_title, case_number, 2,
                    )
                elif tpl_type == "follow_up_2":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, req.firm_name, sender_name,
                        5, req.firm_address or "", req.firm_phone or "",
                        req.additional_notes or "", case_title, case_number, 3,
                    )
                elif tpl_type == "final_notice":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, req.firm_name, sender_name,
                        5, req.firm_address or "", req.firm_phone or "",
                        req.additional_notes or "", case_title, case_number, 4,
                    )
                elif tpl_type == "notice_of_intent":
                    subject, html = tpl_func(
                        contact["name"], amount, currency, req.firm_name, sender_name,
                        5, req.firm_address or "", req.firm_phone or "",
                        req.additional_notes or "", case_title, case_number, 5,
                        req.litigation_type,
                    )
                else:
                    subject, html = tpl_func(
                        contact["name"], amount, currency, req.firm_name, sender_name,
                        14, req.firm_address or "", req.firm_phone or "",
                        req.additional_notes or "", case_title, case_number,
                    )

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
                """SELECT ce.*, cc.name as contact_name, cc.email as contact_email
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
