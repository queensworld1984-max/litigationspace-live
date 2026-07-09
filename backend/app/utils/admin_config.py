"""
Shared admin access configuration for internal dashboards.

Only accounts listed in ALLOWED_INTERNAL_DASHBOARD_EMAILS may access:
  - Marketing Growth OS  (/api/growth/* — non-public endpoints)
  - Analytics Dashboard  (/api/admin/analytics/*)

Use require_internal_dashboard as a FastAPI Depends() in any route that
must be restricted to these accounts.  The same list is mirrored on the
frontend in src/lib/adminConfig.ts — keep both in sync.
"""
from fastapi import Depends, HTTPException
from app.utils.auth import get_current_user

ALLOWED_INTERNAL_DASHBOARD_EMAILS: list[str] = [
    "queensworld1984@gmail.com",
    "dorothypierce84@gmail.com",
]

_ALLOWED_LOWER: list[str] = [e.lower() for e in ALLOWED_INTERNAL_DASHBOARD_EMAILS]


def require_internal_dashboard(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — restrict access to internal dashboard allowlist."""
    if user.get("email", "").lower() not in _ALLOWED_LOWER:
        raise HTTPException(status_code=403, detail="Unauthorized")
    return user
