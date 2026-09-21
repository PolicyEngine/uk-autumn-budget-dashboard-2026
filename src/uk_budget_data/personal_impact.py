"""Personal impact calculator using PolicyEngine-UK.

This module calculates how Autumn Budget 2026 policies affect individual
households over time (2025-2029).
"""

from dataclasses import dataclass, field
from typing import Callable

from policyengine_uk import Simulation

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
    sim = Simulation(situation=situation)

    # Apply parameter changes if provided
    if reform_param_changes:
        for param_path, values in reform_param_changes.items():
            param = sim.tax_benefit_system.parameters
            for part in param_path.split("."):
                if "[" in part:
                    # Handle indexed parameters like rates.uk[1]
                    name, idx = part.rstrip("]").split("[")
                    param = getattr(param, name)[int(idx)]
                else:
                    param = getattr(param, part)

            # Apply value for the year
            year_str = str(year)
            if year_str in values:
                param.update(period=f"{year}-01-01", value=values[year_str])

    # Apply simulation modifier if provided
    if simulation_modifier:
        sim = simulation_modifier(sim)

    return sim


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

    def __init__(self):
        """Initialize the calculator by loading reforms."""
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

        # Calculate baseline for each year
        baselines = {}
        for year in YEARS:
            situation = build_situation(household, year)
            baseline_sim = create_simulation(situation, year)
            baselines[year] = calculate_household_metrics(baseline_sim, year)
            results["years"][year] = {
                "baseline": baselines[year],
                "policies": {},
            }

        # Calculate impact of each policy
        for policy_id in POLICY_IDS:
            reform = self.reforms.get(policy_id)
            if not reform:
                continue

            policy_results = {
                "name": reform.name,
                "description": reform.description,
                "years": {},
                "total_impact": 0,
            }

            for year in YEARS:
                situation = build_situation(household, year)

                # For policies with custom baselines, we need to compare
                # the reform scenario vs the baseline scenario
                if reform.has_custom_baseline():
                    # Create baseline scenario (what would have happened
                    # without the budget)
                    baseline_scenario = reform.to_baseline_scenario()
                    if baseline_scenario:
                        baseline_sim = create_simulation(
                            situation,
                            year,
                            reform_param_changes=(
                                reform.baseline_parameter_changes
                            ),
                            simulation_modifier=(
                                reform.baseline_simulation_modifier
                            ),
                        )
                    else:
                        baseline_sim = create_simulation(situation, year)

                    # Create reform scenario (the budget policy)
                    reform_sim = create_simulation(
                        situation,
                        year,
                        reform_param_changes=reform.parameter_changes,
                        simulation_modifier=reform.simulation_modifier,
                    )
                else:
                    # Standard reform: compare against current law baseline
                    baseline_sim = create_simulation(situation, year)
                    reform_sim = create_simulation(
                        situation,
                        year,
                        reform_param_changes=reform.parameter_changes,
                        simulation_modifier=reform.simulation_modifier,
                    )

                baseline_metrics = calculate_household_metrics(
                    baseline_sim, year
                )
                reform_metrics = calculate_household_metrics(reform_sim, year)

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
