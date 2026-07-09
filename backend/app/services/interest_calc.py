"""
Financial Calculation Engine for legal documents.
Computes interest, damages, and fees PROGRAMMATICALLY — never trusts AI for math.
All monetary values are computed here and injected into document templates.
"""
from datetime import datetime, date
from typing import Optional
import math


def calculate_simple_interest(
    principal: float,
    monthly_rate: float,
    trigger_date: str,
    calc_date: Optional[str] = None,
) -> dict:
    """
    Calculate simple interest on a principal amount.

    Args:
        principal: The principal amount (e.g., 137667.40)
        monthly_rate: Monthly interest rate as decimal (e.g., 0.015 for 1.5%)
        trigger_date: Date interest started accruing (ISO format YYYY-MM-DD)
        calc_date: Date to calculate through (ISO format, defaults to today)

    Returns:
        Dict with all computed values.
    """
    start = _parse_date(trigger_date)
    end = _parse_date(calc_date) if calc_date else date.today()

    # Calculate full months elapsed
    full_months = (end.year - start.year) * 12 + (end.month - start.month)

    # Check if we need to subtract a month (partial month handling)
    if end.day < start.day:
        full_months -= 1

    # Calculate the date after full months
    after_full_months_month = start.month + full_months
    after_full_months_year = start.year + (after_full_months_month - 1) // 12
    after_full_months_month = ((after_full_months_month - 1) % 12) + 1
    # Clamp day to valid range for the target month
    import calendar
    max_day = calendar.monthrange(after_full_months_year, after_full_months_month)[1]
    after_full_months_day = min(start.day, max_day)
    after_full_months = date(after_full_months_year, after_full_months_month, after_full_months_day)

    remaining_days = (end - after_full_months).days

    monthly_amount = principal * monthly_rate
    full_months_interest = monthly_amount * full_months
    daily_rate = monthly_amount / 30
    partial_month_interest = daily_rate * remaining_days
    total_interest = full_months_interest + partial_month_interest
    total_due = principal + total_interest

    return {
        "principal": round(principal, 2),
        "monthly_rate": monthly_rate,
        "trigger_date": trigger_date,
        "calc_date": calc_date or end.isoformat(),
        "full_months": full_months,
        "remaining_days": remaining_days,
        "monthly_amount": round(monthly_amount, 2),
        "full_months_interest": round(full_months_interest, 2),
        "partial_month_interest": round(partial_month_interest, 2),
        "daily_rate": round(daily_rate, 2),
        "total_interest": round(total_interest, 2),
        "total_due": round(total_due, 2),
    }


def calculate_compound_interest(
    principal: float,
    annual_rate: float,
    trigger_date: str,
    calc_date: Optional[str] = None,
    compounding: str = "monthly",
) -> dict:
    """Calculate compound interest."""
    start = _parse_date(trigger_date)
    end = _parse_date(calc_date) if calc_date else date.today()

    days = (end - start).days
    years = days / 365.25

    if compounding == "monthly":
        n = 12
    elif compounding == "quarterly":
        n = 4
    elif compounding == "daily":
        n = 365
    else:
        n = 1  # annual

    total_due = principal * (1 + annual_rate / n) ** (n * years)
    total_interest = total_due - principal

    return {
        "principal": round(principal, 2),
        "annual_rate": annual_rate,
        "compounding": compounding,
        "trigger_date": trigger_date,
        "calc_date": calc_date or end.isoformat(),
        "days_elapsed": days,
        "years_elapsed": round(years, 4),
        "total_interest": round(total_interest, 2),
        "total_due": round(total_due, 2),
    }


def calculate_damages_summary(
    items: list,
) -> dict:
    """
    Calculate a damages summary from a list of items.

    Args:
        items: List of dicts with 'description', 'amount', 'category'

    Returns:
        Dict with itemized and total damages.
    """
    total = 0.0
    by_category = {}
    itemized = []

    for item in items:
        amount = float(item.get("amount", 0))
        category = item.get("category", "General")
        description = item.get("description", "")

        total += amount
        by_category[category] = by_category.get(category, 0) + amount
        itemized.append({
            "description": description,
            "amount": round(amount, 2),
            "category": category,
        })

    return {
        "itemized": itemized,
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
        "total_damages": round(total, 2),
    }


def format_usd(amount: float) -> str:
    """Format a number as USD currency string."""
    return f"${amount:,.2f}"


def substitute_financial_tokens(text: str, calc_result: dict) -> str:
    """Replace {{PLACEHOLDER}} tokens in text with computed financial values."""
    tokens = {
        "{{PRINCIPAL}}": format_usd(calc_result.get("principal", 0)),
        "{{TOTAL_INTEREST}}": format_usd(calc_result.get("total_interest", 0)),
        "{{TOTAL_DUE}}": format_usd(calc_result.get("total_due", 0)),
        "{{MONTHLY_AMOUNT}}": format_usd(calc_result.get("monthly_amount", 0)),
        "{{FULL_MONTHS}}": str(calc_result.get("full_months", 0)),
        "{{REMAINING_DAYS}}": str(calc_result.get("remaining_days", 0)),
        "{{DAILY_RATE}}": format_usd(calc_result.get("daily_rate", 0)),
        "{{TRIGGER_DATE}}": _format_date_long(calc_result.get("trigger_date", "")),
        "{{CALC_DATE}}": _format_date_long(calc_result.get("calc_date", "")),
        "{{TOTAL_DAMAGES}}": format_usd(calc_result.get("total_damages", 0)),
    }

    for token, value in tokens.items():
        text = text.replace(token, value)

    return text


def _parse_date(date_str: str) -> date:
    """Parse a date string in various formats."""
    if isinstance(date_str, date):
        return date_str
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except (ValueError, TypeError):
            continue
    raise ValueError(f"Cannot parse date: {date_str}")


def _format_date_long(date_str: str) -> str:
    """Format a date string as 'Month Day, Year'."""
    try:
        d = _parse_date(date_str)
        return d.strftime("%B %d, %Y")
    except (ValueError, TypeError):
        return date_str or ""
