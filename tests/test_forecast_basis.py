"""Native October assumptions on both sides of the policy comparison.

The forecast source is the certified model, while the policy baseline is
an explicit pre-Budget rollback. Household tests exercise construction;
these checks do not need population data.
"""

import json
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_policy import pre_budget_policy_changes
from uk_budget_data.forecast import (
    NATIVE_FORECAST_PATHS,
    OBR,
    archived_forecast_record,
    forecast_parameter_changes,
    forecast_parameters,
    forecast_record,
    forecast_scenario,
    with_forecast,
)

INPUTS = "gov.economic_assumptions.statutory_uprating_inputs."
YEARS = range(2026, 2032)

# EFO October 2026 Table A.1: rounded headline growth, percent.
TABLE_A1 = {
    "consumer_price_index": [3.1, 3.4, 2.1, 2.1, 2.0, 2.0],
    "rpi": [3.6, 4.3, 3.0, 3.0, 2.3, 2.2],
    "average_earnings": [3.7, 3.0, 2.2, 2.3, 2.5, 2.6],
    "house_prices": [2.1, 2.4, 2.8, 2.8, 2.7, 2.7],
}
# EFO Table A.3: the highest of Q2 earnings, Q3 CPI and 2.5%.
TRIPLE_LOCK = {
    2026: 3.9,
    2027: 3.4,
    2028: 2.5,
    2029: 2.5,
    2030: 2.5,
    2031: 2.6,
}
H = {
    "people": {"p": {"age": {2026: 70}}},
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}


@pytest.fixture(scope="module")
def native():
    return Simulation(situation=H).tax_benefit_system.parameters


@pytest.fixture(scope="module")
def comparison():
    return Simulation(
        situation=H, scenario=with_forecast(None)
    ).tax_benefit_system.parameters


def test_reviewed_bundle_contains_native_october_forecast():
    """A bundle upgrade must review its native forecast and policy record."""
    assert version("policyengine") == "6.17.2"
    assert version("policyengine-uk") == "2.174.1"
    assert version("policyengine-core") == "3.33.3"
    source = (
        files("policyengine_uk")
        .joinpath("parameters/gov/economic_assumptions/yoy_growth.yaml")
        .read_text()
    )
    assert "2026-2031: OBR forecast from the October 2026 EFO" in source


def test_native_headline_values_match_table_a1(native):
    for series, row in TABLE_A1.items():
        for year, value in zip(YEARS, row):
            assert native.get_child(OBR + series)(
                f"{year}-01-01"
            ) == pytest.approx(value / 100, abs=0.00051), (series, year)


def test_forecast_only_scenario_has_no_policy_or_macro_override(native):
    scenario = forecast_scenario()
    assert not scenario.parameter_changes
    assert scenario.simulation_modifier is None
    assert scenario.applied_before_data_load
    actual = Simulation(
        situation=H, scenario=scenario
    ).tax_benefit_system.parameters
    for path in NATIVE_FORECAST_PATHS:
        for year in YEARS:
            instant = f"{year}-01-01"
            assert actual.get_child(path)(instant) == native.get_child(path)(
                instant
            )


def test_native_parameter_reader_does_not_apply_the_policy_rollback(native):
    path = "gov.hmrc.income_tax.allowances.trading_allowance"
    assert forecast_parameters().get_child(path)("2027-06-01") == 3_000
    assert native.get_child(path)("2027-06-01") == 3_000


def test_readback_is_native_and_is_never_the_applied_scenario(native):
    changes = forecast_parameter_changes()
    assert set(changes) == set(NATIVE_FORECAST_PATHS)
    for path, values in changes.items():
        for period, value in values.items():
            assert value == native.get_child(path)(period.split(".")[0])
    assert not forecast_scenario().parameter_changes


def test_policy_rollback_leaves_all_native_forecast_inputs_unchanged(
    native, comparison
):
    for path in NATIVE_FORECAST_PATHS:
        for year in YEARS:
            instant = f"{year}-01-01"
            assert comparison.get_child(path)(instant) == native.get_child(
                path
            )(instant)
    assert not any(
        path.startswith("gov.economic_assumptions.")
        for path in with_forecast(None).parameter_changes
    )


def test_published_statutory_outturns_are_kept(native, comparison):
    for name, instant, expected in (
        ("cpi_september", "2026-09-01", 0.035),
        ("awe_total_pay_may_july", "2026-07-01", 0.039),
    ):
        assert native.get_child(INPUTS + name)(instant) == expected
        assert comparison.get_child(INPUTS + name)(instant) == expected


def test_native_triple_lock_matches_table_a3(comparison):
    for year, expected in TRIPLE_LOCK.items():
        cpi = comparison.get_child(INPUTS + "cpi_september")(f"{year}-09-01")
        awe = comparison.get_child(INPUTS + "awe_total_pay_may_july")(
            f"{year}-07-01"
        )
        assert max(round(cpi * 1000) / 10, round(awe * 1000) / 10, 2.5) == (
            pytest.approx(expected)
        )


def test_empty_measure_and_baseline_are_equivalent():
    baseline = Simulation(situation=H, scenario=with_forecast(None))
    reform = Simulation(situation=H, scenario=with_forecast(Scenario()))
    for year in (2027, 2028, 2029):
        for variable in ("state_pension", "income_tax", "pension_credit"):
            assert reform.calculate(variable, year) == pytest.approx(
                baseline.calculate(variable, year)
            ), (year, variable)


@given(rate=st.floats(min_value=0, max_value=1, allow_nan=False))
@settings(max_examples=12, deadline=None)
def test_selected_measure_takes_precedence_without_mutating_rollback(rate):
    """Scenario composition preserves arbitrary selected parameter values."""
    rollback = pre_budget_policy_changes()
    path = "gov.hmrc.income_tax.rates.property.basic"
    period = next(iter(rollback[path]))
    original = rollback[path][period]
    changed = with_forecast(Scenario(parameter_changes={path: {period: rate}}))
    assert changed.parameter_changes[path][period] == rate
    assert pre_budget_policy_changes()[path][period] == original


def test_measure_specific_macro_change_keeps_its_precedence():
    path = OBR + "rpi"
    period = "2030-01-01.2030-12-31"
    scenario = with_forecast(
        Scenario(parameter_changes={path: {period: 0.05}})
    )
    assert scenario.parameter_changes[path] == {period: 0.05}
    assert set(scenario.parameter_changes) == set(
        pre_budget_policy_changes()
    ) | {path}


def test_national_builder_uses_the_policy_comparison_on_both_sides(
    monkeypatch,
):
    from uk_budget_data import pipeline

    seen = []
    monkeypatch.setattr(
        pipeline.pe.uk,
        "managed_microsimulation",
        lambda **kwargs: seen.append(kwargs["scenario"]),
    )
    pipeline.build_microsimulation(None, None)
    pipeline.build_microsimulation(None, Scenario())
    assert len(seen) == 2
    for scenario in seen:
        assert scenario.parameter_changes == pre_budget_policy_changes()
        assert scenario.applied_before_data_load


def test_native_record_cannot_depend_on_the_archived_overlay(monkeypatch):
    from uk_budget_data import forecast

    def archive_is_not_an_input():
        raise AssertionError("historical overlay used for a native forecast")

    monkeypatch.setattr(
        forecast, "archived_forecast_record", archive_is_not_an_input
    )
    record = forecast_record()
    assert record["mode"] == "native"
    assert record["model_version"] == version("policyengine-uk")
    assert record["vintage"] == "OBR EFO October 2026"
    assert record["parameter_changes"]
    assert all(
        entry["source"] for entry in record["parameter_changes"].values()
    )
    assert not forecast_scenario().parameter_changes


def test_historical_overlay_remains_available_for_old_result_attribution():
    assert archived_forecast_record()["vintage"] == "OBR EFO October 2026"
    assert archived_forecast_record()["parameter_changes"][OBR + "rpi"][
        "values"
    ]


def test_fuel_table_reads_actual_pre_budget_policy():
    from uk_budget_data.budget_policy import pre_budget_policy_timeline
    from uk_budget_data.forecast import FUEL_DUTY, fuel_duty_rpi_steps

    steps = dict(fuel_duty_rpi_steps())
    assert steps["2027-04-01"] == 0.6003
    assert steps["2027-04-01"] != 0.6059
    assert steps == {
        day: value
        for day, value in pre_budget_policy_timeline(FUEL_DUTY).items()
        if day.endswith("-04-01")
    }


def test_declared_basis_separates_policy_from_native_macro_and_data():
    path = (
        Path(__file__).resolve().parents[1]
        / "data_inputs/publication_basis.json"
    )
    basis = json.loads(path.read_text())
    ships = f"policyengine-uk {version('policyengine-uk')} ships"
    assert ships in basis["forecast"]["vintage"]
    assert ships in basis["notes"]
    assert basis["forecast"]["mode"] == "native"
    assert basis["policy"]["baseline"] == "actual_pre_autumn_budget_2026"
    assert basis["policy"]["reform"] == "selected_native_current_law_measures"
    assert "without a dashboard growth-rate override" in basis["notes"]
    assert "old published estimates" in basis["notes"]
