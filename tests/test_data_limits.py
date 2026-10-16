"""Measures the certified data cannot cost: the registry and detection.

pe-uk #2241 makes additional-dwelling and non-residential purchase prices
inputs, nil unless a dataset imputes them, and the certified dataset has
neither column. A measure on those rates scores £0 (before #2241, it charges
a buyer's whole stock), so it must be published as not computable.
"""

import warnings

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from tests.fixed_shape_measures import raise_additional_dwelling_rates
from uk_budget_data import data_limits
from uk_budget_data.data_limits import (
    DATA_LIMITS,
    limits_for_paths,
    limits_for_scenarios,
    limits_touched,
    merge,
    record,
    record_problems,
)
from uk_budget_data.measure_templates import DataLimitedWarning, rate_change

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
            assert limit.missing_input in source, name


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


def test_built_parameter_trees_of_an_unrelated_measure_touch_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.22}}))
        == []
    )


def test_merge_unions_parameters_per_limit_in_registry_order():
    surcharge = BY_KEY["additional_dwelling_purchases"]
    other = BY_KEY["non_residential_purchases"]
    merged = merge(
        [record(other, ["b"])],
        [record(surcharge, ["y"]), record(other, ["a"])],
        [record(surcharge, ["x", "y"])],
    )
    assert merged == [record(surcharge, ["x", "y"]), record(other, ["a", "b"])]


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
