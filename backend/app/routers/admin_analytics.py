"""Admin Analytics Dashboard - restricted to admin email."""
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])

ADMIN_EMAILS = ["queensworld1984@gmail.com"]


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Only allow designated admin emails."""
    if user.get("email", "").lower() not in [e.lower() for e in ADMIN_EMAILS]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/overview")
async def get_analytics_overview(user: dict = Depends(require_admin)):
    """Full platform analytics overview."""
    with get_db() as db:
        # User stats
        total_users = db.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
        users_by_role = [dict(r) for r in db.execute(
            "SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC"
        ).fetchall()]

        # Signup trend (last 30 days)
        signup_trend = [dict(r) for r in db.execute(
            "SELECT DATE(created_at) as date, COUNT(*) as count FROM users "
            "WHERE created_at >= DATE('now', '-30 days') GROUP BY DATE(created_at) ORDER BY date"
        ).fetchall()]

        # Recent signups (last 20)
        recent_signups = [dict(r) for r in db.execute(
            "SELECT id, email, full_name, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 20"
        ).fetchall()]

        # Case stats
        total_cases = db.execute("SELECT COUNT(*) as cnt FROM cases").fetchone()["cnt"]
        cases_by_status = [dict(r) for r in db.execute(
            "SELECT status, COUNT(*) as count FROM cases GROUP BY status ORDER BY count DESC"
        ).fetchall()]
        cases_by_type = [dict(r) for r in db.execute(
            "SELECT case_type, COUNT(*) as count FROM cases GROUP BY case_type ORDER BY count DESC"
        ).fetchall()]

        # Document stats
        total_documents = db.execute("SELECT COUNT(*) as cnt FROM documents").fetchone()["cnt"]

        # Draft stats
        total_drafts = db.execute("SELECT COUNT(*) as cnt FROM legal_drafts").fetchone()["cnt"]
        drafts_by_status = [dict(r) for r in db.execute(
            "SELECT status, COUNT(*) as count FROM legal_drafts GROUP BY status ORDER BY count DESC"
        ).fetchall()]
        drafts_by_type = [dict(r) for r in db.execute(
            "SELECT document_type, COUNT(*) as count FROM legal_drafts GROUP BY document_type ORDER BY count DESC"
        ).fetchall()]

        # Motion Analyzer stats
        total_analyses = db.execute("SELECT COUNT(*) as cnt FROM motion_analysis_jobs").fetchone()["cnt"]
        analyses_by_status = [dict(r) for r in db.execute(
            "SELECT status, COUNT(*) as count FROM motion_analysis_jobs GROUP BY status ORDER BY count DESC"
        ).fetchall()]

        # Notification stats
        total_notifications = db.execute("SELECT COUNT(*) as cnt FROM notifications").fetchone()["cnt"]
        unread_notifications = db.execute("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0").fetchone()["cnt"]

        # Task stats
        total_tasks = db.execute("SELECT COUNT(*) as cnt FROM tasks").fetchone()["cnt"]
        tasks_by_status = [dict(r) for r in db.execute(
            "SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC"
        ).fetchall()]

        # Growth/Marketing stats
        total_prospects_firms = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
        total_prospects_experts = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
        total_leads = 0
        try:
            total_leads = db.execute("SELECT COUNT(*) as cnt FROM leads_motion_analyzer").fetchone()["cnt"]
        except Exception:
            pass

        # Email queue stats
        email_queued = 0
        email_sent = 0
        email_bounced = 0
        try:
            email_queued = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status = 'queued'").fetchone()["cnt"]
            email_sent = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status = 'sent'").fetchone()["cnt"]
            email_bounced = db.execute("SELECT COUNT(*) as cnt FROM email_bounces").fetchone()["cnt"]
        except Exception:
            pass

        # Blog & Social stats
        total_blogs = 0
        total_social = 0
        try:
            total_blogs = db.execute("SELECT COUNT(*) as cnt FROM blog_articles").fetchone()["cnt"]
            total_social = db.execute("SELECT COUNT(*) as cnt FROM social_posts").fetchone()["cnt"]
        except Exception:
            pass

        # Live Bench profiles
        total_live_bench = 0
        try:
            total_live_bench = db.execute("SELECT COUNT(*) as cnt FROM live_bench_profiles").fetchone()["cnt"]
        except Exception:
            pass

        # Cron job stats (last 20 runs)
        recent_cron = []
        try:
            recent_cron = [dict(r) for r in db.execute(
                "SELECT job_name, status, details, executed_at FROM cron_log ORDER BY executed_at DESC LIMIT 20"
            ).fetchall()]
        except Exception:
            pass

        # Judicial workspace stats
        total_judicial_cases = 0
        try:
            total_judicial_cases = db.execute("SELECT COUNT(*) as cnt FROM judicial_cases").fetchone()["cnt"]
        except Exception:
            pass

        # Jurisdiction/Legal Database stats
        total_jurisdiction_docs = 0
        try:
            total_jurisdiction_docs = db.execute("SELECT COUNT(*) as cnt FROM jurisdiction_documents").fetchone()["cnt"]
        except Exception:
            pass

        # Daily activity (last 30 days) - cases created
        cases_trend = [dict(r) for r in db.execute(
            "SELECT DATE(created_at) as date, COUNT(*) as count FROM cases "
            "WHERE created_at >= DATE('now', '-30 days') GROUP BY DATE(created_at) ORDER BY date"
        ).fetchall()]

        # Drafts created trend (last 30 days)
        drafts_trend = [dict(r) for r in db.execute(
            "SELECT DATE(created_at) as date, COUNT(*) as count FROM legal_drafts "
            "WHERE created_at >= DATE('now', '-30 days') GROUP BY DATE(created_at) ORDER BY date"
        ).fetchall()]

    return {
        "users": {
            "total": total_users,
            "by_role": users_by_role,
            "signup_trend": signup_trend,
            "recent_signups": recent_signups,
        },
        "cases": {
            "total": total_cases,
            "by_status": cases_by_status,
            "by_type": cases_by_type,
            "trend": cases_trend,
        },
        "documents": {
            "total": total_documents,
        },
        "drafts": {
            "total": total_drafts,
            "by_status": drafts_by_status,
            "by_type": drafts_by_type,
            "trend": drafts_trend,
        },
        "motion_analyzer": {
            "total": total_analyses,
            "by_status": analyses_by_status,
        },
        "notifications": {
            "total": total_notifications,
            "unread": unread_notifications,
        },
        "tasks": {
            "total": total_tasks,
            "by_status": tasks_by_status,
        },
        "growth": {
            "prospects_firms": total_prospects_firms,
            "prospects_experts": total_prospects_experts,
            "leads": total_leads,
            "email_queued": email_queued,
            "email_sent": email_sent,
            "email_bounced": email_bounced,
            "blogs": total_blogs,
            "social_posts": total_social,
        },
        "live_bench": {
            "total_profiles": total_live_bench,
        },
        "judicial": {
            "total_cases": total_judicial_cases,
        },
        "legal_database": {
            "total_documents": total_jurisdiction_docs,
        },
        "recent_cron": recent_cron,
    }
