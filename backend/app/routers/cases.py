"""Cases router - CRUD operations with multi-tenant isolation."""
import asyncio
import json
import io
import logging
import os
import re
import secrets
import shutil
import hashlib
import traceback
from concurrent.futures import ProcessPoolExecutor
from difflib import SequenceMatcher
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.database import get_db
from app.models.schemas import CaseCreate, CaseUpdate, TaskCreate, TaskUpdate, DocumentCreate
from app.utils.auth import get_current_user, generate_id, decode_token, create_access_token, hash_password

_bearer = HTTPBearer(auto_error=False)

def get_download_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    token: Optional[str] = Query(None),
) -> dict:
    """Auth for download endpoints: accepts Authorization header OR ?token= query param."""
    if credentials:
        return decode_token(credentials.credentials)
    if token:
        return decode_token(token)
    raise HTTPException(status_code=401, detail="Not authenticated")
from app.utils.model_router import get_model_for_task
from app.utils.credits import credit_gate, deduct_credits
from app.utils.case_auth import resolve_case_access
from app.utils.email import send_case_invitation_email

logger = logging.getLogger(__name__)

# File upload configuration
UPLOAD_BASE_DIR = os.environ.get("UPLOAD_DIR", "/var/www/litigationspace/data/uploads")
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".xlsx", ".csv", ".xls", ".pptx", ".ppt", ".tiff", ".tif", ".bmp", ".svg", ".heic", ".heif", ".msg", ".eml", ".pages", ".numbers", ".key"}

# Large PDF merges hold PyMuPDF's C-level lock for long stretches, which starves
# this process's asyncio event loop (and uvicorn's own worker health-check ping)
# if run inline. Running them in a separate OS process means a slow merge can
# never get this worker killed as "unresponsive", no matter how long it takes.
_PDF_MERGE_POOL: "ProcessPoolExecutor | None" = None


def _get_pdf_merge_pool() -> "ProcessPoolExecutor":
    global _PDF_MERGE_POOL
    if _PDF_MERGE_POOL is None:
        _PDF_MERGE_POOL = ProcessPoolExecutor(max_workers=2)
    return _PDF_MERGE_POOL


def _filter_reuploaded_merge_duplicates(db, case_id: str, tenant_id: str, docs: List[dict]) -> List[dict]:
    """Best-effort guard against a previously-merged/derived output being manually
    re-uploaded as an ordinary file — is_merged=1 filtering alone can't catch that,
    since a plain upload never sets is_merged. Same case + identical byte size as
    an existing is_merged=1 document is a strong signal it's that same file."""
    merged_sizes = {
        r["file_size"] for r in db.execute(
            "SELECT DISTINCT file_size FROM documents "
            "WHERE case_id = ? AND tenant_id = ? AND is_merged = 1 AND file_size IS NOT NULL",
            (case_id, tenant_id),
        ).fetchall()
        if r["file_size"]
    }
    if not merged_sizes:
        return docs
    return [d for d in docs if d.get("file_size") not in merged_sizes]


def _merge_file_list_to_pdf_bytes(
    file_items: List[tuple],
    bates_prefix: str = "",
    bates_start: int = 1,
    bates_position: str = "center",
) -> Optional[bytes]:
    """Build a merged PDF from (absolute_path, label) pairs and return its bytes.
    Runs inside _PDF_MERGE_POOL — must stay picklable (module-level, plain args)."""
    import fitz
    merged_pdf = fitz.open()
    for file_path, label in file_items:
        fp = Path(file_path)
        if not fp.exists():
            continue
        _add_file_to_pdf(merged_pdf, fp, label)
    if merged_pdf.page_count == 0:
        merged_pdf.close()
        return None
    if bates_prefix:
        _apply_bates_numbering(merged_pdf, bates_prefix, bates_start, position=bates_position)
    data = _pdf_tobytes(merged_pdf)
    merged_pdf.close()
    return data

# Heavy text fields — omit from list/reorder payloads so multi-doc UIs stay fast.
_DOC_LIST_OMIT = frozenset({"content_text", "content_html"})


def _doc_list_item(row) -> dict:
    """Serialize a document row for list/UI responses without huge text bodies."""
    d = dict(row)
    for k in _DOC_LIST_OMIT:
        d.pop(k, None)
    # Convenience flag for the client
    d["has_file"] = bool(d.get("file_path"))
    return d


def _convert_to_pdf_via_libreoffice(fp: Path) -> Optional[Path]:
    """Convert a document to PDF using LibreOffice. Returns path to converted PDF or None.
    Preserves colors, headings, images, and layout far better than text extraction."""
    import subprocess
    import tempfile
    import shutil as _shutil
    bin_candidates = ["libreoffice", "soffice", "/usr/bin/libreoffice", "/usr/bin/soffice"]
    lo_bin = next((b for b in bin_candidates if _shutil.which(b) or Path(b).exists()), None)
    if not lo_bin:
        logger.warning("LibreOffice not found — cannot preserve DOCX/RTF formatting during merge")
        return None
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Copy file to temp dir to avoid permission issues
            safe_name = fp.name if fp.suffix else (fp.name + ".bin")
            tmp_input = Path(tmpdir) / safe_name
            _shutil.copy2(str(fp), str(tmp_input))
            result = subprocess.run(
                [lo_bin, "--headless", "--norestore", "--nofirststartwizard",
                 "--convert-to", "pdf:writer_pdf_Export",
                 "--outdir", tmpdir, str(tmp_input)],
                capture_output=True, text=True, timeout=180,
                env={**os.environ, "HOME": tmpdir},
            )
            if result.returncode != 0:
                logger.warning(f"LibreOffice conversion failed ({lo_bin}): {result.stderr or result.stdout}")
                return None
            # Find the output PDF (LibreOffice uses input stem)
            pdf_name = tmp_input.stem + ".pdf"
            pdf_path = Path(tmpdir) / pdf_name
            if not pdf_path.exists():
                # Some LO versions put output with slightly different casing
                found = list(Path(tmpdir).glob("*.pdf"))
                pdf_path = found[0] if found else None
            if pdf_path and pdf_path.exists():
                stable_tmp = Path(tempfile.mktemp(suffix=".pdf"))
                _shutil.copy2(str(pdf_path), str(stable_tmp))
                return stable_tmp
            return None
    except Exception as e:
        logger.warning(f"LibreOffice conversion error for {fp}: {e}")
        return None


def _pdf_tobytes(doc) -> bytes:
    """Serialize a PyMuPDF document with settings that preserve color/fonts better."""
    try:
        return doc.tobytes(garbage=3, deflate=True, use_objstms=1)
    except TypeError:
        # Older PyMuPDF
        return doc.tobytes(garbage=3, deflate=True)
    except Exception:
        return doc.tobytes()


def _pdf_tobytes_fast(doc) -> bytes:
    """Faster serialize for interactive insert (large packets). Slightly larger files OK."""
    try:
        return doc.tobytes(garbage=1, deflate=True)
    except TypeError:
        try:
            return doc.tobytes(garbage=1, deflate=True)
        except Exception:
            return doc.tobytes()
    except Exception:
        return doc.tobytes()


def _append_pages_by_order(dest, src, order: List[int]) -> int:
    """Append pages from src into dest following *order*, using contiguous runs.

    Much faster than one insert_pdf per page when order is identity or mostly
    sequential (typical during insert-heavy organize sessions).
    Returns number of pages added.
    """
    if not order:
        return 0
    start_count = dest.page_count
    run_start = int(order[0])
    prev = run_start
    for raw in order[1:]:
        i = int(raw)
        if i == prev + 1:
            prev = i
            continue
        # flush contiguous run [run_start, prev]
        dest.insert_pdf(src, from_page=run_start, to_page=prev)
        run_start = prev = i
    dest.insert_pdf(src, from_page=run_start, to_page=prev)
    return dest.page_count - start_count


def _rasterize_pdf_pages_into(dest, src, dpi: int = 150):
    """Copy PDF pages as full-color RGB images — last-resort fidelity for bad PDFs.
    Preserves visual appearance (color, headings, layout) when vector insert fails."""
    import fitz
    zoom = max(1.0, dpi / 72.0)
    mat = fitz.Matrix(zoom, zoom)
    for i in range(src.page_count):
        page = src[i]
        # Always RGB — never DeviceGray — so color docs stay color
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        w, h = page.rect.width, page.rect.height
        # Keep original page size (including landscape)
        if w <= 0 or h <= 0:
            w, h = 612, 792
        new_page = dest.new_page(width=w, height=h)
        # PNG for fidelity (no JPEG gray-subsample artifacts on text)
        new_page.insert_image(new_page.rect, stream=pix.tobytes("png"))


def _append_pdf_preserving_appearance(dest, fp: Path) -> int:
    """Append a PDF into dest, preserving color, headings, images, and page size.
    Returns number of pages added."""
    import fitz
    data = Path(fp).read_bytes()
    if not data:
        return 0
    # Detect PDF magic even if extension is wrong
    if not data[:5].startswith(b"%PDF"):
        # Not a real PDF — let caller handle other formats
        raise ValueError(f"Not a PDF: {fp}")
    src = fitz.open(stream=data, filetype="pdf")
    start = dest.page_count
    try:
        if src.page_count == 0:
            return 0
        # Prefer native vector insert (keeps selectable text + color)
        try:
            dest.insert_pdf(src, links=True, annots=True)
        except TypeError:
            dest.insert_pdf(src)
        added = dest.page_count - start
        if added <= 0:
            raise RuntimeError("insert_pdf added 0 pages")
        return added
    except Exception as e:
        logger.warning(f"insert_pdf failed for {fp} ({e}); rasterizing pages in full color")
        # Roll back any partial pages from failed insert
        while dest.page_count > start:
            try:
                dest.delete_page(dest.page_count - 1)
            except Exception:
                break
        _rasterize_pdf_pages_into(dest, src, dpi=150)
        return dest.page_count - start
    finally:
        src.close()


def _add_file_to_pdf(merged_pdf, fp: Path, doc_label: str = ""):
    """Append any supported file to merged_pdf while preserving visual fidelity.
    PDFs/images keep color & layout. Office docs go through LibreOffice (not plain text)."""
    import fitz
    ext = fp.suffix.lower()
    try:
        # Sniff PDF by magic bytes (handles wrong extensions)
        try:
            head = Path(fp).read_bytes()[:8]
        except Exception:
            head = b""
        is_pdf_bytes = head.startswith(b"%PDF")

        if ext == ".pdf" or is_pdf_bytes:
            _append_pdf_preserving_appearance(merged_pdf, fp)
        elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"):
            # Full-color image on a page sized to the image aspect (letter max)
            img_doc = fitz.open()
            # Use insert_image via temporary pixmap to keep RGB
            try:
                img = fitz.open(str(fp))
                # fitz can open images as single-page docs
                if img.page_count >= 1 and img[0].get_pixmap:
                    pix = img[0].get_pixmap(alpha=False, colorspace=fitz.csRGB)
                    # Fit to letter, keep aspect
                    max_w, max_h = 612 - 72, 792 - 72
                    iw, ih = pix.width, pix.height
                    scale = min(max_w / max(iw, 1), max_h / max(ih, 1), 1.0)
                    dw, dh = iw * scale, ih * scale
                    page = img_doc.new_page(width=612, height=792)
                    x0 = (612 - dw) / 2
                    y0 = (792 - dh) / 2
                    page.insert_image(fitz.Rect(x0, y0, x0 + dw, y0 + dh), stream=pix.tobytes("png"))
                else:
                    page = img_doc.new_page(width=612, height=792)
                    page.insert_image(fitz.Rect(36, 36, 576, 756), filename=str(fp))
                img.close()
            except Exception:
                page = img_doc.new_page(width=612, height=792)
                page.insert_image(fitz.Rect(36, 36, 576, 756), filename=str(fp))
            merged_pdf.insert_pdf(img_doc)
            img_doc.close()
        elif ext in (".docx", ".doc", ".rtf", ".odt", ".pptx", ".ppt", ".xlsx", ".xls"):
            # LibreOffice keeps headings, colors, tables, images
            converted_pdf_path = _convert_to_pdf_via_libreoffice(fp)
            if converted_pdf_path and converted_pdf_path.exists():
                try:
                    _append_pdf_preserving_appearance(merged_pdf, converted_pdf_path)
                finally:
                    try:
                        converted_pdf_path.unlink()
                    except Exception:
                        pass
            else:
                # Last resort only — plain text (will look B&W / unstyled)
                logger.warning(f"Merge falling back to plain text for {fp.name} (LibreOffice convert failed)")
                if ext in (".docx", ".doc"):
                    text = _extract_text_from_docx(fp.read_bytes())
                else:
                    try:
                        text = fp.read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        text = fp.read_bytes().decode("utf-8", errors="replace")
                if text and text.strip():
                    _add_text_pages(merged_pdf, text.strip(), doc_label or fp.name)
        elif ext == ".txt" or ext == ".csv":
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except Exception:
                text = fp.read_bytes().decode("utf-8", errors="replace")
            if text.strip():
                _add_text_pages(merged_pdf, text.strip(), doc_label or fp.name)
        else:
            # Try treating as PDF; else placeholder
            try:
                _append_pdf_preserving_appearance(merged_pdf, fp)
            except Exception:
                _add_text_pages(
                    merged_pdf,
                    f"[File: {fp.name} — format not directly convertible. Re-upload as PDF for best quality.]",
                    doc_label or fp.name,
                )
    except Exception as e:
        logger.warning(f"_add_file_to_pdf failed for {fp}: {e}\n{traceback.format_exc()}")
        try:
            _add_text_pages(
                merged_pdf,
                f"[Could not merge file: {fp.name}. Error: {e}]",
                doc_label or fp.name,
            )
        except Exception:
            pass


def _add_text_pages(merged_pdf, text: str, title: str = ""):
    """Last-resort plain-text pages when a real PDF conversion is unavailable.
    Prefer LibreOffice / insert_pdf so headings and color are preserved."""
    import fitz
    max_chars_per_page = 2800
    chunks = []
    while text:
        chunks.append(text[:max_chars_per_page])
        text = text[max_chars_per_page:]
    if not chunks:
        chunks = [""]
    for i, chunk in enumerate(chunks):
        page = merged_pdf.new_page(width=612, height=792)
        y0 = 50
        if title and i == 0:
            # Bold title (Helvetica-Bold = "hebo" in PyMuPDF Base-14)
            title_rect = fitz.Rect(54, 40, 558, 70)
            page.insert_textbox(
                title_rect, title,
                fontsize=13, fontname="hebo", color=(0.1, 0.1, 0.35),
                align=fitz.TEXT_ALIGN_LEFT,
            )
            y0 = 78
            # Divider line under heading
            page.draw_line(fitz.Point(54, 74), fitz.Point(558, 74), color=(0.2, 0.2, 0.45), width=1)
        text_rect = fitz.Rect(54, y0, 558, 750)
        page.insert_textbox(
            text_rect, chunk,
            fontsize=10, fontname="helv", color=(0, 0, 0),
            align=fitz.TEXT_ALIGN_LEFT,
        )


def _apply_bates_numbering(
    merged_pdf,
    prefix: str,
    start_num: int = 1,
    pad: int = 2,
    position: str = "center",
):
    """Stamp Bates numbers on every page of a merged PDF.

    position: "left" | "center" | "right" (bottom of page). Default center.
    Format: PREFIX-01, PREFIX-02 … through final page (pad default 2 digits).
    Stamp is large, bold, and dark for court readability.
    """
    import fitz
    prefix = (prefix or "").strip()
    if not prefix:
        return
    try:
        start = int(start_num)
    except (TypeError, ValueError):
        start = 1
    # At least 2 digits (01, 02…) — grow pad if page count needs more (e.g. 100+)
    total_pages = max(1, int(getattr(merged_pdf, "page_count", 1) or 1))
    last_num = start + total_pages - 1
    auto_pad = max(2, len(str(last_num)))
    pad = max(2, min(int(pad or auto_pad), 8), auto_pad)
    pos = (position or "center").strip().lower()
    if pos not in ("left", "center", "right"):
        pos = "center"

    # Bold Helvetica; larger stamp box for bigger type
    fontsize = 14
    box_w, box_h = 160, 28
    margin = 14

    for page_idx in range(merged_pdf.page_count):
        page = merged_pdf[page_idx]
        bates_num = start + page_idx
        bates_text = f"{prefix}-{bates_num:0{pad}d}"
        r = page.rect  # handles landscape / custom sizes
        y1 = r.y1 - margin - box_h
        y2 = r.y1 - margin
        if pos == "left":
            x1 = r.x0 + margin
            x2 = r.x0 + margin + box_w
            align = 0  # left
        elif pos == "center":
            mid = (r.x0 + r.x1) / 2
            x1 = mid - box_w / 2
            x2 = mid + box_w / 2
            align = 1  # center
        else:  # right
            x1 = r.x1 - margin - box_w
            x2 = r.x1 - margin
            align = 2  # right
        stamp = fitz.Rect(x1, y1, x2, y2)
        try:
            # Light white plate so stamp stays readable on dark or busy pages
            page.draw_rect(stamp, color=(0.35, 0.35, 0.35), fill=(1, 1, 1), width=0.6)
            page.insert_textbox(
                fitz.Rect(x1 + 3, y1 + 2, x2 - 3, y2 - 2),
                bates_text,
                fontsize=fontsize,
                fontname="hebo",  # Helvetica-Bold
                color=(0, 0, 0),
                align=align,
            )
        except Exception as e:
            # Fallback if bold font name fails on some PyMuPDF builds
            try:
                page.insert_textbox(
                    fitz.Rect(x1 + 3, y1 + 2, x2 - 3, y2 - 2),
                    bates_text,
                    fontsize=fontsize,
                    fontname="helv",
                    color=(0, 0, 0),
                    align=align,
                )
            except Exception as e2:
                logger.warning(f"Bates stamp failed on page {page_idx + 1}: {e}; fallback {e2}")


def _clear_bottom_bates_band(page, band_height: float = 40.0):
    """Paint a white band across the bottom of the page to erase prior Bates stamps."""
    import fitz
    r = page.rect
    band = fitz.Rect(r.x0, max(r.y0, r.y1 - band_height), r.x1, r.y1)
    try:
        page.draw_rect(band, color=(1, 1, 1), fill=(1, 1, 1), width=0)
    except Exception as e:
        logger.warning(f"Clear Bates band failed: {e}")


def _analyze_pdf_page(page, mode: str = "fast") -> dict:
    """Analyze one page for blank / near-blank and content fingerprint.

    mode="fast" (default): text + image-xref only — no pixmap render.
      Suitable for 100–500 page organizer open (orders of magnitude faster).
    mode="full": also renders a tiny grayscale pixmap for visual blank/dup detection.
    """
    import fitz
    import hashlib

    mode = (mode or "fast").strip().lower()
    if mode not in ("fast", "full"):
        mode = "fast"

    # Prefer plain text extract (faster than "dict"/"rawdict")
    try:
        text = (page.get_text("text") or "").strip()
    except Exception:
        text = (page.get_text() or "").strip()
    text_len = len(text)
    text_norm = " ".join(text.split())

    # Cheap image presence (scanned pages often have images + little text)
    try:
        images = page.get_images(full=False) or []
        n_images = len(images)
    except Exception:
        images = []
        n_images = 0

    r = page.rect
    w = round(r.width, 1)
    h = round(r.height, 1)

    blank = False
    nearly_blank = False
    white_ratio = 0.0
    black_ratio = 0.0

    # Fast blank heuristics (no raster)
    if text_len < 5 and n_images == 0:
        blank = True
    elif text_len < 8 and n_images == 0:
        nearly_blank = True
    elif text_len < 20 and n_images == 0:
        nearly_blank = True

    # Content fingerprint
    hsh = hashlib.sha256()
    hsh.update(text_norm.encode("utf-8", errors="replace"))
    hsh.update(f"|{w}x{h}|img={n_images}".encode())
    # Include image xrefs so two different scans don't collide as "empty"
    if images:
        try:
            for im in images[:12]:
                # (xref, smask, width, height, bpc, colorspace, alt, name, filter)
                hsh.update(str(im[0]).encode())
                if len(im) > 3:
                    hsh.update(f"{im[2]}x{im[3]}".encode())
        except Exception:
            pass
    # Cheap stream fingerprint for image-only pages (still no pixmap)
    if text_len < 40:
        try:
            contents = page.get_contents()
            if contents:
                # contents may be list of xrefs
                if isinstance(contents, (list, tuple)):
                    for xref in contents[:6]:
                        try:
                            raw = page.parent.xref_stream(xref) or b""
                            hsh.update(raw[:2048])
                        except Exception:
                            hsh.update(str(xref).encode())
                elif isinstance(contents, (bytes, bytearray)):
                    hsh.update(contents[:2048])
        except Exception:
            pass

    if mode == "full":
        try:
            mat = fitz.Matrix(0.12, 0.12)  # smaller than before (was 0.15)
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY, alpha=False)
            samples = pix.samples or b""
            n = len(samples)
            if samples:
                step = 8 if n > 10000 else 4
                sampled = samples[::step]
                hsh.update(sampled[:8000])
                hsh.update(f"{pix.width}x{pix.height}".encode())
                sn = len(sampled) or 1
                white = sum(1 for b in sampled if b >= 248)
                black = sum(1 for b in sampled if b <= 12)
                white_ratio = white / sn
                black_ratio = black / sn
                blank = (
                    white_ratio >= 0.985
                    or black_ratio >= 0.985
                    or (text_len < 8 and white_ratio >= 0.93)
                    or (text_len < 8 and black_ratio >= 0.93)
                )
                nearly_blank = (
                    not blank
                    and (
                        white_ratio >= 0.94
                        or (text_len < 25 and white_ratio >= 0.88)
                        or (text_len < 25 and black_ratio >= 0.88)
                    )
                )
        except Exception as e:
            logger.warning(f"Page full analysis failed: {e}")

    content_hash = hsh.hexdigest()[:24]
    if blank and text_len < 5 and n_images == 0:
        content_hash = hashlib.sha256(b"empty-blank").hexdigest()[:24]

    return {
        "blank": blank,
        "nearly_blank": nearly_blank,
        "text_len": text_len,
        "white_ratio": round(white_ratio, 3),
        "black_ratio": round(black_ratio, 3),
        "width": w,
        "height": h,
        "content_hash": content_hash,
        "n_images": n_images,
        "analyze_mode": mode,
    }


# Disk cache for organizer thumbnails (huge win on 200+ page packets)
_THUMB_CACHE_DIR = Path(
    os.environ.get(
        "PDF_THUMB_CACHE_DIR",
        "/var/www/litigationspace-staging/data/thumb_cache",
    )
)


def _render_pdf_page_image(path: Path, page_index: int, scale: float = 1.2) -> tuple:
    """Render one PDF page to JPEG/PNG bytes. Returns (bytes, media_type).

    Uses a simple disk cache keyed by path+mtime+page+scale so reopening the
    organizer does not re-render every page.
    """
    import fitz
    import hashlib

    # scale 0.4–0.6 ≈ strip thumb; 1.5–2.0 ≈ main preview
    scale = max(0.35, min(float(scale or 1.2), 3.0))
    # Prefer JPEG for strip thumbs (much smaller/faster than PNG)
    use_jpeg = scale < 1.25

    try:
        mtime_ns = path.stat().st_mtime_ns
    except Exception:
        mtime_ns = 0
    cache_key = hashlib.sha1(
        f"{path}|{mtime_ns}|{page_index}|{scale:.3f}|{'j' if use_jpeg else 'p'}".encode()
    ).hexdigest()
    cache_path = _THUMB_CACHE_DIR / cache_key[:2] / f"{cache_key}.{'jpg' if use_jpeg else 'png'}"

    if cache_path.exists() and cache_path.stat().st_size > 32:
        try:
            data = cache_path.read_bytes()
            return data, ("image/jpeg" if use_jpeg else "image/png")
        except Exception:
            pass

    pdf = fitz.open(str(path))
    try:
        if page_index < 0 or page_index >= pdf.page_count:
            raise HTTPException(status_code=404, detail="Page not found")
        page = pdf[page_index]
        mat = fitz.Matrix(scale, scale)
        # RGB for quality on main preview; still fine for strip
        pix = page.get_pixmap(matrix=mat, alpha=False)
        if use_jpeg:
            try:
                img_bytes = pix.tobytes("jpeg", jpg_quality=62)
                media = "image/jpeg"
            except TypeError:
                img_bytes = pix.tobytes("jpeg")
                media = "image/jpeg"
            except Exception:
                img_bytes = pix.tobytes("png")
                media = "image/png"
        else:
            try:
                img_bytes = pix.tobytes("png")
                media = "image/png"
            except Exception:
                img_bytes = pix.tobytes("jpeg")
                media = "image/jpeg"
    finally:
        pdf.close()

    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(img_bytes)
    except Exception as e:
        logger.debug(f"thumb cache write skipped: {e}")

    return img_bytes, media


def _resolve_doc_pdf_path(doc: dict) -> Path:
    """Resolve on-disk path for a document; raise 404 if missing.

    Tries configured UPLOAD_BASE_DIR first, then known staging/live upload roots
    (handles servers where files live under /uploads vs /data/uploads).
    """
    file_path_str = doc.get("file_path") or ""
    if not file_path_str:
        raise HTTPException(status_code=404, detail="Document has no file on disk")

    candidates = []
    if file_path_str.startswith("/"):
        candidates.append(Path(file_path_str))
    candidates.append(Path(UPLOAD_BASE_DIR) / file_path_str)
    for root in (
        "/var/www/litigationspace-staging/uploads",
        "/var/www/litigationspace-staging/data/uploads",
        "/var/www/litigationspace/uploads",
        "/var/www/litigationspace/data/uploads",
    ):
        candidates.append(Path(root) / file_path_str)

    seen = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.exists():
            return path
    raise HTTPException(status_code=404, detail="File not found on server")


# --------------- Exhibit helpers ---------------

def _exhibit_letter(n: int) -> str:
    """Convert 0-based index to exhibit letter: 0->A, 25->Z, 26->AA, 27->AB, etc."""
    if n < 26:
        return chr(65 + n)
    result = ""
    while n >= 0:
        result = chr(65 + (n % 26)) + result
        n = n // 26 - 1
    return result


def _int_to_roman(n: int) -> str:
    """Convert 1-based integer to Roman numeral string."""
    vals = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
            (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
            (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    result = ""
    for value, numeral in vals:
        while n >= value:
            result += numeral
            n -= value
    return result


# All supported exhibit numbering schemes (15 formats)
EXHIBIT_SCHEMES = {
    "letters", "numbers", "claimant_numbers", "respondent_numbers",
    "annexture_numbers", "annexture_letters", "plaintiff_numbers",
    "defendant_numbers", "joint_numbers", "government_numbers",
    "roman_numerals", "bates_numbered", "tab_numbers",
    "schedule_letters", "appendix_letters",
}


def _make_exhibit_label(count: int, numbering: str) -> str:
    """Return the exhibit label string for count (0-based) and numbering scheme."""
    n = count + 1  # 1-based for display
    if numbering == "numbers":
        return str(n)
    elif numbering == "claimant_numbers":
        return f"C-{n}"
    elif numbering == "respondent_numbers":
        return f"R-{n}"
    elif numbering == "annexture_numbers":
        return f"Annexture {n}"
    elif numbering == "annexture_letters":
        return f"Annexture {_exhibit_letter(count)}"
    elif numbering == "plaintiff_numbers":
        return f"P-{n}"
    elif numbering == "defendant_numbers":
        return f"D-{n}"
    elif numbering == "joint_numbers":
        return f"J-{n}"
    elif numbering == "government_numbers":
        return f"GX-{n}"
    elif numbering == "roman_numerals":
        return _int_to_roman(n)
    elif numbering == "bates_numbered":
        return f"{n:03d}"
    elif numbering == "tab_numbers":
        return f"Tab {n}"
    elif numbering == "schedule_letters":
        return f"Schedule {_exhibit_letter(count)}"
    elif numbering == "appendix_letters":
        return f"Appendix {_exhibit_letter(count)}"
    else:  # "letters" default
        return _exhibit_letter(count)


def _exhibit_filename(exhibit_label: str, exhibit_name: str, ext: str, numbering: str = "letters") -> str:
    """Return the renamed filename for an exhibit — always prefixed with 'Exhibit'."""
    return f"Exhibit {exhibit_label} \u2014 {exhibit_name}{ext}"


def _next_exhibit_label(db, case_id: str, numbering: str = "letters") -> tuple:
    """Return (next_label, next_order) for a case's documents.
    Supports all 15 exhibit numbering formats."""
    row = db.execute(
        "SELECT COUNT(*) as cnt FROM documents WHERE case_id = ? AND exhibit_label IS NOT NULL",
        (case_id,)
    ).fetchone()
    count = row["cnt"] if row else 0
    return _make_exhibit_label(count, numbering), count


def _extract_text_from_pdf(file_bytes: bytes, max_chars: int = 500_000, ocr_fallback: bool = False) -> str:
    """Extract text from PDF bytes using PyMuPDF; optional OCR for image-only/scanned pages."""
    text = ""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = []
        for page in doc:
            page_text = page.get_text().strip()
            if page_text:
                pages.append(page_text)
        page_count = len(doc)
        doc.close()
        text = "\n\n".join(pages)
        # Thin text relative to page count → likely scanned; OCR
        if ocr_fallback and (
            len(text.strip()) < 80
            or (page_count > 0 and len(text.strip()) < page_count * 40)
        ):
            ocr_text = _ocr_pdf_pages(file_bytes, max_pages=25)
            if ocr_text and len(ocr_text.strip()) > len(text.strip()):
                text = ocr_text
        return text[:max_chars]
    except Exception as e:
        logger.warning(f"PDF text extraction failed: {e}")
        if ocr_fallback:
            try:
                return _ocr_pdf_pages(file_bytes, max_pages=25)[:max_chars]
            except Exception as e2:
                logger.warning(f"PDF OCR fallback failed: {e2}")
        return text[:max_chars] if text else ""


def _ocr_image_full_text(
    image_bytes: bytes,
    filename: str = "image.png",
    mime_type: str = "image/png",
) -> str:
    """Full OCR of an image via OpenAI Vision — extract every visible word for duplicate matching."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Local tesseract fallback
        try:
            from PIL import Image
            import pytesseract
            img = Image.open(io.BytesIO(image_bytes))
            t = pytesseract.image_to_string(img)
            return (t or "").strip()
        except Exception:
            return ""

    ext = Path(filename).suffix.lower()
    mime_map = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
        ".tiff": "image/tiff", ".tif": "image/tiff", ".heic": "image/heic",
        ".heif": "image/heif",
    }
    img_mime = mime_map.get(ext, mime_type or "image/png")
    # Cap very large images (~12MB base64 payload safety)
    if len(image_bytes) > 12 * 1024 * 1024:
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(image_bytes))
            img.thumbnail((2500, 2500))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            image_bytes = buf.getvalue()
            img_mime = "image/jpeg"
            filename = Path(filename).stem + ".jpg"
        except Exception as e:
            logger.warning(f"Image downscale for OCR failed: {e}")

    try:
        import base64
        from openai import OpenAI
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=get_model_for_task("image_description"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise legal-document OCR system. "
                        "Extract ALL visible text from the image exactly as it appears. "
                        "Preserve paragraphs, names, dates, case captions, stamps, "
                        "handwriting (best effort), and numbers. "
                        "Output ONLY the extracted text — no commentary."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Extract all text from this document image ({filename}):"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{img_mime};base64,{b64}",
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
            max_completion_tokens=8000,
            temperature=0.1,
        )
        text = (response.choices[0].message.content or "").strip()
        # Reject empty / failure placeholders
        if text.startswith("[") and ("OCR" in text or "failed" in text.lower()):
            return ""
        return text
    except Exception as e:
        logger.warning(f"AI image OCR failed for {filename}: {e}")
        try:
            from PIL import Image
            import pytesseract
            img = Image.open(io.BytesIO(image_bytes))
            return (pytesseract.image_to_string(img) or "").strip()
        except Exception:
            return ""


def _ocr_pdf_pages(file_bytes: bytes, max_pages: int = 25) -> str:
    """Render PDF pages to images and OCR each with OpenAI Vision (scanned PDFs)."""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        logger.warning(f"PyMuPDF open for OCR failed: {e}")
        return ""

    parts = []
    try:
        n = len(doc)
        for page_num, page in enumerate(doc):
            if page_num >= max_pages:
                parts.append(f"[… {n - max_pages} additional pages not OCR'd for performance]")
                break
            # Prefer embedded images if single large image; else render page
            try:
                pix = page.get_pixmap(dpi=180)
                img_bytes = pix.tobytes("png")
            except Exception as e:
                logger.warning(f"PDF page render failed p{page_num + 1}: {e}")
                continue
            page_text = _ocr_image_full_text(img_bytes, f"page_{page_num + 1}.png", "image/png")
            if page_text and page_text.strip():
                parts.append(f"--- Page {page_num + 1} ---\n{page_text.strip()}")
    finally:
        doc.close()
    return "\n\n".join(parts)


def _generate_html_from_docx(file_bytes: bytes) -> str:
    """Convert DOCX to HTML preserving fonts, sizes, bold/italic via python-docx."""
    try:
        import io as _io
        from docx import Document
        from docx.shared import Pt
        from docx.oxml.ns import qn
        import html as _html

        doc = Document(_io.BytesIO(file_bytes))
        parts = []

        def _run_style(run, para_style_font) -> str:
            styles = []
            # Font size
            sz = run.font.size or (para_style_font.size if para_style_font else None)
            if sz:
                styles.append(f"font-size:{sz.pt:.1f}pt")
            # Font family
            name = run.font.name or (para_style_font.name if para_style_font else None)
            if name:
                styles.append(f"font-family:'{name}',serif")
            # Bold
            b = run.bold if run.bold is not None else (para_style_font.bold if para_style_font else None)
            if b:
                styles.append("font-weight:bold")
            # Italic
            i = run.italic if run.italic is not None else (para_style_font.italic if para_style_font else None)
            if i:
                styles.append("font-style:italic")
            # Underline
            u = run.underline if run.underline is not None else (para_style_font.underline if para_style_font else None)
            if u:
                styles.append("text-decoration:underline")
            return ";".join(styles)

        for para in doc.paragraphs:
            raw = para.text
            sname = (para.style.name or "").lower()
            pf = para.paragraph_format
            psf = para.style.font if para.style else None

            # Choose tag
            if "heading 1" in sname:
                tag = "h1"
            elif "heading 2" in sname:
                tag = "h2"
            elif "heading 3" in sname:
                tag = "h3"
            elif "heading 4" in sname or "heading 5" in sname or "heading 6" in sname:
                tag = "h4"
            else:
                tag = "p"

            # Paragraph-level style
            p_styles = []
            if pf.left_indent:
                p_styles.append(f"margin-left:{pf.left_indent.pt:.0f}pt")
            if pf.right_indent:
                p_styles.append(f"margin-right:{pf.right_indent.pt:.0f}pt")
            if pf.space_before:
                p_styles.append(f"margin-top:{pf.space_before.pt:.0f}pt")
            if pf.space_after:
                p_styles.append(f"margin-bottom:{pf.space_after.pt:.0f}pt")
            if para.alignment is not None:
                align_map = {0: "left", 1: "center", 2: "right", 3: "justify"}
                al = align_map.get(para.alignment.value if hasattr(para.alignment, 'value') else para.alignment)
                if al:
                    p_styles.append(f"text-align:{al}")

            p_style_str = ";".join(p_styles)
            tag_open = f'<{tag} style="{p_style_str}">' if p_style_str else f'<{tag}>'

            if not raw.strip():
                parts.append(f"{tag_open}&nbsp;</{tag}>")
                continue

            # Build inline spans per run
            if para.runs:
                spans = []
                for run in para.runs:
                    if not run.text:
                        continue
                    rs = _run_style(run, psf)
                    text_esc = _html.escape(run.text)
                    if rs:
                        spans.append(f'<span style="{rs}">{text_esc}</span>')
                    else:
                        spans.append(text_esc)
                inner = "".join(spans)
            else:
                inner = _html.escape(raw)

            parts.append(f"{tag_open}{inner}</{tag}>")

        # Also process tables
        for table in doc.tables:
            rows_html = []
            for row in table.rows:
                cells_html = []
                for cell in row.cells:
                    cell_text = _html.escape(cell.text.strip())
                    cells_html.append(f'<td style="border:1px solid #d1d5db;padding:6px 10px;vertical-align:top">{cell_text}</td>')
                rows_html.append(f'<tr>{"".join(cells_html)}</tr>')
            parts.append(f'<table style="border-collapse:collapse;width:100%;margin:12px 0">{"".join(rows_html)}</table>')

        return "\n".join(parts)
    except Exception as e:
        logger.warning(f"DOCX HTML generation failed: {e}")
        return ""


def _generate_html_from_pdf(file_bytes: bytes) -> str:
    """Convert PDF to styled HTML preserving font sizes, bold, italic via PyMuPDF."""
    try:
        import fitz
        import html as _html

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        parts = []

        for page_num, page in enumerate(doc):
            if page_num > 0:
                parts.append('<hr style="border:none;border-top:2px dashed #d1d5db;margin:24px 0">')

            blocks = sorted(
                page.get_text("dict")["blocks"],
                key=lambda b: (round(b["bbox"][1] / 5) * 5, b["bbox"][0])
            )

            for block in blocks:
                if block.get("type") != 0:
                    continue

                lines_html = []
                block_max_size = 0

                for line in block.get("lines", []):
                    span_html = []
                    for span in line.get("spans", []):
                        text = span["text"]
                        if not text.strip():
                            continue
                        size = span["size"]
                        flags = span["flags"]
                        font = span["font"]
                        block_max_size = max(block_max_size, size)

                        styles = [f"font-size:{size:.1f}pt"]
                        if font and font != "(null)":
                            styles.append(f"font-family:'{font}',serif")
                        if flags & 16 or "Bold" in (font or ""):
                            styles.append("font-weight:bold")
                        if flags & 2 or "Italic" in (font or ""):
                            styles.append("font-style:italic")

                        span_html.append(
                            f'<span style="{";".join(styles)}">{_html.escape(text)}</span>'
                        )

                    if span_html:
                        lines_html.append("".join(span_html))

                if not lines_html:
                    continue

                inner = "<br>".join(lines_html)
                if block_max_size >= 16:
                    parts.append(f'<h2 style="font-size:{block_max_size:.1f}pt;margin:16px 0 8px">{inner}</h2>')
                elif block_max_size >= 13:
                    parts.append(f'<h3 style="font-size:{block_max_size:.1f}pt;margin:12px 0 6px">{inner}</h3>')
                else:
                    parts.append(f'<p style="font-size:{block_max_size:.1f}pt;margin:4px 0;line-height:1.6">{inner}</p>')

        doc.close()
        return "\n".join(parts)
    except Exception as e:
        logger.warning(f"PDF HTML generation failed: {e}")
        return ""


def _extract_text_from_docx(file_bytes: bytes, max_chars: int = 500_000) -> str:
    """Extract text from DOCX bytes, preserving paragraph boundaries with double newlines."""
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            with z.open("word/document.xml") as f:
                tree = ET.parse(f)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        raw_paragraphs = tree.findall(".//w:p", ns)
        paras = []
        for p in raw_paragraphs:
            line = "".join(node.text or "" for node in p.findall(".//w:t", ns)).strip()
            if line:
                paras.append(line)
        text = "\n\n".join(paras)
        return text[:max_chars]
    except Exception as e:
        logger.warning(f"DOCX text extraction failed: {e}")
        return ""


def _ai_describe_image(file_bytes: bytes, original_filename: str, mime_type: str = "image/png") -> str:
    """Use GPT-5.4 vision to describe an image for exhibit naming."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return ""
    try:
        import base64
        from openai import OpenAI
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        # Map common extensions to mime types
        ext = Path(original_filename).suffix.lower()
        mime_map = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
            ".tiff": "image/tiff", ".tif": "image/tiff",
        }
        img_mime = mime_map.get(ext, mime_type)
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=get_model_for_task("image_description"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a legal document analyst. Describe this image/screenshot in detail. "
                        "Focus on: any text visible, document type, parties mentioned, dates, "
                        "signatures, headers, or notable content. This will be used to generate "
                        "an exhibit name for a legal case. Be specific and factual."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Describe this image (filename: {original_filename}). What does it show?"},
                        {"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{b64}", "detail": "high"}},
                    ],
                },
            ],
            max_completion_tokens=500,
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"AI image description failed: {e}")
        return ""


_EXHIBIT_NAME_SYSTEM_PROMPT = (
    "You are a legal document analyst. Given the text of a legal document, "
    "generate a short, descriptive exhibit name that MUST include:\n"
    "1. The document type (Agreement, Invoice, Email, Letter, Contract, etc.)\n"
    "2. The names of ALL signing parties or key parties mentioned\n"
    "3. The date the document was signed or executed (if found in the text)\n\n"
    "Format: '[Document Type] between [Party A] and [Party B] dated [Date] (signed by [Signatories])'\n\n"
    "Examples:\n"
    "- 'Consulting Services Agreement between ERC Ltd and Lebanon Medical dated May 17, 2023 (signed by Derek Cowan and Sarah Mills)'\n"
    "- 'Invoice #1234 from ABC Corp to XYZ Inc dated June 3, 2023'\n"
    "- 'Demand Letter from Smith & Associates to Jones Corp dated Jan 5, 2024'\n"
    "- 'Employment Contract between John Doe and Acme Corp dated March 1, 2022 (signed by John Doe and HR Director)'\n"
    "- 'Email correspondence between Smith and Jones re: payment terms (Jan 5-12, 2024)'\n\n"
    "CRITICAL RULES:\n"
    "- ALWAYS include party names if they appear anywhere in the document\n"
    "- ALWAYS include the signing/execution date if one appears in the document\n"
    "- If multiple dates exist, use the signing/execution date, not other dates\n"
    "- If no date is found, simply omit the date — do NOT write 'undated' or similar\n"
    "- If no party names are found, use whatever identifying info is available\n"
    "- Return ONLY the exhibit name, nothing else. Keep it under 150 characters."
)

_DOCUMENT_NAME_SYSTEM_PROMPT = (
    "You are a legal document analyst. Given the text of a document, "
    "generate a short, descriptive filename. Describe what the document is — "
    "include key parties and dates if present. "
    "This applies to ALL types of legal documents: court filings, motions, "
    "briefs, contracts, letters, orders, pleadings, discovery documents, "
    "general correspondence, and any other legal document. "
    "If no date is found, simply omit the date — do NOT write "
    "'date not found', 'undated', or any similar placeholder. "
    "Examples: 'Motion to Dismiss — Smith v. Jones', "
    "'Retainer Agreement with Johnson LLC dated March 2024', "
    "'Court Order Granting Summary Judgment', "
    "'Plaintiff Complaint — Jones v. City of Newark', "
    "'Subpoena Duces Tecum to ABC Corp', "
    "'Settlement Agreement — Johnson v. Metro Health'. "
    "Return ONLY the document name, nothing else. Keep it under 120 characters."
)


def _ai_generate_exhibit_name(text: str, original_filename: str) -> str:
    """Call OpenAI (with Anthropic fallback) to generate a descriptive exhibit name."""
    fallback_name = Path(original_filename).stem.replace("_", " ").replace("-", " ")
    if not text.strip():
        return fallback_name

    user_msg = f"Original filename: {original_filename}\n\nDocument text (first ~3000 chars):\n{text}"

    # Try OpenAI first
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model=get_model_for_task("exhibit_naming"),
                messages=[
                    {"role": "system", "content": _EXHIBIT_NAME_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=200,
                temperature=0.3,
            )
            name = response.choices[0].message.content.strip().strip('"').strip("'")
            if name:
                return name
        except Exception as e:
            logger.warning(f"OpenAI exhibit naming failed: {e}")

    # Fallback to Anthropic (Claude)
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=200,
                system=_EXHIBIT_NAME_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            name = response.content[0].text.strip().strip('"').strip("'")
            if name:
                logger.info(f"Anthropic exhibit naming succeeded (OpenAI unavailable)")
                return name
        except Exception as e:
            logger.warning(f"Anthropic exhibit naming also failed: {e}")

    return fallback_name


def _ai_generate_document_name(text: str, original_filename: str) -> str:
    """Call OpenAI (with Anthropic fallback) to generate a clean descriptive name for a non-exhibit document."""
    fallback_name = Path(original_filename).stem.replace("_", " ").replace("-", " ")

    input_text = text.strip() if text else ""
    if not input_text:
        input_text = "(No text content extracted. Use the original filename to infer the document type.)"

    user_msg = f"Original filename: {original_filename}\n\nDocument text (first ~3000 chars):\n{input_text}"

    # Try OpenAI first
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model=get_model_for_task("document_naming"),
                messages=[
                    {"role": "system", "content": _DOCUMENT_NAME_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=150,
                temperature=0.3,
            )
            name = response.choices[0].message.content.strip().strip('"').strip("'")
            if name:
                return name
        except Exception as e:
            logger.warning(f"OpenAI document naming failed: {e}")

    # Fallback to Anthropic (Claude)
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=150,
                system=_DOCUMENT_NAME_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            name = response.content[0].text.strip().strip('"').strip("'")
            if name:
                logger.info(f"Anthropic document naming succeeded (OpenAI unavailable)")
                return name
        except Exception as e:
            logger.warning(f"Anthropic document naming also failed: {e}")

    return fallback_name


def _stamp_exhibit_on_pdf(file_bytes: bytes, exhibit_label: str, exhibit_name: str, numbering: str = "letters") -> bytes:
    """Insert a full exhibit cover page BEFORE the original document.
    Cover page layout:
      - 'EXHIBIT A' in very large bold red text (48pt)
      - '(Document Name)' in bold black text (28pt), in parentheses
    Original document pages follow unchanged."""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")

        if len(doc) == 0:
            doc.close()
            return file_bytes

        # Use same dimensions as first page of original document
        first_page = doc[0]
        pw = first_page.rect.width
        ph = first_page.rect.height

        # Create new document: cover page + all original pages
        new_doc = fitz.open()

        # --- Cover Page ---
        cover = new_doc.new_page(width=pw, height=ph)

        # "EXHIBIT NO. A" — large red, centered horizontally and ~35% from top
        exhibit_text = f"EXHIBIT NO. {exhibit_label}"
        font = fitz.Font("helv")
        text_width = font.text_length(exhibit_text, fontsize=48)
        x_exhibit = (pw - text_width) / 2
        y_exhibit = ph * 0.38
        cover.insert_text(
            fitz.Point(x_exhibit, y_exhibit),
            exhibit_text,
            fontsize=48,
            fontname="helv",
            color=(1, 0, 0),  # RED
        )

        # "(Document Name)" — bold black, centered below exhibit label
        # Wrap long names into multiple lines
        if exhibit_name:
            name_fontsize = 28
            max_width = pw - 80  # 40px margin each side
            name_text = f"({exhibit_name})"

            # Simple word-wrap
            words = name_text.split()
            lines = []
            current_line = ""
            for word in words:
                test = f"{current_line} {word}".strip() if current_line else word
                if font.text_length(test, fontsize=name_fontsize) <= max_width:
                    current_line = test
                else:
                    if current_line:
                        lines.append(current_line)
                    current_line = word
            if current_line:
                lines.append(current_line)

            y_name = y_exhibit + 60  # gap below exhibit text
            for line in lines:
                line_width = font.text_length(line, fontsize=name_fontsize)
                x_name = (pw - line_width) / 2
                cover.insert_text(
                    fitz.Point(x_name, y_name),
                    line,
                    fontsize=name_fontsize,
                    fontname="helv",
                    color=(0, 0, 0),  # black
                )
                y_name += name_fontsize + 8  # line spacing

        # --- Copy all original pages unchanged (color, headings, layout) ---
        try:
            new_doc.insert_pdf(doc, links=True, annots=True)
        except TypeError:
            new_doc.insert_pdf(doc)

        output = _pdf_tobytes(new_doc)
        new_doc.close()
        doc.close()
        return output
    except Exception as e:
        logger.warning(f"PDF stamping failed: {e}")
        return file_bytes  # Return original if stamping fails


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".heif"}


def _restamp_existing_exhibit(
    doc_id: str, case_id: str, tenant_id: str,
    file_bytes: bytes, filename: str, ext: str,
    file_path_on_disk: Path, exhibit_label: str, exhibit_name: str
):
    """Re-stamp a replaced exhibit file using its existing label and name.
    Never reassigns the label — preserves Exhibit A as A, F as F, etc."""
    try:
        # Extract fresh text/HTML from new file
        if ext == ".pdf":
            text = _extract_text_from_pdf(file_bytes)
            html = _generate_html_from_pdf(file_bytes)
        elif ext in (".docx", ".doc"):
            text = _extract_text_from_docx(file_bytes)
            html = _generate_html_from_docx(file_bytes)
        elif ext == ".txt":
            text = file_bytes.decode("utf-8", errors="ignore")[:500_000]
            import html as _html_mod
            html = "".join(f"<p>{_html_mod.escape(l)}</p>" for l in text.splitlines() if l.strip())
        else:
            text = ""
            html = ""

        numbering = "letters"
        with get_db() as db:
            row = db.execute("SELECT exhibit_numbering FROM cases WHERE id = ?", (case_id,)).fetchone()
            if row and row["exhibit_numbering"]:
                numbering = row["exhibit_numbering"]

        # Stamp PDF with EXISTING label and name — preserves landscape pages via insert_pdf
        if ext == ".pdf":
            stamped = _stamp_exhibit_on_pdf(file_bytes, exhibit_label, exhibit_name, numbering)
            file_path_on_disk.write_bytes(stamped)

        with get_db() as db:
            db.execute(
                "UPDATE documents SET content_text = ?, content_html = ? WHERE id = ?",
                (text, html, doc_id)
            )
        logger.info(f"Exhibit re-stamped: {doc_id} -> Exhibit {exhibit_label}")
    except Exception as e:
        logger.error(f"Exhibit re-stamp failed for {doc_id}: {e}\n{traceback.format_exc()}")


def _process_exhibit_async(doc_id: str, case_id: str, tenant_id: str,
                           file_bytes: bytes, original_filename: str, ext: str,
                           file_path_on_disk: Path, relative_path: str,
                           category: str = "evidence",
                           preferred_name: str = "",
                           preferred_label: str = "",
                           skip_ai_name: bool = False):
    """Background task: extract text, AI name, stamp PDF, update DB.
    Only documents with category 'evidence' get exhibit labels and cover pages.
    All other categories just get an AI-generated descriptive filename.
    preferred_name / preferred_label let the user set document name and Exhibit No. at upload.
    """
    numbering = "letters"
    try:
        # Look up case exhibit_numbering preference
        try:
            with get_db() as db:
                case_row = db.execute("SELECT exhibit_numbering FROM cases WHERE id = ?", (case_id,)).fetchone()
                if case_row and case_row["exhibit_numbering"]:
                    numbering = case_row["exhibit_numbering"]
        except Exception:
            pass  # column may not exist yet; default to letters

        preferred_name = (preferred_name or "").strip()
        preferred_label = (preferred_label or "").strip()

        # 1. Extract text and generate styled HTML
        if ext == ".pdf":
            text = _extract_text_from_pdf(file_bytes)
            html = _generate_html_from_pdf(file_bytes)
        elif ext in (".docx", ".doc"):
            text = _extract_text_from_docx(file_bytes)
            html = _generate_html_from_docx(file_bytes)
        elif ext == ".txt":
            text = file_bytes.decode("utf-8", errors="ignore")[:500_000]
            import html as _html_mod
            html = "".join(
                f"<p>{_html_mod.escape(line)}</p>"
                for line in text.splitlines() if line.strip()
            )
        elif ext in IMAGE_EXTENSIONS:
            # Full OCR (not just a short caption) so later AI features can read the file
            text = _ocr_image_full_text(file_bytes, original_filename) or _ai_describe_image(
                file_bytes, original_filename
            )
            html = f"<p>{text}</p>" if text else ""
        else:
            text = ""
            html = ""

        is_evidence = (category == "evidence")

        if is_evidence:
            # --- EVIDENCE: full exhibit treatment (label, cover page, scheme-aware filename) ---
            with get_db() as db:
                # Respect labels already assigned at upload time
                existing = db.execute(
                    "SELECT exhibit_label, exhibit_name, exhibit_order, filename FROM documents WHERE id = ?",
                    (doc_id,)
                ).fetchone()
                existing = dict(existing) if existing else {}

                if preferred_label or existing.get("exhibit_label"):
                    exhibit_label = preferred_label or existing["exhibit_label"]
                    exhibit_order = existing.get("exhibit_order")
                    if exhibit_order is None:
                        row = db.execute(
                            "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = 'evidence'",
                            (case_id,)
                        ).fetchone()
                        exhibit_order = row["n"] if row else 0
                else:
                    exhibit_label, exhibit_order = _next_exhibit_label(db, case_id, numbering)

                if preferred_name or (skip_ai_name and existing.get("exhibit_name")):
                    exhibit_name = preferred_name or existing.get("exhibit_name") or Path(original_filename).stem
                elif existing.get("exhibit_name") and existing.get("exhibit_label"):
                    # User already set name at upload — keep it unless empty
                    exhibit_name = existing["exhibit_name"] or _ai_generate_exhibit_name(text, original_filename)
                else:
                    exhibit_name = _ai_generate_exhibit_name(text, original_filename)

                new_filename = _exhibit_filename(exhibit_label, exhibit_name, ext, numbering)

                # Stamp PDF with cover page
                if ext == ".pdf":
                    stamped_bytes = _stamp_exhibit_on_pdf(file_bytes, exhibit_label, exhibit_name, numbering)
                    file_path_on_disk.write_bytes(stamped_bytes)

                db.execute(
                    "UPDATE documents SET exhibit_label = ?, exhibit_name = ?, exhibit_order = ?, filename = ?, content_text = ?, content_html = ? WHERE id = ?",
                    (exhibit_label, exhibit_name, exhibit_order, new_filename, text, html, doc_id)
                )
                logger.info(f"Exhibit processed: {doc_id} -> {new_filename}")
        else:
            # --- NON-EVIDENCE: AI-rename unless user already set a display name ---
            if preferred_name or skip_ai_name:
                stem = preferred_name or Path(original_filename).stem
                # Keep extension if user didn't include it
                if preferred_name and Path(preferred_name).suffix.lower() == ext:
                    new_filename = preferred_name
                else:
                    new_filename = f"{stem}{ext}" if not stem.lower().endswith(ext.lower()) else stem
            else:
                doc_name = _ai_generate_document_name(text, original_filename)
                new_filename = f"{doc_name}{ext}"
            with get_db() as db:
                db.execute(
                    "UPDATE documents SET filename = ?, content_text = ?, content_html = ? WHERE id = ?",
                    (new_filename, text, html, doc_id)
                )
                logger.info(f"Document renamed: {doc_id} -> {new_filename}")

    except Exception as e:
        logger.error(f"Document processing failed for {doc_id}: {e}\n{traceback.format_exc()}")
        # Fallback for evidence: still try to assign a label even if AI failed
        if category == "evidence":
            try:
                with get_db() as db:
                    existing = db.execute(
                        "SELECT exhibit_label, exhibit_name FROM documents WHERE id = ?",
                        (doc_id,)
                    ).fetchone()
                    if existing and existing["exhibit_label"]:
                        return
                    exhibit_label, exhibit_order = _next_exhibit_label(db, case_id, numbering)
                    fallback_name = (preferred_name or Path(original_filename).stem).replace("_", " ").replace("-", " ")
                    new_filename = _exhibit_filename(exhibit_label, fallback_name, ext, numbering)
                    db.execute(
                        "UPDATE documents SET exhibit_label = ?, exhibit_name = ?, exhibit_order = ?, filename = ? WHERE id = ?",
                        (exhibit_label, fallback_name, exhibit_order, new_filename, doc_id)
                    )
            except Exception:
                pass


# Pydantic models for exhibit endpoints
class ExhibitUpdate(BaseModel):
    exhibit_name: Optional[str] = None
    exhibit_label: Optional[str] = None

class DocumentRename(BaseModel):
    filename: str

class DocumentCategoryUpdate(BaseModel):
    category: str

class ExhibitReorderItem(BaseModel):
    doc_id: str
    order: int

class ExhibitReorderRequest(BaseModel):
    items: List[ExhibitReorderItem]

class DocumentMergeRequest(BaseModel):
    doc_ids: List[str] = []  # empty = merge all
    merge_all: bool = False
    filename: str = "Merged Document"
    category: str = "evidence"
    bates_prefix: str = ""  # e.g. "BATES" — empty = no Bates numbering
    bates_start: int = 1
    bates_position: str = "center"  # left | center | right (bottom of page)


class SingleDocumentBatesRequest(BaseModel):
    """Stamp Bates numbers onto one uploaded document — no merge involved."""
    bates_prefix: str
    bates_start: int = 1
    bates_position: str = "center"  # left | center | right (bottom of page)

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _calculate_urgency_score(case: dict) -> float:
    """Calculate urgency score based on deadline proximity vs completion percentage."""
    score = 50.0  # base score

    if case.get("filing_deadline"):
        try:
            deadline = datetime.fromisoformat(case["filing_deadline"])
            now = datetime.now(timezone.utc)
            days_remaining = (deadline - now).days
            if days_remaining < 0:
                score += 50  # Overdue
            elif days_remaining < 3:
                score += 40
            elif days_remaining < 7:
                score += 30
            elif days_remaining < 14:
                score += 20
            elif days_remaining < 30:
                score += 10
        except (ValueError, TypeError):
            pass

    completion = case.get("completion_percentage", 0) or 0
    score -= completion * 0.3  # Higher completion reduces urgency

    priority_weights = {"critical": 20, "high": 15, "medium": 5, "low": 0}
    score += priority_weights.get(case.get("priority", "medium"), 5)

    return max(0, min(100, score))


_WORKFLOW_CASE_TYPE_ALIASES = {
    "litigation": "civil_litigation",
    "civil": "civil_litigation",
    "immigration": "immigration_law",
    "immigration_h1b": "immigration_law",
    "immigration_o1": "immigration_law",
    "criminal": "criminal_litigation",
    "family": "civil_litigation",
    "corporate": "civil_litigation",
    "real_estate": "civil_litigation",
    "ip": "civil_litigation",
    "other": "civil_litigation",
}


def _resolve_workflow_case_type(case_type: Optional[str], forum: Optional[str] = None) -> str:
    """Map frontend case_type values to workflow_templates.case_type keys."""
    ct = (case_type or "other").strip().lower()
    if ct in _WORKFLOW_CASE_TYPE_ALIASES:
        return _WORKFLOW_CASE_TYPE_ALIASES[ct]
    if forum:
        forum_lower = forum.lower()
        if any(x in forum_lower for x in ("uscis", "eoir", "bia", "immigration", "asylum", "dhs", "ice", "cbp", "nvc")):
            return "immigration_law"
        if "arbitration" in forum_lower:
            return "arbitration"
        if "mediation" in forum_lower:
            return "mediation"
        if any(x in forum_lower for x in ("criminal", "crown court", "magistrate")):
            return "criminal_litigation"
    return ct


def _ai_generate_case_tasks(jurisdiction: str, forum: str, matter_type: str, case_title: str) -> list:
    """Use OpenAI to generate practical tasks for a new case."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return []
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        prompt = (
            f"You are an expert legal case manager. Generate a practical, ordered task list for the following matter:\n\n"
            f"Jurisdiction: {jurisdiction or 'Unknown'}\n"
            f"Forum / Agency / Court: {forum or 'Unknown'}\n"
            f"Matter Type: {matter_type or 'Unknown'}\n"
            f"Case Title: {case_title}\n\n"
            f"Rules:\n"
            f"- Return ONLY a JSON array of strings, no commentary, no markdown, no extra text.\n"
            f"- Each string is a single task title (max 120 chars).\n"
            f"- Generate 15-25 tasks.\n"
            f"- Tasks must be specific to this jurisdiction, forum, and matter type.\n"
            f"- Order tasks chronologically by when they typically occur in the proceeding.\n"
            f"- Do NOT include generic tasks like 'Open file' or 'Create folder'.\n\n"
            f"Return only the JSON array."
        )
        response = client.chat.completions.create(
            model=get_model_for_task("case_task_generation"),
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=1200,
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        tasks = json.loads(raw.strip())
        if isinstance(tasks, list):
            return [str(t) for t in tasks if t]
        return []
    except Exception as e:
        logger.warning("[AI TASKS] Generation failed: %s", e)
        return []


def _insert_case_tasks(db, case_id: str, tenant_id: str, task_titles: list) -> int:
    for task_title in task_titles:
        task_id = generate_id()
        db.execute(
            """INSERT INTO tasks (id, case_id, tenant_id, title, status, priority)
               VALUES (?, ?, ?, ?, 'pending', 'medium')""",
            (task_id, case_id, tenant_id, task_title),
        )
    return len(task_titles)


def _populate_case_tasks(
    db,
    case_id: str,
    tenant_id: str,
    case_type: str,
    jurisdiction: Optional[str],
    forum: Optional[str],
    matter_type: Optional[str],
    case_title: str,
) -> int:
    """Create initial tasks via AI, then workflow template fallbacks."""
    ai_tasks = _ai_generate_case_tasks(
        jurisdiction=jurisdiction or "",
        forum=forum or "",
        matter_type=matter_type or case_type or "",
        case_title=case_title,
    )
    if ai_tasks:
        count = _insert_case_tasks(db, case_id, tenant_id, ai_tasks)
        logger.info("[AI TASKS] Generated %d tasks for case %s", count, case_id)
        return count

    resolved = _resolve_workflow_case_type(case_type, forum)
    for template_type in dict.fromkeys([resolved, case_type, "civil_litigation"]):
        if not template_type:
            continue
        template = db.execute(
            "SELECT * FROM workflow_templates WHERE case_type = ?",
            (template_type,),
        ).fetchone()
        if template:
            tasks = json.loads(template["tasks_json"])
            count = _insert_case_tasks(db, case_id, tenant_id, tasks)
            logger.info("[TASKS] Seeded %d tasks from template %s for case %s", count, template_type, case_id)
            return count
    return 0


def _opt_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


@router.get("")
async def list_cases(
    status: str = None,
    case_type: str = None,
    sort_by: str = "urgency_score",
    current_user: dict = Depends(get_current_user)
):
    """List cases filtered by tenant."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        query = "SELECT * FROM cases WHERE tenant_id = ?"
        params: list = [tenant_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        if case_type:
            query += " AND case_type = ?"
            params.append(case_type)

        if sort_by == "urgency_score":
            query += " ORDER BY urgency_score DESC"
        elif sort_by == "filing_deadline":
            query += " ORDER BY filing_deadline ASC"
        elif sort_by == "created_at":
            query += " ORDER BY created_at DESC"
        else:
            query += " ORDER BY urgency_score DESC"

        cases = db.execute(query, params).fetchall()
        result = []
        for c in cases:
            case_dict = dict(c)
            # Recalculate urgency score
            new_score = _calculate_urgency_score(case_dict)
            if abs(new_score - (case_dict.get("urgency_score") or 0)) > 1:
                db.execute(
                    "UPDATE cases SET urgency_score = ? WHERE id = ?",
                    (new_score, case_dict["id"])
                )
                case_dict["urgency_score"] = new_score

            # Get task stats
            tasks = db.execute(
                "SELECT status, COUNT(*) as cnt FROM tasks WHERE case_id = ? GROUP BY status",
                (case_dict["id"],)
            ).fetchall()
            task_stats = {t["status"]: t["cnt"] for t in tasks}
            case_dict["task_stats"] = task_stats
            total = sum(task_stats.values())
            completed = task_stats.get("completed", 0)
            if total > 0:
                case_dict["completion_percentage"] = round((completed / total) * 100, 1)

            result.append(case_dict)
        return result


@router.post("")
async def create_case(req: CaseCreate, current_user: dict = Depends(get_current_user)):
    """Create a new case with AI- or template-generated tasks."""
    tenant_id = current_user["tenant_id"]
    case_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()

    case_number = (req.case_number or "").strip() or None
    exhibit_numbering = req.exhibit_numbering if req.exhibit_numbering in EXHIBIT_SCHEMES else "letters"
    derived_case_type = _resolve_workflow_case_type(req.case_type, req.forum)
    court_value = req.court or req.forum or None

    case_data = {
        "id": case_id,
        "tenant_id": tenant_id,
        "title": req.title,
        "case_number": case_number,
        "case_type": req.case_type,
        "jurisdiction": req.jurisdiction,
        "forum": req.forum,
        "matter_type": req.matter_type,
        "party_roles": req.party_roles,
        "description": req.description,
        "client_name": req.client_name,
        "opposing_party": req.opposing_party,
        "court": court_value,
        "judge": req.judge,
        "filing_deadline": req.filing_deadline,
        "trial_date": req.trial_date,
        "uscis_receipt_number": req.uscis_receipt_number,
        "priority": req.priority,
        "exhibit_numbering": exhibit_numbering,
        "created_by": current_user["sub"],
        "assigned_attorney_id": current_user["sub"],
        "created_at": now,
        "updated_at": now,
    }

    urgency = _calculate_urgency_score(case_data)
    case_data["urgency_score"] = urgency

    with get_db() as db:
        db.execute(
            """INSERT INTO cases (id, tenant_id, title, case_number, case_type,
               jurisdiction, forum, matter_type, party_roles,
               description, client_name, opposing_party, court, judge,
               filing_deadline, trial_date, uscis_receipt_number,
               priority, urgency_score, exhibit_numbering, created_by, assigned_attorney_id,
               created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (case_id, tenant_id, req.title, case_number, req.case_type,
             req.jurisdiction, req.forum, req.matter_type, req.party_roles,
             req.description, req.client_name, req.opposing_party, court_value, req.judge,
             req.filing_deadline, req.trial_date, req.uscis_receipt_number,
             req.priority, urgency, exhibit_numbering,
             current_user["sub"], current_user["sub"], now, now)
        )

        task_count = _populate_case_tasks(
            db, case_id, tenant_id, req.case_type,
            req.jurisdiction, req.forum, req.matter_type or req.case_type, req.title,
        )

    case_data["task_stats"] = {}
    case_data["task_count"] = task_count
    case_data["tasks_total"] = task_count
    return case_data


@router.get("/{case_id}")
async def get_case(case_id: str, current_user: dict = Depends(get_current_user)):
    """Get case details with tasks, documents, and timeline."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            # Check if user has expert access
            access = db.execute(
                """SELECT ce.* FROM case_experts ce
                   JOIN cases c ON ce.case_id = c.id
                   WHERE ce.case_id = ? AND ce.expert_id = ? AND ce.status = 'active'""",
                (case_id, current_user["sub"])
            ).fetchone()
            if not access:
                # Check for a per-case collaborator grant (Case Team & Access invites)
                collab = db.execute(
                    """SELECT id FROM case_collaborators
                       WHERE case_id = ? AND user_id = ? AND status = 'active'""",
                    (case_id, current_user["sub"])
                ).fetchone()
                if not collab:
                    raise HTTPException(status_code=404, detail="Case not found")
            case = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()

        case_dict = dict(case)

        # Get tasks
        tasks = db.execute(
            "SELECT * FROM tasks WHERE case_id = ? ORDER BY created_at ASC",
            (case_id,)
        ).fetchall()
        case_dict["tasks"] = [dict(t) for t in tasks]

        # Get documents (ordered by exhibit_order, then created_at)
        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? ORDER BY exhibit_order ASC, created_at ASC",
            (case_id,)
        ).fetchall()
        case_dict["documents"] = [dict(d) for d in docs]

        # Get timeline events
        timeline = db.execute(
            "SELECT * FROM case_timeline WHERE case_id = ? ORDER BY event_date ASC",
            (case_id,)
        ).fetchall()
        case_dict["timeline"] = [dict(t) for t in timeline]

        # Get contradictions
        contradictions = db.execute(
            "SELECT * FROM contradictions WHERE case_id = ? ORDER BY severity DESC",
            (case_id,)
        ).fetchall()
        case_dict["contradictions"] = [dict(c) for c in contradictions]

        # Get assigned experts
        experts = db.execute(
            """SELECT ce.*, u.full_name, u.email, u.specializations
               FROM case_experts ce JOIN users u ON ce.expert_id = u.id
               WHERE ce.case_id = ? AND ce.status = 'active'""",
            (case_id,)
        ).fetchall()
        case_dict["experts"] = [dict(e) for e in experts]

        return case_dict


@router.patch("/{case_id}")
async def update_case(
    case_id: str,
    req: CaseUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update case details."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        updates = {}
        nullable_fields = {
            "case_number",
            "description",
            "client_name",
            "opposing_party",
            "court",
            "judge",
            "filing_deadline",
            "trial_date",
            "uscis_receipt_number",
            "assigned_attorney_id",
            "exhibit_numbering",
        }
        for field, value in req.model_dump(exclude_unset=True).items():
            # Allow explicitly clearing nullable fields by sending null
            if value is not None or field in nullable_fields:
                updates[field] = value

        if not updates:
            return dict(case)

        updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [case_id, tenant_id]
        db.execute(
            f"UPDATE cases SET {set_clause} WHERE id = ? AND tenant_id = ?",
            values
        )

        # Recalculate urgency
        updated = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        updated_dict = dict(updated)
        new_score = _calculate_urgency_score(updated_dict)
        db.execute("UPDATE cases SET urgency_score = ? WHERE id = ?", (new_score, case_id))
        updated_dict["urgency_score"] = new_score

        return updated_dict


@router.delete("/{case_id}")
async def delete_case(case_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a case and all associated data."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # Delete uploaded files from disk (best effort)
        docs = db.execute(
            "SELECT file_path FROM documents WHERE case_id = ?",
            (case_id,)
        ).fetchall()
        for d in docs:
            try:
                fp = d["file_path"]
                if fp and os.path.exists(fp):
                    os.remove(fp)
            except Exception:
                # Don't block deletion if file cleanup fails
                pass

        # Delete drafts + dependent records
        draft_rows = db.execute(
            "SELECT id FROM legal_drafts WHERE case_id = ?",
            (case_id,)
        ).fetchall()
        draft_ids = [r["id"] for r in draft_rows]
        for did in draft_ids:
            db.execute("DELETE FROM draft_versions WHERE draft_id = ?", (did,))
            db.execute("DELETE FROM research_citations WHERE draft_id = ?", (did,))
            db.execute("DELETE FROM draft_comments WHERE draft_id = ?", (did,))
        db.execute("DELETE FROM legal_drafts WHERE case_id = ?", (case_id,))

        # Delete all associated data
        db.execute("DELETE FROM tasks WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM time_entries WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM documents WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_timeline WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM contradictions WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_experts WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM waitlist WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM discovery_items WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM witnesses WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM chat_messages WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_contacts WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_emails WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_notes WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_pipeline WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM case_access WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM timeline_events WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM contracts WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id))

    return {"ok": True, "message": "Case deleted"}


# Task sub-routes
@router.get("/{case_id}/tasks")
async def get_tasks(case_id: str, current_user: dict = Depends(get_current_user)):
    """Get all tasks for a case."""
    with get_db() as db:
        resolve_case_access(case_id, current_user, db, required_permission="view_tasks")
        tasks = db.execute(
            "SELECT * FROM tasks WHERE case_id = ? ORDER BY created_at ASC",
            (case_id,)
        ).fetchall()
        return [dict(t) for t in tasks]


@router.post("/{case_id}/tasks")
async def create_task(
    case_id: str,
    req: TaskCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a task for a case."""
    task_id = generate_id()

    with get_db() as db:
        case = resolve_case_access(case_id, current_user, db, required_permission="edit_tasks")
        tenant_id = case["tenant_id"]

        description = _opt_str(req.description)
        assigned_to = _opt_str(req.assigned_to)
        due_date = _opt_str(req.due_date)
        parent_task_id = _opt_str(req.parent_task_id)

        if assigned_to:
            user = db.execute(
                "SELECT id FROM users WHERE (id = ? OR LOWER(email) = LOWER(?)) AND tenant_id = ?",
                (assigned_to, assigned_to, tenant_id),
            ).fetchone()
            if user:
                assigned_to = user["id"]
            else:
                note = f"Assigned to: {assigned_to}"
                description = f"{note}\n{description}" if description else note
                assigned_to = None

        try:
            db.execute(
                """INSERT INTO tasks (id, case_id, tenant_id, title, description, assigned_to,
                   due_date, priority, parent_task_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (task_id, case_id, tenant_id, req.title.strip(), description, assigned_to,
                 due_date, req.priority, parent_task_id)
            )
        except Exception as e:
            logger.error("Failed to create task for case %s: %s", case_id, e)
            raise HTTPException(status_code=500, detail="Failed to create task") from e

        return {
            "id": task_id, "case_id": case_id, "title": req.title.strip(),
            "status": "pending", "priority": req.priority,
            "description": description, "assigned_to": assigned_to, "due_date": due_date,
        }


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str,
    req: TaskUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update task status/details."""
    with get_db() as db:
        task = db.execute(
            "SELECT * FROM tasks WHERE id = ? AND tenant_id = ?",
            (task_id, current_user["tenant_id"])
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        updates = {}
        for field, value in req.model_dump(exclude_unset=True).items():
            if value is not None:
                updates[field] = value

        if "status" in updates and updates["status"] == "completed":
            updates["completed_at"] = datetime.now(timezone.utc).isoformat()

        if not updates:
            return dict(task)

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [task_id]
        db.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", values)

        updated = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(updated)


# Document sub-routes
@router.get("/{case_id}/documents")
async def get_documents(case_id: str, current_user: dict = Depends(get_current_user)):
    """List documents for a case (metadata only — no full text/html bodies)."""
    with get_db() as db:
        resolve_case_access(case_id, current_user, db, required_permission="view_documents")
        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        ).fetchall()
        return [_doc_list_item(d) for d in docs]


@router.post("/{case_id}/documents")
async def create_document(
    case_id: str,
    req: DocumentCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a document record (file upload handled separately via pre-signed URL)."""
    tenant_id = current_user["tenant_id"]
    doc_id = generate_id()
    file_path = f"tenants/{tenant_id}/cases/{case_id}/{doc_id}/{req.filename}"

    with get_db() as db:
        db.execute(
            """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, category,
               uploaded_by, content_text)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (doc_id, case_id, tenant_id, req.filename, file_path, req.category,
             current_user["sub"], req.content_text)
        )
        return {
            "id": doc_id,
            "case_id": case_id,
            "filename": req.filename,
            "file_path": file_path,
            "category": req.category,
        }


# File upload endpoint
@router.post("/{case_id}/documents/upload")
async def upload_document_file(
    case_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Form(default="general"),
    notes: str = Form(default=""),
    display_name: str = Form(default=""),
    exhibit_label: str = Form(default=""),
    mark_as_exhibit: str = Form(default=""),
    current_user: dict = Depends(get_current_user)
):
    """Upload a file to a case.

    Optional form fields:
      display_name — user-chosen document title (skips AI rename when set)
      exhibit_label — Exhibit No. (e.g. A, 1, C-1); only for evidence
      mark_as_exhibit — '1'/'true' forces category=evidence + exhibit treatment
    """
    with get_db() as _access_db:
        _case = resolve_case_access(case_id, current_user, _access_db, required_permission="upload_documents")
        tenant_id = _case["tenant_id"]

    # Validate file extension
    original_filename = file.filename or "unnamed_file"
    ext = Path(original_filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    # Read file content
    file_bytes = await file.read()
    file_size = len(file_bytes)
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")
    if file_size == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    doc_id = generate_id()
    mime_type = file.content_type or "application/octet-stream"

    preferred_name = (display_name or "").strip()
    preferred_label = (exhibit_label or "").strip()
    force_exhibit = str(mark_as_exhibit or "").strip().lower() in ("1", "true", "yes", "on")

    # Normalize category; mark_as_exhibit promotes to evidence
    category = (category or "general").strip().lower()
    if force_exhibit:
        category = "evidence"

    # Build initial display filename from user name when provided
    if preferred_name:
        stem = preferred_name
        if Path(stem).suffix.lower() == ext:
            filename = stem
        else:
            filename = f"{stem}{ext}"
    else:
        filename = original_filename

    # Create directory and save file
    upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{doc_id}_{original_filename}"
    file_path = upload_dir / safe_filename
    file_path.write_bytes(file_bytes)

    # Store relative path in DB
    relative_path = f"{tenant_id}/{case_id}/{safe_filename}"

    # Assign order for ordered sections; for evidence optionally assign Exhibit No. immediately
    exhibit_order = None
    exhibit_name_init = None
    exhibit_label_init = None
    numbering = "letters"
    with get_db() as db:
        try:
            case_row = db.execute("SELECT exhibit_numbering FROM cases WHERE id = ?", (case_id,)).fetchone()
            if case_row and case_row["exhibit_numbering"]:
                numbering = case_row["exhibit_numbering"]
        except Exception:
            pass

        if category in ("record_on_appeal", "immigration_packet", "appeal_brief", "evidence"):
            # Serialize order assignment so concurrent multi-file uploads don't clash
            db.execute("BEGIN IMMEDIATE")
            if category == "evidence":
                if preferred_label:
                    exhibit_label_init = preferred_label
                    row = db.execute(
                        "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = 'evidence'",
                        (case_id,)
                    ).fetchone()
                    exhibit_order = row["n"] if row else 0
                else:
                    exhibit_label_init, exhibit_order = _next_exhibit_label(db, case_id, numbering)
                exhibit_name_init = preferred_name or Path(original_filename).stem.replace("_", " ").replace("-", " ")
                filename = _exhibit_filename(exhibit_label_init, exhibit_name_init, ext, numbering)
            else:
                row = db.execute(
                    "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = ?",
                    (case_id, category)
                ).fetchone()
                exhibit_order = row["n"] if row else 0

        db.execute(
            """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
               category, uploaded_by, content_text, exhibit_order, exhibit_label, exhibit_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (doc_id, case_id, tenant_id, filename, relative_path, file_size, mime_type,
             category, current_user["sub"], notes, exhibit_order, exhibit_label_init, exhibit_name_init)
        )
        saved = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()

    skip_ai = bool(preferred_name)
    # Process document in background (stamp PDF / AI name when needed)
    background_tasks.add_task(
        _process_exhibit_async, doc_id, case_id, tenant_id,
        file_bytes, original_filename, ext, file_path, relative_path,
        category, preferred_name, preferred_label or (exhibit_label_init or ""), skip_ai
    )

    # Deduct 1 credit for AI naming — never fail the upload if credits accounting errors
    try:
        with get_db() as _db:
            _up_row = _db.execute("SELECT subscription_status FROM users WHERE id=?", (current_user["sub"],)).fetchone()
            if _up_row:
                deduct_credits(current_user["sub"], _up_row["subscription_status"], 1, "document_naming", _db)
    except Exception as credit_err:
        logger.warning(f"Credit deduct after upload failed (doc still saved): {credit_err}")

    result = _doc_list_item(saved) if saved else {
        "id": doc_id,
        "case_id": case_id,
        "filename": filename,
        "file_size": file_size,
        "mime_type": mime_type,
        "category": category,
        "has_file": True,
        "exhibit_order": exhibit_order,
        "exhibit_label": exhibit_label_init,
        "exhibit_name": exhibit_name_init,
    }
    # exhibit_processing true only when AI still needs to invent a name (no user name)
    result["exhibit_processing"] = category == "evidence" and not preferred_name
    result["has_file"] = True
    return result


# File download endpoint
@router.get("/debug/upload-config")
async def debug_upload_config(current_user: dict = Depends(get_current_user)):
    """Diagnostic: show upload directory config and what files exist on disk."""
    import os
    base = Path(UPLOAD_BASE_DIR)
    entries = []
    if base.exists():
        try:
            for root, dirs, files in os.walk(str(base)):
                for f in files:
                    full = Path(root) / f
                    rel = full.relative_to(base)
                    entries.append(str(rel))
                if len(entries) > 200:
                    entries.append("... (truncated at 200 files)")
                    break
        except Exception as e:
            entries = [f"walk error: {e}"]
    return {
        "UPLOAD_BASE_DIR": str(base),
        "base_exists": base.exists(),
        "base_is_dir": base.is_dir() if base.exists() else False,
        "files_on_disk": entries,
    }


@router.get("/documents/{doc_id}/debug-path")
async def debug_document_path(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Diagnostic: show exactly what path would be used to serve this document."""
    with get_db() as db:
        doc = db.execute(
            "SELECT id, filename, file_path, mime_type FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        stored_path = doc["file_path"] or ""
        resolved = str(Path(UPLOAD_BASE_DIR) / stored_path) if stored_path else None
        exists = Path(resolved).exists() if resolved else False
        return {
            "doc_id": doc_id,
            "filename": doc["filename"],
            "stored_path_in_db": stored_path,
            "UPLOAD_BASE_DIR": UPLOAD_BASE_DIR,
            "resolved_full_path": resolved,
            "file_exists": exists,
        }


@router.get("/documents/{doc_id}/download")
async def download_document_file(
    doc_id: str,
    current_user: dict = Depends(get_download_user)
):
    """Download a document file."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        stored_path = doc["file_path"] or ""
        file_path = Path(UPLOAD_BASE_DIR) / stored_path if stored_path else None

        # Fallback: if stored path is already absolute and exists, use it directly
        if (file_path is None or not file_path.exists()) and stored_path.startswith("/"):
            candidate = Path(stored_path)
            if candidate.exists():
                file_path = candidate

        if file_path is None or not file_path.exists():
            logger.warning(
                "Download 404: doc=%s UPLOAD_BASE_DIR=%r stored_path=%r resolved=%r",
                doc_id, UPLOAD_BASE_DIR, stored_path, str(file_path)
            )
            raise HTTPException(
                status_code=404,
                detail=f"File not found on server. base={UPLOAD_BASE_DIR!r} stored={stored_path!r}"
            )

        return FileResponse(
            path=str(file_path),
            filename=doc["filename"],
            media_type=doc["mime_type"] or "application/octet-stream",
        )


@router.get("/{case_id}/documents/download-all")
async def download_all_documents_as_pdf(
    case_id: str,
    bates_prefix: str = "",
    bates_start: int = 1,
    bates_position: str = "center",
    current_user: dict = Depends(get_download_user)
):
    """Merge ALL case documents (every file type) into one PDF for download.
    Optional Bates: ?bates_prefix=BATES&bates_start=1&bates_position=left|center|right
    Numbers stamp as PREFIX-01 … PREFIX-N (bold, large, bottom of page)."""
    from fastapi.responses import Response

    with get_db() as db:
        case = resolve_case_access(case_id, current_user, db, required_permission="download_documents")
        tenant_id = case["tenant_id"]

        # Each merge/download-all is an independent job over the source documents —
        # never re-include output from a prior merge, or every re-run would keep
        # doubling up the same pages/files.
        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? AND tenant_id = ? AND (is_merged IS NULL OR is_merged = 0) "
            "ORDER BY exhibit_order ASC, created_at ASC",
            (case_id, tenant_id)
        ).fetchall()
        if not docs:
            raise HTTPException(status_code=404, detail="No documents in this case")
        docs = [dict(d) for d in docs]
        docs = _filter_reuploaded_merge_duplicates(db, case_id, tenant_id, docs)
        if not docs:
            raise HTTPException(status_code=404, detail="No documents in this case")

    # Sort: court_filing FIRST, then petition, then ROA / Immigration Packet (user order),
    # then exhibits by label (A, B, C...), then other docs
    def _doc_sort_key(d):
        label = d.get('exhibit_label') or ''
        cat = d.get('category', '')
        if cat == 'court_filing':
            return (0, '', d.get('created_at', ''))
        elif cat == 'petition':
            return (1, '', d.get('created_at', ''))
        elif cat == 'record_on_appeal':
            order = d.get('exhibit_order')
            order_key = f"{order:06d}" if order is not None else '999999'
            return (2, order_key, d.get('created_at', ''))
        elif cat == 'immigration_packet':
            order = d.get('exhibit_order')
            order_key = f"{order:06d}" if order is not None else '999999'
            return (3, order_key, d.get('created_at', ''))
        elif cat == 'evidence' and label:
            return (4, label, d.get('created_at', ''))
        elif cat == 'evidence':
            return (4, 'ZZZZ', d.get('created_at', ''))
        else:
            return (5, '', d.get('created_at', ''))
    docs.sort(key=_doc_sort_key)

    file_items = []
    for doc in docs:
        if not doc.get("file_path"):
            continue
        fp = Path(UPLOAD_BASE_DIR) / doc["file_path"]
        if not fp.exists():
            continue
        file_items.append((str(fp), doc.get("filename", "")))

    loop = asyncio.get_event_loop()
    merged_bytes = await loop.run_in_executor(
        _get_pdf_merge_pool(),
        _merge_file_list_to_pdf_bytes,
        file_items, bates_prefix, bates_start, bates_position,
    )
    if not merged_bytes:
        raise HTTPException(status_code=400, detail="No mergeable content found")

    case_title = case.get("title", "Case").replace(" ", "_")
    filename = f"{case_title}_Complete_Filing.pdf"

    return Response(
        content=merged_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/{case_id}/documents/download-zip")
async def download_all_documents_as_zip(
    case_id: str,
    current_user: dict = Depends(get_download_user)
):
    """Download ALL case documents as a ZIP archive, preserving original file formats."""
    import zipfile
    from fastapi.responses import Response

    with get_db() as db:
        case = resolve_case_access(case_id, current_user, db, required_permission="download_documents")
        tenant_id = case["tenant_id"]

        # Each merge/download-all is an independent job over the source documents —
        # never re-include output from a prior merge, or every re-run would keep
        # doubling up the same pages/files.
        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? AND tenant_id = ? AND (is_merged IS NULL OR is_merged = 0) "
            "ORDER BY exhibit_order ASC, created_at ASC",
            (case_id, tenant_id)
        ).fetchall()
        if not docs:
            raise HTTPException(status_code=404, detail="No documents in this case")
        docs = [dict(d) for d in docs]
        docs = _filter_reuploaded_merge_duplicates(db, case_id, tenant_id, docs)
        if not docs:
            raise HTTPException(status_code=404, detail="No documents in this case")

    # Sort: court_filing FIRST, then petition, ROA / Immigration Packet (user order), exhibits, then other
    def _zip_sort_key(d):
        label = d.get('exhibit_label') or ''
        cat = d.get('category', '')
        if cat == 'court_filing':
            return (0, '', d.get('created_at', ''))
        elif cat == 'petition':
            return (1, '', d.get('created_at', ''))
        elif cat == 'record_on_appeal':
            order = d.get('exhibit_order')
            order_key = f"{order:06d}" if order is not None else '999999'
            return (2, order_key, d.get('created_at', ''))
        elif cat == 'immigration_packet':
            order = d.get('exhibit_order')
            order_key = f"{order:06d}" if order is not None else '999999'
            return (3, order_key, d.get('created_at', ''))
        elif cat == 'evidence' and label:
            return (4, label, d.get('created_at', ''))
        elif cat == 'evidence':
            return (4, 'ZZZZ', d.get('created_at', ''))
        else:
            return (5, '', d.get('created_at', ''))
    docs.sort(key=_zip_sort_key)

    buf = io.BytesIO()
    used_names: dict = {}
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            if not doc.get("file_path"):
                continue
            fp = Path(UPLOAD_BASE_DIR) / doc["file_path"]
            if not fp.exists():
                continue
            # Use display filename, deduplicate if needed
            name = doc.get("filename") or fp.name
            if name in used_names:
                used_names[name] += 1
                stem = Path(name).stem
                ext = Path(name).suffix
                name = f"{stem} ({used_names[name]}){ext}"
            else:
                used_names[name] = 1
            zf.write(str(fp), name)

    zip_bytes = buf.getvalue()
    case_title = dict(case).get("title", "Case").replace(" ", "_")
    filename = f"{case_title}_Documents.zip"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# Delete document endpoint
@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a document and its file."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # Delete file from disk
        if doc["file_path"]:
            file_path = Path(UPLOAD_BASE_DIR) / doc["file_path"]
            file_path.unlink(missing_ok=True)

        db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))

    return {"status": "deleted", "document_id": doc_id}


@router.patch("/documents/{doc_id}/rename")
async def rename_document(
    doc_id: str,
    req: DocumentRename,
    current_user: dict = Depends(get_current_user)
):
    """Rename a document's display filename."""
    new_name = (req.filename or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        db.execute("UPDATE documents SET filename = ? WHERE id = ?", (new_name, doc_id))
        updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(updated)


class DocumentAIRenameRequest(BaseModel):
    instructions: Optional[str] = ""


def _ai_rename_with_instructions(text: str, original_filename: str, instructions: str, is_exhibit: bool) -> str:
    """AI rename driven by user-supplied instructions."""
    fallback = Path(original_filename).stem.replace("_", " ").replace("-", " ")
    input_text = text.strip() if text else "(No text content extracted.)"
    user_msg = (
        f"Original filename: {original_filename}\n\n"
        f"User instruction: {instructions}\n\n"
        f"Document text (first ~2000 chars):\n{input_text[:2000]}"
    )
    system_msg = (
        "You are a legal document labeler. Follow the user instruction as the primary directive. "
        "Rules: 1. Follow the user instruction — it overrides everything else. "
        "2. Keep the name short (under 80 characters). "
        "3. Do NOT include a date unless the instruction or document specifically mentions one. "
        "4. Do NOT write placeholder text like 'undated' or 'not stated'. "
        "Return ONLY the name, nothing else."
    )
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model=get_model_for_task("exhibit_naming" if is_exhibit else "document_naming"),
                messages=[{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
                max_completion_tokens=150, temperature=0.3,
            )
            name = resp.choices[0].message.content.strip().strip('"').strip("'")
            if name:
                return name
        except Exception as e:
            logger.warning(f"AI rename instructions (OpenAI) failed: {e}")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic as _anthropic
            client = _anthropic.Anthropic(api_key=anthropic_key)
            resp = client.messages.create(
                model="claude-sonnet-4-6", max_tokens=150,
                system=system_msg, messages=[{"role": "user", "content": user_msg}],
            )
            name = resp.content[0].text.strip().strip('"').strip("'")
            if name:
                return name
        except Exception as e:
            logger.warning(f"AI rename instructions (Anthropic) failed: {e}")
    return fallback


def _restamp_exhibit_pdf(file_bytes: bytes, exhibit_label: str, new_name: str, numbering: str) -> bytes:
    """Remove the existing cover page then re-stamp with a new name."""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        if len(doc) < 2:
            doc.close()
            return _stamp_exhibit_on_pdf(file_bytes, exhibit_label, new_name, numbering)
        doc.delete_page(0)
        stripped = doc.tobytes()
        doc.close()
        return _stamp_exhibit_on_pdf(stripped, exhibit_label, new_name, numbering)
    except Exception as e:
        logger.warning(f"Cover page re-stamp failed: {e}")
        return file_bytes


@router.post("/documents/{doc_id}/ai-rename")
async def ai_rename_document(
    doc_id: str,
    req: DocumentAIRenameRequest,
    current_user: dict = Depends(get_current_user)
):
    """AI-rename a document, optionally guided by user instructions.
    For exhibits: updates exhibit_name + filename and re-stamps PDF cover page.
    For ordinary docs: updates filename only."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        doc_dict = dict(doc)

    text = doc_dict.get("content_text") or ""
    original_filename = doc_dict.get("filename") or ""
    exhibit_label = doc_dict.get("exhibit_label") or ""
    file_path_str = doc_dict.get("file_path") or ""
    ext = Path(file_path_str).suffix.lower() if file_path_str else ""
    instructions = (req.instructions or "").strip()

    if exhibit_label:
        new_name = (
            _ai_rename_with_instructions(text, original_filename, instructions, is_exhibit=True)
            if instructions else _ai_generate_exhibit_name(text, original_filename)
        )
        numbering = "letters"
        with get_db() as db:
            row = db.execute("SELECT exhibit_numbering FROM cases WHERE id = ?", (doc_dict["case_id"],)).fetchone()
            if row and row["exhibit_numbering"]:
                numbering = row["exhibit_numbering"]

        new_filename = _exhibit_filename(exhibit_label, new_name, ext, numbering)
        fp = Path(UPLOAD_BASE_DIR) / file_path_str
        if ext == ".pdf" and fp.exists():
            try:
                stamped = _restamp_exhibit_pdf(fp.read_bytes(), exhibit_label, new_name, numbering)
                fp.write_bytes(stamped)
            except Exception as e:
                logger.warning(f"AI rename re-stamp failed for {doc_id}: {e}")

        with get_db() as db:
            db.execute("UPDATE documents SET exhibit_name = ?, filename = ? WHERE id = ?",
                       (new_name, new_filename, doc_id))
            updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(updated)
    else:
        new_name = (
            _ai_rename_with_instructions(text, original_filename, instructions, is_exhibit=False)
            if instructions else _ai_generate_document_name(text, original_filename)
        )
        with get_db() as db:
            db.execute("UPDATE documents SET filename = ? WHERE id = ?", (new_name, doc_id))
            updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(updated)


class OrganizePagesRequest(BaseModel):
    """Reorder / delete pages of a PDF (typically a merged Bates packet).

    page_order: 0-based indices from the *current* PDF, in the desired new order.
    Pages omitted from page_order are deleted. Re-applying Bates clears the old
    bottom stamp band and re-numbers 01…N.

    filename: optional display name for the saved packet (user's final name).
    save_as_new: if True, write a NEW document in the same workspace instead of
                 overwriting the source row (recommended for multi-doc packages).
    """
    page_order: List[int]
    # Bates OFF by default — only stamp when the user explicitly enables it
    reapply_bates: bool = False
    bates_prefix: str = ""
    bates_start: int = 1
    bates_position: str = "center"
    # When True and reapply is off: still wipe any old bottom Bates strip on save
    clear_old_bates: bool = False
    filename: Optional[str] = None
    save_as_new: bool = False


class CombineForOrganizeRequest(BaseModel):
    """Merge multiple case PDFs into a *new* document for the organizer.

    Sources are never modified. This prevents page-doubling when re-combining
    and keeps originals findable under their own names.
    """
    doc_ids: List[str]
    filename: str = "Organized Packet.pdf"
    category: Optional[str] = None


def _load_tenant_document(doc_id: str, tenant_id: str) -> dict:
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return dict(doc)


def _assert_pdf_document(doc: dict, path: Path) -> None:
    if path.suffix.lower() == ".pdf" or (doc.get("mime_type") or "").endswith("pdf"):
        return
    try:
        if path.read_bytes()[:5].startswith(b"%PDF"):
            return
    except Exception:
        pass
    raise HTTPException(status_code=400, detail="Only PDF documents can be organized by page")


def _build_document_pages_payload(doc_id: str, doc: dict, analyze: str = "fast") -> dict:
    """List PDF pages with blank / duplicate detection (shared by GET /pages and insert).

    analyze:
      - "fast" (default): text + image xref only — opens large packets quickly
      - "full": includes pixmap blank detection (slower, more accurate blanks)
      - "none": index-only list (fastest; no blank/dup flags)
    """
    import fitz
    import time as _time

    t0 = _time.perf_counter()
    path = _resolve_doc_pdf_path(doc)
    filename = doc.get("filename") or path.name
    _assert_pdf_document(doc, path)
    analyze = (analyze or "fast").strip().lower()
    if analyze not in ("fast", "full", "none"):
        analyze = "fast"

    try:
        pdf = fitz.open(str(path))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open PDF: {e}")

    pages = []
    blank_count = 0
    nearly_count = 0
    duplicate_count = 0
    n = 0
    try:
        n = pdf.page_count
        for i in range(n):
            if analyze == "none":
                r = pdf[i].rect
                info = {
                    "blank": False,
                    "nearly_blank": False,
                    "text_len": 0,
                    "white_ratio": 0.0,
                    "black_ratio": 0.0,
                    "width": round(r.width, 1),
                    "height": round(r.height, 1),
                    "content_hash": f"p{i}",
                    "n_images": 0,
                    "analyze_mode": "none",
                }
            else:
                info = _analyze_pdf_page(pdf[i], mode=analyze)
            if info.get("blank"):
                blank_count += 1
            elif info.get("nearly_blank"):
                nearly_count += 1
            pages.append({
                "index": i,
                "page_number": i + 1,
                "thumb_path": f"/api/cases/documents/{doc_id}/pages/{i}/thumbnail",
                **info,
            })
        # Mark later copies of the same content_hash as duplicates
        if analyze != "none":
            first_seen: dict = {}
            for p in pages:
                ch = p.get("content_hash") or f"idx-{p['index']}"
                if ch in first_seen:
                    p["is_duplicate"] = True
                    p["duplicate_of"] = first_seen[ch]
                    p["duplicate_of_page"] = first_seen[ch] + 1
                    duplicate_count += 1
                else:
                    first_seen[ch] = p["index"]
                    p["is_duplicate"] = False
                    p["duplicate_of"] = None
                    p["duplicate_of_page"] = None
        else:
            for p in pages:
                p["is_duplicate"] = False
                p["duplicate_of"] = None
                p["duplicate_of_page"] = None
    finally:
        pdf.close()

    elapsed_ms = int((_time.perf_counter() - t0) * 1000)
    if elapsed_ms > 1500 or n >= 100:
        logger.info(
            "pages payload doc=%s pages=%s analyze=%s took %sms",
            doc_id[:8], len(pages), analyze, elapsed_ms,
        )

    return {
        "id": doc_id,
        "filename": filename,
        "page_count": len(pages),
        "is_merged": bool(doc.get("is_merged")),
        "blank_count": blank_count,
        "nearly_blank_count": nearly_count,
        "duplicate_count": duplicate_count,
        "analyze_mode": analyze,
        "analyze_ms": elapsed_ms,
        "pages": pages,
    }


def _write_pdf_bytes_atomic(path: Path, new_bytes: bytes) -> None:
    """Atomically overwrite a PDF path (temp file + replace)."""
    import tempfile

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(suffix=".pdf", dir=str(path.parent))
        try:
            os.write(fd, new_bytes)
            os.close(fd)
            os.replace(tmp_name, str(path))
        except Exception:
            try:
                os.close(fd)
            except Exception:
                pass
            try:
                if os.path.exists(tmp_name):
                    os.unlink(tmp_name)
            except Exception:
                pass
            path.write_bytes(new_bytes)
    except Exception as e:
        logger.error(f"PDF write failed path={path}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save PDF: {e}")


def _normalize_page_order(raw_order: Optional[List[int]], page_count: int) -> List[int]:
    """Validate 0-based page indices; empty → full document order."""
    if not raw_order:
        return list(range(page_count))
    seen = set()
    order: List[int] = []
    for idx in raw_order:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid page index: {idx}")
        if i < 0 or i >= page_count:
            raise HTTPException(
                status_code=400,
                detail=f"Page index out of range: {i} (0–{page_count - 1})",
            )
        if i in seen:
            continue
        seen.add(i)
        order.append(i)
    if not order:
        raise HTTPException(status_code=400, detail="Keep at least one page")
    return order


@router.get("/documents/{doc_id}/pages")
async def list_document_pages(
    doc_id: str,
    analyze: str = Query(
        "fast",
        description="Page analysis mode: fast (default, no pixmap), full (visual blank/dup), none (index only)",
    ),
    current_user: dict = Depends(get_current_user),
):
    """List PDF pages. Previews load from /pages/{i}/thumbnail.

    Default analyze=fast avoids per-page pixmap renders so large packets open quickly.
    Pass analyze=full for deeper blank/duplicate detection.
    """
    tenant_id = current_user["tenant_id"]
    doc = _load_tenant_document(doc_id, tenant_id)
    return _build_document_pages_payload(doc_id, doc, analyze=analyze)


class OrganizeDraftRequest(BaseModel):
    """In-progress organizer state (page order, name, Bates) — not yet finalized."""
    page_order: List[int]
    filename: Optional[str] = None
    reapply_bates: bool = False
    bates_prefix: str = ""
    bates_start: int = 1
    bates_position: str = "center"
    save_as_new: bool = False
    page_count_source: Optional[int] = None  # pages on disk when draft was made


def _ensure_organize_drafts_table(db) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS organize_drafts (
            document_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT,
            draft_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


@router.get("/documents/{doc_id}/pages/draft")
async def get_organize_draft(
    doc_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Load autosaved organizer draft (if any). Survives browser close / reload."""
    tenant_id = current_user["tenant_id"]
    _load_tenant_document(doc_id, tenant_id)
    with get_db() as db:
        _ensure_organize_drafts_table(db)
        row = db.execute(
            "SELECT draft_json, updated_at FROM organize_drafts WHERE document_id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        ).fetchone()
        if not row:
            return {"has_draft": False, "draft": None}
        try:
            draft = json.loads(row["draft_json"] or "{}")
        except Exception:
            draft = {}
        return {
            "has_draft": True,
            "draft": draft,
            "updated_at": row["updated_at"],
        }


@router.put("/documents/{doc_id}/pages/draft")
async def save_organize_draft(
    doc_id: str,
    req: OrganizeDraftRequest,
    current_user: dict = Depends(get_current_user),
):
    """Autosave organizer work-in-progress. Does NOT rewrite the PDF until final Save."""
    tenant_id = current_user["tenant_id"]
    doc = _load_tenant_document(doc_id, tenant_id)
    if not req.page_order:
        raise HTTPException(status_code=400, detail="page_order cannot be empty")
    # De-dupe order while preserving sequence
    seen = set()
    order = []
    for idx in req.page_order:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            continue
        if i in seen or i < 0:
            continue
        seen.add(i)
        order.append(i)
    if not order:
        raise HTTPException(status_code=400, detail="page_order has no valid indices")

    payload = {
        "document_id": doc_id,
        "page_order": order,
        "filename": (req.filename or doc.get("filename") or "").strip(),
        "reapply_bates": bool(req.reapply_bates),
        "bates_prefix": req.bates_prefix or "",
        "bates_start": int(req.bates_start or 1),
        "bates_position": req.bates_position or "center",
        "save_as_new": bool(req.save_as_new),
        "page_count_source": req.page_count_source,
        "page_count_working": len(order),
    }
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        _ensure_organize_drafts_table(db)
        db.execute(
            """INSERT INTO organize_drafts (document_id, tenant_id, user_id, draft_json, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(document_id) DO UPDATE SET
                 draft_json = excluded.draft_json,
                 user_id = excluded.user_id,
                 updated_at = excluded.updated_at,
                 tenant_id = excluded.tenant_id
            """,
            (
                doc_id,
                tenant_id,
                current_user.get("sub") or current_user.get("id"),
                json.dumps(payload),
                now,
            ),
        )
    return {"status": "saved", "has_draft": True, "updated_at": now, "page_count_working": len(order)}


@router.delete("/documents/{doc_id}/pages/draft")
async def delete_organize_draft(
    doc_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Discard organizer draft after final save or explicit discard."""
    tenant_id = current_user["tenant_id"]
    _load_tenant_document(doc_id, tenant_id)
    with get_db() as db:
        _ensure_organize_drafts_table(db)
        db.execute(
            "DELETE FROM organize_drafts WHERE document_id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        )
    return {"status": "discarded", "has_draft": False}


@router.get("/documents/{doc_id}/pages/{page_index}/thumbnail")
async def document_page_thumbnail(
    doc_id: str,
    page_index: int,
    scale: float = 1.15,
    current_user: dict = Depends(get_download_user),
):
    """
    PNG/JPEG preview of a single PDF page for the organizer.
    Auth: Bearer header or ?token= (so <img src> works).
    scale: ~1.0 strip thumb, ~2.0 main preview.
    """
    from fastapi.responses import Response

    tenant_id = current_user.get("tenant_id")
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        ).fetchone()
        if not doc:
            # Collaborators: resolve via case access
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            doc = dict(doc)
            try:
                resolve_case_access(doc["case_id"], current_user, db, required_permission="download_documents")
            except Exception:
                raise HTTPException(status_code=404, detail="Document not found")
        else:
            doc = dict(doc)

    path = _resolve_doc_pdf_path(doc)
    try:
        img_bytes, media = _render_pdf_page_image(path, int(page_index), scale=scale)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"thumbnail render failed doc={doc_id} page={page_index}: {e}")
        raise HTTPException(status_code=500, detail="Could not render page preview")

    return Response(
        content=img_bytes,
        media_type=media,
        headers={
            "Cache-Control": "private, max-age=60",
            "Content-Disposition": f'inline; filename="page-{page_index + 1}.png"',
        },
    )


def _sanitize_org_filename(name: Optional[str], fallback: str = "Organized Packet.pdf") -> str:
    """Safe display filename for organized packets — always ends with .pdf."""
    raw = (name or "").strip() or fallback
    # Strip path separators / control chars
    raw = re.sub(r"[\\/<>:\"|?*\x00-\x1f]+", "_", raw).strip(" .")
    if not raw:
        raw = fallback
    if not raw.lower().endswith(".pdf"):
        raw = f"{raw}.pdf"
    return raw[:200]


@router.post("/documents/{doc_id}/pages/organize")
async def organize_document_pages(
    doc_id: str,
    req: OrganizePagesRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Delete / reorder pages of a PDF.

    Default: overwrite the same document **in place** (same id + workspace).
    With save_as_new=True: create a NEW document in the same workspace with the
    chosen filename (sources / original row stay unchanged).

    Always de-duplicates page_order and refuses to write if output page count
    does not match the unique page_order length (guards against silent doubling).
    """
    import fitz
    import tempfile

    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        doc = dict(doc)

    # Remember workspace metadata — never move the doc out of its section
    keep_category = (doc.get("category") or "general").strip().lower() or "general"
    keep_filename = doc.get("filename")
    keep_exhibit_order = doc.get("exhibit_order")
    keep_exhibit_label = doc.get("exhibit_label")
    keep_exhibit_name = doc.get("exhibit_name")
    keep_is_merged = doc.get("is_merged")
    keep_case_id = doc.get("case_id")
    user_filename = _sanitize_org_filename(
        req.filename,
        fallback=(keep_filename or "Organized Packet.pdf"),
    )

    path = _resolve_doc_pdf_path(doc)
    if path.suffix.lower() != ".pdf" and not (doc.get("mime_type") or "").endswith("pdf"):
        # Allow files that are PDF bytes even with odd extension
        try:
            if not path.read_bytes()[:5].startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail="Only PDF documents can be organized by page")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Only PDF documents can be organized by page")

    if not req.page_order:
        raise HTTPException(status_code=400, detail="Keep at least one page (page_order is empty)")

    try:
        src = fitz.open(str(path))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open PDF: {e}")

    n = src.page_count
    # Validate indices — hard de-dupe (doubled page_order was a reported bug)
    seen = set()
    order = []
    dupes_dropped = 0
    for idx in req.page_order:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            src.close()
            raise HTTPException(status_code=400, detail=f"Invalid page index: {idx}")
        if i < 0 or i >= n:
            src.close()
            raise HTTPException(status_code=400, detail=f"Page index out of range: {i} (0–{n - 1})")
        if i in seen:
            dupes_dropped += 1
            continue
        seen.add(i)
        order.append(i)

    if not order:
        src.close()
        raise HTTPException(status_code=400, detail="Keep at least one page")

    if dupes_dropped:
        logger.warning(
            "organize %s: dropped %s duplicate page_order entries (had %s, unique %s, file has %s)",
            doc_id, dupes_dropped, len(req.page_order), len(order), n,
        )

    try:
        out = fitz.open()
        for i in order:
            out.insert_pdf(src, from_page=i, to_page=i)
        src.close()
        src = None

        new_count = out.page_count
        if new_count != len(order):
            out.close()
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Page count mismatch while building PDF: expected {len(order)} pages, "
                    f"got {new_count}. Save aborted to prevent a doubled packet."
                ),
            )

        # Remove prior Bates strip, then re-number cleanly
        if req.clear_old_bates or (req.reapply_bates and (req.bates_prefix or "").strip()):
            for page in out:
                _clear_bottom_bates_band(page, band_height=42.0)

        bates_applied = False
        prefix = (req.bates_prefix or "").strip()
        if req.reapply_bates and prefix:
            _apply_bates_numbering(
                out,
                prefix,
                req.bates_start or 1,
                position=req.bates_position or "center",
            )
            bates_applied = True

        try:
            new_bytes = _pdf_tobytes(out)
        except Exception:
            new_bytes = out.tobytes()
        # Re-verify serialized page count
        try:
            check = fitz.open(stream=new_bytes, filetype="pdf")
            check_n = check.page_count
            check.close()
            if check_n != len(order):
                out.close()
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Serialized PDF has {check_n} pages but organizer has {len(order)}. "
                        "Save aborted to prevent a doubled packet."
                    ),
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"organize post-serialize page check failed: {e}")
        out.close()
    except HTTPException:
        try:
            if src is not None:
                src.close()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"organize pages failed: {e}\n{traceback.format_exc()}")
        try:
            if src is not None:
                src.close()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to reorganize PDF: {e}")

    file_size = len(new_bytes)
    note_bits = [
        f"Organized PDF: {new_count} pages"
        + (" (saved as new document)" if req.save_as_new else " (in place)")
    ]
    if bates_applied:
        pos = (req.bates_position or "center").strip().lower()
        note_bits.append(
            f"Bates reset: {prefix}-{(req.bates_start or 1):02d}+ ({pos})"
        )
    note = " | ".join(note_bits)

    result_id = doc_id
    saved_as_new = False

    if req.save_as_new:
        # ── Create a NEW document in the same workspace ──────────────────
        if not keep_case_id:
            raise HTTPException(status_code=400, detail="Document has no case_id; cannot save as new")
        new_id = generate_id()
        upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / keep_case_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = f"{new_id}_{user_filename}"
        new_path = upload_dir / safe_filename
        try:
            new_path.write_bytes(new_bytes)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Could not write new organized PDF: {e}")
        relative_path = f"{tenant_id}/{keep_case_id}/{safe_filename}"

        with get_db() as db:
            exhibit_order = None
            if keep_category in ("record_on_appeal", "immigration_packet", "appeal_brief", "evidence"):
                try:
                    db.execute("BEGIN IMMEDIATE")
                except Exception:
                    pass
                row = db.execute(
                    "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = ?",
                    (keep_case_id, keep_category),
                ).fetchone()
                exhibit_order = row["n"] if row else 0
            try:
                db.execute(
                    """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
                       category, uploaded_by, content_text, exhibit_order, is_merged)
                       VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, 1)""",
                    (
                        new_id,
                        keep_case_id,
                        tenant_id,
                        user_filename,
                        relative_path,
                        file_size,
                        keep_category,
                        current_user.get("sub") or current_user.get("id"),
                        note[:5000],
                        exhibit_order,
                    ),
                )
            except Exception:
                db.execute(
                    """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
                       category, uploaded_by, content_text, exhibit_order)
                       VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?)""",
                    (
                        new_id,
                        keep_case_id,
                        tenant_id,
                        user_filename,
                        relative_path,
                        file_size,
                        keep_category,
                        current_user.get("sub") or current_user.get("id"),
                        note[:5000],
                        exhibit_order,
                    ),
                )
                try:
                    db.execute("UPDATE documents SET is_merged = 1 WHERE id = ?", (new_id,))
                except Exception:
                    pass
            updated = db.execute("SELECT * FROM documents WHERE id = ?", (new_id,)).fetchone()
        result_id = new_id
        saved_as_new = True
        keep_filename = user_filename
        keep_exhibit_order = exhibit_order
    else:
        # ── Atomic overwrite of the SAME file path ───────────────────────
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(suffix=".pdf", dir=str(path.parent))
            try:
                os.write(fd, new_bytes)
                os.close(fd)
                os.replace(tmp_name, str(path))
            except Exception:
                try:
                    os.close(fd)
                except Exception:
                    pass
                try:
                    if os.path.exists(tmp_name):
                        os.unlink(tmp_name)
                except Exception:
                    pass
                path.write_bytes(new_bytes)
        except Exception as e:
            logger.error(f"organize write failed for {doc_id} path={path}: {e}")
            raise HTTPException(status_code=500, detail=f"Could not save organized PDF: {e}")

        with get_db() as db:
            prev = (doc.get("content_text") or "").strip()
            if prev and not prev.startswith("Merged from") and not prev.startswith("Organized"):
                content_text = f"{prev}\n{note}" if len(prev) < 4000 else prev
            else:
                content_text = note

            db.execute(
                """UPDATE documents
                   SET file_size = ?,
                       content_text = ?,
                       mime_type = COALESCE(NULLIF(mime_type, ''), 'application/pdf'),
                       category = ?,
                       filename = ?,
                       exhibit_order = COALESCE(exhibit_order, ?),
                       exhibit_label = COALESCE(exhibit_label, ?),
                       exhibit_name = COALESCE(exhibit_name, ?)
                   WHERE id = ? AND tenant_id = ?""",
                (
                    file_size,
                    (content_text or note)[:5000],
                    keep_category,
                    user_filename,
                    keep_exhibit_order,
                    keep_exhibit_label,
                    keep_exhibit_name,
                    doc_id,
                    tenant_id,
                ),
            )
            if keep_category in ("immigration_packet", "record_on_appeal", "appeal_brief", "evidence") and keep_exhibit_order is not None:
                db.execute(
                    "UPDATE documents SET exhibit_order = ? WHERE id = ?",
                    (keep_exhibit_order, doc_id),
                )
            try:
                db.execute("UPDATE documents SET is_merged = 1 WHERE id = ?", (doc_id,))
            except Exception:
                pass
            updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        keep_filename = user_filename

    result = _doc_list_item(updated) if updated else {
        "id": result_id,
        "filename": keep_filename,
        "file_size": file_size,
        "category": keep_category,
        "case_id": keep_case_id,
        "exhibit_order": keep_exhibit_order,
        "exhibit_label": keep_exhibit_label,
        "exhibit_name": keep_exhibit_name,
    }
    result["id"] = result_id
    result["category"] = keep_category
    result["filename"] = keep_filename
    if keep_exhibit_order is not None:
        result["exhibit_order"] = keep_exhibit_order
    if keep_exhibit_label is not None:
        result["exhibit_label"] = keep_exhibit_label
    if keep_exhibit_name is not None:
        result["exhibit_name"] = keep_exhibit_name
    result["page_count"] = new_count
    result["bates_applied"] = bates_applied
    result["pages_removed"] = n - new_count
    result["saved_in_place"] = not saved_as_new
    result["saved_as_new"] = saved_as_new
    result["workspace"] = keep_category
    result["duplicates_dropped"] = dupes_dropped
    return result


@router.post("/{case_id}/documents/combine-for-organize")
async def combine_documents_for_organize(
    case_id: str,
    req: CombineForOrganizeRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Copy pages from multiple existing case PDFs into a **brand-new** document
    for the organizer. Source documents are never modified.

    Use this instead of inserting sources into the first selected doc (which
    overwrote the first file's name and could double pages on re-run).
    """
    import fitz

    tenant_id = current_user["tenant_id"]
    ids = [str(x).strip() for x in (req.doc_ids or []) if str(x).strip()]
    # de-dupe preserving order
    seen = set()
    ordered_ids: List[str] = []
    for i in ids:
        if i in seen:
            continue
        seen.add(i)
        ordered_ids.append(i)
    if not ordered_ids:
        raise HTTPException(status_code=400, detail="Select at least one PDF to organize")

    # Verify case access
    with get_db() as db:
        case = db.execute(
            "SELECT id FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id),
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

    docs_meta = []
    for sid in ordered_ids:
        d = _load_tenant_document(sid, tenant_id)
        if d.get("case_id") and d.get("case_id") != case_id:
            raise HTTPException(
                status_code=400,
                detail=f"{d.get('filename') or sid}: not on this case",
            )
        docs_meta.append(d)

    # Category: explicit request, else first doc, else ready
    category = (req.category or docs_meta[0].get("category") or "ready").strip().lower() or "ready"
    filename = _sanitize_org_filename(req.filename, fallback="Organized Packet.pdf")

    merged = fitz.open()
    sources_note = []
    expected = 0
    try:
        for d in docs_meta:
            spath = _resolve_doc_pdf_path(d)
            _assert_pdf_document(d, spath)
            try:
                piece = fitz.open(str(spath))
            except Exception as e:
                merged.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"{d.get('filename') or d.get('id')}: could not open ({e})",
                )
            try:
                if piece.page_count < 1:
                    continue
                # Always page-by-page — avoids bulk insert_pdf anomalies / page doubling
                before = merged.page_count
                for pi in range(piece.page_count):
                    merged.insert_pdf(piece, from_page=pi, to_page=pi)
                added = merged.page_count - before
                expected += piece.page_count
                sources_note.append((d.get("filename") or d.get("id"), added))
                if added != piece.page_count:
                    logger.error(
                        "combine source %s: source has %s pages but added %s",
                        d.get("filename"), piece.page_count, added,
                    )
            finally:
                piece.close()
        total = merged.page_count
        if total < 1:
            merged.close()
            raise HTTPException(status_code=400, detail="No pages found in selected documents")
        if expected and total != expected:
            merged.close()
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Combine produced {total} pages but selected documents total {expected}. "
                    "Aborted to prevent a doubled packet. Try organizing fewer files at once."
                ),
            )

        try:
            new_bytes = _pdf_tobytes(merged)
        except Exception:
            new_bytes = merged.tobytes()
        try:
            chk = fitz.open(stream=new_bytes, filetype="pdf")
            chk_n = chk.page_count
            chk.close()
            if chk_n != total:
                raise HTTPException(
                    status_code=500,
                    detail=f"Combined PDF serialize mismatch ({chk_n} vs {total}). Save aborted.",
                )
            total = chk_n
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"combine serialize check skipped: {e}")
    finally:
        try:
            merged.close()
        except Exception:
            pass

    new_id = generate_id()
    upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{new_id}_{filename}"
    file_path = upload_dir / safe_filename
    file_path.write_bytes(new_bytes)
    relative_path = f"{tenant_id}/{case_id}/{safe_filename}"
    file_size = len(new_bytes)

    note = (
        f"Combined for organize from {len(sources_note)} document(s): "
        + ", ".join(f"{n} ({p}p)" for n, p in sources_note)
        + f" → {total} pages. Sources unchanged."
    )

    with get_db() as db:
        exhibit_order = None
        if category in ("record_on_appeal", "immigration_packet", "appeal_brief", "evidence"):
            try:
                db.execute("BEGIN IMMEDIATE")
            except Exception:
                pass
            row = db.execute(
                "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = ?",
                (case_id, category),
            ).fetchone()
            exhibit_order = row["n"] if row else 0
        try:
            db.execute(
                """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
                   category, uploaded_by, content_text, exhibit_order, is_merged)
                   VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, 1)""",
                (
                    new_id, case_id, tenant_id, filename, relative_path, file_size,
                    category, current_user.get("sub") or current_user.get("id"),
                    note[:5000], exhibit_order,
                ),
            )
        except Exception:
            # older schema without is_merged
            db.execute(
                """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
                   category, uploaded_by, content_text, exhibit_order)
                   VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?)""",
                (
                    new_id, case_id, tenant_id, filename, relative_path, file_size,
                    category, current_user.get("sub") or current_user.get("id"),
                    note[:5000], exhibit_order,
                ),
            )
            try:
                db.execute("UPDATE documents SET is_merged = 1 WHERE id = ?", (new_id,))
            except Exception:
                pass
        updated = db.execute("SELECT * FROM documents WHERE id = ?", (new_id,)).fetchone()

    result = _doc_list_item(updated) if updated else {
        "id": new_id,
        "case_id": case_id,
        "filename": filename,
        "file_size": file_size,
        "category": category,
        "mime_type": "application/pdf",
    }
    result["id"] = new_id
    result["filename"] = filename
    result["category"] = category
    result["page_count"] = total
    result["is_merged"] = True
    result["sources_unchanged"] = True
    result["source_count"] = len(sources_note)
    result["workspace"] = category
    return result


@router.post("/documents/{doc_id}/pages/insert")
async def insert_pages_into_document(
    doc_id: str,
    position: str = Form(..., description="before or after the anchor page"),
    at_index: int = Form(
        ...,
        description="0-based index in the *working* page order (current UI order)",
    ),
    page_order: str = Form(
        "[]",
        description="JSON array of original page indices reflecting current organizer order",
    ),
    files: Optional[List[UploadFile]] = File(
        None,
        description="One or more PDFs to insert (optional if source_document_ids is set)",
    ),
    source_document_ids: str = Form(
        "[]",
        description="JSON array of existing case document IDs whose PDF pages to insert",
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    Insert pages from additional PDF upload(s) and/or existing case documents into an
    existing document **in place**.

    Optimized for large packets:
      - rebuilds working order with contiguous runs (not per-page when sequential)
      - bulk-inserts uploaded PDFs
      - fast PDF serialize
      - returns lightweight page list (analyze=none) so the UI updates quickly
    """
    import fitz
    import time as _time

    t0 = _time.perf_counter()
    tenant_id = current_user["tenant_id"]
    pos = (position or "").strip().lower()
    if pos not in ("before", "after"):
        raise HTTPException(status_code=400, detail="position must be 'before' or 'after'")

    file_list: List[UploadFile] = list(files or [])
    try:
        raw_src_ids = json.loads(source_document_ids or "[]")
        if raw_src_ids is None:
            raw_src_ids = []
        if not isinstance(raw_src_ids, list):
            raise ValueError("source_document_ids must be a JSON array")
        src_ids = [str(x).strip() for x in raw_src_ids if str(x).strip()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid source_document_ids JSON: {e}")

    # De-dupe while preserving order; never insert the target into itself
    seen_src: set = set()
    ordered_src_ids: List[str] = []
    for sid in src_ids:
        if sid == doc_id or sid in seen_src:
            continue
        seen_src.add(sid)
        ordered_src_ids.append(sid)

    if not file_list and not ordered_src_ids:
        raise HTTPException(
            status_code=400,
            detail="Upload at least one PDF or select existing document(s) to insert",
        )

    try:
        raw_order = json.loads(page_order or "[]")
        if raw_order is None:
            raw_order = []
        if not isinstance(raw_order, list):
            raise ValueError("page_order must be a JSON array")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid page_order JSON: {e}")

    doc = _load_tenant_document(doc_id, tenant_id)
    keep_category = (doc.get("category") or "general").strip().lower() or "general"
    keep_filename = doc.get("filename")
    case_id = doc.get("case_id")
    path = _resolve_doc_pdf_path(doc)
    _assert_pdf_document(doc, path)

    src = None
    work = None
    extra = None
    out = None
    try:
        src = fitz.open(str(path))
        order = _normalize_page_order(raw_order, src.page_count)
        n_src = src.page_count

        # Fast path: working order is the full sequential file — no rebuild needed
        identity = order == list(range(n_src))
        if identity:
            work = src
            src = None  # ownership moved
            n_work = n_src
        else:
            work = fitz.open()
            _append_pages_by_order(work, src, order)
            src.close()
            src = None
            n_work = work.page_count

        if n_work == 0:
            anchor = 0
            insert_at = 0
        else:
            try:
                anchor = int(at_index)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Invalid at_index: {at_index}")
            if anchor < 0 or anchor >= n_work:
                raise HTTPException(
                    status_code=400,
                    detail=f"at_index out of range: {anchor} (0–{n_work - 1})",
                )
            insert_at = anchor if pos == "before" else anchor + 1

        # Build PDF of pages to insert (bulk, not per-page)
        extra = fitz.open()
        inserted_from: List[str] = []
        for uf in file_list:
            fname = (uf.filename or "upload.pdf").strip() or "upload.pdf"
            data = await uf.read()
            if not data:
                continue
            if len(data) > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"{fname}: file exceeds {MAX_FILE_SIZE // (1024 * 1024)} MB limit",
                )
            lower = fname.lower()
            ctype = (uf.content_type or "").lower()
            if not (lower.endswith(".pdf") or "pdf" in ctype or data[:5] == b"%PDF"):
                raise HTTPException(
                    status_code=400,
                    detail=f"{fname}: only PDF files can be inserted into the organizer",
                )
            try:
                piece = fitz.open(stream=data, filetype="pdf")
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"{fname}: could not open as PDF ({e})",
                )
            try:
                if piece.page_count < 1:
                    raise HTTPException(status_code=400, detail=f"{fname}: PDF has no pages")
                before = extra.page_count
                extra.insert_pdf(piece)
                added = extra.page_count - before
                inserted_from.append(f"{fname} ({added}p)")
            finally:
                piece.close()

        for sid in ordered_src_ids:
            sdoc = _load_tenant_document(sid, tenant_id)
            if case_id and sdoc.get("case_id") and sdoc.get("case_id") != case_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"{sdoc.get('filename') or sid}: document is not on this case",
                )
            spath = _resolve_doc_pdf_path(sdoc)
            try:
                _assert_pdf_document(sdoc, spath)
            except HTTPException:
                raise HTTPException(
                    status_code=400,
                    detail=f"{sdoc.get('filename') or sid}: only PDF documents can be inserted",
                )
            try:
                piece = fitz.open(str(spath))
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"{sdoc.get('filename') or sid}: could not open as PDF ({e})",
                )
            try:
                if piece.page_count < 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{sdoc.get('filename') or sid}: PDF has no pages",
                    )
                before = extra.page_count
                extra.insert_pdf(piece)  # bulk — much faster than per-page
                added = extra.page_count - before
                fname = (sdoc.get("filename") or sid).strip() or sid
                inserted_from.append(f"{fname} ({added}p)")
            finally:
                piece.close()

        if extra.page_count < 1:
            raise HTTPException(status_code=400, detail="No pages found in uploaded file(s) or selected documents")

        pages_added = extra.page_count
        expected_total = n_work + pages_added

        # Assemble final PDF with bulk range inserts (fast)
        out = fitz.open()
        if insert_at > 0 and n_work > 0:
            out.insert_pdf(work, from_page=0, to_page=min(insert_at, n_work) - 1)
        out.insert_pdf(extra)
        if n_work > insert_at:
            out.insert_pdf(work, from_page=insert_at, to_page=n_work - 1)
        new_count = out.page_count
        if new_count != expected_total:
            logger.warning(
                "insert count mismatch expected=%s got=%s — accepting fitz count",
                expected_total, new_count,
            )

        new_bytes = _pdf_tobytes_fast(out)
        out.close()
        out = None
        extra.close()
        extra = None
        work.close()
        work = None
    except HTTPException:
        for d in (out, extra, work, src):
            try:
                if d is not None:
                    d.close()
            except Exception:
                pass
        raise
    except Exception as e:
        for d in (out, extra, work, src):
            try:
                if d is not None:
                    d.close()
            except Exception:
                pass
        logger.error(f"insert pages failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to insert pages: {e}")

    _write_pdf_bytes_atomic(path, new_bytes)
    file_size = len(new_bytes)

    note = (
        f"Inserted {pages_added} page(s) {pos} working position {at_index + 1} "
        f"from {', '.join(inserted_from)}; now {new_count} pages"
    )
    with get_db() as db:
        prev = (doc.get("content_text") or "").strip()
        if prev and not prev.startswith("Merged from") and not prev.startswith("Organized") and not prev.startswith("Inserted"):
            content_text = f"{prev}\n{note}" if len(prev) < 4000 else prev
        else:
            content_text = note
        db.execute(
            """UPDATE documents
               SET file_size = ?,
                   content_text = ?,
                   mime_type = COALESCE(NULLIF(mime_type, ''), 'application/pdf'),
                   category = ?
               WHERE id = ? AND tenant_id = ?""",
            (
                file_size,
                (content_text or note)[:5000],
                keep_category,
                doc_id,
                tenant_id,
            ),
        )
        try:
            db.execute("UPDATE documents SET is_merged = 1 WHERE id = ?", (doc_id,))
        except Exception:
            pass
        updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        doc = dict(updated) if updated else doc

    # Lightweight page list — skip blank/dup scan (was multi-second on large packets)
    payload = _build_document_pages_payload(doc_id, doc, analyze="none")
    payload["inserted_pages"] = pages_added
    payload["insert_position"] = pos
    payload["insert_at"] = insert_at
    payload["select_index"] = insert_at  # first newly inserted page
    payload["inserted_from"] = inserted_from
    payload["filename"] = keep_filename or payload.get("filename")
    payload["category"] = keep_category
    payload["saved_in_place"] = True
    elapsed_ms = int((_time.perf_counter() - t0) * 1000)
    payload["insert_ms"] = elapsed_ms
    if elapsed_ms > 2000:
        logger.info(
            "insert doc=%s pages_added=%s total=%s took %sms",
            doc_id[:8], pages_added, new_count, elapsed_ms,
        )
    return payload


class RoaIndexRequest(BaseModel):
    """Build a Record on Appeal index (document name + page numbers)."""
    numbering: str = "continuous"  # continuous | per_volume
    start_page: int = 1
    bates_prefix: str = ""  # if set, also show Bates range columns
    bates_start: int = 1
    include_volume: bool = True
    save_to_case: bool = True
    filename: str = "Record on Appeal — Index"
    instructions: str = ""  # optional free-text instructions for AI title/section formatting


def _pdf_page_count(path: Path) -> int:
    import fitz
    try:
        doc = fitz.open(str(path))
        n = doc.page_count
        doc.close()
        return max(0, int(n))
    except Exception as e:
        logger.warning(f"page count failed for {path}: {e}")
        return 0


def _clean_index_title(filename: str) -> str:
    """Filename → formal index title (ALL CAPS, no extension)."""
    name = (filename or "UNTITLED DOCUMENT").strip()
    for ext in (".pdf", ".PDF", ".docx", ".DOCX", ".doc", ".DOC"):
        if name.endswith(ext):
            name = name[: -len(ext)]
    name = re.sub(r"[_\-]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name.upper() if name else "UNTITLED DOCUMENT"


def _format_page_no(n: int) -> str:
    """Page numbers like 04, 05, 14, 283."""
    if n is None or n < 1:
        return "—"
    return f"{n:02d}" if n < 100 else str(n)


_ROA_INDEX_AI_SYSTEM_PROMPT = """You are formatting a Record on Appeal (ROA) index for a court filing.

You are given an ordered list of document filenames — already arranged by the attorney in the
exact order they must appear — and the attorney's free-text instructions for how to format the
index (titles, section headings/grouping, etc.).

Rules:
- NEVER reorder the documents. Return exactly one entry per input filename, in the same order.
- For each document, write a clean, formal index title: no file extension, no underscores or
  dashes, ALL CAPS, concise.
- Only assign a "section" label (e.g. "MOTIONS", "CORRESPONDENCE") if the attorney's instructions
  ask for section headings or grouping. Documents that share a section must use the identical
  label so they group under one heading. If the instructions don't call for sections, leave
  "section" as an empty string for every document — never invent sections on your own.
- Respond with ONLY a JSON object: {"items": [{"title": "...", "section": "..."}, ...]} — exactly
  one item per filename, in the same order as given. No other text, no markdown fences.
"""


def _ai_customize_roa_index(filenames: List[str], instructions: str) -> Optional[List[dict]]:
    """Use AI to assign index titles/section labels per the attorney's instructions,
    without ever reordering documents. Returns None (caller falls back to plain
    sequential titles with no sections) if there are no instructions or the AI call fails."""
    instructions = (instructions or "").strip()
    if not instructions or not filenames:
        return None

    numbered = "\n".join(f"{i + 1}. {fn}" for i, fn in enumerate(filenames))
    user_msg = f"Documents (fixed order — do not reorder):\n{numbered}\n\nAttorney's instructions:\n{instructions}"

    def _parse(content: str) -> Optional[List[dict]]:
        try:
            data = json.loads(content)
            items = data.get("items")
            if isinstance(items, list) and len(items) == len(filenames):
                return [
                    {
                        "title": (it.get("title") or "").strip() or _clean_index_title(filenames[i]),
                        "section": (it.get("section") or "").strip().upper(),
                    }
                    for i, it in enumerate(items)
                ]
        except Exception:
            pass
        return None

    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model=get_model_for_task("roa_index_instructions"),
                messages=[
                    {"role": "system", "content": _ROA_INDEX_AI_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=4000,
                temperature=0.2,
            )
            result = _parse(response.choices[0].message.content)
            if result:
                return result
        except Exception as e:
            logger.warning(f"OpenAI ROA index instructions failed: {e}")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                system=_ROA_INDEX_AI_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.strip("`")
                if text.lower().startswith("json"):
                    text = text[4:]
            result = _parse(text.strip())
            if result:
                logger.info("Anthropic ROA index instructions succeeded (OpenAI unavailable)")
                return result
        except Exception as e:
            logger.warning(f"Anthropic ROA index instructions also failed: {e}")

    return None


def _build_roa_index_docx(
    case_title: str,
    case_number: str,
    rows: List[dict],
) -> bytes:
    """Formal appellate INDEX as a Word document. Documents are listed in the exact
    order given — never bucketed or reordered. A section heading is inserted only
    when a document's (AI-assigned) section differs from the previous one."""
    import docx
    from docx.shared import Pt, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER

    document = docx.Document()
    section = document.sections[0]
    section.left_margin = section.right_margin = Inches(0.75)
    section.top_margin = section.bottom_margin = Inches(0.75)
    content_width = section.page_width - section.left_margin - section.right_margin

    title_p = document.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run("INDEX")
    run.bold = True
    run.font.size = Pt(16)

    if case_title:
        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(case_title.upper())
        r.bold = True
        r.font.size = Pt(11)
    if case_number:
        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(f"CASE NO. {case_number}")
        r.font.size = Pt(11)

    document.add_paragraph()

    last_section = None
    item_no = 0
    for row in rows:
        sec = (row.get("section") or "").strip()
        if sec and sec != last_section:
            hp = document.add_paragraph()
            hr = hp.add_run(sec)
            hr.bold = True
            hr.font.size = Pt(12)
        last_section = sec or None

        item_no += 1
        title_txt = row.get("index_title") or _clean_index_title(row.get("filename") or "")
        p_start = row.get("page_start")
        page_label = _format_page_no(int(p_start)) if p_start else "—"
        bates_label = row.get("bates_label") or ""

        entry_line = f"{item_no}.  {title_txt}"
        if bates_label:
            entry_line += f"  (Bates {bates_label})"

        p = document.add_paragraph()
        pf = p.paragraph_format
        pf.tab_stops.add_tab_stop(content_width, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        p.add_run(f"{entry_line}\t{page_label}")

    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def _build_roa_index_xlsx(
    case_title: str,
    case_number: str,
    rows: List[dict],
) -> bytes:
    """Formal appellate INDEX as an Excel workbook, one row per document in the
    exact order given — never bucketed or reordered."""
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ROA Index"

    has_sections = any((row.get("section") or "").strip() for row in rows)
    has_bates = any((row.get("bates_label") or "").strip() for row in rows)

    r = 1
    ws.cell(row=r, column=1, value="INDEX").font = Font(bold=True, size=14)
    r += 1
    if case_title:
        ws.cell(row=r, column=1, value=case_title.upper()).font = Font(bold=True, size=11)
        r += 1
    if case_number:
        ws.cell(row=r, column=1, value=f"CASE NO. {case_number}").font = Font(size=11)
        r += 1
    r += 1

    headers = ["Item #"]
    if has_sections:
        headers.append("Section")
    headers.append("Document")
    headers.append("Page")
    if has_bates:
        headers.append("Bates")
    header_row = r
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=col, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E78")
        c.alignment = Alignment(horizontal="center")
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    r += 1

    for i, row in enumerate(rows, start=1):
        col = 1
        ws.cell(row=r, column=col, value=i)
        col += 1
        if has_sections:
            ws.cell(row=r, column=col, value=row.get("section") or "")
            col += 1
        title_txt = row.get("index_title") or _clean_index_title(row.get("filename") or "")
        ws.cell(row=r, column=col, value=title_txt)
        col += 1
        p_start = row.get("page_start")
        ws.cell(row=r, column=col, value=_format_page_no(int(p_start)) if p_start else "—")
        col += 1
        if has_bates:
            ws.cell(row=r, column=col, value=row.get("bates_label") or "")
        r += 1

    col_n = 1
    ws.column_dimensions[get_column_letter(col_n)].width = 8
    col_n += 1
    if has_sections:
        ws.column_dimensions[get_column_letter(col_n)].width = 20
        col_n += 1
    ws.column_dimensions[get_column_letter(col_n)].width = 60
    col_n += 1
    ws.column_dimensions[get_column_letter(col_n)].width = 12
    col_n += 1
    if has_bates:
        ws.column_dimensions[get_column_letter(col_n)].width = 18

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.post("/{case_id}/documents/roa-index")
async def generate_roa_index(
    case_id: str,
    req: RoaIndexRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Build a Record on Appeal Index (Word + Excel) from ordered ROA documents.

    For each volume/document (in the exact order you arranged them): document
    name, start–end page (continuous across the record, or per-volume), and
    optional Bates range. Documents are never reordered or auto-grouped into
    sections — pass `instructions` to have AI assign titles/section headings
    per your guidance while preserving that order. Optionally saves both
    output files into the case Documents list.
    """
    tenant_id = current_user["tenant_id"]
    numbering = (req.numbering or "continuous").strip().lower()
    if numbering not in ("continuous", "per_volume"):
        numbering = "continuous"
    start_page = max(1, int(req.start_page or 1))
    bates_prefix = (req.bates_prefix or "").strip()
    bates_start = max(1, int(req.bates_start or 1))

    with get_db() as db:
        case = db.execute(
            "SELECT id, title, case_number FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id),
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        case = dict(case)

        rows_db = db.execute(
            """SELECT id, filename, file_path, file_size, mime_type, category,
                      exhibit_order, created_at
               FROM documents
               WHERE case_id = ? AND tenant_id = ? AND category = 'record_on_appeal'
               ORDER BY exhibit_order ASC, created_at ASC""",
            (case_id, tenant_id),
        ).fetchall()
        docs = [dict(r) for r in rows_db]

    if not docs:
        raise HTTPException(
            status_code=400,
            detail="No Record on Appeal documents found. Upload and order volumes first.",
        )

    # AI title/section assignment, respecting the attorney's instructions (if any).
    # Always the same length/order as `docs` — documents are never reordered.
    ai_rows = _ai_customize_roa_index(
        [d.get("filename") or "Untitled" for d in docs], req.instructions
    )

    index_rows = []
    continuous_page = start_page
    continuous_bates = bates_start

    for i, d in enumerate(docs):
        path = None
        try:
            path = _resolve_doc_pdf_path(d)
        except HTTPException:
            path = None
        page_count = _pdf_page_count(path) if path else 0
        if page_count <= 0:
            page_count = 0

        if numbering == "per_volume":
            p_start = 1 if page_count else 0
            p_end = page_count
        else:
            p_start = continuous_page if page_count else continuous_page
            p_end = continuous_page + page_count - 1 if page_count else continuous_page - 1
            if page_count:
                continuous_page = p_end + 1

        # Index style: starting page like "04" (sample form)
        if page_count:
            pages_label = _format_page_no(int(p_start))
        else:
            pages_label = "—"

        bates_label = ""
        if bates_prefix and page_count:
            b_start = continuous_bates
            b_end = continuous_bates + page_count - 1
            pad = max(2, len(str(b_end)))
            bates_label = (
                f"{bates_prefix}-{b_start:0{pad}d}"
                if b_start == b_end
                else f"{bates_prefix}-{b_start:0{pad}d}–{b_end:0{pad}d}"
            )
            continuous_bates = b_end + 1

        fname = d.get("filename") or "Untitled"
        if ai_rows:
            index_title = ai_rows[i]["title"]
            row_section = ai_rows[i]["section"]
        else:
            index_title = _clean_index_title(fname)
            row_section = ""
        index_rows.append({
            "id": d["id"],
            "volume": i + 1 if req.include_volume else None,
            "filename": fname,
            "index_title": index_title,
            "section": row_section,
            "page_count": page_count,
            "page_start": p_start if page_count else None,
            "page_end": p_end if page_count else None,
            "pages_label": pages_label,
            "bates_label": bates_label,
        })

    docx_bytes = _build_roa_index_docx(
        case_title=case.get("title") or "",
        case_number=case.get("case_number") or "",
        rows=index_rows,
    )
    xlsx_bytes = _build_roa_index_xlsx(
        case_title=case.get("title") or "",
        case_number=case.get("case_number") or "",
        rows=index_rows,
    )

    base_name = (req.filename or "Record on Appeal — Index").strip() or "Record on Appeal — Index"
    for ext in (".pdf", ".docx", ".xlsx"):
        if base_name.lower().endswith(ext):
            base_name = base_name[: -len(ext)]
    base_name = base_name.strip() or "Record on Appeal — Index"

    outputs = [
        {
            "kind": "docx",
            "display": f"{base_name} (Word).docx",
            "suffix": "roa_index.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "data": docx_bytes,
        },
        {
            "kind": "xlsx",
            "display": f"{base_name} (Excel).xlsx",
            "suffix": "roa_index.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "data": xlsx_bytes,
        },
    ]

    saved_docs = []
    if req.save_to_case:
        upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        with get_db() as db:
            for out in outputs:
                doc_id = generate_id()
                safe_filename = f"{doc_id}_{out['suffix']}"
                file_path = upload_dir / safe_filename
                file_path.write_bytes(out["data"])
                relative_path = f"{tenant_id}/{case_id}/{safe_filename}"
                db.execute(
                    """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
                       category, uploaded_by, content_text, is_merged)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                    (
                        doc_id, case_id, tenant_id, out["display"], relative_path, len(out["data"]),
                        out["mime_type"], "ready", current_user["sub"],
                        f"ROA Index ({out['kind']}) · {len(index_rows)} documents · numbering={numbering}",
                    ),
                )
                row = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
                saved_docs.append(_doc_list_item(row) if row else {"id": doc_id, "filename": out["display"]})

    import base64
    documents_out = []
    for i, out in enumerate(outputs):
        base = dict(saved_docs[i]) if i < len(saved_docs) else {"id": None}
        base["filename"] = out["display"]
        base["mime_type"] = out["mime_type"]
        base["file_base64"] = base64.b64encode(out["data"]).decode("ascii")
        documents_out.append(base)

    return {
        "ok": True,
        "entries": index_rows,
        "total_documents": len(index_rows),
        "total_pages": sum(r["page_count"] for r in index_rows),
        "numbering": numbering,
        "documents": documents_out,
    }


# --------------- Appeal Brief: Cover Page / Table of Contents / AI Table of Authorities ---------------

def _get_doc_pages_text(doc: dict) -> List[str]:
    """Resolve a document's on-disk file to a list of per-page plain text
    strings. Non-PDF files (DOCX/DOC/RTF) are converted to PDF via LibreOffice
    first so page numbers match what the attorney sees when they open the
    file in Word."""
    import fitz
    path = _resolve_doc_pdf_path(doc)
    ext = path.suffix.lower()
    converted: Optional[Path] = None
    try:
        if ext != ".pdf":
            converted = _convert_to_pdf_via_libreoffice(path)
            if not converted:
                raise HTTPException(
                    status_code=422,
                    detail="Could not convert this file to PDF for page-accurate scanning. Please upload a PDF.",
                )
            path = converted
        pdf = fitz.open(str(path))
        pages = [(page.get_text() or "").strip() for page in pdf]
        pdf.close()
        return pages
    finally:
        if converted:
            try:
                converted.unlink(missing_ok=True)
            except Exception:
                pass


def _toa_pages_label(pages: List[int]) -> str:
    """Standard appellate TOA convention: list pages, or 'passim' at 5+."""
    if not pages:
        return "—"
    if len(pages) >= 5:
        return "passim"
    return ", ".join(str(p) for p in pages)


_TOA_AI_SYSTEM_PROMPT = """You are a meticulous appellate law clerk building a Table of Authorities (TOA) for a Brief of Appellant.

You are given the complete text of the brief, broken into pages with markers like "===PAGE 7===". Read the ENTIRE brief and find every legal authority actually cited in the text: case law, constitutional provisions, statutes, regulations, court rules, and other authorities (secondary sources, treatises, etc.).

For each DISTINCT authority (an authority cited multiple times is ONE entry, not several):
- Record its full citation exactly as it should appear in a formal Table of Authorities (standard legal citation form — case name as "Party v. Party", reporter/volume/page or docket info if given, court and year in parentheses when available; statutes/rules by their code section).
- Record every page number (from the ===PAGE N=== markers) on which that authority is cited or discussed, ascending, no duplicates.
- Classify it into exactly one category: cases, constitutional_provisions, statutes, rules, or other_authorities.

Rules:
- Do not invent or guess citations that are not actually in the text.
- Do not include citations to the record on appeal, exhibits, or the parties' own filings — only legal authorities.
- Sort "cases" alphabetically by the first party's name (ignore a leading "The"; for "In re" matters alphabetize by the name that follows "In re" but keep "In re" in the printed citation).
- Sort statutes, rules, and constitutional provisions by their code/section number in ascending order within their category.

Respond with ONLY a JSON object of this exact shape, no markdown fences, no other text:
{"cases": [{"citation": "...", "pages": [1,4,9]}, ...],
 "constitutional_provisions": [{"citation": "...", "pages": [...]}, ...],
 "statutes": [{"citation": "...", "pages": [...]}, ...],
 "rules": [{"citation": "...", "pages": [...]}, ...],
 "other_authorities": [{"citation": "...", "pages": [...]}, ...]}
Include every key even if its list is empty.
"""

_TOA_CATEGORY_KEYS = ("cases", "constitutional_provisions", "statutes", "rules", "other_authorities")


def _ai_generate_toa(pages_text: List[str], model: str) -> dict:
    """Call AI to extract a categorized Table of Authorities with page numbers
    from the given per-page brief text. Tries OpenAI first, then Anthropic."""
    numbered_pages = []
    total_chars = 0
    cap = 300_000
    for i, text in enumerate(pages_text, start=1):
        if not text:
            continue
        chunk = f"===PAGE {i}===\n{text}\n"
        if total_chars + len(chunk) > cap:
            break
        numbered_pages.append(chunk)
        total_chars += len(chunk)
    full_text = "\n".join(numbered_pages)
    user_msg = f"Brief text (by page):\n\n{full_text}"

    def _parse(content: str) -> Optional[dict]:
        try:
            data = json.loads(content)
            if not isinstance(data, dict):
                return None
            out = {}
            for key in _TOA_CATEGORY_KEYS:
                items = data.get(key) or []
                cleaned = []
                for it in items:
                    citation = (it.get("citation") or "").strip()
                    if not citation:
                        continue
                    raw_pages = it.get("pages") or []
                    pages = sorted({int(p) for p in raw_pages if isinstance(p, (int, float))})
                    if not pages:
                        continue
                    cleaned.append({"citation": citation, "pages": pages})
                out[key] = cleaned
            return out
        except Exception:
            return None

    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _TOA_AI_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=8000,
                temperature=0.1,
            )
            result = _parse(response.choices[0].message.content)
            if result:
                return result
        except Exception as e:
            logger.warning(f"OpenAI TOA generation failed: {e}")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=8000,
                system=_TOA_AI_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text.strip()
            if text.startswith("```"):
                text = text.strip("`")
                if text.lower().startswith("json"):
                    text = text[4:]
            result = _parse(text.strip())
            if result:
                logger.info("Anthropic TOA generation succeeded (OpenAI unavailable)")
                return result
        except Exception as e:
            logger.warning(f"Anthropic TOA generation also failed: {e}")

    raise HTTPException(status_code=502, detail="AI Table of Authorities generation failed. Please try again.")


def _new_docx_with_caption(title_text: str, case_title: str, case_number: str):
    import docx
    from docx.shared import Pt, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    document = docx.Document()
    section = document.sections[0]
    section.left_margin = section.right_margin = Inches(0.75)
    section.top_margin = section.bottom_margin = Inches(0.75)

    title_p = document.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run(title_text)
    run.bold = True
    run.font.size = Pt(16)

    if case_title:
        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(case_title.upper())
        r.bold = True
        r.font.size = Pt(11)
    if case_number:
        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(f"CASE NO. {case_number}")
        r.font.size = Pt(11)
    document.add_paragraph()
    return document


def _build_toa_docx(case_title: str, case_number: str, sections: dict) -> bytes:
    """Table of Authorities as a Word document, grouped by category with
    right-aligned page numbers on dot leaders. Authorities cited on 5+ pages
    show 'passim' per standard appellate convention."""
    from docx.shared import Pt
    from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER

    document = _new_docx_with_caption("TABLE OF AUTHORITIES", case_title, case_number)
    content_width = document.sections[0].page_width - document.sections[0].left_margin - document.sections[0].right_margin

    category_order = [
        ("cases", "CASES"),
        ("constitutional_provisions", "CONSTITUTIONAL PROVISIONS"),
        ("statutes", "STATUTES"),
        ("rules", "RULES"),
        ("other_authorities", "OTHER AUTHORITIES"),
    ]
    any_entries = False
    for key, label in category_order:
        entries = sections.get(key) or []
        if not entries:
            continue
        any_entries = True
        hp = document.add_paragraph()
        hr = hp.add_run(label)
        hr.bold = True
        hr.font.size = Pt(12)

        for entry in entries:
            citation = entry["citation"]
            page_label = _toa_pages_label(entry["pages"])
            p = document.add_paragraph()
            pf = p.paragraph_format
            pf.tab_stops.add_tab_stop(content_width, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
            p.add_run(f"{citation}\t{page_label}")
        document.add_paragraph()

    if not any_entries:
        document.add_paragraph().add_run("No authorities were found in the provided brief.").italic = True

    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


_TOC_STANDARD_SECTIONS = [
    "STATEMENT OF JURISDICTION",
    "STATEMENT OF THE ISSUES",
    "STATEMENT OF ISSUES",
    "STATEMENT OF THE CASE",
    "STATEMENT OF FACTS",
    "SUMMARY OF THE ARGUMENT",
    "SUMMARY OF ARGUMENT",
    "STANDARD OF REVIEW",
    "ARGUMENT",
    "CONCLUSION",
    "CERTIFICATE OF COMPLIANCE",
    "CERTIFICATE OF SERVICE",
]


def _find_toc_entries(pages_text: List[str]) -> List[dict]:
    """Scan brief pages for standard appellate section headings and the page
    each first appears on. Only standalone ALL-CAPS heading lines count, to
    avoid false positives from body text that merely mentions a section."""
    seen = set()
    entries = []
    for page_no, text in enumerate(pages_text, start=1):
        if not text:
            continue
        for raw_line in text.split("\n"):
            line = raw_line.strip().strip(".:")
            if not line or len(line) > 60:
                continue
            upper = line.upper()
            if upper != line or not any(c.isalpha() for c in line):
                continue  # must already be upper-case in source (a real heading)
            for heading in _TOC_STANDARD_SECTIONS:
                if upper == heading and heading not in seen:
                    seen.add(heading)
                    entries.append({"heading": heading, "page": page_no})
                    break
    order_index = {h: i for i, h in enumerate(_TOC_STANDARD_SECTIONS)}
    entries.sort(key=lambda e: order_index.get(e["heading"], 999))
    return entries


def _build_toc_docx(case_title: str, case_number: str, entries: List[dict]) -> bytes:
    from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER

    document = _new_docx_with_caption("TABLE OF CONTENTS", case_title, case_number)
    content_width = document.sections[0].page_width - document.sections[0].left_margin - document.sections[0].right_margin
    for entry in entries:
        p = document.add_paragraph()
        pf = p.paragraph_format
        pf.tab_stops.add_tab_stop(content_width, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        p.add_run(f"{entry['heading']}\t{entry['page']}")
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def _build_cover_page_docx(case: dict, attorney_name: str, bar_number: str) -> bytes:
    import docx
    from docx.shared import Pt, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    document = docx.Document()
    section = document.sections[0]
    section.left_margin = section.right_margin = Inches(1.0)
    section.top_margin = Inches(1.5)
    section.bottom_margin = Inches(1.0)

    def centered(text: str, size: int = 12, bold: bool = False, space_after: int = 12):
        p = document.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(space_after)
        r = p.add_run(text)
        r.bold = bold
        r.font.size = Pt(size)
        return p

    court = (case.get("court") or "").strip()
    jurisdiction = (case.get("jurisdiction") or "").strip()
    centered((court or jurisdiction or "IN THE COURT OF APPEALS").upper(), size=14, bold=True, space_after=36)

    case_title = (case.get("title") or "").strip()
    if case_title:
        centered(case_title.upper(), size=12, bold=True, space_after=6)
    case_number = (case.get("case_number") or "").strip()
    if case_number:
        centered(f"Case No. {case_number}", size=12, space_after=36)
    else:
        centered("", size=12, space_after=36)

    centered("BRIEF OF APPELLANT", size=16, bold=True, space_after=48)

    client_name = (case.get("client_name") or "").strip()
    if client_name:
        centered(f"Appellant: {client_name}", size=11, space_after=6)
    opposing_party = (case.get("opposing_party") or "").strip()
    if opposing_party:
        centered(f"Appellee: {opposing_party}", size=11, space_after=36)

    if attorney_name:
        centered(attorney_name, size=11, bold=True, space_after=2)
    if bar_number:
        centered(f"Bar No. {bar_number}", size=11, space_after=2)
    centered("Attorney for Appellant", size=11, space_after=0)

    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


class GenerateBriefPartRequest(BaseModel):
    """Save the generated Cover Page / Table of Contents into the case Documents list."""
    save_to_case: bool = True
    filename: str = ""


def _save_appeal_brief_output(
    case_id: str, tenant_id: str, uploaded_by: str,
    docx_bytes: bytes, display: str, note: str,
) -> Optional[dict]:
    new_doc_id = generate_id()
    upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{new_doc_id}_appeal_brief.docx"
    file_path = upload_dir / safe_filename
    file_path.write_bytes(docx_bytes)
    relative_path = f"{tenant_id}/{case_id}/{safe_filename}"
    with get_db() as db:
        next_order = db.execute(
            "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = 'appeal_brief'",
            (case_id,),
        ).fetchone()["n"]
        db.execute(
            """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
               category, uploaded_by, content_text, exhibit_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_doc_id, case_id, tenant_id, display, relative_path, len(docx_bytes),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "appeal_brief", uploaded_by, note, next_order,
            ),
        )
        row = db.execute("SELECT * FROM documents WHERE id = ?", (new_doc_id,)).fetchone()
        return _doc_list_item(row) if row else {"id": new_doc_id, "filename": display}


def _load_case_and_brief_doc(case_id: str, doc_id: str, tenant_id: str) -> tuple[dict, dict]:
    with get_db() as db:
        case = db.execute(
            "SELECT id, title, case_number, court, client_name, opposing_party, jurisdiction FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id),
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (doc_id, case_id, tenant_id),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Brief draft document not found")
        return dict(case), dict(doc)


@router.post("/{case_id}/documents/generate-cover-page")
async def generate_appeal_brief_cover_page(
    case_id: str,
    req: GenerateBriefPartRequest,
    current_user: dict = Depends(get_current_user),
):
    """Build a formal appellate brief cover page from the case's caption data.
    Deterministic — no AI, no credits used."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute(
            "SELECT id, title, case_number, court, client_name, opposing_party, jurisdiction FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id),
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        case = dict(case)
        urow = db.execute(
            "SELECT full_name, bar_number FROM users WHERE id = ?", (current_user["sub"],)
        ).fetchone()
        attorney_name = (urow["full_name"] if urow else "") or current_user.get("email") or ""
        bar_number = (urow["bar_number"] if urow else "") or ""

    docx_bytes = _build_cover_page_docx(case, attorney_name, bar_number)

    saved_doc = None
    if req.save_to_case:
        display = (req.filename or "Cover Page").strip() or "Cover Page"
        if not display.lower().endswith(".docx"):
            display += ".docx"
        saved_doc = _save_appeal_brief_output(
            case_id, tenant_id, current_user["sub"], docx_bytes, display, "AI Appeal Brief · Cover Page"
        )

    import base64
    return {
        "ok": True,
        "document": saved_doc,
        "file_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "filename": (req.filename or "Cover Page").strip() + ("" if (req.filename or "").lower().endswith(".docx") else ".docx"),
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }


@router.post("/{case_id}/documents/{doc_id}/generate-toc")
async def generate_appeal_brief_toc(
    case_id: str,
    doc_id: str,
    req: GenerateBriefPartRequest,
    current_user: dict = Depends(get_current_user),
):
    """Build a Table of Contents by scanning the brief draft for standard
    appellate section headings and the page each starts on. Deterministic —
    no AI, no credits used."""
    tenant_id = current_user["tenant_id"]
    case, doc = _load_case_and_brief_doc(case_id, doc_id, tenant_id)

    ext = Path(doc.get("filename") or "").suffix.lower()
    if ext not in (".pdf", ".docx", ".doc"):
        raise HTTPException(status_code=400, detail="Upload your brief draft as a PDF or Word document first.")

    pages_text = _get_doc_pages_text(doc)
    entries = _find_toc_entries(pages_text)
    if not entries:
        raise HTTPException(
            status_code=422,
            detail="No standard brief section headings were found. Make sure headings (e.g. ARGUMENT, CONCLUSION) are in ALL CAPS on their own line.",
        )

    docx_bytes = _build_toc_docx(case.get("title") or "", case.get("case_number") or "", entries)

    saved_doc = None
    if req.save_to_case:
        display = (req.filename or "Table of Contents").strip() or "Table of Contents"
        if not display.lower().endswith(".docx"):
            display += ".docx"
        saved_doc = _save_appeal_brief_output(
            case_id, tenant_id, current_user["sub"], docx_bytes, display,
            f"AI Appeal Brief · Table of Contents · {len(entries)} sections",
        )

    import base64
    return {
        "ok": True,
        "entries": entries,
        "document": saved_doc,
        "file_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "filename": (req.filename or "Table of Contents").strip() + ("" if (req.filename or "").lower().endswith(".docx") else ".docx"),
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }


class GenerateToaRequest(BaseModel):
    """Generate a Table of Authorities from a complete Appeal Brief draft."""
    save_to_case: bool = True
    filename: str = "Table of Authorities"


@router.post("/{case_id}/documents/{doc_id}/generate-toa")
async def generate_table_of_authorities(
    case_id: str,
    doc_id: str,
    req: GenerateToaRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Generate a Table of Authorities (Word document) from a complete Brief of
    Appellant draft. AI reads the entire brief, finds every case, statute,
    rule, constitutional provision, and other authority actually cited, and
    records every page it appears on (using "passim" for authorities cited
    on 5+ pages, per standard appellate convention).
    """
    tenant_id = current_user["tenant_id"]
    case, doc = _load_case_and_brief_doc(case_id, doc_id, tenant_id)

    ext = Path(doc.get("filename") or "").suffix.lower()
    if ext not in (".pdf", ".docx", ".doc"):
        raise HTTPException(
            status_code=400,
            detail="Upload your complete brief draft as a PDF or Word document to generate a Table of Authorities.",
        )

    pages_text = _get_doc_pages_text(doc)
    if not any((p or "").strip() for p in pages_text):
        raise HTTPException(
            status_code=422,
            detail="Could not read any text from this brief draft (it may be a scanned image). Upload a text-based PDF or Word document.",
        )

    with get_db() as db:
        model, credit_cost = credit_gate(current_user["sub"], "table_of_authorities", db)
        sub_row = db.execute(
            "SELECT subscription_status FROM users WHERE id = ?", (current_user["sub"],)
        ).fetchone()
        sub_status = sub_row["subscription_status"] if sub_row else "active"

    toa = _ai_generate_toa(pages_text, model)

    total_entries = sum(len(toa.get(k) or []) for k in _TOA_CATEGORY_KEYS)
    if total_entries == 0:
        raise HTTPException(
            status_code=422,
            detail="No legal authorities were found in this brief draft. Nothing to build a Table of Authorities from.",
        )

    try:
        with get_db() as db:
            deduct_credits(current_user["sub"], sub_status, credit_cost, "table_of_authorities", db)
    except Exception as e:
        logger.warning(f"credit deduct after table_of_authorities failed: {e}")

    docx_bytes = _build_toa_docx(
        case_title=case.get("title") or "",
        case_number=case.get("case_number") or "",
        sections=toa,
    )

    saved_doc = None
    if req.save_to_case:
        display = (req.filename or "Table of Authorities").strip() or "Table of Authorities"
        if not display.lower().endswith(".docx"):
            display += ".docx"
        saved_doc = _save_appeal_brief_output(
            case_id, tenant_id, current_user["sub"], docx_bytes, display,
            f"AI-generated Table of Authorities · {total_entries} authorities",
        )

    import base64
    return {
        "ok": True,
        "sections": toa,
        "total_entries": total_entries,
        "document": saved_doc,
        "file_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "filename": (req.filename or "Table of Authorities").strip() + ("" if (req.filename or "").lower().endswith(".docx") else ".docx"),
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }


@router.post("/documents/{doc_id}/replace-file")
async def replace_document_file(
    doc_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Replace the physical file for an existing document record.
    Re-runs exhibit AI processing if the document is evidence."""
    tenant_id = current_user["tenant_id"]

    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, tenant_id)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        doc_dict = dict(doc)

    # For exhibits that already have a nice AI-generated filename, preserve it
    upload_filename = file.filename or doc_dict["filename"]
    ext = Path(upload_filename).suffix.lower()
    filename = doc_dict["filename"] if doc_dict.get("exhibit_label") else upload_filename
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed")

    file_bytes = await file.read()
    file_size = len(file_bytes)
    if file_size == 0:
        raise HTTPException(status_code=400, detail="File is empty")
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")

    mime_type = file.content_type or "application/octet-stream"
    case_id = doc_dict["case_id"]
    old_path = doc_dict.get("file_path") or ""

    # Reuse path if it's the new-format relative path, otherwise allocate a fresh one
    if old_path and not old_path.startswith("tenants/"):
        file_path = Path(UPLOAD_BASE_DIR) / old_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(file_bytes)
        relative_path = old_path
    else:
        safe_filename = f"{doc_id}_{filename}"
        upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        file_path = upload_dir / safe_filename
        file_path.write_bytes(file_bytes)
        relative_path = f"{tenant_id}/{case_id}/{safe_filename}"

    with get_db() as db:
        db.execute(
            "UPDATE documents SET filename = ?, file_path = ?, file_size = ?, mime_type = ? WHERE id = ?",
            (filename, relative_path, file_size, mime_type, doc_id)
        )
        updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        updated_dict = dict(updated)

    # Background processing for evidence documents
    if doc_dict.get("category") == "evidence":
        if doc_dict.get("exhibit_label"):
            # Existing exhibit: preserve the label/name, just re-stamp with the new file
            background_tasks.add_task(
                _restamp_existing_exhibit, doc_id, case_id, tenant_id,
                file_bytes, filename, ext, file_path,
                doc_dict["exhibit_label"], doc_dict.get("exhibit_name") or ""
            )
        else:
            # No label yet: run full AI processing to assign one
            background_tasks.add_task(
                _process_exhibit_async, doc_id, case_id, tenant_id,
                file_bytes, filename, ext, file_path, relative_path, "evidence"
            )
            updated_dict["exhibit_processing"] = True

    return updated_dict


@router.patch("/documents/{doc_id}/category")
async def update_document_category(
    doc_id: str,
    req: DocumentCategoryUpdate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Update a document's category. If changed TO 'evidence', triggers exhibit AI processing."""
    valid_categories = {'general', 'evidence', 'petition', 'correspondence', 'court_filing', 'ready', 'record_on_appeal', 'immigration_packet', 'appeal_brief'}
    cat = (req.category or "").strip().lower()
    if cat not in valid_categories:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {', '.join(sorted(valid_categories))}")

    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        old_category = doc["category"] or ""
        # Assign next order when moving into ordered sections so it slots into the section
        ordered_cats = ("record_on_appeal", "immigration_packet", "appeal_brief")
        if cat in ordered_cats and old_category != cat:
            next_order = db.execute(
                "SELECT COALESCE(MAX(exhibit_order), -1) + 1 AS n FROM documents WHERE case_id = ? AND category = ?",
                (doc["case_id"], cat)
            ).fetchone()["n"]
            db.execute(
                "UPDATE documents SET category = ?, exhibit_order = ? WHERE id = ?",
                (cat, next_order, doc_id)
            )
        else:
            db.execute("UPDATE documents SET category = ? WHERE id = ?", (cat, doc_id))
        updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        updated_dict = dict(updated)

    # If category changed TO evidence and the document has no exhibit_label yet, trigger AI processing
    if cat == "evidence" and old_category != "evidence" and not updated_dict.get("exhibit_label"):
        fp = Path(UPLOAD_BASE_DIR) / updated_dict["file_path"]
        if fp.exists():
            file_bytes = fp.read_bytes()
            ext = Path(updated_dict["file_path"]).suffix.lower()
            background_tasks.add_task(
                _process_exhibit_async, doc_id, updated_dict["case_id"], updated_dict["tenant_id"],
                file_bytes, updated_dict["filename"], ext, fp, updated_dict["file_path"],
                "evidence"
            )
            updated_dict["exhibit_processing"] = True

    return updated_dict


# --------------- Document merge endpoint ---------------

@router.post("/{case_id}/documents/merge")
async def merge_documents(
    case_id: str,
    req: DocumentMergeRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Merge documents into a single PDF. Supports ALL file types.
    If merge_all=true, merges every document in the case. Otherwise merges doc_ids (1+)."""
    tenant_id = current_user["tenant_id"]

    with get_db() as db:
        # Verify case
        case = db.execute(
            "SELECT id FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        if req.merge_all:
            # Merge ALL documents in the case. Each merge is an independent job over
            # the source documents — exclude prior merge output so re-running it
            # doesn't keep doubling up the same pages.
            rows = db.execute(
                "SELECT * FROM documents WHERE case_id = ? AND tenant_id = ? AND (is_merged IS NULL OR is_merged = 0) "
                "ORDER BY exhibit_order ASC, created_at ASC",
                (case_id, tenant_id)
            ).fetchall()
            if not rows:
                raise HTTPException(status_code=400, detail="No documents in this case to merge")
            docs = [dict(r) for r in rows]
            docs = _filter_reuploaded_merge_duplicates(db, case_id, tenant_id, docs)
            if not docs:
                raise HTTPException(status_code=400, detail="No documents in this case to merge")
            # Sort: court_filing, petition, ROA / Immigration Packet (user order), exhibits, other
            def _merge_sort_key(d):
                label = d.get('exhibit_label') or ''
                cat = d.get('category', '')
                if cat == 'court_filing':
                    return (0, '', d.get('created_at', ''))
                elif cat == 'petition':
                    return (1, '', d.get('created_at', ''))
                elif cat == 'record_on_appeal':
                    order = d.get('exhibit_order')
                    order_key = f"{order:06d}" if order is not None else '999999'
                    return (2, order_key, d.get('created_at', ''))
                elif cat == 'immigration_packet':
                    order = d.get('exhibit_order')
                    order_key = f"{order:06d}" if order is not None else '999999'
                    return (3, order_key, d.get('created_at', ''))
                elif cat == 'evidence' and label:
                    return (4, label, d.get('created_at', ''))
                elif cat == 'evidence':
                    return (4, 'ZZZZ', d.get('created_at', ''))
                else:
                    return (5, '', d.get('created_at', ''))
            docs.sort(key=_merge_sort_key)
        else:
            if len(req.doc_ids) < 1:
                raise HTTPException(status_code=400, detail="Select at least 1 document to merge")
            # Fetch docs in the order requested
            docs = []
            for did in req.doc_ids:
                doc = db.execute(
                    "SELECT * FROM documents WHERE id = ? AND case_id = ? AND tenant_id = ?",
                    (did, case_id, tenant_id)
                ).fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail=f"Document {did} not found")
                docs.append(dict(doc))

    # Merge all file types using shared helper — preserves color/layout via insert_pdf / LO.
    # Runs in a separate process (see _PDF_MERGE_POOL) so a large/slow merge can never
    # starve this worker's event loop or get it killed by uvicorn's health check.
    file_items = []
    for doc in docs:
        if not doc.get("file_path"):
            continue
        rel = doc["file_path"]
        fp = Path(UPLOAD_BASE_DIR) / rel
        if not fp.exists():
            # Legacy absolute or alternate relative paths
            alt = Path(rel)
            if alt.is_absolute() and alt.exists():
                fp = alt
            else:
                logger.warning(f"Merge skip missing file: {rel}")
                continue
        file_items.append((str(fp), doc.get("filename", "") or doc.get("exhibit_name", "")))

    loop = asyncio.get_event_loop()
    merged_bytes = await loop.run_in_executor(
        _get_pdf_merge_pool(),
        _merge_file_list_to_pdf_bytes,
        file_items,
        req.bates_prefix or "",
        req.bates_start or 1,
        getattr(req, "bates_position", None) or "center",
    )
    if not merged_bytes:
        raise HTTPException(
            status_code=400,
            detail="No mergeable content found. Prefer PDF originals; Office files need LibreOffice conversion.",
        )

    doc_id = generate_id()
    upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{doc_id}_merged.pdf"
    file_path = upload_dir / safe_filename
    file_path.write_bytes(merged_bytes)
    relative_path = f"{tenant_id}/{case_id}/{safe_filename}"

    merged_count = len(docs)
    display_name = (req.filename or "Merged Document").strip()
    if not display_name.lower().endswith(".pdf"):
        display_name += ".pdf"

    bates_note = ""
    if req.bates_prefix:
        pos = (req.bates_position or "center").strip().lower()
        bates_note = f" | Bates: {req.bates_prefix}-{req.bates_start:02d}+ ({pos})"

    with get_db() as db:
        db.execute(
            """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
               category, uploaded_by, content_text, is_merged)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (doc_id, case_id, tenant_id, display_name, relative_path, len(merged_bytes),
             "application/pdf", req.category, current_user["sub"],
             f"Merged from {merged_count} documents" + bates_note)
        )

    # Skip AI renaming for merged documents — user already chose the name.
    # Only run exhibit processing if this is NOT a merge (individual uploads).
    # Merged documents keep their user-chosen display_name as-is.

    return {
        "id": doc_id,
        "case_id": case_id,
        "filename": display_name,
        "file_size": len(merged_bytes),
        "category": req.category,
        "merged_from": [d["id"] for d in docs],
        "merged_count": merged_count,
        "bates_applied": bool(req.bates_prefix),
        "exhibit_processing": req.category == "evidence",
    }


@router.post("/{case_id}/documents/{doc_id}/bates")
async def apply_bates_to_document(
    case_id: str,
    doc_id: str,
    req: SingleDocumentBatesRequest,
    current_user: dict = Depends(get_current_user),
):
    """Stamp Bates numbers onto a single uploaded document — no merge required.
    Any supported file type (PDF, image, Office doc) is converted to PDF the same
    way merge does. Saves the stamped result as a new document; the original is
    left untouched. Runs on the same offloaded merge pool as /documents/merge so a
    slow conversion can never block this worker's health check."""
    tenant_id = current_user["tenant_id"]
    prefix = (req.bates_prefix or "").strip()
    if not prefix:
        raise HTTPException(status_code=400, detail="Bates prefix is required")

    with get_db() as db:
        case = db.execute(
            "SELECT id FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (doc_id, case_id, tenant_id)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        doc = dict(doc)

    fp = _resolve_doc_pdf_path(doc)
    label = doc.get("filename", "") or doc.get("exhibit_name", "")

    loop = asyncio.get_event_loop()
    stamped_bytes = await loop.run_in_executor(
        _get_pdf_merge_pool(),
        _merge_file_list_to_pdf_bytes,
        [(str(fp), label)],
        prefix,
        req.bates_start or 1,
        req.bates_position or "center",
    )
    if not stamped_bytes:
        raise HTTPException(status_code=400, detail="Could not convert this document to a stampable PDF")

    new_doc_id = generate_id()
    upload_dir = Path(UPLOAD_BASE_DIR) / tenant_id / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{new_doc_id}_bates.pdf"
    file_path = upload_dir / safe_filename
    file_path.write_bytes(stamped_bytes)
    relative_path = f"{tenant_id}/{case_id}/{safe_filename}"

    orig_stem = Path(doc.get("filename") or "Document").stem
    display_name = f"{orig_stem} (Bates {prefix}).pdf"

    with get_db() as db:
        db.execute(
            """INSERT INTO documents (id, case_id, tenant_id, filename, file_path, file_size, mime_type,
               category, uploaded_by, content_text, is_merged)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                new_doc_id, case_id, tenant_id, display_name, relative_path, len(stamped_bytes),
                "application/pdf", doc.get("category") or "evidence", current_user["sub"],
                f"Bates stamped from {doc.get('filename')} | Bates: {prefix}-{req.bates_start or 1:02d}+ "
                f"({req.bates_position or 'center'})",
            ),
        )
        row = db.execute("SELECT * FROM documents WHERE id = ?", (new_doc_id,)).fetchone()
        saved_doc = _doc_list_item(row) if row else {"id": new_doc_id, "filename": display_name}

    import base64
    return {
        "ok": True,
        "document": saved_doc,
        "file_base64": base64.b64encode(stamped_bytes).decode("ascii"),
        "mime_type": "application/pdf",
        "filename": display_name,
        "bates_applied": True,
    }


# --------------- Exhibit management endpoints ---------------

@router.patch("/documents/{doc_id}/exhibit")
async def update_exhibit(
    doc_id: str,
    req: ExhibitUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Manually update exhibit name or label for a document."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        updates = {}
        if req.exhibit_name is not None:
            updates["exhibit_name"] = req.exhibit_name
        if req.exhibit_label is not None:
            updates["exhibit_label"] = req.exhibit_label

        if not updates:
            return dict(doc)

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [doc_id]
        db.execute(f"UPDATE documents SET {set_clause} WHERE id = ?", values)

        # If label or name changed, update filename and re-stamp PDF
        if req.exhibit_label is not None or req.exhibit_name is not None:
            updated_doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            updated_doc = dict(updated_doc)
            label = updated_doc.get("exhibit_label", "")
            name = updated_doc.get("exhibit_name", "")
            # Determine extension from file_path
            ext = Path(updated_doc.get("file_path", "")).suffix.lower() if updated_doc.get("file_path") else ".pdf"
            new_filename = f"Exhibit {label} — {name}{ext}"
            db.execute("UPDATE documents SET filename = ? WHERE id = ?", (new_filename, doc_id))

            if updated_doc.get("file_path") and updated_doc.get("mime_type", "").startswith("application/pdf"):
                try:
                    fp = Path(UPLOAD_BASE_DIR) / updated_doc["file_path"]
                    if fp.exists():
                        original_bytes = fp.read_bytes()
                        stamped = _stamp_exhibit_on_pdf(original_bytes, label, name)
                        fp.write_bytes(stamped)
                except Exception as e:
                    logger.warning(f"Re-stamp failed: {e}")

        updated = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(updated)


@router.post("/{case_id}/documents/reorder")
async def reorder_exhibits(
    case_id: str,
    req: ExhibitReorderRequest,
    current_user: dict = Depends(get_current_user)
):
    """Reorder exhibits for a case. Reassigns labels based on the case numbering scheme."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        # Verify case and get numbering scheme
        case = db.execute(
            "SELECT id, exhibit_numbering FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        numbering = (case["exhibit_numbering"] or "letters") if case else "letters"
        if numbering not in EXHIBIT_SCHEMES:
            numbering = "letters"

        # Sort items by requested order
        sorted_items = sorted(req.items, key=lambda x: x.order)

        for i, item in enumerate(sorted_items):
            new_label = _make_exhibit_label(i, numbering)
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (item.doc_id,)).fetchone()
            exhibit_name = doc["exhibit_name"] if doc else ""
            ext = Path(doc["file_path"]).suffix.lower() if doc and doc.get("file_path") else ".pdf"
            new_filename = _exhibit_filename(new_label, exhibit_name, ext, numbering)

            db.execute(
                "UPDATE documents SET exhibit_order = ?, exhibit_label = ?, filename = ? WHERE id = ? AND case_id = ?",
                (i, new_label, new_filename, item.doc_id, case_id)
            )

            # Re-stamp PDFs with new label
            if doc and doc["file_path"] and (doc.get("mime_type") or "").startswith("application/pdf"):
                try:
                    fp = Path(UPLOAD_BASE_DIR) / doc["file_path"]
                    if fp.exists():
                        original_bytes = fp.read_bytes()
                        stamped = _stamp_exhibit_on_pdf(
                            original_bytes, new_label, exhibit_name
                        )
                        fp.write_bytes(stamped)
                except Exception as e:
                    logger.warning(f"Re-stamp on reorder failed for {item.doc_id}: {e}")

        # Return updated documents (metadata only)
        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? ORDER BY exhibit_order ASC, created_at ASC",
            (case_id,)
        ).fetchall()
        return [_doc_list_item(d) for d in docs]


class CategoryReorderRequest(BaseModel):
    """Reorder documents within a non-exhibit category (e.g. record_on_appeal, immigration_packet)."""
    category: str
    items: List[ExhibitReorderItem]


@router.post("/{case_id}/documents/reorder-by-category")
async def reorder_documents_by_category(
    case_id: str,
    req: CategoryReorderRequest,
    current_user: dict = Depends(get_current_user)
):
    """Reorder documents within a category. Updates exhibit_order only (no exhibit labels/stamps)."""
    tenant_id = current_user["tenant_id"]
    category = (req.category or "").strip().lower()
    # Evidence uses the dedicated exhibit reorder endpoint (relabels A/B/C)
    reorderable = {'record_on_appeal', 'immigration_packet', 'appeal_brief', 'general', 'petition', 'correspondence', 'court_filing', 'ready'}
    if category not in reorderable:
        raise HTTPException(
            status_code=400,
            detail=f"Category '{category}' is not reorderable here. Use exhibit reorder for evidence."
        )
    if not req.items:
        raise HTTPException(status_code=400, detail="No items to reorder")

    with get_db() as db:
        case = db.execute(
            "SELECT id FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        sorted_items = sorted(req.items, key=lambda x: x.order)
        for i, item in enumerate(sorted_items):
            db.execute(
                """UPDATE documents SET exhibit_order = ?
                   WHERE id = ? AND case_id = ? AND tenant_id = ? AND category = ?""",
                (i, item.doc_id, case_id, tenant_id, category)
            )

        docs = db.execute(
            "SELECT * FROM documents WHERE case_id = ? ORDER BY exhibit_order ASC, created_at ASC",
            (case_id,)
        ).fetchall()
        return [_doc_list_item(d) for d in docs]


# ── Record on Appeal / vault: duplicate content detection ─────────────────────

class FindDuplicatesRequest(BaseModel):
    """Scan documents for duplicate content.

    category: specific bucket (record_on_appeal, evidence, general, …)
              or "all" to scan every document on the case.
    """
    category: str = "all"
    use_ai: bool = True


def _normalize_compare_text(text: str) -> str:
    """Collapse whitespace and lowercase for stable content comparison."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def _extract_any_file_text(
    file_bytes: bytes,
    filename: str,
    mime_type: str = "",
) -> str:
    """
    Best-effort text extraction for any file type used in cases:
    PDF (native + OCR), DOCX, plain text, images (AI OCR), spreadsheets.
    """
    ext = Path(filename or "").suffix.lower()
    mime = (mime_type or "").lower()

    # Images — full AI OCR
    image_exts = {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
        ".tiff", ".tif", ".heic", ".heif",
    }
    if ext in image_exts or mime.startswith("image/"):
        return _ocr_image_full_text(file_bytes, filename or "image.png", mime or "image/png")

    if ext == ".pdf" or mime == "application/pdf":
        # Duplicate scan + vault reads: always OCR scanned/image PDFs
        return _extract_text_from_pdf(file_bytes, ocr_fallback=True)

    if ext in (".docx", ".doc"):
        return _extract_text_from_docx(file_bytes)

    if ext in (".txt", ".md", ".csv", ".tsv", ".rtf", ".log", ".json", ".xml", ".html", ".htm"):
        try:
            return file_bytes.decode("utf-8", errors="ignore")[:500_000]
        except Exception:
            return file_bytes.decode("latin-1", errors="ignore")[:500_000]

    if ext in (".xlsx", ".xls", ".ods"):
        try:
            from app.services.document_processor import extract_text_from_bytes
            return extract_text_from_bytes(file_bytes, filename or f"sheet{ext}")
        except Exception as e:
            logger.warning(f"Spreadsheet extract failed: {e}")
            return ""

    # Unknown type: try UTF-8, then document_processor catch-all
    try:
        trial = file_bytes.decode("utf-8", errors="strict")
        if trial.strip() and sum(1 for c in trial[:400] if c.isprintable() or c in "\n\r\t") > 280:
            return trial[:500_000]
    except Exception:
        pass
    try:
        from app.services.document_processor import extract_text_from_bytes
        t = extract_text_from_bytes(file_bytes, filename or "file.bin")
        if t and not t.startswith("[File uploaded:") and not t.startswith("[Could not"):
            return t
    except Exception as e:
        logger.warning(f"document_processor extract failed: {e}")
    return ""


def _resolve_document_text(doc: dict, persist: bool = True) -> str:
    """
    Prefer stored content_text; fall back to on-disk extraction + AI OCR for
    images and scanned PDFs. Optionally persist OCR text back to the DB so
    future scans do not re-OCR the same file.
    """
    text = (doc.get("content_text") or "").strip()
    # Skip short notes / placeholders that are not real body text
    placeholder = (
        not text
        or len(text) < 80
        or text.startswith("[File uploaded:")
        or text.startswith("[Could not extract")
        or text.startswith("[Cannot process")
        or text.startswith("[OCR failed")
    )

    if not placeholder:
        return text

    file_path_str = doc.get("file_path") or ""
    if not file_path_str:
        return text

    path = Path(UPLOAD_BASE_DIR) / file_path_str
    if not path.exists() and file_path_str.startswith("/"):
        path = Path(file_path_str)
    if not path.exists():
        return text

    try:
        file_bytes = path.read_bytes()
        filename = doc.get("filename") or path.name
        mime = doc.get("mime_type") or ""
        extracted = _extract_any_file_text(file_bytes, filename, mime)
        extracted = (extracted or "").strip()
        # Prefer longer real extraction over notes/placeholder
        if extracted and len(extracted) > len(text):
            # Cache OCR/extracted text for next time
            if persist and doc.get("id") and len(extracted) >= 40:
                try:
                    with get_db() as db:
                        db.execute(
                            "UPDATE documents SET content_text = ? WHERE id = ?",
                            (extracted[:500_000], doc["id"]),
                        )
                except Exception as e:
                    logger.warning(f"Persist OCR text failed for {doc.get('id')}: {e}")
            return extracted
    except Exception as e:
        logger.warning(f"Text resolve failed for doc {doc.get('id')}: {e}")
    return text


def _text_similarity(a: str, b: str, sample: int = 24_000) -> float:
    """Ratio in [0,1] on a capped sample so large ROA volumes stay fast."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # Substring / containment (common when one volume is a partial re-upload)
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 200 and shorter in longer:
        return 0.97
    sa, sb = a[:sample], b[:sample]
    return SequenceMatcher(None, sa, sb).ratio()


def _union_find_groups(ids: List[str], pairs: List[tuple]) -> List[List[str]]:
    """Cluster document ids from undirected pairs (union-find)."""
    parent = {i: i for i in ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a, b in pairs:
        if a in parent and b in parent:
            union(a, b)

    clusters: dict = {}
    for i in ids:
        root = find(i)
        clusters.setdefault(root, []).append(i)
    return [members for members in clusters.values() if len(members) > 1]


def _ai_confirm_duplicate_groups(
    model: str,
    candidates: List[dict],
) -> dict:
    """
    Ask the model to confirm/refine near-duplicate groups and write short reasons.
    candidates: list of {ids, filenames, similarity, excerpts}
    Returns { groups: [{document_ids, match_type, reason, confidence}], summary }
    """
    if not candidates:
        return {"groups": [], "summary": ""}

    lines = []
    for i, c in enumerate(candidates, 1):
        lines.append(
            f"CANDIDATE {i}:\n"
            f"  ids: {', '.join(c['ids'])}\n"
            f"  files: {', '.join(c['filenames'])}\n"
            f"  heuristic_similarity: {c['similarity']:.3f}\n"
            f"  sizes_chars: {c.get('sizes')}\n"
            f"  excerpts:\n{c.get('excerpts', '')}\n"
        )
    user_msg = (
        "You are reviewing Record on Appeal documents for DUPLICATE or NEAR-DUPLICATE content.\n"
        "Heuristic pairing already found the candidates below. Confirm or reject each group.\n\n"
        + "\n".join(lines)
        + "\n\nReturn ONLY valid JSON (no markdown) with this shape:\n"
        '{\n'
        '  "groups": [\n'
        '    {\n'
        '      "document_ids": ["id1","id2"],\n'
        '      "match_type": "exact" | "near_duplicate" | "possible" | "not_duplicate",\n'
        '      "reason": "one short sentence for the attorney",\n'
        '      "confidence": 0.0\n'
        '    }\n'
        '  ],\n'
        '  "summary": "one or two sentences overall"\n'
        '}\n'
        "Rules: mark not_duplicate if different filings that merely share form language; "
        "near_duplicate if same instrument with minor OCR/formatting differences or one is a partial copy; "
        "exact if substantive content is the same document. Only include document_ids from the candidates."
    )
    system_msg = (
        "You are a careful appellate paralegal. Detect true content duplicates in a Record on Appeal, "
        "not merely similar document titles. Respond with JSON only."
    )

    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model=model or get_model_for_task("duplicate_detection"),
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=2000,
                temperature=0.1,
            )
            raw = (resp.choices[0].message.content or "").strip()
            raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
            raw = re.sub(r"\n?```\s*$", "", raw)
            return json.loads(raw)
        except Exception as e:
            logger.warning(f"AI duplicate confirm (OpenAI) failed: {e}")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic as _anthropic
            client = _anthropic.Anthropic(api_key=anthropic_key)
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2000,
                system=system_msg,
                messages=[{"role": "user", "content": user_msg}],
            )
            raw = (resp.content[0].text or "").strip()
            raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
            raw = re.sub(r"\n?```\s*$", "", raw)
            return json.loads(raw)
        except Exception as e:
            logger.warning(f"AI duplicate confirm (Anthropic) failed: {e}")

    return {"groups": [], "summary": ""}


def _dup_doc_payload(by_id: dict, vol_by_id: dict, doc_id: str, labels: dict = None) -> dict:
    """Serialize one document row for a duplicate-group response."""
    p = by_id[doc_id]
    return {
        "id": doc_id,
        "filename": p["filename"],
        "file_size": p["file_size"],
        "exhibit_order": p["exhibit_order"],
        "exhibit_label": p.get("exhibit_label"),
        "category": p.get("category") or "general",
        "volume": vol_by_id.get(doc_id),
        "label": (labels or {}).get(doc_id) or p.get("label"),
        "created_at": p["created_at"],
        "char_count": p["raw_len"],
    }


def _load_docs_for_dup_scan(case_id: str, tenant_id: str, category: str) -> List[dict]:
    """Load ordered document rows for a duplicate scan scope."""
    # Include optional resolution columns when present (migrated deployments)
    cols = (
        "id, filename, file_path, file_size, mime_type, category, "
        "exhibit_order, exhibit_label, content_text, created_at, "
        "COALESCE(dup_not_duplicate, 0) AS dup_not_duplicate, dup_resolved_at"
    )
    with get_db() as db:
        case = db.execute(
            "SELECT id FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id),
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # Fallback if migration not yet applied
        try:
            db.execute("SELECT dup_not_duplicate FROM documents LIMIT 1").fetchone()
        except Exception:
            cols = (
                "id, filename, file_path, file_size, mime_type, category, "
                "exhibit_order, exhibit_label, content_text, created_at"
            )

        if category == "all":
            rows = db.execute(
                f"""SELECT {cols}
                   FROM documents
                   WHERE case_id = ? AND tenant_id = ?
                   ORDER BY
                     CASE category
                       WHEN 'evidence' THEN 0
                       WHEN 'record_on_appeal' THEN 1
                       WHEN 'immigration_packet' THEN 2
                       WHEN 'appeal_brief' THEN 3
                       ELSE 4
                     END,
                     exhibit_order ASC, created_at ASC""",
                (case_id, tenant_id),
            ).fetchall()
        elif category == "case_documents":
            rows = db.execute(
                f"""SELECT {cols}
                   FROM documents
                   WHERE case_id = ? AND tenant_id = ?
                     AND COALESCE(category, 'general') NOT IN ('evidence', 'record_on_appeal', 'immigration_packet', 'appeal_brief')
                   ORDER BY exhibit_order ASC, created_at ASC""",
                (case_id, tenant_id),
            ).fetchall()
        else:
            rows = db.execute(
                f"""SELECT {cols}
                   FROM documents
                   WHERE case_id = ? AND tenant_id = ? AND category = ?
                   ORDER BY exhibit_order ASC, created_at ASC""",
                (case_id, tenant_id, category),
            ).fetchall()
        return [dict(r) for r in rows]


def _build_scan_labels(docs: List[dict], category: str) -> tuple:
    """
    Build human labels (Vol. N / Ex. X / Doc N) and ROA volume map.
    Returns (labels_by_id, vol_by_id).
    """
    labels = {}
    vol_by_id = {}
    roa_idx = 0
    ip_idx = 0
    case_doc_idx = 0
    for d in docs:
        cat = (d.get("category") or "general").lower()
        if cat == "record_on_appeal":
            roa_idx += 1
            vol_by_id[d["id"]] = roa_idx
            labels[d["id"]] = f"Vol. {roa_idx}"
        elif cat == "immigration_packet":
            ip_idx += 1
            vol_by_id[d["id"]] = ip_idx
            labels[d["id"]] = f"Tab {ip_idx}"
        elif cat == "evidence" and d.get("exhibit_label"):
            labels[d["id"]] = f"Ex. {d['exhibit_label']}"
        elif category == "record_on_appeal":
            # Scoped ROA scan — always volume numbers even if category missing
            roa_idx += 1
            vol_by_id[d["id"]] = roa_idx
            labels[d["id"]] = f"Vol. {roa_idx}"
        elif category == "immigration_packet":
            ip_idx += 1
            vol_by_id[d["id"]] = ip_idx
            labels[d["id"]] = f"Tab {ip_idx}"
        else:
            case_doc_idx += 1
            labels[d["id"]] = f"Doc {case_doc_idx}"
    return labels, vol_by_id


def _match_ref(p: dict, labels: dict) -> dict:
    return {
        "id": p["id"],
        "label": labels.get(p["id"]) or p.get("label") or "—",
        "filename": p["filename"],
    }


def _iter_duplicate_scan(
    docs: List[dict],
    category: str,
    use_ai: bool,
    user_id: str,
):
    """
    Generator: yield progress events (dicts) then a final complete event.
    Document-by-document so the UI can mark unique / duplicate with Vol. labels.
    """
    labels, vol_by_id = _build_scan_labels(docs, category)
    total = len(docs)

    yield {
        "type": "start",
        "total": total,
        "category": category,
        "documents": [
            {
                "id": d["id"],
                "label": labels[d["id"]],
                "filename": d.get("filename") or "untitled",
                "category": d.get("category") or "general",
                "status": (
                    "resolved"
                    if int(d.get("dup_not_duplicate") or 0) == 1
                    else "pending"
                ),
                "message": (
                    "Not duplicate (previously resolved — locked)"
                    if int(d.get("dup_not_duplicate") or 0) == 1
                    else "Waiting…"
                ),
            }
            for d in docs
        ],
    }

    if total < 2:
        result = {
            "scanned": total,
            "with_text": total,
            "without_text": [],
            "groups": [],
            "category": category,
            "ai_summary": "Need at least two documents to compare for duplicates.",
            "progress": [],
        }
        yield {"type": "complete", "result": result}
        return

    EXACTISH = 0.97
    NEAR = 0.82
    POSSIBLE = 0.72

    prepared = []  # progressive list of successfully extracted docs
    without_text = []
    progress_rows = []  # final per-doc status for client summary
    # id -> {status, match_type, matches: [ids], similarity, message}
    verdict: dict = {}

    for idx, d in enumerate(docs):
        doc_id = d["id"]
        label = labels[doc_id]
        filename = d.get("filename") or "untitled"
        index = idx + 1

        # User previously resolved "Not Duplicate" — never re-flag on future scans
        if int(d.get("dup_not_duplicate") or 0) == 1:
            resolved_msg = "Not duplicate (previously resolved — locked)"
            verdict[doc_id] = {
                "status": "resolved",
                "message": resolved_msg,
                "matches": [],
            }
            progress_rows.append({
                "id": doc_id, "label": label, "filename": filename,
                "status": "resolved", "message": resolved_msg,
            })
            yield {
                "type": "doc",
                "index": index,
                "total": total,
                "id": doc_id,
                "label": label,
                "filename": filename,
                "status": "resolved",
                "message": resolved_msg,
            }
            # Do not add to prepared — excluded from duplicate matching entirely
            continue

        yield {
            "type": "doc",
            "index": index,
            "total": total,
            "id": doc_id,
            "label": label,
            "filename": filename,
            "status": "scanning",
            "message": f"AI reading {label} (OCR if image/scanned)…",
        }

        raw = _resolve_document_text(d, persist=True)
        norm = _normalize_compare_text(raw)
        if len(norm) < 40:
            without_text.append({
                "id": doc_id,
                "filename": filename,
                "category": d.get("category") or "general",
                "label": label,
            })
            no_txt_msg = (
                "Could not read text (OCR found little/none — try a clearer scan)"
            )
            verdict[doc_id] = {
                "status": "no_text",
                "message": no_txt_msg,
                "matches": [],
            }
            progress_rows.append({
                "id": doc_id, "label": label, "filename": filename,
                "status": "no_text", "message": no_txt_msg,
            })
            yield {
                "type": "doc",
                "index": index,
                "total": total,
                "id": doc_id,
                "label": label,
                "filename": filename,
                "status": "no_text",
                "message": no_txt_msg,
            }
            continue

        content_hash = hashlib.sha256(norm.encode("utf-8", errors="ignore")).hexdigest()
        current = {
            "id": doc_id,
            "filename": filename,
            "file_size": d.get("file_size"),
            "exhibit_order": d.get("exhibit_order"),
            "exhibit_label": d.get("exhibit_label"),
            "category": d.get("category") or "general",
            "created_at": d.get("created_at"),
            "label": label,
            "norm": norm,
            "raw_len": len(raw),
            "hash": content_hash,
            "excerpt": raw[:1200],
            "excerpt_tail": raw[-400:] if len(raw) > 1600 else "",
        }

        yield {
            "type": "doc",
            "index": index,
            "total": total,
            "id": doc_id,
            "label": label,
            "filename": filename,
            "status": "comparing",
            "message": f"Comparing {label} against prior documents…",
        }

        best = None  # (score, match_type, other_prepared)
        for prev in prepared:
            if current["hash"] == prev["hash"]:
                best = (1.0, "exact", prev)
                break
            score = _text_similarity(current["norm"], prev["norm"])
            la, lb = current["raw_len"], prev["raw_len"]
            size_ratio = min(la, lb) / max(la, lb) if max(la, lb) else 0
            if score >= NEAR or (score >= POSSIBLE and size_ratio >= 0.5):
                mt = "exact" if score >= EXACTISH else (
                    "near_duplicate" if score >= NEAR else "possible"
                )
                if best is None or score > best[0]:
                    best = (score, mt, prev)

        if best and best[0] >= POSSIBLE:
            score, mt, other = best
            match_label = labels.get(other["id"]) or other.get("label") or "—"
            msg = (
                f"Duplicate of {match_label}"
                if mt == "exact"
                else f"Near-duplicate of {match_label} ({score:.0%})"
            )
            matches = [_match_ref(other, labels)]
            # If other already linked to more, include those labels too
            other_v = verdict.get(other["id"]) or {}
            for m in other_v.get("matches") or []:
                if m["id"] not in (doc_id, other["id"]):
                    matches.append(m)
            verdict[doc_id] = {
                "status": "duplicate",
                "match_type": mt,
                "similarity": round(score, 3),
                "message": msg,
                "matches": matches,
            }
            # Upgrade prior unique → duplicate of this one as well
            if (verdict.get(other["id"]) or {}).get("status") != "duplicate":
                verdict[other["id"]] = {
                    "status": "duplicate",
                    "match_type": mt,
                    "similarity": round(score, 3),
                    "message": f"Duplicate of {label}",
                    "matches": [_match_ref(current, labels)],
                }
                yield {
                    "type": "doc",
                    "index": index,
                    "total": total,
                    "id": other["id"],
                    "label": labels.get(other["id"]),
                    "filename": other["filename"],
                    "status": "duplicate",
                    "match_type": mt,
                    "similarity": round(score, 3),
                    "message": f"Duplicate of {label}",
                    "matches": [_match_ref(current, labels)],
                }
            progress_rows.append({
                "id": doc_id, "label": label, "filename": filename,
                "status": "duplicate", "match_type": mt, "message": msg,
                "matches": matches,
            })
            yield {
                "type": "doc",
                "index": index,
                "total": total,
                "id": doc_id,
                "label": label,
                "filename": filename,
                "status": "duplicate",
                "match_type": mt,
                "similarity": round(score, 3),
                "message": msg,
                "matches": matches,
            }
        else:
            verdict[doc_id] = {
                "status": "unique",
                "message": "No duplicate",
                "matches": [],
            }
            progress_rows.append({
                "id": doc_id, "label": label, "filename": filename,
                "status": "unique", "message": "No duplicate",
            })
            yield {
                "type": "doc",
                "index": index,
                "total": total,
                "id": doc_id,
                "label": label,
                "filename": filename,
                "status": "unique",
                "message": "No duplicate",
            }

        prepared.append(current)

    by_id = {p["id"]: p for p in prepared}
    groups_out: List[dict] = []
    claimed = set()

    # Build exact hash groups
    hash_buckets: dict = {}
    for p in prepared:
        hash_buckets.setdefault(p["hash"], []).append(p["id"])
    for h, ids in hash_buckets.items():
        if len(ids) < 2:
            continue
        for i in ids:
            claimed.add(i)
        groups_out.append({
            "id": f"exact-{h[:10]}",
            "match_type": "exact",
            "similarity": 1.0,
            "confidence": 1.0,
            "reason": "Identical extracted text (normalized content hash match).",
            "documents": [_dup_doc_payload(by_id, vol_by_id, i, labels) for i in ids],
        })

    # Near pairs among remaining
    remaining = [p for p in prepared if p["id"] not in claimed]
    near_pairs = []
    for i in range(len(remaining)):
        for j in range(i + 1, len(remaining)):
            a, b = remaining[i], remaining[j]
            la, lb = a["raw_len"], b["raw_len"]
            size_ratio = min(la, lb) / max(la, lb) if max(la, lb) else 0
            score = _text_similarity(a["norm"], b["norm"])
            if score >= NEAR or (score >= POSSIBLE and size_ratio >= 0.5):
                near_pairs.append((a["id"], b["id"], score))

    ai_summary = ""
    if near_pairs:
        pair_ids = list({x for pair in near_pairs for x in pair[:2]})
        uf_pairs = [(a, b) for a, b, _ in near_pairs]
        clusters = _union_find_groups(pair_ids, uf_pairs)
        score_map = {}
        for a, b, s in near_pairs:
            score_map[(a, b)] = s
            score_map[(b, a)] = s

        ai_candidates = []
        for members in clusters:
            best = 0.0
            for x in range(len(members)):
                for y in range(x + 1, len(members)):
                    best = max(best, score_map.get((members[x], members[y]), 0.0))
            match_type = "near_duplicate" if best >= EXACTISH or best >= NEAR else "possible"
            excerpts = []
            for mid in members[:6]:
                p = by_id[mid]
                tail = f"\n…[end]…\n{p['excerpt_tail']}" if p["excerpt_tail"] else ""
                excerpts.append(
                    f"  — {labels.get(mid, p['filename'])} (id={mid}, chars={p['raw_len']}):\n"
                    f"{p['excerpt'][:900]}{tail}"
                )
            ai_candidates.append({
                "ids": members,
                "filenames": [by_id[m]["filename"] for m in members],
                "similarity": best,
                "sizes": [by_id[m]["raw_len"] for m in members],
                "excerpts": "\n".join(excerpts),
                "match_type_hint": match_type,
            })

        if use_ai and ai_candidates:
            yield {
                "type": "phase",
                "phase": "ai",
                "message": "AI confirming near-duplicate groups…",
            }
            model = get_model_for_task("duplicate_detection")
            credit_cost = 0
            sub_status = "active"
            try:
                with get_db() as db:
                    model, credit_cost = credit_gate(user_id, "duplicate_detection", db)
                    urow = db.execute(
                        "SELECT subscription_status FROM users WHERE id=?",
                        (user_id,),
                    ).fetchone()
                    if urow:
                        sub_status = urow["subscription_status"] or "active"
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"credit_gate for duplicate_detection failed: {e}")

            ai_result = _ai_confirm_duplicate_groups(model, ai_candidates)
            try:
                if credit_cost:
                    with get_db() as db:
                        deduct_credits(
                            user_id, sub_status, credit_cost,
                            "duplicate_detection", db,
                        )
            except Exception as e:
                logger.warning(f"credit deduct after duplicate_detection failed: {e}")

            ai_summary = (ai_result or {}).get("summary") or ""
            ai_refined = {}
            for g in (ai_result or {}).get("groups") or []:
                ids = [i for i in (g.get("document_ids") or []) if i in by_id]
                if len(ids) < 2:
                    continue
                mt = (g.get("match_type") or "near_duplicate").strip().lower()
                if mt == "not_duplicate":
                    # AI rejected — mark unique if only provisional near match
                    for i in ids:
                        if i not in claimed and (verdict.get(i) or {}).get("match_type") != "exact":
                            verdict[i] = {
                                "status": "unique",
                                "message": "No duplicate (AI confirmed distinct)",
                                "matches": [],
                            }
                            yield {
                                "type": "doc",
                                "id": i,
                                "label": labels.get(i),
                                "filename": by_id[i]["filename"],
                                "status": "unique",
                                "message": "No duplicate (AI confirmed distinct)",
                            }
                    continue
                if mt not in ("exact", "near_duplicate", "possible"):
                    mt = "near_duplicate"
                key = tuple(sorted(ids))
                ai_refined[key] = {
                    "match_type": mt,
                    "reason": g.get("reason") or "AI confirmed similar content.",
                    "confidence": float(g.get("confidence") or 0.8),
                }
            if not ai_refined:
                for c in ai_candidates:
                    key = tuple(sorted(c["ids"]))
                    ai_refined[key] = {
                        "match_type": c["match_type_hint"],
                        "reason": (
                            f"High text similarity ({c['similarity']:.0%}). "
                            "AI confirmation unavailable — review manually."
                        ),
                        "confidence": round(c["similarity"], 3),
                    }
        else:
            ai_refined = {}
            for c in ai_candidates:
                key = tuple(sorted(c["ids"]))
                ai_refined[key] = {
                    "match_type": c["match_type_hint"],
                    "reason": f"Text similarity {c['similarity']:.0%} (AI skipped).",
                    "confidence": round(c["similarity"], 3),
                }

        for c in ai_candidates:
            key = tuple(sorted(c["ids"]))
            meta = ai_refined.get(key)
            if not meta:
                continue
            members = c["ids"]
            for i in members:
                claimed.add(i)
            match_labels = [labels.get(m, by_id[m]["filename"]) for m in members]
            for i in members:
                others = [
                    _match_ref(by_id[m], labels)
                    for m in members if m != i
                ]
                others_lbl = ", ".join(labels.get(m, "?") for m in members if m != i)
                msg = f"Duplicate of {others_lbl}"
                verdict[i] = {
                    "status": "duplicate",
                    "match_type": meta["match_type"],
                    "similarity": round(c["similarity"], 3),
                    "message": msg,
                    "matches": others,
                    "reason": meta["reason"],
                }
                yield {
                    "type": "doc",
                    "id": i,
                    "label": labels.get(i),
                    "filename": by_id[i]["filename"],
                    "status": "duplicate",
                    "match_type": meta["match_type"],
                    "similarity": round(c["similarity"], 3),
                    "message": msg,
                    "matches": others,
                }
            groups_out.append({
                "id": f"near-{hashlib.sha1(''.join(sorted(members)).encode()).hexdigest()[:10]}",
                "match_type": meta["match_type"],
                "similarity": round(c["similarity"], 3),
                "confidence": meta["confidence"],
                "reason": meta["reason"],
                "documents": [_dup_doc_payload(by_id, vol_by_id, i, labels) for i in members],
            })

    rank = {"exact": 0, "near_duplicate": 1, "possible": 2}
    groups_out.sort(key=lambda g: (rank.get(g["match_type"], 9), -float(g.get("similarity") or 0)))

    if not groups_out:
        ai_summary = ai_summary or "No duplicate or near-duplicate content found among documents with extractable text."
    elif not ai_summary:
        n_exact = sum(1 for g in groups_out if g["match_type"] == "exact")
        n_near = sum(1 for g in groups_out if g["match_type"] != "exact")
        parts = []
        if n_exact:
            parts.append(f"{n_exact} exact duplicate group(s)")
        if n_near:
            parts.append(f"{n_near} near-duplicate/possible group(s)")
        ai_summary = "Found " + " and ".join(parts) + ". Review each group before deleting."

    # Final progress snapshot
    final_progress = []
    for d in docs:
        v = verdict.get(d["id"]) or {
            "status": "unique", "message": "No duplicate", "matches": [],
        }
        final_progress.append({
            "id": d["id"],
            "label": labels[d["id"]],
            "filename": d.get("filename") or "untitled",
            "status": v.get("status") or "unique",
            "match_type": v.get("match_type"),
            "similarity": v.get("similarity"),
            "message": v.get("message") or "",
            "matches": v.get("matches") or [],
        })

    result = {
        "scanned": len(docs),
        "with_text": len(prepared),
        "without_text": without_text,
        "groups": groups_out,
        "ai_summary": ai_summary,
        "category": category,
        "progress": final_progress,
    }
    yield {"type": "complete", "result": result}


@router.post("/{case_id}/documents/find-duplicates")
async def find_document_duplicates(
    case_id: str,
    req: FindDuplicatesRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Find documents with identical or near-identical content (JSON, non-streaming).
    Prefer find-duplicates-stream for live per-document progress in the UI.
    """
    tenant_id = current_user["tenant_id"]
    category = (req.category or "all").strip().lower()
    valid = {
        "all", "case_documents", "record_on_appeal", "immigration_packet", "appeal_brief", "general", "evidence",
        "petition", "correspondence", "court_filing", "ready",
    }
    if category not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid category '{category}'")

    docs = _load_docs_for_dup_scan(case_id, tenant_id, category)
    result = None
    try:
        for evt in _iter_duplicate_scan(
            docs, category, req.use_ai, current_user["sub"]
        ):
            if evt.get("type") == "complete":
                result = evt.get("result")
            elif evt.get("type") == "error":
                raise HTTPException(status_code=500, detail=evt.get("message") or "Scan failed")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"find_document_duplicates failed: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e)[:300])
    return result or {
        "scanned": len(docs),
        "with_text": 0,
        "without_text": [],
        "groups": [],
        "category": category,
        "ai_summary": "Scan completed with no result payload.",
        "progress": [],
    }


@router.post("/{case_id}/documents/find-duplicates-stream")
async def find_document_duplicates_stream(
    case_id: str,
    req: FindDuplicatesRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Stream NDJSON progress while scanning documents for duplicates.

    Each line is a JSON event:
      start | doc | phase | complete | error
    Doc events mark each item scanning / unique / duplicate (with Vol./Ex. labels).
    """
    tenant_id = current_user["tenant_id"]
    category = (req.category or "all").strip().lower()
    valid = {
        "all", "case_documents", "record_on_appeal", "immigration_packet", "appeal_brief", "general", "evidence",
        "petition", "correspondence", "court_filing", "ready",
    }
    if category not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid category '{category}'")

    docs = _load_docs_for_dup_scan(case_id, tenant_id, category)
    user_id = current_user["sub"]
    use_ai = bool(req.use_ai)

    def event_stream():
        try:
            for evt in _iter_duplicate_scan(docs, category, use_ai, user_id):
                yield json.dumps(evt, default=str) + "\n"
        except HTTPException as he:
            detail = he.detail
            if isinstance(detail, dict):
                msg = detail.get("message") or str(detail)
            else:
                msg = str(detail)
            yield json.dumps({"type": "error", "message": msg}) + "\n"
        except Exception as e:
            logger.error(f"find-duplicates-stream failed: {e}\n{traceback.format_exc()}")
            yield json.dumps({"type": "error", "message": str(e)[:400]}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/documents/{doc_id}/resolve-not-duplicate")
async def resolve_document_not_duplicate(
    doc_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Mark a document as permanently Not Duplicate (user resolved).
    Future duplicate scans will never re-flag this document as a duplicate.
    """
    tenant_id = current_user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        # Ensure columns exist (safe if migration already ran)
        try:
            cols = {c["name"] for c in db.execute("PRAGMA table_info(documents)").fetchall()}
            if "dup_not_duplicate" not in cols:
                db.execute("ALTER TABLE documents ADD COLUMN dup_not_duplicate INTEGER DEFAULT 0")
            if "dup_resolved_at" not in cols:
                db.execute("ALTER TABLE documents ADD COLUMN dup_resolved_at TIMESTAMP")
        except Exception as e:
            logger.warning(f"ensure dup columns: {e}")

        doc = db.execute(
            "SELECT id, filename FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, tenant_id),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        db.execute(
            """UPDATE documents
               SET dup_not_duplicate = 1, dup_resolved_at = ?
               WHERE id = ? AND tenant_id = ?""",
            (now, doc_id, tenant_id),
        )
        updated = db.execute(
            """SELECT id, filename, COALESCE(dup_not_duplicate, 0) AS dup_not_duplicate,
                      dup_resolved_at
               FROM documents WHERE id = ?""",
            (doc_id,),
        ).fetchone()

    return {
        "ok": True,
        "id": doc_id,
        "filename": dict(updated).get("filename") if updated else None,
        "dup_not_duplicate": 1,
        "dup_resolved_at": now,
        "message": "Document resolved as Not Duplicate. Future scans will not re-flag it.",
    }


@router.post("/documents/{doc_id}/retrigger-exhibit-ai")
async def retrigger_exhibit_ai(
    doc_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Re-trigger AI naming for a document."""
    with get_db() as db:
        doc = db.execute(
            "SELECT * FROM documents WHERE id = ? AND tenant_id = ?",
            (doc_id, current_user["tenant_id"])
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        doc = dict(doc)
        if not doc.get("file_path"):
            raise HTTPException(status_code=400, detail="No file associated with this document")

        fp = Path(UPLOAD_BASE_DIR) / doc["file_path"]
        if not fp.exists():
            raise HTTPException(status_code=404, detail="File not found on server")

        file_bytes = fp.read_bytes()
        ext = Path(doc["filename"]).suffix.lower()

        background_tasks.add_task(
            _retrigger_ai_task, doc_id, doc["case_id"], doc["tenant_id"],
            file_bytes, doc["filename"], ext, fp
        )

    return {"status": "processing", "doc_id": doc_id}


def _retrigger_ai_task(doc_id: str, case_id: str, tenant_id: str,
                       file_bytes: bytes, filename: str, ext: str,
                       file_path_on_disk: Path):
    """Background: re-run AI naming and re-stamp PDF."""
    try:
        if ext == ".pdf":
            text = _extract_text_from_pdf(file_bytes)
        elif ext in (".docx", ".doc"):
            text = _extract_text_from_docx(file_bytes)
        elif ext == ".txt":
            text = file_bytes.decode("utf-8", errors="ignore")[:3000]
        else:
            text = ""

        exhibit_name = _ai_generate_exhibit_name(text, filename)

        with get_db() as db:
            doc = db.execute("SELECT exhibit_label, file_path FROM documents WHERE id = ?", (doc_id,)).fetchone()
            exhibit_label = doc["exhibit_label"] if doc else "A"
            file_ext = Path(doc["file_path"]).suffix.lower() if doc and doc.get("file_path") else ext
            new_filename = f"Exhibit {exhibit_label} — {exhibit_name}{file_ext}"

            db.execute(
                "UPDATE documents SET exhibit_name = ?, filename = ? WHERE id = ?",
                (exhibit_name, new_filename, doc_id)
            )

            if ext == ".pdf":
                stamped = _stamp_exhibit_on_pdf(file_bytes, exhibit_label, exhibit_name)
                file_path_on_disk.write_bytes(stamped)

        logger.info(f"AI re-trigger complete: {doc_id} -> {new_filename}")
    except Exception as e:
        logger.error(f"AI re-trigger failed for {doc_id}: {e}")


# USCIS status sub-route
@router.get("/{case_id}/uscis-status")
async def get_uscis_status(case_id: str, current_user: dict = Depends(get_current_user)):
    """Get USCIS case status for a case."""
    with get_db() as db:
        case = db.execute(
            "SELECT uscis_receipt_number, uscis_status, uscis_last_checked FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, current_user["tenant_id"])
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        return dict(case)


# ──────────────────────────────────────────
# Case Notes — the case_notes table already existed (and is already wired
# into the case-delete cascade) but no create/read/update/delete route was
# ever built, so the Notes tab has been silently failing to save.
# ──────────────────────────────────────────

class CaseNoteCreate(BaseModel):
    content: str


class CaseNoteUpdate(BaseModel):
    content: str


@router.get("/{case_id}/notes")
async def list_case_notes(case_id: str, current_user: dict = Depends(get_current_user)):
    """List notes for a case, newest first."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute("SELECT id FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        rows = db.execute(
            "SELECT * FROM case_notes WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/{case_id}/notes")
async def create_case_note(case_id: str, req: CaseNoteCreate, current_user: dict = Depends(get_current_user)):
    """Add a note to a case."""
    tenant_id = current_user["tenant_id"]
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note content is required")

    with get_db() as db:
        case = db.execute("SELECT id FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        note_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """INSERT INTO case_notes (id, case_id, tenant_id, content, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (note_id, case_id, tenant_id, content, current_user["sub"], now, now)
        )
        row = db.execute("SELECT * FROM case_notes WHERE id = ?", (note_id,)).fetchone()
        return dict(row)


@router.put("/{case_id}/notes/{note_id}")
async def update_case_note(case_id: str, note_id: str, req: CaseNoteUpdate,
                            current_user: dict = Depends(get_current_user)):
    """Edit an existing note."""
    tenant_id = current_user["tenant_id"]
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note content is required")

    with get_db() as db:
        note = db.execute(
            "SELECT id FROM case_notes WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (note_id, case_id, tenant_id)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")

        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE case_notes SET content = ?, updated_at = ? WHERE id = ?",
            (content, now, note_id)
        )
        row = db.execute("SELECT * FROM case_notes WHERE id = ?", (note_id,)).fetchone()
        return dict(row)


@router.delete("/{case_id}/notes/{note_id}")
async def delete_case_note(case_id: str, note_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a note."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        note = db.execute(
            "SELECT id FROM case_notes WHERE id = ? AND case_id = ? AND tenant_id = ?",
            (note_id, case_id, tenant_id)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        db.execute("DELETE FROM case_notes WHERE id = ?", (note_id,))
        return {"message": "Note deleted"}


# ──────────────────────────────────────────
# Case Team & Access — per-case collaborator invites
# ──────────────────────────────────────────

CASE_ROLE_PERMS: dict = {
    "client":     {"view_documents": True,  "download_documents": True,  "upload_documents": False, "view_tasks": True,  "edit_tasks": False, "view_witnesses": True,  "view_discovery": True},
    "co_counsel": {"view_documents": True,  "download_documents": True,  "upload_documents": True,  "view_tasks": True,  "edit_tasks": True,  "view_witnesses": True,  "view_discovery": True},
    "paralegal":  {"view_documents": True,  "download_documents": True,  "upload_documents": True,  "view_tasks": True,  "edit_tasks": True,  "view_witnesses": True,  "view_discovery": True},
    "expert":     {"view_documents": True,  "download_documents": True,  "upload_documents": False, "view_tasks": False, "edit_tasks": False, "view_witnesses": True,  "view_discovery": False},
    "witness":    {"view_documents": True,  "download_documents": False, "upload_documents": False, "view_tasks": False, "edit_tasks": False, "view_witnesses": False, "view_discovery": False},
    "observer":   {"view_documents": True,  "download_documents": False, "upload_documents": False, "view_tasks": True,  "edit_tasks": False, "view_witnesses": True,  "view_discovery": True},
}

CASE_MANAGER_ROLES = ("admin", "attorney", "expert", "paralegal")


class CaseMemberInvite(BaseModel):
    email: str
    name: str
    role: str = "client"
    message: Optional[str] = None


class CaseMemberUpdate(BaseModel):
    role: str
    permissions: dict


def _collab_out(row) -> dict:
    d = dict(row)
    try:
        d["permissions"] = json.loads(d.get("permissions") or "{}")
    except (TypeError, ValueError):
        d["permissions"] = {}
    return d


@router.get("/{case_id}/members")
async def list_case_members(case_id: str, current_user: dict = Depends(get_current_user)):
    """List collaborators invited to this case. Firm members only."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        case = db.execute("SELECT id FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        rows = db.execute(
            "SELECT * FROM case_collaborators WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        ).fetchall()
        return [_collab_out(r) for r in rows]


@router.post("/{case_id}/members")
async def invite_case_member(case_id: str, req: CaseMemberInvite, current_user: dict = Depends(get_current_user)):
    """Invite a collaborator (client, co-counsel, paralegal, expert, witness, observer) to this case."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in CASE_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="You don't have permission to invite collaborators")

    email = req.email.strip().lower()
    name = req.name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if req.role not in CASE_ROLE_PERMS:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(CASE_ROLE_PERMS)}")

    with get_db() as db:
        case = db.execute("SELECT id, title FROM cases WHERE id = ? AND tenant_id = ?", (case_id, tenant_id)).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        existing = db.execute(
            "SELECT id FROM case_collaborators WHERE case_id = ? AND LOWER(email) = ? AND status != 'revoked'",
            (case_id, email)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="This person already has access or a pending invite to this case")

        inviter = db.execute("SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)).fetchone()
        inviter_name = inviter["full_name"] if inviter else current_user.get("email", "")

        member_id = generate_id()
        token = secrets.token_urlsafe(48)
        permissions = CASE_ROLE_PERMS[req.role]
        now = datetime.now(timezone.utc).isoformat()

        db.execute(
            """INSERT INTO case_collaborators
               (id, case_id, tenant_id, name, email, role, permissions, status, invite_token, invited_by, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (member_id, case_id, tenant_id, name, email, req.role, json.dumps(permissions),
             token, current_user["sub"], (req.message or "").strip(), now)
        )

        send_case_invitation_email(
            to_email=email,
            inviter_name=inviter_name,
            case_title=case["title"],
            role=req.role,
            token=token,
            message=(req.message or "").strip() or None,
        )

        row = db.execute("SELECT * FROM case_collaborators WHERE id = ?", (member_id,)).fetchone()
        return _collab_out(row)


@router.patch("/{case_id}/members/{member_id}")
async def update_case_member(case_id: str, member_id: str, req: CaseMemberUpdate,
                              current_user: dict = Depends(get_current_user)):
    """Update a collaborator's role and granular permissions."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in CASE_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="You don't have permission to manage collaborators")
    if req.role not in CASE_ROLE_PERMS:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(CASE_ROLE_PERMS)}")

    with get_db() as db:
        member = db.execute(
            """SELECT cc.* FROM case_collaborators cc
               JOIN cases c ON cc.case_id = c.id
               WHERE cc.id = ? AND cc.case_id = ? AND c.tenant_id = ?""",
            (member_id, case_id, tenant_id)
        ).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Collaborator not found")

        db.execute(
            "UPDATE case_collaborators SET role = ?, permissions = ? WHERE id = ?",
            (req.role, json.dumps(req.permissions), member_id)
        )
        row = db.execute("SELECT * FROM case_collaborators WHERE id = ?", (member_id,)).fetchone()
        return _collab_out(row)


@router.delete("/{case_id}/members/{member_id}")
async def remove_case_member(case_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a collaborator's access to this case."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in CASE_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="You don't have permission to remove collaborators")

    with get_db() as db:
        member = db.execute(
            """SELECT cc.id FROM case_collaborators cc
               JOIN cases c ON cc.case_id = c.id
               WHERE cc.id = ? AND cc.case_id = ? AND c.tenant_id = ?""",
            (member_id, case_id, tenant_id)
        ).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Collaborator not found")
        db.execute("DELETE FROM case_collaborators WHERE id = ?", (member_id,))
        return {"message": "Access removed"}


@router.post("/{case_id}/members/{member_id}/resend")
async def resend_case_member_invite(case_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Resend a pending case collaborator invite with a fresh token."""
    tenant_id = current_user["tenant_id"]
    if current_user["role"] not in CASE_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="You don't have permission to resend invites")

    with get_db() as db:
        member = db.execute(
            """SELECT cc.*, c.title as case_title FROM case_collaborators cc
               JOIN cases c ON cc.case_id = c.id
               WHERE cc.id = ? AND cc.case_id = ? AND c.tenant_id = ?""",
            (member_id, case_id, tenant_id)
        ).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Collaborator not found")

        new_token = secrets.token_urlsafe(48)
        db.execute(
            "UPDATE case_collaborators SET invite_token = ?, status = 'pending' WHERE id = ?",
            (new_token, member_id)
        )

        inviter = db.execute("SELECT full_name FROM users WHERE id = ?", (current_user["sub"],)).fetchone()
        inviter_name = inviter["full_name"] if inviter else current_user.get("email", "")

        send_case_invitation_email(
            to_email=member["email"],
            inviter_name=inviter_name,
            case_title=member["case_title"],
            role=member["role"],
            token=new_token,
            message=member["message"] or None,
        )
        return {"message": f"Invite resent to {member['email']}"}


# ──────────────────────────────────────────
# Case invite acceptance — public, no auth required
# ──────────────────────────────────────────

class CaseInviteAccept(BaseModel):
    token: str
    full_name: str
    password: str


@router.get("/invite/{token}")
async def get_case_invite_info(token: str):
    """Get case invitation details for the accept-invite page. Public — no auth."""
    with get_db() as db:
        inv = db.execute(
            """SELECT cc.*, c.title as case_title, u.full_name as inviter_name
               FROM case_collaborators cc
               JOIN cases c ON cc.case_id = c.id
               LEFT JOIN users u ON cc.invited_by = u.id
               WHERE cc.invite_token = ?""",
            (token,)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Invite not found or expired")
        d = _collab_out(inv)
        return {
            "name": d["name"],
            "email": d["email"],
            "role": d["role"],
            "permissions": d["permissions"],
            "status": d["status"],
            "message": d.get("message"),
            "case_id": d["case_id"],
            "case_title": d["case_title"],
            "inviter_name": d.get("inviter_name") or "",
        }


@router.post("/invite/{token}/accept")
async def accept_case_invite(token: str, req: CaseInviteAccept):
    """Accept a case invitation and create (or link) a login-capable account.

    The accepted collaborator gets their OWN tenant (not the inviting firm's),
    so normal tenant-scoped endpoints show them nothing extra — access to this
    one case is granted separately via the case_collaborators row + the shared
    resolve_case_access() helper, keeping them fully isolated from the firm's
    other cases.
    """
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not req.full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")

    with get_db() as db:
        inv = db.execute(
            """SELECT cc.*, c.title as case_title FROM case_collaborators cc
               JOIN cases c ON cc.case_id = c.id
               WHERE cc.invite_token = ?""",
            (token,)
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=400, detail="Invalid or expired invitation link")

        if inv["status"] == "revoked":
            raise HTTPException(status_code=400, detail="This invitation has been revoked")

        existing_user = db.execute(
            "SELECT id FROM users WHERE LOWER(email) = ?", (inv["email"].lower(),)
        ).fetchone()
        if existing_user:
            raise HTTPException(
                status_code=400,
                detail="An account with this email already exists. Please sign in, then reopen this invite link."
            )

        # A fresh, standalone tenant for this collaborator — deliberately NOT the
        # inviting firm's tenant_id, so tenant-scoped queries never surface the
        # firm's other cases to them.
        tenant_id = generate_id()
        user_id = generate_id()
        now = datetime.now(timezone.utc).isoformat()

        db.execute(
            "INSERT INTO tenants (id, name, type, created_at) VALUES (?, ?, 'solo_practitioner', ?)",
            (tenant_id, f"{req.full_name.strip()} (collaborator)", now)
        )
        db.execute(
            """INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'client', 'READY', ?)""",
            (user_id, tenant_id, inv["email"].lower(), hash_password(req.password), req.full_name.strip(), now)
        )
        db.execute(
            "UPDATE case_collaborators SET status = 'active', user_id = ?, accepted_at = ? WHERE id = ?",
            (user_id, now, inv["id"])
        )

        token_out = create_access_token(user_id, tenant_id, "client", inv["email"].lower())

    return {
        "message": f"You now have access to {inv['case_title']}",
        "access_token": token_out,
        "case_id": inv["case_id"],
        "user": {
            "id": user_id,
            "tenant_id": tenant_id,
            "email": inv["email"].lower(),
            "full_name": req.full_name.strip(),
            "role": "client",
        }
    }
