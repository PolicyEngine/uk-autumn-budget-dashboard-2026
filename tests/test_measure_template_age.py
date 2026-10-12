"""Regression coverage for both tapers of an age-conditioned allowance."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.measure_templates import apply_age_conditioned_allowance


def _pensioner(income, age=75):
    return {
        "people": {
            "p": {
                "age": {2028: age},
                "private_pension_income": {2028: income},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2028: "LONDON"}}},
    }


@pytest.mark.parametrize(
    "income, expected",
    [(110_000, 9140), (130_000, 0), (20_000, 15_000)],
)
def test_age_allowance_preserves_native_high_income_taper(income, expected):
    sim = Simulation(situation=_pensioner(income))
    apply_age_conditioned_allowance(
        sim,
        allowance_by_year={2028: 15_000},
        taper_threshold=24_000,
        taper_rate=0.01,
    )
    assert sim.calculate("personal_allowance", 2028)[0] == expected


def test_age_allowance_noneligible_person_keeps_native_allowance():
    sim = Simulation(situation=_pensioner(110_000, age=40))
    native = sim.calculate("personal_allowance", 2028)[0]
    assert native == 7570
    apply_age_conditioned_allowance(
        sim,
        allowance_by_year={2028: 15_000},
        taper_threshold=24_000,
        taper_rate=0.01,
    )
    assert sim.calculate("personal_allowance", 2028)[0] == native


def test_age_allowance_rounds_after_both_tapers():
    sim = Simulation(situation=_pensioner(110_001.98))
    apply_age_conditioned_allowance(
        sim,
        allowance_by_year={2028: 15_000},
        taper_threshold=24_000,
        taper_rate=0.01,
    )
    assert sim.calculate("personal_allowance", 2028)[0] == 9139
