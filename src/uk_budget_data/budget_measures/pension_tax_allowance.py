"""The Pension Tax Allowance, 6 April 2027 to 5 April 2030: a
non-refundable income tax reduction for people over State Pension age
(``pension_tax_allowance``), the design of
``state_pension_income_tax_protection`` announced in the Budget 2026.
Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def pension_tax_allowance(
    sim,
    full_new_state_pension_2027=13036.40,
    full_new_state_pension_2028=13362.96,
    full_new_state_pension_2029=13696.80,
    allowance_2027=94,
    allowance_2028=159,
    allowance_2029=226,
    taper_divisor=3,
):
    """A reduction in income tax, for people over State Pension age, of
    the year's allowance less £1 for every ``taper_divisor`` pounds of
    total income above the full new State Pension, floored at zero and at
    the tax otherwise due (non-refundable). Hand-written: no template
    reduces a tax liability.

    The design (Budget 2026 document, 6.182 and the policy costings, p.
    63; HM Treasury's Pension Tax Allowance explainer, 28 October 2026):
    a tax reduction that "does not change your Personal Allowance", worth
    20% (the basic rate, for Scottish taxpayers too) of the full new State
    Pension above the £12,570 personal allowance: up to £94 in 2027-28
    (£13,036.40 - £12,570 = £466.40 at 20%, £93.28, rounded up). "For
    every £3 of income above the full level of the new State Pension, your
    Pension Tax Allowance will reduce by £1", so in 2027-28 it is withdrawn
    from £13,036.40 to £13,318.40. It rises with the full new State
    Pension and applies from 6 April 2027 to 5 April 2030; other years keep
    the native liability.

    The full new State Pension is £13,036.40 in 2027-28 (52 x £250.70);
    later years are the engine's weekly rate, to the penny, x 52 (TODO:
    the published rates), and each year's allowance is 20% of its excess
    over £12,570, rounded up to the pound. Total income is
    ``total_income`` (Income Tax Act 2007 s. 23, savings interest
    included). The explainer's 2027-28 cases: £13,036.40 pays nothing
    (£93.28 cancelled); £12,970 pays nothing (£80); £13,186.40 gets £44
    (£94 - £150 / 3); £13,400 gets nothing.
    """
    native = sim.tax_benefit_system.get_variable("income_tax")
    thresholds = {
        2027: full_new_state_pension_2027,
        2028: full_new_state_pension_2028,
        2029: full_new_state_pension_2029,
    }
    allowances = {
        2027: allowance_2027,
        2028: allowance_2028,
        2029: allowance_2029,
    }

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year not in allowances:
            return current
        total = person("total_income", period)
        excess = np.maximum(0, total - thresholds[year])
        reduction = np.maximum(0, allowances[year] - excess / taper_divisor)
        reduction = np.where(person("is_SP_age", period), reduction, 0)
        return np.maximum(0, current - reduction)

    _replace_formula(sim, "income_tax", formula)
    return sim
