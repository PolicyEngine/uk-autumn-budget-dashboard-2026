"""The drill horizon includes the closing months of fiscal 2031–32."""

import pytest

from uk_budget_data.budget_years import (
    HOUSEHOLD_YEARS,
    POLICY_YEARS,
    calendar_to_fiscal_even_months,
    fiscal_months,
    validate_household_years,
)
from uk_budget_data.cli import parse_args
from uk_budget_data.models import DataConfig


def test_policy_horizon_is_shared_by_generation_and_households():
    assert POLICY_YEARS == [2026, 2027, 2028, 2029, 2030, 2031]
    assert HOUSEHOLD_YEARS == [2025, *POLICY_YEARS]
    assert DataConfig().years == POLICY_YEARS
    assert parse_args(["generate"]).years == POLICY_YEARS


def test_terminal_fiscal_year_uses_next_calendar_year():
    months = fiscal_months(2031)
    assert months == [(2031, m) for m in range(4, 13)] + [
        (2032, m) for m in range(1, 4)
    ]
    # Declared even-month calendar approximation: nine months at £120/year,
    # then three at £240/year. Native fiscal variables never use this helper.
    assert calendar_to_fiscal_even_months({2031: 120, 2032: 240}, 2031) == 150
    with pytest.raises(ValueError, match="2032"):
        calendar_to_fiscal_even_months({2031: 120}, 2031)


def test_calendar_boundary_requests_are_bounded_and_unambiguous():
    assert validate_household_years([2031, 2032]) == [2031, 2032]
    for years in ([], [2031, 2031], [2032, 2031], [2033], [2024]):
        with pytest.raises(ValueError):
            validate_household_years(years)
