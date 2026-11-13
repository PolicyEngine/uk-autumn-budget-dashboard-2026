"""Native cache housekeeping must not look like reading every missing input."""

import types

import numpy as np
import pytest
from policyengine_core.data_storage import InMemoryStorage, OnDiskStorage
from policyengine_core.holders import helpers as holder_helpers
from policyengine_core.holders.holder import Holder
from policyengine_core.periods import period
from policyengine_uk.simulation import Simulation
from policyengine_uk.utils import measurement_branches
from policyengine_uk.utils.scenario import Scenario

from tests.test_data_limits_cuts import one_adult
from uk_budget_data import data_limits


@pytest.fixture(autouse=True)
def watched_shares(monkeypatch):
    data_limits._engine_parts()
    monkeypatch.setattr(
        data_limits,
        "_MISSING_INPUTS",
        data_limits._MISSING_INPUTS
        | {"directly_held_shares", "unit_and_investment_trusts"},
    )


def build_reads(modifier):
    simulation = data_limits.watched_build(
        one_adult, Scenario(simulation_modifier=modifier)
    )
    return data_limits._build_reads(simulation)


def shares(simulation):
    simulation.calculate("directly_held_shares", 2027)
    return simulation


def test_native_pending_cleanup_records_only_the_modifiers_actual_read():
    assert build_reads(shares) == {"directly_held_shares"}


def test_direct_holder_fetch_stays_watched_beside_native_cleanup():
    def modifier(simulation):
        simulation.get_holder("pip_dl_points")
        return shares(simulation)

    assert build_reads(modifier) == {"pip_dl_points", "directly_held_shares"}


def test_explicit_modifier_cleanup_is_not_the_native_calculate_exemption():
    def modifier(simulation):
        measurement_branches.drop_calculated_values(simulation)
        return simulation

    assert {"pip_dl_points", "lpg_kg"} <= build_reads(modifier)


def test_a_wrapper_around_the_cleanup_does_not_acquire_native_trust(
    monkeypatch,
):
    original = measurement_branches.drop_calculated_values

    def wrapped(simulation):
        return original(simulation)

    monkeypatch.setitem(
        Simulation.calculate.__globals__, "drop_calculated_values", wrapped
    )
    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        shares
    )


def test_mutating_a_captured_cleanup_code_object_revokes_the_exemption(
    monkeypatch,
):
    function = measurement_branches.drop_calculated_years
    monkeypatch.setattr(
        function,
        "__code__",
        function.__code__.replace(co_name="changed_cleanup"),
    )
    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        shares
    )


def test_a_custom_bound_calculate_wrapper_keeps_its_cleanup_fetches_watched():
    def modifier(simulation):
        original = simulation.calculate

        def wrapped(self, *args, **kwargs):
            return original(*args, **kwargs)

        simulation.calculate = types.MethodType(wrapped, simulation)
        return shares(simulation)

    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        modifier
    )


def test_native_methods_bound_to_another_simulation_do_not_match_the_chain():
    other = one_adult()

    def modifier(simulation):
        # The function is the genuine Core method, but its receiver differs
        # from the simulation whose native calculate is clearing caches.
        simulation.get_holder = other.get_holder
        return shares(simulation)

    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        modifier
    )


def test_a_real_array_read_inside_cleanup_is_still_recorded(monkeypatch):
    original = Holder._drop_computed

    def with_read(self, *args, **kwargs):
        if self.variable.name == "pip_dl_points":
            self.get_array(period("2027"))
        return original(self, *args, **kwargs)

    def modifier(simulation):
        # Install after native construction, so the witness is specifically
        # an array read inside pending-cache cleanup. A class-wide helper
        # replacement also revokes metadata trust for all input holders.
        monkeypatch.setattr(Holder, "_drop_computed", with_read)
        return shares(simulation)

    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        modifier
    )


@pytest.mark.parametrize(
    "method_name", ["_drop_computed", "_stores_user_input"]
)
@pytest.mark.parametrize("replacement", ["class", "instance", "foreign"])
def test_changed_holder_cleanup_cannot_hide_raw_storage_reads(
    monkeypatch, method_name, replacement
):
    original = getattr(Holder, method_name)
    reads = []

    def with_raw_read(self, *args, **kwargs):
        if self.variable.name == "pip_dl_points":
            # Supplied-input helpers may use storage directly; fetching the
            # holder is the watch's fallback for those reads.
            reads.append(
                self._memory_storage.get(
                    period("2027"), self.simulation.branch_name
                )
            )
        return original(self, *args, **kwargs)

    other = one_adult() if replacement == "foreign" else None

    def modifier(simulation):
        if method_name == "_stores_user_input":
            # Native cleanup checks stale replay keys without assuming that
            # an array survives. Exercise that metadata-only call directly.
            simulation._user_input_keys.add(
                ("pip_dl_points", simulation.branch_name, period("2027"))
            )
        if replacement == "class":
            monkeypatch.setattr(Holder, method_name, with_raw_read)
        else:
            # Installing the test override must not itself fetch the holder
            # through the watched API and pre-record the expected input.
            population = simulation.get_variable_population("pip_dl_points")
            holder = population._holders["pip_dl_points"]
            receiver = (
                other.get_variable_population("pip_dl_points")._holders[
                    "pip_dl_points"
                ]
                if other is not None
                else holder
            )
            monkeypatch.setattr(
                holder, method_name, types.MethodType(with_raw_read, receiver)
            )
        return shares(simulation)

    recorded = build_reads(modifier)
    assert reads, "the witness must execute a raw storage read in cleanup"
    assert {"pip_dl_points", "directly_held_shares"} <= recorded
    if replacement != "class":
        # A per-holder override revokes only this holder's exemption.
        assert recorded == {"pip_dl_points", "directly_held_shares"}


@pytest.mark.parametrize(
    "method_name", ["_drop_computed", "_stores_user_input"]
)
def test_mutating_holder_cleanup_code_revokes_native_trust(
    monkeypatch, method_name
):
    function = getattr(Holder, method_name)

    def modifier(simulation):
        monkeypatch.setattr(
            function,
            "__code__",
            function.__code__.replace(co_name="changed_holder_cleanup"),
        )
        return shares(simulation)

    assert {"pip_dl_points", "lpg_kg", "directly_held_shares"} <= build_reads(
        modifier
    )


@pytest.mark.parametrize("method_name", ["has", "drop_computed"])
def test_per_storage_raw_read_revokes_only_its_holders_exemption(
    monkeypatch, method_name
):
    reads = []

    def modifier(simulation):
        holder = simulation.get_variable_population("pip_dl_points")._holders[
            "pip_dl_points"
        ]
        storage = holder._memory_storage
        original = getattr(storage, method_name)
        if method_name == "has":
            simulation._user_input_keys.add(
                ("pip_dl_points", simulation.branch_name, period("2027"))
            )

        def with_raw_read(self, *args, **kwargs):
            reads.append(self.get(period("2027"), simulation.branch_name))
            return original(*args, **kwargs)

        monkeypatch.setattr(
            storage, method_name, types.MethodType(with_raw_read, storage)
        )
        return shares(simulation)

    recorded = build_reads(modifier)
    assert reads, "the storage override must execute its raw read"
    assert recorded == {"pip_dl_points", "directly_held_shares"}


@pytest.mark.parametrize(
    "helper_name", ["_is_input", "_period_from_storage_key"]
)
def test_changed_holder_module_helper_cannot_hide_a_raw_storage_read(
    monkeypatch, helper_name
):
    original = getattr(holder_helpers, helper_name)
    reads = []

    def modifier(simulation):
        storage = (
            simulation.get_variable_population("pip_dl_points")
            ._holders["pip_dl_points"]
            ._memory_storage
        )
        # A restored storage mark without a replay record exercises both
        # native input-classification helpers. This is synthetic setup.
        storage.put(np.array([0.0]), period("2027"), simulation.branch_name)

        def with_raw_read(*args, **kwargs):
            reads.append(storage.get(period("2027"), simulation.branch_name))
            return original(*args, **kwargs)

        monkeypatch.setattr(holder_helpers, helper_name, with_raw_read)
        return shares(simulation)

    assert {"pip_dl_points", "directly_held_shares"} <= build_reads(modifier)
    assert reads, "the module helper must execute its raw read"


# This finite catalogue comes from the native metadata call graph, not the
# implementation's captured-method registry: an omitted binding must fail.
METADATA_CALLEES = (
    (Holder, "_drop_computed"),
    (Holder, "_stores_user_input"),
    (Holder, "_storage_period"),
    (Holder, "_seed_input_storage"),
    *(
        (InMemoryStorage, name)
        for name in (
            "has",
            "is_derived",
            "mark_derived_except",
            "drop_computed",
            "_unmark_input",
            "_own_inputs",
            "_release_inputs_if_empty",
            "_stop_sharing",
            "_release_if_empty",
        )
    ),
    *(
        (OnDiskStorage, name)
        for name in (
            "has",
            "is_derived",
            "mark_derived_except",
            "drop_computed",
        )
    ),
)


def metadata_only_holder():
    """An uninitialised holder/storage shape; no model or storage call runs."""
    holder = Holder.__new__(Holder)
    holder._memory_storage = InMemoryStorage.__new__(InMemoryStorage)
    holder._disk_storage = OnDiskStorage.__new__(OnDiskStorage)
    return holder


def test_unchanged_metadata_callees_are_accepted_without_executing_them():
    assert data_limits._native_cleanup_metadata_unchanged(
        metadata_only_holder()
    )


@pytest.mark.parametrize("kind,name", METADATA_CALLEES)
@pytest.mark.parametrize("change", ["class", "instance", "foreign", "code"])
def test_each_native_metadata_callee_requires_its_code_binding_and_receiver(
    monkeypatch, kind, name, change
):
    holder = metadata_only_holder()
    subject = (
        holder
        if kind is Holder
        else (
            holder._memory_storage
            if kind is InMemoryStorage
            else holder._disk_storage
        )
    )
    original = kind.__dict__[name]
    if change == "class":
        monkeypatch.setattr(kind, name, lambda *args, **kwargs: None)
    elif change == "code":
        monkeypatch.setattr(
            original, "__code__", original.__code__.replace(co_name="changed")
        )
    else:
        receiver = kind.__new__(kind) if change == "foreign" else subject
        function = original if change == "foreign" else lambda *args: None
        monkeypatch.setattr(
            subject, name, types.MethodType(function, receiver)
        )
    assert not data_limits._native_cleanup_metadata_unchanged(holder)


@pytest.mark.parametrize(
    "helper_name", ["_is_input", "_period_from_storage_key"]
)
@pytest.mark.parametrize("change", ["binding", "code", "module"])
def test_metadata_helper_aliases_and_code_must_remain_native(
    monkeypatch, helper_name, change
):
    holder = metadata_only_holder()
    original = getattr(holder_helpers, helper_name)
    if change == "binding":
        monkeypatch.setattr(
            holder_helpers, helper_name, lambda *args, **kwargs: None
        )
    elif change == "code":
        monkeypatch.setattr(
            original, "__code__", original.__code__.replace(co_name="changed")
        )
    else:
        import sys

        monkeypatch.setitem(
            sys.modules,
            holder_helpers.__name__,
            types.ModuleType("replacement"),
        )
    assert not data_limits._native_cleanup_metadata_unchanged(holder)


def test_unknown_storage_implementation_keeps_the_input_watched():
    class CustomStorage(InMemoryStorage):
        pass

    holder = metadata_only_holder()
    holder._memory_storage = CustomStorage.__new__(CustomStorage)
    assert not data_limits._native_cleanup_metadata_unchanged(holder)


@pytest.mark.usefixtures("stand_in_data_limits")
@pytest.mark.parametrize("raw_storage_read", [False, True])
def test_observation_cleanup_exempts_only_unchanged_native_metadata(
    monkeypatch, raw_storage_read
):
    from tests.test_data_limits import (
        priced_by_a_counterfactual_branch,
        simulation,
    )

    baseline = simulation(modifier=priced_by_a_counterfactual_branch(0.03, 0))
    reformed = simulation(modifier=priced_by_a_counterfactual_branch(0.05, 0))
    reads = []
    if raw_storage_read:
        branch = reformed.branches["counterfactual"]
        storage = (
            branch.get_variable_population("pip_dl_points")
            ._holders["pip_dl_points"]
            ._memory_storage
        )
        original = storage.drop_computed

        def with_raw_read(self, *args, **kwargs):
            reads.append(self.get(period("2027"), branch.branch_name))
            return original(*args, **kwargs)

        monkeypatch.setattr(
            storage, "drop_computed", types.MethodType(with_raw_read, storage)
        )

    keys = {
        row["key"] for row in data_limits.limits_touched(baseline, reformed)
    }
    if raw_storage_read:
        assert reads, "the changed helper must execute during observation"
        assert {"non_residential_purchases", "pip_daily_living_points"} <= keys
    else:
        assert keys == {"non_residential_purchases"}
