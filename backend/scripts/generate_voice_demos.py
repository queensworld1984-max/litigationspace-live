"""Generate side-by-side voice demos: ElevenLabs Adam vs OpenAI American male."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SCRIPT = (
    "Welcome to LitigationSpace — the operating system for litigation. "
    "From Case Vault and War Room to Legal Brain, Motion Analyzer, and Live Bench, "
    "we help attorneys organize evidence, craft stronger arguments, and win with clarity. "
    "Strategy. Evidence. Victory. Start today at litigationspace.com."
)

OUT_DIR = Path(os.environ.get("VOICE_DEMO_DIR", "/var/www/litigationspace-staging/data/voice_demos"))


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []

    # ── 1) ElevenLabs Adam ──────────────────────────────────────────────
    try:
        from app.services.tts_elevenlabs import synthesize_speech, voice_id

        adam_path = OUT_DIR / "demo_elevenlabs_adam.mp3"
        dur = synthesize_speech(SCRIPT, adam_path)
        results.append(("elevenlabs_adam", str(adam_path), adam_path.stat().st_size, dur, voice_id()))
        print(f"OK ElevenLabs Adam: {adam_path} ({dur:.1f}s, {adam_path.stat().st_size} bytes)")
    except Exception as e:
        print(f"FAIL ElevenLabs: {e}")
        results.append(("elevenlabs_adam", None, 0, 0, str(e)))

    # ── 2) OpenAI American male (onyx = deep male; echo = clear American male) ──
    # Produce both onyx and echo so user can pick preference; primary "american man" = echo + onyx
    try:
        from openai import OpenAI

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        client = OpenAI(api_key=api_key)

        for voice in ("onyx", "echo"):
            path = OUT_DIR / f"demo_openai_{voice}.mp3"
            resp = client.audio.speech.create(
                model="tts-1-hd",
                voice=voice,
                input=SCRIPT,
            )
            resp.stream_to_file(str(path))
            # duration via ffprobe
            import subprocess

            r = subprocess.run(
                [
                    "ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1", str(path),
                ],
                capture_output=True, text=True,
            )
            try:
                dur = float(r.stdout.strip())
            except ValueError:
                dur = 0.0
            results.append((f"openai_{voice}", str(path), path.stat().st_size, dur, voice))
            print(f"OK OpenAI {voice}: {path} ({dur:.1f}s, {path.stat().st_size} bytes)")
    except Exception as e:
        print(f"FAIL OpenAI: {e}")
        results.append(("openai", None, 0, 0, str(e)))

    # Write a simple HTML compare page
    html_path = OUT_DIR / "index.html"
    cards = []
    labels = {
        "elevenlabs_adam": ("ElevenLabs — Adam", "Attorney-style deep American male (default for product demos)"),
        "openai_onyx": ("OpenAI — Onyx", "Deep American male (serious / courtroom)"),
        "openai_echo": ("OpenAI — Echo", "Clear American male (crisp explainer)"),
    }
    for key, path, size, dur, meta in results:
        if not path or not Path(path).exists():
            continue
        title, desc = labels.get(key, (key, meta))
        fname = Path(path).name
        cards.append(
            f"""
            <div class="card">
              <h2>{title}</h2>
              <p class="desc">{desc}</p>
              <p class="meta">{dur:.1f}s · {size // 1024} KB</p>
              <audio controls preload="metadata" src="{fname}"></audio>
              <p><a href="{fname}" download>Download MP3</a></p>
            </div>
            """
        )

    html_path.write_text(
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
  <p class="sub">Same script, three male American voices. Play each and pick your preferred narrator for product tours.</p>
  <div class="script"><strong>Script used:</strong><br/>{SCRIPT}</div>
  {''.join(cards) if cards else '<p>No demos generated.</p>'}
</body>
</html>
""",
        encoding="utf-8",
    )
    print(f"HTML {html_path}")
    print("DONE")
    return 0 if any(p for _, p, _, _, _ in results if p) else 1


if __name__ == "__main__":
    raise SystemExit(main())
