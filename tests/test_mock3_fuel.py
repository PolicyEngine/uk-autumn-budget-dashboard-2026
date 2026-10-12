"""MOCK drill 3 measure 1: fuel duty phasing (invented rehearsal Budget).

Schedules are checked month by month; one synthetic household is worked by
hand. Engine: policyengine-uk 2.125.1. Calendar-year basis throughout.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.mock_drill3_fuel import (
    _create_mock3_fuel_duty_phasing,
    _mock3_fuel_baseline_rate,
    _mock3_fuel_reform_rate,
    _mock3_fuel_schedule,
    mock3_fuel_household_fiscal_change,
)
from uk_budget_data.reforms import FUEL_DUTY_PATH


@pytest.mark.parametrize(
    "year, month, baseline, reform",
    [
        (2026, 12, 0.5295, 0.5295),
        (2027, 1, 0.5595, 0.5295),
        (2027, 3, 0.5795, 0.5295),
        (2027, 4, 0.5992, 0.5595),
        (2027, 9, 0.5992, 0.5595),
        (2027, 10, 0.5992, 0.5795),
        (2028, 3, 0.5992, 0.5795),
        (2028, 4, 0.6178, 0.5975),
        (2029, 4, 0.6357, 0.6148),
        (2030, 4, 0.6535, 0.6320),
        (2031, 4, 0.6718, 0.6497),
        (2031, 12, 0.6718, 0.6497),
    ],
)
def test_schedule_months(year, month, baseline, reform):
    assert _mock3_fuel_baseline_rate(year, month) == baseline
    assert _mock3_fuel_reform_rate(year, month) == reform


@pytest.mark.parametrize(
    "year, month, gap_pence",
    [
        (2026, 12, 0.00),
        (2027, 1, 3.00),
        (2027, 2, 3.00),
        (2027, 3, 5.00),
        (2027, 4, 3.97),
        (2027, 9, 3.97),
        (2027, 10, 1.97),
        (2028, 3, 1.97),
        (2028, 4, 2.03),
        (2029, 3, 2.03),
        (2029, 4, 2.09),
        (2030, 4, 2.15),
        (2031, 4, 2.21),
        (2031, 12, 2.21),
    ],
)
def test_annex_a_duty_gaps(year, month, gap_pence):
    gap = _mock3_fuel_baseline_rate(year, month) - _mock3_fuel_reform_rate(
        year, month
    )
    assert gap * 100 == pytest.approx(gap_pence, abs=1e-9)


def test_household_fiscal_change_2027_28():
    # (6 x 3.97 + 6 x 1.97) x 1000/12 / 100 x 1.2 = £35.64
    assert mock3_fuel_household_fiscal_change(1_000, 2027) == pytest.approx(
        35.64, abs=0.005
    )


def test_household_fiscal_change_2026_27():
    # (2 x 3.00 + 5.00) x 1000/12 / 100 x 1.2 = £11.00
    assert mock3_fuel_household_fiscal_change(1_000, 2026) == pytest.approx(
        11.00, abs=0.005
    )


def test_schedules_cover_every_month_of_policy_years():
    schedule = _mock3_fuel_schedule(_mock3_fuel_reform_rate)
    assert len(schedule) == 6 * 12
    assert "2026-01-01.2026-01-31" in schedule
    assert "2031-12-01.2031-12-31" in schedule
    reform = _create_mock3_fuel_duty_phasing()
    assert reform.id == "mock3_fuel_duty_phasing"
    assert reform.description.startswith("MOCK.")
    assert set(reform.parameter_changes) == {FUEL_DUTY_PATH}
    assert set(reform.baseline_parameter_changes) == {FUEL_DUTY_PATH}


def _change(situation, year, variable):
    reform = _create_mock3_fuel_duty_phasing()
    baseline = Simulation(
        situation=situation, scenario=reform.to_drill_scenario(baseline=True)
    )
    reformed = Simulation(
        situation=situation, scenario=reform.to_drill_scenario()
    )
    return float(
        reformed.calculate(variable, year)[0]
        - baseline.calculate(variable, year)[0]
    )


def test_household_1000_litres_2027():
    # 1,000 litres of petrol in calendar 2027, spread evenly (1000/12 a month).
    # Monthly gaps 2027: 2 x 3.00 + 5.00 + 6 x 3.97 + 3 x 1.97 = 40.73p
    # x 1000/12 litres = £33.9417 duty. Pump VAT 20% = £6.7883.
    # VAT-inclusive gain = £40.73.
    year = 2027
    situation = {
        "people": {
            "a": {"age": {year: 40}, "employment_income": {year: 30_000}}
        },
        "benunits": {"b": {"members": ["a"]}},
        "households": {
            "h": {
                "members": ["a"],
                "region": {year: "LONDON"},
                "petrol_litres": {year: 1_000},
            }
        },
    }
    assert _change(situation, year, "fuel_duty") == pytest.approx(
        -33.9417, abs=0.01
    )
    assert _change(situation, year, "vat") == pytest.approx(-6.7883, abs=0.01)
    assert _change(situation, year, "household_net_income") == pytest.approx(
        40.73, abs=0.01
    )
