"""Metadata, abolition and stored inputs cannot hide a limited measure."""

from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_core.parameters import ParameterNode
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import Variable
from policyengine_uk.system import system

from tests import template_measures
from tests.test_data_limits import BY_KEY, simulation
from uk_budget_data import data_limits
from uk_budget_data.reforms import get_all_reforms

NONRES = "sdlt_on_non_residential_property_transactions"
RESIDENTIAL = "sdlt_on_residential_property_transactions"


def test_calculation_attributes_match_the_core_audit():
    """The fingerprint's coverage must not shrink with its parametrisation."""
    assert set(data_limits._VARIABLE_CALCULATION_ATTRIBUTES) == {
        "name",
        "entity",
        "is_neutralized",
        "requires_computation_after",
        "definition_period",
        "quantity_type",
        "defined_for",
        "uprating",
        "_uprating",
        "calculate_output",
        "default_value",
        "value_type",
        "possible_values",
        "dtype",
        "adds",
        "subtracts",
        "end",
        "get_formula",
        "default_array",
        "check_defined_for_variable",
        "check_uprating_value_type",
        "exhaustive_parameter_dependencies",
        "baseline_variable",
        "_explicit_attribute_names",
        "set_input",
    }


@pytest.mark.parametrize(
    "attribute", data_limits._VARIABLE_CALCULATION_ATTRIBUTES
)
def test_every_calculation_attribute_is_fingerprinted(attribute):
    """Even a method override must differ without touching formulas."""
    original = system.variables[NONRES]
    changed = original.clone()
    setattr(
        changed,
        "_uprating" if attribute == "uprating" else attribute,
        object(),
    )
    behaviour = data_limits._Behaviour()
    assert behaviour.of(original) != behaviour.of(changed)


def change_metadata(sim, name, attribute, value, update):
    if update:
        changed = type(name, (Variable,), {attribute: value})

        class Change(CoreReform):
            def apply(self):
                self.update_variable(changed)

        sim.apply_reform(Change)
    else:
        setattr(sim.tax_benefit_system.get_variable(name), attribute, value)
        sim.apply_reform(())
    return sim


@pytest.mark.parametrize(
    "name, attribute, value, update, limit",
    [
        (NONRES, "end", "2026-12-31", True, "non_residential_purchases"),
        (
            NONRES,
            "defined_for",
            "is_shared_accommodation",
            True,
            "non_residential_purchases",
        ),
        (
            NONRES,
            "defined_for",
            "is_shared_accommodation",
            False,
            "non_residential_purchases",
        ),
        (
            RESIDENTIAL,
            "defined_for",
            "is_shared_accommodation",
            True,
            "additional_dwelling_purchases",
        ),
        (NONRES, "value_type", bool, True, "non_residential_purchases"),
        (
            NONRES,
            "dtype",
            np.dtype("int32"),
            False,
            "non_residential_purchases",
        ),
    ],
)
def test_metadata_changes_on_limited_formulas_record_the_limit(
    name, attribute, value, update, limit
):
    changed = simulation(
        modifier=lambda sim: change_metadata(
            sim, name, attribute, value, update
        )
    )
    records = data_limits.limits_touched(simulation(), changed)
    assert [record["key"] for record in records] == [limit]
    assert f"formula:{name}" in records[0]["parameters"]


def test_a_template_cannot_hide_an_ended_limited_formula():
    def modifier(sim):
        template_measures.property_modifier(sim)
        return change_metadata(sim, NONRES, "end", "2026-12-31", True)

    records = data_limits.limits_touched(
        simulation(), simulation(modifier=modifier)
    )
    assert [record["key"] for record in records] == [
        "non_residential_purchases"
    ]


def abolish(sim, name=NONRES, cached=False):
    node = ParameterNode(
        "gov.abolitions", data={name: {"values": {"2000-01-01": True}}}
    )
    sim.tax_benefit_system.parameters.gov.add_child("abolitions", node)
    sim.tax_benefit_system.reset_parameter_caches()
    if cached:
        node.children[name].update(period="2027", value=False)
        for year in data_limits.VIEW_YEARS:
            view = sim.tax_benefit_system.parameters(f"{year}-01-01")
            view.gov.abolitions.add_child(name, True)
            assert view.gov.abolitions[name] is True
    return sim


@pytest.mark.parametrize("side, cached", [(0, False), (1, False), (1, True)])
def test_an_abolition_parameter_marks_its_variable_changed(side, cached):
    sims = [simulation(), simulation()]
    sims[side] = simulation(modifier=lambda sim: abolish(sim, cached=cached))
    records = data_limits.limits_touched(*sims)
    assert [record["key"] for record in records] == [
        "non_residential_purchases"
    ]
    assert f"formula:{NONRES}" in records[0]["parameters"]


def test_matching_or_unrelated_abolitions_stay_computable():
    assert (
        data_limits.limits_touched(
            simulation(modifier=abolish), simulation(modifier=abolish)
        )
        == []
    )
    assert (
        data_limits.limits_touched(
            simulation(),
            simulation(modifier=lambda sim: abolish(sim, "income_tax")),
        )
        == []
    )


@pytest.mark.parametrize(
    "variable, limit, mixed",
    [
        (NONRES, "non_residential_purchases", False),
        (NONRES, "non_residential_purchases", True),
        (
            "lbtt_on_non_residential_property_transactions",
            "non_residential_purchases",
            False,
        ),
        (
            "non_residential_property_purchased",
            "non_residential_purchases",
            False,
        ),
        (
            "additional_residential_property_purchased",
            "additional_dwelling_purchases",
            False,
        ),
    ],
)
def test_one_sided_zero_inputs_record_their_own_limit(variable, limit, mixed):
    def modifier(sim):
        if mixed:
            template_measures.property_modifier(sim)
        for year in data_limits.HOUSEHOLD_YEARS:
            sim.set_input(variable, year, np.zeros(1))
        return sim

    records = data_limits.limits_touched(
        simulation(), simulation(modifier=modifier)
    )
    assert [record["key"] for record in records] == [limit]
    assert f"input:{variable}" in records[0]["parameters"]
    assert data_limits.record_problems(records) == []


def test_covered_variables_are_derived_from_formulas_and_each_limit():
    extra = system.clone()

    class new_purchase_tax(Variable):
        label = "New purchase tax"
        value_type = float
        entity = system.variables[NONRES].entity
        definition_period = system.variables[NONRES].definition_period

        def formula(household, period, parameters):
            return household("non_residential_property_purchased", period)

    extra.add_variable(new_purchase_tax)
    limit = BY_KEY["non_residential_purchases"]
    assert "new_purchase_tax" in data_limits.limit_variables(limit, (extra,))
    assert NONRES in data_limits.limit_variables(limit)
    assert RESIDENTIAL not in data_limits.limit_variables(limit)


class StoredHolder:
    def __init__(self, values):
        self.values = values
        self._memory_storage = self
        self._disk_storage = None

    def get_known_branch_periods(self):
        return list(self.values)

    def is_derived(self, period, branch):
        return False

    def get(self, period, branch):
        return self.values.get((branch, period))


def stored_simulation(values):
    return SimpleNamespace(
        tax_benefit_system=system,
        branch_name="default",
        get_holder=lambda name: StoredHolder(values.get(name, {})),
    )


@given(
    period=st.integers(min_value=1900, max_value=2100),
    left=st.lists(st.integers(-1000, 1000), min_size=1, max_size=4),
    right=st.lists(st.integers(-1000, 1000), min_size=1, max_size=4),
)
@settings(max_examples=30, deadline=None)
def test_every_stored_period_and_value_is_compared(period, left, right):
    limit = BY_KEY["non_residential_purchases"]

    def values(array):
        return {NONRES: {("default", str(period)): np.array(array)}}

    changed = data_limits._inputs_changed(
        stored_simulation(values(left)),
        stored_simulation(values(right)),
        limit,
    )
    assert changed == ([] if left == right else [f"input:{NONRES}"])


def test_input_presence_periods_branches_and_values_all_count():
    limit = BY_KEY["non_residential_purchases"]
    base = {NONRES: {("default", "1900"): np.zeros(1)}}
    for changed in (
        {},
        {NONRES: {("default", "1901"): np.zeros(1)}},
        {
            NONRES: {
                ("default", "1900"): np.zeros(1),
                ("other", "1900"): np.ones(1),
            }
        },
        {NONRES: {("default", "1900"): np.ones(1)}},
    ):
        assert data_limits._inputs_changed(
            stored_simulation(base), stored_simulation(changed), limit
        ) == [f"input:{NONRES}"]


def test_other_branch_values_count_with_matching_default_inputs():
    limit = BY_KEY["non_residential_purchases"]
    sides = [
        {
            NONRES: {
                ("default", "1900"): np.zeros(1),
                ("other", "1900"): np.array([value]),
            }
        }
        for value in (1, 2)
    ]
    assert data_limits._inputs_changed(
        stored_simulation(sides[0]), stored_simulation(sides[1]), limit
    ) == [f"input:{NONRES}"]


def test_computed_values_do_not_become_stored_input_differences():
    baseline, reform = simulation(), simulation()
    baseline.calculate(NONRES, 2027)
    assert (
        data_limits._inputs_changed(
            baseline, reform, BY_KEY["non_residential_purchases"]
        )
        == []
    )


@pytest.mark.parametrize(
    "limit", data_limits.DATA_LIMITS, ids=lambda limit: limit.key
)
def test_input_paths_belong_only_to_their_own_limit(limit):
    for name in data_limits.limit_variables(limit):
        assert (
            data_limits.record_problems(
                [data_limits.record(limit, [f"input:{name}"])]
            )
            == []
        )
    other = next(item for item in data_limits.DATA_LIMITS if item != limit)
    # A real variable no limit reads. (Not employment income: from the
    # a133 cut it adds salary sacrifice returned to income, so it is one of
    # that limit's own.)
    for name in (
        other.missing_input,
        "age",
        "",
        "not_a_variable",
    ):
        assert name not in data_limits.limit_variables(limit)
        assert data_limits.record_problems(
            [data_limits.record(limit, [f"input:{name}"])]
        )


@pytest.mark.parametrize(
    "name",
    [
        "vat_modifier",
        "payment_modifier",
        "allowance_modifier",
        "property_modifier",
    ],
)
def test_every_template_stays_computable_without_purchase_inputs(name):
    assert (
        data_limits.limits_touched(
            simulation(), simulation(modifier=getattr(template_measures, name))
        )
        == []
    )


@pytest.mark.parametrize(
    "reform", get_all_reforms(), ids=lambda reform: reform.id
)
def test_registered_measures_do_not_set_limited_inputs(reform):
    sides = (
        simulation(
            changes=reform.baseline_parameter_changes,
            modifier=reform.baseline_simulation_modifier,
        ),
        simulation(
            changes=reform.parameter_changes,
            modifier=reform.simulation_modifier,
        ),
    )
    for built in sides:
        for limit in data_limits.DATA_LIMITS:
            assert (
                data_limits._stored_inputs(
                    built, data_limits.limit_variables(limit)
                )
                == {}
            )
    assert data_limits.limits_touched(*sides) == []
