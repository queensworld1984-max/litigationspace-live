"""
Growth OS Router — Multi-site Marketing Automation
===================================================
Supports two sites via the `website_id` / `site` field:
  ls  — LitigationSpace (litigationspace.com)   default; all legacy paths
  bc  — Build Champions  (buildchampions.org)    nonprofit; requires explicit activation

Site-aware endpoints accept an optional `site` query param (default: 'ls').
All database rows carry a `website_id` column set at write time.

── LitigationSpace env vars (VPS .env) ────────────────────────────────────────
OPENAI_API_KEY                      AI generation (shared by both sites)
FACEBOOK_PAGE_ID                    LS page ID  (legacy — still accepted)
FACEBOOK_PAGE_ACCESS_TOKEN          LS token    (legacy — still accepted)
FACEBOOK_PAGE_ID_LS                 LS page ID  (preferred explicit form)
FACEBOOK_PAGE_ACCESS_TOKEN_LS       LS token    (preferred explicit form)
SERPAPI_KEY                         Lead discovery (LS only)
CRON_SECRET                         Shared cron trigger secret (default: ls-cron-2026)

── Build Champions activation env vars ─────────────────────────────────────────
FACEBOOK_PAGE_ID_BC                 BC Facebook page numeric ID
FACEBOOK_PAGE_ACCESS_TOKEN_BC       BC long-lived page access token

  Until FACEBOOK_PAGE_ID_BC is set the facebook_publish job for site=bc returns
  {"status": "skipped"} — BC content is never published to the LS page.

── Cron jobs and site support ──────────────────────────────────────────────────
Site-aware (run with site=ls or site=bc):
  blog_publish     social_publish     facebook_publish

LS-only (always run for LitigationSpace regardless of site param):
  lead_discovery   expert_recruitment   competitor_analysis   keyword_ranking
  email_queue_process   live_bench_profiles   email_enrichment

Integrations: OpenAI (content generation), SerpAPI (lead discovery).
"""
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json
import hashlib
import os
import logging

from app.database import get_db
from app.utils.auth import get_current_user, generate_id
from app.utils.model_router import get_model_for_task
from app.routers.billing import generate_weekly_invoices, send_deadline_reminders

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/growth", tags=["growth"])


# ================================================================
# PYDANTIC MODELS
# ================================================================

class ProspectLawfirm(BaseModel):
    firm_name: str
    attorney_name: Optional[str] = ""
    practice_area: Optional[str] = ""
    location: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    website: Optional[str] = ""
    linkedin: Optional[str] = ""

class ProspectExpert(BaseModel):
    name: str
    role_type: str = "EXPERT_WITNESS"
    practice_area: Optional[str] = ""
    jurisdiction: Optional[str] = ""
    email: Optional[str] = ""
    linkedin: Optional[str] = ""

class EmailSequence(BaseModel):
    sequence_name: str
    step: int = 1
    delay_days: int = 0
    subject: str
    body: str

class LeadCapture(BaseModel):
    email: str
    firm_name: Optional[str] = ""
    practice_area: Optional[str] = ""
    jurisdiction: Optional[str] = ""
    source: Optional[str] = "motion_analyzer"

class SocialPost(BaseModel):
    platform: str
    content: str
    post_type: Optional[str] = "text"
    scheduled_at: Optional[str] = None
    website_id: Optional[str] = "ls"

class BlogArticle(BaseModel):
    title: str
    slug: str
    content: str
    category: Optional[str] = "general"
    meta_description: Optional[str] = ""
    target_keywords: Optional[str] = ""
    website_id: Optional[str] = "ls"

class ReferralCreate(BaseModel):
    referrer_email: str
    referee_email: str

class GrowthConfig(BaseModel):
    key: str
    value: str


# ================================================================
# PROSPECT LAW FIRMS
# ================================================================

@router.get("/prospects/lawfirms")
async def list_lawfirm_prospects(
    status: Optional[str] = None,
    practice_area: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    with get_db() as db:
        query = "SELECT * FROM prospects_lawfirms WHERE 1=1"
        params: list = []
        if status:
            query += " AND lead_status = ?"
            params.append(status)
        if practice_area:
            query += " AND practice_area LIKE ?"
            params.append(f"%{practice_area}%")
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total, "page": page}


@router.post("/prospects/lawfirms")
async def create_lawfirm_prospect(data: ProspectLawfirm, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        pid = generate_id()
        db.execute(
            """INSERT INTO prospects_lawfirms (id, firm_name, attorney_name, practice_area, location, email, phone, website, linkedin, lead_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)""",
            (pid, data.firm_name, data.attorney_name, data.practice_area, data.location,
             data.email, data.phone, data.website, data.linkedin, datetime.now(timezone.utc).isoformat())
        )
    return {"id": pid, "status": "created"}


@router.put("/prospects/lawfirms/{prospect_id}/status")
async def update_lawfirm_status(prospect_id: str, status: str = Query(...), current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("UPDATE prospects_lawfirms SET lead_status = ? WHERE id = ?", (status, prospect_id))
    return {"status": "updated"}


@router.delete("/prospects/lawfirms/{prospect_id}")
async def delete_lawfirm_prospect(prospect_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM prospects_lawfirms WHERE id = ?", (prospect_id,))
    return {"status": "deleted"}


# ================================================================
# PROSPECT EXPERTS
# ================================================================

@router.get("/prospects/experts")
async def list_expert_prospects(
    status: Optional[str] = None,
    role_type: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    with get_db() as db:
        query = "SELECT * FROM prospects_experts WHERE 1=1"
        params: list = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if role_type:
            query += " AND role_type = ?"
            params.append(role_type)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total, "page": page}


@router.post("/prospects/experts")
async def create_expert_prospect(data: ProspectExpert, current_user: dict = Depends(get_current_user)):
    valid_roles = ['FREELANCE_PARALEGAL', 'COURT_REPORTER', 'PROCESS_SERVER', 'EXPERT_WITNESS', 'CLERK_SUPPORT',
                   'CASE_MANAGER', 'FREELANCE_LAWYER', 'MEDIATOR', 'ARBITRATOR', 'IMMIGRATION_CONSULTANT']
    if data.role_type not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role_type. Must be one of: {valid_roles}")
    with get_db() as db:
        pid = generate_id()
        db.execute(
            """INSERT INTO prospects_experts (id, name, role_type, practice_area, jurisdiction, email, linkedin, status, invited, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 0, ?)""",
            (pid, data.name, data.role_type, data.practice_area, data.jurisdiction,
             data.email, data.linkedin, datetime.now(timezone.utc).isoformat())
        )
    return {"id": pid, "status": "created"}


@router.put("/prospects/experts/{prospect_id}/status")
async def update_expert_status(prospect_id: str, status: str = Query(...), current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("UPDATE prospects_experts SET status = ? WHERE id = ?", (status, prospect_id))
    return {"status": "updated"}


@router.put("/prospects/experts/{prospect_id}/invite")
async def mark_expert_invited(prospect_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("UPDATE prospects_experts SET invited = 1, status = 'invited' WHERE id = ?", (prospect_id,))
    return {"status": "invited"}


# ================================================================
# EMAIL SEQUENCES
# ================================================================

@router.get("/email-sequences")
async def list_email_sequences(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute("SELECT * FROM email_sequences ORDER BY sequence_name, step").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/email-sequences")
async def create_email_sequence(data: EmailSequence, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        sid = generate_id()
        db.execute(
            """INSERT INTO email_sequences (id, sequence_name, step, delay_days, subject, body, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (sid, data.sequence_name, data.step, data.delay_days, data.subject, data.body,
             datetime.now(timezone.utc).isoformat())
        )
    return {"id": sid, "status": "created"}


@router.put("/email-sequences/{seq_id}")
async def update_email_sequence(seq_id: str, data: EmailSequence, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute(
            "UPDATE email_sequences SET sequence_name=?, step=?, delay_days=?, subject=?, body=? WHERE id=?",
            (data.sequence_name, data.step, data.delay_days, data.subject, data.body, seq_id)
        )
    return {"status": "updated"}


@router.delete("/email-sequences/{seq_id}")
async def delete_email_sequence(seq_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM email_sequences WHERE id = ?", (seq_id,))
    return {"status": "deleted"}


# ================================================================
# OUTREACH ENGINE
# ================================================================

@router.post("/outreach/send")
async def send_outreach_email(prospect_id: str = Query(...), sequence_name: str = Query(...), current_user: dict = Depends(get_current_user)):
    smtp_host = os.environ.get("SMTP_HOST")
    if not smtp_host:
        return {"status": "skipped", "reason": "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS env vars."}

    with get_db() as db:
        prospect = db.execute("SELECT * FROM prospects_lawfirms WHERE id = ?", (prospect_id,)).fetchone()
        if not prospect:
            prospect = db.execute("SELECT * FROM prospects_experts WHERE id = ?", (prospect_id,)).fetchone()
        if not prospect:
            raise HTTPException(status_code=404, detail="Prospect not found")

        prospect_dict = dict(prospect)
        email = prospect_dict.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="Prospect has no email")

        seq_step = db.execute(
            "SELECT * FROM email_sequences WHERE sequence_name = ? ORDER BY step LIMIT 1",
            (sequence_name,)
        ).fetchone()
        if not seq_step:
            raise HTTPException(status_code=404, detail="Email sequence not found")

        seq_dict = dict(seq_step)
        name = prospect_dict.get("attorney_name") or prospect_dict.get("name", "")
        subject = seq_dict["subject"].replace("[Name]", name)
        body = seq_dict["body"].replace("[Name]", name)

        oid = generate_id()
        db.execute(
            """INSERT INTO outreach_log (id, prospect_id, prospect_type, sequence_name, step, subject, body, status, sent_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?)""",
            (oid, prospect_id, "lawfirm", sequence_name, seq_dict["step"], subject, body,
             datetime.now(timezone.utc).isoformat())
        )

        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            smtp_port = int(os.environ.get("SMTP_PORT", "587"))
            smtp_user = os.environ.get("SMTP_USER", "")
            smtp_pass = os.environ.get("SMTP_PASS", "")
            smtp_from = os.environ.get("SMTP_FROM", smtp_user)

            msg = MIMEMultipart()
            msg["From"] = smtp_from
            msg["To"] = email
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "html"))

            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if smtp_port not in (25,) and smtp_user and smtp_pass:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                server.send_message(msg)

            db.execute("UPDATE outreach_log SET status = 'delivered' WHERE id = ?", (oid,))
            return {"status": "sent", "to": email, "subject": subject}
        except Exception as e:
            db.execute("UPDATE outreach_log SET status = 'failed', error_msg = ? WHERE id = ?", (str(e), oid))
            return {"status": "failed", "error": str(e)}


@router.get("/outreach/log")
async def list_outreach_log(page: int = 1, limit: int = 50, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM outreach_log ORDER BY sent_at DESC LIMIT ? OFFSET ?",
            (limit, (page - 1) * limit)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM outreach_log").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


# ================================================================
# SOCIAL MEDIA ENGINE
# ================================================================

@router.get("/social/posts")
async def list_social_posts(platform: Optional[str] = None, site: Optional[str] = None, page: int = 1, limit: int = 50, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        query = "SELECT * FROM social_posts WHERE 1=1"
        params: list = []
        if platform:
            query += " AND platform = ?"
            params.append(platform)
        if site:
            query += " AND website_id = ?"
            params.append(site)
        count_query = "SELECT COUNT(*) as cnt FROM social_posts WHERE 1=1"
        count_params: list = []
        if platform:
            count_query += " AND platform = ?"
            count_params.append(platform)
        if site:
            count_query += " AND website_id = ?"
            count_params.append(site)
        query += " ORDER BY scheduled_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute(count_query, count_params).fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


@router.post("/social/posts")
async def create_social_post(data: SocialPost, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        pid = generate_id()
        scheduled = data.scheduled_at or datetime.now(timezone.utc).isoformat()
        site = data.website_id or "ls"
        db.execute(
            """INSERT INTO social_posts (id, platform, content, post_type, status, scheduled_at, created_at, website_id)
               VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)""",
            (pid, data.platform, data.content, data.post_type, scheduled, datetime.now(timezone.utc).isoformat(), site)
        )
    return {"id": pid, "status": "scheduled"}


@router.post("/social/posts/{post_id}/publish")
async def publish_social_post(post_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        post = db.execute("SELECT * FROM social_posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        post_dict = dict(post)
        platform = post_dict["platform"]
        site = post_dict.get("website_id") or "ls"

        # Resolve credentials for non-Facebook platforms (site-agnostic for now)
        platform_keys = {
            "linkedin": os.environ.get("LINKEDIN_ACCESS_TOKEN"),
            "twitter": os.environ.get("TWITTER_API_KEY"),
            "youtube": os.environ.get("YOUTUBE_API_KEY"),
            "tiktok": os.environ.get("TIKTOK_API_KEY"),
        }

        if platform == "facebook":
            # Use site-specific Facebook credentials
            result = _publish_to_facebook(post_dict["content"], site=site)
            if result.get("status") == "skipped":
                db.execute("UPDATE social_posts SET status = 'pending_api_key' WHERE id = ?", (post_id,))
                return {"status": "pending_api_key", "reason": result.get("reason")}
            if result.get("status") == "error":
                db.execute("UPDATE social_posts SET status = 'failed' WHERE id = ?", (post_id,))
                return {"status": "error", "error": result.get("error")}
        else:
            if not platform_keys.get(platform):
                db.execute("UPDATE social_posts SET status = 'pending_api_key' WHERE id = ?", (post_id,))
                return {"status": "pending_api_key", "reason": f"{platform} API key not configured"}

        db.execute("UPDATE social_posts SET status = 'published', published_at = ? WHERE id = ?",
                   (datetime.now(timezone.utc).isoformat(), post_id))
    return {"status": "published", "site": site}


# ================================================================
# BLOG / CONTENT ENGINE
# ================================================================

@router.get("/blog/articles")
async def list_blog_articles(category: Optional[str] = None, site: Optional[str] = None):
    with get_db() as db:
        # Exclude empty-content stubs (seeded but not yet AI-backfilled) so they never
        # render as broken blank articles to real visitors before the cron fills them in.
        query = "SELECT * FROM blog_articles WHERE content IS NOT NULL AND content != ''"
        params: list = []
        if category:
            query += " AND category = ?"
            params.append(category)
        if site:
            query += " AND website_id = ?"
            params.append(site)
        query += " ORDER BY created_at DESC"
        rows = db.execute(query, params).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/blog/articles/{slug}")
async def get_blog_article(slug: str):
    with get_db() as db:
        article = db.execute("SELECT * FROM blog_articles WHERE slug = ?", (slug,)).fetchone()
        if not article or not article["content"]:
            raise HTTPException(status_code=404, detail="Article not found")
        db.execute("UPDATE blog_articles SET view_count = view_count + 1 WHERE slug = ?", (slug,))
    return dict(article)


@router.post("/blog/articles")
async def create_blog_article(data: BlogArticle, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        aid = generate_id()
        site = data.website_id or "ls"
        db.execute(
            """INSERT INTO blog_articles (id, title, slug, content, category, meta_description, target_keywords, view_count, status, created_at, website_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?)""",
            (aid, data.title, data.slug, data.content, data.category, data.meta_description,
             data.target_keywords, datetime.now(timezone.utc).isoformat(), site)
        )
    return {"id": aid, "status": "created"}


@router.put("/blog/articles/{article_id}")
async def update_blog_article(article_id: str, data: BlogArticle, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute(
            "UPDATE blog_articles SET title=?, slug=?, content=?, category=?, meta_description=?, target_keywords=? WHERE id=?",
            (data.title, data.slug, data.content, data.category, data.meta_description, data.target_keywords, article_id)
        )
    return {"status": "updated"}


# ================================================================
# PUBLIC PROSPECTS DIRECTORY (no auth - for homepage display)
# ================================================================

@router.get("/prospects/public/lawfirms")
async def public_lawfirm_prospects(limit: int = 12):
    """Public endpoint: return discovered law firms for homepage display."""
    with get_db() as db:
        rows = db.execute(
            "SELECT firm_name, practice_area, location, website, lead_status, created_at FROM prospects_lawfirms ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/prospects/public/experts")
async def public_expert_prospects(limit: int = 12):
    """Public endpoint: return discovered experts for homepage display."""
    with get_db() as db:
        rows = db.execute(
            "SELECT name, role_type, practice_area, jurisdiction, linkedin, status, created_at FROM prospects_experts ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/prospects/public/stats")
async def public_prospect_stats():
    """Public endpoint: return aggregate prospect stats for homepage."""
    with get_db() as db:
        lawfirms = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
        experts = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
        cities = db.execute("SELECT COUNT(DISTINCT location) as cnt FROM prospects_lawfirms WHERE location IS NOT NULL AND location != ''").fetchone()["cnt"]
        practice_areas = db.execute("SELECT COUNT(DISTINCT practice_area) as cnt FROM prospects_lawfirms WHERE practice_area IS NOT NULL AND practice_area != ''").fetchone()["cnt"]
    return {
        "total_lawfirms": lawfirms,
        "total_experts": experts,
        "cities_covered": cities,
        "practice_areas": practice_areas,
    }


# ================================================================
# LEAD CAPTURE (Public - no auth)
# ================================================================

@router.post("/leads/capture")
async def capture_lead(data: LeadCapture):
    with get_db() as db:
        existing = db.execute("SELECT id FROM leads_motion_analyzer WHERE email = ?", (data.email,)).fetchone()
        if existing:
            return {"status": "already_captured", "id": existing["id"]}
        lid = generate_id()
        db.execute(
            """INSERT INTO leads_motion_analyzer (id, email, firm_name, practice_area, jurisdiction, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (lid, data.email, data.firm_name, data.practice_area, data.jurisdiction, data.source,
             datetime.now(timezone.utc).isoformat())
        )
    return {"status": "captured", "id": lid}


@router.get("/leads")
async def list_leads(source: Optional[str] = None, site: Optional[str] = None, page: int = 1, limit: int = 50, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        query = "SELECT * FROM leads_motion_analyzer WHERE 1=1"
        params: list = []
        if source:
            query += " AND source = ?"
            params.append(source)
        if site:
            query += " AND website_id = ?"
            params.append(site)
        count_query = "SELECT COUNT(*) as cnt FROM leads_motion_analyzer WHERE 1=1"
        count_params: list = []
        if source:
            count_query += " AND source = ?"
            count_params.append(source)
        if site:
            count_query += " AND website_id = ?"
            count_params.append(site)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute(count_query, count_params).fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


# ================================================================
# REFERRAL ENGINE
# ================================================================

@router.post("/referrals")
async def create_referral(current_user: dict = Depends(get_current_user)):
    user_id = current_user["sub"]
    with get_db() as db:
        existing = db.execute("SELECT * FROM referrals WHERE referrer_id = ?", (user_id,)).fetchone()
        if existing:
            return dict(existing)
        code = hashlib.sha256(f"{user_id}-{datetime.now().isoformat()}".encode()).hexdigest()[:8].upper()
        rid = generate_id()
        db.execute(
            """INSERT INTO referrals (id, referrer_id, referral_code, total_referrals, successful_referrals, reward_months, created_at)
               VALUES (?, ?, ?, 0, 0, 0, ?)""",
            (rid, user_id, code, datetime.now(timezone.utc).isoformat())
        )
    return {"id": rid, "referral_code": code, "link": f"https://litigationspace.com/signup?ref={code}"}


@router.get("/referrals/me")
async def get_my_referrals(current_user: dict = Depends(get_current_user)):
    user_id = current_user["sub"]
    with get_db() as db:
        ref = db.execute("SELECT * FROM referrals WHERE referrer_id = ?", (user_id,)).fetchone()
        if not ref:
            return {"referral_code": None, "total_referrals": 0, "successful_referrals": 0}
        return dict(ref)


@router.post("/referrals/track")
async def track_referral(code: str = Query(...)):
    with get_db() as db:
        ref = db.execute("SELECT * FROM referrals WHERE referral_code = ?", (code,)).fetchone()
        if not ref:
            return {"status": "invalid_code"}
        db.execute(
            "UPDATE referrals SET total_referrals = total_referrals + 1 WHERE referral_code = ?",
            (code,)
        )
    return {"status": "tracked"}


@router.post("/referrals/convert")
async def convert_referral(code: str = Query(...), current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        ref = db.execute("SELECT * FROM referrals WHERE referral_code = ?", (code,)).fetchone()
        if not ref:
            return {"status": "invalid_code"}
        db.execute(
            "UPDATE referrals SET successful_referrals = successful_referrals + 1, reward_months = reward_months + 1 WHERE referral_code = ?",
            (code,)
        )
    return {"status": "converted", "reward_months": ref["reward_months"] + 1}


# ================================================================
# GROWTH ANALYTICS + TIME SAVED ROI
# ================================================================

@router.post("/analytics/track-time-saved")
async def track_time_saved(action: str = Query(...), hours: float = Query(default=0.5)):
    with get_db() as db:
        db.execute(
            """INSERT INTO growth_analytics (id, metric_name, metric_value, metadata_json, recorded_at)
               VALUES (?, ?, ?, ?, ?)""",
            (generate_id(), "hours_saved", hours, json.dumps({"action": action}),
             datetime.now(timezone.utc).isoformat())
        )
    return {"status": "tracked", "hours": hours}


@router.get("/analytics/dashboard")
async def get_growth_dashboard(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        analyses = db.execute("SELECT COUNT(*) as cnt FROM motion_analysis_jobs").fetchone()["cnt"]
        leads = db.execute("SELECT COUNT(*) as cnt FROM leads_motion_analyzer").fetchone()["cnt"]
        users = db.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
        experts_invited = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts WHERE invited = 1").fetchone()["cnt"]
        experts_joined = db.execute("SELECT COUNT(*) as cnt FROM users WHERE role IN ('expert', 'expert_active')").fetchone()["cnt"]
        lawfirm_prospects = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
        expert_prospects = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
        emails_sent = db.execute("SELECT COUNT(*) as cnt FROM outreach_log WHERE status = 'sent' OR status = 'delivered'").fetchone()["cnt"]
        social_published = db.execute("SELECT COUNT(*) as cnt FROM social_posts WHERE status = 'published'").fetchone()["cnt"]
        blog_views = db.execute("SELECT COALESCE(SUM(view_count), 0) as cnt FROM blog_articles").fetchone()["cnt"]
        total_referrals = db.execute("SELECT COALESCE(SUM(total_referrals), 0) as cnt FROM referrals").fetchone()["cnt"]
        successful_referrals = db.execute("SELECT COALESCE(SUM(successful_referrals), 0) as cnt FROM referrals").fetchone()["cnt"]
        hours_saved = db.execute(
            "SELECT COALESCE(SUM(metric_value), 0) as total FROM growth_analytics WHERE metric_name = 'hours_saved'"
        ).fetchone()["total"]

        daily_signups = db.execute("""
            SELECT DATE(created_at) as day, COUNT(*) as count
            FROM users WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at) ORDER BY day
        """).fetchall()

        daily_analyses = db.execute("""
            SELECT DATE(created_at) as day, COUNT(*) as count
            FROM motion_analysis_jobs WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at) ORDER BY day
        """).fetchall()

        daily_leads = db.execute("""
            SELECT DATE(created_at) as day, COUNT(*) as count
            FROM leads_motion_analyzer WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at) ORDER BY day
        """).fetchall()

    return {
        "metrics": {
            "motion_analyses": analyses,
            "emails_captured": leads,
            "free_trials": users,
            "experts_invited": experts_invited,
            "experts_joined": experts_joined,
            "lawfirm_prospects": lawfirm_prospects,
            "expert_prospects": expert_prospects,
            "emails_sent": emails_sent,
            "social_published": social_published,
            "blog_views": blog_views,
            "referral_conversions": successful_referrals,
            "total_referrals": total_referrals,
            "hours_saved": round(hours_saved, 1),
        },
        "charts": {
            "daily_signups": [dict(r) for r in daily_signups],
            "daily_analyses": [dict(r) for r in daily_analyses],
            "daily_leads": [dict(r) for r in daily_leads],
        }
    }


# ================================================================
# GROWTH CONFIG
# ================================================================

@router.get("/config")
async def get_growth_config(current_user: dict = Depends(get_current_user)):
    return {
        "smtp_configured": bool(os.environ.get("SMTP_HOST")),
        "linkedin_configured": bool(os.environ.get("LINKEDIN_ACCESS_TOKEN")),
        "twitter_configured": bool(os.environ.get("TWITTER_API_KEY")),
        "facebook_configured": bool(os.environ.get("FACEBOOK_PAGE_TOKEN")),
        "youtube_configured": bool(os.environ.get("YOUTUBE_API_KEY")),
        "tiktok_configured": bool(os.environ.get("TIKTOK_API_KEY")),
        "openai_configured": bool(os.environ.get("OPENAI_API_KEY")),
        "serpapi_configured": bool(os.environ.get("SERPAPI_KEY")),
    }


# ================================================================
# NEWSLETTER ENGINE
# ================================================================

@router.get("/newsletter/preview")
async def preview_newsletter(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        analyses_week = db.execute(
            "SELECT COUNT(*) as cnt FROM motion_analysis_jobs WHERE created_at >= DATE('now', '-7 days')"
        ).fetchone()["cnt"]
        new_users_week = db.execute(
            "SELECT COUNT(*) as cnt FROM users WHERE created_at >= DATE('now', '-7 days')"
        ).fetchone()["cnt"]

    return {
        "subject": f"LitigationSpace Weekly: {analyses_week} Motions Analyzed This Week",
        "preview_text": f"This week: {analyses_week} motions analyzed, {new_users_week} new users joined.",
        "sections": [
            {
                "title": "Motion Intelligence Summary",
                "content": f"This week, {analyses_week} motions were analyzed on LitigationSpace. The most common weakness detected: unsupported evidence claims."
            },
            {
                "title": "Platform Growth",
                "content": f"{new_users_week} new legal professionals joined the platform this week."
            },
            {
                "title": "Try the Free Motion Analyzer",
                "content": "Upload any motion and get an instant diagnostic analysis.",
                "cta_url": "https://litigationspace.com/motion-analyzer",
                "cta_text": "Analyze a Motion Free"
            }
        ]
    }


@router.post("/newsletter/send")
async def send_newsletter(current_user: dict = Depends(get_current_user)):
    smtp_host = os.environ.get("SMTP_HOST")
    if not smtp_host:
        return {"status": "skipped", "reason": "SMTP not configured"}
    with get_db() as db:
        leads = db.execute("SELECT email FROM leads_motion_analyzer").fetchall()
        users = db.execute("SELECT email FROM users").fetchall()
        all_emails = list(set([r["email"] for r in leads] + [r["email"] for r in users]))
    return {"status": "queued", "recipients": len(all_emails)}


# ================================================================
# EMBEDDABLE WIDGET
# ================================================================

@router.get("/widget/config")
async def get_widget_config():
    return {
        "widget_url": "https://litigationspace.com/widget/motion-score.js",
        "api_endpoint": "https://litigationspace.com/api/motion-analyzer/analyze",
        "brand_color": "#6366f1",
        "embed_code": '<script src="https://litigationspace.com/widget/motion-score.js"></script>\n<div id="ls-motion-widget"></div>'
    }


# ================================================================
# CRON JOB STATUS
# ================================================================

@router.get("/cron/status")
async def get_cron_status(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute("SELECT * FROM cron_log ORDER BY executed_at DESC LIMIT 50").fetchall()
        # Calculate monthly SerpAPI budget usage
        serpapi_runs = db.execute(
            "SELECT COUNT(*) as cnt FROM cron_log WHERE job_name IN ('lead_discovery', 'expert_recruitment', 'competitor_analysis', 'keyword_ranking_spot') AND status = 'success' AND executed_at >= DATE('now', 'start of month')"
        ).fetchone()["cnt"]

    return {
        "jobs": [
            {"name": "lead_discovery", "schedule": "Every other day, 02:00 UTC", "description": "Discover law firms (SerpAPI, ~15/month)", "api": "serpapi"},
            {"name": "expert_recruitment", "schedule": "Every 3 days, 03:00 UTC", "description": "Discover experts (SerpAPI, ~10/month)", "api": "serpapi"},
            {"name": "competitor_analysis", "schedule": "Weekly (Mon), 05:00 UTC", "description": "Competitor landscape scan (SerpAPI, ~4/month)", "api": "serpapi"},
            {"name": "keyword_ranking_spot", "schedule": "Weekly (Wed), 05:00 UTC", "description": "SEO keyword spot-check (SerpAPI, 2 keywords, ~8/month)", "api": "serpapi"},
            {"name": "outreach_emails", "schedule": "Daily, 04:00 UTC", "description": "Send outreach email sequences", "api": "smtp"},
            {"name": "blog_publish", "schedule": "Daily, 09:00 UTC", "description": "AI blog article generation", "api": "openai"},
            {"name": "social_publish_am", "schedule": "Daily, 12:00 UTC", "description": "AI social media posts", "api": "openai"},
            {"name": "social_publish_pm", "schedule": "Daily, 18:00 UTC", "description": "AI short-form content", "api": "openai"},
        ],
        "serpapi_budget": {
            "monthly_limit": 100,
            "automated_estimate": 68,
            "manual_reserve": 32,
            "used_this_month": serpapi_runs,
            "remaining": max(0, 100 - serpapi_runs),
        },
        "recent_runs": [dict(r) for r in rows]
    }


# ================================================================
# AI CONTENT GENERATION (OpenAI)
# ================================================================

def _get_openai_client():
    """Get OpenAI client if API key is configured."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    from openai import OpenAI
    return OpenAI(api_key=api_key)


# ================================================================
# LIVE BENCH — PUBLIC PROFILES (DB-backed, OpenAI-seeded)
# ================================================================

_UNSPLASH_HEADSHOTS = [
    "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1615109398623-88346a601842?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1528892952291-009c663ce843?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1556157382-97eda2d62296?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?w=200&h=200&fit=crop&crop=face",
    "https://images.unsplash.com/photo-1545996124-0501ebae84d0?w=200&h=200&fit=crop&crop=face",
]


def _pick_headshot(name: str) -> str:
    if not _UNSPLASH_HEADSHOTS:
        return ""
    idx = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16) % len(_UNSPLASH_HEADSHOTS)
    return _UNSPLASH_HEADSHOTS[idx]


class LiveBenchGenerateRequest(BaseModel):
    count: int = 10


@router.get("/live-bench/public/profiles")
async def public_live_bench_profiles(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    featured: Optional[bool] = None,
    specialty: Optional[str] = None,
):
    """Public profiles used to populate /live-bench and homepage cards."""
    with get_db() as db:
        query = "SELECT * FROM live_bench_profiles WHERE 1=1"
        params: list = []

        if featured is True:
            query += " AND featured = 1"
        if featured is False:
            query += " AND featured = 0"
        if specialty:
            query += " AND specialty LIKE ?"
            params.append(f"%{specialty}%")

        total = db.execute(
            "SELECT COUNT(*) as cnt FROM (" + query + ")",
            params,
        ).fetchone()["cnt"]

        query += " ORDER BY featured DESC, created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = db.execute(query, params).fetchall()

    items: list[dict] = []
    for r in rows:
        d = dict(r)
        try:
            d["jurisdictions"] = json.loads(d.get("jurisdictions_json") or "[]")
        except Exception:
            d["jurisdictions"] = []
        d.pop("jurisdictions_json", None)
        items.append(d)

    return {"items": items, "total": total, "limit": limit, "offset": offset}


def _generate_live_bench_profiles_with_openai(count: int) -> list[dict]:
    """Generate fictional, high-trust marketplace profiles (no real-person scraping)."""
    client = _get_openai_client()
    if not client:
        return []

    prompt = f"""Generate {count} fictional, realistic Live Bench profiles for a litigation marketplace.

Return ONLY valid JSON.

Each profile must include:
- name (first + last)
- role (e.g., 'Immigration Attorney', 'Trial Consultant', 'Expert Witness (Medical)')
- specialty (practice area)
- location (City, ST)
- rate (integer hourly rate)
- status (READY or BUSY)
- rating (float 4.6 to 5.0)
- cases (integer)
- experience (years integer)
- bio (1-2 sentences)
- jurisdictions (array of strings like ['California','Federal'])

Constraints:
- Do NOT use real people or public figures.
- Make profiles feel credible for litigation boutiques.
- Keep bios short, practical, and motion/hearing oriented.

JSON format: {{"profiles": [ ... ]}}
"""

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("live_bench_profiles"),
            messages=[
                {"role": "system", "content": "You generate fictional professional marketplace profiles in strict JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_completion_tokens=4096,
        )
    except Exception as e:
        logger.error(f"Live Bench OpenAI call failed: {e}")
        return []

    raw = (response.choices[0].message.content or "").strip()
    try:
        parsed = json.loads(raw)
    except Exception:
        return []

    profiles = parsed.get("profiles") if isinstance(parsed, dict) else None
    if not isinstance(profiles, list):
        return []

    cleaned: list[dict] = []
    for p in profiles:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()
        role = str(p.get("role") or "").strip()
        specialty = str(p.get("specialty") or "").strip()
        location = str(p.get("location") or "").strip()
        if not (name and role and specialty and location):
            continue

        jurisdictions = p.get("jurisdictions")
        if not isinstance(jurisdictions, list):
            jurisdictions = []

        status = str(p.get("status") or "READY").upper()
        if status not in ("READY", "BUSY"):
            status = "READY"

        cleaned.append(
            {
                "name": name,
                "role": role,
                "specialty": specialty,
                "location": location,
                "rate": int(p.get("rate") or 0),
                "status": status,
                "rating": float(p.get("rating") or 4.8),
                "cases": int(p.get("cases") or 0),
                "experience": int(p.get("experience") or 0),
                "bio": str(p.get("bio") or "").strip(),
                "jurisdictions": jurisdictions,
            }
        )

    return cleaned


def _insert_live_bench_profiles(db, profiles: list[dict], source: str):
    for p in profiles:
        pid = generate_id()
        db.execute(
            """INSERT INTO live_bench_profiles
               (id, name, role, specialty, location, rate, status, rating, cases, experience, photo_url, bio, jurisdictions_json, featured, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
            (
                pid,
                p["name"],
                p["role"],
                p["specialty"],
                p["location"],
                p["rate"],
                p["status"],
                p["rating"],
                p["cases"],
                p["experience"],
                _pick_headshot(p["name"]),
                p.get("bio") or "",
                json.dumps(p.get("jurisdictions") or []),
                source,
                datetime.now(timezone.utc).isoformat(),
            ),
        )


@router.post("/live-bench/generate")
async def generate_live_bench_profiles(
    req: LiveBenchGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: generate additional Live Bench profiles via OpenAI."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    count = max(1, min(100, int(req.count or 10)))

    def _task():
        profiles = _generate_live_bench_profiles_with_openai(count)
        if not profiles:
            return
        with get_db() as db:
            _insert_live_bench_profiles(db, profiles, source="openai")

    background_tasks.add_task(_task)
    return {"status": "queued", "count": count}


async def run_ai_live_bench_profile_generation(count: int = 10) -> dict:
    """Cron job: continuously expand public Live Bench profiles."""
    profiles = _generate_live_bench_profiles_with_openai(count)
    if not profiles:
        return {"status": "skipped", "reason": "OPENAI_API_KEY not set or generation failed"}

    with get_db() as db:
        _insert_live_bench_profiles(db, profiles, source="cron_openai")

    return {"status": "success", "generated": len(profiles)}


class AIBlogRequest(BaseModel):
    topic: str
    category: str = "general"
    target_keywords: Optional[str] = ""
    jurisdiction: Optional[str] = ""
    site: str = "ls"


class AISocialRequest(BaseModel):
    topic: str
    platform: str = "linkedin"
    tone: str = "professional"
    site: str = "ls"


class AIEmailRequest(BaseModel):
    target_audience: str = "lawfirm"
    campaign_goal: str = "introduce_platform"
    firm_size: Optional[str] = "mid-size"


@router.post("/ai/generate-blog")
async def ai_generate_blog(data: AIBlogRequest, current_user: dict = Depends(get_current_user)):
    """Generate a full blog article using OpenAI. Branches by site (ls = LitigationSpace, bc = Build Champions)."""
    client = _get_openai_client()
    if not client:
        return {"status": "not_configured", "reason": "OPENAI_API_KEY not set"}

    site = data.site or "ls"

    if site == "bc":
        # ── Build Champions: 501(c)(3) nonprofit — access to justice content ──
        system_msg = (
            "You are a nonprofit content writer for Build Champions (buildchampions.org), a 501(c)(3) "
            "nonprofit organization whose mission is to democratize access to legal justice. "
            "Write compelling, mission-driven content that educates supporters, inspires donors, "
            "and advocates for equal access to the legal system."
        )
        prompt = f"""Write a comprehensive, mission-driven blog article for BuildChampions.org about: {data.topic}

Category: {data.category}

Requirements:
- Write for an audience of donors, legal advocates, community organizations, and people who believe in equal access to justice
- Highlight the importance of accessible legal tools for pro se litigants, public defenders, and legal aid organizations
- Include stories or examples of how technology levels the legal playing field
- Use clear section headings (H2/H3)
- Include a compelling introduction and a donation call-to-action at the end
- Reference Build Champions' mission: free legal tools across 12 countries
- Length: 1200-2000 words
- Format: HTML with <h2>, <h3>, <p>, <ul>, <li>, <strong> tags
- Do NOT include <html>, <head>, or <body> tags — just the article content

Also provide:
- A compelling title (60 chars max for SEO)
- A meta description (155 chars max)
- A URL-friendly slug
"""
    else:
        # ── LitigationSpace: current behavior preserved exactly ──
        system_msg = (
            "You are a legal content expert writing for LitigationSpace.com, a litigation intelligence platform. "
            "Write authoritative, well-researched legal content."
        )
        jurisdiction_context = f" Focus on {data.jurisdiction} jurisdiction-specific rules and procedures." if data.jurisdiction else ""
        keywords_context = f" Target these SEO keywords: {data.target_keywords}." if data.target_keywords else ""
        prompt = f"""Write a comprehensive, authoritative blog article for LitigationSpace.com about: {data.topic}

Category: {data.category}
{jurisdiction_context}{keywords_context}

Requirements:
- Write for an audience of litigation attorneys and paralegals
- Include practical, actionable guidance
- Reference specific rules, statutes, or case law where appropriate
- Use clear section headings (H2/H3)
- Include a compelling introduction and conclusion
- Add a call-to-action mentioning LitigationSpace's free Motion Analyzer
- Length: 1500-2500 words
- Format: HTML with <h2>, <h3>, <p>, <ul>, <li>, <strong> tags
- Do NOT include <html>, <head>, or <body> tags — just the article content

Also provide:
- A compelling title (60 chars max for SEO)
- A meta description (155 chars max)
- A URL-friendly slug
"""

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("blog_generation"),
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_completion_tokens=4000,
        )
        content = response.choices[0].message.content

        # Parse the response to extract title, slug, meta_description, and content
        lines = content.split("\n")
        title = ""
        slug = ""
        meta_description = ""
        article_content = content

        for line in lines:
            line_lower = line.lower().strip()
            if line_lower.startswith("title:") or line_lower.startswith("**title"):
                title = line.split(":", 1)[1].strip().strip("*").strip('"').strip("'")
            elif line_lower.startswith("slug:") or line_lower.startswith("**slug"):
                slug = line.split(":", 1)[1].strip().strip("*").strip('"').strip("'")
            elif line_lower.startswith("meta") or line_lower.startswith("**meta"):
                meta_description = line.split(":", 1)[1].strip().strip("*").strip('"').strip("'")

        if not slug and title:
            slug = title.lower().replace(" ", "-").replace(":", "").replace(",", "")[:80]

        # Save to database with site-specific website_id
        with get_db() as db:
            aid = generate_id()
            db.execute(
                """INSERT INTO blog_articles (id, title, slug, content, category, meta_description, target_keywords, view_count, status, created_at, website_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?)""",
                (aid, title or data.topic, slug or "ai-generated", article_content, data.category,
                 meta_description or "", data.target_keywords or "", datetime.now(timezone.utc).isoformat(), site)
            )

        return {
            "status": "generated",
            "id": aid,
            "title": title or data.topic,
            "slug": slug,
            "meta_description": meta_description,
            "content_length": len(article_content),
            "model": get_model_for_task("blog_generation"),
            "website_id": site,
        }
    except Exception as e:
        logger.error(f"OpenAI blog generation failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/ai/generate-social")
async def ai_generate_social(data: AISocialRequest, current_user: dict = Depends(get_current_user)):
    """Generate social media posts using OpenAI. Branches by site (ls = LitigationSpace, bc = Build Champions)."""
    client = _get_openai_client()
    if not client:
        return {"status": "not_configured", "reason": "OPENAI_API_KEY not set"}

    site = data.site or "ls"

    platform_guides = {
        "linkedin": "Professional tone, 1300 chars max, use line breaks, include relevant hashtags (3-5), end with a question or CTA",
        "twitter": "Concise, 280 chars max, punchy, 1-2 hashtags, include a link placeholder [LINK]",
        "facebook": "Conversational, 500 chars max, engaging, include emoji sparingly, CTA at end",
        "youtube": "Video description format, 500 chars, include timestamps placeholder, SEO-optimized",
        "tiktok": "Casual, trendy, 150 chars max, 3-5 hashtags, hook in first line",
    }
    guide = platform_guides.get(data.platform, platform_guides["linkedin"])

    if site == "bc":
        # ── Build Champions: nonprofit access-to-justice social content ──
        system_msg = (
            "You are a social media manager for Build Champions (buildchampions.org), a 501(c)(3) nonprofit "
            "organization democratizing access to legal justice. Write mission-driven, inspiring content that "
            "raises awareness, attracts donors, and advocates for equal access to the legal system."
        )
        prompt = f"""Generate a {data.platform} post for BuildChampions.org about: {data.topic}

Tone: {data.tone}
Platform guidelines: {guide}

Build Champions is a 501(c)(3) nonprofit with these talking points:
- Democratizing access to legal justice for pro se litigants, public defenders, and legal aid orgs
- Free litigation tools available across 12 countries
- Community-funded mission — every donation funds free access
- Technology that levels the playing field against well-funded opposing parties
- Support: donate@buildchampions.org

Generate 3 variations of the post. Format as JSON array:
[{{"content": "post text", "hashtags": ["tag1", "tag2"]}}]
"""
    else:
        # ── LitigationSpace: current behavior preserved exactly ──
        system_msg = (
            "You are a legal marketing expert creating social media content for LitigationSpace.com. "
            "Write engaging, professional content that drives lawyers to try the platform."
        )
        prompt = f"""Generate a {data.platform} post for LitigationSpace.com about: {data.topic}

Tone: {data.tone}
Platform guidelines: {guide}

LitigationSpace is a litigation intelligence platform with:
- Free Motion Analyzer (analyzes legal motions for weaknesses)
- War Room (motion strategy engine)
- Win Probability Simulator
- Live Expert Marketplace
- AI-powered legal drafting

Generate 3 variations of the post. Format as JSON array:
[{{"content": "post text", "hashtags": ["tag1", "tag2"]}}]
"""

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("social_posts"),
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
            max_completion_tokens=2000,
        )
        content = response.choices[0].message.content

        # Try to parse JSON from response
        posts = []
        try:
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                posts = json.loads(json_match.group())
        except (json.JSONDecodeError, AttributeError):
            posts = [{"content": content, "hashtags": []}]

        # Save variations to social_posts table with site-specific website_id
        with get_db() as db:
            saved_ids = []
            for post in posts[:3]:
                pid = generate_id()
                post_content = post.get("content", str(post))
                hashtags = post.get("hashtags", [])
                if hashtags:
                    post_content += "\n\n" + " ".join(f"#{h.strip('#')}" for h in hashtags)
                db.execute(
                    """INSERT INTO social_posts (id, platform, content, post_type, status, scheduled_at, created_at, website_id)
                       VALUES (?, ?, ?, 'text', 'draft', ?, ?, ?)""",
                    (pid, data.platform, post_content, datetime.now(timezone.utc).isoformat(),
                     datetime.now(timezone.utc).isoformat(), site)
                )
                saved_ids.append(pid)

        return {
            "status": "generated",
            "posts": posts[:3],
            "saved_ids": saved_ids,
            "platform": data.platform,
            "model": get_model_for_task("social_posts"),
            "website_id": site,
        }
    except Exception as e:
        logger.error(f"OpenAI social generation failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/ai/generate-email-sequence")
async def ai_generate_email_sequence(data: AIEmailRequest, current_user: dict = Depends(get_current_user)):
    """Generate a multi-step email outreach sequence using OpenAI."""
    client = _get_openai_client()
    if not client:
        return {"status": "not_configured", "reason": "OPENAI_API_KEY not set"}

    prompt = f"""Create a 4-step email outreach sequence for LitigationSpace.com.

Target audience: {data.target_audience}
Campaign goal: {data.campaign_goal}
Target firm size: {data.firm_size}

LitigationSpace offers:
- Free Motion Analyzer (analyzes legal motions for weaknesses — no signup required)
- War Room (full motion strategy engine — requires account)
- Win Probability Simulator (predicts motion outcomes)
- Live Expert Marketplace (on-demand paralegals, expert witnesses, etc.)
- AI Legal Drafting with jurisdiction-aware templates

Email sequence requirements:
- Step 1: Day 0 — Cold intro, lead with value (free tool)
- Step 2: Day 3 — Follow-up, share specific use case / social proof
- Step 3: Day 7 — Deeper value prop, address common objection
- Step 4: Day 14 — Final touch, urgency / exclusive offer

For each step provide:
- delay_days (integer)
- subject (compelling, 50 chars max)
- body (HTML formatted, use [Name] placeholder for personalization, include CTA links to litigationspace.com)

Format as JSON array:
[{{"step": 1, "delay_days": 0, "subject": "...", "body": "..."}}]
"""

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("email_outreach"),
            messages=[
                {"role": "system", "content": "You are an expert in legal tech B2B email marketing. Write emails that convert litigation attorneys into platform users."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_completion_tokens=3000,
        )
        content = response.choices[0].message.content

        steps = []
        try:
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                steps = json.loads(json_match.group())
        except (json.JSONDecodeError, AttributeError):
            steps = []

        # Save to email_sequences table
        seq_name = f"ai_{data.target_audience}_{data.campaign_goal}"
        with get_db() as db:
            # Remove old AI-generated sequence with same name
            db.execute("DELETE FROM email_sequences WHERE sequence_name = ?", (seq_name,))
            saved_ids = []
            for step in steps:
                sid = generate_id()
                db.execute(
                    """INSERT INTO email_sequences (id, sequence_name, step, delay_days, subject, body, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (sid, seq_name, step.get("step", 1), step.get("delay_days", 0),
                     step.get("subject", ""), step.get("body", ""),
                     datetime.now(timezone.utc).isoformat())
                )
                saved_ids.append(sid)

        return {
            "status": "generated",
            "sequence_name": seq_name,
            "steps": len(steps),
            "saved_ids": saved_ids,
            "model": get_model_for_task("email_outreach"),
        }
    except Exception as e:
        logger.error(f"OpenAI email sequence generation failed: {e}")
        return {"status": "error", "error": str(e)}


# ================================================================
# SERPAPI LEAD DISCOVERY
# ================================================================

def _get_serpapi_key():
    """Get SerpAPI key if configured."""
    return os.environ.get("SERPAPI_KEY")


class LeadDiscoveryRequest(BaseModel):
    location: str = "New York"
    practice_area: str = "litigation"
    limit: int = 10


class ExpertDiscoveryRequest(BaseModel):
    role_type: str = "EXPERT_WITNESS"
    specialty: str = "forensic accounting"
    location: str = "United States"
    limit: int = 10


@router.post("/discovery/lawfirms")
async def discover_lawfirms(data: LeadDiscoveryRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Discover law firm prospects using SerpAPI Google Maps search."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "not_configured", "reason": "SERPAPI_KEY not set"}

    try:
        from serpapi import GoogleSearch

        params = {
            "engine": "google_maps",
            "q": f"{data.practice_area} law firm {data.location}",
            "type": "search",
            "api_key": serpapi_key,
        }

        search = GoogleSearch(params)
        results = search.get_dict()
        local_results = results.get("local_results", [])

        discovered = []
        with get_db() as db:
            for result in local_results[:data.limit]:
                name = result.get("title", "")
                address = result.get("address", "")
                phone = result.get("phone", "")
                website = result.get("website", "")
                rating = result.get("rating", 0)
                reviews = result.get("reviews", 0)

                # Check for duplicate
                existing = db.execute(
                    "SELECT id FROM prospects_lawfirms WHERE firm_name = ? AND location = ?",
                    (name, address)
                ).fetchone()
                if existing:
                    continue

                pid = generate_id()
                db.execute(
                    """INSERT INTO prospects_lawfirms (id, firm_name, attorney_name, practice_area, location, email, phone, website, linkedin, lead_status, created_at)
                       VALUES (?, ?, '', ?, ?, '', ?, ?, '', 'discovered', ?)""",
                    (pid, name, data.practice_area, address, phone, website,
                     datetime.now(timezone.utc).isoformat())
                )
                discovered.append({
                    "id": pid,
                    "firm_name": name,
                    "location": address,
                    "phone": phone,
                    "website": website,
                    "rating": rating,
                    "reviews": reviews,
                })

        # Log cron activity
        with get_db() as db:
            db.execute(
                "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, 'success', ?, ?)",
                (generate_id(), "lead_discovery_manual",
                 f"Discovered {len(discovered)} law firms in {data.location} for {data.practice_area}",
                 datetime.now(timezone.utc).isoformat())
            )

        return {
            "status": "discovered",
            "count": len(discovered),
            "prospects": discovered,
            "search_query": f"{data.practice_area} law firm {data.location}",
        }
    except Exception as e:
        logger.error(f"SerpAPI law firm discovery failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/discovery/experts")
async def discover_experts(data: ExpertDiscoveryRequest, current_user: dict = Depends(get_current_user)):
    """Discover expert prospects using SerpAPI Google search."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "not_configured", "reason": "SERPAPI_KEY not set"}

    role_search_terms = {
        "FREELANCE_PARALEGAL": "freelance paralegal services",
        "COURT_REPORTER": "court reporter certified",
        "PROCESS_SERVER": "process server licensed",
        "EXPERT_WITNESS": "expert witness",
        "CLERK_SUPPORT": "court clerk consultant",
        "CASE_MANAGER": "legal case manager",
        "FREELANCE_LAWYER": "freelance attorney contract",
        "MEDIATOR": "certified mediator",
        "ARBITRATOR": "arbitrator services",
        "IMMIGRATION_CONSULTANT": "immigration consultant",
    }

    search_term = role_search_terms.get(data.role_type, "legal expert")

    try:
        from serpapi import GoogleSearch

        params = {
            "engine": "google",
            "q": f"{search_term} {data.specialty} {data.location}",
            "api_key": serpapi_key,
            "num": data.limit,
        }

        search = GoogleSearch(params)
        results = search.get_dict()
        organic_results = results.get("organic_results", [])

        discovered = []
        with get_db() as db:
            for result in organic_results[:data.limit]:
                name = result.get("title", "")[:100]
                link = result.get("link", "")
                snippet = result.get("snippet", "")

                # Check for duplicate by name
                existing = db.execute(
                    "SELECT id FROM prospects_experts WHERE name = ?",
                    (name,)
                ).fetchone()
                if existing:
                    continue

                pid = generate_id()
                db.execute(
                    """INSERT INTO prospects_experts (id, name, role_type, practice_area, jurisdiction, email, linkedin, status, invited, created_at)
                       VALUES (?, ?, ?, ?, ?, '', ?, 'discovered', 0, ?)""",
                    (pid, name, data.role_type, data.specialty, data.location, link,
                     datetime.now(timezone.utc).isoformat())
                )
                discovered.append({
                    "id": pid,
                    "name": name,
                    "role_type": data.role_type,
                    "website": link,
                    "snippet": snippet,
                })

        # Log activity
        with get_db() as db:
            db.execute(
                "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, 'success', ?, ?)",
                (generate_id(), "expert_discovery_manual",
                 f"Discovered {len(discovered)} {data.role_type} experts for {data.specialty}",
                 datetime.now(timezone.utc).isoformat())
            )

        return {
            "status": "discovered",
            "count": len(discovered),
            "prospects": discovered,
            "search_query": f"{search_term} {data.specialty} {data.location}",
        }
    except Exception as e:
        logger.error(f"SerpAPI expert discovery failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/discovery/competitor-analysis")
async def competitor_analysis(query: str = Query(default="litigation software"), current_user: dict = Depends(get_current_user)):
    """Analyze competitor landscape using SerpAPI."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "not_configured", "reason": "SERPAPI_KEY not set"}

    try:
        from serpapi import GoogleSearch

        params = {
            "engine": "google",
            "q": query,
            "api_key": serpapi_key,
            "num": 20,
        }

        search = GoogleSearch(params)
        results = search.get_dict()
        organic = results.get("organic_results", [])

        competitors = []
        for r in organic:
            competitors.append({
                "title": r.get("title", ""),
                "link": r.get("link", ""),
                "snippet": r.get("snippet", ""),
                "position": r.get("position", 0),
                "domain": r.get("displayed_link", ""),
            })

        # Check if litigationspace.com appears
        ls_position = None
        for c in competitors:
            if "litigationspace" in c.get("domain", "").lower():
                ls_position = c["position"]
                break

        return {
            "status": "analyzed",
            "query": query,
            "total_results": len(competitors),
            "litigationspace_position": ls_position,
            "competitors": competitors,
        }
    except Exception as e:
        logger.error(f"SerpAPI competitor analysis failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/discovery/keyword-ranking")
async def check_keyword_rankings(current_user: dict = Depends(get_current_user)):
    """Check LitigationSpace's Google rankings for key SEO terms."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "not_configured", "reason": "SERPAPI_KEY not set"}

    target_keywords = [
        "motion analyzer legal",
        "litigation intelligence platform",
        "motion for summary judgment analysis",
        "legal motion weaknesses",
        "win probability litigation",
        "paralegal motion analysis tool",
        "law firm motion strategy",
        "legal drafting software",
    ]

    try:
        from serpapi import GoogleSearch
        rankings = []

        for keyword in target_keywords:
            params = {
                "engine": "google",
                "q": keyword,
                "api_key": serpapi_key,
                "num": 50,
            }
            search = GoogleSearch(params)
            results = search.get_dict()

            position = None
            for r in results.get("organic_results", []):
                if "litigationspace" in r.get("link", "").lower():
                    position = r.get("position")
                    break

            rankings.append({
                "keyword": keyword,
                "position": position,
                "indexed": position is not None,
            })

        # Save to analytics
        with get_db() as db:
            db.execute(
                "INSERT INTO growth_analytics (id, metric_name, metric_value, metadata_json, recorded_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), "keyword_rankings", len([r for r in rankings if r["indexed"]]),
                 json.dumps(rankings), datetime.now(timezone.utc).isoformat())
            )

        return {
            "status": "checked",
            "total_keywords": len(rankings),
            "indexed_count": len([r for r in rankings if r["indexed"]]),
            "rankings": rankings,
        }
    except Exception as e:
        logger.error(f"SerpAPI keyword ranking check failed: {e}")
        return {"status": "error", "error": str(e)}


# ================================================================
# SERPAPI BUDGET GUARD + PAUSE/RESUME
# ================================================================

_SERPAPI_MONTHLY_CAP = 90  # hard cap (leave 10 for manual use out of 100)


def _serpapi_budget_ok() -> bool:
    """Return True if we haven't hit the monthly SerpAPI cap."""
    try:
        with get_db() as db:
            # Check pause switch
            paused = db.execute(
                "SELECT value FROM growth_config WHERE key = 'serpapi_paused'"
            ).fetchone()
            if paused and paused["value"] in ("1", "true", "yes"):
                return False

            used = db.execute(
                "SELECT COUNT(*) as cnt FROM cron_log WHERE job_name IN ('lead_discovery','expert_recruitment','competitor_analysis','keyword_ranking_spot') AND status = 'success' AND executed_at >= DATE('now','start of month')"
            ).fetchone()["cnt"]
            return used < _SERPAPI_MONTHLY_CAP
    except Exception:
        return True  # fail-open so we don't silently break


@router.post("/serpapi/pause")
async def pause_serpapi(current_user: dict = Depends(get_current_user)):
    """Pause all SerpAPI cron jobs."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM growth_config WHERE key = 'serpapi_paused'").fetchone()
        if existing:
            db.execute("UPDATE growth_config SET value = '1' WHERE key = 'serpapi_paused'")
        else:
            db.execute("INSERT INTO growth_config (id, key, value) VALUES (?, 'serpapi_paused', '1')", (generate_id(),))
    return {"status": "paused"}


@router.post("/serpapi/resume")
async def resume_serpapi(current_user: dict = Depends(get_current_user)):
    """Resume SerpAPI cron jobs."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM growth_config WHERE key = 'serpapi_paused'").fetchone()
        if existing:
            db.execute("UPDATE growth_config SET value = '0' WHERE key = 'serpapi_paused'")
        else:
            db.execute("INSERT INTO growth_config (id, key, value) VALUES (?, 'serpapi_paused', '0')", (generate_id(),))
    return {"status": "resumed"}


@router.get("/serpapi/budget")
async def serpapi_budget():
    """Public endpoint: current SerpAPI budget status."""
    with get_db() as db:
        used = db.execute(
            "SELECT COUNT(*) as cnt FROM cron_log WHERE job_name IN ('lead_discovery','expert_recruitment','competitor_analysis','keyword_ranking_spot') AND status = 'success' AND executed_at >= DATE('now','start of month')"
        ).fetchone()["cnt"]
        paused_row = db.execute("SELECT value FROM growth_config WHERE key = 'serpapi_paused'").fetchone()
        paused = paused_row and paused_row["value"] in ("1", "true", "yes") if paused_row else False
    return {
        "monthly_cap": _SERPAPI_MONTHLY_CAP,
        "used_this_month": used,
        "remaining": max(0, _SERPAPI_MONTHLY_CAP - used),
        "paused": paused,
    }


# ================================================================
# AI-POWERED CRON JOB EXECUTION
# ================================================================

async def run_ai_lead_discovery():
    """Cron job: Auto-discover law firms using SerpAPI. Uses systematic rotation to maximize coverage."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "skipped", "reason": "SERPAPI_KEY not set"}

    if not _serpapi_budget_ok():
        return {"status": "skipped", "reason": "Monthly SerpAPI budget reached or paused"}

    locations = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
                 "Philadelphia", "San Antonio", "San Diego", "Dallas", "Austin",
                 "Miami", "Atlanta", "Boston", "Denver", "Seattle",
                 "San Francisco", "Washington DC", "Detroit", "Minneapolis", "Charlotte"]
    practice_areas = ["litigation", "civil litigation", "commercial litigation",
                      "personal injury", "employment litigation",
                      "family law", "criminal defense", "corporate law",
                      "intellectual property", "real estate litigation"]

    # Systematic rotation: use day-of-month to cycle through combinations
    from datetime import datetime as dt
    day = dt.now().day
    location = locations[day % len(locations)]
    practice_area = practice_areas[(day // len(locations)) % len(practice_areas)]

    try:
        from serpapi import GoogleSearch
        params = {
            "engine": "google_maps",
            "q": f"{practice_area} law firm {location}",
            "type": "search",
            "api_key": serpapi_key,
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        local_results = results.get("local_results", [])

        count = 0
        with get_db() as db:
            for result in local_results[:5]:
                name = result.get("title", "")
                address = result.get("address", "")
                existing = db.execute(
                    "SELECT id FROM prospects_lawfirms WHERE firm_name = ? AND location = ?",
                    (name, address)
                ).fetchone()
                if existing:
                    continue
                pid = generate_id()
                db.execute(
                    """INSERT INTO prospects_lawfirms (id, firm_name, attorney_name, practice_area, location, email, phone, website, linkedin, lead_status, created_at)
                       VALUES (?, ?, '', ?, ?, '', ?, ?, '', 'discovered', ?)""",
                    (pid, name, practice_area, address,
                     result.get("phone", ""), result.get("website", ""),
                     datetime.now(timezone.utc).isoformat())
                )
                count += 1

        return {"status": "completed", "discovered": count, "location": location, "practice_area": practice_area}
    except Exception as e:
        logger.error(f"Auto lead discovery failed: {e}")
        return {"status": "error", "error": str(e)}


async def run_ai_blog_generation(site: str = "ls"):
    """Cron job: Auto-generate a blog article using OpenAI.

    site='ls'  — LitigationSpace legal content (default, existing behavior)
    site='bc'  — Build Champions nonprofit / access-to-justice content
    """
    client = _get_openai_client()
    if not client:
        return {"status": "skipped", "reason": "OPENAI_API_KEY not set"}

    import random

    # ── Backfill an existing empty-content stub before generating a brand-new article ──
    # Blog articles can be seeded (see main.py startup seed, and admin/import tooling) with
    # title/slug/metadata but no content. Left unchecked, this cron would just keep publishing
    # new randomly-topicked articles forever while those stubs sit empty and get linked/rendered
    # as broken blank pages. Always drain the backlog of empty stubs first.
    stub = None
    with get_db() as db:
        stub = db.execute(
            "SELECT id, title, slug, category, target_keywords FROM blog_articles "
            "WHERE (content IS NULL OR content = '') AND website_id = ? "
            "ORDER BY created_at ASC LIMIT 1",
            (site,)
        ).fetchone()
    backfill_mode = stub is not None

    if site == "bc":
        # ── Build Champions: 501(c)(3) nonprofit — access to justice content ──
        topics = [
            ("Why Pro Se Litigants Deserve the Same Legal Tools as Big Law", "general", "pro se litigants, legal self-representation, access to justice"),
            ("The Access-to-Justice Gap: What It Really Costs Underrepresented Communities", "general", "access to justice, legal inequality, underrepresented communities"),
            ("How Legal Technology Is Democratizing Courtroom Access", "general", "legal technology nonprofit, courtroom access, legal tech equity"),
            ("Public Defenders: The Underfunded Heroes of Our Justice System", "general", "public defenders, public defense funding, criminal justice reform"),
            ("Legal Aid Organizations: The Fight for Equal Representation", "general", "legal aid organizations, equal representation, civil legal aid"),
            ("AI Tools for the Underdog: How Technology Helps Pro Se Litigants Win", "general", "AI legal tools, pro se litigants, legal self-help technology"),
            ("12 Countries, One Mission: Expanding Access to Justice Globally", "general", "global access to justice, international legal aid, justice technology"),
            ("The Hidden Cost of Being Unrepresented in Court", "general", "unrepresented litigants, legal representation costs, justice gap"),
            ("Nonprofit Legal Tech: When Mission Matters More Than Profit", "general", "nonprofit legal technology, legal tech mission, social impact tech"),
            ("How Donations Fund Free Legal Tools for Those Who Need Them Most", "general", "legal tech donations, free legal tools, charitable legal support"),
            ("Supporting Public Defenders Through Technology Innovation", "general", "public defender technology, criminal defense innovation, legal aid tech"),
            ("Equal Justice Under Law: The Promise and the Gap", "general", "equal justice, judicial equity, access to legal system"),
        ]
        if backfill_mode:
            topic, category, keywords = stub["title"], stub["category"] or "general", stub["target_keywords"] or ""
        else:
            topic, category, keywords = random.choice(topics)
        system_msg = (
            "You are a nonprofit content writer for Build Champions (buildchampions.org), a 501(c)(3) "
            "nonprofit whose mission is to democratize access to legal justice. "
            "Write mission-driven, compelling content that educates supporters, inspires donors, "
            "and advocates for equal access to the legal system. "
            "Return ONLY the article body HTML using h2, h3, p, ul, ol, li, strong, a tags. "
            "Do NOT include <!DOCTYPE>, <html>, <head>, <body>, <title>, or any wrapper tags. "
            "Do NOT wrap your response in markdown code fences (```). "
            "Start directly with the first <h2> tag."
        )
        user_msg = (
            f"Write a 1200-word blog article about: {topic}. "
            "Use h2 for the main title, h3 for sections, p for paragraphs, ul/ol/li for lists, "
            "strong for emphasis, and a tags for links. "
            "Include a donation call-to-action linking to mailto:donate@buildchampions.org at the end. "
            "Return ONLY the HTML content, no code fences, no document wrapper."
        )
        meta_template = f"Build Champions on {topic}: how nonprofit legal tech is closing the justice gap."
    else:
        # ── LitigationSpace: current behavior preserved exactly ──
        topics = [
            ("How to Draft an Effective Motion in Limine", "general", "motion in limine tips, MIL drafting, exclude evidence"),
            ("Federal Rule 56: Summary Judgment Best Practices", "jurisdictional_guide", "FRCP 56, federal summary judgment, rule 56 motion"),
            ("Discovery Abuse: How to File a Successful Motion to Compel", "general", "motion to compel, discovery abuse, FRCP 37"),
            ("Texas Rule 166a: State Summary Judgment Guide", "jurisdictional_guide", "Texas Rule 166a, Texas summary judgment, TRCP"),
            ("5 Evidence Rules Every Litigator Must Know for Motions", "general", "evidence rules motions, FRE litigation, evidence objections"),
            ("Florida Rule 1.510: Summary Judgment After 2021 Amendment", "jurisdictional_guide", "Florida 1.510, FL summary judgment, Daubert standard"),
            ("How AI is Changing Motion Practice in 2026", "general", "AI legal technology, motion analysis AI, legal AI tools"),
            ("Illinois 735 ILCS 5/2-1005: Summary Judgment in Illinois", "jurisdictional_guide", "Illinois summary judgment, 735 ILCS, IL motion practice"),
            ("Motion to Dismiss Under FRCP 12(b)(6): Complete Guide", "general", "motion to dismiss, 12b6, failure to state a claim"),
            ("New York CPLR 3212: Summary Judgment in New York", "jurisdictional_guide", "NY summary judgment, CPLR 3212, New York motion practice"),
            ("Daubert vs Frye: Expert Witness Admissibility Standards", "general", "Daubert standard, Frye test, expert witness motions"),
            ("California CCP 437c: Summary Judgment California Guide", "jurisdictional_guide", "California summary judgment, CCP 437c, CA motion practice"),
            ("How to Win a Motion for Preliminary Injunction", "general", "preliminary injunction, TRO, injunctive relief motion"),
            ("Georgia OCGA 9-11-56: Summary Judgment in Georgia", "jurisdictional_guide", "Georgia summary judgment, OCGA, GA motion practice"),
            ("Effective Deposition Strategies for Litigators", "general", "deposition tips, deposition strategy, litigation discovery"),
            ("Ohio Civil Rule 56: Summary Judgment Guide", "jurisdictional_guide", "Ohio summary judgment, Ohio Civ R 56, OH motion practice"),
            ("Motion for Sanctions Under Rule 11: When and How to File", "general", "Rule 11 sanctions, frivolous litigation, attorney sanctions"),
            ("Pennsylvania Rule 1035.2: Summary Judgment in PA", "jurisdictional_guide", "Pennsylvania summary judgment, Pa RCP 1035, PA motion practice"),
            ("Building a Winning Trial Notebook: Litigation Preparation", "general", "trial notebook, trial preparation, litigation organization"),
            ("Michigan MCR 2.116: Summary Disposition Guide", "jurisdictional_guide", "Michigan summary judgment, MCR 2.116, MI motion practice"),
            ("Strategic Use of Interrogatories in Complex Litigation", "general", "interrogatories, written discovery, litigation strategy"),
            ("New Jersey Rule 4:46: Summary Judgment in NJ", "jurisdictional_guide", "NJ summary judgment, Rule 4:46, New Jersey motion practice"),
            ("Class Action Certification: Motion Practice Guide", "general", "class action, class certification, Rule 23 motion"),
            ("Virginia Code 8.01-420: Summary Judgment in Virginia", "jurisdictional_guide", "Virginia summary judgment, VA motion practice"),
            ("How to Draft Effective Pretrial Motions", "general", "pretrial motions, motion practice, litigation preparation"),
            ("Colorado CRCP 56: Summary Judgment in Colorado", "jurisdictional_guide", "Colorado summary judgment, CRCP 56, CO motion practice"),
            ("Mediation vs Arbitration: When to File a Motion to Compel", "general", "ADR, mediation, arbitration, motion to compel arbitration"),
            ("Washington CR 56: Summary Judgment in Washington", "jurisdictional_guide", "Washington summary judgment, CR 56, WA motion practice"),
            ("Attorney Fee Petitions: Maximizing Recovery Post-Judgment", "general", "attorney fees, fee petition, post-judgment motions"),
            ("Massachusetts Rule 56: Summary Judgment in MA", "jurisdictional_guide", "Massachusetts summary judgment, Mass R Civ P 56, MA motion practice"),
            ("Anti-SLAPP Motions: Protecting Free Speech in Litigation", "general", "anti-SLAPP, free speech, strategic lawsuit, motion to strike"),
            ("Arizona Rule 56: Summary Judgment in Arizona", "jurisdictional_guide", "Arizona summary judgment, Ariz R Civ P 56, AZ motion practice"),
            ("E-Discovery Best Practices for Modern Litigation", "general", "e-discovery, ESI, electronic discovery, litigation technology"),
            ("Minnesota Rule 56: Summary Judgment in Minnesota", "jurisdictional_guide", "Minnesota summary judgment, Minn R Civ P 56, MN motion practice"),
            ("Appellate Motion Practice: Preserving Issues for Appeal", "general", "appellate practice, preserving error, motion for new trial"),
            ("Maryland Rule 2-501: Summary Judgment in Maryland", "jurisdictional_guide", "Maryland summary judgment, Rule 2-501, MD motion practice"),
            ("Remote Hearings and Virtual Litigation Best Practices", "general", "remote hearings, virtual litigation, Zoom court, technology"),
            ("Tennessee Rule 56: Summary Judgment in Tennessee", "jurisdictional_guide", "Tennessee summary judgment, Tenn R Civ P 56, TN motion practice"),
            ("Litigation Hold Letters: Preserving Evidence Early", "general", "litigation hold, evidence preservation, spoliation sanctions"),
            ("Indiana Trial Rule 56: Summary Judgment in Indiana", "jurisdictional_guide", "Indiana summary judgment, Trial Rule 56, IN motion practice"),
        ]
        if backfill_mode:
            topic, category, keywords = stub["title"], stub["category"] or "general", stub["target_keywords"] or ""
        else:
            topic, category, keywords = random.choice(topics)
        system_msg = (
            "You are a legal content expert writing for LitigationSpace.com. Write authoritative, well-researched legal content. "
            "Return ONLY the article body HTML using h2, h3, p, ul, ol, li, strong, a tags. "
            "Do NOT include <!DOCTYPE>, <html>, <head>, <body>, <title>, or any wrapper tags. "
            "Do NOT wrap your response in markdown code fences (```). "
            "Start directly with the first <h2> tag."
        )
        user_msg = (
            f"Write a 1500-word blog article about: {topic}. "
            "Use h2 for the main title, h3 for sections, p for paragraphs, ul/ol/li for lists, "
            "strong for emphasis, and a tags for links. "
            "Include a CTA linking to /motion-analyzer at the end. "
            "Return ONLY the HTML content, no code fences, no document wrapper."
        )
        meta_template = f"Guide to {topic} for litigation attorneys."

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("cron_blog"),
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=0.7,
            max_completion_tokens=3000,
        )
        content = response.choices[0].message.content or ""
        # Strip markdown code fences if present
        content = content.strip()
        if content.startswith("```"):
            # Remove opening fence (```html or ```)
            first_newline = content.index("\n") if "\n" in content else len(content)
            content = content[first_newline + 1:]
        if content.endswith("```"):
            content = content[:-3].strip()
        # Strip full HTML document wrapper if OpenAI returned one
        import re as _re
        body_match = _re.search(r'<body[^>]*>(.*)</body>', content, _re.DOTALL | _re.IGNORECASE)
        if body_match:
            content = body_match.group(1).strip()
        # Remove any remaining <head>...</head>, <html>, <!DOCTYPE> etc.
        content = _re.sub(r'<!DOCTYPE[^>]*>', '', content, flags=_re.IGNORECASE)
        content = _re.sub(r'</?html[^>]*>', '', content, flags=_re.IGNORECASE)
        content = _re.sub(r'<head>.*?</head>', '', content, flags=_re.DOTALL | _re.IGNORECASE)
        content = _re.sub(r'</?body[^>]*>', '', content, flags=_re.IGNORECASE)
        content = _re.sub(r'<title>.*?</title>', '', content, flags=_re.DOTALL | _re.IGNORECASE)
        content = _re.sub(r'<meta[^>]*/?>', '', content, flags=_re.IGNORECASE)
        content = _re.sub(r'<style[^>]*>.*?</style>', '', content, flags=_re.DOTALL | _re.IGNORECASE)
        content = content.strip()

        if backfill_mode:
            with get_db() as db:
                db.execute(
                    "UPDATE blog_articles SET content = ?, status = 'published' WHERE id = ?",
                    (content, stub["id"])
                )
            return {"status": "backfilled", "title": topic, "slug": stub["slug"], "website_id": site}

        slug = topic.lower().replace(" ", "-").replace(":", "").replace(",", "")[:80]

        with get_db() as db:
            existing = db.execute("SELECT id FROM blog_articles WHERE slug = ?", (slug,)).fetchone()
            if not existing:
                aid = generate_id()
                db.execute(
                    """INSERT INTO blog_articles (id, title, slug, content, category, meta_description, target_keywords, view_count, status, created_at, website_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?)""",
                    (aid, topic, slug, content, category, meta_template,
                     keywords, datetime.now(timezone.utc).isoformat(), site)
                )
                return {"status": "published", "title": topic, "slug": slug, "website_id": site}
            else:
                return {"status": "skipped", "reason": "Article already exists"}
    except Exception as e:
        logger.error(f"Auto blog generation failed: {e}")
        return {"status": "error", "error": str(e)}


async def run_ai_social_generation(site: str = "ls"):
    """Cron job: Auto-generate and schedule social media posts.

    site='ls'  — LitigationSpace legal-marketing content (default, existing behavior)
    site='bc'  — Build Champions nonprofit / access-to-justice content
    """
    client = _get_openai_client()
    if not client:
        return {"status": "skipped", "reason": "OPENAI_API_KEY not set"}

    import random

    platform_guides = {
        "facebook": "Engaging, conversational, 300-500 chars, ask a question, 2-3 hashtags, include CTA",
        "linkedin": "Professional, 1300 chars max, line breaks, 3-5 hashtags",
        "twitter": "Concise, 280 chars max, punchy, 1-2 hashtags",
    }

    if site == "bc":
        # ── Build Champions: nonprofit access-to-justice social content ──
        # Weight toward Facebook and LinkedIn; skip Twitter (not currently active for BC)
        platforms = ["facebook", "facebook", "linkedin", "linkedin", "facebook"]
        topics = [
            "access to justice is a human right, not a privilege",
            "how we're helping pro se litigants fight back with better tools",
            "why Build Champions funds free legal technology",
            "the hidden cost of being unrepresented in court",
            "supporting public defenders through technology",
            "legal aid organizations deserve better tools",
            "what it means to level the legal playing field",
            "12 countries, one mission: equal access to legal justice",
            "every donation funds free access to legal tools",
            "nonprofit legal tech: mission-driven technology for justice",
        ]
        platform = random.choice(platforms)
        topic = random.choice(topics)
        system_msg = (
            "You are a social media manager for Build Champions (buildchampions.org), a 501(c)(3) nonprofit "
            "democratizing access to legal justice. Write mission-driven, inspiring content that raises awareness, "
            "attracts donors, and advocates for equal access to the legal system."
        )
        user_prompt = (
            f"Write a {platform} post about: {topic}. "
            f"{platform_guides[platform]}. "
            "Reference Build Champions' mission of free legal tools and equal access to justice. "
            "Include a CTA pointing to donate@buildchampions.org or buildchampions.org."
        )
    else:
        # ── LitigationSpace: current behavior preserved exactly ──
        platforms = ["facebook", "facebook", "facebook", "linkedin", "twitter"]
        topics = [
            "motion analysis tips for litigation attorneys",
            "how AI helps lawyers prepare for hearings",
            "common mistakes in motions for summary judgment",
            "why litigation firms need motion intelligence",
            "the future of legal technology in courtrooms",
            "how to strengthen your motion to dismiss",
            "expert witness preparation tips",
            "litigation workflow automation benefits",
            "preparing for depositions with AI tools",
            "federal vs state motion practice differences",
            "how to evaluate win probability for your case",
            "trial preparation checklist for attorneys",
        ]
        platform = random.choice(platforms)
        topic = random.choice(topics)
        system_msg = "You are a legal marketing expert. Write engaging social media content for LitigationSpace.com."
        user_prompt = (
            f"Write a {platform} post about: {topic}. "
            f"{platform_guides[platform]}. "
            "Include link to litigationspace.com/motion-analyzer."
        )

    try:
        response = client.chat.completions.create(
            model=get_model_for_task("cron_social"),
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.8,
            max_completion_tokens=500,
        )
        content = response.choices[0].message.content

        with get_db() as db:
            pid = generate_id()
            db.execute(
                """INSERT INTO social_posts (id, platform, content, post_type, status, scheduled_at, created_at, website_id)
                   VALUES (?, ?, ?, 'text', 'scheduled', ?, ?, ?)""",
                (pid, platform, content, datetime.now(timezone.utc).isoformat(),
                 datetime.now(timezone.utc).isoformat(), site)
            )

        return {"status": "scheduled", "platform": platform, "post_id": pid, "website_id": site}
    except Exception as e:
        logger.error(f"Auto social generation failed: {e}")
        return {"status": "error", "error": str(e)}


async def run_ai_expert_discovery():
    """Cron job: Auto-discover experts using SerpAPI. Rotates through role types systematically."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "skipped", "reason": "SERPAPI_KEY not set"}

    if not _serpapi_budget_ok():
        return {"status": "skipped", "reason": "Monthly SerpAPI budget reached or paused"}

    role_types = ["EXPERT_WITNESS", "COURT_REPORTER", "FREELANCE_PARALEGAL", "PROCESS_SERVER",
                  "MEDIATOR", "ARBITRATOR", "CASE_MANAGER", "FREELANCE_LAWYER"]
    specialties = ["forensic accounting", "medical malpractice", "construction defects",
                   "intellectual property", "employment law", "environmental",
                   "securities fraud", "product liability"]
    locations = ["New York", "Los Angeles", "Chicago", "Houston", "Miami",
                 "San Francisco", "Boston", "Atlanta", "Dallas", "Denver"]

    from datetime import datetime as dt
    day = dt.now().day
    role_type = role_types[day % len(role_types)]
    specialty = specialties[day % len(specialties)]
    location = locations[(day // 3) % len(locations)]

    role_search_terms = {
        "FREELANCE_PARALEGAL": "freelance paralegal services",
        "COURT_REPORTER": "court reporter certified",
        "PROCESS_SERVER": "process server licensed",
        "EXPERT_WITNESS": "expert witness",
        "CLERK_SUPPORT": "court clerk consultant",
        "CASE_MANAGER": "legal case manager",
        "FREELANCE_LAWYER": "freelance attorney contract",
        "MEDIATOR": "certified mediator",
        "ARBITRATOR": "arbitrator services",
        "IMMIGRATION_CONSULTANT": "immigration consultant",
    }

    search_term = role_search_terms.get(role_type, "legal expert")

    try:
        from serpapi import GoogleSearch
        params = {
            "engine": "google",
            "q": f"{search_term} {specialty} {location}",
            "api_key": serpapi_key,
            "num": 10,
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        organic_results = results.get("organic_results", [])

        count = 0
        with get_db() as db:
            for result in organic_results[:5]:
                name = result.get("title", "")[:100]
                link = result.get("link", "")
                existing = db.execute("SELECT id FROM prospects_experts WHERE name = ?", (name,)).fetchone()
                if existing:
                    continue
                pid = generate_id()
                db.execute(
                    """INSERT INTO prospects_experts (id, name, role_type, practice_area, jurisdiction, email, linkedin, status, invited, created_at)
                       VALUES (?, ?, ?, ?, ?, '', ?, 'discovered', 0, ?)""",
                    (pid, name, role_type, specialty, location, link,
                     datetime.now(timezone.utc).isoformat())
                )
                count += 1

        return {"status": "completed", "discovered": count, "role_type": role_type, "location": location}
    except Exception as e:
        logger.error(f"Auto expert discovery failed: {e}")
        return {"status": "error", "error": str(e)}


async def run_competitor_analysis_cron():
    """Cron job: Weekly competitor landscape analysis. 1 SerpAPI search."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "skipped", "reason": "SERPAPI_KEY not set"}

    if not _serpapi_budget_ok():
        return {"status": "skipped", "reason": "Monthly SerpAPI budget reached or paused"}

    queries = [
        "litigation software", "legal motion analyzer", "case management software lawyers",
        "litigation intelligence platform", "legal AI tools for attorneys",
    ]
    from datetime import datetime as dt
    week = dt.now().isocalendar()[1]
    query = queries[week % len(queries)]

    try:
        from serpapi import GoogleSearch
        params = {
            "engine": "google",
            "q": query,
            "api_key": serpapi_key,
            "num": 20,
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        organic = results.get("organic_results", [])

        ls_position = None
        competitors = []
        for r in organic:
            domain = r.get("displayed_link", "").lower()
            if "litigationspace" in domain:
                ls_position = r.get("position")
            competitors.append({
                "title": r.get("title", ""),
                "position": r.get("position", 0),
                "domain": domain,
            })

        with get_db() as db:
            db.execute(
                "INSERT INTO growth_analytics (id, metric_name, metric_value, metadata_json, recorded_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), "competitor_analysis_weekly", ls_position or 0,
                 json.dumps({"query": query, "top_5": competitors[:5]}),
                 datetime.now(timezone.utc).isoformat())
            )

        return {"status": "analyzed", "query": query, "total_results": len(competitors), "ls_position": ls_position}
    except Exception as e:
        logger.error(f"Auto competitor analysis failed: {e}")
        return {"status": "error", "error": str(e)}


async def run_keyword_spot_check():
    """Cron job: Weekly keyword spot-check. Checks 2 keywords per run to conserve SerpAPI budget."""
    serpapi_key = _get_serpapi_key()
    if not serpapi_key:
        return {"status": "skipped", "reason": "SERPAPI_KEY not set"}

    if not _serpapi_budget_ok():
        return {"status": "skipped", "reason": "Monthly SerpAPI budget reached or paused"}

    all_keywords = [
        "motion analyzer legal", "litigation intelligence platform",
        "motion for summary judgment analysis", "legal motion weaknesses",
        "win probability litigation", "paralegal motion analysis tool",
        "law firm motion strategy", "legal drafting software",
    ]

    # Pick 2 keywords per run based on week number
    from datetime import datetime as dt
    week = dt.now().isocalendar()[1]
    start_idx = (week * 2) % len(all_keywords)
    keywords_to_check = [all_keywords[start_idx], all_keywords[(start_idx + 1) % len(all_keywords)]]

    try:
        from serpapi import GoogleSearch
        rankings = []

        for keyword in keywords_to_check:
            params = {
                "engine": "google",
                "q": keyword,
                "api_key": serpapi_key,
                "num": 50,
            }
            search = GoogleSearch(params)
            results = search.get_dict()

            position = None
            for r in results.get("organic_results", []):
                if "litigationspace" in r.get("link", "").lower():
                    position = r.get("position")
                    break

            rankings.append({
                "keyword": keyword,
                "position": position,
                "indexed": position is not None,
            })

        with get_db() as db:
            db.execute(
                "INSERT INTO growth_analytics (id, metric_name, metric_value, metadata_json, recorded_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), "keyword_spot_check", len([r for r in rankings if r["indexed"]]),
                 json.dumps(rankings), datetime.now(timezone.utc).isoformat())
            )

        return {"status": "checked", "checked": len(rankings), "rankings": rankings}
    except Exception as e:
        logger.error(f"Auto keyword spot-check failed: {e}")
        return {"status": "error", "error": str(e)}


# ================================================================
# EMAIL MARKETING: CAMPAIGNS
# ================================================================

class EmailCampaignCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    campaign_type: Optional[str] = "outreach"
    sender_email: Optional[str] = "noreply@litigationspace.com"
    sender_name: Optional[str] = "LitigationSpace"
    reply_to: Optional[str] = "support@litigationspace.com"
    sequence_name: Optional[str] = None
    target_audience: Optional[str] = "all"
    daily_limit: Optional[int] = 50


@router.get("/campaigns")
async def list_campaigns(
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    with get_db() as db:
        query = "SELECT * FROM email_campaigns WHERE 1=1"
        params: list = []
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM email_campaigns").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


@router.post("/campaigns")
async def create_campaign(data: EmailCampaignCreate, current_user: dict = Depends(get_current_user)):
    cid = generate_id()
    with get_db() as db:
        db.execute(
            """INSERT INTO email_campaigns (id, name, description, campaign_type, status,
               sender_email, sender_name, reply_to, sequence_name, target_audience, daily_limit, created_at)
               VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)""",
            (cid, data.name, data.description, data.campaign_type,
             data.sender_email, data.sender_name, data.reply_to,
             data.sequence_name, data.target_audience, data.daily_limit,
             datetime.now(timezone.utc).isoformat())
        )
    return {"id": cid, "status": "created"}


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        row = db.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Campaign not found")
        # Get queue stats
        queue_stats = db.execute("""
            SELECT status, COUNT(*) as cnt FROM email_queue
            WHERE campaign_id = ? GROUP BY status
        """, (campaign_id,)).fetchall()
    result = dict(row)
    result["queue_breakdown"] = {r["status"]: r["cnt"] for r in queue_stats}
    return result


@router.post("/campaigns/{campaign_id}/activate")
async def activate_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        campaign = db.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        db.execute(
            "UPDATE email_campaigns SET status = 'active', started_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), campaign_id)
        )
    return {"status": "activated"}


@router.post("/campaigns/{campaign_id}/pause")
async def pause_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("UPDATE email_campaigns SET status = 'paused' WHERE id = ?", (campaign_id,))
    return {"status": "paused"}


@router.post("/campaigns/{campaign_id}/resume")
async def resume_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("UPDATE email_campaigns SET status = 'active' WHERE id = ?", (campaign_id,))
    return {"status": "resumed"}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute("DELETE FROM email_queue WHERE campaign_id = ?", (campaign_id,))
        db.execute("DELETE FROM email_campaigns WHERE id = ?", (campaign_id,))
    return {"status": "deleted"}


# ================================================================
# EMAIL MARKETING: QUEUE MANAGEMENT
# ================================================================

class QueueBatchRequest(BaseModel):
    campaign_id: str
    audience: Optional[str] = "lawfirms"  # lawfirms, experts, leads, all
    sequence_name: Optional[str] = None
    subject_override: Optional[str] = None
    body_override: Optional[str] = None


@router.post("/campaigns/{campaign_id}/queue-batch")
async def queue_batch_emails(campaign_id: str, data: QueueBatchRequest, current_user: dict = Depends(get_current_user)):
    """Queue a batch of emails for a campaign based on target audience."""
    with get_db() as db:
        campaign = db.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        campaign_dict = dict(campaign)

        # Get unsubscribed emails to exclude
        unsub_rows = db.execute("SELECT email FROM email_unsubscribes").fetchall()
        unsubscribed = set(r["email"].lower() for r in unsub_rows)

        # Get bounced emails to exclude
        bounce_rows = db.execute("SELECT DISTINCT email FROM email_bounces WHERE bounce_type = 'hard'").fetchall()
        bounced = set(r["email"].lower() for r in bounce_rows)
        excluded = unsubscribed | bounced

        # Get already-queued emails for this campaign
        already_queued = db.execute(
            "SELECT to_email FROM email_queue WHERE campaign_id = ?", (campaign_id,)
        ).fetchall()
        already_set = set(r["to_email"].lower() for r in already_queued)

        # Collect target emails
        prospects = []
        audience = data.audience or campaign_dict.get("target_audience", "all")

        if audience in ("lawfirms", "all"):
            rows = db.execute("SELECT id, firm_name, attorney_name, email FROM prospects_lawfirms WHERE email != '' AND email IS NOT NULL").fetchall()
            for r in rows:
                rd = dict(r)
                if rd["email"].lower() not in excluded and rd["email"].lower() not in already_set:
                    prospects.append({"id": rd["id"], "type": "lawfirm", "name": rd.get("attorney_name") or rd.get("firm_name", ""), "email": rd["email"]})

        if audience in ("experts", "all"):
            rows = db.execute("SELECT id, name, email FROM prospects_experts WHERE email != '' AND email IS NOT NULL").fetchall()
            for r in rows:
                rd = dict(r)
                if rd["email"].lower() not in excluded and rd["email"].lower() not in already_set:
                    prospects.append({"id": rd["id"], "type": "expert", "name": rd.get("name", ""), "email": rd["email"]})

        if audience in ("leads", "all"):
            rows = db.execute("SELECT id, email, firm_name FROM leads_motion_analyzer WHERE email != '' AND email IS NOT NULL").fetchall()
            for r in rows:
                rd = dict(r)
                if rd["email"].lower() not in excluded and rd["email"].lower() not in already_set:
                    prospects.append({"id": rd["id"], "type": "lead", "name": rd.get("firm_name", ""), "email": rd["email"]})

        # Get email template
        seq_name = data.sequence_name or campaign_dict.get("sequence_name")
        subject_tpl = data.subject_override or ""
        body_tpl = data.body_override or ""

        if seq_name and (not subject_tpl or not body_tpl):
            seq = db.execute(
                "SELECT subject, body FROM email_sequences WHERE sequence_name = ? ORDER BY step LIMIT 1",
                (seq_name,)
            ).fetchone()
            if seq:
                seq_dict = dict(seq)
                if not subject_tpl:
                    subject_tpl = seq_dict["subject"]
                if not body_tpl:
                    body_tpl = seq_dict["body"]

        if not subject_tpl:
            subject_tpl = f"Hello [Name] — {campaign_dict['name']}"
        if not body_tpl:
            body_tpl = "<p>Hello [Name],</p><p>We wanted to reach out about LitigationSpace.</p>"

        # Queue emails
        queued = 0
        for p in prospects:
            name = p["name"] or "there"
            subject = subject_tpl.replace("[Name]", name)
            body = body_tpl.replace("[Name]", name)
            # Add unsubscribe footer
            unsub_link = f"https://litigationspace.com/api/growth/email/unsubscribe?email={p['email']}"
            body += f'<br/><hr style="margin-top:30px;border:none;border-top:1px solid #ccc"/><p style="font-size:11px;color:#999;">You received this because you are in our professional network. <a href="{unsub_link}" style="color:#999;">Unsubscribe</a></p>'

            qid = generate_id()
            db.execute(
                """INSERT INTO email_queue (id, campaign_id, prospect_id, prospect_type, to_email, to_name,
                   subject, body, status, sequence_step, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?)""",
                (qid, campaign_id, p["id"], p["type"], p["email"], name, subject, body,
                 datetime.now(timezone.utc).isoformat())
            )
            queued += 1

        # Update campaign total target
        db.execute(
            "UPDATE email_campaigns SET total_target = total_target + ? WHERE id = ?",
            (queued, campaign_id)
        )

    return {"status": "queued", "queued": queued, "excluded_unsubscribed": len(unsubscribed), "excluded_bounced": len(bounced)}


@router.get("/campaigns/{campaign_id}/queue")
async def get_campaign_queue(
    campaign_id: str,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    with get_db() as db:
        query = "SELECT * FROM email_queue WHERE campaign_id = ?"
        params: list = [campaign_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, (page - 1) * limit])
        rows = db.execute(query, params).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE campaign_id = ?", (campaign_id,)).fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


# ================================================================
# EMAIL MARKETING: PROCESS QUEUE (called by cron)
# ================================================================

@router.post("/campaigns/process-queue")
async def process_email_queue(current_user: dict = Depends(get_current_user)):
    """Process queued emails for all active campaigns, respecting daily limits."""
    smtp_host = os.environ.get("SMTP_HOST")
    if not smtp_host:
        return {"status": "skipped", "reason": "SMTP not configured"}

    # Check global email pause
    with get_db() as db:
        paused = db.execute("SELECT value FROM growth_config WHERE key = 'email_paused'").fetchone()
        if paused and paused["value"] in ("1", "true", "yes"):
            return {"status": "paused", "reason": "Email sending is globally paused"}

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")

    total_sent = 0
    total_failed = 0
    total_bounced = 0
    campaign_results = []

    with get_db() as db:
        # Get active campaigns
        campaigns = db.execute("SELECT * FROM email_campaigns WHERE status = 'active'").fetchall()

        for campaign in campaigns:
            c = dict(campaign)
            daily_limit = c.get("daily_limit", 50)

            # Count emails sent today for this campaign
            sent_today = db.execute(
                "SELECT COUNT(*) as cnt FROM email_queue WHERE campaign_id = ? AND status IN ('sent', 'delivered') AND sent_at >= DATE('now')",
                (c["id"],)
            ).fetchone()["cnt"]

            remaining = max(0, daily_limit - sent_today)
            if remaining <= 0:
                campaign_results.append({"campaign": c["name"], "sent": 0, "reason": "daily limit reached"})
                continue

            # Get queued emails
            queue_items = db.execute(
                "SELECT * FROM email_queue WHERE campaign_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT ?",
                (c["id"], remaining)
            ).fetchall()

            campaign_sent = 0
            campaign_failed = 0

            for item in queue_items:
                qi = dict(item)

                # Double-check unsubscribe
                unsub = db.execute("SELECT id FROM email_unsubscribes WHERE email = ?", (qi["to_email"].lower(),)).fetchone()
                if unsub:
                    db.execute("UPDATE email_queue SET status = 'failed', error_msg = 'unsubscribed' WHERE id = ?", (qi["id"],))
                    continue

                try:
                    db.execute("UPDATE email_queue SET status = 'sending' WHERE id = ?", (qi["id"],))

                    sender_email = c.get("sender_email") or os.environ.get("SMTP_FROM", smtp_user)
                    sender_name = c.get("sender_name", "LitigationSpace")
                    reply_to = c.get("reply_to", "support@litigationspace.com")

                    msg = MIMEMultipart()
                    msg["From"] = f"{sender_name} <{sender_email}>"
                    msg["To"] = qi["to_email"]
                    msg["Subject"] = qi["subject"]
                    msg["Reply-To"] = reply_to
                    msg["List-Unsubscribe"] = f"<https://litigationspace.com/api/growth/email/unsubscribe?email={qi['to_email']}>"
                    msg.attach(MIMEText(qi["body"], "html"))

                    with smtplib.SMTP(smtp_host, smtp_port) as server:
                        server.starttls()
                        if smtp_user and smtp_pass:
                            server.login(smtp_user, smtp_pass)
                        server.send_message(msg)

                    now = datetime.now(timezone.utc).isoformat()
                    db.execute(
                        "UPDATE email_queue SET status = 'sent', sent_at = ? WHERE id = ?",
                        (now, qi["id"])
                    )
                    db.execute(
                        "UPDATE email_campaigns SET total_sent = total_sent + 1 WHERE id = ?",
                        (c["id"],)
                    )
                    campaign_sent += 1
                    total_sent += 1

                except smtplib.SMTPRecipientsRefused as e:
                    # Bounce
                    error_str = str(e)
                    db.execute("UPDATE email_queue SET status = 'bounced', error_msg = ? WHERE id = ?", (error_str, qi["id"]))
                    db.execute(
                        "INSERT INTO email_bounces (id, email, bounce_type, error_msg, queue_item_id, bounced_at) VALUES (?, ?, 'hard', ?, ?, ?)",
                        (generate_id(), qi["to_email"], error_str, qi["id"], datetime.now(timezone.utc).isoformat())
                    )
                    db.execute("UPDATE email_campaigns SET total_bounced = total_bounced + 1 WHERE id = ?", (c["id"],))
                    total_bounced += 1
                    campaign_failed += 1

                except Exception as e:
                    error_str = str(e)
                    db.execute("UPDATE email_queue SET status = 'failed', error_msg = ? WHERE id = ?", (error_str, qi["id"]))
                    campaign_failed += 1
                    total_failed += 1

            # Check if campaign is complete
            remaining_queued = db.execute(
                "SELECT COUNT(*) as cnt FROM email_queue WHERE campaign_id = ? AND status = 'queued'",
                (c["id"],)
            ).fetchone()["cnt"]
            if remaining_queued == 0:
                db.execute(
                    "UPDATE email_campaigns SET status = 'completed', completed_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), c["id"])
                )

            campaign_results.append({"campaign": c["name"], "sent": campaign_sent, "failed": campaign_failed})

        # Log cron execution
        db.execute(
            "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, ?, ?, ?)",
            (generate_id(), "email_queue_process", "success",
             json.dumps({"total_sent": total_sent, "total_failed": total_failed, "total_bounced": total_bounced}),
             datetime.now(timezone.utc).isoformat())
        )

    return {
        "status": "processed",
        "total_sent": total_sent,
        "total_failed": total_failed,
        "total_bounced": total_bounced,
        "campaigns": campaign_results,
    }


# ================================================================
# EMAIL MARKETING: UNSUBSCRIBE
# ================================================================

@router.get("/email/unsubscribe")
async def unsubscribe_email(email: str = Query(...), reason: Optional[str] = "link_click"):
    """Public endpoint: unsubscribe an email address."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM email_unsubscribes WHERE email = ?", (email.lower(),)).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO email_unsubscribes (id, email, reason, source, unsubscribed_at) VALUES (?, ?, ?, 'link', ?)",
                (generate_id(), email.lower(), reason, datetime.now(timezone.utc).isoformat())
            )
    # Return a simple HTML page
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content="""
    <!DOCTYPE html>
    <html><head><title>Unsubscribed</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff;}
    .card{text-align:center;padding:40px;background:#1e293b;border-radius:16px;max-width:500px;}
    h1{color:#60a5fa;margin-bottom:16px;}p{color:#94a3b8;}</style></head>
    <body><div class="card"><h1>Unsubscribed</h1><p>You have been removed from our mailing list. You will not receive any more marketing emails from LitigationSpace.</p></div></body></html>
    """)


@router.get("/email/unsubscribes")
async def list_unsubscribes(page: int = 1, limit: int = 100, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM email_unsubscribes ORDER BY unsubscribed_at DESC LIMIT ? OFFSET ?",
            (limit, (page - 1) * limit)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM email_unsubscribes").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/email/bounces")
async def list_bounces(page: int = 1, limit: int = 100, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM email_bounces ORDER BY bounced_at DESC LIMIT ? OFFSET ?",
            (limit, (page - 1) * limit)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM email_bounces").fetchone()["cnt"]
    return {"items": [dict(r) for r in rows], "total": total}


# ================================================================
# EMAIL MARKETING: GLOBAL PAUSE/RESUME
# ================================================================

@router.post("/email/pause")
async def pause_email_sending(current_user: dict = Depends(get_current_user)):
    """Globally pause all email sending."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM growth_config WHERE key = 'email_paused'").fetchone()
        if existing:
            db.execute("UPDATE growth_config SET value = '1' WHERE key = 'email_paused'")
        else:
            db.execute("INSERT INTO growth_config (id, key, value) VALUES (?, 'email_paused', '1')", (generate_id(),))
    return {"status": "paused"}


@router.post("/email/resume")
async def resume_email_sending(current_user: dict = Depends(get_current_user)):
    """Resume email sending."""
    with get_db() as db:
        existing = db.execute("SELECT id FROM growth_config WHERE key = 'email_paused'").fetchone()
        if existing:
            db.execute("UPDATE growth_config SET value = '0' WHERE key = 'email_paused'")
        else:
            db.execute("INSERT INTO growth_config (id, key, value) VALUES (?, 'email_paused', '0')", (generate_id(),))
    return {"status": "resumed"}


# ================================================================
# EMAIL MARKETING: COMPREHENSIVE DASHBOARD
# ================================================================

@router.get("/marketing/dashboard")
async def get_marketing_dashboard(current_user: dict = Depends(get_current_user)):
    """Comprehensive marketing dashboard with all email + automation stats."""
    with get_db() as db:
        # Campaign stats
        campaigns = db.execute("SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT 20").fetchall()
        active_campaigns = db.execute("SELECT COUNT(*) as cnt FROM email_campaigns WHERE status = 'active'").fetchone()["cnt"]
        total_campaigns = db.execute("SELECT COUNT(*) as cnt FROM email_campaigns").fetchone()["cnt"]

        # Queue stats
        queue_total = db.execute("SELECT COUNT(*) as cnt FROM email_queue").fetchone()["cnt"]
        queue_queued = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status = 'queued'").fetchone()["cnt"]
        queue_sent = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status IN ('sent', 'delivered')").fetchone()["cnt"]
        queue_bounced = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status = 'bounced'").fetchone()["cnt"]
        queue_failed = db.execute("SELECT COUNT(*) as cnt FROM email_queue WHERE status = 'failed'").fetchone()["cnt"]

        # Unsubscribes
        total_unsubs = db.execute("SELECT COUNT(*) as cnt FROM email_unsubscribes").fetchone()["cnt"]

        # Bounces
        total_bounces = db.execute("SELECT COUNT(*) as cnt FROM email_bounces").fetchone()["cnt"]
        hard_bounces = db.execute("SELECT COUNT(*) as cnt FROM email_bounces WHERE bounce_type = 'hard'").fetchone()["cnt"]

        # Outreach log stats (legacy)
        outreach_sent = db.execute("SELECT COUNT(*) as cnt FROM outreach_log WHERE status IN ('sent', 'delivered')").fetchone()["cnt"]
        outreach_failed = db.execute("SELECT COUNT(*) as cnt FROM outreach_log WHERE status = 'failed'").fetchone()["cnt"]

        # Prospect counts
        lawfirm_count = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
        expert_count = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
        lead_count = db.execute("SELECT COUNT(*) as cnt FROM leads_motion_analyzer").fetchone()["cnt"]
        lawfirms_with_email = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms WHERE email != '' AND email IS NOT NULL").fetchone()["cnt"]
        experts_with_email = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts WHERE email != '' AND email IS NOT NULL").fetchone()["cnt"]

        # Daily sending chart (last 30 days)
        daily_sends = db.execute("""
            SELECT DATE(sent_at) as day, COUNT(*) as count
            FROM email_queue WHERE sent_at IS NOT NULL AND sent_at >= DATE('now', '-30 days')
            GROUP BY DATE(sent_at) ORDER BY day
        """).fetchall()

        # Cron log (recent)
        recent_cron = db.execute("SELECT * FROM cron_log ORDER BY executed_at DESC LIMIT 20").fetchall()

        # Global pause state
        email_paused_row = db.execute("SELECT value FROM growth_config WHERE key = 'email_paused'").fetchone()
        email_paused = email_paused_row and email_paused_row["value"] in ("1", "true", "yes") if email_paused_row else False

        serpapi_paused_row = db.execute("SELECT value FROM growth_config WHERE key = 'serpapi_paused'").fetchone()
        serpapi_paused = serpapi_paused_row and serpapi_paused_row["value"] in ("1", "true", "yes") if serpapi_paused_row else False

        # SerpAPI budget
        serpapi_used = db.execute(
            "SELECT COUNT(*) as cnt FROM cron_log WHERE job_name IN ('lead_discovery','expert_recruitment','competitor_analysis','keyword_ranking_spot') AND status = 'success' AND executed_at >= DATE('now','start of month')"
        ).fetchone()["cnt"]

    return {
        "campaigns": {
            "total": total_campaigns,
            "active": active_campaigns,
            "items": [dict(c) for c in campaigns],
        },
        "email_queue": {
            "total": queue_total,
            "queued": queue_queued,
            "sent": queue_sent,
            "bounced": queue_bounced,
            "failed": queue_failed,
        },
        "deliverability": {
            "total_unsubscribes": total_unsubs,
            "total_bounces": total_bounces,
            "hard_bounces": hard_bounces,
            "outreach_sent_legacy": outreach_sent,
            "outreach_failed_legacy": outreach_failed,
        },
        "prospects": {
            "lawfirms": lawfirm_count,
            "experts": expert_count,
            "leads": lead_count,
            "lawfirms_with_email": lawfirms_with_email,
            "experts_with_email": experts_with_email,
            "total_reachable": lawfirms_with_email + experts_with_email + lead_count,
        },
        "charts": {
            "daily_sends": [dict(r) for r in daily_sends],
        },
        "automation": {
            "email_paused": email_paused,
            "serpapi_paused": serpapi_paused,
            "serpapi_budget": {
                "monthly_cap": _SERPAPI_MONTHLY_CAP,
                "used": serpapi_used,
                "remaining": max(0, _SERPAPI_MONTHLY_CAP - serpapi_used),
            },
        },
        "recent_cron_runs": [dict(r) for r in recent_cron],
    }


# ================================================================
# CRON TRIGGER ENDPOINT (called by systemd timer on VPS)
# ================================================================

@router.post("/cron/trigger/{job_name}")
async def trigger_cron_job(job_name: str, secret: str = Query(...), site: str = Query(default="ls")):
    """Trigger a cron job. Secured with a shared secret.

    The optional `site` query parameter (default: 'ls') controls which site's
    content is generated / published. Pass site=bc to run BuildChampions jobs.
    Jobs that are not site-aware (lead_discovery, competitor_analysis, etc.)
    ignore the site parameter and always run for LitigationSpace.
    """
    expected_secret = os.environ.get("CRON_SECRET", "ls-cron-2026")
    if secret != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    # Jobs that support multi-site execution — accept any valid site
    SITE_AWARE_JOBS = {"blog_publish", "social_publish", "facebook_publish"}
    # Jobs that are LS-only (operate on shared infrastructure: SerpAPI, email queue, etc.)
    LS_ONLY_JOBS = {
        "lead_discovery", "expert_recruitment", "competitor_analysis",
        "keyword_ranking", "email_queue_process", "live_bench_profiles", "email_enrichment",
        "weekly_invoice_rollup", "task_deadline_reminders",
    }

    if site != "ls" and job_name in LS_ONLY_JOBS:
        return {
            "status": "skipped",
            "reason": f"Job '{job_name}' is LS-only and cannot run for site '{site}'",
            "site": site,
        }

    result = {}
    try:
        if job_name == "lead_discovery":
            result = await run_ai_lead_discovery()
        elif job_name == "expert_recruitment":
            result = await run_ai_expert_discovery()
        elif job_name == "blog_publish":
            result = await run_ai_blog_generation(site=site)
        elif job_name == "social_publish":
            result = await run_ai_social_generation(site=site)
        elif job_name == "competitor_analysis":
            result = await run_competitor_analysis_cron()
        elif job_name == "keyword_ranking":
            result = await run_keyword_spot_check()
        elif job_name == "email_queue_process":
            # Fake a current_user for the queue processor
            result = await _process_email_queue_internal()
        elif job_name == "live_bench_profiles":
            result = await run_ai_live_bench_profile_generation()
        elif job_name == "email_enrichment":
            result = await run_email_enrichment()
        elif job_name == "facebook_publish":
            result = await run_facebook_auto_publish(site=site)
        elif job_name == "weekly_invoice_rollup":
            created = generate_weekly_invoices()
            result = {"status": "success", "invoices_created": len(created), "invoices": created}
        elif job_name == "task_deadline_reminders":
            reminded = send_deadline_reminders()
            result = {"status": "success", "reminders_sent": len(reminded), "tasks": reminded}
        else:
            raise HTTPException(status_code=400, detail=f"Unknown job: {job_name}")

        # Log success
        with get_db() as db:
            db.execute(
                "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), job_name, result.get("status", "success"),
                 json.dumps(result), datetime.now(timezone.utc).isoformat())
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cron trigger {job_name} failed: {e}")
        with get_db() as db:
            db.execute(
                "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), job_name, "error", json.dumps({"error": str(e)}),
                 datetime.now(timezone.utc).isoformat())
            )
        result = {"status": "error", "error": str(e)}

    return result


async def _process_email_queue_internal():
    """Internal version of process_email_queue without auth dependency."""
    smtp_host = os.environ.get("SMTP_HOST")
    if not smtp_host:
        return {"status": "skipped", "reason": "SMTP not configured"}

    with get_db() as db:
        paused = db.execute("SELECT value FROM growth_config WHERE key = 'email_paused'").fetchone()
        if paused and paused["value"] in ("1", "true", "yes"):
            return {"status": "paused", "reason": "Email sending is globally paused"}

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")

    total_sent = 0
    total_failed = 0

    with get_db() as db:
        campaigns = db.execute("SELECT * FROM email_campaigns WHERE status = 'active'").fetchall()
        for campaign in campaigns:
            c = dict(campaign)
            daily_limit = c.get("daily_limit", 50)
            sent_today = db.execute(
                "SELECT COUNT(*) as cnt FROM email_queue WHERE campaign_id = ? AND status IN ('sent', 'delivered') AND sent_at >= DATE('now')",
                (c["id"],)
            ).fetchone()["cnt"]
            remaining = max(0, daily_limit - sent_today)
            if remaining <= 0:
                continue

            queue_items = db.execute(
                "SELECT * FROM email_queue WHERE campaign_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT ?",
                (c["id"], remaining)
            ).fetchall()

            for item in queue_items:
                qi = dict(item)
                unsub = db.execute("SELECT id FROM email_unsubscribes WHERE email = ?", (qi["to_email"].lower(),)).fetchone()
                if unsub:
                    db.execute("UPDATE email_queue SET status = 'failed', error_msg = 'unsubscribed' WHERE id = ?", (qi["id"],))
                    continue
                try:
                    sender_email = c.get("sender_email") or os.environ.get("SMTP_FROM", smtp_user)
                    sender_name = c.get("sender_name", "LitigationSpace")
                    reply_to = c.get("reply_to", "support@litigationspace.com")

                    msg = MIMEMultipart()
                    msg["From"] = f"{sender_name} <{sender_email}>"
                    msg["To"] = qi["to_email"]
                    msg["Subject"] = qi["subject"]
                    msg["Reply-To"] = reply_to
                    msg["List-Unsubscribe"] = f"<https://litigationspace.com/api/growth/email/unsubscribe?email={qi['to_email']}>"
                    msg.attach(MIMEText(qi["body"], "html"))

                    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                        if smtp_port not in (25,) and smtp_user and smtp_pass:
                            server.starttls()
                            server.login(smtp_user, smtp_pass)
                        server.send_message(msg)

                    now = datetime.now(timezone.utc).isoformat()
                    db.execute("UPDATE email_queue SET status = 'sent', sent_at = ? WHERE id = ?", (now, qi["id"]))
                    db.execute("UPDATE email_campaigns SET total_sent = total_sent + 1 WHERE id = ?", (c["id"],))
                    total_sent += 1
                except smtplib.SMTPRecipientsRefused as e:
                    db.execute("UPDATE email_queue SET status = 'bounced', error_msg = ? WHERE id = ?", (str(e), qi["id"]))
                    db.execute(
                        "INSERT INTO email_bounces (id, email, bounce_type, error_msg, queue_item_id, bounced_at) VALUES (?, ?, 'hard', ?, ?, ?)",
                        (generate_id(), qi["to_email"], str(e), qi["id"], datetime.now(timezone.utc).isoformat())
                    )
                    db.execute("UPDATE email_campaigns SET total_bounced = total_bounced + 1 WHERE id = ?", (c["id"],))
                    total_failed += 1
                except Exception as e:
                    db.execute("UPDATE email_queue SET status = 'failed', error_msg = ? WHERE id = ?", (str(e), qi["id"]))
                    total_failed += 1

            # NOTE: Do NOT auto-complete campaigns when queue is empty.
            # Keep campaigns active so new enriched prospects get auto-queued.
            # Campaigns should only be completed manually by the user.

    return {"status": "processed", "total_sent": total_sent, "total_failed": total_failed}


# ================================================================
# EMAIL ENRICHMENT — Website Scraping + Hunter.io Free + Validation
# ================================================================

def _validate_email_dns(email: str) -> bool:
    """Validate email by checking if domain has MX records."""
    import dns.resolver
    try:
        domain = email.split("@")[1]
        answers = dns.resolver.resolve(domain, "MX")
        return len(answers) > 0
    except Exception:
        return False


def _validate_email_smtp(email: str) -> bool:
    """Validate email via SMTP RCPT TO check. Returns True if likely valid."""
    import smtplib
    import dns.resolver
    try:
        domain = email.split("@")[1]
        mx_records = dns.resolver.resolve(domain, "MX", lifetime=5)
        mx_host = str(sorted(mx_records, key=lambda r: r.preference)[0].exchange).rstrip(".")

        with smtplib.SMTP(mx_host, 25, timeout=5) as server:
            server.helo("litigationspace.com")
            server.mail("verify@litigationspace.com")
            code, _ = server.rcpt(email)
            return code == 250
    except Exception:
        return False


def _validate_email_full(email: str) -> dict:
    """Full email validation: syntax + DNS MX + SMTP check."""
    import re
    result = {"email": email, "valid": False, "reason": "unknown"}

    # Syntax check
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        result["reason"] = "invalid_syntax"
        return result

    # Skip obviously bad emails
    bad_domains = ["example.com", "test.com", "localhost", "sentry.io"]
    domain = email.split("@")[1].lower()
    if domain in bad_domains:
        result["reason"] = "disposable_domain"
        return result

    # DNS MX check
    if not _validate_email_dns(email):
        result["reason"] = "no_mx_records"
        return result

    # SMTP verification (best effort — many servers block this)
    try:
        smtp_valid = _validate_email_smtp(email)
        if not smtp_valid:
            # Don't mark as invalid just because SMTP check failed — many servers block VRFY
            result["valid"] = True
            result["reason"] = "dns_valid_smtp_unverified"
            return result
    except Exception:
        pass

    result["valid"] = True
    result["reason"] = "verified"
    return result


def _guess_common_emails(url: str) -> list:
    """Generate common email patterns from a website domain and validate with DNS MX check."""
    import re as _re
    if not url:
        return []
    # Extract domain from URL
    domain = url.replace("https://", "").replace("http://", "").split("/")[0].split("?")[0]
    # Remove www. prefix
    if domain.startswith("www."):
        domain = domain[4:]
    if not domain or "." not in domain:
        return []

    # Common email patterns for law firms
    common_prefixes = ["info", "contact", "office", "inquiries", "admin", "hello", "firm", "mail", "reception"]
    candidates = [f"{prefix}@{domain}" for prefix in common_prefixes]

    # Only return candidates whose domain has valid MX records (check once for all)
    if _validate_email_dns(candidates[0]):
        return candidates
    return []


def _scrape_emails_from_website(url: str) -> list:
    """Scrape email addresses from a website using requests + regex."""
    import re
    import requests
    emails_found = set()

    if not url:
        return []
    if not url.startswith("http"):
        url = "https://" + url

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Try main page
        resp = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
        text = resp.text

        # Find emails in page content
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        found = re.findall(email_pattern, text)
        for e in found:
            e_lower = e.lower()
            # Skip image/asset emails and common false positives
            if not any(e_lower.endswith(ext) for ext in [".png", ".jpg", ".gif", ".svg", ".webp", ".css", ".js"]):
                emails_found.add(e_lower)

        # Also check /contact and /about pages (limit to 2 for speed)
        base_url = url.rstrip("/")
        for path in ["/contact", "/about"]:
            try:
                resp2 = requests.get(base_url + path, headers=headers, timeout=5, allow_redirects=True)
                if resp2.status_code == 200:
                    found2 = re.findall(email_pattern, resp2.text)
                    for e in found2:
                        e_lower = e.lower()
                        if not any(e_lower.endswith(ext) for ext in [".png", ".jpg", ".gif", ".svg", ".webp", ".css", ".js"]):
                            emails_found.add(e_lower)
            except Exception:
                continue

    except Exception as ex:
        logger.warning(f"Failed to scrape {url}: {ex}")

    # Filter out generic/noreply emails — prefer personal ones
    preferred = []
    generic = []
    for e in emails_found:
        local = e.split("@")[0]
        if local in ("info", "noreply", "no-reply", "admin", "webmaster", "postmaster", "contact", "support", "sales", "hello"):
            generic.append(e)
        else:
            preferred.append(e)

    # Return preferred first, then generic
    return preferred + generic


def _hunter_io_find_email(domain: str) -> list:
    """Use Hunter.io free tier to find emails for a domain."""
    import requests
    hunter_key = os.environ.get("HUNTER_API_KEY", "")
    if not hunter_key:
        return []

    try:
        resp = requests.get(
            "https://api.hunter.io/v2/domain-search",
            params={"domain": domain, "api_key": hunter_key, "limit": 5},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            emails = []
            for item in data.get("data", {}).get("emails", []):
                email = item.get("value", "")
                confidence = item.get("confidence", 0)
                if email and confidence >= 50:
                    emails.append(email)
            return emails
    except Exception as ex:
        logger.warning(f"Hunter.io lookup failed for {domain}: {ex}")
    return []


async def run_email_enrichment():
    """Cron job: Enrich prospects with email addresses by scraping websites + Hunter.io + validation.
    
    Optimized: processes max 5 firms per run to avoid timeout. Uses DNS-only validation (fast).
    """
    enriched_count = 0
    validated_count = 0
    invalid_count = 0

    with get_db() as db:
        # Get lawfirms without emails that have websites — limit to 5 per run to stay fast
        firms = db.execute(
            "SELECT id, firm_name, website, email FROM prospects_lawfirms WHERE (email IS NULL OR email = '') AND website IS NOT NULL AND website != '' LIMIT 5"
        ).fetchall()

        for firm in firms:
            f = dict(firm)
            emails_found = []

            # Method 1: Scrape website (main page only for speed)
            if f.get("website"):
                try:
                    scraped = _scrape_emails_from_website(f["website"])
                    emails_found.extend(scraped)
                except Exception:
                    pass

            # Method 2: Hunter.io free tier
            if not emails_found and f.get("website"):
                try:
                    domain = f["website"].replace("https://", "").replace("http://", "").split("/")[0]
                    hunter_emails = _hunter_io_find_email(domain)
                    emails_found.extend(hunter_emails)
                except Exception:
                    pass

            # Method 3: Common email pattern guessing (info@, contact@, etc.)
            if not emails_found and f.get("website"):
                try:
                    guessed = _guess_common_emails(f["website"])
                    emails_found.extend(guessed)
                except Exception:
                    pass

            if emails_found:
                # Quick validation: syntax + DNS only (skip slow SMTP check)
                import re
                email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
                for candidate in emails_found[:3]:
                    if not re.match(email_pattern, candidate):
                        continue
                    # DNS MX check only (fast)
                    if _validate_email_dns(candidate):
                        db.execute(
                            "UPDATE prospects_lawfirms SET email = ? WHERE id = ?",
                            (candidate, f["id"])
                        )
                        enriched_count += 1
                        validated_count += 1
                        logger.info(f"Enriched firm {f['firm_name']} with email {candidate}")
                        break
                else:
                    invalid_count += 1

    # Auto-queue enriched prospects for the active campaign (always check, not just when new enrichments happen)
    queued_count = 0
    with get_db() as db:
        campaign = db.execute("SELECT id FROM email_campaigns WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").fetchone()
        if campaign:
            campaign_id = campaign["id"]
            # Find prospects with emails that are NOT yet in the email queue for this campaign
            unqueued = db.execute(
                """SELECT id, firm_name, email, attorney_name FROM prospects_lawfirms
                   WHERE email IS NOT NULL AND email != ''
                   AND email NOT IN (SELECT to_email FROM email_queue WHERE campaign_id = ?)""",
                (campaign_id,)
            ).fetchall()
            for row in unqueued:
                r = dict(row)
                name = r.get("attorney_name") or r.get("firm_name", "")
                subject = "Streamline Your Litigation Practice with AI-Powered Tools"
                body = f"""<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
<p>Hi {name},</p>
<p>I noticed your firm handles litigation matters and wanted to introduce <strong>LitigationSpace</strong> — a platform built specifically for litigators.</p>
<p>Our tools help attorneys:</p>
<ul>
<li><strong>Analyze motions in seconds</strong> with AI-powered strength scoring</li>
<li><strong>Draft legal documents</strong> using jurisdiction-aware templates</li>
<li><strong>Organize cases</strong> with a comprehensive case vault</li>
<li><strong>Simulate win probability</strong> before filing</li>
</ul>
<p>Would you be open to a quick demo? You can also try it free at <a href="https://litigationspace.com/signup" style="color: #2563eb;">litigationspace.com</a>.</p>
<p>Best regards,<br><strong>LitigationSpace Team</strong></p>
<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
<p style="font-size: 11px; color: #999;">You received this because your firm was listed in public legal directories. <a href="https://litigationspace.com/api/growth/email/unsubscribe?email={r['email']}" style="color: #999;">Unsubscribe</a></p>
</div>"""
                db.execute(
                    "INSERT INTO email_queue (id, campaign_id, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
                    (generate_id(), campaign_id, r["email"], subject, body, datetime.now(timezone.utc).isoformat())
                )
                queued_count += 1
                logger.info(f"Auto-queued email for {r['email']}")

    return {
        "status": "completed",
        "enriched": enriched_count,
        "validated": validated_count,
        "invalid": invalid_count,
        "auto_queued": queued_count,
    }


@router.post("/email/enrich")
async def trigger_email_enrichment(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Manually trigger email enrichment for prospects."""
    result = await run_email_enrichment()
    return result


@router.post("/email/validate")
async def validate_email_endpoint(email: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Validate a single email address."""
    result = _validate_email_full(email)
    return result


@router.get("/email/enrichment-stats")
async def get_enrichment_stats(current_user: dict = Depends(get_current_user)):
    """Get email enrichment statistics."""
    with get_db() as db:
        total_firms = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms").fetchone()["cnt"]
        firms_with_email = db.execute("SELECT COUNT(*) as cnt FROM prospects_lawfirms WHERE email IS NOT NULL AND email != ''").fetchone()["cnt"]
        total_experts = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts").fetchone()["cnt"]
        experts_with_email = db.execute("SELECT COUNT(*) as cnt FROM prospects_experts WHERE email IS NOT NULL AND email != ''").fetchone()["cnt"]

    return {
        "lawfirms": {"total": total_firms, "with_email": firms_with_email, "enrichment_rate": round(firms_with_email / max(total_firms, 1) * 100, 1)},
        "experts": {"total": total_experts, "with_email": experts_with_email, "enrichment_rate": round(experts_with_email / max(total_experts, 1) * 100, 1)},
        "total_reachable": firms_with_email + experts_with_email,
    }


# ================================================================
# FACEBOOK AUTO-POSTING via Graph API
# ================================================================

def _get_facebook_credentials(site: str = "ls") -> tuple[str, str]:
    """Return (page_id, access_token) for the given site.

    For 'ls': checks FACEBOOK_PAGE_ID_LS first, then the legacy FACEBOOK_PAGE_ID
              (backward compatibility for VPS deployments that only have the legacy vars).

    For all other sites (e.g. 'bc'): checks ONLY the site-specific env var with NO
              fallback to the legacy vars. This is intentional — falling back to LS
              credentials would silently publish BC content to the LS Facebook page
              when BC-specific credentials are not yet configured.

    Required env vars for BuildChampions:
        FACEBOOK_PAGE_ID_BC               — BC Facebook page numeric ID
        FACEBOOK_PAGE_ACCESS_TOKEN_BC     — BC long-lived page access token
    """
    if site == "ls":
        page_id = (
            os.environ.get("FACEBOOK_PAGE_ID_LS", "")
            or os.environ.get("FACEBOOK_PAGE_ID", "")
        )
        access_token = (
            os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN_LS", "")
            or os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", "")
        )
    else:
        # Non-LS sites: site-specific vars only — no LS fallback
        site_key     = site.upper()
        page_id      = os.environ.get(f"FACEBOOK_PAGE_ID_{site_key}", "")
        access_token = os.environ.get(f"FACEBOOK_PAGE_ACCESS_TOKEN_{site_key}", "")
    return page_id, access_token


def _publish_to_facebook(content: str, site: str = "ls") -> dict:
    """Publish a post to the Facebook Page for the given site via Graph API."""
    import requests

    page_id, access_token = _get_facebook_credentials(site)

    if not page_id or not access_token:
        return {
            "status": "skipped",
            "reason": f"Facebook credentials not configured for site '{site}' "
                      f"(set FACEBOOK_PAGE_ID_{site.upper()} and FACEBOOK_PAGE_ACCESS_TOKEN_{site.upper()})",
        }

    try:
        url = f"https://graph.facebook.com/v19.0/{page_id}/feed"
        payload = {
            "message": content,
            "access_token": access_token,
        }
        resp = requests.post(url, data=payload, timeout=15)
        data = resp.json()

        if "id" in data:
            return {"status": "published", "post_id": data["id"]}
        else:
            error_msg = data.get("error", {}).get("message", "Unknown error")
            return {"status": "error", "error": error_msg}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def run_facebook_auto_publish(site: str = "ls"):
    """Cron job: Find scheduled Facebook posts for a given site and publish via Graph API.

    The site parameter controls:
      - which rows are fetched (WHERE website_id = site)
      - which Facebook page credentials are used

    Defaults to 'ls' so the existing LitigationSpace cron call is unchanged.
    """
    published = 0
    failed = 0

    page_id, access_token = _get_facebook_credentials(site)

    if not page_id or not access_token:
        return {
            "status": "skipped",
            "reason": f"Facebook credentials not configured for site '{site}'",
            "site": site,
        }

    with get_db() as db:
        # Only fetch scheduled posts belonging to this site
        posts = db.execute(
            "SELECT * FROM social_posts WHERE platform = 'facebook' AND status = 'scheduled' AND website_id = ? ORDER BY created_at ASC LIMIT 5",
            (site,)
        ).fetchall()

        for post in posts:
            p = dict(post)
            result = _publish_to_facebook(p["content"], site=site)

            if result.get("status") == "published":
                db.execute(
                    "UPDATE social_posts SET status = 'published', published_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), p["id"])
                )
                published += 1
                logger.info(f"[{site}] Published Facebook post {p['id']}: {result.get('post_id')}")
            else:
                db.execute(
                    "UPDATE social_posts SET status = 'failed' WHERE id = ?",
                    (p["id"],)
                )
                failed += 1
                logger.warning(f"[{site}] Failed to publish Facebook post {p['id']}: {result.get('error')}")

    return {"status": "completed", "published": published, "failed": failed, "site": site}


@router.post("/social/facebook/publish-pending")
async def publish_pending_facebook(site: str = "ls", current_user: dict = Depends(get_current_user)):
    """Manually trigger publishing all pending Facebook posts for the given site."""
    result = await run_facebook_auto_publish(site=site)
    return result


# ================================================================
# MARKETING VIDEOS — AI-generated explainer videos + multi-platform posting
# ================================================================

VIDEOS_DIR = "/var/www/litigationspace-staging/data/marketing_videos"


@router.get("/videos")
async def list_marketing_videos(site: str = "ls", page: int = 1, limit: int = 20, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        offset = (page - 1) * limit
        rows = db.execute(
            "SELECT * FROM marketing_videos WHERE website_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (site, limit, offset)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as cnt FROM marketing_videos WHERE website_id = ?", (site,)).fetchone()["cnt"]
        items = []
        for r in rows:
            d = dict(r)
            d["script"] = json.loads(d["script"]) if d.get("script") else None
            items.append(d)
        return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/videos/{video_id}/download")
async def download_marketing_video(video_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        row = db.execute("SELECT * FROM marketing_videos WHERE id = ?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        path = os.path.join(VIDEOS_DIR, row["video_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Video file missing on disk")
        filename = f"{row['title'][:60].replace('/', '-')}.mp4"
        return FileResponse(path, media_type="video/mp4", filename=filename)


@router.get("/videos/{video_id}/thumbnail")
async def get_marketing_video_thumbnail(video_id: str):
    with get_db() as db:
        row = db.execute("SELECT thumbnail_path FROM marketing_videos WHERE id = ?", (video_id,)).fetchone()
        if not row or not row["thumbnail_path"]:
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        path = os.path.join(VIDEOS_DIR, row["thumbnail_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Thumbnail file missing on disk")
        return FileResponse(path, media_type="image/png")


@router.post("/videos/generate")
async def generate_marketing_video_now(site: str = "ls", current_user: dict = Depends(get_current_user)):
    """Manually trigger generation of one explainer video."""
    from app.services.video_generator import generate_marketing_video
    with get_db() as db:
        result = generate_marketing_video(db, website_id=site)
    if result.get("status") != "success":
        raise HTTPException(status_code=400, detail=result.get("reason", "Video generation failed"))
    return result


@router.post("/videos/{video_id}/publish")
async def publish_marketing_video(video_id: str, platforms: str = Query(..., description="Comma-separated: youtube,tiktok,facebook,instagram"), current_user: dict = Depends(get_current_user)):
    """Publish a generated video to one or more platforms."""
    with get_db() as db:
        row = db.execute("SELECT * FROM marketing_videos WHERE id = ?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        video = dict(row)
        path = os.path.join(VIDEOS_DIR, video["video_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Video file missing on disk")

        results = {}
        for platform in [p.strip().lower() for p in platforms.split(",") if p.strip()]:
            if platform == "youtube":
                result = _publish_video_to_youtube(path, video["title"], video.get("script"), site=video["website_id"])
            elif platform == "tiktok":
                result = _publish_video_to_tiktok(path, video["title"], site=video["website_id"])
            elif platform == "facebook":
                result = _publish_video_to_facebook(path, video["title"], site=video["website_id"])
            elif platform == "instagram":
                result = _publish_video_to_instagram(path, video["title"], site=video["website_id"])
            else:
                result = {"status": "error", "error": f"Unknown platform '{platform}'"}

            results[platform] = result
            status_col = f"{platform}_status"
            url_col = f"{platform}_url"
            if result.get("status") == "published":
                db.execute(
                    f"UPDATE marketing_videos SET {status_col} = 'published', {url_col} = ? WHERE id = ?",
                    (result.get("url", ""), video_id)
                )
            elif result.get("status") == "skipped":
                db.execute(f"UPDATE marketing_videos SET {status_col} = 'pending_api_key' WHERE id = ?", (video_id,))
            else:
                db.execute(f"UPDATE marketing_videos SET {status_col} = 'failed' WHERE id = ?", (video_id,))
        db.commit()

    return {"video_id": video_id, "results": results}


def _publish_video_to_youtube(video_path: str, title: str, script_json, site: str = "ls") -> dict:
    """Upload a video to YouTube via the YouTube Data API v3.

    Requires env vars:
      YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
    """
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN")

    if not (client_id and client_secret and refresh_token):
        return {"status": "skipped", "reason": "YouTube credentials not configured (set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)"}

    try:
        import requests

        token_resp = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15)
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return {"status": "error", "error": f"Token refresh failed: {token_data}"}

        description = "Learn how to use LitigationSpace - the AI operating system for litigation attorneys.\n\nTry it free: https://litigationspace.com"
        try:
            script = json.loads(script_json) if script_json else None
            if script and script.get("slides"):
                description += "\n\n" + " ".join(s.get("voiceover", "") for s in script["slides"])
        except Exception:
            pass

        metadata = {
            "snippet": {
                "title": title[:100],
                "description": description[:5000],
                "tags": ["litigation", "legal AI", "law firm software", "LitigationSpace"],
                "categoryId": "27",
            },
            "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
        }

        init_resp = requests.post(
            "https://www.googleapis.com/upload/youtube/v3/videos",
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
            json=metadata,
            timeout=15,
        )
        upload_url = init_resp.headers.get("Location")
        if not upload_url:
            return {"status": "error", "error": f"Failed to init upload: {init_resp.text[:300]}"}

        with open(video_path, "rb") as f:
            video_bytes = f.read()

        upload_resp = requests.put(
            upload_url,
            headers={"Content-Type": "video/mp4", "Content-Length": str(len(video_bytes))},
            data=video_bytes,
            timeout=300,
        )
        result = upload_resp.json()
        video_id = result.get("id")
        if video_id:
            return {"status": "published", "url": f"https://www.youtube.com/watch?v={video_id}"}
        return {"status": "error", "error": f"Upload failed: {result}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _publish_video_to_tiktok(video_path: str, title: str, site: str = "ls") -> dict:
    """Upload a video to TikTok via the Content Posting API.

    Requires env vars:
      TIKTOK_ACCESS_TOKEN
    """
    access_token = os.environ.get("TIKTOK_ACCESS_TOKEN")
    if not access_token:
        return {"status": "skipped", "reason": "TikTok credentials not configured (set TIKTOK_ACCESS_TOKEN)"}

    try:
        import requests

        file_size = os.path.getsize(video_path)

        init_resp = requests.post(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "post_info": {
                    "title": title[:150],
                    "privacy_level": "PUBLIC_TO_EVERYONE",
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": file_size,
                    "chunk_size": file_size,
                    "total_chunk_count": 1,
                },
            },
            timeout=15,
        )
        init_data = init_resp.json()
        publish_id = init_data.get("data", {}).get("publish_id")
        upload_url = init_data.get("data", {}).get("upload_url")
        if not upload_url:
            return {"status": "error", "error": f"Init failed: {init_data}"}

        with open(video_path, "rb") as f:
            video_bytes = f.read()

        requests.put(
            upload_url,
            headers={
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes 0-{file_size - 1}/{file_size}",
            },
            data=video_bytes,
            timeout=300,
        )

        return {"status": "published", "url": f"https://www.tiktok.com/publish/status/{publish_id}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _publish_video_to_facebook(video_path: str, title: str, site: str = "ls") -> dict:
    """Upload a video as a Facebook Reel via Graph API."""
    page_id, access_token = _get_facebook_credentials(site)
    if not page_id or not access_token:
        return {"status": "skipped", "reason": f"Facebook credentials not configured for site '{site}'"}

    try:
        import requests
        with open(video_path, "rb") as f:
            resp = requests.post(
                f"https://graph.facebook.com/v19.0/{page_id}/videos",
                data={"access_token": access_token, "description": title},
                files={"source": f},
                timeout=300,
            )
        data = resp.json()
        if "id" in data:
            return {"status": "published", "url": f"https://www.facebook.com/{data['id']}"}
        return {"status": "error", "error": data.get("error", {}).get("message", "Unknown error")}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _publish_video_to_instagram(video_path: str, title: str, site: str = "ls") -> dict:
    """Publish a video as an Instagram Reel via Graph API.

    Requires env vars:
      INSTAGRAM_ACCOUNT_ID_<SITE>, INSTAGRAM_ACCESS_TOKEN_<SITE>
    Note: Instagram's API requires a publicly accessible video URL, not a file upload -
    so the video must already be served from this server's marketing_videos directory.
    """
    site_key = site.upper()
    ig_account_id = os.environ.get(f"INSTAGRAM_ACCOUNT_ID_{site_key}", os.environ.get("INSTAGRAM_ACCOUNT_ID", ""))
    access_token = os.environ.get(f"INSTAGRAM_ACCESS_TOKEN_{site_key}", os.environ.get("INSTAGRAM_ACCESS_TOKEN", ""))

    if not ig_account_id or not access_token:
        return {"status": "skipped", "reason": f"Instagram credentials not configured for site '{site}' (set INSTAGRAM_ACCOUNT_ID_{site_key} and INSTAGRAM_ACCESS_TOKEN_{site_key})"}

    try:
        import requests

        video_filename = os.path.basename(video_path)
        public_url = f"https://litigationspace.com/marketing-videos/{video_filename}"

        create_resp = requests.post(
            f"https://graph.facebook.com/v19.0/{ig_account_id}/media",
            data={
                "media_type": "REELS",
                "video_url": public_url,
                "caption": f"{title}\n\nTry LitigationSpace free: https://litigationspace.com",
                "access_token": access_token,
            },
            timeout=30,
        )
        create_data = create_resp.json()
        creation_id = create_data.get("id")
        if not creation_id:
            return {"status": "error", "error": f"Container creation failed: {create_data}"}

        publish_resp = requests.post(
            f"https://graph.facebook.com/v19.0/{ig_account_id}/media_publish",
            data={"creation_id": creation_id, "access_token": access_token},
            timeout=60,
        )
        publish_data = publish_resp.json()
        media_id = publish_data.get("id")
        if media_id:
            return {"status": "published", "url": f"https://www.instagram.com/reel/{media_id}"}
        return {"status": "error", "error": f"Publish failed: {publish_data}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def run_ai_video_generation(site: str = "ls"):
    """Cron job: generate one explainer video and attempt to auto-publish to all configured platforms."""
    from app.services.video_generator import generate_marketing_video
    with get_db() as db:
        result = generate_marketing_video(db, website_id=site)
        if result.get("status") != "success":
            return result

        video_id = result["id"]
        row = db.execute("SELECT * FROM marketing_videos WHERE id = ?", (video_id,)).fetchone()
        video = dict(row)
        path = os.path.join(VIDEOS_DIR, video["video_path"])

        publish_results = {}
        for platform, fn in [
            ("youtube", _publish_video_to_youtube),
            ("tiktok", _publish_video_to_tiktok),
            ("facebook", _publish_video_to_facebook),
            ("instagram", _publish_video_to_instagram),
        ]:
            if platform == "youtube":
                r = fn(path, video["title"], video.get("script"), site=site)
            else:
                r = fn(path, video["title"], site=site)
            publish_results[platform] = r["status"]

            status_col = f"{platform}_status"
            url_col = f"{platform}_url"
            if r.get("status") == "published":
                db.execute(f"UPDATE marketing_videos SET {status_col} = 'published', {url_col} = ? WHERE id = ?", (r.get("url", ""), video_id))
            elif r.get("status") == "skipped":
                db.execute(f"UPDATE marketing_videos SET {status_col} = 'pending_api_key' WHERE id = ?", (video_id,))
            else:
                db.execute(f"UPDATE marketing_videos SET {status_col} = 'failed' WHERE id = ?", (video_id,))
        db.commit()

        result["publish_results"] = publish_results
        return result
