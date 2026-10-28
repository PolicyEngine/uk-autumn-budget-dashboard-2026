"""Tests for combining measures and proving the combination."""

import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from tests.fixed_shape_measures import broken_modifier, module_level_modifier
from uk_budget_data import reforms
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    CombineConflict,
    CombineInconsistent,
    check_consistency,
    combine_measures,
    combined_key,
    member_order,
    merged_changes,
    parameter_snapshot,
    sample_instants,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    _create_badr_lifetime_limit_cut,
    get_reform,
)

BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
HIGHER_RATE = "gov.hmrc.income_tax.rates.uk[1].rate"
ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
BADR_LIMIT = "gov.hmrc.cgt.badr.lifetime_limit"
SAVINGS_BASIC = "gov.hmrc.income_tax.rates.savings.basic"
YEARS = [2027, 2028]
CONFIG = DataConfig(years=YEARS)


def measure(key, changes=None, **extra) -> Reform:
    return Reform(id=key, name=key.title(), parameter_changes=changes, **extra)


def test_members_are_ordered_by_id_and_listed_once():
    b, a = measure("b"), measure("a")
    assert [m.id for m in member_order([b, a])] == ["a", "b"]
    with pytest.raises(CombineConflict, match="listed twice"):
        member_order([a, measure("a")])


@given(
    st.lists(
        st.text("abcdefgh_", min_size=1, max_size=30),
        min_size=1,
        max_size=12,
        unique=True,
    )
)
def test_combined_key_ignores_order_and_stays_a_safe_length(ids):
    key = combined_key(ids)
    assert key == combined_key(list(reversed(ids)))
    assert key.startswith("combined--")
    assert len(key) <= 120
    if len("combined--" + "+".join(sorted(ids))) <= 120:
        assert key == "combined--" + "+".join(sorted(ids))


def test_parameter_changes_are_merged():
    combined = combine_measures(
        [
            measure("b", {HIGHER_RATE: {"2027": 0.41}}),
            measure("a", {BASIC_RATE: {"2027": 0.21, "2028": 0.22}}),
            measure("c", {SAVINGS_BASIC: {"2028": 0.22}}),
        ],
        CONFIG,
    )
    assert combined.id == "combined--a+b+c"
    assert combined.parameter_changes == {
        BASIC_RATE: {"2027": 0.21, "2028": 0.22},
        HIGHER_RATE: {"2027": 0.41},
        SAVINGS_BASIC: {"2028": 0.22},
    }
    assert combined.simulation_modifier is None
    assert combined.to_baseline_scenario() is None


@pytest.mark.parametrize(
    "second",
    [
        {BASIC_RATE: {"2027": 0.22}},  # a different value
        {BASIC_RATE: {"2027": 0.21}},  # the same value
        {BASIC_RATE: {"2028": 0.21}},  # a different year
    ],
)
def test_two_members_may_never_touch_one_parameter(second):
    """policyengine.py composition v1 requires disjoint parameters."""
    first = measure("a", {BASIC_RATE: {"2027": 0.21}})
    with pytest.raises(CombineConflict) as error:
        combine_measures([first, measure("b", second)], CONFIG)
    message = str(error.value)
    assert BASIC_RATE in message and "both a and b" in message


ELASTICITY = "gov.simulation.capital_gains_responses.elasticity"


def test_members_may_share_a_setting_at_the_same_values():
    """A shared setting (combine.SHARED_SETTINGS) is merged once."""
    pin = {ELASTICITY: {"2027": 0.0, "2028": 0.0}}
    combined = combine_measures(
        [
            measure("a", {BADR_LIMIT: {"2027": 500_000}, **pin}),
            measure("b", {BASIC_RATE: {"2027": 0.21}, **pin}),
        ],
        CONFIG,
    )
    assert combined.parameter_changes == {
        BADR_LIMIT: {"2027": 500_000},
        BASIC_RATE: {"2027": 0.21},
        **pin,
    }


@pytest.mark.parametrize(
    "second",
    [{"2027": 1.0, "2028": 0.0}, {"2027": 0.0}],  # a value; a year
)
def test_members_may_not_share_a_setting_at_different_values(second):
    first = measure("a", {ELASTICITY: {"2027": 0.0, "2028": 0.0}})
    with pytest.raises(CombineConflict, match="set differently by a and b"):
        combine_measures([first, measure("b", {ELASTICITY: second})], CONFIG)


def test_members_sharing_the_configured_baseline_combine():
    config = DataConfig(
        years=YEARS, baseline_parameter_changes={BASIC_RATE: {"2027": 0.19}}
    )
    a = measure("a", {HIGHER_RATE: {"2027": 0.41}})
    b = measure("b", {SAVINGS_BASIC: {"2028": 0.22}})
    sides = merged_changes([a, b], config)
    assert sides["baseline"]["parameter_changes"] == {
        BASIC_RATE: {"2027": 0.19}
    }


def test_members_without_their_own_baseline_use_the_configured_one():
    config = DataConfig(
        years=YEARS, baseline_parameter_changes={BASIC_RATE: {"2027": 0.19}}
    )
    custom = measure(
        "custom",
        {HIGHER_RATE: {"2027": 0.41}},
        baseline_parameter_changes={HIGHER_RATE: {"2027": 0.39}},
    )
    plain = measure("plain", {SAVINGS_BASIC: {"2028": 0.22}})
    sides = merged_changes([custom, plain], config)
    assert sides["baseline"]["parameter_changes"] == {
        HIGHER_RATE: {"2027": 0.39},
        BASIC_RATE: {"2027": 0.19},
    }


def test_the_registered_package_is_the_generic_combination_of_its_members():
    """Differential: the combined candidate package carries exactly the
    generic combiner's parameter changes and modifiers, in member order."""
    members = [
        get_reform(key) for key in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    ]
    sides = merged_changes(members, DataConfig())
    package = get_reform(AUTUMN_BUDGET_2026_COMBINED_ID)
    assert package.parameter_changes == sides["reform"]["parameter_changes"]
    assert (package.baseline_parameter_changes or {}) == sides["baseline"][
        "parameter_changes"
    ]
    # Lists in member order (by id), so a dropped or repeated modifier
    # shows.
    assert [m.__name__ for m in sides["baseline"]["modifiers"]] == []
    assert [m.__name__ for m in sides["reform"]["modifiers"]] == [
        "carers_allowance_earnings_taper",
        "zero_vat_on_domestic_electricity",
        "pump_vat_on_fuel_duty_deferral",
        "household_energy_payment_2026",
        "pension_tax_allowance",
    ]


def test_the_engine_and_the_combiner_agree_on_two_members_changes():
    """Differential: a hand-written scenario holding both members' parameter
    changes and the combiner's give the same parameters."""
    freeze = reforms._create_threshold_freeze_2031_32()
    badr = _create_badr_lifetime_limit_cut()
    instants = ["2027-04-06", "2031-04-30"]
    engine = parameter_snapshot(
        Scenario(
            parameter_changes={
                **freeze.parameter_changes,
                **badr.parameter_changes,
            },
        ),
        instants,
        "engine",
    )
    combined = parameter_snapshot(
        combine_measures([freeze, badr], CONFIG).to_scenario(),
        instants,
        "combined",
    )
    assert engine[BADR_LIMIT][0] == 500_000
    assert engine[ALLOWANCE][1] == 12_570
    assert engine == combined


UC_REBALANCING = "gov.dwp.universal_credit.rebalancing.active"
BUILD_YEARS = range(2025, 2030)
# No earnings, and limited capability for work-related activity: the
# Universal Credit rebalancing step stores this claimant's health element
# while the simulation is built, from the parameters as they are then.
LCWRA_CLAIMANT = {
    "people": {
        "person": {
            "age": {year: 30 + year - 2025 for year in BUILD_YEARS},
            "employment_income": {year: 0 for year in BUILD_YEARS},
            "uc_limited_capability_for_WRA": {
                year: True for year in BUILD_YEARS
            },
        }
    },
    "benunits": {"benunit": {"members": ["person"]}},
    "households": {"household": {"members": ["person"]}},
}


def _household_result(scenario):
    from policyengine_uk import Simulation

    sim = Simulation(situation=LCWRA_CLAIMANT, scenario=scenario)
    return {
        variable: float(sim.calculate(variable, 2027).sum())
        for variable in ("universal_credit", "household_net_income")
    }


def test_a_member_gives_the_same_household_result_combined_as_alone():
    """Review round 10: the combination applied its members' parameter
    changes inside its modifier, which policyengine-uk 2.126.12 runs after
    the Universal Credit rebalancing step. Switching rebalancing off then
    did nothing in a combined run: this claimant's Universal Credit stayed
    at current law (about 10,475 a year) where the measure alone gives
    about 7,883, while every parameter agreed and ``check_consistency``
    passed."""
    changes = {UC_REBALANCING: {"2027": False}}
    alone = measure("a", changes)
    does_nothing = measure("b", simulation_modifier=module_level_modifier)
    combined = combine_measures([alone, does_nothing], CONFIG)
    check_consistency(combined, [alone, does_nothing], CONFIG, [2027])
    result = _household_result(alone.to_scenario())
    assert _household_result(combined.to_scenario()) == result
    # Not vacuous: the change moves this household.
    assert result != _household_result(None)
    # The changes are the scenario's own, so the engine applies them where
    # it applies the member's; the modifier only runs the members'.
    assert combined.to_scenario().parameter_changes == changes
    assert combined.simulation_modifier is not None


def test_combination_keeps_each_members_parameters_and_is_consistent():
    freeze = reforms._create_threshold_freeze_2031_32()
    badr = _create_badr_lifetime_limit_cut()
    combined = combine_measures([freeze, badr], CONFIG)
    check_consistency(combined, [freeze, badr], CONFIG, [2027, 2031])
    reform = parameter_snapshot(
        combined.to_scenario(),
        ["2027-04-06", "2031-04-30"],
        "combined",
    )
    assert reform[BADR_LIMIT][0] == 500_000
    assert reform[ALLOWANCE][1] == 12_570


def test_a_combination_missing_a_members_change_is_inconsistent():
    a = measure("a", {BASIC_RATE: {"2027": 0.21}})
    b = measure("b", {HIGHER_RATE: {"2027": 0.41}})
    broken = measure("combined--a+b", {BASIC_RATE: {"2027": 0.21}})
    with pytest.raises(CombineInconsistent) as error:
        check_consistency(broken, [a, b], CONFIG, YEARS)
    message = str(error.value)
    assert HIGHER_RATE in message and "under b alone" in message


def test_a_combination_that_changes_more_than_its_members_is_inconsistent():
    a = measure("a", {BASIC_RATE: {"2027": 0.21}})
    extra = measure(
        "combined--a",
        {BASIC_RATE: {"2027": 0.21}, HIGHER_RATE: {"2027": 0.41}},
    )
    with pytest.raises(CombineInconsistent, match="which no member does"):
        check_consistency(extra, [a], CONFIG, YEARS)


def test_a_measure_that_cannot_run_on_a_household_cannot_be_combined():
    broken = measure("broken", simulation_modifier=broken_modifier)
    badr = _create_badr_lifetime_limit_cut()
    combined = combine_measures([broken, badr], CONFIG)
    with pytest.raises(CombineInconsistent, match="could not be applied"):
        check_consistency(combined, [broken, badr], CONFIG, YEARS)


def test_the_student_loan_measure_combines_consistently():
    """Its modifier deletes the survey's reported repayments; it crashed on
    policyengine-uk 2.125.1 until it was fixed."""
    student_loans = reforms._create_plan_2_threshold_unfreeze()
    badr = _create_badr_lifetime_limit_cut()
    combined = combine_measures([student_loans, badr], CONFIG)
    check_consistency(combined, [student_loans, badr], CONFIG, YEARS)


def test_sample_instants_bracket_each_fiscal_year():
    assert sample_instants([2028, 2027])[:4] == [
        "2027-01-01",
        "2027-04-06",
        "2027-04-30",
        "2027-12-31",
    ]


def shared_modifier(sim):
    return sim


def test_a_modifier_shared_by_two_members_runs_once_for_each():
    """Review finding: a shared modifier was silently applied once."""
    a = measure("a", simulation_modifier=shared_modifier)
    b = measure("b", simulation_modifier=shared_modifier)
    sides = merged_changes([a, b], CONFIG)
    assert sides["reform"]["modifiers"] == [shared_modifier, shared_modifier]
