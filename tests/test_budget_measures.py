"""One modifier per module in ``budget_measures``.

A receipt binds a modifier's whole module (its source, and every function's
default arguments there), so a module holding several modifiers ties their
definitions together: until 25 October all seven were in
``budget_measures.py``, and any edit there changed every one. Each now has a
module of its own, named after it, and these tests keep it so. They hold
for any number of modifiers, so a new measure's module, or a fix to one,
passes them, provided it keeps the road fuel VAT rate the same in both
modules that write it. ``tests/test_budget_measures_split.py`` checks the
split itself.
"""

import inspect
import pkgutil
from importlib import import_module

import pytest

from uk_budget_data import budget_measures
from uk_budget_data.publication.receipt import CodeRevision
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    get_all_reforms,
)

PACKAGE = budget_measures.__name__
NAMES = sorted(
    info.name for info in pkgutil.iter_modules(budget_measures.__path__)
)
REVISION = CodeRevision("0" * 40, tree_clean=True)
# The two modules that write the road fuel VAT rate, which both their
# measures use.
ROAD_FUEL_MODULES = ("pump_vat_on_fuel_duty_deferral", "road_fuel_vat_cut")


def module(name):
    return import_module(f"{PACKAGE}.{name}")


def modifier(name):
    return getattr(module(name), name)


def defined_functions(namespace, module_name):
    return sorted(
        name
        for name, value in vars(namespace).items()
        if inspect.isfunction(value) and value.__module__ == module_name
    )


def registered_modifiers():
    """Every modifier from the package a registered measure applies, on
    either side, with the measures and sides that apply it."""
    found = {}
    for reform in get_all_reforms():
        for side in ("simulation_modifier", "baseline_simulation_modifier"):
            function = getattr(reform, side)
            if function is not None and function.__module__.startswith(
                f"{PACKAGE}."
            ):
                found.setdefault(function.__name__, []).append(
                    (reform.id, side)
                )
    return found


def identity(function):
    from policyengine.provenance import receipt

    return receipt._modifier_identity(function, REVISION.as_binding())


@pytest.mark.parametrize("name", NAMES)
def test_each_module_holds_exactly_one_modifier_named_after_it(name):
    found = module(name)
    assert defined_functions(found, found.__name__) == [name]
    assert not [
        value
        for value in vars(found).values()
        if inspect.isclass(value) and value.__module__ == found.__name__
    ]


def test_the_package_itself_defines_nothing():
    """It re-exports nothing: a package attribute named after a modifier
    is that modifier's module, never the function."""
    own = {key for key in vars(budget_measures) if not key.startswith("__")}
    assert own <= set(NAMES)
    for key in own:
        assert inspect.ismodule(getattr(budget_measures, key))


def test_every_registered_modifier_lives_in_a_module_of_its_own():
    """Every measure's modifier, on either side, is the one function of a
    module of its own in the package, named after it: none comes from
    anywhere else, in the package or outside it, where it could share a
    module with another. The combined measure's modifiers, on both sides,
    compose its members' (``publication.combine``); each member's is
    checked as its own measure's."""
    checked = 0
    for reform in get_all_reforms():
        if reform.id == AUTUMN_BUDGET_2026_COMBINED_ID:
            continue
        for side in ("simulation_modifier", "baseline_simulation_modifier"):
            function = getattr(reform, side)
            if function is None:
                continue
            assert function.__module__ == f"{PACKAGE}.{function.__name__}", (
                reform.id,
                side,
                function.__module__,
            )
            assert function is modifier(function.__name__)
            checked += 1
    assert checked
    assert set(registered_modifiers()) <= set(NAMES)


def test_the_road_fuel_vat_rate_is_the_same_wherever_it_is_written():
    rates = {
        name: module(name).ROAD_FUEL_VAT_RATE
        for name in NAMES
        if hasattr(module(name), "ROAD_FUEL_VAT_RATE")
    }
    assert set(ROAD_FUEL_MODULES) <= set(rates)
    assert len(set(rates.values())) == 1


@pytest.mark.parametrize("name", NAMES)
def test_each_module_is_bindable_on_its_own(name):
    """The receipt binds each module alone: a module that couldn't be
    bound would be refused at generation."""
    found = identity(modifier(name))
    assert found["module"] == f"{PACKAGE}.{name}"
    assert found["qualname"] == name
