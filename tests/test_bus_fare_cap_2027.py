"""The £2 bus fare cap (``bus_fare_cap_2027``).

Hand-computed single households. Each supplies its household
``bus_fare_spending`` and no journeys, so policyengine-uk prices nothing
itself: the household's fare spending is the supplied amount in every
year. The credit is that spending x 12.5% (PolicyEngine/bus-fare-cap's
``FARE_CAP_REDUCTION_CENTRAL``, £3 to £2) x the share of the fiscal year
the cap runs: a quarter of 2026-27 (January to March 2027) and three
quarters of 2027-28 (April to December 2027).
"""

import inspect

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    bus_fare_cap_2027,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    BUS_FARE_CAP_ID,
    get_reform,
)

SPENDING = 400.0
YEARS = (2025, 2026, 2027, 2028)
PENNY = 0.01


def _household(region, spending=SPENDING):
    return {
        "people": {"adult": {"age": {2026: 35}}},
        "benunits": {"b": {"members": ["adult"]}},
        "households": {
            "h": {
                "members": ["adult"],
                "region": {year: region for year in YEARS},
                "bus_fare_spending": {year: spending for year in YEARS},
            }
        },
    }


def _gain(region, year, spending=SPENDING):
    situation = _household(region, spending)
    baseline = Simulation(situation=situation)
    reformed = Simulation(
        situation=situation,
        scenario=Scenario(simulation_modifier=bus_fare_cap_2027),
    )
    return float(
        reformed.calculate("household_net_income", year)[0]
        - baseline.calculate("household_net_income", year)[0]
    )


def test_the_defaults_are_the_sources_fraction_and_the_months():
    defaults = {
        name: parameter.default
        for name, parameter in inspect.signature(
            bus_fare_cap_2027
        ).parameters.items()
        if name != "sim"
    }
    assert defaults == {
        "reduction": 0.125,
        "share_2026": 0.25,
        "share_2027": 0.75,
        "country": "ENGLAND",
        "excluded_region": "LONDON",
    }


@pytest.mark.parametrize(
    "year, expected",
    [
        (2025, 0.0),
        # January to March 2027: 400 x 0.125 x 3/12
        (2026, 12.5),
        # April to December 2027: 400 x 0.125 x 9/12
        (2027, 37.5),
        (2028, 0.0),
    ],
)
def test_outside_london_the_credit_is_spending_times_the_fraction(
    year, expected
):
    assert _gain("NORTH_WEST", year) == pytest.approx(expected, abs=PENNY)


def test_the_credit_scales_with_spending():
    assert _gain("SOUTH_WEST", 2027, spending=1_000) == pytest.approx(
        1_000 * 0.125 * 0.75, abs=PENNY
    )


@pytest.mark.parametrize("region", ["LONDON", "WALES", "SCOTLAND"])
def test_london_and_the_devolved_nations_get_nothing(region):
    for year in (2026, 2027):
        assert _gain(region, year) == pytest.approx(0, abs=PENNY), (
            region,
            year,
        )


def test_no_fare_spending_no_credit():
    assert _gain("NORTH_EAST", 2027, spending=0) == pytest.approx(0, abs=PENNY)


def test_it_is_registered_in_the_package():
    measure = get_reform(BUS_FARE_CAP_ID)
    assert measure.simulation_modifier is bus_fare_cap_2027
    assert not measure.parameter_changes
    assert not measure.has_custom_baseline()
    assert BUS_FARE_CAP_ID in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
