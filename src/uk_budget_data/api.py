"""FastAPI backend for personal impact calculations.

This module provides a REST API endpoint for calculating how Autumn Budget
policies affect individual households over time.
"""

import os

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from policyengine_uk.variables.household.demographic.geography import Region
from pydantic import BaseModel, Field, field_validator

from uk_budget_data.lifecycle_calculator import (
    LifecycleInputs,
    run_lifecycle_model,
)
from uk_budget_data.personal_impact import (
    POLICY_IDS,
    HouseholdInput,
    PersonalImpactCalculator,
)

app = FastAPI(
    title="UK Budget Personal Impact API",
    description="Calculate how Autumn Budget policies affect households",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class APIHouseholdInput(BaseModel):
    """API request model for household inputs."""

    employment_income: float = Field(
        ..., ge=0, description="Annual employment income in 2025 (GBP)"
    )
    income_growth_rate: float = Field(
        default=0.0,
        ge=-0.5,
        le=0.5,
        description="Annual income growth rate (e.g., 0.03 for 3%)",
    )
    is_married: bool = Field(
        default=False, description="Whether the person is married/cohabiting"
    )
    partner_income: float = Field(
        default=0.0,
        ge=0,
        description="Partner's annual employment income (GBP)",
    )
    children_ages: list[int] = Field(
        default_factory=list,
        description="Ages of children in 2025",
    )
    property_income: float = Field(
        default=0.0, ge=0, description="Annual property income (GBP)"
    )
    savings_income: float = Field(
        default=0.0, ge=0, description="Annual savings/interest income (GBP)"
    )
    dividend_income: float = Field(
        default=0.0, ge=0, description="Annual dividend income (GBP)"
    )
    pension_contributions_salary_sacrifice: float = Field(
        default=0.0,
        ge=0,
        description="Annual salary sacrifice pension contributions (GBP)",
    )
    fuel_spending: float = Field(
        default=0.0,
        ge=0,
        description="Annual fuel spending (GBP)",
    )
    rail_spending: float = Field(
        default=0.0,
        ge=0,
        description="Annual rail spending (GBP)",
    )

    bus_spending: float = Field(default=0.0, ge=0)
    capital_gains: float = Field(default=0.0, ge=0)
    region: str = Field(default="LONDON", description="UK household region")
    fuel_type: str = Field(default="PETROL", description="PETROL or DIESEL")
    self_employment_income: float = Field(default=0, ge=0)
    fuel_litres: float = Field(default=0, ge=0)
    domestic_energy_bill: float = Field(default=0, ge=0)
    electricity_bill: float = Field(default=0, ge=0)
    home_value_2026: float = Field(default=0, ge=0)
    rent: float = Field(default=0, ge=0)
    tenure_type: str = "OWNED_OUTRIGHT"
    state_pension_income: float = Field(default=0, ge=0)
    private_pension_income: float = Field(default=0, ge=0)
    partner_state_pension_income: float = Field(default=0, ge=0)
    partner_private_pension_income: float = Field(default=0, ge=0)
    claims_pension_credit: bool = Field(
        default=True,
        description="False when the household does not claim Pension Credit",
    )
    age_2025: int = Field(default=35, ge=16, le=100)
    partner_age_2025: int = Field(default=33, ge=16, le=100)
    policy_ids: list[str] | None = Field(
        default=None, description="Featured policy IDs to calculate"
    )

    @field_validator("tenure_type")
    @classmethod
    def validate_tenure(cls, value):
        if value not in {
            "OWNED_OUTRIGHT",
            "OWNED_WITH_MORTGAGE",
            "RENT_PRIVATELY",
            "RENT_FROM_HA",
            "RENT_FROM_COUNCIL",
        }:
            raise ValueError("Unknown housing tenure")
        return value

    @field_validator("region")
    @classmethod
    def validate_region(cls, value):
        """Accept only PolicyEngine-UK region identifiers."""
        if value not in Region.__members__ or value == "UNKNOWN":
            raise ValueError("Unknown UK region")
        return value

    @field_validator("fuel_type")
    @classmethod
    def validate_fuel_type(cls, value):
        """Keep the spending input tied to its selected fuel."""
        if value not in {"PETROL", "DIESEL"}:
            raise ValueError("Fuel type must be PETROL or DIESEL")
        return value

    @field_validator("policy_ids")
    @classmethod
    def validate_policy_ids(cls, value):
        """Reject unknown, repeated, or empty policy selections."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        if value is None:
            return value
        if os.environ.get("NEXT_PUBLIC_MOCK") == "1":
            active = {r.id for r in get_autumn_budget_2026_reforms()}
            if len(value) != len(set(value)) or set(value) - active:
                raise ValueError("Select unique active drill measures")
            return value
        if (
            not value
            or len(value) != len(set(value))
            or set(value) - set(POLICY_IDS)
        ):
            raise ValueError("Select one or more unique featured policies")
        return value

    @field_validator("children_ages")
    @classmethod
    def validate_children_ages(cls, v):
        """Validate that children ages are reasonable."""
        if len(v) > 10:
            raise ValueError("Maximum 10 children supported")
        for age in v:
            if age < 0 or age > 25:
                raise ValueError("Children ages must be between 0 and 25")
        return v


def convert_api_input_to_household(api_input: APIHouseholdInput) -> dict:
    """Convert API input to the format expected by PersonalImpactCalculator."""
    return HouseholdInput(**api_input.model_dump(exclude={"policy_ids"}))


def convert_to_native(obj):
    """Convert numpy types to Python native types for JSON serialisation."""
    if isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, dict):
        return {k: convert_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_native(item) for item in obj]
    return obj


# Lazy-load calculator to avoid startup delay
_calculator: PersonalImpactCalculator | None = None


def get_calculator() -> PersonalImpactCalculator:
    """Get or create the PersonalImpactCalculator (lazy singleton)."""
    global _calculator
    if _calculator is None:
        _calculator = PersonalImpactCalculator()
    return _calculator


@app.post("/api/personal-impact")
async def calculate_personal_impact(data: APIHouseholdInput):
    """Calculate personal impact for a household.

    Returns year-by-year impact breakdown per policy.
    """
    try:
        from uk_budget_data.drill_setup import verify_runtime

        verify_runtime()
        household_input = convert_api_input_to_household(data)
        calculator = get_calculator()
        results = calculator.calculate(
            household_input, policy_ids=data.policy_ids
        )
        return convert_to_native(results)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    from uk_budget_data.drill_setup import (
        CORE_VERSION,
        MODEL_VERSION,
        drill_provenance,
        runtime_versions,
    )

    versions = runtime_versions()
    matching = versions == {
        "policyengine-uk": MODEL_VERSION,
        "policyengine-core": CORE_VERSION,
    }
    return {
        "status": "healthy" if matching else "engine-mismatch",
        "versions": versions,
        "provenance": drill_provenance(),
    }


class APILifecycleInput(BaseModel):
    """API request model for lifecycle calculator inputs."""

    current_age: int = Field(
        default=30, ge=18, le=80, description="Current age"
    )
    current_salary: float = Field(
        default=40_000, ge=0, description="Current annual salary in 2025 (GBP)"
    )
    retirement_age: int = Field(
        default=67, ge=55, le=100, description="Retirement age"
    )
    life_expectancy: int = Field(
        default=85, ge=60, le=100, description="Life expectancy"
    )
    student_loan_debt: float = Field(
        default=50_000, ge=0, description="Student loan debt at graduation"
    )
    salary_sacrifice_per_year: float = Field(
        default=5_000,
        ge=0,
        description="Annual salary sacrifice pension contribution",
    )
    rail_spending_per_year: float = Field(
        default=2_000, ge=0, description="Annual rail spending"
    )
    petrol_spending_per_year: float = Field(
        default=1_500, ge=0, description="Annual petrol spending"
    )
    dividends_per_year: float = Field(
        default=2_000, ge=0, description="Annual dividend income"
    )
    savings_interest_per_year: float = Field(
        default=1_500, ge=0, description="Annual savings interest income"
    )
    property_income_per_year: float = Field(
        default=3_000, ge=0, description="Annual property income"
    )
    children_ages: list[int] = Field(
        default_factory=list, description="Ages of children in 2025"
    )

    bus_spending: float = Field(default=0.0, ge=0)
    capital_gains: float = Field(default=0.0, ge=0)

    @field_validator("children_ages")
    @classmethod
    def validate_children_ages(cls, v):
        """Validate that children ages are reasonable."""
        if len(v) > 10:
            raise ValueError("Maximum 10 children supported")
        for age in v:
            if age < 0 or age > 20:
                raise ValueError("Children ages must be between 0 and 20")
        return v


@app.post("/api/lifecycle/calculate")
async def calculate_lifecycle_impact(data: APILifecycleInput):
    """Calculate lifetime policy impact for an individual.

    Returns year-by-year impact breakdown for policies affecting income,
    taxes, student loans, and benefits over a full working life.
    """
    try:
        inputs = LifecycleInputs(
            current_age=data.current_age,
            current_salary=data.current_salary,
            retirement_age=data.retirement_age,
            life_expectancy=data.life_expectancy,
            student_loan_debt=data.student_loan_debt,
            salary_sacrifice_per_year=data.salary_sacrifice_per_year,
            rail_spending_per_year=data.rail_spending_per_year,
            petrol_spending_per_year=data.petrol_spending_per_year,
            dividends_per_year=data.dividends_per_year,
            savings_interest_per_year=data.savings_interest_per_year,
            property_income_per_year=data.property_income_per_year,
            children_ages=data.children_ages,
        )
        results = run_lifecycle_model(inputs)
        return {"data": results}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}")


def main():
    """Run the FastAPI server with uvicorn."""
    import uvicorn

    port = int(os.environ.get("PORT", 5001))
    print(f"Starting UK Budget Personal Impact API on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
