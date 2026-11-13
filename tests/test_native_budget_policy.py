"""Policy inversion invariants, separately from model/data/macro changes.

These tests use the source-bound timelines and Core's actual parameter
updates. They do not calculate households or compare different data cuts.
"""

import copy
import math
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data import budget_policy as policy


class Timeline:
    def __init__(self, values):
        self.values = dict(values)
        self.values_list = [
            SimpleNamespace(instant_str=day) for day in self.values
        ]

    def __call__(self, day):
        key = max(
            (instant for instant in self.values if instant <= day),
            default=min(self.values),
        )
        value = self.values[key]
        return math.inf if value == "infinity" else value


class Parameters:
    def __init__(self, record):
        self.nodes = {
            path: Timeline(spec["native_values"])
            for measure in record["measures"].values()
            for path, spec in measure["paths"].items()
        }
        # The native October tail. Only forecast arithmetic is used here;
        # no synthetic household or microsimulation stands in for evidence.
        self.nodes[policy.RPI] = Timeline(
            {"2031-01-01": 0.0218, "2032-01-01": 0.02222}
        )

    def get_child(self, path):
        return self.nodes[path]


@pytest.fixture
def record():
    return policy.policy_record()


@pytest.fixture
def parameters(record):
    return Parameters(record)


def changes(record, parameters, side, ids=None):
    return policy._changes_for(
        record, parameters, side, record["measures"] if ids is None else ids
    )


def value_after(native, overrides, day):
    matches = [
        value
        for interval, value in overrides.items()
        if interval.split(".")[0] <= day <= interval.split(".")[1]
    ]
    assert len(matches) <= 1, "Scenario contains overlapping intervals"
    return matches[0] if matches else native(day)


def test_record_covers_all_national_and_calculator_measures(record):
    assert set(record["measures"]) == {
        "fuel_duty_rise_deferral",
        "state_pension_income_tax_protection",
        "domestic_electricity_zero_vat",
        "property_income_rates_up",
        "savings_income_rates_up",
        "carers_allowance_earnings_taper",
        "household_energy_payment_2026",
        "trading_allowance_raise",
        "bus_fare_cap_2027",
        "cash_isa_limit_kept",
        "machine_games_duty_rise",
    }
    paths = [
        path
        for measure in record["measures"].values()
        for path in measure["paths"]
    ]
    assert len(paths) == len(set(paths)) == 18
    assert not any(
        path.startswith("gov.economic_assumptions") for path in paths
    )


@given(
    day=st.dates(min_value=date(2027, 1, 1), max_value=date(2033, 4, 5)),
    selected=st.sets(st.integers(min_value=0, max_value=10)),
)
def test_selected_paths_restore_native_and_other_paths_stay_pre_budget(
    day, selected
):
    record = policy.policy_record()
    parameters = Parameters(record)
    ids = list(record["measures"])
    selected_ids = [ids[index] for index in sorted(selected)]
    before = changes(record, parameters, "pre_budget")
    restored = changes(record, parameters, "native", selected_ids)
    combined = copy.deepcopy(before)
    for path, values in restored.items():
        # This is Scenario.__add__'s nested-dictionary merge contract.
        combined[path].update(values)
    for measure_id, measure in record["measures"].items():
        for path in measure["paths"]:
            expected = (
                parameters.get_child(path)(day.isoformat())
                if measure_id in selected_ids
                else value_after(
                    parameters.get_child(path), before[path], day.isoformat()
                )
            )
            assert (
                value_after(
                    parameters.get_child(path), combined[path], day.isoformat()
                )
                == expected
            )


def test_each_restore_replaces_every_pre_budget_interval(record, parameters):
    before = changes(record, parameters, "pre_budget")
    after = changes(record, parameters, "native")
    assert before.keys() == after.keys()
    for path in before:
        assert before[path].keys() == after[path].keys()


def test_actual_pre_budget_electricity_only_reverses_april_june(
    record, parameters
):
    before = changes(record, parameters, "pre_budget")
    for nation in ("great_britain", "northern_ireland"):
        path = f"gov.hmrc.vat.domestic_electricity_rate.{nation}"
        assert before[path] == {"2027-04-01.2027-06-30": 0.05}


def test_july_announced_bus_cap_is_already_in_actual_pre_budget_policy(
    record, parameters
):
    path = "gov.dft.bus.fares.cap"
    before = changes(record, parameters, "pre_budget")
    assert before[path] == {"2027-01-01.2027-12-31": 2}
    assert before[path] == changes(record, parameters, "native")[path]
    assert record["measures"]["bus_fare_cap_2027"]["announced_on"] == (
        "2026-07-22"
    )


def test_fuel_has_statutory_steps_and_preserves_native_july_boundary(
    record, parameters
):
    path = "gov.hmrc.fuel_duty.petrol_and_diesel"
    before = changes(record, parameters, "pre_budget")
    after = changes(record, parameters, "native")
    assert before[path]["2027-01-01.2027-02-28"] == 0.5595
    assert before[path]["2027-03-01.2027-03-31"] == 0.5795
    assert before[path]["2027-04-01.2027-06-30"] == 0.6003
    assert before[path]["2027-07-01.2028-03-31"] == 0.6003
    assert after[path]["2027-01-01.2027-02-28"] == 0.5295
    assert after[path]["2027-07-01.2028-03-31"] == 0.6059
    # RPI extends the counterfactual from its own last rate; it must never
    # switch to the higher post-Budget duty at the end of the stored path.
    assert before[path]["2032-04-01.2033-03-31"] == 0.6944


def test_native_rates_and_payment_are_restored_once(record, parameters):
    after = changes(record, parameters, "native")
    assert set(after["gov.hmrc.income_tax.rates.savings.basic"].values()) == {
        0.24
    }
    assert set(after["gov.hmrc.income_tax.rates.property.basic"].values()) == {
        0.24
    }
    assert after["gov.treasury.household_energy_payment.amount"] == {
        "2026-04-06.2027-04-05": 100
    }


def test_core_parameter_updates_restore_each_native_boundary(
    record, parameters
):
    from policyengine_core.parameters import ParameterNode
    from policyengine_core.periods import instant

    before = changes(record, parameters, "pre_budget")
    native = changes(record, parameters, "native")
    for path, intervals in before.items():
        source = parameters.get_child(path)
        tree = ParameterNode(
            "",
            data={
                "leaf": {
                    "values": {
                        day: policy._decode(value)
                        for day, value in source.values.items()
                    }
                }
            },
        )
        leaf = tree.get_child("leaf")
        for side in (intervals, native[path]):
            for period, value in side.items():
                first, last = period.split(".")
                leaf.update(
                    start=instant(first), stop=instant(last), value=value
                )
        for period in intervals:
            first, last = period.split(".")
            for day in (date.fromisoformat(first), date.fromisoformat(last)):
                assert leaf(day.isoformat()) == source(day.isoformat())
        # The bounded inverse must also preserve the first day after it.
        last = max(period.split(".")[1] for period in intervals)
        day_after = (date.fromisoformat(last) + timedelta(days=1)).isoformat()
        assert leaf(day_after) == source(day_after)


def test_missing_or_changed_native_policy_fails_closed(record, parameters):
    path = "gov.hmrc.income_tax.rates.savings.basic"
    del parameters.nodes[path]
    with pytest.raises(policy.UnsupportedBudgetModel, match="missing"):
        changes(record, parameters, "pre_budget")
    parameters.nodes[path] = Timeline({"2027-04-06": 0.26})
    with pytest.raises(policy.UnsupportedBudgetModel, match="reviewed value"):
        changes(record, parameters, "pre_budget")


def test_unknown_measure_fails_closed(record, parameters):
    with pytest.raises(ValueError, match="Unknown native Budget measure"):
        changes(record, parameters, "native", ["nonexistent_measure"])


def test_public_native_changes_preserve_existing_limitation_warnings(
    record, parameters, monkeypatch
):
    from uk_budget_data import measure_templates

    warned = []
    monkeypatch.setattr(policy, "_native_parameters", lambda: parameters)
    monkeypatch.setattr(
        measure_templates,
        "_warn_if_data_limited",
        lambda path: warned.append(("data", path)),
    )
    monkeypatch.setattr(
        measure_templates,
        "_warn_if_model_limited",
        lambda path: warned.append(("model", path)),
    )
    for measure_id, measure in record["measures"].items():
        policy.native_policy_changes(measure_id)
        for path in measure["paths"]:
            assert ("data", path) in warned
            assert ("model", path) in warned


def test_public_record_cannot_mutate_the_cached_record():
    record = policy.policy_record()
    record["measures"].clear()
    assert len(policy.policy_record()["measures"]) == 11


def test_wrong_installed_model_fails_closed(monkeypatch):
    policy._native_parameters.cache_clear()
    monkeypatch.setattr(policy.metadata, "version", lambda _: "2.165.1")
    try:
        with pytest.raises(policy.UnsupportedBudgetModel, match="2.174.1"):
            policy.pre_budget_policy_changes()
    finally:
        policy._native_parameters.cache_clear()
