#!/usr/bin/env python3
"""
LitigationSpace Legal Database Auto-Discovery Cron
Runs daily to discover, approve, scrape, and AI-verify legal documents
for all supported jurisdictions.
"""
import requests
import time
import logging
import sys
from datetime import datetime

# RAG auto-indexing — index new documents as they are discovered
def _rag_index_document(doc_id: str) -> None:
    """Index a newly verified document into the RAG vector store."""
    try:
        import sqlite3
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from app.utils.rag_engine import index_document, _ensure_embedding_column
        db_path = "/var/www/litigationspace-staging/data/app.db"
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        _ensure_embedding_column(conn)
        count = index_document(conn, doc_id)
        conn.commit()
        conn.close()
        log.info(f"[RAG] Auto-indexed {count} chunks for document {doc_id}")
    except Exception as e:
        log.warning(f"[RAG] Auto-index failed for {doc_id}: {e}")


BASE_URL = "http://127.0.0.1:8002"
JURISDICTIONS = ["US", "UK", "UG", "NG", "KE", "IN", "ZA", "GH", "CA", "AU", "HK", "IE"]
LOG_FILE = "/var/www/litigationspace/data/legal_db_cron.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger("legal_db_cron")

def discover_documents(jurisdiction_code):
    """Trigger AI auto-discover for a jurisdiction."""
    try:
        r = requests.post(
            f"{BASE_URL}/api/jurisdiction/ai-discover",
            json={"jurisdiction_code": jurisdiction_code},
            timeout=60
        )
        if r.status_code == 200:
            data = r.json()
            suggestions = data.get("suggestions", [])
            log.info(f"[{jurisdiction_code}] Discovered {len(suggestions)} suggestions")
            return suggestions
        else:
            log.warning(f"[{jurisdiction_code}] Discover failed: HTTP {r.status_code}")
            return []
    except Exception as e:
        log.error(f"[{jurisdiction_code}] Discover error: {e}")
        return []

def approve_suggestion(suggestion_id):
    """Approve and scrape a suggestion."""
    try:
        r = requests.post(
            f"{BASE_URL}/api/jurisdiction/ai-discover/{suggestion_id}/approve",
            timeout=30
        )
        if r.status_code == 200:
            data = r.json()
            status = data.get("status", "unknown")
            doc_id = data.get("document_id")
            return status, doc_id
        return "error", None
    except Exception as e:
        log.error(f"Approve error for {suggestion_id}: {e}")
        return "error", None

def ai_verify_document(doc_id):
    """Run AI verification on a document."""
    try:
        r = requests.post(
            f"{BASE_URL}/api/jurisdiction/legal-database/ai-verify/{doc_id}",
            timeout=60
        )
        if r.status_code == 200:
            data = r.json()
            return data.get("verification_status", "unknown")
        return "error"
    except Exception as e:
        log.error(f"Verify error for {doc_id}: {e}")
        return "error"

def run():
    start = datetime.utcnow()
    log.info("=" * 60)
    log.info(f"Legal Database Auto-Discovery started at {start.isoformat()}")
    log.info("=" * 60)

    total_discovered = 0
    total_scraped = 0
    total_verified = 0
    new_doc_ids = []

    # Phase 1: Discover documents for each jurisdiction
    for jcode in JURISDICTIONS:
        log.info(f"--- Discovering for {jcode} ---")
        suggestions = discover_documents(jcode)
        total_discovered += len(suggestions)
        time.sleep(2)  # Rate limit OpenAI

    # Phase 2: Approve all pending suggestions (scrape URLs)
    import subprocess
    result = subprocess.run(
        ["sqlite3", "/var/www/litigationspace/data/app.db",
         "SELECT id FROM jurisdiction_ai_suggestions WHERE status='pending';"],
        capture_output=True, text=True
    )
    pending_ids = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
    log.info(f"Found {len(pending_ids)} pending suggestions to approve")

    for sid in pending_ids:
        status, doc_id = approve_suggestion(sid)
        if status == "fetched" and doc_id:
            total_scraped += 1
            new_doc_ids.append(doc_id)
            log.info(f"  Scraped: {doc_id}")
        elif status == "approved":
            log.info(f"  Approved (no URL): {sid}")
        time.sleep(0.5)

    # Phase 3: AI-verify new documents
    log.info(f"Verifying {len(new_doc_ids)} newly scraped documents...")
    for doc_id in new_doc_ids:
        vstatus = ai_verify_document(doc_id)
        if "verified" in str(vstatus).lower() or vstatus not in ("error",):
            total_verified += 1
            # Auto-index into RAG vector store
            _rag_index_document(doc_id)
        log.info(f"  Verified {doc_id}: {vstatus}")
        time.sleep(1)  # Rate limit OpenAI

    # Summary
    elapsed = (datetime.utcnow() - start).total_seconds()
    log.info("=" * 60)
    log.info(f"SUMMARY: Discovered={total_discovered}, Scraped={total_scraped}, Verified={total_verified}")
    log.info(f"Completed in {elapsed:.1f}s")
    log.info("=" * 60)

if __name__ == "__main__":
    run()
