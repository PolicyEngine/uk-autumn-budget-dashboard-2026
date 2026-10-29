"""The household calculator's business mileage (#357): the head's
business miles a year in their own car or van, driven as an employee or
self-employed, and the household-only measure ``mileage_rates_raise``,
the Budget's 35p a mile above 10,000 miles from 2027-28 against current
law's 25p (``uk_budget_data.mileage_rates``).

A household with no business miles is built, run and answered exactly as
before the form asked. The measure is in no national figure: it is not in
``reforms.py``'s registry, only in the household calculation's own list.
Household simulations, no dataset, except the stand-in engine tests.
"""

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api, household_impact
from uk_budget_data.api import HouseholdAnswersRequest
from uk_budget_data.mileage_rates import (
    EMPLOYEE,
    MILEAGE_RATES_ID,
    MILEAGE_RATES_NAME,
    SELF_EMPLOYED,
)
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

FUEL_DUTY = "fuel_duty_rise_deferral"


def Answers(**values):
    """Answers with salaries entered for the year calculated, so no
    earnings growth applies."""
    values.setdefault("salary_year", 2027)
    return household_impact.HouseholdAnswers(**values)


@pytest.fixture(autouse=True)
def _fresh_runs():
    household_impact.clear_runs()
    yield
    household_impact.clear_runs()


def calculate(answers, measures=(MILEAGE_RATES_ID,), year=2027, **options):
    options.setdefault("include", ("by_policy",))
    return household_impact.calculate_household_impact(
        answers, list(measures), year, **options
    )


def row(result, row_id):
    return next(
        entry for entry in result["programmes"] if entry["id"] == row_id
    )


def measure_entry(result, measure_id=MILEAGE_RATES_ID):
    return next(
        entry
        for entry in result["by_policy"]["measures"]
        if entry["id"] == measure_id
    )


# The request and the household


def test_no_business_miles_by_default_and_the_household_is_built_as_before():
    assert (
        HouseholdAnswersRequest().answers()
        == household_impact.HouseholdAnswers()
    )
    assert household_impact.HouseholdAnswers().business_miles == 0
    assert household_impact.HouseholdAnswers().business_miles_role == EMPLOYEE
    for answers in (
        Answers(),
        Answers(
            self_employment_receipts=20_000, business_miles_role=SELF_EMPLOYED
        ),
    ):
        before = household_impact.household_entities(answers, 2027)
        budget = household_impact.household_entities(
            answers, 2027, budget_mileage=True
        )
        assert budget == before
        for person in before[0]:
            assert "employment_deductions" not in person
            assert "capital_allowances" not in person


def test_an_employees_relief_goes_on_the_budget_side_only():
    answers = Answers(employment_income=30_000, business_miles=15_000)
    before, _, _ = household_impact.household_entities(answers, 2027)
    budget, _, _ = household_impact.household_entities(
        answers, 2027, budget_mileage=True
    )
    assert "employment_deductions" not in before[0]
    assert budget[0]["employment_deductions"] == pytest.approx(500)
    assert budget[0]["employment_income"] == before[0]["employment_income"]


def test_a_self_employed_drivers_miles_come_off_profit_on_both_sides():
    answers = Answers(
        employment_income=0,
        self_employment_receipts=30_000,
        self_employment_expenses=5_000,
        business_miles=15_000,
        business_miles_role=SELF_EMPLOYED,
    )
    before, _, _ = household_impact.household_entities(answers, 2027)
    budget, _, _ = household_impact.household_entities(
        answers, 2027, budget_mileage=True
    )
    universal_credit_rate = 0.45 * 9_996 + 0.25 * (15_000 - 9_996)
    assert before[0]["self_employment_income"] == pytest.approx(
        25_000 - universal_credit_rate
    )
    assert (
        budget[0]["self_employment_income"]
        == before[0]["self_employment_income"]
    )
    assert budget[0]["capital_allowances"] - before[0][
        "capital_allowances"
    ] == pytest.approx(500)
    # Receipts are as entered: the trading allowance election reads them
    assert before[0]["self_employment_gross_receipts"] == 30_000


def test_the_measure_is_household_only():
    """Accepted by the household calculation, never registered for the
    national results."""
    assert MILEAGE_RATES_ID in household_impact.household_measure_ids()
    assert MILEAGE_RATES_ID not in household_impact.measure_ids()
    assert MILEAGE_RATES_ID not in {
        reform.id for reform in get_autumn_budget_2026_reforms()
    }
    assert set(household_impact.measure_ids()) < set(
        household_impact.household_measure_ids()
    )


@pytest.mark.parametrize(
    "household, field, error_type",
    [
        ({"business_miles": -1}, "business_miles", "greater_than_equal"),
        ({"business_miles": 100_001}, "business_miles", "less_than_equal"),
        # Whole miles only (Anthony, on #357)
        ({"business_miles": 15_000.5}, "business_miles", "int_from_float"),
        (
            {"business_miles": 5_000, "business_miles_role": "COMPANY_CAR"},
            "business_miles_role",
            "literal_error",
        ),
    ],
)
def test_out_of_range_answers_are_refused_naming_the_field(
    household, field, error_type
):
    """Refused for the value, not as a field the API does not know."""
    response = TestClient(api.app).post(
        "/api/household-impact",
        json={
            "year": 2027,
            "policies": [MILEAGE_RATES_ID],
            "household": household,
            "include": [],
        },
    )
    assert response.status_code == 422
    errors = {
        tuple(error["loc"]): error["type"]
        for error in response.json()["detail"]
    }
    assert errors.get(("body", "household", field)) == error_type


def test_the_api_accepts_the_measure_with_registered_ones():
    response = TestClient(api.app).post(
        "/api/household-impact",
        json={
            "year": 2027,
            "policies": [FUEL_DUTY, MILEAGE_RATES_ID],
            "household": {
                "employment_income": 30_000,
                "business_miles": 15_000,
            },
            "include": [],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["included"] == [FUEL_DUTY, MILEAGE_RATES_ID]
    assert body["mileage_used"]["business_miles"] == 15_000
    assert body["mileage_used"]["deduction_change"] == pytest.approx(500)


# The calculation, with the engine


def test_a_basic_rate_employee_driving_15000_miles_gains_100_in_2027_28():
    """500 miles above 10,000 at 10p more, relieved at 20%: £100 less
    income tax, the same National Insurance."""
    result = calculate(
        Answers(employment_income=30_000, business_miles=15_000)
    )
    assert row(result, "income_tax")["change"] == pytest.approx(-100, abs=0.01)
    assert row(result, "national_insurance")["change"] == 0
    assert result["net_income"]["change"] == pytest.approx(100, abs=0.01)
    entry = measure_entry(result)
    assert entry["name"] == MILEAGE_RATES_NAME
    assert entry["status"] == "affected"
    assert result["included"] == [MILEAGE_RATES_ID]
    assert result["mileage_used"]["role"] == EMPLOYEE
    assert result["mileage_used"]["current_law_rates"] == {
        "first_miles": 0.55,
        "further_miles": 0.25,
    }
    assert result["mileage_used"]["budget_rates"] == {
        "first_miles": 0.55,
        "further_miles": 0.35,
    }


def test_a_higher_rate_employee_gains_200():
    result = calculate(
        Answers(employment_income=70_000, business_miles=15_000)
    )
    assert result["net_income"]["change"] == pytest.approx(200, abs=0.01)


@pytest.mark.parametrize("miles", [6_000, 10_000])
def test_up_to_10000_miles_the_budget_changes_nothing(miles):
    """Current law already gives 55p for the first 10,000 miles."""
    result = calculate(Answers(employment_income=30_000, business_miles=miles))
    assert result["net_income"]["change"] == 0
    assert measure_entry(result)["status"] == "not_affected"


def test_in_2026_27_the_budget_changes_nothing():
    result = calculate(
        Answers(
            employment_income=30_000, business_miles=15_000, salary_year=2026
        ),
        year=2026,
    )
    assert result["net_income"]["change"] == 0


def test_a_self_employed_driver_pays_less_income_tax_and_class_4():
    """£500 less taxable profit: 20% income tax and 6% Class 4, £130."""
    result = calculate(
        Answers(
            employment_income=0,
            self_employment_receipts=30_000,
            self_employment_expenses=5_000,
            business_miles=15_000,
            business_miles_role=SELF_EMPLOYED,
        )
    )
    assert row(result, "income_tax")["change"] == pytest.approx(-100, abs=0.01)
    # The table's National Insurance row is Class 1 (ni_employee); Class 4
    # has no row of its own, so it is in Other taxes
    assert row(result, "national_insurance")["change"] == 0
    assert row(result, "other_taxes")["change"] == pytest.approx(-30, abs=0.01)
    assert result["net_income"]["change"] == pytest.approx(130, abs=0.01)


def test_universal_credit_takes_back_55p_of_each_pound_of_tax_saved():
    """An employee on Universal Credit, earning above the work allowance:
    £100 less income tax raises their earnings for Universal Credit by
    £100, so the award falls by 55% of it, £55, leaving £45."""
    result = calculate(
        Answers(
            age=30,
            employment_income=20_000,
            children=(
                household_impact.Child(age=3),
                household_impact.Child(age=6),
            ),
            region="NORTH_WEST",
            tenure="RENT_PRIVATELY",
            monthly_rent=900,
            claims_universal_credit=True,
            business_miles=15_000,
        )
    )
    assert row(result, "income_tax")["change"] == pytest.approx(-100, abs=0.01)
    assert row(result, "universal_credit")["change"] == pytest.approx(
        -55, abs=0.01
    )
    assert result["net_income"]["change"] == pytest.approx(45, abs=0.01)


def test_miles_without_the_measure_change_nothing():
    """A request without the measure takes the miles at current law on
    both sides: the other measures' change is as without miles."""
    with_miles = calculate(
        Answers(
            employment_income=30_000,
            petrol_spending=1_000,
            business_miles=15_000,
        ),
        measures=[FUEL_DUTY],
    )
    without_miles = calculate(
        Answers(employment_income=30_000, petrol_spending=1_000),
        measures=[FUEL_DUTY],
    )
    assert with_miles["included"] == [FUEL_DUTY]
    assert (
        with_miles["net_income"]["change"]
        == without_miles["net_income"]["change"]
    )


def test_the_split_by_policy_holds_each_measure_at_its_own_setting():
    result = calculate(
        Answers(
            employment_income=30_000,
            petrol_spending=1_000,
            business_miles=15_000,
        ),
        measures=[FUEL_DUTY, MILEAGE_RATES_ID],
    )
    assert result["included"] == [FUEL_DUTY, MILEAGE_RATES_ID]
    assert measure_entry(result)["change"] == pytest.approx(100, abs=0.01)
    fuel = measure_entry(result, FUEL_DUTY)
    assert result["by_policy"]["combined"] == pytest.approx(
        fuel["change"] + 100, abs=0.02
    )


def test_the_sweep_moves_by_the_relief():
    result = calculate(
        Answers(employment_income=30_000, business_miles=15_000),
        include=("sweep",),
    )
    sweep = result["sweep"]
    assert sweep["own_point"]["reform"] - sweep["own_point"]["baseline"] == (
        pytest.approx(100, abs=0.01)
    )
    # Between the personal allowance and the higher rate, every point
    # gains the basic rate on £500
    basic_rate_points = [
        point
        for point in sweep["points"]
        if 14_000 <= point["employment_income"] <= 45_000
    ]
    assert basic_rate_points
    for point in basic_rate_points:
        assert point["change"] == pytest.approx(100, abs=0.01)


@pytest.mark.parametrize(
    "answers, year, expected",
    [
        ({}, 2027, True),
        ({"business_miles": 10_000}, 2031, True),
        ({"business_miles": 15_000}, 2026, True),
        ({"business_miles": 15_000}, 2027, False),
        (
            {"business_miles": 15_000, "business_miles_role": SELF_EMPLOYED},
            2027,
            True,
        ),
        (
            {
                "business_miles": 15_000,
                "business_miles_role": SELF_EMPLOYED,
                "self_employment_receipts": 30_000,
            },
            2027,
            False,
        ),
    ],
)
def test_the_measure_is_skipped_only_when_it_cannot_change_anything(
    answers, year, expected
):
    assert (
        household_impact.provably_unaffected(
            MILEAGE_RATES_ID, Answers(**answers), year
        )
        is expected
    )


@pytest.mark.parametrize(
    "answers, year",
    [
        ({"business_miles": 6_000}, 2027),
        ({"business_miles": 15_000}, 2026),
        (
            {"business_miles": 15_000, "business_miles_role": SELF_EMPLOYED},
            2029,
        ),
    ],
)
def test_a_skip_gives_the_same_answer_as_running_the_measure(answers, year):
    answers = Answers(employment_income=30_000, salary_year=year, **answers)
    measures = [FUEL_DUTY, MILEAGE_RATES_ID]
    full = calculate(answers, measures, year, skip_unaffected=False)
    household_impact.clear_runs()
    fast = calculate(answers, measures, year)
    assert fast == full


# The runs, with a stand-in engine


def test_the_budget_mileage_goes_to_the_budget_side_and_the_measures_single(
    monkeypatch,
):
    calls = []

    def run_scenario(
        people,
        benunit,
        household,
        year,
        side,
        axes=None,
        only=False,
        parts=False,
    ):
        calls.append(
            {
                "side": side,
                "relief": people[0].get("employment_deductions", 0),
                "axes": axes is not None,
            }
        )
        if axes is not None:
            return {"household_net_income": [40_000.0] * axes[0]["count"]}
        if only:
            return {"household_net_income": 40_000.0}
        return {
            "household_net_income": 40_000.0,
            "rows": {entry.id: 0.0 for entry in household_impact._all_rows()},
            "dependants": [
                {v: True for v in household_impact.DEPENDANT_VARIABLES}
            ],
            "brma": "X",
            "local_authority": "Y",
        }

    monkeypatch.setattr(household_impact, "run_scenario", run_scenario)
    sides = household_impact.measure_sides([FUEL_DUTY])
    calculate(
        Answers(
            employment_income=30_000,
            petrol_spending=1_000,
            business_miles=15_000,
        ),
        measures=[FUEL_DUTY, MILEAGE_RATES_ID],
        include=("by_policy", "sweep"),
        skip_unaffected=False,
    )
    by_side = [(call["side"], call["relief"], call["axes"]) for call in calls]
    assert by_side == [
        # Pre-Budget law, then the Budget
        (sides.before, 0, False),
        (sides.after, pytest.approx(500), False),
        # The fuel duty measure alone: mileage at current law
        (sides.singles[FUEL_DUTY], 0, False),
        # The mileage measure alone: every other measure at pre-Budget law
        (sides.before, pytest.approx(500), False),
        # The sweep, and the rate at the head's own pay
        (sides.before, 0, True),
        (sides.after, pytest.approx(500), True),
        (sides.before, 0, False),
        (sides.after, pytest.approx(500), False),
    ]
