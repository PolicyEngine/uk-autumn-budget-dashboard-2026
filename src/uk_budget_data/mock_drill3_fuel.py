"""MOCK drill 3 measure 1 (rehearsal Budget, 12 October 2026): fuel duty phasing.

MOCK DATA: this implements one invented line of the drill 3 Chancellor's
statement. Not a real Budget.

Statement (12:30): "Fuel duty rises phased. The rises due on 1 January and
1 March will not happen then. Fuel duty stays at 52.95p a litre until the end
of March, rises to 55.95p in April and to 57.95p in October 2027. RPI uprating
resumes in April 2028."

Baseline: the engine's native dated schedule (policyengine-uk 2.125.1,
``petrol_and_diesel.yaml``): 52.95p to 31 Dec 2026, 55.95p from 1 Jan 2027,
57.95p from 1 Mar 2027, then RPI-uprated each 1 April from April 2027.

Reform: 52.95p to 31 Mar 2027, 55.95p from 1 Apr 2027, 57.95p from 1 Oct 2027,
then RPI uprating from 1 Apr 2028. The RPI steps use the engine's own method
(``calculate_fuel_duty_rates.py``): each 1 April multiplies the previous rate
by the previous calendar year's growth in
``gov.economic_assumptions.yoy_growth.obr.rpi`` and rounds half-up to the
nearest 0.01p. ``MOCK3_FUEL_REFORM_SCHEDULE`` holds the literal results;
``_engine_rpi_steps`` recomputes them and a test checks they agree.

Annex A (13:40) applied: ``MOCK3_FUEL_BASELINE_SCHEDULE`` is Annex A's
published baseline (59.92p Apr 2027 ... 67.18p Apr 2031) and
``MOCK3_FUEL_REFORM_SCHEDULE`` holds costing 9's published values (59.75p
Apr 2028 ... 64.97p Apr 2031), replacing the RPI-derived literals.
``_engine_rpi_steps`` is retained for reference only.

Basis: both scenarios carry explicit full-calendar-month rates for every
month of every policy year (2026-2031), so model-year totals are CALENDAR
years with litres spread evenly across months, not the engine's native
fiscal-year blend. Fiscal-year (April-March) scoring needs a conversion,
e.g. FY = 9/12 of calendar year t (Apr-Dec months) + 3/12 of t+1 (Jan-Mar),
or a re-run on fiscal-month schedules.

Duty-only effect = the fuel duty parameter change. VAT-inclusive effect adds
20% pump VAT on the duty change, applied once to ``vat`` (never to
``vat_change``) by ``_mock3_fuel_pump_vat_modifier``.
"""

from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from pathlib import Path

import numpy as np
from policyengine_uk import Simulation

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import Reform
from uk_budget_data.reforms import (
    FUEL_DUTY_PATH,
    _dated_rate,
    _month_range,
    _native_fuel_duty_schedule,
)

MOCK3_YEARS = tuple(POLICY_YEARS)  # 2026-2031
MOCK3_PUMP_VAT_RATE = 0.20

# Baseline dated steps (date, £/litre). None = the engine's native schedule.
# Annex A may replace this with an explicit tuple.
MOCK3_FUEL_BASELINE_SCHEDULE = (
    ("2022-03-23", 0.5295),
    ("2027-01-01", 0.5595),
    ("2027-03-01", 0.5795),
    ("2027-04-01", 0.5992),
    ("2028-04-01", 0.6178),
    ("2029-04-01", 0.6357),
    ("2030-04-01", 0.6535),
    ("2031-04-01", 0.6718),
)  # Annex A published baseline schedule

# Reform dated steps (date, £/litre): Annex A costing 9 published values.
MOCK3_FUEL_REFORM_SCHEDULE = (
    ("2022-03-23", 0.5295),
    ("2027-04-01", 0.5595),
    ("2027-10-01", 0.5795),
    ("2028-04-01", 0.5975),
    ("2029-04-01", 0.6148),
    ("2030-04-01", 0.6320),
    ("2031-04-01", 0.6497),
)
MOCK3_RPI_BASE_DATE = "2027-10-01"  # 57.95p, the rate RPI uprating starts from
MOCK3_RPI_FIRST_YEAR = 2028


@lru_cache(maxsize=1)
def _engine_rpi_growth() -> dict[int, Decimal]:
    """Calendar-year RPI growth from the engine's yoy_growth.yaml."""
    import policyengine_uk
    import yaml

    path = (
        Path(policyengine_uk.__file__).parent
        / "parameters/gov/economic_assumptions/yoy_growth.yaml"
    )
    values = yaml.safe_load(path.read_text())["obr"]["rpi"]["values"]
    return {int(str(d)[:4]): Decimal(str(v)) for d, v in values.items()}


def _engine_rpi_steps(
    start_rate: float, first_year: int, last_year: int
) -> tuple[tuple[str, float], ...]:
    """1 April RPI steps, same rule as the engine's calculate_fuel_duty_rates.py."""
    growth = _engine_rpi_growth()
    rate = Decimal(str(start_rate))
    steps = []
    for year in range(first_year, last_year + 1):
        rate = (rate * (1 + growth[year - 1])).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        steps.append((f"{year}-04-01", float(rate)))
    return tuple(steps)


def _mock3_baseline_schedule():
    if MOCK3_FUEL_BASELINE_SCHEDULE is not None:
        return MOCK3_FUEL_BASELINE_SCHEDULE
    return _native_fuel_duty_schedule()


def _mock3_fuel_baseline_rate(year: int, month: int) -> float:
    return _dated_rate(_mock3_baseline_schedule(), year, month)


def _mock3_fuel_reform_rate(year: int, month: int) -> float:
    return _dated_rate(MOCK3_FUEL_REFORM_SCHEDULE, year, month)


def _mock3_fuel_schedule(rate_for) -> dict[str, float]:
    """Explicit full-calendar-month rates for every month of 2026-2031."""
    return {
        _month_range(year, month): rate_for(year, month)
        for year in MOCK3_YEARS
        for month in range(1, 13)
    }


def _mock3_fuel_duty_saving_per_litre(year: int) -> float:
    """Calendar-year average duty saving per litre (litres spread evenly)."""
    return (
        sum(
            _mock3_fuel_baseline_rate(year, month)
            - _mock3_fuel_reform_rate(year, month)
            for month in range(1, 13)
        )
        / 12
    )


def _mock3_fuel_pump_vat_modifier(sim: Simulation) -> Simulation:
    """Pass the duty change through to the 20% VAT charged at the pump.

    Subtracts 20% x litres x duty saving once from vat (never vat_change).
    """
    for year in MOCK3_YEARS:
        saving = _mock3_fuel_duty_saving_per_litre(year)
        if saving == 0:
            continue
        litres = np.asarray(
            sim.calculate("petrol_litres", period=year)
        ) + np.asarray(sim.calculate("diesel_litres", period=year))
        current_vat = np.asarray(sim.calculate("vat", period=year))
        sim.set_input(
            "vat", year, current_vat - litres * saving * MOCK3_PUMP_VAT_RATE
        )
    return sim


def mock3_fuel_household_fiscal_change(litres: float, fiscal_year: int) -> float:
    """VAT-inclusive change at the pump (£) for fiscal year starting April
    ``fiscal_year``, litres spread evenly across months.

    Sum of monthly (baseline - reform) duty gaps x litres/12 x 1.2.
    Positive = household saves.
    """
    months = [(fiscal_year, m) for m in range(4, 13)] + [
        (fiscal_year + 1, m) for m in range(1, 4)
    ]
    gap = sum(
        _mock3_fuel_baseline_rate(y, m) - _mock3_fuel_reform_rate(y, m)
        for y, m in months
    )
    return gap * litres / 12 * (1 + MOCK3_PUMP_VAT_RATE)


def _create_mock3_fuel_duty_phasing() -> Reform:
    """Mock 3 measure 1: phase the January and March 2027 fuel duty rises.

    Calendar-month basis for 2026-2031 in both scenarios; the baseline
    months reproduce the engine's native dated schedule unless
    MOCK3_FUEL_BASELINE_SCHEDULE is set. Duty-only = parameter change;
    VAT-inclusive adds the pump-VAT modifier.
    """
    return Reform(
        id="mock3_fuel_duty_phasing",
        name="Fuel duty rises phased",
        description=(
            "MOCK. The fuel duty rises due on 1 January 2027 (to 55.95p) and "
            "1 March 2027 (to 57.95p) do not happen then: main rates stay at "
            "52.95p per litre until 31 March 2027, rise to 55.95p on 1 April "
            "2027 and to 57.95p on 1 October 2027, and RPI uprating resumes "
            "in April 2028. Baseline: Annex A (55.95p "
            "Jan 2027, 57.95p Mar 2027, 59.92p Apr 2027, then 61.78p, "
            "63.57p, 65.35p, 67.18p each April 2028-2031). Calendar-year basis; includes 20% VAT on the duty change."
        ),
        baseline_parameter_changes={
            FUEL_DUTY_PATH: _mock3_fuel_schedule(_mock3_fuel_baseline_rate)
        },
        parameter_changes={
            FUEL_DUTY_PATH: _mock3_fuel_schedule(_mock3_fuel_reform_rate)
        },
        simulation_modifier=_mock3_fuel_pump_vat_modifier,
    )
