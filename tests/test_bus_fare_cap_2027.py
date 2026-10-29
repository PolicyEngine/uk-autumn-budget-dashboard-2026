"""The £2 bus fare cap (``bus_fare_cap_2027``).

The saving is policyengine-uk's own fare model run twice: bus fares with
the single fare cap held at £3 from 1 January to 31 December 2027, less
current law's (£2 then). Each case checks the credit to household net
income against the engine's own difference in ``bus_fare_spending``
between a simulation with that £3 cap set as a parameter and current law.
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

YEARS = ("2025", "2026", "2027", "2028")
PENNY = 0.01
THREE_POUNDS = {"gov.dft.bus.fares.cap": {"2027-01-01.2027-12-31": 3}}


def _household(region, other_trips=300, london_trips=0, pass_holder=False):
    return {
        "people": {
            "adult": {
                "age": {"2026": 35},
                "bus_pass_eligible": {y: pass_holder for y in YEARS},
                "other_local_bus_trips": {y: other_trips for y in YEARS},
                "bus_in_london_trips": {y: london_trips for y in YEARS},
            }
        },
        "benunits": {"b": {"members": ["adult"]}},
        "households": {
            "h": {"members": ["adult"], "region": {y: region for y in YEARS}}
        },
    }


def _gain_and_engine(situation, year):
    baseline = Simulation(situation=situation)
    reformed = Simulation(
        situation=situation,
        scenario=Scenario(simulation_modifier=bus_fare_cap_2027),
    )
    three = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=THREE_POUNDS)
    )
    gain = float(
        reformed.calculate("household_net_income", year)[0]
        - baseline.calculate("household_net_income", year)[0]
    )
    engine = float(
        three.calculate("bus_fare_spending", year)[0]
        - baseline.calculate("bus_fare_spending", year)[0]
    )
    return gain, engine


def test_the_defaults_are_the_counterfactual_cap_and_its_dates():
    defaults = {
        name: parameter.default
        for name, parameter in inspect.signature(
            bus_fare_cap_2027
        ).parameters.items()
        if name != "sim"
    }
    assert defaults == {
        "counterfactual_cap": 3,
        "cap_from": "2027-01-01",
        "cap_to": "2027-12-31",
    }


@pytest.mark.parametrize("year", [2026, 2027])
def test_in_the_north_west_the_credit_is_the_engines_three_against_two(year):
    gain, engine = _gain_and_engine(_household("NORTH_WEST"), year)
    assert engine > 1
    assert gain == pytest.approx(engine, abs=PENNY)


@pytest.mark.parametrize("year", [2025, 2028])
def test_nothing_outside_calendar_2027(year):
    gain, engine = _gain_and_engine(_household("NORTH_WEST"), year)
    assert gain == pytest.approx(0, abs=PENNY)
    assert engine == pytest.approx(0, abs=PENNY)


@pytest.mark.parametrize(
    "region, situation",
    [
        ("LONDON", _household("LONDON", other_trips=0, london_trips=300)),
        ("WALES", _household("WALES")),
        ("SCOTLAND", _household("SCOTLAND")),
    ],
)
def test_london_wales_and_scotland_get_nothing(region, situation):
    for year in (2026, 2027):
        gain, _ = _gain_and_engine(situation, year)
        assert gain == pytest.approx(0, abs=PENNY), (region, year)


def test_a_bus_pass_holder_saves_nothing():
    gain, _ = _gain_and_engine(
        _household("NORTH_WEST", pass_holder=True), 2027
    )
    assert gain == pytest.approx(0, abs=PENNY)


def test_it_is_registered_in_the_package():
    measure = get_reform(BUS_FARE_CAP_ID)
    assert measure.simulation_modifier is bus_fare_cap_2027
    assert not measure.parameter_changes
    assert not measure.has_custom_baseline()
    assert BUS_FARE_CAP_ID in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
