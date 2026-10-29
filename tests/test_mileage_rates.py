"""The tax-free mileage rates for business miles in the driver's own car or
van (Budget 2026, Table 6.1 row 5; #357), as the household calculator
applies them: the rates by tax year under current law and under the
Budget, the approved amount for a year's miles, and the policyengine-uk
inputs each side gives the head. No engine.
"""

import pytest

from uk_budget_data import mileage_rates
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.mileage_rates import (
    EMPLOYEE,
    SELF_EMPLOYED,
    MileageInputs,
    MileageRates,
    approved_amount,
    car_and_van_rates,
    deduction_change,
    mileage_inputs,
)

# The rates before the Taxation (Energy and Vehicles) Act 2026, which the
# Treasury's examples compare 2027-28 with (Budget 2026, footnote 99)
RATES_BEFORE_THE_MAY_CHANGE = MileageRates(
    first_miles=0.45, further_miles=0.25
)


@pytest.mark.parametrize("year", POLICY_YEARS)
def test_current_law_is_55p_then_25p_in_every_policy_year(year):
    """The Taxation (Energy and Vehicles) Act 2026, s. 2: 55p for the first
    10,000 miles from 2026-27 "and subsequent tax years", 25p above."""
    assert car_and_van_rates(year, budget=False) == MileageRates(0.55, 0.25)


def test_the_budget_raises_the_rate_above_10000_miles_to_35p_from_2027_28():
    assert car_and_van_rates(2026, budget=True) == MileageRates(0.55, 0.25)
    for year in POLICY_YEARS[1:]:
        assert car_and_van_rates(year, budget=True) == MileageRates(0.55, 0.35)


@pytest.mark.parametrize(
    "miles, expected",
    [
        (0, 0),
        (6_000, 3_300),
        (10_000, 5_500),
        (10_001, 5_500.25),
        (15_000, 6_750),
    ],
)
def test_the_approved_amount_takes_the_lower_rate_after_10000_miles(
    miles, expected
):
    assert approved_amount(miles, MileageRates(0.55, 0.25)) == pytest.approx(
        expected
    )


@pytest.mark.parametrize("miles", [0, 500, 6_000, 9_999, 10_000])
def test_the_budget_changes_nothing_up_to_10000_miles(miles):
    for year in POLICY_YEARS:
        assert deduction_change(miles, year) == 0


@pytest.mark.parametrize("miles", [10_001, 12_000, 15_000, 20_000, 40_000])
def test_from_2027_28_the_budget_adds_10p_for_each_mile_above_10000(miles):
    assert deduction_change(miles, 2026) == 0
    for year in POLICY_YEARS[1:]:
        assert deduction_change(miles, year) == pytest.approx(
            0.10 * (miles - 10_000)
        )


def test_the_treasurys_examples_are_against_45p_not_current_law():
    """£120 for 6,000 miles and £300 for 15,000 at the basic rate, 20%,
    are the Budget's rates against 45p and 25p. Against current law the
    same miles give £0 and £100."""
    basic_rate = 0.20
    budget_2027 = car_and_van_rates(2027, budget=True)
    against_45p = {
        miles: basic_rate
        * (
            approved_amount(miles, budget_2027)
            - approved_amount(miles, RATES_BEFORE_THE_MAY_CHANGE)
        )
        for miles in (6_000, 15_000)
    }
    assert against_45p == {
        6_000: pytest.approx(120),
        15_000: pytest.approx(300),
    }
    assert basic_rate * deduction_change(6_000, 2027) == 0
    assert basic_rate * deduction_change(15_000, 2027) == pytest.approx(100)


def test_an_employee_claims_relief_on_the_rise_alone():
    """The employer pays the current-law approved amount, so before the
    Budget there is no relief, and after it the relief is the rise."""
    before = mileage_inputs(15_000, EMPLOYEE, 2027, budget=False)
    after = mileage_inputs(15_000, EMPLOYEE, 2027, budget=True)
    assert before == MileageInputs()
    assert after == MileageInputs(employment_deductions=pytest.approx(500))
    assert (
        mileage_inputs(15_000, EMPLOYEE, 2026, budget=True) == MileageInputs()
    )


def test_a_self_employed_driver_deducts_universal_credits_flat_rate_from_profit():
    """Profit takes Universal Credit's own flat rate (reg. 59: 45p for 833
    miles an assessment period, 25p after, so 9,996 miles a year), on both
    sides; the tax rates' excess over it is a deduction for income tax and
    Class 4 only. The Budget adds 10p a mile above 10,000 to the excess."""
    universal_credit_rate = 0.45 * 9_996 + 0.25 * (15_000 - 9_996)
    before = mileage_inputs(
        15_000, SELF_EMPLOYED, 2027, budget=False, profit=20_000
    )
    after = mileage_inputs(
        15_000, SELF_EMPLOYED, 2027, budget=True, profit=20_000
    )
    assert before.profit_deduction == pytest.approx(universal_credit_rate)
    assert after.profit_deduction == before.profit_deduction
    assert before.capital_allowances == pytest.approx(
        6_750 - universal_credit_rate
    )
    assert (
        after.capital_allowances - before.capital_allowances
        == pytest.approx(500)
    )
    assert before.employment_deductions == after.employment_deductions == 0


def test_the_flat_rate_deduction_stops_at_a_nil_profit():
    """No trading loss is made: a £1,000 profit and 6,000 miles leave a nil
    profit, not a £1,700 loss."""
    inputs = mileage_inputs(
        6_000, SELF_EMPLOYED, 2027, budget=False, profit=1_000
    )
    assert inputs.profit_deduction == 1_000
    assert (
        mileage_inputs(
            6_000, SELF_EMPLOYED, 2027, budget=False, profit=0
        ).profit_deduction
        == 0
    )


def test_without_miles_or_without_self_employment_nothing_is_given():
    for role in (EMPLOYEE, SELF_EMPLOYED):
        for budget in (False, True):
            assert (
                mileage_inputs(0, role, 2029, budget=budget) == MileageInputs()
            )
    # Self-employed miles with no self-employment answers have no profit to
    # come off
    assert (
        mileage_inputs(15_000, SELF_EMPLOYED, 2029, budget=True, profit=None)
        == MileageInputs()
    )


def test_the_inputs_go_on_the_person_only_where_they_are_not_nil():
    person = {"age": 40, "employment_income": 30_000}
    assert MileageInputs().on(person) == person
    assert MileageInputs(employment_deductions=500).on(person) == {
        **person,
        "employment_deductions": 500,
    }
    self_employed = {"age": 40, "self_employment_income": 20_000}
    assert MileageInputs(profit_deduction=5_000, capital_allowances=1_000).on(
        self_employed
    ) == {
        **self_employed,
        "self_employment_income": 15_000,
        "capital_allowances": 1_000,
    }
    # The person given is not changed
    assert self_employed["self_employment_income"] == 20_000


def test_an_unknown_role_is_refused():
    with pytest.raises(ValueError, match="EMPLOYEE or SELF_EMPLOYED"):
        mileage_inputs(1_000, "COMPANY_CAR", 2027, budget=True)


def test_the_measure_is_named_for_the_calculator():
    assert mileage_rates.MILEAGE_RATES_ID == "mileage_rates_raise"
    assert mileage_rates.ROLES == (EMPLOYEE, SELF_EMPLOYED)
