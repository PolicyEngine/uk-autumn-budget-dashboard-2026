"""Opt-in stored-input mode preserves legacy caches and full behavior guards."""

from dataclasses import replace
from types import SimpleNamespace

import numpy
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data import model_limits


class Holder:
    def __init__(self, value):
        self.value = value

    def get_known_branch_periods(self):
        return [] if self.value is None else [("default", "2027")]

    def get_array(self, period, branch):
        return numpy.array([self.value])


VARIABLE = SimpleNamespace()
SYSTEM = SimpleNamespace(variables={"gaming_duty": VARIABLE})
BEHAVIOUR = SimpleNamespace(of=repr)


def simulation(value, *, explicit=False, unknown=False, changed=False):
    holder = Holder(value)
    system = (
        SimpleNamespace(
            variables={
                "gaming_duty": SimpleNamespace(
                    formulas={"2027": lambda *args: None}
                )
            }
        )
        if changed
        else SYSTEM
    )
    result = SimpleNamespace(
        tax_benefit_system=system, get_holder=lambda name: holder
    )
    if not unknown:
        result._user_input_keys = (
            {("gaming_duty", "default", "2027")} if explicit else set()
        )
    return result


def differing(base, reform, *, inputs_only=False):
    return model_limits._variables_differing(
        base, reform, ("gaming_duty",), BEHAVIOUR, inputs_only=inputs_only
    )


def test_legacy_derived_cache_comparison_remains_the_default():
    assert differing(simulation(15), simulation(16)) == [
        "variable:gaming_duty"
    ]
    assert differing(simulation(15), simulation(15)) == []


def test_opt_in_ignores_only_known_ordinary_derived_cache_difference():
    assert differing(simulation(15), simulation(16), inputs_only=True) == []


@pytest.mark.parametrize("side", ["baseline", "reform"])
@pytest.mark.parametrize("mode", ["explicit", "unknown", "behavior"])
def test_opt_in_retains_both_side_input_unknown_and_behavior_guards(
    side, mode
):
    plain = simulation(15)
    changed = simulation(
        16,
        explicit=mode == "explicit",
        unknown=mode == "unknown",
        changed=mode == "behavior",
    )
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    assert differing(*pair, inputs_only=True) == ["variable:gaming_duty"]


def test_unknown_bookkeeping_on_both_sides_compares_all_known_values():
    assert differing(
        simulation(15, unknown=True),
        simulation(16, unknown=True),
        inputs_only=True,
    ) == ["variable:gaming_duty"]


def test_option_is_explicit_default_false_and_bound_in_registry_digest():
    casino = next(
        limit
        for limit in model_limits.MODEL_LIMITS
        if limit.key == "casino_statutory_gaming_bands"
    )
    assert casino.stored_inputs_only is True
    legacy = replace(casino, stored_inputs_only=False)
    assert model_limits._registry_digest(
        (casino,)
    ) != model_limits._registry_digest((legacy,))
    assert all(
        not limit.stored_inputs_only
        for limit in model_limits.MODEL_LIMITS
        if limit.key != casino.key
    )


@st.composite
def storage_arrays(draw):
    size = draw(st.integers(min_value=1, max_value=4))
    values = st.lists(
        st.integers(min_value=-1000, max_value=1000),
        min_size=size,
        max_size=size,
    )
    return draw(values), draw(values), draw(values)


def simulation_with_distinct_slots(inputs, derived):
    arrays = {"2026": numpy.asarray(inputs), "2027": numpy.asarray(derived)}
    holder = SimpleNamespace(
        get_known_branch_periods=lambda: [
            ("default", year) for year in arrays
        ],
        get_array=lambda period, branch: arrays[str(period)],
    )
    return SimpleNamespace(
        tax_benefit_system=SYSTEM,
        get_holder=lambda name: holder,
        _user_input_keys={("gaming_duty", "default", "2026")},
    )


@settings(max_examples=25, deadline=None)
@given(arrays=storage_arrays())
def test_only_opt_in_ignores_arbitrary_derived_values(arrays):
    """Identical explicit inputs permit derived differences only in opt-in mode."""
    inputs, before, after = arrays
    base = simulation_with_distinct_slots(inputs, before)
    reform = simulation_with_distinct_slots(inputs, after)
    expected = [] if before == after else ["variable:gaming_duty"]
    for pair in ((base, reform), (reform, base)):
        assert differing(*pair, inputs_only=True) == []
        assert differing(*pair) == expected


@settings(max_examples=25, deadline=None)
@given(
    arrays=storage_arrays(),
    increment=st.integers(min_value=1, max_value=10),
)
def test_changed_explicit_inputs_hold_in_both_storage_modes(arrays, increment):
    """Changing an explicit 2026 input holds regardless of 2027 derived values."""
    inputs, before, after = arrays
    changed = [inputs[0] + increment, *inputs[1:]]
    base = simulation_with_distinct_slots(inputs, before)
    reform = simulation_with_distinct_slots(changed, after)
    for pair in ((base, reform), (reform, base)):
        assert differing(*pair) == ["variable:gaming_duty"]
        assert differing(*pair, inputs_only=True) == ["variable:gaming_duty"]
