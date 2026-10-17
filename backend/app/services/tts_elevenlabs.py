"""
ElevenLabs text-to-speech helper for LitigationSpace marketing / product demos.

Default voice: Adam (premade) — voice_id pNInz6obpgDQGcFmaJgB
Configure via env:
  ELEVENLABS_API_KEY   (required)
  ELEVENLABS_VOICE_ID  (optional, default Adam)
  ELEVENLABS_MODEL_ID  (optional, default eleven_multilingual_v2)
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Classic ElevenLabs premade "Adam" (American male narrator).
# Override with ELEVENLABS_VOICE_ID if needed.
DEFAULT_ADAM_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"

# Premade voices that work on free-tier API (no paid library voices).
KNOWN_MALE_VOICES = {
    "adam": "pNInz6obpgDQGcFmaJgB",
    "eric": "cjVigY5qzO86Huf0OWal",
    "brian": "nPczCjzI2devNBz1zQrb",
}

KNOWN_FEMALE_VOICES = {
    "sarah": "EXAVITQu4vr4xnSDxMaL",      # Mature, reassuring, confident
    "matilda": "XrExE9yKIg1WjnnlVkGX",   # Knowledgeable, professional
    "bella": "hpp4J3VqNfWAUOO0d1Us",      # Professional, bright, warm
    "alice": "Xb7hH8MSUJpSbSDYk0k2",      # Clear educator (British)
    "jessica": "cgSgspJ2msm6clMCkdW9",    # Bright, polished
}


def elevenlabs_configured() -> bool:
    return bool((os.environ.get("ELEVENLABS_API_KEY") or "").strip())


def voice_id() -> str:
    return (os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_ADAM_VOICE_ID).strip()


def model_id() -> str:
    return (os.environ.get("ELEVENLABS_MODEL_ID") or DEFAULT_MODEL_ID).strip()


def audio_duration_seconds(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def synthesize_speech(
    text: str,
    out_path: Path | str,
    *,
    voice: Optional[str] = None,
    model: Optional[str] = None,
    stability: float = 0.45,
    similarity_boost: float = 0.75,
    style: float = 0.15,
) -> float:
    """
    Synthesize `text` to an MP3 file using ElevenLabs.
    Returns audio duration in seconds (0 if ffprobe unavailable).
    Raises RuntimeError on missing key or API failure.
    """
    api_key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    text = (text or "").strip()
    if not text:
        raise ValueError("text is empty")

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    vid = (voice or voice_id()).strip()
    mid = (model or model_id()).strip()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}"

    payload = json.dumps({
        "text": text,
        "model_id": mid,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": style,
            "use_speaker_boost": True,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"ElevenLabs HTTP {e.code}: {body}") from e

    if not audio or len(audio) < 200:
        raise RuntimeError("ElevenLabs returned empty audio")

    out.write_bytes(audio)
    dur = audio_duration_seconds(out)
    logger.info("ElevenLabs TTS ok voice=%s bytes=%s duration=%.2fs path=%s", vid, len(audio), dur, out)
    return dur
