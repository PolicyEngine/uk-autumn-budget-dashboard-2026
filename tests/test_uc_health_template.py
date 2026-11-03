"""Universal Credit health measures: what scores, and what is refused.

In its exported years the engine's UC rebalancing (policyengine_uk/scenarios/
uc_reform.py) overwrites each claimant's health (LCWRA) element: pre-2026
claimants get rebalancing.protected_health_element (or the UC Act 2025
s. 4 floor), new claimants rebalancing.new_claimant_health_element. A
measure on the element's own amount therefore scores £0 in those years,
and switching rebalancing off pays everyone the new claimants' rate (UK
hub, 15 October). The templates refuse both and build UC health measures
on the rebalancing amounts. Outside those years the element's own amount
is what scores: before 2026, and after the installed engine's
rebalancing has stopped (policyengine-uk issue #2282). The engine table
below pins both edges.
"""

import runpy
from types import SimpleNamespace

import pytest
from policyengine_uk import Simulation, scenarios
from policyengine_uk.scenarios import uc_reform
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import measure_templates, personal_impact
from uk_budget_data.forecast import with_forecast
from uk_budget_data.measure_templates import (
    UC_LCWRA_AMOUNT,
    UC_NEW_CLAIMANT_HEALTH,
    UC_PROTECTED_HEALTH,
    UC_REBALANCED_YEARS,
    UC_REBALANCING_ACTIVE,
    allowance_uprating,
    rate_change,
    threshold_change,
    uc_health_element_change,
)
from uk_budget_data.models import DataConfig, Reform

FIRST = min(UC_REBALANCED_YEARS)
LAST = max(UC_REBALANCED_YEARS)
MONTHLY = 600


@pytest.mark.parametrize("years", [range(2026, 2033), list(range(2026, 2033))])
def test_the_rebalanced_years_follow_the_engine_export(monkeypatch, years):
    """The export present in policyengine-uk 2.145.0 extends the builders.

    The copy runs under the module's own name, so a warning class it raises
    is importable where xdist's controller reports it."""
    monkeypatch.setattr(uc_reform, "REBALANCING_YEARS", years, raising=False)
    loaded = runpy.run_path(
        measure_templates.__file__, run_name=measure_templates.__name__
    )
    assert list(loaded["UC_REBALANCED_YEARS"]) == list(years)
    with pytest.raises(ValueError, match="in 2032 is not"):
        loaded["rate_change"](UC_LCWRA_AMOUNT, {2032: MONTHLY})
    assert loaded["uc_health_element_change"](
        new_claimant={2032: MONTHLY}
    ) == {UC_NEW_CLAIMANT_HEALTH: {"2032": float(MONTHLY)}}


def test_the_rebalanced_years_fall_back_for_older_engines(monkeypatch):
    """The installed older engines have no REBALANCING_YEARS export."""
    monkeypatch.delattr(uc_reform, "REBALANCING_YEARS", raising=False)
    loaded = runpy.run_path(
        measure_templates.__file__, run_name=measure_templates.__name__
    )
    assert loaded["UC_REBALANCED_YEARS"] == range(2026, 2030)


@pytest.mark.parametrize("years", [[], [2026, 2028]])
def test_the_rebalanced_years_refuse_an_invalid_engine_export(
    monkeypatch, years
):
    monkeypatch.setattr(uc_reform, "REBALANCING_YEARS", years, raising=False)
    with pytest.raises(ValueError, match="must be consecutive years"):
        measure_templates._uc_rebalanced_years()


def uprated(path, values):
    """allowance_uprating at zero growth, so every year gets the base: the
    third builder, on the same inputs as the other two."""
    (base,) = set(values.values())
    return allowance_uprating(path, base, {year: 0 for year in values})


BUILDERS = [rate_change, threshold_change, uprated]


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


@pytest.mark.parametrize("builder", BUILDERS)
@pytest.mark.parametrize("year", [FIRST, 2027, LAST])
def test_the_element_amount_in_the_rebalanced_years_is_refused(builder, year):
    with pytest.raises(ValueError) as refused:
        builder(UC_LCWRA_AMOUNT, {year: MONTHLY})
    message = str(refused.value)
    assert UC_PROTECTED_HEALTH in message and UC_NEW_CLAIMANT_HEALTH in message


@pytest.mark.parametrize("builder", BUILDERS)
def test_a_run_into_the_rebalanced_years_is_refused_naming_them(builder):
    years = {LAST - 1: MONTHLY, LAST: MONTHLY, LAST + 1: MONTHLY}
    with pytest.raises(ValueError, match=f"in {LAST - 1}, {LAST} is not"):
        builder(UC_LCWRA_AMOUNT, years)


@pytest.mark.parametrize("builder", BUILDERS)
@pytest.mark.parametrize("year", [FIRST - 1, LAST + 1])
def test_the_element_amount_outside_the_rebalanced_years_is_built(
    builder, year
):
    """Each builder builds the same change, the one the engine table below
    shows scoring for every claimant in those years."""
    assert builder(UC_LCWRA_AMOUNT, {year: MONTHLY}) == {
        UC_LCWRA_AMOUNT: {str(year): float(MONTHLY)}
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
    for year in (FIRST - 1, LAST + 1):
        with pytest.raises(ValueError, match="would score nothing"):
            uc_health_element_change(new_claimant={year: 300})


CHANGES = {
    "amount": UC_LCWRA_AMOUNT,
    "protected": UC_PROTECTED_HEALTH,
    "new_claimant": UC_NEW_CLAIMANT_HEALTH,
}


def scores(change, year, new_claimant, rebalanced_years):
    """Which change the templates take to move this claimant's element."""
    if year not in rebalanced_years:
        return change == "amount"
    return change == ("new_claimant" if new_claimant else "protected")


@pytest.mark.parametrize(
    "new_claimant", [False, True], ids=["protected", "new_claimant"]
)
@pytest.mark.parametrize("year", [FIRST - 1, FIRST, LAST, LAST + 1])
def test_the_engine_pays_the_element_from_what_the_templates_build(
    year, new_claimant
):
    """Pins UC_REBALANCED_YEARS, and so the refusal, to the installed
    engine at both edges: £600 a month on each of the three amounts, and
    only the one the templates use for that claimant and year moves the
    element. In the rebalanced years that is the claimant's rebalancing
    amount and the element's own amount scores nothing; outside them it is
    the element's own amount. An engine that extends the rebalancing without
    exporting its years fails here: from LAST + 1 the element's amount
    stops scoring."""
    assert_engine_matches_template(year, new_claimant, UC_REBALANCED_YEARS)


def assert_engine_matches_template(year, new_claimant, rebalanced_years):
    """Compare all three parameter routes with actual engine awards."""
    situation = claimant(year, new_claimant)
    base = element(situation, year)
    assert abs(base - MONTHLY * 12) > 1
    for change, path in CHANGES.items():
        changed = element(situation, year, {path: {str(year): MONTHLY}})
        moved = scores(change, year, new_claimant, rebalanced_years)
        expected = MONTHLY * 12 if moved else base
        assert changed == pytest.approx(expected, abs=0.01), change


def test_the_edge_check_catches_extended_rebalancing_without_an_export(
    monkeypatch,
):
    """An engine with changed awards and no export cannot pass by fallback."""
    monkeypatch.setattr(scenarios, "uc_reform", SimpleNamespace())
    fallback = measure_templates._uc_rebalanced_years()
    assert fallback == range(2026, 2030)
    year = fallback.stop
    native_modifier = (
        scenarios.universal_credit_july_2025_reform.simulation_modifier
    )

    def extended_rebalancing(sim):
        """Model an additional rebalanced year for a new claimant."""
        native_modifier(sim)
        parameters = sim.tax_benefit_system.parameters
        amount = (
            parameters.gov.dwp.universal_credit.rebalancing.new_claimant_health_element(
                year
            )
            * 12
        )
        current = sim.calculate("uc_LCWRA_element", year).copy()
        current[current > 0] = amount
        sim.set_input("uc_LCWRA_element", year, current)

    monkeypatch.setattr(
        scenarios.universal_credit_july_2025_reform,
        "simulation_modifier",
        extended_rebalancing,
    )
    with pytest.raises(AssertionError, match="amount"):
        assert_engine_matches_template(year, True, fallback)


def household_matches_national(situation, measure, year):
    """Responsiveness, like for like: the measure moves the claimant's
    health element and net income by the same nonzero amount on the
    national route (Scenario) and the household calculator's, and pays
    £600 a month."""
    # On the forecast, as the national run builds every simulation
    national_base = Simulation(
        situation=situation, scenario=with_forecast(None)
    )
    national = Simulation(
        situation=situation, scenario=with_forecast(measure.to_scenario())
    )
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
    assert float(reformed.calculate("uc_LCWRA_element", year)[0]) == (
        pytest.approx(MONTHLY * 12, abs=0.01)
    )


@pytest.mark.parametrize(
    "new_claimant, side", [(False, "protected"), (True, "new_claimant")]
)
def test_a_uc_health_measure_moves_national_and_household_results(
    new_claimant, side
):
    """In a rebalanced year, built with uc_health_element_change."""
    year = 2027
    measure = Reform(
        id="uc_health",
        name="UC health",
        parameter_changes=uc_health_element_change(**{side: {year: MONTHLY}}),
    )
    household_matches_national(claimant(year, new_claimant), measure, year)


@pytest.mark.parametrize(
    "new_claimant", [False, True], ids=["protected", "new_claimant"]
)
def test_an_element_amount_measure_after_the_rebalancing_moves_both_routes(
    new_claimant,
):
    """After rebalancing every claimant, protected or not, gets the element's own
    amount, so a measure built on it scores on both routes."""
    year = LAST + 1
    measure = Reform(
        id="uc_health_amount",
        name="UC health amount",
        parameter_changes=rate_change(UC_LCWRA_AMOUNT, {year: MONTHLY}),
    )
    household_matches_national(claimant(year, new_claimant), measure, year)
