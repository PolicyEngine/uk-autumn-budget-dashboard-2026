"""The Pension Tax Allowance, 6 April 2027 to 5 April 2030: a
non-refundable income tax reduction for people over State Pension age
(``pension_tax_allowance``), the design of
``state_pension_income_tax_protection`` announced in the Budget 2026.
Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np
from policyengine_uk.utils.uc_income_tax import (
    uc_income_tax_on_earnings_slice,
)

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def pension_tax_allowance(
    sim,
    first_year=2027,
    last_year=2029,
    basic_rate=0.2,
    taper_divisor=3,
    weekly_rounding=0.05,
):
    """A reduction in income tax, for people over State Pension age, of
    the year's allowance less £1 for every ``taper_divisor`` pounds of
    total income above the full new State Pension, floored at zero and at
    the tax otherwise due (non-refundable). Hand-written: no template
    reduces a tax liability.

    The design (Budget 2026 document, 6.182 and the policy costings, p.
    63; HM Treasury's Pension Tax Allowance explainer, 28 October 2026):
    a tax reduction that "does not change your Personal Allowance", worth
    ``basic_rate`` (20%, the basic rate, for Scottish taxpayers too) of the
    full new State Pension above the personal allowance, rounded up to the
    pound: up to £94 in 2027-28 (£13,036.40 - £12,570 = £466.40 at 20%,
    £93.28). "For every £3 of income above the full level of the new
    State Pension, your Pension Tax Allowance will reduce by £1", so in
    2027-28 it is withdrawn from £13,036.40 to £13,318.40. It rises with
    the full new State Pension and applies from 6 April 2027 to 5 April
    2030 (``first_year`` to ``last_year``); other years keep the native
    liability.

    Both amounts are read at run time, so they follow the forecast the
    run uses: the full new State Pension is the engine's weekly rate on
    6 April, rounded down to ``weekly_rounding`` (5p, as DWP's rates have
    been: £230.25, £241.30, £250.70), x 52; the personal allowance is the
    engine's. Total income is ``total_income`` (Income Tax Act 2007 s. 23,
    savings interest included). The explainer's 2027-28 cases: £13,036.40
    pays nothing (£93.28 cancelled); £12,970 pays nothing (£80);
    £13,186.40 gets £44 (£94 - £150 / 3); £13,400 gets nothing.
    """
    native = sim.tax_benefit_system.get_variable("income_tax")
    native_uc_earnings = sim.tax_benefit_system.get_variable(
        "uc_income_tax_on_earnings"
    )
    native_uc_trade = sim.tax_benefit_system.get_variable(
        "uc_income_tax_on_trade"
    )

    def in_force(period):
        return first_year <= period.start.year <= last_year

    def reduction_used(person, period, parameters):
        """The PTA used: the reduction, capped at the tax otherwise due."""
        year = period.start.year
        current = _call_formula(native, person, period, parameters)
        on = parameters(f"{year}-04-06").gov
        weekly = on.dwp.state_pension.new_state_pension.amount
        steps = np.floor(weekly / weekly_rounding + 1e-9)
        full_state_pension = round(float(steps * weekly_rounding) * 52, 2)
        personal_allowance = (
            on.hmrc.income_tax.allowances.personal_allowance.amount
        )
        allowance = np.ceil(
            round(basic_rate * (full_state_pension - personal_allowance), 6)
        )
        total = person("total_income", period)
        excess = np.maximum(0, total - full_state_pension)
        reduction = np.maximum(0, allowance - excess / taper_divisor)
        reduction = np.where(person("is_SP_age", period), reduction, 0)
        return current, np.minimum(reduction, np.maximum(0, current))

    def formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(native, person, period, parameters)
        current, used = reduction_used(person, period, parameters)
        return np.maximum(0, current - used)

    # Universal Credit deducts the income tax paid on earnings (UC Regs
    # 2013 reg. 55(5)(b), reg. 57(2) step 3), which policyengine-uk 2.151.0
    # recomputes from the rates less income_tax_subtractions, not from
    # income_tax, so it would miss the PTA. Like the engine's other
    # reductions, the PTA used comes off the tax on the employment (the
    # lower slice) first, then off the tax on the trade. Pension income is
    # counted before tax (reg. 66), so it needs nothing here. Both are
    # derived from the engine's slice directly: its native trade formula
    # reads uc_income_tax_on_earnings.
    def earnings_split(person, period, parameters):
        _, used = reduction_used(person, period, parameters)
        with_trade = uc_income_tax_on_earnings_slice(
            person, period, parameters
        )
        without_trade = uc_income_tax_on_earnings_slice(
            person, period, parameters, include_trade=False
        )
        employment = np.maximum(0, without_trade - used)
        left = np.maximum(0, used - without_trade)
        trade = np.maximum(0, (with_trade - without_trade) - left)
        return employment, trade

    def uc_earnings_formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(
                native_uc_earnings, person, period, parameters
            )
        employment, trade = earnings_split(person, period, parameters)
        return employment + trade

    def uc_trade_formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(native_uc_trade, person, period, parameters)
        _, trade = earnings_split(person, period, parameters)
        return trade

    _replace_formula(sim, "income_tax", formula)
    _replace_formula(sim, "uc_income_tax_on_earnings", uc_earnings_formula)
    _replace_formula(sim, "uc_income_tax_on_trade", uc_trade_formula)
    return sim
