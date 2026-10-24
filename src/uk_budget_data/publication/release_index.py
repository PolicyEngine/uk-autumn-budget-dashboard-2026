"""Bind supplementary flat tables to one reviewed publication snapshot.

The manifest owns the CSV digests; the index repeats that map and binds the
exact manifest bytes and revision. Replacing either file first fails closed
until both belong to the same snapshot. Only ``publish index`` writes these
bindings, after checking the receipts and comparing receipted flat rows.
"""

import csv
import io
import json
import os
import re
import tempfile
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import (
    capture,
    captured_file_problems,
    captured_tables,
)
from uk_budget_data.publication.tables import (
    TABLES,
    canonical_csv,
    parse_csv,
    sha256_bytes,
)

INDEX_FILE = "release-index.json"
INDEX_SCHEMA = "uk-budget-release-index/v1"
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
CSV_FILE = re.compile(r"[a-z][a-z0-9_]*\.csv\Z")


def identity_problems(manifest) -> list[str]:
    """Publication is for this Budget and this release, explicitly."""
    raw = (
        manifest.model_dump(by_alias=True)
        if isinstance(manifest, m.Manifest)
        else manifest
    )
    if not isinstance(raw, dict) or (
        raw.get("release") != m.CURRENT_RELEASE
        or raw.get("budget") != m.CURRENT_BUDGET
    ):
        return [
            "manifest is not explicitly for the current 2026 Budget release"
        ]
    return []


def release_index_problems(data_root: Path, manifest=None) -> list[str]:
    """Verify index identity, snapshot, complete file map and every CSV byte.

    No index means that no supplementary flat view is published. It is
    permitted for an artifact-only manifest; it never authorizes a figure.
    """
    index_path = data_root / INDEX_FILE
    manifest_path = m.manifest_path(data_root)
    if not index_path.exists() and not getattr(manifest, "flat_files", None):
        # Check a map on disk too when called by a public-file gate.
        if not manifest_path.exists():
            return []
        try:
            raw = json.loads(manifest_path.read_bytes())
        except (OSError, ValueError):
            return ["release index: manifest cannot be read"]
        if not isinstance(raw, dict):
            return ["release index: manifest is not an object"]
        if not raw.get("flat_files"):
            return []
    try:
        if index_path.is_symlink() or manifest_path.is_symlink():
            return ["release index: symbolic link"]
        manifest_bytes = manifest_path.read_bytes()
        raw = json.loads(manifest_bytes)
        index = json.loads(index_path.read_bytes())
        if not isinstance(raw, dict) or not isinstance(index, dict):
            raise ValueError
    except (OSError, ValueError, TypeError):
        return ["release index: manifest or index cannot be read"]
    problems = [f"release index: {p}" for p in identity_problems(raw)]
    if raw.get("schema") != m.SCHEMA:
        problems.append("release index: unknown manifest schema")
    if manifest is not None and (
        raw != manifest.model_dump(by_alias=True, exclude_none=True)
    ):
        problems.append(
            "release index: manifest on disk differs from checked snapshot"
        )
    if index.get("schema") != INDEX_SCHEMA:
        problems.append("release index: unknown schema")
    if index.get("release") != raw.get("release") or index.get(
        "budget"
    ) != raw.get("budget"):
        problems.append("release index: release or Budget identity differs")
    if (
        type(raw.get("revision")) is not int
        or raw["revision"] < 1
        or index.get("manifest_revision") != raw.get("revision")
    ):
        problems.append("release index: manifest revision differs")
    if index.get("manifest_sha256") != sha256_bytes(manifest_bytes):
        problems.append("release index: manifest bytes differ")
    files = index.get("files")
    if not isinstance(files, dict) or not files:
        return problems + ["release index: no flat CSV digests"]
    if files != raw.get("flat_files"):
        problems.append("release index: file map differs from manifest")
    actual_names = {path.name for path in data_root.glob("*.csv")}
    if set(files) != actual_names:
        problems.append(
            "release index: file map does not cover every flat CSV"
        )
    for name, digest in sorted(files.items()):
        if (
            not isinstance(name, str)
            or not CSV_FILE.fullmatch(name)
        ):
            problems.append("release index: unsafe CSV filename")
            continue
        if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            problems.append(f"release index: {name}: invalid SHA-256")
            continue
        path = data_root / name
        if path.is_symlink() or not path.is_file():
            problems.append(f"release index: {name}: not a regular file")
        elif sha256_bytes(path.read_bytes()) != digest:
            problems.append(f"release index: {name}: bytes differ")
    return problems


def _flat_problems(
    manifest: m.Manifest, files: dict[str, bytes], data_root: Path
) -> list[str]:
    """Refuse held/unpublished years and stale copies of receipted rows."""
    from uk_budget_data.publication.publish import binding_problems

    problems = []
    artifacts = {}
    for key, entry in manifest.entries().items():
        if entry.status not in m.DISPLAYABLE:
            continue
        try:
            captured = capture(data_root / entry.artifact)
            found = captured_file_problems(captured)
            tables = captured_tables(captured)
            found += binding_problems(captured.document, tables, entry, key)
            if found:
                problems.extend(f"{key}: {p}" for p in found)
            else:
                artifacts[key] = tables
        except (OSError, ValueError) as error:
            problems.append(
                f"{key}: artifact cannot be verified ({type(error).__name__})"
            )
    for filename, content in sorted(files.items()):
        if not CSV_FILE.fullmatch(filename):
            problems.append(f"{filename}: unsupported flat CSV filename")
            continue
        try:
            rows = list(
                csv.DictReader(
                    io.StringIO(content.decode("utf-8-sig"), newline="")
                )
            )
            for row in rows:
                key = row.get("reform_id", row.get("reform"))
                if key is None:
                    continue  # A reviewed reference table, without figures by policy.
                entry = manifest.entries().get(key)
                year = int(row.get("year", ""))
                if entry is None or entry.status not in m.DISPLAYABLE:
                    problems.append(
                        f"{filename}: row is absent from the displayable manifest"
                    )
                elif (
                    year not in entry.years or year in entry.unsupported_years
                ):
                    problems.append(f"{filename}: row has an unsupported year")
            name = filename.removesuffix(".csv")
            if name in TABLES:
                flat_rows = parse_csv(name, content)
                # Compare every receipted policy represented in the flat
                # table. An optional table absent from all receipts has a
                # separately reviewed flat contract instead.
                for key in {row["reform_id"] for row in flat_rows}:
                    expected = artifacts.get(key, {}).get(name)
                    if expected is not None and canonical_csv(
                        name, expected
                    ) != canonical_csv(
                        name,
                        [row for row in flat_rows if row["reform_id"] == key],
                    ):
                        problems.append(
                            f"{filename}: rows differ from approved artifact for {key}"
                        )
        except (UnicodeError, ValueError, TypeError, KeyError):
            problems.append(f"{filename}: invalid flat CSV contract")
    return sorted(set(problems))


def write_release_index(
    manifest: m.Manifest, *, data_root: Path, inputs: Path
) -> m.Manifest:
    """Gate, bind and write a new manifest/index pair; never bless old rows."""
    from uk_budget_data.publication.publish import PublishError, check

    # Reindexing replaces an old binding after the figures have regenerated.
    # All receipt/approval gates still run; only the obsolete index is skipped.
    problems = identity_problems(manifest) + check(
        manifest, data_root=data_root, inputs=inputs, check_flat_index=False
    )
    try:
        problems += identity_problems(
            json.loads(m.manifest_path(data_root).read_bytes())
        )
    except (OSError, ValueError):
        problems.append("an explicit current manifest must be saved before indexing")
    files = {}
    for path in sorted(data_root.glob("*.csv")):
        if path.is_symlink():
            problems.append(f"{path.name}: a symbolic link")
        else:
            files[path.name] = path.read_bytes()
    if not files:
        problems.append("no flat CSVs to bind")
    problems += _flat_problems(manifest, files, data_root)
    if problems:
        raise PublishError("release index", problems)
    working = manifest.model_copy(deep=True)
    working.flat_files = {
        name: sha256_bytes(content) for name, content in files.items()
    }
    working.revision += 1
    working.updated_at = m.now()
    manifest_bytes = (
        json.dumps(
            working.model_dump(by_alias=True, exclude_none=True),
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode()
    index = {
        "schema": INDEX_SCHEMA,
        "release": working.release,
        "budget": working.budget,
        "manifest_revision": working.revision,
        "manifest_sha256": sha256_bytes(manifest_bytes),
        "files": working.flat_files,
    }
    index_bytes = (json.dumps(index, indent=2, sort_keys=True) + "\n").encode()
    staged = []
    try:
        for filename, content in (
            (INDEX_FILE, index_bytes),
            (m.MANIFEST_FILE, manifest_bytes),
        ):
            handle, temporary = tempfile.mkstemp(
                prefix=".release-", suffix=".json", dir=data_root
            )
            staged.append((Path(temporary), data_root / filename))
            with os.fdopen(handle, "wb") as stream:
                stream.write(content)
        # Each replacement is atomic. Between them the old/new revision and
        # digest mismatch, so consumers refuse every supplementary figure.
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    for field in type(manifest).model_fields:
        setattr(manifest, field, getattr(working, field))
    return manifest
