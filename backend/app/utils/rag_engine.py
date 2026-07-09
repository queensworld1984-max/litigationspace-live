"""
RAG Litigation Engine — LitigationSpace
Semantic vector search over jurisdiction_doc_chunks using OpenAI embeddings
and numpy cosine similarity (SQLite-native, no external vector DB needed).

Storage: embedding_json TEXT column on jurisdiction_doc_chunks (JSON float array)
Model:   text-embedding-3-small (1536 dims, ~$0.00002/1K tokens)
Search:  cosine similarity with numpy at query time (O(n), fine for <20K chunks)
Cache:   module-level dict {chunk_id -> np.ndarray} populated lazily on first search
"""

import json
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
EMBED_MODEL   = "text-embedding-3-small"
EMBED_DIMS    = 1536
MAX_CHARS     = 6000    # ~1500 tokens — safely under 8192 even for dense legal text
TOP_K_DEFAULT = 6

# ── Module-level embedding cache ──────────────────────────────────────────────
_cache: dict = {}
_cache_loaded: bool = False


# ── OpenAI client ─────────────────────────────────────────────────────────────

def _get_openai():
    from openai import OpenAI
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    return OpenAI(api_key=key)


def _embed_single(text: str) -> list:
    """Embed one text string. Truncates to MAX_CHARS."""
    client = _get_openai()
    safe = text[:MAX_CHARS] if text else " "
    resp = client.embeddings.create(model=EMBED_MODEL, input=[safe])
    return resp.data[0].embedding


def embed_query(question: str) -> list:
    """Embed a question for similarity search."""
    return _embed_single(question)


# ── Database helpers ───────────────────────────────────────────────────────────

def _ensure_embedding_column(db) -> None:
    """Add embedding_json column to jurisdiction_doc_chunks if missing."""
    cols = [r[1] for r in db.execute("PRAGMA table_info(jurisdiction_doc_chunks)").fetchall()]
    if "embedding_json" not in cols:
        db.execute("ALTER TABLE jurisdiction_doc_chunks ADD COLUMN embedding_json TEXT")
        logger.info("[RAG] Added embedding_json column to jurisdiction_doc_chunks")


# ── Cache management ──────────────────────────────────────────────────────────

def load_cache(db) -> int:
    """Load all stored embeddings into the module-level cache."""
    global _cache, _cache_loaded
    import numpy as np
    rows = db.execute(
        "SELECT id, embedding_json FROM jurisdiction_doc_chunks WHERE embedding_json IS NOT NULL AND embedding_json != ''"
    ).fetchall()
    loaded = 0
    for row in rows:
        try:
            _cache[row[0]] = np.array(json.loads(row[1]), dtype="float32")
            loaded += 1
        except Exception:
            pass
    _cache_loaded = True
    logger.info(f"[RAG] Cache loaded: {loaded} embeddings")
    return loaded


def _ensure_cache(db) -> None:
    global _cache_loaded
    if not _cache_loaded:
        load_cache(db)


def invalidate_cache() -> None:
    global _cache, _cache_loaded
    _cache = {}
    _cache_loaded = False


# ── Indexing ──────────────────────────────────────────────────────────────────

def index_chunks(db, limit: Optional[int] = None, force: bool = False) -> dict:
    """
    Embed all unembedded chunks one at a time (per-chunk for error resilience).
    Large chunks are truncated to MAX_CHARS before embedding.
    Returns {"indexed": N, "skipped": M, "errors": E}.
    """
    import numpy as np

    _ensure_embedding_column(db)

    if force:
        query = "SELECT id, content, section_title FROM jurisdiction_doc_chunks"
    else:
        query = "SELECT id, content, section_title FROM jurisdiction_doc_chunks WHERE embedding_json IS NULL OR embedding_json = ''"

    if limit:
        query += f" LIMIT {limit}"

    rows = db.execute(query).fetchall()

    if not rows:
        logger.info("[RAG] No chunks to index.")
        return {"indexed": 0, "skipped": 0, "errors": 0}

    logger.info(f"[RAG] Indexing {len(rows)} chunks (MAX_CHARS={MAX_CHARS})...")
    indexed = errors = 0

    for i, row in enumerate(rows):
        title = (row[2] or "")[:200]
        body  = (row[1] or "")[:MAX_CHARS]
        text  = (title + "\n" + body).strip() or " "

        try:
            vec = _embed_single(text)
            emb_json = json.dumps(vec)
            db.execute(
                "UPDATE jurisdiction_doc_chunks SET embedding_json=? WHERE id=?",
                (emb_json, row[0])
            )
            _cache[row[0]] = np.array(vec, dtype="float32")
            indexed += 1
            if indexed % 50 == 0:
                logger.info(f"[RAG] Progress: {indexed}/{len(rows)}")
            # Light rate limiting every 10 chunks
            if i > 0 and i % 10 == 0:
                time.sleep(0.1)
        except Exception as e:
            logger.warning(f"[RAG] Skipping chunk {str(row[0])[:8]}: {str(e)[:100]}")
            errors += 1
            time.sleep(0.3)  # back off on error

    logger.info(f"[RAG] Done. indexed={indexed} errors={errors}")
    return {"indexed": indexed, "skipped": 0, "errors": errors}


def index_document(db, document_id: str) -> int:
    """Index all chunks for a specific document."""
    import numpy as np
    _ensure_embedding_column(db)
    rows = db.execute(
        "SELECT id, content, section_title FROM jurisdiction_doc_chunks WHERE document_id=?",
        (document_id,)
    ).fetchall()
    if not rows:
        return 0
    count = 0
    for row in rows:
        title = (row[2] or "")[:200]
        body  = (row[1] or "")[:MAX_CHARS]
        text  = (title + "\n" + body).strip() or " "
        try:
            vec = _embed_single(text)
            db.execute(
                "UPDATE jurisdiction_doc_chunks SET embedding_json=? WHERE id=?",
                (json.dumps(vec), row[0])
            )
            _cache[row[0]] = np.array(vec, dtype="float32")
            count += 1
            time.sleep(0.05)
        except Exception as e:
            logger.warning(f"[RAG] Chunk {str(row[0])[:8]} failed: {e}")
    logger.info(f"[RAG] Indexed {count} chunks for document {document_id}")
    return count


# ── Search ────────────────────────────────────────────────────────────────────

def search(db, question: str, top_k: int = TOP_K_DEFAULT,
           jurisdiction: Optional[str] = None) -> list:
    """Semantic search. Falls back to keyword search if no embeddings exist."""
    import numpy as np
    _ensure_cache(db)

    if not _cache:
        logger.warning("[RAG] Cache empty — falling back to keyword search")
        return _keyword_fallback(db, question, top_k, jurisdiction)

    try:
        q_vec = np.array(embed_query(question), dtype="float32")
    except Exception as e:
        logger.error(f"[RAG] Query embed failed: {e}")
        return _keyword_fallback(db, question, top_k, jurisdiction)

    ids    = list(_cache.keys())
    matrix = np.stack([_cache[i] for i in ids])
    q_norm = q_vec / (np.linalg.norm(q_vec) + 1e-8)
    norms  = np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-8
    scores = matrix.dot(q_norm) / norms.squeeze()

    top_idx    = scores.argsort()[::-1][:top_k * 3]
    top_ids    = [ids[i] for i in top_idx]
    top_scores = [float(scores[i]) for i in top_idx]

    placeholders = ",".join("?" * len(top_ids))
    rows = db.execute(
        f"""SELECT c.id, c.content, c.section_title,
               d.title, d.jurisdiction_code, d.document_type, d.source_url, d.is_verified
            FROM jurisdiction_doc_chunks c
            JOIN jurisdiction_documents d ON c.document_id = d.id
            WHERE c.id IN ({placeholders})""",
        top_ids
    ).fetchall()

    id_to_row = {dict(r)["id"]: dict(r) for r in rows}
    results = []
    for cid, score in zip(top_ids, top_scores):
        if cid not in id_to_row:
            continue
        row = id_to_row[cid]
        if jurisdiction and row["jurisdiction_code"] != jurisdiction:
            continue
        results.append({
            "score":          round(score, 4),
            "chunk_id":       cid,
            "title":          row["title"],
            "jurisdiction":   row["jurisdiction_code"],
            "document_type":  row["document_type"],
            "section_title":  row.get("section_title", ""),
            "content":        row["content"][:1200],
            "source_url":     row.get("source_url", ""),
            "is_verified":    bool(row.get("is_verified", 0)),
        })
        if len(results) >= top_k:
            break

    return results


def _keyword_fallback(db, question: str, top_k: int, jurisdiction: Optional[str]) -> list:
    keywords = [w.lower() for w in question.split() if len(w) > 3][:5]
    if not keywords:
        return []
    where = " OR ".join(["c.content LIKE ?"] * len(keywords))
    params = [f"%{kw}%" for kw in keywords]
    if jurisdiction:
        where += " AND d.jurisdiction_code = ?"
        params.append(jurisdiction)
    rows = db.execute(
        f"""SELECT c.id, c.content, c.section_title,
               d.title, d.jurisdiction_code, d.document_type, d.source_url, d.is_verified
            FROM jurisdiction_doc_chunks c
            JOIN jurisdiction_documents d ON c.document_id = d.id
            WHERE d.status='active' AND ({where})
            ORDER BY d.usage_count DESC LIMIT {top_k}""",
        params
    ).fetchall()
    return [
        {
            "score":         0.0,
            "chunk_id":      dict(r)["id"],
            "title":         dict(r)["title"],
            "jurisdiction":  dict(r)["jurisdiction_code"],
            "document_type": dict(r)["document_type"],
            "section_title": dict(r).get("section_title", ""),
            "content":       dict(r)["content"][:1200],
            "source_url":    dict(r).get("source_url", ""),
            "is_verified":   bool(dict(r).get("is_verified", 0)),
        }
        for r in rows
    ]


# ── Context builder for Legal Brain ───────────────────────────────────────────

def build_rag_context(db, question: str, jurisdiction: Optional[str] = None) -> tuple:
    """
    Search for relevant chunks and format as context for OpenAI.
    Returns (context_string, citations_list).
    """
    results = search(db, question, top_k=TOP_K_DEFAULT, jurisdiction=jurisdiction)
    if not results:
        return "", []

    parts     = []
    citations = []

    for i, r in enumerate(results, 1):
        jur   = r["jurisdiction"]
        dtype = r["document_type"].replace("_", " ").title()
        title = r["title"]
        sec   = r["section_title"]
        body  = r["content"]
        url   = r["source_url"]
        score = r["score"]

        parts.append(
            f"[Source {i}: {jur} | {dtype} | {title}]"
            + (f" — {sec}" if sec else "")
            + f"\n{body}"
        )
        citations.append({
            "index":         i,
            "title":         title,
            "jurisdiction":  jur,
            "document_type": dtype,
            "section":       sec,
            "source_url":    url,
            "relevance":     score,
            "verified":      r["is_verified"],
        })

    context = (
        "=== VERIFIED LEGAL SOURCES (RAG) ===\n\n"
        + "\n\n---\n\n".join(parts)
        + "\n\n=== END OF SOURCES ==="
    )
    return context, citations


# ── Index status ───────────────────────────────────────────────────────────────

def get_index_status(db) -> dict:
    _ensure_embedding_column(db)
    total   = db.execute("SELECT COUNT(*) FROM jurisdiction_doc_chunks").fetchone()[0]
    indexed = db.execute(
        "SELECT COUNT(*) FROM jurisdiction_doc_chunks WHERE embedding_json IS NOT NULL AND embedding_json != ''"
    ).fetchone()[0]
    return {
        "total_chunks":   total,
        "indexed_chunks": indexed,
        "coverage_pct":   round(indexed / total * 100, 1) if total else 0,
        "cache_size":     len(_cache),
        "embed_model":    EMBED_MODEL,
        "max_chars_per_chunk": MAX_CHARS,
    }
