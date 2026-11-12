"""Native cache housekeeping must not look like reading every missing input."""

import types

import pytest
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
        # an array read inside the otherwise exempt pending-cache cleanup.
        monkeypatch.setattr(Holder, "_drop_computed", with_read)
        return shares(simulation)

    assert build_reads(modifier) == {"pip_dl_points", "directly_held_shares"}
