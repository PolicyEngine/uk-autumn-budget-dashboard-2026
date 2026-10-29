"""Gas standing charges abolished: one household's change in its gas bill.

The household gives one answer, its gas use in kWh a year; 0 kWh is a home
with no mains gas. The figures by hand are from Ofgem's price cap for 1
October to 31 December 2026 (the Great Britain average Direct Debit
standing charge, including VAT: 29.68p a day, £108.33 a year) and DESNZ's
mean domestic gas use per meter in 2024 (11,359 kWh), worked with the
rebalancing rule S × (use / mean use − 1) for a full year (#355).
"""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data import gas_standing_charges as gas

FULL_YEAR = 2028
FIRST_YEAR = 2027


def change_for(gas_use_kwh, year=FULL_YEAR, region="NORTH_WEST"):
    return gas.bill_change(gas_use_kwh=gas_use_kwh, region=region, year=year)


def test_one_standing_charge_for_every_home_the_budgets_108():
    """Ofgem's Great Britain average Direct Debit charge, 29.68p a day for
    365 days: the Budget's "£108 a year on average"."""
    assert gas.STANDING_CHARGE_PENCE_A_DAY == 29.68
    assert gas.annual_standing_charge() == pytest.approx(108.332)


def test_the_unit_rate_rises_by_the_standing_charge_over_mean_use():
    """£108.332 over 11,359 kWh: 0.954p a kWh."""
    assert change_for(9_500).unit_rate_rise_pence == pytest.approx(
        0.9537, abs=1e-4
    )


@pytest.mark.parametrize(
    "gas_use_kwh, expected",
    [
        (1, -108.32),
        (3_000, -79.72),
        (9_500, -17.73),
        (11_359, 0.00),
        (20_000, 82.41),
    ],
)
def test_a_full_year_by_hand(gas_use_kwh, expected):
    """From 2028-29: S × (use / 11,359 − 1)."""
    result = change_for(gas_use_kwh)
    assert result.change == pytest.approx(expected, abs=0.005)
    assert result.applies
    assert result.reason is None


def test_at_mean_use_the_change_is_a_calculated_zero():
    """At the mean use the bill neither rises nor falls: the measure
    applies, with no reason given, and the change is £0."""
    result = change_for(gas.MEAN_GAS_USE_KWH)
    assert result.applies
    assert result.reason is None
    assert result.change == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize(
    "gas_use_kwh, expected",
    [
        (3_000, -16.21),
        (9_500, 7.04),
        (11_359, 13.69),
        (20_000, 44.59),
    ],
)
def test_2027_28_has_january_to_march_2028_by_hand(gas_use_kwh, expected):
    """The assumed start, 1 January 2028: the standing charge comes off for
    91 of the year's 366 days, and the higher unit rate falls on the gas
    used from January to March, 37.5% of a year's use:
    S × (0.375 × use / 11,359 − 91/366)."""
    result = change_for(gas_use_kwh, year=FIRST_YEAR)
    assert result.change == pytest.approx(expected, abs=0.005)
    assert result.day_share == pytest.approx(91 / 366)
    assert result.use_share == pytest.approx(0.375)


def test_the_start_is_assumed_to_be_1_january_2028():
    assert gas.ABOLISHED_FROM.isoformat() == "2028-01-01"
    assert gas.in_force(2026) == gas.InForce(days=0, year_days=365, use=0)
    assert gas.in_force(2027) == gas.InForce(days=91, year_days=366, use=0.375)
    assert gas.in_force(2028) == gas.InForce(days=365, year_days=365, use=1)
    assert gas.in_force(2031) == gas.InForce(days=366, year_days=366, use=1)


def test_the_form_starts_at_ofgems_typical_use():
    assert gas.TYPICAL_GAS_USE_KWH == 9_500


@pytest.mark.parametrize(
    "case",
    [
        {"year": 2026},
        {"gas_use_kwh": 0},
        {"region": "NORTHERN_IRELAND"},
    ],
    ids=["before the start", "0 kWh: no mains gas", "Northern Ireland"],
)
def test_no_change_says_why(case):
    result = change_for(**{"gas_use_kwh": 9_500, **case})
    assert result.change == 0
    assert not result.applies
    assert result.reason


def test_the_reasons_are_distinct():
    reasons = {
        change_for(9_500, year=2026).reason,
        change_for(0).reason,
        change_for(9_500, region="NORTHERN_IRELAND").reason,
    }
    assert len(reasons) == 3
    assert "0 kWh" in change_for(0).reason


def test_refuses_a_negative_use():
    with pytest.raises(ValueError):
        change_for(-1)


@settings(max_examples=200, deadline=None)
@given(
    gas_use_kwh=st.floats(min_value=0.001, max_value=100_000),
    year=st.sampled_from([2027, 2028, 2029, 2030, 2031]),
)
def test_the_change_is_linear_in_use(gas_use_kwh, year):
    """Each extra kWh costs the unit rate rise, times the share of the
    year's use the abolition covers, less the standing charge for the days
    it covers."""
    result = change_for(gas_use_kwh, year=year)
    expected = gas.annual_standing_charge() * (
        result.use_share * gas_use_kwh / gas.MEAN_GAS_USE_KWH
        - result.day_share
    )
    assert result.change == pytest.approx(expected, abs=1e-9)


@settings(max_examples=100, deadline=None)
@given(
    uses=st.lists(
        st.floats(min_value=1, max_value=50_000), min_size=2, max_size=40
    )
)
def test_suppliers_recover_the_same_revenue(uses):
    """Across homes whose mean use is the national mean, a full year's bill
    changes add up to nothing: the standing charge is recovered through
    the unit rate, not removed."""
    scale = gas.MEAN_GAS_USE_KWH * len(uses) / sum(uses)
    total = sum(change_for(use * scale).change for use in uses)
    assert total == pytest.approx(0, abs=1e-6 * len(uses))
