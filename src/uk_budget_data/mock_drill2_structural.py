"""MOCK drill 2 structural measures (rehearsal Budget, 5 October 2026).

MOCK DATA: these measures implement the invented drill 2 Chancellor's
statement (data_inputs/mock_drill2/packet/MOCK-statement.md). Not a real
Budget. Constants follow the 13:40 policy costings
(data_inputs/mock_drill2/packet/MOCK-policy-costings.md, sections 3 and 4
and Annex A).

Both measures are structural: the engine has no parameter for an age-
conditioned personal allowance or for a one-off energy payment, so each is a
``policyengine_core`` Reform class applied through a ``simulation_modifier``.
``Reform.to_drill_scenario()`` carries that modifier into both the national
pipeline (``pipeline.build_microsimulation``) and the household calculator
(``personal_impact.calculate_drill_impact``), so one implementation serves
both. The modifier runs after data load, so it uses the engine's own
``_apply_reform_class`` helper, which calls ``Simulation.apply_reform`` and
purges cached formula output.

Stored-input caveat: the loader treats any recognised H5 column as an input,
which would silently bypass a replaced formula. The modifiers therefore fail
loudly if the overridden variables already hold values when applied.
"""

import numpy as np
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import (
    GBP,
    YEAR,
    BenUnit,
    Household,
    Person,
    Variable,
    max_,
    where,
)
from policyengine_uk.utils.scenario import _apply_reform_class
from policyengine_uk.variables.gov.treasury.cost_of_living_support.cost_of_living_support_payment import (
    cost_of_living_support_payment as _engine_col_payment,
)

from uk_budget_data.models import Reform

# =============================================================================
# A. State Pension personal allowance
# =============================================================================

# Statement: "From April 2027 people over State Pension age get a higher
# personal allowance of £13,100". Model year 2027 = FY 2027-28 in this engine
# (annual parameters are fiscal-year mapped), so 2027 is the first year.
SP_PA_FIRST_YEAR = 2027
SP_PA_AMOUNT_2027 = 13_100
# Costing section 4: tapered by £1 for every £2 of adjusted net income above
# £20,000 until it reaches the £12,570 Personal Allowance. The £20,000
# threshold is fixed in cash terms (only the allowance is uprated). The
# measure does not change the basic rate limit.
SP_PA_TAPER_THRESHOLD = 20_000
SP_PA_TAPER_RATE = 0.5
# Costing section 4: from April 2028 the allowance "rises each April by the
# same percentage as the full new State Pension, rounded up to the next £10".
SP_PA_ROUNDING = 10


def _new_state_pension_weekly(parameters, instant):
    return parameters(instant).gov.dwp.state_pension.new_state_pension.amount


def sp_personal_allowance_amount(year: int, new_sp_weekly) -> float:
    """Untapered State Pension Personal Allowance for model year ``year``.

    amount(2027) = 13,100; amount(t) = ceil(amount(t-1) x nSP(t) / nSP(t-1)
    / 10) x 10, chained year by year (each year's rounded value is the base
    for the next). ``new_sp_weekly(y)`` returns the full new State Pension a
    week for model year y.
    """
    amount = SP_PA_AMOUNT_2027
    for y in range(SP_PA_FIRST_YEAR + 1, year + 1):
        raw = amount * new_sp_weekly(y) / new_sp_weekly(y - 1)
        # round() guards ceil against float noise on an exact multiple of £10.
        amount = SP_PA_ROUNDING * np.ceil(round(raw / SP_PA_ROUNDING, 9))
    return float(amount)


class personal_allowance(Variable):
    """Personal allowance with the MOCK State Pension age allowance.

    standard = engine PA (12,570 less 50% of ANI above £100,000, ceil'd).
    amount   = 13,100 in 2027, then each year ceil(amount(t-1) x nSP(t) /
               nSP(t-1) / 10) x 10 (see sp_personal_allowance_amount).
    higher   = amount less 50% of ANI above £20,000 (ceil'd like the
               engine's PA); the taper is applied after the rounding.
    result   = max(standard, higher) for people at State Pension age from
               2027, else standard.

    max() makes the higher allowance taper to the standard PA first; above
    £100,000 the higher allowance is long gone (it is exhausted by
    20,000 + 530 / 0.5 = £21,060 in 2027), so the standard £100k taper then
    applies as normal.
    """

    value_type = float
    entity = Person
    label = "Personal Allowance for the year (MOCK drill 2 SP allowance)"
    unit = GBP
    definition_period = YEAR

    def formula(person, period, parameters):
        PA = parameters(
            period
        ).gov.hmrc.income_tax.allowances.personal_allowance
        ANI = person("adjusted_net_income", period)
        ANI_for_taper = ANI - person("gift_aid_grossed_up", period)
        standard = max_(
            0,
            np.ceil(
                PA.amount
                - max_(0, ANI_for_taper - PA.maximum_ANI) * PA.reduction_rate
            ),
        )
        if period.start.year < SP_PA_FIRST_YEAR:
            return standard
        # nSP is read from this simulation's own parameters so a changed
        # State Pension path (Annex A baseline, an uprating measure) carries
        # through. System parameters are fiscal-year mapped: "2027-01-01" is
        # FY 2027-28.
        amount = sp_personal_allowance_amount(
            period.start.year,
            lambda y: _new_state_pension_weekly(parameters, f"{y}-01-01"),
        )
        higher = np.ceil(
            amount
            - max_(0, ANI_for_taper - SP_PA_TAPER_THRESHOLD) * SP_PA_TAPER_RATE
        )
        return where(
            person("is_SP_age", period), max_(standard, higher), standard
        )


class _StatePensionPersonalAllowanceReform(CoreReform):
    def apply(self):
        self.update_variable(personal_allowance)


def _ensure_formula_runs(sim, variable: str) -> None:
    """Fail loudly if a stored dataset column would bypass the new formula."""
    holder = sim.get_holder(variable)
    if holder.get_known_periods():
        raise RuntimeError(
            f"{variable} is a stored input in this dataset; the MOCK drill 2 "
            "structural override would be bypassed"
        )


def _state_pension_personal_allowance_modifier(sim):
    _apply_reform_class(_StatePensionPersonalAllowanceReform, sim)
    _ensure_formula_runs(sim, "personal_allowance")
    return sim


def create_mock2_state_pension_personal_allowance() -> Reform:
    return Reform(
        id="mock2_state_pension_personal_allowance",
        name="State Pension personal allowance",
        description=(
            "MOCK drill 2. From April 2027 people at State Pension age get a "
            f"£{SP_PA_AMOUNT_2027:,} personal allowance, rising each April "
            "from 2028 by the same percentage as the full new State Pension "
            "(rounded up to the next £10) and withdrawn at £1 per £2 of "
            f"adjusted net income above £{SP_PA_TAPER_THRESHOLD:,} (fixed) "
            "down to the standard allowance. The basic rate limit is "
            "unchanged."
        ),
        simulation_modifier=_state_pension_personal_allowance_modifier,
    )


# =============================================================================
# B. Energy Price Protection Payment
# =============================================================================

ENERGY_PAYMENT_AMOUNT = 150
# Costing section 3: a one-off £150 paid in January 2027 to households in
# Great Britain receiving Universal Credit or Pension Credit guarantee credit
# on 1 December 2026; static cost £870m in 2026-27, around 5.8m households.
# Both dates fall in FY 2026-27, which is model year 2026 in this engine, so
# the payment and its eligibility test use the 2026 period (annual UC and
# guarantee-credit receipt stand in for receipt on 1 December 2026).
# Northern Ireland is excluded (it gets a Barnett-equivalent sum instead).
ENERGY_PAYMENT_YEAR = 2026


class mock2_energy_price_payment_eligible(Variable):
    value_type = bool
    entity = BenUnit
    label = "Eligible for the MOCK Energy Price Protection Payment"
    definition_period = YEAR

    def formula(benunit, period, parameters):
        # Guarantee credit receipt, not any Pension Credit: a savings-credit-
        # only award does not qualify. in_receipt_of_guarantee_credit applies
        # Pension Credit take-up (would_claim_pc), as universal_credit does.
        return (benunit("universal_credit", period) > 0) | benunit(
            "in_receipt_of_guarantee_credit", period
        )


class mock2_energy_price_payment(Variable):
    value_type = float
    entity = Household
    label = "MOCK Energy Price Protection Payment"
    unit = GBP
    definition_period = YEAR

    def formula(household, period, parameters):
        if period.start.year != ENERGY_PAYMENT_YEAR:
            return household.empty_array()
        # Native benefit-unit eligibility, projected to each person then to
        # the household with any(): one payment however many benefit units
        # (or benefits) in the household qualify.
        eligible = household.any(
            household.members.benunit(
                "mock2_energy_price_payment_eligible", period
            )
        )
        country = household("country", period)
        in_gb = country != country.possible_values.NORTHERN_IRELAND
        return eligible * in_gb * ENERGY_PAYMENT_AMOUNT


class cost_of_living_support_payment(Variable):
    """Engine cost-of-living payment plus the MOCK energy payment.

    This existing one-off-payment channel already feeds household_benefits
    (hence household_net_income), HBAI net income and gov_spending, so the
    payment reaches household resources and the government cost once. It is
    not part of any income tax base or any benefit means test (no UC, Pension
    Credit or Housing Benefit income variable reads it), matching the
    costing: not taxable and disregarded for all benefits.
    """

    label = "Cost-of-living support payment (incl. MOCK energy payment)"
    entity = Household
    definition_period = YEAR
    value_type = float
    unit = GBP

    def formula(household, period, parameters):
        return _engine_col_payment.formula(
            household, period, parameters
        ) + household("mock2_energy_price_payment", period)


class _EnergyPricePaymentReform(CoreReform):
    def apply(self):
        self.update_variable(mock2_energy_price_payment_eligible)
        self.update_variable(mock2_energy_price_payment)
        self.update_variable(cost_of_living_support_payment)


def _energy_price_payment_modifier(sim):
    _apply_reform_class(_EnergyPricePaymentReform, sim)
    _ensure_formula_runs(sim, "cost_of_living_support_payment")
    return sim


def create_mock2_energy_price_payment() -> Reform:
    return Reform(
        id="mock2_energy_price_payment",
        name="Energy Price Protection Payment",
        description=(
            f"MOCK drill 2. A one-off £{ENERGY_PAYMENT_AMOUNT} per household "
            "in Great Britain where any benefit unit receives Universal "
            "Credit or Pension Credit guarantee credit on 1 December 2026, "
            "paid in January 2027 (FY 2026-27, model year 2026). Not taxable "
            "and disregarded for benefits."
        ),
        simulation_modifier=_energy_price_payment_modifier,
    )
