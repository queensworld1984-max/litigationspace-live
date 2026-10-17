import json
import os
import urllib.request

k = os.environ.get("ELEVENLABS_API_KEY", "")
req = urllib.request.Request(
    "https://api.elevenlabs.io/v1/voices",
    headers={"xi-api-key": k},
)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read())
voices = data.get("voices") or []
print("count", len(voices))
for v in voices:
    print(v.get("voice_id"), "|", v.get("name"), "|", v.get("category"), "|", (v.get("labels") or {}))
