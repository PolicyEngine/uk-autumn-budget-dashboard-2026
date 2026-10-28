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
from functools import lru_cache
from importlib.resources import files
from typing import Optional

from policyengine_uk.utils.scenario import Scenario

FORECAST_FILE = "obr_october_2026.json"


@lru_cache(maxsize=None)
def forecast_record() -> dict:
    """The forecast file as stored: sources, notes and values."""
    return json.loads(
        files("uk_budget_data.forecast").joinpath(FORECAST_FILE).read_text()
    )


def forecast_parameter_changes() -> dict[str, dict[str, float]]:
    """``{parameter path: {period: value}}`` for every forecast series."""
    return {
        path: dict(entry["values"])
        for path, entry in forecast_record()["parameter_changes"].items()
    }


def forecast_scenario() -> Scenario:
    """The forecast on its own: a scenario applied before data load."""
    return Scenario(
        parameter_changes=forecast_parameter_changes(),
        applied_before_data_load=True,
    )


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
