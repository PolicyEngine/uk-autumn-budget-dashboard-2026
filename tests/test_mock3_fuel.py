"""MOCK drill 3 measure 1: fuel duty phasing (invented rehearsal Budget).

Schedules are checked month by month; one synthetic household is worked by
hand. Engine: policyengine-uk 2.125.1. Calendar-year basis throughout.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.mock_drill3_fuel import (
    MOCK3_FUEL_REFORM_SCHEDULE,
    MOCK3_RPI_FIRST_YEAR,
    _create_mock3_fuel_duty_phasing,
    _engine_rpi_steps,
    _mock3_fuel_baseline_rate,
    _mock3_fuel_reform_rate,
    _mock3_fuel_schedule,
)
from uk_budget_data.reforms import FUEL_DUTY_PATH


@pytest.mark.parametrize(
    "year, month, baseline, reform",
    [
        (2026, 12, 0.5295, 0.5295),
        (2027, 1, 0.5595, 0.5295),  # native Jan rise does not happen
        (2027, 3, 0.5795, 0.5295),  # native Mar rise does not happen
        (2027, 4, 0.5975, 0.5595),  # native RPI step vs 55.95p
        (2027, 9, 0.5975, 0.5595),
        (2027, 10, 0.5975, 0.5795),  # 57.95p from October 2027
        (2028, 3, 0.5975, 0.5795),
        (2028, 4, 0.6154, 0.5969),  # RPI resumes: 0.5795 x 1.030
        (2029, 4, 0.6326, 0.6136),
        (2030, 4, 0.6509, 0.6314),
        (2031, 4, 0.6659, 0.6459),
        (2031, 12, 0.6659, 0.6459),
    ],
)
def test_schedule_months(year, month, baseline, reform):
    assert _mock3_fuel_baseline_rate(year, month) == baseline
    assert _mock3_fuel_reform_rate(year, month) == reform


def test_reform_rpi_steps_follow_engine_method():
    computed = _engine_rpi_steps(0.5795, MOCK3_RPI_FIRST_YEAR, 2031)
    literal = tuple(
        step for step in MOCK3_FUEL_REFORM_SCHEDULE if step[0] >= "2028"
    )
    assert literal == computed


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
    # Baseline monthly rates: 2 x 55.95p + 57.95p + 9 x 59.75p = 707.60p
    # Reform monthly rates:   3 x 52.95p + 6 x 55.95p + 3 x 57.95p = 668.40p
    # Sum of monthly differences = 39.20p; x 1000/12 litres = £32.6667.
    # Duty-only saving = £32.67. Pump VAT 20% x £32.6667 = £6.5333.
    # VAT-inclusive gain = £39.20.
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
        -32.6667, abs=0.01
    )
    assert _change(situation, year, "vat") == pytest.approx(-6.5333, abs=0.01)
    assert _change(situation, year, "household_net_income") == pytest.approx(
        39.20, abs=0.01
    )
