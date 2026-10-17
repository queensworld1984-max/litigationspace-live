"""
Product tour video generator for LitigationSpace marketing.

Pipeline per product:
  1. Capture real page screenshot (headless Chrome) when possible
  2. Draw a large GREEN ARROW pointer at key UI targets
  3. ElevenLabs Adam (or configured) voice-over per step
  4. FFmpeg still+audio → MP4
  5. Save under product_demos/ + product_demo_videos table

Pointer style: bright green filled arrow with dark outline (demo-friendly).
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DEMOS_DIR = Path(
    os.environ.get(
        "PRODUCT_DEMOS_DIR",
        "/var/www/litigationspace-staging/data/product_demos",
    )
)
BASE_URL = os.environ.get("LS_PUBLIC_URL", "https://litigationspace.com").rstrip("/")
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"

# Frame size (landscape for product tours)
W, H = 1920, 1080
GOLD = (245, 166, 35)
BG = (13, 17, 23)
WHITE = (255, 255, 255)
GRAY = (148, 163, 184)
GREEN = (34, 197, 94)       # bright green pointer
GREEN_DARK = (5, 80, 40)

# ── Tour definitions ───────────────────────────────────────────────────────────
# arrow: (tip_x, tip_y) where the green arrow points (1920x1080 coords)
# kind: "capture" uses live screenshot; "brand" uses branded slide only

TOURS: List[Dict[str, Any]] = [
    {
        "product_key": "home_dashboard",
        "title": "Home to Dashboard",
        "path": "/",
        "steps": [
            {
                "kind": "brand",
                "heading": "LitigationSpace",
                "voiceover": (
                    "Welcome to LitigationSpace — the operating system for litigation. "
                    "Let's walk from the homepage into your Dashboard."
                ),
                "arrow": (960, 620),
            },
            {
                "kind": "capture",
                "path": "/",
                "heading": "Homepage",
                "voiceover": (
                    "From the homepage, attorneys see Motion Analyzer, Legal Brain, Case Vault, "
                    "and Live Bench — strategy, evidence, and victory in one platform."
                ),
                "arrow": (960, 720),
            },
            {
                "kind": "brand",
                "heading": "Your Dashboard",
                "voiceover": (
                    "After sign-in, the Dashboard is your command center. "
                    "Every product is one click away from the sidebar."
                ),
                "arrow": (220, 400),
            },
        ],
    },
    {
        "product_key": "live_bench",
        "title": "Live Bench",
        "path": "/live-bench",
        "steps": [
            {
                "kind": "brand",
                "heading": "Live Bench",
                "voiceover": (
                    "Live Bench is your expert witness marketplace. "
                    "Find verified experts, paralegals, and consultants on demand."
                ),
                "arrow": (960, 540),
            },
            {
                "kind": "capture",
                "path": "/live-bench",
                "heading": "Browse experts",
                "voiceover": (
                    "Browse Live Bench profiles, filter by specialty, and request the talent your case needs — "
                    "without leaving LitigationSpace."
                ),
                "arrow": (1100, 500),
            },
        ],
    },
    {
        "product_key": "case_vault",
        "title": "Case Vault",
        "path": "/cases",
        "steps": [
            {
                "kind": "brand",
                "heading": "Case Vault",
                "voiceover": (
                    "Case Vault is the heart of your matters. "
                    "Open any case for tasks, documents, discovery, witnesses, AI chat, and more."
                ),
                "arrow": (960, 520),
            },
            {
                "kind": "brand",
                "heading": "Documents workspace",
                "voiceover": (
                    "Inside Documents, switch workspaces: Evidence with Exhibit numbers, "
                    "Record on Appeal, Immigration Packet, or Case Documents — "
                    "upload new files or choose from your document bank."
                ),
                "arrow": (700, 280),
            },
            {
                "kind": "brand",
                "heading": "Tasks · Discovery · Witnesses",
                "voiceover": (
                    "Track tasks and deadlines, manage discovery, and organize witnesses — "
                    "all under the same case file."
                ),
                "arrow": (500, 400),
            },
        ],
    },
    {
        "product_key": "case_builder",
        "title": "Case Builder",
        "path": "/case-builder",
        "steps": [
            {
                "kind": "brand",
                "heading": "Case Builder",
                "voiceover": (
                    "Case Builder walks you through opening a new matter: parties, court, deadlines, "
                    "and priorities — so your vault starts organized."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/case-builder",
                "heading": "Build a matter",
                "voiceover": (
                    "Fill caption details and case type, then create the case. "
                    "Your team can collaborate from day one."
                ),
                "arrow": (960, 700),
            },
        ],
    },
    {
        "product_key": "war_room",
        "title": "War Room",
        "path": "/warroom",
        "steps": [
            {
                "kind": "brand",
                "heading": "War Room",
                "voiceover": (
                    "War Room is where strategy comes alive. "
                    "Map theories, risks, and next moves with AI-assisted litigation planning."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/warroom",
                "heading": "Strategy workspace",
                "voiceover": (
                    "Use War Room to pressure-test arguments before you file — "
                    "so you walk into court prepared."
                ),
                "arrow": (1200, 480),
            },
        ],
    },
    {
        "product_key": "drafting",
        "title": "Drafting Engine",
        "path": "/drafting/new",
        "steps": [
            {
                "kind": "brand",
                "heading": "Drafting Engine",
                "voiceover": (
                    "The Drafting Engine helps you produce motions, briefs, and letters in minutes — "
                    "with structure attorneys expect."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/drafting/new",
                "heading": "Start a draft",
                "voiceover": (
                    "Choose a document type, set jurisdiction and facts, then generate a first draft "
                    "you can refine in the editor."
                ),
                "arrow": (960, 640),
            },
        ],
    },
    {
        "product_key": "legal_brain",
        "title": "Legal Brain",
        "path": "/legal-brain",
        "steps": [
            {
                "kind": "brand",
                "heading": "Legal Brain",
                "voiceover": (
                    "Legal Brain is your AI research partner. "
                    "Ask questions and get answers grounded in legal analysis."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/legal-brain",
                "heading": "Ask anything",
                "voiceover": (
                    "Open Legal Brain from the dashboard, type your issue, and get instant research "
                    "support across issues and jurisdictions."
                ),
                "arrow": (960, 780),
            },
        ],
    },
    {
        "product_key": "doc_analyzer",
        "title": "Doc Analyzer",
        "path": "/document-analyzer",
        "steps": [
            {
                "kind": "brand",
                "heading": "Doc Analyzer",
                "voiceover": (
                    "Document Analyzer extracts key facts, arguments, and risks from uploads — "
                    "so you understand a file in minutes, not hours."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/document-analyzer",
                "heading": "Upload and analyze",
                "voiceover": (
                    "Drop a PDF or brief, run analysis, and review AI findings side by side with the document."
                ),
                "arrow": (960, 600),
            },
        ],
    },
    {
        "product_key": "motion_analyzer",
        "title": "Motion Analyzer",
        "path": "/motion-analyzer",
        "steps": [
            {
                "kind": "brand",
                "heading": "Motion Analyzer",
                "voiceover": (
                    "Motion Analyzer scores motion strength, surfaces weaknesses, "
                    "and highlights citation opportunities before you file."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/motion-analyzer",
                "heading": "Score your motion",
                "voiceover": (
                    "Upload a motion and get an instant AI-powered assessment — "
                    "built for serious litigators."
                ),
                "arrow": (1100, 650),
            },
        ],
    },
    {
        "product_key": "legal_database",
        "title": "Legal Database",
        "path": "/legal-database",
        "steps": [
            {
                "kind": "brand",
                "heading": "Legal Database",
                "voiceover": (
                    "Legal Database brings statutes, case law, and court rules into one searchable workspace."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/legal-database",
                "heading": "Search the law",
                "voiceover": (
                    "Query across jurisdictions without leaving the platform — "
                    "research that stays connected to your cases."
                ),
                "arrow": (960, 400),
            },
        ],
    },
    {
        "product_key": "global_legal_intel",
        "title": "Global Legal Intel",
        "path": "/jurisdiction",
        "steps": [
            {
                "kind": "brand",
                "heading": "Global Legal Intel",
                "voiceover": (
                    "Global Legal Intel maps jurisdiction insights so you understand venue, "
                    "procedure, and cross-border risk."
                ),
                "arrow": (960, 500),
            },
            {
                "kind": "capture",
                "path": "/jurisdiction",
                "heading": "Jurisdiction intelligence",
                "voiceover": (
                    "Explore Global Legal Intel to orient strategy across forums — "
                    "from federal practice to international context."
                ),
                "arrow": (1000, 520),
            },
        ],
    },
    {
        "product_key": "ai_navigator",
        "title": "AI Navigator",
        "path": "/dashboard",
        "steps": [
            {
                "kind": "brand",
                "heading": "AI Navigator",
                "voiceover": (
                    "AI Navigator on the Dashboard points you to the right tool at the right time — "
                    "Legal Brain, Doc Analyzer, Motion Analyzer, and more."
                ),
                "arrow": (960, 480),
            },
            {
                "kind": "brand",
                "heading": "One click to tools",
                "voiceover": (
                    "From the Dashboard, open AI Navigator and jump straight into analysis or research. "
                    "No hunting through menus."
                ),
                "arrow": (1400, 400),
            },
        ],
    },
]


def ensure_schema(db) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS product_demo_videos (
            id TEXT PRIMARY KEY,
            product_key TEXT NOT NULL,
            title TEXT NOT NULL,
            script TEXT,
            video_path TEXT,
            thumbnail_path TEXT,
            duration_seconds REAL DEFAULT 0,
            file_size_bytes INTEGER DEFAULT 0,
            voice TEXT DEFAULT 'adam',
            pointer_style TEXT DEFAULT 'green_arrow',
            status TEXT DEFAULT 'generated',
            website_id TEXT DEFAULT 'ls',
            created_at TEXT
        )
        """
    )
    try:
        db.commit()
    except Exception:
        pass


def _draw_green_arrow(draw, tip: Tuple[int, int], angle_deg: float = -35) -> None:
    """Draw a large filled green arrow pointer with tip at (x,y)."""
    import math
    from PIL import ImageDraw

    tx, ty = tip
    # Arrow geometry in local coords (points to +x), then rotate
    length = 160
    head = 70
    half_w = 22
    # Shaft + head polygon pointing right, tip at origin after transform
    pts_local = [
        (-length, -half_w),
        (-head, -half_w),
        (-head, -half_w * 2.2),
        (0, 0),
        (-head, half_w * 2.2),
        (-head, half_w),
        (-length, half_w),
    ]
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)

    def rot(x, y):
        return (
            int(tx + x * cos_a - y * sin_a),
            int(ty + x * sin_a + y * cos_a),
        )

    pts = [rot(x, y) for x, y in pts_local]
    # Outline
    draw.polygon(pts, fill=GREEN, outline=GREEN_DARK)
    # Soft glow circle at tip
    r = 14
    draw.ellipse([tx - r, ty - r, tx + r, ty + r], fill=GREEN, outline=WHITE)


def _wrap(draw, text: str, font, max_w: int) -> List[str]:
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _render_brand_frame(heading: str, body: str, arrow: Tuple[int, int], out_path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, 10], fill=GOLD)
    draw.rectangle([0, H - 10, W, H], fill=GOLD)

    try:
        font_brand = ImageFont.truetype(FONT_BOLD, 28)
        font_h = ImageFont.truetype(FONT_BOLD, 64)
        font_b = ImageFont.truetype(FONT_REGULAR, 32)
    except Exception:
        font_brand = font_h = font_b = ImageFont.load_default()

    draw.text((60, 40), "LITIGATIONSPACE", font=font_brand, fill=GOLD)
    draw.text((60, 90), "Product tour", font=font_brand, fill=GRAY)

    y = 280
    for line in _wrap(draw, heading, font_h, W - 200):
        draw.text((80, y), line, font=font_h, fill=WHITE)
        y += 78

    y += 20
    for line in _wrap(draw, body, font_b, W - 280)[:6]:
        draw.text((80, y), line, font=font_b, fill=GRAY)
        y += 42

    _draw_green_arrow(draw, arrow, angle_deg=-40)
    # Caption near arrow base
    draw.text((min(arrow[0] + 40, W - 320), max(arrow[1] - 80, 40)), "▶ Follow the green arrow", font=font_brand, fill=GREEN)

    img.save(out_path, "PNG")


def _capture_page(url: str, out_path: Path, wait_ms: int = 2500) -> bool:
    """Headless Chrome screenshot. Returns True on success."""
    chrome = shutil.which("google-chrome") or shutil.which("chromium-browser") or shutil.which("chromium")
    if not chrome:
        logger.warning("No Chrome binary for screenshots")
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Chrome writes screenshot next to --screenshot= path
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--window-size={W},{H}",
            f"--virtual-time-budget={wait_ms}",
            f"--screenshot={out_path}",
            "--hide-scrollbars",
            url,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        if out_path.exists() and out_path.stat().st_size > 5000:
            return True
        logger.warning(f"Screenshot failed for {url}: {r.stderr[-400:] if r.stderr else r.returncode}")
        return False
    except Exception as e:
        logger.warning(f"Screenshot error {url}: {e}")
        return False


def _overlay_arrow_on_image(src_path: Path, arrow: Tuple[int, int], out_path: Path, caption: str = "") -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(src_path).convert("RGB")
    # Scale to W x H if needed
    if img.size != (W, H):
        img = img.resize((W, H), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(img)
    # Dim vignette band at bottom for caption
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([0, H - 110, W, H], fill=(13, 17, 23, 200))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)
    _draw_green_arrow(draw, arrow, angle_deg=-45)
    try:
        font = ImageFont.truetype(FONT_BOLD, 26)
    except Exception:
        font = ImageFont.load_default()
    label = caption or "Follow the green arrow"
    draw.text((48, H - 72), label, font=font, fill=GREEN)
    draw.text((48, H - 40), "LitigationSpace product tour", font=font, fill=GOLD)
    img.save(out_path, "PNG")


def _voiceover(text: str, out_path: Path) -> float:
    from app.services.tts_elevenlabs import synthesize_speech, elevenlabs_configured
    from app.services.video_generator import _generate_voiceover, _get_openai_client

    if elevenlabs_configured():
        try:
            return synthesize_speech(text, out_path) + 0.35
        except Exception as e:
            logger.warning(f"ElevenLabs VO failed: {e}")
    client = _get_openai_client()
    return _generate_voiceover(client, text, out_path) + 0.35


def _make_clip(image: Path, audio: Path, duration: float, out: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loop", "1", "-i", str(image),
            "-i", str(audio),
            "-c:v", "libx264", "-tune", "stillimage",
            "-c:a", "aac", "-b:a", "160k",
            "-pix_fmt", "yuv420p",
            "-t", str(max(duration, 1.5)),
            "-vf", f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2",
            str(out),
        ],
        check=True,
        capture_output=True,
    )


def generate_product_tour(db, product_key: str, website_id: str = "ls") -> Dict[str, Any]:
    """Generate one product tour video with green-arrow pointer + Adam VO."""
    ensure_schema(db)
    tour = next((t for t in TOURS if t["product_key"] == product_key), None)
    if not tour:
        return {"status": "error", "detail": f"Unknown product_key: {product_key}"}

    video_id = str(uuid.uuid4())
    work = DEMOS_DIR / video_id
    work.mkdir(parents=True, exist_ok=True)
    DEMOS_DIR.mkdir(parents=True, exist_ok=True)

    clips = []
    total_dur = 0.0
    script_payload = {"product": tour["title"], "steps": []}

    for i, step in enumerate(tour["steps"]):
        heading = step["heading"]
        vo = step["voiceover"]
        arrow = tuple(step.get("arrow") or (1400, 700))
        script_payload["steps"].append({"heading": heading, "voiceover": vo})

        frame = work / f"frame_{i}.png"
        kind = step.get("kind", "brand")

        if kind == "capture":
            path = step.get("path") or tour.get("path") or "/"
            url = BASE_URL + path
            raw = work / f"raw_{i}.png"
            ok = _capture_page(url, raw)
            if ok:
                _overlay_arrow_on_image(raw, arrow, frame, caption=heading)
            else:
                _render_brand_frame(heading, vo, arrow, frame)
        else:
            _render_brand_frame(heading, vo, arrow, frame)

        audio = work / f"vo_{i}.mp3"
        try:
            dur = _voiceover(vo, audio)
        except Exception as e:
            logger.error(f"VO failed step {i}: {e}")
            return {"status": "error", "detail": f"Voice-over failed: {e}"}

        clip = work / f"clip_{i}.mp4"
        _make_clip(frame, audio, dur, clip)
        clips.append(clip)
        total_dur += dur

    concat = work / "concat.txt"
    with open(concat, "w") as f:
        for c in clips:
            f.write(f"file '{c.name}'\n")

    final_name = f"{video_id}.mp4"
    final_path = DEMOS_DIR / final_name
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(final_path)],
        check=True,
        capture_output=True,
        cwd=str(work),
    )

    thumb_name = f"{video_id}_thumb.png"
    thumb_path = DEMOS_DIR / thumb_name
    first_frame = work / "frame_0.png"
    if first_frame.exists():
        shutil.copy2(first_frame, thumb_path)

    size = final_path.stat().st_size if final_path.exists() else 0
    shutil.rmtree(work, ignore_errors=True)

    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        """INSERT INTO product_demo_videos
           (id, product_key, title, script, video_path, thumbnail_path,
            duration_seconds, file_size_bytes, voice, pointer_style, status, website_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            video_id,
            tour["product_key"],
            tour["title"],
            json.dumps(script_payload),
            final_name,
            thumb_name,
            total_dur,
            size,
            "adam",
            "green_arrow",
            "generated",
            website_id,
            now,
        ),
    )
    try:
        db.commit()
    except Exception:
        pass

    return {
        "status": "success",
        "id": video_id,
        "product_key": tour["product_key"],
        "title": tour["title"],
        "duration_seconds": total_dur,
        "file_size_bytes": size,
        "pointer_style": "green_arrow",
        "voice": "adam",
    }


def list_tour_catalog() -> List[Dict[str, str]]:
    return [
        {
            "product_key": t["product_key"],
            "title": t["title"],
            "path": t.get("path", ""),
            "steps": len(t["steps"]),
        }
        for t in TOURS
    ]


def generate_all_product_tours(db, website_id: str = "ls") -> Dict[str, Any]:
    results = []
    for t in TOURS:
        try:
            r = generate_product_tour(db, t["product_key"], website_id=website_id)
            results.append(r)
        except Exception as e:
            logger.error(f"Tour {t['product_key']} failed: {e}", exc_info=True)
            results.append({"status": "error", "product_key": t["product_key"], "detail": str(e)[:300]})
    ok = sum(1 for r in results if r.get("status") == "success")
    return {"status": "complete", "generated": ok, "total": len(TOURS), "results": results}
