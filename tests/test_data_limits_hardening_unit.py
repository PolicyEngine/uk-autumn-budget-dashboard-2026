"""Small, isolated checks for the detector's fail-closed mechanisms."""

import ast
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest


@pytest.fixture
def limits(monkeypatch):
    """Load the detector itself without the package's model initialisation.

    These unit tests supply their systems and storage. Importing the whole
    dashboard would initialise the UK model without exercising it here.
    Other tests still import the package normally for real simulations.
    """
    directory = Path(__file__).resolve().parents[1] / "src" / "uk_budget_data"
    package_specification = importlib.util.spec_from_file_location(
        "uk_budget_data",
        directory / "__init__.py",
        submodule_search_locations=[str(directory)],
    )
    package = importlib.util.module_from_spec(package_specification)
    monkeypatch.setitem(sys.modules, "uk_budget_data", package)
    name = "_w5_data_limits_under_test"
    specification = importlib.util.spec_from_file_location(
        name, directory / "data_limits.py"
    )
    module = importlib.util.module_from_spec(specification)
    monkeypatch.setitem(sys.modules, name, module)
    specification.loader.exec_module(module)
    return module


def test_an_empty_registry_imports_without_holding_any_parameters(
    monkeypatch, limits
):
    path = Path(limits.__file__)
    tree = ast.parse(path.read_text(), filename=str(path))
    assignments = [
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "DATA_LIMITS"
            for target in node.targets
        )
    ]
    assert len(assignments) == 1
    assignments[0].value = ast.copy_location(
        ast.Tuple(elts=[], ctx=ast.Load()), assignments[0].value
    )
    module = ModuleType("_w5_empty_data_limits_under_test")
    module.__file__ = str(path)
    monkeypatch.setitem(sys.modules, module.__name__, module)
    exec(
        compile(ast.fix_missing_locations(tree), str(path), "exec"),
        module.__dict__,
    )
    assert module.DATA_LIMITS == ()
    assert module._MISSING_INPUTS == frozenset()
    assert module._LIMITED_PREFIXES == ()
    assert module._TOWARDS == {}
    assert (
        module.limits_for_paths(
            ["gov.hmrc.stamp_duty.non_residential.purchase"]
        )
        == []
    )


def non_residential(limits):
    """The non-residential purchase limit, lifted from the registry at the
    a6299504 cut, built in the module under test: these checks need a limit
    whose input a stand-in model reads (tests/data_limit_stand_ins.py keeps
    the copy the other tests register)."""
    return limits.DataLimit(
        key="non_residential_purchases",
        parameters=(
            "gov.hmrc.stamp_duty.non_residential.purchase",
            "gov.revenue_scotland.lbtt.non_residential",
            "gov.wra.land_transaction_tax.non_residential",
        ),
        missing_input="non_residential_property_purchased",
        reason="A stand-in for the lifted non-residential purchase limit.",
    )


def variable(**changes):
    return SimpleNamespace(
        **{
            "name": "purchase_tax",
            "formulas": {},
            "is_neutralized": False,
            **changes,
        }
    )


def test_a_formula_end_changes_behaviour(limits):
    behaviour = limits._Behaviour()
    assert behaviour.of(variable(end=None)) != behaviour.of(
        variable(end="2026-12-31")
    )


def test_macro_cache_parameter_metadata_changes_behaviour(limits):
    behaviour = limits._Behaviour()
    assert behaviour.of(
        variable(exhaustive_parameter_dependencies=None)
    ) != behaviour.of(
        variable(exhaustive_parameter_dependencies=["gov.some.parameter"])
    )


def test_entity_population_keys_and_person_status_change_behaviour(limits):
    entity_type = type(
        "Entity", (), {"__module__": "policyengine_core.entities.entity"}
    )
    entities = [entity_type() for _ in range(3)]
    for entity, key, is_person in zip(
        entities, ("household", "benunit", "household"), (False, False, True)
    ):
        entity.key, entity.is_person = key, is_person
    behaviour = limits._Behaviour()
    original = behaviour.of(variable(entity=entities[0]))
    for changed in entities[1:]:
        assert original != behaviour.of(variable(entity=changed))


def test_abolition_changes_enter_the_observed_variables(monkeypatch, limits):
    monkeypatch.setattr(
        limits, "_abolitions_changed", lambda *args: {"purchase_tax"}
    )
    systems = [
        SimpleNamespace(variables={"purchase_tax": variable()})
        for _ in range(2)
    ]
    changes = limits._Changes(*systems, limits._Behaviour())
    assert "purchase_tax" in changes.sides


def test_abolition_comparison_uses_stored_values_and_cached_views(
    monkeypatch, limits
):
    def leaf(value):
        return SimpleNamespace(
            values_list=[SimpleNamespace(instant_str="2027-01-01")],
            value=value,
        )

    systems = [
        SimpleNamespace(parameters=SimpleNamespace(children={}))
        for _ in range(2)
    ]
    monkeypatch.setattr(limits, "_structure", lambda *args: {})
    monkeypatch.setattr(
        limits,
        "_views",
        lambda system, *args: [{"purchase_tax": system is systems[1]}],
    )
    assert limits._abolitions_changed(*systems, limits._Behaviour()) == {
        "purchase_tax"
    }
    monkeypatch.setattr(limits, "_views", lambda *args: [None])
    monkeypatch.setattr(
        limits,
        "_structure",
        lambda tree, *args: {
            "gov.abolitions.purchase_tax": leaf(tree is systems[1].parameters)
        },
    )
    monkeypatch.setattr(limits, "_same_effect", lambda left, right: False)
    assert limits._abolitions_changed(*systems, limits._Behaviour()) == {
        "purchase_tax"
    }


def test_abolition_views_read_the_mapping_core_uses(monkeypatch, limits):
    class View:
        purchase_tax = False

        def __init__(self, value):
            self._children = {"purchase_tax": value}

        def __getitem__(self, name):
            return self._children[name]

    systems = [
        SimpleNamespace(parameters=SimpleNamespace(children={}))
        for _ in range(2)
    ]
    monkeypatch.setattr(
        limits,
        "_view_at",
        lambda tree, *args: View(tree is systems[1].parameters),
    )
    monkeypatch.setattr(limits, "_structure", lambda *args: {})
    assert limits._views(
        systems[1], "gov.abolitions", limits._Behaviour(), True
    ) == [{"purchase_tax": True} for _ in limits.VIEW_YEARS]
    assert limits._abolitions_changed(*systems, limits._Behaviour()) == {
        "purchase_tax"
    }


@pytest.mark.parametrize("cache_at", ["root", "gov"])
def test_cached_abolitions_need_no_stored_branch(cache_at, limits):
    class View:
        purchase_tax = False

        def __init__(self, value):
            self._children = {"purchase_tax": value}

        def __getitem__(self, name):
            return self._children[name]

    def system(value):
        gov = SimpleNamespace(abolitions=View(value))
        root = SimpleNamespace(gov=gov)
        instants = [f"{year}-01-01" for year in limits.VIEW_YEARS]
        parameters = SimpleNamespace(
            children={
                "gov": SimpleNamespace(
                    children={},
                    _at_instant_cache=(
                        {instant: gov for instant in instants}
                        if cache_at == "gov"
                        else {}
                    ),
                )
            },
            _at_instant_cache=(
                {instant: root for instant in instants}
                if cache_at == "root"
                else {}
            ),
        )
        return SimpleNamespace(parameters=parameters)

    assert (
        limits._view_at(
            SimpleNamespace(children={}, _at_instant_cache={}),
            "gov.abolitions",
            "2027-01-01",
        )
        is None
    )
    systems = (system(False), system(True))
    assert limits._abolitions_changed(*systems, limits._Behaviour()) == {
        "purchase_tax"
    }
    assert all(
        item.parameters.children["gov"].children == {} for item in systems
    )


class Holder:
    def __init__(self, value):
        self.value = np.array([value])
        self._memory_storage = self
        self._disk_storage = None

    def get_known_branch_periods(self):
        return [("default", "1900")]

    def is_derived(self, period, branch):
        return False

    def get(self, period, branch):
        return self.value


def test_stored_inputs_read_both_tiers_without_calculation_or_neutralisation(
    limits,
):
    memory, disk = Holder(0), Holder(1)
    # A derived memory value shadows the disk input when core calculates.
    memory.is_derived = lambda *args: True
    holder = SimpleNamespace(_memory_storage=memory, _disk_storage=disk)
    sim = SimpleNamespace(
        tax_benefit_system=SimpleNamespace(variables={"purchase_tax": None}),
        get_holder=lambda name: holder,
    )
    found = limits._stored_inputs(sim, {"purchase_tax"})
    assert set(found) == {("purchase_tax", "default", "1900")}
    assert np.array_equal(next(iter(found.values()))[0], [1])
    memory.is_derived = lambda *args: False
    assert np.array_equal(
        limits._stored_inputs(sim, {"purchase_tax"})[
            ("purchase_tax", "default", "1900")
        ],
        [[0], [1]],
    )


def test_storage_location_alone_does_not_change_a_stored_input(
    monkeypatch, limits
):
    monkeypatch.setattr(
        limits, "limit_variables", lambda *args: frozenset({"purchase_tax"})
    )
    sims = []
    for memory_value, disk_value in ((0, None), (None, 0), (0, 0)):
        holder = SimpleNamespace(
            _memory_storage=(
                Holder(memory_value) if memory_value is not None else None
            ),
            _disk_storage=(
                Holder(disk_value) if disk_value is not None else None
            ),
        )
        sims.append(
            SimpleNamespace(
                tax_benefit_system=SimpleNamespace(
                    variables={"purchase_tax": None}
                ),
                get_holder=lambda name, holder=holder: holder,
            )
        )
    for other in sims[1:]:
        assert (
            limits._inputs_changed(sims[0], other, non_residential(limits))
            == []
        )


def test_stored_input_differences_reach_the_limit_record(monkeypatch, limits):
    limit = non_residential(limits)
    monkeypatch.setattr(limits, "DATA_LIMITS", (limit,))
    monkeypatch.setattr(
        limits, "limit_variables", lambda *args: frozenset({"purchase_tax"})
    )
    monkeypatch.setattr(limits, "_structure", lambda *args: {})
    monkeypatch.setattr(limits, "_views", lambda *args: [None])
    sims = [
        SimpleNamespace(
            tax_benefit_system=SimpleNamespace(
                parameters=SimpleNamespace(children={}),
                variables={"purchase_tax": variable()},
            ),
            get_holder=lambda name, holder=Holder(value): holder,
        )
        for value in (0, 1)
    ]
    observation = SimpleNamespace(
        sims=sims,
        finished=True,
        drifted={},
        changes=SimpleNamespace(behaviour=limits._Behaviour(), sides={}),
    )
    assert limits.limits_touched(*sims, observation=observation) == [
        limits.record(limit, ["input:purchase_tax"])
    ]


def test_input_records_accept_only_variables_of_their_limit(
    monkeypatch, limits
):
    limit = non_residential(limits)
    monkeypatch.setattr(limits, "DATA_LIMITS", (limit,))
    monkeypatch.setattr(
        limits, "limit_variables", lambda *args: frozenset({"purchase_tax"})
    )
    assert (
        limits.record_problems([limits.record(limit, ["input:purchase_tax"])])
        == []
    )
    assert limits.record_problems(
        [limits.record(limit, ["input:employment_income"])]
    )


def test_reader_names_are_derived_from_formula_input_and_parameter_reads(
    monkeypatch, limits
):
    def by_input(household, period, parameters):
        return household("non_residential_property_purchased", period)

    def by_parameters(household, period, parameters):
        return parameters(period).gov.hmrc.stamp_duty.non_residential.purchase

    model = SimpleNamespace(
        variables={
            "new_reader": variable(formulas={"2000": by_input}),
            "parameter_reader": variable(formulas={"2000": by_parameters}),
            "unrelated": variable(),
        }
    )
    monkeypatch.setitem(
        sys.modules, "policyengine_uk.system", SimpleNamespace(system=model)
    )
    assert limits.limit_variables(non_residential(limits)) == frozenset(
        {
            "non_residential_property_purchased",
            "new_reader",
            "parameter_reader",
        }
    )
