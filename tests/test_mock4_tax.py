"""MOCK drill 4 tax measures, hand-checked on single households.

Model year Y is fiscal year Y-Y+1.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.reforms import get_reform, list_reform_ids

YEARS = [2026, 2027, 2028, 2029, 2030, 2031]


def _household(age, employment_income, petrol=0.0, diesel=0.0):
    return {
        "people": {
            "you": {
                "age": {str(y): age for y in YEARS},
                "employment_income": {
                    str(y): employment_income for y in YEARS
                },
            }
        },
        "benunits": {"benunit": {"members": ["you"]}},
        "households": {
            "household": {
                "members": ["you"],
                "petrol_spending": {str(y): petrol for y in YEARS},
                "diesel_spending": {str(y): diesel for y in YEARS},
            }
        },
    }


def _pair(reform_id, situation):
    scenario = get_reform(reform_id).to_scenario()
    return Simulation(situation=situation), Simulation(
        situation=situation, scenario=scenario
    )


def _change(baseline, reformed, variable, year):
    return float(reformed.calculate(variable, year).sum()) - float(
        baseline.calculate(variable, year).sum()
    )


def test_mock4_measures_are_registered():
    ids = list_reform_ids()
    assert "mock4_fuel_vat_cut" in ids
    assert "mock4_employer_ni_under23" in ids


# Fuel VAT: £1,000 petrol + £200 diesel = £1,200 a year, VAT-inclusive.
# Saving = 1,200 / 1.20 x 0.05 = £50 a full year.
# 2026-27: 50 x 121/365 = £16.5753; 2027-28: 50 x 61/365 = £8.3562.
FUEL_SAVING = {
    2026: 1200 / 1.2 * 0.05 * 121 / 365,
    2027: 1200 / 1.2 * 0.05 * 61 / 365,
    2028: 0.0,
    2029: 0.0,
    2030: 0.0,
    2031: 0.0,
}


@pytest.fixture(scope="module")
def fuel_pair():
    return _pair(
        "mock4_fuel_vat_cut",
        _household(40, 30_000, petrol=1_000, diesel=200),
    )


def test_fuel_vat_hand_values():
    assert FUEL_SAVING[2026] == pytest.approx(16.5753, abs=1e-4)
    assert FUEL_SAVING[2027] == pytest.approx(8.3562, abs=1e-4)


@pytest.mark.parametrize("year", YEARS)
def test_fuel_vat_cut_flows_through(fuel_pair, year):
    baseline, reformed = fuel_pair
    saving = FUEL_SAVING[year]
    assert _change(baseline, reformed, "vat", year) == pytest.approx(
        -saving, abs=1e-3
    )
    assert float(reformed.calculate("vat_change", year).sum()) == (
        pytest.approx(-saving, abs=1e-3)
    )
    assert _change(baseline, reformed, "household_tax", year) == (
        pytest.approx(-saving, abs=1e-3)
    )
    assert _change(baseline, reformed, "household_net_income", year) == (
        pytest.approx(saving, abs=1e-3)
    )
    assert _change(baseline, reformed, "gov_balance", year) == pytest.approx(
        -saving, abs=1e-3
    )
    # Fuel duty is untouched.
    assert _change(baseline, reformed, "fuel_duty", year) == pytest.approx(
        0, abs=1e-6
    )


def test_fuel_vat_cut_zero_without_fuel_spending():
    baseline, reformed = _pair("mock4_fuel_vat_cut", _household(40, 30_000))
    for year in (2026, 2027):
        assert _change(baseline, reformed, "vat", year) == pytest.approx(0)


# Employer NI: age 22 on £30,000. Secondary threshold £5,000, rate 15%.
# Baseline employer NI = 0.15 x (30,000 - 5,000) = £3,750.
# Relief from 2027-28 = 0.15 x (min(30,000, 25,000) - 5,000) = £3,000,
# leaving £750 (= 0.15 x 5,000, the slice above £25,000).
@pytest.fixture(scope="module")
def ni_young_pair():
    return _pair("mock4_employer_ni_under23", _household(22, 30_000))


def test_employer_ni_hand_values(ni_young_pair):
    baseline, reformed = ni_young_pair
    assert float(baseline.calculate("ni_employer", 2027).sum()) == (
        pytest.approx(3_750, abs=0.01)
    )
    assert float(reformed.calculate("ni_employer", 2027).sum()) == (
        pytest.approx(750, abs=0.01)
    )


@pytest.mark.parametrize("year", YEARS)
def test_employer_ni_under23_by_year(ni_young_pair, year):
    baseline, reformed = ni_young_pair
    # The secondary threshold is £5,000 to 2030-31, then CPI-uprated: 2031-32
    # is £5,100, so the relief there is 0.15 x (25,000 - 5,100) = £2,985.
    threshold = (
        baseline.tax_benefit_system.parameters(
            f"{year}-04-06"
        ).gov.hmrc.national_insurance.class_1.thresholds.secondary_threshold
        * 52
    )
    expected = 0.0 if year == 2026 else -0.15 * (25_000 - threshold)
    if 2026 < year < 2031:
        assert expected == pytest.approx(-3_000.0)
    if year == 2031:
        assert expected == pytest.approx(-2_985.0, abs=0.5)
    assert _change(baseline, reformed, "ni_employer", year) == (
        pytest.approx(expected, abs=0.01)
    )
    # Gross employer NI is the government side.
    assert _change(baseline, reformed, "gov_balance", year) == (
        pytest.approx(expected, abs=0.01)
    )
    # Earnings fixed: no pass-through to wages, so no household change.
    assert _change(baseline, reformed, "employment_income", year) == (
        pytest.approx(0, abs=1e-6)
    )
    assert _change(baseline, reformed, "household_net_income", year) == (
        pytest.approx(0, abs=1e-6)
    )


def test_employer_ni_no_relief_at_23():
    baseline, reformed = _pair(
        "mock4_employer_ni_under23", _household(23, 30_000)
    )
    assert _change(baseline, reformed, "ni_employer", 2027) == (
        pytest.approx(0, abs=1e-6)
    )


def test_employer_ni_below_cap_fully_relieved():
    # Age 20 on £18,000: baseline 0.15 x 13,000 = £1,950, all relieved.
    baseline, reformed = _pair(
        "mock4_employer_ni_under23", _household(20, 18_000)
    )
    assert float(baseline.calculate("ni_employer", 2028).sum()) == (
        pytest.approx(1_950, abs=0.01)
    )
    assert float(reformed.calculate("ni_employer", 2028).sum()) == (
        pytest.approx(0, abs=0.01)
    )
