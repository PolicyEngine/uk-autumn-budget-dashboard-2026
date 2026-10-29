"""Universal Credit's surplus earnings rule, month by month, for one
household (``uk_budget_data.uc_surplus_earnings``). No engine: each
month's Universal Credit amounts are given directly.

The two worked examples are DWP's own, in Advice for Decision Making
chapter H3, paragraph H3311 (Examples 1 and 2), so they check the rule
against figures worked out independently of this code:
https://assets.publishing.service.gov.uk/media/69845c2fafabc06c35d3442f/adm-ch-h3.pdf
"""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data import uc_surplus_earnings as surplus_rule
from uk_budget_data.uc_surplus_earnings import MonthAmounts


def simple_month(
    earned_income: float,
    maximum_amount: float,
    taper_rate: float,
    work_allowance: float = 0.0,
    unearned_income: float = 0.0,
) -> MonthAmounts:
    """A month with no benefit cap and no minimum income floor: Universal
    Credit is the maximum amount less the taper on earned income above the
    work allowance and less unearned income, never below nil."""
    reduction = min(
        maximum_amount,
        taper_rate * max(0.0, earned_income - work_allowance)
        + unearned_income,
    )
    award = maximum_amount - reduction
    return MonthAmounts(
        universal_credit=award,
        universal_credit_before_benefit_cap=award,
        maximum_amount=maximum_amount,
        unearned_income=unearned_income,
        work_allowance=work_allowance,
        total_earned_income=earned_income,
        assessed_earned_income=earned_income,
    )


def test_emma_adm_h3311_example_2_at_the_300_pound_threshold():
    # Emma: single, £300 a month, no unearned income and no work
    # allowance, maximum amount £317.82, the 63% taper of 2019 and the
    # £300 de minimis. A £2,100 bonus makes one month's earnings £2,400.
    taper_rate = 0.63
    months = [
        simple_month(pay, 317.82, taper_rate)
        for pay in (2_400, 300, 300, 300, 300)
    ]
    results = surplus_rule.month_by_month(months, 300, taper_rate)

    assert surplus_rule.nil_uc_threshold(months[0], taper_rate) == 504.48
    # The bonus month ends the award: original surplus £2,400 − £804.48
    assert results[0].status == "award_ended"
    assert results[0].universal_credit == 0
    assert results[0].surplus_carried == pytest.approx(1_595.52, abs=0.005)
    # Claims 1 to 3: no award; the adjusted surplus carried each time
    for index, (counted, carried) in enumerate(
        [(1_595.52, 1_091.04), (1_091.04, 586.56), (586.56, 82.08)],
        start=1,
    ):
        assert results[index].status == "no_award"
        assert results[index].claim == index
        assert results[index].universal_credit == 0
        assert results[index].surplus_counted == pytest.approx(
            counted, abs=0.005
        )
        assert results[index].surplus_carried == pytest.approx(
            carried, abs=0.005
        )
    # Claim 4: an award of £77.11, and nothing carried
    assert results[4].status == "new_award"
    assert results[4].claim == 4
    assert results[4].surplus_counted == pytest.approx(82.08, abs=0.005)
    assert results[4].universal_credit == pytest.approx(77.11, abs=0.005)
    assert results[4].surplus_carried == 0


def test_john_adm_h3311_example_1_at_the_2500_pound_threshold():
    # John: single, £500 a month, maximum amount £393.45, no work
    # allowance, the 55% taper and the £2,500 de minimis. A £3,000 bonus
    # makes one month's earnings £3,500.
    taper_rate = 0.55
    months = [
        simple_month(pay, 393.45, taper_rate) for pay in (3_500, 500, 500)
    ]
    results = surplus_rule.month_by_month(months, 2_500, taper_rate)

    assert surplus_rule.nil_uc_threshold(months[0], taper_rate) == 715.36
    assert results[0].status == "award_ended"
    assert results[0].surplus_carried == pytest.approx(284.64, abs=0.005)
    # First claim: £284.64 + £500 is £38.10 of excess income, so no
    # award, and it no longer exceeds the relevant threshold (£3,215.36):
    # nothing is carried
    assert results[1].status == "no_award"
    assert results[1].surplus_counted == pytest.approx(284.64, abs=0.005)
    assert results[1].universal_credit == 0
    assert results[1].surplus_carried == 0
    # Second claim: no surplus, so the month's own award
    assert results[2].status == "new_award"
    assert results[2].surplus_counted == 0
    assert results[2].universal_credit == pytest.approx(
        393.45 - 0.55 * 500, abs=0.005
    )


def test_a_surplus_counts_in_five_claims_at_most():
    # A surplus far larger than the month's earnings could ever erode:
    # claims 1 to 5 give nothing, and the sixth month, past the six
    # months, has the month's own award
    taper_rate = 0.55
    months = [simple_month(100_000, 400, taper_rate)] + [
        simple_month(500, 400, taper_rate)
    ] * 6
    results = surplus_rule.month_by_month(months, 300, taper_rate)
    assert [result.claim for result in results] == [None, 1, 2, 3, 4, 5, None]
    assert [result.status for result in results[1:6]] == ["no_award"] * 5
    # Nothing is carried from the fifth claim: the surplus lapses
    assert results[5].surplus_carried == 0
    assert results[6].status == "new_award"
    assert results[6].surplus_counted == 0
    assert results[6].universal_credit == pytest.approx(
        400 - 0.55 * 500, abs=0.005
    )


def test_an_award_that_never_ends_carries_nothing():
    taper_rate = 0.55
    months = [simple_month(1_000, 1_200, taper_rate, 400)] * 12
    for threshold in (300, 2_500):
        results = surplus_rule.month_by_month(months, threshold, taper_rate)
        assert {result.status for result in results} == {"award"}
        assert sum(result.universal_credit for result in results) == (
            pytest.approx(12 * months[0].universal_credit)
        )


def test_a_household_off_an_award_claims_once_entitled():
    # Not entitled in April (no award ended, so no surplus), entitled from
    # May: a new award then, with nothing counted
    taper_rate = 0.55
    months = [simple_month(5_000, 900, taper_rate)] + [
        simple_month(800, 900, taper_rate)
    ] * 2
    results = surplus_rule.month_by_month(
        months, 300, taper_rate, on_award_at_start=False
    )
    assert results[0].status == "no_award"
    assert results[0].claim is None
    assert results[0].surplus_carried == 0
    assert results[1].status == "new_award"
    assert results[2].status == "award"


@pytest.mark.parametrize(
    "year, current_law, budget",
    [(2026, 2_500, 2_500), (2027, 300, 2_500), (2028, 300, 300)],
)
def test_the_thresholds_by_year(year, current_law, budget):
    # Current law: £2,500 for claims to 31 March 2027 (ADM H3310), then
    # £300; the Budget keeps £2,500 to 31 March 2028 (Table 6.1 row 8)
    assert surplus_rule.surplus_threshold(year, budget=False) == current_law
    assert surplus_rule.surplus_threshold(year, budget=True) == budget
    assert (year in surplus_rule.MEASURE_YEARS) is (current_law != budget)


def test_the_minimum_income_floor_is_applied_after_the_surplus():
    # ADM H3314: a self-employed claimant earning £200 is assessed on a
    # £1,000 floor. A £500 surplus leaves them below it, so the award is
    # unchanged; a £1,000 surplus takes them £200 above it.
    taper_rate = 0.55
    month = MonthAmounts(
        universal_credit=1_500 - taper_rate * 1_000,
        universal_credit_before_benefit_cap=1_500 - taper_rate * 1_000,
        maximum_amount=1_500,
        unearned_income=0,
        work_allowance=0,
        total_earned_income=200,
        assessed_earned_income=1_000,
    )
    assert surplus_rule.universal_credit_with_surplus(
        month, 500, taper_rate
    ) == pytest.approx(month.universal_credit)
    assert surplus_rule.universal_credit_with_surplus(
        month, 1_000, taper_rate
    ) == pytest.approx(month.universal_credit - taper_rate * 200)


def test_the_benefit_cap_room_takes_the_surplus_first():
    # The cap takes £400 off a £1,000 award. A surplus whose taper is under
    # £400 leaves the capped award as it is; above that, the award falls by
    # the rest.
    taper_rate = 0.5
    month = MonthAmounts(
        universal_credit=600,
        universal_credit_before_benefit_cap=1_000,
        maximum_amount=1_500,
        unearned_income=0,
        work_allowance=0,
        total_earned_income=1_000,
        assessed_earned_income=1_000,
    )
    assert surplus_rule.universal_credit_with_surplus(
        month, 600, taper_rate
    ) == pytest.approx(600)
    assert surplus_rule.universal_credit_with_surplus(
        month, 1_000, taper_rate
    ) == pytest.approx(500)


def test_the_measure_change_is_the_budget_months_less_current_law():
    # A bonus month whose earnings are £1,000 above the nil UC threshold:
    # a surplus at £300 (£700), none at £2,500. The first new claim pays
    # less at £300, by the taper on £700.
    taper_rate = 0.55
    maximum, allowance, regular = 1_650.0, 440.0, 1_400.0
    nil_threshold = round(maximum / taper_rate + allowance, 2)
    pay = [regular] * 12
    pay[5] = nil_threshold + 1_000
    months = [
        simple_month(value, maximum, taper_rate, allowance) for value in pay
    ]
    effect = surplus_rule.household_effect(months, 2027, taper_rate)
    assert effect["thresholds"] == {"current_law": 300, "budget": 2_500}
    current_law, budget = effect["current_law"], effect["budget"]
    assert current_law[5].surplus_carried == pytest.approx(700, abs=0.005)
    assert budget[5].surplus_carried == 0
    assert current_law[6].status == budget[6].status == "new_award"
    assert effect["change"] == pytest.approx(taper_rate * 700, abs=0.01)
    assert effect["change"] == pytest.approx(
        sum(month.universal_credit for month in budget)
        - sum(month.universal_credit for month in current_law)
    )


def test_a_year_with_equal_thresholds_has_no_change():
    taper_rate = 0.55
    pay = [1_000] * 11 + [20_000]
    months = [simple_month(value, 1_200, taper_rate) for value in pay]
    for year in (2026, 2028, 2031):
        assert surplus_rule.household_effect(months, year, taper_rate)[
            "change"
        ] == pytest.approx(0)


@pytest.mark.parametrize(
    "region, claims, year, expected",
    [
        ("NORTH_WEST", True, 2027, (None, None)),
        ("SCOTLAND", True, 2027, (None, None)),
        # The Budget measure is for Great Britain: Northern Ireland's
        # Department for Communities sets its own threshold
        ("NORTHERN_IRELAND", True, 2027, ("not_affected", "great_britain")),
        ("NORTH_WEST", False, 2027, ("not_affected", "no_universal_credit")),
        ("NORTH_WEST", True, 2028, ("not_affected", "same_threshold")),
        ("NORTH_WEST", True, 2026, ("not_affected", "same_threshold")),
        ("NORTHERN_IRELAND", False, 2028, ("not_affected", "great_britain")),
    ],
)
def test_what_is_decided_before_any_run(region, claims, year, expected):
    status, reason = surplus_rule.decided_without_running(region, claims, year)
    assert (status, reason) == expected
    if reason is not None:
        assert surplus_rule.REASONS[reason]


money = st.floats(min_value=0, max_value=20_000, allow_nan=False)


@st.composite
def year_of_months(draw):
    taper_rate = 0.55
    maximum = draw(st.floats(min_value=300, max_value=3_000))
    allowance = draw(st.sampled_from([0.0, 411.0, 684.0]))
    pay = draw(st.lists(money, min_size=12, max_size=12))
    months = [
        simple_month(value, maximum, taper_rate, allowance) for value in pay
    ]
    return months, taper_rate


@given(year_of_months(), st.sampled_from([300, 2_500]))
def test_a_surplus_only_ever_lowers_a_month_and_never_below_nil(
    drawn, threshold
):
    months, taper_rate = drawn
    results = surplus_rule.month_by_month(months, threshold, taper_rate)
    assert len(results) == len(months)
    for month, result in zip(months, results):
        assert 0 <= result.universal_credit <= month.universal_credit + 0.01
        assert result.surplus_counted >= 0
        assert result.surplus_carried >= 0
        if result.status in ("award", "new_award"):
            assert result.universal_credit >= surplus_rule.MINIMUM_AWARD
        else:
            assert result.universal_credit == 0


@given(year_of_months())
def test_with_no_month_at_nil_both_thresholds_pay_the_same(drawn):
    months, taper_rate = drawn
    if any(month.universal_credit < 0.01 for month in months):
        return
    effect = surplus_rule.household_effect(months, 2027, taper_rate)
    assert effect["change"] == 0
