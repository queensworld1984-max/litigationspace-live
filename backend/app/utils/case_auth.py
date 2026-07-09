"""Shared case-access authorization for the per-case collaborator system.

There are two independent ways to be authorized for a case:

  1. Firm member — current_user['tenant_id'] matches the case's tenant_id.
     This is the original, unrestricted access model: any authenticated
     member of the firm's tenant can see every case that tenant owns.

  2. Case collaborator — an active `case_collaborators` row links
     current_user['sub'] to this exact case_id. Access is then gated by
     the `permissions` JSON on that row (view_documents, upload_documents,
     view_tasks, edit_tasks, view_witnesses, view_discovery, etc).
     Collaborators are deliberately scoped to the single case they were
     invited to — not the tenant — so a witness or client invited to one
     matter can never see the firm's other cases.
"""
import json
from fastapi import HTTPException


def resolve_case_access(case_id: str, current_user: dict, db, required_permission: str = None) -> dict:
    """Return the case row (as a dict) if current_user may access it.

    Raises HTTPException(404) if the case doesn't exist or the user has no
    access to it at all, or HTTPException(403) if the user is a collaborator
    who lacks the specific required_permission.
    """
    tenant_id = current_user["tenant_id"]
    user_id = current_user["sub"]

    case = db.execute(
        "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
        (case_id, tenant_id)
    ).fetchone()
    if case:
        return dict(case)

    # Not a firm member for this case's tenant — check for a collaborator grant.
    collab = db.execute(
        """SELECT * FROM case_collaborators
           WHERE case_id = ? AND user_id = ? AND status = 'active'""",
        (case_id, user_id)
    ).fetchone()
    if not collab:
        raise HTTPException(status_code=404, detail="Case not found")

    if required_permission:
        perms = json.loads(collab["permissions"] or "{}")
        if not perms.get(required_permission):
            raise HTTPException(status_code=403, detail="You don't have permission to do this")

    case = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return dict(case)
