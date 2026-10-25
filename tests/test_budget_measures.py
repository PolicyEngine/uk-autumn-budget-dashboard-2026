"""One modifier per module in ``budget_measures``, and the split that made it.

A receipt binds a modifier's whole module (its source, and every function's
default arguments there), so a module holding several modifiers ties their
definitions together: until 25 October all seven were in
``budget_measures.py``, and any edit there changed every one. Each now has a
module of its own, named after it.

``tests/budget_measures_before_split.py`` is ``budget_measures.py`` exactly
as it was on ``main`` before the split (65280bd), kept for the differential
tests below: the split moved code and nothing else, so each modifier's
identity changes only in its module, and its figures not at all.
"""

import hashlib
import inspect
import pkgutil
from importlib import import_module
from pathlib import Path

import numpy as np
import pytest
from policyengine_uk import Simulation

from tests import budget_measures_before_split as before_split
from uk_budget_data import budget_measures
from uk_budget_data.publication.receipt import CodeRevision
from uk_budget_data.reforms import get_all_reforms

PACKAGE = budget_measures.__name__
NAMES = sorted(
    info.name for info in pkgutil.iter_modules(budget_measures.__path__)
)
REVISION = CodeRevision("0" * 40, tree_clean=True)
# SHA-256 of budget_measures.py on main at 65280bd, the last commit before
# the split: the copy is that file, byte for byte.
BEFORE_SPLIT_SHA256 = (
    "b9eb17b3a8b80c8e62a8749e78d447326d790e3cf36fd62f499f27a6012cb42d"
)


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
    """Every modifier a registered measure applies, on either side."""
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


# --- one modifier per module --------------------------------------------


def test_the_package_holds_the_seven_modifiers():
    assert NAMES == defined_functions(before_split, before_split.__name__)
    assert len(NAMES) == 7


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
    """No measure applies a modifier from anywhere else in the package, or
    shares a module with another."""
    registered = registered_modifiers()
    assert sorted(registered) == NAMES
    for reform in get_all_reforms():
        for side in ("simulation_modifier", "baseline_simulation_modifier"):
            function = getattr(reform, side)
            if function is None or not function.__module__.startswith(
                f"{PACKAGE}."
            ):
                continue
            assert function.__module__ == f"{PACKAGE}.{function.__name__}"
            assert function is modifier(function.__name__)


def test_the_road_fuel_vat_rate_is_the_same_wherever_it_is_written():
    rates = {
        name: module(name).ROAD_FUEL_VAT_RATE
        for name in NAMES
        if hasattr(module(name), "ROAD_FUEL_VAT_RATE")
    }
    assert sorted(rates) == [
        "pump_vat_on_fuel_duty_deferral",
        "road_fuel_vat_cut",
    ]
    assert set(rates.values()) == {before_split.ROAD_FUEL_VAT_RATE}


@pytest.mark.parametrize("name", NAMES)
def test_each_module_is_bindable_on_its_own(name):
    """The receipt binds each module alone: a module that couldn't be
    bound would be refused at generation."""
    identity = _identity(modifier(name))
    assert identity["module"] == f"{PACKAGE}.{name}"
    assert identity["qualname"] == name


# --- the split: identities change only in their module --------------------


def _identity(function):
    from policyengine.provenance import receipt

    return receipt._modifier_identity(function, REVISION.as_binding())


def test_the_copy_is_main_before_the_split():
    path = Path(before_split.__file__)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == BEFORE_SPLIT_SHA256


@pytest.mark.parametrize("name", NAMES)
def test_a_modifiers_identity_changed_only_in_its_module(name):
    """The function's own source and default arguments are as they were;
    only the module it is bound with (its name, its source, and the other
    functions' defaults there) differs."""
    old = _identity(getattr(before_split, name))
    new = _identity(modifier(name))
    assert new["qualname"] == old["qualname"] == name
    assert new["source_sha256"] == old["source_sha256"]
    assert new["code_revision"] == old["code_revision"]
    own_defaults = (old["module_defaults"] or {}).get(name)
    assert new["module_defaults"] == (
        None if own_defaults is None else {name: own_defaults}
    )
    assert new["module"] != old["module"]
    assert new["module_source_sha256"] != old["module_source_sha256"]


# --- the split: the same figures ------------------------------------------

YEARS = range(2026, 2032)
HOUSEHOLD_OUTPUTS = (
    "household_net_income",
    "household_tax",
    "household_benefits",
    "cost_of_living_support_payment",
)
PERSON_OUTPUTS = (
    "ni_class_1_employer",
    "income_tax",
    "student_loan_repayments",
)


def every_year(value):
    return {year: value for year in YEARS}


def situation():
    """A household each modifier moves: a 22-year-old Plan 2 graduate in
    work, a pensioner with a private pension, and a low-paid single parent
    on Universal Credit, with fuel and electricity spending."""
    people = {
        "graduate": {
            "age": every_year(22),
            "employment_income": every_year(30_000),
            "student_loan_plan": every_year("PLAN_2"),
            "student_loan_balance": every_year(40_000),
            "student_loan_repayments": every_year(300),
        },
        "pensioner": {
            "age": every_year(70),
            "state_pension": every_year(11_500),
            "private_pension_income": every_year(4_000),
        },
        "parent": {
            "age": every_year(35),
            "employment_income": every_year(9_000),
        },
        "child": {"age": every_year(6)},
    }
    return {
        "people": people,
        "benunits": {
            "graduate_unit": {"members": ["graduate"]},
            "pensioner_unit": {"members": ["pensioner"]},
            "family": {"members": ["parent", "child"]},
        },
        "households": {
            "home": {
                "members": list(people),
                "region": every_year("NORTH_WEST"),
                "electricity_consumption": every_year(1_050),
                "petrol_spending": every_year(1_500),
                "diesel_spending": every_year(800),
            }
        },
    }


def outputs(scenario):
    sim = Simulation(situation=situation(), scenario=scenario)
    found = {}
    for year in YEARS:
        for variable in HOUSEHOLD_OUTPUTS + PERSON_OUTPUTS:
            found[(variable, year)] = np.asarray(sim.calculate(variable, year))
    return found


def with_modifiers(reform, choose):
    return reform.model_copy(
        update={
            side: choose(getattr(reform, side))
            for side in ("simulation_modifier", "baseline_simulation_modifier")
            if getattr(reform, side) is not None
        }
    )


def to_the_copy(function):
    if not function.__module__.startswith(f"{PACKAGE}."):
        return function
    return getattr(before_split, function.__name__)


MEASURES_WITH_MODIFIERS = sorted(
    {
        reform_id
        for uses in registered_modifiers().values()
        for reform_id, _ in uses
    }
)


def test_every_modifier_is_exercised_below():
    assert len(MEASURES_WITH_MODIFIERS) == len(NAMES)


@pytest.mark.parametrize("measure_id", MEASURES_WITH_MODIFIERS)
def test_a_measure_gives_the_same_figures_from_the_copy(measure_id):
    """Each side of each measure, run on one household with the split's
    modifiers and with the copy's, gives identical outputs in every year;
    and the household is one the measure moves, so the comparison is not
    empty."""
    from uk_budget_data.models import DataConfig

    reform = next(r for r in get_all_reforms() if r.id == measure_id)
    copied = with_modifiers(reform, to_the_copy)
    config = DataConfig()
    split_reform = outputs(reform.to_scenario())
    copied_reform = outputs(copied.to_scenario())
    for key, value in split_reform.items():
        assert np.array_equal(value, copied_reform[key]), key
    split_base = outputs(reform.baseline_scenario_for(config))
    copied_base = outputs(copied.baseline_scenario_for(config))
    for key, value in split_base.items():
        assert np.array_equal(value, copied_base[key]), key
    assert any(
        not np.array_equal(value, split_base[key])
        for key, value in split_reform.items()
    )
