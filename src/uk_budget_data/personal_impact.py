"""Personal impact calculator using PolicyEngine-UK.

This module calculates how Autumn Budget 2026 policies affect individual
households over time (2025-2030).
"""

from dataclasses import asdict, dataclass, field
from typing import Callable

from policyengine_uk import Simulation

from uk_budget_data.reforms import (
    DIVIDEND_PRE_BUDGET_BASIC_RATE,
    DIVIDEND_PRE_BUDGET_HIGHER_RATE,
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
    region: str = "LONDON"
    fuel_type: str = "PETROL"


# Years to calculate (2025 is base year, 2026-2030 are policy years)
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
    "threshold_freeze_extension",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
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
                "region": {year: household.region},
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


def calculate_personal_net_income(
    *,
    people: list[dict],
    household: dict,
    year: int,
    parameters: dict | None = None,
) -> float:
    """Calculate only the household income needed for a policy comparison."""
    person_ids = [f"person_{index}" for index in range(len(people))]
    situation = {
        "people": {
            person_id: {
                variable: {str(year): value}
                for variable, value in person.items()
            }
            for person_id, person in zip(person_ids, people)
        },
        "benunits": {"benunit_0": {"members": person_ids}},
        "households": {
            "household_0": {
                "members": person_ids,
                **{
                    variable: {str(year): value}
                    for variable, value in household.items()
                },
            }
        },
    }
    reform = (
        {
            path: (
                value if isinstance(value, dict) else {f"{year}-01-01": value}
            )
            for path, value in parameters.items()
        }
        if parameters
        else None
    )
    simulation = Simulation(situation=situation, reform=reform)
    return float(simulation.calculate("household_net_income", year)[0])


def annual_reform_parameters(
    changes: dict[str, dict[str, float]], year: int
) -> dict[str, dict[str, float]]:
    """Keep every dated change in the model year, including monthly rates."""
    selected = {}
    for path, values in changes.items():
        annual_values = {
            key if "-" in key else f"{key}-01-01": value
            for key, value in values.items()
            if key[:4] == str(year)
        }
        if annual_values:
            selected[path] = annual_values
    return selected


def has_relevant_input(policy_id: str, household: HouseholdInput) -> bool:
    """Avoid a simulation when the household has no affected income or spend."""
    relevant_amount = {
        "cgt_equalisation": household.capital_gains,
        "fuel_duty_rise_cancellation": household.fuel_spending,
        "bus_fare_cap": household.bus_spending,
        "dividend_tax_increase_2pp": household.dividend_income,
        "savings_tax_increase_2pp": household.savings_income,
        "property_tax_increase_2pp": household.property_income,
    }.get(policy_id)
    if relevant_amount is not None:
        return relevant_amount > 0
    return any(
        value > 0
        for value in (
            household.employment_income,
            household.partner_income,
            household.property_income,
            household.savings_income,
            household.dividend_income,
            household.capital_gains,
        )
    )


class PersonalImpactCalculator:
    """Calculator for personal household impact from budget policies."""

    def __init__(self):
        """Initialize the calculator by loading reforms."""
        self.reforms = {
            reform.id: reform
            for reform in get_autumn_budget_2026_reforms()
            if reform.id in POLICY_IDS
        }

    def calculate(
        self, household: HouseholdInput, policy_ids: list[str] | None = None
    ) -> dict:
        """Calculate the requested dashboard policies using policyengine.py."""
        from policyengine_uk.variables.household.demographic.geography import (
            Region,
        )

        from uk_budget_data.reforms import (
            BUS_CAP_ELIGIBLE_REGIONS,
            BUS_FARE_CAP_REDUCTION,
        )

        requested = (
            set(policy_ids) if policy_ids is not None else set(POLICY_IDS)
        )
        unknown = requested - self.reforms.keys()
        if unknown:
            raise ValueError(f"Unknown policies: {', '.join(sorted(unknown))}")
        selected_reforms = {
            policy_id: self.reforms[policy_id]
            for policy_id in POLICY_IDS
            if policy_id in requested
        }

        results = {
            "household_input": asdict(household),
            "years": {},
            "policies": {},
            "totals": {"by_year": {}, "cumulative": 0},
        }
        for policy_id, reform in selected_reforms.items():
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
                "region": household.region,
                "petrol_spending": (
                    household.fuel_spending
                    if household.fuel_type == "PETROL"
                    else 0
                ),
                "diesel_spending": (
                    household.fuel_spending
                    if household.fuel_type == "DIESEL"
                    else 0
                ),
                "bus_fare_spending": household.bus_spending,
            }

            def metrics(parameters=None, bus_saving=0):
                inputs = dict(household_inputs)
                if bus_saving:
                    inputs["bus_fare_spending"] -= bus_saving
                    inputs["bus_subsidy_spending"] = bus_saving
                income = calculate_personal_net_income(
                    people=people,
                    household=inputs,
                    year=year,
                    parameters=parameters,
                )
                return {"household_net_income": income}

            baseline = metrics()
            results["years"][year] = {"baseline": baseline, "policies": {}}
            for policy_id, reform in selected_reforms.items():
                if not has_relevant_input(policy_id, household):
                    policy = results["policies"][policy_id]
                    policy["years"][year] = {
                        "baseline_net_income": baseline[
                            "household_net_income"
                        ],
                        "reformed_net_income": baseline[
                            "household_net_income"
                        ],
                        "net_income_change": 0.0,
                        "baseline_metrics": baseline,
                        "reformed_metrics": baseline,
                    }
                    results["years"][year]["policies"][policy_id] = {
                        "net_income_change": 0.0
                    }
                    continue
                parameters = annual_reform_parameters(
                    reform.parameter_changes or {}, year
                )
                saving = (
                    household.bus_spending * BUS_FARE_CAP_REDUCTION
                    if policy_id == "bus_fare_cap"
                    and year >= 2027
                    and Region[household.region] in BUS_CAP_ELIGIBLE_REGIONS
                    else 0
                )
                baseline_parameters = annual_reform_parameters(
                    reform.baseline_parameter_changes or {}, year
                )
                if policy_id == "dividend_tax_increase_2pp" and year >= 2026:
                    baseline_parameters.update(
                        {
                            "gov.hmrc.income_tax.rates.dividends[0].rate": (
                                DIVIDEND_PRE_BUDGET_BASIC_RATE
                            ),
                            "gov.hmrc.income_tax.rates.dividends[1].rate": (
                                DIVIDEND_PRE_BUDGET_HIGHER_RATE
                            ),
                        }
                    )
                policy_baseline = (
                    metrics(baseline_parameters)
                    if baseline_parameters
                    else baseline
                )
                reformed = (
                    metrics(parameters, saving)
                    if parameters or saving
                    else baseline
                )
                change = (
                    reformed["household_net_income"]
                    - policy_baseline["household_net_income"]
                )
                policy = results["policies"][policy_id]
                policy["years"][year] = {
                    "baseline_net_income": policy_baseline[
                        "household_net_income"
                    ],
                    "reformed_net_income": reformed["household_net_income"],
                    "net_income_change": change,
                    "baseline_metrics": policy_baseline,
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
