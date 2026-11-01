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
    band_positions,
    calculate,
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
    TAX_BEFORE_WINTER_FUEL_CHARGE,
    pension_tax_allowance,
)

HAS_CHARGE = "winter_fuel_payment_charge" in system.variables
HAS_NATIVE_ALLOWANCE = "pension_tax_allowance" in system.variables
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
        # A 5p step down, then £93.28 rounded up to the pound
        (250.74, 13_036.40, 94),
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
    "date_of_birth, qualifies",
    [
        # Attains 67 on 5 April 2028, the last day of 2027-28
        (19610405, True),
        # Attains 67 on 6 April 2028, the first day of 2028-29
        (19610406, False),
    ],
)
def test_the_tax_year_ends_on_5_april(date_of_birth, qualifies):
    without, with_allowance, _, _ = _reaching(date_of_birth)
    assert without == pytest.approx(93.28, abs=PENNY)
    assert with_allowance == pytest.approx(
        0 if qualifies else 93.28, abs=PENNY
    )


def test_reaching_state_pension_age_after_6_october_qualifies():
    """The engine's is_SP_age says no here, which is why the measure does
    not read it: this person attains State Pension age in the second half
    of the tax year."""
    _, with_allowance, months, over_at_mid_year = _reaching(19610120)
    assert -6 < months < 0
    assert not over_at_mid_year
    assert with_allowance == pytest.approx(0, abs=PENNY)


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
