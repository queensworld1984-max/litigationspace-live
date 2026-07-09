"""
Credit engine for LitigationSpace.

Three functions used at every AI call site:

  model, cost = credit_gate(user_id, task_type, db)
      → pre-flight: resolves subscription, blocks if restricted/insufficient,
        returns the correct model + credit cost to use.
        Raises HTTPException 402/403 on failure.

  deduct_credits(user_id, subscription_status, cost, task_type, db)
      → post-call: atomically deducts credits after a successful AI call.

  get_credit_balance(user_id, db)
      → returns a simple balance dict for the frontend.

Deduction rules:
  grace      → no deduction (full free access during grace period)
  trial      → increment trial_credits_used
  active     → decrement subscription_credits_remaining
               if subscription_credits_remaining < cost, overflow into payg_credits
  payg       → decrement payg_credits
  restricted → blocked at credit_gate (never reaches deduct)
"""
import logging
from fastapi import HTTPException
from app.utils.model_router import get_model_for_user, TRIAL_BLOCKED_TASKS
from app.utils.subscription import resolve_subscription

logger = logging.getLogger(__name__)


def credit_gate(user_id: str, task_type: str, db) -> tuple[str, int]:
    """
    Combined subscription check + model resolution + credit pre-flight.

    Call this at the START of every AI endpoint, before making the OpenAI call.

    Returns:
        (model_id, credit_cost)  — use model_id for the OpenAI call.

    Raises:
        HTTPException 403  — feature blocked for trial users
        HTTPException 402  — insufficient credits
        HTTPException 403  — account restricted (trial expired)
    """
    state = resolve_subscription(user_id, db)
    status = state["status"]

    # Restricted accounts cannot run any AI
    if status == "restricted":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "account_restricted",
                "message": "Your trial has expired. Upgrade your plan to continue.",
                "upgrade_url": "/pricing",
            }
        )

    result = get_model_for_user(task_type, status)

    # Feature blocked for trial/grace users
    if result.tier == "blocked":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "feature_locked",
                "message": "This feature requires a paid plan.",
                "upgrade_url": "/pricing",
            }
        )

    # Grace users have full free access — no credit check needed
    if status == "grace":
        return result.model, result.credit_cost

    # Trial users — check trial credits
    if status == "trial":
        remaining = state["trial_credits_remaining"]
        if remaining < result.credit_cost:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "insufficient_credits",
                    "message": f"You need {result.credit_cost} credits but have {remaining} remaining.",
                    "credits_remaining": remaining,
                    "credits_needed": result.credit_cost,
                    "upgrade_url": "/pricing",
                }
            )
        return result.model, result.credit_cost

    # Active subscribers — check subscription credits (overflow to PAYG)
    if status == "active":
        sub_rem  = state["subscription_credits_remaining"]
        payg     = state["payg_credits"]
        total_av = sub_rem + payg
        if total_av < result.credit_cost:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "insufficient_credits",
                    "message": f"You need {result.credit_cost} credits but have {total_av} remaining.",
                    "credits_remaining": total_av,
                    "credits_needed": result.credit_cost,
                    "upgrade_url": "/pricing",
                }
            )
        return result.model, result.credit_cost

    # PAYG users — check payg_credits only
    if status == "payg":
        payg = state["payg_credits"]
        if payg < result.credit_cost:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "insufficient_credits",
                    "message": f"You need {result.credit_cost} credits but have {payg} PAYG credits remaining.",
                    "credits_remaining": payg,
                    "credits_needed": result.credit_cost,
                    "upgrade_url": "/pricing",
                }
            )
        return result.model, result.credit_cost

    # Unknown status — default allow with standard model (safe fallback)
    logger.warning(f"[CREDITS] Unknown status='{status}' for user={user_id}, allowing with standard model")
    return result.model, result.credit_cost


def deduct_credits(user_id: str, subscription_status: str, cost: int, task_type: str, db) -> None:
    """
    Atomically deduct credits after a successful AI call.
    Call this AFTER the OpenAI call succeeds.

    Deduction logic:
      grace   → no deduction
      trial   → trial_credits_used += cost
      active  → subscription_credits_remaining -= cost (overflow to payg_credits)
      payg    → payg_credits -= cost
    """
    if cost <= 0:
        return

    if subscription_status == "grace":
        # Grace period: free access, no deduction
        return

    if subscription_status == "trial":
        db.execute(
            "UPDATE users SET trial_credits_used = trial_credits_used + ? WHERE id = ?",
            (cost, user_id)
        )
        logger.info(f"[CREDITS] trial deduct user={user_id} task={task_type} cost={cost}")
        return

    if subscription_status == "active":
        # Deduct from subscription credits first, overflow into payg
        row = db.execute(
            "SELECT subscription_credits_remaining, payg_credits FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
        if not row:
            return
        sub_rem = row["subscription_credits_remaining"] or 0
        payg    = row["payg_credits"] or 0

        if sub_rem >= cost:
            db.execute(
                "UPDATE users SET subscription_credits_remaining = subscription_credits_remaining - ? WHERE id = ?",
                (cost, user_id)
            )
        else:
            # Drain subscription credits, take remainder from payg
            overflow = cost - sub_rem
            db.execute(
                """UPDATE users SET
                     subscription_credits_remaining = 0,
                     payg_credits = MAX(0, payg_credits - ?)
                   WHERE id = ?""",
                (overflow, user_id)
            )
        logger.info(f"[CREDITS] active deduct user={user_id} task={task_type} cost={cost} "
                    f"sub_rem={sub_rem} payg={payg}")
        return

    if subscription_status == "payg":
        db.execute(
            "UPDATE users SET payg_credits = MAX(0, payg_credits - ?) WHERE id = ?",
            (cost, user_id)
        )
        logger.info(f"[CREDITS] payg deduct user={user_id} task={task_type} cost={cost}")
        return


def get_credit_balance(user_id: str, db) -> dict:
    """Return a quick credit balance summary for the frontend."""
    row = db.execute(
        """SELECT subscription_status, plan,
                  trial_credits_total, trial_credits_used,
                  subscription_credits_total, subscription_credits_remaining,
                  payg_credits, grace_until, trial_end_date
           FROM users WHERE id = ?""",
        (user_id,)
    ).fetchone()
    if not row:
        return {}

    status = row["subscription_status"] or "trial"
    trial_rem = max(0, (row["trial_credits_total"] or 200) - (row["trial_credits_used"] or 0))

    return {
        "status":                        status,
        "plan":                          row["plan"] or "none",
        "trial_credits_remaining":       trial_rem,
        "subscription_credits_remaining": row["subscription_credits_remaining"] or 0,
        "payg_credits":                  row["payg_credits"] or 0,
    }
