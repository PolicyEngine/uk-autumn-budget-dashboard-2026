"""Three expired model limits, kept as stand-ins for tests of the machinery.

policyengine-uk 2.151.0 (6.11.1's adoption, PR 238) has the fixes for three
model limits: #2336 (the State Pension add-on and protected payments rise
by September CPI), #2533 (benefits rise by September CPI, from the
published outturn) and #2187 (VAT grossed up by survey coverage and the
household share of receipts). Each limit's ``installed_fixed()`` reads true
there, so they are out of ``MODEL_LIMITS``, with their checks for the fix.
Only the Pension Credit minimum guarantee's limit is still in force.

The tests of detection, recording and publication were written around
those three: one covers parameters from any year, one only from 2027, and
the VAT one covers variables as well (the only limit that did). They
register them as stand-ins on top of the registry, in its old order, with
the ``stand_in_model_limits`` fixture (tests/conftest.py), which patches
the registry and its digest, so receipts made meanwhile record the patched
digest and the gate checks against it. Each stand-in keeps its key,
parameters, variables, reason and starting year, but no model has its fix
unless a test installs that stand-in's marker variable (``with_fix``): the
real checks would read every installed model as fixed.
"""

from policyengine_core.periods import YEAR
from policyengine_core.variables import Variable
from policyengine_uk.entities import Household

from uk_budget_data import model_limits
from uk_budget_data.model_limits import ModelLimit

_SEPTEMBER_CPI_INDEX = (
    "gov.economic_assumptions.indices.september_cpi_uprating"
)


def fix_marker(key: str) -> str:
    """The variable whose presence says a system has a stand-in's fix."""
    return f"stand_in_fix_for_{key}"


def fix_marker_check(key: str):
    """A stand-in's check for its fix: the system has its marker variable.
    A system without variables (a stand-in object, or none) lacks it."""

    def fixed(system) -> bool:
        variables = getattr(system, "variables", None) or {}
        return fix_marker(key) in variables

    fixed.__name__ = f"has_{fix_marker(key)}"
    return fixed


def _never() -> bool:
    """No installed model has a stand-in's fix."""
    return False


def with_fix(*keys):
    """A simulation modifier installing these stand-ins' fixes: a marker
    variable each, read by nothing."""

    def install(sim):
        for key in keys:
            marker = type(
                fix_marker(key),
                (Variable,),
                {
                    "entity": Household,
                    "definition_period": YEAR,
                    "value_type": bool,
                    "label": f"Stand-in: this model has {key}'s fix",
                },
            )
            sim.tax_benefit_system.add_variable(marker)

    return install


# Topmost prefixes whose uprating metadata names gov.benefit_uprating_cpi,
# including the UC standard allowance's parent (which propagates to all
# four leaves), as the registry listed them when the limit expired.
_BENEFIT_CPI_PARAMETERS = (
    "gov.dfe.childcare_funding_rate",
    "gov.dwp.JSA.income.amount_18_24",
    "gov.dwp.JSA.income.amount_over_25",
    "gov.dwp.JSA.income.couple",
    "gov.dwp.attendance_allowance.higher",
    "gov.dwp.attendance_allowance.lower",
    "gov.dwp.carer_premium.single",
    "gov.dwp.carers_allowance.rate",
    "gov.dwp.constant_attendance_allowance.exceptional_rate",
    "gov.dwp.constant_attendance_allowance.full_day_rate",
    "gov.dwp.constant_attendance_allowance.intermediate_rate",
    "gov.dwp.constant_attendance_allowance.part_day_rate",
    "gov.dwp.disability_premia.disability_couple",
    "gov.dwp.disability_premia.disability_single",
    "gov.dwp.disability_premia.enhanced_couple",
    "gov.dwp.disability_premia.enhanced_single",
    "gov.dwp.disability_premia.severe_couple",
    "gov.dwp.disability_premia.severe_single",
    "gov.dwp.dla.mobility.higher",
    "gov.dwp.dla.mobility.lower",
    "gov.dwp.dla.self_care.higher",
    "gov.dwp.dla.self_care.lower",
    "gov.dwp.dla.self_care.middle",
    "gov.dwp.housing_benefit.allowances.couple.aged",
    "gov.dwp.housing_benefit.allowances.couple.older",
    "gov.dwp.housing_benefit.allowances.couple.younger",
    "gov.dwp.housing_benefit.allowances.lone_parent.aged",
    "gov.dwp.housing_benefit.allowances.lone_parent.older",
    "gov.dwp.housing_benefit.allowances.lone_parent.younger",
    "gov.dwp.housing_benefit.allowances.single.aged",
    "gov.dwp.housing_benefit.allowances.single.older",
    "gov.dwp.housing_benefit.allowances.single.younger",
    "gov.dwp.housing_benefit.non_dep_deduction.amount",
    "gov.dwp.income_support.amounts.amount_16_24",
    "gov.dwp.income_support.amounts.amount_couples_16_17",
    "gov.dwp.income_support.amounts.amount_couples_age_gap",
    "gov.dwp.income_support.amounts.amount_couples_over_18",
    "gov.dwp.income_support.amounts.amount_lone_16_17",
    "gov.dwp.income_support.amounts.amount_lone_over_18",
    "gov.dwp.income_support.amounts.amount_over_25",
    "gov.dwp.pension_credit.guarantee_credit.carer.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.disability.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.disability.severe.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.first.addition",
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.COUPLE",
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE",
    "gov.dwp.pension_credit.guarantee_credit.severe_disability.addition",
    "gov.dwp.pension_credit.savings_credit.threshold",
    "gov.dwp.pip.daily_living.enhanced",
    "gov.dwp.pip.daily_living.standard",
    "gov.dwp.pip.mobility.enhanced",
    "gov.dwp.pip.mobility.standard",
    "gov.dwp.sda.maximum",
    "gov.dwp.tax_credits.child_tax_credit.elements.child_element",
    "gov.dwp.tax_credits.child_tax_credit.elements.dis_child_element",
    "gov.dwp.tax_credits.child_tax_credit.elements.severe_dis_child_element",
    "gov.dwp.tax_credits.means_test.income_threshold",
    "gov.dwp.tax_credits.means_test.income_threshold_CTC_only",
    "gov.dwp.tax_credits.working_tax_credit.elements.basic",
    "gov.dwp.tax_credits.working_tax_credit.elements.couple",
    "gov.dwp.tax_credits.working_tax_credit.elements.disabled",
    "gov.dwp.tax_credits.working_tax_credit.elements.lone_parent",
    "gov.dwp.tax_credits.working_tax_credit.elements.severely_disabled",
    "gov.dwp.tax_credits.working_tax_credit.elements.worker",
    "gov.dwp.universal_credit.elements.carer.amount",
    "gov.dwp.universal_credit.elements.child.amount",
    "gov.dwp.universal_credit.elements.child.disabled.amount",
    "gov.dwp.universal_credit.elements.child.first.higher_amount",
    "gov.dwp.universal_credit.elements.child.severely_disabled.amount",
    "gov.dwp.universal_credit.elements.childcare.cap",
    "gov.dwp.universal_credit.elements.disabled.amount",
    "gov.dwp.universal_credit.elements.housing.non_dep_deduction.amount",
    "gov.dwp.universal_credit.means_test.work_allowance",
    "gov.dwp.universal_credit.standard_allowance.amount",
    "gov.hmrc.child_benefit.amount.additional",
    "gov.hmrc.child_benefit.amount.eldest",
    "gov.hmrc.council_tax.high_value_surcharge.amount",
    "gov.social_security_scotland.carer_support_payment.rate",
)

# Parameters outside the benefit index whose 2027 amount is still computed
# from the September 2026 CPI input. The UC protected health element is null
# from April 2027, so policyengine-uk's uc_reform takes the UC Act 2025 s. 4
# floor, which reads statutory_uprating_inputs.cpi_september for the
# previous September (review of #85). The September CPI index is built from
# the same input, and from policyengine-uk #2336 additional State Pension and
# new State Pension protected payments rise by it, so a pair with #2336 but
# without #2533's fix gives them a forecast for their April 2027 rise
# (coordinator, 22 October). Any route that moves the index (the input, a
# CPI growth path or its forecast gap) changes its stored values. The
# triple lock reads the same input for its April 2027 CPI leg, so a
# measure on its rule, or anything that moves the index it builds, is held
# too: the State Pension limit no longer holds it once #2336 is in (review
# of #90). A measure on the full rates alone is not held.
_SEPTEMBER_INPUT_READERS = (
    "gov.dwp.universal_credit.rebalancing.protected_health_element",
    _SEPTEMBER_CPI_INDEX,
    "gov.dwp.state_pension.triple_lock",
    "gov.economic_assumptions.indices.triple_lock",
)


# consumption's categories, which it adds (COICOP), as policyengine-uk
# 2.132.6 lists them.
_CONSUMPTION_CATEGORIES = (
    "food_and_non_alcoholic_beverages_consumption",
    "alcohol_and_tobacco_consumption",
    "clothing_and_footwear_consumption",
    "housing_water_and_electricity_consumption",
    "household_furnishings_consumption",
    "health_consumption",
    "transport_consumption",
    "communication_consumption",
    "recreation_consumption",
    "education_consumption",
    "restaurants_and_hotels_consumption",
    "miscellaneous_consumption",
)

# consumption's categories rise by this index in years after the data's, so
# a CPI path moves VAT without changing a VAT parameter. In a household
# calculation it changes no stored input either; on a dataset the projected
# inputs follow it, and record too.
_CONSUMPTION_UPRATING = (
    "gov.economic_assumptions.indices.obr.consumer_price_index"
)

# What household VAT is built from: the two grossed liabilities, their
# difference, the two consumption bases and what they are built from. A
# measure on any of them moves VAT without changing a VAT parameter: the VAT
# base template replaces vat's formula, and a modifier can set consumption.
_VAT_VARIABLES = (
    "vat",
    "baseline_vat",
    "vat_change",
    "full_rate_vat_consumption",
    "reduced_rate_vat_consumption",
    "full_rate_vat_expenditure_rate",
    "consumption",
    *_CONSUMPTION_CATEGORIES,
)


STATE_PENSION_ADD_ON = ModelLimit(
    key="state_pension_add_on_uprating",
    parameters=(
        "gov.dwp.state_pension.basic_state_pension.amount",
        "gov.dwp.state_pension.new_state_pension.amount",
        "gov.dwp.state_pension.triple_lock",
        # Without the fix the add-on ignores September CPI, so a change
        # that moves the index but not the full rates misses it.
        "gov.economic_assumptions.indices.september_cpi_uprating",
    ),
    fixed_by="policyengine-uk #2336",
    reason=(
        "The installed model raises additional State Pension and new "
        "State Pension protected payments with the full rates, not with "
        "prices, so anything that moves the full rates moves them too, "
        "and a change to September CPI misses them. They rise by prices: "
        "the statutory floor, which the Up-rating Orders give as "
        "September CPI (SI 2026/148 articles 4(3)(a) and 6(3)(b)). So "
        "this measure is mis-costed: on uk-data 1.58.1, a 10% rise in "
        "the full rates overstates its net cost by about £0.85bn to "
        "£1.06bn a year over 2026-27 to 2030-31. policyengine-uk #2336 "
        "fixes it; it is not in this model. Held at provisional."
    ),
    fixed=fix_marker_check("state_pension_add_on_uprating"),
    installed_fixed=_never,
)


BENEFIT_SEPTEMBER_CPI = ModelLimit(
    key="benefit_uprating_september_cpi",
    parameters=_BENEFIT_CPI_PARAMETERS + _SEPTEMBER_INPUT_READERS,
    fixed_by="policyengine-uk #2533",
    reason=(
        "The installed benefit uprating index follows lagged calendar-year "
        "CPI: the parameters uprated by it, the UC standard allowance "
        "among them, step by 2.3% in April 2027 against September 2026 "
        "CPI of 3.5% (ONS D7G7, published 21 October 2026). The UC "
        "protected health element's 2027 amount also reads the "
        "September 2026 input, which is still a forecast, and so do the "
        "triple lock's CPI leg and the September CPI index, by which "
        "additional State Pension and new State Pension protected "
        "payments rise once policyengine-uk #2336 is in the model. The "
        "2026-27 rates are hard-coded and unaffected. policyengine-uk "
        "#2533 must both enter the September outturn and repoint the "
        "benefit index to September CPI. Until both steps are in the "
        "model, measures "
        "touching these benefit levels from 2027 are held at "
        "provisional."
    ),
    fixed=fix_marker_check("benefit_uprating_september_cpi"),
    installed_fixed=_never,
    from_year=2027,
)


VAT_CONSUMPTION_COVERAGE = ModelLimit(
    key="vat_consumption_coverage",
    parameters=(
        "gov.hmrc.vat",
        "gov.simulation.microdata_vat_coverage",
        _CONSUMPTION_UPRATING,
        # baseline_vat reads the engine's copy of the tree as built, and
        # vat_change subtracts it, so an edit to that copy moves VAT.
        "baseline.gov.hmrc.vat",
        "baseline.gov.simulation.microdata_vat_coverage",
    ),
    variables=_VAT_VARIABLES,
    fixed_by="policyengine-uk #2187",
    reason=(
        "The installed model grosses household VAT up to receipts by a "
        "single factor of 0.38 (gov.simulation.microdata_vat_coverage). "
        "policyengine-uk #2187 divides instead by survey consumption "
        "coverage times the household share of VAT receipts, 0.67 × 0.7 "
        "= 0.469, so this model's VAT is about 23% higher (the UK hub's "
        "notice 59 puts it about 24% high on Microcosm), and a "
        "measure that moves a VAT rate, the VAT base or the consumption "
        "VAT is charged on can be overstated by as much. A measure "
        "built with the VAT base template is held too, though the term "
        "the template adds is not grossed. #2187 is not in this model. "
        "Until a pair with it is adopted, such measures are held at "
        "provisional."
    ),
    fixed=fix_marker_check("vat_consumption_coverage"),
    installed_fixed=_never,
)


# The registry the tests of the machinery see, in the order it had: the
# stand-ins around every limit still in force.
STAND_IN_MODEL_LIMITS = (
    STATE_PENSION_ADD_ON,
    BENEFIT_SEPTEMBER_CPI,
    *model_limits.MODEL_LIMITS,
    VAT_CONSUMPTION_COVERAGE,
)


def register(monkeypatch, limits=STAND_IN_MODEL_LIMITS) -> None:
    """Make ``limits`` the registry, with its digest."""
    monkeypatch.setattr(model_limits, "MODEL_LIMITS", limits)
    monkeypatch.setattr(
        model_limits, "REGISTRY_SHA256", model_limits._registry_digest(limits)
    )
