"""Invariants of the Pension Tax Allowance (``pension_tax_allowance``), run on
whichever policyengine-uk is installed.

Examples run on branches of one simulation of invented single-person
households, so Hypothesis reaches hundreds of them. Amounts in the model are
float32, so comparisons allow a penny, and rates on £30 of income.
"""

from functools import lru_cache
from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.dates import MONTHS_FROM_TAX_YEAR_START_TO_MID_YEAR
from policyengine_uk.utils.scenario import Scenario

from tests.pta_households import (
    PENNY,
    REGIONS,
    SLOTS,
    YEARS,
    band_positions,
    calculate,
    contributions,
    examples,
    in_band,
    mixes,
    rule_for,
    situation_for,
    split,
    years,
)
from uk_budget_data.budget_measures.pension_tax_allowance import (
    MONTHS_TO_MID_YEAR,
    STEP_7_CHARGES,
    TAX_BEFORE_WINTER_FUEL_CHARGE,
    pension_tax_allowance,
)

HAS_CHARGE = "winter_fuel_payment_charge" in system.variables
HAS_NATIVE_ALLOWANCE = "pension_tax_allowance" in system.variables
ANNUAL_ALLOWANCE_INPUT = "employer_pension_contributions"
ANNUAL_ALLOWANCE_CHARGE = "personal_pension_contributions_tax"
RATE_TAXES = {
    "earned_income_tax",
    "savings_income_tax",
    "dividend_income_tax",
    "property_income_tax",
}
needs_charge = pytest.mark.skipif(
    not HAS_CHARGE, reason="this engine has no Winter Fuel Payment charge"
)
without_native_allowance = pytest.mark.skipif(
    HAS_NATIVE_ALLOWANCE,
    reason="this engine has the allowance in current law, so it is refused",
)
pytestmark = without_native_allowance
slots = st.lists(
    st.floats(min_value=0, max_value=1), min_size=SLOTS, max_size=SLOTS
)


@lru_cache(maxsize=None)
def _simulations():
    baseline = Simulation(situation=situation_for())
    reformed = Simulation(situation=situation_for())
    pension_tax_allowance(reformed)
    return baseline, reformed


def _both(year, inputs, outputs=("income_tax",)):
    baseline, reformed = _simulations()
    return (
        calculate(baseline, year, inputs, outputs),
        calculate(reformed, year, inputs, outputs),
    )


def test_the_fast_path_matches_a_fresh_simulation():
    """The branches these tests run on give what a simulation built for the
    same households gives."""
    rule = rule_for(2028)
    income = in_band(rule, np.linspace(-0.5, 1.5, SLOTS))
    ([without], [with_allowance]) = _both(2028, {"state_pension": income})
    situation = situation_for()
    for i in range(SLOTS):
        situation["people"][f"p{i}"]["state_pension"] = {
            2028: float(income[i])
        }
    fresh = Simulation(situation=situation)
    assert np.asarray(fresh.calculate("income_tax", 2028)) == pytest.approx(
        without, abs=PENNY
    )
    pension_tax_allowance(fresh := Simulation(situation=situation))
    assert np.asarray(fresh.calculate("income_tax", 2028)) == pytest.approx(
        with_allowance, abs=PENNY
    )


@pytest.mark.parametrize(
    "year, full_state_pension, allowance, top",
    [(2027, 13_036.40, 94, 13_318.40)],
)
def test_the_rule_gives_the_explainers_amounts(
    year, full_state_pension, allowance, top
):
    rule = rule_for(year)
    assert rule.full_state_pension == pytest.approx(full_state_pension)
    assert rule.allowance == allowance
    assert rule.top == pytest.approx(top)


@pytest.mark.parametrize("year", YEARS)
def test_the_full_new_state_pension_pays_no_income_tax(year):
    """The Budget's aim (6.182): pensioners "whose total income is up to the
    value of the full new State Pension" pay no income tax, in Scotland
    too. The engine pays 52 x its unrounded weekly rate, which can sit
    above the band's bottom, and the allowance still clears the tax on
    it."""
    rule = rule_for(year)
    paid = np.full(SLOTS, rule.paid)
    ([without], [with_allowance]) = _both(year, {"state_pension": paid})
    assert (without > 1).all()
    assert with_allowance == pytest.approx(0, abs=PENNY)


@examples
@given(years, band_positions, mixes)
def test_tax_with_the_allowance_never_exceeds_tax_without(
    year, positions, mix
):
    inputs = split(in_band(rule_for(year), positions), mix)
    ([without], [with_allowance]) = _both(year, inputs)
    assert (with_allowance <= without + PENNY).all()


@examples
@given(years, st.lists(st.floats(0, 90_000), min_size=SLOTS, max_size=SLOTS))
def test_the_allowance_is_non_refundable(year, income):
    ([without], [with_allowance]) = _both(year, {"state_pension": income})
    assert (with_allowance >= -PENNY).all()
    assert (without - with_allowance <= rule_for(year).allowance + PENNY).all()


@examples
@given(years, band_positions, mixes)
def test_tax_matches_at_and_past_the_top_of_the_band(year, positions, mix):
    rule = rule_for(year)
    # At or above 1, every slot sits at the top of the band or past it.
    above = np.maximum(1, np.asarray(positions))
    inputs = split(in_band(rule, above), mix)
    ([without, total], [with_allowance, _]) = _both(
        year, inputs, ("income_tax", "total_income")
    )
    past = total >= rule.top - PENNY
    assert past.any()
    assert with_allowance[past] == pytest.approx(without[past], abs=PENNY)


@examples
@given(years, slots)
def test_the_rate_on_the_band_is_a_third_above_the_rate_without(year, shares):
    """On the taper, each £3 of income takes £1 of allowance on top of the
    tax itself: 53.3% at the 20% basic rate, in England, Wales and Northern
    Ireland. Scottish taxpayers have the same third on the starter rate."""
    rule = rule_for(year)
    step = 30.0
    income = in_band(rule, np.asarray(shares)) - step
    income = np.maximum(income, rule.full_state_pension)
    ([without], [with_allowance]) = _both(year, {"state_pension": income})
    ([without_more], [with_more]) = _both(
        year, {"state_pension": income + step}
    )
    on_the_taper = (with_allowance > PENNY) & (income + step <= rule.top)
    rate = (with_more - with_allowance) / step
    rate_without = (without_more - without) / step
    assert rate[on_the_taper] == pytest.approx(
        rate_without[on_the_taper] + 1 / 3, abs=2e-4
    )
    outside_scotland = np.array(REGIONS) != "SCOTLAND"
    assert rate[on_the_taper & outside_scotland] == pytest.approx(
        0.2 + 1 / 3, abs=2e-4
    )


@examples
@given(
    years,
    st.lists(st.floats(0, 34_000), min_size=SLOTS, max_size=SLOTS),
    st.floats(min_value=1, max_value=500),
)
def test_income_after_tax_rises_with_income(year, income, more):
    """Up to the Winter Fuel Payment charge's £35,000, where income after tax
    falls with or without the allowance: the whole payment comes back."""
    income = np.asarray(income)
    (_, [lower]) = _both(year, {"state_pension": income})
    (_, [higher]) = _both(year, {"state_pension": income + more})
    assert ((income + more - higher) >= (income - lower) - PENNY).all()


@examples
@given(years, slots)
def test_the_models_allowance_is_within_a_pound_of_the_budgets_formula(
    year, shares
):
    """Where the taper binds, the reduction plus a third of the income above
    the band's bottom gives back the full allowance A."""
    rule = rule_for(year)
    income = in_band(rule, shares)
    ([without], [with_allowance]) = _both(year, {"state_pension": income})
    binding = with_allowance > PENNY
    implied = without - with_allowance + (income - rule.full_state_pension) / 3
    assert implied[binding] == pytest.approx(rule.allowance, abs=PENNY)
    gap = 0.2 * (rule.full_state_pension - rule.personal_allowance)
    assert abs(rule.allowance - gap) <= 1


@pytest.mark.parametrize(
    "weekly, full_state_pension, allowance",
    [
        # Down to the nearest 5p, then £93.28 rounded up to the pound
        (250.71, 13_036.40, 94),
        # Up to the nearest 5p, then £93.80 rounded up to the pound
        (250.73, 13_039.00, 94),
        # 20% of the gap is a whole pound, so it stays that pound
        (250.00, 13_000.00, 86),
        (255.00, 13_260.00, 138),
    ],
)
def test_the_allowance_rounds_up_from_a_5p_weekly_rate(
    weekly, full_state_pension, allowance
):
    """£30 into the band, the taper takes £10 and leaves tax to cover the
    rest, so the reduction shows A itself."""
    scenario = Scenario(
        parameter_changes={
            "gov.dwp.state_pension.new_state_pension.amount": {
                "2027-01-01.2027-12-31": weekly
            }
        }
    )
    situation = {
        "people": {
            "p": {
                "age": {2027: 70},
                "state_pension": {2027: full_state_pension + 30},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2027: "LONDON"}}},
    }
    baseline = Simulation(situation=situation, scenario=scenario)
    reformed = Simulation(situation=situation, scenario=scenario)
    pension_tax_allowance(reformed)
    reduction = float(baseline.calculate("income_tax", 2027)[0]) - float(
        reformed.calculate("income_tax", 2027)[0]
    )
    assert reduction == pytest.approx(allowance - 10, abs=PENNY)


def test_the_months_to_mid_year_are_the_engines():
    assert MONTHS_TO_MID_YEAR == MONTHS_FROM_TAX_YEAR_START_TO_MID_YEAR


def _reaching(date_of_birth, year=2027, income=13_036.40):
    """A person born on the date, with the age it gives on 6 October."""
    age = year - date_of_birth // 10_000 - (date_of_birth % 10_000 > 1006)
    situation = {
        "people": {
            "p": {
                "age": {year: age},
                "date_of_birth": {year: date_of_birth},
                "state_pension": {year: income},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    pension_tax_allowance(reformed)
    return (
        float(baseline.calculate("income_tax", year)[0]),
        float(reformed.calculate("income_tax", year)[0]),
        float(baseline.calculate("months_since_state_pension_age", year)[0]),
        bool(baseline.calculate("is_SP_age", year)[0]),
    )


@pytest.mark.parametrize(
    "year, date_of_birth, qualifies",
    [
        # Attains 67 on 5 April, the last day of the tax year
        (2027, 19610405, True),
        (2028, 19620405, True),
        (2029, 19630405, True),
        # Attains 67 on 6 April, the first day of the next tax year
        (2027, 19610406, False),
        (2028, 19620406, False),
        (2029, 19630406, False),
    ],
)
def test_the_tax_year_ends_on_5_april(year, date_of_birth, qualifies):
    rule = rule_for(year)
    without, with_allowance, _, _ = _reaching(
        date_of_birth, year, rule.full_state_pension
    )
    tax = 0.2 * (rule.full_state_pension - rule.personal_allowance)
    assert without == pytest.approx(tax, abs=PENNY)
    assert with_allowance == pytest.approx(0 if qualifies else tax, abs=PENNY)


@pytest.mark.parametrize(
    "year, date_of_birth",
    [(2027, 19610120), (2028, 19620120), (2029, 19630120)],
)
def test_reaching_state_pension_age_after_6_october_qualifies(
    year, date_of_birth
):
    """The engine's is_SP_age says no here, which is why the measure does
    not read it: this person attains State Pension age in the second half
    of the tax year."""
    _, with_allowance, months, over_at_mid_year = _reaching(
        date_of_birth, year, rule_for(year).full_state_pension
    )
    assert -6 < months < 0
    assert not over_at_mid_year
    assert with_allowance == pytest.approx(0, abs=PENNY)


def _with_annual_allowance_charge(year, income, paid_in=70_000.0):
    """Tax and the charge for people with this State Pension, whose employers
    paid in past the annual allowance."""
    inputs = {
        "state_pension": np.full(SLOTS, float(income)),
        ANNUAL_ALLOWANCE_INPUT: np.full(SLOTS, paid_in),
    }
    outputs = ("income_tax", ANNUAL_ALLOWANCE_CHARGE)
    ([without, charge], [with_allowance, _]) = _both(year, inputs, outputs)
    return without, with_allowance, charge


@pytest.mark.parametrize("year", YEARS)
def test_the_allowance_never_offsets_the_annual_allowance_charge(year):
    """Income at the personal allowance leaves no tax at Step 5, so the
    allowance has nothing to come off and the Step 7 charge stays whole."""
    without, with_allowance, charge = _with_annual_allowance_charge(
        year, rule_for(year).personal_allowance
    )
    assert (charge > 0).all()
    assert without == pytest.approx(charge, abs=PENNY)
    assert with_allowance == pytest.approx(charge, abs=PENNY)


@pytest.mark.parametrize("year", YEARS)
def test_the_allowance_stops_at_the_tax_before_the_charge(year):
    """£100 above the personal allowance leaves £20 of tax at 20%, less than
    the allowance. The reduction takes the £20 and no more."""
    rule = rule_for(year)
    without, with_allowance, charge = _with_annual_allowance_charge(
        year, rule.personal_allowance + 100
    )
    outside_scotland = np.array(REGIONS) != "SCOTLAND"
    assert (rule.allowance > 20) and (charge > 0).all()
    assert without[outside_scotland] == pytest.approx(
        charge[outside_scotland] + 20, abs=PENNY
    )
    assert with_allowance == pytest.approx(charge, abs=PENNY)


@examples
@given(years, band_positions, mixes, contributions)
def test_the_allowance_comes_off_only_the_tax_before_the_charges(
    year, positions, mix, paid_in
):
    """Step 6 takes the allowance off the Step 5 tax, and Step 7 adds the
    charges after it, so the charges stay whole for every household."""
    rule = rule_for(year)
    inputs = {
        **split(in_band(rule, positions), mix),
        ANNUAL_ALLOWANCE_INPUT: paid_in,
    }
    outputs = ("income_tax", *STEP_7_CHARGES, "total_income")
    ([without, *charges, total], [with_allowance, *_]) = _both(
        year, inputs, outputs
    )
    charged = sum(charges)
    step_5_tax = without - charged
    excess = np.maximum(0, total - rule.full_state_pension)
    reduction = np.maximum(0, rule.allowance - excess / 3)
    assert without - with_allowance == pytest.approx(
        np.minimum(reduction, step_5_tax), abs=2 * PENNY
    )
    assert (with_allowance >= charged - PENNY).all()


def test_the_allowance_never_offsets_the_child_benefit_charge():
    """A pensioner on the full new State Pension, claiming Child Benefit for
    a child of 10, with the charge's thresholds moved into the band so the
    two meet, as they cannot at the Budget's amounts (the charge starts at
    £60,000 of adjusted net income). The allowance clears the £93.28 of tax
    and leaves the charge whole."""
    year = 2027
    situation = {
        "people": {
            "p": {"age": {year: 70}, "state_pension": {year: 13_036.40}},
            "c": {"age": {year: 10}},
        },
        "benunits": {
            "b": {
                "members": ["p", "c"],
                "would_claim_child_benefit": {year: True},
            }
        },
        "households": {
            "h": {"members": ["p", "c"], "region": {year: "LONDON"}}
        },
    }
    path = "gov.hmrc.income_tax.charges.CB_HITC"
    changes = {
        f"{path}.phase_out_start": {str(year): 12_000},
        f"{path}.phase_out_end": {str(year): 20_000},
    }
    baseline = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=changes)
    )
    reformed = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=changes)
    )
    pension_tax_allowance(reformed)
    charge = float(reformed.calculate("CB_HITC", year)[0])
    assert charge > 0
    assert float(baseline.calculate("income_tax", year)[0]) == pytest.approx(
        93.28 + charge, abs=PENNY
    )
    assert float(reformed.calculate("income_tax", year)[0]) == pytest.approx(
        charge, abs=PENNY
    )


def test_the_step_7_charges_are_the_engines():
    """The cap takes these off the engine's tax, so a new charge among the
    engine's additions has to join them."""
    income_tax = system.parameters.gov.hmrc.income_tax
    on = "2027-04-06"
    if "income_tax_charges" in system.variables:
        charges = income_tax.step_7_additional_tax(on)
    else:
        charges = set(income_tax.income_tax_additions(on)) - RATE_TAXES
    assert set(charges) == set(STEP_7_CHARGES)


def _with_charge_threshold(threshold, year=2027, income=13_036.40):
    """A pensioner in England, with the charge's threshold moved into the
    band so the two meet, as they cannot at the Budget's amounts."""
    situation = {
        "people": {"p": {"age": {year: 70}, "state_pension": {year: income}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }
    path = "gov.hmrc.income_tax.charges.winter_fuel_payment.income_threshold"
    changes = {path: {str(year): threshold}}
    baseline = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=changes)
    )
    reformed = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=changes)
    )
    pension_tax_allowance(reformed)
    return baseline, reformed


@needs_charge
def test_the_allowance_never_offsets_the_charge():
    """£93.28 of tax on the full new State Pension, with a £94 allowance:
    the spare 72p does not reach the charge, which stays whole. The charge
    comes at Step 7, after the Step 6 reductions."""
    year = 2027
    baseline, reformed = _with_charge_threshold(13_000, year)
    charge = float(reformed.calculate("winter_fuel_payment_charge", year)[0])
    assert charge > 0
    assert float(baseline.calculate("income_tax", year)[0]) == pytest.approx(
        93.28 + charge, abs=PENNY
    )
    assert float(
        reformed.calculate(TAX_BEFORE_WINTER_FUEL_CHARGE, year)[0]
    ) == pytest.approx(0, abs=PENNY)
    assert float(reformed.calculate("income_tax", year)[0]) == pytest.approx(
        charge, abs=PENNY
    )


@needs_charge
@examples
@given(
    years,
    st.lists(st.floats(0, 60_000), min_size=SLOTS, max_size=SLOTS),
)
def test_the_charge_and_the_allowance_never_meet(year, income):
    """At the Budget's amounts nobody has both, so the choice above moves no
    figure."""
    baseline, reformed = _simulations()
    [without, charge] = calculate(
        baseline,
        year,
        {"state_pension": income},
        ("income_tax", "winter_fuel_payment_charge"),
    )
    [with_allowance] = calculate(reformed, year, {"state_pension": income})
    charged = charge > 0
    assert with_allowance[charged] == pytest.approx(
        without[charged], abs=PENNY
    )
    threshold = system.parameters(
        f"{year}-04-06"
    ).gov.hmrc.income_tax.charges.winter_fuel_payment.income_threshold
    assert rule_for(year).top < threshold


@needs_charge
def test_the_property_allowance_election_keeps_its_ceiling():
    """Wrapping income_tax itself would turn this off, and leave the means
    tests reading tax without the allowance."""
    from policyengine_uk.variables.gov.hmrc.income_tax.allowances.uses_property_allowance import (  # noqa: E501
        ceiling_bounds_the_charge,
    )

    _, reformed = _simulations()
    assert ceiling_bounds_the_charge(reformed, 2027)


def _single_earner(claims_pension_credit, year=2027):
    """A pensioner with a small State Pension and part-time pay, renting and
    claiming Housing Benefit."""
    return {
        "people": {
            "p": {
                "age": {year: 70},
                "state_pension": {year: 9_000},
                "employment_income": {year: 4_036.40},
            }
        },
        "benunits": {
            "b": {
                "members": ["p"],
                "would_claim_pc": {year: claims_pension_credit},
                "would_claim_housing_benefit": {year: True},
            }
        },
        "households": {
            "h": {
                "members": ["p"],
                "region": {year: "NORTH_WEST"},
                "tenure_type": {year: "RENT_PRIVATELY"},
                "rent": {year: 6_000},
                "council_tax": {year: 1_500},
            }
        },
    }


@pytest.mark.parametrize(
    "variable, claims_pension_credit",
    [
        ("pension_credit_income", True),
        # A guarantee credit recipient's whole income is disregarded, so
        # these two take someone outside Pension Credit.
        ("housing_benefit_applicable_income", False),
        ("council_tax_reduction_applicable_income", False),
    ],
)
def test_the_means_tests_see_the_tax_after_the_allowance(
    variable, claims_pension_credit
):
    """Each counts income after tax, so income tax £93.28 lower is income
    £93.28 higher, whichever variable the measure wraps."""
    year = 2027
    situation = _single_earner(claims_pension_credit)
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    pension_tax_allowance(reformed)
    used = float(
        baseline.calculate("income_tax", year)[0]
        - reformed.calculate("income_tax", year)[0]
    )
    assert used == pytest.approx(93.28, abs=PENNY)
    change = float(
        reformed.calculate(variable, year)[0]
        - baseline.calculate(variable, year)[0]
    )
    assert change == pytest.approx(used, abs=PENNY)


def test_universal_credit_takes_the_allowance_off_the_employment_first():
    """A pensioner in 2029-30 with £12,800 of pay and £1,100 of trade. The
    engine takes the pay as the lowest slice, so the tax on it is small, and
    the allowance used exceeds it. The allowance clears the tax on the pay
    and the rest comes off the tax on the trade."""
    year = 2029
    situation = {
        "people": {
            "p": {
                "age": {year: 70},
                "employment_income": {year: 12_800},
                "self_employment_income": {year: 1_100},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    pension_tax_allowance(reformed)

    def split_of(sim):
        earnings = float(sim.calculate("uc_income_tax_on_earnings", year)[0])
        trade = float(sim.calculate("uc_income_tax_on_trade", year)[0])
        return earnings - trade, trade

    used = float(
        baseline.calculate("income_tax", year)[0]
        - reformed.calculate("income_tax", year)[0]
    )
    employment, trade = split_of(baseline)
    employment_after, trade_after = split_of(reformed)
    assert 0 < employment < used < employment + trade
    assert employment_after == pytest.approx(0, abs=PENNY)
    assert trade_after == pytest.approx(trade - (used - employment), abs=PENNY)


class PastTheRefusal(Exception):
    pass


def _sim_with_allowance(in_effect):
    def get_variable(name):
        raise PastTheRefusal

    reliefs = SimpleNamespace(
        pension_tax_allowance=SimpleNamespace(
            in_effect=lambda instant: in_effect
        )
    )
    return SimpleNamespace(
        tax_benefit_system=SimpleNamespace(
            variables={"pension_tax_allowance": object()},
            parameters=SimpleNamespace(
                gov=SimpleNamespace(
                    hmrc=SimpleNamespace(
                        income_tax=SimpleNamespace(reliefs=reliefs)
                    )
                )
            ),
            get_variable=get_variable,
        )
    )


def test_an_engine_with_the_allowance_in_force_is_refused():
    with pytest.raises(ValueError, match="count it twice"):
        pension_tax_allowance(_sim_with_allowance(True))


def test_an_engine_with_the_allowance_switched_off_is_not():
    with pytest.raises(PastTheRefusal):
        pension_tax_allowance(_sim_with_allowance(False))
