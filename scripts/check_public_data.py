#!/usr/bin/env python
"""Check that every tracked file under public/ may be published.

This repository is public, and the dashboard serves public/, so every file
there is a publication. The UK figures derive from UKDS-licensed survey
microdata, and the licence binds every published number.

Every file under public/ must be listed in data_inputs/public_data_review.csv
with the sha256 of the exact bytes a person reviewed; any change fails until
it is reviewed again. A table shaped as the disclosure layer's (a CSV with its
public columns) must also pass ``validate_public``, and is reviewed as kind
``disclosure_table``: neither check can tell a release the layer resolved from
a file written any other way, so a person signs off the bytes too.

A review entry of kind ``pending`` names who decides and by when. Until its
expiry date, at most 14 days after it was added, it is reported without
failing; from then on it fails.

One file takes no review entry: the page's area routing status
(public/data/area-routing.json, from uk_budget_data.area_routing). It says
only whether the installed bundle routes results by area, so its bytes can
be one of a few fixed texts, reviewed here once; any other text fails. A
bundle adoption that changes the routing regenerates it without a new review.
A review entry for it fails too, since nothing would read it.

The record-level guard covers every public file, and no review entry turns
it off: a public file may not carry household, benefit unit or person ids or
weights. The area-code guard covers every tracked file: no file may carry
more than a few constituency, local-authority or small-area codes, unless it
is a validated table, reviewed reference geography, a pending file before
its expiry, or a reference input under data_inputs/.

The check needs no key, no microdata and no network, so it runs on every pull
request, forks included. It prints file paths and rule names, never values.
The build runs a smaller check against the same review list
(scripts/check-public-files.mjs), so a deploy that skips CI still fails.

Usage:
    python scripts/check_public_data.py [--root PATH]
"""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# Importing policyengine would otherwise import every installed country
# model. The disclosure package imports nothing from them.
os.environ.setdefault("POLICYENGINE_SKIP_COUNTRY_IMPORTS", "1")

from policyengine.disclosure import validate_public  # noqa: E402
from policyengine.disclosure.schema import PUBLIC_COLUMNS  # noqa: E402

PUBLIC = "public/"
REVIEW_FILE = "data_inputs/public_data_review.csv"
REVIEW_COLUMNS = (
    "path",
    "kind",
    "sha256",
    "reviewer",
    "reviewed_on",
    "expires_on",
    "basis",
)
PENDING = "pending"
REFERENCE_GEOGRAPHY = "reference_geography"
DISCLOSURE_TABLE = "disclosure_table"
KINDS = (
    DISCLOSURE_TABLE,
    "national_table",
    "synthetic_household",
    REFERENCE_GEOGRAPHY,
    "static_asset",
    PENDING,
)
MAX_PENDING_DAYS = 14
AREA_ROUTING_FILE = "public/data/area-routing.json"
# Every text uk_budget_data.area_routing writes: whether the area views are
# available, and the bundle's routing kind (tests/test_area_routing.py).
AREA_ROUTING_CONTENTS = frozenset(
    (
        json.dumps(
            {"area_views": views, "regional_release_kind": kind},
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode()
    for views, kind in (
        ("available", "local_area"),
        ("available", "area_coded_national"),
        ("not_available", None),
        ("not_available", "local_area"),
        ("not_available", "area_coded_national"),
    )
)
SHA256 = re.compile(r"[0-9a-f]{64}")
# Reference inputs, such as the constituency lookup, carry area codes by
# design and are never served.
AREA_CODES_ALLOWED_UNDER = ("data_inputs/",)
# GSS codes of Westminster constituencies, local authorities, wards and
# small areas (MSOAs, LSOAs, output areas and their Scottish and Northern
# Irish equivalents).
AREA_CODE = re.compile(
    rb"\b(?:E14|W07|S14|N05|E06|E07|E08|E09|W06|S12|N09|E05|W05|S13|N08"
    rb"|E02|W02|S02|E01|W01|S01|E00|W00|S00|N00|N20|N21)\d{6}\b"
)
# A few codes appear in tests and examples; a table by area carries many.
MAX_AREA_CODES = 20
# Identifiers and weights of single records, as CSV columns, JSON keys or
# anything else.
RECORD_LEVEL = re.compile(rb"\b(?:household|benunit|person)_(?:id|weight)\b")


@dataclass(frozen=True)
class ReviewEntry:
    path: str
    kind: str
    sha256: str
    reviewer: str
    reviewed_on: date
    expires_on: Optional[date]
    basis: str


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)


def tracked_files(root: Path) -> list[str]:
    """The files git tracks under ``root``, as POSIX paths relative to it."""
    output = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return sorted(name for name in output.decode().split("\0") if name)


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parse_date(value: str) -> Optional[date]:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def read_review(root: Path) -> tuple[dict[str, ReviewEntry], list[str]]:
    """The review entries by path, and any problems with the file itself."""
    path = root / REVIEW_FILE
    if not path.is_file():
        return {}, [f"{REVIEW_FILE}: missing"]
    problems: list[str] = []
    entries: dict[str, ReviewEntry] = {}
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != REVIEW_COLUMNS:
            return {}, [f"{REVIEW_FILE}: columns must be {REVIEW_COLUMNS}"]
        for number, row in enumerate(reader, start=2):
            where = f"{REVIEW_FILE}: row {number}"
            reviewed_on = _parse_date(row["reviewed_on"])
            expires_on = _parse_date(row["expires_on"])
            if row["kind"] not in KINDS:
                problems.append(f"{where}: unknown kind")
            elif not row["path"].startswith(PUBLIC):
                problems.append(
                    f"{where}: only files under public/ are reviewed"
                )
            elif not SHA256.fullmatch(row["sha256"]):
                problems.append(f"{where}: the sha256 is missing or malformed")
            elif not row["reviewer"] or not row["basis"]:
                problems.append(f"{where}: a reviewer and a basis are needed")
            elif reviewed_on is None:
                problems.append(f"{where}: the review date is missing")
            elif row["kind"] == PENDING and (
                expires_on is None
                or not reviewed_on
                <= expires_on
                <= reviewed_on + timedelta(days=MAX_PENDING_DAYS)
            ):
                problems.append(
                    f"{where}: a pending entry needs an expiry date within "
                    f"{MAX_PENDING_DAYS} days of its review date"
                )
            elif row["kind"] != PENDING and row["expires_on"]:
                problems.append(f"{where}: only a pending entry expires")
            elif row["path"] in entries:
                problems.append(f"{where}: {row['path']} is listed twice")
            else:
                entries[row["path"]] = ReviewEntry(
                    path=row["path"],
                    kind=row["kind"],
                    sha256=row["sha256"],
                    reviewer=row["reviewer"],
                    reviewed_on=reviewed_on,
                    expires_on=expires_on,
                    basis=row["basis"],
                )
    return entries, problems


def csv_header(data: bytes) -> Optional[list[str]]:
    """The header of a CSV file, or None if it has none."""
    text = data.decode("utf-8-sig", errors="replace")
    return next(csv.reader(io.StringIO(text)), None)


def is_binary(data: bytes) -> bool:
    return b"\0" in data[:8192]


def is_layer_table(name: str, data: bytes) -> bool:
    """Whether a file is shaped as a table from the disclosure layer."""
    if not name.endswith(".csv"):
        return False
    header = csv_header(data) or []
    return set(PUBLIC_COLUMNS) <= set(header)


def validate_layer_table(path: Path, name: str, report: Report) -> None:
    for problem in validate_public(path):
        # The validator labels problems with the file's base name.
        report.problems.append(
            name + problem[len(path.name) :]
            if problem.startswith(path.name)
            else f"{name}: {problem}"
        )


def check(root: Path, today: Optional[date] = None) -> Report:
    """Run every check on the repository at ``root``."""
    today = today or datetime.now(timezone.utc).date()
    report = Report()
    from uk_budget_data.publication.release_index import (
        manifest_identity_problems,
        release_index_problems,
    )

    # A manifest must name this Budget; flat view files must be bound to it
    report.problems.extend(
        manifest_identity_problems(root / "public" / "data")
    )
    report.problems.extend(release_index_problems(root / "public" / "data"))
    files = tracked_files(root)
    review, problems = read_review(root)
    report.problems.extend(problems)
    for name in sorted(set(review) - set(files)):
        report.problems.append(f"{name}: reviewed, but not tracked")

    for name in files:
        path = root / name
        if path.is_symlink():
            report.problems.append(f"{name}: symbolic link")
            continue
        if not path.is_file():
            continue
        data = path.read_bytes()
        binary = is_binary(data)
        area_codes_allowed = name.startswith(AREA_CODES_ALLOWED_UNDER)

        if name.startswith(PUBLIC):
            if not binary and RECORD_LEVEL.search(data):
                report.problems.append(f"{name}: record-level identifiers")
            layer = is_layer_table(name, data)
            if layer:
                validate_layer_table(path, name, report)
                area_codes_allowed = True
            entry = review.get(name)
            if name == AREA_ROUTING_FILE:
                if data not in AREA_ROUTING_CONTENTS:
                    report.problems.append(
                        f"{name}: not an area routing status"
                    )
                if entry is not None:
                    report.problems.append(f"{name}: needs no review entry")
            elif entry is None:
                report.problems.append(
                    f"{name}: a disclosure table, not reviewed"
                    if layer
                    else f"{name}: not a disclosure table and not reviewed"
                )
            elif (entry.kind == DISCLOSURE_TABLE) != layer:
                report.problems.append(
                    f"{name}: reviewed as {entry.kind}, but "
                    + ("it is" if layer else "it is not")
                    + " a disclosure table"
                )
            elif sha256_of(data) != entry.sha256:
                report.problems.append(f"{name}: changed since its review")
            elif entry.kind == PENDING:
                if today > entry.expires_on:
                    report.problems.append(
                        f"{name}: pending past its expiry date "
                        f"({entry.expires_on.isoformat()})"
                    )
                else:
                    report.pending.append(
                        f"{name}: pending until "
                        f"{entry.expires_on.isoformat()} "
                        f"({entry.reviewer}): {entry.basis}"
                    )
                    area_codes_allowed = True
            elif entry.kind == REFERENCE_GEOGRAPHY:
                area_codes_allowed = True

        if not area_codes_allowed and not binary:
            codes = set(AREA_CODE.findall(data))
            if len(codes) > MAX_AREA_CODES:
                report.problems.append(
                    f"{name}: carries more than {MAX_AREA_CODES} area codes"
                )
    return report


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repository root (default: this script's repository)",
    )
    arguments = parser.parse_args(argv)
    report = check(arguments.root.resolve())
    for problem in report.problems:
        print(problem)
    for item in report.pending:
        print(item)
    print(
        f"{len(report.problems)} problem(s), "
        f"{len(report.pending)} file(s) pending a decision."
    )
    return 1 if report.problems else 0


if __name__ == "__main__":
    sys.exit(main())
