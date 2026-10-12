"""MOCK drill 3 measure 5: employer NI relief for employees aged under 22.

Invented for a PolicyEngine rehearsal (MOCK DATA). Hand-checked against the
native 2027 parameters of policyengine-uk 2.125.1:
  employer rate          15%
  Secondary Threshold    96.153846 x 52 = £5,000.00 (stored as 5,000 / 52)
  Upper Earnings Limit   966.73 x 52   = £50,269.96
The engine has no under-21 relief, so the reform's only effect is on
employees aged exactly 21.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.mock_drill3_employer_ni import (
    _create_mock3_employer_ni_under_22,
)

YEAR = 2027
RATE = 0.15
ST = 5_000.0
UEL = 50_269.96  # engine native UEL (relief uses Annex A UST 50,270)


def _situation(age, employment_income, year=YEAR):
    return {
        "people": {
            "a": {
                "age": {year: age},
                "employment_income": {year: employment_income},
            }
        },
        "benunits": {"b": {"members": ["a"]}},
        "households": {"h": {"members": ["a"], "region": {year: "LONDON"}}},
    }


def _change(age, employment_income, variable, year=YEAR):
    reform = _create_mock3_employer_ni_under_22()
    situation = _situation(age, employment_income, year)
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


def test_reform_metadata():
    reform = _create_mock3_employer_ni_under_22()
    assert reform.id == "mock3_employer_ni_under_22"
    assert reform.description.startswith("MOCK.")
    assert reform.parameter_changes is None
    assert not reform.has_custom_baseline()


def test_native_2027_parameters():
    class_1 = system.parameters(
        f"{YEAR}-04-30"
    ).gov.hmrc.national_insurance.class_1
    assert class_1.rates.employer == RATE
    assert class_1.thresholds.secondary_threshold * 52 == pytest.approx(
        ST, abs=0.01
    )
    assert class_1.thresholds.upper_earnings_limit * 52 == pytest.approx(
        UEL, abs=0.01
    )


def test_age_21_on_30k():
    # 15% x (30,000 - 5,000) = £3,750 of employer NI removed.
    assert _change(21, 30_000, "ni_employer") == pytest.approx(
        -RATE * (30_000 - ST), abs=0.01
    )
    assert _change(21, 30_000, "ni_employer") == pytest.approx(-3_750, abs=0.01)


def test_age_21_above_uel():
    # Relief stops at the Annex A UST: 15% x (50,270 - 5,000) = £6,790.50.
    # Above the UEL the 15% still applies: baseline 15% x 55,000 = £8,250,
    # reform 15% x (60,000 - 50,269.96) = £1,459.51.
    assert _change(21, 60_000, "ni_employer") == pytest.approx(
        -RATE * (UEL - ST), abs=0.01
    )
    assert _change(21, 60_000, "ni_employer") == pytest.approx(
        -6_790.50, abs=0.01
    )


def test_age_21_below_secondary_threshold():
    assert _change(21, 4_000, "ni_employer") == 0


@pytest.mark.parametrize("age", [22, 20])
def test_other_ages_unchanged(age):
    # 22: outside the measure. 20: already relieved in law; the engine
    # charges them in both baseline and reform, so the change is £0.
    assert _change(age, 30_000, "ni_employer") == 0


def test_no_change_before_april_2027():
    assert _change(21, 30_000, "ni_employer", year=2026) == 0


def test_household_incidence_age_21():
    # The engine's pass-through (employer_ni_fixed_employer_cost_change)
    # fires only on changes to the employer rate, Secondary Threshold or
    # pension-contribution exemption parameters. This measure sets
    # ni_class_1_employer directly, so pay and household net income are
    # unchanged; employer cost and government revenue fall by the full £3,750.
    assert _change(21, 30_000, "employment_income") == 0
    assert _change(21, 30_000, "household_net_income") == 0
    assert _change(21, 30_000, "employer_cost") == pytest.approx(
        -3_750, abs=0.01
    )
    assert _change(21, 30_000, "gov_tax") == pytest.approx(-3_750, abs=0.01)
