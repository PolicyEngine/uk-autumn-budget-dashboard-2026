"""The State Pension income tax protection for people whose only income is
the State Pension (``state_pension_only_income_tax_allowance``).

Hand-computed cases, 2027-28, personal allowance £12,570 (frozen) and
basic rate 20%. The full new State Pension is £13,036.40 a year from April
2027 (£250.70 a week, as reported on 26 October 2026); each case gives it
as an input, so the engine's own projection (£13,036.97) plays no part.
"""

import math

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.budget_measures.state_pension_only_income_tax_allowance import (
    state_pension_only_income_tax_allowance,
)

FULL_NEW_STATE_PENSION = 13_036.40
YEAR = 2027


def _person(age, state_pension=0.0, **incomes):
    person = {"age": {YEAR: age}, "state_pension": {YEAR: state_pension}}
    for name, value in incomes.items():
        person[name] = {YEAR: value}
    return {
        "people": {"p": person},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {YEAR: "LONDON"}}},
    }


def _income_tax(situation, **arguments):
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    state_pension_only_income_tax_allowance(reformed, **arguments)
    return (
        baseline.calculate("income_tax", YEAR)[0],
        reformed.calculate("income_tax", YEAR)[0],
    )


def test_full_new_state_pension_only_pays_no_tax():
    # Baseline: (13,036.40 - 12,570) x 20% = £93.28. Reform: allowance
    # £13,037 covers it all.
    before, after = _income_tax(_person(75, FULL_NEW_STATE_PENSION))
    assert before == pytest.approx(93.28, abs=0.01)
    assert after == pytest.approx(0, abs=0.01)


def test_large_private_pension_is_unchanged():
    # (33,036.40 - 12,570) x 20% = £4,093.28 either way.
    situation = _person(
        75, FULL_NEW_STATE_PENSION, private_pension_income=20_000
    )
    before, after = _income_tax(situation)
    assert before == pytest.approx(4_093.28, abs=0.01)
    assert after == pytest.approx(before, abs=0.01)


def test_small_private_pension_loses_the_whole_allowance():
    # The cliff: £1,000 of private pension, (14,036.40 - 12,570) x 20% =
    # £293.28 either way.
    situation = _person(
        75, FULL_NEW_STATE_PENSION, private_pension_income=1_000
    )
    before, after = _income_tax(situation)
    assert before == pytest.approx(293.28, abs=0.01)
    assert after == pytest.approx(before, abs=0.01)


def test_savings_interest_does_not_disqualify():
    # Baseline: £93.28 on the State Pension; £200 of interest falls in the
    # starting rate for savings. Reform: no taxable non-savings income.
    situation = _person(
        75, FULL_NEW_STATE_PENSION, savings_interest_income=200
    )
    before, after = _income_tax(situation)
    assert before == pytest.approx(93.28, abs=0.01)
    assert after == pytest.approx(0, abs=0.01)


def test_savings_interest_disqualifies_when_not_disregarded():
    situation = _person(
        75, FULL_NEW_STATE_PENSION, savings_interest_income=200
    )
    before, after = _income_tax(situation, disregard_savings_interest=False)
    assert after == pytest.approx(before, abs=0.01)


def test_working_age_person_is_unchanged():
    # Age 40, £13,036.40 of earnings: £93.28 either way.
    situation = _person(40, employment_income=FULL_NEW_STATE_PENSION)
    before, after = _income_tax(situation)
    assert before == pytest.approx(93.28, abs=0.01)
    assert after == pytest.approx(before, abs=0.01)


def test_over_state_pension_age_without_a_state_pension_is_unchanged():
    situation = _person(75, private_pension_income=FULL_NEW_STATE_PENSION)
    before, after = _income_tax(situation)
    assert after == pytest.approx(before, abs=0.01)


def test_alternative_for_every_pensioner_by_raising_the_limit():
    # With no income test, the £20,000 private pension keeps the allowance:
    # (33,036.40 - 13,037) x 20% = £3,999.88, £93.40 less.
    situation = _person(
        75, FULL_NEW_STATE_PENSION, private_pension_income=20_000
    )
    before, after = _income_tax(situation, other_income_limit=1e12)
    assert after == pytest.approx(3_999.88, abs=0.01)
    assert before - after == pytest.approx(93.40, abs=0.01)


def test_alternative_keeps_the_native_taper_above_100000():
    # £150,000 of total income: the taper takes the whole allowance.
    situation = _person(
        75,
        FULL_NEW_STATE_PENSION,
        private_pension_income=150_000 - FULL_NEW_STATE_PENSION,
    )
    before, after = _income_tax(situation, other_income_limit=1e12)
    assert after == pytest.approx(before, abs=0.01)


def test_no_change_before_april_2027():
    situation = {
        "people": {"p": {"age": {2026: 75}, "state_pension": {2026: 12_900}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2026: "LONDON"}}},
    }
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    state_pension_only_income_tax_allowance(reformed)
    assert reformed.calculate("income_tax", 2026)[0] == pytest.approx(
        baseline.calculate("income_tax", 2026)[0], abs=0.01
    )


@pytest.mark.parametrize("year", [2027, 2028, 2029, 2030, 2031])
def test_allowance_is_the_engine_full_new_state_pension_rounded_up(year):
    weekly = system.parameters.gov.dwp.state_pension.new_state_pension.amount(
        f"{year}-04-06"
    )
    defaults = state_pension_only_income_tax_allowance.__defaults__
    allowance = dict(zip(range(2027, 2032), defaults[:5]))[year]
    assert allowance == math.ceil(weekly * 52)
