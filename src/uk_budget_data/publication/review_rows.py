"""Public-file review rows for the gated publication.

Every file under ``public/`` needs a row in
``data_inputs/public_data_review.csv`` with the SHA-256 of the bytes a person
reviewed (``scripts/check_public_data.py`` in CI, and
``scripts/check-public-files.mjs`` in the build). The gated publication writes
its manifest and artifacts under ``public/data/``, so each publish pull
request carries their rows. The Reconciler writes them with

    uv run uk-budget-data publish review-rows --reviewer NAME

and the review list is committed with the artifacts. Each row is the
Reconciler's attestation that they reviewed those bytes.

Rows are written only for what the page lists, and only for bytes the gate
bound:

- each file of each displayed entry (approved or provisional): its
  ``receipt.json``, which the entry names by its artifact digest, and each
  file the receipt lists, by the digest the receipt records;
- the ``receipt.json`` of each not-computable entry, which is all its
  artifact holds: its receipt lists no files, so it binds no figures. The
  page lists it with its reason and fetches nothing from it
  (``src/utils/publication/load.js``), but ``publish check`` reads it, so
  it stays in ``public/`` and needs a row;
- ``manifest.json`` itself.

Nothing else gets a row. A staged, stale or withdrawn entry is not shown at
all. The manifest does not record who staged an entry, so ``--staged-by``
names them whenever a provisional or not-computable entry is listed.

The artifact digest covers a receipt's content except the two fields that
describe its generation run (``receipt.VOLATILE_DASHBOARD_FIELDS``), so a
receipt must also hold nothing beyond what that digest covers, in the form
publication writes, with those two fields shaped as a time and a command
line. Their values are the only bytes in a row that the gate did not bind.

The run refuses, and writes and deletes nothing, if any listed file is not
what the gate bound, if a displayed artifact holds a file its receipt does
not bind (``reconciliation.json``, say, which the gates recompute and never
read), if a not-computable artifact holds anything but its receipt, if a
displayed entry's receipt records a data limit, or if a symbolic link lies
on any path it would review.

Once nothing is refused, it deletes every path under the data root's
``artifacts/`` that is not inside an artifact directory a current manifest
entry names, whatever that entry's status: generated runs never staged, and
the artifacts of superseded entries, which the manifest keeps for audit but
no longer names, after a correction or a re-cut. Directories left empty go
too. It never follows a symbolic link and never deletes anything outside
``artifacts/``. It keeps what an entry names by the path the manifest
spells, so it also refuses, writing and deleting nothing, if any current
entry's artifact is reached through a symbolic link, holds one, holds a
directory it cannot list, or is spelled otherwise on disk (as a
case-insensitive filesystem allows). Stage everything to be kept before
running it.

Re-running replaces the rows for the same paths in place. It removes only
rows under the data root's ``artifacts/`` whose files are no longer on disk,
and never touches any other row: untouched rows keep their bytes, quoting
and order. New rows go in path order among the rest.
"""

import csv
import io
import json
import os
import re
import shutil
import stat
import tempfile
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from policyengine.disclosure.schema import PUBLIC_COLUMNS
from pydantic import ValidationError

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import RECEIPT_FILE
from uk_budget_data.publication.receipt import (
    VOLATILE_DASHBOARD_FIELDS,
    artifact_sha256,
    receipt_api,
)
from uk_budget_data.publication.tables import sha256_bytes

REVIEW_CSV = Path("data_inputs/public_data_review.csv")
# The review list's columns, as scripts/check_public_data.py requires them.
REVIEW_COLUMNS = (
    "path",
    "kind",
    "sha256",
    "reviewer",
    "reviewed_on",
    "expires_on",
    "basis",
)
PUBLIC = "public"
ARTIFACTS_DIR = "artifacts"
# A receipt's top-level fields: what build_receipt_document writes, and all
# that receipt.artifact_sha256 digests.
RECEIPT_FIELDS = {"schema", "execution_receipt", "dashboard"}

NATIONAL_TABLE = "national_table"
SYNTHETIC_HOUSEHOLD = "synthetic_household"
STATIC_ASSET = "static_asset"
# The kind each artifact table is reviewed as. Every table but one holds UK
# totals or UK deciles, as the flat CSVs it replaces do, and the binned
# scatter counts households by UK-wide income and change bands; the income
# curve is one hypothetical household, as public/data/income_curve.csv is
# reviewed. None carries the disclosure layer's public columns, so none may
# be reviewed as a disclosure_table.
TABLE_KINDS = {
    "budgetary_impact.csv": NATIONAL_TABLE,
    "distributional_impact.csv": NATIONAL_TABLE,
    "winners_losers.csv": NATIONAL_TABLE,
    "metrics.csv": NATIONAL_TABLE,
    "household_scatter_binned.csv": NATIONAL_TABLE,
    "income_curve.csv": SYNTHETIC_HOUSEHOLD,
}
# A receipt holds provenance and digests, and the manifest entries, their
# statuses and digests, and any household check receipt, which concerns
# hypothetical households: no figure from the survey, so both are reviewed
# as files with no data.
RECEIPT_KIND = STATIC_ASSET
MANIFEST_KIND = STATIC_ASSET
# Tables an artifact may list (publication.tables.TABLES) that no review row
# can cover.
NO_ROW_REASONS = {
    "household_scatter.csv": (
        "one row per survey household, with its id and weight; only the "
        "binned scatter is published"
    ),
    "constituency.csv": "results by area are published only through the "
    "disclosure layer",
    "demographic_constituency.csv": "results by area are published only "
    "through the disclosure layer",
}

# The disclosure checks' rules that no review row can satisfy, as
# scripts/check_public_data.py states them: no public file may carry
# record-level identifiers; a CSV with the layer's public columns must be
# reviewed as a disclosure table (which this helper never writes); and a
# file reviewed as any kind written here may carry at most a few area codes.
RECORD_LEVEL = re.compile(rb"\b(?:household|benunit|person)_(?:id|weight)\b")
AREA_CODE = re.compile(
    rb"\b(?:E14|W07|S14|N05|E06|E07|E08|E09|W06|S12|N09|E05|W05|S13|N08"
    rb"|E02|W02|S02|E01|W01|S01|E00|W00|S00|N00|N20|N21)\d{6}\b"
)
MAX_AREA_CODES = 20
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ReviewRowsError(RuntimeError):
    """Raised when no row is written; ``problems`` says why."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Row:
    """One review row the helper writes."""

    path: str
    kind: str
    sha256: str
    basis: str


@dataclass
class Report:
    """What a run changed, by path. Holds no cell values."""

    revision: int
    added: list[str] = field(default_factory=list)
    replaced: list[str] = field(default_factory=list)
    unchanged: int = 0
    removed: list[str] = field(default_factory=list)
    # Paths under the data root's artifacts/ that no manifest entry names,
    # deleted from disk (directories end in "/").
    deleted: list[str] = field(default_factory=list)
    # Files under the data root left with no row: (path, why).
    unreviewed: list[tuple[str, str]] = field(default_factory=list)
    elapsed: float = 0.0


@dataclass(frozen=True)
class _Record:
    """One record of the review list, exactly as it is in the file."""

    raw: str
    path: Optional[str]


def _name(value: Optional[str]) -> str:
    """A person's name on one line, or empty."""
    return " ".join((value or "").split())


def _absolute(path: Path) -> Path:
    return Path(os.path.normpath(os.path.abspath(path)))


def _within(root: Path, path: Path) -> Optional[Path]:
    """``path`` relative to the resolved ``root``, however it is spelled.

    The first ancestor of ``path`` that resolves to ``root`` is taken as the
    root, so a parent reached through a link (macOS's ``/var``, say) still
    matches, while the components below it are kept as given and a link
    among them can be refused.
    """
    path = _absolute(path)
    for ancestor in (path, *path.parents):
        if Path(os.path.realpath(ancestor)) == root:
            return path.relative_to(ancestor)
    return None


def _first_link(root: Path, relative: Path) -> Optional[str]:
    """The first component of ``root / relative`` that is a symbolic link."""
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            return path.relative_to(root).as_posix()
    return None


def _review_date(on: Optional[str]) -> str:
    if on is None:
        return datetime.now(timezone.utc).date().isoformat()
    try:
        if not _DATE.match(on):
            raise ValueError
        return date.fromisoformat(on).isoformat()
    except ValueError:
        raise ReviewRowsError(
            [f"--on {on!r} is not a date (YYYY-MM-DD)"]
        ) from None


def _is_layer_shaped(name: str, data: bytes) -> bool:
    """Whether a file is a CSV with the disclosure layer's public columns."""
    if not name.endswith(".csv"):
        return False
    text = data.decode("utf-8-sig", errors="replace")
    header = next(csv.reader(io.StringIO(text)), None) or []
    return set(PUBLIC_COLUMNS) <= set(header)


def _no_kind_problems(where: str, data: bytes) -> list[str]:
    """Rules of the disclosure checks that a row of these kinds would fail.

    As in scripts/check_public_data.py, the content rules skip binary files
    and the disclosure-table rule does not.
    """
    binary = b"\0" in data[:8192]
    problems = []
    if not binary and RECORD_LEVEL.search(data):
        problems.append(f"{where}: carries record-level identifiers")
    if _is_layer_shaped(where, data):
        problems.append(
            f"{where}: shaped as a disclosure-layer table, which is reviewed "
            "through the layer, not by this helper"
        )
    elif not binary and len(set(AREA_CODE.findall(data))) > MAX_AREA_CODES:
        problems.append(
            f"{where}: carries more than {MAX_AREA_CODES} area codes"
        )
    return problems


def _read_file(path: Path, where: str, problems: list[str]) -> Optional[bytes]:
    if path.is_symlink():
        problems.append(f"{where}: a symbolic link")
        return None
    if not path.is_file():
        problems.append(f"{where}: missing")
        return None
    return path.read_bytes()


def receipt_bytes(document) -> bytes:
    """A receipt's bytes as ``write_artifact`` writes them."""
    return (json.dumps(document, indent=2, sort_keys=True) + "\n").encode()


def _is_time(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_command_line(value) -> bool:
    return isinstance(value, list) and all(isinstance(a, str) for a in value)


# The shape each field left out of the artifact digest must have. A field
# added to VOLATILE_DASHBOARD_FIELDS without a shape here is refused.
VOLATILE_SHAPES = {
    "generated_at": _is_time,
    "generator_argv": _is_command_line,
}


def _receipt_problems(
    key: str, entry: m.Entry, document, data: bytes, where: str
) -> list[str]:
    """Ways a receipt is not the one the entry names."""
    if not isinstance(document, dict) or not isinstance(
        document.get("dashboard"), dict
    ):
        return [f"{where}: not a receipt"]
    dashboard = document["dashboard"]
    problems = []
    if set(document) != RECEIPT_FIELDS:
        problems.append(
            f"{where}: holds fields its artifact digest does not cover"
        )
    for name in VOLATILE_DASHBOARD_FIELDS:
        shape = VOLATILE_SHAPES.get(name)
        if shape is None or not shape(dashboard.get(name)):
            problems.append(
                f"{where}: its {name} is not shaped as publication writes it"
            )
    if receipt_bytes(document) != data:
        problems.append(f"{where}: not in the form publication writes")
    if artifact_sha256(document) != entry.artifact_sha256:
        problems.append(
            f"{where}: not the receipt {key}'s entry names (its artifact "
            "digest differs)"
        )
    if dashboard.get("key") != key:
        problems.append(f"{where}: is not {key}'s receipt")
    files, digests = dashboard.get("files"), dashboard.get("digests")
    if not isinstance(files, dict) or not isinstance(digests, dict):
        return problems + [f"{where}: does not record its files and digests"]
    if entry.status == m.NOT_COMPUTABLE:
        if files:
            problems.append(
                f"{where}: lists files, but a not-computable artifact binds "
                "no figures"
            )
        if not dashboard.get("data_limits"):
            problems.append(
                f"{where}: records no data limit, so it is not 'not "
                "computable'"
            )
    elif dashboard.get("data_limits"):
        problems.append(
            f"{where}: records a data limit, so its figures cannot be "
            "displayed"
        )
    elif not files:
        return problems + [f"{where}: does not record its files and digests"]
    api, _ = receipt_api()
    if (
        api.content_sha256(files) != entry.outputs_sha256
        or digests.get("outputs_sha256") != entry.outputs_sha256
    ):
        problems.append(
            f"{where}: does not list the files {key}'s entry names"
        )
    return problems


def _entry_rows(
    key: str,
    entry: m.Entry,
    *,
    data_root: Path,
    root: Path,
    responsible: str,
    revision: int,
    problems: list[str],
) -> list[Row]:
    """The rows for one listed entry, checked against what the gate bound.

    A displayed entry gets a row for its receipt and each file it lists; a
    not-computable one, for its receipt, which is all it may hold. Each
    file is read once: the bytes checked are the bytes the row names.
    """
    directory = data_root / entry.artifact
    relative = directory.relative_to(root)
    where = relative.as_posix()
    link = _first_link(root, relative)
    if link is not None:
        problems.append(f"{link}: a symbolic link")
        return []
    if not directory.is_dir():
        problems.append(f"{where}: {key}'s artifact directory is missing")
        return []
    if entry.status == m.APPROVED and (
        entry.approval is None
        or entry.approval.artifact_sha256 != entry.artifact_sha256
        or entry.approval.outputs_sha256 != entry.outputs_sha256
    ):
        problems.append(f"{key}: its approval is not for this artifact")
    phrase = {
        m.APPROVED: f"approved by {responsible}",
        m.PROVISIONAL: f"provisional, staged by {responsible}",
        m.NOT_COMPUTABLE: f"not computable, staged by {responsible}",
    }[entry.status]
    tables_basis = (
        f"Gated publication: {phrase} (manifest revision {revision}); "
        "bytes bound by the receipt"
    )
    receipt_basis = (
        f"Gated publication: {phrase} (manifest revision {revision}); "
        "receipt bound by the entry's artifact digest"
    )

    receipt_where = f"{where}/{RECEIPT_FILE}"
    data = _read_file(directory / RECEIPT_FILE, receipt_where, problems)
    if data is None:
        return []
    try:
        document = json.loads(data)
    except ValueError:
        problems.append(f"{receipt_where}: not valid JSON")
        return []
    found = _receipt_problems(key, entry, document, data, receipt_where)
    if found:
        problems.extend(found)
        return []
    rows = [
        Row(receipt_where, RECEIPT_KIND, sha256_bytes(data), receipt_basis)
    ]
    problems.extend(_no_kind_problems(receipt_where, data))

    if entry.status == m.NOT_COMPUTABLE:
        for name in sorted(os.listdir(directory)):
            if name != RECEIPT_FILE:
                problems.append(
                    f"{where}/{name}: in a not-computable artifact, which "
                    f"holds only its {RECEIPT_FILE}; move it out of the "
                    "repository (the gates refuse it there)"
                )
        return rows

    listed = document["dashboard"]["files"]
    for name, digest in sorted(listed.items()):
        file_where = f"{where}/{name}"
        if Path(name).name != name or name in (RECEIPT_FILE, ".."):
            problems.append(f"{where}: its receipt lists {name!r}")
            continue
        content = _read_file(directory / name, file_where, problems)
        if content is None:
            continue
        actual = sha256_bytes(content)
        if actual != digest:
            problems.append(
                f"{file_where}: does not match the digest its receipt records"
            )
            continue
        kind = TABLE_KINDS.get(name)
        if kind is None:
            reason = NO_ROW_REASONS.get(name, "no review kind for this file")
            problems.append(f"{file_where}: no row can cover it ({reason})")
            continue
        problems.extend(_no_kind_problems(file_where, content))
        rows.append(Row(file_where, kind, actual, tables_basis))

    bound = {RECEIPT_FILE, *listed}
    for name in sorted(os.listdir(directory)):
        if name not in bound:
            problems.append(
                f"{where}/{name}: in a displayed artifact, but its receipt "
                "does not bind it; move it out of the repository (the gates "
                "never read it, and an untracked file in the tree makes the "
                "next receipt dirty)"
            )
    return rows


def _parse_manifest(raw: bytes, where: str) -> m.Manifest:
    """The manifest, or a refusal naming where it is invalid (no values)."""
    try:
        return m.parse_manifest(raw, where)
    except ValidationError as error:
        raise ReviewRowsError(
            [
                f"{where}: {'.'.join(str(p) for p in item['loc'])}: "
                f"{item['msg']}"
                for item in error.errors()
            ]
        ) from None
    except ValueError as error:
        raise ReviewRowsError([f"{where}: {error}"]) from None


def planned_rows(
    *,
    staged_by: Optional[str] = None,
    data_root: Path = m.DATA_ROOT,
    root: Path = Path("."),
) -> tuple[list[Row], m.Manifest, Path]:
    """Every row the listed entries need, the manifest and the data root.

    The data root is returned as found under the resolved ``root``. Raises
    ReviewRowsError, naming every problem, if any row cannot be written.
    """
    root = Path(os.path.realpath(_absolute(root)))
    relative = _within(root, data_root)
    if relative is None or relative.parts[:1] != (PUBLIC,):
        raise ReviewRowsError(
            [f"the data root {data_root} is not under {root / PUBLIC}"]
        )
    # The artifacts directory too: the run deletes under it, and never
    # through a link.
    link = _first_link(root, relative / ARTIFACTS_DIR)
    if link is not None:
        raise ReviewRowsError([f"{link}: a symbolic link"])
    data_root = root / relative
    path = m.manifest_path(data_root)
    where = path.relative_to(root).as_posix()
    problems: list[str] = []
    raw = _read_file(path, where, problems)
    if raw is None:
        raise ReviewRowsError(problems)
    manifest = _parse_manifest(raw, where)

    listed = {
        key: entry
        for key, entry in sorted(manifest.entries().items())
        if entry.status in m.LISTED
    }
    stager = _name(staged_by)
    if not stager:
        _need_stager(listed)

    rows = [
        Row(
            where,
            MANIFEST_KIND,
            sha256_bytes(raw),
            f"Gated publication: manifest revision {manifest.revision}, the "
            "index the page reads",
        )
    ]
    problems.extend(_no_kind_problems(where, raw))
    for key, entry in listed.items():
        if entry.status == m.APPROVED:
            responsible = _name(entry.approval.by if entry.approval else "")
            if not responsible:
                problems.append(f"{key}: approved, but no approver is named")
        else:
            responsible = stager
        rows.extend(
            _entry_rows(
                key,
                entry,
                data_root=data_root,
                root=root,
                responsible=responsible,
                revision=manifest.revision,
                problems=problems,
            )
        )
    if problems:
        raise ReviewRowsError(problems)
    return rows, manifest, data_root


def _need_stager(listed: dict[str, m.Entry]) -> None:
    """Refuse when a listed entry's row must name who staged it."""
    groups = [
        f"{label} ({', '.join(keys)})"
        for label, keys in (
            (
                "provisional entries are displayed",
                [k for k, e in listed.items() if e.status == m.PROVISIONAL],
            ),
            (
                "not-computable entries are listed",
                [k for k, e in listed.items() if e.status == m.NOT_COMPUTABLE],
            ),
        )
        if keys
    ]
    if groups:
        raise ReviewRowsError(
            [
                " and ".join(groups) + "; name who staged them with "
                "--staged-by (the manifest does not record it)"
            ]
        )


def _kept_problems(
    data_root: Path, root: Path, manifest: m.Manifest
) -> list[str]:
    """Why deleting could reach what a current entry names.

    ``_unreferenced`` keeps an artifact by the path its entry spells, so
    a symbolic link on the way to it or inside it, or a spelling the disk
    doesn't use (which a case-insensitive filesystem still resolves),
    would leave its real files looking unreferenced. So would a directory
    inside it that cannot be listed, which could hide such a link. Every
    current entry counts, whatever its status.
    """
    problems = []
    for key, entry in sorted(manifest.entries().items()):
        relative = (data_root / entry.artifact).relative_to(root)
        link = _first_link(root, relative)
        if link is not None:
            problems.append(f"{link}: a symbolic link on {key}'s artifact")
            continue
        path = root
        for part in relative.parts:
            if not os.path.lexists(path / part):
                break
            if part not in os.listdir(path):
                where = (path / part).relative_to(root).as_posix()
                problems.append(
                    f"{where}: {key}'s artifact is spelled otherwise on "
                    "disk"
                )
                break
            path = path / part
        else:

            def unlisted(error: OSError, key: str = key) -> None:
                where = Path(error.filename).relative_to(root).as_posix()
                problems.append(f"{where}: {key}'s artifact cannot be listed")

            for directory, names, files in os.walk(path, onerror=unlisted):
                for name in sorted(names + files):
                    inner = Path(directory) / name
                    if inner.is_symlink():
                        problems.append(
                            f"{inner.relative_to(root).as_posix()}: a "
                            f"symbolic link in {key}'s artifact"
                        )
    return problems


def _unreferenced(data_root: Path, manifest: m.Manifest) -> list[Path]:
    """Every path under ``data_root/artifacts`` outside the artifact
    directories the manifest's current entries name, outermost first.

    A path inside a named directory is kept, and so is any path on the
    way to one, which is descended only if it is a directory and not a
    link; anything else is returned, and a directory returned is not
    descended. Symbolic links are never followed. Superseded entries do not
    count: the manifest keeps them for audit, not on disk.
    """
    artifacts = data_root / ARTIFACTS_DIR
    named = {
        Path(entry.artifact).parts for entry in manifest.entries().values()
    }
    on_the_way = {parts[:n] for parts in named for n in range(len(parts))}
    found = []

    def visit(directory: Path) -> None:
        for name in sorted(os.listdir(directory)):
            path = directory / name
            parts = path.relative_to(data_root).parts
            if any(parts[: len(kept)] == kept for kept in named):
                continue
            if parts in on_the_way:
                if path.is_dir() and not path.is_symlink():
                    visit(path)
                continue
            found.append(path)

    if artifacts.is_dir() and not artifacts.is_symlink():
        visit(artifacts)
    return found


def _delete(paths: list[Path], data_root: Path, root: Path) -> list[str]:
    """Delete each path, never following a link, and then every
    directory under ``artifacts/`` the deletions left empty. Returns what
    was deleted, by repository path, directories ending in "/"."""
    artifacts = data_root / ARTIFACTS_DIR
    deleted = []

    def where(path: Path, directory: bool) -> str:
        text = path.relative_to(root).as_posix()
        return text + "/" if directory else text

    for path in paths:
        if path.is_symlink() or not path.is_dir():
            path.unlink()
            deleted.append(where(path, False))
            continue
        for directory, names, files in os.walk(path, topdown=False):
            for name in files + names:
                file = Path(directory) / name
                if file.is_symlink() or not file.is_dir():
                    deleted.append(where(file, False))
            deleted.append(where(Path(directory), True))
        shutil.rmtree(path)
    for path in {p.parent for p in paths}:
        while path != artifacts and path.is_dir() and not os.listdir(path):
            path.rmdir()
            deleted.append(where(path, True))
            path = path.parent
    return sorted(deleted)


def read_review(path: Path) -> tuple[str, list[_Record]]:
    """The review list's header and records, each with its exact text.

    Records are split by the reader the CI check uses, so a quoted field
    holding a line break stays in its record; malformed quoting, which that
    reader would accept by guessing, is refused.
    """
    if not path.is_file():
        raise ReviewRowsError([f"{path}: no review list"])
    with path.open(newline="", encoding="utf-8") as handle:
        lines = list(handle)
    reader = csv.reader(iter(lines), strict=True)
    try:
        header = next(reader, None)
        if tuple(header or ()) != REVIEW_COLUMNS:
            raise ReviewRowsError(
                [f"{path}: columns must be {', '.join(REVIEW_COLUMNS)}"]
            )
        consumed = reader.line_num
        header_text = "".join(lines[:consumed])
        records = []
        for values in reader:
            raw = "".join(lines[consumed : reader.line_num])
            consumed = reader.line_num
            records.append(_Record(raw, values[0] if values else None))
    except csv.Error as error:
        raise ReviewRowsError(
            [f"{path}: cannot be read (line {reader.line_num}: {error})"]
        ) from None
    paths = [record.path for record in records if record.path is not None]
    twice = sorted({p for p in paths if paths.count(p) > 1})
    if twice:
        raise ReviewRowsError([f"{path}: {p} is listed twice" for p in twice])
    return header_text, records


def row_text(row: Row, reviewer: str, reviewed_on: str) -> str:
    """One row, quoted as the review list's own rows are."""
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerow(
        [row.path, row.kind, row.sha256, reviewer, reviewed_on, "", row.basis]
    )
    return buffer.getvalue()


def merge(
    header: str,
    records: list[_Record],
    rows: list[Row],
    *,
    reviewer: str,
    reviewed_on: str,
    removable,
    report: Report,
) -> str:
    """The review list with ``rows`` written in, as text.

    A row for a path already listed replaces it in place. A new row goes
    before the first kept record whose path sorts after it, so a list in
    path order stays in path order. A record whose path ``removable``
    accepts is dropped. Every other record keeps its exact text.
    """
    texts = {row.path: row_text(row, reviewer, reviewed_on) for row in rows}
    listed = {record.path for record in records}
    pending = sorted(path for path in texts if path not in listed)
    parts = [header]

    def emit(text: str) -> None:
        if not parts[-1].endswith(("\n", "\r")):
            parts.append("\n")
        parts.append(text)

    for record in records:
        if record.path is None:
            emit(record.raw)
            continue
        if record.path not in texts and removable(record.path):
            report.removed.append(record.path)
            continue
        while pending and pending[0] < record.path:
            report.added.append(pending[0])
            emit(texts[pending.pop(0)])
        if record.path in texts:
            report.replaced.append(record.path)
            if record.raw == texts[record.path]:
                report.unchanged += 1
            emit(texts[record.path])
        else:
            emit(record.raw)
    for path in pending:
        report.added.append(path)
        emit(texts[path])
    return "".join(parts)


def _write_text(path: Path, text: str) -> None:
    """Replace a file in one step, keeping its permissions."""
    mode = stat.S_IMODE(path.stat().st_mode)
    handle, temporary = tempfile.mkstemp(
        prefix=f".{path.stem}-", suffix=path.suffix, dir=path.parent
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    except BaseException:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def _unreviewed(
    data_root: Path, root: Path, manifest: m.Manifest, reviewed: set[str]
) -> list[tuple[str, str]]:
    """Files under the data root that the review list will not cover."""
    owners = {}
    for entry in [s.entry for s in manifest.superseded]:
        owners[entry.artifact] = "a superseded entry"
    for key, entry in manifest.entries().items():
        owners[entry.artifact] = f"{key} is {entry.status}"
    found = []
    for directory, _, names in os.walk(data_root):
        for name in names:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if relative in reviewed:
                continue
            artifact = Path(directory).relative_to(data_root).as_posix()
            found.append((relative, owners.get(artifact, "in no entry")))
    return sorted(found)


def review_rows(
    *,
    reviewer: str,
    staged_by: Optional[str] = None,
    on: Optional[str] = None,
    data_root: Path = m.DATA_ROOT,
    review_csv: Path = REVIEW_CSV,
) -> Report:
    """Write the review rows the manifest's listed entries need, after
    deleting the artifacts no current entry names.

    The repository root is the review list's grandparent
    (``<root>/data_inputs/public_data_review.csv``, where both disclosure
    checks read it), and the data root must be under its ``public/``.
    Raises ReviewRowsError, and writes and deletes nothing, if any row
    cannot be written, or if deleting could reach what a current entry
    names (``_kept_problems``).
    """
    started = time.perf_counter()
    name = _name(reviewer)
    if not name:
        raise ReviewRowsError(["--reviewer must name a person"])
    reviewed_on = _review_date(on)
    review_csv = _absolute(review_csv)
    root = Path(os.path.realpath(review_csv.parent.parent))
    header, records = read_review(review_csv)
    rows, manifest, data_root = planned_rows(
        staged_by=staged_by, data_root=data_root, root=root
    )
    report = Report(revision=manifest.revision)
    # Only once every row is planned: a refusal deletes nothing.
    problems = _kept_problems(data_root, root, manifest)
    if problems:
        raise ReviewRowsError(problems)
    report.deleted = _delete(
        _unreferenced(data_root, manifest), data_root, root
    )

    prefix = (data_root / ARTIFACTS_DIR).relative_to(root).as_posix() + "/"

    def removable(path: str) -> bool:
        return path.startswith(prefix) and not os.path.lexists(root / path)

    text = merge(
        header,
        records,
        rows,
        reviewer=name,
        reviewed_on=reviewed_on,
        removable=removable,
        report=report,
    )
    if text != review_csv.read_text(encoding="utf-8", newline=""):
        _write_text(review_csv, text)
    kept = {r.path for r in records if r.path not in report.removed}
    report.unreviewed = _unreviewed(
        data_root, root, manifest, kept | {row.path for row in rows}
    )
    report.elapsed = time.perf_counter() - started
    return report
