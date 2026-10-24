"""Bind the flat files a view reads to one reviewed publication snapshot.

Every national figure the page shows comes from a receipt-verified
artifact. Two views read flat files that no artifact carries: the OBR
comparison (``obr_comparison.csv``) and results by area (``regional.csv``
and ``constituency.csv``, from the disclosure layer). ``publish index``
binds those files to the manifest: the manifest records each file's SHA-256
(``flat_files``), and ``release-index.json`` names the manifest's revision
and the SHA-256 of its exact bytes. The page reads a flat file only when the
index matches the manifest it loaded and the file's bytes match their
digest, so replacing either file first fails closed until both belong to the
same snapshot. Only ``publish index`` writes these bindings.
"""

import csv
import io
import json
import os
import re
import tempfile
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.tables import sha256_bytes

INDEX_FILE = "release-index.json"
INDEX_SCHEMA = "uk-budget-release-index/v1"
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
CSV_FILE = re.compile(r"[a-z][a-z0-9_]*\.csv\Z")

# The flat files a view reads directly (OBRComparisonTable.jsx, and
# useGeographyData.js through utils/geography/columns.js). Every other flat
# CSV under public/data is read by no view: the figures it would carry come
# from the artifacts.
FLAT_VIEW_FILES = ("constituency.csv", "obr_comparison.csv", "regional.csv")
# The column naming each row's measure or combined run, by file
ID_COLUMNS = ("reform_id", "reform")


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


def manifest_identity_problems(data_root: Path) -> list[str]:
    """The manifest file itself names this Budget and release.

    The model fills a missing identity with the current one, so a manifest
    written before the identity existed would pass a check of the parsed
    model. The page reads the file, so the file is what is checked.
    """
    path = m.manifest_path(data_root)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return ["manifest cannot be read"]
    return identity_problems(raw)


def release_index_problems(data_root: Path, manifest=None) -> list[str]:
    """Verify the index's identity and snapshot, its file map, and each
    bound file's bytes.

    No index means that no flat view is published: those views show as
    unavailable. That is allowed; it never authorises a figure.
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
    unread = sorted(set(files) - set(FLAT_VIEW_FILES))
    if unread:
        problems.append(
            "release index: binds files no view reads: " + ", ".join(unread)
        )
    unbound = sorted(
        name
        for name in FLAT_VIEW_FILES
        if (data_root / name).exists() and name not in files
    )
    if unbound:
        problems.append(
            "release index: flat view files published but not bound: "
            + ", ".join(unbound)
        )
    for name, digest in sorted(files.items()):
        if not isinstance(name, str) or not CSV_FILE.fullmatch(name):
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


def _flat_problems(manifest: m.Manifest, files: dict[str, bytes]) -> list[str]:
    """Refuse a flat view file that carries a held entry's figures.

    A row whose measure or combined run the manifest lists but does not
    display (staged, stale, withdrawn or not computable) means the file was
    made for another snapshot, or publishes a figure the page must not show.
    A row for an id the manifest does not list is allowed: the page shows
    only rows whose id has a verified artifact in this snapshot. Problems
    name files, ids and statuses, never values.
    """
    problems = []
    entries = manifest.entries()
    for filename, content in sorted(files.items()):
        try:
            reader = csv.DictReader(
                io.StringIO(content.decode("utf-8"), newline="")
            )
            id_column = next(
                (c for c in ID_COLUMNS if c in (reader.fieldnames or [])), None
            )
            if id_column is None or "year" not in reader.fieldnames:
                problems.append(f"{filename}: no measure id or year column")
                continue
            for row in reader:
                int(row["year"])
                entry = entries.get(row[id_column])
                if entry is not None and entry.status not in m.DISPLAYABLE:
                    problems.append(
                        f"{filename}: has figures for {row[id_column]}, "
                        f"which is {entry.status}"
                    )
        except (UnicodeError, ValueError, TypeError, csv.Error):
            problems.append(
                f"{filename}: not a readable CSV with integer years"
            )
    return sorted(set(problems))


def write_release_index(
    manifest: m.Manifest, *, data_root: Path, inputs: Path
) -> m.Manifest:
    """Gate, bind and write a new manifest and index pair.

    Every publication gate runs first, on the manifest and on the file on
    disk; only the index being replaced is skipped. The flat view files
    present are bound as they are: regenerate them for this snapshot first.
    """
    from uk_budget_data.publication.publish import PublishError, check

    problems = identity_problems(manifest) + check(
        manifest, data_root=data_root, inputs=inputs, check_flat_index=False
    )
    if not m.manifest_path(data_root).exists():
        problems.append("save the manifest before indexing it")
    files = {}
    for name in FLAT_VIEW_FILES:
        path = data_root / name
        if path.is_symlink():
            problems.append(f"{name}: a symbolic link")
        elif path.is_file():
            files[name] = path.read_bytes()
    if not files:
        problems.append(
            "no flat view file to bind (" + ", ".join(FLAT_VIEW_FILES) + ")"
        )
    problems += _flat_problems(manifest, files)
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
        # Each replacement is atomic. Between them the revision and digest
        # disagree, so the page refuses every flat view until both land.
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    for field in type(manifest).model_fields:
        setattr(manifest, field, getattr(working, field))
    return manifest
