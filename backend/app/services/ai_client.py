"""
Unified AI client supporting both Claude (Anthropic) and OpenAI.
Claude is the primary engine for legal drafting.
OpenAI remains as fallback for existing features.
"""
import os
import json
import logging
import httpx
from typing import Optional

logger = logging.getLogger("ai_client")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# Claude model — using latest sonnet for legal drafting
CLAUDE_MODEL = "claude-sonnet-4-20250514"
OPENAI_MODEL      = "gpt-5.4"       # paid users (admin, attorney)
OPENAI_MODEL_FREE = "gpt-5.4-mini"  # free users (paralegal, client)


def get_openai_model(is_paid: bool = True) -> str:
    """Return the appropriate OpenAI model based on subscription tier."""
    return OPENAI_MODEL if is_paid else OPENAI_MODEL_FREE


def get_model_for_user(user: dict, task_type: str = "reasoning") -> str:
    """Return the correct model for a given user and task type.

    task_type="simple"    → gpt-4o (text extraction, OCR, simple formatting only)
    task_type="reasoning" → gpt-5.4 for premium, gpt-5.4-mini for free

    Premium = role in (admin, attorney) OR status in (ACTIVE, PREMIUM, PRO, READY)
    Free    = role in (paralegal, expert_pending) OR status in (LOCKED,) or anything else
    """
    if task_type == "simple":
        return "gpt-4o"

    role = (user.get("role") or "").lower()
    status = (user.get("status") or "").upper()

    is_premium = (
        role in ("admin", "attorney")
        or status in ("ACTIVE", "PREMIUM", "PRO", "READY")
    )
    return OPENAI_MODEL if is_premium else OPENAI_MODEL_FREE


async def call_claude(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.3,
) -> str:
    """Call Anthropic Claude API. Returns text response."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    async with httpx.AsyncClient(timeout=1800.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": CLAUDE_MODEL,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}],
            },
        )
        if resp.status_code != 200:
            logger.error(f"Claude API error {resp.status_code}: {resp.text[:500]}")
            raise RuntimeError(f"Claude API error: {resp.status_code}")
        data = resp.json()
        # Extract text from content blocks
        content_blocks = data.get("content", [])
        text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
        return "\n".join(text_parts).strip()


async def call_claude_json(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.2,
) -> dict:
    """Call Claude and parse JSON response. Strips markdown fences if present."""
    raw = await call_claude(system_prompt, user_message, max_tokens, temperature)

    # Strip markdown code fences
    import re
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
    raw = re.sub(r'\n?```\s*$', '', raw.strip())

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to find JSON object in the response
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse Claude JSON response: {raw[:500]}")
        raise RuntimeError("Claude returned invalid JSON")


async def call_openai(
    messages: list,
    max_tokens: int = 4000,
    temperature: float = 0.3,
    model: str = None,
) -> str:
    """Call OpenAI chat completions API. Kept as fallback."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")

    async with httpx.AsyncClient(timeout=1800.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model or OPENAI_MODEL,
                "messages": messages,
                "max_completion_tokens": max_tokens,
                "temperature": temperature,
            },
        )
        if resp.status_code != 200:
            logger.error(f"OpenAI API error {resp.status_code}: {resp.text[:500]}")
            raise RuntimeError(f"OpenAI API error: {resp.status_code}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def call_openai_json(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 4000,
    temperature: float = 0.2,
) -> dict:
    """Call OpenAI and parse JSON response. Uses GPT-4o for structured output."""
    import re
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    raw = await call_openai(messages, max_tokens, temperature)

    # Strip markdown code fences
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
    raw = re.sub(r'\n?```\s*$', '', raw.strip())

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        # Try to find JSON array
        match = re.search(r'\[[\s\S]*\]', raw)
        if match:
            try:
                return {"items": json.loads(match.group(0))}
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse OpenAI JSON response: {raw[:500]}")
        raise RuntimeError("OpenAI returned invalid JSON")


def call_claude_sync(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.3,
) -> str:
    """Synchronous call to Anthropic Claude API. Returns text response.
    Used by legal_brain.py which has synchronous helper functions."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    with httpx.Client(timeout=1800.0) as client:
        resp = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": CLAUDE_MODEL,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}],
            },
        )
        if resp.status_code != 200:
            logger.error(f"Claude API error {resp.status_code}: {resp.text[:500]}")
            raise RuntimeError(f"Claude API error: {resp.status_code}")
        data = resp.json()
        content_blocks = data.get("content", [])
        text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
        return "\n".join(text_parts).strip()


def call_claude_json_sync(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.2,
) -> dict:
    """Synchronous call to Claude and parse JSON response."""
    import re
    raw = call_claude_sync(system_prompt, user_message, max_tokens, temperature)

    # Strip markdown code fences
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
    raw = re.sub(r'\n?```\s*$', '', raw.strip())

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse Claude JSON response: {raw[:500]}")
        raise RuntimeError("Claude returned invalid JSON")


def call_openai_sync(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.3,
    model: str = None,
) -> str:
    """Synchronous call to OpenAI chat completions API. Returns text response.
    Used by legal_brain.py which has synchronous helper functions."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")

    with httpx.Client(timeout=1800.0) as client:
        resp = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model or OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "max_completion_tokens": max_tokens,
                "temperature": temperature,
            },
        )
        if resp.status_code != 200:
            logger.error(f"OpenAI API error {resp.status_code}: {resp.text[:500]}")
            raise RuntimeError(f"OpenAI API error: {resp.status_code}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]


def call_openai_json_sync(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 8000,
    temperature: float = 0.2,
) -> dict:
    """Synchronous call to OpenAI and parse JSON response."""
    import re
    raw = call_openai_sync(system_prompt, user_message, max_tokens, temperature)

    # Strip markdown code fences
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw.strip())
    raw = re.sub(r'\n?```\s*$', '', raw.strip())

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse OpenAI JSON response: {raw[:500]}")
        raise RuntimeError("OpenAI returned invalid JSON")


def get_ai_provider() -> str:
    """Return the best available AI provider."""
    if OPENAI_API_KEY:
        return "openai"
    if ANTHROPIC_API_KEY:
        return "claude"
    return "none"
