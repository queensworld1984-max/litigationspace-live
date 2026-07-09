"""Pydantic schemas for request/response validation."""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr


# Auth schemas
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "attorney"
    tenant_name: Optional[str] = None
    tenant_type: str = "law_firm"
    bar_number: Optional[str] = None
    jurisdiction: Optional[str] = None
    specializations: Optional[str] = None
    hourly_rate: Optional[float] = None
    bio: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# Expert schemas
class ExpertStatusUpdate(BaseModel):
    status: str  # READY, BUSY, LOCKED


class ExpertHireRequest(BaseModel):
    case_id: str
    role: str = "consultant"
    access_level: str = "read"
    hours: Optional[int] = None


# Case schemas
class CaseCreate(BaseModel):
    title: str
    case_number: Optional[str] = None
    case_type: str
    status: str = "active"
    description: Optional[str] = None
    client_name: Optional[str] = None
    opposing_party: Optional[str] = None
    court: Optional[str] = None
    judge: Optional[str] = None
    filing_deadline: Optional[str] = None
    trial_date: Optional[str] = None
    uscis_receipt_number: Optional[str] = None
    priority: str = "medium"
    exhibit_numbering: str = "letters"  # "letters" (A,B,C) or "numbers" (1,2,3)


class CaseUpdate(BaseModel):
    title: Optional[str] = None
    case_number: Optional[str] = None
    case_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    client_name: Optional[str] = None
    opposing_party: Optional[str] = None
    court: Optional[str] = None
    judge: Optional[str] = None
    filing_deadline: Optional[str] = None
    trial_date: Optional[str] = None
    uscis_receipt_number: Optional[str] = None
    completion_percentage: Optional[float] = None
    assigned_attorney_id: Optional[str] = None
    exhibit_numbering: Optional[str] = None  # "letters" or "numbers"


# Task schemas
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    priority: str = "medium"
    parent_task_id: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None


# Document schemas
class DocumentCreate(BaseModel):
    filename: str
    category: str = "general"
    content_text: Optional[str] = None


class ShareLinkResponse(BaseModel):
    share_url: str
    expires_at: str


# Timeline schemas
class TimelineEventCreate(BaseModel):
    event_date: str
    title: str
    description: Optional[str] = None
    event_type: str = "general"
    evidence_ids: Optional[str] = None
    position_x: float = 0
    position_y: float = 0


class TimelineEventUpdate(BaseModel):
    event_date: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    evidence_ids: Optional[str] = None
    position_x: Optional[float] = None
    position_y: Optional[float] = None


# Contradiction schemas
class ContradictionCreate(BaseModel):
    source_a_type: str
    source_a_id: str
    source_a_text: Optional[str] = None
    source_b_type: str
    source_b_id: str
    source_b_text: Optional[str] = None
    severity: str = "medium"
    notes: Optional[str] = None


# Waitlist schemas
class WaitlistJoinRequest(BaseModel):
    case_id: Optional[str] = None


# Workflow schemas
class WorkflowTemplateCreate(BaseModel):
    name: str
    case_type: str
    tasks_json: str


# Notification schemas
class NotificationUpdate(BaseModel):
    read: bool = True
