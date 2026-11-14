"""The Pension Tax Allowance after its port to the split income_tax, against
the template before it (tests/pension_tax_allowance_before_port.py) and
against the engine's own allowance where it has one.

The port means to differ from the template in three places. People reaching
State Pension age between 6 October and 5 April now qualify, as the explainer
says. The allowance no longer offsets the annual allowance charge, which comes
at Step 7, after the Step 6 reductions. The weekly rate rounds to the nearest
5p, not down, so the differentials run at rates already on a 5p step.
Everyone else matches.
"""

import json
import math
from functools import lru_cache

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from tests.pension_tax_allowance_before_port import (
    FIXTURE,
    pension_tax_allowance_before_port,
    situation,
)
from tests.pta_households import (
    PENNY,
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
    TAX_BEFORE_WINTER_FUEL_CHARGE,
    pension_tax_allowance,
)

HAS_CHARGE = "winter_fuel_payment_charge" in system.variables
HAS_NATIVE_ALLOWANCE = "pension_tax_allowance" in system.variables
HAS_CLAIM_STATUS = "trading_allowance_claim_status" in system.variables
OLD_TEMPLATE_RUNS = not system.get_variable("income_tax").adds
UC_TAX = ("uc_income_tax_on_earnings", "uc_income_tax_on_trade")
NATIVE_SWITCH = "gov.hmrc.income_tax.reliefs.pension_tax_allowance.in_effect"
STATE_PENSION_RATE = "gov.dwp.state_pension.new_state_pension.amount"
ANNUAL_ALLOWANCE_INPUT = "employer_pension_contributions"
ANNUAL_ALLOWANCE_CHARGE = "personal_pension_contributions_tax"

ages = st.lists(
    st.integers(min_value=60, max_value=72), min_size=SLOTS, max_size=SLOTS
)
months = st.lists(
    st.floats(min_value=0, max_value=11.9), min_size=SLOTS, max_size=SLOTS
)


def _pensioner():
    return situation_for()


@pytest.mark.skipif(
    OLD_TEMPLATE_RUNS, reason="income_tax has a formula on this engine"
)
def test_the_old_template_is_refused():
    """The reason for the port: income_tax only adds the tax before the
    Winter Fuel Payment charge to the charge."""
    assert (
        TAX_BEFORE_WINTER_FUEL_CHARGE in system.get_variable("income_tax").adds
    )
    with pytest.raises(ValueError, match="built from adds or subtracts"):
        pension_tax_allowance_before_port(Simulation(situation=_pensioner()))


def _down_to_5p(weekly):
    """The old template's rounding of the weekly rate."""
    return math.floor(round(float(weekly) * 100, 6) / 5) * 5 / 100


def _template_rate(year):
    return _down_to_5p(
        system.parameters(
            f"{year}-04-06"
        ).gov.dwp.state_pension.new_state_pension.amount
    )


def _on_a_5p_step():
    """Intended: the port rounds the weekly rate to the nearest 5p, where the
    template rounded down, so on 2.151.0 the band starts £2.60 higher in
    2028-29. The template's own rate, already on a 5p step, gives both the
    same band."""
    return Scenario(
        parameter_changes={
            STATE_PENSION_RATE: {
                f"{year}-01-01.{year}-12-31": _template_rate(year)
                for year in YEARS
            }
        }
    )


@lru_cache(maxsize=None)
def _old_and_ported():
    old = Simulation(situation=_pensioner(), scenario=_on_a_5p_step())
    pension_tax_allowance_before_port(old)
    ported = Simulation(situation=_pensioner(), scenario=_on_a_5p_step())
    pension_tax_allowance(ported)
    return old, ported


@pytest.mark.skipif(
    not OLD_TEMPLATE_RUNS or HAS_NATIVE_ALLOWANCE,
    reason="the old template runs only where income_tax has a formula",
)
@examples
@given(years, band_positions, mixes, ages, months)
def test_the_port_matches_the_old_template(
    year, positions, mix, age, months_since_birthday
):
    rule = rule_for(year, _template_rate(year))
    inputs = {
        **split(in_band(rule, positions), mix),
        "age": age,
        "months_since_last_birthday": months_since_birthday,
    }
    old, ported = _old_and_ported()
    outputs = (
        "income_tax",
        *UC_TAX,
        "months_since_state_pension_age",
        "total_income",
    )
    old_tax, *old_uc, since, total = calculate(old, year, inputs, outputs)
    new_tax, *new_uc, _, _ = calculate(ported, year, inputs, outputs)
    # Intended: people reaching State Pension age after 6 October in the tax
    # year get the allowance, which the template gave them none of.
    reaching = (since < 0) & (since > -6)
    assert new_tax[~reaching] == pytest.approx(old_tax[~reaching], abs=PENNY)
    excess = np.maximum(0, total - rule.full_state_pension)
    reduction = np.maximum(0, rule.allowance - excess / 3)
    assert new_tax[reaching] == pytest.approx(
        np.maximum(0, old_tax - reduction)[reaching], abs=2 * PENNY
    )
    for before, after in zip(old_uc, new_uc):
        assert after[~reaching] == pytest.approx(before[~reaching], abs=PENNY)


@pytest.mark.skipif(
    not OLD_TEMPLATE_RUNS or HAS_NATIVE_ALLOWANCE,
    reason="the old template runs only where income_tax has a formula",
)
@pytest.mark.parametrize("year", YEARS)
def test_the_port_keeps_the_annual_allowance_charge_the_template_offset(year):
    """Intended: income at the personal allowance leaves no tax at Step 5, so
    the template took its whole allowance off the charge. The port leaves the
    charge whole."""
    rule = rule_for(year, _template_rate(year))
    inputs = {
        "state_pension": [rule.personal_allowance] * SLOTS,
        ANNUAL_ALLOWANCE_INPUT: [70_000.0] * SLOTS,
    }
    old, ported = _old_and_ported()
    [old_tax] = calculate(old, year, inputs)
    [new_tax, charge] = calculate(
        ported, year, inputs, ("income_tax", ANNUAL_ALLOWANCE_CHARGE)
    )
    assert (charge > 0).all()
    assert new_tax == pytest.approx(charge, abs=PENNY)
    assert old_tax == pytest.approx(charge - rule.allowance, abs=PENNY)


@pytest.mark.skipif(
    HAS_NATIVE_ALLOWANCE,
    reason="this engine has the allowance in current law, so it is refused",
)
@pytest.mark.parametrize("year", YEARS)
def test_the_port_gives_what_the_old_template_gave_on_2_151_0(year):
    """Households the old template ran on 2.151.0, against the port on this
    engine, at the State Pension rates of 2.151.0 down to 5p, as the
    template took them (see _on_a_5p_step): later engines carry the October
    2026 forecast, which moves the band. The reduction matches
    everywhere. Tax matches too wherever the Winter Fuel Payment charge does
    not apply, outside Scotland: later engines move Scotland's starter and
    basic bands (the first ends £4,102.67 above the personal allowance, not
    £4,046.33, in 2027-28), which start above the allowance's band."""
    fixture = json.loads(FIXTURE.read_text())
    rows = [row for row in fixture["rows"] if row["year"] == year]
    at_those_rates = Scenario(
        parameter_changes={
            STATE_PENSION_RATE: {
                f"{year}-01-01.{year + 1}-12-31": _down_to_5p(
                    fixture["weekly_rates"][str(year)]
                )
            }
        }
    )
    baseline = Simulation(
        situation=situation(rows, year), scenario=at_those_rates
    )
    reformed = Simulation(
        situation=situation(rows, year), scenario=at_those_rates
    )
    pension_tax_allowance(reformed)
    without = np.asarray(baseline.calculate("income_tax", year), dtype=float)
    tax = np.asarray(reformed.calculate("income_tax", year), dtype=float)
    old_without = np.array(
        [row["income_tax_without_allowance"] for row in rows]
    )
    old_tax = np.array([row["income_tax_with_allowance"] for row in rows])
    assert (old_without - old_tax > PENNY).any()
    assert without - tax == pytest.approx(old_without - old_tax, abs=2 * PENNY)

    charge = (
        np.asarray(
            reformed.calculate("winter_fuel_payment_charge", year), dtype=float
        )
        if HAS_CHARGE
        else np.zeros(len(rows))
    )
    assert (charge > 0).any() == HAS_CHARGE
    outside_scotland = np.array([row["region"] for row in rows]) != "SCOTLAND"
    compared = (charge == 0) & outside_scotland
    assert tax[compared] == pytest.approx(old_tax[compared], abs=2 * PENNY)


@pytest.mark.skipif(
    not HAS_NATIVE_ALLOWANCE,
    reason="this engine has no allowance of its own",
)
def test_an_engine_with_the_allowance_in_current_law_is_refused():
    with pytest.raises(ValueError, match="count it twice"):
        pension_tax_allowance(Simulation(situation=_pensioner()))


def _engine_rates_sit_on_5p_steps():
    """policyengine-uk#2751 (in 2.170.2 and later) rounds the engine's
    forecast rates to the nearest 5p; engines before it carry unrounded
    rates."""
    return all(
        math.isclose(round(rate * 20), rate * 20, abs_tol=1e-6)
        for rate in (
            float(
                system.parameters(
                    f"{year}-04-06"
                ).gov.dwp.state_pension.new_state_pension.amount
            )
            for year in YEARS
        )
    )


def _without_the_native_allowance():
    return Scenario(
        parameter_changes={
            NATIVE_SWITCH: {str(year): False for year in YEARS},
        }
    )


def _ported(situation):
    """The engine with its own allowance switched off and the port applied.
    The engine's threshold is 52 x its weekly rate. Where that rate sits on a
    5p step, the port runs at its own rounding, as the dashboard runs it.
    Elsewhere the comparison leaves out the port's rounding to 5p."""
    ported = Simulation(
        situation=situation, scenario=_without_the_native_allowance()
    )
    if _engine_rates_sit_on_5p_steps():
        pension_tax_allowance(ported)
    else:
        pension_tax_allowance(ported, weekly_rounding=1e-6)
    return ported


@lru_cache(maxsize=None)
def _native_and_ported():
    return Simulation(situation=_pensioner()), _ported(_pensioner())


@pytest.mark.skipif(
    not HAS_NATIVE_ALLOWANCE,
    reason="this engine has no allowance of its own",
)
@examples
@given(years, band_positions, mixes, ages, months, contributions)
def test_the_port_matches_the_engines_own_allowance(
    year, positions, mix, age, months_since_birthday, paid_in
):
    inputs = {
        **split(in_band(rule_for(year), positions), mix),
        "age": age,
        "months_since_last_birthday": months_since_birthday,
        ANNUAL_ALLOWANCE_INPUT: paid_in,
    }
    native, ported = _native_and_ported()
    outputs = ("income_tax", *UC_TAX)
    native_tax, *native_uc = calculate(native, year, inputs, outputs)
    ported_tax, *ported_uc = calculate(ported, year, inputs, outputs)
    assert ported_tax == pytest.approx(native_tax, abs=2 * PENNY)
    for native_part, ported_part in zip(native_uc, ported_uc):
        assert ported_part == pytest.approx(native_part, abs=2 * PENNY)


def _pay_and_trade(year):
    """A Londoner aged 70 with £12,800 of pay and a £1,100 trade profit that
    already nets the trading allowance: they claim its partial relief, so
    income tax falls on all of the profit."""
    return {
        "people": {
            "p": {
                "age": {year: 70},
                "employment_income": {year: 12_800},
                "self_employment_income": {year: 1_100},
                "trading_allowance_claim_status": {year: "CLAIMANT"},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }


@pytest.mark.skipif(
    not (HAS_NATIVE_ALLOWANCE and HAS_CLAIM_STATUS),
    reason="this engine has no allowance of its own or no claimant status",
)
@pytest.mark.parametrize("year", (2028, 2029))
def test_the_port_splits_universal_credits_tax_as_the_engine_does(year):
    """The engine counts pay as the lowest slice of income when it works out
    the income tax Universal Credit deducts, so that tax falls only on pay
    over the personal allowance. Without a claimant status, the engine
    relieves in full a trade profit within the £3,000 trading allowance. Pay
    and trade that both bear tax then exceed the top of the allowance's band,
    so the households generated above never test how the port shares the
    allowance between the tax on pay and the tax on trade. This claimant
    does: the allowance they use falls short of the tax on their pay in
    2028-29 and exceeds it in 2029-30, and in both years taking it off the
    trade first would leave a different tax on the trade."""
    outputs = ("income_tax", *UC_TAX)

    def results(simulation):
        return [float(simulation.calculate(name, year)[0]) for name in outputs]

    tax, earnings, trade = results(
        Simulation(
            situation=_pay_and_trade(year),
            scenario=_without_the_native_allowance(),
        )
    )
    native = results(Simulation(situation=_pay_and_trade(year)))
    used = tax - native[0]
    employment = earnings - trade
    employment_first = max(0.0, trade - max(0.0, used - employment))
    trade_first = max(0.0, trade - used)
    assert used > 2 * PENNY
    assert (used < employment) == (year == 2028)
    assert abs(employment_first - trade_first) > 2 * PENNY

    ported = results(_ported(_pay_and_trade(year)))
    assert ported == pytest.approx(native, abs=2 * PENNY)
