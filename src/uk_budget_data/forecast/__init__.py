"""The economic forecast every simulation is built on.

policyengine-uk 2.151.0 ships the OBR's March 2026 forecast. The dashboard
scores the Budget on the OBR's October 2026 forecast instead
(``obr_october_2026.json``): its growth rates go into every simulation the
dashboard builds, the baseline and the reform alike, through
``with_forecast``. A measure's own changes are added on top, so they win
where they overlap (no registered measure changes these paths).

The forecast is a scenario applied before data load, keyed by calendar
year, the route the runbook requires for a macro path, so the dataset's
projected years follow it, and the statutory uprating inputs' forecast
years (September CPI, May-July earnings) follow its calendar-year growth.
"""

import json
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from importlib.resources import files
from typing import Optional

from policyengine_uk.utils.scenario import Scenario

FORECAST_FILE = "obr_october_2026.json"

OBR = "gov.economic_assumptions.yoy_growth.obr."
FUEL_DUTY = "gov.hmrc.fuel_duty.petrol_and_diesel"
# The last statutory rate (Hydrocarbon Oil Duties Act 1979, from 1 March
# 2027), and the 1 April RPI steps after it: each the previous calendar
# year's RPI growth, rounded to the nearest hundredth of a penny, as
# policyengine-uk's calculate_fuel_duty_rates.py writes its March-RPI path.
FUEL_DUTY_STATUTORY = ("2027-03-01", 0.5795)
FUEL_DUTY_RPI_YEARS = range(2027, 2033)
PENNY_HUNDREDTH = Decimal("0.0001")


@lru_cache(maxsize=None)
def forecast_record() -> dict:
    """The forecast file as stored: sources, notes and values."""
    return json.loads(
        files("uk_budget_data.forecast").joinpath(FORECAST_FILE).read_text()
    )


def _stored_changes() -> dict[str, dict[str, float]]:
    return {
        path: dict(entry["values"])
        for path, entry in forecast_record()["parameter_changes"].items()
    }


def forecast_rpi(year: int) -> float:
    """Calendar-year RPI growth in ``year`` on the forecast."""
    return _stored_changes()[OBR + "rpi"][f"{year}-01-01.{year}-12-31"]


def fuel_duty_rpi_steps() -> tuple:
    """Current law's fuel duty rate on each 1 April from 2027, ``(date,
    rate)``: the statutory 57.95p uprated by the forecast's RPI. Both the
    baseline (``forecast_parameter_changes``) and the fuel duty measure
    (``reforms.FUEL_DUTY_CURRENT_LAW``) read it from here."""
    rate = Decimal(str(FUEL_DUTY_STATUTORY[1]))
    steps = []
    for year in FUEL_DUTY_RPI_YEARS:
        growth = Decimal(str(forecast_rpi(year - 1)))
        rate = (rate * (1 + growth)).quantize(
            PENNY_HUNDREDTH, rounding=ROUND_HALF_UP
        )
        steps.append((f"{year}-04-01", float(rate)))
    return tuple(steps)


def forecast_parameter_changes() -> dict[str, dict[str, float]]:
    """``{parameter path: {period: value}}`` for every forecast series.

    The stored growth rates, plus current law's fuel duty RPI path on the
    forecast's RPI: policyengine-uk stores that path as values (computed
    from its March RPI), so editing RPI alone would not move it. Each step
    is keyed by the year it is in force, 1 April to 31 March.
    """
    changes = _stored_changes()
    changes[FUEL_DUTY] = {
        f"{day}.{int(day[:4]) + 1}-03-31": rate
        for day, rate in fuel_duty_rpi_steps()
    }
    return changes


def forecast_scenario() -> Scenario:
    """The forecast on its own: a scenario applied before data load."""
    return Scenario(
        parameter_changes=forecast_parameter_changes(),
        applied_before_data_load=True,
    )


@lru_cache(maxsize=None)
def forecast_parameters():
    """The processed parameter tree on the forecast, for code that reads
    current law's values to write a measure (in place of
    ``policyengine_uk.system.system``, which holds the March forecast)."""
    from policyengine_uk import Simulation

    situation = {
        "people": {"p": {}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    return Simulation(
        situation=situation, scenario=forecast_scenario()
    ).tax_benefit_system.parameters


def with_forecast(scenario: Optional[Scenario]) -> Scenario:
    """``scenario`` on the forecast: what every simulation is built with.

    None (current law) becomes the forecast alone. Otherwise the forecast
    plus the scenario: its parameter changes are merged with the
    scenario's taking precedence, all applied before data load, and the
    scenario's modifier runs at its own time (``Scenario.__add__``).
    """
    if scenario is None:
        return forecast_scenario()
    return forecast_scenario() + scenario
