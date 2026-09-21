"""Metric calculators for UK Budget Data pipeline.

Each calculator is responsible for computing a specific type of metric
from baseline and reformed microsimulation results.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from microdf import MicroDataFrame, MicroSeries


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

    years: list[int] = field(
        default_factory=lambda: [2026, 2027, 2028, 2029, 2030]
    )

    # Reforms that use student_loan_repayments_modelled instead of gov_balance
    STUDENT_LOAN_REFORMS = ["freeze_student_loan_thresholds"]

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

        return [
            {
                "reform_id": reform_id,
                "reform_name": reform_name,
                "year": year,
                "people_affected": percent_affected,
                "gini_change": gini_change,
                "poverty_change_pp": poverty_pp,
                "poverty_change_pct": poverty_pct,
            }
        ]

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
    """Calculates income curve (net income vs employment income)."""

    max_income: int = 150_000
    num_points: int = 201

    def get_income_range(self) -> np.ndarray:
        """Get the range of employment incomes to calculate."""
        return np.linspace(0, self.max_income, self.num_points)

    def get_base_situation(self, year: int) -> dict:
        """Get the base household situation for income curve."""
        return {
            "people": {
                "adult1": {
                    "age": {str(year): 40},
                    "employment_income": {str(year): 0},
                    "employee_pension_contributions": {str(year): 10000},
                },
                "adult2": {
                    "age": {str(year): 40},
                    "employment_income": {str(year): 0},
                },
                "child1": {
                    "age": {str(year): 7},
                    "employment_income": {str(year): 0},
                },
                "child2": {
                    "age": {str(year): 5},
                    "employment_income": {str(year): 0},
                },
                "child3": {
                    "age": {str(year): 3},
                    "employment_income": {str(year): 0},
                },
            },
            "benunits": {
                "family": {
                    "members": [
                        "adult1",
                        "adult2",
                        "child1",
                        "child2",
                        "child3",
                    ],
                    "would_claim_uc": {str(year): True},
                }
            },
            "households": {
                "household": {
                    "brma": {str(year): "MAIDSTONE"},
                    "region": {str(year): "LONDON"},
                    "members": [
                        "adult1",
                        "adult2",
                        "child1",
                        "child2",
                        "child3",
                    ],
                    "local_authority": {str(year): "MAIDSTONE"},
                }
            },
            "axes": [
                [
                    {
                        "name": "employment_income",
                        "min": 0,
                        "max": self.max_income,
                        "count": self.num_points,
                        "period": str(year),
                    }
                ]
            ],
        }

    def calculate(
        self,
        baseline_scenario,
        reform_scenario,
        reform_id: str,
        reform_name: str,
        year: int,
    ) -> list[dict]:
        """Calculate income curve from PolicyEngine scenarios.

        Args:
            baseline_scenario: Scenario for baseline (pre-budget policy).
            reform_scenario: Scenario for reform (post-budget policy).
            reform_id: Unique identifier for the reform.
            reform_name: Human-readable reform name.
            year: Year to calculate for.

        Returns:
            List of dicts with employment_income, baseline_net_income,
            reform_net_income.
        """
        from policyengine_uk import Simulation

        base_situation = self.get_base_situation(year)

        # Apply baseline scenario (pre-budget) if provided
        if baseline_scenario is not None:
            baseline_sim = Simulation(
                scenario=baseline_scenario, situation=base_situation
            )
        else:
            baseline_sim = Simulation(situation=base_situation)

        # Apply reform scenario (post-budget)
        reform_sim = Simulation(
            scenario=reform_scenario, situation=base_situation
        )

        # Use fixed income range for consistent x-axis across all reforms
        employment_incomes = self.get_income_range()
        baseline_hnet = baseline_sim.calculate("household_net_income", year)
        reform_hnet = reform_sim.calculate("household_net_income", year)

        results = []
        for i in range(len(employment_incomes)):
            results.append(
                {
                    "reform_id": reform_id,
                    "reform_name": reform_name,
                    "year": year,
                    "employment_income": employment_incomes[i],
                    "baseline_net_income": baseline_hnet[i],
                    "reform_net_income": reform_hnet[i],
                }
            )

        return results


@dataclass
class HouseholdScatterCalculator(BaseCalculator):
    """Calculates household-level scatter plot data.

    Samples households to keep file size manageable while maintaining
    representativeness. Uses deterministic sampling for reproducibility.
    """

    max_income: int = 150_000
    min_income: int = 0
    sample_size: int = 2000  # Sample per reform per year

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

        return self.calculate_from_arrays(
            reform_id=reform_id,
            reform_name=reform_name,
            year=year,
            baseline_incomes=baseline_income.values,
            income_changes=(reform_income - baseline_income).values,
            weights=household_weight.values,
            household_ids=household_id.values,
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
        """
        mask = (baseline_incomes >= self.min_income) & (
            baseline_incomes <= self.max_income
        )

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


def get_standard_calculators(
    years: list[int] = None,
    income_curve_max: int = 150_000,
    income_curve_points: int = 201,
    household_scatter_max: int = 150_000,
) -> dict[str, BaseCalculator]:
    """Get all standard calculators with default configuration.

    Args:
        years: Years for budgetary calculations.
        income_curve_max: Max income for curve calculation.
        income_curve_points: Number of points on income curve.
        household_scatter_max: Max income for scatter plot.

    Returns:
        Dict mapping calculator name to calculator instance.
    """
    years = years or [2026, 2027, 2028, 2029, 2030]

    return {
        "budgetary": BudgetaryImpactCalculator(years=years),
        "distributional": DistributionalImpactCalculator(),
        "winners_losers": WinnersLosersCalculator(),
        "metrics": MetricsCalculator(),
        "income_curve": IncomeCurveCalculator(
            max_income=income_curve_max,
            num_points=income_curve_points,
        ),
        "household_scatter": HouseholdScatterCalculator(
            max_income=household_scatter_max,
        ),
        "constituency": ConstituencyCalculator(),
        "demographic_constituency": DemographicConstituencyCalculator(),
    }
