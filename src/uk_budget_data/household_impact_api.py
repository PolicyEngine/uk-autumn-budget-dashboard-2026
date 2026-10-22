"""The household calculation as a small web app, served on Modal.

``create_app`` builds a FastAPI app with two routes:

- ``GET /health``: ``{"status": "ok", "versions": {...}}``, the packages the
  calculation runs on;
- ``POST /household-impact``: a household, a year and the measures to
  compare it under (every measure the calculation knows when none are
  named), answered by ``household_impact.calculate_household_impact``.

Inputs are checked here, so a request out of range gets a 422 naming the
field and never reaches the calculation. ``modal_household`` serves the app
from containers restored from a memory snapshot.
"""

from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from uk_budget_data import household_impact
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.runtime_identity import runtime_identity

# The largest amount a field takes, in £ a year
MAX_AMOUNT = 10_000_000


class HouseholdAnswersRequest(BaseModel):
    """A household, as the Personal impact view asks about it. Amounts are
    £ a year, except the monthly rent; children are dependants (under 20)."""

    age: int = Field(default=40, ge=16, le=100)
    employment_income: float = Field(default=35_000, ge=0, le=MAX_AMOUNT)
    has_partner: bool = False
    partner_age: int = Field(default=40, ge=16, le=100)
    partner_employment_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    children_ages: list[int] = Field(default_factory=list, max_length=10)
    region: Literal[household_impact.REGIONS] = "LONDON"
    claims_universal_credit: bool = False
    tenure: Literal[household_impact.TENURES] = "OWNED_WITH_MORTGAGE"
    monthly_rent: float = Field(default=0, ge=0, le=100_000)
    dividend_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    savings_interest_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    property_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    petrol_spending: float = Field(default=0, ge=0, le=100_000)
    diesel_spending: float = Field(default=0, ge=0, le=100_000)
    salary_sacrifice_pension_contributions: float = Field(
        default=0, ge=0, le=MAX_AMOUNT
    )

    @field_validator("children_ages")
    @classmethod
    def _dependent_children(cls, ages: list[int]) -> list[int]:
        if any(age < 0 or age > 19 for age in ages):
            raise ValueError("Children's ages must be 0 to 19")
        return ages

    def answers(self) -> household_impact.HouseholdAnswers:
        return household_impact.HouseholdAnswers(
            **{**self.model_dump(), "children_ages": tuple(self.children_ages)}
        )


class HouseholdImpactRequest(BaseModel):
    """A household, a policy year, and the measures to compare it under."""

    year: int
    policies: Optional[list[str]] = Field(default=None, min_length=1)
    household: HouseholdAnswersRequest = Field(
        default_factory=HouseholdAnswersRequest
    )

    @field_validator("year")
    @classmethod
    def _policy_year(cls, year: int) -> int:
        if year not in POLICY_YEARS:
            raise ValueError(
                f"Choose a year from {POLICY_YEARS[0]} to {POLICY_YEARS[-1]}"
            )
        return year

    @field_validator("policies")
    @classmethod
    def _known_measures(cls, policies: Optional[list[str]]):
        if policies is None:
            return policies
        unknown = sorted(set(policies) - set(household_impact.measure_ids()))
        if unknown:
            raise ValueError(f"Unknown measures: {', '.join(unknown)}")
        return policies


def create_app() -> FastAPI:
    """The web app. Its routes are plain functions, so FastAPI runs each
    calculation in a worker thread and ``/health`` keeps answering."""
    app = FastAPI(
        title="UK Autumn Budget 2026 household impact",
        description="A household's net income before and after the Budget",
        version="0.1.0",
    )

    @app.get("/health")
    def health():
        return {"status": "ok", "versions": runtime_identity()["packages"]}

    @app.post("/household-impact")
    def household_impact_route(data: HouseholdImpactRequest):
        policies = data.policies or household_impact.measure_ids()
        try:
            return household_impact.calculate_household_impact(
                data.household.answers(), policies, data.year
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))

    return app
