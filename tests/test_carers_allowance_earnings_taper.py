"""The Carer's Allowance earnings taper (``carers_allowance_earnings_taper``).

Hand-computed cases in 2026-27, the last year whose rate and limit are in
law rather than projected: the allowance is £86.45 a week and the
earnings limit £204. The measure starts in 2030-31 by default, so each
case passes ``start_year=2026``; one case checks the default leaves
2027-28 alone.

Earnings for the limit are pay less PAYE on the pay alone and primary
Class 1 NI (policyengine-uk's ``carers_allowance_earnings``). Below the
personal allowance and the primary threshold (£12,570 each) net pay is
gross pay; above, 20% income tax and 8% NI come off the excess.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
    carers_allowance_earnings_taper,
)
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


def test_universal_credit_takes_it_all_back_and_tax_leaves_a_loss():
    # £10,660: the taper pays £4,443.40, which Universal Credit counts in
    # full as unearned income, so UC falls by £4,443.40. The carer element
    # (£2,512.08) is paid on the hours either way. The allowance is
    # taxable: 10,660 + 4,443.40 - 12,570 = £2,533.40 at 20% = £506.68,
    # which the engine does not take off UC's earned income (in practice
    # PAYE would collect it from the pay, and UC would return 55% of it),
    # so the household is £506.68 a year worse off.
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
    assert measure.simulation_modifier is carers_allowance_earnings_taper
    assert not measure.description.startswith("Candidate measure.")
    combined = get_reform(AUTUMN_BUDGET_2026_COMBINED_ID)
    assert measure.name in combined.description
