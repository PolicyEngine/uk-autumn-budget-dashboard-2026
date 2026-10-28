"""POST /api/household-impact: one household, one year, a list of measures.

Requests out of range are refused with a 422 naming the field, before any
calculation. A request is answered through the same one-at-a-time limiter
as /api/personal-impact, with a Server-Timing header, and answers are kept
by request so moving the year or the measures back and forth reuses them.
"""

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api, household_impact
from uk_budget_data.runtime_identity import runtime_identity

# The four candidates withdrawn on Budget day stay fixtures of the
# calculation's machinery here (tests/conftest.py).
pytestmark = pytest.mark.usefixtures("pre_budget_registry")

client = TestClient(api.app)
ROUTE = "/api/household-impact"
REQUEST = {
    "year": 2031,
    "policies": ["threshold_freeze_2031_32"],
    "household": {"age": 40, "employment_income": 60_000},
    "include": [],
}


@pytest.fixture(autouse=True)
def _fresh_cache():
    api._cached_household_impact.cache_clear()
    household_impact.clear_runs()
    yield
    api._cached_household_impact.cache_clear()
    household_impact.clear_runs()


def _with(change):
    request = {**REQUEST, **change}
    if "household" in change:
        request["household"] = {**REQUEST["household"], **change["household"]}
    return request


@pytest.mark.parametrize(
    "change, field",
    [
        ({"year": 2025}, ["body", "year"]),
        ({"year": 2032}, ["body", "year"]),
        ({"policies": []}, ["body", "policies"]),
        ({"policies": ["no_such_measure"]}, ["body", "policies"]),
        ({"policies": ["autumn_budget_2026_combined"]}, ["body", "policies"]),
        ({"include": ["everything"]}, ["body", "include", 0]),
        ({"household": {"age": 12}}, ["body", "household", "age"]),
        (
            {"household": {"employment_income": -1}},
            ["body", "household", "employment_income"],
        ),
        (
            {"household": {"region": "ATLANTIS"}},
            ["body", "household", "region"],
        ),
        ({"household": {"tenure": "CASTLE"}}, ["body", "household", "tenure"]),
        (
            {"household": {"children": [{"age": 3}] * 11}},
            ["body", "household", "children"],
        ),
        (
            {"household": {"children": [{"age": 20}]}},
            ["body", "household", "children", 0, "age"],
        ),
        (
            {"household": {"monthly_rent": -5}},
            ["body", "household", "monthly_rent"],
        ),
        (
            {"household": {"has_partner": True, "partner_age": 10}},
            ["body", "household", "partner_age"],
        ),
        (
            {"household": {"student_loan_plan": "PLAN_3"}},
            ["body", "household", "student_loan_plan"],
        ),
        ({"household": {"brma": "ATLANTIS"}}, ["body", "household", "brma"]),
        (
            {"household": {"local_authority": "ATLANTIS"}},
            ["body", "household", "local_authority"],
        ),
        (
            {"household": {"council_tax_band": "Z"}},
            ["body", "household", "council_tax_band"],
        ),
        (
            {"household": {"children_ages": [3]}},
            ["body", "household", "children_ages"],
        ),
        (
            {"household": {"electricity_spending": -1}},
            ["body", "household", "electricity_spending"],
        ),
        (
            {"household": {"gas_spending": -1}},
            ["body", "household", "gas_spending"],
        ),
        (
            {"household": {"state_pension": -1}},
            ["body", "household", "state_pension"],
        ),
        (
            {"household": {"partner_state_pension": 200_000}},
            ["body", "household", "partner_state_pension"],
        ),
        (
            {"household": {"care_hours": 169}},
            ["body", "household", "care_hours"],
        ),
        ({"household": {"salary_year": 2024}}, ["body", "household"]),
        ({"year": 2027, "household": {"salary_year": 2028}}, ["body"]),
    ],
)
def test_answers_out_of_range_are_refused_naming_the_field(
    change, field, monkeypatch
):
    def never(*args, **kwargs):
        raise AssertionError("a refused request reached the calculation")

    monkeypatch.setattr(household_impact, "calculate_household_impact", never)
    response = client.post(ROUTE, json=_with(change))
    assert response.status_code == 422, response.text
    assert field in [error["loc"] for error in response.json()["detail"]]


def test_with_no_measures_named_it_uses_every_measure_it_knows(monkeypatch):
    calls = []

    def calculate(answers, policies, year, include, workers):
        calls.append((policies, include))
        return {"year": year}

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate
    )
    response = client.post(ROUTE, json={"year": 2029})
    assert response.status_code == 200, response.text
    assert calls == [(household_impact.measure_ids(), ("by_policy", "sweep"))]


def test_the_state_pension_reaches_the_answers_or_is_left_to_the_model():
    request = api.HouseholdAnswersRequest(age=72, partner_state_pension=9e3)
    answers = request.answers()
    assert answers.state_pension is None
    assert answers.partner_state_pension == 9_000


def test_caring_hours_reach_the_answers_and_default_to_none():
    assert api.HouseholdAnswersRequest().answers().care_hours == 0
    request = api.HouseholdAnswersRequest(care_hours=35)
    assert request.answers().care_hours == 35


def test_answers_are_kept_by_request(monkeypatch):
    calls = []

    def calculate(answers, policies, year, include, workers):
        calls.append(year)
        return {"year": year, "net_income": {"change": 1.0}}

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate
    )
    first = client.post(ROUTE, json=REQUEST).json()
    # The same request, its keys in another order
    again = client.post(ROUTE, json=dict(reversed(REQUEST.items()))).json()
    assert first == again
    assert calls == [2031]
    client.post(ROUTE, json=_with({"year": 2030}))
    assert calls == [2031, 2030]


def test_a_household_answered_in_stages():
    """The headline and programmes first, then the slower parts."""
    headline = client.post(ROUTE, json=REQUEST)
    assert headline.status_code == 200, headline.text
    assert "calculate;dur=" in headline.headers["server-timing"]
    body = headline.json()
    net = body["net_income"]
    assert net["change"] == pytest.approx(
        net["reform"] - net["baseline"], abs=0.01
    )
    # The freeze keeps thresholds lower than current law: less net income
    assert net["change"] < 0
    assert body["included"] == ["threshold_freeze_2031_32"]
    assert body["by_policy"] is None and body["sweep"] is None
    assert {row["id"] for row in body["programmes"]} >= {
        "income_tax",
        "national_insurance",
        "universal_credit",
        "child_benefit",
        "state_pension",
        "pension_credit",
        "housing_benefit",
        "council_tax",
        "council_tax_reduction",
        "benefit_cap",
        "private_pension_income",
        "student_loan_repayments",
        "fuel_duty",
    }
    assert body["council_tax_used"]["source"] == "estimated"
    assert body["engine"]["policyengine"]
    assert body["engine"]["policyengine-uk"]
    assert body["git_sha"] == runtime_identity()["git_sha"]

    rest = client.post(ROUTE, json=_with({"include": ["by_policy", "sweep"]}))
    assert rest.status_code == 200, rest.text
    rest = rest.json()
    assert rest["net_income"] == net
    [measure] = rest["by_policy"]["measures"]
    assert measure["change"] == net["change"]
    assert len(rest["sweep"]["points"]) == household_impact.SWEEP_POINTS


def test_a_child_aged_20_is_refused_naming_the_children():
    response = client.post(
        ROUTE, json=_with({"household": {"children": [{"age": 20}]}})
    )
    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "household", "children", 0, "age"]
    assert error["type"] == "less_than_equal"


def test_private_pensions_and_education_are_accepted():
    response = client.post(
        ROUTE,
        json=_with(
            {
                "household": {
                    "private_pension_income": 5_000,
                    "partner_private_pension_income": 0,
                    "children": [{"age": 17, "in_education": True}],
                    "council_tax": 1_500,
                }
            }
        ),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["council_tax_used"] == {
        "band": "D",
        "council_tax": 1_500,
        "source": "entered",
        "note": "As entered.",
    }
    pension = next(
        row
        for row in body["programmes"]
        if row["id"] == "private_pension_income"
    )
    assert pension["baseline"] == 5_000


def test_a_calculation_past_its_limit_is_a_504(monkeypatch):
    def slow(*args, **kwargs):
        raise TimeoutError("The worker calls took more than 280 s")

    monkeypatch.setattr(household_impact, "calculate_household_impact", slow)
    response = client.post(ROUTE, json=REQUEST)
    assert response.status_code == 504


def test_gas_spending_defaults_to_the_ons_average():
    """Left out, the average household's (ONS Family Spending), as for
    electricity, so a gas VAT measure reaches every calculator household
    (#208 review, finding 7); entered, as entered."""
    from uk_budget_data.api import HouseholdAnswersRequest

    assert HouseholdAnswersRequest().answers().gas_spending == 733
    answers = HouseholdAnswersRequest(gas_spending=1_050).answers()
    assert answers.gas_spending == 1_050
    assert HouseholdAnswersRequest(gas_spending=0).answers().gas_spending == 0


def test_electricity_spending_defaults_to_the_ons_average():
    """Left out, the average household's (ONS Family Spending); entered,
    as entered."""
    from uk_budget_data.api import HouseholdAnswersRequest

    assert HouseholdAnswersRequest().answers().electricity_spending == 1_040
    answers = HouseholdAnswersRequest(electricity_spending=600).answers()
    assert answers.electricity_spending == 600
