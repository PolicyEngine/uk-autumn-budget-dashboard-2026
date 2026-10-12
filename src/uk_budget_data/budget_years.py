"""Shared drill horizon and an opt-in calendar incidence approximation."""

import json
import math
from collections.abc import Mapping
from importlib.resources import files

_CONFIG = json.loads(
    files("uk_budget_data").joinpath("budget_years.json").read_text()
)
BASE_YEAR = _CONFIG["base_year"]
POLICY_YEARS = _CONFIG["policy_years"]
TERMINAL_CALENDAR_YEAR = _CONFIG["terminal_calendar_year"]
HOUSEHOLD_YEARS = [BASE_YEAR, *POLICY_YEARS]


def validate_household_years(years: list[int] | None) -> list[int]:
    """Permit ordered annual requests, including the terminal boundary year."""
    if years is None:
        return HOUSEHOLD_YEARS.copy()
    if (
        not years
        or any(type(year) is not int for year in years)
        or years != sorted(set(years))
        or any(
            year < BASE_YEAR or year > TERMINAL_CALENDAR_YEAR for year in years
        )
    ):
        raise ValueError(
            f"Select unique increasing years from {BASE_YEAR} to {TERMINAL_CALENDAR_YEAR}"
        )
    return years.copy()


def fiscal_months(start_year: int) -> list[tuple[int, int]]:
    """Return April through March, retaining the following calendar year."""
    if start_year not in POLICY_YEARS:
        raise ValueError("Fiscal year must start within the policy horizon")
    return [(start_year, month) for month in range(4, 13)] + [
        (start_year + 1, month) for month in range(1, 4)
    ]


def calendar_to_fiscal_even_months(
    calendar_values: Mapping[int, float], start_year: int
) -> float:
    """Approximate an explicitly calendar-based measure with even-month incidence.

    Call only when the measure's incidence assumption supports the 9/12 + 3/12
    split. Never pass native fiscal variables or total household net income.
    This helper does not determine a measure's basis and is never auto-applied.
    """
    fiscal_months(start_year)
    for year in (start_year, start_year + 1):
        if year not in calendar_values:
            raise ValueError(f"Missing calendar value for {year}")
        if not math.isfinite(calendar_values[year]):
            raise ValueError(f"Calendar value for {year} must be finite")
    return (
        9 / 12 * calendar_values[start_year]
        + 3 / 12 * calendar_values[start_year + 1]
    )
