from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
import asyncio
import jwt
from datetime import datetime, timezone

from app.database import init_db, get_db, _migrate_cases_exhibit_numbering, _migrate_growth_website_id
from app.utils.trial_emails import run_trial_notifications
from app.routers import auth, experts, cases, documents, warroom, notifications, uscis, workflows, features, drafting, judicial, motion_analyzer, growth, legal_brain, jurisdiction, admin_analytics, signatures, outreach, tracking
from app.routers import contact as contact_router
from app.routers import support_chat as support_chat_router
from app.routers import billing as billing_router
from app.utils.admin_config import ALLOWED_INTERNAL_DASHBOARD_EMAILS, _ALLOWED_LOWER
from app.utils.auth import SECRET_KEY, ALGORITHM


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    import os
    init_db()
    # Run migrations for existing databases
    with get_db() as db:
        _migrate_cases_exhibit_numbering(db)
        _migrate_growth_website_id(db)  # Phase 1: multi-site website_id columns
    legal_brain.init_legal_brain_tables()
    jurisdiction.init_jurisdiction_tables()
    _seed_growth_data()

    # ── Staging guard ──────────────────────────────────────────────────────────
    # When STAGING=true all scheduled jobs are disabled.
    # No blog publishing, no social posting, no email sending, no SerpAPI calls.
    # Jobs can still be triggered manually via the Growth OS dashboard.
    if os.environ.get("STAGING", "").lower() == "true":
        yield
        return
    # ──────────────────────────────────────────────────────────────────────────

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        lambda: asyncio.run(uscis.run_uscis_cron()),
        'interval',
        hours=6,
        id='uscis_cron'
    )
    # Growth OS cron jobs - Optimized for SerpAPI free tier (100 searches/month)
    # Budget: ~50 law firms (every other day) + ~10 experts (every 3 days) + ~4 competitor + ~4 keyword spot-checks = ~68 searches/month
    # Leaves ~32 searches/month for manual dashboard use
    scheduler.add_job(_run_cron_job, 'cron', day='1-31/2', hour=2, minute=0, args=['lead_discovery'], id='lead_discovery')  # Every other day
    scheduler.add_job(_run_cron_job, 'cron', day='1-31/3', hour=3, minute=0, args=['expert_recruitment'], id='expert_recruitment')  # Every 3 days
    scheduler.add_job(_run_cron_job, 'cron', hour=4, minute=0, args=['outreach_emails'], id='outreach_emails')  # Daily (no SerpAPI cost)
    scheduler.add_job(_run_cron_job, 'cron', hour=9, minute=0, args=['blog_publish'], id='blog_publish')  # Daily (OpenAI only)
    scheduler.add_job(_run_cron_job, 'cron', hour=12, minute=0, args=['social_publish_am'], id='social_publish_am')  # Daily (OpenAI only)
    scheduler.add_job(_run_cron_job, 'cron', hour=18, minute=0, args=['social_publish_pm'], id='social_publish_pm')  # Daily (OpenAI only)
    scheduler.add_job(_run_cron_job, 'cron', hour=6, minute=0, args=['live_bench_profiles'], id='live_bench_profiles')  # Daily (OpenAI only)
    scheduler.add_job(_run_cron_job, 'cron', hour='*/6', args=['send_reminders'], id='send_reminders')  # Every 6 hours
    scheduler.add_job(_run_cron_job, 'cron', hour=7, minute=0, args=['daily_briefing'], id='daily_briefing')  # Daily 7am UTC
    scheduler.add_job(run_trial_notifications, 'cron', hour=8, minute=30, id='trial_notifications')  # Daily 8:30am UTC
    scheduler.add_job(_run_cron_job, 'cron', hour=10, minute=0, args=['auto_resend_verification'], id='auto_resend_verification')  # Daily 10am UTC
    scheduler.add_job(_run_cron_job, 'cron', day='1-31/3', hour=4, minute=30, args=['jurisdiction_discovery'], id='jurisdiction_discovery')  # Every 3 days
    scheduler.add_job(_run_cron_job, 'cron', day_of_week='mon', hour=6, minute=0, args=['dns_health_check'], id='dns_health_check')  # Weekly Monday 6am UTC
    scheduler.add_job(_run_cron_job, 'cron', day_of_week='mon', hour=5, minute=0, args=['competitor_analysis'], id='competitor_analysis')  # Weekly (1 search)
    scheduler.add_job(_run_cron_job, 'cron', day_of_week='wed', hour=5, minute=0, args=['keyword_ranking_spot'], id='keyword_ranking_spot')  # Weekly spot-check (2 keywords)
    scheduler.add_job(_run_cron_job, 'cron', hour=14, minute=0, args=['ai_video_generation'], id='ai_video_generation')  # Daily (OpenAI + FFmpeg)
    scheduler.start()
    yield
    scheduler.shutdown()


from app.routers.bench_marketplace import router as bench_marketplace_router
app = FastAPI(
    title="LitigationSpace API",
    description="High-velocity legal workspace - Live Marketplace + AI Case Management + War Room",
    version="1.0.0",
    lifespan=lifespan,
)

# Disable CORS. Do not remove this for full-stack development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# ── Internal dashboard access enforcement ─────────────────────────────────────
# Growth paths that are intentionally public (no JWT required):
#   /public/        — directory endpoints displayed on the homepage
#   /leads/capture  — free motion analyzer lead form
#   /cron/trigger/  — called by cron_marketing.sh with a shared secret, not JWT
#   /email/unsubscribe — one-click unsubscribe links in outreach emails
#   /widget/config  — embeddable JS widget configuration
#   GET /blog/*     — public blog article reads that power the public /blog page
#                     (no auth dependency in growth.py — intentional public reads)
_GROWTH_PUBLIC_EXACT: frozenset[str] = frozenset({
    "/api/growth/leads/capture",
    "/api/growth/email/unsubscribe",
    "/api/growth/widget/config",
})


@app.middleware("http")
async def enforce_internal_dashboard_access(request: Request, call_next):
    """
    Block non-allowlisted users from all internal dashboard endpoints.
    Covers:
      - /api/growth/* (except public sub-paths listed below)
      - /api/admin/analytics/*

    Protected live automation paths — DO NOT REMOVE these exemptions:
      GET /api/growth/blog/*     — powers the public /blog page; no auth in growth.py
      POST /api/growth/blog/*    — write operations remain admin-only
      /api/growth/social/posts   — reads/writes via existing social engine (admin-only)
      /api/growth/ai/generate-*  — AI generation (admin-only, existing cron behavior preserved)
    """
    # CORS preflight — let through unconditionally so CORSMiddleware can handle it
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path

    # Determine whether this path needs the allowlist check
    needs_check = False
    if path.startswith("/api/growth/"):
        # Skip genuinely public growth paths
        if (
            "/public/" not in path
            and path not in _GROWTH_PUBLIC_EXACT
            and not path.startswith("/api/growth/cron/trigger")
            # Blog article READS are public — they serve the /blog landing page.
            # growth.py list_blog_articles() and get_blog_article() have no auth dependency.
            # POST /blog/articles remains admin-only (write ops still need auth).
            and not (request.method == "GET" and path.startswith("/api/growth/blog/"))
        ):
            needs_check = True
    elif path.startswith("/api/admin/analytics/"):
        needs_check = True
    elif path.startswith("/api/support/admin/"):
        needs_check = True

    if not needs_check:
        return await call_next(request)

    # Validate JWT and check email allowlist
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("email", "").lower()
        if email not in _ALLOWED_LOWER:
            return JSONResponse(status_code=403, content={"detail": "Unauthorized"})
    except jwt.ExpiredSignatureError:
        return JSONResponse(status_code=401, content={"detail": "Token expired"})
    except jwt.InvalidTokenError:
        return JSONResponse(status_code=401, content={"detail": "Invalid token"})

    return await call_next(request)


# Register routers
app.include_router(auth.router)
app.include_router(experts.router)
app.include_router(cases.router)
app.include_router(documents.router)
app.include_router(warroom.router)
app.include_router(notifications.router)
app.include_router(uscis.router)
app.include_router(workflows.router)
app.include_router(features.router)
app.include_router(drafting.router)
app.include_router(judicial.router)
app.include_router(motion_analyzer.router)
app.include_router(growth.router)
app.include_router(legal_brain.router)
app.include_router(jurisdiction.router)
app.include_router(admin_analytics.router)
app.include_router(signatures.router)
app.include_router(outreach.router)
app.include_router(contact_router.router)
app.include_router(support_chat_router.router)
app.include_router(billing_router.router)
app.include_router(bench_marketplace_router)
app.include_router(tracking.router)


def _run_cron_job(job_name: str):
    """Execute a Growth OS cron job and log the result."""
    from app.database import get_db
    from app.utils.auth import generate_id
    from app.routers.growth import run_ai_lead_discovery, run_ai_blog_generation, run_ai_social_generation, run_ai_expert_discovery, run_competitor_analysis_cron, run_keyword_spot_check, run_ai_live_bench_profile_generation, run_ai_video_generation
    import os

    details = f"{job_name} completed"
    status = "success"

    try:
        # Run AI-powered jobs when keys are available
        if job_name == "lead_discovery" and os.environ.get("SERPAPI_KEY"):
            result = asyncio.run(run_ai_lead_discovery())
            details = f"Lead discovery: {result.get('status')} - discovered {result.get('discovered', 0)} firms"
        elif job_name == "blog_publish" and os.environ.get("OPENAI_API_KEY"):
            result = asyncio.run(run_ai_blog_generation(site="ls"))  # APScheduler: always LS
            details = f"Blog generation: {result.get('status')} - {result.get('title', 'N/A')}"
        elif job_name in ("social_publish_am", "social_publish_pm") and os.environ.get("OPENAI_API_KEY"):
            result = asyncio.run(run_ai_social_generation(site="ls"))  # APScheduler: always LS
            details = f"Social generation: {result.get('status')} - {result.get('platform', 'N/A')}"
        elif job_name == "live_bench_profiles" and os.environ.get("OPENAI_API_KEY"):
            result = asyncio.run(run_ai_live_bench_profile_generation())
            details = f"Live Bench profiles: {result.get('status')} - generated {result.get('generated', 0)}"
        elif job_name == "expert_recruitment" and os.environ.get("SERPAPI_KEY"):
            result = asyncio.run(run_ai_expert_discovery())
            details = f"Expert discovery: {result.get('status')} - discovered {result.get('discovered', 0)} experts"
        elif job_name == "competitor_analysis" and os.environ.get("SERPAPI_KEY"):
            result = asyncio.run(run_competitor_analysis_cron())
            details = f"Competitor analysis: {result.get('status')} - {result.get('total_results', 0)} results"
        elif job_name == "keyword_ranking_spot" and os.environ.get("SERPAPI_KEY"):
            result = asyncio.run(run_keyword_spot_check())
            details = f"Keyword spot-check: {result.get('status')} - checked {result.get('checked', 0)} keywords"
        elif job_name == "send_reminders":
            from app.routers.legal_brain import send_due_reminders
            result = asyncio.run(send_due_reminders())
            details = f"Reminders: processed {result.get('processed', 0)}"
        elif job_name == "daily_briefing":
            from app.routers.legal_brain import send_daily_briefing_emails
            asyncio.run(send_daily_briefing_emails())
            details = "Daily briefing emails sent"
        elif job_name == "auto_resend_verification":
            from app.utils.health import auto_resend_verification
            result = auto_resend_verification()
            details = f"Verification reminders: sent {result.get('reminders_sent', 0)}"
        elif job_name == "jurisdiction_discovery":
            from app.routers.jurisdiction import run_jurisdiction_discovery
            result = asyncio.run(run_jurisdiction_discovery())
            total = result.get("total_added", 0)
            codes = ", ".join(r["code"] for r in result.get("jurisdictions", []))
            details = f"Jurisdiction discovery: {total} docs added ({codes})"
        elif job_name == "dns_health_check":
            from app.utils.health import check_dns_health
            result = check_dns_health()
            missing = result.get("missing", [])
            details = f"DNS health: {'OK' if not missing else 'MISSING: ' + ', '.join(missing)}"
        elif job_name == "ai_video_generation" and os.environ.get("OPENAI_API_KEY"):
            result = asyncio.run(run_ai_video_generation(site="ls"))
            details = f"Video generation: {result.get('status')} - {result.get('title', result.get('reason', 'N/A'))}"
        elif job_name == "outreach_emails":
            smtp_configured = bool(os.environ.get("SMTP_HOST"))
            details = f"Outreach emails: {'SMTP ready' if smtp_configured else 'SMTP not configured - skipped'}"

        with get_db() as db:
            db.execute(
                "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, ?, ?, ?)",
                (generate_id(), job_name, status, details, datetime.now(timezone.utc).isoformat())
            )
    except Exception as e:
        try:
            with get_db() as db:
                db.execute(
                    "INSERT INTO cron_log (id, job_name, status, details, executed_at) VALUES (?, ?, 'failed', ?, ?)",
                    (generate_id(), job_name, str(e), datetime.now(timezone.utc).isoformat())
                )
        except Exception:
            pass


def _seed_growth_data():
    """Seed default email sequences and blog articles for Growth OS."""
    from app.database import get_db
    from app.utils.auth import generate_id
    import json
    try:
        with get_db() as db:
            # Seed email sequences if empty
            seq_count = db.execute("SELECT COUNT(*) as cnt FROM email_sequences").fetchone()["cnt"]
            if seq_count == 0:
                sequences = [
                    ("lawfirm_intro", 1, 0, "Analyze your next motion before the hearing",
                     "<p>Hi [Name],</p><p>Litigation teams are using LitigationSpace to analyze motions and detect weaknesses before hearings.</p><p>Try the free Motion Analyzer: <a href='https://litigationspace.com/motion-analyzer'>litigationspace.com/motion-analyzer</a></p><p>Best,<br>LitigationSpace Team</p>"),
                    ("lawfirm_intro", 2, 3, "Did you try the Motion Analyzer?",
                     "<p>Hi [Name],</p><p>Just following up — have you had a chance to try the free Motion Analyzer?</p><p>Upload any motion and get instant analysis of weaknesses, risk flags, and attack points.</p><p><a href='https://litigationspace.com/motion-analyzer'>Try it here</a></p>"),
                    ("lawfirm_intro", 3, 7, "How top litigation firms prepare for hearings",
                     "<p>Hi [Name],</p><p>The best litigation teams don't walk into hearings blind. They analyze motions for weaknesses, simulate outcomes, and prepare targeted attack strategies.</p><p>LitigationSpace gives you all three in one platform.</p><p><a href='https://litigationspace.com'>Learn more</a></p>"),
                    ("expert_invite", 1, 0, "Join LitigationSpace as an Expert",
                     "<p>Hi [Name],</p><p>LitigationSpace connects litigation experts with law firms who need immediate help. Get matched with cases in your specialty.</p><p><a href='https://litigationspace.com/join-live-bench'>Join the Expert Marketplace</a></p>"),
                    ("expert_invite", 2, 5, "Firms are looking for experts like you",
                     "<p>Hi [Name],</p><p>Law firms on LitigationSpace are actively searching for experts in your practice area. Set your availability and start getting matched.</p><p><a href='https://litigationspace.com/join-live-bench'>Apply now</a></p>"),
                ]
                for seq in sequences:
                    db.execute(
                        "INSERT INTO email_sequences (id, sequence_name, step, delay_days, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (generate_id(), seq[0], seq[1], seq[2], seq[3], seq[4], datetime.now(timezone.utc).isoformat())
                    )

            # Seed blog articles if empty
            blog_count = db.execute("SELECT COUNT(*) as cnt FROM blog_articles").fetchone()["cnt"]
            if blog_count == 0:
                articles = [
                    {
                        "title": "South Carolina Rule 207: The Paralegal's Guide to Transcript Deadlines",
                        "slug": "sc-rule-207-transcript-deadlines",
                        "category": "jurisdictional_guide",
                        "meta_description": "Complete guide to South Carolina Rule 207 transcript deadlines. Learn filing requirements, extensions, and common mistakes paralegals make.",
                        "target_keywords": "South Carolina Rule 207, transcript deadlines, SC court rules, paralegal guide",
                    },
                    {
                        "title": "California CCP 437c: Motion for Summary Judgment Deadlines and Requirements",
                        "slug": "california-ccp-437c-msj-guide",
                        "category": "jurisdictional_guide",
                        "meta_description": "Step-by-step guide to California CCP 437c Summary Judgment requirements. Deadlines, evidence rules, and separate statement formatting.",
                        "target_keywords": "California CCP 437c, summary judgment California, MSJ deadlines, separate statement",
                    },
                    {
                        "title": "New York CPLR 3212: Summary Judgment Motion Practice Guide",
                        "slug": "new-york-cplr-3212-summary-judgment",
                        "category": "jurisdictional_guide",
                        "meta_description": "New York CPLR 3212 summary judgment guide. Filing deadlines, affidavit requirements, and common pitfalls.",
                        "target_keywords": "New York CPLR 3212, NY summary judgment, motion practice New York",
                    },
                    {
                        "title": "How to Analyze a Motion for Summary Judgment: A Complete Guide",
                        "slug": "analyze-summary-judgment-motion",
                        "category": "general",
                        "meta_description": "Learn how to systematically analyze a motion for summary judgment. Identify weaknesses, evaluate evidence, and build winning opposition strategies.",
                        "target_keywords": "analyze motion summary judgment, MSJ analysis, motion weaknesses",
                    },
                    {
                        "title": "Top 10 Reasons Motions to Dismiss Fail (And How to Avoid Them)",
                        "slug": "motion-dismiss-weaknesses",
                        "category": "general",
                        "meta_description": "The most common reasons motions to dismiss fail. Learn from real case examples and strengthen your motion practice.",
                        "target_keywords": "motion to dismiss fail, 12b6 mistakes, dismiss motion weaknesses",
                    },
                ]
                for art in articles:
                    db.execute(
                        "INSERT INTO blog_articles (id, title, slug, content, category, meta_description, target_keywords, view_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
                        (generate_id(), art["title"], art["slug"], "", art["category"], art["meta_description"], art["target_keywords"], datetime.now(timezone.utc).isoformat())
                    )
    except Exception:
        pass


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/stats")
async def get_stats():
    """Get platform statistics."""
    from app.database import get_db
    with get_db() as db:
        users_count = db.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
        cases_count = db.execute("SELECT COUNT(*) as cnt FROM cases").fetchone()["cnt"]
        experts_ready = db.execute(
            "SELECT COUNT(*) as cnt FROM users WHERE role = 'expert' AND status = 'READY'"
        ).fetchone()["cnt"]
        active_cases = db.execute(
            "SELECT COUNT(*) as cnt FROM cases WHERE status = 'active'"
        ).fetchone()["cnt"]
        docs = db.execute("SELECT COUNT(*) as cnt FROM documents").fetchone()["cnt"]
    return {
        "total_users": users_count,
        "total_cases": cases_count,
        "active_cases": active_cases,
        "experts_ready": experts_ready,
        "total_documents": docs,
    }
