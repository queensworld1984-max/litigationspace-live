"""Notifications router."""
from fastapi import APIRouter, Depends

from app.database import get_db
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(
    unread_only: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """Get notifications for the current user."""
    with get_db() as db:
        query = "SELECT * FROM notifications WHERE user_id = ?"
        params: list = [current_user["sub"]]
        if unread_only:
            query += " AND read = 0"
        query += " ORDER BY created_at DESC LIMIT 50"
        notifications = db.execute(query, params).fetchall()
        return [dict(n) for n in notifications]


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a notification as read."""
    with get_db() as db:
        db.execute(
            "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
            (notification_id, current_user["sub"])
        )
        return {"status": "read"}


@router.post("/read-all")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    """Mark all notifications as read."""
    with get_db() as db:
        db.execute(
            "UPDATE notifications SET read = 1 WHERE user_id = ?",
            (current_user["sub"],)
        )
        return {"status": "all_read"}
