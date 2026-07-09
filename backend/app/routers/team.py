"""Team management router - invitations, members, case access, activity tracking."""
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import secrets
import json

from app.database import get_db
from app.utils.auth import get_current_user, generate_id, hash_password
from app.utils.email import send_team_invitation_email

router = APIRouter(prefix="/api/v1/team", tags=["team"])


# --- Request/Response schemas ---

class InviteRequest(BaseModel):
    email: str
    role: str = "paralegal"
    message: Optional[str] = None

class UpdateRoleRequest(BaseModel):
    role: str

class CaseAccessRequest(BaseModel):
    user_id: str
    access_level: str = "view"

class AcceptInviteRequest(BaseModel):
    token: str
    full_name: str
    password: str


def _log_activity(db, tenant_id: str, user_id: str, user_name: str, action: str,
                  resource_type: str = None, resource_id: str = None, resource_name: str = None,
                  metadata: dict = None):
    """Log an activity event."""
    db.execute(
        """INSERT INTO activity_log (id, tenant_id, user_id, user_name, action, resource_type,
           resource_id, resource_name, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (generate_id(), tenant_id, user_id, user_name, action,
         resource_type, resource_id, resource_name,
         json.dumps(metadata) if metadata else None,
         datetime.now(timezone.utc).isoformat())
    )


# ──────────────────────────────────────────
# Team Members
# ──────────────────────────────────────────

@router.get("/members")
async def list_members(current_user: dict = Depends(get_current_user)):
    """List all team members in the current tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        members = db.execute(
            """SELECT id, email, full_name, role, status, avatar_url, bio,
                      bar_number, jurisdiction, specializations, hourly_rate,
                      created_at, last_heartbeat
               FROM users WHERE tenant_id = ?
               ORDER BY created_at ASC""",
            (tenant_id,)
        ).fetchall()
        result = []
        for m in members:
            d = dict(m)
            # Determine online status based on last_heartbeat
            if d.get("last_heartbeat"):
                try:
                    hb = datetime.fromisoformat(d["last_heartbeat"])
                    if hb.tzinfo is None:
                        hb = hb.replace(tzinfo=timezone.utc)
                    diff = (datetime.now(timezone.utc) - hb).total_seconds()
                    d["online"] = diff < 120  # Online if heartbeat within 2 minutes
                except (ValueError, TypeError):
                    d["online"] = False
            else:
                d["online"] = False
            result.append(d)
        return {"members": result, "total": len(result)}


@router.put("/members/{user_id}/role")
async def update_member_role(user_id: str, req: UpdateRoleRequest,
                              current_user: dict = Depends(get_current_user)):
    """Update a team member's role. Only admins can do this."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "expert"):
        raise HTTPException(status_code=403, detail="Only admins can change roles")
    if user_id == current_user["sub"]:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    valid_roles = ("admin", "attorney", "paralegal", "client")
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    with get_db() as db:
        user = db.execute(
            "SELECT id, full_name FROM users WHERE id = ? AND tenant_id = ?",
            (user_id, tenant_id)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found in your team")
        db.execute("UPDATE users SET role = ? WHERE id = ?", (req.role, user_id))
        _log_activity(db, tenant_id, current_user["sub"], current_user.get("email", ""),
                      "changed_role", "user", user_id, user["full_name"],
                      {"new_role": req.role})
    return {"message": f"Role updated to {req.role}", "user_id": user_id}


@router.delete("/members/{user_id}")
async def remove_member(user_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a team member. Only admins can do this."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "expert"):
        raise HTTPException(status_code=403, detail="Only admins can remove members")
    if user_id == current_user["sub"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    with get_db() as db:
        user = db.execute(
            "SELECT id, full_name, email FROM users WHERE id = ? AND tenant_id = ?",
            (user_id, tenant_id)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found in your team")
        # Remove case access entries
        db.execute("DELETE FROM case_access WHERE user_id = ? AND tenant_id = ?", (user_id, tenant_id))
        # Remove the user
        db.execute("DELETE FROM users WHERE id = ? AND tenant_id = ?", (user_id, tenant_id))
        _log_activity(db, tenant_id, current_user["sub"], current_user.get("email", ""),
                      "removed_member", "user", user_id, user["full_name"])
    return {"message": "Member removed", "user_id": user_id}


# ──────────────────────────────────────────
# Invitations
# ──────────────────────────────────────────

@router.post("/invite")
async def invite_member(req: InviteRequest, current_user: dict = Depends(get_current_user)):
    """Send a team invitation email."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "attorney", "expert"):
        raise HTTPException(status_code=403, detail="Only admins and attorneys can invite members")

    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    valid_roles = ("admin", "attorney", "paralegal", "client", "expert")
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    with get_db() as db:
        # Check if user already exists in this tenant
        existing = db.execute(
            "SELECT id FROM users WHERE LOWER(email) = ? AND tenant_id = ?",
            (email, tenant_id)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="This person is already a member of your team")

        # Check for pending invitation
        pending = db.execute(
            "SELECT id FROM team_invitations WHERE LOWER(email) = ? AND tenant_id = ? AND status = 'pending'",
            (email, tenant_id)
        ).fetchone()
        if pending:
            raise HTTPException(status_code=400, detail="An invitation is already pending for this email")

        # Get inviter info
        inviter = db.execute(
            "SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)
        ).fetchone()
        inviter_name = inviter["full_name"] if inviter else current_user.get("email", "")

        # Get tenant name
        tenant = db.execute("SELECT name FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
        tenant_name = tenant["name"] if tenant else "Your Team"

        # Create invitation
        invite_id = generate_id()
        token = secrets.token_urlsafe(48)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

        db.execute(
            """INSERT INTO team_invitations (id, tenant_id, invited_by, email, role, status, token, expires_at, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
            (invite_id, tenant_id, current_user["sub"], email, req.role, token, expires_at,
             datetime.now(timezone.utc).isoformat())
        )

        # Send invitation email
        send_team_invitation_email(
            to_email=email,
            inviter_name=inviter_name,
            tenant_name=tenant_name,
            role=req.role,
            token=token,
            message=req.message
        )

        _log_activity(db, tenant_id, current_user["sub"], inviter_name,
                      "sent_invitation", "invitation", invite_id, email,
                      {"role": req.role})

    return {"message": f"Invitation sent to {email}", "invitation_id": invite_id}


@router.get("/invitations")
async def list_invitations(current_user: dict = Depends(get_current_user)):
    """List all invitations for this tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        invitations = db.execute(
            """SELECT ti.*, u.full_name as inviter_name
               FROM team_invitations ti
               LEFT JOIN users u ON ti.invited_by = u.id
               WHERE ti.tenant_id = ?
               ORDER BY ti.created_at DESC""",
            (tenant_id,)
        ).fetchall()
        result = []
        now = datetime.now(timezone.utc)
        for inv in invitations:
            d = dict(inv)
            # Auto-expire old invitations
            if d["status"] == "pending" and d.get("expires_at"):
                try:
                    exp = datetime.fromisoformat(d["expires_at"])
                    if exp.tzinfo is None:
                        exp = exp.replace(tzinfo=timezone.utc)
                    if now > exp:
                        d["status"] = "expired"
                        db.execute("UPDATE team_invitations SET status = 'expired' WHERE id = ?", (d["id"],))
                except (ValueError, TypeError):
                    pass
            result.append(d)
        return {"invitations": result, "total": len(result)}


@router.post("/invitations/{invitation_id}/revoke")
async def revoke_invitation(invitation_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a pending invitation."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "attorney", "expert"):
        raise HTTPException(status_code=403, detail="Only admins and attorneys can revoke invitations")

    with get_db() as db:
        inv = db.execute(
            "SELECT id, email FROM team_invitations WHERE id = ? AND tenant_id = ? AND status = 'pending'",
            (invitation_id, tenant_id)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Invitation not found or already processed")
        db.execute("UPDATE team_invitations SET status = 'revoked' WHERE id = ?", (invitation_id,))
        _log_activity(db, tenant_id, current_user["sub"], current_user.get("email", ""),
                      "revoked_invitation", "invitation", invitation_id, inv["email"])
    return {"message": "Invitation revoked"}


@router.post("/invitations/{invitation_id}/resend")
async def resend_invitation(invitation_id: str, current_user: dict = Depends(get_current_user)):
    """Resend a pending invitation with a fresh token and expiry."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "attorney", "expert"):
        raise HTTPException(status_code=403, detail="Only admins and attorneys can resend invitations")

    with get_db() as db:
        inv = db.execute(
            "SELECT id, email, role FROM team_invitations WHERE id = ? AND tenant_id = ?",
            (invitation_id, tenant_id)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Invitation not found")

        # Generate fresh token + expiry
        new_token = secrets.token_urlsafe(48)
        new_expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        db.execute(
            "UPDATE team_invitations SET token = ?, expires_at = ?, status = 'pending' WHERE id = ?",
            (new_token, new_expires, invitation_id)
        )

        # Get inviter info + tenant name
        inviter = db.execute("SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)).fetchone()
        inviter_name = inviter["full_name"] if inviter else current_user.get("email", "")
        tenant = db.execute("SELECT name FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
        tenant_name = tenant["name"] if tenant else "Your Team"

        send_team_invitation_email(
            to_email=inv["email"],
            inviter_name=inviter_name,
            tenant_name=tenant_name,
            role=inv["role"],
            token=new_token
        )
    return {"message": f"Invitation resent to {inv['email']}"}


# ──────────────────────────────────────────
# Accept Invitation (public — no auth required)
# ──────────────────────────────────────────

@router.post("/accept-invite")
async def accept_invite(req: AcceptInviteRequest):
    """Accept a team invitation and create account."""
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not req.full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")

    with get_db() as db:
        inv = db.execute(
            """SELECT ti.*, t.name as tenant_name
               FROM team_invitations ti
               JOIN tenants t ON ti.tenant_id = t.id
               WHERE ti.token = ? AND ti.status = 'pending'""",
            (req.token,)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=400, detail="Invalid or expired invitation link")

        # Check expiry
        if inv["expires_at"]:
            try:
                exp = datetime.fromisoformat(inv["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp:
                    db.execute("UPDATE team_invitations SET status = 'expired' WHERE id = ?", (inv["id"],))
                    raise HTTPException(status_code=400, detail="Invitation has expired. Please ask for a new one.")
            except ValueError:
                pass

        # Check if email already registered
        existing = db.execute(
            "SELECT id FROM users WHERE LOWER(email) = ?", (inv["email"].lower(),)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="An account with this email already exists. Please sign in instead.")

        # Create user in the inviter's tenant
        user_id = generate_id()
        pw_hash = hash_password(req.password)
        now = datetime.now(timezone.utc).isoformat()

        db.execute(
            """INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, status,
                                  email_verified, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'READY', 1, ?)""",
            (user_id, inv["tenant_id"], inv["email"].lower(), pw_hash,
             req.full_name.strip(), inv["role"], now)
        )

        # Mark invitation as accepted
        db.execute(
            "UPDATE team_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
            (now, inv["id"])
        )

        # Log activity
        _log_activity(db, inv["tenant_id"], user_id, req.full_name.strip(),
                      "joined_team", "user", user_id, req.full_name.strip(),
                      {"role": inv["role"], "invited_by": inv["invited_by"]})

        # Generate auth token
        from app.utils.auth import create_access_token
        token = create_access_token(user_id, inv["tenant_id"], inv["role"], inv["email"].lower())

    return {
        "message": f"Welcome to {inv['tenant_name']}!",
        "access_token": token,
        "user": {
            "id": user_id,
            "tenant_id": inv["tenant_id"],
            "email": inv["email"].lower(),
            "full_name": req.full_name.strip(),
            "role": inv["role"],
        }
    }


@router.get("/invite-info/{token}")
async def get_invite_info(token: str):
    """Get invitation details (public — no auth). Used by the accept-invite page."""
    with get_db() as db:
        inv = db.execute(
            """SELECT ti.email, ti.role, ti.status, ti.expires_at, t.name as tenant_name,
                      u.full_name as inviter_name
               FROM team_invitations ti
               JOIN tenants t ON ti.tenant_id = t.id
               LEFT JOIN users u ON ti.invited_by = u.id
               WHERE ti.token = ?""",
            (token,)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Invitation not found")

        d = dict(inv)
        # Check expiry
        if d["status"] == "pending" and d.get("expires_at"):
            try:
                exp = datetime.fromisoformat(d["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp:
                    d["status"] = "expired"
            except (ValueError, TypeError):
                pass

        return {
            "email": d["email"],
            "role": d["role"],
            "status": d["status"],
            "tenant_name": d["tenant_name"],
            "inviter_name": d.get("inviter_name", ""),
        }


# ──────────────────────────────────────────
# Case Access Control
# ──────────────────────────────────────────

@router.get("/cases/{case_id}/access")
async def list_case_access(case_id: str, current_user: dict = Depends(get_current_user)):
    """List who has access to a specific case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        # Verify case belongs to tenant
        case = db.execute(
            "SELECT id, title FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        access_list = db.execute(
            """SELECT ca.*, u.full_name, u.email, u.role as user_role, u.avatar_url
               FROM case_access ca
               JOIN users u ON ca.user_id = u.id
               WHERE ca.case_id = ? AND ca.tenant_id = ?
               ORDER BY ca.granted_at ASC""",
            (case_id, tenant_id)
        ).fetchall()
        return {"access": [dict(a) for a in access_list], "case_title": case["title"]}


@router.post("/cases/{case_id}/access")
async def grant_case_access(case_id: str, req: CaseAccessRequest,
                             current_user: dict = Depends(get_current_user)):
    """Grant a team member access to a case."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "attorney", "expert"):
        raise HTTPException(status_code=403, detail="Only admins and attorneys can manage case access")

    valid_levels = ("view", "edit", "manage")
    if req.access_level not in valid_levels:
        raise HTTPException(status_code=400, detail=f"Invalid access level. Must be: {', '.join(valid_levels)}")

    with get_db() as db:
        # Verify case
        case = db.execute(
            "SELECT id, title FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # Verify user is in same tenant
        target_user = db.execute(
            "SELECT id, full_name FROM users WHERE id = ? AND tenant_id = ?",
            (req.user_id, tenant_id)
        ).fetchone()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found in your team")

        # Upsert access
        existing = db.execute(
            "SELECT id FROM case_access WHERE case_id = ? AND user_id = ?",
            (case_id, req.user_id)
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE case_access SET access_level = ? WHERE id = ?",
                (req.access_level, existing["id"])
            )
        else:
            db.execute(
                """INSERT INTO case_access (id, case_id, user_id, tenant_id, access_level, granted_by, granted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (generate_id(), case_id, req.user_id, tenant_id, req.access_level,
                 current_user["sub"], datetime.now(timezone.utc).isoformat())
            )

        _log_activity(db, tenant_id, current_user["sub"], current_user.get("email", ""),
                      "granted_case_access", "case", case_id, case["title"],
                      {"user_id": req.user_id, "user_name": target_user["full_name"],
                       "access_level": req.access_level})

    return {"message": f"Access granted to {target_user['full_name']}", "access_level": req.access_level}


@router.delete("/cases/{case_id}/access/{user_id}")
async def revoke_case_access(case_id: str, user_id: str,
                              current_user: dict = Depends(get_current_user)):
    """Revoke a team member's access to a case."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in ("admin", "attorney", "expert"):
        raise HTTPException(status_code=403, detail="Only admins and attorneys can manage case access")

    with get_db() as db:
        access = db.execute(
            "SELECT id FROM case_access WHERE case_id = ? AND user_id = ? AND tenant_id = ?",
            (case_id, user_id, tenant_id)
        ).fetchone()
        if not access:
            raise HTTPException(status_code=404, detail="Access entry not found")
        db.execute("DELETE FROM case_access WHERE id = ?", (access["id"],))

        user = db.execute("SELECT full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        case = db.execute("SELECT title FROM cases WHERE id = ?", (case_id,)).fetchone()
        _log_activity(db, tenant_id, current_user["sub"], current_user.get("email", ""),
                      "revoked_case_access", "case", case_id,
                      case["title"] if case else "",
                      {"user_id": user_id, "user_name": user["full_name"] if user else ""})

    return {"message": "Access revoked"}


# ──────────────────────────────────────────
# Activity Log
# ──────────────────────────────────────────

@router.get("/activity")
async def get_activity(limit: int = 50, offset: int = 0,
                       current_user: dict = Depends(get_current_user)):
    """Get activity log for the tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        activities = db.execute(
            """SELECT * FROM activity_log
               WHERE tenant_id = ?
               ORDER BY created_at DESC
               LIMIT ? OFFSET ?""",
            (tenant_id, min(limit, 200), offset)
        ).fetchall()
        total = db.execute(
            "SELECT COUNT(*) as cnt FROM activity_log WHERE tenant_id = ?",
            (tenant_id,)
        ).fetchone()["cnt"]
        return {"activities": [dict(a) for a in activities], "total": total}


@router.get("/activity/case/{case_id}")
async def get_case_activity(case_id: str, limit: int = 50,
                             current_user: dict = Depends(get_current_user)):
    """Get activity log for a specific case."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        activities = db.execute(
            """SELECT * FROM activity_log
               WHERE tenant_id = ? AND resource_type = 'case' AND resource_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (tenant_id, case_id, min(limit, 200))
        ).fetchall()
        return {"activities": [dict(a) for a in activities]}
