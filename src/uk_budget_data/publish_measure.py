"""Publish one measure at a time, through receipted artifacts (#105, on #104).

On Budget day each measure is coded, checked and published on its own, so
a measure ready at 13:30 does not wait for the slowest one, and a late fix
reruns one measure, not every one. Since #104 the page reads only
receipt-verified artifacts named by an approved manifest entry, so this
follows the runbook's G2 to G4 order rather than writing flat CSV rows:

1. **Run.** ``generate --artifacts --reforms <id>``, one measure per
   process (``compute_measure``). A hand-written modifier is always
   generated alone, as the runbook requires, because each workflow job runs
   one measure.
2. **Reconcile and stage** (``collect``). Each artifact is reconciled
   (status only; ``reconciliation.json`` is written outside the checkout and
   never committed) and staged: plainly, or with ``--provisional`` for G2's
   statement figures. The new files' review rows are marked **pending**,
   naming the Reconciler, with an expiry date at most ``PENDING_DAYS`` days
   away, so the data pull request passes the public-file check while
   nothing is signed. Once results by area are bound, the release index is
   rebuilt if it can be, and ``publish check`` runs last.
3. **Approve** (``sign_measures``, by hand). The Reconciler approves each
   staged entry (``publish approve``) and writes the review rows
   (``publish review-rows``), which replace the pending ones. Nothing here
   approves or signs automatically.

**What "live" means.** An entry is live when it is approved in the
deployed ``public/data/manifest.json``. A staged entry is the measure
"being costed"; there is no second status store. ``live_measure_ids`` and
``displayable_measure_ids`` read the manifest.

**The combined run.** ``refresh-combined`` is ``generate --combined`` over
the approved measures, then stage; approval needs every member approved
(``sign_measures`` again). ``combined_status`` says whether the manifest
has a displayable combined run whose members are exactly the displayable
measures, which is the only package the page shows (#104).

**Results by area** are not run here: they are G4's area run
(``uk-budget-data geography``), then ``publish index`` and ``publish
check``.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

RECONCILER = "juaristi22"
PENDING_DAYS = 7
REVIEW_CSV = Path("data_inputs/public_data_review.csv")
PENDING_BASIS = (
    "Pending review: staged by publish-measure for {ids}. The Reconciler "
    "approves (publish approve) and writes the review rows (publish "
    "review-rows) before merge."
)


class PublishMeasureError(RuntimeError):
    """A measure cannot be published as asked."""


def registry_order() -> list[str]:
    """Every registered measure id, in the registry's order."""
    from uk_budget_data.reforms import get_autumn_budget_2026_reforms

    return [reform.id for reform in get_autumn_budget_2026_reforms()]


def is_combined(key: str) -> bool:
    from uk_budget_data.publication.artifacts import COMBINED_PREFIX

    return key.startswith(COMBINED_PREFIX)


# ---------------------------------------------------------------------------
# Status, from the manifest
# ---------------------------------------------------------------------------


def _manifest(data_root: Path):
    from uk_budget_data.publication import manifest as m

    if not m.manifest_path(data_root).exists():
        return None
    return m.load_manifest(data_root)


def _ids_with(data_root: Path, statuses: tuple[str, ...]) -> list[str]:
    manifest = _manifest(Path(data_root))
    if manifest is None:
        return []
    return sorted(
        key
        for key, entry in manifest.measures.items()
        if entry.status in statuses
    )


def live_measure_ids(data_root: Path) -> list[str]:
    """The approved single measures, by id."""
    from uk_budget_data.publication import manifest as m

    return _ids_with(data_root, (m.APPROVED,))


def displayable_measure_ids(data_root: Path) -> list[str]:
    """The single measures the page shows: approved and provisional."""
    from uk_budget_data.publication import manifest as m

    return _ids_with(data_root, m.DISPLAYABLE)


def combined_status(data_root: Path) -> dict:
    """Whether the package the page shows is current.

    ``current`` is the key of a displayable combined entry whose members
    are exactly the displayable measures, else None: then the page shows
    the package's figures as unavailable until ``refresh-combined`` runs
    and its entry is approved.
    """
    from uk_budget_data.publication import manifest as m

    members = displayable_measure_ids(data_root)
    manifest = _manifest(Path(data_root))
    current = None
    if manifest is not None and members:
        for key, entry in sorted(manifest.combined.items()):
            if entry.status in m.DISPLAYABLE and sorted(
                entry.measures or []
            ) == list(members):
                current = key
                break
    return {"members": members, "current": current}


# ---------------------------------------------------------------------------
# Running (one measure per process)
# ---------------------------------------------------------------------------


def _generate(reforms, config, combined_sets, artifacts_root, generate):
    if generate is None:
        from uk_budget_data.publication.generate import generate_artifacts

        generate = generate_artifacts
    report = generate(
        reforms,
        config,
        combined_sets=combined_sets,
        artifacts_root=Path(artifacts_root),
        generator_argv=["uk-budget-data", "publish-measure"],
    )
    if report.refused:
        raise PublishMeasureError(
            "; ".join(f"{k}: {why}" for k, why in report.refused.items())
        )
    if len(report.written) != 1:
        raise PublishMeasureError(
            f"expected one artifact, got {len(report.written)}"
        )
    return report.written[0]


def compute_measure(reform, config, artifacts_root, generate=None):
    """Generate one measure's receipted artifact. Returns its ArtifactRef."""
    if is_combined(reform.id):
        raise PublishMeasureError(
            "the combined run is refreshed by refresh-combined"
        )
    return _generate([reform], config, [], artifacts_root, generate)


def compute_combined(members, config, artifacts_root, generate=None):
    """Generate the combined run of these measures. Returns its ArtifactRef.

    Each member is bound at the commit its own approved receipt was made at
    (#104), so the manifest must list every member.
    """
    if not members:
        raise PublishMeasureError("no approved measure to combine")
    return _generate([], config, [list(members)], artifacts_root, generate)


# ---------------------------------------------------------------------------
# Collecting: reconcile, stage, pending review rows, check
# ---------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mark_pending(
    root: Path,
    public_paths: Iterable[str],
    keys: list[str],
    *,
    reconciler: str = RECONCILER,
    on: Optional[str] = None,
    days: int = PENDING_DAYS,
) -> list[str]:
    """Mark each new or changed file's review row pending; returns those paths.

    A file whose bytes still match its row is left alone, signed or not,
    so a rerun that changes nothing changes no row. Nothing is signed.
    """
    from uk_budget_data.publication import review_rows as rr

    root = Path(root)
    on = on or datetime.now(timezone.utc).date().isoformat()
    expires = (date.fromisoformat(on) + timedelta(days=days)).isoformat()
    review_path = root / REVIEW_CSV
    header, records = rr.read_review(review_path)
    signed = {r.path: r.raw for r in records if r.path is not None}
    basis = PENDING_BASIS.format(ids=", ".join(sorted(keys)))
    rows = []
    for public_path in sorted(set(public_paths)):
        sha = _sha256(root / public_path)
        raw = signed.get(public_path)
        if raw is not None and sha in raw:
            continue
        rows.append(
            rr.Row(
                path=public_path,
                kind="pending",
                sha256=sha,
                basis=basis,
                expires_on=expires,
            )
        )
    if rows:
        text = rr.merge(
            header,
            records,
            rows,
            reviewer=reconciler,
            reviewed_on=on,
            removable=lambda path: False,
            report=rr.Report(revision=0),
        )
        rr._write_text(review_path, text)
    return [row.path for row in rows]


@dataclass
class Collected:
    """What ``collect`` did, one line per artifact, and the gate result."""

    staged: dict[str, str] = field(default_factory=dict)
    reconciliation: dict[str, str] = field(default_factory=dict)
    refused: dict[str, list[str]] = field(default_factory=dict)
    revenue: dict[str, dict[int, float]] = field(default_factory=dict)
    pending: list[str] = field(default_factory=list)
    index: str = ""
    failures: list[str] = field(default_factory=list)
    seconds: dict[str, float] = field(default_factory=dict)
    summary: str = ""


def artifact_dirs(paths: Iterable[Path]) -> list[Path]:
    """Artifact directories (those holding receipt.json) under these paths."""
    found = []
    for path in paths:
        path = Path(path)
        if (path / "receipt.json").is_file():
            found.append(path)
        elif path.is_dir():
            found.extend(p.parent for p in sorted(path.rglob("receipt.json")))
    return sorted(set(found))


def _revenue(path: Path) -> dict[int, float]:
    from uk_budget_data.publication.artifacts import read_tables

    try:
        rows = read_tables(path).get("budgetary_impact", [])
    except Exception:  # a not-computable artifact holds no tables
        return {}
    return {int(row["year"]): float(row["value"]) for row in rows}


def collect(
    paths: Iterable[Path],
    *,
    root: Path = Path("."),
    data_root: Optional[Path] = None,
    inputs: Optional[Path] = None,
    provisional: bool = False,
    private_dir: Optional[Path] = None,
    reconciler: str = RECONCILER,
    on: Optional[str] = None,
    clock: Callable[[], float] = time.monotonic,
) -> Collected:
    """Reconcile and stage artifacts, mark their review rows pending, check.

    Artifacts must already sit under the data root's ``artifacts/``. Each is
    staged on its own; one that a gate refuses is reported and leaves the
    manifest as it was. ``reconciliation.json`` goes to ``private_dir``
    (outside the checkout), never beside the artifact.
    """
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import (
        TREASURY_INPUTS,
        PublishError,
        check,
        stage,
    )
    from uk_budget_data.publication.reconcile import (
        ReconciliationInputError,
        not_computable,
        reconcile_artifact,
    )

    root = Path(root)
    data_root = Path(data_root or root / m.DATA_ROOT)
    inputs = Path(inputs or root / TREASURY_INPUTS)
    result = Collected()
    directories = artifact_dirs(paths)
    if not directories:
        raise PublishMeasureError("no artifact found")

    manifest = m.load_manifest(data_root)
    started = clock()
    for path in directories:
        document = read_receipt(path)
        key = document["dashboard"]["key"]
        if not_computable(document):
            result.reconciliation[key] = "not computable"
        else:
            try:
                reconciled = reconcile_artifact(path, inputs)
                result.reconciliation[key] = reconciled["summary"]["status"]
                if private_dir is not None:
                    target = Path(private_dir) / key
                    target.mkdir(parents=True, exist_ok=True)
                    (target / "reconciliation.json").write_text(
                        json.dumps(reconciled, indent=2, sort_keys=True) + "\n"
                    )
            except ReconciliationInputError as error:
                result.reconciliation[key] = f"no Treasury figures ({error})"
        try:
            stage(
                manifest,
                path,
                data_root=data_root,
                inputs=inputs,
                provisional=provisional,
            )
            result.staged[key] = manifest.entries()[key].status
            result.revenue[key] = _revenue(path)
        except PublishError as error:
            result.refused[key] = list(error.problems)
    result.seconds["reconcile and stage"] = clock() - started

    if not result.staged:
        result.summary = summarise(result)
        return result
    m.save_manifest(manifest, data_root)

    # Staging unbinds results by area; rebuild the index when it was bound.
    if manifest.flat_files:
        from uk_budget_data.publication.release_index import (
            write_release_index,
        )

        try:
            manifest = write_release_index(
                manifest, data_root=data_root, inputs=inputs
            )
            result.index = "rebuilt"
        except (PublishError, OSError, ValueError) as error:
            result.index = (
                f"refused ({error}); rerun the area run or take the area "
                "views down (publish index --without-area)"
            )

    started = clock()
    result.failures = check(manifest, data_root=data_root, inputs=inputs)
    result.seconds["publish check"] = clock() - started

    changed = [
        str(p.relative_to(root))
        for d in directories
        if document_key(d) in result.staged
        for p in sorted(d.rglob("*"))
        if p.is_file()
    ]
    changed.append(str(m.manifest_path(data_root).relative_to(root)))
    for name in ("release-index.json",):
        if (data_root / name).exists():
            changed.append(str((data_root / name).relative_to(root)))
    result.pending = mark_pending(
        root, changed, list(result.staged), reconciler=reconciler, on=on
    )
    result.summary = summarise(result)
    return result


def document_key(path: Path) -> str:
    from uk_budget_data.publication.artifacts import read_receipt

    return read_receipt(path)["dashboard"]["key"]


def summarise(result: Collected) -> str:
    """The data pull request's summary, in Markdown."""
    lines = ["## Staged for review", ""]
    years = sorted({y for v in result.revenue.values() for y in v})
    if result.staged:
        head = "| Entry | Status | Reconciliation | " + " | ".join(
            f"{y}-{str(y + 1)[2:]} (£bn)" for y in years
        )
        lines += [head + " |", "|" + "---|" * (3 + len(years))]
        for key, status in result.staged.items():
            values = result.revenue.get(key, {})
            cells = [
                f"{values[y]:+.2f}" if y in values else "–" for y in years
            ]
            lines.append(
                f"| `{key}` | {status} | "
                f"{result.reconciliation.get(key, '–')} | "
                + " | ".join(cells)
                + " |"
            )
        lines.append("")
    for key, problems in result.refused.items():
        lines.append(f"- **Refused `{key}`:** " + "; ".join(problems))
    if result.index:
        lines.append(f"- **Results by area:** index {result.index}.")
    if result.failures:
        lines.append(
            f"- **publish check:** {len(result.failures)} failure(s):"
        )
        lines += [f"  - {failure}" for failure in result.failures]
    elif result.staged:
        lines.append("- **publish check:** passes.")
    if result.pending:
        lines.append(
            f"- **Review rows:** {len(result.pending)} file(s) pending, "
            f"expiring in {PENDING_DAYS} days. Nothing is approved or "
            "signed."
        )
    lines += [
        "",
        "**To publish:** on this branch, after `publish reconcile` and "
        "moving each `reconciliation.json` outside the checkout, the "
        'Reconciler runs `uv run uk-budget-data sign-measures --by "<name>" '
        "--reviewer <handle>` (approve, then review rows), commits and "
        "pushes. Merging deploys.",
    ]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Approving, by hand
# ---------------------------------------------------------------------------


def sign_measures(
    *,
    by: str,
    reviewer: str,
    keys: Optional[list[str]] = None,
    root: Path = Path("."),
    data_root: Optional[Path] = None,
    inputs: Optional[Path] = None,
    household_receipts: Optional[dict[str, dict]] = None,
    staged_by: Optional[str] = None,
    on: Optional[str] = None,
) -> tuple[list[str], object]:
    """Approve staged entries, then write the review rows.

    Run by the Reconciler, by hand, after reviewing the data pull request.
    ``keys`` defaults to every staged entry, measures before combined runs
    (a combined run needs every member approved). Approval is refused,
    approving nothing further, as soon as a gate fails. Returns the keys
    approved and the review-rows report.
    """
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.publish import (
        TREASURY_INPUTS,
        approve,
    )
    from uk_budget_data.publication.review_rows import review_rows

    if not by.strip() or not reviewer.strip():
        raise PublishMeasureError("sign-measures needs --by and --reviewer")
    root = Path(root)
    data_root = Path(data_root or root / m.DATA_ROOT)
    inputs = Path(inputs or root / TREASURY_INPUTS)
    manifest = m.load_manifest(data_root)
    if keys is None:
        keys = sorted(
            (k for k, e in manifest.entries().items() if e.status == m.STAGED),
            key=lambda k: (is_combined(k), k),
        )
    if not keys:
        raise PublishMeasureError("no staged entry to approve")
    receipts = household_receipts or {}
    approved = []
    for key in keys:
        approve(
            manifest,
            key,
            by,
            data_root=data_root,
            inputs=inputs,
            household_receipt=receipts.get(key),
        )
        approved.append(key)
    m.save_manifest(manifest, data_root)
    report = review_rows(
        reviewer=reviewer,
        staged_by=staged_by,
        on=on,
        data_root=data_root,
        review_csv=root / REVIEW_CSV,
    )
    return approved, report
