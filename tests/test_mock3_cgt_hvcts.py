"""MOCK drill 3: hand-checked households for statement measures #8 and #10.

Every measure here is invented for a PolicyEngine rehearsal. Expected values
are worked by hand from the statement and the engine's native parameters
(policyengine-uk 2.125.1); each test shows its arithmetic. The reforms are
built by calling their create functions directly (not yet registered).
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.mock_drill3_cgt_hvcts import (
    _create_mock3_cgt_higher_rate_aea,
    _create_mock3_hvcts_top_bands,
)


def _household(year, person=None, household=None, region="LONDON"):
    return {
        "people": {"a": {"age": {year: 40}, **(person or {})}},
        "benunits": {"b": {"members": ["a"]}},
        "households": {
            "h": {
                "members": ["a"],
                "region": {year: region},
                **(household or {}),
            }
        },
    }


def _change(reform, situation, year, variable="household_net_income"):
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


def test_ids_and_mock_descriptions():
    cgt = _create_mock3_cgt_higher_rate_aea()
    hvcts = _create_mock3_hvcts_top_bands()
    assert cgt.id == "mock3_cgt_higher_rate_aea"
    assert hvcts.id == "mock3_hvcts_top_bands"
    assert cgt.description.startswith("MOCK.")
    assert hvcts.description.startswith("MOCK.")


def _cgt_situation(year, pay, gains=20_000):
    return _household(
        year,
        {"employment_income": {year: pay}, "capital_gains": {year: gains}},
    )


@pytest.mark.parametrize("year", [2027, 2029, 2031])
def test_cgt_higher_rate_taxpayer(year):
    # £80,000 pay uses up the basic rate band (also in 2031, when the band
    # unfreezes to £38,454 and the PA to £12,821), so all gains are higher
    # rate. Baseline: (20,000 - 3,000 AEA) x 24% = 17,000 x 24% = £4,080.
    # Reform: (20,000 - 2,000 AEA) x 28% = 18,000 x 28% = £5,040.
    # Change -£960 = rate 17,000 x 4% (£680) + AEA 1,000 x 28% (£280).
    reform = _create_mock3_cgt_higher_rate_aea()
    situation = _cgt_situation(year, 80_000)
    assert _change(
        reform, situation, year, "capital_gains_tax"
    ) == pytest.approx(960.0, abs=0.01)
    assert _change(reform, situation, year) == pytest.approx(-960.0, abs=0.01)


def test_cgt_basic_rate_taxpayer_aea_only():
    # £30,000 pay: taxable 30,000 - 12,570 = 17,430, leaving 37,700 - 17,430
    # = 20,270 of basic band, which covers all gains. Basic rate stays 18%:
    # baseline 17,000 x 18% = £3,060, reform 18,000 x 18% = £3,240, -£180.
    reform = _create_mock3_cgt_higher_rate_aea()
    situation = _cgt_situation(2027, 30_000)
    assert _change(reform, situation, 2027) == pytest.approx(-180.0, abs=0.01)


def test_cgt_residential_property_gains():
    # Same £80,000 earner, all £20,000 gains on residential property, which
    # shares the 24% rate and rises to 28% (assumption): -£960 as above.
    reform = _create_mock3_cgt_higher_rate_aea()
    situation = _household(
        2027,
        {
            "employment_income": {2027: 80_000},
            "capital_gains": {2027: 20_000},
            "capital_gains_residential_property": {2027: 20_000},
        },
    )
    assert _change(reform, situation, 2027) == pytest.approx(-960.0, abs=0.01)


def test_cgt_unchanged_in_2026():
    # The change starts on 6 April 2027; 2026-27 is untouched.
    reform = _create_mock3_cgt_higher_rate_aea()
    assert _change(reform, _cgt_situation(2026, 80_000), 2026) == 0


# Native CPI uprating of surcharge amounts relative to 2028, from the
# untouched £2m band: 2029 2,549.99762 / 2,500 = 1.0199990, 2030
# 2,600.99192 / 2,500 = 1.0403968, 2031 2,653.01265 / 2,500 = 1.0612051.
# Native £5m+ band is £7,500 (2028) uprated by the same factor.
@pytest.mark.parametrize(
    "year, value_2026, region, tenure, expected",
    [
        (2027, 6_000_000, "LONDON", "OWNED_OUTRIGHT", 0.0),  # before 2028
        # £6m: £7,500 -> £10,000, -£2,500.
        (2028, 6_000_000, "LONDON", "OWNED_OUTRIGHT", -2_500.0),
        # £12m: £7,500 -> £15,000, -£7,500.
        (2028, 12_000_000, "LONDON", "OWNED_OUTRIGHT", -7_500.0),
        # Boundaries are inclusive like the native thresholds.
        (2028, 5_000_000, "LONDON", "OWNED_OUTRIGHT", -2_500.0),
        (2028, 10_000_000, "LONDON", "OWNED_WITH_MORTGAGE", -7_500.0),
        # 2029: 2,500 x 1.0199990 and 7,500 x 1.0199990.
        (2029, 6_000_000, "LONDON", "OWNED_OUTRIGHT", -2_549.9976),
        (2029, 12_000_000, "LONDON", "OWNED_OUTRIGHT", -7_649.9929),
        # 2031: 2,500 x 1.0612051 and 7,500 x 1.0612051.
        (2031, 6_000_000, "LONDON", "OWNED_OUTRIGHT", -2_653.0127),
        (2031, 12_000_000, "LONDON", "OWNED_OUTRIGHT", -7_959.0380),
        (2028, 4_000_000, "LONDON", "OWNED_OUTRIGHT", 0.0),  # £3.5m band
        (2028, 12_000_000, "WALES", "OWNED_OUTRIGHT", 0.0),  # England only
        (2028, 6_000_000, "LONDON", "RENT_PRIVATELY", 0.0),  # owners only
    ],
)
def test_hvcts_top_bands_household(year, value_2026, region, tenure, expected):
    index = system.parameters.gov.economic_assumptions.indices.obr
    gdp = index.per_capita.gdp
    situation = _household(
        year,
        {"employment_income": {year: 30_000}},
        {
            "main_residence_value": {
                year: value_2026 * gdp(str(year)) / gdp("2026")
            },
            "tenure_type": {year: tenure},
        },
        region=region,
    )
    reform = _create_mock3_hvcts_top_bands()
    assert _change(reform, situation, year) == pytest.approx(
        expected, abs=0.01
    )


def test_hvcts_welsh_home_pays_nothing_in_either_scenario():
    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    situation = _household(
        2028,
        household={
            "main_residence_value": {
                2028: 12_000_000 * gdp("2028") / gdp("2026")
            },
            "tenure_type": {2028: "OWNED_OUTRIGHT"},
        },
        region="WALES",
    )
    reform = _create_mock3_hvcts_top_bands()
    reformed = Simulation(
        situation=situation, scenario=reform.to_drill_scenario()
    )
    assert reformed.calculate("high_value_council_tax_surcharge", 2028)[0] == 0
