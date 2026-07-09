from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional
import sqlite3, os, re

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

DB_PATH = os.getenv("DB_PATH", "/var/www/litigationspace-staging/data/app.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def detect_search_engine(referrer: str) -> str:
    if not referrer:
        return ""
    r = referrer.lower()
    if "google." in r:
        return "google"
    if "bing." in r:
        return "bing"
    if "yahoo." in r:
        return "yahoo"
    if "duckduckgo." in r:
        return "duckduckgo"
    if "baidu." in r:
        return "baidu"
    return ""

class VisitPayload(BaseModel):
    page: str
    referrer: Optional[str] = ""
    utm_source: Optional[str] = ""
    utm_medium: Optional[str] = ""
    utm_campaign: Optional[str] = ""
    utm_term: Optional[str] = ""
    utm_content: Optional[str] = ""

@router.post("/pageview")
async def record_pageview(payload: VisitPayload, request: Request):
    # Sanitize: limit lengths
    def s(v): return (v or "")[:200]
    se = detect_search_engine(payload.referrer or "")
    db = get_db()
    try:
        db.execute(
            """INSERT INTO page_visits
               (page, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, search_engine)
               VALUES (?,?,?,?,?,?,?,?)""",
            (s(payload.page), s(payload.referrer), s(payload.utm_source),
             s(payload.utm_medium), s(payload.utm_campaign), s(payload.utm_term),
             s(payload.utm_content), se)
        )
        db.commit()
    finally:
        db.close()
    return {"ok": True}

@router.get("/stats")
async def get_visit_stats(days: int = 30):
    db = get_db()
    try:
        # Total visits
        total = db.execute(
            "SELECT COUNT(*) as n FROM page_visits WHERE created_at >= datetime('now', ? || ' days')",
            (f"-{days}",)
        ).fetchone()["n"]

        # Visits by page
        by_page = db.execute(
            """SELECT page, COUNT(*) as visits
               FROM page_visits
               WHERE created_at >= datetime('now', ? || ' days')
               GROUP BY page ORDER BY visits DESC LIMIT 20""",
            (f"-{days}",)
        ).fetchall()

        # Visits by search engine
        by_engine = db.execute(
            """SELECT search_engine, COUNT(*) as visits
               FROM page_visits
               WHERE created_at >= datetime('now', ? || ' days') AND search_engine != ''
               GROUP BY search_engine ORDER BY visits DESC""",
            (f"-{days}",)
        ).fetchall()

        # Visits by UTM source
        by_source = db.execute(
            """SELECT utm_source, COUNT(*) as visits
               FROM page_visits
               WHERE created_at >= datetime('now', ? || ' days') AND utm_source != ''
               GROUP BY utm_source ORDER BY visits DESC LIMIT 10""",
            (f"-{days}",)
        ).fetchall()

        # Top UTM keywords (paid/campaign tracking)
        by_keyword = db.execute(
            """SELECT utm_term, utm_source, COUNT(*) as visits
               FROM page_visits
               WHERE created_at >= datetime('now', ? || ' days') AND utm_term != ''
               GROUP BY utm_term, utm_source ORDER BY visits DESC LIMIT 20""",
            (f"-{days}",)
        ).fetchall()

        # Daily trend (last 14 days)
        daily = db.execute(
            """SELECT date(created_at) as day, COUNT(*) as visits
               FROM page_visits
               WHERE created_at >= datetime('now', '-14 days')
               GROUP BY day ORDER BY day""",
        ).fetchall()

        # Organic search visits
        organic = db.execute(
            """SELECT COUNT(*) as n FROM page_visits
               WHERE created_at >= datetime('now', ? || ' days') AND search_engine != ''""",
            (f"-{days}",)
        ).fetchone()["n"]

        return {
            "total": total,
            "organic": organic,
            "by_page": [dict(r) for r in by_page],
            "by_engine": [dict(r) for r in by_engine],
            "by_source": [dict(r) for r in by_source],
            "by_keyword": [dict(r) for r in by_keyword],
            "daily": [dict(r) for r in daily],
        }
    finally:
        db.close()
