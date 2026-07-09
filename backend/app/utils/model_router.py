"""
Central AI model router for LitigationSpace.

Single source of truth for OpenAI model assignments AND credit costs.
All AI call points import from here.

Subscription tiers:
  grace / trial  → MODEL_STANDARD (gpt-5.4-mini) for litigation tasks
                   MODEL_LITE    (gpt-5.4-nano) for lightweight tasks
                   BLOCKED       for premium-only features

  active / payg  → MODEL_PREMIUM  (gpt-5.5)      for litigation intelligence
                   MODEL_STANDARD (gpt-5.4-mini) for standard drafting
                   MODEL_LITE    (gpt-5.4-nano) for lightweight automation

Primary function:
    model, cost = get_model_for_user(task_type, subscription_status)

Legacy functions (fully backward-compatible, assume paid/active):
    model = get_model_for_task(task_type)
    model = get_model_for_user_task(paid_task, free_task, is_paid)

IMPORTANT: Model names MUST NOT be exposed to the frontend.
           Use "AI processing capacity" / "advanced litigation intelligence" language only.
"""
import logging
from typing import NamedTuple

logger = logging.getLogger(__name__)

# ── Model constants ──────────────────────────────────────────────────────────
MODEL_PREMIUM  = "gpt-5.5"       # Paid users — litigation intelligence & strategy
MODEL_STANDARD = "gpt-5.4-mini"  # Trial users & standard tasks — competent legal assistance
MODEL_LITE     = "gpt-5.4-nano"  # All users — OCR, metadata, tagging, automation

# Legacy aliases kept for any direct references elsewhere
MODEL_HIGH   = MODEL_PREMIUM
MODEL_MEDIUM = MODEL_STANDARD
MODEL_LOW    = MODEL_LITE


class RouteResult(NamedTuple):
    model: str
    credit_cost: int
    tier: str          # "premium" | "standard" | "lite" | "blocked"


# ── Subscription status sets ─────────────────────────────────────────────────
_PAID_STATUSES  = {"active", "payg"}
_TRIAL_STATUSES = {"grace", "trial"}

# ── Tasks blocked for trial/grace users ──────────────────────────────────────
# These return a BLOCKED result; the caller must enforce the 403.
TRIAL_BLOCKED_TASKS: frozenset[str] = frozenset({
    "war_room",
    "win_simulator",
    "deep_drafting",
    "advanced_contradiction",
    "premium_legal_brain",
    "advanced_legal_database",
})

# ── PREMIUM tasks: gpt-5.5 for paid, gpt-5.4-mini for trial ─────────────────
# Credit costs shown are for PAID users. Trial users pay the same credits
# but receive mini-model quality.
_PREMIUM_TASKS: dict[str, int] = {
    # Legal Brain
    "legal_brain_research":         5,
    "legal_brain_chat":             5,
    "legal_brain_draft_document":   5,
    "legal_brain_draft_email":      5,

    # Motion Analyzer
    "motion_analysis":              5,

    # Document Analyzer
    "document_analysis":            5,

    # War Room (paid only — trial blocked above)
    "war_room":                    30,

    # Win Simulator (paid only)
    "win_simulator":               40,

    # Drafting Engine (deep intelligence)
    "drafting_engine":              5,
    "deep_drafting":               10,

    # Advanced Contradiction Analysis (paid only)
    "advanced_contradiction":      25,

    # Premium Legal Brain (paid only)
    "premium_legal_brain":         10,

    # Legal Database / Jurisdiction
    "advanced_legal_database":     10,
    "jurisdiction_legal_analysis": 10,
    "jurisdiction_verification":    5,
    "jurisdiction_suggestions":     5,

    # Case Navigator (paid tier)
    "case_navigator_paid":         10,

    # Case task generation
    "case_task_generation":         5,
}

# ── STANDARD tasks: always gpt-5.4-mini regardless of subscription ───────────
_STANDARD_TASKS: dict[str, int] = {
    # Legal Brain public / basic
    "legal_brain_public":           2,
    "basic_legal_brain":            3,

    # Basic drafting (all users)
    "basic_drafting":               5,

    # Document summary
    "document_summary":             2,

    # Jurisdiction summary
    "jurisdiction_summary":         2,

    # Case Navigator free tier
    "case_navigator_free":          3,

    # Content generation (marketing / growth)
    "blog_generation":              2,
    "social_posts":                 1,
    "email_outreach":               1,
    "live_bench_profiles":          1,
    "client_explanation":           2,
    "research_outline":             3,

    # Support / contact
    "support_chat":                 2,
    "contact_auto_reply":           1,

    # Cron / background (system-level, never premium)
    "cron_blog":                    2,
    "cron_social":                  1,
    "cron_content":                 1,
}

# ── LITE tasks: always gpt-5.4-nano regardless of subscription ───────────────
_LITE_TASKS: dict[str, int] = {
    "image_description":            1,
    "exhibit_naming":               1,
    "document_naming":              1,
    "case_classification":          1,
    "metadata_extraction":          1,
    "document_type_detection":      1,
    "tagging":                      1,
    "jurisdiction_extraction":      1,
    "ocr_cleanup":                  1,
    "reminder_generation":          1,
    "notification_text":            1,
    "dashboard_summary":            1,
    "task_generation":              1,
}


# ── Primary subscription-aware resolver ──────────────────────────────────────

def get_model_for_user(task_type: str, subscription_status: str) -> RouteResult:
    """
    Primary resolver. Returns (model, credit_cost, tier).

    Args:
        task_type:            One of the task keys defined above.
        subscription_status:  grace | trial | active | payg | restricted

    Usage:
        result = get_model_for_user("motion_analysis", user["subscription_status"])
        model  = result.model
        cost   = result.credit_cost
        if result.tier == "blocked":
            raise HTTPException(403, "Upgrade required")
    """
    is_paid = subscription_status in _PAID_STATUSES

    # ── Lite tasks — always nano, always cheap ────────────────────────────────
    if task_type in _LITE_TASKS:
        cost = _LITE_TASKS[task_type]
        logger.debug(f"[ROUTER] task={task_type} status={subscription_status} model={MODEL_LITE} cost={cost}")
        return RouteResult(MODEL_LITE, cost, "lite")

    # ── Standard tasks — always mini ─────────────────────────────────────────
    if task_type in _STANDARD_TASKS:
        cost = _STANDARD_TASKS[task_type]
        logger.debug(f"[ROUTER] task={task_type} status={subscription_status} model={MODEL_STANDARD} cost={cost}")
        return RouteResult(MODEL_STANDARD, cost, "standard")

    # ── Premium tasks ─────────────────────────────────────────────────────────
    if task_type in _PREMIUM_TASKS:
        cost = _PREMIUM_TASKS[task_type]

        # Blocked for trial users
        if task_type in TRIAL_BLOCKED_TASKS and not is_paid:
            logger.info(f"[ROUTER] BLOCKED task={task_type} status={subscription_status}")
            return RouteResult(MODEL_STANDARD, 0, "blocked")

        # Paid → premium model; trial → standard model (same credit cost)
        model = MODEL_PREMIUM if is_paid else MODEL_STANDARD
        tier  = "premium" if is_paid else "standard"
        logger.info(f"[ROUTER] task={task_type} status={subscription_status} model={model} cost={cost}")
        return RouteResult(model, cost, tier)

    # ── Unknown task type — safe fallback ────────────────────────────────────
    logger.warning(f"[ROUTER] Unknown task_type='{task_type}' — falling back to standard")
    model = MODEL_PREMIUM if is_paid else MODEL_STANDARD
    return RouteResult(model, 2, "standard")


# ── Legacy backward-compatible functions ─────────────────────────────────────
# All existing call sites continue to work unchanged.
# They default to "active" (paid) behavior — returning gpt-5.5 for premium tasks.
# Migrate call sites to get_model_for_user() during Day 4 (credit deduction pass).

def get_model_for_task(task_type: str) -> str:
    """
    Legacy: return model for a task assuming paid/active user.
    All existing callers continue to work unchanged.
    Migrate to get_model_for_user() when adding credit deduction.
    """
    result = get_model_for_user(task_type, "active")
    return result.model


def get_model_for_user_task(task_type_paid: str, task_type_free: str, is_paid: bool) -> str:
    """
    Legacy tier-split helper used by legal_brain.py and features.py.
    Migrate to get_model_for_user() during Day 4.
    """
    task_type = task_type_paid if is_paid else task_type_free
    status    = "active" if is_paid else "trial"
    result    = get_model_for_user(task_type, status)
    return result.model


def get_credit_cost(task_type: str) -> int:
    """Return just the credit cost for a task (subscription-neutral)."""
    for table in (_LITE_TASKS, _STANDARD_TASKS, _PREMIUM_TASKS):
        if task_type in table:
            return table[task_type]
    return 2
