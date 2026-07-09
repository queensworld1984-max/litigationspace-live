"""
Trial notification emails for LitigationSpace.

Sends time-based and credit-based nudge emails to trial/grace users.

Schedule (called by daily cron):
  Day 3 of trial  → "Your trial is active" orientation
  Day 5 of trial  → "X credits remaining" urgency nudge
  24hrs before expiry → "Trial expires tomorrow" hard urgency
  Credits < 20    → "Running low on credits" nudge
  On expiry       → "Upgrade to continue" conversion email

Tracking: a 'trial_notifications_sent' column (comma-separated flags) on users
prevents duplicate sends across cron runs.
"""
import logging
from datetime import datetime, timezone, timedelta
from app.utils.email import _send_email, SMTP_FROM_MARKETING, BASE_URL

logger = logging.getLogger(__name__)

# Email flag keys — stored in trial_notifications_sent column
FLAG_DAY3        = "day3"
FLAG_DAY5        = "day5"
FLAG_24HR        = "24hr"
FLAG_LOW_CREDITS = "low_credits"
FLAG_EXPIRED     = "expired"


def _has_flag(flags_str: str, flag: str) -> bool:
    flags = [f.strip() for f in (flags_str or "").split(",") if f.strip()]
    return flag in flags


def _add_flag(flags_str: str, flag: str) -> str:
    flags = [f.strip() for f in (flags_str or "").split(",") if f.strip()]
    if flag not in flags:
        flags.append(flag)
    return ",".join(flags)


# ── Email templates ──────────────────────────────────────────────────────────

def _send_trial_active(email: str, name: str, days_left: int, credits_left: int) -> bool:
    first = name.split()[0] if name else "Counselor"
    subject = "Your LitigationSpace trial is active"
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0c2461;padding:32px 40px;text-align:center;">
    <h1 style="color:#FFE566;font-size:22px;margin:0;font-family:Georgia,serif;">LitigationSpace</h1>
    <p style="color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;">The Operating System for Litigation</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:15px;color:#111;margin:0 0 16px;">Hi {first},</p>
    <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 20px;">
      Your free trial is active and running. You have <strong>{days_left} days</strong> and
      <strong>{credits_left} credits</strong> to explore LitigationSpace's litigation intelligence platform.
    </p>
    <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 20px;">
      Your workspace, cases, and documents are safely stored. Everything you build during your trial
      is preserved when you upgrade.
    </p>
    <div style="background:#f8faff;border:1px solid #dde5f5;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="font-size:13px;color:#0c2461;font-weight:600;margin:0 0 8px;">What to explore first:</p>
      <ul style="font-size:13px;color:#444;margin:0;padding-left:18px;line-height:1.8;">
        <li>Upload and analyze a motion</li>
        <li>Ask the Legal Brain about your case</li>
        <li>Build a case and add your documents</li>
      </ul>
    </div>
    <a href="{BASE_URL}/dashboard" style="display:inline-block;background:#0c2461;color:#FFE566;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">Go to Dashboard →</a>
  </div>
  <div style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#999;margin:0;">LitigationSpace · <a href="{BASE_URL}/pricing" style="color:#0c2461;">View Plans</a></p>
  </div>
</div>"""
    return _send_email(email, subject, html, sender=SMTP_FROM_MARKETING)


def _send_credits_running_low(email: str, name: str, credits_left: int, days_left: int) -> bool:
    first = name.split()[0] if name else "Counselor"
    subject = f"You have {credits_left} litigation intelligence credits remaining"
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0c2461;padding:32px 40px;text-align:center;">
    <h1 style="color:#FFE566;font-size:22px;margin:0;font-family:Georgia,serif;">LitigationSpace</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:15px;color:#111;margin:0 0 16px;">Hi {first},</p>
    <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 20px;">
      You have <strong>{credits_left} credits</strong> remaining in your trial
      {'with ' + str(days_left) + ' days left' if days_left and days_left > 0 else ''}.
      When your credits run out, AI-powered workflows will pause.
    </p>
    <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 20px;">
      Your cases, documents, and all prior AI outputs are safely preserved —
      nothing is lost when you upgrade.
    </p>
    <a href="{BASE_URL}/pricing" style="display:inline-block;background:#C9A020;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;margin-right:12px;">View Plans →</a>
    <a href="{BASE_URL}/dashboard" style="display:inline-block;color:#0c2461;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;border:1px solid #0c2461;">Continue Working</a>
  </div>
  <div style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#999;margin:0;">LitigationSpace · <a href="{BASE_URL}/pricing" style="color:#0c2461;">View Plans</a></p>
  </div>
</div>"""
    return _send_email(email, subject, html, sender=SMTP_FROM_MARKETING)


def _send_trial_expiring_tomorrow(email: str, name: str, credits_left: int) -> bool:
    first = name.split()[0] if name else "Counselor"
    subject = "Your LitigationSpace trial expires tomorrow"
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0c2461;padding:32px 40px;text-align:center;">
    <h1 style="color:#FFE566;font-size:22px;margin:0;font-family:Georgia,serif;">LitigationSpace</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:15px;color:#111;margin:0 0 16px;">Hi {first},</p>
    <div style="background:#fff8e1;border:1px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 20px;">
      <p style="font-size:14px;color:#92400e;font-weight:600;margin:0;">⚠️ Your trial expires in less than 24 hours.</p>
    </div>
    <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 16px;">
      You have <strong>{credits_left} credits</strong> remaining. After expiry, you can still:
    </p>
    <ul style="font-size:14px;color:#444;margin:0 0 20px;padding-left:18px;line-height:1.8;">
      <li>View all your cases and saved documents</li>
      <li>Read all prior AI analysis outputs</li>
      <li>Access your account and billing settings</li>
    </ul>
    <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
      Upgrade now to maintain uninterrupted access to litigation intelligence, AI drafting,
      War Room simulations, and everything you've built.
    </p>
    <a href="{BASE_URL}/pricing" style="display:inline-block;background:#C9A020;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">Upgrade Now →</a>
  </div>
  <div style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#999;margin:0;">LitigationSpace · <a href="{BASE_URL}/pricing" style="color:#0c2461;">View Plans</a></p>
  </div>
</div>"""
    return _send_email(email, subject, html, sender=SMTP_FROM_MARKETING)


def _send_trial_expired(email: str, name: str) -> bool:
    first = name.split()[0] if name else "Counselor"
    subject = "Your trial has ended — your work is safe"
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0c2461;padding:32px 40px;text-align:center;">
    <h1 style="color:#FFE566;font-size:22px;margin:0;font-family:Georgia,serif;">LitigationSpace</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:15px;color:#111;margin:0 0 16px;">Hi {first},</p>
    <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 16px;">
      Your free trial has ended. <strong>Your workspace is safe.</strong>
    </p>
    <div style="background:#f8faff;border:1px solid #dde5f5;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
      <p style="font-size:13px;color:#0c2461;font-weight:600;margin:0 0 8px;">Everything preserved for you:</p>
      <ul style="font-size:13px;color:#444;margin:0;padding-left:18px;line-height:1.8;">
        <li>All your cases and case files</li>
        <li>All saved documents and exhibits</li>
        <li>All prior AI analysis outputs</li>
        <li>All drafts and legal research</li>
      </ul>
    </div>
    <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
      Upgrade to continue advanced litigation intelligence, AI drafting, War Room simulations,
      and real-time legal research. Plans start at $49/month.
    </p>
    <a href="{BASE_URL}/pricing" style="display:inline-block;background:#C9A020;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">Continue with LitigationSpace →</a>
  </div>
  <div style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#999;margin:0;">LitigationSpace · <a href="{BASE_URL}/pricing" style="color:#0c2461;">View Plans</a></p>
  </div>
</div>"""
    return _send_email(email, subject, html, sender=SMTP_FROM_MARKETING)


# ── Main cron function ───────────────────────────────────────────────────────

def run_trial_notifications():
    """
    Check all trial/grace users and send appropriate notification emails.
    Called daily by the APScheduler in main.py.
    Safe to run multiple times — flags prevent duplicate sends.
    """
    from app.database import get_db

    now = _now_utc()
    sent_total = 0

    try:
        with get_db() as db:
            users = db.execute("""
                SELECT id, email, full_name,
                       subscription_status, trial_start_date, trial_end_date,
                       trial_credits_total, trial_credits_used, grace_until,
                       trial_notifications_sent
                FROM users
                WHERE subscription_status IN ('trial', 'grace', 'restricted')
                  AND email NOT LIKE '%@example.com'
                  AND email NOT LIKE '%@testmail.com'
                ORDER BY created_at ASC
            """).fetchall()

            for u in users:
                sent = _process_user_notifications(db, dict(u), now)
                sent_total += sent

    except Exception as e:
        logger.error(f"[TRIAL EMAILS] Cron error: {e}")

    logger.info(f"[TRIAL EMAILS] Cron complete — sent {sent_total} emails")
    return sent_total


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    try:
        s = str(value).strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                    "%Y-%m-%dT%H:%M:%S+00:00"):
            try:
                return datetime.strptime(s.split("+")[0].split("Z")[0], fmt.split("+")[0]).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    except Exception:
        pass
    return None


def _process_user_notifications(db, u: dict, now: datetime) -> int:
    """Process notification logic for a single user. Returns count of emails sent."""
    status    = u["subscription_status"]
    email     = u["email"]
    name      = u["full_name"] or "Counselor"
    flags     = u["trial_notifications_sent"] or ""
    sent      = 0

    trial_end   = _parse_dt(u["trial_end_date"])
    grace_until = _parse_dt(u["grace_until"])
    credits_total = u["trial_credits_total"] or 200
    credits_used  = u["trial_credits_used"] or 0
    credits_left  = max(0, credits_total - credits_used)

    # Determine trial_start for day-counting
    trial_start = _parse_dt(u["trial_start_date"]) or _parse_dt(u["grace_until"])

    # ── RESTRICTED (trial expired) ────────────────────────────────────────────
    if status == "restricted":
        if not _has_flag(flags, FLAG_EXPIRED):
            if _send_trial_expired(email, name):
                flags = _add_flag(flags, FLAG_EXPIRED)
                db.execute("UPDATE users SET trial_notifications_sent=? WHERE id=?", (flags, u["id"]))
                sent += 1
                logger.info(f"[TRIAL EMAILS] expired → {email}")
        return sent

    # ── TRIAL ─────────────────────────────────────────────────────────────────
    if status == "trial" and trial_start:
        days_elapsed = (now - trial_start).days
        days_left    = max(0, (trial_end - now).days) if trial_end else 0

        # Day 3 orientation
        if days_elapsed >= 3 and not _has_flag(flags, FLAG_DAY3):
            if _send_trial_active(email, name, days_left, credits_left):
                flags = _add_flag(flags, FLAG_DAY3)
                db.execute("UPDATE users SET trial_notifications_sent=? WHERE id=?", (flags, u["id"]))
                sent += 1
                logger.info(f"[TRIAL EMAILS] day3 → {email}")

        # Day 5 urgency
        if days_elapsed >= 5 and not _has_flag(flags, FLAG_DAY5):
            if _send_credits_running_low(email, name, credits_left, days_left):
                flags = _add_flag(flags, FLAG_DAY5)
                db.execute("UPDATE users SET trial_notifications_sent=? WHERE id=?", (flags, u["id"]))
                sent += 1
                logger.info(f"[TRIAL EMAILS] day5 → {email}")

        # 24-hour warning
        if trial_end and (trial_end - now) <= timedelta(hours=25) and not _has_flag(flags, FLAG_24HR):
            if _send_trial_expiring_tomorrow(email, name, credits_left):
                flags = _add_flag(flags, FLAG_24HR)
                db.execute("UPDATE users SET trial_notifications_sent=? WHERE id=?", (flags, u["id"]))
                sent += 1
                logger.info(f"[TRIAL EMAILS] 24hr → {email}")

    # ── LOW CREDITS (trial or grace) ──────────────────────────────────────────
    if status in ("trial", "grace") and credits_left < 20 and credits_left > 0:
        if not _has_flag(flags, FLAG_LOW_CREDITS):
            days_left = max(0, (trial_end - now).days) if (status == "trial" and trial_end) else None
            if _send_credits_running_low(email, name, credits_left, days_left):
                flags = _add_flag(flags, FLAG_LOW_CREDITS)
                db.execute("UPDATE users SET trial_notifications_sent=? WHERE id=?", (flags, u["id"]))
                sent += 1
                logger.info(f"[TRIAL EMAILS] low_credits → {email}")

    return sent
