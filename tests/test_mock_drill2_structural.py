"""MOCK drill 2 structural measures: hand-computed synthetic households.

MOCK DATA: rehearsal Budget for PolicyEngine drill 2. Not a real Budget.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data import mock_drill2_structural as mock2
from uk_budget_data.models import Reform
from uk_budget_data.personal_impact import (
    HouseholdInput,
    calculate_drill_impact,
)
from uk_budget_data.reforms import get_autumn_budget_2026_reforms, get_reform

SP_PA = "mock2_state_pension_personal_allowance"
ENERGY = "mock2_energy_price_payment"

# Engine full new State Pension, FY 2027-28: £250.711/week x 52 = £13,036.97.
NSP_WEEKLY = {
    y: system.parameters.gov.dwp.state_pension.new_state_pension.amount(
        f"{y}-01-01"
    )
    for y in (2027, 2029)
}
FULL_NSP_2027 = NSP_WEEKLY[2027] * 52

# Annex A full new State Pension a week (the integrator's baseline path).
ANNEX_A_NSP = {2027: 250.70, 2028: 259.75, 2029: 268.85, 2030: 278.00}
NSP_PATH = "gov.dwp.state_pension.new_state_pension.amount"


def _annex_a_reform():
    """The SP allowance measure on the Annex A State Pension path."""
    nsp = {NSP_PATH: {str(y): v for y, v in ANNEX_A_NSP.items()}}
    return Reform(
        id="annex_a_sp_pa",
        name="SP PA on Annex A path",
        description="test",
        baseline_parameter_changes=nsp,
        parameter_changes=nsp,
        simulation_modifier=mock2._state_pension_personal_allowance_modifier,
    )


def _pensioner(year, state_pension, other_pension=0.0, age=70):
    return {
        "people": {
            "p": {
                "age": {year: age},
                "state_pension_type": {year: "NEW"},
                "state_pension_reported": {year: state_pension},
                "private_pension_income": {year: other_pension},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def _run(situation, year, variables, policy=SP_PA):
    reform = get_reform(policy) if isinstance(policy, str) else policy
    out = {}
    for label, scenario in (
        ("baseline", reform.to_drill_scenario(baseline=True)),
        ("reform", reform.to_drill_scenario()),
    ):
        sim = Simulation(situation=situation, scenario=scenario)
        out[label] = {
            v: float(sim.calculate(v, year).sum()) for v in variables
        }
    return out


def test_both_measures_registered():
    ids = [r.id for r in get_autumn_budget_2026_reforms()]
    assert SP_PA in ids and ENERGY in ids


def test_full_new_state_pension_only_pays_no_tax_under_reform():
    # Baseline: tax = (13,036.97 - 12,570) x 20% = 466.97 x 0.2 = £93.39.
    # Reform: PA = 13,100 (ANI 13,036.97 < 20,000, no taper) > 13,036.97,
    # so taxable income is 0 and tax is £0.
    assert FULL_NSP_2027 == pytest.approx(13_036.97, abs=0.01)
    r = _run(
        _pensioner(2027, FULL_NSP_2027),
        2027,
        ["personal_allowance", "income_tax", "household_net_income"],
    )
    assert r["baseline"]["personal_allowance"] == 12_570
    assert r["baseline"]["income_tax"] == pytest.approx(93.39, abs=1)
    assert r["reform"]["personal_allowance"] == 13_100
    assert r["reform"]["income_tax"] == 0
    assert r["reform"]["household_net_income"] - r["baseline"][
        "household_net_income"
    ] == pytest.approx(r["baseline"]["income_tax"], abs=0.01)


def test_taper_at_25000_falls_back_to_standard_allowance():
    # ANI 25,000: higher PA = 13,100 - (25,000 - 20,000) x 0.5 = 10,600,
    # below the standard 12,570, so the standard 12,570 applies; no change.
    r = _run(
        _pensioner(2027, 12_000, other_pension=13_000),
        2027,
        ["adjusted_net_income", "personal_allowance", "income_tax"],
    )
    assert r["reform"]["adjusted_net_income"] == pytest.approx(25_000)
    assert r["reform"]["personal_allowance"] == 12_570
    assert r["reform"]["income_tax"] == r["baseline"]["income_tax"]


def test_taper_at_21000_gives_12600():
    # ANI 21,000: PA = 13,100 - (21,000 - 20,000) x 0.5 = 12,600.
    # Tax: baseline (21,000 - 12,570) x 20% = 1,686; reform
    # (21,000 - 12,600) x 20% = 1,680, a £6 cut (= 30 x 20%).
    r = _run(
        _pensioner(2027, 12_000, other_pension=9_000),
        2027,
        ["personal_allowance", "income_tax"],
    )
    assert r["reform"]["personal_allowance"] == 12_600
    assert r["baseline"]["income_tax"] == pytest.approx(1_686, abs=1)
    assert r["baseline"]["income_tax"] - r["reform"]["income_tax"] == (
        pytest.approx(6, abs=0.01)
    )


# Annex A chain, rounded up to the next £10 each year:
# 2028: 13,100 x 259.75 / 250.70 = 13,572.90 -> 13,580
# 2029: 13,580 x 268.85 / 259.75 = 14,055.76 -> 14,060
# 2030: 14,060 x 278.00 / 268.85 = 14,538.52 -> 14,540
ANNEX_A_SP_PA = {2027: 13_100, 2028: 13_580, 2029: 14_060, 2030: 14_540}


def test_uprating_chain_on_annex_a_path():
    for year, expected in ANNEX_A_SP_PA.items():
        assert (
            mock2.sp_personal_allowance_amount(year, ANNEX_A_NSP.get)
            == expected
        )


def test_uprating_chains_from_rounded_value_not_from_2027():
    # A ratio path where chaining matters: nSP +1% a year from 100.
    # 2028: 13,100 x 1.01 = 13,231 -> 13,240; 2029: 13,240 x 1.01 =
    # 13,372.4 -> 13,380. Unchained 13,100 x 1.0201 = 13,363.31 -> 13,370.
    path = {2027: 100.0, 2028: 101.0, 2029: 102.01}
    assert mock2.sp_personal_allowance_amount(2028, path.get) == 13_240
    assert mock2.sp_personal_allowance_amount(2029, path.get) == 13_380


@pytest.mark.parametrize("year", [2028, 2029, 2030])
def test_allowance_uprated_in_simulation_on_annex_a_path(year):
    r = _run(
        _pensioner(year, 13_000),
        year,
        ["personal_allowance"],
        policy=_annex_a_reform(),
    )
    assert r["baseline"]["personal_allowance"] == 12_570
    assert r["reform"]["personal_allowance"] == ANNEX_A_SP_PA[year]


def test_registered_measure_uses_annex_a_path_in_2028():
    r = _run(_pensioner(2028, 13_000), 2028, ["personal_allowance"])
    assert r["reform"]["personal_allowance"] == ANNEX_A_SP_PA[2028]


def test_taper_applied_after_rounding_in_2028():
    # ANI 21,000 in 2028: 13,580 - (21,000 - 20,000) x 0.5 = 13,080; the
    # £20,000 threshold is not uprated. Tax: (21,000 - 12,570) x 20% =
    # 1,686 baseline; (21,000 - 13,080) x 20% = 1,584 reform; £102 cut.
    r = _run(
        _pensioner(2028, 12_000, other_pension=9_000),
        2028,
        ["personal_allowance", "income_tax"],
        policy=_annex_a_reform(),
    )
    assert r["reform"]["personal_allowance"] == 13_080
    assert r["baseline"]["income_tax"] - r["reform"]["income_tax"] == (
        pytest.approx(102, abs=0.01)
    )


def test_basic_rate_limit_unchanged():
    # The measure changes no income tax parameter (the £37,700 basic rate
    # limit included); it only replaces the personal_allowance formula. Its
    # parameter changes are the Annex A State Pension path, set identically
    # in baseline and reform.
    reform = get_reform(SP_PA)
    changes = reform.parameter_changes or {}
    assert not [p for p in changes if p.startswith("gov.hmrc")]
    assert changes == (reform.baseline_parameter_changes or {})
    # ANI 60,000 in 2028: the higher allowance is gone (13,580 - 20,000 x
    # 0.5 < 12,570), so PA 12,570 and income tax are unchanged.
    r = _run(
        _pensioner(2028, 12_000, other_pension=48_000),
        2028,
        ["personal_allowance", "income_tax"],
        policy=_annex_a_reform(),
    )
    assert r["reform"] == r["baseline"]


def test_inert_before_2027_and_below_state_pension_age():
    # 2026 precedes April 2027: standard PA. A 50-year-old in 2027: standard.
    for year, age in ((2026, 70), (2027, 50)):
        r = _run(
            _pensioner(year, 0, other_pension=13_000, age=age),
            year,
            ["personal_allowance", "income_tax"],
        )
        assert r["reform"] == r["baseline"]
        assert r["reform"]["personal_allowance"] == 12_570


def test_hundred_k_taper_still_applies_to_pensioners():
    # ANI 110,000: higher PA long gone; standard = 12,570 - 10,000 x 0.5
    # = 7,570, the same as baseline.
    r = _run(
        _pensioner(2027, 12_000, other_pension=98_000),
        2027,
        ["personal_allowance"],
    )
    assert r["baseline"]["personal_allowance"] == 7_570
    assert r["reform"]["personal_allowance"] == 7_570


def _renter(year, income, region=None):
    return {
        "people": {
            "a": {"age": {year: 30}, "employment_income": {year: income}},
            "c": {"age": {year: 5}},
        },
        "benunits": {"b": {"members": ["a", "c"]}},
        "households": {
            "h": {
                "members": ["a", "c"],
                "rent": {year: 9_600},
                "tenure_type": {year: "RENT_PRIVATELY"},
                **({"region": {year: region}} if region else {}),
            }
        },
    }


@pytest.mark.parametrize(
    "income, expected",
    [
        # Low-paid lone parent renting: UC > 0, so £150 once.
        (10_000, 150),
        # £120,000 earner: no UC or Pension Credit, so £0.
        (120_000, 0),
    ],
)
def test_energy_payment_by_uc_receipt(income, expected):
    variables = [
        "universal_credit",
        "mock2_energy_price_payment",
        "household_net_income",
    ]
    reform = get_reform(ENERGY)
    base = Simulation(
        situation=_renter(2026, income),
        scenario=reform.to_drill_scenario(baseline=True),
    )
    sim = Simulation(
        situation=_renter(2026, income), scenario=reform.to_drill_scenario()
    )
    uc = float(sim.calculate("universal_credit", 2026).sum())
    assert (uc > 0) == (expected > 0)
    assert float(sim.calculate(variables[1], 2026).sum()) == expected
    change = float(sim.calculate(variables[2], 2026).sum()) - float(
        base.calculate(variables[2], 2026).sum()
    )
    assert change == pytest.approx(expected)
    # Not taxable and disregarded for benefits: UC is unchanged.
    assert uc == pytest.approx(
        float(base.calculate("universal_credit", 2026).sum())
    )
    # One-off in model year 2026 (FY 2026-27): nothing in 2027.
    assert float(sim.calculate(variables[1], 2027).sum()) == 0


def test_energy_payment_excludes_northern_ireland():
    # Same low-paid UC renter in Northern Ireland: UC > 0 but £0.
    sim = Simulation(
        situation=_renter(2026, 10_000, region="NORTHERN_IRELAND"),
        scenario=get_reform(ENERGY).to_drill_scenario(),
    )
    assert float(sim.calculate("universal_credit", 2026).sum()) > 0
    assert float(sim.calculate("mock2_energy_price_payment", 2026).sum()) == 0


def test_energy_payment_for_guarantee_credit_pensioner():
    # Single pensioner, £5,000 State Pension only: guarantee credit > 0.
    year = 2026
    situation = _pensioner(year, 5_000, age=75)
    sim = Simulation(
        situation=situation, scenario=get_reform(ENERGY).to_drill_scenario()
    )
    assert float(sim.calculate("guarantee_credit", year).sum()) > 0
    assert sim.calculate("in_receipt_of_guarantee_credit", year).all()
    assert (
        float(sim.calculate("mock2_energy_price_payment", year).sum()) == 150
    )


def test_energy_payment_once_for_pension_credit_and_uc_household():
    # Two benefit units in one household: a Pension Credit pensioner and a
    # UC renter. Both qualify, but the household receives £150 once.
    year = 2026
    situation = {
        "people": {
            "p": {
                "age": {year: 75},
                "state_pension_type": {year: "NEW"},
                "state_pension_reported": {year: 5_000},
            },
            "a": {"age": {year: 30}, "employment_income": {year: 5_000}},
        },
        "benunits": {"pb": {"members": ["p"]}, "ab": {"members": ["a"]}},
        "households": {
            "h": {
                "members": ["p", "a"],
                "rent": {year: 9_600},
                "tenure_type": {year: "RENT_PRIVATELY"},
            }
        },
    }
    sim = Simulation(
        situation=situation,
        scenario=get_reform(ENERGY).to_drill_scenario(),
    )
    eligible = sim.calculate("mock2_energy_price_payment_eligible", year)
    assert eligible.all()
    assert (
        float(sim.calculate("mock2_energy_price_payment", year).sum()) == 150
    )


def test_household_calculator_routes_both_measures():
    # Personal impact: a 70-year-old (in 2027) with the full new State
    # Pension. Age and SP inputs reach the measure: 2027 gain = baseline tax
    # (~£93); 2026 gain = 0. The full-SP pensioner gets no guarantee credit,
    # so no £150.
    household = HouseholdInput(
        employment_income=0,
        age_2025=68,
        state_pension_income=FULL_NSP_2027,
    )
    result = calculate_drill_impact(household, [SP_PA, ENERGY])
    sp = result["policies"][SP_PA]["years"]
    assert sp[2026]["net_income_change"] == 0
    assert sp[2027]["net_income_change"] == pytest.approx(93.39, abs=1)
    energy = result["policies"][ENERGY]["years"]
    assert all(energy[y]["net_income_change"] == 0 for y in energy)


def test_household_calculator_pays_uc_household():
    household = HouseholdInput(
        employment_income=10_000,
        children_ages=[3],
        rent=9_600,
        tenure_type="RENT_PRIVATELY",
    )
    result = calculate_drill_impact(household, [ENERGY])
    years = result["policies"][ENERGY]["years"]
    assert years[2026]["net_income_change"] == pytest.approx(150)
    assert years[2027]["net_income_change"] == 0
    assert years[2028]["net_income_change"] == 0


def test_constants_match_policy_costings():
    assert mock2.SP_PA_AMOUNT_2027 == 13_100
    assert mock2.SP_PA_TAPER_THRESHOLD == 20_000
    assert mock2.SP_PA_TAPER_RATE == 0.5
    assert mock2.SP_PA_ROUNDING == 10
    assert mock2.ENERGY_PAYMENT_AMOUNT == 150
    assert mock2.ENERGY_PAYMENT_YEAR == 2026


def test_structural_override_does_not_leak_into_later_simulations():
    situation = _pensioner(2027, 13_000)
    reformed = Simulation(
        situation=situation, scenario=get_reform(SP_PA).to_drill_scenario()
    )
    assert float(reformed.calculate("personal_allowance", 2027)[0]) == 13_100
    plain = Simulation(situation=situation)
    assert float(plain.calculate("personal_allowance", 2027)[0]) == 12_570
    Simulation(
        situation=situation, scenario=get_reform(ENERGY).to_drill_scenario()
    )
    assert "mock2_energy_price_payment" not in (
        Simulation(situation=situation).tax_benefit_system.variables
    )
