"""Data generation pipeline for UK Budget dashboard.

This module provides the main pipeline for generating all dashboard data
from a list of reforms.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import h5py
import pandas as pd
import policyengine as pe
from policyengine_uk import Microsimulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario
from rich.console import Console
from rich.markup import escape

from uk_budget_data import data_limits, model_limits
from uk_budget_data.calculators import (
    AgeImpactCalculator,
    BudgetaryImpactCalculator,
    ConstituencyCalculator,
    DemographicConstituencyCalculator,
    DistributionalImpactCalculator,
    HouseholdScatterCalculator,
    IncomeCurveCalculator,
    IncomeDistributionCalculator,
    IncomeMobilityCalculator,
    MetricsCalculator,
    WinnersLosersCalculator,
)
from uk_budget_data.measure_templates import (
    wealth_tax_paths,
    wealth_tax_paths_differing,
    wealth_tax_refusal,
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.parameter_companions import (
    built_companion_gaps,
    companion_gaps,
)
from uk_budget_data.private_outputs import private_directory, save_private_csv
from uk_budget_data.reforms import get_autumn_budget_2026_reforms
from uk_budget_data.scored_years import missing_scored_years

console = Console()


def build_microsimulation(dataset_path: Optional[str], scenario=None):
    """Build a Microsimulation pinned to the installed policyengine.py bundle.

    Args:
        dataset_path: Explicit dataset path, or None to use the bundle's
            certified dataset (requires HUGGING_FACE_TOKEN).
        scenario: Scenario to apply, or None for current law.
    """
    kwargs = {} if scenario is None else {"scenario": scenario}
    return pe.uk.managed_microsimulation(
        dataset=dataset_path,
        allow_unmanaged=dataset_path is not None,
        **kwargs,
    )


def save_csv(df: pd.DataFrame, csv_path: Path) -> None:
    """Save DataFrame to CSV, creating parent directories if needed."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(csv_path, index=False)


def check_input_data(config: DataConfig) -> None:
    """Check that required input files exist.

    Args:
        config: Data configuration with paths.

    Raises:
        FileNotFoundError: If required files are missing.
    """
    weights_path = config.data_dir / "parliamentary_constituency_weights.h5"
    constituencies_path = config.data_inputs_dir / "constituencies_2024.csv"

    if not weights_path.exists():
        console.print(f"[red]Error: {weights_path} not found[/red]")
        raise FileNotFoundError(f"Required file not found: {weights_path}")

    if not constituencies_path.exists():
        console.print(f"[red]Error: {constituencies_path} not found[/red]")
        raise FileNotFoundError(
            f"Required file not found: {constituencies_path}"
        )

    console.print("[green]✓[/green] Found required constituency data files")


class ReformProcessor:
    """Processes a single reform to generate all metrics."""

    def __init__(
        self,
        reform: Reform,
        config: Optional[DataConfig] = None,
        geography_collector=None,
    ):
        """Initialize the processor.

        Args:
            reform: The reform to process.
            config: Data configuration (uses defaults if not provided).
            geography_collector: A ``geography.GeographyCollector`` to feed
                each year's runs, for results by area; None skips it.
        """
        self.reform = reform
        self.config = config or DataConfig()
        self.geography_collector = geography_collector

        # Initialize calculators
        self.budgetary_calc = BudgetaryImpactCalculator(
            years=self.config.years
        )
        self.distributional_calc = DistributionalImpactCalculator()
        self.winners_losers_calc = WinnersLosersCalculator()
        self.metrics_calc = MetricsCalculator()
        self.income_curve_calc = IncomeCurveCalculator(
            num_points=self.config.income_curve_points,
        )
        from uk_budget_data.publication.tables import scatter_basis_year

        self.household_scatter_calc = HouseholdScatterCalculator(
            max_income=self.config.household_scatter_max_income,
            basis_year=scatter_basis_year(self.config.years),
        )
        self.constituency_calc = ConstituencyCalculator()
        self.demographic_calc = DemographicConstituencyCalculator()
        self.age_calc = AgeImpactCalculator()

    def process(
        self,
        baseline: Microsimulation,
        reformed: Microsimulation,
        baseline_scenario: Optional[Scenario],
    ) -> ReformResult:
        """Process the reform and return all metrics.

        Args:
            baseline: Baseline microsimulation.
            reformed: Reformed microsimulation.
            baseline_scenario: The scenario ``baseline`` was built with
                (None for current law). The income curve's households are
                simulated against it, so they share the population's
                baseline.

        Returns:
            ReformResult with all calculated metrics.
        """
        reform_id = self.reform.id
        reform_name = self.reform.name

        # Calculate budgetary impact
        budgetary = self.budgetary_calc.calculate(
            baseline, reformed, reform_id, reform_name
        )

        # Calculate per-year metrics
        all_distributional = []
        all_winners_losers = []
        all_metrics = []
        all_income_curve = []
        all_household_scatter = []
        all_constituency = []
        all_demographic = []
        all_age = []

        scenario = self.reform.to_scenario()

        # Income curve: against the population's own baseline. Every year
        # at once: one household simulation per scenario reads them all,
        # the same values as a simulation per year (checked to the bit for
        # every measure on 24 October 2026), about four times faster.
        all_income_curve.extend(
            self.income_curve_calc.calculate(
                baseline_scenario,
                scenario,
                reform_id,
                reform_name,
                list(self.config.years),
            )
        )

        for year in self.config.years:
            # Distributional (also returns dataframe for other calcs)
            distributional, decile_df = self.distributional_calc.calculate(
                baseline, reformed, reform_id, reform_name, year
            )
            all_distributional.extend(distributional)

            # Winners/losers
            winners_losers = self.winners_losers_calc.calculate(
                decile_df, reform_id, reform_name, year
            )
            all_winners_losers.extend(winners_losers)

            # Summary metrics
            metrics = self.metrics_calc.calculate(
                baseline, reformed, reform_id, reform_name, year
            )
            all_metrics.extend(metrics)

            # Results by age band
            all_age.extend(
                self.age_calc.calculate(
                    baseline, reformed, reform_id, reform_name, year
                )
            )

            # Household scatter (sampled to ~2k households per reform/year)
            household_scatter = self.household_scatter_calc.calculate(
                baseline, reformed, reform_id, reform_name, year
            )
            all_household_scatter.extend(household_scatter)

            if self.geography_collector is not None:
                self.geography_collector.collect(
                    reform_id, year, baseline, reformed
                )

            # The legacy constituency calculators take direct means with no
            # disclosure control, so they run only on request, and their
            # rows go to a private directory (see DataPipeline._save_all).
            if self.config.legacy_geography_dir is not None:
                constituency, demographic = self._calculate_constituency(
                    baseline, reformed, reform_id, year
                )
                all_constituency.extend(constituency)
                all_demographic.extend(demographic)

        return ReformResult(
            reform_id=reform_id,
            reform_name=reform_name,
            budgetary_impact=budgetary,
            distributional_impact=all_distributional,
            winners_losers=all_winners_losers,
            metrics=all_metrics,
            income_curve=all_income_curve,
            household_scatter=all_household_scatter,
            constituency=all_constituency,
            demographic_constituency=all_demographic,
            age_impact=all_age,
        )

    def _calculate_constituency(
        self,
        baseline: Microsimulation,
        reformed: Microsimulation,
        reform_id: str,
        year: int,
    ) -> tuple[list[dict], list[dict]]:
        """Calculate constituency-level impacts."""
        weights_path = self.config.data_dir / (
            "parliamentary_constituency_weights.h5"
        )
        constituencies_path = (
            self.config.data_inputs_dir / "constituencies_2024.csv"
        )

        if not weights_path.exists() or not constituencies_path.exists():
            raise FileNotFoundError("Constituency data not found")

        with h5py.File(weights_path, "r") as f:
            year_key = str(year)
            if year_key not in f:
                raise KeyError(
                    f"No constituency weights for {year_key} in "
                    f"{weights_path}. Available: {sorted(f.keys())}"
                )
            weights = f[year_key][...]

        constituency_df = pd.read_csv(constituencies_path)

        constituency = self.constituency_calc.calculate(
            baseline, reformed, reform_id, year, weights, constituency_df
        )

        demographic = self.demographic_calc.calculate(
            baseline, reformed, reform_id, year, weights, constituency_df
        )

        return constituency, demographic


class DataPipeline:
    """Main pipeline for generating all dashboard data."""

    def __init__(
        self,
        reforms: Optional[list[Reform]] = None,
        config: Optional[DataConfig] = None,
        household_scatter: bool = False,
    ):
        """Initialize the pipeline.

        Args:
            reforms: List of reforms to process. Defaults to Autumn Budget.
            config: Data configuration. Uses defaults if not provided.
            household_scatter: Also write ``household_scatter_binned.csv``
                from the same simulations, as ``generate --only
                household_scatter`` writes it.
        """
        self.reforms = reforms or get_autumn_budget_2026_reforms()
        self.config = config or DataConfig()
        self.household_scatter = household_scatter

    def run(
        self, skip_input_check: bool = False, runner=None
    ) -> dict[str, pd.DataFrame]:
        """Run the pipeline and generate all data.

        Args:
            skip_input_check: Skip checking for input files.
            runner: Runs the measures (``parallel.SerialRunner`` by default:
                one after another, here). Each measure is one unit: its two
                simulations are built once and every table is read from
                them, whichever runner runs it.

        Returns:
            Dict mapping output name to DataFrame.
        """
        if self.config.legacy_geography_dir is not None:
            # Refuse an unsafe directory before any simulation runs.
            private_directory(self.config.legacy_geography_dir)
            if not skip_input_check:
                check_input_data(self.config)

        # Dataset selection is delegated to policyengine.py. With no explicit
        # path it resolves the dataset pinned by the installed release bundle
        # (the certified enhanced FRS on HuggingFace), which needs
        # HUGGING_FACE_TOKEN. An explicit path is an unmanaged override.
        dataset_path = (
            str(self.config.dataset_path) if self.config.dataset_path else None
        )
        tables = FLAT | (SCATTER if self.household_scatter else frozenset())
        outcomes = flat_units(
            self.reforms, self.config, dataset_path, tables, runner
        )
        for line in hold_packages_to_members(outcomes):
            console.print(line)
        results = [outcome.result for outcome in outcomes]

        # Aggregate and save
        aggregated = aggregate_results(results, config=self.config)
        self._save_all(aggregated)
        if self.household_scatter:
            save_scatter(
                [cell for o in outcomes for cell in o.scatter_cells],
                self.config.output_dir,
            )

        return aggregated

    def _save_all(self, data: dict[str, pd.DataFrame]) -> None:
        """Save all DataFrames to CSV files."""
        output_dir = self.config.output_dir

        file_mapping = {
            "budgetary_impact": "budgetary_impact.csv",
            "distributional_impact": "distributional_impact.csv",
            "winners_losers": "winners_losers.csv",
            "metrics": "metrics.csv",
            "income_curve": "income_curve.csv",
            "obr_comparison": "obr_comparison.csv",
            "age_impact": "age_impact.csv",
        }
        # Household rows are never written under output_dir: one row per
        # survey household is unit-record data. The receipted artifacts
        # carry the scatter binned instead.

        for key, filename in file_mapping.items():
            if key in data and len(data[key]) > 0:
                # Metadata belongs to the manifest and its bound receipts.
                # Keep the numeric tables in the canonical artifact schema.
                save_csv(data[key], output_dir / filename)

        console.print(f"[green]Saved results to {output_dir}/[/green]")

        # Constituency rows from the legacy calculators carry no disclosure
        # control. They are kept for comparison, privately, never published.
        if self.config.legacy_geography_dir is not None:
            directory = private_directory(self.config.legacy_geography_dir)
            for key in ("constituency", "demographic_constituency"):
                if key in data and len(data[key]) > 0:
                    save_private_csv(
                        data[key], directory / f"legacy_{key}.csv"
                    )
            console.print(f"[green]Saved legacy rows to {directory}/[/green]")


def aggregate_results(
    results: list[ReformResult],
    config: "DataConfig" = None,
) -> dict[str, pd.DataFrame]:
    """Aggregate results from multiple reforms into DataFrames.

    Args:
        results: List of ReformResult objects.
        config: Data configuration (for OBR estimates path).

    Returns:
        Dict mapping metric name to combined DataFrame.
    """
    aggregated = {
        "budgetary_impact": pd.DataFrame(),
        "distributional_impact": pd.DataFrame(),
        "winners_losers": pd.DataFrame(),
        "metrics": pd.DataFrame(),
        "income_curve": pd.DataFrame(),
        "household_scatter": pd.DataFrame(),
        "constituency": pd.DataFrame(),
        "demographic_constituency": pd.DataFrame(),
        "obr_comparison": pd.DataFrame(),
        "age_impact": pd.DataFrame(),
    }

    for result in results:
        if result.budgetary_impact:
            aggregated["budgetary_impact"] = pd.concat(
                [
                    aggregated["budgetary_impact"],
                    pd.DataFrame(result.budgetary_impact),
                ],
                ignore_index=True,
            )

        if result.distributional_impact:
            aggregated["distributional_impact"] = pd.concat(
                [
                    aggregated["distributional_impact"],
                    pd.DataFrame(result.distributional_impact),
                ],
                ignore_index=True,
            )

        if result.winners_losers:
            aggregated["winners_losers"] = pd.concat(
                [
                    aggregated["winners_losers"],
                    pd.DataFrame(result.winners_losers),
                ],
                ignore_index=True,
            )

        if result.metrics:
            aggregated["metrics"] = pd.concat(
                [
                    aggregated["metrics"],
                    pd.DataFrame(result.metrics),
                ],
                ignore_index=True,
            )

        if result.income_curve:
            aggregated["income_curve"] = pd.concat(
                [
                    aggregated["income_curve"],
                    pd.DataFrame(result.income_curve),
                ],
                ignore_index=True,
            )

        if result.household_scatter:
            aggregated["household_scatter"] = pd.concat(
                [
                    aggregated["household_scatter"],
                    pd.DataFrame(result.household_scatter),
                ],
                ignore_index=True,
            )

        if result.constituency:
            aggregated["constituency"] = pd.concat(
                [
                    aggregated["constituency"],
                    pd.DataFrame(result.constituency),
                ],
                ignore_index=True,
            )

        if result.demographic_constituency:
            aggregated["demographic_constituency"] = pd.concat(
                [
                    aggregated["demographic_constituency"],
                    pd.DataFrame(result.demographic_constituency),
                ],
                ignore_index=True,
            )

        if result.age_impact:
            aggregated["age_impact"] = pd.concat(
                [aggregated["age_impact"], pd.DataFrame(result.age_impact)],
                ignore_index=True,
            )

    # Generate OBR comparison by merging budgetary impact with OBR estimates
    if config and len(aggregated["budgetary_impact"]) > 0:
        obr_path = config.data_inputs_dir / "obr_estimates.csv"
        if obr_path.exists():
            obr_df = pd.read_csv(obr_path)
            pe_df = aggregated["budgetary_impact"].copy()
            pe_df = pe_df.rename(columns={"value": "policyengine_value"})
            # Check if OBR data has both static and behavioural columns
            obr_cols = ["reform_id", "year"]
            if "obr_static_value" in obr_df.columns:
                obr_cols.append("obr_static_value")
            if "obr_post_behavioural_value" in obr_df.columns:
                obr_cols.append("obr_post_behavioural_value")
            if "obr_value" in obr_df.columns:
                obr_cols.append("obr_value")
            comparison = pd.merge(
                pe_df,
                obr_df[obr_cols],
                on=["reform_id", "year"],
                how="left",
            )
            aggregated["obr_comparison"] = comparison

    return aggregated


def generate_all_data(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
    skip_input_check: bool = False,
    runner=None,
    household_scatter: bool = False,
) -> dict[str, pd.DataFrame]:
    """Generate all dashboard data for the given reforms.

    This is the main entry point for data generation.

    Args:
        reforms: List of reforms to process. Defaults to Autumn Budget 2026.
        config: Data configuration. Uses defaults if not provided.
        skip_input_check: Skip checking for input files.
        runner: Runs the measures (see ``DataPipeline.run``).
        household_scatter: Also write ``household_scatter_binned.csv`` from
            the same simulations.

    Returns:
        Dict mapping output name to DataFrame.
    """
    pipeline = DataPipeline(
        reforms=reforms, config=config, household_scatter=household_scatter
    )
    return pipeline.run(skip_input_check=skip_input_check, runner=runner)


# -- one measure's work: the unit a runner runs ------------------------------

# The tables a unit reads from its two simulations. FLAT is every flat CSV,
# age_impact.csv included; AGE and SCATTER alone are ``generate --only``.
FLAT = frozenset({"flat"})
AGE = frozenset({"age_impact"})
DISTRIBUTION = frozenset({"income_distribution"})
GROWTH = frozenset({"income_growth"})
SCATTER = frozenset({"household_scatter"})


@dataclass(frozen=True)
class FlatUnit:
    """One measure for the flat CSVs: what a worker needs to run it."""

    reform: object  # a Reform, or parallel.RegisteredReform
    config: DataConfig
    dataset_path: Optional[str]
    tables: frozenset
    # One year of ``config.years`` for a per-year unit (``flat_units`` with
    # ``by_year``: income_distribution and income_growth only), or None for
    # every year. ``config`` itself is never cut down, so the measure, its
    # baseline and a combined run compose exactly as in a whole unit.
    years: Optional[tuple] = None


@dataclass
class FlatOutcome:
    """What one measure's unit made, and the lines it has to say."""

    reform_id: str
    result: Optional[ReformResult] = None
    # The unit's ``years`` (None for every year), so a per-year outcome is
    # checked against the unit it answers.
    years: Optional[tuple] = None
    reform_name: Optional[str] = None
    age_rows: list = field(default_factory=list)
    distribution_rows: list = field(default_factory=list)
    mobility_rows: list = field(default_factory=list)
    scatter_cells: list = field(default_factory=list)
    growth_rows: list = field(default_factory=list)
    # A per-year income_growth unit's group cells, ``{"baseline": {year:
    # cells}, "reform": {year: cells}}``. Its rows are made only once every
    # year is back (``merge_year_outcomes``), since the floor reads them all.
    growth_cells: dict = field(default_factory=dict)
    messages: list = field(default_factory=list)
    # What the floor of survey households withheld (``hold_flat_to_floor``):
    # the whole measure, or the years with no decile rows. A package's rows
    # carry its members' (``hold_packages_to_members``).
    withheld_whole: bool = False
    withheld_decile_years: set = field(default_factory=set)


def run_flat_unit(unit: FlatUnit) -> FlatOutcome:
    """Build one measure's two simulations once and read every requested
    table from them, under the same data-limit watch and model-limit check
    as before. Runs here or in a worker; it prints nothing, so that the
    parent says each measure's lines in measure order."""
    from uk_budget_data.parallel import resolve_reform

    reform = resolve_reform(unit.reform, unit.config)
    config = unit.config
    dataset_path = unit.dataset_path
    flat = "flat" in unit.tables
    outcome = FlatOutcome(
        reform_id=reform.id, years=unit.years, reform_name=reform.name
    )
    say = outcome.messages.append
    if unit.years is not None and (
        flat or not unit.tables <= DISTRIBUTION | GROWTH
    ):
        raise ValueError(
            "only income_distribution and income_growth run one year per unit"
        )
    years_read = list(unit.years) if unit.years is not None else config.years

    baseline_scenario = reform.baseline_scenario_for(config)
    reform_scenario = reform.to_scenario()

    def warn(reason):
        say(
            f"[bold red]WARNING[/bold red] {escape(reform.id)}: "
            f"{escape(reason)} Generation refuses it."
        )

    wealth_tax = None
    companions = []
    if flat:
        # Generation refuses a measure that changes a wealth-tax scale,
        # leaves out a scored year of an uprated amount or changes a
        # parameter without its companion; this flat path has no gate, so it
        # says so loudly, in the same order, and runs it.
        wealth_tax = wealth_tax_paths(baseline_scenario, reform_scenario)
        if wealth_tax:
            warn(wealth_tax_refusal(*wealth_tax))
        for gap in missing_scored_years(
            getattr(baseline_scenario, "parameter_changes", None),
            reform_scenario.parameter_changes,
            config.years,
            system,
        ):
            warn(gap.reason)
        companions = companion_gaps(baseline_scenario, reform_scenario)
        for gap in companions:
            warn(gap.reason)

    # Built under data_limits.building, so a modifier that reads a limited
    # input while its simulation is built counts.
    baseline = data_limits.watched_build(
        build_microsimulation, dataset_path, baseline_scenario
    )
    reformed = data_limits.watched_build(
        build_microsimulation, dataset_path, reform_scenario
    )
    # A modifier that edits a wealth-tax scale, or a parameter without its
    # companion, which the built simulations show and generation refuses.
    if flat and all(
        hasattr(sim, "tax_benefit_system") for sim in (baseline, reformed)
    ):
        if not wealth_tax:
            built = wealth_tax_paths_differing(baseline, reformed)
            if built:
                warn(wealth_tax_refusal(*built))
        if not companions:
            for gap in built_companion_gaps(
                baseline,
                reformed,
                config.years,
                baseline_scenario,
                reform_scenario,
            ):
                warn(gap.reason)
    survey = None
    if unit.tables & {"household_scatter", "income_distribution"}:
        survey = scatter_survey_households(baseline, dataset_path)

    # Every table is read while the watch runs, from the same two runs.
    with data_limits.observing(baseline, reformed) as observed:
        if flat:
            outcome.result = ReformProcessor(reform, config).process(
                baseline, reformed, baseline_scenario
            )
        elif "age_impact" in unit.tables:
            calculator = AgeImpactCalculator()
            for year in config.years:
                outcome.age_rows.extend(
                    calculator.calculate(
                        baseline, reformed, reform.id, reform.name, year
                    )
                )
        elif "income_distribution" in unit.tables:
            calculator = IncomeDistributionCalculator()
            mobility = IncomeMobilityCalculator()
            for year in years_read:
                outcome.distribution_rows.extend(
                    calculator.calculate(
                        baseline,
                        reformed,
                        reform.id,
                        reform.name,
                        year,
                        survey_households=survey,
                    )
                )
                outcome.mobility_rows.extend(
                    mobility.calculate(
                        baseline,
                        reformed,
                        reform.id,
                        reform.name,
                        year,
                        survey_households=survey,
                    )
                )
        elif "income_growth" in unit.tables:
            from uk_budget_data.living_standards import measures_growth

            years = list(config.years)
            if unit.years is not None:
                # One year's cells; growth_rows runs on the merge.
                outcome.growth_cells = {
                    "baseline": measures_growth.group_cells(
                        baseline, years_read
                    ),
                    "reform": measures_growth.group_cells(
                        reformed, years_read
                    ),
                }
            else:
                outcome.growth_rows = measures_growth.growth_rows(
                    reform.id,
                    reform.name,
                    measures_growth.group_cells(baseline, years),
                    measures_growth.group_cells(reformed, years),
                    years[1:],
                    measures_growth.deflator(),
                )
        if survey is not None and "household_scatter" in unit.tables:
            outcome.scatter_cells = _scatter_cells(
                reform, config, dataset_path, baseline, reformed, survey
            )

    if flat or "age_impact" in unit.tables:
        hold_flat_to_floor(
            outcome, baseline, reformed, dataset_path, list(config.years)
        )

    # This flat path has no publication gate, so say loudly when the data
    # cannot cost a measure, or the model mis-costs it.
    for limit in data_limits.limits_touched(baseline, reformed, observed):
        if flat:
            say(
                f"[bold red]NOT COMPUTABLE ON CURRENT DATA[/bold red] "
                f"{reform.name}: {limit['reason']} Its rows in these "
                "CSVs are not costings; publish it through the gated "
                "path, which lists it as not computable."
            )
        else:
            say(
                f"[bold red]NOT COMPUTABLE ON CURRENT DATA[/bold red] "
                f"{reform.name}: {limit['reason']}"
            )
    for limit in model_limits.limits_touched(baseline, reformed):
        if flat:
            say(
                f"[bold red]MIS-COSTED BY THIS MODEL[/bold red] "
                f"{reform.name}: {limit['reason']} Publish it through "
                "the gated path, which holds it at provisional."
            )
        else:
            say(
                f"[bold red]MIS-COSTED BY THIS MODEL[/bold red] "
                f"{reform.name}: {limit['reason']}"
            )
    # The observation holds both simulations: free them together.
    del baseline, reformed, observed
    say(f"[green]✓[/green] {reform.name}")
    return outcome


def _built_from_a_dataset(simulation) -> bool:
    """Whether ``simulation`` was built from a dataset with tables by year,
    whose household and person tables name the survey households (as
    ``generate._built_from_a_dataset``)."""
    dataset = getattr(simulation, "dataset", None)
    return hasattr(dataset, "years") and hasattr(dataset, "__getitem__")


def hold_flat_to_floor(
    outcome: "FlatOutcome",
    baseline,
    reformed,
    dataset_path: Optional[str],
    years: list[int],
) -> None:
    """Hold one measure's flat rows to the floor of survey households, as
    generation holds an artifact's (``disclosure_floor``; #285 review,
    finding 3, and its second review):

    - When a decile table's "all" is thin in any year, the whole measure's
      change rests on 1 or 2 survey households: none of its rows is
      written, in any table or year, its costing and inequality figures
      included, as the publication gate never shows such an artifact.
    - Otherwise a year in which a decile is thin has no decile rows for the
      measure, which leaves out at least what an artifact withholds (that
      decile's cells and the winners and losers "all" row); the flat
      tables have no receipt to say which blank is withheld.
    - The flat metrics.csv's thin figures are written as empty cells, and
      the age table's thin groups are left out with whatever gives them
      back, as in an artifact.

    What was withheld is said in the unit's lines, by table, year and
    column, never a figure. A package's rows also carry its members'
    (``hold_packages_to_members``).

    A run on simulations built from no dataset (a stand-in in tests) is
    said to be unchecked. One whose survey households cannot be told apart
    is refused on data that could be certified, as generation refuses it;
    on any other data none of its rows is written."""
    from uk_budget_data.publication import disclosure_floor
    from uk_budget_data.publication.generate import _certifiable

    say = outcome.messages.append
    name = escape(outcome.reform_name or outcome.reform_id)
    if not all(_built_from_a_dataset(sim) for sim in (baseline, reformed)):
        say(
            f"{name}: not held to the floor of survey households (its "
            "simulations were not built from a dataset)"
        )
        return
    try:
        survey = scatter_survey_households(baseline, dataset_path)
    except ValueError as error:
        if _certifiable(dataset_path):
            raise ValueError(
                f"{outcome.reform_name or outcome.reform_id}: the survey "
                "households behind the records cannot be told apart, so its "
                f"flat rows cannot be held to the floor: {error}"
            ) from error
        _withhold_whole_measure(outcome)
        say(
            f"[bold red]NOT HELD TO THE FLOOR[/bold red] {name}: its "
            f"survey households cannot be told apart ({escape(str(error))})"
            "; the data is not certified, so none of its rows is written."
        )
        return
    found = disclosure_floor.thin_cells(baseline, reformed, years, survey)
    deciles = {
        cell: labels
        for cell, labels in found.items()
        if cell[0] in disclosure_floor.DECILE_TABLES
    }
    whole = {
        cell: labels for cell, labels in deciles.items() if "all" in labels
    }
    if whole:
        _withhold_whole_measure(outcome)
        say(
            f"{name}: WITHHELD, the whole measure: "
            f"{escape(disclosure_floor.thin_cells_reason(whole))}; none of "
            "its rows is written"
        )
        return
    result = outcome.result
    thin_years = {year for _, year in deciles}
    if result is not None:
        result.age_impact = disclosure_floor.withhold_thin_age_rows(
            result.age_impact, found
        )
        withheld = disclosure_floor.thin_metrics(
            baseline, reformed, years, survey
        )
        result.metrics = disclosure_floor.withhold_metrics(
            result.metrics, withheld
        )
        found.update(withheld)
        _drop_decile_years(outcome, thin_years)
    else:
        # ``generate --only age_impact``: the age table alone
        found = {
            cell: labels
            for cell, labels in found.items()
            if cell[0] == disclosure_floor.AGE_TABLE
        }
    outcome.age_rows = disclosure_floor.withhold_thin_age_rows(
        outcome.age_rows, found
    )
    record = disclosure_floor.floor_record(found)
    line = disclosure_floor.withheld_line(record)
    if line is not None:
        say(f"{name}: {escape(line)}")
    if deciles and result is not None:
        say(
            f"{name}: WITHHELD, no decile rows for "
            f"{', '.join(str(y) for y in sorted(thin_years))}: "
            f"{escape(disclosure_floor.thin_cells_reason(deciles))}"
        )


# The flat tables a measure's result holds (``ReformResult``), all left
# empty when the floor withholds the whole measure.
_RESULT_TABLES = (
    "budgetary_impact",
    "distributional_impact",
    "winners_losers",
    "metrics",
    "income_curve",
    "household_scatter",
    "constituency",
    "demographic_constituency",
    "age_impact",
)


def _withhold_whole_measure(outcome: "FlatOutcome") -> None:
    """Leave out every row of the measure, in every table and year."""
    if outcome.result is not None:
        for table in _RESULT_TABLES:
            if hasattr(outcome.result, table):
                setattr(outcome.result, table, [])
    outcome.age_rows = []
    outcome.scatter_cells = []
    outcome.withheld_whole = True


def _drop_decile_years(outcome: "FlatOutcome", years: set) -> None:
    """Leave out the measure's decile rows in ``years``."""
    outcome.withheld_decile_years |= set(years)
    for table in ("distributional_impact", "winners_losers"):
        setattr(
            outcome.result,
            table,
            [
                row
                for row in getattr(outcome.result, table)
                if row["year"] not in outcome.withheld_decile_years
            ],
        )


def _is_package(reform_id: str) -> bool:
    """Whether a flat outcome is a combined run of other measures: the
    Autumn Budget package, or one under a combined key
    (``combine.combined_key``)."""
    from uk_budget_data.publication.artifacts import COMBINED_PREFIX
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    return reform_id == AUTUMN_BUDGET_2026_COMBINED_ID or reform_id.startswith(
        COMBINED_PREFIX
    )


def hold_packages_to_members(outcomes: list["FlatOutcome"]) -> list[str]:
    """Carry the members' floor into each package's flat rows, as a
    combined artifact inherits its members' withheld cells (#279), so the
    package less its other members never gives a member's withheld figures
    back. A member withheld whole withholds the package whole, as a
    combined artifact with a member never shown is never shown; otherwise
    the package has no decile rows in a year any member has none. Every
    other measure in the run counts as a member, which can only withhold
    more. Returns the lines to say, naming measures and years, never a
    figure."""
    members = [o for o in outcomes if not _is_package(o.reform_id)]
    whole = [o.reform_name or o.reform_id for o in members if o.withheld_whole]
    years = set()
    for member in members:
        years |= member.withheld_decile_years
    lines = []
    for package in outcomes:
        if not _is_package(package.reform_id) or package.withheld_whole:
            continue
        name = escape(package.reform_name or package.reform_id)
        if whole:
            _withhold_whole_measure(package)
            lines.append(
                f"{name}: WITHHELD, the whole package: its members "
                f"{escape(', '.join(whole))} are withheld whole; none of "
                "its rows is written"
            )
        elif package.result is not None and years - (
            package.withheld_decile_years
        ):
            inherited = sorted(years - package.withheld_decile_years)
            _drop_decile_years(package, years)
            lines.append(
                f"{name}: WITHHELD, no decile rows for "
                f"{', '.join(str(y) for y in inherited)}, as a member has "
                "none"
            )
    return lines


def flat_units(
    reforms: list[Reform],
    config: DataConfig,
    dataset_path: Optional[str],
    tables: frozenset,
    runner=None,
    by_year: bool = False,
) -> list[FlatOutcome]:
    """Run one unit per measure and say each measure's lines, in measure
    order. Results come back in measure order whatever the runner.

    ``by_year`` (income_distribution and income_growth only) runs one unit
    per measure and year instead, so a runner that has a container per unit
    (``--backend modal``) runs the years side by side, and folds each
    measure's years back into one outcome (``merge_year_outcomes``): the
    same rows, in the same order, as one unit over every year."""
    from uk_budget_data.parallel import (
        CombinedMeasures,
        SerialRunner,
        portable,
    )

    if by_year and not (tables and tables <= DISTRIBUTION | GROWTH):
        raise ValueError(
            "by_year runs income_distribution and income_growth only"
        )
    runner = runner or SerialRunner()
    references = [
        (
            reform
            if isinstance(reform, CombinedMeasures)
            else portable(reform, runner)
        )
        for reform in reforms
    ]
    if not by_year:
        units = [
            FlatUnit(reference, config, dataset_path, tables)
            for reference in references
        ]

        def report(index, outcome):
            for message in outcome.messages:
                console.print(message)

        return runner.map(run_flat_unit, units, on_result=report)

    years = list(config.years)
    if not years:
        raise ValueError("by_year needs at least one year")
    # Measure-major, year-minor: a measure's years are contiguous, in
    # config.years order, and the measures in their own order.
    units = [
        FlatUnit(reference, config, dataset_path, tables, (year,))
        for reference in references
        for year in years
    ]
    per_measure = len(years)

    returned: list = []

    def report(index, outcome):
        # Say a measure's lines once its last year is back (results come
        # back in unit order), each line once.
        returned.append(outcome)
        if index % per_measure == per_measure - 1:
            for message in _unique(
                line
                for result in returned[-per_measure:]
                for line in result.messages
            ):
                console.print(message)

    outcomes = runner.map(run_flat_unit, units, on_result=report)
    return [
        merge_year_outcomes(
            outcomes[i * per_measure : (i + 1) * per_measure], years, tables
        )
        for i in range(len(references))
    ]


def _unique(lines) -> list:
    """``lines`` with each line kept once, at its first place."""
    return list(dict.fromkeys(lines))


def merge_year_outcomes(
    outcomes: list[FlatOutcome], years: list, tables: frozenset
) -> FlatOutcome:
    """One measure's per-year outcomes (``flat_units`` with ``by_year``),
    in ``years`` order, as the one outcome a unit over every year makes.

    Distribution and mobility rows are made a year at a time and their
    floors are per year, so they concatenate in year order, as the whole
    unit's loop appends them. Growth rows are made here, from every year's
    group cells, by the same ``growth_rows`` the whole unit calls: its
    floor withholds a grouping when any year it reads is under it, so it
    can only run once every year is back. Messages (data-limit and
    model-limit lines, the measure's tick) are kept once each, in the order
    first said."""
    from uk_budget_data.living_standards import measures_growth

    years = list(years)
    if len(outcomes) != len(years):
        raise ValueError(
            f"{len(outcomes)} per-year outcomes for {len(years)} years"
        )
    ids = {outcome.reform_id for outcome in outcomes}
    if len(ids) != 1:
        raise ValueError(f"per-year outcomes of several measures: {ids}")
    for outcome, year in zip(outcomes, years):
        if outcome.years != (year,):
            raise ValueError(
                f"{outcome.reform_id}: an outcome for {outcome.years} in "
                f"place of {year}"
            )
    first = outcomes[0]
    merged = FlatOutcome(
        reform_id=first.reform_id,
        reform_name=first.reform_name,
        messages=_unique(line for o in outcomes for line in o.messages),
    )
    for outcome in outcomes:
        merged.distribution_rows.extend(outcome.distribution_rows)
        merged.mobility_rows.extend(outcome.mobility_rows)
    if "income_growth" in tables:
        cells = {"baseline": {}, "reform": {}}
        for outcome in outcomes:
            for side in cells:
                cells[side].update(outcome.growth_cells[side])
        merged.growth_rows = measures_growth.growth_rows(
            first.reform_id,
            first.reform_name,
            cells["baseline"],
            cells["reform"],
            years[1:],
            measures_growth.deflator(),
        )
    return merged


def _scatter_cells(reform, config, dataset_path, baseline, reformed, survey):
    """One measure's binned scatter cells, as ``generate_household_scatter``
    bins them: every year's households banded by their basis-year income."""
    from uk_budget_data.geography import household_values
    from uk_budget_data.publication.tables import (
        bin_scatter,
        scatter_basis_year,
    )

    basis_year = scatter_basis_year(config.years)
    reference = household_values(baseline, "household_net_income", basis_year)
    rows = []
    for year in config.years:
        rows.extend(
            household_scatter_rows(
                reform,
                year,
                household_values(baseline, "household_net_income", year),
                household_values(reformed, "household_net_income", year),
                household_values(baseline, "household_weight", year),
                survey,
                config.household_scatter_max_income,
                reference_incomes=reference,
                basis_year=basis_year,
            )
        )
    return bin_scatter(rows)


SCATTER_COLUMNS = [
    "reform_id",
    "reform_name",
    "year",
    "income_band",
    "change_band",
    "change_band_upper",
    "households",
    "income_basis_year",
]


def save_scatter(cells: list[dict], output_dir: Path) -> pd.DataFrame:
    """Write ``household_scatter_binned.csv`` from binned cells."""
    frame = pd.DataFrame(cells, columns=SCATTER_COLUMNS)
    path = output_dir / HOUSEHOLD_SCATTER_FILE
    save_csv(frame, path)
    console.print(f"[green]Saved {len(frame)} cells to {path}[/green]")
    return frame


def generate_age_impact(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
    runner=None,
) -> pd.DataFrame:
    """Write only ``age_impact.csv``: results by age band.

    Builds the same two simulations per reform as the full run, on the same
    baselines, but runs only the age calculator, so it is quick to rerun
    after the other files exist. ``uk-budget-data generate --only
    age_impact`` calls it. The full run writes the same file from its own
    simulations, so it needs no second pass.
    """
    reforms = reforms or get_autumn_budget_2026_reforms()
    config = config or DataConfig()
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    outcomes = flat_units(reforms, config, dataset_path, AGE, runner)
    frame = pd.DataFrame([row for o in outcomes for row in o.age_rows])
    save_csv(frame, config.output_dir / "age_impact.csv")
    console.print(
        f"[green]Saved {len(frame)} rows to "
        f"{config.output_dir / 'age_impact.csv'}[/green]"
    )
    return frame


INCOME_DISTRIBUTION_FILE = "income_distribution.csv"
INCOME_MOBILITY_FILE = "income_mobility.csv"


def with_combined_sets(
    reforms: Optional[list[Reform]],
    combined_sets: Optional[list[list[Reform]]],
    runner=None,
) -> list:
    """The units' measures: ``reforms``, then one combined run per set in
    ``combined_sets``, keyed as the publication manifest keys it
    (``combine.combined_key`` of its members, ``combined--...``).

    The page reads a package's rows in these flat files under the key of
    the manifest's combined run of exactly the measures it shows, so rows
    for any other package are never taken for it (#228). With combined
    sets and no ``reforms``, the measures are the sets' members, and the
    registry's own package (``autumn_budget_2026_combined``, every
    candidate) is not run.
    """
    from uk_budget_data.parallel import portable_combined

    if not combined_sets:
        return reforms or get_autumn_budget_2026_reforms()
    if reforms is None:
        reforms = list(
            {
                member.id: member
                for members in combined_sets
                for member in members
            }.values()
        )
    packages = [
        portable_combined(members, runner) for members in combined_sets
    ]
    keys = [package.id for package in packages]
    if len(set(keys)) != len(keys):
        raise ValueError(f"a combined set is listed twice: {keys}")
    return [*reforms, *packages]


def generate_income_distribution(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
    runner=None,
    combined_sets: Optional[list[list[Reform]]] = None,
    by_year: bool = False,
) -> pd.DataFrame:
    """Write only ``income_distribution.csv`` (percentiles of equivalised
    household net income before and after each measure) and
    ``income_mobility.csv`` (who changes place, by starting decile).

    Builds the same two simulations per reform as the full run, on the same
    baselines, and runs only IncomeDistributionCalculator. ``uk-budget-data
    generate --only income_distribution`` calls it. The full run does not
    write this file. ``combined_sets`` adds one combined run per set,
    under its manifest key (:func:`with_combined_sets`). ``by_year`` runs
    each measure's years as units of their own (:func:`flat_units`); the
    file is the same bytes.
    """
    reforms = with_combined_sets(reforms, combined_sets, runner)
    config = config or DataConfig()
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    outcomes = flat_units(
        reforms, config, dataset_path, DISTRIBUTION, runner, by_year=by_year
    )
    frame = pd.DataFrame(
        [row for o in outcomes for row in o.distribution_rows]
    )
    path = config.output_dir / INCOME_DISTRIBUTION_FILE
    save_csv(frame, path)
    console.print(f"[green]Saved {len(frame)} rows to {path}[/green]")
    mobility = pd.DataFrame([row for o in outcomes for row in o.mobility_rows])
    path = config.output_dir / INCOME_MOBILITY_FILE
    save_csv(mobility, path)
    console.print(f"[green]Saved {len(mobility)} rows to {path}[/green]")
    return frame


INCOME_GROWTH_FILE = "income_growth_with_measures.csv"


def generate_income_growth(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
    runner=None,
    combined_sets: Optional[list[list[Reform]]] = None,
    by_year: bool = False,
) -> pd.DataFrame:
    """Write only ``income_growth_with_measures.csv``: real growth of each
    income group's median (HBAI income, as the Living standards outlook's
    ``income_growth_by_group``) under each measure and under its own
    baseline, and the difference, by year (see
    ``living_standards.measures_growth``).

    Builds the same two simulations per reform as the full run, on the same
    baselines. ``uk-budget-data generate --only income_growth`` calls it;
    the full run does not write this file. The first configured year is
    read only, as the year before the first year published.
    ``combined_sets`` adds one combined run per set, under its manifest
    key (:func:`with_combined_sets`). ``by_year`` runs each measure's
    years as units of their own (:func:`flat_units`); the file is the same
    bytes.
    """
    from uk_budget_data.living_standards.measures_growth import COLUMNS

    reforms = with_combined_sets(reforms, combined_sets, runner)
    config = config or DataConfig()
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    outcomes = flat_units(
        reforms, config, dataset_path, GROWTH, runner, by_year=by_year
    )
    frame = pd.DataFrame(
        [row for o in outcomes for row in o.growth_rows], columns=COLUMNS
    )
    path = config.output_dir / INCOME_GROWTH_FILE
    save_csv(frame, path)
    console.print(f"[green]Saved {len(frame)} rows to {path}[/green]")
    return frame


HOUSEHOLD_SCATTER_FILE = "household_scatter_binned.csv"


def scatter_survey_households(simulation, dataset_path: Optional[str]):
    """The survey household behind each of a simulation's households.

    In the engine's household order. Microcosm builds several records from
    one survey household, so the scatter's floor counts these ids, as the
    results by area do (``geography.survey_household_ids``). A dataset the
    bundle resolves, its default (None) or one given by name, is a
    Microcosm export when its data package is Microcosm's; a local file is
    one when its H5 carries the export marker.
    """
    from policyengine.provenance.manifest import (
        dataset_logical_name,
        get_release_manifest,
    )

    from uk_budget_data import geography

    tables = geography.dataset_tables(simulation)
    if dataset_path is None or not Path(dataset_path).is_file():
        manifest = get_release_manifest("uk")
        name = (
            manifest.default_dataset
            if dataset_path is None
            else dataset_logical_name(dataset_path)
        )
        # The bundle's own datasets name no package of their own.
        package = getattr(
            manifest.datasets.get(name), "data_package_name", None
        )
        microcosm = (package or manifest.data_package.name) == "microcosm-data"
    else:
        microcosm = geography.is_microcosm_export(dataset_path)
    return geography.survey_household_ids(
        tables.household,
        tables.person,
        geography.MICROCOSM if microcosm else geography.EFRS,
        microcosm_export=microcosm,
    )


def household_scatter_rows(
    reform: Reform,
    year: int,
    baseline_incomes,
    reform_incomes,
    weights,
    survey_households,
    max_income: float,
    reference_incomes=None,
    basis_year: Optional[int] = None,
) -> list[dict]:
    """One year's household rows for the binned scatter, never published.

    ``reference_incomes`` are the same households' baseline net incomes in
    ``basis_year``: each row carries its household's, and ``bin_scatter``
    bands it by that, so a household sits in the same income band in every
    year. Households whose basis-year income is from £0 to ``max_income``
    are kept, in every year alike, so every year holds the same households.
    Without ``reference_incomes`` a year is banded and kept by its own
    baseline income. Each row names its survey household so that
    ``bin_scatter`` counts those.
    """
    if reference_incomes is None:
        reference_incomes, basis_year = baseline_incomes, year
    elif basis_year is None:
        raise ValueError("reference_incomes need their basis_year")
    rows = []
    for base, new, weight, survey, reference in zip(
        baseline_incomes,
        reform_incomes,
        weights,
        survey_households,
        reference_incomes,
        strict=True,
    ):
        if 0 <= reference <= max_income:
            rows.append(
                {
                    "reform_id": reform.id,
                    "reform_name": reform.name,
                    "year": year,
                    "baseline_income": float(base),
                    "income_change": float(new - base),
                    "household_weight": float(weight),
                    "survey_household": survey,
                    "reference_income": float(reference),
                    "income_basis_year": int(basis_year),
                }
            )
    return rows


def generate_household_scatter(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
    runner=None,
) -> pd.DataFrame:
    """Write only ``household_scatter_binned.csv``: the binned scatter.

    Households by baseline income band and income change band, for each
    reform and year, binned as the receipted artifacts bin them
    (``publication.tables.bin_scatter``): cells with fewer than the floor
    of survey households are left out, and counts are rounded. No
    household row is written anywhere. ``uk-budget-data generate --only
    household_scatter`` calls it; the full run writes the same file from
    its own simulations.
    """
    reforms = reforms or get_autumn_budget_2026_reforms()
    config = config or DataConfig()
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    outcomes = flat_units(reforms, config, dataset_path, SCATTER, runner)
    return save_scatter(
        [cell for o in outcomes for cell in o.scatter_cells],
        config.output_dir,
    )


def generate_income_curve(
    reforms: Optional[list[Reform]] = None,
    config: Optional[DataConfig] = None,
) -> pd.DataFrame:
    """Write only ``income_curve.csv``: the example households' curves.

    The same rows as the full run's income curve, on the same baselines
    (each measure's ``baseline_scenario_for(config)``) and reform scenarios,
    but from household simulations alone: no survey data, so no dataset or
    HUGGING_FACE_TOKEN is needed. Each distinct scenario is simulated once
    per household for every year at once, and shared by the measures that
    use it (most measures keep current law on one side).
    ``uk-budget-data income-curve`` calls it.
    """
    from uk_budget_data.example_households import EXAMPLE_HOUSEHOLDS
    from uk_budget_data.personal_impact import scenario_key

    reforms = reforms or get_autumn_budget_2026_reforms()
    config = config or DataConfig()
    calculator = IncomeCurveCalculator(num_points=config.income_curve_points)
    years = list(config.years)
    rows = []
    for household in EXAMPLE_HOUSEHOLDS:
        curves = {}

        def curve(scenario):
            key = scenario_key(scenario)
            if key not in curves:
                curves[key] = calculator.simulate(household, scenario, years)
            return curves[key]

        for reform in reforms:
            rows.extend(
                calculator.rows(
                    household,
                    curve(reform.baseline_scenario_for(config)),
                    curve(reform.to_scenario()),
                    reform.id,
                    reform.name,
                    years,
                )
            )
        console.print(
            f"[green]✓[/green] {household.label}: "
            f"{len(curves)} scenarios simulated"
        )
    # Measures in the registry's order, then year, then the households in
    # their own order, then income.
    reform_order = {reform.id: i for i, reform in enumerate(reforms)}
    household_order = {h.id: i for i, h in enumerate(EXAMPLE_HOUSEHOLDS)}
    frame = pd.DataFrame(rows)
    frame = (
        frame.assign(
            _reform=frame["reform_id"].map(reform_order),
            _household=frame["household"].map(household_order),
        )
        .sort_values(["_reform", "year", "_household", "income"])
        .drop(columns=["_reform", "_household"])
        .reset_index(drop=True)
    )
    save_csv(frame, config.output_dir / "income_curve.csv")
    console.print(
        f"[green]Saved {len(frame)} rows to "
        f"{config.output_dir / 'income_curve.csv'}[/green]"
    )
    return frame
