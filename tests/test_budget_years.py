"""The shared horizon includes the closing months of fiscal 2031–32."""

import pytest

from uk_budget_data.budget_years import (
    BASE_YEAR,
    HOUSEHOLD_YEARS,
    POLICY_YEARS,
    TERMINAL_CALENDAR_YEAR,
    calendar_to_fiscal_even_months,
    fiscal_months,
    validate_household_years,
)


def test_shared_policy_horizon():
    assert BASE_YEAR == 2025
    assert POLICY_YEARS == [2026, 2027, 2028, 2029, 2030, 2031]
    assert HOUSEHOLD_YEARS == [BASE_YEAR, *POLICY_YEARS]
    assert TERMINAL_CALENDAR_YEAR == 2032


@pytest.mark.parametrize("start_year", POLICY_YEARS)
def test_fiscal_year_covers_april_through_next_march(start_year):
    assert fiscal_months(start_year) == [
        (start_year, month) for month in range(4, 13)
    ] + [(start_year + 1, month) for month in range(1, 4)]


def test_terminal_fiscal_year_uses_next_calendar_year():
    months = fiscal_months(2031)
    assert months[-3:] == [(2032, 1), (2032, 2), (2032, 3)]
    # Explicit even-month incidence: nine months at £120/year and three at
    # £240/year. Native fiscal variables never use this helper.
    assert calendar_to_fiscal_even_months({2031: 120, 2032: 240}, 2031) == 150


@pytest.mark.parametrize("missing_year", [2031, 2032])
def test_calendar_approximation_requires_both_years(missing_year):
    calendar_values = {2031: 120, 2032: 240}
    del calendar_values[missing_year]
    with pytest.raises(ValueError, match=str(missing_year)):
        calendar_to_fiscal_even_months(calendar_values, 2031)


@pytest.mark.parametrize("year", [2031, 2032])
@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_calendar_approximation_requires_finite_values(year, value):
    calendar_values = {2031: 120, 2032: 240}
    calendar_values[year] = value
    with pytest.raises(ValueError, match=f"{year} must be finite"):
        calendar_to_fiscal_even_months(calendar_values, 2031)


@pytest.mark.parametrize("start_year", [2025, 2032, True, 2031.0, "2031"])
def test_fiscal_start_year_must_be_an_integer_in_the_policy_horizon(
    start_year,
):
    with pytest.raises(ValueError, match="policy horizon"):
        fiscal_months(start_year)
    with pytest.raises(ValueError, match="policy horizon"):
        calendar_to_fiscal_even_months({2031: 120, 2032: 240}, start_year)


def test_calendar_boundary_requests_are_bounded_and_unambiguous():
    assert validate_household_years([2031, 2032]) == [2031, 2032]
    for years in (
        [],
        [2031, 2031],
        [2032, 2031],
        [2033],
        [2024],
        [True],
        [2031.0],
        ["2031"],
    ):
        with pytest.raises(ValueError):
            validate_household_years(years)


def test_year_validation_returns_independent_lists():
    default_years = validate_household_years(None)
    assert default_years == HOUSEHOLD_YEARS
    assert default_years is not HOUSEHOLD_YEARS
    requested_years = [2031, 2032]
    validated_years = validate_household_years(requested_years)
    assert validated_years == requested_years
    assert validated_years is not requested_years
