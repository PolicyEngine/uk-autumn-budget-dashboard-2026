"""Synthetic regressions for reusable measure authoring patterns.

PYTEST_DONT_REWRITE: receipt binding verifies this module's original bytecode.
"""

import subprocess

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from tests.template_measures import (
    allowance_modifier,
    payment_modifier,
    property_modifier,
    vat_modifier,
)
from tests.unbindable_template_measures import partial_payment_modifier
from uk_budget_data.measure_templates import (
    allowance_uprating,
    apply_benefit_receipt_payment,
    apply_vat_base_change,
    nearest_5p_weekly,
    pension_uprating,
    rate_change,
    threshold_change,
)
from uk_budget_data.models import Reform

FUEL_PATH = "gov.hmrc.fuel_duty.petrol_and_diesel"
ALLOWANCE_PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
NEW_PENSION_PATH = "gov.dwp.state_pension.new_state_pension.amount"
BASIC_PENSION_PATH = "gov.dwp.state_pension.basic_state_pension.amount"


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
def test_annual_builders_validate_paths_and_explicit_years(builder):
    assert builder(FUEL_PATH, {2029: 0.6, "2028": 0.5}) == {
        FUEL_PATH: {"2028": 0.5, "2029": 0.6}
    }
    with pytest.raises(ValueError, match="Unknown parameter path"):
        builder("gov.hmrc.no_such_parameter", {2028: 1})
    with pytest.raises(ValueError, match="leaf"):
        builder("gov.hmrc.fuel_duty", {2028: 1})
    with pytest.raises(ValueError, match="one day"):
        builder(FUEL_PATH, {"2029-04-01": 0.5})
    with pytest.raises(ValueError, match="Duplicate"):
        builder(FUEL_PATH, {2028: 0.5, "2028": 0.6})


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
@pytest.mark.parametrize(
    "key",
    [
        "2026-04-06",  # one day: scores nothing
        "2026-04-06.2100-12-31",  # an interval: the household calculator ignores it
        "year:2026:5",
        "2026-04",
    ],
)
def test_only_bare_fiscal_years_are_accepted(builder, key):
    """A Budget measure keyed any other way can silently do nothing.

    On policyengine-uk 2.126.12 a bare year names the whole UK fiscal year
    and a lone date names one day. The national run reads an interval, but
    the household calculator applies a change only where the key is the
    year itself, so a bare year is the only key both read
    (``tests/test_measure_keys.py``).
    """
    with pytest.raises(ValueError, match="four-digit"):
        builder(FUEL_PATH, {key: 0.6})


def test_a_bare_year_sets_the_whole_fiscal_year_on_the_installed_model():
    situation = {
        "people": {"p": {"age": {"2028": 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    sim = Simulation(
        situation=situation,
        scenario=Scenario(
            parameter_changes=rate_change(FUEL_PATH, {2028: 0.7})
        ),
    )
    fuel = sim.tax_benefit_system.parameters.gov.hmrc.fuel_duty
    # Formulas read the annual value; the fiscal-year value is 30 April's.
    assert fuel.petrol_and_diesel("2028-01-01") == pytest.approx(0.7)
    assert fuel.petrol_and_diesel("2028-04-30") == pytest.approx(0.7)
    assert fuel.petrol_and_diesel("2027-04-30") != pytest.approx(0.7)


@pytest.mark.parametrize("bad_value", [float("inf"), float("nan"), True])
def test_parameter_builders_refuse_nonfinite_or_boolean_values(bad_value):
    with pytest.raises(ValueError, match="finite number"):
        rate_change(FUEL_PATH, {2028: bad_value})


def test_parameter_builders_accept_native_scale_bracket_paths():
    rate_path = "gov.hmrc.income_tax.rates.uk[0].rate"
    threshold_path = "gov.hmrc.income_tax.rates.uk[1].threshold"
    assert rate_change(rate_path, {2028: 0.25}) == {rate_path: {"2028": 0.25}}
    assert threshold_change(threshold_path, {2028: 40_000}) == {
        threshold_path: {"2028": 40_000}
    }


def test_annual_parameter_builders_run_through_native_scenario():
    policy = Reform(
        id="synthetic_annual_values",
        name="Synthetic annual values",
        parameter_changes={
            **rate_change(FUEL_PATH, {2028: 0.6, 2029: 0.7}),
            **threshold_change(ALLOWANCE_PATH, {2028: 15_000, 2029: 15_500}),
        },
    )
    situation = {
        "people": {"p": {"age": {2028: 40, 2029: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    sim = Simulation(situation=situation, scenario=policy.to_scenario())
    for year, expected in [(2028, 15_000), (2029, 15_500)]:
        assert sim.calculate("personal_allowance", year)[0] == expected
    parameter = sim.tax_benefit_system.parameters.gov.hmrc.fuel_duty
    assert parameter.petrol_and_diesel("2028") == pytest.approx(0.6)
    assert parameter.petrol_and_diesel("2029") == pytest.approx(0.7)


def test_uprating_chain_on_explicit_path():
    # The rounded £15,460, rather than raw £15,451.50, is next year's base.
    assert allowance_uprating(
        ALLOWANCE_PATH, 15_000, {2027: 0, 2028: 0.0301, 2029: 0.02}
    ) == {ALLOWANCE_PATH: {"2027": 15_000, "2028": 15_460, "2029": 15_770}}


def test_uprating_chains_from_rounded_value_not_initial_value():
    values = allowance_uprating(
        ALLOWANCE_PATH, 15_010, {2027: 0, 2028: 0.01, 2029: 0.01}
    )[ALLOWANCE_PATH]
    assert values == {"2027": 15_010, "2028": 15_170, "2029": 15_330}
    assert values["2029"] != 15_320  # Rounding the unchained £15,311.701.


def test_uprating_rounds_the_supplied_growth_without_a_tolerance():
    exact = allowance_uprating(ALLOWANCE_PATH, 20_000, {2028: 0.3})
    computed = allowance_uprating(ALLOWANCE_PATH, 20_000, {2028: 0.1 + 0.2})
    assert exact == {ALLOWANCE_PATH: {"2028": 26_000}}
    assert computed == {ALLOWANCE_PATH: {"2028": 26_010}}


def test_allowance_uprating_refuses_gaps_and_taper_before_rounding():
    with pytest.raises(ValueError, match="consecutive"):
        allowance_uprating(ALLOWANCE_PATH, 15_000, {2027: 0, 2029: 0.01})
    with pytest.raises(ValueError, match="taper_after_rounding"):
        allowance_uprating(
            ALLOWANCE_PATH, 15_000, {2027: 0}, taper_after_rounding=False
        )


@given(
    base=st.integers(1, 30_000).map(lambda value: value * 10),
    growths=st.lists(st.integers(0, 10_000), min_size=1, max_size=5),
    extra=st.integers(0, 10_000),
)
@settings(max_examples=30, deadline=None)
def test_allowance_uprating_is_monotone_rounded_and_chained(
    base, growths, extra
):
    growth_by_year = {
        2027 + i: value / 100_000 for i, value in enumerate(growths)
    }
    larger_growth = {
        year: growth + extra / 100_000
        for year, growth in growth_by_year.items()
    }
    lower = allowance_uprating(ALLOWANCE_PATH, base, growth_by_year)[
        ALLOWANCE_PATH
    ]
    higher = allowance_uprating(ALLOWANCE_PATH, base, larger_growth)[
        ALLOWANCE_PATH
    ]
    previous = base
    for index, (year, value) in enumerate(lower.items()):
        # Independent integer ceiling: growth is growths[index] / 100_000,
        # then the amount is rounded upward to the next multiple of ten.
        numerator = previous * (100_000 + growths[index])
        expected = ((numerator + 999_999) // 1_000_000) * 10
        assert value == expected
        assert value % 10 == 0
        assert value >= previous
        assert higher[year] >= value
        previous = int(value)


@pytest.mark.parametrize(
    "amount, expected",
    [(200.021, 200.0), (200.025, 200.05), (200.076, 200.1), (0, 0)],
)
def test_nearest_5p_weekly_is_explicit(amount, expected):
    assert nearest_5p_weekly(amount) == expected


def test_state_pension_uprating_paths_conditionally_round_both_pensions():
    # New: £240 x 1.031 = £247.44 -> £247.45. Basic: £180 x 1.031
    # = £185.58 -> £185.60; the rounded new-pension ratio is insufficient.
    growth = 0.031
    changes = {
        **rate_change(
            NEW_PENSION_PATH,
            {2029: pension_uprating(240, growth, round_to_5p=True)},
        ),
        **rate_change(
            BASIC_PENSION_PATH,
            {2029: pension_uprating(180, growth, round_to_5p=True)},
        ),
    }
    assert changes[NEW_PENSION_PATH]["2029"] == 247.45
    assert changes[BASIC_PENSION_PATH]["2029"] == 185.60
    assert pension_uprating(240, growth) == pytest.approx(247.44)
    assert pension_uprating(180, growth) == pytest.approx(185.58)
    assert changes[BASIC_PENSION_PATH]["2029"] != pytest.approx(
        changes[NEW_PENSION_PATH]["2029"] * 180 / 240
    )


@pytest.mark.parametrize(
    "pension_type, path, age",
    [("NEW", NEW_PENSION_PATH, 75), ("BASIC", BASIC_PENSION_PATH, 85)],
)
@pytest.mark.parametrize("reported", [10_000, 20_000])
def test_native_pension_responds_to_rates_without_total_income_override(
    pension_type, path, age, reported
):
    # policyengine-uk splits reported pension at the legislated baseline rate.
    # Partial records and protected/additional amounts now respond natively;
    # applying a second total-pension scaling modifier would count it twice.
    situation = _pensioner(2028, income=0, age=age)
    situation["people"]["p"].update(
        {
            "state_pension_type": {2028: pension_type},
            "state_pension_reported": {2028: reported},
        }
    )
    baseline = Simulation(situation=situation)
    old_rate = baseline.tax_benefit_system.parameters.get_child(path)("2028")
    new_rate = pension_uprating(old_rate, 0.031, round_to_5p=True)
    policy = Reform(
        id="synthetic_pension_rate",
        name="Synthetic pension rate",
        parameter_changes=rate_change(path, {2028: new_rate}),
    )
    sim = Simulation(situation=situation, scenario=policy.to_scenario())
    assert _value(baseline, "state_pension", 2028) == pytest.approx(reported)
    assert _value(sim, "state_pension", 2028) == pytest.approx(
        reported * new_rate / old_rate, abs=0.01
    )
    assert (_value(sim, "additional_state_pension", 2028) > 0) == (
        reported > old_rate * 52
    )


def _policy(modifier):
    return Reform(
        id="synthetic_policy",
        name="Synthetic policy",
        simulation_modifier=modifier,
    )


def _situation(year=2027, income=30_000, age=40, **household_inputs):
    return {
        "people": {
            "p": {"age": {year: age}, "employment_income": {year: income}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "region": {year: "LONDON"},
                **{
                    name: {year: value}
                    for name, value in household_inputs.items()
                },
            }
        },
    }


def _value(sim, variable, year=2027):
    return float(np.asarray(sim.calculate(variable, year)).sum())


@pytest.mark.parametrize("year", [2027, 2028])
def test_vat_is_counted_once_in_income_and_receipts(year):
    situation = _situation(year, domestic_energy_consumption=1680)
    reformed = Simulation(
        situation=situation, scenario=_policy(vat_modifier).to_scenario()
    )
    baseline = reformed.baseline
    # VAT-inclusive bill: £1680 / 1.05 x 2.5 percentage points = £40.
    assert _value(reformed, "household_net_income", year) - _value(
        baseline, "household_net_income", year
    ) == pytest.approx(40, abs=0.01)
    for receipts in ("vat", "gov_balance"):
        assert _value(reformed, receipts, year) - _value(
            baseline, receipts, year
        ) == pytest.approx(-40, abs=0.01)
    assert _value(reformed, "vat_change", year) == pytest.approx(-40, abs=0.01)


@pytest.mark.parametrize("spending", [None, 0])
def test_vat_missing_input_and_explicit_zero_have_no_effect(spending):
    inputs = (
        {} if spending is None else {"domestic_energy_consumption": spending}
    )
    sim = Simulation(
        situation=_situation(**inputs),
        scenario=_policy(vat_modifier).to_scenario(),
    )
    assert _value(sim, "vat_change") == 0


def test_vat_bounds_leave_other_years_unchanged():
    situation = _situation(domestic_energy_consumption=1680)
    sim = Simulation(
        situation=situation, scenario=_policy(vat_modifier).to_scenario()
    )
    baseline = sim.baseline
    for year in (2026, 2029):
        assert _value(sim, "vat", year) == _value(baseline, "vat", year)


@pytest.fixture(scope="module")
def vat_household_template():
    return Simulation(situation=_situation(domestic_energy_consumption=0))


@given(
    spending=st.integers(0, 100_000).map(lambda pennies: pennies / 100),
    delta=st.integers(-500, 2000).map(lambda rate: rate / 10_000),
)
@settings(max_examples=10, deadline=None)
def test_vat_resources_equal_opposite_government_receipts(
    vat_household_template, spending, delta
):
    # Each example owns the formula being wrapped and its baseline, so
    # wrappers cannot accumulate across property-test examples.
    sim = vat_household_template.clone()
    sim.set_input("domestic_energy_consumption", 2027, [spending])
    sim.baseline = sim.clone()
    # Warm cached downstream results: helper must invalidate them too.
    income_before = _value(sim, "household_net_income")
    balance_before = _value(sim, "gov_balance")
    vat_before = _value(sim, "vat")
    apply_vat_base_change(
        sim,
        spending_variable="domestic_energy_consumption",
        rate_change=delta,
        start_year=2027,
        end_year=2027,
    )
    resources = _value(sim, "household_net_income") - income_before
    receipts = _value(sim, "vat") - vat_before
    balance = _value(sim, "gov_balance") - balance_before
    expected = spending * delta / 1.05
    assert receipts == pytest.approx(expected, abs=0.01)
    assert resources == pytest.approx(-receipts, abs=0.01)
    assert resources == pytest.approx(-balance, abs=0.01)


def _uc_household(income=8000, region="LONDON"):
    situation = _situation(
        income=income, rent=9600, tenure_type="RENT_PRIVATELY"
    )
    situation["people"]["c"] = {"age": {2027: 5}}
    situation["benunits"]["b"]["members"].append("c")
    situation["households"]["h"]["members"].append("c")
    situation["households"]["h"]["region"] = {2027: region}
    return situation


def _pensioner(year=2027, income=5000, age=75):
    situation = _situation(year, income=0, age=age)
    situation["people"]["p"]["private_pension_income"] = {year: income}
    situation["benunits"]["b"]["would_claim_pc"] = {year: True}
    return situation


@pytest.mark.parametrize("income, expected", [(8000, 120), (120_000, 0)])
def test_payment_by_uc_receipt(income, expected):
    situation = _uc_household(income)
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert (_value(sim, "universal_credit") > 0) == (expected > 0)
    assert (
        _value(sim, "cost_of_living_support_payment")
        - _value(baseline, "cost_of_living_support_payment")
        == expected
    )
    assert _value(sim, "household_net_income") - _value(
        baseline, "household_net_income"
    ) == pytest.approx(expected, abs=0.01)
    assert _value(sim, "gov_balance") - _value(
        baseline, "gov_balance"
    ) == pytest.approx(-expected, abs=0.01)
    assert _value(sim, "universal_credit") == _value(
        baseline, "universal_credit"
    )
    assert _value(sim, "income_tax") == _value(baseline, "income_tax")
    assert _value(sim, "cost_of_living_support_payment", 2028) == _value(
        baseline, "cost_of_living_support_payment", 2028
    )


@pytest.mark.parametrize("region", ["NORTHERN_IRELAND", "SCOTLAND", "WALES"])
def test_payment_geography_excludes_northern_ireland(region):
    situation = _uc_household(region=region)
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "universal_credit") > 0
    expected = 0 if region == "NORTHERN_IRELAND" else 120
    assert (
        _value(sim, "cost_of_living_support_payment")
        - _value(baseline, "cost_of_living_support_payment")
        == expected
    )


def test_payment_for_guarantee_credit_pensioner():
    situation = _pensioner()
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "guarantee_credit") > 0
    assert sim.calculate("in_receipt_of_guarantee_credit", 2027).all()
    assert (
        _value(sim, "cost_of_living_support_payment")
        - _value(baseline, "cost_of_living_support_payment")
        == 120
    )


def test_payment_refuses_entitlement_without_actual_claim():
    situation = _pensioner()
    situation["benunits"]["b"]["would_claim_pc"] = {2027: False}
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    assert (
        _value(sim, "guarantee_credit") > 0
    )  # Entitlement alone is insufficient.
    assert _value(sim, "pension_credit") == 0
    assert _value(sim, "cost_of_living_support_payment") == 0


def test_payment_once_for_pension_credit_and_uc_household():
    situation = _uc_household()
    situation["people"]["pensioner"] = {
        "age": {2027: 75},
        "private_pension_income": {2027: 5000},
    }
    situation["benunits"]["pensioners"] = {
        "members": ["pensioner"],
        "would_claim_pc": {2027: True},
    }
    situation["households"]["h"]["members"].append("pensioner")
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "universal_credit") > 0
    assert sim.calculate("in_receipt_of_guarantee_credit", 2027).any()
    assert (
        _value(sim, "cost_of_living_support_payment")
        - _value(baseline, "cost_of_living_support_payment")
        == 120
    )


def test_savings_credit_only_does_not_qualify():
    # An older pensioner can have savings credit with no guarantee credit.
    situation = _pensioner(income=14_000, age=85)
    sim = Simulation(
        situation=situation, scenario=_policy(payment_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "savings_credit") > 0
    assert _value(sim, "guarantee_credit") == 0
    assert _value(sim, "pension_credit") > 0
    assert _value(sim, "cost_of_living_support_payment") == _value(
        baseline, "cost_of_living_support_payment"
    )


@pytest.mark.parametrize("claim", [True, False])
def test_explicit_savings_credit_selector_requires_actual_receipt(claim):
    situation = _pensioner(income=14_000, age=85)
    situation["benunits"]["b"]["would_claim_pc"] = {2027: claim}
    sim = Simulation(situation=situation)
    assert _value(sim, "savings_credit") > 0
    apply_benefit_receipt_payment(
        sim,
        amount=120,
        eligible_benefits=["savings_credit"],
        geography="GB",
        channel="cost_of_living_support_payment",
        year=2027,
    )
    assert _value(sim, "cost_of_living_support_payment") == (
        120 if claim else 0
    )


@pytest.fixture(scope="module")
def payment_household_template():
    # Three households with two benefit units each, all initially unpaid.
    situation = {"people": {}, "benunits": {}, "households": {}}
    for i in range(6):
        name = str(i)
        situation["people"][name] = {"age": {2027: 75}}
        situation["benunits"][name] = {
            "members": [name],
            "universal_credit": {2027: 0},
            "guarantee_credit": {2027: 0},
            "in_receipt_of_guarantee_credit": {2027: False},
        }
    for i in range(3):
        situation["households"][str(i)] = {
            "members": [str(2 * i), str(2 * i + 1)]
        }
    return Simulation(situation=situation)


@given(
    combinations=st.lists(
        st.tuples(st.booleans(), st.booleans()), min_size=6, max_size=6
    )
)
@settings(max_examples=10, deadline=None)
def test_lump_sum_is_once_per_eligible_household(
    payment_household_template, combinations
):
    # Synthetic actual receipt inputs isolate aggregation from entitlement.
    sim = payment_household_template.clone()
    sim.set_input(
        "universal_credit", 2027, [100 if uc else 0 for uc, _ in combinations]
    )
    sim.set_input(
        "guarantee_credit", 2027, [100 if pc else 0 for _, pc in combinations]
    )
    sim.set_input(
        "in_receipt_of_guarantee_credit",
        2027,
        [pc for _, pc in combinations],
    )
    before = np.asarray(sim.calculate("cost_of_living_support_payment", 2027))
    _policy(payment_modifier).simulation_modifier(sim)
    np.testing.assert_allclose(
        sim.calculate("cost_of_living_support_payment", 2027) - before,
        [
            120 if any(uc or pc for uc, pc in combinations[i : i + 2]) else 0
            for i in range(0, 6, 2)
        ],
    )


@pytest.mark.parametrize(
    "year, expected", [(2027, 15_000), (2028, 15_460), (2029, 15_770)]
)
def test_allowance_uprated_in_simulation_on_explicit_path(year, expected):
    sim = Simulation(
        situation=_pensioner(year, income=13_000),
        scenario=_policy(allowance_modifier).to_scenario(),
    )
    assert _value(sim, "personal_allowance", year) == expected
    assert _value(sim, "income_tax", year) == 0


def test_taper_applied_after_rounding_in_2028():
    situation = _pensioner(2028, income=25_010)
    sim = Simulation(
        situation=situation, scenario=_policy(allowance_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "personal_allowance", 2028) == 15_460 - 505
    assert _value(baseline, "income_tax", 2028) - _value(
        sim, "income_tax", 2028
    ) == pytest.approx(477, abs=0.01)


def test_basic_rate_limit_unchanged():
    situation = _pensioner(2028, income=60_000)
    sim = Simulation(
        situation=situation, scenario=_policy(allowance_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "personal_allowance", 2028) == _value(
        baseline, "personal_allowance", 2028
    )
    assert _value(sim, "income_tax", 2028) == _value(
        baseline, "income_tax", 2028
    )
    limit_path = "gov.hmrc.income_tax.rates.uk[1].threshold"
    original = baseline.tax_benefit_system.parameters.get_child(limit_path)(
        "2028"
    )
    changed = sim.tax_benefit_system.parameters.get_child(limit_path)("2028")
    assert changed == original


def test_hundred_k_taper_still_applies_to_pensioners():
    situation = _pensioner(2028, income=110_000)
    sim = Simulation(
        situation=situation, scenario=_policy(allowance_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "personal_allowance", 2028) == 7570
    assert _value(sim, "personal_allowance", 2028) == _value(
        baseline, "personal_allowance", 2028
    )


@pytest.mark.parametrize("year, age", [(2026, 75), (2027, 40)])
def test_extra_allowance_inert_outside_path_or_eligibility(year, age):
    situation = _pensioner(year, income=13_000, age=age)
    sim = Simulation(
        situation=situation, scenario=_policy(allowance_modifier).to_scenario()
    )
    baseline = sim.baseline
    assert _value(sim, "personal_allowance", year) == _value(
        baseline, "personal_allowance", year
    )


@pytest.mark.parametrize(
    "modifier, channel",
    [
        (allowance_modifier, "personal_allowance"),
        (payment_modifier, "cost_of_living_support_payment"),
    ],
)
def test_structural_override_does_not_leak_into_later_simulations(
    modifier, channel
):
    situation = _pensioner(
        income=13_000 if modifier is allowance_modifier else 5000
    )
    before = Simulation(situation=situation)
    expected = _value(before, channel)
    reformed = Simulation(
        situation=situation, scenario=_policy(modifier).to_scenario()
    )
    assert _value(reformed, channel) != expected
    later = Simulation(situation=situation)
    assert _value(later, channel) == expected


@pytest.mark.parametrize(
    "modifier, channel, entity",
    [
        (allowance_modifier, "personal_allowance", "people"),
        (payment_modifier, "cost_of_living_support_payment", "households"),
        (vat_modifier, "vat", "households"),
        (property_modifier, "high_value_council_tax_surcharge", "households"),
    ],
)
def test_overrides_refuse_stored_input(modifier, channel, entity):
    situation = _situation(2028, domestic_energy_consumption=1680)
    situation[entity]["p" if entity == "people" else "h"][channel] = {2028: 0}
    with pytest.raises(ValueError, match=f"{channel} is a stored input"):
        Simulation(
            situation=situation, scenario=_policy(modifier).to_scenario()
        )


@pytest.mark.parametrize(
    "tenure",
    [
        "RENT_PRIVATELY",
        "RENT_FROM_COUNCIL",
        "RENT_FROM_HA",
        "OWNED_OUTRIGHT",
        "OWNED_WITH_MORTGAGE",
    ],
)
@pytest.mark.parametrize("base_value", [1_200_000, 2_500_000])
def test_property_surcharge_owners_only_in_new_and_existing_bands(
    tenure, base_value
):
    # Set current values to an exact synthetic 2026-price band position.
    from policyengine_uk.system import system

    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    current_value = base_value * gdp("2028") / gdp("2026")
    situation = _situation(
        2028, tenure_type=tenure, main_residence_value=current_value
    )
    sim = Simulation(
        situation=situation, scenario=_policy(property_modifier).to_scenario()
    )
    baseline = sim.baseline
    owner = tenure in ("OWNED_OUTRIGHT", "OWNED_WITH_MORTGAGE")
    native = _value(baseline, "high_value_council_tax_surcharge", 2028)
    changed = _value(sim, "high_value_council_tax_surcharge", 2028)
    if not owner:
        assert native == changed == 0
    elif base_value < 2_000_000:
        assert native == 0
        assert changed == 900
    else:
        assert changed == native > 0


@pytest.mark.parametrize("region", ["SCOTLAND", "WALES", "NORTHERN_IRELAND"])
def test_property_surcharge_geography(region):
    situation = _situation(
        2028, tenure_type="OWNED_OUTRIGHT", main_residence_value=1_200_000
    )
    situation["households"]["h"]["region"] = {2028: region}
    sim = Simulation(
        situation=situation, scenario=_policy(property_modifier).to_scenario()
    )
    assert _value(sim, "high_value_council_tax_surcharge", 2028) == 0


def _receipt_module():
    """policyengine's receipt code: released, or the copy the dashboard
    vendors until the release ships."""
    from uk_budget_data.publication.receipt import receipt_api

    module, _ = receipt_api()
    return module


def test_receipt_binds_module_template_modifiers_and_refuses_closure():
    receipt = _receipt_module()
    revision = {
        "repository": (
            "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026"
        ),
        "git_sha": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True
        ).strip(),
    }
    for modifier in (
        vat_modifier,
        payment_modifier,
        allowance_modifier,
        property_modifier,
    ):
        scenario = _policy(modifier).to_scenario()
        identity = receipt.scenario_reform_identity(
            scenario, code_revision=revision
        )
        assert identity.binding == "code_revision"
        assert len(identity.reform_sha256) == 64
    assert (
        receipt.scenario_reform_identity(
            Scenario(parameter_changes=rate_change(FUEL_PATH, {2027: 0.6}))
        ).binding
        == "content"
    )
    rate = -0.025

    def closure(sim):
        return apply_vat_base_change(
            sim,
            spending_variable="domestic_energy_consumption",
            rate_change=rate,
            start_year=2027,
            end_year=2028,
        )

    with pytest.raises(receipt.ReceiptError, match="closes over|module-level"):
        receipt.scenario_reform_identity(
            Scenario(simulation_modifier=closure), code_revision=revision
        )


def test_receipt_refuses_a_modifier_reading_a_partial_global():
    """W4's reproducer (policyengine.py#571): a partial hides the values it
    captured, so a module holding one cannot be bound."""
    receipt = _receipt_module()
    revision = {
        "repository": (
            "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026"
        ),
        "git_sha": "a" * 40,
    }
    with pytest.raises(receipt.ReceiptError, match="cannot be bound"):
        receipt.scenario_reform_identity(
            _policy(partial_payment_modifier).to_scenario(),
            code_revision=revision,
        )
