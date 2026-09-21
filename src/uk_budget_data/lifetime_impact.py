"""Lifetime impact calculator for UK Autumn Budget 2026 policies.

Models how budget policies affect an individual graduate over their working life,
including earnings growth, life events (marriage, children), and reform impacts.

Based on IFS lifetime earnings research methodology.
"""

from dataclasses import dataclass, field
from typing import Literal

import pandas as pd
from policyengine_uk import Simulation
from rich.console import Console
from rich.table import Table

from uk_budget_data.reforms import get_autumn_budget_2026_reforms

# Graduate starting income by percentile (age 22, 2025 prices)
# Based on IFS research on graduate earnings
GRADUATE_STARTING_INCOME = {
    "p25": 21_000,
    "p50": 26_000,
    "p75": 31_000,
    "p90": 40_000,
}

# Age-earnings profile multipliers (relative to age 22 = 1.0)
# Based on IFS lifetime earnings research showing strong growth until mid-40s
# then plateau and slight decline
AGE_EARNINGS_MULTIPLIERS = {
    22: 1.00,
    25: 1.15,
    30: 1.45,
    35: 1.75,
    40: 2.00,
    45: 2.15,
    50: 2.20,
    55: 2.15,
    60: 2.05,
    65: 1.95,
    67: 1.90,  # Retirement age
}

# Student loan plan 2 parameters (post-2012 loans)
STUDENT_LOAN_THRESHOLD_2025 = 27_295  # Frozen until 2027
STUDENT_LOAN_RATE = 0.09  # 9% above threshold
# Interest: RPI + 0-3% depending on income. Average around 4.5% for mid-earners
STUDENT_LOAN_INTEREST_RATE = 0.045
# Plan 2 loans written off 40 years after first repayment due (usually age ~62)
STUDENT_LOAN_WRITE_OFF_YEARS = 40

# Rail fare baseline increases (without freeze)
RAIL_FARE_INCREASES = {
    2026: 0.058,  # 5.8%
    2027: 0.042,
    2028: 0.039,
    2029: 0.039,
}


@dataclass
class LifetimeInputs:
    """Input parameters for lifetime impact calculation."""

    # Income profile
    income_percentile: Literal["p25", "p50", "p75", "p90"] = "p50"
    starting_income: float | None = None  # Override starting income
    income_growth_rate: float = 0.02  # Real annual growth above profile

    # Life events
    graduation_age: int = 22
    retirement_age: int = 67
    marriage_age: int | None = 31
    children_ages_at_birth: list[int] = field(
        default_factory=lambda: [0, 2]
    )  # Ages relative to first child

    # Student loan
    student_loan_balance: float = 45_000  # Average graduate debt ~£45k
    has_plan_2_loan: bool = True

    # Spending patterns (annual amounts, 2025 prices)
    salary_sacrifice_amount: float = 0  # Annual pension via salary sacrifice
    rail_spending: float = 1_500  # Average commuter ~£1,500/year
    fuel_spending: float = 1_200  # Average driver ~£1,200/year

    # Investment income (annual amounts)
    dividend_income: float = 0
    savings_interest: float = 500  # Modest savings
    property_income: float = 0

    # Simulation years
    start_year: int = 2025
    end_year: int = 2060  # 35 years from graduation


@dataclass
class YearResult:
    """Results for a single year."""

    year: int
    age: int
    employment_income: float
    is_married: bool
    num_children: int
    children_ages: list[int]

    # Net income
    baseline_net_income: float
    reformed_net_income: float

    # Policy impacts (positive = gain from reform)
    two_child_limit_impact: float = 0
    fuel_duty_freeze_impact: float = 0
    rail_fares_freeze_impact: float = 0
    threshold_freeze_impact: float = 0
    dividend_tax_impact: float = 0
    savings_tax_impact: float = 0
    property_tax_impact: float = 0
    salary_sacrifice_cap_impact: float = 0
    student_loan_threshold_impact: float = 0

    # Student loan
    student_loan_repayment: float = 0
    student_loan_balance_start: float = 0
    student_loan_balance_end: float = 0

    @property
    def total_policy_impact(self) -> float:
        """Total impact of all policies."""
        return (
            self.two_child_limit_impact
            + self.fuel_duty_freeze_impact
            + self.rail_fares_freeze_impact
            + self.threshold_freeze_impact
            + self.dividend_tax_impact
            + self.savings_tax_impact
            + self.property_tax_impact
            + self.salary_sacrifice_cap_impact
            + self.student_loan_threshold_impact
        )


def interpolate_earnings_multiplier(age: int) -> float:
    """Interpolate earnings multiplier for any age."""
    ages = sorted(AGE_EARNINGS_MULTIPLIERS.keys())

    if age <= ages[0]:
        return AGE_EARNINGS_MULTIPLIERS[ages[0]]
    if age >= ages[-1]:
        return AGE_EARNINGS_MULTIPLIERS[ages[-1]]

    # Find surrounding ages
    for i in range(len(ages) - 1):
        if ages[i] <= age < ages[i + 1]:
            lower_age, upper_age = ages[i], ages[i + 1]
            lower_mult = AGE_EARNINGS_MULTIPLIERS[lower_age]
            upper_mult = AGE_EARNINGS_MULTIPLIERS[upper_age]
            # Linear interpolation
            ratio = (age - lower_age) / (upper_age - lower_age)
            return lower_mult + ratio * (upper_mult - lower_mult)

    return 1.0


def calculate_student_loan_repayment(
    gross_income: float,
    loan_balance: float,
    threshold: float = STUDENT_LOAN_THRESHOLD_2025,
    rate: float = STUDENT_LOAN_RATE,
) -> tuple[float, float]:
    """Calculate student loan repayment and interest.

    Returns:
        Tuple of (repayment, interest_accrued)
    """
    if loan_balance <= 0:
        return 0.0, 0.0

    income_above_threshold = max(0, gross_income - threshold)
    repayment = income_above_threshold * rate
    repayment = min(repayment, loan_balance)

    interest = loan_balance * STUDENT_LOAN_INTEREST_RATE

    return repayment, interest


def build_lifetime_situation(
    inputs: LifetimeInputs,
    year: int,
    age: int,
    employment_income: float,
    is_married: bool,
    children_ages: list[int],
) -> dict:
    """Build a PolicyEngine situation for a given year."""
    people = {
        "adult": {
            "age": {year: age},
            "employment_income": {year: employment_income},
            "savings_interest_income": {year: inputs.savings_interest},
            "property_income": {year: inputs.property_income},
            "dividend_income": {year: inputs.dividend_income},
        }
    }

    if inputs.salary_sacrifice_amount > 0:
        people["adult"]["pension_contributions_via_salary_sacrifice"] = {
            year: inputs.salary_sacrifice_amount
        }

    benunit_members = ["adult"]
    household_members = ["adult"]

    # Add spouse if married
    if is_married:
        # Spouse earns 70% of main earner (typical pattern)
        spouse_income = employment_income * 0.7
        people["partner"] = {
            "age": {year: age - 2},  # Slightly younger
            "employment_income": {year: spouse_income},
        }
        benunit_members.append("partner")
        household_members.append("partner")

    # Add children
    for i, child_age in enumerate(children_ages):
        if 0 <= child_age < 18:  # Only dependent children
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
                "region": {year: "LONDON"},
            }
        },
    }


class LifetimeImpactCalculator:
    """Calculator for lifetime policy impacts."""

    def __init__(self, verbose: bool = True):
        """Initialise calculator."""
        self.verbose = verbose
        self.console = Console() if verbose else None
        self.reforms = {
            r.id: r
            for r in get_autumn_budget_2026_reforms()
            if r.id != "autumn_budget_2026_combined"
        }

    def _log(self, message: str) -> None:
        """Log a message if verbose."""
        if self.console:
            self.console.print(message)

    def calculate(self, inputs: LifetimeInputs) -> pd.DataFrame:
        """Calculate lifetime policy impacts.

        Args:
            inputs: Lifetime calculation inputs.

        Returns:
            DataFrame with row for each year containing all impacts.
        """
        self._log("[bold]Calculating lifetime impact[/bold]")
        self._log(f"  Income percentile: {inputs.income_percentile}")
        self._log(f"  Marriage age: {inputs.marriage_age or 'Never'}")
        self._log(f"  Children: {len(inputs.children_ages_at_birth)}")

        # Determine starting income
        if inputs.starting_income is not None:
            starting_income = inputs.starting_income
        else:
            starting_income = GRADUATE_STARTING_INCOME[
                inputs.income_percentile
            ]

        results: list[YearResult] = []
        student_loan_balance = (
            inputs.student_loan_balance if inputs.has_plan_2_loan else 0
        )

        # Track when first child is born
        first_child_year = None
        if inputs.marriage_age and inputs.children_ages_at_birth:
            # First child typically 2 years after marriage
            first_child_year = (
                inputs.start_year
                + (inputs.marriage_age - inputs.graduation_age)
                + 2
            )

        for year in range(inputs.start_year, inputs.end_year + 1):
            age = inputs.graduation_age + (year - inputs.start_year)

            if age > inputs.retirement_age:
                break

            # Calculate employment income
            base_multiplier = interpolate_earnings_multiplier(age)
            years_growth = (1 + inputs.income_growth_rate) ** (
                year - inputs.start_year
            )
            employment_income = (
                starting_income * base_multiplier * years_growth
            )

            # Determine life events
            is_married = (
                inputs.marriage_age is not None and age >= inputs.marriage_age
            )

            # Calculate children's ages
            children_ages = []
            if first_child_year and year >= first_child_year:
                years_since_first = year - first_child_year
                for relative_age in inputs.children_ages_at_birth:
                    child_age = years_since_first - relative_age
                    if child_age >= 0:  # Child has been born
                        children_ages.append(child_age)

            # Student loan calculations
            # Write off after 40 years from graduation (age 22 + 40 = 62)
            years_since_graduation = age - inputs.graduation_age
            loan_written_off = (
                years_since_graduation >= STUDENT_LOAN_WRITE_OFF_YEARS
            )

            if student_loan_balance > 0 and not loan_written_off:
                repayment, interest = calculate_student_loan_repayment(
                    employment_income, student_loan_balance
                )
                new_balance = student_loan_balance + interest - repayment
                new_balance = max(0, new_balance)
            else:
                repayment = 0
                new_balance = 0

            # Build situation
            situation = build_lifetime_situation(
                inputs, year, age, employment_income, is_married, children_ages
            )

            # Calculate baseline and reformed net income
            # For years where PE-UK has data (2025-2029), use full simulation
            # For future years, extrapolate from 2029 patterns
            sim_year = min(year, 2029)

            baseline_sim = Simulation(situation=situation)
            baseline_net = float(
                baseline_sim.calculate("household_net_income", sim_year)[0]
            )

            # Create result
            result = YearResult(
                year=year,
                age=age,
                employment_income=employment_income,
                is_married=is_married,
                num_children=len(children_ages),
                children_ages=children_ages.copy(),
                baseline_net_income=baseline_net,
                reformed_net_income=baseline_net,  # Will be updated
                student_loan_repayment=repayment,
                student_loan_balance_start=student_loan_balance,
                student_loan_balance_end=new_balance,
            )

            # Calculate individual policy impacts
            self._calculate_policy_impacts(result, inputs, situation, sim_year)

            # Update reformed net income
            result.reformed_net_income = (
                baseline_net + result.total_policy_impact
            )

            results.append(result)
            student_loan_balance = new_balance

            if self.verbose and year <= inputs.start_year + 5:
                self._log(
                    f"  {year}: Age {age}, Income £{employment_income:,.0f}, "
                    f"Impact £{result.total_policy_impact:,.0f}"
                )

        # Convert to DataFrame
        df = pd.DataFrame([vars(r) for r in results])

        # Add summary statistics
        if self.verbose:
            self._print_summary(df, inputs)

        return df

    def _calculate_policy_impacts(
        self,
        result: YearResult,
        inputs: LifetimeInputs,
        situation: dict,
        year: int,
    ) -> None:
        """Calculate impact of each policy for a year."""
        # Two child limit repeal - affects families with 3+ children who claim UC/TC
        # Note: Most graduates won't benefit as their incomes exceed UC thresholds
        # Only applicable for very low earners (p25 or below, single parent)
        if result.num_children >= 3:
            # UC eligibility roughly ends around £40k for families
            # More generous threshold for single parents
            income_threshold = 35_000 if not result.is_married else 25_000

            if result.employment_income < income_threshold:
                extra_children = result.num_children - 2
                # UC child element ~£3,300/year, but tapers at 55%
                # Estimate net gain ~£1,500 per child for working families
                result.two_child_limit_impact = extra_children * 1500

        # Fuel duty freeze - affects those with fuel spending
        # Autumn Budget extends 5p cut until Sep 2026, then staggered reversal
        # Without budget: 5p cut would have ended Mar 2026
        # Benefit is mainly in 2026 (full year of 5p), then diminishing
        if inputs.fuel_spending > 0:
            litres_per_year = inputs.fuel_spending / 1.40
            if year == 2026:
                result.fuel_duty_freeze_impact = (
                    litres_per_year * 0.05
                )  # Full 5p saving
            elif year == 2027:
                result.fuel_duty_freeze_impact = (
                    litres_per_year * 0.02
                )  # Reduced benefit
            # No benefit from 2028+ as rates converge

        # Rail fares freeze - one-year freeze in 2026 only
        if inputs.rail_spending > 0 and year == 2026:
            # The freeze is only for one year (March 2026)
            # Saves the 5.8% increase that would have happened
            result.rail_fares_freeze_impact = (
                inputs.rail_spending * RAIL_FARE_INCREASES[2026]
            )

        # Threshold freeze extension - affects most earners (2028+)
        if year >= 2028:
            reform = self.reforms.get("threshold_freeze_extension")
            if reform:
                result.threshold_freeze_impact = (
                    self._calculate_single_reform_impact(
                        situation, year, reform
                    )
                )

        # Dividend tax increase
        if inputs.dividend_income > 0 and year >= 2026:
            # 2pp increase on dividends
            # Effective rate increase depends on tax band
            result.dividend_tax_impact = -inputs.dividend_income * 0.02

        # Savings tax increase
        if inputs.savings_interest > 0 and year >= 2027:
            # 2pp increase on savings above allowance
            # Only applies above £1000 allowance (basic rate) or £500 (higher)
            taxable_savings = max(0, inputs.savings_interest - 1000)
            result.savings_tax_impact = -taxable_savings * 0.02

        # Property tax increase
        if inputs.property_income > 0 and year >= 2027:
            result.property_tax_impact = -inputs.property_income * 0.02

        # Salary sacrifice cap (from 2029)
        if inputs.salary_sacrifice_amount > 2000 and year >= 2029:
            reform = self.reforms.get("salary_sacrifice_cap")
            if reform:
                result.salary_sacrifice_cap_impact = (
                    self._calculate_single_reform_impact(
                        situation, year, reform
                    )
                )

        # Student loan threshold freeze
        # The threshold freeze means higher repayments than if thresholds rose with inflation
        if result.student_loan_balance_start > 0 and year <= 2027:
            # Without freeze, threshold would rise ~3% per year
            unfrozen_threshold = STUDENT_LOAN_THRESHOLD_2025 * (
                1.03 ** (year - 2025)
            )
            # Extra repayment due to frozen threshold
            extra_income_above = max(
                0, unfrozen_threshold - STUDENT_LOAN_THRESHOLD_2025
            )
            result.student_loan_threshold_impact = (
                -extra_income_above * STUDENT_LOAN_RATE
            )

    def _calculate_single_reform_impact(
        self,
        situation: dict,
        year: int,
        reform,
    ) -> float:
        """Calculate net income impact of a single reform."""
        from uk_budget_data.personal_impact import create_simulation

        try:
            if reform.has_custom_baseline():
                baseline_sim = create_simulation(
                    situation,
                    year,
                    reform_param_changes=reform.baseline_parameter_changes,
                    simulation_modifier=reform.baseline_simulation_modifier,
                )
            else:
                baseline_sim = Simulation(situation=situation)

            reform_sim = create_simulation(
                situation,
                year,
                reform_param_changes=reform.parameter_changes,
                simulation_modifier=reform.simulation_modifier,
            )

            baseline_net = float(
                baseline_sim.calculate("household_net_income", year)[0]
            )
            reform_net = float(
                reform_sim.calculate("household_net_income", year)[0]
            )

            return reform_net - baseline_net
        except Exception:
            return 0.0

    def _print_summary(self, df: pd.DataFrame, inputs: LifetimeInputs) -> None:
        """Print summary statistics."""
        table = Table(title="Lifetime impact summary")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right", style="green")

        # Calculate total impact from component columns
        total_impact = (
            df["two_child_limit_impact"].sum()
            + df["fuel_duty_freeze_impact"].sum()
            + df["rail_fares_freeze_impact"].sum()
            + df["threshold_freeze_impact"].sum()
            + df["dividend_tax_impact"].sum()
            + df["savings_tax_impact"].sum()
            + df["property_tax_impact"].sum()
            + df["salary_sacrifice_cap_impact"].sum()
            + df["student_loan_threshold_impact"].sum()
        )

        # Calculate component totals
        components = {
            "2 child limit": df["two_child_limit_impact"].sum(),
            "Fuel duty freeze": df["fuel_duty_freeze_impact"].sum(),
            "Rail fares freeze": df["rail_fares_freeze_impact"].sum(),
            "Threshold freeze": df["threshold_freeze_impact"].sum(),
            "Dividend tax": df["dividend_tax_impact"].sum(),
            "Savings tax": df["savings_tax_impact"].sum(),
            "Property tax": df["property_tax_impact"].sum(),
            "Salary sacrifice cap": df["salary_sacrifice_cap_impact"].sum(),
            "Student loan threshold": df[
                "student_loan_threshold_impact"
            ].sum(),
        }

        table.add_row("Years modelled", str(len(df)))
        table.add_row("Total lifetime impact", f"£{total_impact:,.0f}")
        table.add_row("", "")

        for name, value in components.items():
            if abs(value) > 1:
                table.add_row(f"  {name}", f"£{value:,.0f}")

        table.add_row("", "")
        table.add_row(
            "Peak earnings year",
            str(df.loc[df["employment_income"].idxmax(), "year"]),
        )
        table.add_row(
            "Peak earnings",
            f"£{df['employment_income'].max():,.0f}",
        )

        if inputs.has_plan_2_loan:
            final_balance = df["student_loan_balance_end"].iloc[-1]
            total_repaid = df["student_loan_repayment"].sum()
            table.add_row("Student loan repaid", f"£{total_repaid:,.0f}")
            table.add_row("Final loan balance", f"£{final_balance:,.0f}")

        self.console.print(table)


def calculate_lifetime_impact(
    income_percentile: str = "p50",
    marriage_age: int | None = 31,
    num_children: int = 2,
    student_loan_balance: float = 45_000,
    salary_sacrifice: float = 0,
    rail_spending: float = 1_500,
    fuel_spending: float = 1_200,
    dividend_income: float = 0,
    savings_interest: float = 500,
    property_income: float = 0,
    verbose: bool = True,
) -> pd.DataFrame:
    """Convenience function to calculate lifetime impact with common defaults.

    Args:
        income_percentile: Starting income percentile (p25, p50, p75, p90).
        marriage_age: Age of marriage (None for never married).
        num_children: Number of children (born every 2 years after marriage).
        student_loan_balance: Starting student loan debt.
        salary_sacrifice: Annual salary sacrifice pension contributions.
        rail_spending: Annual rail spending.
        fuel_spending: Annual fuel spending.
        dividend_income: Annual dividend income.
        savings_interest: Annual savings interest.
        property_income: Annual property income.
        verbose: Whether to print progress.

    Returns:
        DataFrame with year-by-year results.
    """
    # Build children ages (born every 2 years starting 2 years after marriage)
    children_ages = [i * 2 for i in range(num_children)]

    inputs = LifetimeInputs(
        income_percentile=income_percentile,
        marriage_age=marriage_age,
        children_ages_at_birth=children_ages,
        student_loan_balance=student_loan_balance,
        salary_sacrifice_amount=salary_sacrifice,
        rail_spending=rail_spending,
        fuel_spending=fuel_spending,
        dividend_income=dividend_income,
        savings_interest=savings_interest,
        property_income=property_income,
    )

    calculator = LifetimeImpactCalculator(verbose=verbose)
    return calculator.calculate(inputs)


if __name__ == "__main__":
    # Example usage
    df = calculate_lifetime_impact(
        income_percentile="p50",
        marriage_age=31,
        num_children=2,
        verbose=True,
    )

    # Save to CSV
    df.to_csv("lifetime_impact.csv", index=False)
    print(f"\nSaved {len(df)} years to lifetime_impact.csv")
