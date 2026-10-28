"""An income tax allowance of the full new State Pension for people over
State Pension age whose total income is at most that allowance: the
default design of ``state_pension_income_tax_protection``. Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula

# Budget day: how the full new State Pension (the engine's weekly rate x
# 52) is rounded to whole pounds for the threshold. True rounds down
# (£13,036 in 2027-28: the Times and the press, 52 x £250.70 =
# £13,036.40); False rounds up (£13,037, the candidate). The engine's
# 2027-28 weekly rate is £250.711 (not rounded to the penny), so later
# years may differ by £1 from the Budget's own figures: if the document
# gives the thresholds, write them into the tuple instead.
ROUND_DOWN = False
# The engine's full new State Pension x 52 for 2027-28 to 2031-32
# (policyengine-uk 2.151.0), rounded up and rounded down.
ROUNDED_UP = (13037, 13363, 13697, 14040, 14391)
ROUNDED_DOWN = (13036, 13362, 13696, 14039, 14390)


def state_pension_only_income_tax_allowance(
    sim,
    allowance_2027=ROUNDED_DOWN[0] if ROUND_DOWN else ROUNDED_UP[0],
    allowance_2028=ROUNDED_DOWN[1] if ROUND_DOWN else ROUNDED_UP[1],
    allowance_2029=ROUNDED_DOWN[2] if ROUND_DOWN else ROUNDED_UP[2],
    allowance_2030=ROUNDED_DOWN[3] if ROUND_DOWN else ROUNDED_UP[3],
    allowance_2031=ROUNDED_DOWN[4] if ROUND_DOWN else ROUNDED_UP[4],
    other_income_limit=None,
    total_income_at_most_allowance=True,
    disregard_savings_interest=False,
    test_at_rounded_up_pension=True,
    last_year=2029,
):
    """A personal allowance of the full new State Pension, from April 2027,
    for people over State Pension age whose total income is at most that
    allowance. Hand-written: the allowance template withdraws against total
    income above a threshold, and cannot take the whole allowance away.

    The design: the reporting of 26 October 2026 (BBC; The Times) gave "a
    new tax allowance for low-income pensioners" of £13,036, the full new
    State Pension, rising with it, for pensioners "wholly reliant on the
    State Pension"; the Telegraph then reported that "officials have
    broadened it" to pensioners with other income, "provided their total
    income stays below the threshold" (GB News, 27 October 2026). Each
    year's allowance is the engine's full new State Pension (weekly rate x
    52) rounded to the pound, up unless ``ROUND_DOWN`` is set.

    A person qualifies if over State Pension age, receiving a State
    Pension, and, while ``total_income_at_most_allowance`` is set, with
    total income (Income Tax Act 2007 s. 23: the State Pension, with any
    increments, protected payment or additional State Pension, plus every
    other income) at or below the year's allowance. Such a person has no
    taxable income, so pays no income tax. Above it there is no allowance:
    £1 of income above the threshold takes the whole allowance away, and a
    State Pension above the full new rate (increments, the old basic State
    Pension with SERPS) is itself above it. Savings interest counts unless
    ``disregard_savings_interest`` is set (the reported test is on total
    income).

    ``last_year`` is the last fiscal year the allowance applies: 2029 =
    2029-30, as the Budget 2026 document gives it (6 April 2027 to 5 April
    2030, row 52).

    Rounded down (``ROUND_DOWN``), the total-income test stays at the full
    new State Pension rounded up unless ``test_at_rounded_up_pension`` is
    unset: see the formula.

    The alternatives switch by argument: ``other_income_limit`` adds a test
    on income other than the State Pension (0, with the total-income test
    off and savings interest disregarded, is the sole-income design
    reported on 26 October); with both tests off, everyone over State
    Pension age with a State Pension gets the allowance.

    The allowance keeps the native taper above £100,000 of adjusted net
    income, as the standard allowance does (it binds only when the tests
    are off). Only ``personal_allowance`` changes, and only for those who
    qualify: an eligible person keeps the larger of the allowance and the
    previous formula's, so it composes with other allowance measures.
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
        if year not in allowances or year > last_year:
            return current
        state_pension = person("state_pension", period)
        total = person("total_income", period)
        if disregard_savings_interest:
            total = total - person("savings_interest_income", period)
        eligible = person("is_SP_age", period) & (state_pension > 0)
        if other_income_limit is not None:
            eligible = eligible & (total - state_pension <= other_income_limit)
        if total_income_at_most_allowance:
            # Rounded down, the allowance (£13,036 in 2027-28) is below the
            # full new State Pension itself (£13,036.40 in law, £13,036.97
            # in the engine), so a total-income test at the allowance would
            # exclude everyone on exactly the full new State Pension. With
            # ``test_at_rounded_up_pension`` the test is at the full new
            # State Pension rounded up (ROUNDED_UP) instead, and such a
            # pensioner keeps the allowance, paying tax on the pence above
            # it. Rounded up, both are the same number.
            limit = (
                ROUNDED_UP[year - 2027]
                if test_at_rounded_up_pension
                else allowances[year]
            )
            eligible = eligible & (total <= limit)
        # The native £100,000 taper still applies, which matters only when
        # a large limit opens the allowance to higher incomes.
        pa = parameters(
            period
        ).gov.hmrc.income_tax.allowances.personal_allowance
        # Already net of grossed-up Gift Aid (ITA 2007 s. 58), as the
        # native allowance reads it.
        income = person("adjusted_net_income", period)
        reduction = np.maximum(0, income - pa.maximum_ANI) * pa.reduction_rate
        allowance = np.maximum(0, np.ceil(allowances[year] - reduction))
        return np.where(eligible, np.maximum(current, allowance), current)

    _replace_formula(sim, "personal_allowance", formula)
    return sim
