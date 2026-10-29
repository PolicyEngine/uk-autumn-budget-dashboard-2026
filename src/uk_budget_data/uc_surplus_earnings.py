"""Universal Credit's surplus earnings rule, month by month, for one
household: the Budget 2026 measure that keeps the surplus earnings
threshold at £2,500 for claims from April 2027 to March 2028 (Table 6.1
row 8, −£140m in 2027-28), for the household calculator only.

policyengine-uk works out Universal Credit for a whole year from yearly
earnings, as if every month were the same, and has no surplus earnings
rule. This module takes each month's Universal Credit amounts without any
surplus (from a policyengine-uk simulation of that month's pay, in
``household_impact``) and applies the rule across the months, once at
each threshold.

The rule (Universal Credit Regulations 2013 reg. 54A; DWP Advice for
Decision Making chapter H3, H3300 to H3314):

- When earnings take an award to nil, the award ends. The month that
  would have been its final assessment period gives the "original
  surplus": the claimants' total earned income above the relevant
  threshold.
- The relevant threshold is the nil UC threshold, the earned income at
  which Universal Credit is nil ((M − U) / taper + WA), plus £300
  (reg. 54A(6)), or plus £2,500 for a claim for a period that begins
  before the end of the temporary de minimis period (SI 2015/345 reg. 5;
  ADM H3309 and H3310).
- The claimant is treated as claiming again on the first day of each of
  the next five months (Claims and Payments Regulations 2013 reg. 32A;
  ADM memo 10/20). In each of those first to fifth claims the surplus
  counts as earned income. A claim that gives no award carries the
  "adjusted surplus" to the next: the surplus plus that month's total
  earned income, less the relevant threshold, if positive
  (reg. 54A(3)). From the sixth month the old award ended more than six
  months before, and nothing counts (reg. 54A(1)(a)).
- Total earned income leaves out what the minimum income floor adds
  (reg. 54A(6)); the floor is applied after the surplus (ADM H3314).
- No surplus applies to a claimant who has recently been a victim of
  domestic violence (reg. 54A(5)), for whom the measure changes nothing.

Amounts are £ a month, rounded to the penny where the ADM's worked
examples round them: the nil UC threshold and each surplus.
"""

from dataclasses import dataclass
from typing import Optional

MEASURE_ID = "universal_credit_surplus_earnings"
MEASURE_NAME = "Universal Credit surplus earnings threshold kept at £2,500"

# Reg. 54A(6): the nil UC threshold plus £300
REGULATIONS_THRESHOLD = 300
# SI 2015/345 reg. 5: plus £2,500 instead, for a claim for a period that
# begins before the end of the temporary de minimis period
TEMPORARY_THRESHOLD = 2_500
# The last policy year (April to March) in the temporary de minimis
# period. Under current law it ends on 31 March 2027 (ADM H3310, after the
# Secretary of State's determination of January 2026); the Budget extends
# it to 31 March 2028 (Budget 2026, Table 6.1 row 8).
LAST_TEMPORARY_YEAR = {"current_law": 2026, "budget": 2027}
# The policy years in which the two thresholds differ
MEASURE_YEARS = frozenset(
    year
    for year in range(
        LAST_TEMPORARY_YEAR["current_law"] + 1,
        LAST_TEMPORARY_YEAR["budget"] + 1,
    )
)
# Reg. 54A(3): surplus earnings count in the first to fifth claims after
# the old award ended
CLAIMS_COUNTING_SURPLUS = 5
MONTHS_IN_YEAR = 12
# Less than a penny is no award
MINIMUM_AWARD = 0.01

# Why the measure changes nothing for a household, decided from its
# answers before any simulation
REASONS = {
    "great_britain": (
        "The Budget keeps the £2,500 threshold in Great Britain. Northern "
        "Ireland's Department for Communities sets Northern Ireland's, so "
        "this measure does not change it."
    ),
    "no_universal_credit": (
        "The household does not claim Universal Credit, so no award can "
        "end or start."
    ),
    "same_threshold": (
        "The threshold is the same with or without the Budget in this "
        "year: £2,500 for claims to March 2027, and £300 from April 2028. "
        "The Budget keeps £2,500 for claims from April 2027 to March 2028."
    ),
}


def surplus_threshold(year: int, budget: bool) -> int:
    """The amount added to the nil UC threshold for claims in the policy
    year ``year`` (April to March): £2,500 in the temporary de minimis
    period, else £300. ``budget`` says whether the Budget's extension to
    March 2028 applies."""
    last = LAST_TEMPORARY_YEAR["budget" if budget else "current_law"]
    return TEMPORARY_THRESHOLD if year <= last else REGULATIONS_THRESHOLD


def decided_without_running(
    region: str, claims_universal_credit: bool, year: int
) -> tuple[Optional[str], Optional[str]]:
    """``("not_affected", reason)`` when the measure cannot change this
    household's net income in ``year`` (a key of ``REASONS``), else
    ``(None, None)``: the months must be worked out."""
    if region == "NORTHERN_IRELAND":
        return "not_affected", "great_britain"
    if not claims_universal_credit:
        return "not_affected", "no_universal_credit"
    if year not in MEASURE_YEARS:
        return "not_affected", "same_threshold"
    return None, None


@dataclass(frozen=True)
class MonthAmounts:
    """One month's Universal Credit amounts with no surplus earnings, £ a
    month, as policyengine-uk gives them for that month's pay.

    ``universal_credit`` is the award after the benefit cap;
    ``universal_credit_before_benefit_cap`` before it. ``maximum_amount``
    (M), ``unearned_income`` (U) and ``work_allowance`` (WA) are the nil UC
    threshold's terms. ``total_earned_income`` is the claimants' earned
    income without the minimum income floor (reg. 54A(6));
    ``assessed_earned_income`` is what the award is assessed on, with the
    floor where it applies."""

    universal_credit: float
    universal_credit_before_benefit_cap: float
    maximum_amount: float
    unearned_income: float
    work_allowance: float
    total_earned_income: float
    assessed_earned_income: float


@dataclass(frozen=True)
class MonthResult:
    """What happens to the household's Universal Credit in one month.

    ``status``: "award" (an award runs and is paid), "award_ended" (the
    month's earnings take the award to nil and it ends), "new_award" (a
    claim this month starts an award) or "no_award" (no award this month).
    ``claim`` is which claim since the old award ended (1 to 5) when the
    surplus could count in it, else None. ``surplus_counted`` is the
    surplus counted as earned income this month; ``surplus_carried`` what
    the next month's claim would count."""

    universal_credit: float
    status: str
    surplus_counted: float
    surplus_carried: float
    claim: Optional[int]
    nil_uc_threshold: float


def _penny(value: float) -> float:
    return round(float(value), 2)


def nil_uc_threshold(month: MonthAmounts, taper_rate: float) -> float:
    """The total earned income above which there is no Universal Credit
    (reg. 54A(6)): (M − U) / taper + WA, to the penny, never below nil."""
    return _penny(
        max(
            0.0,
            (month.maximum_amount - month.unearned_income) / taper_rate
            + month.work_allowance,
        )
    )


def _income_reduction(
    month: MonthAmounts, earned_income: float, taper_rate: float
) -> float:
    # As policyengine-uk's uc_income_reduction: the taper on earned income
    # above the work allowance plus unearned income, at most M
    return min(
        month.maximum_amount,
        taper_rate * max(0.0, earned_income - month.work_allowance)
        + month.unearned_income,
    )


def universal_credit_with_surplus(
    month: MonthAmounts, surplus: float, taper_rate: float
) -> float:
    """The month's award with ``surplus`` counted as earned income
    (reg. 54A(2)).

    The minimum income floor is applied after the surplus is added (ADM
    H3314): the earned income assessed is the larger of the month's
    assessed earned income and its total earned income plus the surplus.
    The award before the benefit cap falls by the extra taper; the cap's
    reduction is the month's, so the capped award falls only once the
    award before it drops below the capped amount."""
    if surplus <= 0:
        return month.universal_credit
    with_surplus = max(
        month.assessed_earned_income, month.total_earned_income + surplus
    )
    extra = _income_reduction(
        month, with_surplus, taper_rate
    ) - _income_reduction(month, month.assessed_earned_income, taper_rate)
    return max(
        0.0,
        min(
            month.universal_credit,
            month.universal_credit_before_benefit_cap - extra,
        ),
    )


def month_by_month(
    months: list[MonthAmounts],
    threshold: float,
    taper_rate: float,
    on_award_at_start: bool = True,
) -> list[MonthResult]:
    """The household's Universal Credit in each month, with surplus
    earnings at ``threshold`` (£300 or £2,500 above the nil UC threshold).

    The household starts on an award (``on_award_at_start``) with no
    surplus carried in from before the first month. After an award ends it
    claims every month, as reg. 32A treats it as doing."""
    results = []
    on_award = on_award_at_start
    surplus = 0.0
    # Claims made since the old award ended; None when no award has ended
    # within the six months
    claims = None
    for month in months:
        nil_threshold = nil_uc_threshold(month, taper_rate)
        relevant_threshold = nil_threshold + threshold
        if on_award:
            if month.universal_credit >= MINIMUM_AWARD:
                results.append(
                    MonthResult(
                        _penny(month.universal_credit),
                        "award",
                        0.0,
                        0.0,
                        None,
                        nil_threshold,
                    )
                )
                continue
            # The award ends: this month would have been its final
            # assessment period, and its earnings above the relevant
            # threshold are the original surplus
            on_award = False
            claims = 0
            surplus = _penny(
                max(0.0, month.total_earned_income - relevant_threshold)
            )
            results.append(
                MonthResult(
                    0.0, "award_ended", 0.0, surplus, None, nil_threshold
                )
            )
            continue
        # A claim this month. Within the six months the surplus counts.
        if claims is not None and claims < CLAIMS_COUNTING_SURPLUS:
            claims += 1
            claim = claims
            counted = surplus
        else:
            claims, claim, counted, surplus = None, None, 0.0, 0.0
        award = universal_credit_with_surplus(month, counted, taper_rate)
        if award >= MINIMUM_AWARD:
            on_award = True
            claims, surplus = None, 0.0
            results.append(
                MonthResult(
                    _penny(award),
                    "new_award",
                    counted,
                    0.0,
                    claim,
                    nil_threshold,
                )
            )
            continue
        if claim is not None:
            # The adjusted surplus for the next claim (reg. 54A(3)(b) to
            # (e)); nothing after the fifth claim
            surplus = (
                _penny(
                    max(
                        0.0,
                        counted
                        + month.total_earned_income
                        - relevant_threshold,
                    )
                )
                if claim < CLAIMS_COUNTING_SURPLUS
                else 0.0
            )
        results.append(
            MonthResult(
                0.0, "no_award", counted, surplus, claim, nil_threshold
            )
        )
    return results


def household_effect(
    months: list[MonthAmounts], year: int, taper_rate: float
) -> dict:
    """The months at the current-law threshold and at the Budget's, and
    the measure's change: the Budget's twelve months of Universal Credit
    less current law's."""
    thresholds = {
        "current_law": surplus_threshold(year, budget=False),
        "budget": surplus_threshold(year, budget=True),
    }
    current_law = month_by_month(months, thresholds["current_law"], taper_rate)
    budget = month_by_month(months, thresholds["budget"], taper_rate)
    total = {
        "current_law": sum(month.universal_credit for month in current_law),
        "budget": sum(month.universal_credit for month in budget),
    }
    return {
        "thresholds": thresholds,
        "current_law": current_law,
        "budget": budget,
        "total": total,
        "change": total["budget"] - total["current_law"],
    }


def month_amounts_from_yearly(values: dict) -> MonthAmounts:
    """One month's amounts from policyengine-uk's yearly figures for a
    year of that month's pay (each ÷ 12)."""
    return MonthAmounts(
        **{
            name: float(values[name]) / MONTHS_IN_YEAR
            for name in MonthAmounts.__dataclass_fields__
        }
    )
