"""
OpenAI request compatibility shim.

Newer models (e.g. gpt-5.5, used for paid users) reject non-default sampling
parameters such as `temperature`, and the legacy `max_tokens` name. The app sends
those from dozens of call sites (OpenAI SDK and raw httpx alike), so for those
models every call failed and features silently fell back or errored.

Both the SDK and the raw calls go through httpx, so this hooks httpx.Client.send /
httpx.AsyncClient.send for POSTs to api.openai.com .../chat/completions:
  - if OpenAI answers 400 naming one of the parameters, the request is re-sent
    without it (max_tokens is renamed to max_completion_tokens);
  - the model is remembered so later requests are adjusted before sending.

Imported once at startup from app.main.
"""
from __future__ import annotations

import json
import logging

import httpx

log = logging.getLogger(__name__)

_SAMPLING = ("temperature", "top_p", "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs")
# model -> set of parameter names that model rejects
_REJECTED: dict[str, set[str]] = {}


def _is_chat(request: httpx.Request) -> bool:
    return (request.method == "POST" and request.url.host == "api.openai.com"
            and request.url.path.endswith("/chat/completions"))


def _body(request: httpx.Request) -> dict | None:
    try:
        return json.loads(request.content or b"{}")
    except Exception:
        return None


def _rebuild(request: httpx.Request, body: dict) -> httpx.Request:
    headers = {k: v for k, v in request.headers.items() if k.lower() != "content-length"}
    return httpx.Request(request.method, request.url, headers=headers, content=json.dumps(body).encode(),
                         extensions=request.extensions)


def _apply(body: dict, params: set[str]) -> bool:
    changed = False
    for p in params:
        if p == "max_tokens":
            if "max_tokens" in body:
                body.setdefault("max_completion_tokens", body.pop("max_tokens"))
                changed = True
        elif p in body:
            body.pop(p)
            changed = True
    return changed


def _preadjust(request: httpx.Request) -> httpx.Request:
    body = _body(request)
    if not body:
        return request
    known = _REJECTED.get(body.get("model", ""))
    if known and _apply(body, known):
        return _rebuild(request, body)
    return request


def _rejected_params(text: str, body: dict) -> set[str]:
    found = {p for p in _SAMPLING if p in body and f"'{p}'" in text}
    if "max_tokens" in body and "'max_tokens'" in text:
        found.add("max_tokens")
    return found


def _retry_request(request: httpx.Request, text: str) -> httpx.Request | None:
    body = _body(request)
    if not body:
        return None
    params = _rejected_params(text, body)
    if not params:
        return None
    model = body.get("model", "")
    _REJECTED.setdefault(model, set()).update(params)
    log.warning("OpenAI model %s rejected %s; retrying without them", model, sorted(params))
    _apply(body, params)
    return _rebuild(request, body)


_orig_send = httpx.Client.send
_orig_asend = httpx.AsyncClient.send


def _send(self, request, *args, **kwargs):
    if not _is_chat(request):
        return _orig_send(self, request, *args, **kwargs)
    request = _preadjust(request)
    resp = _orig_send(self, request, *args, **kwargs)
    if resp.status_code == 400:
        resp.read()
        retry = _retry_request(request, resp.text)
        if retry is not None:
            resp.close()
            return _orig_send(self, retry, *args, **kwargs)
    return resp


async def _asend(self, request, *args, **kwargs):
    if not _is_chat(request):
        return await _orig_asend(self, request, *args, **kwargs)
    request = _preadjust(request)
    resp = await _orig_asend(self, request, *args, **kwargs)
    if resp.status_code == 400:
        await resp.aread()
        retry = _retry_request(request, resp.text)
        if retry is not None:
            await resp.aclose()
            return await _orig_asend(self, retry, *args, **kwargs)
    return resp


if not getattr(httpx.Client.send, "_ls_compat", False):
    _send._ls_compat = True  # type: ignore[attr-defined]
    _asend._ls_compat = True  # type: ignore[attr-defined]
    httpx.Client.send = _send  # type: ignore[assignment]
    httpx.AsyncClient.send = _asend  # type: ignore[assignment]
