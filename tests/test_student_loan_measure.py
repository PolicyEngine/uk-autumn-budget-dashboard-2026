"""The student loan threshold freeze on the certified policyengine-uk.

These run household simulations, so they need no dataset. The household
supplies its own ``student_loan_repayments`` value, as the dataset does.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.reforms import (
    _connect_student_loan_variables,
    get_reform,
)

REPORTED = 500.0
YEAR = 2028
# The model computes in float32, so pounds agree to within a penny.
PENNY = 0.01


def household(employment_income: float = 45_000) -> dict:
    return {
        "people": {
            "graduate": {
                "age": {YEAR: 30},
                "employment_income": {YEAR: employment_income},
                "student_loan_plan": {YEAR: "PLAN_2"},
                "student_loan_balance": {YEAR: 60_000},
                "student_loan_repayments": {YEAR: REPORTED},
            }
        },
        "benunits": {"benunit": {"members": ["graduate"]}},
        "households": {"household": {"members": ["graduate"]}},
    }


def run(scenario=None, **kwargs) -> Simulation:
    return Simulation(situation=household(**kwargs), scenario=scenario)


def value(sim: Simulation, variable: str) -> float:
    return float(sim.calculate(variable, YEAR).sum())


def test_without_the_modifier_the_reported_value_masks_the_model():
    sim = run()
    assert value(sim, "student_loan_repayments") == REPORTED
    assert value(sim, "student_loan_repayment") > REPORTED


def test_the_modifier_runs_and_counts_modelled_repayments_everywhere():
    plain = run()
    connected = run(
        Scenario(simulation_modifier=_connect_student_loan_variables)
    )
    modelled = value(connected, "student_loan_repayment")
    assert value(connected, "student_loan_repayments") == pytest.approx(
        modelled, abs=PENNY
    )
    shift = modelled - REPORTED
    for variable, sign in (
        ("gov_tax", 1),
        ("household_tax", 1),
        ("hbai_household_net_income", -1),
    ):
        assert value(connected, variable) - value(
            plain, variable
        ) == pytest.approx(sign * shift, abs=PENNY), variable


def test_the_freeze_raises_repayments_for_a_graduate_above_the_threshold():
    """Responsiveness: frozen thresholds mean more repaid than RPI ones."""
    measure = get_reform("freeze_student_loan_thresholds")
    baseline = run(measure.to_baseline_scenario())
    reformed = run(measure.to_scenario())
    gained = value(reformed, "gov_tax") - value(baseline, "gov_tax")
    repaid = value(reformed, "student_loan_repayments") - value(
        baseline, "student_loan_repayments"
    )
    assert repaid > 0
    assert gained == pytest.approx(repaid, abs=PENNY)


def test_a_graduate_below_both_thresholds_is_unaffected():
    measure = get_reform("freeze_student_loan_thresholds")
    baseline = run(measure.to_baseline_scenario(), employment_income=20_000)
    reformed = run(measure.to_scenario(), employment_income=20_000)
    assert value(reformed, "student_loan_repayments") == 0
    assert value(baseline, "student_loan_repayments") == 0
