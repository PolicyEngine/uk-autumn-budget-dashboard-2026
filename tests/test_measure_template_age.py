"""Regression coverage for both tapers of an age-conditioned allowance."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.measure_templates import apply_age_conditioned_allowance


def _pensioner(income, age=75, gift_aid=0):
    return {
        "people": {
            "p": {
                "age": {2028: age},
                "private_pension_income": {2028: income},
                "gift_aid": {2028: gift_aid},
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


@pytest.mark.parametrize(
    "income, gift_aid, expected",
    # £8,000 of Gift Aid grosses up to £10,000 at the 20% basic rate, so
    # both pensioners have adjusted net income of £100,000: the age taper
    # leaves 15,000 - (100,000 - 24,000) x 0.01. The second is above
    # £100,000 before the gift, so it also tests the £1-for-£1 taper.
    [(100_000, 0, 14_240), (110_000, 8_000, 14_240)],
)
def test_age_allowance_deducts_gift_aid_once(income, gift_aid, expected):
    sim = Simulation(situation=_pensioner(income, gift_aid=gift_aid))
    assert sim.calculate("adjusted_net_income", 2028)[0] == 100_000
    apply_age_conditioned_allowance(
        sim,
        allowance_by_year={2028: 15_000},
        taper_threshold=24_000,
        taper_rate=0.01,
    )
    assert sim.calculate("personal_allowance", 2028)[0] == expected
