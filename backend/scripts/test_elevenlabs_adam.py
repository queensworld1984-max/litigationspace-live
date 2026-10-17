"""Smoke test: ElevenLabs Adam voiceover."""
import os
import sys
from pathlib import Path

# Ensure backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tts_elevenlabs import (  # noqa: E402
    elevenlabs_configured,
    synthesize_speech,
    voice_id,
)


def main() -> int:
    print("configured", elevenlabs_configured())
    print("voice_id", voice_id())
    if not elevenlabs_configured():
        print("FAIL: ELEVENLABS_API_KEY missing")
        return 1
    out = Path("/tmp/ls_adam_test.mp3")
    text = "Welcome to LitigationSpace. Strategy. Evidence. Victory."
    dur = synthesize_speech(text, out)
    print("ok bytes", out.stat().st_size, "duration", round(dur, 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
