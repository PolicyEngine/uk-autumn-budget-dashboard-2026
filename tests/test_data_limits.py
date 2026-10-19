"""Measures the certified data cannot cost: the registry and detection.

pe-uk #2241 makes additional-dwelling and non-residential purchase prices
inputs, nil unless a dataset imputes them, and the certified dataset has
neither column. A measure on those rates scores £0 (before #2241, it charges
a buyer's whole stock), so it must be published as not computable.
"""

import ast
import collections
import contextlib
import copy
import enum
import functools
import inspect
import operator
import re
import sys
import types
import warnings
from collections.abc import Mapping

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from tests import purchase_helpers, template_measures
from tests.fixed_shape_measures import raise_additional_dwelling_rates
from uk_budget_data import data_limits
from uk_budget_data.data_limits import (
    DATA_LIMITS,
    limits_for_paths,
    limits_for_scenarios,
    limits_touched,
    record,
    record_problems,
)
from uk_budget_data.measure_templates import (
    DataLimitedWarning,
    _call_formula,
    _replace_formula,
    apply_property_band_surcharge,
    rate_change,
    threshold_change,
)

SURCHARGE = "gov.hmrc.stamp_duty.residential.purchase.additional"
SURCHARGE_RATE = f"{SURCHARGE}.rate[1].rate"
NON_RESIDENTIAL = "gov.hmrc.stamp_duty.non_residential.purchase"
INCOME_TAX = "gov.hmrc.income_tax.rates.uk[0].rate"
BY_KEY = {limit.key: limit for limit in DATA_LIMITS}


def household(year=2027):
    return {
        "people": {"p": {"age": {year: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def simulation(changes=None, modifier=None):
    scenario = None
    if changes or modifier:
        scenario = Scenario(
            parameter_changes=changes, simulation_modifier=modifier
        )
    return Simulation(situation=household(), scenario=scenario)


# --- the registry --------------------------------------------------------


def test_every_registered_parameter_exists_in_the_installed_engine():
    """A renamed parameter would silently stop being covered."""
    from policyengine_uk.system import system

    for limit in DATA_LIMITS:
        for prefix in limit.parameters:
            system.parameters.get_child(prefix)


def test_every_input_a_limit_names_is_one_the_engine_has():
    from policyengine_uk.system import system

    for limit in DATA_LIMITS:
        assert limit.missing_input in system.variables


def test_the_formulas_the_registry_reasons_from_still_read_its_inputs():
    """Each limit covers the rates of the transaction-tax formulas that read
    its missing input (policyengine-uk 2.130.1). If a formula stops reading
    it, the registry's reasoning needs revisiting."""

    from policyengine_uk.system import system

    readers = {
        "additional_dwelling_purchases": (
            "sdlt_on_residential_property_transactions",
            "lbtt_on_residential_property_transactions",
            "ltt_on_residential_property_transactions",
        ),
        "non_residential_purchases": (
            "sdlt_on_non_residential_property_transactions",
            "lbtt_on_non_residential_property_transactions",
            "ltt_on_non_residential_property_transactions",
        ),
    }
    for key, variables in readers.items():
        limit = BY_KEY[key]
        for name in variables:
            source = inspect.getsource(type(system.variables[name]))
            # A call reading the input, not a mention in a comment.
            pattern = r'household\(\s*"' + limit.missing_input + '"'
            assert re.search(pattern, source), name


@pytest.mark.parametrize(
    "path, keys",
    [
        (SURCHARGE, ["additional_dwelling_purchases"]),
        (SURCHARGE_RATE, ["additional_dwelling_purchases"]),
        (f"{SURCHARGE}.min", ["additional_dwelling_purchases"]),
        (
            "gov.revenue_scotland.lbtt.residential."
            "additional_residence_surcharge",
            ["additional_dwelling_purchases"],
        ),
        (
            "gov.wra.land_transaction_tax.residential.higher_rate[2].rate",
            ["additional_dwelling_purchases"],
        ),
        (f"{NON_RESIDENTIAL}[1].rate", ["non_residential_purchases"]),
        (
            "gov.wra.land_transaction_tax.non_residential[0].rate",
            ["non_residential_purchases"],
        ),
        # Main-home rates price computable purchases too.
        (
            "gov.hmrc.stamp_duty.residential.purchase.main.subsequent[1].rate",
            [],
        ),
        ("gov.revenue_scotland.lbtt.residential.rate[1].rate", []),
        # A sibling whose name merely starts with a limited path.
        (f"{SURCHARGE}_x", []),
        (INCOME_TAX, []),
    ],
)
def test_paths_fall_under_exactly_their_limits(path, keys):
    assert [limit.key for limit in limits_for_paths([path])] == keys


# --- detection from scenarios ---------------------------------------------


def test_a_reform_changing_a_limited_rate_touches_its_limit():
    found = limits_for_scenarios(
        None, Scenario(parameter_changes={SURCHARGE_RATE: {"2027": 0.07}})
    )
    assert found == [
        record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE_RATE])
    ]


def test_a_baseline_only_change_touches_its_limit_too():
    """The measure's figure is reform minus baseline either way."""
    found = limits_for_scenarios(
        Scenario(parameter_changes={SURCHARGE_RATE: {"2027": 0.03}}), None
    )
    assert [item["key"] for item in found] == ["additional_dwelling_purchases"]


def test_the_same_change_on_both_sides_touches_nothing():
    same = {SURCHARGE_RATE: {"2027": 0.07}, INCOME_TAX: {"2027": 0.21}}
    assert (
        limits_for_scenarios(
            Scenario(parameter_changes=same),
            Scenario(parameter_changes={**same, INCOME_TAX: {"2027": 0.22}}),
        )
        == []
    )


def test_an_unrelated_measure_touches_nothing():
    assert (
        limits_for_scenarios(
            None, Scenario(parameter_changes={INCOME_TAX: {"2027": 0.22}})
        )
        == []
    )


# --- detection from built simulations -------------------------------------


def test_built_parameter_trees_show_a_parameter_change():
    touched = limits_touched(
        simulation(), simulation({SURCHARGE_RATE: {"2027": 0.07}})
    )
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]
    assert touched[0]["parameters"] == [SURCHARGE_RATE]


def test_built_parameter_trees_show_a_modifier():
    """A modifier is invisible in the scenario's changes; the built trees
    show it."""
    reformed = simulation(modifier=raise_additional_dwelling_rates)
    scenario = Scenario(simulation_modifier=raise_additional_dwelling_rates)
    assert limits_for_scenarios(None, scenario) == []
    touched = limits_touched(simulation(), reformed)
    assert touched == [
        record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE_RATE])
    ]


def test_built_parameter_trees_show_a_baseline_side_change():
    touched = limits_touched(
        simulation({f"{NON_RESIDENTIAL}[1].rate": {"2027": 0.03}}),
        simulation(),
    )
    assert [item["key"] for item in touched] == ["non_residential_purchases"]


def limited_scale(sim):
    return sim.tax_benefit_system.parameters.get_child(f"{SURCHARGE}.rate")


def test_built_parameter_trees_show_swapped_brackets_that_keep_their_names():
    """Review of #51: comparing leaves by the names they carry missed a
    modifier that swaps two brackets' rate objects."""
    reformed = simulation()
    first, second = limited_scale(reformed).brackets[:2]
    a, b = first.children["rate"], second.children["rate"]
    first.children["rate"], second.children["rate"] = b, a
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]
    assert f"{SURCHARGE}.rate[0].rate" in touched[0]["parameters"]


def fresh_views(sim):
    """Drop the system's cached views, as a modifier that runs before any
    calculation leaves them, so they are rebuilt from the changed tree."""
    sim.tax_benefit_system._parameters_at_instant_cache.clear()
    return sim


def test_built_parameter_trees_show_a_retyped_scale():
    reformed = simulation()
    limited_scale(reformed).metadata["type"] = "single_amount"
    touched = limits_touched(simulation(), fresh_views(reformed))
    assert touched[0]["parameters"] == [SURCHARGE]


def test_a_change_to_the_cached_views_alone_shows():
    """Review of #51 round 2: a modifier can change what formulas read by
    editing the system's cached view, leaving the stored tree untouched."""
    reformed = simulation()
    view = reformed.tax_benefit_system.parameters("2027-01-01")
    view.gov.hmrc.stamp_duty.residential.purchase.additional.rate.rates[1] = (
        0.07
    )
    touched = limits_touched(simulation(), reformed)
    assert touched == [
        record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE])
    ]


def test_a_parameter_that_changes_between_its_breakpoints_shows():
    """Review of #51 round 2: a Parameter subclass whose value differs
    between the stored breakpoints; formulas read it at each year's start."""
    from policyengine_core.parameters import Parameter

    class BetweenBreakpoints(Parameter):
        def _get_at_instant(self, instant):
            if "2027-01-01" <= str(instant) < "2028-01-01":
                return 0.07
            return super()._get_at_instant(instant)

    reformed = simulation()
    leaf = reformed.tax_benefit_system.parameters.get_child(SURCHARGE_RATE)
    leaf.__class__ = BetweenBreakpoints
    touched = limits_touched(simulation(), fresh_views(reformed))
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_detection_fills_no_cache_that_formulas_read():
    """Review of #51 round 3: building views for 2015-2040 before any
    calculation filled the caches formulas read. Detection now leaves them
    as it found them, and the figures as they would have been."""
    baseline = simulation()
    reformed = simulation({SURCHARGE_RATE: {"2027": 0.07}})
    systems = [baseline.tax_benefit_system, reformed.tax_benefit_system]
    before = [
        (
            set(system._parameters_at_instant_cache),
            set(system.parameters._at_instant_cache),
            set(system.parameters.get_child(SURCHARGE)._at_instant_cache),
        )
        for system in systems
    ]
    assert limits_touched(baseline, reformed)
    after = [
        (
            set(system._parameters_at_instant_cache),
            set(system.parameters._at_instant_cache),
            set(system.parameters.get_child(SURCHARGE)._at_instant_cache),
        )
        for system in systems
    ]
    assert after == before
    fresh = simulation({SURCHARGE_RATE: {"2027": 0.07}})
    assert reformed.calculate("household_net_income", 2027).tolist() == (
        fresh.calculate("household_net_income", 2027).tolist()
    )


def every_view(sim):
    return [
        sim.tax_benefit_system.parameters(f"{year}-01-01")
        for year in range(2015, 2041)
    ]


def test_a_reassigned_child_of_a_cached_view_shows():
    """Review of #51 round 3: formulas reach children by attribute; the
    check read the view's _children."""
    reformed = simulation()
    for view in every_view(reformed):
        view.gov.hmrc.stamp_duty.residential.purchase.additional.min = 1e12
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_views_are_read_through_the_tree_formulas_call():
    """Review of #51 round 3: formulas call tax_benefit_system.parameters
    (its own cache); the check read the system's separate cache first."""
    reformed = simulation()
    system = reformed.tax_benefit_system
    for year in range(2015, 2041):
        system.get_parameters_at_instant(f"{year}-01-01")
    system.parameters.get_child(SURCHARGE).clear_parent_cache()
    for view in every_view(reformed):
        view.gov.hmrc.stamp_duty.residential.purchase.additional.rate.rates[
            1
        ] = 0.07
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_a_scale_whose_calc_is_replaced_on_the_instance_shows():
    """Review of #51 round 3: formulas call .calc, and an instance
    attribute overrides the class's."""
    reformed = simulation()
    for view in every_view(reformed):
        scale = view.gov.hmrc.stamp_duty.residential.purchase.additional.rate
        scale.calc = lambda base, *args, **kwargs: base * 0.1
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_a_same_named_scale_subclass_shows():
    reformed = simulation()
    for view in every_view(reformed):
        node = view.gov.hmrc.stamp_duty.residential.purchase.additional
        original = type(node.rate)
        node.rate.__class__ = type(original.__name__, (original,), {})
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_a_replaced_formula_reading_the_missing_input_shows():
    """Review of #51 round 4: a structural measure that reads
    additional-dwelling purchases directly, through a formula helper, was
    invisible to a check of parameters alone."""
    from uk_budget_data.measure_templates import _replace_formula

    def surcharge(household, period, parameters):
        return household("additional_residential_property_purchased", period)

    reformed = simulation()
    _replace_formula(
        reformed, "sdlt_on_non_residential_property_transactions", surcharge
    )
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases",
        "non_residential_purchases",
    ]
    assert touched[0]["parameters"] == [
        "formula:sdlt_on_non_residential_property_transactions"
    ]


def test_a_replaced_formula_unrelated_to_the_inputs_touches_nothing():
    from uk_budget_data.measure_templates import _replace_formula

    def flat(person, period, parameters):
        return person("employment_income", period) * 0

    reformed = simulation()
    _replace_formula(reformed, "income_tax", flat)
    assert limits_touched(simulation(), reformed) == []


def test_two_plain_systems_have_no_formula_differences():
    """Formulas are compiled afresh for each system, so they are compared by
    code, not identity."""
    changes = data_limits._Changes(
        simulation().tax_benefit_system,
        simulation().tax_benefit_system,
        data_limits._Behaviour(),
    )
    assert changes.sides == {}


# --- formulas by content (review of #51 round 5) ------------------------

RESIDENTIAL = "sdlt_on_residential_property_transactions"
NON_RESIDENTIAL_SDLT = "sdlt_on_non_residential_property_transactions"


def keys(touched):
    return [item["key"] for item in touched]


def surcharge_closing_over(rate):
    """A structural measure whose rate is a value its formula closes over."""

    def modifier(sim):
        def formula(household, period, parameters):
            purchased = household(
                "additional_residential_property_purchased", period
            )
            return purchased * rate

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def one_percent(household, period, parameters, rate=0.01):
    return (
        household("additional_residential_property_purchased", period) * rate
    )


def two_percent(household, period, parameters, rate=0.02):
    return (
        household("additional_residential_property_purchased", period) * rate
    )


def installing(formula, name=RESIDENTIAL):
    def modifier(sim):
        _replace_formula(sim, name, formula)
        return sim

    return modifier


def test_a_rate_a_formula_closes_over_shows():
    """Review of #51 round 5: the same code closing over 1% and 2% compared
    equal, and SDLT doubled with no limit recorded."""
    touched = limits_touched(
        simulation(modifier=surcharge_closing_over(0.01)),
        simulation(modifier=surcharge_closing_over(0.02)),
    )
    assert keys(touched) == ["additional_dwelling_purchases"]
    assert touched[0]["parameters"] == [f"formula:{RESIDENTIAL}"]


def test_the_same_closed_over_rate_on_both_sides_touches_nothing():
    """Each side's formula is its own object; the same rate is no change."""
    assert (
        limits_touched(
            simulation(modifier=surcharge_closing_over(0.01)),
            simulation(modifier=surcharge_closing_over(0.01)),
        )
        == []
    )


def test_a_rate_held_as_a_default_argument_shows():
    """Review of #51 round 5: one code, defaults of 1% and 2%."""
    touched = limits_touched(
        simulation(modifier=installing(one_percent)),
        simulation(modifier=installing(two_percent)),
    )
    assert keys(touched) == ["additional_dwelling_purchases"]


def neutralise_non_residential(sim):
    sim.tax_benefit_system.neutralize_variable(NON_RESIDENTIAL_SDLT)
    return sim


def test_a_neutralised_limited_variable_shows():
    """Review of #51 round 5: neutralising keeps a variable's formulas and
    only sets is_neutralized, which was not compared."""
    touched = limits_touched(
        simulation(), simulation(modifier=neutralise_non_residential)
    )
    assert keys(touched) == ["non_residential_purchases"]
    assert touched[0]["parameters"] == [f"formula:{NON_RESIDENTIAL_SDLT}"]


def band_on_sdlt(amount):
    def modifier(sim):
        return apply_property_band_surcharge(
            sim,
            channel=RESIDENTIAL,
            geography="UK",
            lower_bound=100_000,
            upper_bound=1_000_000,
            amount=amount,
            start_year=2027,
            end_year=2027,
        )

    return modifier


@pytest.mark.parametrize(
    "baseline, reform",
    [
        (None, band_on_sdlt(1000)),
        (band_on_sdlt(500), band_on_sdlt(1000)),
        (band_on_sdlt(1000), None),
    ],
    ids=["reform-only", "both-sides", "baseline-only"],
)
def test_a_template_adding_to_a_limited_formula_is_computable(
    baseline, reform
):
    """Review of #51 round 5: a property band charged through SDLT adds an
    amount from data the survey holds to SDLT's own result, wrapped
    unchanged; it was marked not computable."""
    assert (
        limits_touched(
            simulation(modifier=baseline), simulation(modifier=reform)
        )
        == []
    )


def wrapping_sdlt(extra):
    """A template-shaped wrapper: SDLT's own result, plus ``extra``."""

    def modifier(sim):
        native = sim.tax_benefit_system.get_variable(RESIDENTIAL)

        def formula(household, period, parameters):
            current = _call_formula(native, household, period, parameters)
            return current + extra(household, period, parameters)

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def from_second_homes(household, period, parameters):
    return 0.01 * household(
        "additional_residential_property_purchased", period
    )


def through_the_higher_rates(household, period, parameters):
    rates = parameters(period).gov.hmrc.stamp_duty.residential.purchase
    return rates.additional.rate.calc(
        household("main_residence_value", period)
    )


def from_main_homes(household, period, parameters):
    return 0.01 * household("main_residence_value", period)


@pytest.mark.parametrize(
    "extra, expected",
    [
        (from_second_homes, ["additional_dwelling_purchases"]),
        (through_the_higher_rates, ["additional_dwelling_purchases"]),
        (from_main_homes, []),
    ],
    ids=["missing-input", "limited-parameters", "computable"],
)
def test_what_a_wrapper_adds_decides(extra, expected):
    """What a wrapper adds counts like any formula: reading the missing
    input, or the limit's parameters by attribute, touches the limit."""
    reformed = simulation(modifier=wrapping_sdlt(extra))
    assert keys(limits_touched(simulation(), reformed)) == expected


def second_homes(household, period):
    return household("additional_residential_property_purchased", period)


def once(household, period, parameters):
    return second_homes(household, period) * 0.01


def twice(household, period, parameters):
    return second_homes(household, period) * 0.02


def test_a_helper_both_sides_call_still_counts():
    """A helper that reads the missing input is part of the pricing, though
    both sides call it unchanged; only whole variables are left out."""
    touched = limits_touched(
        simulation(modifier=installing(once)),
        simulation(modifier=installing(twice)),
    )
    assert keys(touched) == ["additional_dwelling_purchases"]


def test_a_disguised_scale_subclass_shows():
    """Review of #51 round 5: a subclass given the original's module and
    name, overriding calc, compared as the original."""
    reformed = simulation()
    for view in every_view(reformed):
        node = view.gov.hmrc.stamp_duty.residential.purchase.additional
        original = type(node.rate)
        node.rate.__class__ = type(
            original.__name__,
            (original,),
            {
                "__module__": original.__module__,
                "__qualname__": original.__qualname__,
                "calc": lambda self, base, *args, **kwargs: base * 0.1,
            },
        )
    assert keys(limits_touched(simulation(), reformed)) == [
        "additional_dwelling_purchases"
    ]


def closing_over_its_simulation(sim):
    def formula(person, period, parameters):
        assert sim is not None
        return person("employment_income", period) * 0

    _replace_formula(sim, "income_tax", formula)
    return sim


def test_a_formula_closing_over_its_own_simulation_is_read_by_name():
    """Each side's formula holds its own simulation; that is no change, and
    its data are not fingerprinted."""
    assert (
        limits_touched(
            simulation(modifier=closing_over_its_simulation),
            simulation(modifier=closing_over_its_simulation),
        )
        == []
    )


def test_partial_formulas_compare_by_their_arguments():
    behaviour = data_limits._Behaviour()
    assert behaviour.of(functools.partial(one_percent, rate=0.01)) == (
        behaviour.of(functools.partial(one_percent, rate=0.01))
    )
    assert behaviour.of(functools.partial(one_percent, rate=0.01)) != (
        behaviour.of(functools.partial(one_percent, rate=0.02))
    )


VALUES = st.recursive(
    st.none()
    | st.booleans()
    | st.integers(-(10**6), 10**6)
    | st.floats(allow_nan=True)
    | st.text(max_size=4),
    lambda children: st.lists(children, max_size=3)
    | st.dictionaries(st.text(max_size=3), children, max_size=3),
    max_leaves=10,
)


def closing_over(value):
    def formula(household, period, parameters):
        return value

    return formula


@settings(max_examples=200, deadline=None)
@given(VALUES)
def test_a_value_matches_its_copy(value):
    behaviour = data_limits._Behaviour()
    assert behaviour.of(value) == behaviour.of(copy.deepcopy(value))


@settings(max_examples=200, deadline=None)
@given(VALUES, VALUES)
def test_a_closure_matches_exactly_when_its_value_does(a, b):
    behaviour = data_limits._Behaviour()
    same = behaviour.of(a) == behaviour.of(b)
    assert (
        behaviour.of(closing_over(a)) == behaviour.of(closing_over(b))
    ) == same


@given(st.integers(-(2**52), 2**52))
def test_equal_numbers_match_and_different_ones_do_not(number):
    behaviour = data_limits._Behaviour()
    assert behaviour.of(number) == behaviour.of(float(number))
    assert behaviour.of(number) != behaviour.of(number + 1)
    assert behaviour.of(float("nan")) == behaviour.of(float("nan"))


# --- state and results (review of #51 round 6) -------------------------


def pricing_by_class_rate(rate):
    """A rate held as class data, read by the class's method."""

    def modifier(sim):
        class Pricer:
            coefficient = rate

            def __call__(self, household, period, parameters):
                purchased = household(
                    "additional_residential_property_purchased", period
                )
                return purchased * self.coefficient

        pricer = Pricer()

        def formula(household, period, parameters):
            return pricer(household, period, parameters)

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def pricing_by_slotted_rate(rate):
    """A rate held on an object with slots and no ``__dict__``."""

    def modifier(sim):
        class Rate:
            __slots__ = ("coefficient",)

            def __init__(self, coefficient):
                self.coefficient = coefficient

        config = Rate(rate)

        def formula(household, period, parameters):
            purchased = household(
                "additional_residential_property_purchased", period
            )
            return purchased * config.coefficient

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def pricing_by_first_rate(rates):
    """Charges a mapping's first rate: its order is behaviour."""

    def modifier(sim):
        bands = dict(rates)

        def formula(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * next(iter(bands.values()))

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def pricing_by_default_rate(rate):
    def modifier(sim):
        rates = collections.defaultdict(lambda: rate)

        def formula(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * rates["standard"]

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize(
    "baseline, reform, key",
    [
        (
            pricing_by_class_rate(0.01),
            pricing_by_class_rate(0.02),
            "additional_dwelling_purchases",
        ),
        (
            pricing_by_slotted_rate(0.01),
            pricing_by_slotted_rate(0.02),
            "additional_dwelling_purchases",
        ),
        (
            pricing_by_first_rate([("standard", 0.01), ("higher", 0.02)]),
            pricing_by_first_rate([("higher", 0.02), ("standard", 0.01)]),
            "non_residential_purchases",
        ),
        (
            pricing_by_default_rate(0.01),
            pricing_by_default_rate(0.02),
            "non_residential_purchases",
        ),
    ],
    ids=["class-data", "slots", "mapping-order", "defaultdict-factory"],
)
def test_state_a_formula_holds_is_compared(baseline, reform, key):
    """Review of #51 round 6: a rate held as class data, on a slotted
    object, as a mapping's order or as a defaultdict's factory compared
    equal at 1% and 2%."""
    touched = limits_touched(
        simulation(modifier=baseline), simulation(modifier=reform)
    )
    assert keys(touched) == [key]


def half_the_purchase(sim):
    native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)

    def formula(household, period, parameters):
        def taxable(name, period):
            return household(name, period) * 0.5

        return _call_formula(native, taxable, period, parameters)

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


def rebinding_the_household(sim):
    native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)

    def formula(household, period, parameters):
        actual = household
        household = lambda name, period: actual(name, period) * 0.5  # noqa
        return _call_formula(native, household, period, parameters)

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


def holding_without_calling(sim):
    native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)

    def formula(household, period, parameters):
        assert native is not None
        return household.filled_array(0.0)

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


def halving_its_result(sim):
    native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)

    def formula(household, period, parameters):
        return 0.5 * _call_formula(native, household, period, parameters)

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


@pytest.mark.parametrize(
    "reform, expected",
    [
        (half_the_purchase, ["non_residential_purchases"]),
        (rebinding_the_household, ["non_residential_purchases"]),
        (holding_without_calling, ["non_residential_purchases"]),
        (halving_its_result, []),
    ],
    ids=[
        "changed-purchase-base",
        "rebound-entity",
        "held-never-called",
        "own-result-halved",
    ],
)
def test_a_wrapper_is_left_out_only_where_it_uses_the_result(reform, expected):
    """Review of #51 round 6: holding the original is not using its result.
    A wrapper that prices a changed purchase base, or never calls the
    original, reprices; one that halves the original's own result is
    downstream of the pricing, as abolishing SDLT is."""
    reformed = simulation(modifier=reform)
    assert keys(limits_touched(simulation(), reformed)) == expected


def stacked_bands(sim):
    band_on_sdlt(1000)(sim)
    band_on_sdlt(500)(sim)
    return sim


@pytest.mark.parametrize(
    "baseline", [None, band_on_sdlt(300)], ids=["reform-only", "both-sides"]
)
def test_stacked_templates_stay_computable(baseline):
    """Combined measures stack templates on one channel: the intermediate
    variable is followed, and the original at the bottom is left out."""
    assert (
        limits_touched(
            simulation(modifier=baseline), simulation(modifier=stacked_bands)
        )
        == []
    )


def calling_its_own_pricing(sim):
    """Calls, for its own result, a variable the modifier made, whose
    formula prices second homes."""
    from policyengine_uk.model_api import Variable

    native = sim.tax_benefit_system.get_variable(RESIDENTIAL)

    def pricing(household, period, parameters):
        purchased = household(
            "additional_residential_property_purchased", period
        )
        return 0.02 * purchased

    made = type(
        RESIDENTIAL,
        (Variable,),
        {
            "formula": pricing,
            "entity": native.entity,
            "definition_period": "year",
            "value_type": float,
            "label": "made by the modifier",
        },
    )(baseline_variable=native)

    def formula(household, period, parameters):
        return _call_formula(made, household, period, parameters)

    _replace_formula(sim, RESIDENTIAL, formula)
    return sim


def no_residential_sdlt(sim):
    def formula(household, period, parameters):
        return household.filled_array(0.0)

    _replace_formula(sim, RESIDENTIAL, formula)
    return sim


def test_a_variable_the_modifier_made_is_followed():
    """Only an unchanged result is left out: a variable no system has and
    the other side doesn't use is code like any other. (The baseline here
    reads nothing, so only the made variable can name the input.)"""
    touched = limits_touched(
        simulation(modifier=no_residential_sdlt),
        simulation(modifier=calling_its_own_pricing),
    )
    assert keys(touched) == ["additional_dwelling_purchases"]


def pricing_helper_times(factor):
    def modifier(sim):
        def second_homes_charge(household, period, parameters):
            return household(
                "additional_residential_property_purchased", period
            )

        def formula(household, period, parameters):
            return second_homes_charge(household, period, parameters) * factor

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def test_a_helper_called_with_the_formulas_own_arguments_still_counts():
    """The direct-call form is left out only for a variable's formula: a
    pricing helper both sides call alike is still pricing."""
    touched = limits_touched(
        simulation(modifier=pricing_helper_times(1)),
        simulation(modifier=pricing_helper_times(2)),
    )
    assert keys(touched) == ["additional_dwelling_purchases"]


@settings(max_examples=100, deadline=None)
@given(
    st.lists(
        st.tuples(st.text(max_size=3), st.integers()),
        min_size=2,
        max_size=5,
        unique_by=lambda pair: pair[0],
    )
)
def test_a_mapping_matches_only_in_the_same_order(pairs):
    behaviour = data_limits._Behaviour()
    assert behaviour.of(dict(pairs)) == behaviour.of(dict(pairs))
    assert behaviour.of(dict(pairs)) != behaviour.of(dict(pairs[::-1]))


# --- call forms and stdlib state (review of #51 round 7) ---------------

call_alias = _call_formula


def private_slot_rate(rate):
    """A rate on a private slot, which Python stores under a mangled name."""

    def modifier(sim):
        class Rate:
            __slots__ = ("__rate",)

            def __init__(self, rate):
                self.__rate = rate

            def get_rate(self):
                return self.__rate

        config = Rate(rate)

        def formula(household, period, parameters):
            purchased = household(
                "additional_residential_property_purchased", period
            )
            return purchased * config.get_rate()

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def picked_rate(index):
    """A rate an ``operator.itemgetter`` picks."""

    def modifier(sim):
        pick = operator.itemgetter(index)
        rates = (0.01, 0.02)

        def formula(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * pick(rates)

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def priced_by_a_mapping_method(rate):
    """A dict subclass whose method reads the missing input."""

    def modifier(sim):
        class Rates(dict):
            def price(self, household, period):
                purchased = household(
                    "non_residential_property_purchased", period
                )
                return purchased * self["rate"]

        rates = Rates(rate=rate)

        def formula(household, period, parameters):
            return rates.price(household, period)

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize(
    "baseline, reform, key",
    [
        (
            private_slot_rate(0.01),
            private_slot_rate(0.02),
            "additional_dwelling_purchases",
        ),
        (picked_rate(0), picked_rate(1), "non_residential_purchases"),
        (
            priced_by_a_mapping_method(0.01),
            priced_by_a_mapping_method(0.02),
            "non_residential_purchases",
        ),
    ],
    ids=["private-slot", "itemgetter", "mapping-method"],
)
def test_more_state_a_formula_holds_is_compared(baseline, reform, key):
    """Review of #51 round 7: a private slot, an itemgetter's key and a
    mapping subclass's method compared equal, or went unread."""
    touched = limits_touched(
        simulation(modifier=baseline), simulation(modifier=reform)
    )
    assert keys(touched) == [key]


def own_result_by(make):
    def modifier(sim):
        native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)
        _replace_formula(sim, NON_RESIDENTIAL_SDLT, make(native))
        return sim

    return modifier


def by_keyword(native):
    def formula(household, period, parameters):
        result = _call_formula(
            native, household, period, parameters=parameters
        )
        return result + 1000

    return formula


def by_keywords_only(native):
    def formula(household, period, parameters):
        result = _call_formula(
            variable=native,
            entity=household,
            period=period,
            parameters=parameters,
        )
        return result + 1000

    return formula


def by_star(native):
    def formula(*args):
        return _call_formula(native, *args) + 1000

    return formula


def by_star_of_a_tuple(native):
    def formula(household, period, parameters):
        args = (household, period, parameters)
        return _call_formula(native, *args) + 1000

    return formula


def by_double_star(native):
    def formula(household, period, parameters):
        given = {"entity": household, "period": period}
        return _call_formula(native, **given, parameters=parameters) + 1000

    return formula


def by_local_alias(native):
    def formula(household, period, parameters):
        call = _call_formula
        return call(native, household, period, parameters) + 1000

    return formula


def by_module_alias(native):
    def formula(household, period, parameters):
        return call_alias(native, household, period, parameters) + 1000

    return formula


def by_entity_alias(native):
    def formula(household, period, parameters):
        entity = household
        return _call_formula(native, entity, period, parameters) + 1000

    return formula


def by_identity(native):
    def formula(household, period, parameters):
        household = household  # noqa: PLW0127 - rebinds nothing
        return _call_formula(native, household, period, parameters) + 1000

    return formula


def by_the_formula_with_keywords(native):
    original = list(native.formulas.values())[-1]

    def formula(household, period, parameters):
        return original(household, period=period, parameters=parameters) + 1000

    return formula


def by_the_formula_with_star(native):
    original = list(native.formulas.values())[-1]

    def formula(*args):
        return original(*args) + 1000

    return formula


@pytest.mark.parametrize(
    "make",
    [
        by_keyword,
        by_keywords_only,
        by_star,
        by_star_of_a_tuple,
        by_double_star,
        by_local_alias,
        by_module_alias,
        by_entity_alias,
        by_identity,
        by_the_formula_with_keywords,
        by_the_formula_with_star,
    ],
)
def test_the_own_result_in_any_call_form_is_computable(make):
    """Review of #51 round 7: keyword, ``*``, ``**`` and alias calls of the
    original's own result were marked limited."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def result_discarded(native):
    def formula(household, period, parameters):
        _call_formula(native, household, period, parameters)
        return household.filled_array(0.0)

    return formula


def default_rebound(native):
    from policyengine_uk.model_api import Variable

    def nothing(household, period, parameters):
        return household.filled_array(0.0)

    zero = type(
        NON_RESIDENTIAL_SDLT,
        (Variable,),
        {
            "formula": nothing,
            "entity": native.entity,
            "definition_period": "year",
            "value_type": float,
            "label": "zero",
        },
    )(baseline_variable=native)

    def formula(household, period, parameters, held=native):
        # Not a plain alias: rebound only when the branch runs (always).
        if period is not None:
            held = zero
        return _call_formula(held, household, period, parameters)

    return formula


def another_period(native):
    def formula(household, period, parameters):
        return _call_formula(native, household, period.last_year, parameters)

    return formula


@pytest.mark.parametrize(
    "make", [result_discarded, default_rebound, another_period]
)
def test_a_result_discarded_or_rebound_or_for_another_period_counts(make):
    """Review of #51 round 7: a call whose result is discarded, or a held
    default rebound before the call, was taken as using the result."""
    reformed = simulation(modifier=own_result_by(make))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def test_parameter_names_and_sequence_kinds_are_compared():
    """Review of #51 round 7: ``(base, rate)`` against ``(rate, base)`` with
    the same instructions, and a list against a tuple, compared equal."""
    behaviour = data_limits._Behaviour()

    def divide(base, rate):
        return base / rate

    def divide_other_way(rate, base):
        return rate / base

    assert behaviour.of(divide) != behaviour.of(divide_other_way)
    assert behaviour.of([1]) != behaviour.of((1,))


# --- hidden state, mutated arguments, scopes (review of #51 round 8) ---


def inherited_private_slot_rate(rate):
    """A base class's private slot, beside a subclass's of the same name."""

    def modifier(sim):
        class Base:
            __slots__ = ("__rate",)

            def __init__(self, rate):
                self.__rate = rate

            def get_rate(self):
                return self.__rate

        class Derived(Base):
            __slots__ = ("__rate",)

            def __init__(self, rate):
                super().__init__(rate)
                self.__rate = 0.99

        config = Derived(rate)

        def formula(household, period, parameters):
            purchased = household(
                "additional_residential_property_purchased", period
            )
            return purchased * config.get_rate()

        _replace_formula(sim, RESIDENTIAL, formula)
        return sim

    return modifier


def non_residential_times(make_rate):
    """Non-residential purchases times a rate, read from what ``make_rate``
    builds."""

    def modifier(sim):
        get_rate = make_rate()

        def formula(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * get_rate()

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def cached_rate(rate):
    def make():
        @functools.cache
        def get_rate():
            return rate

        return get_rate

    return make


def masked_rate(mask):
    def make():
        rates = np.ma.array([0.01], mask=[mask])
        return lambda: rates.filled(0.02)[0]

    return make


def array_subclass_rate(scale):
    def make():
        class Rates(np.ndarray):
            def get_rate(self):
                return self.scale * self[0]

        rates = np.array([0.01]).view(Rates)
        rates.scale = scale
        return rates.get_rate

    return make


def memory_rate(digit):
    def make():
        rates = memoryview(bytes([digit]))
        return lambda: rates[0] / 100

    return make


def positional_only(a=0.01, /, **kw):
    return a + kw.get("a", 0)


def keyword_capable(a=0.01, **kw):
    return a + kw.get("a", 0)


def by_signature(function):
    def make():
        return lambda: function(a=0.01)

    return make


@pytest.mark.parametrize(
    "baseline, reform, expected",
    [
        (
            inherited_private_slot_rate(0.01),
            inherited_private_slot_rate(0.02),
            ["additional_dwelling_purchases"],
        ),
        (
            non_residential_times(cached_rate(0.01)),
            non_residential_times(cached_rate(0.02)),
            ["non_residential_purchases"],
        ),
        (
            non_residential_times(masked_rate(False)),
            non_residential_times(masked_rate(True)),
            ["non_residential_purchases"],
        ),
        (
            non_residential_times(array_subclass_rate(1)),
            non_residential_times(array_subclass_rate(2)),
            ["non_residential_purchases"],
        ),
        (
            non_residential_times(by_signature(positional_only)),
            non_residential_times(by_signature(keyword_capable)),
            ["non_residential_purchases"],
        ),
        # State that can't be read is opaque: it compares unequal, so the
        # formula counts as changed and what it reads is watched.
        (
            non_residential_times(memory_rate(1)),
            non_residential_times(memory_rate(2)),
            ["non_residential_purchases"],
        ),
    ],
    ids=[
        "inherited-private-slot",
        "functools-cache",
        "masked-array",
        "array-subclass",
        "positional-only",
        "memoryview-opaque",
    ],
)
def test_hidden_state_is_compared_or_treated_as_opaque(
    baseline, reform, expected
):
    """Review of #51 round 8: an inherited private slot, a cached getter's
    closure, a masked or subclassed array's state and a positional-only
    signature compared equal; a memoryview could not be read at all."""
    touched = limits_touched(
        simulation(modifier=baseline), simulation(modifier=reform)
    )
    assert keys(touched) == expected


def kwargs_replaced(native):
    def formula(household, period, parameters):
        given = {
            "entity": household,
            "period": period,
            "parameters": parameters,
        }
        given["entity"] = lambda name, period: household(name, period) * 0.5
        return _call_formula(native, **given)

    return formula


def kwargs_updated(native):
    def formula(household, period, parameters):
        given = {
            "entity": household,
            "period": period,
            "parameters": parameters,
        }
        given.update(entity=lambda name, period: household(name, period) * 0.5)
        return _call_formula(native, **given)

    return formula


def kwargs_mutated_through_another_name(native):
    def formula(household, period, parameters):
        given = {
            "entity": household,
            "period": period,
            "parameters": parameters,
        }
        other = given
        other["entity"] = lambda name, period: household(name, period) * 0.5
        return _call_formula(native, **given)

    return formula


def args_replaced(native):
    def formula(household, period, parameters):
        args = [household, period, parameters]
        args[0] = lambda name, period: household(name, period) * 0.5
        return _call_formula(native, *args)

    return formula


def result_assigned_unread(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)  # noqa
        return household.filled_array(0.0)

    return formula


def result_overwritten(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        result = household.filled_array(0.0)
        return result

    return formula


def result_deleted(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        del result
        return household.filled_array(0.0)

    return formula


@pytest.mark.parametrize(
    "make",
    [
        kwargs_replaced,
        kwargs_updated,
        kwargs_mutated_through_another_name,
        args_replaced,
        result_assigned_unread,
        result_overwritten,
        result_deleted,
    ],
)
def test_mutated_arguments_and_unread_results_count(make):
    """Review of #51 round 8: a ``**`` mapping changed after it was built
    (by subscript, update() or another name) reprices; so does a result
    assigned and never read, overwritten or deleted."""
    reformed = simulation(modifier=own_result_by(make))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def nested_helper_shadowing(native):
    def formula(household, period, parameters):
        def helper(household):
            return household.filled_array(1000.0)

        own = _call_formula(native, household, period, parameters)
        return own + helper(household)

    return formula


def unpacked_aliases(native):
    def formula(household, period, parameters):
        entity, instant, policy = household, period, parameters
        return _call_formula(native, entity, instant, policy) + 1000

    return formula


def result_assigned_and_read(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        return result + 1000

    return formula


@pytest.mark.parametrize(
    "make",
    [nested_helper_shadowing, unpacked_aliases, result_assigned_and_read],
)
def test_more_own_result_forms_are_computable(make):
    """Review of #51 round 8: a nested helper's parameter named like the
    formula's, or aliases by unpacking, were taken as rebinding."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def test_unreadable_state_is_unequal():
    behaviour = data_limits._Behaviour()
    one, same = memoryview(b"\x01"), memoryview(b"\x01")
    assert behaviour.of(one) != behaviour.of(same)


def test_an_unobservable_variable_reads_anything():
    assert all(
        data_limits._reads(limit, {data_limits.ANY_NAME})
        for limit in DATA_LIMITS
    )


# --- library state, decorators, accumulation (review of #51 round 9) ---


def queued_rate(rate):
    def make():
        rates = collections.deque([rate])
        return lambda: rates[0]

    return make


def series_rate(rate):
    def make():
        import pandas as pd

        rates = pd.Series([0.01, rate], index=[2026, 2027])
        return lambda: rates[2027]

    return make


def structured_rate(swap_fields):
    def make():
        names = ["other", "rate"] if swap_fields else ["rate", "other"]
        rates = np.array(
            [(0.01, 0.02)], dtype=[(names[0], "f8"), (names[1], "f8")]
        )
        return lambda: rates["rate"][0]

    return make


def nested_rate(rate):
    def make():
        class Section:
            pass

        config = Section()
        config.policy = Section()
        config.policy.purchase = Section()
        config.policy.purchase.sdlt = Section()
        config.policy.purchase.sdlt.nonres = Section()
        config.policy.purchase.sdlt.nonres.rate = rate
        return lambda: config.policy.purchase.sdlt.nonres.rate

    return make


def scalar_subclass_rate(rate):
    def make():
        class Rate(float):
            pass

        value = Rate(0.5)
        value.nonres_rate = rate
        return lambda: value.nonres_rate

    return make


def context_manager_rate(rate):
    def make():
        @contextlib.contextmanager
        def rated():
            yield rate

        def get_rate():
            with rated() as found:
                return found

        return get_rate

    return make


def single_dispatch_rate(rate):
    def make():
        @functools.singledispatch
        def get_rate(x):
            return rate

        return lambda: get_rate(0)

    return make


@pytest.mark.parametrize(
    "make",
    [
        queued_rate,
        series_rate,
        structured_rate,
        nested_rate,
        scalar_subclass_rate,
        context_manager_rate,
        single_dispatch_rate,
    ],
)
def test_library_state_and_decorated_helpers_are_compared(make):
    """Review of #51 round 9: a deque's items, a pandas series, a structured
    array's field names, nested configuration, a float subclass's field and
    a stdlib decorator's wrapped function compared equal at 1% and 2%."""
    if make is structured_rate:
        baseline, reform = make(False), make(True)
    else:
        baseline, reform = make(0.01), make(0.02)
    touched = limits_touched(
        simulation(modifier=non_residential_times(baseline)),
        simulation(modifier=non_residential_times(reform)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def income_tax_by_vectorize(sim):
    def scalar(income):
        return income * 0.01

    pricer = np.vectorize(scalar)

    def formula(person, period, parameters):
        return pricer(person("employment_income", period))

    _replace_formula(sim, "income_tax", formula)
    return sim


def test_a_vectorized_pricer_is_read_through_what_it_wraps():
    """Review of #51 round 9: an np.vectorize income tax was opaque, and so
    marked against every limit."""
    reformed = simulation(modifier=income_tax_by_vectorize)
    assert limits_touched(simulation(), reformed) == []


def accumulated(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        result += 1000
        return result

    return formula


def reassigned_from_itself(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        result = result + 1000
        return result

    return formula


@pytest.mark.parametrize("make", [accumulated, reassigned_from_itself])
def test_a_result_built_on_is_used(make):
    """Review of #51 round 9: ``result += 1000`` was taken as overwriting
    the result."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def tucked_in_a_tuple(native):
    def formula(household, period, parameters):
        kept = (_call_formula(native, household, period, parameters),)  # noqa
        return household.filled_array(0.0)

    return formula


def period_captured_by_match(native):
    def formula(household, period, parameters):
        match period.last_year:
            case period:
                pass
        return _call_formula(native, household, period, parameters)

    return formula


@pytest.mark.parametrize("make", [tucked_in_a_tuple, period_captured_by_match])
def test_a_tucked_result_or_a_match_capture_counts(make):
    """Review of #51 round 9: a result tucked into a tuple, or a period
    rebound by a match capture, slipped past."""
    reformed = simulation(modifier=own_result_by(make))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def test_locals_and_keyword_only_counts_are_compared():
    behaviour = data_limits._Behaviour()

    def one(a):
        rate = 0.01
        return locals().get("rate", 0) + a

    def other(a):
        else_ = 0.01
        return locals().get("rate", 0) + a

    def positional(a, b):
        return a + b

    def keyword_only(a, *, b):
        return a + b

    assert behaviour.of(one) != behaviour.of(other)
    assert behaviour.of(positional) != behaviour.of(keyword_only)


# --- composed names, bound methods, more state (review of #51 round 10) -


def levy_on_a_composed_name(compose):
    def make(native):
        def formula(household, period, parameters):
            extra = household(compose(), period) * 0.01
            return _call_formula(native, household, period, parameters) + extra

        return formula

    return make


def by_fstring():
    kind = "non_residential"
    return f"{kind}_property_purchased"


def by_join():
    separator = "_"
    return separator.join(["non", "residential", "property", "purchased"])


def by_a_loop_over_kinds():
    for kind in ["non_residential"]:
        return f"{kind}_property_purchased"


@pytest.mark.parametrize(
    "compose, expected",
    [
        (by_fstring, ["non_residential_purchases"]),
        (by_join, ["non_residential_purchases"]),
        (by_a_loop_over_kinds, ["non_residential_purchases"]),
    ],
    ids=["fstring", "join", "built-in-a-loop"],
)
def test_a_composed_input_name_is_read(compose, expected):
    """Review of #51 round 10: an input name built at run time hid the
    read. Reads are watched as the formula runs, so the name read is the
    one it built, however it built it (round 13)."""
    reformed = simulation(
        modifier=own_result_by(levy_on_a_composed_name(compose))
    )
    assert keys(limits_touched(simulation(), reformed)) == expected


def bound_get_rate(key):
    def make():
        rates = {"a": 0.01, "b": 0.02}
        get = rates.get
        return lambda: get(key)

    return make


def str_subclass_rate(rate):
    def make():
        class Config(str):
            pass

        config = Config("rates")
        config.rate = rate
        return lambda: config.rate

    return make


def function_attribute_rate(rate):
    def make():
        def get_rate():
            return get_rate.rate

        get_rate.rate = rate
        return get_rate

    return make


def enum_member_rate(rate):
    def make():
        class Band(enum.Enum):
            STANDARD = 1

            def __init__(self, value):
                self.rate = rate

        member = Band.STANDARD
        return lambda: member.rate

    return make


@pytest.mark.parametrize(
    "make",
    [
        bound_get_rate,
        str_subclass_rate,
        function_attribute_rate,
        enum_member_rate,
    ],
)
def test_bound_methods_and_attribute_state_are_compared(make):
    """Review of #51 round 10: a bound dict.get, a str subclass's field, a
    function's attribute and an enum member's field compared equal."""
    if make is bound_get_rate:
        baseline, reform = make("a"), make("b")
    else:
        baseline, reform = make(0.01), make(0.02)
    touched = limits_touched(
        simulation(modifier=non_residential_times(baseline)),
        simulation(modifier=non_residential_times(reform)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def test_the_same_bound_method_on_both_sides_is_no_change():
    """A bound dict.get is read through its mapping, so the same getter on
    both sides is unchanged, where an unreadable one would mark a limit."""
    assert (
        limits_touched(
            simulation(modifier=non_residential_times(bound_get_rate("a"))),
            simulation(modifier=non_residential_times(bound_get_rate("a"))),
        )
        == []
    )


def forward(variable, entity, period, parameters):
    return _call_formula(variable, entity, period, parameters)


def by_named_dict_kwargs(native):
    def formula(household, period, parameters):
        kwargs = dict(entity=household, period=period, parameters=parameters)
        return _call_formula(native, **kwargs) + 1000

    return formula


def by_a_forwarding_helper(native):
    def formula(household, period, parameters):
        return forward(native, household, period, parameters) + 1000

    return formula


def by_a_listed_star(native):
    def formula(household, period, parameters):
        args = [household, period, parameters]
        return _call_formula(native, *args) + 1000

    return formula


@pytest.mark.parametrize(
    "make", [by_named_dict_kwargs, by_a_forwarding_helper, by_a_listed_star]
)
def test_named_kwargs_forwarders_and_lists_are_computable(make):
    """Review of #51 round 10: a named dict(...), a module helper that only
    forwards to _call_formula, and a list of the arguments were limited."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


# --- names, helpers, templates (review of #51 round 11) ----------------


def levy_by_named_concatenation(native):
    def formula(household, period, parameters):
        prefix = "non_residential"
        suffix = "_property_purchased"
        name = prefix + suffix
        own = _call_formula(native, household, period, parameters)
        return own + household(name, period) * 0.01

    return formula


def levy_by_named_percent(native):
    def formula(household, period, parameters):
        pattern = "%s_property_purchased"
        kind = "non_residential"
        name = pattern % kind
        own = _call_formula(native, household, period, parameters)
        return own + household(name, period) * 0.01

    return formula


def levy_by_a_format_callback(native):
    def formula(household, period, parameters):
        fmt = "{}_property_purchased".format
        own = _call_formula(native, household, period, parameters)
        return own + household(fmt("non_residential"), period) * 0.01

    return formula


def levy_by_an_imported_helper(native):
    def formula(household, period, parameters):
        own = _call_formula(native, household, period, parameters)
        return own + purchase_helpers.surcharge(household, period, 0.01)

    return formula


@pytest.mark.parametrize(
    "make",
    [
        levy_by_named_concatenation,
        levy_by_named_percent,
        levy_by_a_format_callback,
        levy_by_an_imported_helper,
    ],
)
def test_names_built_from_named_parts_and_imported_helpers_are_read(make):
    """Review of #51 round 11: a name built from named strings by + or %
    or a bound format, and a levy in an imported helper module, recorded
    no limit."""
    reformed = simulation(modifier=own_result_by(make))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def by_list_unpacking(native):
    def formula(household, period, parameters):
        entity, instant, policy = [household, period, parameters]
        return _call_formula(native, entity, instant, policy) + 1000

    return formula


def by_an_annotated_alias(native):
    def formula(household, period, parameters):
        entity: object = household
        return _call_formula(native, entity, period, parameters) + 1000

    return formula


def by_a_chained_alias(native):
    def formula(household, period, parameters):
        entity = alias = household  # noqa: F841
        return _call_formula(native, alias, period, parameters) + 1000

    return formula


@pytest.mark.parametrize(
    "make", [by_list_unpacking, by_an_annotated_alias, by_a_chained_alias]
)
def test_list_annotated_and_chained_aliases_are_computable(make):
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def income_tax_with_a_message(sim):
    def formula(person, period, parameters):
        income = person("employment_income", period)
        if (income < 0).any():
            raise ValueError(f"negative income in {period}")
        return income * 0.01

    _replace_formula(sim, "income_tax", formula)
    return sim


def income_tax_by_a_composed_name(sim):
    base = "employment"

    def formula(person, period, parameters):
        return person(f"{base}_income", period) * 0.01

    _replace_formula(sim, "income_tax", formula)
    return sim


@pytest.mark.parametrize(
    "modifier", [income_tax_with_a_message, income_tax_by_a_composed_name]
)
def test_messages_and_known_composed_names_stay_computable(modifier):
    """Review of #51 round 11: an f-string in an error message, or a name
    composed from known parts (employment_income), marked every limit."""
    reformed = simulation(modifier=modifier)
    assert limits_touched(simulation(), reformed) == []


TEMPLATE_MODIFIERS = [
    "vat_modifier",
    "payment_modifier",
    "allowance_modifier",
    "property_modifier",
]


@pytest.mark.parametrize("name", TEMPLATE_MODIFIERS)
def test_every_repository_template_measure_is_computable(name):
    """The templates are the way Budget-day measures are written: none may
    be marked not computable (review of #51 round 11: the VAT template
    was, through a helper's error message)."""
    reformed = simulation(modifier=getattr(template_measures, name))
    assert limits_touched(simulation(), reformed) == []


# The coordinator's ruling on #51 (19 Oct, under d1625) puts three
# constructions outside the line for hand-written modifiers only: building
# or holding a simulation or system other than the one given, or anything
# of one; changing state formulas hold while the simulations run; and a
# metaclass. Templates stay inside the line, so the two tests below keep
# them free of all three: a template that used one would need the watch
# to cover it in full.
TEMPLATE_MUTATORS = {
    "add",
    "append",
    "clear",
    "discard",
    "extend",
    "insert",
    "pop",
    "popitem",
    "remove",
    "setdefault",
    "update",
}
ENGINE_BUILDERS = {
    "CoreReform",
    "CountryTaxBenefitSystem",
    "Microsimulation",
    "Reform",
    "Simulation",
    "TaxBenefitSystem",
}


def _bound_names(function) -> set:
    names = {a.arg for a in ast.walk(function.args) if isinstance(a, ast.arg)}
    for node in ast.walk(function):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
    return names


def test_the_templates_use_no_construction_ruled_outside_the_line():
    from uk_budget_data import measure_templates

    tree = ast.parse(inspect.getsource(measure_templates))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            found.append((node.lineno, "global or nonlocal state"))
        elif isinstance(node, ast.ClassDef) and any(
            keyword.arg == "metaclass" for keyword in node.keywords
        ):
            found.append((node.lineno, "a metaclass"))
        elif isinstance(node, ast.Attribute) and node.attr in (
            "clone",
            "get_branch",
        ):
            found.append((node.lineno, f"another simulation ({node.attr})"))
        elif isinstance(node, ast.Call):
            called = node.func
            name = getattr(called, "id", getattr(called, "attr", None))
            if name in ENGINE_BUILDERS:
                found.append((node.lineno, f"another system ({name})"))
    # A formula is a function defined inside a template function: it may
    # store to no attribute or item, and change nothing it doesn't bind.
    for template in tree.body:
        if not isinstance(template, ast.FunctionDef):
            continue
        for formula in ast.walk(template):
            if formula is template or not isinstance(formula, ast.FunctionDef):
                continue
            bound = _bound_names(formula)
            for node in ast.walk(formula):
                targets = []
                if isinstance(node, (ast.Assign, ast.Delete)):
                    targets = node.targets
                elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
                    targets = [node.target]
                if any(
                    isinstance(t, (ast.Attribute, ast.Subscript))
                    for t in targets
                ):
                    found.append((node.lineno, "a formula storing state"))
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in TEMPLATE_MUTATORS
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id not in bound
                ):
                    found.append((node.lineno, "a formula changing state"))
    assert found == []


@pytest.mark.parametrize("name", TEMPLATE_MODIFIERS)
def test_template_measures_hold_and_build_no_other_engine_object(
    name, monkeypatch
):
    """Run: the template's own code builds no simulation or system, and
    its formulas hold none, nor any population, holder or stored
    parameter; every class they hold or make has a plain or library
    metaclass; and what they hold is the same after a watched run."""
    from policyengine_core.holders.holder import Holder
    from policyengine_core.parameters import (
        Parameter,
        ParameterNode,
        ParameterScale,
    )
    from policyengine_core.populations import GroupPopulation, Population
    from policyengine_core.simulations.simulation import (
        Simulation as CoreSimulation,
    )
    from policyengine_core.taxbenefitsystems import TaxBenefitSystem

    from uk_budget_data import measure_templates

    template_files = {
        inspect.getsourcefile(measure_templates),
        inspect.getsourcefile(template_measures),
    }
    built = []

    def recording(kind, method):
        original = kind.__dict__[method]

        def record(*args, **kwargs):
            caller = sys._getframe(1).f_code.co_filename
            if caller in template_files:
                built.append(f"{kind.__name__}.{method}")
            return original(*args, **kwargs)

        monkeypatch.setattr(kind, method, record)

    # Wherever a class defines them: policyengine-uk's Simulation has its
    # own __init__ and clone, and its system class its own __init__.
    system_class = type(simulation().tax_benefit_system)
    for root, methods in (
        (Simulation, ("__init__", "clone", "get_branch")),
        (system_class, ("__init__", "clone")),
    ):
        for kind in root.__mro__[:-1]:
            for method in methods:
                if method in kind.__dict__:
                    recording(kind, method)

    baseline = simulation()
    reformed = simulation(modifier=getattr(template_measures, name))
    changes = data_limits._Changes(
        baseline.tax_benefit_system,
        reformed.tax_benefit_system,
        data_limits._Behaviour(),
    )
    assert changes.sides
    engine_objects = (
        CoreSimulation,
        TaxBenefitSystem,
        Population,
        GroupPopulation,
        Holder,
        Parameter,
        ParameterNode,
        ParameterScale,
    )

    def held():
        values = []
        for variable_name in changes.sides:
            variable = reformed.tax_benefit_system.variables[variable_name]
            assert data_limits._library_class(type(type(variable))) or (
                type(type(variable)) is type
            )
            for formula in data_limits._formulas(variable):
                for cell in formula.__closure__ or ():
                    value = cell.cell_contents
                    values.append(value)
                    if isinstance(value, Mapping):
                        values.extend(value.values())
        return values

    before = held()
    for value in before:
        assert not isinstance(value, engine_objects), value
        if isinstance(value, type):
            assert type(value) is type or data_limits._library_class(
                type(value)
            ), value
    fingerprints = [data_limits._Behaviour().of(value) for value in before]
    with data_limits.observing(baseline, reformed) as observed:
        for sim in (baseline, reformed):
            for variable_name in changes.sides:
                for year in data_limits.HOUSEHOLD_YEARS:
                    sim.calculate(variable_name, year)
    assert observed.drifted == {}
    assert observed.unobservable == {}
    assert [data_limits._Behaviour().of(value) for value in held()] == (
        fingerprints
    )
    assert built == []


def numpy_subclass_rate(rate):
    def make():
        class Config(np.float64):
            pass

        config = Config(0.0)
        config.rate = rate
        return lambda: config.rate

    return make


def test_a_numpy_scalar_subclass_is_read_with_its_fields():
    touched = limits_touched(
        simulation(modifier=non_residential_times(numpy_subclass_rate(0.01))),
        simulation(modifier=non_residential_times(numpy_subclass_rate(0.02))),
    )
    assert keys(touched) == ["non_residential_purchases"]


def test_an_unchanged_threshold_set_as_a_float_is_not_a_change():
    """Review of #51 round 4: 40000.0 against the stored 40000 was a false
    positive."""
    changes = threshold_change(f"{SURCHARGE}.min", {2027: 40000})
    assert limits_touched(simulation(), simulation(changes)) == []


def test_different_methods_set_on_cached_views_show():
    """Review of #51 round 4: methods were compared by name alone."""
    baseline, reformed = simulation(), simulation()
    for sim, share in ((baseline, 0.1), (reformed, 0.2)):
        for view in every_view(sim):
            scale = (
                view.gov.hmrc.stamp_duty.residential.purchase.additional.rate
            )
            scale.calc = (
                lambda base, *args, share=share, **kwargs: base * share
            )
    touched = limits_touched(baseline, reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_a_view_reassigned_above_the_limit_shows():
    """Formulas reach the limit through the root's cached view: a child
    reassigned on an ancestor's view is what they read, though the limit's
    own node still caches the original."""
    reformed = simulation()
    for view in every_view(reformed):
        purchase = view.gov.hmrc.stamp_duty.residential.purchase
        purchase.additional = view.gov.hmrc.stamp_duty.non_residential.purchase
    touched = limits_touched(simulation(), reformed)
    assert [item["key"] for item in touched] == [
        "additional_dwelling_purchases"
    ]


def test_a_label_is_not_a_change():
    """Review of #51 round 2: a display label was a false positive."""
    reformed = simulation({INCOME_TAX: {"2027": 0.22}})
    limited_scale(reformed).metadata["label"] = "A clearer label"
    assert limits_touched(simulation(), fresh_views(reformed)) == []


def test_the_same_nan_on_both_sides_is_not_a_change():
    baseline = simulation({SURCHARGE_RATE: {"2027": float("nan")}})
    reformed = simulation({SURCHARGE_RATE: {"2027": float("nan")}})
    assert limits_touched(baseline, reformed) == []


def test_built_parameter_trees_show_an_added_parameter():
    reformed = simulation()
    node = reformed.tax_benefit_system.parameters.get_child(SURCHARGE)
    node.add_child("added", node.children["min"].clone())
    touched = limits_touched(simulation(), reformed)
    assert touched[0]["parameters"] == [f"{SURCHARGE}.added"]


def test_a_redundant_breakpoint_is_not_a_change():
    """A breakpoint that repeats the value already in force changes
    nothing: the trees are compared by effective value, not by their lists
    of breakpoints (which here differ)."""
    from policyengine_core.parameters import ParameterAtInstant

    reformed = simulation()
    minimum = reformed.tax_benefit_system.parameters.get_child(
        f"{SURCHARGE}.min"
    )
    before = [(v.instant_str, v.value) for v in minimum.values_list]
    minimum.values_list.insert(
        0,
        ParameterAtInstant(
            minimum.name, "2050-01-01", data=minimum("2050-01-01")
        ),
    )
    assert [(v.instant_str, v.value) for v in minimum.values_list] != before
    assert limits_touched(simulation(), reformed) == []


def test_built_parameter_trees_of_an_unrelated_measure_touch_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.22}}))
        == []
    )


# --- recorded limits -------------------------------------------------------


def test_recorded_limits_from_the_registry_pass():
    assert record_problems([]) == []
    assert (
        record_problems(
            [
                record(
                    BY_KEY["additional_dwelling_purchases"], [SURCHARGE_RATE]
                ),
                record(
                    BY_KEY["non_residential_purchases"],
                    [f"{NON_RESIDENTIAL}[1].rate"],
                ),
            ]
        )
        == []
    )


@pytest.mark.parametrize(
    "records, expected",
    [
        ("not a list", "must be a list"),
        (
            [
                record(
                    BY_KEY["additional_dwelling_purchases"],
                    [SURCHARGE, INCOME_TAX],
                )
            ],
            "paths under that limit",
        ),
        ([{"key": "nope", "reason": "", "parameters": []}], "known limits"),
        (
            [
                record(BY_KEY["non_residential_purchases"], [NON_RESIDENTIAL]),
                record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE]),
            ],
            "registry order",
        ),
        (
            [
                record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE]),
                record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE]),
            ],
            "once each",
        ),
        (
            [
                {
                    **record(
                        BY_KEY["additional_dwelling_purchases"], [SURCHARGE]
                    ),
                    "reason": "a reason of its own",
                }
            ],
            "not the registry's",
        ),
        (
            [record(BY_KEY["additional_dwelling_purchases"], [INCOME_TAX])],
            "paths under that limit",
        ),
        (
            [
                {
                    **record(
                        BY_KEY["additional_dwelling_purchases"], [SURCHARGE]
                    ),
                    "parameters": [],
                }
            ],
            "non-empty",
        ),
    ],
)
def test_recorded_limits_that_are_not_the_registrys_are_problems(
    records, expected
):
    assert any(expected in problem for problem in record_problems(records))


# --- the templates ---------------------------------------------------------


def test_a_template_on_a_limited_rate_warns_and_still_builds():
    with pytest.warns(DataLimitedWarning, match="not computable") as caught:
        built = rate_change(SURCHARGE_RATE, {2027: 0.07})
    assert built == {SURCHARGE_RATE: {"2027": 0.07}}
    # The warning points at the author's call, not inside the templates.
    assert caught[0].filename == __file__


def test_a_template_on_an_unrelated_rate_does_not_warn():
    with warnings.catch_warnings():
        warnings.simplefilter("error", DataLimitedWarning)
        rate_change(INCOME_TAX, {2027: 0.21})


# --- the certified data ----------------------------------------------------


@pytest.mark.certified_data
def test_the_certified_data_still_lack_every_limits_input():
    """Tripwire: when certified data carry an input a limit names (uk-data
    #573 imputes the purchases), this fails, and the limit is removed in the
    bundle-adoption PR that brings that data."""
    from uk_budget_data.pipeline import build_microsimulation

    sim = build_microsimulation(None)
    # Control: a column the data do carry has its periods set, so an empty
    # holder below means the data lack the input, not that nothing loaded.
    assert sim.get_holder(
        "other_residential_property_value"
    ).get_known_periods()
    for limit in data_limits.DATA_LIMITS:
        holder = sim.get_holder(limit.missing_input)
        assert holder.get_known_periods() == [], (
            f"the certified data now set {limit.missing_input}: lift "
            f"{limit.key}"
        )


# --- the flat pipeline ------------------------------------------------------


def test_the_flat_pipeline_warns_for_a_measure_the_data_cannot_cost(
    monkeypatch, capsys
):
    """The flat CSV path has no publication gate; it says loudly that the
    measure's rows are not costings, and stays quiet for the others."""
    from uk_budget_data import pipeline
    from uk_budget_data.models import DataConfig, Reform

    class Processor:
        def __init__(self, reform, config):
            pass

        def process(self, *args):
            return None

    monkeypatch.setattr(
        pipeline,
        "build_microsimulation",
        lambda dataset, scenario=None: Simulation(
            situation=household(), scenario=scenario
        ),
    )
    monkeypatch.setattr(pipeline, "ReformProcessor", Processor)
    monkeypatch.setattr(pipeline, "aggregate_results", lambda r, config: {})
    monkeypatch.setattr(pipeline.DataPipeline, "_save_all", lambda s, d: None)
    reforms = [
        Reform(
            id="surcharge",
            name="Surcharge",
            parameter_changes={SURCHARGE_RATE: {"2027": 0.07}},
        ),
        Reform(
            id="structural",
            name="Structural",
            simulation_modifier=raise_additional_dwelling_rates,
        ),
        Reform(
            id="income",
            name="Income",
            parameter_changes={INCOME_TAX: {"2027": 0.22}},
        ),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    assert out.count("NOT COMPUTABLE ON CURRENT DATA") == 2
    assert "Surcharge: The survey data" in out
    assert "Structural: The survey data" in out
    assert "Income: The survey data" not in out


# --- reads watched as the formulas run (review of #51 round 12) ---------

NAME_OF = "{}_property_purchased".format


def adding_a_levy(read):
    """The original non-residential SDLT plus 1% of what ``read`` reads."""

    def make(native):
        def formula(household, period, parameters):
            extra = read(household, period) * 0.01
            return _call_formula(native, household, period, parameters) + extra

        return formula

    return make


def read_by_str(household, period):
    return household(str("non_residential") + "_property_purchased", period)


def read_by_a_global_format(household, period):
    return household(NAME_OF("non_residential"), period)


def read_by_a_shadowed_loop_name(household, period):
    name = "main_residential_property_purchased"
    for name in ["non_residential_property_purchased"]:  # noqa: B007
        pass
    return household(name, period)


def read_by_a_local_import(household, period):
    from tests.purchase_helpers import surcharge

    return surcharge(household, period, 1)


def read_through_a_holder(household, period):
    kind = "non_residential"
    holder = household.get_holder(f"{kind}_property_purchased")
    values = holder.get_array(period)
    return 0 if values is None else values


@pytest.mark.parametrize(
    "read",
    [
        read_by_str,
        read_by_a_global_format,
        read_by_a_shadowed_loop_name,
        read_by_a_local_import,
        read_through_a_holder,
    ],
)
def test_a_read_however_named_or_reached_shows(read):
    """Review of #51 round 12: ``str()``, a global bound ``format``, a loop
    name shadowing an earlier one and a helper imported inside the formula
    hid a purchase read (SDLT £39,500 to £49,500 with no limit). Reads are
    watched now, so the input read is the one recorded."""
    reformed = simulation(modifier=own_result_by(adding_a_levy(read)))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def read_an_annotated_label(household, period):
    kind = "non_residential"
    label: str = f"{kind}_property_purchased"  # noqa: F841
    return household("main_residential_property_purchased", period)


def read_by_keyword_format(household, period):
    return household(
        "{kind}_property_purchased".format(kind="main_residential"), period
    )


def read_by_format_map(household, period):
    return household(
        "{kind}_property_purchased".format_map({"kind": "main_residential"}),
        period,
    )


def read_by_a_converted_fstring(household, period):
    kind = "main_residential"
    return household(f"{kind!s}_property_purchased", period)


@pytest.mark.parametrize(
    "read",
    [
        read_an_annotated_label,
        read_by_keyword_format,
        read_by_format_map,
        read_by_a_converted_fstring,
    ],
)
def test_a_name_built_for_a_costable_input_stays_computable(read):
    """Review of #51 round 12: an annotated label, keyword ``format``,
    ``format_map`` and an f-string's ``!s`` marked computable measures with
    both limits. The input read is a main residence's, which the data hold."""
    reformed = simulation(modifier=own_result_by(adding_a_levy(read)))
    assert limits_touched(simulation(), reformed) == []


def chained_assignment(native):
    def formula(household, period, parameters):
        first = second = _call_formula(native, household, period, parameters)
        return first + second * 0 + 1000

    return formula


def named_unpacking(native):
    def formula(household, period, parameters):
        given = {"entity": household, "period": period}
        result = _call_formula(native, **given, parameters=parameters)
        return result + 1000

    return formula


class _Wrapper:
    def __init__(self, native):
        self.native = native

    def __call__(self, household, period, parameters):
        return _call_formula(self.native, household, period, parameters)


def callable_wrapper(native):
    wrapper = _Wrapper(native)

    def formula(household, period, parameters):
        return wrapper(household, period, parameters) + 1000

    return formula


@pytest.mark.parametrize(
    "make", [chained_assignment, named_unpacking, callable_wrapper]
)
def test_the_own_result_however_reached_stays_computable(make):
    """Review of #51 round 12: a chained assignment, named argument
    unpacking and a callable wrapper made an own-result addition not
    computable. The call is recognised by its arguments as it starts."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def unused_by_multiplying(native):
    def formula(household, period, parameters):
        return _call_formula(native, household, period, parameters) * 0

    return formula


def another_variables_result(sim):
    residential = sim.tax_benefit_system.get_variable(RESIDENTIAL)

    def formula(household, period, parameters):
        result = _call_formula(residential, household, period, parameters)
        return result + 1000

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


def test_using_another_variables_result_does_not_wrap_this_one():
    """Only a call of the other side's own formula wraps it. A replacement
    built on residential SDLT's result (an unchanged variable's, whose
    reads are its own) leaves the original non-residential formula's reads
    as the change's: the difference is residential SDLT less the original."""
    reformed = simulation(modifier=another_variables_result)
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def test_a_result_multiplied_away_is_not_used():
    """Moving the purchases the original reads moves what it returns but not
    what the replacement returns, so the original's reads are the change's:
    a repeal through ``* 0`` is not computable on data with no purchases."""
    reformed = simulation(modifier=own_result_by(unused_by_multiplying))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def a_branch_never_run(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        if period.start.year > 2100:
            kind = "non_residential"
            result = result + household(f"{kind}_property_purchased", period)
        return result + 1000

    return formula


def test_a_name_built_in_code_that_never_runs_reads_nothing():
    """What decides the figures is what ran: a name built in a branch the
    years published never take is no read."""
    reformed = simulation(modifier=own_result_by(a_branch_never_run))
    assert limits_touched(simulation(), reformed) == []


def kind_rated(rate):
    """A member of an enum class a modifier makes afresh each time: the
    same name, value and qualified name, a different method."""

    class Kind(enum.Enum):
        NON_RESIDENTIAL = 1

        def rate(self):
            return rate

    return Kind.NON_RESIDENTIAL


def kind_scaled(scale):
    """The same, with class state instead of a method."""

    class Kind(enum.Enum):
        NON_RESIDENTIAL = 1
        scale = enum.nonmember(None)

        def rate(self):
            return 0.01 * type(self).scale

    Kind.scale = scale
    return Kind.NON_RESIDENTIAL


def rate_from_member(member):
    def make():
        return member.rate

    return make


@pytest.mark.parametrize(
    "baseline, reform",
    [
        (kind_rated(0.01), kind_rated(0.02)),
        (kind_scaled(1), kind_scaled(2)),
    ],
    ids=["method", "class-state"],
)
def test_an_enum_members_class_is_compared(baseline, reform):
    """Review of #51 round 12: two members alike in name, value and class
    name, whose classes' methods or state differ, compared equal (£1,000 to
    £2,000 with no limit)."""
    behaviour = data_limits._Behaviour()
    assert type(baseline).__qualname__ == type(reform).__qualname__
    assert behaviour.of(baseline) != behaviour.of(reform)
    assert behaviour.of(kind_rated(0.01)) == behaviour.of(kind_rated(0.01))
    touched = limits_touched(
        simulation(modifier=non_residential_times(rate_from_member(baseline))),
        simulation(modifier=non_residential_times(rate_from_member(reform))),
    )
    assert keys(touched) == ["non_residential_purchases"]


def test_a_library_enum_member_compares_by_name_and_value():
    behaviour = data_limits._Behaviour()
    assert behaviour.of(re.IGNORECASE) == behaviour.of(re.IGNORECASE)
    assert behaviour.of(re.IGNORECASE) != behaviour.of(re.MULTILINE)


# --- the watch itself ----------------------------------------------------


def engine_methods():
    """Every engine method a watch replaces, as its class holds it (None
    for one the class inherits)."""
    from policyengine_core.holders.holder import Holder
    from policyengine_core.parameters.at_instant_like import AtInstantLike
    from policyengine_core.parameters.parameter_node_at_instant import (
        ParameterNodeAtInstant,
    )
    from policyengine_core.populations.population import Population
    from policyengine_core.simulations.simulation import Simulation

    return tuple(
        kind.__dict__.get(name)
        for kind, name in (
            (Simulation, "calculate"),
            (Population, "get_holder"),
            (Holder, "get_array"),
            (AtInstantLike, "get_at_instant"),
            (AtInstantLike, "__getattribute__"),
            (ParameterNodeAtInstant, "__getattribute__"),
            (ParameterNodeAtInstant, "__getitem__"),
        )
    )


def test_the_watch_leaves_the_engine_as_it_found_it():
    before = engine_methods()
    tools = [sys.monitoring.get_tool(i) for i in range(6)]
    reformed = simulation(modifier=own_result_by(read_levy_of(read_by_str)))
    assert limits_touched(simulation(), reformed)
    assert engine_methods() == before
    assert [sys.monitoring.get_tool(i) for i in range(6)] == tools
    with pytest.raises(RuntimeError):
        with data_limits.observing(simulation(), reformed):
            during = engine_methods()
            assert all(now is not then for now, then in zip(during, before))
            raise RuntimeError
    assert engine_methods() == before
    assert [sys.monitoring.get_tool(i) for i in range(6)] == tools


def read_levy_of(read):
    return adding_a_levy(read)


def test_watching_the_run_records_what_it_ran():
    """The publication path keeps the watch over the run that makes the
    figures: what that run calculates decides, and a variable it never
    calculates reads nothing."""
    make = own_result_by(adding_a_levy(read_by_str))
    baseline, reformed = simulation(), simulation(modifier=make)
    with data_limits.observing(baseline, reformed) as observed:
        reformed.calculate(NON_RESIDENTIAL_SDLT, 2027)
        baseline.calculate(NON_RESIDENTIAL_SDLT, 2027)
    assert keys(limits_touched(baseline, reformed, observed)) == [
        "non_residential_purchases"
    ]
    baseline, reformed = simulation(), simulation(modifier=make)
    with data_limits.observing(baseline, reformed) as idle:
        pass
    assert limits_touched(baseline, reformed, idle) == []


def test_an_observation_is_for_its_own_finished_watch():
    baseline, reformed = simulation(), simulation()
    with data_limits.observing(baseline, reformed) as observed:
        with pytest.raises(ValueError, match="still watching"):
            limits_touched(baseline, reformed, observed)
    with pytest.raises(ValueError, match="other simulations"):
        limits_touched(simulation(), reformed, observed)


def test_a_value_calculated_before_the_watch_reads_anything():
    """A cached value is used without its formula running, so what that
    formula reads can't be watched: every limit."""
    reformed = simulation(
        modifier=own_result_by(adding_a_levy(read_an_annotated_label))
    )
    reformed.calculate(NON_RESIDENTIAL_SDLT, 2027)
    with pytest.warns(
        data_limits.UnwatchedFormulaWarning,
        match="calculated before it was watched",
    ):
        touched = limits_touched(simulation(), reformed)
    assert keys(touched) == [
        "additional_dwelling_purchases",
        "non_residential_purchases",
    ]


def test_an_input_set_before_the_watch_is_not_a_calculation():
    """A value set as an input is used and no formula runs for it, so it
    makes nothing unobservable. Set on both sides; on the reform alone,
    2027's difference would be the original's, which reads purchases."""
    baseline = simulation()
    reformed = simulation(
        modifier=own_result_by(adding_a_levy(read_an_annotated_label))
    )
    for sim in (baseline, reformed):
        sim.set_input(NON_RESIDENTIAL_SDLT, 2027, [0.0])
    assert limits_touched(baseline, reformed) == []
    reformed = simulation(
        modifier=own_result_by(adding_a_levy(read_an_annotated_label))
    )
    reformed.set_input(NON_RESIDENTIAL_SDLT, 2027, [0.0])
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def test_with_no_tool_id_free_every_changed_variable_reads_anything(
    monkeypatch,
):
    before = engine_methods()
    monkeypatch.setattr(data_limits, "_TOOL_IDS", ())
    reformed = simulation(modifier=template_measures.property_modifier)
    with pytest.warns(
        data_limits.UnwatchedFormulaWarning, match="no sys.monitoring tool"
    ):
        touched = limits_touched(simulation(), reformed)
    assert keys(touched) == [
        "additional_dwelling_purchases",
        "non_residential_purchases",
    ]
    assert engine_methods() == before


def test_the_run_watched_and_the_variables_calculated_here_agree():
    """Differential: watching a run that calculates each changed variable
    in the Budget's years, and calculating them here, record the same."""
    for make in (
        adding_a_levy(read_by_str),
        adding_a_levy(read_an_annotated_label),
        unused_by_multiplying,
        chained_assignment,
    ):
        here = limits_touched(
            simulation(), simulation(modifier=own_result_by(make))
        )
        baseline = simulation()
        reformed = simulation(modifier=own_result_by(make))
        with data_limits.observing(baseline, reformed) as observed:
            for year in data_limits.HOUSEHOLD_YEARS:
                for sim in (baseline, reformed):
                    sim.calculate(NON_RESIDENTIAL_SDLT, year)
        assert limits_touched(baseline, reformed, observed) == here, make


INPUTS = {
    "non_residential_property_purchased": ["non_residential_purchases"],
    "additional_residential_property_purchased": [
        "additional_dwelling_purchases"
    ],
    "main_residential_property_purchased": [],
    "council_tax": [],
}


def build_name(name, cuts, how):
    """``name`` cut at ``cuts`` and put back together ``how``."""
    bounds = [0, *sorted(set(cuts)), len(name)]
    parts = [name[a:b] for a, b in zip(bounds, bounds[1:]) if a < b]
    if how == "plus":
        built = ""
        for part in parts:
            built = built + part
        return built
    if how == "join":
        return "".join(parts)
    if how == "percent":
        return ("%s" * len(parts)) % tuple(parts)
    if how == "format":
        return ("{}" * len(parts)).format(*parts)
    if how == "format_map":
        keys_ = [f"k{i}" for i in range(len(parts))]
        template = "".join("{" + key + "}" for key in keys_)
        return template.format_map(dict(zip(keys_, parts)))
    return "".join(f"{part!s}" for part in map(str, parts))


@settings(max_examples=12, deadline=None)
@given(
    st.sampled_from(sorted(INPUTS)),
    st.lists(st.integers(min_value=1, max_value=30), max_size=4),
    st.sampled_from(
        ["plus", "join", "percent", "format", "format_map", "fstring"]
    ),
)
def test_the_limit_recorded_is_the_input_read_however_its_name_is_built(
    name, cuts, how
):
    """Property: an own-result addition of a levy on one input records
    exactly that input's limits, whatever way its name was put together."""

    def read(household, period):
        return household(build_name(name, cuts, how), period)

    reformed = simulation(modifier=own_result_by(adding_a_levy(read)))
    assert keys(limits_touched(simulation(), reformed)) == INPUTS[name]


# --- round 13's gaps in the watch (review of #51 round 13) -------------

OTHER_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
NON_RESIDENTIAL_BAND = f"{NON_RESIDENTIAL}[1].rate"


def priced_by_a_summed_rate(kind, path):
    """Non-residential purchases priced by a variable made of nothing but
    ``adds`` or ``subtracts`` of one parameter, which the engine reads with
    no formula running."""

    def modifier(sim):
        from policyengine_core.model_api import Variable

        entity = sim.tax_benefit_system.get_variable(
            NON_RESIDENTIAL_SDLT
        ).entity

        class purchase_rate(Variable):
            label = "Purchase rate"
            definition_period = "year"
            value_type = float

        purchase_rate.entity = entity
        setattr(purchase_rate, kind, [path])

        class sdlt_on_non_residential_property_transactions(Variable):
            def formula(household, period, parameters):
                purchased = household(
                    "non_residential_property_purchased", period
                )
                return purchased * household("purchase_rate", period)

        sim.tax_benefit_system.add_variable(purchase_rate)
        sim.tax_benefit_system.update_variable(
            sdlt_on_non_residential_property_transactions
        )
        return sim

    return modifier


@pytest.mark.parametrize("kind", ["adds", "subtracts"])
def test_a_limited_rate_summed_with_no_formula_shows(kind):
    """Review of #51 round 13: a variable of ``adds`` or ``subtracts`` alone
    ran no formula, so the limited parameter it names was dropped (SDLT
    £20,000 to £2,000 with no limit). The engine starting its sums counts
    as running it, and the parameter read is watched."""
    touched = limits_touched(
        simulation(modifier=priced_by_a_summed_rate(kind, OTHER_RATE)),
        simulation(
            modifier=priced_by_a_summed_rate(kind, NON_RESIDENTIAL_BAND)
        ),
    )
    assert keys(touched) == ["non_residential_purchases"]
    assert touched[0]["parameters"] == ["formula:purchase_rate"]


def rates_by_get_parameter(parameters, period):
    from policyengine_core.parameters import get_parameter

    kind = "non_residential"
    return get_parameter(parameters, f"gov.hmrc.stamp_duty.{kind}.purchase")(
        period
    )


def rates_by_get_child(parameters, period):
    kind = "non_residential"
    return parameters.get_child(f"gov.hmrc.stamp_duty.{kind}.purchase")(period)


def rates_by_getattr(parameters, period):
    kind = "non_residential"
    return getattr(parameters(period).gov.hmrc.stamp_duty, kind).purchase


def rates_by_item(parameters, period):
    kind = "non_residential"
    return parameters(period).gov.hmrc.stamp_duty[kind].purchase


def rates_by_stored_values(parameters, period):
    """The rates rebuilt from the stored parameter, read with no instant."""
    from policyengine_core.taxscales import MarginalRateTaxScale

    kind = "non_residential"
    stored = parameters.get_child(f"gov.hmrc.stamp_duty.{kind}.purchase")

    def latest(parameter):
        return next(
            item.value
            for item in parameter.values_list
            if item.value is not None
        )

    scale = MarginalRateTaxScale()
    for bracket in stored.brackets:
        scale.add_bracket(latest(bracket.threshold), latest(bracket.rate))
    return scale


def rates_by_a_literal_path(parameters, period):
    return parameters(period).gov.hmrc.stamp_duty.non_residential.purchase


def pricing_main_homes_by(rates):
    def make(native):
        def formula(household, period, parameters):
            current = _call_formula(native, household, period, parameters)
            main = household("main_residential_property_purchased", period)
            return current + rates(parameters, period).calc(main)

        return formula

    return make


@pytest.mark.parametrize(
    "rates",
    [
        rates_by_get_parameter,
        rates_by_get_child,
        rates_by_getattr,
        rates_by_item,
        rates_by_stored_values,
        rates_by_a_literal_path,
    ],
)
def test_a_limited_parameter_read_by_any_path_shows(rates):
    """Review of #51 round 13: a parameter path built at run time escaped
    the watch (SDLT £0 to £14,500 with no limit) while the literal path
    showed. Reads of the parameter tree on the way to a limited path are
    watched now, however the path is reached."""
    reformed = simulation(modifier=own_result_by(pricing_main_homes_by(rates)))
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def band_set_on_its_member(rate):
    """An enum class a modifier makes, with its member's rate set after the
    class is made, read through the class."""

    class Band(enum.Enum):
        STANDARD = 1

    Band.STANDARD.rate = rate

    def make():
        return lambda: Band.STANDARD.rate

    return make


def test_a_members_state_read_through_its_class_is_compared():
    """Review of #51 round 13: state set on a member after its class was
    made, read through the class, compared equal (£1,000 to £2,000 with no
    limit)."""
    touched = limits_touched(
        simulation(modifier=non_residential_times(band_set_on_its_member(1))),
        simulation(modifier=non_residential_times(band_set_on_its_member(2))),
    )
    assert keys(touched) == ["non_residential_purchases"]


def priced_by_a_counterfactual_branch(rate, bonus, wrapped=False):
    """Non-residential SDLT taken from a branch with a cloned system whose
    own rate differs: what the branch calculates is the formula's. If
    ``wrapped``, the branch's own formula adds to its original's result."""

    def modifier(sim):
        from policyengine_core.parameters import get_parameter

        branch = sim.get_branch("counterfactual", clone_system=True)
        get_parameter(
            branch.tax_benefit_system.parameters, NON_RESIDENTIAL_BAND
        ).update(period="2027", value=rate)
        if wrapped:
            own_result_by(adding_1000)(branch)
        branch.drop_computed_arrays()

        def formula(household, period, parameters):
            return branch.calculate(NON_RESIDENTIAL_SDLT, period) + bonus

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize(
    "bonus, wrapped",
    [(0, False), (1, False), (0, True)],
    ids=["same-code", "changed-code", "wrapped-in-the-branch"],
)
def test_a_branch_with_its_own_policy_shows(bonus, wrapped):
    """Review of #51 round 13: a held branch with a cloned system compared
    equal whatever its policy, and what it calculated was read by no one
    (SDLT £15,500 to £17,500 with no limit). A held simulation matches only
    when it is one of the two compared; a calculation in another,
    inside a changed variable's, is that variable's."""
    touched = limits_touched(
        simulation(
            modifier=priced_by_a_counterfactual_branch(0.03, 0, wrapped)
        ),
        simulation(
            modifier=priced_by_a_counterfactual_branch(0.05, bonus, wrapped)
        ),
    )
    assert keys(touched) == ["non_residential_purchases"]


def the_original_past_a_threshold(native):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        return np.where(current > 100_000, current, 0) + 1000

    return formula


def test_an_own_result_used_past_a_threshold_stays_computable():
    """Review of #51 round 13: one £1m move never took SDLT past the
    threshold, so the result looked unused and the measure limited. The
    moves grow until the formula's result moves."""
    reformed = simulation(
        modifier=own_result_by(the_original_past_a_threshold)
    )
    assert limits_touched(simulation(), reformed) == []


def non_residential_at_a_rate(household, period, parameters, rate=0.05):
    return household("non_residential_property_purchased", period) * rate


def non_residential_at_a_keyword_rate(
    household, period, parameters, *, rate=0.05
):
    return household("non_residential_property_purchased", period) * rate


def non_residential_from_its_holder(household, period, parameters):
    holder = household.get_holder("non_residential_property_purchased")
    values = holder.get_array(period)
    return (0 if values is None else values) * 0.05


def priced_natively_by(formula, wrapped):
    """A modifier installing ``formula`` for non-residential SDLT and, if
    ``wrapped``, adding £1,000 to its own result."""

    def modifier(sim):
        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        if wrapped:
            own_result_by(adding_1000)(sim)
        return sim

    return modifier


def adding_1000(native):
    def formula(household, period, parameters):
        return _call_formula(native, household, period, parameters) + 1000

    return formula


@pytest.mark.parametrize(
    "formula",
    [
        non_residential_at_a_rate,
        non_residential_at_a_keyword_rate,
        non_residential_from_its_holder,
    ],
    ids=["optional-argument", "keyword-only-argument", "holder-read"],
)
def test_an_own_result_however_the_original_is_written_stays_computable(
    formula,
):
    """Review of #51 round 13: an original with an optional or keyword-only
    argument at its default wasn't taken as called for its own result, and
    one reading its input through the holder wasn't moved by the check;
    both made a £1,000 addition not computable."""
    touched = limits_touched(
        simulation(modifier=priced_natively_by(formula, False)),
        simulation(modifier=priced_natively_by(formula, True)),
    )
    assert touched == []


def discarding_the_original_beside_another(native):
    def formula(household, period, parameters):
        _call_formula(native, household, period, parameters)
        residential = household.simulation.tax_benefit_system.get_variable(
            RESIDENTIAL
        )
        return _call_formula(residential, household, period, parameters) + 1000

    return formula


def test_a_discarded_original_beside_another_result_does_not_wrap():
    """Review of #51 round 13 (outside the line): the check moved the
    inputs every own-result call read, so residential SDLT's result
    moving confirmed a wrapping of the discarded original. Only inputs read
    inside calls of the other side's formula move now."""
    reformed = simulation(
        modifier=own_result_by(discarding_the_original_beside_another)
    )
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


def reading_next_year_when_there_is_tax(native):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        if np.any(current > 0):
            # Only the check's moved purchases take this branch.
            parameters(period.offset(1, "year"))
        return current + 1000

    return formula


def test_checking_a_wrapping_leaves_parameter_caches_as_the_run_did():
    """Review of #51 round 13 (P3): the wrapping check, run as the watch
    ends, filled parameter caches the run had not (here, next year's,
    which only the moved purchases read)."""
    baseline = simulation()
    reformed = simulation(
        modifier=own_result_by(reading_next_year_when_there_is_tax)
    )
    systems = [baseline.tax_benefit_system, reformed.tax_benefit_system]
    with data_limits.observing(baseline, reformed) as observed:
        for sim in (baseline, reformed):
            sim.calculate(NON_RESIDENTIAL_SDLT, 2027)
        after_run = [
            [set(cache) for cache in data_limits._caches(system)]
            for system in systems
        ]
    assert observed.wrapped
    assert [
        [set(cache) for cache in data_limits._caches(system)]
        for system in systems
    ] == after_run
    assert limits_touched(baseline, reformed, observed) == []


def a_literal_read_in_a_branch_never_taken(native):
    def formula(household, period, parameters):
        result = _call_formula(native, household, period, parameters)
        if period.start.year > 2100:
            purchased = household("non_residential_property_purchased", period)
            result = result + purchased
        return result + 1000

    return formula


def test_a_name_written_in_a_formula_that_ran_counts_unread():
    """The names written in a side's code count wherever its formula ran
    unwrapped, read or not: the net under the watch for a read the engine
    doesn't route through its hooks. (A name built at run time in such a
    branch reads nothing, above.)"""
    reformed = simulation(
        modifier=own_result_by(a_literal_read_in_a_branch_never_taken)
    )
    assert keys(limits_touched(simulation(), reformed)) == [
        "non_residential_purchases"
    ]


# A module global holding a limited path, named as an attribute elsewhere.
limited_note = NON_RESIDENTIAL
OPTIONS = types.SimpleNamespace(limited_note=0.0)


def adding_an_option_named_like_a_global(native):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        return current + 1000 + OPTIONS.limited_note

    return formula


def test_an_attribute_named_like_a_global_reads_no_global():
    """Review of #51 round 14 (found in this round's own run): the names
    written in code followed every name a formula uses into its module's
    globals, attribute names included, so ``OPTIONS.limited_note`` read the
    module's ``limited_note``. Only names loaded as globals are followed."""
    reformed = simulation(
        modifier=own_result_by(adding_an_option_named_like_a_global)
    )
    assert limits_touched(simulation(), reformed) == []


# --- round 14's gaps in the watch (review of #51 round 14) -------------


def priced_by_a_branch_population(rate, bonus):
    """Non-residential SDLT read through a held population of a branch with
    a cloned system whose rate differs."""

    def modifier(sim):
        from policyengine_core.parameters import get_parameter

        branch = sim.get_branch("counterfactual", clone_system=True)
        get_parameter(
            branch.tax_benefit_system.parameters, NON_RESIDENTIAL_BAND
        ).update(period="2027", value=rate)
        branch.drop_computed_arrays()
        population = branch.get_variable_population(NON_RESIDENTIAL_SDLT)

        def formula(household, period, parameters):
            return population(NON_RESIDENTIAL_SDLT, period) + bonus

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize("bonus", [0, 1], ids=["same-code", "changed-code"])
def test_a_held_population_with_its_own_policy_shows(bonus):
    """Review of #51 round 14: a held population of a branch with a cloned
    system compared equal whatever its simulation's policy (SDLT £15,500 to
    £17,500 with no limit). A population matches only when its simulation
    is one of the two compared."""
    touched = limits_touched(
        simulation(modifier=priced_by_a_branch_population(0.03, 0)),
        simulation(modifier=priced_by_a_branch_population(0.05, bonus)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def rate_by_an_enum_alias(higher):
    def modifier(sim):
        class Band(enum.Enum):
            STANDARD = 0.01
            HIGHER = 0.02
            SELECTED = HIGHER if higher else STANDARD

        def formula(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * Band.SELECTED.value

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def test_an_enum_alias_is_compared():
    """Review of #51 round 14: an alias choosing the higher rate compared
    equal (£1,000 to £2,000 with no limit). A class is read with every name
    it gives a member."""
    touched = limits_touched(
        simulation(modifier=rate_by_an_enum_alias(False)),
        simulation(modifier=rate_by_an_enum_alias(True)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def purchase_tax_at(rate):
    """A factory: each function it makes runs the same code object."""

    def priced(household, period, parameters, rate=rate):
        purchased = household("non_residential_property_purchased", period)
        return purchased * rate

    return priced


def with_two_purchase_taxes(sim):
    """Two unchanged variables whose formulas the factory made."""
    from policyengine_core.model_api import Variable

    entity = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT).entity
    for name, rate in (
        ("purchase_tax_low", 0.01),
        ("purchase_tax_high", 0.02),
    ):
        variable = type(
            name,
            (Variable,),
            {
                "label": name,
                "entity": entity,
                "definition_period": "year",
                "value_type": float,
                "formula": purchase_tax_at(rate),
            },
        )
        sim.tax_benefit_system.add_variable(variable)
    return sim


def low_tax_at_the_high_rate(sim, changed):
    with_two_purchase_taxes(sim)
    low = sim.tax_benefit_system.get_variable("purchase_tax_low")
    priced = list(low.formulas.values())[-1]

    def formula(household, period, parameters):
        if changed:
            return priced(household, period, parameters, rate=0.02)
        return household.filled_array(0.0)

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
    return sim


def test_a_changed_argument_matching_another_functions_default_shows():
    """Review of #51 round 14: the low-rate tax called at 2% was taken for
    the high-rate tax at its default, both made by one factory, and the
    purchase read was dropped (£0 to £2,000 with no limit). Each exempt
    function runs a code object of its own while watched."""
    touched = limits_touched(
        simulation(modifier=lambda sim: low_tax_at_the_high_rate(sim, False)),
        simulation(modifier=lambda sim: low_tax_at_the_high_rate(sim, True)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def factory_priced(sim, wrapped):
    with_two_purchase_taxes(sim)
    _replace_formula(sim, NON_RESIDENTIAL_SDLT, purchase_tax_at(0.01))
    if wrapped:
        own_result_by(adding_1000)(sim)
    return sim


def test_an_own_result_through_shared_code_stays_computable():
    """Review of #51 round 14: an original sharing its code with another
    function wasn't taken as the other side's, so adding £1,000 to its own
    result was marked not computable."""
    touched = limits_touched(
        simulation(modifier=lambda sim: factory_priced(sim, False)),
        simulation(modifier=lambda sim: factory_priced(sim, True)),
    )
    assert touched == []


def installed_factory_functions(*sims):
    return [
        formula
        for sim in sims
        for name in ("purchase_tax_low", "purchase_tax_high")
        for formula in sim.tax_benefit_system.variables[name].formulas.values()
    ]


def test_while_watched_each_exempt_function_runs_its_own_code():
    """Each exempt function runs a code object of its own while watched,
    and each such object names that function alone."""
    baseline = simulation(modifier=lambda sim: factory_priced(sim, False))
    reformed = simulation(modifier=lambda sim: factory_priced(sim, True))
    functions = installed_factory_functions(baseline, reformed)
    assert len({id(f.__code__) for f in functions}) == 1
    with data_limits.observing(baseline, reformed) as observed:
        members = [
            member
            for exempt in observed.changes.exempt.values()
            for member in exempt.members
        ]
        assert {id(f) for f in functions} <= {id(f) for f, _ in members}
        for exempt in observed.changes.exempt.values():
            codes = [id(f.__code__) for f, _ in exempt.members]
            assert len(set(codes)) == len(codes)
            for f, _ in exempt.members:
                assert exempt.functions[id(f.__code__)] == (f,)


def test_the_watch_gives_each_function_its_code_back():
    baseline = simulation(modifier=lambda sim: factory_priced(sim, False))
    reformed = simulation(modifier=lambda sim: factory_priced(sim, True))
    functions = installed_factory_functions(baseline, reformed)
    codes = [f.__code__ for f in functions]
    assert limits_touched(baseline, reformed) == []
    assert all(f.__code__ is code for f, code in zip(functions, codes))
    with pytest.raises(RuntimeError):
        with data_limits.observing(baseline, reformed):
            raise RuntimeError
    assert all(f.__code__ is code for f, code in zip(functions, codes))


def the_original_within_a_band(native):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        return np.where(
            (current > 200_000) & (current < 400_000), current, 0
        ) + (1000)

    return formula


def the_original_past_a_high_threshold(native):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        return np.where(current > 100_000_000, current, 0) + 1000

    return formula


@pytest.mark.parametrize(
    "make",
    [the_original_within_a_band, the_original_past_a_high_threshold],
    ids=["within-a-band", "past-a-high-threshold"],
)
def test_an_own_result_used_within_a_band_or_far_out_stays_computable(make):
    """Review of #51 round 14: moves by powers of ten from £1k to £1bn
    stepped over a £200k-£400k band of SDLT and never reached a £100m
    threshold. The moves now step by quarter-decades from £100 to £1tn."""
    reformed = simulation(modifier=own_result_by(make))
    assert limits_touched(simulation(), reformed) == []


def test_a_signed_zero_is_not_its_default():
    """Review of #51 round 14 (outside the line): -0.0 passed where the
    default is 0.0 was taken as the default."""
    assert data_limits._same_value(0.0, 0.0)
    assert not data_limits._same_value(-0.0, 0.0)
    assert not data_limits._same_value(1, 1.0)
    assert data_limits._same_value("a", "a")


# --- round 15's gaps (review of #51 round 15) --------------------------


def rates_edited_by_the_wrapper(edit, restore=False):
    """An original priced by a rate held in a dict; if ``edit``, a wrapper
    raises the rate before calling the original for its result (and, if
    ``restore``, puts it back after)."""

    def modifier(sim):
        rates = {"rate": 0.01}

        def original(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * rates["rate"]

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, original)
        if edit:
            native = sim.tax_benefit_system.get_variable(NON_RESIDENTIAL_SDLT)

            def formula(household, period, parameters):
                rates["rate"] = 0.02
                result = _call_formula(native, household, period, parameters)
                if restore:
                    rates["rate"] = 0.01
                return result + 1000

            _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize("restore", [False, True], ids=["left", "restored"])
def test_state_an_original_holds_edited_during_the_run_shows(restore):
    """Review of #51 round 15: a wrapper raised the rate its original read
    before calling it for its result (£1,000 to £3,000 with no limit). An
    exempt measure-code function is fingerprinted afresh as it starts."""
    touched = limits_touched(
        simulation(modifier=rates_edited_by_the_wrapper(False)),
        simulation(modifier=rates_edited_by_the_wrapper(True, restore)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def priced_by_a_held_branch_parameter(rate, held):
    """Non-residential purchases priced by a cloned branch's stored scale,
    or its parent node, held by the formula."""

    def modifier(sim):
        from policyengine_core.parameters import get_parameter

        branch = sim.get_branch("counterfactual", clone_system=True)
        parameters = branch.tax_benefit_system.parameters
        get_parameter(parameters, NON_RESIDENTIAL_BAND).update(
            period="2027", value=rate
        )
        node = parameters.get_child(NON_RESIDENTIAL.rsplit(".", 1)[0])

        def formula(household, period, parameters):
            scale = node.purchase if held == "node" else stored
            purchased = household("non_residential_property_purchased", period)
            return scale(period).calc(purchased)

        stored = parameters.get_child(NON_RESIDENTIAL)
        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


@pytest.mark.parametrize("held", ["scale", "node"])
def test_a_held_branch_parameter_shows(held):
    """Review of #51 round 15: a cloned branch's stored scale or node, held
    by a formula, compared by name whatever its values (SDLT £15,500 to
    £17,500 with no limit). A stored parameter object matches only when it
    is a compared system's own."""
    touched = limits_touched(
        simulation(modifier=priced_by_a_held_branch_parameter(0.03, held)),
        simulation(modifier=priced_by_a_held_branch_parameter(0.05, held)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def priced_through_a_branch_entity(rate):
    """A formula running the formula a cloned branch's entity gives it."""

    def modifier(sim):
        branch = sim.get_branch("counterfactual", clone_system=True)

        def priced(household, period, parameters):
            purchased = household("non_residential_property_purchased", period)
            return purchased * rate

        _replace_formula(branch, NON_RESIDENTIAL_SDLT, priced)
        # The household entity the branch's system holds, bound to it.
        entity = next(
            entity
            for entity in branch.tax_benefit_system.entities
            if entity.key == "household"
        )

        def formula(household, period, parameters):
            variable = entity.get_variable(NON_RESIDENTIAL_SDLT)
            return variable.get_formula(period)(household, period, parameters)

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def test_a_held_branch_entity_shows():
    """Review of #51 round 15: an entity bound to a cloned branch's system
    compared by class name, so the formula it selected went unseen
    (£5,000 to £10,000 with no limit)."""
    touched = limits_touched(
        simulation(modifier=priced_through_a_branch_entity(0.01)),
        simulation(modifier=priced_through_a_branch_entity(0.02)),
    )
    assert keys(touched) == ["non_residential_purchases"]


def rate_from_a_metaclass(rate, enum_based):
    def make():
        if enum_based:

            class RateType(enum.EnumType):
                purchase_rate = rate

            class Band(enum.Enum, metaclass=RateType):
                STANDARD = 1

        else:

            class RateType(type):
                purchase_rate = rate

            class Band(metaclass=RateType):
                pass

        return lambda: Band.purchase_rate

    return make


@pytest.mark.parametrize("enum_based", [False, True], ids=["type", "enum"])
def test_a_metaclass_is_compared(enum_based):
    """Review of #51 round 15: a rate held by a class's metaclass compared
    equal (£1,000 to £2,000 with no limit)."""
    touched = limits_touched(
        simulation(
            modifier=non_residential_times(
                rate_from_a_metaclass(1, enum_based)
            )
        ),
        simulation(
            modifier=non_residential_times(
                rate_from_a_metaclass(2, enum_based)
            )
        ),
    )
    assert keys(touched) == ["non_residential_purchases"]


def priced_from_a_held_input_holder(rate):
    """Purchases read from their holder, captured before the watch."""

    def modifier(sim):
        holder = sim.get_holder("non_residential_property_purchased")

        def formula(household, period, parameters):
            values = holder.get_array(period)
            return (
                household.filled_array(0.0) if values is None else values
            ) * (rate)

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def priced_from_a_branch_calculated_before(rate, by, cloned):
    """SDLT a simulation with a cloned system calculated before the watch
    (a clone, or a branch), read through its holder or its calculate."""

    def modifier(sim):
        from policyengine_core.parameters import get_parameter

        aux = (
            sim.clone(clone_tax_benefit_system=True)
            if cloned
            else sim.get_branch("counterfactual", clone_system=True)
        )
        get_parameter(
            aux.tax_benefit_system.parameters, NON_RESIDENTIAL_BAND
        ).update(period="2027", value=rate)
        aux.drop_computed_arrays()
        for year in data_limits.HOUSEHOLD_YEARS:
            aux.calculate(NON_RESIDENTIAL_SDLT, year)
        holder = aux.get_holder(NON_RESIDENTIAL_SDLT)

        def formula(household, period, parameters):
            if by == "holder":
                return holder.get_array(period)
            return aux.calculate(NON_RESIDENTIAL_SDLT, period)

        _replace_formula(sim, NON_RESIDENTIAL_SDLT, formula)
        return sim

    return modifier


def test_a_held_input_holder_read_directly_shows():
    """Review of #51 round 15: purchases read through a holder captured
    before the watch went unseen (£5,000 to £10,000 with no limit). Holder
    reads are watched, and a held holder carries its variable's name."""
    touched = limits_touched(
        simulation(modifier=priced_from_a_held_input_holder(0.05)),
        simulation(modifier=priced_from_a_held_input_holder(0.10)),
    )
    assert keys(touched) == ["non_residential_purchases"]


@pytest.mark.parametrize(
    "by, cloned",
    [("holder", True), ("calculate", True)],
    ids=["clone-holder", "clone-calculate"],
)
def test_values_a_branch_calculated_before_the_watch_read_anything(by, cloned):
    """Review of #51 round 15: SDLT a cloned simulation had already
    calculated was read with nothing to watch. A value a simulation no
    watch knows calculated unwatched makes the variable unobservable."""
    with pytest.warns(data_limits.UnwatchedFormulaWarning):
        touched = limits_touched(
            simulation(
                modifier=priced_from_a_branch_calculated_before(
                    0.03, by, cloned
                )
            ),
            simulation(
                modifier=priced_from_a_branch_calculated_before(
                    0.05, by, cloned
                )
            ),
        )
    assert keys(touched) == [
        "additional_dwelling_purchases",
        "non_residential_purchases",
    ]


def test_a_branch_recalculating_under_the_watch_is_watched():
    """A branch's values are dropped with its parent's when the modifier
    is applied, so the branch calculates again under the watch, and what
    it reads is the changed variable's: the purchase read shows."""
    touched = limits_touched(
        simulation(
            modifier=priced_from_a_branch_calculated_before(
                0.03, "calculate", False
            )
        ),
        simulation(
            modifier=priced_from_a_branch_calculated_before(
                0.05, "calculate", False
            )
        ),
    )
    assert keys(touched) == ["non_residential_purchases"]


def holding_its_input_holder(sim, banded):
    """An original reading its own simulation's purchases holder, captured
    before the watch, falling back to the engine; if ``banded``, the
    property-band template adds to its result."""
    holder = sim.get_holder("non_residential_property_purchased")

    def native(household, period, parameters):
        values = holder.get_array(period)
        if values is None:
            values = household("non_residential_property_purchased", period)
        return values * 0.05

    _replace_formula(sim, NON_RESIDENTIAL_SDLT, native)
    if banded:
        apply_property_band_surcharge(
            sim,
            channel=NON_RESIDENTIAL_SDLT,
            geography="UK",
            lower_bound=100_000,
            upper_bound=1_000_000,
            amount=900,
            start_year=2027,
            end_year=2027,
        )
    return sim


def test_a_template_on_an_original_holding_its_holder_stays_computable():
    """Review of #51 round 15: an original holding its own simulation's
    holder fingerprinted differently on each side, so the property-band
    template on it was marked not computable. A holder of a compared
    simulation matches by its variable."""
    touched = limits_touched(
        simulation(modifier=lambda sim: holding_its_input_holder(sim, False)),
        simulation(modifier=lambda sim: holding_its_input_holder(sim, True)),
    )
    assert touched == []
