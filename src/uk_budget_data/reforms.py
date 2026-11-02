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
from uk_budget_data.budget_measures import (
    zero_vat_on_domestic_electricity as _electricity,
)
from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    bus_fare_cap_2027,
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
from uk_budget_data.budget_measures.household_energy_payment_2026 import (
    household_energy_payment_2026,
)
from uk_budget_data.budget_measures.pension_tax_allowance import (
    pension_tax_allowance,
)
from uk_budget_data.budget_measures.planned_cash_isa_limit import (
    planned_cash_isa_limit,
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
from uk_budget_data.forecast import (
    FUEL_DUTY_STATUTORY,
    forecast_parameters,
    fuel_duty_rpi_steps,
)
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
# Budget 2026 document (3.9; Table 6.1 rows 61 and 62): property and
# savings income rates up a further 2 points from April 2027 at the basic,
# higher and additional rates; dividends unchanged. One measure each, as
# the Treasury's two rows (Vahid, 28 October 2026).
PROPERTY_INCOME_RATE_PATHS = (
    f"{INCOME_TAX_RATES}.property.basic",
    f"{INCOME_TAX_RATES}.property.higher",
    f"{INCOME_TAX_RATES}.property.additional",
)
SAVINGS_INCOME_RATE_PATHS = (
    f"{INCOME_TAX_RATES}.savings.basic",
    f"{INCOME_TAX_RATES}.savings.higher",
    f"{INCOME_TAX_RATES}.savings.additional",
)
# Both together: the single measure withdrawn when they were split.
UNEARNED_INCOME_RATE_PATHS = (
    *SAVINGS_INCOME_RATE_PATHS,
    *PROPERTY_INCOME_RATE_PATHS,
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
PROPERTY_INCOME_RATES_ID = "property_income_rates_up"
SAVINGS_INCOME_RATES_ID = "savings_income_rates_up"
LHA_UNFREEZE_ID = "lha_unfreeze_2027"
CARERS_ALLOWANCE_TAPER_ID = "carers_allowance_earnings_taper"
STATE_PENSION_DOUBLE_LOCK_ID = "state_pension_double_lock_2030"
HOUSEHOLD_ENERGY_PAYMENT_ID = "household_energy_payment_2026"
TRADING_ALLOWANCE_ID = "trading_allowance_raise"
BUS_FARE_CAP_ID = "bus_fare_cap_2027"
CASH_ISA_LIMIT_ID = "cash_isa_limit_kept"
TRADING_ALLOWANCE = "gov.hmrc.income_tax.allowances.trading_allowance"


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
    and the State Pension allowance designs (taxable income; not the Pension
    Tax Allowance, a tax reduction). This is the static
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
# 1. FUEL DUTY: THE 5P CUT EXTENDED TO 1 JULY 2027
# =============================================================================

# Current law, by the date each rate takes effect: 52.95p to 31 December
# 2026, 55.95p from 1 January 2027, 57.95p from 1 March 2027 (as in
# policyengine-uk 2.151.0's petrol_and_diesel.yaml; HMRC's amended rates
# note, SI 2026/164 as amended by SI 2026/555), then 60.59p from 1 April
# 2027 (the OBR's July rate, EFO October 2026 paragraph 3.19, taken in
# April in current law; HMRC set no April rate) and RPI each April after,
# on the OBR October 2026 forecast, the same path the baseline is built on
# (uk_budget_data.forecast.fuel_duty_rpi_steps).
FUEL_DUTY_CURRENT_LAW = (
    ("2026-03-23", 0.5295),
    ("2027-01-01", 0.5595),
    FUEL_DUTY_STATUTORY,
    *fuel_duty_rpi_steps(),
)
# The pre-Budget candidate (27 October 2026), kept only for
# FUEL_DUTY_FROZEN_UNTIL = None: 52.95p frozen through 2027-28 (to 31 March
# 2028), RPI uprating resuming in April 2028 from 52.95p, each later rate
# current law's scaled by 52.95p over current law's April 2027 rate.
# Budget day replaced it with FUEL_DUTY_FROZEN_UNTIL below.
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
#
# Announced in the speech (28 October 2026, 12:54): "a further extension
# of the 5p fuel duty cut until next July". FUEL_DUTY_FROZEN_UNTIL, when
# set, is the first day back on current law: 52.95p to the day before,
# then current law's rate in force that day (60.59p: the 5p and the
# deferred RPI rise together, EFO October 2026 paragraph 3.19) and its RPI
# rises after.
# Budget 2026 document: "Extend the 5p fuel duty cut and freeze ... to
# 1 July 2027" (Table row 3: -575, -780, then 0), so "2027-07-01".
# None gives the 27 October candidate (FUEL_DUTY_FROZEN_THROUGH, with RPI
# resuming from 52.95p).
FUEL_DUTY_FROZEN_UNTIL = "2027-07-01"
FUEL_DUTY_STAGES = (("2026-03-23", FUEL_DUTY_FROZEN),)
FUEL_DUTY_RPI_FROM = f"{FUEL_DUTY_FROZEN_THROUGH + 1}-04-01"


def _fuel_duty_scale_base() -> float:
    """Current law's rate just before uprating resumes, which the frozen
    rate stands in for (60.59p, its April 2027 rate, for a freeze through
    2027-28); later rates are current law's scaled by frozen / this. Used
    only by the pre-Budget candidate (FUEL_DUTY_FROZEN_UNTIL = None)."""
    before = [
        rate for day, rate in FUEL_DUTY_CURRENT_LAW if day < FUEL_DUTY_RPI_FROM
    ]
    return before[-1]


def fuel_duty_deferral_schedule() -> tuple:
    """The candidate's rates by the date each takes effect."""
    if FUEL_DUTY_FROZEN_UNTIL is not None:
        before = [
            rate
            for day, rate in FUEL_DUTY_CURRENT_LAW
            if day <= FUEL_DUTY_FROZEN_UNTIL
        ]
        return (
            FUEL_DUTY_STAGES
            + ((FUEL_DUTY_FROZEN_UNTIL, before[-1]),)
            + tuple(
                (day, rate)
                for day, rate in FUEL_DUTY_CURRENT_LAW
                if day > FUEL_DUTY_FROZEN_UNTIL
            )
        )
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
    path: policyengine-uk #2430). With FUEL_DUTY_FROZEN_UNTIL, only the
    years the extension touches: later years return to current law's own
    path, which is what the extension does."""
    rates = {
        year: round(rate, 6)
        for year, rate in fiscal_year_means(
            fuel_duty_deferral_schedule()
        ).items()
    }
    if FUEL_DUTY_FROZEN_UNTIL is not None:
        # After the extension, current law's own rates, written for every
        # scored year: the parameter is uprated, so a bounded change would
        # return to the old path (policyengine-uk #2430; scored_years).
        node = forecast_parameters().get_child(FUEL_DUTY)
        for y in list(rates):
            if int(y) not in fuel_duty_extension_years():
                rates[y] = node(f"{y}-04-30")
    return rates


def fuel_duty_extension_years() -> list[int]:
    """The fiscal years (from 6 April) the 5p cut's extension touches."""
    last = date.fromordinal(
        date.fromisoformat(FUEL_DUTY_FROZEN_UNTIL).toordinal() - 1
    )
    last_year = (
        last.year if (last.month, last.day) >= (4, 6) else last.year - 1
    )
    return [y for y in DEFAULT_YEARS if y <= last_year]


def pump_vat_on_fuel_duty_deferral_defaults() -> dict[str, float]:
    """The pump VAT modifier's defaults for the current freeze: for each
    fuel and year, 0.24 x the duty change / the engine's pump price (see
    the modifier's comment). Paste them into
    ``budget_measures/pump_vat_on_fuel_duty_deferral.py`` after changing
    the freeze."""
    prices = forecast_parameters().household.consumption.fuel.prices
    rates = fuel_duty_deferral_rates()
    current = fiscal_year_means(FUEL_DUTY_CURRENT_LAW)
    return {
        f"{fuel}_{year}": (
            0.24
            * (rates[str(year)] - current[str(year)])
            / getattr(prices, fuel)(f"{year}-04-30")
            if FUEL_DUTY_FROZEN_UNTIL is None
            or year in fuel_duty_extension_years()
            else 0.0
        )
        for year in POLICY_YEARS
        for fuel in ("petrol", "diesel")
    }


def _fiscal_year_label(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


def _pence(rate: float) -> str:
    return f"{rate * 100:.2f}p"


def _fuel_duty_cut_extension_description() -> str:
    frozen = _pence(FUEL_DUTY_FROZEN)
    back = date.fromisoformat(FUEL_DUTY_FROZEN_UNTIL)
    last = date.fromordinal(back.toordinal() - 1)
    rate = dict(fuel_duty_deferral_schedule())[FUEL_DUTY_FROZEN_UNTIL]
    return (
        "The 5p cut in fuel duty is kept: the main rate stays at "
        f"{frozen} a litre to {last.day} {last:%B %Y}, so the rise due on "
        "1 January 2027 and the March and April 2027 steps do not happen. "
        f"From {back.day} {back:%B %Y} it returns to current law's "
        f"{_pence(rate)} a litre, rising with RPI each April. Rates are "
        "day-weighted to fiscal years, and the VAT on the lower pump "
        "price is included."
    )


def _fuel_duty_deferral_description() -> str:
    if FUEL_DUTY_FROZEN_UNTIL is not None:
        return _fuel_duty_cut_extension_description()
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
        name="Fuel duty cut extended",
        description=_fuel_duty_deferral_description(),
        parameter_changes=rate_change(FUEL_DUTY, fuel_duty_deferral_rates()),
        simulation_modifier=pump_vat_on_fuel_duty_deferral,
    )


# =============================================================================
# 2. PENSION TAX ALLOWANCE: AN INCOME TAX REDUCTION FOR PENSIONERS WHOSE
#    TOTAL INCOME IS AT MOST THE FULL NEW STATE PENSION
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
# Budget 2026 (6.182; costings p. 63; HM Treasury's explainer): the
# Pension Tax Allowance is a non-refundable tax reduction ("tax_reduction",
# budget_measures/pension_tax_allowance.py), not a higher allowance.
STATE_PENSION_PROTECTION_DESIGN = "tax_reduction"
_SP_ROUNDING = "down" if _sp_threshold.ROUND_DOWN else "up"
_SP_THRESHOLD_2027 = state_pension_only_income_tax_allowance.__defaults__[0]
# The allowance's last fiscal year (a default of the modifier): "in this
# Parliament", per the speech; the description names it only when it ends
# before 2031-32, the last scored year.
_SP_LAST_YEAR = state_pension_only_income_tax_allowance.__defaults__[-1]
_SP_UNTIL = (
    ""
    if _SP_LAST_YEAR >= POLICY_YEARS[-1]
    else f" The allowance applies to {_SP_LAST_YEAR}-"
    f"{(_SP_LAST_YEAR + 1) % 100:02d} and ends after it."
)
STATE_PENSION_PROTECTION_DESIGNS = {
    "tax_reduction": (
        pension_tax_allowance,
        "From 6 April 2027 to 5 April "
        "2030, people over State Pension age whose total "
        "income (the State Pension, with any increments or additional "
        "State Pension, plus all other income, savings interest included) "
        "is at or below the full new State Pension (£13,036.40 in 2027-28) "
        "get a Pension Tax Allowance: a non-refundable reduction in their "
        "income tax, worth up to £94 in 2027-28. It falls by £1 for every "
        "£3 of income above the full new State Pension, so it is gone at "
        "about £13,319 in 2027-28. The personal allowance is unchanged.",
    ),
    "total_income": (
        state_pension_only_income_tax_allowance,
        "From 6 April 2027, people over State Pension age whose total "
        "income (the State Pension, with any increments or additional "
        "State Pension, plus all other income, savings interest included) "
        "is at or below the full new State Pension get an income tax "
        "allowance of that amount; £1 of income above it takes the whole "
        "allowance away.",
    ),
    "tapered": (
        state_pension_income_tax_allowance,
        "From 6 April 2027, people over State Pension "
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
    design = design or STATE_PENSION_PROTECTION_DESIGN
    modifier, description = STATE_PENSION_PROTECTION_DESIGNS[design]
    return Reform(
        id=STATE_PENSION_ALLOWANCE_ID,
        name="Pension Tax Allowance",
        description=description,
        simulation_modifier=modifier,
        # The PTA ("tax_reduction") lowers the liability and leaves taxable
        # income, and so the capital gains rate, alone: no capital gains
        # pin, which would only add noise in the years it is not in force.
        # The allowance designs move taxable income, so they carry it.
        parameter_changes=(
            None if design == "tax_reduction" else static_capital_gains()
        ),
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


def _electricity_vat_description() -> str:
    end = date.fromisoformat(_electricity.ZERO_RATE_EXTENDED_TO)
    end_text = f"{end.day} {end:%B %Y}"
    days = (end - date(2027, 4, 1)).days + 1
    if _electricity.PRE_BUDGET_ZERO_RATE_IN_MEASURE:
        return (
            "VAT on domestic electricity is 0% instead of 5% from "
            f"1 October 2026 to {end_text}. It applies in Great Britain "
            "from October 2026 and across the UK from April 2027. It covers "
            "electricity only, not gas. Each year counts its share of a "
            "year's electricity use: about 57% in 2026-27 (October to "
            "March) and 22% in 2027-28 (April to June)."
        )
    return (
        "The zero rate of VAT on domestic electricity, "
        "in force from 1 October 2026 to 31 March 2027, is extended to "
        f"{end_text}: VAT is 0% instead of 5% from 1 April 2027 to "
        f"{end_text}. Applied to electricity spending only, in Great "
        "Britain (Northern Ireland keeps the 5%), weighted by its "
        f"{days} days of 2027-28's 366. The zero rate before April 2027 "
        "is in neither the model's baseline nor this measure."
    )


def _create_domestic_electricity_zero_vat() -> Reform:
    return Reform(
        id=ELECTRICITY_VAT_ID,
        name="Zero VAT on domestic electricity",
        description=_electricity_vat_description(),
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
    rpi = forecast_parameters().gov.economic_assumptions.indices.obr.rpi
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
            "rises with RPI from April 2027 (to £30,648 in 2027-28), reversing "
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
# Budget day, from the Budget document (6.13, 6.128) and the policy
# costings (p. 16); each is a default argument of
# budget_measures/carers_allowance_earnings_taper.py, and changing one
# changes the module's receipt, so it needs a fresh two-person attestation:
# - start: ``start_year=2030`` with ``first_year_share=0.5``, half of
#   2030-31's effect, as the start date "within the 2030-31 financial year"
#   is still to be confirmed.
# - limit: 16 hours at the National Living Wage, rounded up to the pound:
#   the OBR's wage for each April (EFO October 2026, Table 1.13), £212 at
#   April 2027's £13.21, £228 in 2030-31 and £234 in 2031-32.
# - rate: ``taper_rate=1.0`` (100%).
# - Registered and in the package (AUTUMN_BUDGET_2026_COMBINED_COMPONENTS).
def _create_carers_allowance_earnings_taper() -> Reform:
    return Reform(
        id=CARERS_ALLOWANCE_TAPER_ID,
        name="Carer's Allowance earnings taper",
        description=(
            "In England and Wales, Carer's Allowance no longer stops when "
            "weekly net earnings pass the Weekly Earnings Limit, 16 hours at "
            "the National Living Wage (£212 a week at April 2027's £13.21, "
            "rounded up to the pound): it is "
            "reduced by £1 for each £1 of earnings above the limit, a 100% "
            "taper, to nothing once earnings exceed the limit by the full "
            "weekly rate. The taper starts within 2030-31, on a date still to "
            "come, so the model counts half of that year. "
            "Carers at or below the limit, and "
            "Scotland's Carer Support Payment, are unchanged. Claims by "
            "carers "
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
    node = forecast_parameters().get_child(SECONDARY_THRESHOLD)
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
# PROPERTY AND SAVINGS INCOME TAX RATES UP 2 POINTS FROM APRIL 2027
# =============================================================================

UNEARNED_INCOME_RATE_RISE = 0.02
UNEARNED_INCOME_RATES_FROM = 2027


def _rates_up(paths) -> dict[str, dict[str, float]]:
    """Current law's rate plus 2 points at each path, every policy year
    from 2027."""
    changes = {}
    for path in paths:
        node = forecast_parameters().get_child(path)
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


def property_income_rates_up() -> dict[str, dict[str, float]]:
    """The property basic, higher and additional rates, 2 points up."""
    return _rates_up(PROPERTY_INCOME_RATE_PATHS)


def savings_income_rates_up() -> dict[str, dict[str, float]]:
    """The savings basic, higher and additional rates, 2 points up."""
    return _rates_up(SAVINGS_INCOME_RATE_PATHS)


def unearned_income_rates_up() -> dict[str, dict[str, float]]:
    """Both: the withdrawn single measure's changes."""
    return _rates_up(UNEARNED_INCOME_RATE_PATHS)


def _create_property_income_rates_up() -> Reform:
    # Table 6.1 row 61. The engine's property rates do not apply to
    # Scottish taxpayers, whose property income is taxed at Scottish rates;
    # finance cost relief follows the property basic rate UK-wide (ITTOIA
    # 2005 s. 274AA(5) as amended by FA 2026), so Scottish landlords' relief
    # rises too (Max, #290, 28 October 2026).
    return Reform(
        id=PROPERTY_INCOME_RATES_ID,
        name="Property income tax rates up",
        description=(
            "From 6 April 2027 the income tax rates on property income rise "
            "to 24%, 44% and 49% at the basic, higher and additional rates "
            "in England, Wales and Northern Ireland: 2 percentage points "
            "above current law, which already includes Budget 2025's rises. "
            "Finance cost relief for landlords follows the property basic "
            "rate, so rises to 24%, Scottish landlords' included. Incomes "
            "are held fixed, with no behavioural response."
        ),
        parameter_changes=property_income_rates_up(),
    )


def _create_savings_income_rates_up() -> Reform:
    # Table 6.1 row 62.
    return Reform(
        id=SAVINGS_INCOME_RATES_ID,
        name="Savings income tax rates up",
        description=(
            "From 6 April 2027 the income tax rates on savings income rise "
            "to 24%, 44% and 49% at the basic, higher and additional rates "
            "across the UK: 2 percentage points above current law, which "
            "already includes Budget 2025's rises. Dividend rates are "
            "unchanged. Incomes are held fixed, with no behavioural response."
        ),
        parameter_changes=savings_income_rates_up(),
    )


def _create_unearned_income_rates_up() -> Reform:
    # Withdrawn on Budget day, 28 October 2026: split into the property and
    # savings measures above, one per Table 6.1 row. Unregistered.
    return Reform(
        id=UNEARNED_INCOME_RATES_ID,
        name="Savings and property income tax rates up",
        description=(
            "From 6 April 2027 the income tax rates on savings income rise "
            "to 24%, 44% and 49% at the basic, higher and additional rates "
            "across the UK, and those on property income to the same rates "
            "in England, Wales and Northern Ireland: 2 percentage points "
            "above current law, which already includes Budget 2025's rises. "
            "Finance cost relief for landlords follows the property basic "
            "rate, so rises to 24%. Dividend rates are unchanged. Incomes "
            "are held fixed, with no behavioural response."
        ),
        parameter_changes=unearned_income_rates_up(),
    )


# =============================================================================
# HOUSEHOLD ENERGY PAYMENT: £100, BANDS A TO D, ENGLAND, WINTER 2026-27
# =============================================================================

# Announced in the speech (28 October 2026, 12:53). Budget day, from the
# documents (each a default of the hand-written modifier in
# budget_measures/household_energy_payment_2026.py; changing one needs a
# fresh attestation): amount=100, year=2026 (winter 2026-27),
# country="ENGLAND" (devolved governments get a Barnett share instead; "UK"
# pays every country), bands=("A", "B", "C", "D"). In the package
# (AUTUMN_BUDGET_2026_COMBINED_COMPONENTS).


def _create_household_energy_payment_2026() -> Reform:
    return Reform(
        id=HOUSEHOLD_ENERGY_PAYMENT_ID,
        name="Household Energy Payment",
        description=(
            "A one-off £100 payment from January 2027 to each household in "
            "England in property valuation bands A to D (the lowest four of "
            "England's eight), up to 20 million households, paid into bank "
            "accounts and counted as household income in 2026-27. Scotland, "
            "Wales and Northern Ireland receive a share of the funding "
            "instead, which is not modelled."
        ),
        simulation_modifier=household_energy_payment_2026,
    )


# =============================================================================
# TRADING ALLOWANCE FROM £1,000 TO £3,000
# =============================================================================

# Budget 2026 (6.254; policy costings p. 23; Table 6.1 row 15): the
# trading allowance rises from £1,000 to £3,000 from 6 April 2027
# (TRADING_ALLOWANCE_RAISED, TRADING_ALLOWANCE_FROM), with no new-venture
# limit. The parameter is not uprated, so writing every year from the
# first is the whole change. The property allowance (£1,000) is unchanged.
TRADING_ALLOWANCE_RAISED = 3_000
TRADING_ALLOWANCE_FROM = 2027


def _create_trading_allowance_raise() -> Reform:
    return Reform(
        id=TRADING_ALLOWANCE_ID,
        name="Trading allowance raised to £3,000",
        description=(
            f"From 6 April {TRADING_ALLOWANCE_FROM} the "
            "trading allowance, which relieves trading receipts in place "
            "of actual expenses, rises from £1,000 to "
            f"£{TRADING_ALLOWANCE_RAISED:,}, for income tax and Class 4 "
            "National Insurance. Without gross receipts in the data, the "
            "model relieves a profit up to £3,000 in full and gives no "
            "relief above it, so the cost may be overstated for some people "
            "and understated for others."
        ),
        parameter_changes=threshold_change(
            TRADING_ALLOWANCE,
            _years_from(TRADING_ALLOWANCE_FROM, TRADING_ALLOWANCE_RAISED),
        ),
    )


# =============================================================================
# SINGLE BUS FARES CAPPED AT £2 OUTSIDE LONDON, CALENDAR 2027
# =============================================================================

# Budget 2026 (Table 6.1, "Single bus fares capped at £2 outside London"):
# a £2 maximum single fare on participating services in England outside
# London from 1 January to 31 December 2027, where most are capped at £3
# until then. Left out on Budget day only because runs were in flight
# (María, 29 October 2026); registered and in the package since. Vahid,
# 29 October 2026 (issue #329, option 3): the Treasury's costing (Table
# 6.1) shared out across households by their bus fare spending in England
# outside London, not our own estimate of the national cost: 10.0% of
# spending at £3 fares while the cap runs (£230m / 0.9 operator
# participation / £2,557m), grossed up from current law's spending at £2.
# It reads no gov.dft.bus parameter, so it does not reach the data limit
# bus_uncapped_single_fares. Defaults of the hand-written modifier in
# budget_measures/bus_fare_cap_2027.py: fall=0.10, capped_2026=95/365,
# capped_2027=270/366, country="ENGLAND", excluded_region="LONDON".


def _create_bus_fare_cap_2027() -> Reform:
    return Reform(
        id=BUS_FARE_CAP_ID,
        name="Single bus fares capped at £2",
        description=(
            "Single bus fares on participating services in England outside "
            "London are capped at £2 instead of £3 from 1 January to "
            "31 December 2027. The saving is the Treasury's costing "
            "(Table 6.1) shared out across households by their bus fare "
            "spending in England outside London: 10.0% of what that "
            "spending would be at £3 fares (£230m, divided by 0.9 for "
            "operator participation, over £2,557m of spending), for the "
            "days the cap runs: 1 January to 5 April 2027 in 2026-27 and "
            "6 April to 31 December 2027 in 2027-28. London residents get "
            "£0. The saving is counted as household income, a "
            "methodological choice: the official cost is a grant to bus "
            "operators. Spending is held fixed, with no extra travel."
        ),
        simulation_modifier=bus_fare_cap_2027,
    )


# =============================================================================
# CASH ISA LIMIT KEPT AT £20,000 (Household calculator only)
# =============================================================================


# Budget 2026 (2.52, 6.248; Table 6.1 row 11): the cut in the cash ISA limit
# to £12,000 a year for under-65s from 6 April 2027 (SI 2026/1018 reg 6)
# does not go ahead. policyengine-uk 2.151.0 has no ISA limits, so current
# law is the Budget's and the pre-Budget side carries the cut
# (budget_measures/planned_cash_isa_limit.py; its numbers are default
# arguments there). Its effect rests on what a household pays into cash
# ISAs, which the survey data do not hold (PolicyEngine/microcosm#1415), so
# it is registered for the Household calculator only: listed, not in the
# package, and never in the national results (calculatorOnlyMeasures.js).
def _create_cash_isa_limit_kept() -> Reform:
    return Reform(
        id=CASH_ISA_LIMIT_ID,
        name="Cash ISA limit kept at £20,000 for under-65s",
        description=(
            "The cut in the cash ISA limit to £12,000 a year for savers "
            "under 65, planned from 6 April 2027, does not go ahead: they "
            "can still pay up to £20,000 a year into cash ISAs. The "
            "household's gain is the income tax it would have paid on the "
            "interest from what the planned limit left out: the same "
            "payments each year from April 2027, the excess held in a "
            "taxable account earning Bank Rate as the OBR forecasts it, the "
            "interest paid out each year. For one household at a time: the "
            "survey data hold no payments into ISAs, so there is no "
            "national figure."
        ),
        baseline_simulation_modifier=planned_cash_isa_limit,
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
# On the OBR October 2026 forecast the dashboard runs on
# (uk_budget_data.forecast), neither reading changes anything to 2031-32:
# the inputs for April 2030 (May-July 2029 earnings 2.28%, September 2029
# CPI 2.15%) and April 2031 (2.49%, 2.00%) are both under 2.5%, so the
# floor sets both upratings either way (full new State Pension £265.72 ->
# £272.36 -> £279.17 a week, with or without the switches). The OBR says
# the same: "an uprating of 2.5 per cent would apply under both the
# previous and adjusted version of the triple lock in both 2030-31 and
# 2031-32" (EFO October 2026, paragraph 3.50, footnote 17; Table A.3
# triple-lock guarantee 2.5, 2.5). Generation would refuse a measure that
# scores nothing; keep it on the ledger unless the forecast changes.
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
    ELECTRICITY_VAT_ID,
    PROPERTY_INCOME_RATES_ID,
    # Budget day: registered once announced (HCWS421). Its cells in some
    # deciles rest on fewer than 3 survey households, so the combined run
    # refuses while it is here: drop it and keep it in _MEASURE_FACTORIES,
    # listed but not combined.
    CARERS_ALLOWANCE_TAPER_ID,
    HOUSEHOLD_ENERGY_PAYMENT_ID,
    TRADING_ALLOWANCE_ID,
    # 29 October 2026 (María): the £2 bus fare cap, left out on Budget day
    # only because runs were in flight. Package of eight.
    BUS_FARE_CAP_ID,
)

# Withdrawn on Budget day, not in the Budget 2026 document: the Warm Home
# Discount top-up, the threshold freeze to 2031-32 (not extended), the
# Plan 2 threshold unfreeze (the freeze stays) and the employer NI
# secondary threshold (stays £5,000). Their factories stay, unregistered.
# Also withdrawn that day: the savings and property income tax rates as one
# measure (``UNEARNED_INCOME_RATES_ID``), split into the property and the
# savings measures, Table 6.1 rows 61 and 62. Nine registered since the £2
# bus fare cap (29 October 2026); eight in the package (savings held back).
# The cash ISA limit kept at £20,000 (Table 6.1 row 11) joined on
# 29 October, for the Household calculator only: ten registered.
_MEASURE_FACTORIES = (
    _create_fuel_duty_rise_deferral,
    _create_state_pension_income_tax_protection,
    _create_domestic_electricity_zero_vat,
    _create_property_income_rates_up,
    _create_savings_income_rates_up,
    _create_carers_allowance_earnings_taper,
    _create_household_energy_payment_2026,
    _create_trading_allowance_raise,
    _create_bus_fare_cap_2027,
    _create_cash_isa_limit_kept,
)


_NUMBER_WORDS = {
    n: word
    for n, word in enumerate(
        "zero one two three four five six seven eight nine ten eleven "
        "twelve".split()
    )
}


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
        name="Autumn Budget 2026 measures (combined)",
        description=(
            f"All {_NUMBER_WORDS[len(members)]} announced measures simulated "
            "together: "
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
    """The combined package, then the registered measures."""
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
