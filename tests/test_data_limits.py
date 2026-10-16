"""Measures the certified data cannot cost: the registry and detection.

pe-uk #2241 makes additional-dwelling and non-residential purchase prices
inputs, nil unless a dataset imputes them, and the certified dataset has
neither column. A measure on those rates scores £0 (before #2241, it charges
a buyer's whole stock), so it must be published as not computable.
"""

import copy
import functools
import re
import warnings

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

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
    import inspect

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
    from uk_budget_data.data_limits import _formulas_touched

    assert (
        _formulas_touched(
            simulation().tax_benefit_system, simulation().tax_benefit_system
        )
        == {}
    )


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
