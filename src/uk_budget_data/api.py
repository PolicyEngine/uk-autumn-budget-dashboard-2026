"""FastAPI backend for personal impact calculations.

This module provides a REST API endpoint for calculating how Autumn Budget
policies affect individual households over time.
"""

import json
import os

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from uk_budget_data.lifecycle_calculator import (
    LifecycleInputs,
    run_lifecycle_model,
)
from uk_budget_data.personal_impact import (
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
    return HouseholdInput(
        employment_income=api_input.employment_income,
        income_growth_rate=api_input.income_growth_rate,
        is_married=api_input.is_married,
        partner_income=api_input.partner_income,
        children_ages=api_input.children_ages,
        property_income=api_input.property_income,
        savings_income=api_input.savings_income,
        dividend_income=api_input.dividend_income,
        pension_contributions_salary_sacrifice=(
            api_input.pension_contributions_salary_sacrifice
        ),
        fuel_spending=api_input.fuel_spending,
        rail_spending=api_input.rail_spending,
        bus_spending=api_input.bus_spending,
        capital_gains=api_input.capital_gains,
    )


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
        household_input = convert_api_input_to_household(data)
        calculator = get_calculator()
        results = calculator.calculate(household_input)
        return convert_to_native(results)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}")


@app.post("/api/personal-impact/stream")
async def calculate_personal_impact_stream(data: APIHouseholdInput):
    """Stream personal impact results year-by-year using SSE."""
    try:
        household_input = convert_api_input_to_household(data)
        calculator = get_calculator()

        async def generate():
            for event in calculator.calculate_streaming(household_input):
                event_data = convert_to_native(event)
                yield f"data: {json.dumps(event_data)}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


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
