"""Personal impact calculator using PolicyEngine-UK.

This module calculates how Autumn Budget 2026 policies affect individual
households over time (2025-2029).
"""

import copy
import json
from dataclasses import dataclass, field
from typing import Callable, Optional

from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.reforms import (
    get_autumn_budget_2026_reforms,
)


@dataclass
class HouseholdInput:
    """Input parameters for a household."""

    employment_income: float
    income_growth_rate: float = 0.0
    is_married: bool = False
    partner_income: float = 0.0
    children_ages: list[int] = field(default_factory=list)
    property_income: float = 0.0
    savings_income: float = 0.0
    dividend_income: float = 0.0
    pension_contributions_salary_sacrifice: float = 0.0
    fuel_spending: float = 0.0
    rail_spending: float = 0.0


# Years to calculate (2025 is base year, 2026-2029 are policy years)
YEARS = [2025, 2026, 2027, 2028, 2029, 2030]

# Policies to analyse (excluding combined which would double-count)
POLICY_IDS = [
    "two_child_limit",
    "fuel_duty_freeze",
    "rail_fares_freeze",
    "threshold_freeze_extension",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
    "salary_sacrifice_cap",
]


def build_situation(household: HouseholdInput, year: int) -> dict:
    """Build a PolicyEngine situation dict for a given year.

    Ages children appropriately for the year (relative to 2025 base).
    Applies income growth to employment income.

    Args:
        household: Household input parameters.
        year: The year to build the situation for.

    Returns:
        PolicyEngine situation dictionary.
    """
    years_from_base = year - 2025
    growth_factor = (1 + household.income_growth_rate) ** years_from_base

    # Build people
    people = {
        "adult": {
            "age": {year: 35 + years_from_base},
            "employment_income": {
                year: household.employment_income * growth_factor
            },
            "savings_interest_income": {year: household.savings_income},
            "property_income": {year: household.property_income},
            "dividend_income": {year: household.dividend_income},
        }
    }

    # Add salary sacrifice pension contributions if specified
    if household.pension_contributions_salary_sacrifice > 0:
        people["adult"]["pension_contributions_via_salary_sacrifice"] = {
            year: household.pension_contributions_salary_sacrifice
        }

    benunit_members = ["adult"]
    household_members = ["adult"]

    # Add partner if married
    if household.is_married:
        people["partner"] = {
            "age": {year: 33 + years_from_base},
            "employment_income": {
                year: household.partner_income * growth_factor
            },
        }
        benunit_members.append("partner")
        household_members.append("partner")

    # Add children (age them each year)
    for i, child_age_2025 in enumerate(household.children_ages):
        child_age = child_age_2025 + years_from_base
        # Only include children under 25 (after which they're not dependents)
        if child_age < 25:
            child_id = f"child_{i + 1}"
            people[child_id] = {
                "age": {year: child_age},
                "employment_income": {year: 0},
            }
            benunit_members.append(child_id)
            household_members.append(child_id)

    return {
        "people": people,
        "benunits": {"benunit": {"members": benunit_members}},
        "households": {
            "household": {
                "members": household_members,
                "region": {year: "LONDON"},  # Default to London
            }
        },
    }


def build_situations(
    household: HouseholdInput, years: list[int]
) -> list[tuple[list[int], dict]]:
    """The household's situations for ``years``, each holding every one of
    its years' inputs, so a scenario is simulated once for all of them
    rather than once a year.

    Each year's inputs are exactly ``build_situation``'s for that year. A
    situation's people are fixed, and a child leaves the household at 25,
    so years with different people are in different situations.

    Returns:
        ``(years, situation)`` pairs, in the order of ``years``.
    """
    groups: dict[tuple, tuple[list[int], dict]] = {}
    for year in years:
        single = build_situation(household, year)
        people = tuple(single["people"])
        if people not in groups:
            groups[people] = ([year], copy.deepcopy(single))
            continue
        group_years, merged = groups[people]
        group_years.append(year)
        for person, variables in single["people"].items():
            for variable, values in variables.items():
                merged["people"][person].setdefault(variable, {}).update(
                    values
                )
        for variable, values in single["households"]["household"].items():
            if variable != "members":
                merged["households"]["household"][variable].update(values)
    return list(groups.values())


def _frozen(value):
    """A field value as something hashable that compares by content; a
    modifier (a function) compares by identity."""
    if value is None or callable(value):
        return value
    return json.dumps(value, sort_keys=True, default=repr)


def scenario_key(scenario: Optional[Scenario]):
    """What a scenario does, as a key: two scenarios with the same key
    simulate the same household identically. Every field of the model
    counts, so a field a later engine adds keeps scenarios apart. A
    scenario that changes nothing is current law."""
    scenario = effective(scenario)
    if scenario is None:
        return None
    return tuple(
        (name, _frozen(getattr(scenario, name)))
        for name in type(scenario).model_fields
    )


def create_simulation(
    situation: dict,
    year: int,
    reform_param_changes: dict | None = None,
    simulation_modifier: Callable | None = None,
) -> Simulation:
    """Create a PolicyEngine simulation with optional reform.

    Args:
        situation: PolicyEngine situation dictionary.
        year: The year to simulate.
        reform_param_changes: Parameter changes for the reform.
        simulation_modifier: Function to modify the simulation.

    Returns:
        Configured Simulation object.
    """
    # The changes go in as the national run applies them, through
    # policyengine-uk's Scenario: before fiscal-year conversion and the
    # parameters derived from them. Writing a value on 1 January afterwards
    # reached only what reads that one day: a monthly variable such as
    # fuel_duty saw 1/12 of a change, a duty kept on its statutory dates
    # (alcohol) saw none, and derived thresholds were not recomputed.
    # The modifier goes in the same Scenario, so the engine runs it where
    # the national run does and ignores what it returns: taking its return
    # as the simulation turned a modifier that returns nothing into None.
    scenario = {}
    if reform_param_changes:
        scenario["parameter_changes"] = reform_param_changes
    if simulation_modifier is not None:
        scenario["simulation_modifier"] = simulation_modifier
    return Simulation(
        situation=situation,
        scenario=Scenario(**scenario) if scenario else None,
    )


def household_simulations(
    situation: dict,
    reform: Reform,
    config: DataConfig,
    uses_config: Optional[bool] = None,
) -> tuple[Simulation, Simulation]:
    """The baseline and reformed simulations of a household under a
    measure, built as the national pipeline builds its own: the baseline
    from ``reform.baseline_scenario_for(config, uses_config)`` (the
    measure's own baseline, else the configured one, else current law) and
    the reform from ``reform.to_scenario()``.

    Args:
        situation: PolicyEngine situation dictionary.
        reform: The measure.
        config: The configuration the national figures were generated with.
        uses_config: For a combined measure, whether any member uses the
            configured baseline, as publication passes it: members that
            each bring an empty baseline merge into an empty one, which on
            its own reads as none. Leave it None for a single measure.

    Returns:
        ``(baseline, reformed)``.
    """
    return (
        Simulation(
            situation=situation,
            scenario=effective(
                reform.baseline_scenario_for(config, uses_config)
            ),
        ),
        Simulation(
            situation=situation, scenario=effective(reform.to_scenario())
        ),
    )


# Scenario fields that change nothing on their own.
_INERT_FIELDS = ("applied_before_data_load",)


def effective(scenario: Optional[Scenario]) -> Optional[Scenario]:
    """The scenario, or None when it changes nothing.

    Given any scenario, policyengine-uk builds a second, scenario-free
    simulation from the situation as the simulation's ``baseline``; given
    none, it clones itself. A scenario with no parameter changes, dated
    reforms or modifier applies nothing (an empty parameter rebuild returns
    at once), so it would only add that build: most registered measures
    keep current law on the reform side as ``parameter_changes={}``. Any
    other field, including one a later engine adds, keeps the scenario.
    """
    if scenario is None:
        return None
    if any(
        getattr(scenario, field) not in (None, {}, [])
        for field in type(scenario).model_fields
        if field not in _INERT_FIELDS
    ):
        return scenario
    return None


def calculate_household_metrics(sim: Simulation, year: int) -> dict:
    """Calculate key metrics for a household.

    Args:
        sim: PolicyEngine simulation.
        year: The year to calculate for.

    Returns:
        Dictionary of metric values.
    """
    # Get household net income (main metric)
    household_net_income = float(
        sim.calculate("household_net_income", year)[0]
    )

    # Get individual-level taxes (sum across all people)
    income_tax = float(sim.calculate("income_tax", year).sum())
    national_insurance = float(sim.calculate("national_insurance", year).sum())

    # Get benefit unit level benefits
    child_benefit = float(sim.calculate("child_benefit", year).sum())

    # Universal credit is at benefit unit level
    try:
        universal_credit = float(sim.calculate("universal_credit", year).sum())
    except Exception:
        universal_credit = 0.0

    # Council tax is at household level
    try:
        council_tax = float(
            sim.calculate("council_tax", year, map_to="household")[0]
        )
    except Exception:
        council_tax = 0.0

    return {
        "household_net_income": household_net_income,
        "income_tax": income_tax,
        "national_insurance": national_insurance,
        "child_benefit": child_benefit,
        "universal_credit": universal_credit,
        "council_tax": council_tax,
    }


class PersonalImpactCalculator:
    """Calculator for personal household impact from budget policies."""

    def __init__(self, config: Optional[DataConfig] = None):
        """Initialize the calculator by loading reforms.

        Args:
            config: The configuration the national figures were generated
                with, whose baseline a measure without its own is compared
                against. The default is ``generate``'s, which sets no
                global baseline.
        """
        self.config = config if config is not None else DataConfig()
        self.reforms = {
            reform.id: reform
            for reform in get_autumn_budget_2026_reforms()
            if reform.id in POLICY_IDS
        }

    def calculate(self, household: HouseholdInput) -> dict:
        """Calculate the impact of all policies on a household.

        Args:
            household: Household input parameters.

        Returns:
            Dictionary with year-by-year breakdown per policy.
        """
        results = {
            "household_input": {
                "employment_income": household.employment_income,
                "income_growth_rate": household.income_growth_rate,
                "is_married": household.is_married,
                "partner_income": household.partner_income,
                "children_ages": household.children_ages,
                "property_income": household.property_income,
                "savings_income": household.savings_income,
                "dividend_income": household.dividend_income,
                "pension_contributions_salary_sacrifice": (
                    household.pension_contributions_salary_sacrifice
                ),
                "fuel_spending": household.fuel_spending,
                "rail_spending": household.rail_spending,
            },
            "years": {},
            "policies": {},
            "totals": {
                "by_year": {},
                "cumulative": 0,
            },
        }

        # Every simulation the results need, keyed by what its scenario does:
        # the configured baseline, and each measure's two sides. Most
        # measures share a side (current law, for one), and a simulation
        # answers every year, so each distinct scenario is built once per
        # set of people, not once per measure and year: construction, not
        # calculation, is what takes the time.
        reforms = [
            (policy_id, self.reforms[policy_id])
            for policy_id in POLICY_IDS
            if policy_id in self.reforms
        ]
        scenarios = {}

        def needed(scenario):
            key = scenario_key(scenario)
            scenarios.setdefault(key, effective(scenario))
            return key

        configured = needed(self.config.get_baseline_scenario())
        sides = {
            policy_id: (
                needed(reform.baseline_scenario_for(self.config)),
                needed(reform.to_scenario()),
            )
            for policy_id, reform in reforms
        }
        metrics = {}
        for years, situation in build_situations(household, YEARS):
            # One simulation at a time, so memory stays that of one.
            for key, scenario in scenarios.items():
                sim = Simulation(situation=situation, scenario=scenario)
                for year in years:
                    metrics[key, year] = calculate_household_metrics(sim, year)
                del sim

        for year in YEARS:
            results["years"][year] = {
                "baseline": dict(metrics[configured, year]),
                "policies": {},
            }

        # Calculate impact of each policy
        for policy_id, reform in reforms:
            policy_results = {
                "name": reform.name,
                "description": reform.description,
                "years": {},
                "total_impact": 0,
            }
            baseline_key, reform_key = sides[policy_id]

            for year in YEARS:
                baseline_metrics = dict(metrics[baseline_key, year])
                reform_metrics = dict(metrics[reform_key, year])

                # Calculate the impact (positive = household gains)
                net_income_change = (
                    reform_metrics["household_net_income"]
                    - baseline_metrics["household_net_income"]
                )

                policy_results["years"][year] = {
                    "baseline_net_income": baseline_metrics[
                        "household_net_income"
                    ],
                    "reformed_net_income": reform_metrics[
                        "household_net_income"
                    ],
                    "net_income_change": net_income_change,
                    "baseline_metrics": baseline_metrics,
                    "reformed_metrics": reform_metrics,
                }

                policy_results["total_impact"] += net_income_change
                results["years"][year]["policies"][policy_id] = {
                    "net_income_change": net_income_change
                }

            results["policies"][policy_id] = policy_results

        # Calculate totals
        for year in YEARS:
            year_total = sum(
                results["policies"][pid]["years"][year]["net_income_change"]
                for pid in POLICY_IDS
                if pid in results["policies"]
            )
            results["totals"]["by_year"][year] = year_total

        results["totals"]["cumulative"] = sum(
            results["totals"]["by_year"].values()
        )

        return results
