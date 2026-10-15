"""Keyed, immutable artifacts.

Generating a measure writes one new directory holding that measure's tables
and its receipt, named by the measure and the artifact digest (the receipt
document without its run-specific fields; see ``receipt.artifact_sha256``):

    public/data/artifacts/<key>/<artifact digest prefix>/

A directory is written once, atomically, and never changed, so generating
one measure cannot overwrite or erase another, and anything that names an
artifact by its digest keeps meaning the same bytes. ``reconciliation.json``
is the one file added later: it is a review record bound to the artifact by
its output digest, not part of the artifact's own content.
"""

import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from uk_budget_data.publication.receipt import artifact_sha256
from uk_budget_data.publication.tables import (
    TABLES,
    TableError,
    canonical_csv,
    parse_csv,
    records,
    sha256_bytes,
)

ARTIFACTS_ROOT = Path("public/data/artifacts")
RECEIPT_FILE = "receipt.json"
RECONCILIATION_FILE = "reconciliation.json"
COMBINED_PREFIX = "combined--"
_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]*$")


class ArtifactError(ValueError):
    """Raised when an artifact cannot be written or does not verify."""


@dataclass(frozen=True)
class ArtifactRef:
    """Where an artifact is and what it is."""

    key: str
    path: Path
    outputs_sha256: str
    receipt_sha256: str
    execution_identity_sha256: str
    artifact_sha256: str
    created: bool


def check_key(key: str) -> str:
    """Refuse keys that could escape the artifacts directory."""
    if not _KEY.match(key) or ".." in key:
        raise ArtifactError(f"invalid artifact key {key!r}")
    return key


def table_files(tables: Mapping[str, Any], key: str) -> dict[str, bytes]:
    """Canonical bytes for each table, checked to describe only ``key``.

    Required tables must be present and non-empty; optional tables are
    written when they have rows.
    """
    files = {}
    for name, spec in TABLES.items():
        rows = records(tables[name]) if tables.get(name) is not None else []
        if not rows:
            if spec.required:
                raise ArtifactError(f"{key}: required table {name} is empty")
            continue
        foreign = {str(row["reform_id"]) for row in rows} - {key}
        if foreign:
            raise ArtifactError(
                f"{key}: table {name} holds rows for {sorted(foreign)}"
            )
        try:
            files[spec.filename] = canonical_csv(name, rows)
        except TableError as error:
            raise ArtifactError(f"{key}: {error}") from error
    unknown = set(tables) - set(TABLES)
    if unknown:
        raise ArtifactError(f"{key}: unknown tables {sorted(unknown)}")
    return files


def write_artifact(
    tables: Mapping[str, Any],
    key: str,
    build_receipt: Callable[[dict[str, str]], dict],
    root: Path = ARTIFACTS_ROOT,
) -> ArtifactRef:
    """Write an artifact atomically and return a reference to it.

    Args:
        tables: Table name -> rows (a DataFrame or a list of dicts).
        key: The measure id, or a combined key.
        build_receipt: Given ``{filename: sha256}``, returns the receipt
            document for these exact files.
        root: The artifacts directory.

    If an artifact with the same digest already exists with the same files
    and the same receipt content, nothing is written. If it exists with any
    difference, that is an error: published bytes are never replaced.
    """

    check_key(key)
    files = table_files(tables, key)
    digests = {name: sha256_bytes(data) for name, data in files.items()}
    document = build_receipt(digests)
    recorded = document["dashboard"]["digests"]
    if document["dashboard"]["files"] != dict(sorted(digests.items())):
        raise ArtifactError(f"{key}: the receipt lists different files")

    digest = artifact_sha256(document)
    target = root / key / digest[:16]
    reference = dict(
        key=key,
        path=target,
        outputs_sha256=recorded["outputs_sha256"],
        receipt_sha256=recorded["receipt_sha256"],
        execution_identity_sha256=recorded["execution_identity_sha256"],
        artifact_sha256=digest,
    )
    if target.exists():
        for name, data in files.items():
            existing = target / name
            if not existing.exists() or existing.read_bytes() != data:
                raise ArtifactError(
                    f"{target} already exists with different {name}"
                )
        try:
            stored = artifact_sha256(read_receipt(target))
        except (ArtifactError, ValueError) as error:
            raise ArtifactError(f"{target}: {error}") from error
        if stored != digest:
            raise ArtifactError(
                f"{target} already exists with a different receipt"
            )
        return ArtifactRef(**reference, created=False)

    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=target.parent))
    try:
        for name, data in files.items():
            (staging / name).write_bytes(data)
        (staging / RECEIPT_FILE).write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n"
        )
        os.replace(staging, target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return ArtifactRef(**reference, created=True)


def read_receipt(path: Path) -> dict:
    receipt = path / RECEIPT_FILE
    if not receipt.exists():
        raise ArtifactError(f"{path}: no {RECEIPT_FILE}")
    return json.loads(receipt.read_text())


def read_tables(path: Path) -> dict[str, list[dict]]:
    """Typed rows of every table file in an artifact."""
    return captured_tables(capture(path))


@dataclass(frozen=True)
class Captured:
    """An artifact's receipt and files, each read from disk exactly once.

    Every check of an artifact runs on one capture, so a file changed
    while the checks run cannot pass one check in one version and another
    check in another.
    """

    path: Path
    document: dict
    files: dict[str, bytes]


def capture(path: Path) -> Captured:
    """Read an artifact's receipt and every table or listed file once."""
    receipt = path / RECEIPT_FILE
    if not receipt.exists():
        raise ArtifactError(f"{path}: no {RECEIPT_FILE}")
    document = json.loads(receipt.read_bytes())
    listed = (
        (document.get("dashboard") or {}).get("files")
        if isinstance(document, dict)
        else None
    ) or {}
    names = {spec.filename for spec in TABLES.values()} | set(listed)
    files = {}
    for name in sorted(names):
        file = path / name
        if Path(name).name == name and file.is_file():
            files[name] = file.read_bytes()
    return Captured(path, document, files)


def captured_tables(captured: Captured) -> dict[str, list[dict]]:
    """Typed rows of every table file in a capture."""
    return {
        name: parse_csv(name, captured.files[spec.filename])
        for name, spec in TABLES.items()
        if spec.filename in captured.files
    }


def captured_file_problems(captured: Captured) -> list[str]:
    """Ways a capture's files differ from what its receipt lists.

    Every listed file must exist with the listed digest and be in canonical
    form, and no unlisted table file may be present.
    """
    listed = (captured.document.get("dashboard") or {}).get("files") or {}
    problems = []
    for name, digest in sorted(listed.items()):
        data = captured.files.get(name)
        if data is None:
            problems.append(f"{name} is missing")
            continue
        if sha256_bytes(data) != digest:
            problems.append(f"{name} does not match its recorded digest")
            continue
        table = name.removesuffix(".csv")
        try:
            if canonical_csv(table, parse_csv(table, data)) != data:
                problems.append(f"{name} is not in canonical form")
        except (TableError, KeyError) as error:
            problems.append(f"{name}: {error}")
    for spec in TABLES.values():
        if spec.filename in captured.files and spec.filename not in listed:
            problems.append(f"{spec.filename} is present but not receipted")
    return problems


def file_problems(path: Path, document: dict) -> list[str]:
    """Ways the files on disk differ from what ``document`` lists."""
    on_disk = capture(path)
    return captured_file_problems(Captured(path, document, on_disk.files))
