"""Personal impact calculator using PolicyEngine-UK.

This module calculates how Autumn Budget 2026 policies affect individual
households over time (2025-2029).
"""

from dataclasses import asdict, dataclass, field
from typing import Callable

import policyengine as pe
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
    bus_spending: float = 0.0
    capital_gains: float = 0.0


# Years to calculate (2025 is base year, 2026-2029 are policy years)
YEARS = [2025, 2026, 2027, 2028, 2029, 2030]

# Policies to analyse (excluding combined which would double-count)
# The Autumn Budget 2026 measures offered by the personal impact calculator.
# Must stay a subset of get_autumn_budget_2026_reforms(), which the calculator
# filters by these ids; an id listed here but absent from that list silently
# disappears from the calculator rather than erroring.
POLICY_IDS = [
    "cgt_equalisation",
    "fuel_duty_rise_cancellation",
    "bus_fare_cap",
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
        """Calculate the three candidate policies using policyengine.py."""
        from uk_budget_data.reforms import BUS_FARE_CAP_REDUCTION

        results = {
            "household_input": asdict(household),
            "years": {},
            "policies": {},
            "totals": {"by_year": {}, "cumulative": 0},
        }
        for policy_id, reform in self.reforms.items():
            results["policies"][policy_id] = {
                "name": reform.name,
                "description": reform.description,
                "years": {},
                "total_impact": 0,
            }

        for year in YEARS:
            situation = build_situation(household, year)
            people = [
                {key: values[year] for key, values in person.items()}
                for person in situation["people"].values()
            ]
            people[0][
                "capital_gains_before_response"
            ] = household.capital_gains
            household_inputs = {
                "region": "LONDON",
                "petrol_spending": household.fuel_spending,
                "diesel_spending": 0,
                "bus_fare_spending": household.bus_spending,
            }

            def metrics(parameters=None, bus_saving=0):
                inputs = dict(household_inputs)
                if bus_saving:
                    inputs["bus_fare_spending"] -= bus_saving
                    inputs["bus_subsidy_spending"] = bus_saving
                result = pe.uk.calculate_household(
                    people=people,
                    household=inputs,
                    year=year,
                    reform=parameters or None,
                    extra_variables=["household_net_income"],
                )
                return {
                    "household_net_income": float(
                        result.household.household_net_income
                    )
                }

            baseline = metrics()
            results["years"][year] = {"baseline": baseline, "policies": {}}
            for policy_id, reform in self.reforms.items():
                parameters = {
                    path: values[str(year)]
                    for path, values in (
                        reform.parameter_changes or {}
                    ).items()
                    if str(year) in values
                }
                saving = (
                    household.bus_spending * BUS_FARE_CAP_REDUCTION
                    if policy_id == "bus_fare_cap" and year >= 2026
                    else 0
                )
                reformed = (
                    metrics(parameters, saving)
                    if parameters or saving
                    else baseline
                )
                change = (
                    reformed["household_net_income"]
                    - baseline["household_net_income"]
                )
                policy = results["policies"][policy_id]
                policy["years"][year] = {
                    "baseline_net_income": baseline["household_net_income"],
                    "reformed_net_income": reformed["household_net_income"],
                    "net_income_change": change,
                    "baseline_metrics": baseline,
                    "reformed_metrics": reformed,
                }
                policy["total_impact"] += change
                results["years"][year]["policies"][policy_id] = {
                    "net_income_change": change
                }
            results["totals"]["by_year"][year] = sum(
                p["years"][year]["net_income_change"]
                for p in results["policies"].values()
            )
        results["totals"]["cumulative"] = sum(
            results["totals"]["by_year"].values()
        )
        return results
