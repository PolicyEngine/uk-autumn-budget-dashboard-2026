"""Command-line entry points for publication.

``uk-budget-data generate --artifacts`` writes receipted artifacts, and
``uk-budget-data publish ...`` reconciles, stages, approves, withdraws and
checks manifest entries.
"""

import argparse
import json
import sys
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import ARTIFACTS_ROOT
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
    reconcile_artifact,
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
        "(repeatable; implies --artifacts)",
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
        "reconcile", help="Write reconciliation.json for artifacts"
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
    actions.add_parser("status", help="List manifest entries")


def run_publish(parsed: argparse.Namespace, out=print) -> int:
    """Run a ``publish`` action. Returns the process exit code."""
    data_root, inputs = parsed.data_root, parsed.inputs
    action = parsed.action

    if action == "reconcile":
        code = 0
        for path in parsed.artifacts:
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
                "{reconcile,stage,approve,withdraw,check,status}"
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


def run_generate_artifacts(
    parsed, config, reforms, get_reform, out=print
) -> int:
    """Run ``generate --artifacts``. Returns the process exit code."""
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
    )
    out(
        f"{len(report.written)} artifacts written, "
        f"{len(report.refused)} refused"
    )
    for key, reason in report.refused.items():
        out(f"REFUSED {key}: {reason}")
    return 1 if report.refused else 0
