"""MOCK drill 4: hand-checked values for the parameter measures."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.reforms import get_reform


def _param(reform_id, path, year):
    sim = Simulation(
        situation={"people": {"a": {"age": 40}}},
        scenario=get_reform(reform_id).to_scenario(),
    )
    return sim.tax_benefit_system.parameters.get_child(path)(f"{year}-04-30")


def test_fuel_duty_day_weighted_by_hand():
    # 323 days at 52.95p and 42 days at 54.95p in 2026-27;
    # 178 days at 54.95p and 188 days at 56.95p in 2027-28 (leap year).
    path = "gov.hmrc.fuel_duty.petrol_and_diesel"
    assert _param("mock4_fuel_duty", path, 2026) == pytest.approx(
        0.531801, abs=1e-6
    )
    assert _param("mock4_fuel_duty", path, 2027) == pytest.approx(
        0.559773, abs=1e-6
    )


def test_parameter_values():
    assert (
        _param(
            "mock4_carers_allowance_limit",
            "gov.dwp.carers_allowance.earnings_limit",
            2027,
        )
        == 230
    )
    assert (
        _param(
            "mock4_savings_starting_band",
            "gov.hmrc.income_tax.rates.savings_starter_rate.allowance",
            2027,
        )
        == 5_000
    )
    assert (
        _param(
            "mock4_savings_starting_band",
            "gov.hmrc.income_tax.rates.savings_starter_rate.allowance",
            2028,
        )
        == 2_000
    )
    assert (
        _param("mock4_lha_reset", "gov.dwp.LHA.freeze", 2027) is False
        or _param("mock4_lha_reset", "gov.dwp.LHA.freeze", 2027) == 0
    )
    assert (
        _param(
            "mock4_threshold_freeze_2032",
            "gov.hmrc.income_tax.allowances.personal_allowance.amount",
            2031,
        )
        == 12_570
    )
    # 2027 baseline child element £310.93/month + £12.50.
    assert _param(
        "mock4_uc_child_element",
        "gov.dwp.universal_credit.elements.child.amount",
        2027,
    ) == pytest.approx(323.43, abs=0.01)


def test_cgt_higher_rate_household_by_hand():
    # £100,000 earnings and £20,000 gains in 2027-28: (20,000 − 3,000 AEA) × 2pp = £340.
    situation = {
        "people": {
            "a": {
                "age": 45,
                "employment_income": {"2027": 100_000, "2026": 100_000},
                "capital_gains": {"2027": 20_000, "2026": 20_000},
            }
        },
    }
    reform = get_reform("mock4_cgt_higher_rate").to_scenario()
    base = (
        Simulation(situation=situation)
        .calculate("capital_gains_tax", 2027)
        .sum()
    )
    new = (
        Simulation(situation=situation, scenario=reform)
        .calculate("capital_gains_tax", 2027)
        .sum()
    )
    assert new - base == pytest.approx(340, abs=1)
    base26 = (
        Simulation(situation=situation)
        .calculate("capital_gains_tax", 2026)
        .sum()
    )
    new26 = (
        Simulation(situation=situation, scenario=reform)
        .calculate("capital_gains_tax", 2026)
        .sum()
    )
    assert new26 == pytest.approx(base26, abs=0.01)
