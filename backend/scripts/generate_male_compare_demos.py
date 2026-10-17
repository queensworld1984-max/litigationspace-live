"""Generate attorney-like male demos for voice comparison page."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.tts_elevenlabs import synthesize_speech

OUT = Path("/var/www/litigationspace-staging/data/voice_demos")
PUBLIC = Path("/var/www/litigationspace-staging/frontend/voice-demos")

SCRIPT = (
    "Welcome to LitigationSpace — the operating system for litigation. "
    "From Case Vault and War Room to Legal Brain, Motion Analyzer, and Live Bench, "
    "we help attorneys organize evidence, craft stronger arguments, and win with clarity. "
    "Strategy. Evidence. Victory. Start today at litigationspace.com."
)

# voice_id, file slug, display title, description
# Only premade voices that work on free-tier API (no paid library voices).
VOICES = [
    # ── Male ──────────────────────────────────────────────────────────────
    (
        "pNInz6obpgDQGcFmaJgB",
        "adam_classic",
        "Male · Adam",
        "Dominant, firm American male · attorney product-demo style",
    ),
    (
        "cjVigY5qzO86Huf0OWal",
        "eric",
        "Male · Eric",
        "Smooth, trustworthy American male",
    ),
    (
        "nPczCjzI2devNBz1zQrb",
        "brian",
        "Male · Brian",
        "Deep, resonant American male",
    ),
    # ── Female — confident & professional ─────────────────────────────────
    (
        "EXAVITQu4vr4xnSDxMaL",
        "sarah",
        "Female · Sarah",
        "Mature, reassuring, confident · professional American",
    ),
    (
        "XrExE9yKIg1WjnnlVkGX",
        "matilda",
        "Female · Matilda",
        "Knowledgeable, professional · upbeat American",
    ),
    (
        "hpp4J3VqNfWAUOO0d1Us",
        "bella",
        "Female · Bella",
        "Professional, bright, warm · informative American",
    ),
    (
        "Xb7hH8MSUJpSbSDYk0k2",
        "alice",
        "Female · Alice",
        "Clear, engaging educator · professional British",
    ),
    (
        "cgSgspJ2msm6clMCkdW9",
        "jessica",
        "Female · Jessica",
        "Playful but polished · bright American (lighter option)",
    ),
]


def duration(path: Path) -> float:
    r = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    cards = []
    errors = []

    for vid, slug, title, desc in VOICES:
        path = OUT / f"demo_elevenlabs_{slug}.mp3"
        try:
            d = synthesize_speech(SCRIPT, path, voice=vid)
            print(f"OK {slug} id={vid} bytes={path.stat().st_size} duration={d:.1f}")
            cards.append(
                f"""
            <div class="card">
              <h2>{title}</h2>
              <p class="desc">{desc}</p>
              <p class="meta">{d:.1f}s · {path.stat().st_size // 1024} KB · <code>{vid}</code></p>
              <audio controls preload="metadata" src="{path.name}"></audio>
              <p><a href="{path.name}" download>Download MP3</a></p>
            </div>
            """
            )
        except Exception as e:
            msg = str(e)[:300]
            print(f"FAIL {slug} id={vid}: {msg}")
            errors.append((title, vid, msg))
            cards.append(
                f"""
            <div class="card fail">
              <h2>{title}</h2>
              <p class="desc">{desc}</p>
              <p class="meta fail">Could not generate · <code>{vid}</code></p>
              <p class="err">{msg}</p>
            </div>
            """
            )

    err_note = ""
    if errors:
        err_note = (
            "<div class='note'><strong>Some voices failed</strong> (often paid/library voices on free plans). "
            "Successful samples are playable below.</div>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LitigationSpace — Male Voice Demos</title>
  <style>
    body {{ font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3;
           max-width: 760px; margin: 40px auto; padding: 0 20px; }}
    h1 {{ color: #F5A623; font-size: 1.35rem; }}
    .sub {{ color: #8b949e; font-size: 0.9rem; line-height: 1.5; margin-bottom: 18px; }}
    .note {{ background: rgba(245,166,35,0.1); border: 1px solid rgba(245,166,35,0.3);
             border-radius: 10px; padding: 12px 14px; color: #e6c07b; font-size: 0.84rem;
             line-height: 1.45; margin-bottom: 18px; }}
    .card {{ background: #161b22; border: 1px solid #30363d; border-radius: 12px;
             padding: 18px 20px; margin-bottom: 14px; }}
    .card.fail {{ border-color: rgba(248,113,113,0.4); opacity: 0.9; }}
    .card h2 {{ margin: 0 0 6px; font-size: 1.02rem; }}
    .desc {{ margin: 0 0 8px; color: #8b949e; font-size: 0.84rem; }}
    .meta {{ margin: 0 0 12px; color: #F5A623; font-size: 0.78rem; font-weight: 700; }}
    .meta.fail {{ color: #f87171; }}
    .err {{ color: #fca5a5; font-size: 0.78rem; word-break: break-word; }}
    code {{ font-size: 0.72rem; color: #93c5fd; }}
    audio {{ width: 100%; }}
    a {{ color: #58a6ff; }}
    .script {{ background: #21262d; border-radius: 8px; padding: 14px; font-size: 0.84rem;
               color: #c9d1d9; line-height: 1.55; margin-bottom: 20px; }}
  </style>
</head>
<body>
  <h1>LitigationSpace — Voice demos (male &amp; female)</h1>
  <p class="sub">Confident professional narrators for product tours. Play each sample, then reply with your pick.</p>
  {err_note}
  <div class="script"><strong>Same script for all:</strong><br/>{SCRIPT}</div>
  {''.join(cards)}
</body>
</html>
"""
    (OUT / "index.html").write_text(html, encoding="utf-8")
    for f in OUT.iterdir():
        if f.is_file():
            shutil.copy2(f, PUBLIC / f.name)
            os.chmod(PUBLIC / f.name, 0o644)
    print("Published", PUBLIC)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
