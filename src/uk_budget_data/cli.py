"""Command-line interface for UK Budget Data generation."""

import argparse
from pathlib import Path

from rich.console import Console
from rich.table import Table

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.constituencies import (
    add_constituencies_parser,
    run_constituencies,
)
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
    generate_income_distribution,
    generate_income_growth,
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
        choices=[
            "age_impact",
            "household_scatter",
            "income_distribution",
            "income_growth",
        ],
        default=None,
        help=(
            "Write only this file to --output-dir, leaving the others as "
            "they are. age_impact: results by age band (age_impact.csv). "
            "household_scatter: households by income band and income "
            "change band, binned (household_scatter_binned.csv). "
            "income_distribution: percentiles of equivalised household net "
            "income before and after each measure "
            "(income_distribution.csv). income_growth: real growth of "
            "each income group's median HBAI income with each measure and "
            "under its baseline (income_growth_with_measures.csv)."
        ),
    )

    generate_parser.add_argument(
        "--published-package",
        action="store_true",
        help=(
            "With --only income_distribution or income_growth: run the "
            "measures the publication manifest lists for the page "
            "(provisional or approved) and its combined run of exactly "
            "those, under the manifest's combined key, in place of every "
            "registered measure and the registry's package. Run it after "
            "the artifacts are staged. --combined ID... does the same for "
            "a set given by hand."
        ),
    )
    generate_parser.add_argument(
        "--sequential",
        action="store_true",
        help=(
            "With --only income_distribution or income_growth and "
            "--backend modal: run each measure's years one after another "
            "in one container, as before, in place of one container per "
            "measure and year. The files are the same bytes either way. "
            "A local run always runs a measure's years in one unit."
        ),
    )
    generate_parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help=(
            "Publication manifest for --published-package (default: "
            "public/data/manifest.json)"
        ),
    )

    generate_parser.add_argument(
        "--national",
        action="store_true",
        help=(
            "The national results in one run: each measure in --reforms as "
            "a receipted artifact, then their package (the combined run of "
            "all of them), and income_distribution.csv, income_mobility.csv "
            "and income_growth_with_measures.csv from the same simulations. "
            "With --backend modal it is one Modal app, the dataset cached "
            "on a Volume. Replaces --artifacts, --combined and the two "
            "--only ... --published-package runs; those still work."
        ),
    )
    generate_parser.add_argument(
        "--combined-key",
        default=None,
        metavar="KEY",
        help=(
            "With --national: the package key you expect (combined--...); "
            "the run stops if --reforms makes another"
        ),
    )
    generate_parser.add_argument(
        "--no-flat-files",
        action="store_true",
        help="With --national: make the artifacts only, not the flat files",
    )
    generate_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --national: print the plan and stop; nothing runs",
    )

    add_generate_arguments(generate_parser)
    add_jobs_arguments(generate_parser, modal=True)

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

    # What each measure changes, current law beside the measure: parameter
    # lookups only, no dataset or simulation
    policy_table_parser = subparsers.add_parser(
        "policy-table",
        help=(
            "Write only policy_parameters.json: each measure's policy "
            "parameters before and after, from the model (no dataset needed)"
        ),
    )
    policy_table_parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./public/data"),
        help="Output directory (default: ./public/data)",
    )

    add_publish_parser(subparsers)
    add_geography_parser(subparsers)
    add_constituencies_parser(subparsers)
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


def modal_artifacts_problem(dataset, repo_root: Path = Path(".")) -> str:
    """Why ``--artifacts --backend modal`` cannot run, or "".

    The containers run the working tree's package, so a run on the bundle's
    dataset needs the committed tree: its receipts then name the code that
    ran. A local dataset file is never sent; a ``synthetic:`` dataset (the
    smoke test) is built in each container instead.
    """
    from uk_budget_data import synthetic_dataset
    from uk_budget_data.publication.receipt import code_revision

    if dataset is not None:
        if str(dataset).startswith(synthetic_dataset.PREFIX):
            return ""
        return (
            "--backend modal never sends a dataset file; leave out --dataset "
            "to use the bundle's, or use synthetic:<households>:<seed> to "
            "test the plumbing"
        )
    revision = code_revision(repo_root)
    if not revision.tree_clean:
        return (
            "--artifacts --backend modal needs a clean working tree, so the "
            "receipts name the code the containers ran: "
            + ", ".join(revision.dirty_paths[:5])
        )
    return ""


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


# The flat files the page reads a package's rows from, by the manifest's
# combined key (#228): these take --combined and --published-package.
PACKAGE_FLAT_FILES = ("income_distribution", "income_growth")


def published_package(manifest) -> tuple[list[str], list[str]]:
    """The measures the page shows from ``manifest`` and its package.

    The measures are those with a displayable status (provisional or
    approved), sorted by id. The package is the displayable combined run of
    exactly those measures whose members' outputs are the ones it recorded,
    as the page picks it (``combinedEntryFor`` in
    ``src/utils/publication/select.js``); with one measure there is none.
    Raises ValueError when there is nothing to show, or no such combined
    run for two or more measures.
    """
    from uk_budget_data.publication.manifest import DISPLAYABLE

    ids = sorted(
        key
        for key, entry in manifest.measures.items()
        if entry.status in DISPLAYABLE
    )
    if not ids:
        raise ValueError("the manifest lists no measure for the page")
    if len(ids) == 1:
        return ids, []
    for key in sorted(manifest.combined):
        entry = manifest.combined[key]
        if (
            entry.status in DISPLAYABLE
            and sorted(entry.measures or []) == ids
            and all(
                (entry.member_outputs_sha256 or {}).get(member)
                == manifest.measures[member].outputs_sha256
                for member in ids
            )
        ):
            return ids, sorted(entry.measures)
    raise ValueError(
        "the manifest has no displayable combined run of exactly its "
        f"displayable measures ({', '.join(ids)}); generate and stage it "
        "first"
    )


def package_selection(parsed: argparse.Namespace):
    """``(reforms, combined_sets)`` for ``--only`` with ``--combined`` or
    ``--published-package``, or None when neither is given. Raises
    ValueError for unknown ids or a manifest without the package."""
    published = getattr(parsed, "published_package", False)
    if not published and not parsed.combined:
        return None
    if published and (parsed.combined or parsed.reforms):
        raise ValueError(
            "--published-package takes its measures from the manifest; "
            "leave out --reforms and --combined"
        )

    def known(ids):
        unknown = [i for i in ids if get_reform(i) is None]
        if unknown:
            raise ValueError(f"unknown reform ids: {', '.join(unknown)}")
        return [get_reform(i) for i in dict.fromkeys(ids)]

    if published:
        from uk_budget_data.publication import manifest as publication_manifest

        path = parsed.manifest or publication_manifest.manifest_path()
        if not Path(path).is_file():
            raise ValueError(f"no publication manifest at {path}")
        manifest = publication_manifest.parse_manifest(
            Path(path).read_bytes(), str(path)
        )
        ids, members = published_package(manifest)
        return known(ids), ([known(members)] if members else [])
    sets = [known(ids) for ids in parsed.combined]
    for members in sets:
        if len(members) < 2:
            raise ValueError("a combined run needs two or more measures")
    return (known(parsed.reforms) if parsed.reforms else None), sets


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

    if getattr(parsed, "national", False):
        return run_national_command(parsed, config)
    for flag in ("combined_key", "no_flat_files", "dry_run"):
        if getattr(parsed, flag, None):
            console.print(
                f"[red]Error: --{flag.replace('_', '-')} goes with "
                "--national[/red]"
            )
            return 1

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

    published = getattr(parsed, "published_package", False)
    if published and parsed.only not in PACKAGE_FLAT_FILES:
        console.print(
            "[red]Error: --published-package goes with --only "
            "income_distribution or --only income_growth[/red]"
        )
        return 1
    if parsed.only is not None:
        package_file = parsed.only in PACKAGE_FLAT_FILES
        if (
            parsed.artifacts
            or parsed.legacy_geography
            or (parsed.combined and not package_file)
        ):
            console.print(
                "[red]Error: --only writes one flat CSV; it does not combine "
                "with --artifacts or --legacy-geography, nor with "
                "--combined except for income_distribution and "
                "income_growth[/red]"
            )
            return 1
        combined_sets = None
        if package_file:
            try:
                selection = package_selection(parsed)
            except ValueError as error:
                console.print(f"[red]Error: {error}[/red]")
                return 1
            if selection is not None:
                reforms, combined_sets = selection
                shown = [r.id for r in reforms or []] or sorted(
                    {m.id for members in combined_sets for m in members}
                )
                console.print(
                    f"Measures: {', '.join(shown)}; combined runs: "
                    f"{len(combined_sets)}"
                )
            else:
                # Refused, not warned: without them the package rows are the
                # registry's autumn_budget_2026_combined, which the page
                # never reads; it reads a package only under the manifest's
                # combined key (#228).
                console.print(
                    f"[red]Error: --only {parsed.only} writes the package's "
                    "rows into a public file: pass --published-package (the "
                    "manifest's package) or --combined ID... (#228)[/red]"
                )
                return 1
        # With --combined alone the measures are the sets' members
        measures = (
            len(reforms)
            if reforms
            else len(
                {m.id for members in combined_sets or [] for m in members}
            )
        )
        units = measures + len(combined_sets or [])
        runner = runner_for(parsed, max(units, 1), len(config.years))
        # On Modal, one container per measure and year: the
        # years run side by side. Locally a measure's years stay in one
        # unit: six builds per measure would be slower, not faster.
        by_year = (
            package_file
            and getattr(parsed, "backend", "local") == "modal"
            and not getattr(parsed, "sequential", False)
        )
        if package_file:
            console.print(
                "Years: one container per measure and year"
                if by_year
                else "Years: each measure's years in one unit"
            )
        if parsed.only == "household_scatter":
            generate_household_scatter(
                reforms=reforms, config=config, runner=runner
            )
        elif parsed.only == "income_distribution":
            generate_income_distribution(
                reforms=reforms,
                config=config,
                runner=runner,
                combined_sets=combined_sets,
                by_year=by_year,
            )
        elif parsed.only == "income_growth":
            generate_income_growth(
                reforms=reforms,
                config=config,
                runner=runner,
                combined_sets=combined_sets,
                by_year=by_year,
            )
        else:
            generate_age_impact(reforms=reforms, config=config, runner=runner)
        return 0

    # Receipted artifacts: one write-once directory per measure, and one
    # per combined set. --combined alone generates only the combined runs.
    if parsed.artifacts or parsed.combined:
        if parsed.backend == "modal":
            problem = modal_artifacts_problem(parsed.dataset)
            if problem:
                console.print(f"[red]Error: {problem}[/red]")
                return 1
            console.print(
                "[yellow]Modal: these receipts carry the container's "
                "execution identity. Make every artifact of this release on "
                "Modal (measures, combined run, area run), or staging needs "
                "--adopt-execution.[/yellow]"
            )
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


def manifest_measures(path=None) -> list[str]:
    """The measures the page shows from the publication manifest
    (provisional or approved), sorted by id: the release's set, as
    ``--published-package`` reads it. Raises ValueError when there is no
    manifest or it shows none."""
    from uk_budget_data.publication import manifest as publication_manifest
    from uk_budget_data.publication.manifest import DISPLAYABLE

    path = Path(path or publication_manifest.manifest_path())
    if not path.is_file():
        raise ValueError(f"no publication manifest at {path}")
    manifest = publication_manifest.parse_manifest(
        path.read_bytes(), str(path)
    )
    ids = sorted(
        key
        for key, entry in manifest.measures.items()
        if entry.status in DISPLAYABLE
    )
    if not ids:
        raise ValueError(f"{path} lists no measure for the page")
    return ids


def run_national_command(parsed: argparse.Namespace, config) -> int:
    """``generate --national``: measures, package and the package files in
    one run (``uk_budget_data.national``)."""
    import sys

    from uk_budget_data import national

    clashes = [
        flag
        for flag, given in (
            ("--only", parsed.only is not None),
            ("--artifacts", parsed.artifacts),
            ("--combined", bool(parsed.combined)),
            ("--published-package", parsed.published_package),
            ("--sequential", parsed.sequential),
            ("--legacy-geography", parsed.legacy_geography),
        )
        if given
    ]
    if clashes:
        console.print(
            "[red]Error: --national makes the artifacts, the package and "
            f"the flat files itself; leave out {', '.join(clashes)}[/red]"
        )
        return 1
    if parsed.reforms:
        ids = list(parsed.reforms)
        source = "--reforms"
    else:
        try:
            ids = manifest_measures(parsed.manifest)
        except ValueError as error:
            console.print(
                f"[red]Error: {error}; pass --reforms with the release's "
                "measures (never every registered measure)[/red]"
            )
            return 1
        source = "the publication manifest's published measures"
    unknown = [i for i in ids if get_reform(i) is None]
    if unknown:
        console.print(f"[red]Error: unknown reform ids: {unknown}[/red]")
        return 1
    reforms = [get_reform(i) for i in dict.fromkeys(ids)]
    console.print(f"Measures from {source}", markup=False)
    key = national.package_key(reforms)
    if parsed.combined_key is not None and parsed.combined_key != key:
        console.print(
            f"[red]Error: --reforms make the package {key}, not "
            f"{parsed.combined_key}[/red]"
        )
        return 1
    backend = getattr(parsed, "backend", "local")
    write_flat = not parsed.no_flat_files
    for line in national.plan_lines(
        reforms, backend, config.output_dir, parsed.artifacts_root, write_flat
    ):
        console.print(line, markup=False, highlight=False, soft_wrap=True)
    if parsed.dry_run:
        console.print("Dry run: nothing was run.")
        return 0
    if backend == "modal":
        problem = modal_artifacts_problem(parsed.dataset)
        if problem:
            console.print(f"[red]Error: {problem}[/red]")
            return 1
    elif parsed.jobs not in ("1", 1):
        console.print(
            "[red]Error: --national --backend local runs one measure after "
            "another; leave out --jobs[/red]"
        )
        return 1

    def say(line):
        console.print(line, markup=False, highlight=False, soft_wrap=True)

    stash: dict = {}
    arguments = dict(
        artifacts_root=parsed.artifacts_root,
        generator_argv=sys.argv,
        write_flat=write_flat,
        on_progress=say,
    )
    if backend == "modal":
        from uk_budget_data.modal_runner import (
            NationalModalRunner,
            national_modal_session,
        )

        with national_modal_session(say=say) as remote:
            runner = NationalModalRunner(stash, remote, say=say)
            result = national.run_national(
                reforms, config, runner, stash, **arguments
            )
    else:
        result = national.run_national(
            reforms,
            config,
            national.LocalNationalRunner(stash),
            stash,
            **arguments,
        )
    return report_national(result, reforms)


def report_national(result, reforms) -> int:
    """The national run's summary, as ``generate --artifacts`` prints its
    own, then what became of the flat files. Exit 1 unless every artifact
    and every flat file was written."""
    from uk_budget_data.publication.commands import _rerun_steps

    report = result.artifacts
    console.print(
        f"{len(report.written)} artifacts written, "
        f"{len(report.refused)} refused"
        + (
            f", {len(report.failed)} failed in their Modal containers"
            if report.failed
            else ""
        )
        + (
            f", {len(report.not_started)} combined runs not started"
            if report.not_started
            else ""
        ),
        markup=False,
    )
    for key, reason in report.refused.items():
        console.print(f"REFUSED {key}: {reason}", markup=False)
    for key, error in report.failed.items():
        console.print(f"FAILED {key}: {error}", markup=False)
    for key in report.not_started:
        console.print(
            f"NOT STARTED {key}: a measure failed in its container first",
            markup=False,
        )
    if report.failed or report.not_started:
        sets = [reforms] if result.package_key else []
        for line in _rerun_steps(report, sets):
            console.print(line, markup=False)
    if result.flat_files:
        for path in result.flat_files:
            console.print(f"flat file written: {path}", markup=False)
    else:
        console.print(
            f"Flat files NOT written: {result.flat_skipped}. Once the "
            "package is staged, make them with `generate --only "
            "income_distribution --published-package` and `--only "
            "income_growth --published-package`.",
            markup=False,
        )
    failed = report.refused or report.failed or report.not_started
    return (
        1
        if failed
        or (not result.flat_files and result.flat_skipped != "--no-flat-files")
        else 0
    )


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
    elif parsed.command == "policy-table":
        from uk_budget_data.policy_table import write

        console.print(f"Wrote {write(parsed.output_dir)}")
        return 0
    elif parsed.command == "publish":
        return run_publish(parsed)
    elif parsed.command == "geography":
        return run_geography(parsed)
    elif parsed.command == "constituencies":
        return run_constituencies(parsed)
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
            "  policy-table - Each measure's parameters, before and after"
        )
        console.print(
            "  publish   - Reconcile, stage, approve and check publications"
        )
        console.print(
            "  geography - Results by region and constituency, disclosure "
            "controlled"
        )
        console.print(
            "  constituencies - geography's seats pass on the published "
            "local-area cut, a fresh process per measure"
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
