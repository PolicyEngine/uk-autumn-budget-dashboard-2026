"""Tests for combining measures and proving the combination."""

import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from tests.fixed_shape_measures import broken_modifier
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
    _create_combined_autumn_budget_reform,
    get_reform,
)

BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
HIGHER_RATE = "gov.hmrc.income_tax.rates.uk[1].rate"
DIVIDEND_BASIC = "gov.hmrc.income_tax.rates.dividends[0].rate"
SAVINGS_BASIC = "gov.hmrc.income_tax.rates.savings.basic"
YEARS = [2027, 2028]
CONFIG = DataConfig(years=YEARS)

# The nine members of the hand-built 2025 combined reform.
HAND_BUILT_MEMBERS = [
    "two_child_limit",
    "salary_sacrifice_cap",
    "fuel_duty_freeze",
    "rail_fares_freeze",
    "threshold_freeze_extension",
    "freeze_student_loan_thresholds",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
]


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


def test_generic_combination_reproduces_the_hand_built_2025_reform():
    """Differential: same parameter changes and modifiers on both sides."""
    members = [get_reform(key) for key in HAND_BUILT_MEMBERS]
    sides = merged_changes(members, DataConfig())
    hand_built = _create_combined_autumn_budget_reform()
    assert (
        sides["baseline"]["parameter_changes"]
        == hand_built.baseline_parameter_changes
    )
    assert sides["reform"]["parameter_changes"] == (
        hand_built.parameter_changes or {}
    )
    # Lists in member order (by id), so a dropped or repeated modifier
    # shows.
    assert [m.__name__ for m in sides["baseline"]["modifiers"]] == [
        "_set_pre_budget_dividend_rates",
        "_connect_student_loan_variables",
    ]
    assert [m.__name__ for m in sides["reform"]["modifiers"]] == [
        "_connect_student_loan_variables",
        "_rail_fares_freeze_modifier",
    ]


def test_the_engine_and_the_combiner_agree_on_changes_beside_a_modifier():
    """Differential: one scenario handed to the engine, and the combiner's
    single modifier, give the same parameters.

    The combiner applies parameter changes and then modifiers inside one
    modifier because policyengine-uk 2.125.1 ran a scenario's modifier
    first, and the parameter rebuild then wiped the dividend baseline's
    rates (the engine alone gave 0.1075). From 2.126.12 the engine applies
    them in the combiner's order.
    """
    dividend = get_reform("dividend_tax_increase_2pp")
    savings = get_reform("savings_tax_increase_2pp")
    instants = ["2027-04-06", "2028-04-30"]
    engine = parameter_snapshot(
        Scenario(
            simulation_modifier=dividend.baseline_simulation_modifier,
            parameter_changes=savings.baseline_parameter_changes,
        ),
        instants,
        "engine",
    )
    combined = parameter_snapshot(
        combine_measures([dividend, savings], CONFIG).to_baseline_scenario(),
        instants,
        "combined",
    )
    assert engine[DIVIDEND_BASIC][0] == 0.0875
    assert engine[SAVINGS_BASIC][1] == 0.20
    assert engine == combined


def test_combination_keeps_a_modifiers_parameters_and_is_consistent():
    dividend = get_reform("dividend_tax_increase_2pp")
    savings = get_reform("savings_tax_increase_2pp")
    combined = combine_measures([dividend, savings], CONFIG)
    check_consistency(combined, [dividend, savings], CONFIG, YEARS)
    baseline = parameter_snapshot(
        combined.to_baseline_scenario(),
        ["2027-04-06", "2028-04-30"],
        "combined",
    )
    assert baseline[DIVIDEND_BASIC][0] == 0.0875
    assert baseline[SAVINGS_BASIC][1] == 0.20


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
    savings = get_reform("savings_tax_increase_2pp")
    combined = combine_measures([broken, savings], CONFIG)
    with pytest.raises(CombineInconsistent, match="could not be applied"):
        check_consistency(combined, [broken, savings], CONFIG, YEARS)


def test_the_student_loan_measure_now_combines_consistently():
    """It crashed on policyengine-uk 2.125.1 until its modifier was fixed."""
    student_loans = get_reform("freeze_student_loan_thresholds")
    savings = get_reform("savings_tax_increase_2pp")
    combined = combine_measures([student_loans, savings], CONFIG)
    check_consistency(combined, [student_loans, savings], CONFIG, YEARS)


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
