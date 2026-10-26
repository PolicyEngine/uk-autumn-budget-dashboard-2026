"""An income tax allowance of the full new State Pension for people whose
only income is the State Pension: the default design of
``state_pension_income_tax_protection``. Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def state_pension_only_income_tax_allowance(
    sim,
    allowance_2027=13037,
    allowance_2028=13363,
    allowance_2029=13697,
    allowance_2030=14040,
    allowance_2031=14391,
    other_income_limit=0,
    disregard_savings_interest=True,
):
    """A personal allowance of the full new State Pension, from April 2027,
    for people over State Pension age whose only income is the State
    Pension. Hand-written: the allowance template withdraws against total
    income above a threshold, and cannot test what the income is.

    The design reported on 26 October 2026 (BBC; The Times): "a new tax
    allowance for low-income pensioners" of £13,036, the full new State
    Pension, rising with it, for pensioners "wholly reliant on the State
    Pension"; those with private pensions still pay income tax. Each year's
    allowance is the engine's full new State Pension (weekly rate x 52)
    rounded up to the pound, so someone whose only income is the full new
    State Pension has no taxable income.

    A person qualifies if over State Pension age, receiving a State
    Pension, with other income of at most ``other_income_limit``. Other
    income is total income (Income Tax Act 2007 s. 23) less the State
    Pension, and less savings interest while ``disregard_savings_interest``
    is set: with the allowance at the full State Pension, the starting rate
    for savings and the personal savings allowance already leave such a
    person's interest untaxed, and HMRC does not see most of it. A
    qualifying person whose State Pension is above the full new rate
    (increments, protected payments) is taxed on the excess.

    The test is a cliff: £1 of other income above the limit takes the whole
    allowance away. The alternatives switch by argument: a large
    ``other_income_limit`` gives the allowance to everyone over State
    Pension age with a State Pension, whatever their other income.

    The allowance keeps the native taper above £100,000 of adjusted net
    income, as the standard allowance does. Only ``personal_allowance``
    changes, and only for those who qualify:
    an eligible person keeps the larger of the allowance and the previous
    formula's, so it composes with other allowance measures.
    """
    native = sim.tax_benefit_system.get_variable("personal_allowance")
    allowances = {
        2027: allowance_2027,
        2028: allowance_2028,
        2029: allowance_2029,
        2030: allowance_2030,
        2031: allowance_2031,
    }

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year not in allowances:
            return current
        state_pension = person("state_pension", period)
        other = person("total_income", period) - state_pension
        if disregard_savings_interest:
            other = other - person("savings_interest_income", period)
        eligible = (
            person("is_SP_age", period)
            & (state_pension > 0)
            & (other <= other_income_limit)
        )
        # The native £100,000 taper still applies, which matters only when
        # a large limit opens the allowance to higher incomes.
        pa = parameters(
            period
        ).gov.hmrc.income_tax.allowances.personal_allowance
        income = person("adjusted_net_income", period) - person(
            "gift_aid_grossed_up", period
        )
        reduction = np.maximum(0, income - pa.maximum_ANI) * pa.reduction_rate
        allowance = np.maximum(0, np.ceil(allowances[year] - reduction))
        return np.where(eligible, np.maximum(current, allowance), current)

    _replace_formula(sim, "personal_allowance", formula)
    return sim
