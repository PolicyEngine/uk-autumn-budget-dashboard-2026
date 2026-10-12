"""MOCK drill 3 housing and energy measures (rehearsal Budget, 12 October 2026).

MOCK DATA: invented measures for a PolicyEngine rehearsal. Not a real Budget.

#3 Local Housing Allowance back to the 30th percentile (GB) from April 2027.
#2 Warm Home Discount £100 top-up, England and Wales, winters 2026-27 and
   2027-28.

Engine: policyengine-uk 2.125.1. Bare-year parameter keys are UK fiscal years
(read at 30 April), so "2027" is April 2027 to March 2028.
"""

import numpy as np
import pandas as pd
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import (
    GBP,
    MONTHS_IN_YEAR,
    WEEKS_IN_YEAR,
    YEAR,
    BenUnit,
    Household,
    Variable,
    min_,
    where,
)
from policyengine_uk.utils.lha import (
    CATEGORIES,
    determination,
    published_rates,
    restatement,
)
from policyengine_uk.utils.scenario import _apply_reform_class
from policyengine_uk.variables.gov.treasury.cost_of_living_support.cost_of_living_support_payment import (
    cost_of_living_support_payment as _engine_col_payment,
)

from uk_budget_data.models import Reform

MOCK3_YEARS = [2026, 2027, 2028, 2029, 2030, 2031]

# =============================================================================
# #3 Local Housing Allowance at the 30th percentile, Great Britain
# =============================================================================
#
# Native baseline (policyengine-uk 2.125.1, gov.dwp.LHA):
#   freeze: false 2024-04-06, true from 2025-04-06 onward (no end date), so
#     every year 2025-2031 holds the April 2024 determination in cash terms
#     (utils.lha.determination_year -> 2024).
#   percentile: 0.3 throughout (it only bites when unfrozen).
#   maximum (national cap, weekly A-E): last set 2024-04-01, held in cash.
# Reform: freeze false and percentile 0.3 for 2027-2031, so each year is a
# fresh determination: the latest published 30th-percentile rent grown by
# gov.indices.private_rent_index to that year, then the (still 2024-cash)
# national maximum, anomalous-rate rule and March 2020 minimum. Annual
# redetermination is the engine's reading of "kept there each year".
#
# Northern Ireland: the parameter is UK-wide (NIHE determinations sit in the
# same table), so unfreezing alone would also raise NI rates. The statement
# says Great Britain only, so the modifier below holds NI benefit units at
# the native frozen (April 2024) determination.

LHA_FREEZE_PATH = "gov.dwp.LHA.freeze"
LHA_PERCENTILE_PATH = "gov.dwp.LHA.percentile"
MOCK3_LHA_FIRST_YEAR = 2027
MOCK3_LHA_YEARS = [y for y in MOCK3_YEARS if y >= MOCK3_LHA_FIRST_YEAR]
MOCK3_LHA_PERCENTILE = 0.3
# The determination the native baseline holds from April 2025 onward.
MOCK3_NATIVE_HELD_DETERMINATION = 2024


def _frozen_benunit_lha(
    benunit,
    period,
    universal_credit: bool = False,
    category_variable: str = "LHA_category",
):
    """benunit_lha's "rate" with the native April 2024 determination held.

    Replicates utils.lha.lha_rates for a frozen year (determination 2024 plus
    the held-table restatement) without reading the reformed freeze flag.
    """
    parameters = benunit.simulation.tax_benefit_system.parameters
    year = period.start.year
    held = MOCK3_NATIVE_HELD_DETERMINATION
    adjustment = None
    if held != year:
        measure = "uc_rate" if universal_credit else "rate"
        adjustment = restatement(measure, held, year)
    _, rate = determination(parameters, held, universal_credit, adjustment)
    brma = benunit.value_from_first_person(
        benunit.members.household("brma", period).decode_to_str()
    )
    category = benunit(category_variable, period).decode_to_str()
    brma_index = published_rates().brmas.get_indexer(brma)
    category_index = pd.Index(CATEGORIES).get_indexer(category)
    values = rate[np.maximum(brma_index, 0), np.maximum(category_index, 0)]
    return np.where((brma_index < 0) | (category_index < 0), np.nan, values)


def _ni_mask(benunit, period):
    country = benunit.members.household("country", period).decode_to_str()
    return benunit.value_from_first_person(country) == "NORTHERN_IRELAND"


def _gb_only(native_variable_class, frozen):
    """Wrap a native LHA variable: NI keeps the frozen value from 2027."""

    native_formula = native_variable_class.formula

    class _Wrapped(native_variable_class):
        def formula(benunit, period, parameters):
            value = native_formula(benunit, period, parameters)
            if period.start.year < MOCK3_LHA_FIRST_YEAR:
                return value
            return where(
                _ni_mask(benunit, period), frozen(benunit, period), value
            )

    _Wrapped.__name__ = native_variable_class.__name__
    return _Wrapped


def _build_gb_only_lha_reform():
    from policyengine_uk.variables.gov.dwp.BRMA_LHA_rate import (
        BRMA_LHA_rate,
    )
    from policyengine_uk.variables.gov.dwp.housing_benefit_LHA_rate import (
        housing_benefit_LHA_rate,
    )
    from policyengine_uk.variables.gov.dwp.uc_LHA_cap import uc_LHA_cap

    brma = _gb_only(
        BRMA_LHA_rate,
        lambda b, p: _frozen_benunit_lha(b, p) * WEEKS_IN_YEAR,
    )
    hb = _gb_only(
        housing_benefit_LHA_rate,
        lambda b, p: _frozen_benunit_lha(
            b, p, category_variable="housing_benefit_LHA_category"
        )
        * WEEKS_IN_YEAR,
    )
    uc = _gb_only(
        uc_LHA_cap,
        lambda b, p: min_(
            b("benunit_rent", p),
            _frozen_benunit_lha(b, p, universal_credit=True) * MONTHS_IN_YEAR,
        ),
    )

    class _GbOnlyLhaReform(CoreReform):
        def apply(self):
            self.update_variable(brma)
            self.update_variable(hb)
            self.update_variable(uc)

    return _GbOnlyLhaReform


def _ensure_formula_runs(sim, variable: str) -> None:
    """Fail loudly if a stored dataset column would bypass the new formula."""
    if sim.get_holder(variable).get_known_periods():
        raise RuntimeError(
            f"{variable} is a stored input in this dataset; the MOCK drill 3 "
            "override would be bypassed"
        )


def _mock3_lha_gb_only_modifier(sim):
    _apply_reform_class(_build_gb_only_lha_reform(), sim)
    for variable in ("BRMA_LHA_rate", "housing_benefit_LHA_rate", "uc_LHA_cap"):
        _ensure_formula_runs(sim, variable)
    return sim


def _create_mock3_lha_30th_percentile() -> Reform:
    return Reform(
        id="mock3_lha_30th_percentile",
        name="Local Housing Allowance restored to 30th percentile",
        description=(
            "MOCK. From April 2027 Local Housing Allowance rates in Great "
            "Britain return to the 30th percentile of local rents and are "
            "redetermined at the 30th percentile each year to 2031-32. "
            "Baseline: the engine's native freeze at April 2024 rates. "
            "Northern Ireland stays frozen. National maximum rates unchanged."
        ),
        parameter_changes={
            LHA_FREEZE_PATH: {str(y): False for y in MOCK3_LHA_YEARS},
            LHA_PERCENTILE_PATH: {
                str(y): MOCK3_LHA_PERCENTILE for y in MOCK3_LHA_YEARS
            },
        },
        simulation_modifier=_mock3_lha_gb_only_modifier,
    )


# =============================================================================
# #2 Warm Home Discount £100 top-up, England and Wales
# =============================================================================
#
# The engine has no Warm Home Discount variable, so eligibility is a proxy
# for the WHD scheme's two groups, assessed on the benefit unit:
#   core group 1: Pension Credit guarantee credit (in_receipt_of_guarantee_
#     credit, which applies PC take-up);
#   core group 2 proxy: any qualifying means-tested benefit received
#     (> 0 annual amount): Universal Credit, income-related ESA, income-based
#     JSA, Income Support, Housing Benefit, Child Tax Credit, Working Tax
#     Credit. Any further scheme tests (e.g. the energy-cost test, removed
#     in the 2025-26 expansion) are not modelled; caseload check is open.
# One £100 per household however many benefit units qualify. Engine years
# 2026 (FY 2026-27, winter 2026-27) and 2027 (winter 2027-28). Scotland and
# Northern Ireland excluded. Paid through cost_of_living_support_payment,
# which feeds household_benefits -> household_net_income and gov_spending and
# is not read by any tax base or means test (WHD is disregarded and untaxed).

MOCK3_WHD_AMOUNT = 100
MOCK3_WHD_YEARS = (2026, 2027)
MOCK3_WHD_COUNTRIES = ("ENGLAND", "WALES")
MOCK3_WHD_QUALIFYING_BENEFITS = (
    "universal_credit",
    "esa_income",
    "jsa_income",
    "income_support",
    "housing_benefit",
    "child_tax_credit",
    "working_tax_credit",
)
MOCK3_WHD_STATEMENT_CASELOAD = 5_400_000  # households; check open


class mock3_whd_top_up_eligible(Variable):
    value_type = bool
    entity = BenUnit
    label = "Eligible for the MOCK Warm Home Discount top-up (proxy)"
    definition_period = YEAR

    def formula(benunit, period, parameters):
        eligible = benunit("in_receipt_of_guarantee_credit", period)
        for benefit in MOCK3_WHD_QUALIFYING_BENEFITS:
            eligible = eligible | (benunit(benefit, period) > 0)
        return eligible


class mock3_whd_top_up(Variable):
    value_type = float
    entity = Household
    label = "MOCK Warm Home Discount top-up"
    unit = GBP
    definition_period = YEAR

    def formula(household, period, parameters):
        if period.start.year not in MOCK3_WHD_YEARS:
            return household.empty_array()
        eligible = household.any(
            household.members.benunit("mock3_whd_top_up_eligible", period)
        )
        country = household("country", period).decode_to_str()
        in_ew = np.isin(country, MOCK3_WHD_COUNTRIES)
        return eligible * in_ew * MOCK3_WHD_AMOUNT


class cost_of_living_support_payment(Variable):
    """Engine cost-of-living payment plus the MOCK WHD top-up."""

    label = "Cost-of-living support payment (incl. MOCK WHD top-up)"
    entity = Household
    definition_period = YEAR
    value_type = float
    unit = GBP

    def formula(household, period, parameters):
        return _engine_col_payment.formula(
            household, period, parameters
        ) + household("mock3_whd_top_up", period)


class _WhdTopUpReform(CoreReform):
    def apply(self):
        self.update_variable(mock3_whd_top_up_eligible)
        self.update_variable(mock3_whd_top_up)
        self.update_variable(cost_of_living_support_payment)


def _mock3_whd_top_up_modifier(sim):
    _apply_reform_class(_WhdTopUpReform, sim)
    _ensure_formula_runs(sim, "cost_of_living_support_payment")
    return sim


def _create_mock3_whd_top_up() -> Reform:
    return Reform(
        id="mock3_whd_top_up",
        name="Warm Home Discount £100 top-up",
        description=(
            f"MOCK. An extra £{MOCK3_WHD_AMOUNT} per household in England and "
            "Wales receiving the Warm Home Discount, in winter 2026-27 and "
            "winter 2027-28 (model years 2026 and 2027), funded by the "
            "taxpayer. Eligibility proxy: Pension Credit guarantee credit or "
            "a means-tested benefit (UC, income-related ESA, income-based "
            "JSA, Income Support, Housing Benefit, tax credits). Not taxable "
            "and disregarded for benefits."
        ),
        simulation_modifier=_mock3_whd_top_up_modifier,
    )
