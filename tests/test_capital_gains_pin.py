"""The measures that move capital gains tax are scored static.

``static_capital_gains`` sets policyengine-uk's capital gains responses to
none on the reform side of every measure that moves capital gains tax, so
its figure stays static when the engine pin moves to one whose main
elasticity defaults to 1 (from 2.134.0). The engine scales the reformed
simulation's gains by its own elasticities, so current law needs no pin.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.combine import combine_measures
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    BADR_ID,
    BADR_LIFETIME_LIMIT,
    CAPITAL_GAINS_RESPONSES,
    STATE_PENSION_ALLOWANCE_ID,
    THRESHOLD_FREEZE_ID,
    get_autumn_budget_2026_reforms,
    get_reform,
    static_capital_gains,
)

YEARS = [str(year) for year in POLICY_YEARS]
# The measures that move capital gains tax: the relief's limit, the basic
# rate band (which gains pay the lower rate) and the State Pension allowance
# (taxable income).
PINNED = (BADR_ID, THRESHOLD_FREEZE_ID, STATE_PENSION_ALLOWANCE_ID)


def test_the_pin_sets_no_response_in_every_policy_year():
    assert static_capital_gains() == {
        f"{CAPITAL_GAINS_RESPONSES}.elasticity": {y: 0 for y in YEARS},
        f"{CAPITAL_GAINS_RESPONSES}.mtr_elasticity": {y: 0 for y in YEARS},
        f"{CAPITAL_GAINS_RESPONSES}.separate_badr_elasticity": {
            y: False for y in YEARS
        },
    }


def _responses(changes) -> dict:
    return {
        path: periods
        for path, periods in (changes or {}).items()
        if path.startswith(CAPITAL_GAINS_RESPONSES)
    }


@pytest.mark.parametrize(
    "measure",
    [m for m in get_autumn_budget_2026_reforms()],
    ids=lambda m: m.id,
)
def test_exactly_the_capital_gains_measures_carry_the_pin(measure):
    """On the reform side only; the combined package carries it as its
    members do."""
    pinned = measure.id in (*PINNED, AUTUMN_BUDGET_2026_COMBINED_ID)
    expected = static_capital_gains() if pinned else {}
    assert _responses(measure.parameter_changes) == expected
    assert _responses(measure.baseline_parameter_changes) == {}


def test_capital_gains_measures_combine_with_the_shared_pin():
    """Each sets the pin, to the same values, so a package of them is one
    simulation with the pin set once."""
    combined = combine_measures(
        [get_reform(measure_id) for measure_id in PINNED], DataConfig()
    )
    assert _responses(combined.parameter_changes) == static_capital_gains()


def _capital_gains_tax(scenario: Scenario) -> float:
    year = 2027
    sim = Simulation(
        situation={
            "people": {
                "founder": {
                    "age": {year: 55},
                    "employment_income": {year: 100_000},
                    "capital_gains": {year: 800_000},
                    "capital_gains_badr": {year: 800_000},
                }
            },
            "benunits": {"benunit": {"members": ["founder"]}},
            "households": {"household": {"members": ["founder"]}},
        },
        scenario=scenario,
    )
    return float(sim.calculate("capital_gains_tax", year).sum())


def test_the_pin_keeps_the_figure_static_when_gains_respond():
    """An £800,000 qualifying gain in 2027-28: £143,460 before the measure
    and £161,280 after (test_reforms has the arithmetic). With the main
    elasticity at 1, as newer engines default it, current law against
    itself is unchanged, but the reformed gains fall and the tax with them;
    the measure's own changes, pinned, keep the static figure."""
    responsive = {
        f"{CAPITAL_GAINS_RESPONSES}.elasticity": {y: 1 for y in YEARS}
    }
    measure = get_reform(BADR_ID)
    limit = {
        BADR_LIFETIME_LIMIT: measure.parameter_changes[BADR_LIFETIME_LIMIT]
    }
    assert _capital_gains_tax(
        Scenario(parameter_changes=responsive)
    ) == pytest.approx(143_460, abs=0.01)
    unpinned = _capital_gains_tax(
        Scenario(parameter_changes={**limit, **responsive})
    )
    assert unpinned < 161_280 - 1_000
    pinned = _capital_gains_tax(
        Scenario(parameter_changes={**responsive, **measure.parameter_changes})
    )
    assert pinned == pytest.approx(161_280, abs=0.01)
