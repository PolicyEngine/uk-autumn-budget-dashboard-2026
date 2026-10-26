"""Candidate measures for the UK Autumn Budget 2026 (28 October 2026).

These are candidates, modelled before the Budget from reporting and
briefing up to 24 October 2026; none is announced policy. They replaced
the nine Autumn Budget 2025 placeholder measures on 24 October, all of
which are already in the policyengine-uk 2.132.6 baseline or had lapsed.

Every measure is compared against current law: the installed
policyengine-uk (2.132.6, through policyengine 6.10.2), with no baseline
changes of its own, except the Plan 2 measure, whose baseline also counts
modelled student loan repayments. A measure changes parameters
(``parameter_changes``, bound by content) or applies a modifier from
``budget_measures``, each in a module of its own (of fixed shape, which
receipts can bind; this module fills caches at run time, so no modifier
may live here).

Year Y is fiscal year Y-(Y+1).
"""

import os
import re
from datetime import date
from typing import Optional

from uk_budget_data.budget_measures.connect_student_loan_repayments import (
    connect_student_loan_repayments,
)
from uk_budget_data.budget_measures.employer_ni_relief_ages_21_to_24 import (
    employer_ni_relief_ages_21_to_24,
)
from uk_budget_data.budget_measures.pump_vat_on_fuel_duty_deferral import (
    pump_vat_on_fuel_duty_deferral,
)
from uk_budget_data.budget_measures.road_fuel_vat_cut import road_fuel_vat_cut
from uk_budget_data.budget_measures.state_pension_income_tax_allowance import (
    state_pension_income_tax_allowance,
)
from uk_budget_data.budget_measures.state_pension_income_tax_allowance_untapered import (
    state_pension_income_tax_allowance_untapered,
)
from uk_budget_data.budget_measures.state_pension_only_income_tax_allowance import (
    state_pension_only_income_tax_allowance,
)
from uk_budget_data.budget_measures.warm_home_discount_top_up import (
    warm_home_discount_top_up,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_gas import (
    zero_vat_on_domestic_gas,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.measure_templates import rate_change, threshold_change
from uk_budget_data.models import Reform

# Default years for parameter changes: the policy years in
# budget_years.json, which the page reads too (2026-27 to 2031-32)
DEFAULT_YEARS = list(POLICY_YEARS)

FUEL_DUTY = "gov.hmrc.fuel_duty.petrol_and_diesel"
PERSONAL_ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
BASIC_RATE_BAND = "gov.hmrc.income_tax.rates.uk[1].threshold"
BADR_LIFETIME_LIMIT = "gov.hmrc.cgt.badr.lifetime_limit"
PLAN_2_THRESHOLD = "gov.hmrc.student_loans.thresholds.plan_2"

FUEL_DUTY_DEFERRAL_ID = "fuel_duty_rise_deferral"
STATE_PENSION_ALLOWANCE_ID = "state_pension_income_tax_protection"
WARM_HOME_DISCOUNT_ID = "warm_home_discount_top_up"
ELECTRICITY_VAT_ID = "domestic_electricity_zero_vat"
EMPLOYER_NI_ID = "employer_ni_relief_under_25s"
THRESHOLD_FREEZE_ID = "threshold_freeze_2031_32"
BADR_ID = "badr_lifetime_limit_cut"
FUEL_VAT_ID = "road_fuel_vat_cut"
PLAN_2_ID = "plan_2_threshold_unfreeze"


def _years_dict(value, years: list[int] = None) -> dict[str, any]:
    """Create a {year: value} dict for parameter changes."""
    years = years or DEFAULT_YEARS
    return {str(y): value for y in years}


def _years_from(first_year: int, value) -> dict[str, any]:
    """A {year: value} dict for every policy year from ``first_year``."""
    return _years_dict(value, [y for y in POLICY_YEARS if y >= first_year])


# =============================================================================
# 1. FUEL DUTY: THE JANUARY AND MARCH 2027 RISES DEFERRED
# =============================================================================

# Current law in policyengine-uk 2.132.6 (petrol_and_diesel.yaml), by the
# date each rate takes effect: 52.95p to 31 December 2026, 55.95p from
# 1 January 2027, 57.95p from 1 March 2027, then RPI each April. The 2032
# step is the engine's own uprating (2031's rate by 2031 RPI growth).
FUEL_DUTY_CURRENT_LAW = (
    ("2026-03-23", 0.5295),
    ("2027-01-01", 0.5595),
    ("2027-03-01", 0.5795),
    ("2027-04-01", 0.5975),
    ("2028-04-01", 0.6154),
    ("2029-04-01", 0.6326),
    ("2030-04-01", 0.6509),
    ("2031-04-01", 0.6659),
    ("2032-04-01", 0.6812),
)
# The research's most likely path: 52.95p held through winter 2026-27 with
# no April 2027 RPI rise; the 5p restored in 2027-28 in two steps, 3p on
# 1 September and 2p on 1 December 2027 (Budget 2025's staging, a year
# on); RPI from April 2028, on 57.95p. So from April 2028 each rate is
# current law's scaled by 57.95 / 59.75, a year's RPI below it.
FUEL_DUTY_STAGES = (
    ("2026-03-23", 0.5295),
    ("2027-09-01", 0.5595),
    ("2027-12-01", 0.5795),
)
FUEL_DUTY_RPI_FROM = "2028-04-01"


def fuel_duty_deferral_schedule() -> tuple:
    """The candidate's rates by the date each takes effect."""
    scale = 0.5795 / 0.5975
    later = tuple(
        (day, round(rate * scale, 4))
        for day, rate in FUEL_DUTY_CURRENT_LAW
        if day >= FUEL_DUTY_RPI_FROM
    )
    return FUEL_DUTY_STAGES + later


def fiscal_year_means(schedule, years=DEFAULT_YEARS) -> dict[str, float]:
    """Day-weighted mean rate in each model year, 6 April to 5 April, as
    the engine blends the fuel duty parameter (``fiscal_year_blend``)."""
    steps = [(date.fromisoformat(day), rate) for day, rate in schedule]
    means = {}
    for year in years:
        start, end = date(year, 4, 6), date(year + 1, 4, 6)
        total = 0.0
        for k, (day, rate) in enumerate(steps):
            following = steps[k + 1][0] if k + 1 < len(steps) else end
            low, high = max(day, start), min(following, end)
            if high > low:
                total += (high - low).days * rate
        means[str(year)] = total / (end - start).days
    return means


def fuel_duty_deferral_rates() -> dict[str, float]:
    """The candidate's annual fuel duty rates, every policy year (the
    parameter is uprated, so a bounded change would return to the old
    path: policyengine-uk #2430)."""
    return {
        year: round(rate, 6)
        for year, rate in fiscal_year_means(
            fuel_duty_deferral_schedule()
        ).items()
    }


def _create_fuel_duty_rise_deferral() -> Reform:
    return Reform(
        id=FUEL_DUTY_DEFERRAL_ID,
        name="Fuel duty rises deferred",
        description=(
            "Candidate measure. Fuel duty stays at 52.95p a litre through "
            "winter 2026-27, with no April 2027 RPI rise; the 5p is restored "
            "in 2027-28 (3p on 1 September, 2p on 1 December 2027), and RPI "
            "uprating resumes in April 2028 from 57.95p. Rates are "
            "day-weighted to fiscal years. Includes the VAT on the lower "
            "pump price."
        ),
        parameter_changes=rate_change(FUEL_DUTY, fuel_duty_deferral_rates()),
        simulation_modifier=pump_vat_on_fuel_duty_deferral,
    )


# =============================================================================
# 2. NO INCOME TAX FOR PENSIONERS WHOSE ONLY INCOME IS THE STATE PENSION
# =============================================================================


def _create_state_pension_income_tax_protection() -> Reform:
    return Reform(
        id=STATE_PENSION_ALLOWANCE_ID,
        name="State Pension income tax protection",
        description=(
            "Candidate measure. From 6 April 2027, people over State Pension "
            "age get an income tax allowance equal to the full new State "
            "Pension (rounded up to £10: £13,040 in 2027-28), withdrawn £1 "
            "for £1 of income above it, down to the standard personal "
            "allowance. Someone whose only income is the full new State "
            "Pension pays no income tax."
        ),
        simulation_modifier=state_pension_income_tax_allowance,
    )


# =============================================================================
# 3. WARM HOME DISCOUNT FROM £150 TO £250, WINTER 2026-27
# =============================================================================


def _create_warm_home_discount_top_up() -> Reform:
    return Reform(
        id=WARM_HOME_DISCOUNT_ID,
        name="Warm Home Discount top-up",
        description=(
            "Candidate measure. The Warm Home Discount rises from £150 to "
            "£250 for winter 2026-27 only: £100 more to each household in "
            "Great Britain receiving Universal Credit, Pension Credit, "
            "Housing Benefit or income-related ESA. Receipt follows DESNZ's "
            "rates: 85% of Pension Credit households and 70% of other "
            "eligible households. Eligibility follows England and Wales's "
            "2026-27 core group, so households in Scotland are approximate."
        ),
        simulation_modifier=warm_home_discount_top_up,
    )


# =============================================================================
# 4. ZERO VAT ON DOMESTIC ELECTRICITY, 1 OCTOBER 2026 TO 31 MARCH 2028
# =============================================================================


def _create_domestic_electricity_zero_vat() -> Reform:
    return Reform(
        id=ELECTRICITY_VAT_ID,
        name="Zero VAT on domestic electricity",
        description=(
            "Candidate measure. VAT on domestic electricity is 0% instead "
            "of 5% from 1 October 2026 to 31 March 2028: the zero rate to "
            "March 2027, not in the model's baseline, scored with a "
            "candidate one-year extension. Applied to electricity spending "
            "only, day-weighted in 2026-27."
        ),
        simulation_modifier=zero_vat_on_domestic_electricity,
    )


# =============================================================================
# 5. EMPLOYER NI RELIEF FOR UNDER-25S
# =============================================================================


def _create_employer_ni_relief_under_25s() -> Reform:
    return Reform(
        id=EMPLOYER_NI_ID,
        name="Employer NI relief for under-25s",
        description=(
            "Candidate measure. From 6 April 2027 employers pay no "
            "secondary Class 1 National Insurance on earnings up to the "
            "upper earnings limit (£50,270) for employees under 25, "
            "extending the under-21 relief to ages 21 to 24. Wages are held "
            "fixed, so it changes revenue, not household incomes."
        ),
        simulation_modifier=employer_ni_relief_ages_21_to_24,
    )


# =============================================================================
# 6. THRESHOLD FREEZE EXTENDED INTO 2031-32
# =============================================================================


def _create_threshold_freeze_2031_32() -> Reform:
    changes = threshold_change(PERSONAL_ALLOWANCE, {"2031": 12570})
    changes.update(threshold_change(BASIC_RATE_BAND, {"2031": 37700}))
    return Reform(
        id=THRESHOLD_FREEZE_ID,
        name="Threshold freeze to 2031-32",
        description=(
            "Candidate measure. The income tax personal allowance stays at "
            "£12,570 and the basic rate band at £37,700 (a higher rate "
            "threshold of £50,270) for one more year, 2031-32, instead of "
            "rising with inflation to £12,830 and £38,500. From 2031-32 "
            "policyengine-uk sets the National Insurance primary threshold "
            "and upper earnings limit at the personal allowance and higher "
            "rate threshold, so they stay at £12,570 and £50,270 too; the "
            "employer secondary threshold is not held."
        ),
        parameter_changes=changes,
    )


# =============================================================================
# 7. BUSINESS ASSET DISPOSAL RELIEF RESTRICTED
# =============================================================================


def _create_badr_lifetime_limit_cut() -> Reform:
    return Reform(
        id=BADR_ID,
        name="Business Asset Disposal Relief restricted",
        description=(
            "Candidate measure. From 6 April 2027 the lifetime limit on "
            "gains qualifying for Business Asset Disposal Relief falls from "
            "£1 million to £500,000; the relief rate stays at 18%. Gains "
            "above the limit pay the main capital gains tax rates. The "
            "model applies the limit to each year's gains."
        ),
        parameter_changes=threshold_change(
            BADR_LIFETIME_LIMIT, _years_from(2027, 500_000)
        ),
    )


# =============================================================================
# 8. TEMPORARY VAT CUT ON ROAD FUEL
# =============================================================================


def _create_road_fuel_vat_cut() -> Reform:
    return Reform(
        id=FUEL_VAT_ID,
        name="VAT cut on road fuel",
        description=(
            "Candidate measure. VAT on petrol and diesel falls from 20% to "
            "15% from 1 December 2026 to 31 May 2027, fully passed through "
            "to pump prices; spending on fuel is held fixed. Day-weighted "
            "to fiscal years."
        ),
        simulation_modifier=road_fuel_vat_cut,
    )


# =============================================================================
# 9. PLAN 2 STUDENT LOAN REPAYMENT THRESHOLD UNFROZEN
# =============================================================================

# The Plan 2 threshold in 2026-27, before the Budget 2025 freeze.
PLAN_2_THRESHOLD_2026 = 29385


def plan_2_unfrozen_thresholds() -> dict[str, float]:
    """The Plan 2 threshold uprated by RPI each April from 2027, as the
    law did before the Budget 2025 freeze (2027-28 to 2029-30), with the
    engine's RPI index; every policy year from 2027, since the parameter is
    uprated (policyengine-uk #2430)."""
    from policyengine_uk.system import system

    rpi = system.parameters.gov.economic_assumptions.indices.obr.rpi
    base = rpi("2026-04-06")
    return {
        str(year): round(PLAN_2_THRESHOLD_2026 * rpi(f"{year}-04-06") / base)
        for year in POLICY_YEARS
        if year >= 2027
    }


def _create_plan_2_threshold_unfreeze() -> Reform:
    return Reform(
        id=PLAN_2_ID,
        name="Plan 2 student loan threshold unfrozen",
        description=(
            "Candidate measure. The Plan 2 student loan repayment threshold "
            "rises with RPI from April 2027 (to £30,267 in 2027-28), reversing "
            "the freeze at £29,385 to April 2030. Repayments are modelled, "
            "replacing those reported in the survey, and the revenue figure "
            "is the change in modelled repayments."
        ),
        parameter_changes=threshold_change(
            PLAN_2_THRESHOLD, plan_2_unfrozen_thresholds()
        ),
        simulation_modifier=connect_student_loan_repayments,
        baseline_simulation_modifier=connect_student_loan_repayments,
    )


# =============================================================================
# COMBINED PACKAGE
# =============================================================================

AUTUMN_BUDGET_2026_COMBINED_ID = "autumn_budget_2026_combined"
# The measures the combined reform brings together, by id. The combined
# reform is simulated whole, so this list does not change what it does; it
# names its parts, so results by area can check it as a package of them.
AUTUMN_BUDGET_2026_COMBINED_COMPONENTS = (
    FUEL_DUTY_DEFERRAL_ID,
    STATE_PENSION_ALLOWANCE_ID,
    WARM_HOME_DISCOUNT_ID,
    ELECTRICITY_VAT_ID,
    EMPLOYER_NI_ID,
    THRESHOLD_FREEZE_ID,
    BADR_ID,
    FUEL_VAT_ID,
    PLAN_2_ID,
)

_MEASURE_FACTORIES = (
    _create_fuel_duty_rise_deferral,
    _create_state_pension_income_tax_protection,
    _create_warm_home_discount_top_up,
    _create_domestic_electricity_zero_vat,
    _create_employer_ni_relief_under_25s,
    _create_threshold_freeze_2031_32,
    _create_badr_lifetime_limit_cut,
    _create_road_fuel_vat_cut,
    _create_plan_2_threshold_unfreeze,
)


# =============================================================================
# DRILL 5 (MOCK DATA, 26 October 2026; do not merge)
# =============================================================================
# Six of the nine candidates above plus nine new measures: the fifteen most
# probable measures PolicyEngine UK can model, from Manifold's UK Autumn
# Budget 2026 markets and reporting up to 25 October 2026. Select them with
# UK_BUDGET_MEASURE_SET=drill5; without it, nothing below is registered.
# Specifics are mock values where reporting gives none (issue: Drill 5).
# A sixteenth, the State Pension protection for those whose only income is
# the State Pension, was added on 26 October from that day's reporting, as
# an alternative to the base protection.

UC_STANDARD_ALLOWANCE = "gov.dwp.universal_credit.standard_allowance.amount"
UC_CLAIMANT_TYPES = (
    "SINGLE_YOUNG",
    "SINGLE_OLD",
    "COUPLE_YOUNG",
    "COUPLE_OLD",
)
NI_SECONDARY_THRESHOLD = (
    "gov.hmrc.national_insurance.class_1.thresholds.secondary_threshold"
)
CGT_BASIC_RATE = "gov.hmrc.cgt.basic_rate"
CGT_HIGHER_RATE = "gov.hmrc.cgt.higher_rate"
HVCTS_FIRST_THRESHOLD = (
    "gov.hmrc.council_tax.high_value_surcharge.amount[1].threshold"
)
LHA_FREEZE = "gov.dwp.LHA.freeze"
DIVIDEND_RATES = tuple(
    f"gov.hmrc.income_tax.rates.dividends[{band}].rate" for band in (0, 1, 2)
)

UC_BELOW_CPI_ID = "uc_standard_allowance_below_cpi"
STATE_PENSION_EXTENDED_ID = "state_pension_income_tax_protection_extended"
STATE_PENSION_SOLE_INCOME_ID = (
    "state_pension_income_tax_protection_sole_income"
)
NI_SECONDARY_THRESHOLD_ID = "employer_ni_secondary_threshold_raised"
CGT_RATES_ID = "cgt_main_rates_up_2pp"
HVCTS_ID = "council_tax_surcharge_from_1_5m"
LHA_RESET_ID = "lha_reset_april_2027"
DIVIDEND_RATES_ID = "dividend_rates_up_1pp"
GAS_VAT_ID = "domestic_gas_zero_vat"

# Measures that are alternatives to another drill 5 measure, so the drill's
# combined run leaves them out (each replaces the base protection).
DRILL5_ALTERNATIVES = (STATE_PENSION_EXTENDED_ID, STATE_PENSION_SOLE_INCOME_ID)


def _current_law(path: str, year: int):
    from policyengine_uk.system import system

    node = system.parameters
    for part in re.split(r"\.(?![^\[]*\])", path):
        match = re.fullmatch(r"(\w+)\[(\d+)\]", part)
        if match:
            node = getattr(node, match.group(1)).brackets[int(match.group(2))]
        else:
            node = getattr(node, part)
    return node(f"{year}-04-06")


def _create_uc_standard_allowance_below_cpi() -> Reform:
    changes = {}
    for claimant in UC_CLAIMANT_TYPES:
        path = f"{UC_STANDARD_ALLOWANCE}.{claimant}"
        changes.update(
            threshold_change(
                path,
                {
                    str(y): round(_current_law(path, y) * 0.99, 2)
                    for y in POLICY_YEARS
                    if y >= 2027
                },
            )
        )
    return Reform(
        id=UC_BELOW_CPI_ID,
        name="UC standard allowance uprated below CPI",
        description=(
            "Drill 5 mock measure. The Universal Credit standard allowance "
            "rises by one point less than CPI in April 2027, so from "
            "2027-28 every claimant type's allowance is 1% below current "
            "law."
        ),
        parameter_changes=changes,
    )


def _create_state_pension_income_tax_protection_extended() -> Reform:
    return Reform(
        id=STATE_PENSION_EXTENDED_ID,
        name="State Pension income tax protection, extended",
        description=(
            "Drill 5 mock measure, an alternative to the State Pension "
            "income tax protection. People over State Pension age get a "
            "personal allowance of the full new State Pension from 2027-28, "
            "kept whatever their other income or State Pension increments."
        ),
        simulation_modifier=state_pension_income_tax_allowance_untapered,
    )


def _create_state_pension_income_tax_protection_sole_income() -> Reform:
    return Reform(
        id=STATE_PENSION_SOLE_INCOME_ID,
        name="State Pension income tax protection, State Pension income only",
        description=(
            "Drill 5 measure, from reporting on 26 October (BBC; The "
            "Times), an alternative to the State Pension income tax "
            "protection. From 6 April 2027, people over "
            "State Pension age whose only income is the State Pension "
            "(savings interest aside) get a personal allowance of the full "
            "new State Pension (£13,037 in 2027-28), rising with it. £1 of "
            "other income takes the whole allowance away."
        ),
        simulation_modifier=state_pension_only_income_tax_allowance,
    )


def _create_employer_ni_secondary_threshold_raised() -> Reform:
    return Reform(
        id=NI_SECONDARY_THRESHOLD_ID,
        name="Employer NI threshold raised by £1,000",
        description=(
            "Drill 5 mock measure. The employer National Insurance "
            "secondary threshold rises by £1,000 a year from April 2027 "
            "(£5,000 to £6,000 in 2027-28)."
        ),
        parameter_changes=threshold_change(
            NI_SECONDARY_THRESHOLD,
            {
                str(y): _current_law(NI_SECONDARY_THRESHOLD, y) + 1000 / 52
                for y in POLICY_YEARS
                if y >= 2027
            },
        ),
    )


def _create_cgt_main_rates_up_2pp() -> Reform:
    changes = rate_change(CGT_BASIC_RATE, _years_from(2027, 0.20))
    changes.update(rate_change(CGT_HIGHER_RATE, _years_from(2027, 0.26)))
    return Reform(
        id=CGT_RATES_ID,
        name="Capital gains tax main rates up 2 points",
        description=(
            "Drill 5 mock measure. From 6 April 2027 the main capital gains "
            "tax rates rise from 18% and 24% to 20% and 26%."
        ),
        parameter_changes=changes,
    )


def _create_council_tax_surcharge_from_1_5m() -> Reform:
    return Reform(
        id=HVCTS_ID,
        name="Council tax surcharge from £1.5m",
        description=(
            "Drill 5 mock measure. The High Value Council Tax Surcharge "
            "starts at £1.5 million instead of £2 million (2026 prices, "
            "uprated as current law), so homes from £1.5 million pay the "
            "first band's £2,500 from April 2028."
        ),
        parameter_changes=threshold_change(
            HVCTS_FIRST_THRESHOLD,
            {
                str(y): round(_current_law(HVCTS_FIRST_THRESHOLD, y) * 0.75)
                for y in POLICY_YEARS
                if y >= 2028
            },
        ),
    )


def _create_lha_reset_april_2027() -> Reform:
    return Reform(
        id=LHA_RESET_ID,
        name="Local Housing Allowance reset in April 2027",
        description=(
            "Drill 5 mock measure. Local Housing Allowance rates are reset "
            "to the 30th percentile of local rents in April 2027, then "
            "frozen in cash terms again."
        ),
        parameter_changes={LHA_FREEZE: {"2027": False}},
    )


def _create_dividend_rates_up_1pp() -> Reform:
    changes = {}
    for path in DIVIDEND_RATES:
        changes.update(
            rate_change(
                path,
                {
                    str(y): round(_current_law(path, y) + 0.01, 4)
                    for y in POLICY_YEARS
                    if y >= 2027
                },
            )
        )
    return Reform(
        id=DIVIDEND_RATES_ID,
        name="Dividend tax rates up 1 point",
        description=(
            "Drill 5 mock measure. From 6 April 2027 each dividend tax rate "
            "rises by one point (basic 10.75% to 11.75%)."
        ),
        parameter_changes=changes,
    )


def _create_domestic_gas_zero_vat() -> Reform:
    return Reform(
        id=GAS_VAT_ID,
        name="Zero VAT on domestic gas",
        description=(
            "Drill 5 mock measure. No VAT on household gas bills, instead "
            "of 5%, from 1 April 2027 to 31 March 2028."
        ),
        simulation_modifier=zero_vat_on_domestic_gas,
    )


_DRILL5_MEASURE_FACTORIES = (
    _create_fuel_duty_rise_deferral,
    _create_warm_home_discount_top_up,
    _create_uc_standard_allowance_below_cpi,
    _create_state_pension_income_tax_protection,
    _create_state_pension_income_tax_protection_extended,
    _create_state_pension_income_tax_protection_sole_income,
    _create_domestic_electricity_zero_vat,
    _create_employer_ni_secondary_threshold_raised,
    _create_employer_ni_relief_under_25s,
    _create_cgt_main_rates_up_2pp,
    _create_council_tax_surcharge_from_1_5m,
    _create_lha_reset_april_2027,
    _create_dividend_rates_up_1pp,
    _create_domestic_gas_zero_vat,
    _create_threshold_freeze_2031_32,
    _create_badr_lifetime_limit_cut,
)


def get_drill5_measures() -> list[Reform]:
    """The sixteen drill 5 measures, without a combined run."""
    return [factory() for factory in _DRILL5_MEASURE_FACTORIES]


def _measure_factories():
    if os.environ.get("UK_BUDGET_MEASURE_SET") == "drill5":
        return _DRILL5_MEASURE_FACTORIES
    return _MEASURE_FACTORIES


def _create_combined_autumn_budget_reform(members: list[Reform]) -> Reform:
    """One simulation of every candidate measure.

    Built by ``publication.combine.combine_measures``, as a combined run
    is: the members' merged parameter changes (it refuses two members
    changing one parameter) and each member's modifier, in order of measure
    id. The Plan 2 measure brings its baseline modifier, so the combined
    baseline counts modelled student loan repayments too.
    """
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication.combine import combine_measures

    combined = combine_measures(members, DataConfig())
    return Reform(
        id=AUTUMN_BUDGET_2026_COMBINED_ID,
        name="Autumn Budget 2026 candidates (combined)",
        description=(
            "All nine candidate measures simulated together: "
            + ", ".join(member.name for member in members)
            + ". Shows the package's impact with interactions."
        ),
        parameter_changes=combined.parameter_changes,
        simulation_modifier=combined.simulation_modifier,
        baseline_parameter_changes=combined.baseline_parameter_changes,
        baseline_simulation_modifier=combined.baseline_simulation_modifier,
    )


# =============================================================================
# REFORM COLLECTIONS (lazy-loaded to avoid import-time work)
# =============================================================================

_AUTUMN_BUDGET_2026_REFORMS_CACHE: list[Reform] | None = None
_REFORM_LOOKUP_CACHE: dict[str, Reform] | None = None


def _get_autumn_budget_2026_reforms() -> list[Reform]:
    global _AUTUMN_BUDGET_2026_REFORMS_CACHE
    if _AUTUMN_BUDGET_2026_REFORMS_CACHE is None:
        members = [factory() for factory in _measure_factories()]
        combined = [m for m in members if m.id not in DRILL5_ALTERNATIVES]
        _AUTUMN_BUDGET_2026_REFORMS_CACHE = [
            _create_combined_autumn_budget_reform(combined),  # Combined first
            *members,
        ]
    return _AUTUMN_BUDGET_2026_REFORMS_CACHE


def _get_reform_lookup() -> dict[str, Reform]:
    global _REFORM_LOOKUP_CACHE
    if _REFORM_LOOKUP_CACHE is None:
        _REFORM_LOOKUP_CACHE = {
            r.id: r for r in _get_autumn_budget_2026_reforms()
        }
    return _REFORM_LOOKUP_CACHE


def get_autumn_budget_2026_reforms() -> list[Reform]:
    """The combined package, then the nine candidate measures."""
    return _get_autumn_budget_2026_reforms()


def get_all_reforms() -> list[Reform]:
    """Every registered reform: the same list."""
    return _get_autumn_budget_2026_reforms()


def get_reform(reform_id: str) -> Optional[Reform]:
    """Get a reform by its ID, or None if not found."""
    return _get_reform_lookup().get(reform_id)


def list_reform_ids() -> list[str]:
    """Get a list of all available reform IDs."""
    return list(_get_reform_lookup().keys())
