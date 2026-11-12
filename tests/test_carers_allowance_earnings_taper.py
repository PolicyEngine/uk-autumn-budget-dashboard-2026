"""The Carer's Allowance earnings taper (``carers_allowance_earnings_taper``).

Retained forward-helper cases use 2026-27's £86.45 weekly allowance and
£204 earnings limit, with an explicit ``start_year=2026``. They test the
archived helper separately from the active parameter-only factory. Native
factory cases use the shared pre-Budget rollback and the provisional
6 October 2030 start, with its actual fiscal-year day fraction.

Earnings for the limit are pay less PAYE on the pay alone and primary
Class 1 NI (policyengine-uk's ``carers_allowance_earnings``). Below the
personal allowance and the primary threshold (£12,570 each) net pay is
gross pay; above, 20% income tax and 8% NI come off the excess.
"""

import math
from datetime import date

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
    carers_allowance_earnings_taper,
)
from uk_budget_data.budget_policy import native_policy_changes
from uk_budget_data.forecast import forecast_parameters, with_forecast
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    CARERS_ALLOWANCE_TAPER_ID,
    get_reform,
    list_reform_ids,
)

YEAR = 2026


def _carer(pay, region="LONDON", age=40, **inputs):
    """A carer providing 35 hours a week of care to an older relative on
    Attendance Allowance, in a benefit unit of their own."""
    carer = {
        "age": {YEAR: age},
        "employment_income": {YEAR: pay},
        "care_hours": {YEAR: 35},
    }
    for name, value in inputs.items():
        carer[name] = {YEAR: value}
    return {
        "people": {
            "carer": carer,
            "cared": {"age": {YEAR: 70}, "attendance_allowance": {YEAR: 5000}},
        },
        "benunits": {
            "b": {"members": ["carer"]},
            "b2": {"members": ["cared"]},
        },
        "households": {
            "h": {"members": ["carer", "cared"], "region": {YEAR: region}}
        },
    }


def _both(situation, variable, year=YEAR, **arguments):
    arguments.setdefault("start_year", YEAR)
    # The hand-computed cases use the engine's £204 limit and a whole
    # first year; the Budget's limit and part year are tested below.
    arguments.setdefault("national_living_wage_2027", None)
    arguments.setdefault("first_year_share", 1.0)
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    carers_allowance_earnings_taper(reformed, **arguments)
    return (
        baseline.calculate(variable, year).sum(),
        reformed.calculate(variable, year).sum(),
    )


def test_at_the_limit_is_unchanged():
    # £10,608 / 52 = £204.00 a week, not above the limit: the full
    # £86.45 x 52 = £4,495.40 either way.
    before, after = _both(_carer(10_608), "carers_allowance")
    assert before == pytest.approx(4_495.40, abs=0.01)
    assert after == pytest.approx(before, abs=0.01)


def test_below_the_limit_is_unchanged():
    # £8,000 / 52 = £153.85 a week: £4,495.40 either way.
    before, after = _both(_carer(8_000), "carers_allowance")
    assert before == pytest.approx(4_495.40, abs=0.01)
    assert after == pytest.approx(before, abs=0.01)


def test_one_pound_over_the_limit_loses_one_pound_a_week():
    # £10,660 / 52 = £205.00 a week, £1 over: the cliff takes all
    # £4,495.40; the taper pays (86.45 - 1) x 52 = £4,443.40.
    before, after = _both(_carer(10_660), "carers_allowance")
    assert before == pytest.approx(0, abs=0.01)
    assert after == pytest.approx(4_443.40, abs=0.01)


def test_part_way_down_the_taper():
    # £15,000: net 15,000 - 28% x 2,430 = £14,319.60, £275.3769 a week,
    # £275.37 to the penny: (86.45 - 71.37) x 52 = £784.16.
    before, after = _both(_carer(15_000), "carers_allowance")
    assert before == pytest.approx(0, abs=0.01)
    assert after == pytest.approx(784.16, abs=0.01)


def test_exhausted_once_the_excess_reaches_the_rate():
    # The taper ends at £204 + £86.45 = £290.45 a week. £16,100: net
    # 16,100 - 28% x 3,530 = £15,111.60, £290.60 a week: nothing.
    before, after = _both(_carer(16_100), "carers_allowance")
    assert before == pytest.approx(0, abs=0.01)
    assert after == pytest.approx(0, abs=0.01)


def test_taper_rate_is_an_argument():
    # At 50p per £1, £15,000: (86.45 - 0.5 x 71.37) x 52 = £2,639.78.
    _, after = _both(_carer(15_000), "carers_allowance", taper_rate=0.5)
    assert after == pytest.approx(2_639.78, abs=0.01)


def test_earnings_limit_is_an_argument():
    # A £250 limit puts £15,000 (£275.37 a week) £25.37 over:
    # (86.45 - 25.37) x 52 = £3,176.16; £10,660 is now below it: full.
    _, after = _both(_carer(15_000), "carers_allowance", earnings_limit=250)
    assert after == pytest.approx(3_176.16, abs=0.01)
    _, after = _both(_carer(10_660), "carers_allowance", earnings_limit=250)
    assert after == pytest.approx(4_495.40, abs=0.01)


def test_default_start_leaves_earlier_years_unchanged():
    # Default start 2030-31: in 2027-28 £1 over the limit still loses all.
    situation = _carer(10_660)
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    carers_allowance_earnings_taper(reformed)
    for year in (2026, 2027):
        assert reformed.calculate("carers_allowance", year).sum() == (
            pytest.approx(baseline.calculate("carers_allowance", year).sum())
        )


def test_scotland_is_unaffected():
    # Carer Support Payment replaced the allowance in Scotland from
    # 2025-26 and has its own earnings limit: nothing changes there.
    for variable in ("carers_allowance", "carer_support_payment"):
        before, after = _both(_carer(10_660, "SCOTLAND"), variable)
        assert before == pytest.approx(0, abs=0.01)
        assert after == pytest.approx(0, abs=0.01)


def test_a_carer_who_would_not_claim_gets_nothing():
    before, after = _both(
        _carer(10_660, would_claim_carers_allowance=False), "carers_allowance"
    )
    assert after == pytest.approx(0, abs=0.01)


def test_redraw_lets_a_newly_entitled_carer_claim():
    # A household situation draws 0, under any take-up rate above 0.
    _, after = _both(
        _carer(10_660, would_claim_carers_allowance=False),
        "carers_allowance",
        redraw_newly_entitled_take_up=True,
    )
    assert after == pytest.approx(4_443.40, abs=0.01)
    # Below the limit the redraw changes nothing: entitled and not claiming
    # in the data stays not claiming.
    _, after = _both(
        _carer(8_000, would_claim_carers_allowance=False),
        "carers_allowance",
        redraw_newly_entitled_take_up=True,
    )
    assert after == pytest.approx(0, abs=0.01)


def test_overlapping_benefit_step_is_unchanged():
    # Over State Pension age with a State Pension above the carer rate:
    # the tapered entitlement (£4,443.40) stays underlying, nothing paid.
    situation = _carer(10_660, age=70, state_pension=12_000)
    _, pre_overlap = _both(situation, "carers_allowance_pre_overlap")
    _, payable = _both(situation, "carers_allowance")
    assert pre_overlap == pytest.approx(4_443.40, abs=0.01)
    assert payable == pytest.approx(0, abs=0.01)


def _uc_family(pay):
    """A lone parent carer renting privately in the North West, on
    Universal Credit, with one child of 8."""
    people = {
        "carer": {
            "age": {YEAR: 35},
            "employment_income": {YEAR: pay},
            "care_hours": {YEAR: 35},
        },
        "child": {"age": {YEAR: 8}},
    }
    members = ["carer", "child"]
    return {
        "people": people,
        "benunits": {"b": {"members": members}},
        "households": {
            "h": {
                "members": members,
                "region": {YEAR: "NORTH_WEST"},
                "rent": {YEAR: 7_800},
                "tenure_type": {YEAR: "RENT_PRIVATELY"},
            }
        },
    }


def test_archived_helper_uc_deduction_and_tax_leave_a_loss():
    # £10,660: the taper pays £4,443.40, which Universal Credit counts in
    # full as unearned income, so UC falls by £4,443.40. The carer element
    # (£2,512.08) is paid on the hours either way. The allowance is
    # taxable: 10,660 + 4,443.40 - 12,570 = £2,533.40 at 20% = £506.68,
    # which this archived forward helper does not take off UC's earned
    # income, leaving a £506.68 loss under that design. This is not the
    # registered native taper's income-tax/UC interaction.
    situation = _uc_family(10_660)
    uc_before, uc_after = _both(situation, "universal_credit")
    assert uc_before - uc_after == pytest.approx(4_443.40, abs=0.01)
    element_before, element_after = _both(situation, "uc_carer_element")
    assert element_before == pytest.approx(2_512.08, abs=0.01)
    assert element_after == pytest.approx(element_before, abs=0.01)
    tax_before, tax_after = _both(situation, "income_tax")
    assert tax_after - tax_before == pytest.approx(506.68, abs=0.01)
    net_before, net_after = _both(situation, "household_net_income")
    assert net_after - net_before == pytest.approx(-506.68, abs=0.01)


def test_registered_on_budget_day():
    # Withdrawn on 27 October 2026 (#263, thin cells), registered again on
    # Budget day once announced (HCWS421), in the package.
    measure = get_reform(CARERS_ALLOWANCE_TAPER_ID)
    assert CARERS_ALLOWANCE_TAPER_ID in list_reform_ids()
    assert CARERS_ALLOWANCE_TAPER_ID in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    assert measure.simulation_modifier is None
    assert measure.parameter_changes == native_policy_changes(
        CARERS_ALLOWANCE_TAPER_ID
    )
    assert not measure.description.startswith("Candidate measure.")
    combined = get_reform(AUTUMN_BUDGET_2026_COMBINED_ID)
    assert measure.name in combined.description


def _native_pair(year, weekly_pay, wage_by_year=None):
    """The registered factory on the common reference, with optional wage
    inputs shared by both sides to test the native earnings-limit projector."""
    situation = _carer(round(weekly_pay * 52, 2))
    for person in situation["people"].values():
        for key, value in person.items():
            person[key] = {year: next(iter(value.values()))}
    situation["households"]["h"]["region"] = {year: "LONDON"}
    changes = {}
    if wage_by_year:
        bracket = (
            len(
                forecast_parameters().baseline.gov.hmrc.minimum_wage.non_apprentice.brackets
            )
            - 1
        )
        changes[f"gov.hmrc.minimum_wage.non_apprentice[{bracket}].amount"] = {
            str(y): value for y, value in wage_by_year
        }
    common = Scenario(parameter_changes=changes)
    selected = get_reform(CARERS_ALLOWANCE_TAPER_ID).to_scenario()
    return (
        Simulation(situation=situation, scenario=with_forecast(common)),
        Simulation(
            situation=situation, scenario=with_forecast(common + selected)
        ),
    )


def _native_weekly_awards_in(year, weekly_pays, wage_by_year=None):
    results = []
    for weekly_pay in weekly_pays:
        baseline, reformed = _native_pair(year, weekly_pay, wage_by_year)
        p = reformed.tax_benefit_system.parameters
        wage = p.gov.hmrc.minimum_wage.non_apprentice(f"{year}-01-01").amounts[
            -1
        ]
        hours = p.gov.dwp.carers_allowance.earnings_limit_national_living_wage_hours(
            f"{year}-01-01"
        )
        limit = math.ceil(round(hours * wage, 6))
        assert (
            p.gov.dwp.carers_allowance.earnings_limit(f"{year}-01-01") == limit
        )
        weekly = (
            float(reformed.calculate("carers_allowance_earnings", year)[0])
            / 52
        )
        excess = max(0, math.floor(weekly * 100 + 1e-6) / 100 - limit)
        rate = p.gov.dwp.carers_allowance.rate(f"{year}-01-01")
        results.append(
            (
                float(baseline.calculate("carers_allowance", year)[0]) / 52,
                float(reformed.calculate("carers_allowance", year)[0]) / 52,
                weekly,
                excess,
                rate,
                limit,
            )
        )
    return results


def test_the_budget_limit_is_16_hours_at_the_national_living_wage():
    """The native provisional 6 October 2030 start pays 182/365 of the
    annual taper amount; the actual pre-Budget side retains the cliff."""
    year = 2030
    p = forecast_parameters()
    limit = p.gov.dwp.carers_allowance.earnings_limit(f"{year}-01-01")
    ((before, after, _, excess, rate, actual_limit),) = (
        _native_weekly_awards_in(year, [limit + 20])
    )
    start, end = date(year, 4, 6), date(year + 1, 4, 6)
    taper_start = date(2030, 10, 6)
    share = (end - taper_start).days / (end - start).days
    assert ((end - taper_start).days, (end - start).days) == (182, 365)
    assert 0 < excess < rate
    assert actual_limit == limit
    assert before == 0
    assert after == pytest.approx(share * (rate - excess), abs=0.001)
    baseline, reformed = _native_pair(year, limit + 20)
    assert (
        baseline.tax_benefit_system.parameters.gov.dwp.carers_allowance.earnings_taper.applies(
            "2030-01-01"
        )
        == 0
    )
    assert reformed.tax_benefit_system.parameters.gov.dwp.carers_allowance.earnings_taper.applies(
        "2030-01-01"
    ) == pytest.approx(
        share
    )
    path = "gov.dwp.carers_allowance.earnings_taper.applies"
    assert any(
        interval.startswith("2030-10-06.") and value == 1
        for interval, value in native_policy_changes(
            CARERS_ALLOWANCE_TAPER_ID
        )[path].items()
    )


def test_northern_ireland_keeps_the_cliff():
    """England and Wales only (Budget 2026, 6.13)."""
    _, after = _both(
        _carer(11_000, region="NORTHERN_IRELAND"), "carers_allowance"
    )
    assert after == 0


def _archived_weekly_awards_in(year, weekly_pays, **arguments):
    """Retained forward-helper cases, separate from the active factory.
    For carers in London on each weekly pay (below the personal
    allowance), the Carer's Allowance a week before and after the taper in
    ``year``, and their weekly earnings for the limit (the engine moves
    the pay on a little in later years, so these are read, not assumed).
    The first pay should be below every limit, so its award is the full
    weekly rate."""
    results = []
    for weekly_pay in weekly_pays:
        situation = _carer(round(weekly_pay * 52, 2))
        for person in situation["people"].values():
            for key in person:
                person[key] = {year: list(person[key].values())[0]}
        situation["households"]["h"]["region"] = {year: "LONDON"}
        baseline = Simulation(situation=situation)
        reformed = Simulation(situation=situation)
        carers_allowance_earnings_taper(reformed, **arguments)
        results.append(
            (
                baseline.calculate("carers_allowance", year)[0] / 52,
                reformed.calculate("carers_allowance", year)[0] / 52,
                baseline.calculate("carers_allowance_earnings", year)[0] / 52,
            )
        )
    return results


def test_the_limit_rounds_up_to_the_next_pound():
    # Native projection rule: 16 x £13.21 = £211.36, rounded to £212.
    below, over = _native_weekly_awards_in(
        2031,
        (211.90, 213.50),
        wage_by_year=((2031, 13.21),),
    )
    assert 211.36 < below[2] <= 212
    assert below[5] == over[5] == 212
    assert below[0] == pytest.approx(below[4], abs=0.001)
    assert below[1] == pytest.approx(below[0], abs=0.001)
    assert 212 < over[2] < 212 + over[4]
    assert over[0] == 0
    assert over[1] == pytest.approx(over[4] - over[3], abs=0.001)


def test_archived_helper_exact_pound_limit_is_not_rounded_up():
    # 16 x £12.75 = £204.00 exactly, which stays £204, not £205.
    (full, _, _), over = _archived_weekly_awards_in(
        2031,
        (150, 204.80),
        national_living_wage_by_april=((2031, 12.75),),
    )
    assert 204 < over[2] < 205
    assert over[1] == pytest.approx(full - (over[2] - 204), abs=0.01)


def test_the_obr_wage_sets_the_limit_for_its_year():
    # £14.00 in April 2031 gives £224: about £220 is under it, about £230
    # over it.
    under, over = _native_weekly_awards_in(
        2031,
        (220, 230),
        wage_by_year=((2030, 13.00), (2031, 14.00)),
    )
    assert under[2] < 224 < over[2]
    assert under[5] == over[5] == 224
    assert under[0] == pytest.approx(under[4], abs=0.001)
    assert under[1] == pytest.approx(under[0], abs=0.001)
    assert over[0] == 0
    assert over[1] == pytest.approx(over[4] - over[3], abs=0.001)


def test_the_default_limit_is_the_obr_wage_rounded_up():
    # Native rounded OBR wage £14.62 in April 2031, x 16 = £233.92,
    # so £234 in 2031-32, a full year of the taper.
    under, over = _native_weekly_awards_in(2031, (233.50, 237))
    assert under[2] < 234 < over[2]
    assert under[5] == over[5] == 234
    assert under[0] == pytest.approx(under[4], abs=0.001)
    assert under[1] == pytest.approx(under[0], abs=0.001)
    assert over[0] == 0
    assert over[1] == pytest.approx(over[4] - over[3], abs=0.001)
