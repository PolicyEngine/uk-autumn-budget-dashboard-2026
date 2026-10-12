"""MOCK drill 3 (12 October 2026): parameter measures #7, #9, #12 and #13.

Coded from the released statement text only. Every value is invented for a
PolicyEngine rehearsal. Baselines are the engine's native rules
(policyengine-uk 2.125.1); bare-year keys are UK fiscal years, so "2027"
starts in April 2027. Not yet registered: the integrator wires these into
reforms.py.
"""

from uk_budget_data.models import Reform

MOCK3_YEARS = list(range(2026, 2032))

UK_RATES = "gov.hmrc.income_tax.rates.uk"
DIVIDEND_RATES = "gov.hmrc.income_tax.rates.dividends"
PERSONAL_ALLOWANCE_PATH = (
    "gov.hmrc.income_tax.allowances.personal_allowance.amount"
)
HIGHER_RATE_THRESHOLD_PATH = f"{UK_RATES}[1].threshold"
ADDITIONAL_RATE_THRESHOLD_PATH = f"{UK_RATES}[2].threshold"
DIVIDEND_ADDITIONAL_RATE_THRESHOLD_PATH = f"{DIVIDEND_RATES}[2].threshold"
PRIMARY_THRESHOLD_PATH = (
    "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold"
)
UPPER_EARNINGS_LIMIT_PATH = (
    "gov.hmrc.national_insurance.class_1.thresholds.upper_earnings_limit"
)
SALARY_SACRIFICE_CAP_PATH = (
    "gov.hmrc.national_insurance.salary_sacrifice_pension_cap"
)
CLASS_4_MAIN_RATE_PATH = "gov.hmrc.national_insurance.class_4.rates.main"


def _from(first_year: int, value) -> dict[str, float]:
    return {str(y): value for y in MOCK3_YEARS if y >= first_year}


DIVIDEND_HIGHER_RATE_THRESHOLD_PATH = f"{DIVIDEND_RATES}[1].threshold"
CLASS_4_LPL_PATH = (
    "gov.hmrc.national_insurance.class_4.thresholds.lower_profits_limit"
)
CLASS_4_UPL_PATH = (
    "gov.hmrc.national_insurance.class_4.thresholds.upper_profits_limit"
)
SS_REDUCTION_RATE_PATH = (
    "gov.contrib.behavioral_responses.employee_salary_sacrifice_reduction_rate"
)
SS_HAIRCUT_RATE_PATH = (
    "gov.contrib.behavioral_responses.salary_sacrifice_broad_base_haircut_rate"
)
WEEKS = 52

# Annex A baseline (MOCK costings document). Engine native (2.125.1) differs:
# PT/UEL are 241.73/966.73 a week (12,569.96 / 50,269.96 a year, 4p short),
# and from 2031-32 the engine CPI-uprates PA/BRL/PT/UEL/Class 4 to
# 12,821.41 / 38,454.01 / 12,821.37 / 51,275.39 / 12,821.41-51,275.43 while
# Annex A says 12,830 / 38,500 / 12,830 / 51,330. The dividend higher rate
# threshold is NOT uprated natively (37,700 in 2031-32), so it is pinned to
# the Annex A basic rate limit too. Savings income has no separate
# thresholds in the engine (it uses rates.uk).
ANNEX_A_PA = {y: (12_830 if y == 2031 else 12_570) for y in MOCK3_YEARS}
ANNEX_A_BRL = {y: (38_500 if y == 2031 else 37_700) for y in MOCK3_YEARS}
ANNEX_A_PT = {y: (12_830 if y == 2031 else 12_570) for y in MOCK3_YEARS}
ANNEX_A_UEL = {y: (51_330 if y == 2031 else 50_270) for y in MOCK3_YEARS}
ANNEX_A_LPL = ANNEX_A_PT
ANNEX_A_UPL = ANNEX_A_UEL
ANNEX_A_ART = 125_140  # taxable income, fixed in cash


def _series(values: dict[int, float], scale: float = 1.0) -> dict[str, float]:
    return {str(y): v / scale for y, v in values.items()}


def _annex_a_class4_limits() -> dict[str, dict[str, float]]:
    return {
        CLASS_4_LPL_PATH: _series(ANNEX_A_LPL),
        CLASS_4_UPL_PATH: _series(ANNEX_A_UPL),
    }


def _annex_a_income_tax_and_class1() -> dict[str, dict[str, float]]:
    return {
        PERSONAL_ALLOWANCE_PATH: _series(ANNEX_A_PA),
        HIGHER_RATE_THRESHOLD_PATH: _series(ANNEX_A_BRL),
        DIVIDEND_HIGHER_RATE_THRESHOLD_PATH: _series(ANNEX_A_BRL),
        PRIMARY_THRESHOLD_PATH: _series(ANNEX_A_PT, WEEKS),
        UPPER_EARNINGS_LIMIT_PATH: _series(ANNEX_A_UEL, WEEKS),
        **_annex_a_class4_limits(),
    }


# ---------------------------------------------------------------------------
# #7 Additional rate threshold £125,140 -> £100,000 from April 2027
# ---------------------------------------------------------------------------
MOCK3_ART_FIRST_YEAR = 2027
# Annex A / costing 7: the higher rate limit is £125,140 *of taxable income*
# falling to £100,000 *of taxable income* (not £100,000 total income). The
# engine's bracket thresholds are taxable income, so the value is 100,000.
MOCK3_ART_TAXABLE_THRESHOLD = 100_000


def _create_mock3_additional_rate_threshold() -> Reform:
    """Mock 3 measure 7: the 45p rate starts at £100,000 total income.

    Sets the rUK additional rate threshold (and the matching dividend
    additional rate threshold, which the engine stores separately) to
    £100,000 of taxable income from 2027-28 (Annex A). Baseline £125,140 is
    pinned in both scenarios for all years (engine native already matches).
    Savings and property income use rates.uk thresholds in the engine.
    Scottish non-savings income keeps the devolved schedule.
    """
    return Reform(
        id="mock3_additional_rate_threshold",
        name="Lower additional rate threshold",
        description=(
            "MOCK. From April 2027 the 45p additional rate starts at £100,000 "
            "of taxable income instead of £125,140 (Annex A higher rate "
            "limit). "
            "Applies to rUK income tax and the dividend additional rate; "
            "Scottish non-savings rates are unchanged."
        ),
        baseline_parameter_changes={
            ADDITIONAL_RATE_THRESHOLD_PATH: _from(2026, ANNEX_A_ART),
            DIVIDEND_ADDITIONAL_RATE_THRESHOLD_PATH: _from(2026, ANNEX_A_ART),
        },
        parameter_changes={
            ADDITIONAL_RATE_THRESHOLD_PATH: _from(
                MOCK3_ART_FIRST_YEAR, MOCK3_ART_TAXABLE_THRESHOLD
            ),
            DIVIDEND_ADDITIONAL_RATE_THRESHOLD_PATH: _from(
                MOCK3_ART_FIRST_YEAR, MOCK3_ART_TAXABLE_THRESHOLD
            ),
        },
    )


# ---------------------------------------------------------------------------
# #9 Salary sacrifice NI-exempt cap £2,000 -> £1,000 from 6 April 2029
# ---------------------------------------------------------------------------
MOCK3_SS_CAP_FIRST_YEAR = 2029
MOCK3_SS_CAP = 1_000


# Costing 20's static basis is "before corporation-tax offsets or wage
# pass-through": the engine's employer-NI wage pass-through and earnings
# behavioural response are held at zero in both scenarios.
MOCK3_SS_STATIC_OFF = (
    "employer_ni_fixed_employer_cost_change",
    "employment_income_behavioral_response",
)


def _mock3_ss_static_modifier(sim):
    import numpy as np

    for year in range(2026, 2032):
        for variable in MOCK3_SS_STATIC_OFF:
            n = len(np.asarray(sim.calculate("age", year)))
            sim.set_input(variable, year, np.zeros(n))
    return sim


def _create_mock3_salary_sacrifice_cap() -> Reform:
    """Mock 3 measure 9: salary-sacrifice NI exemption limit halves to £1,000.

    Annex A baseline: uncapped through 2028-29, £2,000 from 6 April 2029;
    the engine native matches (inf, then 2,000) and is pinned anyway.
    Sacrifice above the cap is treated as an ordinary (income-tax-relieved)
    employee contribution and bears employee and employer NI. Static
    scoring (Annex A): the employee sacrifice-reduction response and the
    0.16% broad-workforce earnings haircut are switched OFF in both
    baseline and reform.
    """
    return Reform(
        id="mock3_salary_sacrifice_cap",
        name="Lower pension salary sacrifice limit",
        description=(
            "MOCK. From 6 April 2029 the annual pension salary-sacrifice "
            "amount exempt from employee and employer National Insurance "
            "falls from £2,000 to £1,000. Income tax relief on pension "
            "contributions continues."
        ),
        baseline_parameter_changes={
            SALARY_SACRIFICE_CAP_PATH: _from(MOCK3_SS_CAP_FIRST_YEAR, 2_000),
            SS_REDUCTION_RATE_PATH: _from(2026, 0),
            SS_HAIRCUT_RATE_PATH: _from(2026, 0),
        },
        parameter_changes={
            SALARY_SACRIFICE_CAP_PATH: _from(
                MOCK3_SS_CAP_FIRST_YEAR, MOCK3_SS_CAP
            ),
            SS_REDUCTION_RATE_PATH: _from(2026, 0),
            SS_HAIRCUT_RATE_PATH: _from(2026, 0),
        },
        baseline_simulation_modifier=_mock3_ss_static_modifier,
        simulation_modifier=_mock3_ss_static_modifier,
    )


# ---------------------------------------------------------------------------
# #12 PA, higher rate threshold, PT and UEL held one more year (to April 2032)
# ---------------------------------------------------------------------------
MOCK3_FREEZE_YEAR = 2031  # fiscal 2031-32
# Reform: 2031-32 held at the 2030-31 Annex A values (annual; NI is weekly
# in the engine, so PT/UEL are divided by 52).
MOCK3_FROZEN_ANNUAL = {
    PERSONAL_ALLOWANCE_PATH: 12_570,
    HIGHER_RATE_THRESHOLD_PATH: 37_700,
    DIVIDEND_HIGHER_RATE_THRESHOLD_PATH: 37_700,
    PRIMARY_THRESHOLD_PATH: 12_570 / WEEKS,
    UPPER_EARNINGS_LIMIT_PATH: 50_270 / WEEKS,
    CLASS_4_LPL_PATH: 12_570,
    CLASS_4_UPL_PATH: 50_270,
}


def _create_mock3_threshold_freeze_2032() -> Reform:
    """Mock 3 costing measure 1: hold 2031-32 thresholds at 2030-31 values.

    Baseline is Annex A, pinned in every year 2026-31 (engine native PT/UEL
    are 4p/yr off and its 2031-32 CPI uprating differs from Annex A's
    rounded £12,830 / £38,500 / £51,330). The reform freezes PA, basic rate
    limit (rUK non-savings and UK-wide savings via rates.uk; dividends via
    their own threshold), Class 1 PT and UEL, and Class 4 LPL/UPL. The
    Secondary Threshold is not touched. Scottish non-savings bands are
    devolved; the PA and NI legs apply in Scotland.
    """
    baseline = _annex_a_income_tax_and_class1()
    reform = _annex_a_income_tax_and_class1()
    for path, value in MOCK3_FROZEN_ANNUAL.items():
        reform[path][str(MOCK3_FREEZE_YEAR)] = value
    return Reform(
        id="mock3_threshold_freeze_2032",
        name="Threshold freeze extended to April 2032",
        description=(
            "MOCK. The Personal Allowance (£12,570), basic rate limit "
            "(£37,700), Class 1 Primary Threshold and Upper Earnings Limit "
            "(£12,570 / £50,270) and Class 4 profits limits stay at 2030-31 "
            "levels in 2031-32 instead of rising to the Annex A indexed "
            "£12,830 / £38,500 / £51,330. The employer Secondary Threshold "
            "is not affected."
        ),
        baseline_parameter_changes=baseline,
        parameter_changes=reform,
    )


# ---------------------------------------------------------------------------
# #13 Class 4 main rate 6% -> 7% from April 2027
# ---------------------------------------------------------------------------
MOCK3_CLASS4_FIRST_YEAR = 2027
MOCK3_CLASS4_MAIN_RATE = 0.07


def _create_mock3_class4_main_rate() -> Reform:
    """Mock 3 costing 10: Class 4 main rate 6% -> 7% from 2027-28.

    Annex A Class 4 limits (12,570/50,270 to 2030-31; 12,830/51,330 in
    2031-32) are pinned in both scenarios.
    """
    return Reform(
        id="mock3_class4_main_rate",
        name="Class 4 National Insurance main rate rise",
        description=(
            "MOCK. The Class 4 National Insurance main rate for the "
            "self-employed rises from 6% to 7% from April 2027, on profits "
            "between the Lower and Upper Profits Limits. The 2% additional "
            "rate is unchanged."
        ),
        baseline_parameter_changes=_annex_a_class4_limits(),
        parameter_changes={
            CLASS_4_MAIN_RATE_PATH: _from(
                MOCK3_CLASS4_FIRST_YEAR, MOCK3_CLASS4_MAIN_RATE
            ),
            **_annex_a_class4_limits(),
        },
    )


MOCK3_PARAM_REFORM_FACTORIES = [
    _create_mock3_additional_rate_threshold,
    _create_mock3_salary_sacrifice_cap,
    _create_mock3_threshold_freeze_2032,
    _create_mock3_class4_main_rate,
]
