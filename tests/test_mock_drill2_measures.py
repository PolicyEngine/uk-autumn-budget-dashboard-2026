"""MOCK drill 2: one hand-checked synthetic household per parameter measure.

Every measure here is invented for a PolicyEngine rehearsal. Expected values
are worked by hand from the statement and the engine's native parameters
(policyengine-uk 2.120.0); each test shows its arithmetic.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.reforms import (
    _mock2_fuel_baseline_rate,
    _mock2_fuel_reform_rate,
    get_autumn_budget_2026_reforms,
    get_reform,
)

MOCK2_IDS = [
    "mock2_fuel_duty_hold",
    "mock2_electricity_vat_zero",
    "mock2_employer_ni_threshold",
    "mock2_cgt_rates",
    "mock2_hvcts_band",
    "mock2_state_pension_uprating",
]


def _household(year, person=None, household=None):
    return {
        "people": {"a": {"age": {year: 40}, **(person or {})}},
        "benunits": {"b": {"members": ["a"]}},
        "households": {
            "h": {
                "members": ["a"],
                "region": {year: "LONDON"},
                **(household or {}),
            }
        },
    }


def _change(reform_id, situation, year, variable="household_net_income"):
    reform = get_reform(reform_id)
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


def test_mock2_measures_registered_in_one_block():
    ids = [r.id for r in get_autumn_budget_2026_reforms()]
    assert [i for i in ids if i in MOCK2_IDS] == MOCK2_IDS


def test_fuel_schedules_match_annex_a_and_costing():
    # Annex A baseline: 55.95p Jan 2027, 57.95p Mar 2027, 59.92p Apr 2027,
    # then 61.78p, 63.57p, 65.35p each April.
    assert _mock2_fuel_baseline_rate(2027, 1) == 0.5595
    assert _mock2_fuel_baseline_rate(2027, 3) == 0.5795
    assert _mock2_fuel_baseline_rate(2027, 4) == 0.5992
    assert _mock2_fuel_baseline_rate(2028, 4) == 0.6178
    assert _mock2_fuel_baseline_rate(2030, 4) == 0.6535
    # Costing note 1: 52.95p to 31 Aug 2027, 55.95p from 1 Sep 2027 to
    # 31 Mar 2028, then 57.68p, 59.35p, 61.01p each April.
    assert _mock2_fuel_reform_rate(2027, 8) == 0.5295
    assert _mock2_fuel_reform_rate(2027, 9) == 0.5595
    assert _mock2_fuel_reform_rate(2028, 3) == 0.5595
    assert _mock2_fuel_reform_rate(2028, 4) == 0.5768
    assert _mock2_fuel_reform_rate(2029, 4) == 0.5935
    assert _mock2_fuel_reform_rate(2030, 4) == 0.6101


def test_fuel_duty_hold_household_2027():
    # 1,200 litres of petrol a year, spread evenly (100 a month), calendar 2027.
    # Baseline (Annex A): 2 x 55.95p + 57.95p + 9 x 59.92p = 709.13p a month
    #   summed over 12 months of 100 litres = £709.13.
    # Reform: 8 x 52.95p + 4 x 55.95p = 647.40p -> £647.40.
    # Duty-only saving = £61.73. Pump VAT: 20% x £61.73 = £12.346.
    # VAT-inclusive gain = £74.076.
    year = 2027
    situation = _household(
        year,
        {"employment_income": {year: 30_000}},
        {"petrol_litres": {year: 1_200}},
    )
    fuel = "mock2_fuel_duty_hold"
    assert _change(fuel, situation, year, "fuel_duty") == pytest.approx(
        -61.73, abs=0.01
    )
    assert _change(fuel, situation, year, "vat") == pytest.approx(
        -12.346, abs=0.01
    )
    assert _change(fuel, situation, year) == pytest.approx(74.076, abs=0.01)


@pytest.mark.parametrize(
    "year, region, expected",
    [
        # £1,050 electricity bill incl. 5% VAT: VAT = 1,050 x 5/105 = £50.
        (2027, "LONDON", 37.50),  # 9/12 x £50 (April-December 2027)
        (2028, "LONDON", 12.50),  # 3/12 x £50 (January-March 2028)
        (2029, "LONDON", 0.0),
        (2027, "NORTHERN_IRELAND", 0.0),  # GB only
    ],
)
def test_electricity_vat_zero_household(year, region, expected):
    situation = _household(
        year,
        {"employment_income": {year: 30_000}},
        {
            "electricity_consumption": {year: 1_050},
            "gas_consumption": {year: 900},
            "region": {year: region},
        },
    )
    assert _change(
        "mock2_electricity_vat_zero", situation, year
    ) == pytest.approx(expected, abs=0.01)


def test_employer_ni_threshold_household_2027():
    # Annex A baseline ST £5,000 (£5,000/52 a week); reform £5,500.
    # Engine incidence (employee_incidence = 1) holds employer cost fixed:
    #   pay rise = 15% x £500 / 1.15 = £65.217.
    # Employee on £30,000 pays 20% income tax + 8% NI on the rise:
    #   net gain = £65.217 x 0.72 = £46.957.
    year = 2027
    situation = _household(year, {"employment_income": {year: 30_000}})
    reform = "mock2_employer_ni_threshold"
    assert get_reform(reform).parameter_changes[
        "gov.hmrc.national_insurance.class_1.thresholds.secondary_threshold"
    ]["2027"] * 52 == pytest.approx(5_500)
    assert _change(
        reform, situation, year, "employment_income"
    ) == pytest.approx(65.217, abs=0.01)
    assert _change(reform, situation, year) == pytest.approx(46.957, abs=0.01)
    # No change before April 2027.
    situation_2026 = _household(2026, {"employment_income": {2026: 30_000}})
    assert _change(reform, situation_2026, 2026) == 0


def test_cgt_rates_household():
    # £30,000 pay, £20,000 gains. Taxable income 30,000 - 12,570 = 17,430,
    # leaving 37,700 - 17,430 = 20,270 of basic band. Gains after the £3,000
    # AEA = 17,000, all basic rate: 18% = £3,060 -> 20% = £3,400 (-£340).
    situation = _household(
        2027,
        {
            "employment_income": {2027: 30_000},
            "capital_gains": {2027: 20_000},
        },
    )
    assert _change("mock2_cgt_rates", situation, 2027) == pytest.approx(
        -340.0, abs=0.01
    )
    # Higher rate: £80,000 pay uses the basic band; 17,000 x (28% - 24%)
    # = £680.
    situation = _household(
        2027,
        {
            "employment_income": {2027: 80_000},
            "capital_gains": {2027: 20_000},
        },
    )
    assert _change("mock2_cgt_rates", situation, 2027) == pytest.approx(
        -680.0, abs=0.01
    )
    # 2026-27 is untouched: the change starts on 6 April 2027.
    situation = _household(
        2026,
        {
            "employment_income": {2026: 30_000},
            "capital_gains": {2026: 20_000},
        },
    )
    assert _change("mock2_cgt_rates", situation, 2026) == 0


@pytest.mark.parametrize(
    "year, value_2026, expected",
    [
        (2027, 1_750_000, 0.0),  # before April 2028
        # £1.75m in 2026 prices sits in the new band: £1,500.
        (2028, 1_750_000, -1_500.0),
        # 2029: band amount uprated as the native £2,500 band
        # (2,549.9976 / 2,500 x 1,500 = £1,529.9986).
        (2029, 1_750_000, -1_529.9986),
        (2028, 1_499_999, 0.0),  # below the new floor
        (2028, 2_200_000, 0.0),  # existing £2,500 band unchanged
    ],
)
def test_hvcts_band_household(year, value_2026, expected):
    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita
    index = gdp.gdp
    situation = _household(
        year,
        {"employment_income": {year: 30_000}},
        {
            "main_residence_value": {
                year: value_2026 * index(str(year)) / index("2026")
            },
            "tenure_type": {year: "OWNED_OUTRIGHT"},
        },
    )
    assert _change("mock2_hvcts_band", situation, year) == pytest.approx(
        expected, abs=0.01
    )


def _new_state_pension_2030(parameter_changes):
    simulation = Simulation(
        situation=_household(2030),
        scenario=Scenario(parameter_changes=parameter_changes),
    )
    parameters = simulation.tax_benefit_system.parameters
    return (
        parameters.gov.economic_assumptions.yoy_growth.triple_lock(
            "2030-01-01"
        ),
        parameters.gov.dwp.state_pension.new_state_pension.amount("2030"),
    )


def test_state_pension_uprating_annex_a_paths():
    # Annex A triple lock: £268.85 (2029-30) -> £278.00 (2030-31), +3.4%
    # earnings. Reform: 268.85 x 1.025 = £275.57125 in April 2030.
    reform = get_reform("mock2_state_pension_uprating")
    path = "gov.dwp.state_pension.new_state_pension.amount"
    assert reform.baseline_parameter_changes[path]["2030"] == 278.00
    assert reform.parameter_changes[path]["2029"] == 268.85
    assert reform.parameter_changes[path]["2030"] == pytest.approx(275.57125)


def test_state_pension_uprating_full_rate_loss():
    # A full-rate pensioner loses (278.00 - 275.57125) x 52 = £126.295 a year.
    reform = get_reform("mock2_state_pension_uprating")
    path = "gov.dwp.state_pension.new_state_pension.amount"
    loss = (
        reform.baseline_parameter_changes[path]["2030"]
        - reform.parameter_changes[path]["2030"]
    ) * 52
    assert loss == pytest.approx(126.295, abs=0.001)
