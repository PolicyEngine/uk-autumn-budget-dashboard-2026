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
manifest key each reform in its tables stands for, the approved entry it
checked each reform against, and, since schema v2, each reform's definition
(its baseline and reform digests without the commit), the commit, years and
dataset of the run that wrote each table. ``publish index`` binds the tables
to what their figures depend on, not to the national artifacts:

- the same reforms, each still displayable under the same manifest key;
- each reform's definition the current approved receipt's, and the one the
  code at HEAD defines;
- the same local-area dataset (only an area run writes the record, and the
  table digests tie the tables to it);
- no area-relevant code (``area_code.AREA_CODE_PATHS``) changed since the
  area run's commit, or between it and the commit each approved receipt was
  made at.

So a national rerun that changes none of these, such as one that adds a
table, keeps the map. A v1 record binds each national artifact itself, and
is still accepted under that rule: any national rerun refuses it until the
area run is rerun once. The package alias the tables use (``PACKAGES`` in
geography.py) is passed to the page as the manifest key it stands for.

The code checks need git and the measure registry, so only ``publish
index`` makes them (``code_root``); ``publish check`` and the page check the
rest, against the exact manifest bytes the index binds.
"""

import csv
import io
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Optional

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
# v2 binds the tables to definitions, dataset and area code; v1, written
# before it, to the national artifacts (still accepted, under that rule).
AREA_PROVENANCE_SCHEMA = "uk-budget-area-provenance/v2"
AREA_PROVENANCE_SCHEMA_V1 = "uk-budget-area-provenance/v1"
AREA_PROVENANCE_SCHEMAS = (AREA_PROVENANCE_SCHEMA_V1, AREA_PROVENANCE_SCHEMA)
# The column naming each row's measure or combined run, by file
ID_COLUMNS = ("reform_id", "reform")
COMMIT = re.compile(r"[0-9a-f]{40}\Z|[0-9a-f]{64}\Z")


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
    if not isinstance(document, dict):
        return ["area provenance: unexpected fields"]
    if document.get("schema") not in AREA_PROVENANCE_SCHEMAS:
        return ["area provenance: unknown schema"]
    v2 = document["schema"] == AREA_PROVENANCE_SCHEMA
    fields = {
        "schema",
        "manifest_revision",
        "manifest_sha256",
        "reforms",
        "files",
    } | ({"runs"} if v2 else set())
    if set(document) != fields:
        return ["area provenance: unexpected fields"]
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
    if v2:
        runs = document["runs"]
        if (
            not isinstance(runs, dict)
            or set(runs) != set(files)
            or not all(_valid_run(run) for run in runs.values())
        ):
            return ["area provenance: invalid area run records"]
    reforms = document["reforms"]
    if not isinstance(reforms, dict) or not reforms:
        return ["area provenance: no reform identities"]
    record_fields = AREA_RECORD_FIELDS | ({"definition"} if v2 else set())
    for reform_id, record in reforms.items():
        if (
            not isinstance(reform_id, str)
            or not reform_id
            or not isinstance(record, dict)
            or set(record) != record_fields
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
        if v2 and not _valid_definition(record):
            return ["area provenance: invalid reform definition"]
    return []


def _valid_run(run) -> bool:
    """One table's area run: its commit, years and dataset."""
    if not isinstance(run, dict) or set(run) != {
        "git_sha",
        "years",
        "dataset",
    }:
        return False
    years, dataset = run["years"], run["dataset"]
    return (
        isinstance(run["git_sha"], str)
        and COMMIT.fullmatch(run["git_sha"]) is not None
        and isinstance(years, list)
        and bool(years)
        and all(type(year) is int for year in years)
        and years == sorted(set(years))
        and isinstance(dataset, dict)
        and set(dataset) == {"kind", "name", "sha256"}
        and all(
            isinstance(dataset[field], str) and dataset[field]
            for field in ("kind", "name")
        )
        and (
            dataset["sha256"] is None
            or (
                isinstance(dataset["sha256"], str)
                and DIGEST.fullmatch(dataset["sha256"]) is not None
            )
        )
    )


def _valid_definition(record: dict) -> bool:
    """Each side's definition digest: null for current law, and for a
    content-bound side its identity's own digest (which has no commit)."""
    definition = record["definition"]
    if not isinstance(definition, dict) or set(definition) != {
        "baseline",
        "reform",
    }:
        return False
    for side in ("baseline", "reform"):
        identity, value = record[side], definition[side]
        if identity["kind"] == "current_law":
            if value is not None:
                return False
        elif not isinstance(value, str) or not DIGEST.fullmatch(value):
            return False
        elif identity["binding"] == "content" and (
            value != identity["reform_sha256"]
        ):
            return False
    return True


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
    SHA-256 read, each reform's manifest key, approved outputs and
    definition, and ``run``, this run's commit and years, with the dataset
    its caller adds. ``carried_runs`` (constituencies.carried_provenance)
    gives the run of each table another run wrote. The SHA-256 of each table
    written is added here.
    """
    out_dir = Path(out_dir)
    carried = provenance.get("carried_runs") or {}
    files = {
        Path(path).name: sha256_bytes(Path(path).read_bytes())
        for path in written
    }
    document = {
        "schema": AREA_PROVENANCE_SCHEMA,
        **{
            field: provenance[field]
            for field in ("manifest_revision", "manifest_sha256", "reforms")
        },
        "files": files,
        "runs": {name: carried.get(name, provenance["run"]) for name in files},
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
    manifest: m.Manifest,
    files: dict[str, bytes],
    data_root: Path,
    *,
    code_root: Optional[Path] = None,
) -> tuple[list[str], dict[str, str]]:
    """Refuse area tables whose figures may differ from what the approved
    entries now define.

    A v2 record is checked against each reform's definition, and, with
    ``code_root`` (the repository, for ``publish index``), against the code
    at HEAD and in git (the module docstring). A v1 record is checked
    against the national artifacts it was made beside, as before v2.

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
        or document.get("schema") not in AREA_PROVENANCE_SCHEMAS
    ):
        return [f"area results: {AREA_PROVENANCE_FILE} has another schema"], {}
    problems = area_provenance_document_problems(document)
    if problems:
        return problems, {}
    v2 = document["schema"] == AREA_PROVENANCE_SCHEMA
    digests = {
        name: sha256_bytes(content) for name, content in present.items()
    }
    if document.get("files") != digests:
        problems.append(
            "area results: the tables are not the ones the area run wrote"
        )
    reforms = document["reforms"]
    used_by_file = {}
    for name, content in present.items():
        try:
            used_by_file[name] = _reform_ids(content)
        except (UnicodeError, ValueError, csv.Error):
            problems.append(f"{name}: not a readable CSV with a reform column")
    used = set().union(*used_by_file.values()) if used_by_file else set()
    entries = manifest.entries()
    aliases = {}
    receipts = {}
    identity = (
        "artifact",
        "artifact_sha256",
        "receipt_sha256",
        "outputs_sha256",
        "execution_identity_sha256",
    )
    for reform_id in sorted(used):
        record = reforms.get(reform_id)
        if record is None:
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
        elif not v2 and any(
            getattr(entry, field) != record[field] for field in identity
        ):
            problems.append(
                f"area results for {reform_id} were made for an earlier "
                f"{key}; rerun the area run (its {AREA_PROVENANCE_FILE} is "
                "v1, bound to the national artifact; the rerun writes v2, "
                "bound to the definition)"
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
                    or (receipt.get("dashboard") or {}).get("key") != key
                    or not all(
                        _same_definition(
                            record[side],
                            identity_core(receipt["execution_receipt"][side]),
                            exact=not v2,
                        )
                        for side in ("baseline", "reform")
                    )
                ):
                    raise ValueError
                receipts[reform_id] = receipt
            except (OSError, ValueError, KeyError, TypeError):
                problems.append(
                    f"area results: {reform_id} approved receipt identity differs"
                    + ("" if not v2 else "; rerun the area run")
                )
        if key != reform_id:
            aliases[reform_id] = key
    if v2 and code_root is not None and not problems:
        problems += _area_code_problems(
            document, used_by_file, receipts, Path(code_root)
        )
    return problems, aliases


def _same_definition(recorded: dict, current: dict, *, exact: bool) -> bool:
    """Whether an area run's identity of one side is the current receipt's.

    ``exact`` (v1): equal, the code-bound digest's commit included. v2: the
    same kind, representation and binding, and for a content-bound side the
    same digest, which has no commit. A code-bound digest includes the
    receipt's commit, so its definition is compared with the code
    (``_area_code_problems``) instead.
    """
    if exact:
        return recorded == current
    return all(
        recorded[field] == current[field]
        for field in ("kind", "representation", "binding")
    ) and (
        current["binding"] != "content"
        or recorded["reform_sha256"] == current["reform_sha256"]
    )


def _area_code_problems(
    document: dict,
    used_by_file: dict[str, set],
    receipts: dict[str, dict],
    code_root: Path,
) -> list[str]:
    """The v2 checks that need the repository (``publish index`` only).

    For each table's area run: no area-relevant code changed since its
    commit (committed, uncommitted or untracked); none differs between it
    and the commit each reform's approved receipt was made at; and each
    reform's definition, as the code at HEAD defines it, is the one the
    area run recorded, under the same manifest key.
    """
    from uk_budget_data import geography
    from uk_budget_data.publication import area_code
    from uk_budget_data.publication.receipt import ReceiptUnavailable

    problems = []
    rerun = "rerun the area run"
    definitions = {}
    for name, used in sorted(used_by_file.items()):
        run = document["runs"][name]
        sha = run["git_sha"]
        try:
            changed = area_code.area_changes_since(sha, code_root)
        except ValueError as error:
            problems.append(f"area results: {name}: {error}; {rerun}")
            continue
        if changed:
            problems.append(
                f"area results: code that can change {name} changed since "
                f"its area run's commit {sha[:12]} "
                f"({', '.join(changed[:5])}); {rerun}"
            )
        for reform_id in sorted(used):
            receipt = receipts.get(reform_id)
            if receipt is None:
                continue
            approved = (receipt.get("dashboard") or {}).get("git_sha")
            try:
                between = area_code.area_changes_between(
                    sha, approved, code_root
                )
            except ValueError as error:
                problems.append(f"area results: {reform_id}: {error}")
                continue
            if between:
                problems.append(
                    f"area results: {reform_id}'s approved artifact was made "
                    f"with other area code than {name} "
                    f"({', '.join(between[:5])}); {rerun}"
                )
            record = document["reforms"][reform_id]
            if geography.manifest_key(reform_id) != record["key"]:
                problems.append(
                    f"area results: {reform_id} now stands for other "
                    f"members than {record['key']}; {rerun}"
                )
                continue
            label = (reform_id, tuple(run["years"]))
            if label not in definitions:
                try:
                    definitions[label] = geography.definition_digests(
                        reform_id, run["years"]
                    )
                except (KeyError, ValueError, ReceiptUnavailable) as error:
                    definitions[label] = error
            current = definitions[label]
            if isinstance(current, Exception):
                problems.append(
                    f"area results: {reform_id}'s definition cannot be "
                    f"bound: {current}"
                )
            elif current != record["definition"]:
                problems.append(
                    f"area results: {reform_id}'s definition changed since "
                    f"its area run; {rerun}"
                )
    return problems


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


def unbind_area_results(
    manifest: m.Manifest, *, data_root: Path
) -> m.Manifest:
    """Take the results by area off the page, for a correction (G5).

    A withdrawal leaves the bound area tables holding the withdrawn
    entry's rows, and a stale package's, so ``write_release_index``
    refuses them until the area run is rerun. This is the quick way past
    that: it deletes the index, the area tables and their provenance, and
    saves the manifest without a flat binding (raising its revision). With
    no index the area views show as unavailable, and nothing else on the
    page changes. It authorises no figure, so it runs no gate; run
    ``publish check`` after it. The area run and ``publish index`` bring
    the views back.
    """
    from uk_budget_data.publication.publish import PublishError

    problems = identity_problems(manifest)
    if not m.manifest_path(data_root).exists():
        problems.append("save the manifest before unbinding it")
    if problems:
        raise PublishError("release index", problems)
    working = manifest.model_copy(deep=True)
    working.flat_files = {}
    working.flat_aliases = {}
    working.flat_provenance_sha256 = None
    # The index first, so no later state pairs it with these files, and
    # the manifest last, so no area file outlives its binding: until the
    # save, the saved manifest binds files with no index, which publish
    # check refuses. Each step leaves the area views unavailable, and
    # rerunning finishes it.
    (data_root / INDEX_FILE).unlink(missing_ok=True)
    for name in (*AREA_FILES, AREA_PROVENANCE_FILE):
        (data_root / name).unlink(missing_ok=True)
    m.save_manifest(working, data_root)
    for field in type(manifest).model_fields:
        setattr(manifest, field, getattr(working, field))
    return manifest


def write_release_index(
    manifest: m.Manifest,
    *,
    data_root: Path,
    inputs: Path,
    code_root: Optional[Path] = Path("."),
) -> m.Manifest:
    """Gate, bind and write a new manifest and index pair.

    Every publication gate runs first, on the manifest and on the file on
    disk; only the index being replaced is skipped. The flat view files
    present are bound as they are: regenerate them for this snapshot first.
    ``code_root`` is the repository the area code is checked in (the
    working directory); None skips those checks, for tests of the others.
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
    found, aliases = area_problems(
        manifest, files, data_root, code_root=code_root
    )
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
