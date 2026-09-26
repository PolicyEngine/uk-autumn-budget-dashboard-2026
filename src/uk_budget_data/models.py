"""Data models for UK Budget Data pipeline."""

from pathlib import Path
from typing import Any, Callable, Optional

from policyengine_uk.utils.scenario import Scenario
from pydantic import BaseModel, Field


class Reform(BaseModel):
    """Definition of a policy reform.

    A reform can be defined either via parameter changes (simple reforms)
    or via a simulation modifier function (structural reforms).

    For reforms that compare two non-default scenarios (e.g., fuel duty freeze
    comparing higher rates vs lower rates), use baseline_parameter_changes to
    define the baseline scenario.
    """

    id: str = Field(..., description="Unique identifier for the reform")
    name: str = Field(..., description="Human-readable name")
    description: str = Field(
        default="", description="Detailed description of the reform"
    )
    parameter_changes: Optional[dict[str, dict[str, Any]]] = Field(
        default=None,
        description="Parameter path -> {period: value} mappings for reform",
    )
    baseline_parameter_changes: Optional[dict[str, dict[str, Any]]] = Field(
        default=None,
        description=(
            "Parameter changes for custom baseline scenario. "
            "If provided, both baseline and reform will use modified parameters."
        ),
    )
    baseline_simulation_modifier: Optional[Callable] = Field(
        default=None,
        description=(
            "Function that modifies baseline simulation. Use for ParameterScale "
            "brackets that can't be modified via parameter_changes."
        ),
    )
    simulation_modifier: Optional[Callable] = Field(
        default=None,
        description="Function that modifies a simulation object",
    )

    model_config = {"arbitrary_types_allowed": True}

    @staticmethod
    def _build_scenario(
        changes: Optional[dict[str, dict[str, Any]]],
        modifier: Optional[Callable],
    ) -> Scenario:
        """Preserve dated parameter changes when constructing a UK scenario.

        UK Simulation.apply_parameter_changes interprets keys through its
        fiscal-year helper. Monthly fuel-duty changes instead need the exact
        date path used by Scenario.from_reform (and the personal calculator).
        """
        annual_changes = {}
        dated_changes = {}
        for path, values in (changes or {}).items():
            annual = {
                key: value for key, value in values.items() if "-" not in key
            }
            dated = {key: value for key, value in values.items() if "-" in key}
            if annual:
                annual_changes[path] = annual
            if dated:
                dated_changes[path] = dated

        dated_modifier = (
            Scenario.from_reform(dated_changes).simulation_modifier
            if dated_changes
            else None
        )
        if dated_modifier and modifier:

            def combined_modifier(simulation):
                dated_modifier(simulation)
                modifier(simulation)

            modifier = combined_modifier
        elif dated_modifier:
            modifier = dated_modifier
        return Scenario(
            parameter_changes=annual_changes or None,
            simulation_modifier=modifier,
        )

    def to_scenario(self) -> Scenario:
        """Convert this reform to a PolicyEngine Scenario object."""
        return self._build_scenario(
            self.parameter_changes, self.simulation_modifier
        )

    def to_baseline_scenario(self) -> Optional[Scenario]:
        """Convert baseline parameter changes to a Scenario, if defined.

        Returns:
            Scenario object for custom baseline, or None for default baseline.
        """
        if self.has_custom_baseline():
            return self._build_scenario(
                self.baseline_parameter_changes,
                self.baseline_simulation_modifier,
            )
        return None

    def has_custom_baseline(self) -> bool:
        """Check if this reform uses a custom baseline scenario."""
        return (
            self.baseline_parameter_changes is not None
            or self.baseline_simulation_modifier is not None
        )


class ReformResult(BaseModel):
    """Results from processing a single reform."""

    reform_id: str
    reform_name: str
    budgetary_impact: list[dict]
    distributional_impact: list[dict]
    winners_losers: list[dict]
    metrics: list[dict]
    income_curve: list[dict]
    household_scatter: list[dict]
    constituency: list[dict]
    demographic_constituency: list[dict]

    model_config = {"arbitrary_types_allowed": True}


class DataConfig(BaseModel):
    """Configuration for the data generation pipeline."""

    years: list[int] = Field(
        default=[2026, 2027, 2028, 2029, 2030],
        description="Years to calculate metrics for",
    )
    output_dir: Path = Field(
        default=Path("./public/data"),
        description="Directory to write output CSVs",
    )
    data_dir: Path = Field(
        default=Path("./data"),
        description="Directory containing input data files",
    )
    data_inputs_dir: Path = Field(
        default=Path("./data_inputs"),
        description="Directory containing reference data",
    )
    dataset_path: Optional[Path] = Field(
        default=None,
        description="Path to enhanced FRS dataset (optional)",
    )
    income_curve_max: int = Field(
        default=150_000,
        description="Maximum employment income for curve",
    )
    income_curve_points: int = Field(
        default=201,
        description="Number of points on income curve",
    )
    household_scatter_max_income: int = Field(
        default=150_000,
        description="Max baseline income for scatter plot",
    )
    baseline_parameter_changes: Optional[dict[str, dict[str, Any]]] = Field(
        default=None,
        description=(
            "Global baseline parameter changes applied to all reforms. "
            "Use this for pre-Autumn Budget baseline scenarios. "
            "Reform-specific baseline_parameter_changes take precedence."
        ),
    )

    model_config = {"arbitrary_types_allowed": True}

    def get_baseline_scenario(self) -> Optional[Scenario]:
        """Get the global baseline scenario, if configured."""
        if self.baseline_parameter_changes is not None:
            return Scenario(parameter_changes=self.baseline_parameter_changes)
        return None
