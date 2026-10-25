"""Command-line interface for UK Budget Data generation."""

import argparse
import json
from pathlib import Path

from rich.console import Console
from rich.table import Table

from uk_budget_data import historical_events, releases
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.geography import add_geography_parser, run_geography
from uk_budget_data.living_standards.commands import (
    add_living_standards_parsers,
    run_living_standards,
    run_obr_forecast,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.parallel import add_jobs_arguments
from uk_budget_data.pipeline import (
    generate_age_impact,
    generate_all_data,
    generate_household_scatter,
    generate_income_curve,
)
from uk_budget_data.private_outputs import (
    AUDIT_DIR_ENV,
    PrivateOutputError,
    private_directory,
)
from uk_budget_data.publication.commands import (
    add_generate_arguments,
    add_publish_parser,
    run_generate_artifacts,
    run_publish,
)
from uk_budget_data.reforms import (
    get_autumn_budget_2026_reforms,
    get_reform,
)

console = Console()


class DefaultYears(list):
    """The policy years, as ``generate --years`` defaults to them: a list
    like any other, marked so a past event can tell it was not asked
    for and score its own years instead."""


def parse_args(args: list[str] = None) -> argparse.Namespace:
    """Parse command-line arguments.

    Args:
        args: List of arguments (uses sys.argv if None).

    Returns:
        Parsed arguments namespace.
    """
    parser = argparse.ArgumentParser(
        prog="uk-budget-data",
        description="Generate data for UK Autumn Budget dashboard.",
    )

    subparsers = parser.add_subparsers(
        dest="command", help="Available commands"
    )

    # Dashboard data generation command
    generate_parser = subparsers.add_parser(
        "generate", help="Generate dashboard data"
    )

    generate_parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./public/data"),
        help="Output directory for CSV files (default: ./public/data)",
    )

    generate_parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("./data"),
        help="Directory containing input data files (default: ./data)",
    )

    generate_parser.add_argument(
        "--data-inputs-dir",
        type=Path,
        default=Path("./data_inputs"),
        help="Directory containing reference data (default: ./data_inputs)",
    )

    generate_parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Path to enhanced FRS dataset (optional)",
    )

    generate_parser.add_argument(
        "--reforms",
        nargs="+",
        default=None,
        help="Reform IDs to process (default: all Autumn Budget reforms)",
    )

    generate_parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=DefaultYears(POLICY_YEARS),
        help=(
            "Years to calculate (default: the policy years in "
            f"budget_years.json, {POLICY_YEARS[0]} to {POLICY_YEARS[-1]}; "
            "for a past event, the years its registry scores)"
        ),
    )

    generate_parser.add_argument(
        "--list-reforms",
        action="store_true",
        help="List all available reform IDs and exit",
    )

    generate_parser.add_argument(
        "--skip-input-check",
        action="store_true",
        help="Skip checking for input files",
    )

    generate_parser.add_argument(
        "--legacy-geography",
        action="store_true",
        help=(
            "Also run the legacy constituency calculators, writing their "
            f"rows to ${AUDIT_DIR_ENV}/legacy. They have no disclosure "
            "control, so they are never written to --output-dir."
        ),
    )

    generate_parser.add_argument(
        "--only",
        choices=["age_impact", "household_scatter"],
        default=None,
        help=(
            "Write only this file to --output-dir, leaving the others as "
            "they are. age_impact: results by age band (age_impact.csv). "
            "household_scatter: households by income band and income "
            "change band, binned (household_scatter_binned.csv)."
        ),
    )

    add_generate_arguments(generate_parser)
    add_jobs_arguments(generate_parser, modal=True)

    import_parser = subparsers.add_parser(
        "import-replay",
        help="Import past fiscal events from policyengine-scorecard exports",
    )
    import_parser.add_argument(
        "exports",
        nargs="+",
        type=Path,
        help="Event exports (results/uk/dashboard_export/<variant>/<event>"
        ".json in policyengine-scorecard)",
    )
    import_parser.add_argument(
        "--events-root",
        type=Path,
        default=Path("src/uk_budget_data/events"),
        help="Where the event registries go (default: "
        "src/uk_budget_data/events)",
    )
    import_parser.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="Also write each release's flat view files (coverage, "
        "not-modelled measures, OBR comparison) into its root under this "
        "default data root, normally public/data",
    )

    # The example households alone: household simulations, no survey data
    income_curve_parser = subparsers.add_parser(
        "income-curve",
        help=(
            "Write only income_curve.csv: the example households' net "
            "income across their income grids (no dataset needed)"
        ),
    )
    income_curve_parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./public/data"),
        help="Output directory (default: ./public/data)",
    )
    income_curve_parser.add_argument(
        "--reforms",
        nargs="+",
        default=None,
        help="Reform IDs to process (default: all Autumn Budget reforms)",
    )
    income_curve_parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=list(POLICY_YEARS),
        help=(
            "Years to calculate (default: the policy years in "
            f"budget_years.json, {POLICY_YEARS[0]} to {POLICY_YEARS[-1]})"
        ),
    )

    add_publish_parser(subparsers)
    add_geography_parser(subparsers)
    add_living_standards_parsers(subparsers)

    return parser.parse_args(args)


def runner_for(parsed: argparse.Namespace, units: int, years: int):
    """The runner ``--jobs`` and ``--backend`` ask for."""
    from uk_budget_data.parallel import make_runner

    jobs = parsed.jobs
    if jobs != "auto":
        try:
            if int(jobs) < 1:
                raise ValueError
        except ValueError:
            raise SystemExit(
                f"--jobs takes a whole number from 1, or auto, not {jobs!r}"
            ) from None
    return make_runner(
        jobs,
        units,
        years,
        backend=getattr(parsed, "backend", "local"),
        say=console.print,
        unit_gb=parsed.unit_memory_gb,
    )


def get_reforms_from_ids(reform_ids: list[str]) -> list[Reform]:
    """Get Reform objects from a list of IDs.

    Args:
        reform_ids: List of reform IDs.

    Returns:
        List of Reform objects (unknown IDs are skipped with warning).
    """
    reforms = []
    for reform_id in reform_ids:
        reform = get_reform(reform_id)
        if reform:
            reforms.append(reform)
        else:
            console.print(
                f"[yellow]Warning: Unknown reform ID '{reform_id}', "
                "skipping[/yellow]"
            )
    return reforms


def print_reforms_list() -> None:
    """Print a table of available reforms."""
    table = Table(title="Available Reforms")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Type", style="yellow")

    for reform in get_autumn_budget_2026_reforms():
        reform_type = (
            "Structural" if reform.simulation_modifier else "Parameter"
        )
        table.add_row(reform.id, reform.name, reform_type)

    console.print(table)
    console.print(
        "\n[dim]Use --reforms ID1 ID2 to select specific reforms[/dim]"
    )


def _generation_release(parsed: argparse.Namespace):
    """The release a generate run writes: the one whose root holds its
    artifacts root (this Budget's unless that is a past event's), or a
    ReleaseError."""
    if not (parsed.artifacts or parsed.combined):
        return releases.DEFAULT_RELEASE
    return releases.release_for_root(Path(parsed.artifacts_root).parent)


def run_generate(parsed: argparse.Namespace) -> int:
    """Run the generate command."""
    # Handle --list-reforms
    if parsed.list_reforms:
        print_reforms_list()
        return 0

    try:
        release = _generation_release(parsed)
        if release.historical:
            return run_generate_historical(parsed, release)
    except (releases.ReleaseError, historical_events.EventImportError) as e:
        console.print(f"[red]Error: {e}[/red]")
        return 1

    legacy_geography_dir = None
    if parsed.legacy_geography:
        try:
            legacy_geography_dir = private_directory(subdirectory="legacy")
        except PrivateOutputError as e:
            console.print(f"[red]Error: {e}[/red]")
            return 1

    # Build configuration
    config = DataConfig(
        output_dir=parsed.output_dir,
        data_dir=parsed.data_dir,
        data_inputs_dir=parsed.data_inputs_dir,
        dataset_path=parsed.dataset,
        years=parsed.years,
        legacy_geography_dir=legacy_geography_dir,
    )

    # Get reforms
    if parsed.reforms:
        reforms = get_reforms_from_ids(parsed.reforms)
        if not reforms:
            console.print("[red]Error: No valid reforms specified[/red]")
            return 1
    else:
        reforms = get_autumn_budget_2026_reforms()

    # Print summary
    console.print("\n[bold]UK Budget Data Generator[/bold]")
    console.print(f"Output: {config.output_dir}")
    console.print(f"Years: {config.years}")
    console.print(f"Reforms: {len(reforms)}")
    console.print()

    if parsed.only is not None:
        if parsed.artifacts or parsed.combined or parsed.legacy_geography:
            console.print(
                "[red]Error: --only writes one flat CSV; it does not combine "
                "with --artifacts, --combined or --legacy-geography[/red]"
            )
            return 1
        runner = runner_for(parsed, len(reforms), len(config.years))
        if parsed.only == "household_scatter":
            generate_household_scatter(
                reforms=reforms, config=config, runner=runner
            )
        else:
            generate_age_impact(reforms=reforms, config=config, runner=runner)
        return 0

    # Receipted artifacts: one write-once directory per measure, and one
    # per combined set. --combined alone generates only the combined runs.
    if parsed.artifacts or parsed.combined:
        if parsed.backend != "local":
            console.print(
                "[red]Error: --artifacts runs locally only: a receipt binds "
                "the execution it was made in, and Modal's would differ "
                "from every other entry's[/red]"
            )
            return 1
        standalone = reforms if (parsed.reforms or not parsed.combined) else []
        units = max(len(standalone), len(parsed.combined or []), 1)
        return run_generate_artifacts(
            parsed,
            config,
            standalone,
            get_reform,
            runner=runner_for(parsed, units, len(config.years)),
        )

    # Run pipeline
    try:
        generate_all_data(
            reforms=reforms,
            config=config,
            skip_input_check=parsed.skip_input_check,
            runner=runner_for(parsed, len(reforms), len(config.years)),
            # The binned scatter, from the same simulations, so that
            # --only household_scatter needs no second pass.
            household_scatter=True,
        )
        console.print("\n[bold green]Data generation complete![/bold green]")
        # The household scatter is no longer sampled into public/data: one
        # row per survey household is unit-record data.

        console.print("\n[bold green]Done![/bold green]")
        return 0
    except FileNotFoundError as e:
        console.print(f"\n[red]Error: {e}[/red]")
        return 1
    except Exception as e:
        console.print(f"\n[red]Unexpected error: {e}[/red]")
        raise


def run_generate_historical(parsed: argparse.Namespace, release) -> int:
    """Generate a past event's artifacts in its own root, from its own
    registry only, over the years the registry scores."""
    document = historical_events.load_event(release.id)
    if document is None:
        raise historical_events.EventImportError(
            f"{release.id}: no event registry is imported (import-replay)"
        )
    years = document["years"]
    asked = None if isinstance(parsed.years, DefaultYears) else parsed.years
    if asked is not None and not set(asked) <= set(years):
        raise historical_events.EventImportError(
            f"{release.id} scores {years}; --years asks for others"
        )
    if parsed.only or parsed.legacy_geography:
        raise historical_events.EventImportError(
            "a past event is generated only as receipted artifacts"
        )
    # A worker process is sent a measure that does not pickle by its id,
    # looked up in this Budget's registry (parallel.portable), so a past
    # event's measures run here, one after another, never by that route
    if parsed.backend != "local" or str(parsed.jobs) != "1":
        raise historical_events.EventImportError(
            "a past event's measures run locally, one after another "
            "(--jobs 1, --backend local)"
        )
    lookup = historical_events.release_reform_lookup(release)
    ids = parsed.reforms or [record["id"] for record in document["measures"]]
    reforms = [lookup(reform_id) for reform_id in ids]
    unknown = [i for i, reform in zip(ids, reforms) if reform is None]
    if unknown:
        raise historical_events.EventImportError(
            f"not measures of {release.name}: {', '.join(unknown)}"
        )
    config = DataConfig(
        output_dir=releases.data_root_for(release, Path("public/data")),
        data_dir=parsed.data_dir,
        data_inputs_dir=parsed.data_inputs_dir,
        dataset_path=parsed.dataset,
        years=list(asked or years),
    )
    console.print(f"\n[bold]{release.name}[/bold], on today's model and data")
    console.print(f"Artifacts: {parsed.artifacts_root}")
    console.print(f"Years: {config.years}")
    console.print(f"Measures: {len(reforms)}")
    standalone = reforms if (parsed.reforms or not parsed.combined) else []
    return run_generate_artifacts(parsed, config, standalone, lookup)


def run_import_replay(parsed: argparse.Namespace) -> int:
    """Run the import-replay command."""
    parsed.events_root.mkdir(parents=True, exist_ok=True)
    for export in parsed.exports:
        try:
            registry, written = historical_events.import_file(
                export, parsed.events_root, parsed.data_root
            )
        except (historical_events.EventImportError, OSError) as e:
            console.print(f"[red]Error: {export}: {e}[/red]")
            return 1
        document = json.loads(registry.read_text())
        console.print(
            f"{document['release']}: {len(document['measures'])} measures "
            f"imported over {document['years']}, "
            f"{len(document['not_modelled'])} not modelled -> {registry}"
        )
        for path in written:
            console.print(f"  {path}")
    return 0


def run_income_curve(parsed: argparse.Namespace) -> int:
    """Run the income-curve command."""
    if parsed.reforms:
        reforms = get_reforms_from_ids(parsed.reforms)
        if not reforms:
            console.print("[red]Error: No valid reforms specified[/red]")
            return 1
    else:
        reforms = get_autumn_budget_2026_reforms()
    config = DataConfig(output_dir=parsed.output_dir, years=parsed.years)
    generate_income_curve(reforms=reforms, config=config)
    return 0


def main(args: list[str] = None) -> int:
    """Main entry point for CLI.

    Args:
        args: Command-line arguments (uses sys.argv if None).

    Returns:
        Exit code (0 for success).
    """
    parsed = parse_args(args)

    if parsed.command == "generate":
        return run_generate(parsed)
    elif parsed.command == "income-curve":
        return run_income_curve(parsed)
    elif parsed.command == "publish":
        return run_publish(parsed)
    elif parsed.command == "import-replay":
        return run_import_replay(parsed)
    elif parsed.command == "geography":
        return run_geography(parsed)
    elif parsed.command == "living-standards":
        return run_living_standards(parsed)
    elif parsed.command == "obr-forecast":
        return run_obr_forecast(parsed)
    else:
        # Default to showing help
        console.print("[bold]UK Budget Data CLI[/bold]\n")
        console.print("Commands:")
        console.print(
            "  generate  - Generate dashboard data from microsimulation"
        )
        console.print("  income-curve - The example households' curves only")
        console.print(
            "  publish   - Reconcile, stage, approve and check publications"
        )
        console.print(
            "  import-replay - Import past fiscal events from scorecard exports"
        )
        console.print(
            "  geography - Results by region and constituency, disclosure "
            "controlled"
        )
        console.print(
            "  living-standards - The Living standards tab's outlook data"
        )
        console.print("  obr-forecast - Load a new OBR forecast into that tab")
        console.print(
            "\nRun 'uk-budget-data <command> --help' for command options."
        )
        return 0


if __name__ == "__main__":
    exit(main())
