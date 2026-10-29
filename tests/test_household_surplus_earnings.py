"""The household calculator's monthly pay, for the Universal Credit
surplus earnings threshold measure (Budget 2026 Table 6.1 row 8): the
request's months and how they reach the answers.

A request without months is the request it was before the measure, and
its answers are unchanged.
"""

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api, household_impact
from uk_budget_data.api import HouseholdAnswersRequest

client = TestClient(api.app)
ROUTE = "/api/household-impact"
MONTHS = [1_500.0] * 12
BONUS_MONTHS = [1_500.0] * 5 + [6_000.0] + [1_500.0] * 6


@pytest.fixture(autouse=True)
def _fresh_runs():
    api._cached_household_impact.cache_clear()
    household_impact.clear_runs()
    yield
    api._cached_household_impact.cache_clear()
    household_impact.clear_runs()


def _request(household: dict, year: int = 2027, include=()) -> dict:
    return {
        "year": year,
        "policies": ["fuel_duty_rise_deferral"],
        "household": {"claims_universal_credit": True, **household},
        "include": list(include),
    }


def test_no_months_by_default_and_the_answers_are_as_before():
    assert HouseholdAnswersRequest().answers() == (
        household_impact.HouseholdAnswers()
    )
    answers = household_impact.HouseholdAnswers()
    assert answers.monthly_employment_income is None
    assert answers.partner_monthly_employment_income is None


def test_the_months_reach_the_answers_as_tuples():
    request = HouseholdAnswersRequest(
        has_partner=True,
        monthly_employment_income=BONUS_MONTHS,
        partner_monthly_employment_income=MONTHS,
    )
    answers = request.answers()
    assert answers.monthly_employment_income == tuple(BONUS_MONTHS)
    assert answers.partner_monthly_employment_income == tuple(MONTHS)
    # Frozen answers stay hashable, as the run cache needs
    hash(answers)


@pytest.mark.parametrize(
    "household, field",
    [
        (
            {"monthly_employment_income": [1_000.0] * 11},
            ["body", "household", "monthly_employment_income"],
        ),
        (
            {"monthly_employment_income": [1_000.0] * 13},
            ["body", "household", "monthly_employment_income"],
        ),
        (
            {"monthly_employment_income": [-1.0] + [1_000.0] * 11},
            ["body", "household", "monthly_employment_income", 0],
        ),
        (
            {"monthly_employment_income": [1_000.0] * 11 + [1e9]},
            ["body", "household", "monthly_employment_income", 11],
        ),
        # The partner's months only with a partner, and with the head's
        (
            {"partner_monthly_employment_income": MONTHS},
            ["body", "household"],
        ),
        (
            {
                "has_partner": True,
                "partner_monthly_employment_income": MONTHS,
            },
            ["body", "household"],
        ),
    ],
)
def test_months_out_of_range_are_refused_naming_the_field(
    household, field, monkeypatch
):
    def never(*args, **kwargs):
        raise AssertionError("a refused request reached the calculation")

    monkeypatch.setattr(household_impact, "calculate_household_impact", never)
    response = client.post(ROUTE, json=_request(household))
    assert response.status_code == 422, response.text
    assert field in [error["loc"] for error in response.json()["detail"]]


def test_a_non_finite_month_is_refused_with_a_422(monkeypatch):
    def never(*args, **kwargs):
        raise AssertionError("a refused request reached the calculation")

    monkeypatch.setattr(household_impact, "calculate_household_impact", never)
    months = ", ".join(["1000"] * 11 + ["NaN"])
    response = client.post(
        ROUTE,
        content=(
            '{"year": 2027, "household": {"monthly_employment_income": '
            f"[{months}]}}}}"
        ),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422, response.text
    assert ["body", "household", "monthly_employment_income", 11] in [
        error["loc"] for error in response.json()["detail"]
    ]
