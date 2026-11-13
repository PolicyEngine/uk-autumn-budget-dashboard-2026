"""Fresh native model modules differ in identity, not policy behaviour."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data import data_limits


def _one_adult():
    return Simulation(
        situation={
            "people": {"p": {"age": {2027: 40}}},
            "benunits": {"b": {"members": ["p"]}},
            "households": {"h": {"members": ["p"]}},
        }
    )


def test_fresh_native_hb_formulas_and_all_variables_compare_equal():
    """Native HB helpers read childcare.__name__, not module __name__.

    The model compiles a different generated module for each system. That
    unrelated name previously made the unchanged WTC-disregard formula
    appear changed and attach twelve missing-input holds to any measure.
    """
    simulations = _one_adult(), _one_adult()
    systems = tuple(sim.tax_benefit_system for sim in simulations)
    behaviour = data_limits._Behaviour(main_systems=systems)
    left, right = (
        system.get_variable("housing_benefit_wtc_disregard")
        for system in systems
    )
    assert behaviour.of(left) == behaviour.of(right)
    assert not data_limits._Changes(*systems, behaviour).sides


class NamedValue:
    def __init__(self, name):
        self.__name__ = name


def _compiled(expression, namespace):
    exec(
        compile(
            f"def formula():\n    return {expression}\n", __file__, "exec"
        ),
        namespace,
    )
    return namespace["formula"]


def test_attribute_name_does_not_read_the_module_global_name():
    functions = [
        _compiled(
            "target.__name__",
            {"__name__": module, "target": NamedValue("childcare")},
        )
        for module in ("generated_native_a", "generated_native_b")
    ]
    behaviour = data_limits._Behaviour()
    assert functions[0]() == functions[1]() == "childcare"
    assert behaviour.of(functions[0]) == behaviour.of(functions[1])


@pytest.mark.parametrize(
    "expression, initial, mutated",
    [
        ("__name__", {"__name__": "one"}, {"__name__": "two"}),
        (
            "rates['rate']",
            {"rates": {"rate": 0.01}},
            {"rates": {"rate": 0.02}},
        ),
    ],
)
def test_real_global_reads_still_bind_values_and_mutations(
    expression, initial, mutated
):
    namespace = dict(initial)
    formula = _compiled(expression, namespace)
    original_result = formula()
    before = data_limits._Behaviour().of(formula)
    namespace.update(mutated)
    assert formula() != original_result
    assert data_limits._Behaviour().of(formula) != before
