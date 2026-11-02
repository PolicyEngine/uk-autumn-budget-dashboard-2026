"""The £12,000 cash ISA limit for under-65s that pre-Budget law set from
6 April 2027, which the Budget 2026 does not make: the pre-Budget side of
``cash_isa_limit_kept`` (``planned_cash_isa_limit``). Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import Variable
from policyengine_uk.utils.scenario import _apply_reform_class

from uk_budget_data.measure_templates import (
    _call_formula,
    _replace_formula,
    _stored_input_periods,
)


def planned_cash_isa_limit(
    sim,
    limit=12_000,
    annual_limit=20_000,
    full_limit_age=65,
    first_year=2027,
    bank_rate=(
        (2027, 0.048),
        (2028, 0.048),
        (2029, 0.047),
        (2030, 0.047),
        (2031, 0.048),
    ),
    survey_taxed_share=0.46,
    survey_deposit_rate=(
        (2027, 0.0248),
        (2028, 0.0262),
        (2029, 0.0272),
        (2030, 0.0286),
        (2031, 0.0301),
    ),
):
    """Interest on the cash an under-65 could not put in a cash ISA under
    the planned ``limit``, taxed as savings income. Hand-written: no
    template moves money out of an ISA.

    The law: the Individual Savings Account (Amendment) (No. 2)
    Regulations 2026 (SI 2026/1018, reg 6) set a cash limit of £12,000 a
    year from 6 April 2027 for a saver "64 or under at the end of that
    year", within the £20,000 ISA limit (``annual_limit``). The Budget 2026
    keeps the cash limit at £20,000 for all savers (paragraph 2.52; Table
    6.1 row 11), which policyengine-uk 2.151.0 already has: it holds no
    ISA limits, so the Budget side is the engine as it is.

    The assumption (María, 29 October 2026), the convention of the Budget
    2025 costing of the cut, which taxed the returns of under-65s who
    planned to pay more than £12,000 into cash ISAs: the saver pays the
    same into cash ISAs each year from ``first_year``, and what the
    planned limit leaves out sits in a taxable account. Each earlier
    year's excess is held all year and this year's is paid in evenly, so
    held for half of it; the interest is paid out each year, not added to
    the balance. It earns Bank Rate: the OBR's October 2026 forecast,
    Economic and fiscal outlook, Table A.3 ("Determinants of the fiscal
    forecast", Bank Rate, per cent, by fiscal year), as ``bank_rate``
    pairs; a later year takes the last rate.

    The interest enters ``other_investment_income``, which policyengine-uk
    2.151.0 taxes as savings income (``taxable_savings_interest_income``)
    and counts in total income (so in adjusted net income), but leaves out
    of market and net income. So the household's incomes stay as answered
    and only its taxes move: the pre-Budget side pays the tax on that
    interest, and the Budget side does not, the interest staying in the
    ISA.

    The household calculator gives the saver's payments a year as
    ``cash_isa_subscriptions``, which policyengine-uk 2.151.0 lacks (it
    arrives in 2.164.1, PolicyEngine/policyengine-uk#2712), so this
    defines it where the engine has none and the household API sets it
    on the built simulation. Under 65 is read from the age the household
    gives, taken as the age at the end of the year. A simulation built
    from survey data, whose other investment income is stored, is left
    unchanged unless the data store cash ISA payments
    (``cash_isa_subscriptions``, which the national of
    policyengine.py#731, 0a4c8e2c on policyengine-uk 2.164.2, carries).

    On survey data that do store them, the rule is the one María proposed
    for a national figure (policyengine.py#731, 2 November 2026), not the
    household's: only ``survey_taxed_share`` of each saver's excess sits in
    a taxable account (46%, Paragon Bank's survey of cash ISA savers under
    65: the rest goes to a stocks-and-shares ISA, Premium Bonds or a
    pension), and it earns the OBR's deposit rate (October 2026 EFO,
    detailed forecast Table 1.9, "Deposit rate", by fiscal year), as the
    costing grows its base on deposit returns. One household chooses for
    itself, so the calculator taxes all of its excess at Bank Rate. Even
    so, the national figure is about 1.5 times the OBR's income tax line
    (Table 1.1, measure 11), whose costing has no static effect, so the
    measure stays out of the national results (calculatorOnlyMeasures.js).
    """
    survey = bool(_stored_input_periods(sim, "other_investment_income"))
    if survey and not (
        "cash_isa_subscriptions" in sim.tax_benefit_system.variables
        and _stored_input_periods(sim, "cash_isa_subscriptions")
    ):
        return sim
    if "cash_isa_subscriptions" not in sim.tax_benefit_system.variables:
        # The receipt binds imported modules and callables only, so the
        # entity comes from the engine and the period and unit are literals
        person_entity = sim.tax_benefit_system.get_variable("age").entity

        class cash_isa_subscriptions(Variable):
            value_type = float
            entity = person_entity
            label = "Cash ISA subscriptions"
            documentation = (
                "New money paid into cash ISAs in the tax year: the "
                "Household calculator's answer (policyengine-uk 2.164.1 "
                "has its own)."
            )
            definition_period = "year"
            unit = "currency-GBP"

        class DefineSubscriptions(CoreReform):
            def apply(self):
                self.add_variable(cash_isa_subscriptions)

        _apply_reform_class(DefineSubscriptions, sim)
    # Survey data store other investment income, so its formula cannot be
    # wrapped there: the interest goes into taxable savings interest
    # instead, which income tax reads as savings income and adjusted net
    # income counts (so the £100,000 childcare limits read it too, as they
    # would the interest itself)
    target = (
        "taxable_savings_interest_income"
        if survey
        else "other_investment_income"
    )
    native = sim.tax_benefit_system.get_variable(target)
    path = survey_deposit_rate if survey else bank_rate
    rates = dict(path)
    last_rate = path[-1][1]
    taxed = survey_taxed_share if survey else 1.0

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year < first_year:
            return current
        paid = np.clip(
            person("cash_isa_subscriptions", period), 0, annual_limit
        )
        under = person("age", period) < full_limit_age
        excess = np.maximum(paid - limit, 0) * under
        held = excess * (year - first_year + 0.5)
        return current + rates.get(year, last_rate) * taxed * held

    _replace_formula(sim, target, formula)
    return sim
