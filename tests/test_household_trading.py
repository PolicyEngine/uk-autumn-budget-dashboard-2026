"""The household calculator's self-employment answers: the head's gross
receipts (turnover) and allowable expenses a year, given to
policyengine-uk as ``self_employment_gross_receipts`` and
``self_employment_income`` (receipts less expenses), so its
``trading_allowance_deduction`` chooses between the trading allowance and
the actual expenses. Household simulations only, no dataset.
"""

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api, household_impact
from uk_budget_data.api import HouseholdAnswersRequest

MEASURE = "trading_allowance_raise"


def Answers(**values):
    return household_impact.HouseholdAnswers(**values)


@pytest.fixture(autouse=True)
def _fresh_runs():
    household_impact.clear_runs()
    yield
    household_impact.clear_runs()


def test_no_self_employment_by_default_and_the_household_is_built_as_before():
    assert HouseholdAnswersRequest().answers() == Answers()
    for answers in (Answers(), Answers(has_partner=True)):
        people, _, _ = household_impact.household_entities(answers, 2027)
        for person in people:
            assert "self_employment_income" not in person
            assert "self_employment_gross_receipts" not in person


def test_receipts_and_expenses_give_profit_and_receipts():
    people, _, _ = household_impact.household_entities(
        Answers(self_employment_receipts=3_000, self_employment_expenses=500),
        2027,
    )
    assert people[0]["self_employment_gross_receipts"] == 3_000
    assert people[0]["self_employment_income"] == 2_500


@pytest.mark.parametrize(
    "field", ["self_employment_receipts", "self_employment_expenses"]
)
def test_a_negative_amount_is_refused_naming_the_field(field):
    response = TestClient(api.app).post(
        "/api/household-impact",
        json={
            "year": 2027,
            "policies": [MEASURE],
            "household": {field: -1},
            "include": [],
        },
    )
    assert response.status_code == 422
    assert ["body", "household", field] in [
        error["loc"] for error in response.json()["detail"]
    ]


@pytest.mark.parametrize(
    "answers, year, expected",
    [
        ({}, 2027, True),
        ({"self_employment_receipts": 3_000}, 2026, True),
        ({"self_employment_receipts": 3_000}, 2027, False),
        ({"self_employment_expenses": 100}, 2031, False),
    ],
)
def test_the_trading_allowance_is_skipped_only_without_self_employment(
    answers, year, expected
):
    assert (
        household_impact.provably_unaffected(MEASURE, Answers(**answers), year)
        is expected
    )


def _run(year=2027, **values):
    return household_impact.calculate_household_impact(
        Answers(employment_income=30_000, **values),
        [MEASURE],
        year,
        include=("by_policy",),
    )


def _row(result, id_):
    return next(row for row in result["programmes"] if row["id"] == id_)


def test_max_s_case_an_employee_with_3000_of_receipts_gains_400():
    """An employee on £30,000 with £3,000 of receipts and no expenses: the
    allowance rises from £1,000 to £3,000 in 2027-28, so £2,000 less
    profit is taxed at the basic rate, 20%: £400 less income tax (Max,
    #290, 28 October 2026)."""
    result = _run(self_employment_receipts=3_000)
    assert _row(result, "income_tax")["change"] == pytest.approx(-400, abs=1)
    assert result["net_income"]["change"] == pytest.approx(400, abs=1)
    (measure,) = result["by_policy"]["measures"]
    assert measure["status"] == "affected"
    assert _row(result, "self_employment_income")["baseline"] == 3_000


def test_expenses_above_the_old_allowance_are_kept_until_the_new_one_beats_them():
    """£3,000 of receipts with £2,500 of expenses: before, the expenses
    (more than £1,000) are deducted, a £500 profit; after, the £3,000
    allowance replaces them, so no profit is taxed: £100 less tax."""
    result = _run(
        self_employment_receipts=3_000, self_employment_expenses=2_500
    )
    assert _row(result, "income_tax")["change"] == pytest.approx(-100, abs=1)


def test_before_2027_28_and_without_receipts_nothing_changes():
    assert _run(year=2026, self_employment_receipts=3_000)["net_income"][
        "change"
    ] == pytest.approx(0, abs=0.01)
    result = _run()
    assert result["net_income"]["change"] == 0
    assert "self_employment_income" not in {
        row["id"] for row in result["programmes"]
    }
