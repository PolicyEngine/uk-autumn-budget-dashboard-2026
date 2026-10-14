#!/usr/bin/env python
"""Check that every tracked file under public/data may be published.

This repository is public, and the dashboard serves public/data, so every
file there is a publication. The UK figures derive from UKDS-licensed survey
microdata, and the licence binds every published number.

A file under public/data passes when it is either:

- a disclosure-controlled table written by ``policyengine.disclosure``, which
  ``validate_public`` checks file by file; or
- listed in data_inputs/public_data_review.csv after a person reviewed it.
  A reviewed CSV keeps the header it was reviewed with.

Two guards cover every tracked file, wherever it sits:

- a file may not carry more than a few constituency, local-authority or
  small-area codes, unless it is a validated table, reviewed reference
  geography, or a reference input under data_inputs/;
- a CSV under public/ may not carry record-level columns.

A review entry of kind ``pending`` names who decides and why. It is reported
on every run but does not fail, so a file that awaits someone's decision stays
visible without blocking unrelated work.

The check needs no key, no microdata and no network, so it runs on every pull
request, forks included. It prints file paths and rule names, never values.

Usage:
    python scripts/check_public_data.py [--root PATH]
"""

import argparse
import csv
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Importing policyengine would otherwise import every installed country
# model. The disclosure package imports nothing from them.
os.environ.setdefault("POLICYENGINE_SKIP_COUNTRY_IMPORTS", "1")

from policyengine.disclosure import validate_public  # noqa: E402
from policyengine.disclosure.schema import PUBLIC_COLUMNS  # noqa: E402

PUBLIC_DATA = "public/data/"
REVIEW_FILE = "data_inputs/public_data_review.csv"
REVIEW_COLUMNS = ("path", "kind", "header", "reviewer", "reviewed_on", "basis")
PENDING = "pending"
REFERENCE_GEOGRAPHY = "reference_geography"
KINDS = (
    "national_table",
    "synthetic_household",
    REFERENCE_GEOGRAPHY,
    "static_asset",
    PENDING,
)
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
RECORD_LEVEL_COLUMNS = frozenset(
    {
        "household_id",
        "household_weight",
        "benunit_id",
        "benunit_weight",
        "person_id",
        "person_weight",
    }
)


@dataclass(frozen=True)
class ReviewEntry:
    path: str
    kind: str
    header: str
    reviewer: str
    reviewed_on: str
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
            entry = ReviewEntry(**{key: row[key] for key in REVIEW_COLUMNS})
            if entry.kind not in KINDS:
                problems.append(f"{where}: unknown kind")
                continue
            if not entry.reviewer or not entry.basis:
                problems.append(f"{where}: a reviewer and a basis are needed")
                continue
            if entry.kind != PENDING and not entry.reviewed_on:
                problems.append(f"{where}: the review date is missing")
                continue
            if entry.path in entries:
                problems.append(f"{where}: {entry.path} is listed twice")
                continue
            entries[entry.path] = entry
    return entries, problems


def csv_header(path: Path) -> Optional[list[str]]:
    """The header of a CSV file, or None if it has none."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return next(csv.reader(handle), None)


def is_binary(path: Path) -> bool:
    with path.open("rb") as handle:
        return b"\0" in handle.read(8192)


def check_public_data_file(
    root: Path, name: str, entry: Optional[ReviewEntry], report: Report
) -> bool:
    """Check one file under public/data. Returns whether it is a validated
    disclosure table."""
    path = root / name
    header = csv_header(path) if path.suffix == ".csv" else None
    if entry is not None:
        if header is not None and entry.header:
            if ",".join(header) != entry.header:
                report.problems.append(
                    f"{name}: header differs from the reviewed one"
                )
        return False
    if header is not None and set(PUBLIC_COLUMNS) <= set(header):
        for problem in validate_public(path):
            # The validator labels problems with the file's base name.
            report.problems.append(
                name + problem[len(path.name) :]
                if problem.startswith(path.name)
                else f"{name}: {problem}"
            )
        return True
    report.problems.append(f"{name}: not a disclosure table and not reviewed")
    return False


def check(root: Path) -> Report:
    """Run every check on the repository at ``root``."""
    report = Report()
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
        entry = review.get(name)
        if entry is not None and entry.kind == PENDING:
            report.pending.append(
                f"{name}: pending ({entry.reviewer}): {entry.basis}"
            )
            continue

        validated = False
        if name.startswith(PUBLIC_DATA):
            validated = check_public_data_file(root, name, entry, report)

        if name.startswith("public/") and path.suffix == ".csv":
            header = csv_header(path) or []
            if RECORD_LEVEL_COLUMNS & set(header):
                report.problems.append(f"{name}: record-level columns")

        allowed = (
            validated
            or (entry is not None and entry.kind == REFERENCE_GEOGRAPHY)
            or name.startswith(AREA_CODES_ALLOWED_UNDER)
        )
        if not allowed and not is_binary(path):
            codes = set(AREA_CODE.findall(path.read_bytes()))
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
