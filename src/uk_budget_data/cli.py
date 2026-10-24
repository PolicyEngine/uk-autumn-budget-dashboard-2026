"""Command-line interface for UK Budget Data generation."""

import argparse
from pathlib import Path

from rich.console import Console
from rich.table import Table

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.geography import add_geography_parser, run_geography
from uk_budget_data.models import DataConfig, Reform
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
        default=list(POLICY_YEARS),
        help=(
            "Years to calculate (default: the policy years in "
            f"budget_years.json, {POLICY_YEARS[0]} to {POLICY_YEARS[-1]})"
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

    return parser.parse_args(args)


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


def run_generate(parsed: argparse.Namespace) -> int:
    """Run the generate command."""
    # Handle --list-reforms
    if parsed.list_reforms:
        print_reforms_list()
        return 0

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
        if parsed.only == "household_scatter":
            generate_household_scatter(reforms=reforms, config=config)
        else:
            generate_age_impact(reforms=reforms, config=config)
        return 0

    # Receipted artifacts: one write-once directory per measure, and one
    # per combined set. --combined alone generates only the combined runs.
    if parsed.artifacts or parsed.combined:
        standalone = reforms if (parsed.reforms or not parsed.combined) else []
        return run_generate_artifacts(parsed, config, standalone, get_reform)

    # Run pipeline
    try:
        generate_all_data(
            reforms=reforms,
            config=config,
            skip_input_check=parsed.skip_input_check,
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
    elif parsed.command == "geography":
        return run_geography(parsed)
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
            "  geography - Results by region and constituency, disclosure "
            "controlled"
        )
        console.print(
            "\nRun 'uk-budget-data <command> --help' for command options."
        )
        return 0


if __name__ == "__main__":
    exit(main())
