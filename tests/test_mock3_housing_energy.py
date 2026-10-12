"""MOCK drill 3: hand-checked households for the LHA and WHD measures.

Invented measures for a PolicyEngine rehearsal (policyengine-uk 2.125.1).
"""

import numpy as np
import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.lha import published_rates

from uk_budget_data.mock_drill3_housing_energy import (
    LHA_FREEZE_PATH,
    LHA_PERCENTILE_PATH,
    _create_mock3_lha_30th_percentile,
    _create_mock3_whd_top_up,
)
from uk_budget_data.models import Reform

RENT_INDEX = system.parameters.gov.indices.private_rent_index


def _pair(reform, situation, year, variable):
    base = Simulation(
        situation=situation, scenario=reform.to_drill_scenario(baseline=True)
    )
    sim = Simulation(situation=situation, scenario=reform.to_drill_scenario())
    return (
        float(base.calculate(variable, year)[0]),
        float(sim.calculate(variable, year)[0]),
    )


# ---------------------------------------------------------------------------
# #3 LHA
# ---------------------------------------------------------------------------


def _renter(year, brma, region):
    # Single 40-year-old, £8,000 earnings, £15,000 private rent (above any
    # LHA here, so the LHA binds). Under 35 would take the shared rate; at 40
    # with no children the category is B (one bedroom).
    return {
        "people": {"a": {"age": {year: 40}, "employment_income": {year: 8_000}}},
        "benunits": {"b": {"members": ["a"]}},
        "households": {
            "h": {
                "members": ["a"],
                "region": {year: region},
                "brma": {year: brma},
                "rent": {year: 15_000},
                "tenure_type": {year: "RENT_PRIVATELY"},
            }
        },
    }


def test_native_baseline_frozen_at_april_2024_and_30th_percentile():
    lha = system.parameters.gov.dwp.LHA
    assert not lha.freeze("2024")
    for year in range(2025, 2032):
        assert lha.freeze(str(year))
        assert lha.percentile(str(year)) == 0.3


def _uc_percentile_2026(brma):
    # The latest published 30th percentile is the weekly 2026 table; no
    # monthly UC figure is published for it, so the engine converts at
    # 365/7/12 (utils.lha.WEEKLY_TO_MONTHLY).
    rates = published_rates()
    i = rates.brmas.get_loc(brma)
    weekly, year = rates.latest("percentile_30", 2027)
    assert int(year[i, 1]) == 2026
    return float(weekly[i, 1]) * 365 / 7 / 12  # category B


@pytest.mark.parametrize(
    "brma, region, baseline_monthly",
    [
        # April 2024 UC rates, held by the native freeze.
        ("CENTRAL_GREATER_MANCHESTER", "NORTH_WEST", 775.00),
        ("CARDIFF", "WALES", 650.00),
    ],
)
@pytest.mark.parametrize("year", [2027, 2028])
def test_lha_uc_renter(brma, region, baseline_monthly, year):
    # Reform: the latest published 30th-percentile rent (2026 table, Central
    # Greater Manchester B = £207.12 a week x 365/7/12 = £899.99 a month;
    # Cardiff B = £178.36 a week = £775.03 a month) grown by the private rent
    # index to the determination year, rounded to the penny:
    #   2027: 899.99 x 126.786 / 123.3 = £925.43 a month (x12 = £11,105.16)
    #   2028: 899.99 x 129.321 / 123.3 = £943.94 a month (x12 = £11,327.28)
    # Below the national maximum, so it is the rate. UC rises by the same
    # amount (the renter is on the UC taper only through earnings).
    situation = _renter(year, brma, region)
    reform = _create_mock3_lha_30th_percentile()
    base, ref = _pair(reform, situation, year, "uc_LHA_cap")
    assert base == pytest.approx(baseline_monthly * 12, abs=0.01)
    pct = _uc_percentile_2026(brma)
    expected = round(pct * RENT_INDEX(str(year)) / RENT_INDEX("2026"), 2)
    # Cardiff: 2027 £796.93 (x12 = £9,563.16); 2028 £812.86 (£9,754.32).
    assert ref == pytest.approx(expected * 12, abs=0.01)
    if brma == "CENTRAL_GREATER_MANCHESTER":
        assert pct == pytest.approx(899.99, abs=0.01)
        assert ref == pytest.approx(
            {2027: 11_105.16, 2028: 11_327.28}[year], abs=0.01
        )
    uc_base, uc_ref = _pair(reform, situation, year, "universal_credit")
    assert uc_ref - uc_base == pytest.approx(ref - base, abs=0.01)
    hni_base, hni_ref = _pair(reform, situation, year, "household_net_income")
    assert hni_ref - hni_base == pytest.approx(ref - base, abs=0.01)


def test_lha_unchanged_in_2026():
    situation = _renter(2026, "CENTRAL_GREATER_MANCHESTER", "NORTH_WEST")
    base, ref = _pair(
        _create_mock3_lha_30th_percentile(), situation, 2026, "uc_LHA_cap"
    )
    assert base == ref == pytest.approx(9_300.00)


def test_lha_northern_ireland_stays_frozen():
    # Belfast B: frozen at the April 2024 determination under the measure,
    # whereas the parameter change alone (no GB-only modifier) would raise it.
    year = 2027
    situation = _renter(year, "BELFAST", "NORTHERN_IRELAND")
    reform = _create_mock3_lha_30th_percentile()
    base, ref = _pair(reform, situation, year, "uc_LHA_cap")
    assert ref == pytest.approx(base)
    hb_base, hb_ref = _pair(reform, situation, year, "housing_benefit_LHA_rate")
    assert hb_ref == pytest.approx(hb_base)
    parameters_only = Reform(
        id="t",
        name="t",
        description="t",
        parameter_changes={
            LHA_FREEZE_PATH: {"2027": False},
            LHA_PERCENTILE_PATH: {"2027": 0.3},
        },
    )
    _, unrestricted = _pair(parameters_only, situation, year, "uc_LHA_cap")
    assert unrestricted > base + 100


# ---------------------------------------------------------------------------
# #2 WHD top-up
# ---------------------------------------------------------------------------


def _pensioner(year, region):
    # Single 75-year-old, £5,000 new State Pension only: guarantee credit > 0.
    return {
        "people": {
            "p": {
                "age": {year: 75},
                "state_pension_type": {year: "NEW"},
                "state_pension_reported": {year: 5_000},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: region}}},
    }


@pytest.mark.parametrize("year, expected", [(2026, 100), (2027, 100), (2028, 0)])
def test_whd_wales_pension_credit_pensioner(year, expected):
    reform = _create_mock3_whd_top_up()
    situation = _pensioner(year, "WALES")
    sim = Simulation(situation=situation, scenario=reform.to_drill_scenario())
    assert float(sim.calculate("guarantee_credit", year)[0]) > 0
    assert float(sim.calculate("mock3_whd_top_up", year)[0]) == expected
    base, ref = _pair(reform, situation, year, "household_net_income")
    assert ref - base == pytest.approx(expected)
    gs_base, gs_ref = _pair(reform, situation, year, "gov_spending")
    assert gs_ref - gs_base == pytest.approx(expected)
    # Disregarded: Pension Credit unchanged.
    pc_base, pc_ref = _pair(reform, situation, year, "pension_credit")
    assert pc_ref == pytest.approx(pc_base)


def test_whd_scottish_pension_credit_pensioner_gets_nothing():
    year = 2026
    reform = _create_mock3_whd_top_up()
    situation = _pensioner(year, "SCOTLAND")
    sim = Simulation(situation=situation, scenario=reform.to_drill_scenario())
    assert float(sim.calculate("guarantee_credit", year)[0]) > 0
    base, ref = _pair(reform, situation, year, "household_net_income")
    assert ref - base == 0


def test_whd_non_recipient_gets_nothing():
    year = 2026
    situation = {
        "people": {"a": {"age": {year: 40}, "employment_income": {year: 50_000}}},
        "benunits": {"b": {"members": ["a"]}},
        "households": {"h": {"members": ["a"], "region": {year: "WALES"}}},
    }
    reform = _create_mock3_whd_top_up()
    sim = Simulation(situation=situation, scenario=reform.to_drill_scenario())
    assert not np.any(sim.calculate("mock3_whd_top_up_eligible", year))
    base, ref = _pair(reform, situation, year, "household_net_income")
    assert ref - base == 0
