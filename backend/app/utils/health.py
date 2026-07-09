"""
Health utilities:
  auto_resend_verification() — resend to unverified users after 24 h
  check_dns_health()         — alert if SPF/DKIM/DMARC are missing
"""
import subprocess
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

REQUIRED_DNS = {
    "SPF":   {"name": "litigationspace.com",          "contains": "v=spf1"},
    "DKIM":  {"name": "google._domainkey.litigationspace.com", "contains": "v=DKIM1"},
    "DMARC": {"name": "_dmarc.litigationspace.com",   "contains": "v=DMARC1"},
}


def _dig(name: str) -> str:
    try:
        result = subprocess.run(
            ["dig", "TXT", name, "+short", "@8.8.8.8"],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout
    except Exception as e:
        logger.warning("[DNS] dig failed for %s: %s", name, e)
        return ""


def check_dns_health() -> dict:
    """Check SPF, DKIM, DMARC records. Email admin if any are missing."""
    from app.utils.email import _send_email

    missing = []
    results = {}
    for record, cfg in REQUIRED_DNS.items():
        output = _dig(cfg["name"])
        ok = cfg["contains"] in output
        results[record] = ok
        if not ok:
            missing.append(record)
            logger.warning("[DNS] %s record missing or incorrect for %s", record, cfg["name"])

    if missing:
        records_list = "".join(f"<li><strong>{r}</strong></li>" for r in missing)
        html = f"""
        <div style="font-family:sans-serif;max-width:600px;padding:24px;">
          <h2 style="color:#dc2626;">⚠ DNS Health Alert — LitigationSpace</h2>
          <p>The following email authentication records are <strong>missing or incorrect</strong>:</p>
          <ul>{records_list}</ul>
          <p>Without these records, outgoing emails (verification, invoices, marketing) will go to spam.</p>
          <p>Fix them in Hostinger → Domains → litigationspace.com → DNS / Zone Editor.</p>
          <hr>
          <p style="font-size:12px;color:#888;">Checked at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</p>
        </div>
        """
        _send_email("info@litigationspace.com", f"[ALERT] DNS records missing: {', '.join(missing)}", html)
        logger.error("[DNS] Alert sent — missing: %s", missing)
    else:
        logger.info("[DNS] All records OK: %s", results)

    return {"missing": missing, "results": results}


def auto_resend_verification() -> dict:
    """
    Find users who registered 24-72 hours ago, are still unverified,
    and haven't received a reminder yet. Send one reminder email.
    """
    from app.database import get_db
    from app.utils.auth import generate_id
    from app.utils.email import send_verification_email

    cutoff_start = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
    cutoff_end   = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    with get_db() as db:
        # Add reminder_sent_at column if it doesn't exist yet
        try:
            db.execute("ALTER TABLE users ADD COLUMN reminder_sent_at TEXT")
        except Exception:
            pass  # Column already exists

        users = db.execute(
            """SELECT id, email, full_name FROM users
               WHERE email_verified = 0
               AND status = 'LOCKED'
               AND created_at BETWEEN ? AND ?
               AND reminder_sent_at IS NULL""",
            (cutoff_start, cutoff_end)
        ).fetchall()

        sent = 0
        for u in users:
            import secrets, base64
            new_token = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")

            expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
            db.execute(
                "UPDATE users SET email_verification_token=?, email_verification_expires_at=?, reminder_sent_at=? WHERE id=?",
                (new_token, expires, datetime.now(timezone.utc).isoformat(), u["id"])
            )
            send_verification_email(u["email"], new_token, u["full_name"])
            sent += 1
            logger.info("[REMINDER] Verification reminder sent to %s", u["email"])

    return {"reminders_sent": sent}
