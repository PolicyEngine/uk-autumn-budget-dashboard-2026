"""The split of ``budget_measures.py`` into one module per modifier (#134).

``tests/budget_measures_before_split.b64`` is ``budget_measures.py``
exactly as it was on ``main`` before the split (65280bd), base64-encoded.
Kept as Python, git paired the copy with the deleted file as a rename
(100% similar), so a branch still editing ``budget_measures.py`` merged its
edit into the copy, with no conflict, instead of into the modifier's
module. Encoded, the copy shares no line with it: the edit is a conflict
with the deletion, to be ported by hand. The split moved code and nothing
else, so each modifier's identity changes only through its module
(its name, its source, and the other functions' defaults there), and each
measure gives the same figures from the copy as from the split.

These tests prove the split, not later work. Each compares a module only
while its source is the one the split wrote (``SPLIT_SHA256``): a later fix
to a module (G5) changes its definition on purpose, and its comparison is
skipped, saying so; a new module (construction step 1) has no copy to
compare with. The copy itself is never updated, since its digest is pinned.
"""

import base64
import hashlib
import importlib.util
import inspect
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest
from policyengine_uk import Simulation

from tests.test_budget_measures import (
    PACKAGE,
    ROAD_FUEL_MODULES,
    defined_functions,
    identity,
    modifier,
    module,
    registered_modifiers,
)
from uk_budget_data.reforms import get_all_reforms

COPY = Path(__file__).with_name("budget_measures_before_split.b64")
COPY_MODULE = "budget_measures_before_split"
# Where the copy's source is written: the receipt binds a module by its
# file's source. Removed when the test run ends.
_COPY_DIRECTORY = tempfile.TemporaryDirectory(prefix="before-split-")


def _load_copy():
    path = Path(_COPY_DIRECTORY.name) / f"{COPY_MODULE}.py"
    path.write_bytes(base64.b64decode(COPY.read_bytes(), validate=False))
    spec = importlib.util.spec_from_file_location(COPY_MODULE, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[COPY_MODULE] = loaded
    try:
        spec.loader.exec_module(loaded)
    except BaseException:
        del sys.modules[COPY_MODULE]
        raise
    return loaded


try:
    before_split = _load_copy()
except ImportError as error:  # a helper the copy imports was renamed since
    pytest.skip(
        f"the pre-split copy no longer imports ({error}); the split was "
        "proved by its own CI (#134)",
        allow_module_level=True,
    )

# SHA-256 of budget_measures.py on main at 65280bd, the last commit before
# the split: the copy is that file, byte for byte.
BEFORE_SPLIT_SHA256 = (
    "b9eb17b3a8b80c8e62a8749e78d447326d790e3cf36fd62f499f27a6012cb42d"
)
# SHA-256 of each module as the split wrote it.
SPLIT_SHA256 = {
    "connect_student_loan_repayments": (
        "8992487f9496048a3eb44e81d4857365540383f2d16d0e779c984cdc79171219"
    ),
    "employer_ni_relief_ages_21_to_24": (
        "f3146191e61ca89ddb1eed743f705a12dcaff370f84f985eb66e1c2d8e5e01d3"
    ),
    "pump_vat_on_fuel_duty_deferral": (
        "ee58cdf6addca2bbda55e491a9b2c255386c99eaef9e54936febefc25722eb7e"
    ),
    "road_fuel_vat_cut": (
        "1a39e578e5182d0013fa3e47c0a67b78edad26218aec6074fd6fa2d97a2c2e88"
    ),
    "state_pension_income_tax_allowance": (
        "439b23e23a95ca5a68d56c78e195bd19236b85ba71455c37a215fd5333cc98ed"
    ),
    "warm_home_discount_top_up": (
        "75cf729d00b491705b8e49571d93659be4ac3b5a3ae2be1f2803fdce8c5a0bcc"
    ),
    "zero_vat_on_domestic_electricity": (
        "b302b1ab4eeec00cdf2b93ae13aa1f7b491f11182138ca04c9dbb5cfa472e8cc"
    ),
}
SPLIT_NAMES = sorted(SPLIT_SHA256)


def as_split(name):
    """Skip unless the module's source is the one the split wrote."""
    try:
        path = Path(inspect.getsourcefile(module(name)))
    except ImportError:
        pytest.skip(f"{name}'s module has been removed since the split")
    if hashlib.sha256(path.read_bytes()).hexdigest() != SPLIT_SHA256[name]:
        pytest.skip(
            f"{name}'s module has changed since the split, so its "
            "definition has too: the split was proved by its own CI (#134)"
        )


def test_the_copy_is_main_before_the_split():
    path = Path(before_split.__file__)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == BEFORE_SPLIT_SHA256


def test_the_stored_copy_shares_no_line_with_its_source():
    """So git can't take it for ``budget_measures.py`` renamed (above)."""
    source = Path(before_split.__file__).read_text().splitlines()
    stored = COPY.read_text().splitlines()
    assert stored
    assert not set(stored) & set(source)


def test_the_split_wrote_a_module_for_each_modifier_in_the_copy():
    assert SPLIT_NAMES == defined_functions(
        before_split, before_split.__name__
    )
    assert len(SPLIT_NAMES) == 7


@pytest.mark.parametrize("name", SPLIT_NAMES)
def test_a_modifiers_identity_changed_only_in_its_module(name):
    """The function's own source and default arguments are as they were;
    only the module it is bound with (its name, its source, and the other
    functions' defaults there) differs."""
    as_split(name)
    old = identity(getattr(before_split, name))
    new = identity(modifier(name))
    assert new["qualname"] == old["qualname"] == name
    assert new["source_sha256"] == old["source_sha256"]
    assert new["code_revision"] == old["code_revision"]
    own_defaults = (old["module_defaults"] or {}).get(name)
    assert new["module_defaults"] == (
        None if own_defaults is None else {name: own_defaults}
    )
    assert new["module"] != old["module"]
    assert new["module_source_sha256"] != old["module_source_sha256"]


@pytest.mark.parametrize("name", ROAD_FUEL_MODULES)
def test_the_road_fuel_vat_rate_is_the_copys(name):
    as_split(name)
    assert module(name).ROAD_FUEL_VAT_RATE == before_split.ROAD_FUEL_VAT_RATE


# --- the same figures ------------------------------------------------------

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


SIDES = ("simulation_modifier", "baseline_simulation_modifier")


def split_modifiers_of(reform):
    """The names of the split's modifiers the measure applies."""
    return {
        getattr(reform, side).__name__
        for side in SIDES
        if getattr(reform, side) is not None
        and getattr(reform, side).__module__.startswith(f"{PACKAGE}.")
        and getattr(reform, side).__name__ in SPLIT_SHA256
    }


def with_the_copy(reform):
    """The measure with each of the split's modifiers taken from the copy;
    anything else it applies is left as it is."""

    def choose(function):
        if (
            function.__module__.startswith(f"{PACKAGE}.")
            and function.__name__ in SPLIT_SHA256
        ):
            return getattr(before_split, function.__name__)
        return function

    return reform.model_copy(
        update={
            side: choose(getattr(reform, side))
            for side in SIDES
            if getattr(reform, side) is not None
        }
    )


MEASURES = sorted(
    reform.id for reform in get_all_reforms() if split_modifiers_of(reform)
)


def test_every_split_modifier_still_registered_is_exercised_below():
    covered = set().union(
        *(
            split_modifiers_of(reform)
            for reform in get_all_reforms()
            if reform.id in MEASURES
        )
    )
    assert covered
    assert covered == set(registered_modifiers()) & set(SPLIT_NAMES)


@pytest.mark.parametrize("measure_id", MEASURES)
def test_a_measure_gives_the_same_figures_from_the_copy(measure_id):
    """Each side of each measure, run on one household with the split's
    modifiers and with the copy's, gives identical outputs in every year;
    and the household is one the measure moves, so the comparison is not
    empty."""
    from uk_budget_data.models import DataConfig

    reform = next(r for r in get_all_reforms() if r.id == measure_id)
    for name in sorted(split_modifiers_of(reform)):
        as_split(name)
    copied = with_the_copy(reform)
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
