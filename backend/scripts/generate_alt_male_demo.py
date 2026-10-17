"""Generate second male ElevenLabs voice (Josh) + refresh compare page. OpenAI may be down."""
from __future__ import annotations

import os
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

# Josh — clear American male (good attorney explainer contrast to Adam)
JOSH_ID = "TxGEqnHWrfWFTfGW9XjX"


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

    josh = OUT / "demo_elevenlabs_josh.mp3"
    d = synthesize_speech(SCRIPT, josh, voice=JOSH_ID)
    print(f"OK Josh bytes={josh.stat().st_size} duration={d:.1f}")

    # Try OpenAI once more with short text
    openai_ok = []
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from openai import OpenAI
            import time

            client = OpenAI(api_key=api_key)
            short = (
                "Welcome to LitigationSpace. Strategy. Evidence. Victory. "
                "We help attorneys organize cases and win with clarity."
            )
            for voice in ("onyx", "echo"):
                path = OUT / f"demo_openai_{voice}.mp3"
                for attempt in range(2):
                    try:
                        resp = client.audio.speech.create(
                            model="tts-1", voice=voice, input=short
                        )
                        resp.stream_to_file(str(path))
                        print(f"OK openai_{voice} bytes={path.stat().st_size}")
                        openai_ok.append(voice)
                        break
                    except Exception as e:
                        print(f"openai {voice} attempt {attempt}: {e}")
                        time.sleep(5)
        except Exception as e:
            print(f"OpenAI skip: {e}")

    items = []
    adam = OUT / "demo_elevenlabs_adam.mp3"
    if adam.exists():
        items.append(
            (
                "ElevenLabs — Adam",
                "Deep American male · attorney / product-demo style (recommended default)",
                adam,
            )
        )
    if josh.exists():
        items.append(
            (
                "ElevenLabs — Josh",
                "Clear American male · crisp explainer style (alt male)",
                josh,
            )
        )
    for voice, label, desc in (
        ("onyx", "OpenAI — Onyx", "Deep American male (OpenAI)"),
        ("echo", "OpenAI — Echo", "Clear American male (OpenAI)"),
    ):
        p = OUT / f"demo_openai_{voice}.mp3"
        if p.exists() and p.stat().st_size > 1000:
            items.append((label, desc, p))

    cards = []
    for title, desc, p in items:
        cards.append(
            f"""
            <div class="card">
              <h2>{title}</h2>
              <p class="desc">{desc}</p>
              <p class="meta">{duration(p):.1f}s · {p.stat().st_size // 1024} KB</p>
              <audio controls preload="metadata" src="{p.name}"></audio>
              <p><a href="{p.name}" download>Download MP3</a></p>
            </div>
            """
        )

    note = ""
    if not openai_ok:
        note = (
            "<p class='note'><strong>Note:</strong> OpenAI TTS is currently returning "
            "server errors (500/503) from their API. We included a second ElevenLabs "
            "male voice (Josh) so you can still compare two attorney-style American men. "
            "We will re-run OpenAI when their TTS recovers.</p>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LitigationSpace — Voice Demo Compare</title>
  <style>
    body {{ font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3;
           max-width: 720px; margin: 40px auto; padding: 0 20px; }}
    h1 {{ color: #F5A623; font-size: 1.4rem; }}
    .sub {{ color: #8b949e; font-size: 0.9rem; line-height: 1.5; margin-bottom: 20px; }}
    .note {{ background: rgba(245,166,35,0.12); border: 1px solid rgba(245,166,35,0.35);
             border-radius: 10px; padding: 12px 14px; color: #e6c07b; font-size: 0.85rem;
             line-height: 1.45; margin-bottom: 20px; }}
    .card {{ background: #161b22; border: 1px solid #30363d; border-radius: 12px;
             padding: 18px 20px; margin-bottom: 16px; }}
    .card h2 {{ margin: 0 0 6px; font-size: 1.05rem; color: #f0f6fc; }}
    .desc {{ margin: 0 0 8px; color: #8b949e; font-size: 0.85rem; }}
    .meta {{ margin: 0 0 12px; color: #F5A623; font-size: 0.8rem; font-weight: 600; }}
    audio {{ width: 100%; margin-bottom: 8px; }}
    a {{ color: #58a6ff; }}
    .script {{ background: #21262d; border-radius: 8px; padding: 14px; font-size: 0.85rem;
               color: #c9d1d9; line-height: 1.55; margin-bottom: 24px; }}
  </style>
</head>
<body>
  <h1>LitigationSpace — Voice demo compare</h1>
  <p class="sub">Male American narrators for product tours. Play each and reply with your pick.</p>
  {note}
  <div class="script"><strong>Script:</strong><br/>{SCRIPT}</div>
  {''.join(cards)}
</body>
</html>
"""
    (OUT / "index.html").write_text(html, encoding="utf-8")
    for f in OUT.iterdir():
        if f.is_file():
            dest = PUBLIC / f.name
            dest.write_bytes(f.read_bytes())
            os.chmod(dest, 0o644)
    print("PUBLIC", PUBLIC)
    print("DONE openai_ok", openai_ok)
    return 0


if __name__ == "__main__":
    import os

    raise SystemExit(main())
