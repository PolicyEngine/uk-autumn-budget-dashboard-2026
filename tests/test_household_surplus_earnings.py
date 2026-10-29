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


# --- The months in the calculation --------------------------------------

# A renting single parent in the North West on Universal Credit, paid
# £1,500 a month with a £6,000 month in September 2027
SINGLE_PARENT = {
    "age": 35,
    "employment_income": 18_000,
    "children": [{"age": 5}],
    "region": "NORTH_WEST",
    "claims_universal_credit": True,
    "tenure": "RENT_PRIVATELY",
    "monthly_rent": 750,
}
SEPTEMBER = 5


def test_each_month_is_twelve_times_its_pay_with_the_partner_spread_evenly():
    answers = household_impact.HouseholdAnswers(
        has_partner=True,
        partner_employment_income=12_000,
        monthly_employment_income=tuple(BONUS_MONTHS),
    )
    salaries = household_impact.month_salaries(answers, 2027)
    growth = household_impact.earnings_growth(answers.salary_year, 2027)
    assert len(salaries) == 12
    assert [head for head, _ in salaries] == [12 * pay for pay in BONUS_MONTHS]
    assert [partner for _, partner in salaries] == [
        pytest.approx(12_000 * growth)
    ] * 12
    # The partner's own months when given; no partner, no partner's pay
    with_partner_months = household_impact.HouseholdAnswers(
        has_partner=True,
        monthly_employment_income=tuple(MONTHS),
        partner_monthly_employment_income=tuple(BONUS_MONTHS),
    )
    assert [
        partner
        for _, partner in household_impact.month_salaries(
            with_partner_months, 2027
        )
    ] == [12 * pay for pay in BONUS_MONTHS]
    single = household_impact.HouseholdAnswers(
        monthly_employment_income=tuple(MONTHS)
    )
    assert household_impact.month_salaries(single, 2027) == [
        [12 * pay] for pay in MONTHS
    ]
    assert (
        household_impact.month_salaries(
            household_impact.HouseholdAnswers(), 2027
        )
        is None
    )


def test_a_bonus_month_on_universal_credit_gains_from_the_2500_threshold():
    """Through the route, in stages as the page asks: the headline, then
    the split by policy. Each stage's net income carries the measure's
    change, and both agree, as the page's stage check needs."""
    household = {**SINGLE_PARENT, "monthly_employment_income": BONUS_MONTHS}
    headline = client.post(ROUTE, json=_request(household))
    assert headline.status_code == 200, headline.text
    headline = headline.json()
    detail = client.post(
        ROUTE, json=_request(household, include=["by_policy"])
    )
    assert detail.status_code == 200, detail.text
    detail = detail.json()
    plain = client.post(
        ROUTE, json=_request(SINGLE_PARENT, include=["by_policy"])
    ).json()

    surplus = headline["surplus_earnings"]
    assert surplus["id"] == "universal_credit_surplus_earnings"
    assert surplus["status"] == "affected"
    assert surplus["thresholds"] == {"current_law": 300, "budget": 2_500}
    months = surplus["months"]
    assert [month["month"] for month in months] == [
        "2027-04",
        "2027-05",
        "2027-06",
        "2027-07",
        "2027-08",
        "2027-09",
        "2027-10",
        "2027-11",
        "2027-12",
        "2028-01",
        "2028-02",
        "2028-03",
    ]
    assert [month["employment_income"] for month in months] == BONUS_MONTHS
    # September's pay takes the award to nil: it ends, with a surplus at
    # £300 and none at £2,500; October's claim starts a new award at both,
    # smaller at £300
    bonus, after_bonus = months[SEPTEMBER], months[SEPTEMBER + 1]
    assert bonus["current_law"]["status"] == "award_ended"
    assert bonus["budget"]["status"] == "award_ended"
    assert bonus["current_law"]["surplus_carried"] > 0
    assert bonus["budget"]["surplus_carried"] == 0
    assert after_bonus["current_law"]["status"] == "new_award"
    assert after_bonus["budget"]["status"] == "new_award"
    assert (
        after_bonus["current_law"]["universal_credit"]
        < after_bonus["budget"]["universal_credit"]
    )
    # The change: the Budget's months less current law's, positive
    change = surplus["change"]
    assert change > 0
    assert change == pytest.approx(
        sum(month["budget"]["universal_credit"] for month in months)
        - sum(month["current_law"]["universal_credit"] for month in months),
        abs=0.02,
    )
    assert surplus["total"]["budget"] - surplus["total"]["current_law"] == (
        pytest.approx(change, abs=0.02)
    )

    # The net income change carries it, over the same household without
    # months, and both stages agree
    net, plain_net = headline["net_income"], plain["net_income"]
    assert net["baseline"] == plain_net["baseline"]
    assert net["change"] == pytest.approx(
        plain_net["change"] + change, abs=0.02
    )
    assert net["reform"] == pytest.approx(
        net["baseline"] + net["change"], abs=0.02
    )
    assert detail["net_income"] == net

    # So does the Universal Credit row of the income table
    def programme(answer, row_id):
        return next(row for row in answer["programmes"] if row["id"] == row_id)

    uc = programme(headline, "universal_credit")
    plain_uc = programme(plain, "universal_credit")
    assert uc["baseline"] == plain_uc["baseline"]
    assert uc["change"] == pytest.approx(plain_uc["change"] + change, abs=0.02)
    assert "surplus earnings" in uc["note"]

    # The split by policy: the measure's own row, adding up to the change
    by_policy = detail["by_policy"]
    measure = next(
        row for row in by_policy["measures"] if row["id"] == surplus["id"]
    )
    assert measure["status"] == "affected"
    assert measure["change"] == pytest.approx(
        detail["surplus_earnings"]["own_change"], abs=0.01
    )
    assert by_policy["combined"] == pytest.approx(net["change"], abs=0.01)
    assert by_policy["residual"] == pytest.approx(
        by_policy["combined"] - by_policy["sum_of_singles"], abs=0.01
    )
    # The other measures' rows are as without months
    assert [
        row for row in by_policy["measures"] if row["id"] != surplus["id"]
    ] == plain["by_policy"]["measures"]
    # The household without months has no month figures at all
    assert plain["surplus_earnings"] is None
    assert all(
        row["id"] != surplus["id"] for row in plain["by_policy"]["measures"]
    )


@pytest.mark.parametrize(
    "year, household, reason",
    [
        (2028, SINGLE_PARENT, "same_threshold"),
        (
            2027,
            {**SINGLE_PARENT, "region": "NORTHERN_IRELAND"},
            "great_britain",
        ),
        (
            2027,
            {**SINGLE_PARENT, "claims_universal_credit": False},
            "no_universal_credit",
        ),
    ],
)
def test_a_household_the_measure_cannot_reach_has_its_reason_and_no_change(
    year, household, reason
):
    with_months = client.post(
        ROUTE,
        json=_request(
            {**household, "monthly_employment_income": BONUS_MONTHS},
            year=year,
        ),
    ).json()
    without = client.post(ROUTE, json=_request(household, year=year)).json()
    surplus = with_months["surplus_earnings"]
    assert surplus["status"] == "not_affected"
    assert surplus["reason"] == reason
    assert surplus["note"]
    assert surplus["change"] == 0
    assert surplus["months"] is None
    assert with_months["net_income"] == without["net_income"]
    assert with_months["programmes"] == without["programmes"]
