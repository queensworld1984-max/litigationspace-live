"""
Subscription state resolver for LitigationSpace.

Single source of truth for:
  - Resolving a user's effective subscription status
  - Determining feature access (allowed vs blocked)
  - Credit balance queries
  - Plan → monthly credit allowances

Account states:
  grace       existing users at launch, 7 days full access, no credit counting
  trial       new users, 7 days + 200 credits, limited features + mini/nano models
  active      paid subscriber, full access, monthly credit allowance
  payg        credit-purchase users, full access while payg_credits > 0
  restricted  expired trial — can read/view but cannot run new AI or upload
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# ── Monthly credit allowances per plan ───────────────────────────────────────
PLAN_MONTHLY_CREDITS: dict[str, int] = {
    "basic":      1_000,
    "elite":      5_000,
    "chambers":  25_000,
    "enterprise":     0,   # negotiated separately
    "payg":           0,   # uses payg_credits balance only
    "none":           0,
}

# ── Features allowed during free trial ───────────────────────────────────────
TRIAL_ALLOWED_FEATURES: set[str] = {
    "case_builder",
    "motion_analyzer",
    "document_analyzer",
    "global_legal_intel",
    "basic_legal_brain",
    "basic_drafting",
}

# ── Features blocked during free trial ───────────────────────────────────────
TRIAL_BLOCKED_FEATURES: set[str] = {
    "war_room",
    "win_simulator",
    "deep_drafting",
    "advanced_contradiction",
    "premium_legal_brain",
    "advanced_legal_database",
    "advanced_team",
    "enterprise_workflows",
}

# ── Restricted workspace — what expired users can still access ────────────────
RESTRICTED_ALLOWED_FEATURES: set[str] = {
    "view_cases",
    "read_outputs",
    "dashboard",
    "account_settings",
    "billing",
    "document_viewing",
    "team_viewing",
}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value) -> Optional[datetime]:
    """Parse a timestamp string or datetime from SQLite into an aware datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    try:
        # SQLite stores as string e.g. "2026-06-09 14:20:12" or ISO format
        s = str(value).strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    except Exception:
        pass
    return None


def resolve_subscription(user_id: str, db) -> dict:
    """
    Read the user's subscription fields from the DB, apply any state
    transitions that are due, persist them, and return the full status dict.

    Always call this via get_db() context so the write is committed.

    Returns:
        {
          "status":                     str,
          "plan":                       str,
          "days_remaining":             int | None,
          "trial_credits_total":        int,
          "trial_credits_used":         int,
          "trial_credits_remaining":    int,
          "subscription_credits_total": int,
          "subscription_credits_remaining": int,
          "payg_credits":               int,
          "grace_until":                str | None,
          "trial_end_date":             str | None,
          "subscription_activated_at":  str | None,
          "features_allowed":           list[str],
          "features_blocked":           list[str],
          "can_use_ai":                 bool,
          "can_upload":                 bool,
        }
    """
    row = db.execute(
        """SELECT subscription_status, plan, trial_start_date, trial_end_date,
                  trial_credits_total, trial_credits_used,
                  subscription_credits_total, subscription_credits_remaining,
                  credits_reset_at, payg_credits, subscription_activated_at,
                  grace_until
           FROM users WHERE id = ?""",
        (user_id,)
    ).fetchone()

    if not row:
        logger.warning(f"[SUBSCRIPTION] User {user_id} not found")
        return _restricted_state()

    status   = row["subscription_status"] or "trial"
    plan     = row["plan"] or "none"
    now      = _now_utc()

    trial_credits_total = row["trial_credits_total"] or 200
    trial_credits_used  = row["trial_credits_used"]  or 0
    sub_credits_total   = row["subscription_credits_total"] or 0
    sub_credits_rem     = row["subscription_credits_remaining"] or 0
    payg_credits        = row["payg_credits"] or 0
    grace_until         = _parse_dt(row["grace_until"])
    trial_end_date      = _parse_dt(row["trial_end_date"])

    # ── State transitions ────────────────────────────────────────────────────

    # GRACE → TRIAL: grace period has expired
    if status == "grace" and grace_until and now > grace_until:
        trial_start = grace_until
        trial_end   = grace_until + timedelta(days=7)
        db.execute(
            """UPDATE users SET
                 subscription_status = 'trial',
                 trial_start_date    = ?,
                 trial_end_date      = ?,
                 trial_credits_total = 200,
                 trial_credits_used  = 0
               WHERE id = ?""",
            (trial_start.isoformat(), trial_end.isoformat(), user_id)
        )
        logger.info(f"[SUBSCRIPTION] {user_id} transitioned grace → trial (end={trial_end.date()})")
        status         = "trial"
        trial_end_date = trial_end
        trial_credits_total = 200
        trial_credits_used  = 0

    # TRIAL → RESTRICTED: trial expired by date or credits depleted
    if status == "trial":
        date_expired    = trial_end_date and now > trial_end_date
        credits_gone    = trial_credits_used >= trial_credits_total
        if date_expired or credits_gone:
            db.execute(
                "UPDATE users SET subscription_status = 'restricted' WHERE id = ?",
                (user_id,)
            )
            logger.info(f"[SUBSCRIPTION] {user_id} transitioned trial → restricted "
                        f"(date_expired={date_expired}, credits_gone={credits_gone})")
            status = "restricted"

    # PAYG → RESTRICTED: bought credits but ran out
    if status == "payg" and payg_credits <= 0:
        db.execute(
            "UPDATE users SET subscription_status = 'restricted' WHERE id = ?",
            (user_id,)
        )
        status = "restricted"

    # ── Monthly credit reset for active subscribers ───────────────────────────
    if status == "active" and plan in PLAN_MONTHLY_CREDITS:
        credits_reset_at = _parse_dt(row["credits_reset_at"])
        monthly = PLAN_MONTHLY_CREDITS[plan]
        if monthly > 0:
            if credits_reset_at is None or (now - credits_reset_at).days >= 30:
                db.execute(
                    """UPDATE users SET
                         subscription_credits_total     = ?,
                         subscription_credits_remaining = ?,
                         credits_reset_at               = ?
                       WHERE id = ?""",
                    (monthly, monthly, now.isoformat(), user_id)
                )
                sub_credits_total = monthly
                sub_credits_rem   = monthly

    # ── Build response ────────────────────────────────────────────────────────
    days_remaining = None
    if status == "grace" and grace_until:
        days_remaining = max(0, (grace_until - now).days)
    elif status == "trial" and trial_end_date:
        days_remaining = max(0, (trial_end_date - now).days)

    trial_credits_remaining = max(0, trial_credits_total - trial_credits_used)

    if status in ("grace", "trial"):
        features_allowed = list(TRIAL_ALLOWED_FEATURES)
        features_blocked = list(TRIAL_BLOCKED_FEATURES)
        can_use_ai = True
        can_upload = True
    elif status in ("active", "payg"):
        features_allowed = ["all"]
        features_blocked = []
        can_use_ai = True
        can_upload = True
    else:
        # restricted
        features_allowed = list(RESTRICTED_ALLOWED_FEATURES)
        features_blocked = list(TRIAL_BLOCKED_FEATURES | TRIAL_ALLOWED_FEATURES)
        can_use_ai = False
        can_upload = False

    return {
        "status":                        status,
        "plan":                          plan,
        "days_remaining":                days_remaining,
        "trial_credits_total":           trial_credits_total,
        "trial_credits_used":            trial_credits_used,
        "trial_credits_remaining":       trial_credits_remaining,
        "subscription_credits_total":    sub_credits_total,
        "subscription_credits_remaining": sub_credits_rem,
        "payg_credits":                  payg_credits,
        "grace_until":                   grace_until.isoformat() if grace_until else None,
        "trial_end_date":                trial_end_date.isoformat() if trial_end_date else None,
        "subscription_activated_at":     row["subscription_activated_at"],
        "features_allowed":              features_allowed,
        "features_blocked":              features_blocked,
        "can_use_ai":                    can_use_ai,
        "can_upload":                    can_upload,
    }


def init_trial(user_id: str, db) -> None:
    """Set trial fields on a newly registered user."""
    now   = _now_utc()
    end   = now + timedelta(days=7)
    db.execute(
        """UPDATE users SET
             subscription_status = 'trial',
             trial_start_date    = ?,
             trial_end_date      = ?,
             trial_credits_total = 200,
             trial_credits_used  = 0
           WHERE id = ?""",
        (now.isoformat(), end.isoformat(), user_id)
    )
    logger.info(f"[SUBSCRIPTION] Trial initialised for {user_id} (ends {end.date()})")


def _restricted_state() -> dict:
    return {
        "status": "restricted",
        "plan": "none",
        "days_remaining": None,
        "trial_credits_total": 0,
        "trial_credits_used": 0,
        "trial_credits_remaining": 0,
        "subscription_credits_total": 0,
        "subscription_credits_remaining": 0,
        "payg_credits": 0,
        "grace_until": None,
        "trial_end_date": None,
        "subscription_activated_at": None,
        "features_allowed": list(RESTRICTED_ALLOWED_FEATURES),
        "features_blocked": list(TRIAL_BLOCKED_FEATURES | TRIAL_ALLOWED_FEATURES),
        "can_use_ai": False,
        "can_upload": False,
    }
