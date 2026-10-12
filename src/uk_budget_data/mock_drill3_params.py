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


# ---------------------------------------------------------------------------
# #7 Additional rate threshold £125,140 -> £100,000 from April 2027
# ---------------------------------------------------------------------------
MOCK3_ART_FIRST_YEAR = 2027
MOCK3_ART_TOTAL_INCOME = 100_000
MOCK3_PERSONAL_ALLOWANCE = 12_570
# The engine's bracket thresholds apply to taxable income (after the
# Personal Allowance). The PA taper starts only *above* £100,000 adjusted net
# income, so at exactly £100,000 the full £12,570 is still given and taxable
# income is £87,430. The native £125,140 is the same construction: PA is nil
# there, so taxable income equals total income.
MOCK3_ART_TAXABLE_THRESHOLD = MOCK3_ART_TOTAL_INCOME - MOCK3_PERSONAL_ALLOWANCE


def _create_mock3_additional_rate_threshold() -> Reform:
    """Mock 3 measure 7: the 45p rate starts at £100,000 total income.

    Sets the rUK additional rate threshold (and the matching dividend
    additional rate threshold, which the engine stores separately) to £87,430
    of taxable income from 2027-28. With the PA taper running from £100,000
    to £125,140, the effective marginal rate there becomes 45% x 1.5 = 67.5%.
    Savings and property income use the same rUK thresholds. Scottish
    non-savings income keeps the devolved schedule.
    """
    return Reform(
        id="mock3_additional_rate_threshold",
        name="Lower additional rate threshold",
        description=(
            "MOCK. From April 2027 the 45p additional rate starts at £100,000 "
            "of income instead of £125,140 (modelled as £87,430 of taxable "
            "income, i.e. £100,000 less the full £12,570 Personal Allowance). "
            "Applies to rUK income tax and the dividend additional rate; "
            "Scottish non-savings rates are unchanged."
        ),
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


def _create_mock3_salary_sacrifice_cap() -> Reform:
    """Mock 3 measure 9: salary-sacrifice NI exemption limit halves to £1,000.

    The engine's native cap is already £2,000 from 2029-30, so no baseline
    override is needed. Sacrifice above the cap is treated as an ordinary
    (income-tax-relieved) employee contribution and bears employee and
    employer NI. The engine's broad-base employer haircut rate (0.16% of
    pay) is calibrated to the £2,000 cap and is left unchanged.
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
        parameter_changes={
            SALARY_SACRIFICE_CAP_PATH: _from(
                MOCK3_SS_CAP_FIRST_YEAR, MOCK3_SS_CAP
            ),
        },
    )


# ---------------------------------------------------------------------------
# #12 PA, higher rate threshold, PT and UEL held one more year (to April 2032)
# ---------------------------------------------------------------------------
MOCK3_FREEZE_YEAR = 2031  # fiscal 2031-32
# The engine's own 2030-31 values (frozen in its YAML to April 2031, then
# CPI-uprated from 2031-32): PA £12,570, basic rate band £37,700 (so the
# higher rate threshold stays at £50,270), PT £241.73/week, UEL £966.73/week.
MOCK3_FROZEN_VALUES = {
    PERSONAL_ALLOWANCE_PATH: 12_570,
    HIGHER_RATE_THRESHOLD_PATH: 37_700,
    PRIMARY_THRESHOLD_PATH: 241.73,
    UPPER_EARNINGS_LIMIT_PATH: 966.73,
}


def _create_mock3_threshold_freeze_2032() -> Reform:
    """Mock 3 measure 12: hold 2031-32 thresholds at their 2030-31 values.

    "Main National Insurance thresholds" is read as the Class 1 Primary
    Threshold and Upper Earnings Limit. The Secondary Threshold and the
    Class 4 profits limits are not frozen (they keep the engine's CPI
    uprating). The higher rate threshold is held by freezing the basic rate
    band width, so PA + band stays at £50,270. The dividend higher rate
    threshold is already £37,700 natively in 2031-32.
    """
    return Reform(
        id="mock3_threshold_freeze_2032",
        name="Threshold freeze extended to April 2032",
        description=(
            "MOCK. The Personal Allowance (£12,570), higher rate threshold "
            "(£50,270) and the National Insurance Primary Threshold and Upper "
            "Earnings Limit stay at 2030-31 levels in 2031-32 instead of "
            "rising with CPI. The employer Secondary Threshold and Class 4 "
            "profits limits are not frozen."
        ),
        parameter_changes={
            path: {str(MOCK3_FREEZE_YEAR): value}
            for path, value in MOCK3_FROZEN_VALUES.items()
        },
    )


# ---------------------------------------------------------------------------
# #13 Class 4 main rate 6% -> 7% from April 2027
# ---------------------------------------------------------------------------
MOCK3_CLASS4_FIRST_YEAR = 2027
MOCK3_CLASS4_MAIN_RATE = 0.07


def _create_mock3_class4_main_rate() -> Reform:
    """Mock 3 measure 13: Class 4 main rate 6% -> 7% from 2027-28."""
    return Reform(
        id="mock3_class4_main_rate",
        name="Class 4 National Insurance main rate rise",
        description=(
            "MOCK. The Class 4 National Insurance main rate for the "
            "self-employed rises from 6% to 7% from April 2027, on profits "
            "between the Lower and Upper Profits Limits. The 2% additional "
            "rate is unchanged."
        ),
        parameter_changes={
            CLASS_4_MAIN_RATE_PATH: _from(
                MOCK3_CLASS4_FIRST_YEAR, MOCK3_CLASS4_MAIN_RATE
            ),
        },
    )


MOCK3_PARAM_REFORM_FACTORIES = [
    _create_mock3_additional_rate_threshold,
    _create_mock3_salary_sacrifice_cap,
    _create_mock3_threshold_freeze_2032,
    _create_mock3_class4_main_rate,
]
