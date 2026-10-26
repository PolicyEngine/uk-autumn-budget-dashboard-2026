"""Metric calculators for UK Budget Data pipeline.

Each calculator is responsible for computing a specific type of metric
from baseline and reformed microsimulation results.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from microdf import MicroDataFrame, MicroSeries

from uk_budget_data.budget_years import POLICY_YEARS


def _as_weighted(df) -> MicroDataFrame:
    """Return df as a MicroDataFrame weighted by household_weight.

    Calculators rely on microdf's weighted reductions, so a plain DataFrame
    reaching them would silently produce unweighted results.
    """
    if isinstance(df, MicroDataFrame):
        return df
    if "household_weight" not in df.columns:
        raise KeyError(
            "decile frame must carry a household_weight column to be "
            "weighted; got columns: " + ", ".join(map(str, df.columns))
        )
    return MicroDataFrame(df, weights="household_weight")


class BaseCalculator(ABC):
    """Base class for all metric calculators."""

    @abstractmethod
    def calculate(self, *args, **kwargs) -> list[dict]:
        """Calculate metrics and return as list of dicts."""
        pass


@dataclass
class BudgetaryImpactCalculator(BaseCalculator):
    """Calculates budgetary impact (cost/revenue) of reforms."""

    years: list[int] = field(default_factory=lambda: list(POLICY_YEARS))

    # Reforms that use student_loan_repayments_modelled instead of gov_balance
    STUDENT_LOAN_REFORMS = ["plan_2_threshold_unfreeze"]

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
    ) -> list[dict]:
        """Calculate budgetary impact from microsimulations.

        Args:
            baseline: Baseline Microsimulation object.
            reformed: Reformed Microsimulation object.
            reform_id: Unique identifier for the reform.
            reform_name: Human-readable reform name.

        Returns:
            List of dicts with year, value (in billions).
        """
        results = []
        for year in self.years:
            # Special case for student loan reforms: use student_loan_repayment
            # (policyengine-uk's calculated variable using threshold parameters)
            if reform_id in self.STUDENT_LOAN_REFORMS:
                baseline_repayments = baseline.calculate(
                    "student_loan_repayment", period=year
                )
                reformed_repayments = reformed.calculate(
                    "student_loan_repayment", period=year
                )
                # Revenue = reformed - baseline (frozen thresholds = more repayments)
                impact = (
                    reformed_repayments - baseline_repayments
                ).sum() / 1e9
            else:
                baseline_balance = baseline.calculate(
                    "gov_balance", period=year
                )
                reformed_balance = reformed.calculate(
                    "gov_balance", period=year
                )
                impact = (reformed_balance - baseline_balance).sum() / 1e9
            results.append(
                {
                    "reform_id": reform_id,
                    "reform_name": reform_name,
                    "year": year,
                    "value": impact,
                }
            )
        return results

    def calculate_from_values(
        self,
        reform_id: str,
        reform_name: str,
        baseline_balances: dict[int, float],
        reformed_balances: dict[int, float],
    ) -> list[dict]:
        """Calculate from pre-computed balance values (for testing).

        Args:
            reform_id: Unique identifier for the reform.
            reform_name: Human-readable reform name.
            baseline_balances: {year: balance} dict for baseline.
            reformed_balances: {year: balance} dict for reformed.

        Returns:
            List of dicts with year, value (in billions).
        """
        results = []
        for year in self.years:
            if year in baseline_balances and year in reformed_balances:
                impact = (
                    reformed_balances[year] - baseline_balances[year]
                ) / 1e9
                results.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "value": impact,
                    }
                )
        return results


@dataclass
class DistributionalImpactCalculator(BaseCalculator):
    """Calculates distributional impact by income decile."""

    decile_names: list[str] = field(
        default_factory=lambda: [
            "1st",
            "2nd",
            "3rd",
            "4th",
            "5th",
            "6th",
            "7th",
            "8th",
            "9th",
            "10th",
        ]
    )

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> tuple[list[dict], pd.DataFrame]:
        """Calculate distributional impact from microsimulations.

        Returns both the results list and the intermediate DataFrame
        for use by other calculators.
        """
        baseline_income = baseline.calculate(
            "household_net_income", period=year, map_to="household"
        )
        reform_income = reformed.calculate(
            "household_net_income", period=year, map_to="household"
        )
        household_decile = baseline.calculate(
            "household_income_decile", period=year, map_to="household"
        )
        household_weight = baseline.calculate(
            "household_weight", period=year, map_to="household"
        )

        decile_df = MicroDataFrame(
            {
                "household_income_decile": household_decile.values,
                "baseline_income": baseline_income.values,
                "reform_income": reform_income.values,
                "income_change": (reform_income - baseline_income).values,
                "household_weight": household_weight.values,
            },
            weights="household_weight",
        )
        decile_df = decile_df[decile_df["household_income_decile"] >= 1]

        results = self.calculate_from_dataframe(
            reform_id, reform_name, year, decile_df
        )
        return results, decile_df

    def calculate_from_dataframe(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        decile_df: pd.DataFrame,
    ) -> list[dict]:
        """Calculate from a pre-built decile DataFrame (for testing)."""
        decile_df = _as_weighted(decile_df)
        results = []

        for decile_num in range(1, 11):
            decile_data = decile_df[
                decile_df["household_income_decile"] == decile_num
            ]
            if len(decile_data) > 0:
                # MicroDataFrame columns are weighted, so sum() is already
                # the weighted total.
                weighted_change = decile_data["income_change"].sum()
                weighted_baseline = decile_data["baseline_income"].sum()
                if weighted_baseline <= 0:
                    raise ValueError(
                        f"Decile {decile_num} has non-positive weighted "
                        f"baseline income ({weighted_baseline}) in {year}; "
                        "a relative change is undefined."
                    )
                rel_change = (weighted_change / weighted_baseline) * 100
                results.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "decile": self.decile_names[decile_num - 1],
                        "value": rel_change,
                    }
                )

        return results


@dataclass
class WinnersLosersCalculator(BaseCalculator):
    """Calculates average gains/losses by decile."""

    def calculate(
        self,
        decile_df: pd.DataFrame,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> list[dict]:
        """Calculate from a decile DataFrame."""
        return self.calculate_from_dataframe(
            reform_id, reform_name, year, decile_df
        )

    def calculate_from_dataframe(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        decile_df: pd.DataFrame,
    ) -> list[dict]:
        """Calculate weighted average change per decile."""
        decile_df = _as_weighted(decile_df)
        results = []

        for decile_num in range(1, 11):
            decile_data = decile_df[
                decile_df["household_income_decile"] == decile_num
            ]
            if len(decile_data) > 0:
                # Weighted total over weighted household count is exactly
                # the weighted mean microdf already computes.
                avg_change = decile_data["income_change"].mean()
                results.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "decile": str(decile_num),
                        "avg_change": avg_change,
                    }
                )

        # Overall average
        overall_avg = decile_df["income_change"].mean()
        results.append(
            {
                "reform_id": reform_id,
                "reform_name": reform_name,
                "year": year,
                "decile": "all",
                "avg_change": overall_avg,
            }
        )

        return results


# Poverty measures published beside the headline (``poverty_change_*``,
# absolute before housing costs, kept for older readers). Each is a
# policyengine-uk household flag, read per person. The absolute lines are
# 60% of the FYE 2025 median held constant in real terms; the relative
# lines are 60% of the median in the same simulation, so under a reform the
# line moves with the reform's own median (policyengine-uk 2.132.6,
# in_relative_poverty_bhc / _ahc).
POVERTY_MEASURES = {
    "abs_bhc": "in_poverty_bhc",
    "abs_ahc": "in_poverty_ahc",
    "rel_bhc": "in_relative_poverty_bhc",
    "rel_ahc": "in_relative_poverty_ahc",
}
# People in the poverty columns: everyone, and HBAI dependent children
# (is_hbai_dependent_child: under 16, or 16-19 in non-advanced education and
# living with a parent), as DWP's child poverty statistics count them.
POVERTY_GROUPS = {"": None, "child_": "is_hbai_dependent_child"}


def poverty_change(
    baseline_flag: np.ndarray,
    reformed_flag: np.ndarray,
    person_weight: np.ndarray,
    in_group: Optional[np.ndarray] = None,
    label: str = "poverty",
) -> tuple[float, float]:
    """Change in a weighted poverty rate: (percentage points, % of baseline).

    ``in_group`` restricts the rate to some people (children); the rate's
    denominator is that group's weighted count.
    """
    weight = np.asarray(person_weight, dtype=float)
    if in_group is not None:
        weight = weight * np.asarray(in_group, dtype=bool)
    total = weight.sum()
    if total <= 0:
        raise ValueError(f"No weighted people for {label}.")
    baseline_rate = weight[np.asarray(baseline_flag, dtype=bool)].sum() / total
    reformed_rate = weight[np.asarray(reformed_flag, dtype=bool)].sum() / total
    if baseline_rate <= 0:
        raise ValueError(
            f"Baseline {label} rate is 0; a relative change is undefined."
        )
    change_pp = (reformed_rate - baseline_rate) * 100
    return change_pp, (reformed_rate - baseline_rate) / baseline_rate * 100


def inequality_measures(income: np.ndarray, weights: np.ndarray) -> dict:
    """Gini, top 10% and top 1% shares and the 90/10 ratio of an income.

    The income and weights are those of the headline Gini: equivalised
    household net income floored at zero, each household weighted by its
    people. The 90/10 ratio is the 90th percentile over the 10th.
    """
    series = MicroSeries(np.asarray(income, dtype=float), weights=weights)
    p10 = series.quantile(0.1)
    if p10 <= 0:
        raise ValueError(
            "The 10th percentile is 0; the 90/10 ratio is undefined."
        )
    return {
        "gini": series.gini(),
        "top_10_share": series.top_x_pct_share(0.1),
        "top_1_share": series.top_x_pct_share(0.01),
        "p90_p10": series.quantile(0.9) / p10,
    }


def inequality_changes(baseline: dict, reformed: dict) -> dict:
    """Columns for metrics.csv: the shares' change in percentage points and
    the 90/10 ratio's relative change (a fraction, as ``gini_change``)."""
    return {
        "top_10_share_change_pp": (
            reformed["top_10_share"] - baseline["top_10_share"]
        )
        * 100,
        "top_1_share_change_pp": (
            reformed["top_1_share"] - baseline["top_1_share"]
        )
        * 100,
        "p90_p10_change": (reformed["p90_p10"] - baseline["p90_p10"])
        / baseline["p90_p10"],
    }


@dataclass
class MetricsCalculator(BaseCalculator):
    """Calculates summary metrics (affected %, Gini, poverty)."""

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> list[dict]:
        """Calculate summary metrics from microsimulations."""

        # Calculate people affected
        baseline_income = baseline.calculate(
            "household_net_income", period=year, map_to="household"
        )
        reform_income = reformed.calculate(
            "household_net_income", period=year, map_to="household"
        )
        household_decile = baseline.calculate(
            "household_income_decile", period=year, map_to="household"
        )
        household_count = baseline.calculate(
            "household_count_people", period=year, map_to="household"
        )
        household_weight = baseline.calculate(
            "household_weight", period=year, map_to="household"
        )

        income_change = reform_income - baseline_income
        capped_baseline = np.maximum(baseline_income.values, 1)
        income_change_pct = income_change.values / capped_baseline

        # People per household, weighted natively by microdf.
        people = MicroSeries(
            household_count.values, weights=household_weight.values
        )
        income_changed = np.abs(income_change_pct) > 0.0001
        valid_deciles = household_decile.values >= 1

        people_affected = people[income_changed & valid_deciles].sum()
        total_people = people[valid_deciles].sum()
        if total_people <= 0:
            raise ValueError(
                f"No weighted population in valid deciles for {year}; "
                "cannot compute the share of people affected."
            )
        percent_affected = (people_affected / total_people) * 100

        # Calculate Gini change
        baseline_equiv = baseline.calculate(
            "equiv_household_net_income", period=year, map_to="household"
        )
        reformed_equiv = reformed.calculate(
            "equiv_household_net_income", period=year, map_to="household"
        )
        hh_count = baseline.calculate(
            "household_count_people", period=year, map_to="household"
        )
        hh_weight = baseline.calculate(
            "household_weight", period=year, map_to="household"
        )

        baseline_equiv_values = np.maximum(baseline_equiv.values, 0)
        reformed_equiv_values = np.maximum(reformed_equiv.values, 0)
        adjusted_weights = hh_weight.values * hh_count.values

        baseline_gini = MicroSeries(
            baseline_equiv_values, weights=adjusted_weights
        ).gini()
        reformed_gini = MicroSeries(
            reformed_equiv_values, weights=adjusted_weights
        ).gini()
        gini_change = (reformed_gini - baseline_gini) / baseline_gini

        # Calculate poverty change
        baseline_poverty = baseline.calculate(
            "in_poverty_bhc", period=year, map_to="person"
        ).values
        reformed_poverty = reformed.calculate(
            "in_poverty_bhc", period=year, map_to="person"
        ).values
        person_weight = baseline.calculate(
            "person_weight", period=year, map_to="person"
        ).values

        baseline_rate = (
            person_weight[baseline_poverty].sum() / person_weight.sum()
        ) * 100
        reformed_rate = (
            person_weight[reformed_poverty].sum() / person_weight.sum()
        ) * 100

        poverty_pp = reformed_rate - baseline_rate
        if baseline_rate <= 0:
            raise ValueError(
                f"Baseline poverty rate is {baseline_rate} for {reform_id} "
                f"in {year}; a relative poverty change is undefined."
            )
        poverty_pct = (poverty_pp / baseline_rate) * 100

        row = {
            "reform_id": reform_id,
            "reform_name": reform_name,
            "year": year,
            "people_affected": percent_affected,
            "gini_change": gini_change,
            "poverty_change_pp": poverty_pp,
            "poverty_change_pct": poverty_pct,
        }

        # Every poverty measure, for everyone and for children
        groups = {
            prefix: (
                None
                if flag is None
                else baseline.calculate(
                    flag, period=year, map_to="person"
                ).values.astype(bool)
            )
            for prefix, flag in POVERTY_GROUPS.items()
        }
        for measure, variable in POVERTY_MEASURES.items():
            before = baseline.calculate(
                variable, period=year, map_to="person"
            ).values
            after = reformed.calculate(
                variable, period=year, map_to="person"
            ).values
            for prefix, in_group in groups.items():
                pp, pct = poverty_change(
                    before,
                    after,
                    person_weight,
                    in_group,
                    label=f"{prefix}{variable} ({reform_id}, {year})",
                )
                row[f"{prefix}poverty_{measure}_change_pp"] = pp
                row[f"{prefix}poverty_{measure}_change_pct"] = pct

        # The other inequality measures, on the Gini's income and weights
        row.update(
            inequality_changes(
                inequality_measures(baseline_equiv_values, adjusted_weights),
                inequality_measures(reformed_equiv_values, adjusted_weights),
            )
        )
        return [row]

    def calculate_from_values(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        percent_affected: float,
        gini_change: float,
        poverty_change_pp: float,
        poverty_change_pct: float,
    ) -> list[dict]:
        """Create metrics from pre-computed values (for testing)."""
        return [
            {
                "reform_id": reform_id,
                "reform_name": reform_name,
                "year": year,
                "people_affected": percent_affected,
                "gini_change": gini_change,
                "poverty_change_pp": poverty_change_pp,
                "poverty_change_pct": poverty_change_pct,
            }
        ]


@dataclass
class IncomeCurveCalculator(BaseCalculator):
    """Net income of the example households across one income each.

    For each household in ``example_households.EXAMPLE_HOUSEHOLDS``, its
    net income before and after a measure at each point on its income grid
    (employment income, or private pension income for the pensioners). One
    simulation per household and scenario answers every year: the grid is
    set in every year at once (``example_households.build_situation``).
    """

    num_points: int = 201

    def simulate(self, household, scenario, years: list[int]) -> dict:
        """``{year: household net income at each grid point}`` under
        ``scenario`` (None for current law)."""
        from policyengine_uk import Simulation

        from uk_budget_data.example_households import build_situation
        from uk_budget_data.personal_impact import AsBuilt, effective

        situation = build_situation(
            household,
            years,
            state_pension_weekly=full_new_state_pension(years),
            points=self.num_points,
        )
        sim = Simulation(situation=situation, scenario=effective(scenario))
        built = AsBuilt(sim)
        curves = {}
        for year in years:
            # As the household calculator reads several years from one
            # simulation: each year as built, so no year sees another's
            # calculated values.
            built.restore()
            curves[year] = np.asarray(
                sim.calculate("household_net_income", year), dtype=float
            )
        return curves

    def rows(
        self,
        household,
        baseline: dict,
        reformed: dict,
        reform_id: str,
        reform_name: str,
        years: list[int],
    ) -> list[dict]:
        """The table rows for one household, from its simulated curves."""
        grid = household.grid(self.num_points)
        rows = []
        for year in years:
            for i, income in enumerate(grid):
                rows.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "household": household.id,
                        "x_variable": household.x_variable,
                        "income": float(income),
                        "baseline_net_income": round(
                            float(baseline[year][i]), 2
                        ),
                        "reform_net_income": round(
                            float(reformed[year][i]), 2
                        ),
                    }
                )
        return rows

    def calculate(
        self,
        baseline_scenario,
        reform_scenario,
        reform_id: str,
        reform_name: str,
        year,
    ) -> list[dict]:
        """Every example household's curve for one measure, in one year or
        several.

        Args:
            baseline_scenario: Scenario for baseline (pre-budget policy).
            reform_scenario: Scenario for reform (post-budget policy).
            reform_id: Unique identifier for the reform.
            reform_name: Human-readable reform name.
            year: A year, or a list of years. Each household is simulated
                once per scenario for every year at once (``simulate``
                reads each year as built), which gives the same values as
                one simulation per year, to the bit, in about a quarter of
                the time.

        Returns:
            One row per household and grid point (see ``rows``), year by
            year, as consecutive one-year calls would return them.
        """
        from uk_budget_data.example_households import EXAMPLE_HOUSEHOLDS

        years = [year] if isinstance(year, int) else [int(y) for y in year]
        by_year: dict[int, list[dict]] = {y: [] for y in years}
        for household in EXAMPLE_HOUSEHOLDS:
            baseline = self.simulate(household, baseline_scenario, years)
            reformed = self.simulate(household, reform_scenario, years)
            for y in years:
                by_year[y].extend(
                    self.rows(
                        household,
                        baseline,
                        reformed,
                        reform_id,
                        reform_name,
                        [y],
                    )
                )
        return [row for y in years for row in by_year[y]]


def full_new_state_pension(years: list[int]) -> dict[int, float]:
    """The full new State Pension, £ a week, in each year, as legislated
    (the rate ``new_state_pension`` splits a reported amount at)."""
    from policyengine_uk.system import system

    amount = system.parameters.gov.dwp.state_pension.new_state_pension.amount
    return {year: float(amount(f"{year}-01-01")) for year in years}


@dataclass
class HouseholdScatterCalculator(BaseCalculator):
    """Calculates household-level scatter plot data.

    One row per household, never published: ``bin_scatter`` bins them.
    With a ``basis_year``, every year's rows carry the household's baseline
    net income in that year (``reference_income``), and households are kept
    by it, so every year holds the same households and each is banded by
    the same income (``publication.tables.SCATTER_INCOME_BASIS_YEAR``).
    """

    max_income: int = 150_000
    min_income: int = 0
    sample_size: int = 2000  # Sample per reform per year
    basis_year: Optional[int] = None

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> list[dict]:
        """Calculate from microsimulations."""
        baseline_income = baseline.calculate(
            "household_net_income", period=year, map_to="household"
        )
        reform_income = reformed.calculate(
            "household_net_income", period=year, map_to="household"
        )
        household_weight = baseline.calculate(
            "household_weight", period=year, map_to="household"
        )
        # Use stable household_id from the FRS microdata
        # This ensures consistent household identification across reforms
        household_id = baseline.calculate(
            "household_id", period=year, map_to="household"
        )
        reference = None
        if self.basis_year is not None:
            reference = baseline.calculate(
                "household_net_income",
                period=self.basis_year,
                map_to="household",
            ).values

        return self.calculate_from_arrays(
            reform_id=reform_id,
            reform_name=reform_name,
            year=year,
            baseline_incomes=baseline_income.values,
            income_changes=(reform_income - baseline_income).values,
            weights=household_weight.values,
            household_ids=household_id.values,
            reference_incomes=reference,
        )

    def calculate_from_arrays(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        baseline_incomes: np.ndarray,
        income_changes: np.ndarray,
        weights: np.ndarray,
        household_ids: np.ndarray = None,
        reference_incomes: np.ndarray = None,
    ) -> list[dict]:
        """Calculate from numpy arrays (for testing).

        Returns all households within income range. Sampling for git
        is done separately via sample_household_scatter.py script.

        Args:
            reform_id: Unique reform identifier
            reform_name: Human-readable reform name
            year: Year for the calculation
            baseline_incomes: Household net incomes under baseline
            income_changes: Change in income (reform - baseline)
            weights: Household weights
            household_ids: Stable FRS household IDs (optional, for testing)
            reference_incomes: The same households' baseline net incomes
                in ``self.basis_year``, which then select and band them in
                every year (optional).
        """
        if reference_incomes is not None and self.basis_year is None:
            raise ValueError("reference_incomes need a basis_year")
        selecting = (
            baseline_incomes
            if reference_incomes is None
            else reference_incomes
        )
        mask = (selecting >= self.min_income) & (selecting <= self.max_income)

        results = []
        for i in range(len(baseline_incomes)):
            if mask[i]:
                row = {
                    "reform_id": reform_id,
                    "reform_name": reform_name,
                    "year": year,
                    "baseline_income": baseline_incomes[i],
                    "income_change": income_changes[i],
                    "household_weight": weights[i],
                }
                # Include stable household_id if provided
                if household_ids is not None:
                    row["household_id"] = int(household_ids[i])
                if reference_incomes is not None:
                    row["reference_income"] = float(reference_incomes[i])
                    row["income_basis_year"] = int(self.basis_year)
                results.append(row)

        return results


@dataclass
class ConstituencyCalculator(BaseCalculator):
    """Calculates constituency-level impacts."""

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        year: int,
        constituency_weights: np.ndarray,
        constituency_df: pd.DataFrame,
    ) -> list[dict]:
        """Calculate from microsimulations with constituency weights."""

        baseline_income = baseline.calculate(
            "household_net_income", period=year, map_to="household"
        ).values
        reform_income = reformed.calculate(
            "household_net_income", period=year, map_to="household"
        ).values

        results = []
        for i in range(len(constituency_df)):
            name = constituency_df.iloc[i]["name"]
            code = constituency_df.iloc[i]["code"]
            weight = constituency_weights[i]

            baseline_ms = MicroSeries(baseline_income, weights=weight)
            reform_ms = MicroSeries(reform_income, weights=weight)

            avg_change = (
                reform_ms.sum() - baseline_ms.sum()
            ) / baseline_ms.count()
            avg_baseline = baseline_ms.sum() / baseline_ms.count()
            if avg_baseline <= 0:
                raise ValueError(
                    f"Non-positive average baseline income ({avg_baseline}) "
                    f"for {reform_id} in {year}; relative change undefined."
                )
            rel_change = (avg_change / avg_baseline) * 100

            results.append(
                self.calculate_from_values(
                    reform_id=reform_id,
                    year=year,
                    constituency_code=code,
                    constituency_name=name,
                    average_gain=avg_change,
                    relative_change=rel_change,
                )
            )

        return results

    def calculate_from_values(
        self,
        reform_id: str,
        year: int,
        constituency_code: str,
        constituency_name: str,
        average_gain: float,
        relative_change: float,
    ) -> dict:
        """Create a single constituency result (for testing)."""
        return {
            "reform_id": reform_id,
            "year": year,
            "constituency_code": constituency_code,
            "constituency_name": constituency_name,
            "average_gain": average_gain,
            "relative_change": relative_change,
        }


@dataclass
class DemographicConstituencyCalculator(BaseCalculator):
    """Calculates impacts by children count, marital status, constituency."""

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        year: int,
        constituency_weights: np.ndarray,
        constituency_df: pd.DataFrame,
    ) -> list[dict]:
        """Calculate demographic constituency impacts."""
        baseline_income = baseline.calculate(
            "household_net_income", period=year, map_to="household"
        ).values
        reform_income = reformed.calculate(
            "household_net_income", period=year, map_to="household"
        ).values
        income_change = reform_income - baseline_income

        num_children = baseline.calculate(
            "num_children", period=year, map_to="household"
        ).values
        is_married = baseline.calculate(
            "is_married", period=year, map_to="household"
        ).values

        # Cap children at 4+
        num_children_capped = np.minimum(num_children, 4).astype(int)

        results = []

        for const_idx in range(len(constituency_df)):
            name = constituency_df.iloc[const_idx]["name"]
            code = constituency_df.iloc[const_idx]["code"]
            weights = constituency_weights[const_idx]

            for n_children in range(5):  # 0, 1, 2, 3, 4+
                for married in [True, False]:
                    mask = (num_children_capped == n_children) & (
                        is_married == married
                    )

                    if mask.sum() == 0:
                        continue

                    masked_weights = weights * mask
                    total_weight = masked_weights.sum()

                    if total_weight == 0:
                        continue

                    avg_change = (
                        income_change * masked_weights
                    ).sum() / total_weight
                    avg_baseline = (
                        baseline_income * masked_weights
                    ).sum() / total_weight
                    if avg_baseline <= 0:
                        raise ValueError(
                            f"Constituency {code} ({name}) has non-positive "
                            f"weighted baseline income ({avg_baseline}) in "
                            f"{year}; relative change is undefined."
                        )
                    rel_change = (avg_change / avg_baseline) * 100

                    results.append(
                        {
                            "reform_id": reform_id,
                            "year": year,
                            "constituency_code": code,
                            "constituency_name": name,
                            "num_children": (
                                f"{n_children}+"
                                if n_children == 4
                                else str(n_children)
                            ),
                            "is_married": married,
                            "average_gain": avg_change,
                            "relative_change": rel_change,
                            "household_count": total_weight,
                        }
                    )

        return results


# Age bands for results by age: (label, lowest age, highest age), inclusive.
# The adult bands are the ONS Labour Force Survey's standard age groups
# (ONS, "A05 SA: Employment, unemployment and economic inactivity by age
# group", which splits 16-17 and 18-24, 25-34, 35-49, 50-64 and 65 and
# over); 16-24 is the ONS labour-market definition of young people (as in
# its "Young people not in education, employment or training (NEET)"
# release). Children are under 16, as in ONS population statistics and
# DWP's Households Below Average Income (HBAI); HBAI also counts 16- to
# 19-year-olds in full-time non-advanced education as children, which these
# bands do not: everyone aged 16 to 24 is in "16-24".
AGE_BANDS: tuple[tuple[str, int, int], ...] = (
    ("0-15", 0, 15),
    ("16-24", 16, 24),
    ("25-34", 25, 34),
    ("35-49", 35, 49),
    ("50-64", 50, 64),
    ("65+", 65, 200),
)
AGE_BAND_ALL = "all"
# Single years of age are rows too, labelled by the age ("0", "1", ...), up
# to this age; people this age or older share its row, labelled "90+" (the
# ONS mid-year estimates' top age).
SINGLE_AGE_TOP = 90
# A single year of age with fewer survey records than this has no row.
SINGLE_AGE_MIN_RECORDS = 100
# A change smaller than this share of household net income counts as no
# change: the test MetricsCalculator uses for people affected.
AGE_CHANGE_THRESHOLD = 0.0001
# A change in a person's own taxes or earnings smaller than this, in £ a
# year, does not make them directly affected.
DIRECT_EFFECT_MIN_GBP = 1.0
# The person-level variables whose change makes someone directly affected.
DIRECT_EFFECT_VARIABLES = (
    "income_tax",
    "national_insurance",
    "student_loan_repayment",
    "employment_income",
)


def age_band_of(age: np.ndarray) -> np.ndarray:
    """The AGE_BANDS label of each age; ages outside every band get ""."""
    labels = np.full(len(age), "", dtype=object)
    for label, low, high in AGE_BANDS:
        labels[(age >= low) & (age <= high)] = label
    return labels


def single_age_of(age: np.ndarray) -> np.ndarray:
    """Each age's single-year label: "0" to "89", then "90+"."""
    whole = np.floor(np.asarray(age, dtype=float)).astype(int)
    labels = whole.astype(str).astype(object)
    labels[whole >= SINGLE_AGE_TOP] = f"{SINGLE_AGE_TOP}+"
    return labels


@dataclass
class AgeImpactCalculator(BaseCalculator):
    """Change in household net income by the age of each person.

    Every person is given their household's change in net income (not
    equivalised; ``mean_equivalised_change`` carries the equivalised
    change too), and the rows average it over people, so a mean of £100 for
    16- to 24-year-olds means the average young person lives in a household
    £100 a year better off. People whose household has no income decile
    (``household_income_decile`` < 1) are left out, as in MetricsCalculator.

    A person is better off when their household's change is more than
    AGE_CHANGE_THRESHOLD of its baseline net income (at least £1), worse off
    when it is less than minus that, and unchanged otherwise.

    A person is directly affected when their own income tax, National
    Insurance, student loan repayment or employment income changes by
    DIRECT_EFFECT_MIN_GBP or more a year. Benefits are paid to benefit
    units, not people, so a change only in benefits (or in prices) is not
    counted as direct.

    After the AGE_BANDS rows and the ``all`` row come rows by single year
    of age (``age_band`` "0" to "89", then "90+"), with the same columns.
    A single year with fewer than SINGLE_AGE_MIN_RECORDS survey records has
    no row, so thin cells are never published.
    """

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> list[dict]:
        def person(sim, variable):
            return np.asarray(
                sim.calculate(variable, period=year, map_to="person").values,
                dtype=float,
            )

        own_change = np.zeros_like(person(baseline, "age"))
        for variable in DIRECT_EFFECT_VARIABLES:
            own_change = np.maximum(
                own_change,
                np.abs(
                    person(reformed, variable) - person(baseline, variable)
                ),
            )
        frame = pd.DataFrame(
            {
                "age": person(baseline, "age"),
                "weight": person(baseline, "person_weight"),
                "decile": person(baseline, "household_income_decile"),
                "baseline_income": person(baseline, "household_net_income"),
                "reform_income": person(reformed, "household_net_income"),
                "baseline_equivalised": person(
                    baseline, "equiv_household_net_income"
                ),
                "reform_equivalised": person(
                    reformed, "equiv_household_net_income"
                ),
                "own_change": own_change,
            }
        )
        return self.calculate_from_dataframe(
            reform_id, reform_name, year, frame
        )

    def calculate_from_dataframe(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        frame: pd.DataFrame,
    ) -> list[dict]:
        """Rows by age band from a person-level frame.

        ``frame`` has one row per person: age, weight, decile,
        baseline_income and reform_income (household net income),
        baseline_equivalised and reform_equivalised, and own_change (the
        largest absolute change in the person's own taxes or earnings).
        """
        frame = frame[frame["decile"] >= 1]
        change = (frame["reform_income"] - frame["baseline_income"]).to_numpy()
        relative = change / np.maximum(frame["baseline_income"].to_numpy(), 1)
        better = relative > AGE_CHANGE_THRESHOLD
        worse = relative < -AGE_CHANGE_THRESHOLD
        equivalised = (
            frame["reform_equivalised"] - frame["baseline_equivalised"]
        ).to_numpy()
        direct = frame["own_change"].to_numpy() >= DIRECT_EFFECT_MIN_GBP
        weight = frame["weight"].to_numpy()
        bands = age_band_of(frame["age"].to_numpy())

        groups = [(label, bands == label) for label, _, _ in AGE_BANDS]
        groups.append((AGE_BAND_ALL, np.ones(len(frame), dtype=bool)))
        singles = single_age_of(frame["age"].to_numpy())
        for whole in sorted({int(label.rstrip("+")) for label in singles}):
            label = (
                f"{SINGLE_AGE_TOP}+" if whole >= SINGLE_AGE_TOP else str(whole)
            )
            members = singles == label
            if members.sum() >= SINGLE_AGE_MIN_RECORDS:
                groups.append((label, members))
        rows = []
        for label, members in groups:
            w = weight[members]
            people = float(w.sum())
            if people <= 0:
                continue

            def share(flags):
                return float(w[flags[members]].sum()) / people * 100

            rows.append(
                {
                    "reform_id": reform_id,
                    "reform_name": reform_name,
                    "year": year,
                    "age_band": label,
                    "people": people,
                    "sample_size": int(members.sum()),
                    "mean_change": float((w * change[members]).sum()) / people,
                    "mean_equivalised_change": float(
                        (w * equivalised[members]).sum()
                    )
                    / people,
                    "pct_better_off": share(better),
                    "pct_worse_off": share(worse),
                    "pct_unchanged": share(~better & ~worse),
                    "people_directly_affected": float(
                        w[direct[members]].sum()
                    ),
                }
            )
        return rows


# The income distribution: the percentiles published, and the floor on
# the survey households behind each one.
DISTRIBUTION_PERCENTILES = tuple(range(1, 100))
# Each percentile is the mean over the people in a band one percentile wide
# around it; a band with fewer survey households than this has no row.
DISTRIBUTION_MIN_HOUSEHOLDS = SINGLE_AGE_MIN_RECORDS
DISTRIBUTION_BAND = 1.0
DISTRIBUTION_SIDES = ("baseline", "reform")
# Items in the survey data's household net income that the household
# calculator never gives a household it builds from the form, so a reader
# can be placed on the distribution: public spending in kind on health,
# education and transport subsidies (benefits in household_benefits), and
# the business rates and stamp duty the model attributes to households
# (taxes in household_tax).
NOT_IN_CALCULATOR_BENEFITS = (
    "nhs_spending",
    "dfe_education_spending",
    "dft_subsidy_spending",
)
NOT_IN_CALCULATOR_TAXES = (
    "business_rates",
    "corporate_sdlt",
    "expected_sdlt",
    "expected_ltt",
    "expected_lbtt",
)


def comparable_net_income(sim, year: int) -> np.ndarray:
    """Household net income as the household calculator counts it, by
    household: ``household_net_income`` less public spending in kind
    (NHS, schools, transport subsidies), plus the attributed business
    rates and stamp duty (NOT_IN_CALCULATOR_*). What
    stays is earnings and other market income, cash benefits and free
    childcare, less income tax, National Insurance, council tax, fuel duty,
    VAT changes, student loan repayments and pension contributions."""

    def household(variable):
        return np.asarray(
            sim.calculate(variable, period=year, map_to="household").values,
            dtype=float,
        )

    income = household("household_net_income")
    for variable in NOT_IN_CALCULATOR_BENEFITS:
        income = income - household(variable)
    for variable in NOT_IN_CALCULATOR_TAXES:
        income = income + household(variable)
    return income


def distribution_points(
    income: np.ndarray,
    people: np.ndarray,
    survey_households: Optional[np.ndarray] = None,
    percentiles=DISTRIBUTION_PERCENTILES,
    band: float = DISTRIBUTION_BAND,
    min_households: int = DISTRIBUTION_MIN_HOUSEHOLDS,
) -> list[tuple[int, float, int]]:
    """Smoothed percentile points of a person-weighted income distribution.

    ``income`` is each household's income, ``people`` its weight in people
    (household weight times household size), so a point is where a share
    of people, not of households, lies below. Households are sorted by
    income; each person sits at the midpoint of their household's slice of
    the cumulative share. The point for percentile p is the person-weighted
    mean income of the people between p - band/2 and p + band/2, so it is
    never one household's own figure. A band with fewer than
    ``min_households`` survey households (distinct ``survey_households``
    ids; the household records when None) is left out.

    Returns (percentile, income, survey households) for each kept point.
    """
    income = np.asarray(income, dtype=float)
    people = np.asarray(people, dtype=float)
    keep = people > 0
    income, people = income[keep], people[keep]
    ids = (
        np.arange(len(keep))[keep]
        if survey_households is None
        else np.asarray(survey_households)[keep]
    )
    order = np.argsort(income, kind="stable")
    income, people, ids = income[order], people[order], ids[order]
    total = people.sum()
    if total <= 0:
        return []
    upper = np.cumsum(people) / total * 100
    middle = upper - people / total * 100 / 2
    points = []
    for p in percentiles:
        members = (middle >= p - band / 2) & (middle < p + band / 2)
        households = len(np.unique(ids[members]))
        if households < min_households:
            continue
        w = people[members]
        points.append(
            (int(p), float((w * income[members]).sum() / w.sum()), households)
        )
    return points


@dataclass
class IncomeDistributionCalculator(BaseCalculator):
    """Percentiles of equivalised household net income, before and after.

    The income is ``comparable_net_income`` (household net income as the
    household calculator counts it, so fuel duty and VAT measures count,
    and NHS spending in kind and attributed business taxes do not) divided
    by the HBAI modified OECD scale (``household_equivalisation_bhc``), so
    a reader's household from the calculator can be placed on it. It is
    not the HBAI income the decile charts rank on, which leaves out fuel
    duty and VAT.

    People are counted, not households: each household weighs its weight
    times its size, as the deciles do. The ``baseline`` points rank
    everyone's income before the measure, the ``reform`` points everyone's
    income after it, each against its own distribution. Points run from
    the 1st to the 99th percentile; see ``distribution_points`` for how
    each is made and when one is left out.
    """

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
        survey_households=None,
    ) -> list[dict]:
        def household(sim, variable):
            return np.asarray(
                sim.calculate(
                    variable, period=year, map_to="household"
                ).values,
                dtype=float,
            )

        frame = pd.DataFrame(
            {
                "people": household(baseline, "household_weight")
                * household(baseline, "household_count_people"),
                "baseline": comparable_net_income(baseline, year)
                / household(baseline, "household_equivalisation_bhc"),
                "reform": comparable_net_income(reformed, year)
                / household(reformed, "household_equivalisation_bhc"),
            }
        )
        if survey_households is not None:
            frame["survey_household"] = np.asarray(survey_households)
        return self.calculate_from_dataframe(
            reform_id, reform_name, year, frame
        )

    def calculate_from_dataframe(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        frame: pd.DataFrame,
    ) -> list[dict]:
        """Rows from a household-level frame: ``people`` (weight times
        size), ``baseline`` and ``reform`` equivalised net income, and
        optionally ``survey_household`` ids."""
        ids = (
            frame["survey_household"].to_numpy()
            if "survey_household" in frame
            else None
        )
        rows = []
        for side in DISTRIBUTION_SIDES:
            for percentile, income, _ in distribution_points(
                frame[side].to_numpy(), frame["people"].to_numpy(), ids
            ):
                rows.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "side": side,
                        "percentile": percentile,
                        "equivalised_net_income": round(income),
                    }
                )
        return rows


# Income mobility: a mover's cell (people moving up, or down, from one
# starting decile) is published only when its movers come from at least
# this many distinct survey households, as the binned scatter's floor.
MOBILITY_MIN_HOUSEHOLDS = 10


def person_ranks(income: np.ndarray, people: np.ndarray) -> np.ndarray:
    """Each household's rank (0 to 100) in a person-weighted distribution:
    the midpoint of the share of people at its income, households with the
    same income sharing one rank."""
    income = np.asarray(income, dtype=float)
    people = np.asarray(people, dtype=float)
    total = people.sum()
    frame = pd.DataFrame({"income": income, "people": people})
    by = frame.groupby("income", sort=True)["people"].sum()
    upper = by.cumsum() / total * 100
    middle = upper - by / total * 100 / 2
    return middle.reindex(income).to_numpy()


@dataclass
class IncomeMobilityCalculator(BaseCalculator):
    """Who changes place in the income distribution, by starting decile.

    Each household is ranked by ``comparable_net_income`` (equivalised, as
    IncomeDistributionCalculator) among everyone before the measure, and
    again among everyone after it. People move up a percentile (or decile)
    when the whole percentile (decile) of their rank after is higher than
    before, and down when it is lower. Rows give the share of people (%)
    moving up, down or not at all, for each starting decile (by rank
    before) and for everyone (``all``). A share of movers drawn from fewer
    than MOBILITY_MIN_HOUSEHOLDS survey households is left blank, and so is
    the matching share staying put.
    """

    def calculate(
        self,
        baseline,
        reformed,
        reform_id: str,
        reform_name: str,
        year: int,
        survey_households=None,
    ) -> list[dict]:
        def household(sim, variable):
            return np.asarray(
                sim.calculate(
                    variable, period=year, map_to="household"
                ).values,
                dtype=float,
            )

        frame = pd.DataFrame(
            {
                "people": household(baseline, "household_weight")
                * household(baseline, "household_count_people"),
                "baseline": comparable_net_income(baseline, year)
                / household(baseline, "household_equivalisation_bhc"),
                "reform": comparable_net_income(reformed, year)
                / household(reformed, "household_equivalisation_bhc"),
            }
        )
        if survey_households is not None:
            frame["survey_household"] = np.asarray(survey_households)
        return self.calculate_from_dataframe(
            reform_id, reform_name, year, frame
        )

    def calculate_from_dataframe(
        self,
        reform_id: str,
        reform_name: str,
        year: int,
        frame: pd.DataFrame,
    ) -> list[dict]:
        frame = frame[frame["people"] > 0]
        people = frame["people"].to_numpy()
        ids = (
            frame["survey_household"].to_numpy()
            if "survey_household" in frame
            else np.arange(len(frame))
        )
        before = person_ranks(frame["baseline"].to_numpy(), people)
        after = person_ranks(frame["reform"].to_numpy(), people)
        start = np.minimum(np.floor(before / 10).astype(int) + 1, 10)
        groups = [(str(d), start == d) for d in range(1, 11)]
        groups.append(("all", np.ones(len(frame), dtype=bool)))
        rows = []
        for unit, size in (("percentile", 1), ("decile", 10)):
            b = np.minimum(np.floor(before / size), 100 / size - 1)
            a = np.minimum(np.floor(after / size), 100 / size - 1)
            up, down = a > b, a < b
            for label, members in groups:
                w = people[members]
                total = w.sum()
                if total <= 0:
                    continue

                def share(flags):
                    movers = members & flags
                    if len(np.unique(ids[movers])) < MOBILITY_MIN_HOUSEHOLDS:
                        return None
                    return float(people[movers].sum() / total * 100)

                up_share, down_share = share(up), share(down)
                still = (
                    100 - up_share - down_share
                    if up_share is not None and down_share is not None
                    else None
                )
                rows.append(
                    {
                        "reform_id": reform_id,
                        "reform_name": reform_name,
                        "year": year,
                        "unit": unit,
                        "start_decile": label,
                        "pct_up": up_share,
                        "pct_down": down_share,
                        "pct_same": still,
                    }
                )
        return rows


def get_standard_calculators(
    years: list[int] = None,
    income_curve_points: int = 201,
    household_scatter_max: int = 150_000,
) -> dict[str, BaseCalculator]:
    """Get all standard calculators with default configuration.

    Args:
        years: Years for budgetary calculations.
        income_curve_points: Number of points on income curve.
        household_scatter_max: Max income for scatter plot.

    Returns:
        Dict mapping calculator name to calculator instance.
    """
    years = years or list(POLICY_YEARS)

    return {
        "budgetary": BudgetaryImpactCalculator(years=years),
        "distributional": DistributionalImpactCalculator(),
        "winners_losers": WinnersLosersCalculator(),
        "metrics": MetricsCalculator(),
        "income_curve": IncomeCurveCalculator(
            num_points=income_curve_points,
        ),
        "household_scatter": HouseholdScatterCalculator(
            max_income=household_scatter_max,
        ),
        "constituency": ConstituencyCalculator(),
        "demographic_constituency": DemographicConstituencyCalculator(),
        "age_impact": AgeImpactCalculator(),
        "income_distribution": IncomeDistributionCalculator(),
    }
