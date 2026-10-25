"""Command-line commands for publishing one measure at a time (#105, on #104).

- ``publish-measure <id>``: generate one measure's receipted artifact (and,
  without ``--no-stage``, reconcile and stage it, marking its review rows
  pending);
- ``stage-artifacts DIR...``: reconcile and stage artifacts generated
  elsewhere, mark their review rows pending and write the summary (the
  workflow's collect job);
- ``refresh-combined``: the approved measures as one combined run, staged;
- ``changed-measures``: the measure ids a push added or changed (any file
  a measure's definition reaches, or code every measure runs through);
- ``sign-measures --by NAME --reviewer HANDLE``: the Reconciler approves the
  staged entries and writes the review rows, by hand;
- ``measure-status``: the manifest's live measures and whether the package
  is current, as JSON.

See ``publish_measure`` for the design, and docs/budget-day-runbook.md
("Budget day: publish one measure") for the steps.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from rich.console import Console

from uk_budget_data import publish_measure as pm
from uk_budget_data.budget_years import POLICY_YEARS

console = Console(stderr=True)

PUBLISH_MEASURE_COMMANDS = {
    "publish-measure",
    "stage-artifacts",
    "refresh-combined",
    "changed-measures",
    "sign-measures",
    "measure-status",
}


def _staging(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="Repository root (default: .)",
    )
    parser.add_argument(
        "--provisional",
        action="store_true",
        help="Stage as provisional (G2's statement figures)",
    )
    parser.add_argument(
        "--private-dir",
        type=Path,
        default=None,
        help=(
            "Where reconciliation.json goes, outside the checkout (default: "
            "$RUNNER_TEMP/reconciliation, else not written)"
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
        help=f"Who decides the pending review rows (default: {pm.RECONCILER})",
    )
    parser.add_argument(
        "--on",
        default=None,
        help="Date for the pending rows, YYYY-MM-DD (default: today, UTC)",
    )


def _compute(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=list(POLICY_YEARS),
        help=(
            "Years to run (default: the policy years, "
            f"{POLICY_YEARS[0]} to {POLICY_YEARS[-1]}; leave it out on the "
            "day, as the runbook says)"
        ),
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Dataset path (default: the bundle's certified dataset)",
    )
    parser.add_argument(
        "--artifacts-root",
        type=Path,
        default=None,
        help="Artifacts directory (default: public/data/artifacts)",
    )
    parser.add_argument(
        "--no-stage",
        action="store_true",
        help="Only generate the artifact (the workflow's matrix jobs)",
    )


def add_publish_measure_parsers(subparsers) -> None:
    one = subparsers.add_parser(
        "publish-measure",
        help="Budget day: one measure's receipted artifact, staged (#105)",
    )
    one.add_argument("measure", help="The measure id, as in reforms.py")
    _compute(one)
    _staging(one)

    collect = subparsers.add_parser(
        "stage-artifacts",
        help="Reconcile and stage artifacts; review rows pending",
    )
    collect.add_argument(
        "artifacts",
        nargs="+",
        type=Path,
        help="Artifact directories, or directories holding them",
    )
    _staging(collect)

    combined = subparsers.add_parser(
        "refresh-combined",
        help="Budget day: the approved measures as one combined run, staged",
    )
    combined.add_argument(
        "--measures",
        nargs="+",
        default=None,
        help="Members (default: the approved measures in the manifest)",
    )
    _compute(combined)
    _staging(combined)

    changed = subparsers.add_parser(
        "changed-measures",
        help="Measure ids a push added or changed, as JSON",
    )
    changed.add_argument("--base", default="HEAD^")
    changed.add_argument("--head", default="HEAD")
    changed.add_argument("--repo", type=Path, default=Path("."))

    sign = subparsers.add_parser(
        "sign-measures",
        help=(
            "The Reconciler approves the staged entries and writes the "
            "review rows"
        ),
    )
    sign.add_argument("keys", nargs="*", help="Entries (default: all staged)")
    sign.add_argument("--by", required=True, help="Who is approving")
    sign.add_argument(
        "--reviewer", required=True, help="Who reviewed these bytes"
    )
    sign.add_argument(
        "--household-receipt",
        action="append",
        default=[],
        metavar="KEY=PATH",
        help="A measure's household receipt (repeatable)",
    )
    sign.add_argument("--staged-by", default=None)
    sign.add_argument("--root", type=Path, default=Path("."))
    sign.add_argument("--on", default=None)

    status = subparsers.add_parser(
        "measure-status",
        help="Live measures and whether the package is current, as JSON",
    )
    status.add_argument("--data-root", type=Path, default=Path("public/data"))


def _config(parsed):
    from uk_budget_data.models import DataConfig

    return DataConfig(dataset_path=parsed.dataset, years=parsed.years)


def _private_dir(parsed):
    if parsed.private_dir is not None:
        return parsed.private_dir
    runner_temp = os.environ.get("RUNNER_TEMP")
    return Path(runner_temp) / "reconciliation" if runner_temp else None


def _stage(parsed, paths) -> int:
    started = time.monotonic()
    result = pm.collect(
        paths,
        root=parsed.root,
        provisional=parsed.provisional,
        private_dir=_private_dir(parsed),
        reconciler=parsed.reconciler,
        on=parsed.on,
    )
    print(result.summary)
    if parsed.summary is not None:
        parsed.summary.write_text(result.summary)
    for step, seconds in result.seconds.items():
        console.print(f"{step}: {seconds:.1f} s")
    console.print(f"staged in {time.monotonic() - started:.1f} s")
    return 1 if (result.refused or result.failures) else 0


def _artifacts_root(parsed) -> Path:
    from uk_budget_data.publication.artifacts import ARTIFACTS_ROOT

    return parsed.artifacts_root or parsed.root / ARTIFACTS_ROOT


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

    if parsed.command == "measure-status":
        status = pm.combined_status(parsed.data_root)
        status["live"] = pm.live_measure_ids(parsed.data_root)
        print(json.dumps(status))
        return 0

    if parsed.command == "sign-measures":
        receipts = {}
        for item in parsed.household_receipt:
            key, _, path = item.partition("=")
            receipts[key] = json.loads(Path(path).read_text())
        approved, report = pm.sign_measures(
            by=parsed.by,
            reviewer=parsed.reviewer,
            keys=parsed.keys or None,
            root=parsed.root,
            household_receipts=receipts,
            staged_by=parsed.staged_by,
            on=parsed.on,
        )
        for key in approved:
            print(f"approved {key} by {parsed.by}")
        print(
            f"review rows: {len(report.added)} added, "
            f"{len(report.replaced)} replaced, {len(report.removed)} removed"
        )
        for path, why in report.unreviewed:
            print(f"  no row: {path} ({why})")
        return 0

    if parsed.command == "stage-artifacts":
        return _stage(parsed, parsed.artifacts)

    started = time.monotonic()
    config = _config(parsed)
    if parsed.command == "publish-measure":
        reform = get_reform(parsed.measure)
        if reform is None:
            raise pm.PublishMeasureError(
                f"unknown measure id: {parsed.measure}"
            )
        reference = pm.compute_measure(reform, config, _artifacts_root(parsed))
    else:  # refresh-combined
        members = sorted(
            parsed.measures
            or pm.live_measure_ids(parsed.root / "public" / "data")
        )
        if not members:
            raise pm.PublishMeasureError("no approved measure to combine")
        console.print(
            f"Combining {len(members)} measures: {', '.join(members)}"
        )
        reference = pm.compute_combined(
            members, config, _artifacts_root(parsed)
        )
    console.print(
        f"[green]✓[/green] {reference.key}: artifact written in "
        f"{time.monotonic() - started:.0f} s"
    )
    print(reference.path)
    if parsed.no_stage:
        return 0
    return _stage(parsed, [reference.path])


if __name__ == "__main__":
    from uk_budget_data.cli import main

    sys.exit(main())
