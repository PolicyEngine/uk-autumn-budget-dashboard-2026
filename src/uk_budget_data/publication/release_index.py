"""Bind the flat files a view reads to one reviewed publication snapshot.

Every national figure the page shows comes from a receipt-verified
artifact. Results by area (``regional.csv`` and ``constituency.csv``, from
the disclosure layer) are the one view that reads flat files no artifact
carries. ``publish index`` binds them to the manifest: the manifest records
each file's SHA-256 (``flat_files``), and ``release-index.json`` names the
manifest's revision and the SHA-256 of its exact bytes. The page reads a
flat file only when the index matches the manifest it loaded and the file's
bytes match their digest, so replacing either file first fails closed until
both belong to the same snapshot. Only ``publish index`` writes these
bindings.

The area run records what it was made from (``area_provenance.json``): the
manifest key each reform in its tables stands for, and that entry's approved
outputs. ``publish index`` refuses the tables once any of those entries has
changed, and passes the package alias the tables use (``PACKAGES`` in
geography.py) to the page as the manifest key it stands for.
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

# The flat files a view reads directly (useGeographyData.js, through
# utils/geography/columns.js). Every other flat CSV under public/data is read
# by no view: the figures it would carry come from the artifacts. The OBR
# comparison's file is not bindable: the pipeline builds it from
# data_inputs/obr_estimates.csv, the November 2025 costings, under ids the
# 2026 registry reuses, so that view stays unavailable until a 2026 OBR
# source exists.
FLAT_VIEW_FILES = ("constituency.csv", "regional.csv")
AREA_FILES = ("constituency.csv", "regional.csv")
AREA_PROVENANCE_FILE = "area_provenance.json"
AREA_PROVENANCE_SCHEMA = "uk-budget-area-provenance/v1"
# The column naming each row's measure or combined run, by file
ID_COLUMNS = ("reform_id", "reform")


# Identity fields covered by the released receipt digest; names are labels.
IDENTITY_FIELDS = ("kind", "representation", "reform_sha256", "binding")
PROVENANCE_KIND = "publication_provenance"
AREA_RECORD_FIELDS = {
    "key",
    "artifact",
    "artifact_sha256",
    "receipt_sha256",
    "outputs_sha256",
    "execution_identity_sha256",
    "baseline",
    "reform",
}


def identity_core(identity: dict) -> dict:
    return {field: identity.get(field) for field in IDENTITY_FIELDS}


def area_provenance_document_problems(document) -> list[str]:
    """A provenance file holds only publication identities and file digests.

    This closed shape is also its reviewed public-data kind: adding any
    survey value or a new field requires changing this rule and its review.
    """
    if not isinstance(document, dict) or set(document) != {
        "schema",
        "manifest_revision",
        "manifest_sha256",
        "reforms",
        "files",
    }:
        return ["area provenance: unexpected fields"]
    if document.get("schema") != AREA_PROVENANCE_SCHEMA:
        return ["area provenance: unknown schema"]
    if (
        type(document["manifest_revision"]) is not int
        or document["manifest_revision"] < 1
    ):
        return ["area provenance: invalid manifest revision"]

    def digest(value):
        return isinstance(value, str) and DIGEST.fullmatch(value) is not None

    if not digest(document["manifest_sha256"]):
        return ["area provenance: invalid manifest digest"]
    files = document["files"]
    if (
        not isinstance(files, dict)
        or not files
        or any(
            name not in AREA_FILES or not digest(value)
            for name, value in files.items()
        )
    ):
        return ["area provenance: invalid table digests"]
    reforms = document["reforms"]
    if not isinstance(reforms, dict) or not reforms:
        return ["area provenance: no reform identities"]
    for reform_id, record in reforms.items():
        if (
            not isinstance(reform_id, str)
            or not reform_id
            or not isinstance(record, dict)
            or set(record) != AREA_RECORD_FIELDS
        ):
            return ["area provenance: unexpected reform identity fields"]
        if (
            not isinstance(record["key"], str)
            or not record["key"]
            or not isinstance(record["artifact"], str)
        ):
            return ["area provenance: invalid approved artifact"]
        path = Path(record["artifact"])
        if path.is_absolute() or ".." in path.parts or not path.parts:
            return ["area provenance: unsafe approved artifact path"]
        if any(
            not digest(record[field])
            for field in (
                "artifact_sha256",
                "receipt_sha256",
                "outputs_sha256",
                "execution_identity_sha256",
            )
        ):
            return ["area provenance: invalid approved identity digest"]
        for side in ("baseline", "reform"):
            identity = record[side]
            if not isinstance(identity, dict) or set(identity) != set(
                IDENTITY_FIELDS
            ):
                return ["area provenance: invalid scenario identity"]
            if identity["kind"] == "current_law":
                if identity != {
                    "kind": "current_law",
                    "representation": None,
                    "reform_sha256": None,
                    "binding": "content",
                }:
                    return ["area provenance: invalid current-law identity"]
            elif (
                identity["kind"] != "reform"
                or not digest(identity["reform_sha256"])
                or not isinstance(identity["representation"], str)
                or not identity["representation"]
                or identity["binding"] not in ("content", "code_revision")
            ):
                return ["area provenance: invalid reform identity"]
    return []


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


def write_area_provenance(out_dir, provenance: dict, written) -> Path:
    """Write what an area run was made from beside its tables.

    ``provenance`` is geography.area_provenance's: the manifest revision and
    SHA-256 read, and each reform's manifest key and approved outputs. The
    SHA-256 of each table written is added here.
    """
    out_dir = Path(out_dir)
    document = {
        "schema": AREA_PROVENANCE_SCHEMA,
        **provenance,
        "files": {
            Path(path).name: sha256_bytes(Path(path).read_bytes())
            for path in written
        },
    }
    problems = area_provenance_document_problems(document)
    if problems:
        raise ValueError("; ".join(problems))
    path = out_dir / AREA_PROVENANCE_FILE
    handle, temporary = tempfile.mkstemp(
        prefix=".area-provenance-", suffix=".json", dir=out_dir
    )
    try:
        with os.fdopen(handle, "w") as stream:
            stream.write(json.dumps(document, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return path


def _reform_ids(content: bytes) -> set[str]:
    reader = csv.DictReader(io.StringIO(content.decode("utf-8"), newline=""))
    column = next(
        (c for c in ID_COLUMNS if c in (reader.fieldnames or [])), None
    )
    if column is None:
        raise ValueError("no measure id column")
    return {row[column] for row in reader}


def area_problems(
    manifest: m.Manifest, files: dict[str, bytes], data_root: Path
) -> tuple[list[str], dict[str, str]]:
    """Refuse area tables made for other entries than those now approved.

    Returns the problems, and the aliases the tables use for manifest keys
    (a package alias for its combined run). Problems name files, ids and
    statuses, never values.
    """
    present = {name: files[name] for name in AREA_FILES if name in files}
    if not present:
        return [], {}
    try:
        document = json.loads((data_root / AREA_PROVENANCE_FILE).read_bytes())
    except (OSError, ValueError):
        return [
            f"area results: no readable {AREA_PROVENANCE_FILE}; "
            "rerun the area run"
        ], {}
    if (
        not isinstance(document, dict)
        or document.get("schema") != AREA_PROVENANCE_SCHEMA
    ):
        return [f"area results: {AREA_PROVENANCE_FILE} has another schema"], {}
    problems = area_provenance_document_problems(document)
    if problems:
        return problems, {}
    digests = {
        name: sha256_bytes(content) for name, content in present.items()
    }
    if document.get("files") != digests:
        problems.append(
            "area results: the tables are not the ones the area run wrote"
        )
    reforms = document.get("reforms")
    if not isinstance(reforms, dict):
        return problems + ["area results: no reforms recorded"], {}
    used = set()
    for name, content in present.items():
        try:
            used |= _reform_ids(content)
        except (UnicodeError, ValueError, csv.Error):
            problems.append(f"{name}: not a readable CSV with a reform column")
    entries = manifest.entries()
    aliases = {}
    identity = (
        "artifact",
        "artifact_sha256",
        "receipt_sha256",
        "outputs_sha256",
        "execution_identity_sha256",
    )
    for reform_id in sorted(used):
        record = reforms.get(reform_id)
        if (
            not isinstance(record, dict)
            or not isinstance(record.get("key"), str)
            or any(
                not isinstance(record.get(field), str) for field in identity
            )
        ):
            problems.append(
                f"area results: {reform_id} is not recorded by the area run"
            )
            continue
        key = record["key"]
        entry = entries.get(key)
        if entry is None or entry.status not in m.DISPLAYABLE:
            status = entry.status if entry is not None else "not listed"
            problems.append(
                f"area results: {reform_id} stands for {key}, which is {status}"
            )
        elif any(getattr(entry, field) != record[field] for field in identity):
            problems.append(
                f"area results for {reform_id} were made for an earlier "
                f"{key}; rerun the area run"
            )
        if entry is not None:
            try:
                receipt_path = data_root / entry.artifact / "receipt.json"
                if receipt_path.is_symlink():
                    raise ValueError
                receipt = json.loads(receipt_path.read_bytes())
                from uk_budget_data.publication.receipt import (
                    artifact_sha256,
                    document_problems,
                )

                if (
                    document_problems(receipt)
                    or artifact_sha256(receipt) != entry.artifact_sha256
                    or any(
                        record[side]
                        != identity_core(receipt["execution_receipt"][side])
                        for side in ("baseline", "reform")
                    )
                ):
                    raise ValueError
            except (OSError, ValueError, KeyError, TypeError):
                problems.append(
                    f"area results: {reform_id} approved receipt identity differs"
                )
        if key != reform_id:
            aliases[reform_id] = key
    return problems, aliases


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
    provenance_digest = raw.get("flat_provenance_sha256")
    provenance_path = data_root / AREA_PROVENANCE_FILE
    if (
        not isinstance(provenance_digest, str)
        or not DIGEST.fullmatch(provenance_digest)
        or index.get("flat_provenance_sha256") != provenance_digest
        or provenance_path.is_symlink()
        or not provenance_path.is_file()
        or sha256_bytes(provenance_path.read_bytes()) != provenance_digest
    ):
        problems.append(
            "release index: area provenance differs from the manifest binding"
        )
    aliases = index.get("aliases")
    if aliases != (raw.get("flat_aliases") or {}):
        problems.append("release index: aliases differ from the manifest's")
    keys = set(raw.get("measures") or {}) | set(raw.get("combined") or {})
    if not isinstance(aliases, dict) or any(
        not isinstance(alias, str)
        or alias in keys
        or not isinstance(key, str)
        or key not in keys
        for alias, key in aliases.items()
    ):
        problems.append(
            "release index: aliases must name manifest keys, and only them"
        )
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
    # The area run's record still matches the entries, and names the aliases
    bound = {
        name: (data_root / name).read_bytes()
        for name in files
        if name in AREA_FILES and (data_root / name).is_file()
    }
    try:
        model = m.parse_manifest(manifest_bytes, str(manifest_path))
    except ValueError:
        return problems + ["release index: the manifest does not parse"]
    found, expected = area_problems(model, bound, data_root)
    problems += [f"release index: {problem}" for problem in found]
    if aliases != expected:
        problems.append(
            "release index: aliases differ from the area run's record"
        )
    return problems


def _flat_problems(
    manifest: m.Manifest, files: dict[str, bytes], aliases: dict[str, str]
) -> list[str]:
    """Refuse a flat view file that carries a held entry's figures.

    A row whose measure or combined run (through its alias) the manifest
    lists but does not display (staged, stale, withdrawn or not computable)
    means the file was made for another snapshot, or publishes a figure the
    page must not show. Every year must be an integer. Problems name files,
    ids and statuses, never values.
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
                entry = entries.get(
                    aliases.get(row[id_column], row[id_column])
                )
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
    found, aliases = area_problems(manifest, files, data_root)
    problems += found + _flat_problems(manifest, files, aliases)
    if problems:
        raise PublishError("release index", problems)
    working = manifest.model_copy(deep=True)
    working.flat_files = {
        name: sha256_bytes(content) for name, content in files.items()
    }
    working.flat_aliases = dict(sorted(aliases.items()))
    working.flat_provenance_sha256 = sha256_bytes(
        (data_root / AREA_PROVENANCE_FILE).read_bytes()
    )
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
        # The ids the bound tables use for manifest keys (a package alias)
        "aliases": working.flat_aliases,
        "flat_provenance_sha256": working.flat_provenance_sha256,
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
