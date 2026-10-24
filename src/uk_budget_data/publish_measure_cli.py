"""Command-line commands for publishing one measure at a time (#105).

- ``publish-measure <id>``: run one measure's tables and upsert its rows
  (or, with ``--rows-dir``, write them to a fragment for ``apply-rows``);
- ``apply-rows DIR...``: upsert fragments, mark review rows pending and
  write the summary (the workflow's collect job);
- ``refresh-combined``: the live measures as one simulation, upserted as
  the combined run;
- ``changed-measures``: the measure ids a registry change added or changed;
- ``sign-pending --reviewer NAME``: the Reconciler signs, by hand.

See ``publish_measure`` for the design, and docs/budget-day-runbook.md
("Budget day: publish one measure") for the steps.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from rich.console import Console

from uk_budget_data import publish_measure as pm
from uk_budget_data.budget_years import POLICY_YEARS

console = Console(stderr=True)

PUBLISH_MEASURE_COMMANDS = {
    "publish-measure",
    "apply-rows",
    "refresh-combined",
    "changed-measures",
    "sign-pending",
}


def _common(parser: argparse.ArgumentParser, compute: bool = True) -> None:
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./public/data"),
        help="The public data directory (default: ./public/data)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help=(
            "Repository root, holding data_inputs/public_data_review.csv "
            "(default: .)"
        ),
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=None,
        help="Also write the markdown summary to this file",
    )
    parser.add_argument(
        "--reconciler",
        default=pm.RECONCILER,
        help=(
            "Who decides the pending review rows (default: "
            f"{pm.RECONCILER})"
        ),
    )
    parser.add_argument(
        "--on",
        default=None,
        help="Date for the pending rows, YYYY-MM-DD (default: today, UTC)",
    )
    if compute:
        parser.add_argument(
            "--years",
            nargs="+",
            type=int,
            default=list(POLICY_YEARS),
            help=(
                "Years to run (default: the policy years, "
                f"{POLICY_YEARS[0]} to {POLICY_YEARS[-1]}); rows for other "
                "years are kept"
            ),
        )
        parser.add_argument(
            "--dataset",
            type=Path,
            default=None,
            help="Dataset path (default: the bundle's certified dataset)",
        )
        parser.add_argument(
            "--rows-dir",
            type=Path,
            default=None,
            help=(
                "Write the rows to a fragment here instead of the public "
                "files; apply-rows applies it"
            ),
        )


def add_publish_measure_parsers(subparsers) -> None:
    one = subparsers.add_parser(
        "publish-measure",
        help=(
            "Budget day: run one measure's tables and upsert its rows, "
            "review pending (#105)"
        ),
    )
    one.add_argument("measure", help="The measure id, as in reforms.py")
    one.add_argument(
        "--geography",
        action="store_true",
        help=f"Results by area: refused until {pm.GEOGRAPHY_GATE} merges",
    )
    _common(one)

    apply = subparsers.add_parser(
        "apply-rows",
        help="Upsert publish-measure fragments; review rows pending",
    )
    apply.add_argument(
        "fragments",
        nargs="+",
        type=Path,
        help="Fragment directories, or directories holding them",
    )
    _common(apply, compute=False)

    combined = subparsers.add_parser(
        "refresh-combined",
        help="Budget day: run the live measures together; upsert the rows",
    )
    combined.add_argument(
        "--measures",
        nargs="+",
        default=None,
        help=(
            "Members (default: the live measures, those in "
            "budgetary_impact.csv)"
        ),
    )
    _common(combined)

    changed = subparsers.add_parser(
        "changed-measures",
        help="Measure ids a registry change added or changed, as JSON",
    )
    changed.add_argument("--base", default="HEAD^")
    changed.add_argument("--head", default="HEAD")
    changed.add_argument("--repo", type=Path, default=Path("."))

    sign = subparsers.add_parser(
        "sign-pending",
        help="The Reconciler signs the rows publish-measure marked pending",
    )
    sign.add_argument("--reviewer", required=True)
    sign.add_argument("--root", type=Path, default=Path("."))
    sign.add_argument("--on", default=None)


def _config(parsed):
    from uk_budget_data.models import DataConfig

    return DataConfig(
        output_dir=parsed.output_dir,
        dataset_path=parsed.dataset,
        years=parsed.years,
    )


def _finish(parsed, fragments: list[pm.Fragment]) -> int:
    report = pm.apply_fragments(
        fragments,
        parsed.output_dir,
        root=parsed.root,
        reconciler=parsed.reconciler,
        on=parsed.on,
    )
    print(report.summary)
    if parsed.summary is not None:
        parsed.summary.write_text(report.summary)
    return 0


def _emit(parsed, fragment: pm.Fragment, started: float) -> int:
    console.print(
        f"[green]✓[/green] {fragment.reform_id}: rows computed in "
        f"{time.monotonic() - started:.0f}s"
    )
    if parsed.rows_dir is not None:
        target = pm.write_fragment(parsed.rows_dir, fragment)
        console.print(f"Fragment written to {target}")
        return 0
    return _finish(parsed, [fragment])


def run_publish_measure_command(parsed) -> int:
    try:
        return _run(parsed)
    except pm.PublishMeasureError as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1


def _run(parsed) -> int:
    from uk_budget_data.reforms import get_reform

    if parsed.command == "changed-measures":
        from uk_budget_data.registry_diff import changed_between

        print(
            json.dumps(changed_between(parsed.base, parsed.head, parsed.repo))
        )
        return 0

    if parsed.command == "sign-pending":
        signed = pm.sign_pending(parsed.root, parsed.reviewer, parsed.on)
        for path in signed:
            print(f"signed {path}")
        console.print(f"{len(signed)} row(s) signed by {parsed.reviewer}.")
        return 0

    if parsed.command == "apply-rows":
        directories = pm.fragment_dirs(parsed.fragments)
        if not directories:
            raise pm.PublishMeasureError("no fragment found")
        return _finish(parsed, [pm.read_fragment(d) for d in directories])

    started = time.monotonic()
    config = _config(parsed)
    if parsed.command == "publish-measure":
        if parsed.geography:
            pm.publish_geography(None, config)
        reform = get_reform(parsed.measure)
        if reform is None:
            raise pm.PublishMeasureError(
                f"unknown measure id: {parsed.measure}"
            )
        if pm.is_combined(reform.id):
            raise pm.PublishMeasureError(
                "the combined run is refreshed by refresh-combined"
            )
        return _emit(parsed, pm.compute_fragment(reform, config), started)

    # refresh-combined
    members = sorted(parsed.measures or pm.live_measure_ids(parsed.output_dir))
    if not members:
        raise pm.PublishMeasureError("no live measure to combine")
    console.print(f"Combining {len(members)} measures: {', '.join(members)}")
    reform = pm.combined_reform(members, config)
    return _emit(
        parsed, pm.compute_fragment(reform, config, members=members), started
    )


if __name__ == "__main__":
    from uk_budget_data.cli import main

    sys.exit(main())
