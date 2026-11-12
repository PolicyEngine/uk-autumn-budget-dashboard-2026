"""Source-bound metadata transition for the native October/current-law bundle."""

import copy
import hashlib
import json
from importlib.resources import files
from pathlib import Path
from types import SimpleNamespace

import pytest
from policyengine_uk.system import system

from uk_budget_data import certified_data, data_limits

EVIDENCE = json.loads(
    (
        Path(__file__).parent / "fixtures/input_coverage_eeb6093e.json"
    ).read_text()
)
CURRENT = EVIDENCE["current"]["build_id"]
PREVIOUS = EVIDENCE["previous"]["build_id"]
DECLARATIONS = EVIDENCE["input_declarations_and_scopes"]
NEW_NAMES = EVIDENCE["newly_missing_inputs"]
EXISTING_NAMES = EVIDENCE[
    "previously_missing_inputs_with_newly_relevant_paths"
]
BY_INPUT = {limit.missing_input: limit for limit in data_limits.DATA_LIMITS}


def test_complete_metadata_sets_derive_exactly_four_new_missing_inputs():
    stored = set().union(*map(set, EVIDENCE["columns_by_entity"].values()))
    inputs = set(EVIDENCE["input_variables"])
    assert len(stored) == 343
    assert len(inputs) == 376
    assert inputs == {
        name
        for name, variable in system.variables.items()
        if variable.is_input_variable()
    }
    missing = inputs - stored
    assert len(missing) == 148
    assert missing == set(EVIDENCE["missing_inputs"])
    assert (
        sorted(missing - set(EVIDENCE["previous_missing_inputs"])) == NEW_NAMES
    )
    assert len(NEW_NAMES) == 4
    assert set(EXISTING_NAMES) <= missing & set(
        EVIDENCE["previous_missing_inputs"]
    )
    assert EVIDENCE["record_values_read"] is False
    assert EVIDENCE["simulations"] == 0
    assert EVIDENCE["hdf_bytes_received"] < 32 * 1024 * 1024
    assert (
        "Not a degeneracy, usability or certification gate"
        in EVIDENCE["limitations"]
    )


def test_installed_cut_and_metadata_lineage_are_recorded():
    release = certified_data.load_bundle_manifest()["data_releases"]["uk"]
    assert release["build_id"] == CURRENT
    assert (
        release["certified_data_artifact"]["sha256"]
        == EVIDENCE["current"]["dataset_lfs_sha256"]
    )
    assert data_limits.NEWLY_MISSING_INPUTS[CURRENT] == tuple(NEW_NAMES)
    assert data_limits.LISTED_AGAINST[CURRENT] == PREVIOUS
    assert data_limits.coverage_problems(CURRENT) == []
    assert not set(EXISTING_NAMES) & set(
        data_limits.NEWLY_MISSING_INPUTS[CURRENT]
    )


def test_reviewed_native_input_and_reader_sources_match_exact_bytes():
    package = files("policyengine_uk")
    for entry in DECLARATIONS:
        for source in entry["sources"]:
            path = source["path"].removeprefix("policyengine_uk/")
            assert hashlib.sha256(
                package.joinpath(path).read_bytes()
            ).hexdigest() == (source["sha256"])


@pytest.mark.parametrize("name", NEW_NAMES)
def test_each_new_missing_input_requires_a_limit(name, monkeypatch):
    monkeypatch.setattr(
        data_limits,
        "DATA_LIMITS",
        tuple(
            limit
            for limit in data_limits.DATA_LIMITS
            if limit.missing_input != name
        ),
    )
    assert any(
        name in problem for problem in data_limits.coverage_problems(CURRENT)
    )


@pytest.mark.parametrize(
    "entry", DECLARATIONS, ids=lambda entry: entry["input"]
)
def test_exact_native_input_defaults_and_scopes_match_source(entry):
    name = entry["input"]
    variable = system.variables[name]
    assert variable.is_input_variable()
    expected = entry["default"]
    if isinstance(expected, dict):
        assert variable.default_value.name == expected["enum"]
    else:
        assert variable.default_value == expected
    assert variable.entity.key.lower() == entry["entity"].lower()
    assert str(variable.definition_period).upper() == entry["period"]
    limit = BY_INPUT[name]
    assert limit.parameters == tuple(entry["parameter_roots"])
    assert limit.parameter_change_only == tuple(entry["parameter_change_only"])
    assert entry["default_words"] in limit.reason
    assert name not in data_limits.NO_LONGER_MISSING
    assert set(entry["direct_readers"] + entry["helper_readers"]) <= (
        data_limits.limit_variables(limit)
    )


@pytest.mark.parametrize(
    "entry", DECLARATIONS, ids=lambda entry: entry["input"]
)
@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_each_scoped_root_is_held_on_either_side(entry, side):
    for path in entry["parameter_roots"]:
        changed = SimpleNamespace(parameter_changes={path: {"2027": 1}})
        pair = (changed, None) if side == "baseline" else (None, changed)
        assert entry["input"] in {
            item["key"] for item in data_limits.limits_for_scenarios(*pair)
        }
    assert BY_INPUT[entry["input"]] not in data_limits.limits_for_paths(
        ["unrelated.root"]
    )


def test_later_presence_retires_only_the_evidenced_registered_limit():
    released = EVIDENCE["released_missing_input_limits"]
    assert [entry["input"] for entry in released] == [
        "child_limit_non_parental_caring_exception"
    ]
    stored = set().union(*map(set, EVIDENCE["columns_by_entity"].values()))
    for entry in released:
        assert entry["input"] in stored
        assert entry["input"] in data_limits.NO_LONGER_MISSING
        assert entry["input"] not in BY_INPUT
    for name in (
        "child_limit_adoption_exception",
        "child_limit_continuation_exception",
        "child_limit_multiple_birth_exception",
        "child_limit_non_consensual_conception_exception",
        "company_car_availability",
        "company_car_private_use_payments",
        "company_car_registered_from_6_april_2020",
    ):
        assert name not in stored
        assert name in BY_INPUT


def test_native_fuel_and_trading_policies_expose_their_missing_bases():
    from policyengine_uk.utils.scenario import Scenario

    from uk_budget_data.budget_policy import native_policy_changes
    from uk_budget_data.forecast import with_forecast

    baseline = with_forecast(None)
    fuel = with_forecast(
        Scenario(
            parameter_changes=native_policy_changes("fuel_duty_rise_deferral")
        )
    )
    trading = with_forecast(
        Scenario(
            parameter_changes=native_policy_changes("trading_allowance_raise")
        )
    )
    assert {"lpg_kg", "natural_gas_kg"} <= {
        row["key"] for row in data_limits.limits_for_scenarios(baseline, fuel)
    }
    assert {
        "income_not_otherwise_charged",
        "trading_allowance_claim_status",
    } <= {
        row["key"]
        for row in data_limits.limits_for_scenarios(baseline, trading)
    }


def test_presence_claims_do_not_lift_unrelated_native_limits():
    evidence = copy.deepcopy(EVIDENCE)
    assert "electricity_kwh" in evidence["columns_by_entity"]["household"]
    assert (
        "electricity_consumption_kwh"
        not in evidence["columns_by_entity"]["household"]
    )
    assert "gas_kwh" in evidence["columns_by_entity"]["household"]
    assert (
        "gas_consumption_kwh" not in evidence["columns_by_entity"]["household"]
    )
    assert {"electricity_consumption_kwh", "gas_consumption_kwh"} <= set(
        BY_INPUT
    )
    assert BY_INPUT["armed_forces_independence_payment"].parameters == (
        "gov.dwp.universal_credit.attendance_allowance_benefits",
    )
