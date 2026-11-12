"""Exact0639 transition metadata and source-backed coverage; native cases run in CI."""

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from policyengine_uk.system import system

from uk_budget_data import data_limits

EVIDENCE = json.loads(
    (
        Path(__file__).parent / "fixtures/input_coverage_0639b9c7.json"
    ).read_text()
)
CURRENT = EVIDENCE["current"]["build_id"]
PREVIOUS = EVIDENCE["previous"]["build_id"]
DECLARATIONS = EVIDENCE["input_declarations_and_scopes"]
NAMES = EVIDENCE["newly_missing_inputs"]
BY_INPUT = {limit.missing_input: limit for limit in data_limits.DATA_LIMITS}


def test_exact_transition_and_predecessor_chain_are_recorded():
    assert len(NAMES) == len(set(NAMES)) == 26
    assert set(data_limits.NEWLY_MISSING_INPUTS[CURRENT]) == set(NAMES)
    assert data_limits.LISTED_AGAINST[CURRENT] == PREVIOUS
    assert data_limits.coverage_problems(CURRENT) == []
    assert (
        "Not a degeneracy, usability or certification gate"
        in EVIDENCE["limitations"]
    )


@pytest.mark.parametrize("name", NAMES)
def test_every_new_input_has_one_limit_and_no_release_exemption(name):
    assert (
        sum(limit.missing_input == name for limit in data_limits.DATA_LIMITS)
        == 1
    )
    assert name not in data_limits.NO_LONGER_MISSING


@pytest.mark.parametrize("name", NAMES)
def test_removing_any_new_limit_fails_coverage(name, monkeypatch):
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
def test_default_entity_period_and_exact_roots_match_the_reviewed_source(
    entry,
):
    variable = system.variables[entry["input"]]
    default = entry["default"]
    if isinstance(default, dict):
        assert variable.default_value.name == default["enum"]
    else:
        assert variable.default_value == default
    assert variable.entity.key.lower() == entry["entity"].lower()
    assert str(variable.definition_period).upper() == entry["period"]
    limit = BY_INPUT[entry["input"]]
    assert limit.parameters == tuple(entry["parameter_roots"])
    assert entry["default_words"] in limit.reason


@pytest.mark.parametrize(
    "entry", DECLARATIONS, ids=lambda entry: entry["input"]
)
@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_each_scoped_root_is_held_on_either_scenario_side(entry, side):
    for path in entry["parameter_roots"]:
        changed = SimpleNamespace(parameter_changes={path: {"2027": 1}})
        args = (changed, None) if side == "baseline" else (None, changed)
        keys = {
            item["key"] for item in data_limits.limits_for_scenarios(*args)
        }
        assert BY_INPUT[entry["input"]].key in keys
    assert BY_INPUT[entry["input"]].key not in {
        limit.key for limit in data_limits.limits_for_paths(["unrelated.root"])
    }


@pytest.mark.parametrize(
    "entry", DECLARATIONS, ids=lambda entry: entry["input"]
)
def test_native_direct_helper_and_defined_for_readers_are_covered(entry):
    """A real witness: helper/gating gaps must fail, never become exemptions."""
    readers = set(entry["direct_readers"] + entry["helper_readers"])
    assert readers <= data_limits.limit_variables(BY_INPUT[entry["input"]])


def test_only_evidenced_gambling_input_limits_retire():
    released = EVIDENCE["released_missing_input_limits"]
    assert len(released) == 13
    for entry in released:
        assert entry["input"] not in BY_INPUT
        assert entry["input"] in data_limits.NO_LONGER_MISSING
    for name in (
        "financial_spread_betting_net_losses",
        "other_spread_betting_net_losses",
    ):
        assert name in BY_INPUT
        assert name not in data_limits.NO_LONGER_MISSING


def test_non_cash_isa_charge_keeps_its_basic_savings_dependency():
    limit = BY_INPUT["non_cash_isa_cash_interest"]
    assert limit in data_limits.limits_for_paths(
        ["gov.hmrc.income_tax.rates.savings.basic"]
    )
    assert limit not in data_limits.limits_for_paths(
        ["gov.hmrc.income_tax.rates.savings.higher"]
    )


def test_ni_epg_does_not_unconditionally_hold_current_vat_paths():
    limits = data_limits.limits_for_paths(
        [
            "gov.hmrc.vat.domestic_electricity_rate.northern_ireland",
            "gov.hmrc.vat.reduced_rate",
        ]
    )
    assert not {limit.missing_input for limit in limits} & {
        "electricity_consumption_kwh",
        "gas_consumption_kwh",
        "ni_epg_full_rate_applies",
    }


def test_isa_interest_is_not_mislabeled_as_a_registered_input_lift():
    variable = system.variables["individual_savings_account_interest_income"]
    assert variable.formulas or variable.adds or variable.subtracts
    assert "individual_savings_account_interest_income" not in {
        entry["input"] for entry in EVIDENCE["released_missing_input_limits"]
    }


@pytest.mark.parametrize("side", ["baseline", "reform"])
@pytest.mark.parametrize("discount", ["electricity_discount", "gas_discount"])
@pytest.mark.parametrize("with_vat", [False, True])
def test_native_ni_reactivation_is_held_with_or_without_vat(
    side, discount, with_vat
):
    from policyengine_uk.utils.scenario import Scenario

    from tests.test_data_limits_cuts import one_adult

    changes = {
        f"gov.ofgem.energy_price_guarantee_northern_ireland.{discount}": {
            2027: 1
        }
    }
    if with_vat:
        changes["gov.hmrc.vat.reduced_rate"] = {2027: 0.01}
    plain = one_adult()
    changed = one_adult(Scenario(parameter_changes=changes))
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    touched = {entry["key"] for entry in data_limits.limits_touched(*pair)}
    assert {
        "electricity_consumption_kwh",
        "gas_consumption_kwh",
        "ni_epg_full_rate_applies",
    } <= touched


@pytest.mark.parametrize("side", ["baseline", "reform"])
@pytest.mark.parametrize(
    "input_name,reader,entity,period,value",
    [
        (
            "would_claim_wales_childcare_offer",
            "wales_childcare_offer_eligible",
            "benunits",
            2027,
            True,
        ),
        (
            "electricity_consumption_kwh",
            "monthly_ni_epg_subsidy",
            "households",
            "2027-01",
            1,
        ),
        (
            "ni_epg_full_rate_applies",
            "ni_epg_subsidy_calculable",
            "households",
            "2027-01",
            True,
        ),
    ],
)
def test_native_gating_and_helper_reader_storage_is_held_on_either_side(
    side, input_name, reader, entity, period, value
):
    """The separate bounded scanner repair must satisfy these native witnesses."""
    from policyengine_uk import Simulation

    situation = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    plain = Simulation(situation=copy.deepcopy(situation))
    key = "b" if entity == "benunits" else "h"
    situation[entity][key][reader] = {period: value}
    changed = Simulation(situation=copy.deepcopy(situation))
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    assert input_name in {
        entry["key"] for entry in data_limits.limits_touched(*pair)
    }
