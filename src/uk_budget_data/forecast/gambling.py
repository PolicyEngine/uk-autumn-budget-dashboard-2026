"""The gambling duty bases on the OBR's October 2026 betting and gaming
forecast, ported from policyengine-uk#2761.

policyengine-uk 2.151.0 and 2.165.1 declare no uprating for their sixteen
gambling inputs, so dataset projection holds each at its 2024-25 cash level
while household weights grow with population: the bases hardly move (Machine
Games Duty's grows 0.7% to 2027-28 against the OBR's 10.9%). #2761 gives each
of the seven betting and gaming duties a base series (each year's receipts
over the rate the model charges, so the model applies its own rate changes
once), and this module grows the bases by it (``gambling_duty_bases.json``).

How. Each duty is linear in its own inputs, and every input of a duty takes
that duty's series, so growing the inputs by a factor grows the duty by the
same factor. The projection therefore wraps each duty's formula and scales
it by ``projection_factor``: the duty's national base index over the
dataset's first year, divided by the installed engine's ``ons.population``
growth over the same years, which already grows the household weights. The
weighted duty then grows with the national base, on 2.151.0's population
path as on 2.165.1's. The inputs themselves are left as stored, so a build
reads none of them (``data_limits.building``). A measure that charges a
gambling input itself (``machine_games_higher_stake_rate``) scales by the
same factor, so it charges the projected base.

Where. Only a simulation built from survey data on an engine without the
series. A simulation built from one household's answers (the Household
calculator) takes the household's amounts as given for the year asked, and
an engine whose gambling inputs declare an uprating (#2761, from
policyengine-uk 2.169.0) projects them itself, so this changes nothing
there (``tests/test_gambling_projection.py`` has the tripwire).
"""

import json
from functools import lru_cache
from importlib.resources import files

from policyengine_uk.utils.data_source import built_from_data

from uk_budget_data.measure_templates import _call_formula, _replace_formula

BASES_FILE = "gambling_duty_bases.json"

# Each duty's variable and the inputs #2761 grows by its series
# (``uprating`` on each input in policyengine_uk/variables/input/
# consumption/gambling/). The higher-stake input arrives in 2.167.0
# (#2731) and takes Machine Games Duty's series.
DUTIES = {
    "remote_gaming": ("remote_gaming_duty", ("remote_gaming_net_losses",)),
    "lottery": ("lottery_duty", ("national_lottery_ticket_spending",)),
    "general_betting": (
        "general_betting_duty",
        (
            "land_based_fixed_odds_betting_net_losses",
            "remote_uk_horseracing_betting_net_losses",
            "remote_other_betting_net_losses",
            "horse_and_dog_pool_betting_net_losses",
            "financial_spread_betting_net_losses",
            "other_spread_betting_net_losses",
            "betting_exchange_commission",
        ),
    ),
    "machine_games": (
        "machine_games_duty",
        (
            "machine_games_lower_rate_net_takings",
            "machine_games_standard_rate_net_takings",
            "machine_games_higher_rate_net_takings",
            "machine_games_standard_rate_higher_stake_net_takings",
        ),
    ),
    "gaming": ("gaming_duty", ("land_based_casino_net_losses",)),
    "bingo": ("bingo_duty", ("bingo_net_receipts",)),
    "pool_betting": ("pool_betting_duty", ("pool_betting_net_receipts",)),
}

POPULATION = "gov.economic_assumptions.indices.ons.population"
# #2761's series in the engine, from policyengine-uk 2.169.0
ENGINE_SERIES = (
    "gov.economic_assumptions.indices.obr.per_capita.gambling_duty_bases"
)


@lru_cache(maxsize=None)
def bases_record() -> dict:
    """The series file as stored: sources, notes and values."""
    return json.loads(
        files("uk_budget_data.forecast").joinpath(BASES_FILE).read_text()
    )


def _years(duty: str) -> list[int]:
    return sorted(int(y) for y in bases_record()["per_person_growth"][duty])


def _within(duty: str, year: int) -> int:
    """``year`` within the series: a later year holds its last, and an
    earlier one its first (2024-25, index 1: the gambling inputs start
    then, and a dataset of an earlier year holds them at that level)."""
    years = _years(duty)
    return max(years[0], min(year, years[-1]))


@lru_cache(maxsize=None)
def per_person_index(duty: str, year: int) -> float:
    """The duty's base per person over its 2024-25 level, as policyengine-uk
    compounds a ``yoy_growth`` series: one step a year, each rounded to five
    decimals (create_economic_assumption_indices)."""
    growth = bases_record()["per_person_growth"][duty]
    index = 1.0
    for y in _years(duty)[1:]:
        if y > _within(duty, year):
            break
        index = round(index * (1 + growth[str(y)]), 5)
    return index


def base_index(duty: str, year: int) -> float:
    """The duty's national base over its 2024-25 level: the per-person
    index times the population growth #2761 divided by."""
    year = _within(duty, year)
    population = bases_record()["population_index"][str(year)]
    return per_person_index(duty, year) * population


def engine_projects_gambling(system) -> bool:
    """Whether the installed engine grows its gambling inputs itself: it
    has #2761's base series, which its gambling inputs are uprated by.

    Asked of the parameter tree, not the inputs: a measure's formula calls
    this, and code naming the gambling inputs would read, to the data
    limits' watch, as reading them (``data_limits._formulas_touched``)."""
    try:
        system.parameters.get_child(ENGINE_SERIES)
    except Exception:
        return False
    return True


def data_first_year(simulation) -> int:
    """The first year the simulation's data hold: the year the stored
    gambling inputs are at, in cash, in every later year."""
    dataset = getattr(simulation, "dataset", None)
    years = getattr(dataset, "years", None)
    if years:
        return int(min(years))
    return int(str(simulation.default_input_period)[:4])


def projects(simulation) -> bool:
    """Whether this simulation's gambling bases are grown here: built from
    survey data, on an engine that does not grow them itself."""
    return built_from_data(simulation) and not engine_projects_gambling(
        simulation.tax_benefit_system
    )


def projection_factor(simulation, duty: str, year: int) -> float:
    """What a stored ``duty`` input in ``year`` is multiplied by: its
    national base's growth from the data's first year, over the engine's
    population growth then, which the household weights already carry.
    1 where ``projects`` is false."""
    if not projects(simulation):
        return 1.0
    first = data_first_year(simulation)
    population = simulation.tax_benefit_system.parameters.get_child(POPULATION)
    weights = population(f"{year}-01-01") / population(f"{first}-01-01")
    return base_index(duty, year) / base_index(duty, first) / weights


def _projected(native, duty):
    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        return current * projection_factor(
            household.simulation, duty, period.start.year
        )

    return formula


def project_gambling_bases(sim):
    """Grow each gambling duty with its base (see the module docstring):
    the forecast's modifier after data load, for baseline and reform alike.
    Leaves a simulation where ``projects`` is false as it is."""
    if not projects(sim):
        return sim
    system = sim.tax_benefit_system
    for duty, (variable, _) in DUTIES.items():
        _replace_formula(
            sim, variable, _projected(system.get_variable(variable), duty)
        )
    return sim
