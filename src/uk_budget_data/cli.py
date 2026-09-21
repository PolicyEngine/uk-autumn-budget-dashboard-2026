"""Command-line interface for UK Budget Data generation."""

import argparse
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.table import Table

from uk_budget_data.lifetime_impact import (
    GRADUATE_STARTING_INCOME,
    calculate_lifetime_impact,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import generate_all_data
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
        default=[2026, 2027, 2028, 2029, 2030],
        help="Years to calculate (default: 2026 2027 2028 2029 2030)",
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

    # Lifetime impact command
    lifetime_parser = subparsers.add_parser(
        "lifetime",
        help="Calculate lifetime impact of budget policies on a graduate",
    )

    lifetime_parser.add_argument(
        "--income",
        type=str,
        choices=["p25", "p50", "p75", "p90"],
        default="p50",
        help=f"Graduate income percentile: p25=£{GRADUATE_STARTING_INCOME['p25']:,}, "
        f"p50=£{GRADUATE_STARTING_INCOME['p50']:,}, p75=£{GRADUATE_STARTING_INCOME['p75']:,}, "
        f"p90=£{GRADUATE_STARTING_INCOME['p90']:,} (default: p50)",
    )

    lifetime_parser.add_argument(
        "--marriage-age",
        type=int,
        default=31,
        help="Age of marriage (default: 31, use 0 for never married)",
    )

    lifetime_parser.add_argument(
        "--children",
        type=int,
        default=2,
        help="Number of children (default: 2, born every 2 years after marriage)",
    )

    lifetime_parser.add_argument(
        "--student-loan",
        type=float,
        default=45000,
        help="Student loan balance at graduation (default: £45,000)",
    )

    lifetime_parser.add_argument(
        "--salary-sacrifice",
        type=float,
        default=0,
        help="Annual salary sacrifice pension contributions (default: £0)",
    )

    lifetime_parser.add_argument(
        "--rail-spending",
        type=float,
        default=1500,
        help="Annual rail spending (default: £1,500)",
    )

    lifetime_parser.add_argument(
        "--fuel-spending",
        type=float,
        default=1200,
        help="Annual fuel spending (default: £1,200)",
    )

    lifetime_parser.add_argument(
        "--dividend-income",
        type=float,
        default=0,
        help="Annual dividend income (default: £0)",
    )

    lifetime_parser.add_argument(
        "--savings-interest",
        type=float,
        default=500,
        help="Annual savings interest (default: £500)",
    )

    lifetime_parser.add_argument(
        "--property-income",
        type=float,
        default=0,
        help="Annual property income (default: £0)",
    )

    lifetime_parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output CSV file (default: print summary only)",
    )

    lifetime_parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress output",
    )

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

    # Build configuration
    config = DataConfig(
        output_dir=parsed.output_dir,
        data_dir=parsed.data_dir,
        data_inputs_dir=parsed.data_inputs_dir,
        dataset_path=parsed.dataset,
        years=parsed.years,
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

    # Run pipeline
    try:
        generate_all_data(
            reforms=reforms,
            config=config,
            skip_input_check=parsed.skip_input_check,
        )
        console.print("\n[bold green]Data generation complete![/bold green]")

        # Run household scatter sampling script
        sampling_script = Path("scripts/sample_household_scatter.py")
        if sampling_script.exists():
            console.print(
                "\n[bold]Running household scatter sampling...[/bold]"
            )
            result = subprocess.run(
                [sys.executable, str(sampling_script)],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                console.print("[green]Sampling complete![/green]")
            else:
                console.print(
                    f"[yellow]Sampling warning: {result.stderr}[/yellow]"
                )

        console.print("\n[bold green]Done![/bold green]")
        return 0
    except FileNotFoundError as e:
        console.print(f"\n[red]Error: {e}[/red]")
        return 1
    except Exception as e:
        console.print(f"\n[red]Unexpected error: {e}[/red]")
        raise


def run_lifetime(parsed: argparse.Namespace) -> int:
    """Run the lifetime impact command."""
    marriage_age = parsed.marriage_age if parsed.marriage_age > 0 else None

    df = calculate_lifetime_impact(
        income_percentile=parsed.income,
        marriage_age=marriage_age,
        num_children=parsed.children,
        student_loan_balance=parsed.student_loan,
        salary_sacrifice=parsed.salary_sacrifice,
        rail_spending=parsed.rail_spending,
        fuel_spending=parsed.fuel_spending,
        dividend_income=parsed.dividend_income,
        savings_interest=parsed.savings_interest,
        property_income=parsed.property_income,
        verbose=not parsed.quiet,
    )

    if parsed.output:
        df.to_csv(parsed.output, index=False)
        console.print(
            f"\n[green]Saved {len(df)} years to {parsed.output}[/green]"
        )

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
    elif parsed.command == "lifetime":
        return run_lifetime(parsed)
    else:
        # Default to showing help
        console.print("[bold]UK Budget Data CLI[/bold]\n")
        console.print("Commands:")
        console.print(
            "  generate  - Generate dashboard data from microsimulation"
        )
        console.print("  lifetime  - Calculate lifetime impact on a graduate")
        console.print(
            "\nRun 'uk-budget-data <command> --help' for command options."
        )
        return 0


if __name__ == "__main__":
    exit(main())
