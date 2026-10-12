"""MOCK drill 3: hand-checked households for parameter measures #7, #9, #12, #13.

Every measure is invented for a PolicyEngine rehearsal. Reforms are built by
calling the create functions directly (not yet registered). Expected values
are worked by hand from the statement and the engine's native parameters
(policyengine-uk 2.125.1).
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.mock_drill3_params import (
    _create_mock3_additional_rate_threshold,
    _create_mock3_class4_main_rate,
    _create_mock3_salary_sacrifice_cap,
    _create_mock3_threshold_freeze_2032,
)

PARAMS = system.parameters


def _household(year, person=None):
    return {
        "people": {"a": {"age": {year: 40}, **(person or {})}},
        "benunits": {"b": {"members": ["a"]}},
        "households": {"h": {"members": ["a"], "region": {year: "LONDON"}}},
    }


def _change(reform, situation, year, variable):
    baseline = Simulation(
        situation=situation, scenario=reform.to_drill_scenario(baseline=True)
    )
    reformed = Simulation(
        situation=situation, scenario=reform.to_drill_scenario()
    )
    return float(
        reformed.calculate(variable, year).sum()
        - baseline.calculate(variable, year).sum()
    )


def test_ids_and_descriptions():
    ids = {
        _create_mock3_additional_rate_threshold().id: "#7",
        _create_mock3_salary_sacrifice_cap().id: "#9",
        _create_mock3_threshold_freeze_2032().id: "#12",
        _create_mock3_class4_main_rate().id: "#13",
    }
    assert set(ids) == {
        "mock3_additional_rate_threshold",
        "mock3_salary_sacrifice_cap",
        "mock3_threshold_freeze_2032",
        "mock3_class4_main_rate",
    }
    for create in (
        _create_mock3_additional_rate_threshold,
        _create_mock3_salary_sacrifice_cap,
        _create_mock3_threshold_freeze_2032,
        _create_mock3_class4_main_rate,
    ):
        assert create().description.startswith("MOCK.")


# --- #7 additional rate threshold ------------------------------------------


@pytest.mark.parametrize(
    "year, income, expected",
    [
        # 2026-27: measure not yet in force.
        (2026, 110_000, 0.0),
        # Annex A: threshold is £100,000 of TAXABLE income.
        # £100,000 salary: PA 12,570, taxable 87,430 < 100,000 -> no change.
        (2027, 100_000, 0.0),
        # £110,000: PA = 12,570 - 0.5 x 10,000 = 7,570; taxable 102,430.
        #   Extra 5p on 102,430 - 100,000 = 2,430 -> +£121.50.
        (2027, 110_000, 121.50),
        # £150,000: PA nil, taxable 150,000. Extra 5p on
        #   min(150,000, 125,140) - 100,000 = 25,140 -> +£1,257.00.
        (2027, 150_000, 1_257.00),
        (2031, 150_000, 1_257.00),
    ],
)
def test_additional_rate_threshold(year, income, expected):
    reform = _create_mock3_additional_rate_threshold()
    situation = _household(year, {"employment_income": {year: income}})
    assert _change(reform, situation, year, "income_tax") == pytest.approx(
        expected, abs=0.01
    )
    assert _change(
        reform, situation, year, "household_net_income"
    ) == pytest.approx(-expected, abs=0.01)


def test_additional_rate_threshold_dividends():
    # £150,000 of dividends only (2027): PA nil. Dividend allowance £500 sits
    # in the top band in both cases. Extra (39.35% - 35.75%) = 3.6p on the
    # dividends between taxable 100,000 and 125,140 = 25,140 -> +905.04.
    year = 2027
    reform = _create_mock3_additional_rate_threshold()
    situation = _household(year, {"dividend_income": {year: 150_000}})
    assert _change(reform, situation, year, "income_tax") == pytest.approx(
        905.04, abs=0.01
    )


# --- #9 salary sacrifice cap -----------------------------------------------


@pytest.mark.parametrize(
    "year, sacrifice, expected_ni",
    [
        # Before 6 April 2029: measure not in force.
        (2028, 3_000, 0.0),
        # £40,000 salary (below UEL), £3,000 sacrifice. Excess over the cap
        #   rises from 1,000 to 2,000; the extra 1,000 bears 8% employee NI
        #   -> +£80. It is redirected to a relieved employee contribution, so
        #   income tax is unchanged.
        (2029, 3_000, 80.0),
        (2031, 3_000, 80.0),
        # £1,500 sacrifice: excess goes 0 -> 500 -> 8% x 500 = +£40.
        (2029, 1_500, 40.0),
        # £1,000 sacrifice: at the new cap -> no change.
        (2029, 1_000, 0.0),
    ],
)
def test_salary_sacrifice_cap(year, sacrifice, expected_ni):
    reform = _create_mock3_salary_sacrifice_cap()
    situation = _household(
        year,
        {
            "employment_income": {year: 40_000},
            "pension_contributions_via_salary_sacrifice": {year: sacrifice},
        },
    )
    assert _change(
        reform, situation, year, "ni_class_1_employee"
    ) == pytest.approx(expected_ni, abs=0.01)
    assert _change(reform, situation, year, "income_tax") == pytest.approx(
        0.0, abs=0.01
    )
    # Employer side: 15% x the extra excess (1,000 -> £150; 500 -> £75).
    assert _change(
        reform, situation, year, "salary_sacrifice_pension_ni_employer"
    ) == pytest.approx(expected_ni / 0.08 * 0.15, abs=0.01)


# --- #12 threshold freeze to April 2032 ------------------------------------


def _native_2031():
    y = "2031"
    p = PARAMS.gov.hmrc
    return {
        "pa": p.income_tax.allowances.personal_allowance.amount(y),
        "band": p.income_tax.rates.uk.brackets[1].threshold(y),
        "pt": p.national_insurance.class_1.thresholds.primary_threshold(y)
        * 52,
        "uel": p.national_insurance.class_1.thresholds.upper_earnings_limit(y)
        * 52,
    }


def test_native_2031_values_are_uprated():
    # Engine CPI-uprates from 2031-32: PA 12,821.41, band 38,454.01,
    # PT 246.56 x 52 = 12,821.37, UEL 986.07 x 52 = 51,275.39.
    n = _native_2031()
    assert n["pa"] == pytest.approx(12_821.41, abs=0.01)
    assert n["band"] == pytest.approx(38_454.01, abs=0.01)
    assert n["pt"] == pytest.approx(12_821.37, abs=0.01)
    assert n["uel"] == pytest.approx(51_275.39, abs=0.01)


# Annex A baseline in 2031-32 (pinned): PA 12,830, BRL 38,500, PT 12,830,
# UEL 51,330. Reform: 12,570 / 37,700 / 12,570 / 50,270.
# The native £2,000 salary-sacrifice cap (from 2029) switches on the
# broad-base haircut in both scenarios of this measure: employment income is
# cut by 0.16%. £30,000 -> £29,952; £60,000 -> £59,904.


def test_threshold_freeze_30k():
    # £29,952 after the haircut, 2031-32.
    #   Income tax: PA 12,830 -> 12,570, +260 taxable at 20% -> +£52.00.
    #   Employee NI: PT 12,830 -> 12,570 at 8% -> +£20.80.
    #   Net income: -£72.80.
    reform = _create_mock3_threshold_freeze_2032()
    year = 2031
    situation = _household(year, {"employment_income": {year: 30_000}})
    assert _change(reform, situation, year, "income_tax") == pytest.approx(
        52.00, abs=0.05
    )
    assert _change(
        reform, situation, year, "ni_class_1_employee"
    ) == pytest.approx(20.80, abs=0.05)
    assert _change(
        reform, situation, year, "household_net_income"
    ) == pytest.approx(-72.80, abs=0.1)
    # 2030-31 unaffected.
    s2030 = _household(2030, {"employment_income": {2030: 30_000}})
    assert _change(reform, s2030, 2030, "household_net_income") == 0


def test_threshold_freeze_60k():
    # £59,904 after the haircut, 2031-32.
    #   Baseline tax: taxable 59,904 - 12,830 = 47,074;
    #     0.2 x 38,500 + 0.4 x 8,574 = 7,700 + 3,429.60 = 11,129.60.
    #   Reform tax: taxable 47,334; 0.2 x 37,700 + 0.4 x 9,634 = 11,393.60.
    #   Change = +£264.00.
    #   Employee NI: PT leg +8% x 260 = +20.80; UEL leg moves 1,060 from 8%
    #     to 2%: -63.60. Net -£42.80.
    #   Net income change = -(264.00 - 42.80) = -£221.20.
    year = 2031
    reform = _create_mock3_threshold_freeze_2032()
    situation = _household(year, {"employment_income": {year: 60_000}})
    assert _change(reform, situation, year, "income_tax") == pytest.approx(
        264.00, abs=0.05
    )
    assert _change(
        reform, situation, year, "ni_class_1_employee"
    ) == pytest.approx(-42.80, abs=0.05)
    assert _change(
        reform, situation, year, "household_net_income"
    ) == pytest.approx(-221.20, abs=0.1)


def test_threshold_freeze_class4_and_dividends():
    # 2031-32 Class 4: £30,000 profit. LPL 12,830 -> 12,570 at 6% -> +£15.60.
    year = 2031
    reform = _create_mock3_threshold_freeze_2032()
    se = _household(year, {"self_employment_income": {year: 30_000}})
    assert _change(reform, se, year, "ni_class_4") == pytest.approx(
        15.60, abs=0.05
    )
    # £60,000 dividends only: PA 12,830 -> 12,570 and dividend BRL
    # 38,500 -> 37,700 (pinned; the engine does not uprate it natively).
    #   Baseline: taxable 47,170; allowance £500 in band. Basic band 38,500:
    #     10.75% x (38,500 - 500) + 35.75% x 8,670 = 4,085 + 3,099.53
    #     = 7,184.53.
    #   Reform: taxable 47,430; 10.75% x 37,200 + 35.75% x 9,730
    #     = 3,999 + 3,478.48 = 7,477.48. Change +£292.95.
    dv = _household(year, {"dividend_income": {year: 60_000}})
    assert _change(reform, dv, year, "income_tax") == pytest.approx(
        292.95, abs=0.05
    )


def test_threshold_freeze_annex_a_baseline_pins_2026_2030():
    # Annex A 2026-31: PT/UEL exactly 12,570 / 50,270 a year (engine native is
    # 241.73 / 966.73 a week = 12,569.96 / 50,269.96).
    bp = _create_mock3_threshold_freeze_2032().baseline_parameter_changes
    for y in map(str, range(2026, 2031)):
        assert bp[
            "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold"
        ][y] * 52 == pytest.approx(12_570, abs=1e-9)
        assert bp[
            "gov.hmrc.national_insurance.class_1.thresholds."
            "upper_earnings_limit"
        ][y] * 52 == pytest.approx(50_270, abs=1e-9)


# --- #13 Class 4 main rate -------------------------------------------------


@pytest.mark.parametrize(
    "year, profit, expected",
    [
        (2026, 30_000, 0.0),  # not yet in force
        (2027, 12_000, 0.0),  # below LPL 12,570
        # 1% x (30,000 - 12,570) = +£174.30.
        (2027, 30_000, 174.30),
        # Above UPL: 1% x (50,270 - 12,570) = +£377.00.
        (2027, 80_000, 377.00),
        (2030, 30_000, 174.30),
    ],
)
def test_class4_main_rate(year, profit, expected):
    reform = _create_mock3_class4_main_rate()
    situation = _household(year, {"self_employment_income": {year: profit}})
    assert _change(reform, situation, year, "ni_class_4") == pytest.approx(
        expected, abs=0.01
    )
