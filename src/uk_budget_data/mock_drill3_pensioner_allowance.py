"""MOCK drill 3 measure 4: Pensioner Allowance (rehearsal Budget, 12 Oct 2026).

MOCK DATA: implements the invented drill 3 Chancellor's statement (12:30).
Not a real Budget.

Statement: "No income tax on the State Pension. From April 2027 pensioners
get a Pensioner Allowance equal to their State Pension where that is higher
than the Personal Allowance, so nobody whose only income is the State Pension
pays income tax on it. It is withdrawn gradually from pensioners with incomes
above £30,000."

Mechanism (reused from drill 2's ``mock2_state_pension_personal_allowance``):
the engine has no parameter for a person-specific allowance, so the
``personal_allowance`` formula is replaced by a ``policyengine_core`` Reform
class applied through a ``simulation_modifier``. ``_apply_reform_class`` calls
``Simulation.apply_reform`` and purges cached formula output, so
``allowances``, taxable income and income tax (UK and Scottish rates alike:
the allowance is reserved, so it applies UK-wide) all recompute from the new
allowance in both the household ``Simulation`` and ``Microsimulation``.

Rule, per person and model year 2027-2031 (FY 2027-28 to 2031-32):

    native    = engine Personal Allowance (incl. its £100k taper, ceil'd)
    excess    = max(0, state_pension - native)      if is_SP_age, else 0
    withdrawn = PROVISIONAL_TAPER_RATE x max(0, ANI - £30,000)
    allowance = ceil(native + max(0, excess - withdrawn))

The withdrawal only ever removes the excess; the allowance never falls below
the native Personal Allowance. ANI is adjusted net income less grossed-up
Gift Aid, the same income measure the engine uses for the £100k taper.
"""

import numpy as np
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import GBP, YEAR, Person, Variable, max_, where
from policyengine_uk.utils.scenario import _apply_reform_class
from policyengine_uk.variables.gov.hmrc.income_tax.allowances.personal_allowance import (
    personal_allowance as _engine_personal_allowance,
)

from uk_budget_data.mock_drill2_structural import _ensure_formula_runs
from uk_budget_data.models import Reform

MOCK3_PENSIONER_ALLOWANCE_ID = "mock3_pensioner_allowance"

# Statement: "From April 2027". Model year 2027 = FY 2027-28 (annual
# parameters are fiscal-year mapped). Runs to the last policy year.
PENSIONER_ALLOWANCE_FIRST_YEAR = 2027
PENSIONER_ALLOWANCE_LAST_YEAR = 2031
# Statement: "withdrawn gradually from pensioners with incomes above
# £30,000". Treated as a cash-fixed threshold on adjusted net income.
PENSIONER_ALLOWANCE_TAPER_THRESHOLD = 30_000
# PROVISIONAL: the statement gives no withdrawal rate. £1 for every £2 (50%),
# as for the Personal Allowance taper. Replace from Annex A (13:40).
PROVISIONAL_TAPER_RATE = 0.5


class personal_allowance(Variable):
    """Personal Allowance with the MOCK drill 3 Pensioner Allowance."""

    value_type = float
    entity = Person
    label = "Personal Allowance for the year (MOCK drill 3 Pensioner Allowance)"
    unit = GBP
    definition_period = YEAR

    def formula(person, period, parameters):
        native = _engine_personal_allowance.formula(person, period, parameters)
        year = period.start.year
        if not (
            PENSIONER_ALLOWANCE_FIRST_YEAR
            <= year
            <= PENSIONER_ALLOWANCE_LAST_YEAR
        ):
            return native
        state_pension = person("state_pension", period)
        excess = where(
            person("is_SP_age", period),
            max_(0, state_pension - native),
            0,
        )
        ani_for_taper = person("adjusted_net_income", period) - person(
            "gift_aid_grossed_up", period
        )
        withdrawn = (
            max_(0, ani_for_taper - PENSIONER_ALLOWANCE_TAPER_THRESHOLD)
            * PROVISIONAL_TAPER_RATE
        )
        # ceil (as the engine rounds the PA) so an allowance "equal to" a
        # pence-valued State Pension never leaves pennies taxable.
        return np.ceil(native + max_(0, excess - withdrawn))


class _PensionerAllowanceReform(CoreReform):
    def apply(self):
        self.update_variable(personal_allowance)


def _pensioner_allowance_modifier(sim):
    _apply_reform_class(_PensionerAllowanceReform, sim)
    _ensure_formula_runs(sim, "personal_allowance")
    return sim


def _create_mock3_pensioner_allowance() -> Reform:
    return Reform(
        id=MOCK3_PENSIONER_ALLOWANCE_ID,
        name="Pensioner Allowance",
        description=(
            "MOCK. From April 2027 people over State Pension age get a "
            "Pensioner Allowance equal to their State Pension where that is "
            "higher than the Personal Allowance, so nobody whose only income "
            "is the State Pension pays income tax on it. The extra allowance "
            "is withdrawn at £1 for every £2 of adjusted net income above "
            f"£{PENSIONER_ALLOWANCE_TAPER_THRESHOLD:,} (provisional rate) and "
            "never falls below the Personal Allowance. Applies UK-wide."
        ),
        simulation_modifier=_pensioner_allowance_modifier,
    )
