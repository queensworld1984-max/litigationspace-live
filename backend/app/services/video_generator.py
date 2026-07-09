"""
Marketing explainer video generator.

Pipeline:
  1. OpenAI generates a short script broken into slides (title + voiceover line per slide)
  2. OpenAI TTS (tts-1) generates voiceover audio per slide
  3. PIL renders branded slide images (gold/dark theme matching LitigationSpace)
  4. FFmpeg combines slide images + audio into a single MP4, synced to audio duration
  5. Result saved to disk + recorded in marketing_videos table
"""
import os
import json
import uuid
import subprocess
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

VIDEOS_DIR = Path("/var/www/litigationspace-staging/data/marketing_videos")
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"

# Rotating list of platform features to cover, one per video
VIDEO_TOPICS = [
    {
        "name": "Motion Analyzer",
        "path": "/motion-analyzer",
        "summary": "Upload any motion and get an instant AI-powered strength score, weaknesses, and case law citations.",
    },
    {
        "name": "Legal Brain",
        "path": "/legal-brain",
        "summary": "Ask any legal research question and get instant AI-backed answers with citations across jurisdictions.",
    },
    {
        "name": "Win Probability Simulator",
        "path": "/win-simulator",
        "summary": "Predict your case outcome using AI analysis of judge history, venue, and motion strength.",
    },
    {
        "name": "Live Expert Bench",
        "path": "/live-bench",
        "summary": "Find and hire verified expert witnesses, paralegals, and legal consultants on demand.",
    },
    {
        "name": "Legal Database",
        "path": "/legal-database",
        "summary": "Search statutes, case law, and court rules across 12+ jurisdictions in one place.",
    },
    {
        "name": "Document Analyzer",
        "path": "/document-analyzer",
        "summary": "Upload a document and let AI extract arguments, key facts, and risks automatically.",
    },
    {
        "name": "AI Drafting Engine",
        "path": "/drafting",
        "summary": "Draft motions, briefs, and legal documents in minutes with AI assistance.",
    },
    {
        "name": "Case Vault & War Room",
        "path": "/cases",
        "summary": "Organize cases, evidence, deadlines, and build real-time litigation strategy.",
    },
]

GOLD = (245, 166, 35)
BG_DARK = (13, 17, 23)
WHITE = (255, 255, 255)
GRAY = (148, 163, 184)


def _get_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    from openai import OpenAI
    return OpenAI(api_key=api_key)


def _pick_topic(db) -> dict:
    """Pick the topic least recently used for a video."""
    row = db.execute(
        "SELECT topic FROM marketing_videos ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    last_topic = row["topic"] if row else None

    used = db.execute(
        "SELECT topic, MAX(created_at) as last_used FROM marketing_videos GROUP BY topic"
    ).fetchall()
    used_map = {r["topic"]: r["last_used"] for r in used}

    # Sort topics by last-used date (never used = oldest)
    def sort_key(t):
        return used_map.get(t["name"], "")

    sorted_topics = sorted(VIDEO_TOPICS, key=sort_key)
    pick = sorted_topics[0]
    if pick["name"] == last_topic and len(sorted_topics) > 1:
        pick = sorted_topics[1]
    return pick


def _generate_script(topic: dict) -> dict:
    """Use OpenAI to generate a slide-by-slide explainer script."""
    client = _get_openai_client()
    if not client:
        raise RuntimeError("OPENAI_API_KEY not configured")

    prompt = f"""Write a short (45-60 second) vertical video script explaining the "{topic['name']}" feature
of LitigationSpace, an AI litigation platform for attorneys. Feature summary: {topic['summary']}

Return JSON with this exact shape:
{{
  "title": "short catchy video title (max 60 chars)",
  "slides": [
    {{"heading": "short slide heading (max 40 chars)", "voiceover": "1-2 sentences of natural spoken narration"}},
    ...
  ]
}}

Rules:
- 5 to 7 slides total.
- First slide is a hook/intro. Last slide is a call-to-action ("Try it free at litigationspace.com").
- Voiceover lines should be natural, conversational, and concise (under 25 words each).
- Headings are short on-screen text, not full sentences.
"""

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.8,
    )
    data = json.loads(resp.choices[0].message.content)
    return data


def _generate_voiceover(client, text: str, out_path: Path) -> float:
    """Generate TTS audio for a slide, return duration in seconds."""
    response = client.audio.speech.create(
        model="tts-1",
        voice="onyx",
        input=text,
    )
    response.stream_to_file(str(out_path))

    # Get duration via ffprobe
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokeys=1", str(out_path)],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 4.0


def _render_slide_image(heading: str, body: str, slide_num: int, total: int, out_path: Path):
    """Render a 1080x1920 (vertical) branded slide image."""
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1080, 1920
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Top accent bar
    draw.rectangle([0, 0, W, 14], fill=GOLD)

    # Brand label
    font_brand = ImageFont.truetype(FONT_BOLD, 40)
    draw.text((60, 70), "LITIGATIONSPACE", font=font_brand, fill=GOLD)

    # Progress dots
    dot_y = 150
    for i in range(total):
        cx = 60 + i * 36
        color = GOLD if i == slide_num else (60, 65, 75)
        draw.ellipse([cx, dot_y, cx + 18, dot_y + 18], fill=color)

    # Heading (wrapped, centered vertically in upper-middle area)
    font_heading = ImageFont.truetype(FONT_BOLD, 88)
    heading_lines = _wrap_text(draw, heading, font_heading, W - 120)
    y = 600
    for line in heading_lines:
        bbox = draw.textbbox((0, 0), line, font=font_heading)
        w = bbox[2] - bbox[0]
        draw.text(((W - w) / 2, y), line, font=font_heading, fill=WHITE)
        y += (bbox[3] - bbox[1]) + 24

    # Body text
    font_body = ImageFont.truetype(FONT_REGULAR, 46)
    body_lines = _wrap_text(draw, body, font_body, W - 160)
    y += 60
    for line in body_lines:
        bbox = draw.textbbox((0, 0), line, font=font_body)
        w = bbox[2] - bbox[0]
        draw.text(((W - w) / 2, y), line, font=font_body, fill=GRAY)
        y += (bbox[3] - bbox[1]) + 18

    # Bottom URL bar
    font_url = ImageFont.truetype(FONT_BOLD, 42)
    url_text = "litigationspace.com"
    bbox = draw.textbbox((0, 0), url_text, font=font_url)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) / 2, H - 120), url_text, font=font_url, fill=GOLD)

    img.save(out_path)


def _wrap_text(draw, text, font, max_width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def generate_marketing_video(db, website_id: str = "ls") -> dict:
    """Full pipeline: pick topic, write script, generate audio + slides, render MP4.

    Returns the inserted marketing_videos row as a dict.
    """
    client = _get_openai_client()
    if not client:
        return {"status": "skipped", "reason": "OPENAI_API_KEY not configured"}

    topic = _pick_topic(db)
    script = _generate_script(topic)

    video_id = str(uuid.uuid4())
    work_dir = VIDEOS_DIR / video_id
    work_dir.mkdir(parents=True, exist_ok=True)

    slides = script["slides"]
    total = len(slides)
    concat_lines = []

    for i, slide in enumerate(slides):
        heading = slide["heading"]
        voiceover = slide["voiceover"]

        audio_path = work_dir / f"slide_{i}.mp3"
        duration = _generate_voiceover(client, voiceover, audio_path)
        # Add 0.4s padding so slides don't feel rushed
        duration += 0.4

        image_path = work_dir / f"slide_{i}.png"
        _render_slide_image(heading, voiceover, i, total, image_path)

        concat_lines.append((image_path, audio_path, duration))

    # Build per-slide video clips, then concat
    clip_paths = []
    for i, (image_path, audio_path, duration) in enumerate(concat_lines):
        clip_path = work_dir / f"clip_{i}.mp4"
        subprocess.run([
            "ffmpeg", "-y",
            "-loop", "1", "-i", str(image_path),
            "-i", str(audio_path),
            "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-t", str(duration),
            "-vf", "scale=1080:1920",
            str(clip_path),
        ], check=True, capture_output=True)
        clip_paths.append(clip_path)

    # Concat list file
    concat_file = work_dir / "concat.txt"
    with open(concat_file, "w") as f:
        for cp in clip_paths:
            f.write(f"file '{cp.name}'\n")

    final_filename = f"{video_id}.mp4"
    final_path = VIDEOS_DIR / final_filename
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-c", "copy",
        str(final_path),
    ], check=True, capture_output=True, cwd=str(work_dir))

    # Thumbnail = first slide image
    thumb_filename = f"{video_id}_thumb.png"
    thumb_path = VIDEOS_DIR / thumb_filename
    if clip_paths:
        os.replace(work_dir / "slide_0.png", thumb_path)

    # Total duration + file size
    total_duration = sum(d for _, _, d in concat_lines)
    file_size = final_path.stat().st_size

    # Cleanup work dir
    import shutil
    shutil.rmtree(work_dir, ignore_errors=True)

    title = script.get("title", topic["name"])

    db.execute(
        """INSERT INTO marketing_videos
           (id, title, topic, script, video_path, thumbnail_path, duration_seconds, file_size_bytes, status, website_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?)""",
        (video_id, title, topic["name"], json.dumps(script),
         final_filename, thumb_filename, total_duration, file_size,
         website_id, datetime.now(timezone.utc).isoformat())
    )
    db.commit()

    return {
        "status": "success",
        "id": video_id,
        "title": title,
        "topic": topic["name"],
        "duration_seconds": total_duration,
        "file_size_bytes": file_size,
    }
