"""MOCK drill 2 structural measures (rehearsal Budget, 5 October 2026).

MOCK DATA: these measures implement the invented drill 2 Chancellor's
statement (data_inputs/mock_drill2/packet/MOCK-statement.md). Not a real
Budget. Annex A / the policy costings (released 13:40) may change the
constants below; every assumption awaiting it is marked ``AWAITING ANNEX A``.

Both measures are structural: the engine has no parameter for an age-
conditioned personal allowance or for a 2027 one-off payment, so each is a
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
# Statement: "tapers away for pensioners with incomes above £20,000".
# Held flat in cash terms (the statement uprates only the allowance).
# AWAITING ANNEX A: confirm whether the £20,000 threshold is uprated.
SP_PA_TAPER_THRESHOLD = 20_000
# AWAITING ANNEX A: the statement gives no taper rate. Assumed £1 of the
# higher allowance withdrawn per £2 of adjusted net income above the
# threshold (the same 50% rate as the £100,000 taper), down to the standard
# personal allowance. Change here only.
SP_PA_TAPER_RATE = 0.5


def _new_state_pension_weekly(parameters, instant):
    return parameters(instant).gov.dwp.state_pension.new_state_pension.amount


class personal_allowance(Variable):
    """Personal allowance with the MOCK State Pension age allowance.

    standard = engine PA (12,570 less 50% of ANI above £100,000, ceil'd).
    higher   = 13,100 x nSP(t) / nSP(2027), less SP_PA_TAPER_RATE of ANI above
               £20,000 (ceil'd like the engine's PA).
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
        PA = parameters(period).gov.hmrc.income_tax.allowances.personal_allowance
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
        # Engine SP uprating, read from this simulation's own parameters so a
        # changed State Pension path (e.g. an uprating measure) carries through.
        # System parameters are fiscal-year mapped: "2027-01-01" is FY 2027-28.
        uprating = _new_state_pension_weekly(
            parameters, period
        ) / _new_state_pension_weekly(parameters, f"{SP_PA_FIRST_YEAR}-01-01")
        higher = np.ceil(
            SP_PA_AMOUNT_2027 * uprating
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
            f"£{SP_PA_AMOUNT_2027:,} personal allowance, rising with the new "
            "State Pension each year and withdrawn at £1 per £2 of adjusted "
            f"net income above £{SP_PA_TAPER_THRESHOLD:,} down to the "
            "standard allowance (taper rate assumed, awaiting Annex A)."
        ),
        simulation_modifier=_state_pension_personal_allowance_modifier,
    )


# =============================================================================
# B. Energy Price Protection Payment
# =============================================================================

ENERGY_PAYMENT_AMOUNT = 150
# Statement: "a one-off £150 in January". January 2027 falls in FY 2026-27,
# but in this engine model year 2027 means FY 2027-28 for annual parameters
# and benefit amounts (6 Apr 2027 - 5 Apr 2028), which does NOT contain
# January 2027. As instructed, the payment is booked in model year 2027 and
# eligibility uses the engine's 2027 UC / Pension Credit amounts. Reconcile
# against a 2026-27 scorecard line (Table 4.1) with this one-year offset.
# AWAITING ANNEX A: confirm payment date, fiscal year and qualifying benefits.
ENERGY_PAYMENT_YEAR = 2027
ENERGY_PAYMENT_QUALIFYING_BENEFITS = ("universal_credit", "pension_credit")


class mock2_energy_price_payment_eligible(Variable):
    value_type = bool
    entity = BenUnit
    label = "Eligible for the MOCK Energy Price Protection Payment"
    definition_period = YEAR

    def formula(benunit, period, parameters):
        eligible = False
        for benefit in ENERGY_PAYMENT_QUALIFYING_BENEFITS:
            eligible = eligible | (benunit(benefit, period) > 0)
        return eligible


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
        return eligible * ENERGY_PAYMENT_AMOUNT


class cost_of_living_support_payment(Variable):
    """Engine cost-of-living payment plus the MOCK energy payment.

    This existing one-off-payment channel already feeds household_benefits
    (hence household_net_income), HBAI net income and gov_spending, so the
    payment reaches household resources and the government cost once.
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
            "where any benefit unit receives Universal Credit or Pension "
            "Credit, paid in January 2027 (FY 2026-27) and modelled in model "
            "year 2027."
        ),
        simulation_modifier=_energy_price_payment_modifier,
    )
