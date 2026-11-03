"""The £2 bus fare cap (``bus_fare_cap_2027``).

The saving is the Treasury's costing (Table 6.1) shared out across
households by their bus fare spending in England outside London: 10.0% of
spending at £3 fares for the days the cap runs, grossed up from current
law's spending (already at £2): ``spending × step / (1 − step)`` with
``step = 0.10 × share``. Each case sets bus fare spending directly and
checks the credit to household net income against that formula; one case
checks that no data limit is touched.
"""

import inspect

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import data_limits
from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    bus_fare_cap_2027,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    BUS_FARE_CAP_ID,
    get_reform,
)

YEARS = ("2025", "2026", "2027", "2028")
PENNY = 0.01
SPENDING = 500
# 1 January to 5 April 2027 of 2026-27's 365 days; 6 April to 31 December
# 2027 of 2027-28's 366 days
SHARES = {2026: 95 / 365, 2027: 270 / 366}


def _spender(region, spending=SPENDING):
    """One adult with bus fare spending set directly."""
    return {
        "people": {"adult": {"age": {"2026": 35}}},
        "benunits": {"b": {"members": ["adult"]}},
        "households": {
            "h": {
                "members": ["adult"],
                "region": {y: region for y in YEARS},
                "bus_fare_spending": {y: spending for y in YEARS},
            }
        },
    }


def _traveller(region="NORTH_WEST"):
    """One adult whose bus fares the engine prices from journeys (the
    path that reads ``gov.dft.bus``)."""
    return {
        "people": {
            "adult": {
                "age": {"2027": 35},
                "bus_pass_eligible": {"2026": False, "2027": False},
                "other_local_bus_trips": {"2026": 200, "2027": 200},
                "bus_in_london_trips": {"2026": 0, "2027": 0},
            }
        },
        "benunits": {"b": {"members": ["adult"]}},
        "households": {
            "h": {
                "members": ["adult"],
                "region": {"2026": region, "2027": region},
            }
        },
    }


def _gain(situation, year):
    baseline = Simulation(situation=situation)
    reformed = Simulation(
        situation=situation,
        scenario=Scenario(simulation_modifier=bus_fare_cap_2027),
    )
    return float(
        reformed.calculate("household_net_income", year)[0]
        - baseline.calculate("household_net_income", year)[0]
    )


def test_the_defaults_are_the_treasury_share_and_the_capped_days():
    defaults = {
        name: parameter.default
        for name, parameter in inspect.signature(
            bus_fare_cap_2027
        ).parameters.items()
        if name != "sim"
    }
    assert defaults == {
        "fall": 0.10,
        "capped_2026": 95 / 365,
        "capped_2027": 270 / 366,
        "country": "ENGLAND",
        "excluded_region": "LONDON",
    }


def test_the_share_is_the_treasury_costing_over_participation_and_spending():
    # £230m (Table 6.1 row 4, full year) / 0.9 / £2,557m, to 0.1 points
    assert 230 / 0.9 / 2_557 == pytest.approx(0.10, abs=0.0005)


@pytest.mark.parametrize("year", [2026, 2027])
def test_in_the_north_west_the_credit_is_the_grossed_up_share(year):
    step = 0.10 * SHARES[year]
    expected = SPENDING * step / (1 - step)
    assert expected > 1
    assert _gain(_spender("NORTH_WEST"), year) == pytest.approx(
        expected, abs=PENNY
    )


@pytest.mark.parametrize("year", [2025, 2028])
def test_nothing_outside_calendar_2027(year):
    assert _gain(_spender("NORTH_WEST"), year) == pytest.approx(0, abs=PENNY)


@pytest.mark.parametrize(
    "region", ["LONDON", "WALES", "SCOTLAND", "NORTHERN_IRELAND"]
)
def test_london_wales_scotland_and_northern_ireland_get_nothing(region):
    for year in (2026, 2027):
        assert _gain(_spender(region), year) == pytest.approx(0, abs=PENNY), (
            region,
            year,
        )


def _touched(scenario):
    def build(scenario):
        return Simulation(situation=_traveller(), scenario=scenario)

    baseline = data_limits.watched_build(build, None)
    reformed = data_limits.watched_build(build, scenario)
    with data_limits.observing(baseline, reformed) as observation:
        for sim in (baseline, reformed):
            for year in (2026, 2027):
                sim.calculate("epg_subsidy", year)
                sim.calculate("bus_fare_spending", year)
    return data_limits.limits_touched(baseline, reformed, observation)


def test_no_data_limit_is_touched():
    assert _touched(Scenario(simulation_modifier=bus_fare_cap_2027)) == []


def test_the_limit_check_would_see_a_change_to_the_fare_cap():
    # Control: holding the cap at £3 by parameter does touch
    # bus_uncapped_single_fares, so the check above is not vacuous
    touched = _touched(
        Scenario(
            parameter_changes={
                "gov.dft.bus.fares.cap": {"2027-01-01.2027-12-31": 3}
            }
        )
    )
    assert "bus_uncapped_single_fares" in [
        limit.get("key", limit) for limit in touched
    ]


def test_it_is_registered_in_the_package():
    measure = get_reform(BUS_FARE_CAP_ID)
    assert measure.simulation_modifier is bus_fare_cap_2027
    assert not measure.parameter_changes
    assert not measure.has_custom_baseline()
    assert BUS_FARE_CAP_ID in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
