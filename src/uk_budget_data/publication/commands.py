"""Command-line entry points for publication.

``uk-budget-data generate --artifacts`` writes receipted artifacts, and
``uk-budget-data publish ...`` reconciles, stages, approves, withdraws and
checks manifest entries, and writes the public-file review rows for the
entries the page lists, after deleting the artifacts no current entry
names.
"""

import argparse
import json
import sys
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import ARTIFACTS_ROOT, read_receipt
from uk_budget_data.publication.publish import (
    TREASURY_INPUTS,
    PublishError,
    approve,
    check,
    stage,
    withdraw,
)
from uk_budget_data.publication.reconcile import (
    ReconciliationInputError,
    not_computable,
    reconcile_artifact,
)
from uk_budget_data.publication.review_rows import (
    REVIEW_CSV,
    ReviewRowsError,
    review_rows,
)


def add_generate_arguments(parser: argparse.ArgumentParser) -> None:
    """Options that make ``generate`` write receipted artifacts."""
    parser.add_argument(
        "--artifacts",
        action="store_true",
        help="Write one receipted, write-once artifact per measure instead "
        "of rewriting the shared CSVs",
    )
    parser.add_argument(
        "--artifacts-root",
        type=Path,
        default=ARTIFACTS_ROOT,
        help=f"Artifacts directory (default: {ARTIFACTS_ROOT})",
    )
    parser.add_argument(
        "--combined",
        nargs="+",
        action="append",
        default=None,
        metavar="ID",
        help="Simulate these measures together as one combined run "
        "(repeatable; implies --artifacts, except with --only "
        "income_distribution or income_growth, where it adds the run's "
        "rows to that flat file under its combined key)",
    )


def add_publish_parser(subparsers) -> None:
    publish = subparsers.add_parser(
        "publish", help="Reconcile, stage, approve and check manifest entries"
    )
    publish.add_argument(
        "--data-root",
        type=Path,
        default=m.DATA_ROOT,
        help=f"Published data directory (default: {m.DATA_ROOT})",
    )
    publish.add_argument(
        "--inputs",
        type=Path,
        default=TREASURY_INPUTS,
        help=f"Treasury inputs directory (default: {TREASURY_INPUTS})",
    )
    actions = publish.add_subparsers(dest="action")

    reconcile = actions.add_parser(
        "reconcile",
        help="Write reconciliation.json for artifacts (a not-computable "
        "one has nothing to reconcile, and is skipped)",
    )
    reconcile.add_argument("artifacts", nargs="+", type=Path)

    staging = actions.add_parser("stage", help="Stage artifacts")
    staging.add_argument("artifacts", nargs="+", type=Path)
    staging.add_argument(
        "--provisional",
        action="store_true",
        help="Show on the page as provisional (statement figures only)",
    )
    staging.add_argument(
        "--adopt-execution",
        action="store_true",
        help="Adopt this artifact's execution identity; every other entry "
        "becomes stale",
    )
    staging.add_argument(
        "--adopt-basis",
        action="store_true",
        help="Adopt this artifact's forecast and calibration basis; every "
        "other entry becomes stale",
    )

    approving = actions.add_parser("approve", help="Approve an entry")
    approving.add_argument("key")
    approving.add_argument("--by", required=True, help="Who is approving")
    approving.add_argument("--household-receipt", type=Path, default=None)

    withdrawing = actions.add_parser("withdraw", help="Withdraw an entry")
    withdrawing.add_argument("key")
    withdrawing.add_argument("--reason", required=True)

    actions.add_parser("check", help="Re-run every gate (used by CI)")
    indexing = actions.add_parser(
        "index", help="Bind every flat CSV to this approved manifest snapshot"
    )
    indexing.add_argument(
        "--without-area",
        action="store_true",
        help="Instead, take the results by area off the page: delete the "
        "index, the area tables and their provenance, and save the manifest "
        "without a flat binding (G5)",
    )
    actions.add_parser("status", help="List manifest entries")
    compare = actions.add_parser(
        "definitions",
        help="Compare this code's definition of each displayed measure "
        "with its approved receipt, as the household API reports it",
    )
    compare.add_argument(
        "--api",
        metavar="URL",
        help="Compare the definitions the household API at URL serves "
        "instead (a deployed revision, by its service or tag URL)",
    )
    compare.add_argument(
        "--timeout",
        type=float,
        default=300.0,
        help="Seconds to wait for the API's answer (one household "
        "calculation; default 300)",
    )

    rows = actions.add_parser(
        "review-rows",
        help="Write the public-file review rows for the listed entries' "
        "files and the manifest, after deleting the artifacts no manifest "
        "entry names",
    )
    rows.add_argument(
        "--reviewer", required=True, help="Who reviewed these bytes"
    )
    rows.add_argument(
        "--staged-by",
        default=None,
        help="Who staged the provisional and not-computable entries (the "
        "manifest does not record it); needed when any is listed",
    )
    rows.add_argument(
        "--on",
        default=None,
        metavar="YYYY-MM-DD",
        help="The review date (default: today, UTC)",
    )
    # Also accepted after the action, as the runbook writes it.
    rows.add_argument(
        "--data-root",
        type=Path,
        default=argparse.SUPPRESS,
        help=f"Published data directory (default: {m.DATA_ROOT})",
    )
    rows.add_argument(
        "--review-csv",
        type=Path,
        default=REVIEW_CSV,
        help=f"The review list (default: {REVIEW_CSV})",
    )


def _receipt_or_empty(path: Path) -> dict:
    """An artifact's receipt, or {} when it cannot be read (reconciling it
    then reports why)."""
    try:
        return read_receipt(path)
    except (ValueError, OSError):
        return {}


def run_publish(parsed: argparse.Namespace, out=print) -> int:
    """Run a ``publish`` action. Returns the process exit code."""
    data_root, inputs = parsed.data_root, parsed.inputs
    action = parsed.action

    if action == "reconcile":
        code = 0
        for path in parsed.artifacts:
            # A not-computable artifact holds its receipt alone: there is
            # nothing to reconcile, and no file may be added beside it.
            receipt = _receipt_or_empty(path)
            if not_computable(receipt):
                key = receipt["dashboard"].get("key", path)
                out(
                    f"{key}: not computable on current data; nothing to "
                    "reconcile"
                )
                continue
            try:
                result = reconcile_artifact(path, inputs)
            except ReconciliationInputError as error:
                out(f"{path}: error: {error}")
                code = 2
                continue
            (path / "reconciliation.json").write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n"
            )
            out(
                f"{result['measure_id']}: reconciliation "
                f"{result['summary']['status']}, responsiveness "
                f"{result['responsiveness']['status']}"
            )
        return code

    if action == "check":
        if not m.manifest_path(data_root).exists():
            out("no manifest yet; legacy flat CSVs are unreceipted")
            return 0
        failures = check(
            m.load_manifest(data_root), data_root=data_root, inputs=inputs
        )
        for failure in failures:
            out(f"FAIL {failure}")
        if not failures:
            out("publication manifest passes every gate")
        return 1 if failures else 0

    if action == "review-rows":
        return run_review_rows(parsed, out)

    if action == "definitions":
        from uk_budget_data.definitions import api_reporter, run_check

        if parsed.api:
            return run_check(
                data_root,
                out,
                api_reporter(parsed.api, parsed.timeout),
                where=f"the API at {parsed.api}",
            )
        return run_check(data_root, out)

    if action == "index":
        from uk_budget_data.publication.release_index import (
            unbind_area_results,
            write_release_index,
        )

        try:
            if getattr(parsed, "without_area", False):
                manifest = unbind_area_results(
                    m.load_manifest(data_root), data_root=data_root
                )
                out(
                    "results by area taken off the page at manifest revision "
                    f"{manifest.revision}; run publish check, then the "
                    "review rows"
                )
                return 0
            manifest = write_release_index(
                m.load_manifest(data_root), data_root=data_root, inputs=inputs
            )
        except (PublishError, OSError, ValueError) as error:
            out(f"REFUSED release index: {error}")
            return 1
        out(
            f"release index bound to manifest revision {manifest.revision}; review these new bytes"
        )
        return 0

    manifest = m.load_manifest(data_root)
    if action == "status":
        out(f"revision {manifest.revision}")
        for key, entry in sorted(manifest.entries().items()):
            approved_by = f" by {entry.approval.by}" if entry.approval else ""
            reason = f" ({entry.reason})" if entry.reason else ""
            out(f"{key}: {entry.status}{approved_by}{reason}")
        return 0

    try:
        if action == "stage":
            for path in parsed.artifacts:
                key = stage(
                    manifest,
                    path,
                    data_root=data_root,
                    inputs=inputs,
                    provisional=parsed.provisional,
                    adopt_execution=parsed.adopt_execution,
                    adopt_basis=parsed.adopt_basis,
                )
                out(f"staged {key}: {manifest.entries()[key].status}")
        elif action == "approve":
            receipt = (
                json.loads(parsed.household_receipt.read_text())
                if parsed.household_receipt
                else None
            )
            approve(
                manifest,
                parsed.key,
                parsed.by,
                data_root=data_root,
                inputs=inputs,
                household_receipt=receipt,
            )
            out(f"approved {parsed.key} by {parsed.by}")
        elif action == "withdraw":
            withdraw(manifest, parsed.key, parsed.reason)
            out(f"withdrew {parsed.key}")
        else:
            out(
                "usage: uk-budget-data publish "
                "{reconcile,stage,approve,withdraw,check,index,status,"
                "definitions,review-rows}"
            )
            return 2
    except PublishError as error:
        out(f"REFUSED {error.subject}:")
        for problem in error.problems:
            out(f"  - {problem}")
        return 1
    m.save_manifest(manifest, data_root)
    out(f"manifest revision {manifest.revision}")
    return 0


def run_review_rows(parsed: argparse.Namespace, out=print) -> int:
    """Run ``publish review-rows``. Prints paths and counts, never values."""
    try:
        report = review_rows(
            reviewer=parsed.reviewer,
            staged_by=parsed.staged_by,
            on=parsed.on,
            data_root=parsed.data_root,
            review_csv=parsed.review_csv,
        )
    except ReviewRowsError as error:
        out("REFUSED review rows (nothing written or deleted):")
        for problem in error.problems:
            out(f"  - {problem}")
        return 1
    for label, paths in (
        ("deleted", report.deleted),
        ("added", report.added),
        ("replaced", report.replaced),
        ("removed", report.removed),
    ):
        for path in paths:
            out(f"{label} {path}")
    out(
        f"{len(report.deleted)} paths deleted under the data root's "
        "artifacts/ that no manifest entry names"
    )
    out(
        f"review rows for manifest revision {report.revision}: "
        f"{len(report.added)} added, {len(report.replaced)} replaced "
        f"({report.unchanged} unchanged), {len(report.removed)} removed; "
        f"took {report.elapsed:.2f} s after start-up"
    )
    if report.unreviewed:
        out(
            f"{len(report.unreviewed)} files under the data root have no "
            "review row, so the build check fails on them:"
        )
        for path, why in report.unreviewed:
            out(f"  - {path} ({why})")
    return 0


def run_generate_artifacts(
    parsed, config, reforms, get_reform, out=print, runner=None
) -> int:
    """Run ``generate --artifacts``. Returns the process exit code.

    ``runner`` runs the artifacts (see ``generate_artifacts``); one after
    another by default."""
    from uk_budget_data.publication.generate import generate_artifacts

    combined_sets = []
    for ids in parsed.combined or []:
        members = [get_reform(reform_id) for reform_id in ids]
        unknown = [i for i, member in zip(ids, members) if member is None]
        if unknown:
            out(f"error: unknown measures in --combined: {unknown}")
            return 1
        combined_sets.append(members)
    report = generate_artifacts(
        reforms,
        config,
        combined_sets=combined_sets,
        artifacts_root=parsed.artifacts_root,
        generator_argv=sys.argv,
        on_progress=out,
        runner=runner,
    )
    out(
        f"{len(report.written)} artifacts written, "
        f"{len(report.refused)} refused"
    )
    for key, reason in report.refused.items():
        out(f"REFUSED {key}: {reason}")
    return 1 if report.refused else 0
