"""Native Budget policy is restored once against a shared pre-Budget reference.

These checks bind the registry to the reviewed native policy and compare
the assembled current-law side with the model's independent default
parameter tree. They need no population dataset or policy-output estimates.
"""

from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import CountryTaxBenefitSystem, Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import reforms
from uk_budget_data.budget_measures.planned_cash_isa_limit import (
    planned_cash_isa_limit,
)
from uk_budget_data.budget_policy import (
    native_policy_changes,
    policy_record,
    pre_budget_policy_changes,
)
from uk_budget_data.forecast import with_forecast
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.combine import merged_changes

NATIONAL_IDS = tuple(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
CALCULATOR_ONLY_IDS = (
    reforms.CASH_ISA_LIMIT_ID,
    reforms.MACHINE_GAMES_DUTY_ID,
)
SITUATION = {
    "people": {"adult": {}},
    "benunits": {"unit": {"members": ["adult"]}},
    "households": {"household": {"members": ["adult"]}},
}


def _restores(measure_ids):
    changes = {}
    for measure_id in measure_ids:
        own = native_policy_changes(measure_id)
        assert not (changes.keys() & own.keys()), measure_id
        changes.update(own)
    return changes


@pytest.mark.parametrize("measure_id", NATIONAL_IDS)
def test_national_measure_restores_native_policy_without_formula_wrappers(
    measure_id,
):
    measure = reforms.get_reform(measure_id)
    assert measure.parameter_changes == native_policy_changes(measure_id)
    assert measure.simulation_modifier is None
    assert measure.baseline_simulation_modifier is None
    assert measure.baseline_parameter_changes is None


def test_national_package_restores_exactly_its_members_once():
    package = reforms.get_reform(reforms.AUTUMN_BUDGET_2026_COMBINED_ID)
    assert package.parameter_changes == _restores(NATIONAL_IDS)
    assert package.simulation_modifier is None
    assert package.baseline_simulation_modifier is None


@pytest.mark.parametrize("measure_id", CALCULATOR_ONLY_IDS)
def test_native_calculator_measures_keep_their_national_publication_hold(
    measure_id,
):
    measure = reforms.get_reform(measure_id)
    assert measure.parameter_changes == native_policy_changes(measure_id)
    assert measure_id not in NATIONAL_IDS
    assert measure.simulation_modifier is None


def test_cash_isa_reference_keeps_the_approved_diversion_assumption():
    measure = reforms.get_reform(reforms.CASH_ISA_LIMIT_ID)
    assert measure.baseline_simulation_modifier is planned_cash_isa_limit


def test_machine_games_restores_only_the_native_higher_stake_switch():
    changes = reforms.get_reform(
        reforms.MACHINE_GAMES_DUTY_ID
    ).parameter_changes
    assert set(changes) == {
        "gov.hmrc.gambling_duty.machine_games.higher_stake_machines_at_higher_rate"
    }
    assert reforms.MACHINE_GAMES_STANDARD_RATE not in changes


@pytest.mark.parametrize(
    "builder, paths",
    [
        (reforms.property_income_rates_up, reforms.PROPERTY_INCOME_RATE_PATHS),
        (reforms.savings_income_rates_up, reforms.SAVINGS_INCOME_RATE_PATHS),
    ],
)
def test_legacy_rate_helpers_do_not_add_the_budget_increase_again(
    builder, paths
):
    changes = builder()
    for path, rate in zip(paths, (0.24, 0.44, 0.49)):
        assert set(changes[path].values()) == {rate}


@given(st.sets(st.sampled_from(NATIONAL_IDS)))
@settings(max_examples=24, deadline=None)
def test_every_selection_restores_only_its_policies(selected):
    """Unselected native policies stay pre-Budget on both comparison sides."""
    rollback = pre_budget_policy_changes()
    restores = _restores(selected)
    scenario = with_forecast(Scenario(parameter_changes=restores))
    # A mixed-timing sum can report False on its aggregate flag. The
    # engine's actual split still applies all parameters before loading.
    before, after = scenario.parts_by_data_load()
    assert before is not None and before.applied_before_data_load
    assert before.parameter_changes == scenario.parameter_changes
    assert after is None or not after.parameter_changes
    for path, periods in rollback.items():
        expected = restores.get(path, periods)
        assert scenario.parameter_changes[path] == expected, (selected, path)


@pytest.fixture(scope="module")
def native_and_full_selection():
    measures = [
        reforms.get_reform(measure_id)
        for measure_id in (*NATIONAL_IDS, *CALCULATOR_ONLY_IDS)
    ]
    sides = merged_changes(measures, DataConfig())
    assert not sides["reform"]["modifiers"]
    scenario = with_forecast(
        Scenario(parameter_changes=sides["reform"]["parameter_changes"])
    )
    return (
        CountryTaxBenefitSystem().parameters,
        Simulation(
            situation=SITUATION, scenario=scenario
        ).tax_benefit_system.parameters,
    )


def test_full_registered_selection_matches_native_policy_settings(
    native_and_full_selection,
):
    """Compare both processed and statutory trees, including interval ends."""
    native, selected = native_and_full_selection
    for path, periods in pre_budget_policy_changes().items():
        instants = set()
        for period in periods:
            start, stop = period.split(".")
            instants.update((start, stop))
            instants.add(
                (date.fromisoformat(start) - timedelta(days=1)).isoformat()
            )
            instants.add(
                (date.fromisoformat(stop) + timedelta(days=1)).isoformat()
            )
        for instant in sorted(instants):
            assert selected.baseline.get_child(path)(
                instant
            ) == native.baseline.get_child(path)(instant), (path, instant)
        for year in policy_record()["supported_fiscal_years"]:
            instant = f"{year}-01-01"
            assert selected.get_child(path)(instant) == pytest.approx(
                native.get_child(path)(instant), abs=1e-12
            ), (
                path,
                instant,
            )


def test_full_selection_keeps_native_economic_assumptions(
    native_and_full_selection,
):
    native, selected = native_and_full_selection
    for series in ("consumer_price_index", "average_earnings", "rpi"):
        path = f"gov.economic_assumptions.yoy_growth.obr.{series}"
        for year in policy_record()["supported_fiscal_years"]:
            instant = f"{year}-01-01"
            assert selected.get_child(path)(instant) == native.get_child(path)(
                instant
            ), (
                path,
                instant,
            )
