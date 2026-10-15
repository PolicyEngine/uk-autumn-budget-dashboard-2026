"""Universal Credit health measures: what scores, and what is refused.

From 2026 the engine's UC rebalancing (policyengine_uk/scenarios/
uc_reform.py) overwrites each claimant's health (LCWRA) element: pre-2026
claimants get rebalancing.protected_health_element (or the UC Act 2025
s. 4 floor), new claimants rebalancing.new_claimant_health_element. A
measure on the element's own amount therefore scores £0 in 2026-29, and
switching rebalancing off pays everyone the new claimants' rate (UK hub,
15 October). The templates refuse both and build UC health measures on
the rebalancing amounts.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import personal_impact
from uk_budget_data.measure_templates import (
    UC_LCWRA_AMOUNT,
    UC_NEW_CLAIMANT_HEALTH,
    UC_PROTECTED_HEALTH,
    UC_REBALANCED_YEARS,
    UC_REBALANCING_ACTIVE,
    rate_change,
    threshold_change,
    uc_health_element_change,
)
from uk_budget_data.models import DataConfig, Reform


def claimant(year, new_claimant):
    """A single adult with limited capability for work-related activity and
    no earnings, a pre-2026 or a new claimant."""
    return {
        "people": {
            "p": {
                "age": {year: 40},
                "employment_income": {year: 0},
                "uc_limited_capability_for_WRA": {year: True},
            }
        },
        "benunits": {
            "b": {
                "members": ["p"],
                "uc_receives_new_claimant_health_element": {
                    year: new_claimant
                },
            }
        },
        "households": {"h": {"members": ["p"]}},
    }


def element(situation, year, changes=None):
    sim = Simulation(
        situation=situation,
        scenario=Scenario(parameter_changes=changes) if changes else None,
    )
    return float(sim.calculate("uc_LCWRA_element", year)[0])


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
@pytest.mark.parametrize("year", [2026, 2027, 2029, 2030])
def test_the_element_amount_from_2026_is_refused(builder, year):
    with pytest.raises(ValueError) as refused:
        builder(UC_LCWRA_AMOUNT, {year: 600})
    message = str(refused.value)
    assert UC_PROTECTED_HEALTH in message and UC_NEW_CLAIMANT_HEALTH in message


def test_the_element_amount_before_2026_is_built():
    # Before the rebalancing runs, the element is the formula's amount.
    assert rate_change(UC_LCWRA_AMOUNT, {2025: 450}) == {
        UC_LCWRA_AMOUNT: {"2025": 450.0}
    }


def test_switching_rebalancing_off_is_refused():
    with pytest.raises(ValueError, match="not the law before"):
        rate_change(UC_REBALANCING_ACTIVE, {2027: 0})


def test_the_uc_health_builder_sets_the_rebalancing_amounts():
    assert uc_health_element_change(
        protected={2027: 500}, new_claimant={2027: 300, 2028: 310}
    ) == {
        UC_PROTECTED_HEALTH: {"2027": 500.0},
        UC_NEW_CLAIMANT_HEALTH: {"2027": 300.0, "2028": 310.0},
    }
    with pytest.raises(ValueError, match="Supply protected or new_claimant"):
        uc_health_element_change()
    for year in (2025, 2030):
        with pytest.raises(ValueError, match="would score nothing"):
            uc_health_element_change(new_claimant={year: 300})


def test_the_element_amount_scores_nothing_in_the_engine():
    """Why it is refused: the rebalancing overwrites it (£600 a month on
    the amount, and no claimant's element moves). If this fails, the
    engine has changed and the refusal can be revisited."""
    for new_claimant in (False, True):
        situation = claimant(2027, new_claimant)
        assert element(
            situation, 2027, {UC_LCWRA_AMOUNT: {"2027": 600}}
        ) == pytest.approx(element(situation, 2027), abs=0.01)


@pytest.mark.parametrize(
    "year, moves",
    [
        (min(UC_REBALANCED_YEARS), True),
        (max(UC_REBALANCED_YEARS), True),
        (max(UC_REBALANCED_YEARS) + 1, False),
    ],
)
def test_the_rebalancing_amounts_score_only_in_the_rebalanced_years(
    year, moves
):
    """Pins UC_REBALANCED_YEARS to the engine: a new claimant's element
    follows rebalancing.new_claimant_health_element in 2026-29 and not
    after."""
    situation = claimant(year, True)
    changed = element(
        situation, year, {UC_NEW_CLAIMANT_HEALTH: {str(year): 600}}
    )
    assert (changed == pytest.approx(600 * 12, abs=0.01)) is moves
    if not moves:
        assert changed == pytest.approx(element(situation, year), abs=0.01)


@pytest.mark.parametrize(
    "new_claimant, side", [(False, "protected"), (True, "new_claimant")]
)
def test_a_uc_health_measure_moves_national_and_household_results(
    new_claimant, side
):
    """Responsiveness: built with uc_health_element_change, a £600 a month
    health element moves the claimant's award by the same amount on the
    national route (Scenario) and the household calculator's."""
    year = 2027
    situation = claimant(year, new_claimant)
    measure = Reform(
        id="uc_health",
        name="UC health",
        parameter_changes=uc_health_element_change(**{side: {year: 600}}),
    )
    national_base = Simulation(situation=situation)
    national = Simulation(situation=situation, scenario=measure.to_scenario())
    baseline, reformed = personal_impact.household_simulations(
        situation, measure, DataConfig()
    )
    for variable in ("uc_LCWRA_element", "household_net_income"):
        national_change = float(national.calculate(variable, year)[0]) - float(
            national_base.calculate(variable, year)[0]
        )
        household_change = float(
            reformed.calculate(variable, year)[0]
        ) - float(baseline.calculate(variable, year)[0])
        assert household_change == pytest.approx(national_change, abs=0.01)
        assert abs(household_change) > 1
    # £600 a month.
    assert float(reformed.calculate("uc_LCWRA_element", year)[0]) == (
        pytest.approx(7_200, abs=0.01)
    )
