"""Finish Motion Analyzer explainer from an existing Playwright webm (skip re-record)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from record_motion_analyzer_explainer import (  # noqa: E402
    DEMOS_DIR,
    STEPS,
    _build_vo_track,
    _mux,
)

# Prefer newest webm under product_demos
def find_webm() -> Path:
    root = DEMOS_DIR
    webs = sorted(root.rglob("*.webm"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not webs:
        raise SystemExit("No webm found under product_demos")
    print("Using", webs[0])
    return webs[0]


def main() -> int:
    raw = find_webm()
    work = DEMOS_DIR / f"ma_finish_{uuid.uuid4().hex[:8]}"
    work.mkdir(parents=True, exist_ok=True)

    silent_mp4 = work / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent_mp4)],
        check=True, capture_output=True,
    )
    print("Silent mp4 ready", silent_mp4.stat().st_size)

    # Shorter VO for quota / reliability
    short_steps = [
        {**s, "vo": s["vo"][:220], "hold": min(s["hold"], 4.0)} for s in STEPS
    ]
    # temporarily patch STEPS used by _build_vo_track via monkeypatch
    import record_motion_analyzer_explainer as rec

    rec.STEPS = short_steps
    vo_path, vo_dur = rec._build_vo_track(work)
    print("VO", vo_dur, vo_path)

    video_id = str(uuid.uuid4())
    final_name = f"{video_id}.mp4"
    final_path = DEMOS_DIR / final_name
    _mux(silent_mp4, vo_path, final_path)

    thumb_name = f"{video_id}_thumb.png"
    thumb_path = DEMOS_DIR / thumb_name
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(final_path), "-ss", "3", "-vframes", "1", str(thumb_path)],
        check=True, capture_output=True,
    )
    size = final_path.stat().st_size
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(final_path)],
        capture_output=True, text=True,
    )
    try:
        dur = float(r.stdout.strip())
    except ValueError:
        dur = vo_dur

    from app.database import get_db
    from app.services.product_tour_generator import ensure_schema

    with get_db() as db:
        ensure_schema(db)
        db.execute(
            """INSERT INTO product_demo_videos
               (id, product_key, title, script, video_path, thumbnail_path,
                duration_seconds, file_size_bytes, voice, pointer_style, status, website_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                video_id,
                "motion_analyzer_real",
                "Motion Analyzer — Live Walkthrough (Real UI)",
                json.dumps({"type": "real_ui", "steps": short_steps}),
                final_name,
                thumb_name,
                dur,
                size,
                "adam_or_onyx",
                "green_arrow",
                "generated",
                "ls",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        try:
            db.commit()
        except Exception:
            pass

    print("SUCCESS", video_id, final_path, size, dur)
    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
