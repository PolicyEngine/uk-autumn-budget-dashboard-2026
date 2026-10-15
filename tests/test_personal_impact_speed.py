"""The household calculator builds each distinct scenario once.

``PersonalImpactCalculator.calculate`` used to build two simulations for
every measure and year (about a hundred for one household), and building a
simulation, not calculating it, is what takes the time. It now builds one
simulation per distinct scenario and set of people, each answering every
year, so a full request takes about a seventh of the time. These tests
check that it gives exactly the answers the per-year route gives.
"""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import personal_impact
from uk_budget_data.models import DataConfig
from uk_budget_data.personal_impact import (
    HouseholdInput,
    build_situation,
    build_situations,
    calculate_household_metrics,
    household_simulations,
    scenario_key,
)

ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"

households = st.builds(
    HouseholdInput,
    employment_income=st.integers(0, 200_000),
    income_growth_rate=st.sampled_from([0.0, 0.03, -0.02]),
    is_married=st.booleans(),
    partner_income=st.integers(0, 100_000),
    # Up to 30 in 2025, so some children leave (at 25) within the window.
    children_ages=st.lists(st.integers(0, 30), max_size=4),
    savings_income=st.integers(0, 10_000),
    pension_contributions_salary_sacrifice=st.sampled_from([0, 2_000]),
)


@settings(max_examples=200, deadline=None)
@given(household=households)
def test_each_years_inputs_are_build_situations(household):
    """The situations split the years in order, and each year's inputs in
    its situation are exactly ``build_situation``'s for that year."""
    years = personal_impact.YEARS
    groups = build_situations(household, years)
    assert [year for group, _ in groups for year in group] == years
    for group, situation in groups:
        for year in group:
            single = build_situation(household, year)
            assert list(situation["people"]) == list(single["people"])
            for person, variables in single["people"].items():
                for variable, values in variables.items():
                    assert situation["people"][person][variable][year] == (
                        values[year]
                    )
            assert situation["benunits"] == single["benunits"]
            household_entity = situation["households"]["household"]
            assert household_entity["members"] == (
                single["households"]["household"]["members"]
            )
            assert household_entity["region"][year] == "LONDON"
        # Nothing but the group's years.
        for variables in situation["people"].values():
            for values in variables.values():
                assert set(values) <= set(group)


def test_a_child_who_leaves_starts_a_new_situation():
    groups = build_situations(
        HouseholdInput(employment_income=30_000, children_ages=[21]),
        personal_impact.YEARS,
    )
    # 21 in 2025: a dependant through 2028, 25 in 2029.
    assert [years for years, _ in groups] == [
        [2025, 2026, 2027, 2028],
        [2029, 2030],
    ]
    assert "child_1" in groups[0][1]["people"]
    assert "child_1" not in groups[1][1]["people"]


def _does_nothing(sim):
    """A modifier with no effect."""


def test_scenarios_that_do_the_same_share_a_key():
    changes = {ALLOWANCE: {"2027": 20_000}}
    assert scenario_key(None) is None
    assert scenario_key(Scenario()) is None
    assert scenario_key(Scenario(parameter_changes={})) is None
    # Equal content, different objects: one simulation.
    assert scenario_key(Scenario(parameter_changes=changes)) == scenario_key(
        Scenario(parameter_changes={ALLOWANCE: {"2027": 20_000}})
    )
    different = [
        Scenario(parameter_changes=changes),
        Scenario(parameter_changes={ALLOWANCE: {"2027": 20_001}}),
        Scenario(parameter_changes={ALLOWANCE: {"2028": 20_000}}),
        Scenario(simulation_modifier=_does_nothing),
        Scenario(parameter_changes=changes, simulation_modifier=_does_nothing),
        Scenario(parameter_changes=changes, applied_before_data_load=True),
        Scenario.from_reform({ALLOWANCE: {"2027-04-06.2100-12-31": 20_000}}),
    ]
    keys = [scenario_key(scenario) for scenario in different]
    assert len(set(keys)) == len(keys)


@pytest.mark.slow
def test_the_calculator_gives_the_per_year_routes_answers(monkeypatch):
    """Differential: every figure the calculator returns equals the one the
    per-year route gives (two simulations for each measure and year, built
    by ``household_simulations``), exactly. The household's child leaves
    within the years, so two situations are built, and one holds two
    years. Years and measures are
    cut to keep the per-year reference short; a full local comparison of
    six households is in the PR."""
    # 2026 is merged into 2025's situation; the child has left by 2029.
    years = [2025, 2026, 2029]
    # The two-child limit and the threshold freeze move this household;
    # the rail fares freeze is the measure with a modifier.
    policy_ids = [
        "two_child_limit",
        "threshold_freeze_extension",
        "rail_fares_freeze",
    ]
    monkeypatch.setattr(personal_impact, "YEARS", years)
    monkeypatch.setattr(personal_impact, "POLICY_IDS", policy_ids)
    household = HouseholdInput(
        employment_income=25_000,
        children_ages=[21, 6, 3, 1],
        income_growth_rate=0.03,
    )
    calculator = personal_impact.PersonalImpactCalculator()
    results = calculator.calculate(household)
    config = DataConfig()
    for year in years:
        situation = build_situation(household, year)
        reported = results["years"][year]["baseline"]
        assert reported == calculate_household_metrics(
            personal_impact.Simulation(situation=situation), year
        )
        for policy_id in policy_ids:
            baseline, reformed = household_simulations(
                situation, calculator.reforms[policy_id], config
            )
            entry = results["policies"][policy_id]["years"][year]
            assert entry["baseline_metrics"] == calculate_household_metrics(
                baseline, year
            )
            assert entry["reformed_metrics"] == calculate_household_metrics(
                reformed, year
            )
    # Somewhere a measure moves the household, so the comparison is not
    # of zeros alone.
    assert any(
        results["policies"][policy_id]["years"][year]["net_income_change"]
        for policy_id in policy_ids
        for year in years
    )
