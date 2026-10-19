"""MOCK drill 4: hand-checked household specimens for the two structural
measures (Child Benefit Early Years Addition, State Pension Top-up
Allowance). Single-household situations; no population dataset.

Model year Y is fiscal year Y-Y+1; both measures start in model year 2027.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.reforms import get_reform

YEARS = [2026, 2027, 2028, 2029, 2030, 2031]


def _reform(reform_id):
    return get_reform(reform_id)


def _pair(situation, reform_id):
    baseline = Simulation(situation=situation)
    reformed = Simulation(
        situation=situation, scenario=_reform(reform_id).to_scenario()
    )
    return baseline, reformed


def _family(child_age, year, employment_income=30_000):
    return {
        "people": {
            "parent": {
                "age": {year: 30},
                "employment_income": {year: employment_income},
            },
            "child": {"age": {year: child_age}},
        },
        "benunits": {"b": {"members": ["parent", "child"]}},
        "households": {"h": {"members": ["parent", "child"]}},
    }


def _pensioner(year, state_pension, private_pension=0):
    return {
        "people": {
            "p": {
                "age": {year: 70},
                "state_pension": {year: state_pension},
                "private_pension_income": {year: private_pension},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def test_both_measures_registered():
    from uk_budget_data.reforms import get_autumn_budget_2026_reforms

    ids = {r.id for r in get_autumn_budget_2026_reforms()}
    assert "mock4_cb_early_years_addition" in ids
    assert "mock4_state_pension_topup_allowance" in ids


# --- Child Benefit Early Years Addition ------------------------------------


@pytest.mark.parametrize("year", YEARS)
def test_cb_eya_child_aged_0(year):
    """One child aged 0, parent on £30k (no HICBC): +£10 x 52 = £520 a year
    from 2027, nothing in 2026."""
    base, reform = _pair(_family(0, year), "mock4_cb_early_years_addition")
    expected = 520.0 if year >= 2027 else 0.0
    d_cb = (
        reform.calculate("child_benefit", year)[0]
        - base.calculate("child_benefit", year)[0]
    )
    d_net = (
        reform.calculate("household_net_income", year)[0]
        - base.calculate("household_net_income", year)[0]
    )
    assert d_cb == pytest.approx(expected, abs=0.01)
    assert d_net == pytest.approx(expected, abs=0.01)


def test_cb_eya_child_aged_1_gets_nothing():
    base, reform = _pair(_family(1, 2027), "mock4_cb_early_years_addition")
    assert reform.calculate("household_net_income", 2027)[0] == pytest.approx(
        base.calculate("household_net_income", 2027)[0], abs=0.01
    )


def test_cb_eya_subject_to_hicbc():
    """Parent ANI £70k: HICBC charges 50% of CB (phase-out £60k-£80k), so
    half the addition is clawed back: net gain £260 (+/- £1 rounding)."""
    base, reform = _pair(
        _family(0, 2027, employment_income=70_000),
        "mock4_cb_early_years_addition",
    )
    d_net = (
        reform.calculate("household_net_income", 2027)[0]
        - base.calculate("household_net_income", 2027)[0]
    )
    assert d_net == pytest.approx(260.0, abs=1.0)


# --- State Pension Top-up Allowance ----------------------------------------


@pytest.mark.parametrize("year", YEARS)
def test_spta_sp_only_above_pa(year):
    """SP £13,000, no other income. PA £12,570 to 2030 (£12,830 in 2031).
    Baseline tax = 20% x (13,000 - PA): £86 (2026-30), £34 (2031). From
    2027 the allowance covers SP - PA and ANI (£13,000) is below the
    withdrawal threshold, so income tax falls to £0."""
    base, reform = _pair(
        _pensioner(year, 13_000), "mock4_state_pension_topup_allowance"
    )
    base_tax = base.calculate("income_tax", year)[0]
    pa = base.calculate("personal_allowance", year)[0]
    assert base_tax == pytest.approx(0.2 * (13_000 - pa), abs=0.01)
    expected = base_tax if year == 2026 else 0.0
    assert reform.calculate("income_tax", year)[0] == pytest.approx(
        expected, abs=0.01
    )


def test_spta_withdrawn_pound_for_pound():
    """2027: SP £13,000 + private pension £1,300, ANI £14,300.
    Full new SP = 250.71102654 x 52 = £13,036.97; threshold £14,036.97.
    Allowance = 430 - (14,300 - 14,036.97) = £166.97.
    Tax: baseline 20% x 1,730 = £346; reform 20% x (1,730 - 166.97)
    = £312.61."""
    base, reform = _pair(
        _pensioner(2027, 13_000, 1_300), "mock4_state_pension_topup_allowance"
    )
    assert base.calculate("income_tax", 2027)[0] == pytest.approx(
        346.0, abs=0.01
    )
    assert reform.calculate("income_tax", 2027)[0] == pytest.approx(
        312.61, abs=0.02
    )


def test_spta_sp_below_pa_gets_nothing():
    """SP £12,000 < PA: allowance £0, tax unchanged (£0)."""
    base, reform = _pair(
        _pensioner(2027, 12_000), "mock4_state_pension_topup_allowance"
    )
    assert reform.calculate("income_tax", 2027)[0] == pytest.approx(
        base.calculate("income_tax", 2027)[0], abs=0.01
    )


def test_spta_fully_withdrawn():
    """SP £13,000 + £5,000 private: ANI exceeds threshold by ~£3,963 > £430,
    so no allowance."""
    base, reform = _pair(
        _pensioner(2027, 13_000, 5_000), "mock4_state_pension_topup_allowance"
    )
    assert reform.calculate("income_tax", 2027)[0] == pytest.approx(
        base.calculate("income_tax", 2027)[0], abs=0.01
    )
