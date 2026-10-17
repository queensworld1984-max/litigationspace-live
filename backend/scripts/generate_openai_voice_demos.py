"""Generate OpenAI male American voice demos only (retry-friendly)."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

from openai import OpenAI

# Shorter script reduces OpenAI rate-limit failures; still comparable to Adam sample.
SCRIPT = (
    "Welcome to LitigationSpace — the operating system for litigation. "
    "From Case Vault and Legal Brain to Motion Analyzer and Live Bench, "
    "we help attorneys organize evidence and win with clarity. "
    "Strategy. Evidence. Victory."
)

OUT = Path("/var/www/litigationspace-staging/data/voice_demos")


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
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("FAIL: OPENAI_API_KEY missing")
        return 1
    client = OpenAI(api_key=api_key)
    ok = 0
    for voice in ("onyx", "echo"):
        path = OUT / f"demo_openai_{voice}.mp3"
        for attempt in range(4):
            try:
                resp = client.audio.speech.create(
                    model="tts-1",
                    voice=voice,
                    input=SCRIPT,
                )
                resp.stream_to_file(str(path))
                d = duration(path)
                print(f"OK openai_{voice} bytes={path.stat().st_size} duration={d:.1f}")
                ok += 1
                break
            except Exception as e:
                print(f"retry {voice} attempt={attempt}: {e}")
                time.sleep(2 + attempt * 3)
        else:
            print(f"FAIL openai_{voice}")
        time.sleep(1.5)

    # Refresh HTML compare page if Adam exists
    adam = OUT / "demo_elevenlabs_adam.mp3"
    cards = []
    items = []
    if adam.exists():
        items.append(("ElevenLabs — Adam", "Attorney-style deep American male", adam, "demo_elevenlabs_adam.mp3"))
    for voice, label, desc in (
        ("onyx", "OpenAI — Onyx", "Deep American male (serious / courtroom)"),
        ("echo", "OpenAI — Echo", "Clear American male (crisp explainer)"),
    ):
        p = OUT / f"demo_openai_{voice}.mp3"
        if p.exists():
            items.append((label, desc, p, p.name))

    for title, desc, p, fname in items:
        d = duration(p)
        cards.append(
            f"""
            <div class="card">
              <h2>{title}</h2>
              <p class="desc">{desc}</p>
              <p class="meta">{d:.1f}s · {p.stat().st_size // 1024} KB</p>
              <audio controls preload="metadata" src="{fname}"></audio>
              <p><a href="{fname}" download>Download MP3</a></p>
            </div>
            """
        )

    (OUT / "index.html").write_text(
        f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LitigationSpace — Voice Demo Compare</title>
  <style>
    body {{ font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3;
           max-width: 720px; margin: 40px auto; padding: 0 20px; }}
    h1 {{ color: #F5A623; font-size: 1.4rem; }}
    .sub {{ color: #8b949e; font-size: 0.9rem; line-height: 1.5; margin-bottom: 28px; }}
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
  <p class="sub">Same script, male American voices. Play each and tell us which to use for product tours.</p>
  <div class="script"><strong>Script used:</strong><br/>{SCRIPT}</div>
  {''.join(cards) if cards else '<p>No demos generated.</p>'}
</body>
</html>
""",
        encoding="utf-8",
    )
    print("HTML refreshed")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
