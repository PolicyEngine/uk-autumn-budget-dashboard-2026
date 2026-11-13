"""Native October forecast and the dashboard's policy comparison.

The installed certified model supplies all economic assumptions on both
sides. ``with_forecast`` retains its public name for existing builders,
but now prepends only the explicit pre-Budget policy rollback. Selected
measures then restore their part of native post-Budget law.

The former numeric forecast overlay stays archived for attribution of
historical outputs. It does not supply values to new simulations.
"""

import json
from functools import lru_cache
from importlib.metadata import version
from importlib.resources import files
from typing import Optional

from policyengine_uk.utils.scenario import Scenario

FORECAST_FILE = "obr_october_2026.json"
OBR = "gov.economic_assumptions.yoy_growth.obr."
FUEL_DUTY = "gov.hmrc.fuel_duty.petrol_and_diesel"
FUEL_DUTY_STATUTORY = ("2027-03-01", 0.5795)
FORECAST_YEARS = range(2026, 2032)

# Readback contract for the outlook and its historical comparison. These
# paths name native model inputs; their values never form an override.
NATIVE_FORECAST_PATHS = tuple(
    OBR + name
    for name in (
        "consumer_price_index",
        "rpi",
        "average_earnings",
        "cpih",
        "rent",
        "mortgage_interest",
        "house_prices",
        "per_capita.gdp",
        "per_capita.mixed_income",
        "non_labour_income",
        "per_capita.non_labour_income",
        "social_rent",
        "consumer_price_index_ahc",
        "council_tax.england",
        "council_tax.scotland",
        "council_tax.wales",
    )
) + (
    "gov.economic_assumptions.statutory_uprating_inputs.forecast_gap."
    "cpi_september",
    "gov.economic_assumptions.statutory_uprating_inputs.forecast_gap."
    "awe_total_pay_may_july",
)


@lru_cache(maxsize=None)
def archived_forecast_record() -> dict:
    """The former overlay, for attribution of historical results only."""
    return json.loads(
        files("uk_budget_data.forecast").joinpath(FORECAST_FILE).read_text()
    )


@lru_cache(maxsize=None)
def forecast_parameters():
    """The processed native current-law tree, without policy rollbacks.

    Measure builders need post-Budget law even though their comparison's
    unselected policies start from the explicit pre-Budget baseline.
    """
    from policyengine_uk import CountryTaxBenefitSystem

    return CountryTaxBenefitSystem().parameters


def forecast_parameter_changes() -> dict[str, dict[str, float]]:
    """Read back native inputs using the outlook's existing dated shape.

    The name remains for existing readers. These are observations of the
    installed model, not changes applied by ``forecast_scenario``.
    """
    parameters = forecast_parameters()
    return {
        path: {
            f"{year}-01-01.{year}-12-31": float(
                parameters.get_child(path)(f"{year}-01-01")
            )
            for year in FORECAST_YEARS
        }
        for path in NATIVE_FORECAST_PATHS
    }


def forecast_record() -> dict:
    """Native forecast identity and readback, without overlay attribution."""
    model_version = version("policyengine-uk")
    source = (
        f"policyengine-uk {model_version}: native OBR October 2026 inputs "
        "and the model's documented derived and carried series"
    )
    return {
        "vintage": "OBR EFO October 2026",
        "source": source,
        "source_url": "https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/",
        "model_version": model_version,
        "mode": "native",
        "applies_to": (
            "Both policy sides use the installed model's economic assumptions "
            "without a dashboard forecast override."
        ),
        "parameter_changes": {
            path: {"source": f"{source}; {path}", "values": values}
            for path, values in forecast_parameter_changes().items()
        },
    }


def forecast_rpi(year: int) -> float:
    """Calendar-year RPI growth from the installed native forecast."""
    return float(forecast_parameters().get_child(OBR + "rpi")(f"{year}-01-01"))


def fuel_duty_rpi_steps() -> tuple:
    """The actual pre-Budget April fuel schedule for legacy readers.

    This comes from the frozen pre-Budget policy snapshot, not the former
    dashboard convention of taking 60.59p in April 2027.
    """
    from uk_budget_data.budget_policy import pre_budget_policy_timeline

    return tuple(
        (day, rate)
        for day, rate in pre_budget_policy_timeline(FUEL_DUTY).items()
        if day.endswith("-04-01")
    )


def forecast_scenario() -> Scenario:
    """Native economic assumptions alone: no parameter overrides."""
    return Scenario(parameter_changes={}, applied_before_data_load=True)


def with_forecast(scenario: Optional[Scenario]) -> Scenario:
    """Apply a selected policy on the explicit pre-Budget comparison.

    Both sides retain native economic assumptions. The rollback applies
    before data loading; a selected measure takes precedence over it,
    while each modifier retains the timing declared by its scenario.
    """
    from uk_budget_data.budget_policy import pre_budget_policy_changes
    from uk_budget_data.publication.phase_recipe import bound_native_scenario

    # Only the genuine public live-bound type can carry an already-resolved
    # comparison. It executes its own checked adapter; adding rollback again
    # would change the plan that its receipt binds.
    ordered = bound_native_scenario(scenario)
    if ordered is not None:
        return ordered

    baseline = Scenario(
        parameter_changes=pre_budget_policy_changes(),
        applied_before_data_load=True,
    )
    if scenario is None:
        return baseline
    combined = baseline + scenario
    before, after = combined.parts_by_data_load()
    # A sum without a late modifier has one actual phase. Return that
    # phase rather than its aggregate mixed-timing flag.
    return before if after is None else combined
