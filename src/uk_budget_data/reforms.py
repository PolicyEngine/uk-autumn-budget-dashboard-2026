"""Candidate measures for the UK Autumn Budget 2026 (28 October 2026).

These are candidates, modelled before the Budget from reporting and
briefing up to 24 October 2026; none is announced policy. They replaced
the nine Autumn Budget 2025 placeholder measures on 24 October, all of
which are already in the policyengine-uk 2.132.6 baseline or had lapsed.

Every measure is compared against current law: the installed
policyengine-uk (2.132.6, through policyengine 6.10.2), with no baseline
changes of its own, except the Plan 2 measure, whose baseline also counts
modelled student loan repayments. Every measure that moves capital gains
tax holds capital gains realisations fixed (``static_capital_gains``), so
its figure is static. A measure changes parameters
(``parameter_changes``, bound by content) or applies a modifier from
``budget_measures``, each in a module of its own (of fixed shape, which
receipts can bind; this module fills caches at run time, so no modifier
may live here).

Year Y is fiscal year Y-(Y+1).
"""

from datetime import date
from typing import Optional

from uk_budget_data.budget_measures import (
    state_pension_only_income_tax_allowance as _sp_threshold,
)
from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
    carers_allowance_earnings_taper,
)
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
from uk_budget_data.budget_measures.state_pension_only_income_tax_allowance import (
    state_pension_only_income_tax_allowance,
)
from uk_budget_data.budget_measures.warm_home_discount_top_up import (
    warm_home_discount_top_up,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.measure_templates import rate_change, threshold_change
from uk_budget_data.models import Reform

# Default years for parameter changes: the policy years in
# budget_years.json, which the page reads too (2026-27 to 2031-32)
DEFAULT_YEARS = list(POLICY_YEARS)

# Legacy lifetime response columns have no reviewed publication contract.
# Keep this empty for receipt compatibility; the live single-year calculator
# uses the current registry through the household API.
PUBLIC_PERSONAL_SERIES: dict[str, dict] = {}

FUEL_DUTY = "gov.hmrc.fuel_duty.petrol_and_diesel"
PERSONAL_ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
BASIC_RATE_BAND = "gov.hmrc.income_tax.rates.uk[1].threshold"
BADR_LIFETIME_LIMIT = "gov.hmrc.cgt.badr.lifetime_limit"
PLAN_2_THRESHOLD = "gov.hmrc.student_loans.thresholds.plan_2"
CAPITAL_GAINS_RESPONSES = "gov.simulation.capital_gains_responses"
LHA_FREEZE = "gov.dwp.LHA.freeze"
# Northern Ireland's, which the Housing Executive sets as DWP does
LHA_FREEZE_NI = "gov.dfc.LHA.freeze"
# The employer (secondary) Class 1 threshold, weekly: £5,000 a year from
# April 2025 is stored as 5,000 / 52.
SECONDARY_THRESHOLD = (
    "gov.hmrc.national_insurance.class_1.employer_scale[1].threshold"
)
INCOME_TAX_RATES = "gov.hmrc.income_tax.rates"
# The dividend schedule's four brackets (the fourth a technical top node
# repeating the additional rate) and the savings and property rates.
UNEARNED_INCOME_RATE_PATHS = (
    f"{INCOME_TAX_RATES}.dividends[0].rate",
    f"{INCOME_TAX_RATES}.dividends[1].rate",
    f"{INCOME_TAX_RATES}.dividends[2].rate",
    f"{INCOME_TAX_RATES}.dividends[3].rate",
    f"{INCOME_TAX_RATES}.savings.basic",
    f"{INCOME_TAX_RATES}.savings.higher",
    f"{INCOME_TAX_RATES}.savings.additional",
    f"{INCOME_TAX_RATES}.property.basic",
    f"{INCOME_TAX_RATES}.property.higher",
    f"{INCOME_TAX_RATES}.property.additional",
)

FUEL_DUTY_DEFERRAL_ID = "fuel_duty_rise_deferral"
STATE_PENSION_ALLOWANCE_ID = "state_pension_income_tax_protection"
WARM_HOME_DISCOUNT_ID = "warm_home_discount_top_up"
ELECTRICITY_VAT_ID = "domestic_electricity_zero_vat"
EMPLOYER_NI_ID = "employer_ni_relief_under_25s"
THRESHOLD_FREEZE_ID = "threshold_freeze_2031_32"
BADR_ID = "badr_lifetime_limit_cut"
FUEL_VAT_ID = "road_fuel_vat_cut"
PLAN_2_ID = "plan_2_threshold_unfreeze"
EMPLOYER_NI_THRESHOLD_ID = "employer_nics_secondary_threshold_raise"
UNEARNED_INCOME_RATES_ID = "unearned_income_rates_up"
LHA_UNFREEZE_ID = "lha_unfreeze_2027"
CARERS_ALLOWANCE_TAPER_ID = "carers_allowance_earnings_taper"
STATE_PENSION_DOUBLE_LOCK_ID = "state_pension_double_lock_2030"


def _years_dict(value, years: list[int] = None) -> dict[str, any]:
    """Create a {year: value} dict for parameter changes."""
    years = years or DEFAULT_YEARS
    return {str(y): value for y in years}


def _years_from(first_year: int, value) -> dict[str, any]:
    """A {year: value} dict for every policy year from ``first_year``."""
    return _years_dict(value, [y for y in POLICY_YEARS if y >= first_year])


def static_capital_gains() -> dict[str, dict[str, any]]:
    """No capital gains realisation response, in every policy year.

    Set by every measure that moves capital gains tax, through its rates,
    bands, allowances or reliefs, so its figure is static: the Business
    Asset Disposal Relief limit, the threshold freeze (the basic rate band)
    and the State Pension allowance (taxable income). This is the static
    setting policyengine-uk's own parameter descriptions give: both
    elasticities 0, and gains qualifying for the relief on the main
    elasticity. 2.132.6 has no response by default, so nothing changes on
    it; from 2.134.0 the main elasticity defaults to 1, which would turn a
    static figure into a post-response one.

    The reform side is enough: the engine scales the reformed simulation's
    gains by its own elasticities, against current law's rates, and current
    law against itself has no rate change to respond to. It is a shared
    setting, so members of a combined run may each set it
    (``combine.SHARED_SETTINGS``).
    """
    changes = rate_change(
        f"{CAPITAL_GAINS_RESPONSES}.elasticity", _years_dict(0)
    )
    changes.update(
        rate_change(
            f"{CAPITAL_GAINS_RESPONSES}.mtr_elasticity", _years_dict(0)
        )
    )
    changes[f"{CAPITAL_GAINS_RESPONSES}.separate_badr_elasticity"] = (
        _years_dict(False)
    )
    return changes


# =============================================================================
# 1. FUEL DUTY: FROZEN AT 52.95P THROUGH 2027-28
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
# The candidate (Vahid, 27 October 2026): no 1 January 2027 rise, so the
# 5p cut continues and 52.95p is frozen through 2027-28 (to 31 March
# 2028), with neither the March 2027 step nor the April 2027 RPI rise; RPI
# uprating resumes in April 2028 from 52.95p. So from April 2028 each rate
# is current law's scaled by 52.95 / 59.75, the 5p and a year's RPI below
# it.
#
# Budget day: the two numbers to set from the Budget document.
# - FUEL_DUTY_FROZEN: the frozen rate, £ a litre. 0.5295 keeps the 5p cut
#   (52.95p); 0.5795 would let it lapse and freeze at 57.95p.
# - FUEL_DUTY_FROZEN_THROUGH: the last fiscal year the freeze covers (2027
#   = 2027-28, to 31 March 2028). RPI uprating resumes on 1 April of the
#   next year, from the frozen rate. Must be a year with an April step in
#   FUEL_DUTY_CURRENT_LAW (2027 to 2031).
# Changing either changes the pump VAT modifier's defaults too
# (budget_measures/pump_vat_on_fuel_duty_deferral.py):
# ``uv run python -c "from uk_budget_data.reforms import
# pump_vat_on_fuel_duty_deferral_defaults as d; print(d())"`` prints them,
# and tests/test_reforms.py fails until they are pasted in.
FUEL_DUTY_FROZEN = 0.5295
FUEL_DUTY_FROZEN_THROUGH = 2027
FUEL_DUTY_STAGES = (("2026-03-23", FUEL_DUTY_FROZEN),)
FUEL_DUTY_RPI_FROM = f"{FUEL_DUTY_FROZEN_THROUGH + 1}-04-01"


def _fuel_duty_scale_base() -> float:
    """Current law's rate just before uprating resumes, which the frozen
    rate stands in for (59.75p, its April 2027 rate, for a freeze through
    2027-28); later rates are current law's scaled by frozen / this."""
    before = [
        rate for day, rate in FUEL_DUTY_CURRENT_LAW if day < FUEL_DUTY_RPI_FROM
    ]
    return before[-1]


def fuel_duty_deferral_schedule() -> tuple:
    """The candidate's rates by the date each takes effect."""
    scale = FUEL_DUTY_FROZEN / _fuel_duty_scale_base()
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


def pump_vat_on_fuel_duty_deferral_defaults() -> dict[str, float]:
    """The pump VAT modifier's defaults for the current freeze: for each
    fuel and year, 0.24 x the duty change / the engine's pump price (see
    the modifier's comment). Paste them into
    ``budget_measures/pump_vat_on_fuel_duty_deferral.py`` after changing
    the freeze."""
    from policyengine_uk.system import system

    prices = system.parameters.household.consumption.fuel.prices
    rates = fuel_duty_deferral_rates()
    current = fiscal_year_means(FUEL_DUTY_CURRENT_LAW)
    return {
        f"{fuel}_{year}": 0.24
        * (rates[str(year)] - current[str(year)])
        / getattr(prices, fuel)(f"{year}-04-30")
        for year in POLICY_YEARS
        for fuel in ("petrol", "diesel")
    }


def _fiscal_year_label(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


def _pence(rate: float) -> str:
    return f"{rate * 100:.2f}p"


def _fuel_duty_deferral_description() -> str:
    frozen = _pence(FUEL_DUTY_FROZEN)
    through = FUEL_DUTY_FROZEN_THROUGH
    resume = through + 1
    if FUEL_DUTY_FROZEN == 0.5295:
        cut = "so the 5p cut continues"
    else:
        cut = "so the 5p cut ends"
    rises = "there is no March 2027 step and no April 2027 RPI rise"
    skipped = "the 5p and that year's RPI are"
    if through > 2027:
        rises += (
            ", nor the April 2028 RPI rise"
            if through == 2028
            else f", nor any April RPI rise from 2028 to {through}"
        )
        skipped = "the 5p and those years' RPI are"
    if FUEL_DUTY_FROZEN != 0.5295:
        skipped = skipped.replace("the 5p and ", "")
    # On main's values this is main's description, byte for byte.
    return (
        f"Candidate measure. Fuel duty stays at {frozen} a litre through "
        f"{_fiscal_year_label(through)} (to 31 March {resume}): the rise "
        f"due on 1 January 2027 does not happen, {cut}, and {rises}. RPI "
        f"uprating resumes in April {resume} from {frozen}, so {skipped} "
        "never made up. Rates are day-weighted to fiscal years. Includes "
        "the VAT on the lower pump price."
    )


def _create_fuel_duty_rise_deferral() -> Reform:
    return Reform(
        id=FUEL_DUTY_DEFERRAL_ID,
        name="Fuel duty rises deferred",
        description=_fuel_duty_deferral_description(),
        parameter_changes=rate_change(FUEL_DUTY, fuel_duty_deferral_rates()),
        simulation_modifier=pump_vat_on_fuel_duty_deferral,
    )


# =============================================================================
# 2. NO INCOME TAX FOR PENSIONERS WHOSE TOTAL INCOME IS AT MOST THE FULL
#    NEW STATE PENSION
# =============================================================================


# The design: "total_income" follows the reporting of 27 October 2026
# (Telegraph: "officials have broadened it ... provided their total income
# stays below the threshold"; GB News): an allowance of the full new State
# Pension for people over State Pension age whose total income, State
# Pension included, is at or below it. It broadened the "sole_income"
# design of 26 October (BBC; The Times), for pensioners "wholly reliant on
# the state pension", which the same module gives with
# other_income_limit=0, total_income_at_most_allowance=False and
# disregard_savings_interest=True. "tapered", the design modelled before
# that, gives the allowance to everyone over State Pension age and
# withdraws it £1 for £1 of income above it.
#
# Budget day: two switches. The design here (``total_income``, or
# ``tapered``: everyone over State Pension age, withdrawn £1 for £1 above
# it), and the rounding of the threshold, ``ROUND_DOWN`` in
# budget_measures/state_pension_only_income_tax_allowance.py (up: £13,037
# in 2027-28; down: £13,036, as the Times reports). The description
# follows the rounding.
STATE_PENSION_PROTECTION_DESIGN = "total_income"
_SP_ROUNDING = "down" if _sp_threshold.ROUND_DOWN else "up"
_SP_THRESHOLD_2027 = state_pension_only_income_tax_allowance.__defaults__[0]
STATE_PENSION_PROTECTION_DESIGNS = {
    "total_income": (
        state_pension_only_income_tax_allowance,
        "Candidate measure. From 6 April 2027, people over State Pension "
        "age whose total income (the State Pension, with any increments "
        "or additional State Pension, plus all other income, savings "
        "interest included) is at or below the full new State Pension "
        f"(rounded {_SP_ROUNDING} to the pound: £{_SP_THRESHOLD_2027:,} in "
        "2027-28, rising with it) get "
        "an income tax allowance of that amount, so pay no income tax. "
        "Above it there is no allowance: £1 of income over the threshold "
        "takes the whole allowance away.",
    ),
    "tapered": (
        state_pension_income_tax_allowance,
        "Candidate measure. From 6 April 2027, people over State Pension "
        "age get an income tax allowance equal to the full new State "
        "Pension (rounded up to £10: £13,040 in 2027-28), withdrawn £1 "
        "for £1 of income above it, down to the standard personal "
        "allowance. Someone whose only income is the full new State "
        "Pension pays no income tax.",
    ),
}


def _create_state_pension_income_tax_protection(
    design: str = None,
) -> Reform:
    modifier, description = STATE_PENSION_PROTECTION_DESIGNS[
        design or STATE_PENSION_PROTECTION_DESIGN
    ]
    return Reform(
        id=STATE_PENSION_ALLOWANCE_ID,
        name="State Pension income tax protection",
        description=description,
        simulation_modifier=modifier,
        # The allowance moves taxable income, so the capital gains rate.
        parameter_changes=static_capital_gains(),
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
            "only, in Great Britain (Northern Ireland keeps the 5%). "
            "2026-27 carries the October to March share of a year's "
            "electricity use (about 57%), not a share of its days."
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
            "fixed, so it changes revenue, not household incomes. The data "
            "identify no apprentices, so the cost includes 21 to 24-year-old "
            "apprentices, whose employers already pay none in law."
        ),
        simulation_modifier=employer_ni_relief_ages_21_to_24,
    )


# =============================================================================
# 6. THRESHOLD FREEZE EXTENDED INTO 2031-32
# =============================================================================


def _create_threshold_freeze_2031_32() -> Reform:
    changes = threshold_change(PERSONAL_ALLOWANCE, {"2031": 12570})
    changes.update(threshold_change(BASIC_RATE_BAND, {"2031": 37700}))
    # The basic rate band sets which gains pay the lower capital gains rate.
    changes.update(static_capital_gains())
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
            "model applies the limit to each year's gains. Capital gains "
            "are imputed and calibrated to 2024-25, when disposals were "
            "unusually high ahead of the April 2025 rise in the relief's "
            "rate, so the relief's base, and the revenue from restricting "
            "it, are likely 1.5 to 1.7 times too high."
        ),
        parameter_changes={
            **threshold_change(
                BADR_LIFETIME_LIMIT, _years_from(2027, 500_000)
            ),
            **static_capital_gains(),
        },
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
# CARER'S ALLOWANCE EARNINGS TAPER
# =============================================================================


# Announced in written statement HCWS421 (27 October 2026): "earnings above
# the Weekly Earnings Limit will be subject to a 100% taper, where support
# is only reduced by £1 for each £1 increase in earnings", beginning
# "within 2030-31 once the Department for Work and Pensions have developed
# a new IT system". The limit is 16 hours at the National Living Wage, £204
# a week in 2026-27.
#
# Budget day, from the policy costings document (each a default argument
# of budget_measures/carers_allowance_earnings_taper.py; changing one
# changes the module's receipt, so it needs a fresh two-person
# attestation):
# - TODO start: ``start_year=2030`` applies the taper to the whole of
#   2030-31. A start partway through 2030-31 needs a part-year weight the
#   modifier does not have yet; if the costing gives a month, either keep
#   the whole year and say so in the description, or start in 2031.
# - TODO limit: ``earnings_limit=None`` reads the engine's limit, £204 in
#   every year (policyengine-uk 2.151.0 does not uprate it). If the limit
#   follows 16 x the National Living Wage, it rises each year; one weekly
#   amount (``earnings_limit=``) applies to every year.
# - TODO rate: ``taper_rate=1.0`` (the statement's 100%).
# - Registration: not registered (#263, cells under the disclosure floor
#   of 10 on main; #271 lowers it to 3 and is open, not merged).
def _create_carers_allowance_earnings_taper() -> Reform:
    return Reform(
        id=CARERS_ALLOWANCE_TAPER_ID,
        name="Carer's Allowance earnings taper",
        description=(
            "Candidate measure. From 2030-31 Carer's Allowance no longer "
            "stops when weekly net earnings pass the £204 earnings limit "
            "(16 hours at the National Living Wage in 2026-27, held at "
            "£204 in the model): it is reduced by £1 for each £1 of weekly "
            "earnings above the limit, a 100% taper, to nothing once "
            "earnings exceed the limit by the full weekly rate. The "
            "government says the taper begins within 2030-31, once DWP's "
            "new IT system is ready; the model applies it to the whole of "
            "2030-31. Carers at or below the limit are unchanged. "
            "Scotland's Carer Support Payment is unchanged. Claims by carers "
            "the limit kept out follow the data's take-up draw (60%). For "
            "a carer on Universal Credit the model counts the extra "
            "allowance in full as unearned income but deducts none of the "
            "PAYE on it from earnings, as DWP would, so such a carer can "
            "lose overall."
        ),
        simulation_modifier=carers_allowance_earnings_taper,
    )


# =============================================================================
# LOCAL HOUSING ALLOWANCE UNFROZEN FROM APRIL 2027
# =============================================================================


def _create_lha_unfreeze_2027() -> Reform:
    # The freeze is a switch, which the templates' numeric values refuse,
    # so the change is written directly, as static_capital_gains writes
    # its switch. Every policy year from 2027: a bounded change would
    # return to the freeze, holding the rates at their 2027 level.
    return Reform(
        id=LHA_UNFREEZE_ID,
        name="Local Housing Allowance unfrozen",
        description=(
            "Candidate measure. From April 2027 Local Housing Allowance "
            "rates are no longer frozen at their April 2024 level: each "
            "April they are re-set to the 30th percentile "
            "of local rents, as policyengine-uk determines them from its "
            "projected rents, with the national maximum and the March 2020 "
            "minimum. It raises Universal Credit's housing element and "
            "Housing Benefit for private renters whose rent is above the "
            "frozen rate. Northern Ireland's rates, which follow Great "
            "Britain's, are unfrozen too."
        ),
        parameter_changes={
            LHA_FREEZE: _years_from(2027, False),
            LHA_FREEZE_NI: _years_from(2027, False),
        },
    )


# =============================================================================
# EMPLOYER NI SECONDARY THRESHOLD BACK TO £9,100 FROM APRIL 2027
# =============================================================================

# Current law: £5,000 a year (stored weekly, £96.15) from April 2025, held
# to 2030-31 and then raised by CPI each year by the engine. The candidate:
# £9,100 a year (£175 a week, its 2022-23 to 2024-25 value) from 6 April
# 2027, and from 2031-32 current law's CPI rise applied to it (the engine
# indexes the threshold from its own previous amount; every scored year is
# written, as scored_years asks of a projected threshold).
SECONDARY_THRESHOLD_RAISED = 9100
SECONDARY_THRESHOLD_FROM = 2027


def secondary_threshold_raised() -> dict[str, float]:
    """The weekly secondary threshold, every policy year from 2027."""
    from policyengine_uk.system import system

    node = system.parameters.get_child(SECONDARY_THRESHOLD)
    weekly = SECONDARY_THRESHOLD_RAISED / 52
    values = {}
    for year in POLICY_YEARS:
        if year < SECONDARY_THRESHOLD_FROM:
            continue
        if year > SECONDARY_THRESHOLD_FROM:
            weekly *= node(f"{year}-04-06") / node(f"{year - 1}-04-06")
        values[str(year)] = round(weekly, 8)
    return values


def _create_employer_nics_secondary_threshold_raise() -> Reform:
    return Reform(
        id=EMPLOYER_NI_THRESHOLD_ID,
        name="Employer NI threshold raised",
        description=(
            "Candidate measure. From 6 April 2027 the threshold above which "
            "employers pay Class 1 National Insurance goes back from £5,000 "
            "to £9,100 a year (£175 a week), rising with CPI from 2031-32 "
            "as current law's does; the 15% rate is unchanged. "
            "policyengine-uk holds each employer's total cost of employment "
            "fixed, so the saving is passed to employees as higher pay in "
            "the same year."
        ),
        parameter_changes=threshold_change(
            SECONDARY_THRESHOLD, secondary_threshold_raised()
        ),
    )


# =============================================================================
# DIVIDEND, SAVINGS AND PROPERTY INCOME TAX RATES UP 2 POINTS FROM APRIL 2027
# =============================================================================

UNEARNED_INCOME_RATE_RISE = 0.02
UNEARNED_INCOME_RATES_FROM = 2027


def unearned_income_rates_up() -> dict[str, dict[str, float]]:
    """Current law's rate plus 2 points, every policy year from 2027."""
    from policyengine_uk.system import system

    changes = {}
    for path in UNEARNED_INCOME_RATE_PATHS:
        node = system.parameters.get_child(path)
        changes.update(
            rate_change(
                path,
                {
                    str(year): round(
                        node(f"{year}-04-06") + UNEARNED_INCOME_RATE_RISE, 6
                    )
                    for year in POLICY_YEARS
                    if year >= UNEARNED_INCOME_RATES_FROM
                },
            )
        )
    return changes


def _create_unearned_income_rates_up() -> Reform:
    return Reform(
        id=UNEARNED_INCOME_RATES_ID,
        name="Dividend, savings and property income tax up",
        description=(
            "Candidate measure. From 6 April 2027 the income tax rates on "
            "dividends, savings income and property income each rise by 2 "
            "percentage points on top of current law, which already "
            "includes Budget 2025's rises: dividends to 12.75%, 37.75% and "
            "41.35%, and savings and property income to 24%, 44% and 49% "
            "at the basic, higher and additional rates. Incomes are held "
            "fixed, with no behavioural response."
        ),
        parameter_changes=unearned_income_rates_up(),
    )


# =============================================================================
# STATE PENSION DOUBLE LOCK FROM APRIL 2030 (not registered)
# =============================================================================

# Reported (BBC live, 11:53 on 28 October 2026): the Prime Minister's plan
# of 29 September to drop the triple lock's earnings leg from April 2030,
# so the State Pension rises by at least CPI or 2.5%. policyengine-uk
# 2.151.0 builds the April uprating from these switches when they arrive
# through Scenario(parameter_changes=...), as Reform.to_scenario sends
# them, and it reads a bare-year key as that April's uprating. Both the
# new and the basic State Pension follow its triple lock; the Pension
# Credit guarantee and the additional State Pension do not.
#
# Budget day:
# - DOUBLE_LOCK_FROM: the first April without the earnings leg.
# - DOUBLE_LOCK_EARNINGS_PATH: True is the reading in Vahid's
#   PolicyEngine/uk-triple-lock ("burnham_2030": never below an earnings
#   link from the 2029-30 level, as the speech's "hold its value relative
#   to earnings over time"); False is plain max(CPI, 2.5%).
# On the engine's forecast neither reading changes anything to 2031-32:
# the inputs for April 2030 (May-July 2029 earnings 2.19%, September 2029
# CPI 2.05%) and April 2031 (2.39%, 2.00%) are both under 2.5%, so the
# floor sets both upratings either way. Generation would refuse a measure
# that scores nothing; keep it on the ledger unless the engine's forecast
# changes.
TRIPLE_LOCK_INCLUDE_EARNINGS = (
    "gov.dwp.state_pension.triple_lock.include_earnings"
)
TRIPLE_LOCK_EARNINGS_PATH = (
    "gov.dwp.state_pension.triple_lock.earnings_path_guarantee"
)
DOUBLE_LOCK_FROM = 2030
DOUBLE_LOCK_EARNINGS_PATH = True


def _create_state_pension_double_lock_2030() -> Reform:
    # Switches, which the templates' numeric values refuse, so written
    # directly as the LHA unfreeze writes its switch.
    return Reform(
        id=STATE_PENSION_DOUBLE_LOCK_ID,
        name="State Pension double lock from 2030",
        description=(
            "Candidate measure. From April "
            f"{DOUBLE_LOCK_FROM} the new and basic State Pension rise each "
            "April by the higher of September CPI and 2.5%, no longer by "
            "earnings growth when that is higher"
            + (
                ", but never fall below an earnings link from their "
                f"{DOUBLE_LOCK_FROM - 1}-{DOUBLE_LOCK_FROM % 100:02d} level"
                if DOUBLE_LOCK_EARNINGS_PATH
                else ""
            )
            + ". The additional State Pension and Pension Credit are "
            "unchanged."
        ),
        parameter_changes={
            TRIPLE_LOCK_INCLUDE_EARNINGS: _years_from(DOUBLE_LOCK_FROM, False),
            TRIPLE_LOCK_EARNINGS_PATH: _years_from(
                DOUBLE_LOCK_FROM, DOUBLE_LOCK_EARNINGS_PATH
            ),
        },
    )


# =============================================================================
# COMBINED PACKAGE
# =============================================================================

AUTUMN_BUDGET_2026_COMBINED_ID = "autumn_budget_2026_combined"
# The candidate set Vahid chose on the evening of 27 October 2026 (#222):
# every registered measure, eight; on Budget day the Carer's Allowance
# earnings taper (``CARERS_ALLOWANCE_TAPER_ID``, withdrawn on 27 October
# for #263) was registered again once announced (HCWS421), making nine.
# Withdrawn, so in neither the package nor the registry
# (``_MEASURE_FACTORIES``), and run or published by no default command:
# the Local Housing Allowance unfreeze (``LHA_UNFREEZE_ID``), whose cells
# by decile rest on fewer than 10 survey households, and the road fuel VAT
# cut (``FUEL_VAT_ID``) that evening, and earlier that day the Business Asset Disposal Relief cut (``BADR_ID``) and
# the employer NI relief for under-25s (``EMPLOYER_NI_ID``). Their
# factories stay above, unregistered. Considered that evening and left out:
# tobacco duty at RPI+2% (already in current law: policyengine-uk 2.151.0
# has the rise from 1 October 2026) and alcohol duty at RPI (the data hold
# no tobacco or alcohol quantities, so both duties are about zero), and
# working-age benefits at CPI-1% (no parametric route leaves pensioner
# benefits alone).
# The measures the combined reform brings together, by id. The combined
# reform is simulated whole, so this list does not change what it does; it
# names its parts, so results by area can check it as a package of them.
AUTUMN_BUDGET_2026_COMBINED_COMPONENTS = (
    FUEL_DUTY_DEFERRAL_ID,
    STATE_PENSION_ALLOWANCE_ID,
    WARM_HOME_DISCOUNT_ID,
    ELECTRICITY_VAT_ID,
    THRESHOLD_FREEZE_ID,
    PLAN_2_ID,
    EMPLOYER_NI_THRESHOLD_ID,
    UNEARNED_INCOME_RATES_ID,
    # Budget day: registered once announced (HCWS421). If #271 (disclosure
    # floor 3) is not merged before generation, its artifact cannot be
    # staged and the combined run refuses: then drop it from here and keep
    # it in _MEASURE_FACTORIES, listed but not combined.
    CARERS_ALLOWANCE_TAPER_ID,
)

_MEASURE_FACTORIES = (
    _create_fuel_duty_rise_deferral,
    _create_state_pension_income_tax_protection,
    _create_warm_home_discount_top_up,
    _create_domestic_electricity_zero_vat,
    _create_threshold_freeze_2031_32,
    _create_plan_2_threshold_unfreeze,
    _create_employer_nics_secondary_threshold_raise,
    _create_unearned_income_rates_up,
    _create_carers_allowance_earnings_taper,
)


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
        members = [factory() for factory in _MEASURE_FACTORIES]
        # The package holds its components only (today every registered
        # measure; a measure registered outside them is listed, not
        # combined).
        package = [
            member
            for member in members
            if member.id in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
        ]
        _AUTUMN_BUDGET_2026_REFORMS_CACHE = [
            _create_combined_autumn_budget_reform(package),  # Combined first
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
