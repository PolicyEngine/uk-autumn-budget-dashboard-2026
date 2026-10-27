"""FastAPI backend for personal impact calculations.

This module provides a REST API endpoint for calculating how Autumn Budget
policies affect individual households.
"""

import copy
import functools
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import anyio
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from uk_budget_data import definitions, household_impact
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.personal_impact import (
    HouseholdInput,
    PersonalImpactCalculator,
    household_workers,
    stop_workers,
)
from uk_budget_data.runtime_identity import runtime_identity


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        yield
    finally:
        # Before uvicorn re-raises SIGTERM: see stop_workers.
        stop_workers()


app = FastAPI(
    title="UK Budget Personal Impact API",
    description="Calculate how Autumn Budget policies affect households",
    version="0.1.0",
    lifespan=lifespan,
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


# One household calculation at a time per instance, in arrival order. A
# calculation takes minutes of CPU: several at once share it and all finish
# together, later than any would alone (three at a time on Cloud Run's 300 s
# limit all time out where two of three would have finished), and each
# holds its own memory. How many visitors an instance takes is Cloud Run's
# --concurrency.
CALCULATIONS = anyio.CapacityLimiter(1)


def household_request_limit() -> int:
    """How many household-impact requests an instance works on at once.

    With worker processes, ``HOUSEHOLD_CONCURRENT_REQUESTS`` (default 4):
    their runs share the instance's worker slots fairly
    (``personal_impact.FairSlots``), so a later visitor's headline is not
    held behind an earlier visitor's whole calculation, while CPU and
    memory stay bounded by the slots. Without workers every run is in this
    process, so one request at a time.
    """
    # On Modal (HOUSEHOLD_RUNNER=modal) the runs happen in their own
    # containers, not in this process, so requests can overlap.
    modal_runner = os.environ.get("HOUSEHOLD_RUNNER") == "modal"
    if household_workers() <= 1 and not modal_runner:
        return 1
    try:
        return max(1, int(os.environ.get("HOUSEHOLD_CONCURRENT_REQUESTS", 4)))
    except ValueError:
        return 4


# The household route's own limiter (see household_request_limit).
HOUSEHOLD_REQUESTS = anyio.CapacityLimiter(household_request_limit())

# Where a container's cgroup reports its peak memory: cgroup v2, then v1.
MEMORY_PEAK_FILES = (
    Path("/sys/fs/cgroup/memory.peak"),
    Path("/sys/fs/cgroup/memory/memory.max_usage_in_bytes"),
)


def memory_peak_bytes() -> Optional[int]:
    """The container's peak memory use so far (its high-water mark since it
    started, page cache included), from its cgroup, or None where no cgroup
    reports it (outside a container)."""
    for path in MEMORY_PEAK_FILES:
        try:
            return int(path.read_text().split()[0])
        except (OSError, ValueError, IndexError):
            continue
    return None


def server_timing(
    calculating: float, queued: float, peak: Optional[int]
) -> str:
    """A Server-Timing header: the calculation's own time, the time the
    request waited for the calculation before it, and, where the cgroup
    reports it, the container's peak memory, so a deployed revision can be
    measured from outside (``curl -i``)."""
    parts = [
        f"calculate;dur={calculating * 1000:.0f}",
        f"queue;dur={queued * 1000:.0f}",
    ]
    if peak is not None:
        parts.append(f'memory;desc="peak {peak / 2**20:.0f} MiB"')
    return ", ".join(parts)


def timed(calculate, household):
    """The calculation's results and how long it took, timed in the worker
    thread so a wait for the limiter isn't counted."""
    started = time.perf_counter()
    results = calculate(household)
    return results, time.perf_counter() - started


@app.post("/api/personal-impact")
async def calculate_personal_impact(
    data: APIHouseholdInput, response: Response
):
    """Calculate personal impact for a household.

    Returns year-by-year impact breakdown per policy.

    The calculation runs in a worker thread, one at a time
    (``CALCULATIONS``), so the event loop keeps answering other requests
    (``/api/version``, ``/api/health``) meanwhile. Run on the event loop
    itself, it blocked every request to the instance until it finished.
    """
    try:
        household_input = convert_api_input_to_household(data)
        calculator = get_calculator()
        received = time.perf_counter()
        results, calculating = await anyio.to_thread.run_sync(
            timed, calculator.calculate, household_input, limiter=CALCULATIONS
        )
        response.headers["Server-Timing"] = server_timing(
            calculating,
            time.perf_counter() - received - calculating,
            memory_peak_bytes(),
        )
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


# --- One household, one year: POST /api/household-impact -------------------

# The largest amount a field takes, in £ a year
MAX_AMOUNT = 10_000_000


class HouseholdChildRequest(BaseModel):
    """A child: a dependant under policyengine-uk's rules, which count
    everyone under 16 and a 16- to 19-year-old in full-time non-advanced
    education (school or college). ``in_education`` says which a 16- to
    19-year-old is; left out, policyengine-uk places a 16- or 17-year-old in
    school and an 18- or 19-year-old at university (not a dependant)."""

    model_config = {"extra": "forbid"}

    age: int = Field(..., ge=0, le=household_impact.OLDEST_CHILD_AGE)
    in_education: Optional[bool] = None


class HouseholdAnswersRequest(BaseModel):
    """A household, as the Personal impact view asks about it. Amounts are
    £ a year, except the monthly rent."""

    model_config = {"extra": "forbid"}

    age: int = Field(default=40, ge=16, le=100)
    employment_income: float = Field(default=35_000, ge=0, le=MAX_AMOUNT)
    student_loan_plan: Literal[household_impact.STUDENT_LOAN_PLANS] = "NONE"
    has_partner: bool = False
    partner_age: int = Field(default=40, ge=16, le=100)
    partner_employment_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    partner_student_loan_plan: Literal[household_impact.STUDENT_LOAN_PLANS] = (
        "NONE"
    )
    children: list[HouseholdChildRequest] = Field(
        default_factory=list, max_length=10
    )
    region: Literal[household_impact.REGIONS] = "LONDON"
    claims_universal_credit: bool = False
    tenure: Literal[household_impact.TENURES] = "OWNED_WITH_MORTGAGE"
    monthly_rent: float = Field(default=0, ge=0, le=100_000)
    brma: Optional[Literal[household_impact.BRMAS]] = Field(
        default=None,
        description=(
            "Broad Rental Market Area, for Local Housing Allowance. Left "
            "out: the region's BRMA with the most private-rented households "
            "(policyengine-uk's default)."
        ),
    )
    local_authority: Optional[Literal[household_impact.LOCAL_AUTHORITIES]] = (
        Field(
            default=None,
            description=(
                "Local authority. policyengine-uk reads it only for the few "
                "Council Tax Reduction schemes it models, so it matters only "
                "with council_tax entered; it does not choose the BRMA. Left "
                "out: a local authority in the region's default BRMA (none "
                "with a modelled working-age scheme)."
            ),
        )
    )
    council_tax: Optional[float] = Field(
        default=None,
        ge=0,
        le=100_000,
        description=(
            "Council Tax a year, as billed. Left out: estimated from "
            "council_tax_band and the region's average Band D for 2026-27, "
            "grown to the year (none in Northern Ireland)."
        ),
    )
    council_tax_band: Literal[household_impact.COUNCIL_TAX_BANDS] = "D"
    monthly_childcare: float = Field(
        default=0,
        ge=0,
        le=10_000,
        description="Childcare costs a month, with children only",
    )
    salary_year: int = Field(
        default=household_impact.SALARY_YEAR,
        description=(
            "The year the salaries are entered for; they are grown to the "
            "chosen year with the OBR average earnings index"
        ),
    )
    dividend_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    savings_interest_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    property_income: float = Field(default=0, ge=0, le=MAX_AMOUNT)
    private_pension_income: float = Field(
        default=0,
        ge=0,
        le=MAX_AMOUNT,
        description=(
            "Private and workplace pensions in payment, £ a year (not the "
            "State Pension), as policyengine-uk's private_pension_income"
        ),
    )
    partner_private_pension_income: float = Field(
        default=0, ge=0, le=MAX_AMOUNT
    )
    petrol_spending: float = Field(default=0, ge=0, le=100_000)
    diesel_spending: float = Field(default=0, ge=0, le=100_000)
    electricity_spending: float = Field(
        default=household_impact.ELECTRICITY_SPENDING,
        ge=0,
        le=100_000,
        description=(
            "Domestic electricity, £ a year including VAT, for the zero VAT "
            "on domestic electricity. Left out: the average UK household's, "
            "£20.00 a week (ONS, Family spending in the UK, April 2024 to "
            "March 2025, Table A1, 4.4.1)."
        ),
    )
    gas_spending: float = Field(
        default=household_impact.GAS_SPENDING,
        ge=0,
        le=100_000,
        description=(
            "Domestic mains gas, £ a year including VAT, for a measure that "
            "changes the VAT on domestic gas. Left out: the average UK "
            "household's, £14.10 a week (ONS, Family spending in the UK, "
            "April 2024 to March 2025, Table A1, 4.4.2)."
        ),
    )
    salary_sacrifice_pension_contributions: float = Field(
        default=0,
        ge=0,
        le=MAX_AMOUNT,
        description=(
            "Pension paid by salary sacrifice, £ a year. employment_income "
            "is pay after the sacrifice, as policyengine-uk reads it: the "
            "sacrifice changes no figure until the £2,000 cap from April "
            "2029, which returns the excess to pay"
        ),
    )
    state_pension: Optional[float] = Field(
        default=None,
        ge=0,
        le=100_000,
        description=(
            "State Pension, £ a year in the chosen year (not grown like the "
            "salary), read only at State Pension age. Left out: the full "
            "new State Pension for the chosen year, from policyengine-uk's "
            "parameter."
        ),
    )
    partner_state_pension: Optional[float] = Field(
        default=None,
        ge=0,
        le=100_000,
        description="The partner's State Pension, as state_pension",
    )

    def answers(self) -> household_impact.HouseholdAnswers:
        values = self.model_dump()
        values["children"] = tuple(
            household_impact.Child(**child) for child in values["children"]
        )
        return household_impact.HouseholdAnswers(**values)


class HouseholdImpactRequest(BaseModel):
    """A household, a policy year, and the measures to compare it under
    (every measure the calculation knows when none are named)."""

    model_config = {"extra": "forbid"}

    year: int
    policies: Optional[list[str]] = Field(default=None, min_length=1)
    household: HouseholdAnswersRequest = Field(
        default_factory=HouseholdAnswersRequest
    )
    include: list[Literal[household_impact.PARTS]] = Field(
        default_factory=lambda: list(household_impact.PARTS),
        description=(
            "The slower parts to compute besides the headline and the "
            "programmes: by_policy (one more run per measure) and sweep "
            "(two runs). Send [] for the headline alone, then ask for the "
            "rest."
        ),
    )

    @field_validator("household")
    @classmethod
    def _salary_year(cls, household: "HouseholdAnswersRequest"):
        if household.salary_year not in POLICY_YEARS:
            raise ValueError(
                f"household.salary_year: choose a year from "
                f"{POLICY_YEARS[0]} to {POLICY_YEARS[-1]}"
            )
        return household

    @model_validator(mode="after")
    def _salary_not_after_year(self):
        if self.household.salary_year > self.year:
            raise ValueError(
                "household.salary_year must not be after year: salaries are "
                "grown forward to the chosen year"
            )
        return self

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


@functools.lru_cache(maxsize=64)
def _cached_household_impact(request_json: str) -> dict:
    """Answers by request, so moving the year or measures back and forth
    reuses them. A refused request raises, and is not kept."""
    data = HouseholdImpactRequest.model_validate_json(request_json)
    return household_impact.calculate_household_impact(
        data.household.answers(),
        data.policies or household_impact.measure_ids(),
        data.year,
        include=tuple(data.include),
        workers=household_workers(),
    )


def _household_impact(
    data: HouseholdImpactRequest, requested: Optional[dict] = None
) -> dict:
    # Canonical JSON: the same request in another key order is one entry.
    # The definitions are not part of it: the answer doesn't depend on
    # them.
    key = json.dumps(data.model_dump(mode="json"), sort_keys=True)
    # Before the calculation: with one worker its runs share this process,
    # and a warning from a bound module would leave it unbindable
    # (uk_budget_data.definitions).
    bound = definitions.definitions_for(
        requested or {}, household_impact.measure_ids()
    )
    results = copy.deepcopy(_cached_household_impact(key))
    results["definitions"] = bound
    return results


@app.post("/api/household-impact")
async def calculate_household_impact(
    data: HouseholdImpactRequest,
    response: Response,
    definition: list[str] = Query(
        default=[],
        description=(
            "<measure id>:<commit>, once per measure: the commit its "
            "approved receipt was made at. The answer's definitions give "
            "each one's baseline and reform identities recomputed at that "
            "commit from this build's code, to compare with the receipt "
            "(uk_budget_data.definitions). A query parameter, so the body "
            "a build without them refuses is unchanged."
        ),
    ),
):
    """One household's net income in one year before and after the
    selected measures: the headline, each measure's own effect and the
    interaction residual, the programmes, and the earnings sweep, with the
    definitions named in ``definition`` (always present; empty when none
    are named).

    Runs in a worker thread, so ``/api/health`` keeps answering, through
    its own limiter (``HOUSEHOLD_REQUESTS``): several requests at once
    share the instance's worker processes run by run
    (``personal_impact.FairSlots``), so none waits for another's whole
    calculation and the processes, and so memory, stay bounded. A
    calculation that passes its time limit is a 504. Out-of-range answers
    are refused with a 422 naming the field.
    """
    try:
        requested = definitions.parse_requested(definition)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        received = time.perf_counter()
        results, calculating = await anyio.to_thread.run_sync(
            timed,
            functools.partial(_household_impact, requested=requested),
            data,
            limiter=HOUSEHOLD_REQUESTS,
        )
        response.headers["Server-Timing"] = server_timing(
            calculating,
            time.perf_counter() - received - calculating,
            memory_peak_bytes(),
        )
        return results
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(
            status_code=504, detail=f"Calculation timed out: {e}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/version")
async def version():
    """Report this build's identity for deployed-route household checks."""
    return runtime_identity()


def main():
    """Run the FastAPI server with uvicorn."""
    import uvicorn

    port = int(os.environ.get("PORT", 5001))
    print(f"Starting UK Budget Personal Impact API on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
