#!/usr/bin/env python3
"""Before/after map check: compare two published tables of results by area.

When the data or the model behind the map changes, this compares the table
the page publishes today (old) with the regenerated one (new), measure by
measure and year by year, and writes a short Markdown report:

- how many constituencies have a figure, and how many are not published;
- how far each constituency's figure moves, and whether the new figure
  falls outside the old 90% interval;
- which constituencies change colour on the map (the page's own rule,
  src/utils/geography/classify.js, ported below);
- the constituencies that move most;
- the map against the national figure: the mean of the constituency
  figures beside the national average change per household, before and
  after.

It reads files the regeneration writes and runs no model. From each
``public/data`` folder it reads ``constituency.csv``, the manifest and the
area provenance (to find each measure's national tables) and those tables'
``winners_losers.csv``. The old folder can be a git ref, read with
``git show``. It needs the standard library only, so plain ``python3``
runs it.

Every figure in the report comes from a row of those public files. The
script refuses a table that carries a private-audit column.

One thing it cannot give from public files: the local-area file's own
national total. The public table has no household counts and leaves out
the constituencies it does not publish, so the mean of the map is not that
total. ``--households`` weights the mean by a household count you supply.
``--local-uk-audit`` reads the UK-level rows, and only those, of a private
``disclosure_audit.csv`` and prints the local-area file's national average
beside the national file's on the terminal, never in the report.

Usage, from the repository root on the branch that holds the new tables:

    python3 scripts/map_check.py --old-ref origin/main \\
        --report /tmp/map-check.md --details /tmp/map-check.csv
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import json
import os
import statistics
import subprocess
import sys
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parent.parent
DATA_PREFIX = "public/data"
TABLE = "constituency.csv"
MANIFEST = "manifest.json"
PROVENANCE = "area_provenance.json"
NATIONAL_TABLE = "winners_losers.csv"
NATIONAL_ROW = "all"

# The columns a public table needs for this check, and the private audit's
# columns (policyengine.disclosure.schema: PUBLIC_COLUMNS, AUDIT_COLUMNS).
REQUIRED_COLUMNS = (
    "level",
    "area_code",
    "reform",
    "year",
    "outcome",
    "value",
    "lo",
    "hi",
    "tier",
)
AUDIT_COLUMNS = (
    "family",
    "exact_value",
    "exact_lo",
    "exact_hi",
    "standard_error",
    "rounding_base",
    "n_sources",
    "n_eff",
    "top_share",
    "rest_share",
    "private_reason",
)
WITHHELD = "withheld"
AVERAGE_CHANGE = "average_change"
RELATIVE_CHANGE = "relative_change"
OUTCOMES = (AVERAGE_CHANGE, RELATIVE_CHANGE)
NATIONAL_LEVEL = "national"

# The map's categories: src/utils/geography/classify.js. The shared cases
# in src/test/fixtures/geography/classify_cases.json hold the two to the
# same answers (tests/test_map_check.py and classifyCases.test.js).
CATEGORY_BREAKS = {
    RELATIVE_CHANGE: (Decimal("0.001"), Decimal("0.01")),
    AVERAGE_CHANGE: (Decimal("10"), Decimal("100")),
}
CATEGORIES = (
    "large_loss",
    "small_loss",
    "little_change",
    "small_gain",
    "large_gain",
)
TOO_UNCERTAIN = "too_uncertain"
NOT_PUBLISHED = "not_published"
ABSENT = "absent"
SHOWN_LABELS = {
    "large_loss": "large loss",
    "small_loss": "small loss",
    "little_change": "little change",
    "small_gain": "small gain",
    "large_gain": "large gain",
    TOO_UNCERTAIN: "too uncertain",
    NOT_PUBLISHED: "not published",
    ABSENT: "no row",
}


class MapCheckError(Exception):
    """An input this check cannot read or must refuse."""


# -- where the files come from ------------------------------------------------


class DirectorySource:
    """A ``public/data`` folder on disk."""

    def __init__(self, root: Path, repo: Optional[Path] = None) -> None:
        self.root = Path(root)
        self.label = str(root)
        if repo is not None:
            # Inside the repository, name the folder from its root, so a
            # pasted report shows no path of the machine it ran on.
            with contextlib.suppress(ValueError):
                relative = self.root.resolve().relative_to(repo.resolve())
                self.label = f"{relative} in the checkout"

    def describe(self) -> str:
        return f"`{self.label}`"

    def read(self, relative: str) -> Optional[bytes]:
        path = self.root / relative
        return path.read_bytes() if path.is_file() else None


class GitSource:
    """The ``public/data`` folder of a git ref, read with ``git show``."""

    def __init__(self, repo: Path, ref: str) -> None:
        self.repo = Path(repo)
        self.ref = ref
        self.label = f"{ref}:{DATA_PREFIX}"

    def _git(self, *arguments: str) -> Optional[bytes]:
        # Without git's own variables, so --repo decides the repository
        # even when this runs from a hook.
        environment = {
            name: value
            for name, value in os.environ.items()
            if not name.startswith("GIT_")
        }
        done = subprocess.run(
            ["git", "-C", str(self.repo), *arguments],
            capture_output=True,
            check=False,
            env=environment,
        )
        return done.stdout if done.returncode == 0 else None

    def describe(self) -> str:
        """The ref with the commit it names now, since a branch moves."""
        commit = self._git("rev-parse", "--short=8", f"{self.ref}^{{commit}}")
        if commit is None:
            return f"`{self.label}`"
        return f"`{self.label}` at `{commit.decode().strip()}`"

    def read(self, relative: str) -> Optional[bytes]:
        return self._git("show", f"{self.ref}:{DATA_PREFIX}/{relative}")


# -- the public table ---------------------------------------------------------


@dataclass(frozen=True)
class Row:
    """One public row: a figure with its interval, or a withheld cell."""

    level: str
    area_code: str
    area_name: str
    reform: str
    year: int
    outcome: str
    tier: str
    value: Optional[Decimal]
    lo: Optional[Decimal]
    hi: Optional[Decimal]

    @property
    def published(self) -> bool:
        return self.value is not None


Group = tuple[str, str, int, str]  # level, reform, year, outcome


def _year(text: Optional[str], what: str) -> int:
    try:
        return int(text or "")
    except ValueError:
        raise MapCheckError(f"{what}: year is not a whole number") from None


def _decimal(text: str, what: str) -> Decimal:
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise MapCheckError(f"{what} is not a number") from None
    if not number.is_finite():
        raise MapCheckError(f"{what} is not finite")
    return number


def load_table(data: bytes, label: str) -> dict[Group, dict[str, Row]]:
    """Read a public table of results by area into rows by group and area.

    Raises:
        MapCheckError: If the table carries a private-audit column, lacks a
            public column, repeats a row, or a row is malformed.
    """
    reader = csv.DictReader(io.StringIO(data.decode("utf-8")))
    columns = set(reader.fieldnames or ())
    leaked = sorted(columns & set(AUDIT_COLUMNS))
    if leaked:
        raise MapCheckError(
            f"{label} carries private-audit columns {leaked}: this check "
            "reads public tables only"
        )
    missing = [name for name in REQUIRED_COLUMNS if name not in columns]
    if missing:
        raise MapCheckError(f"{label} lacks the columns {missing}")
    table: dict[Group, dict[str, Row]] = {}
    for number, record in enumerate(reader, start=2):
        where = f"{label} line {number}"
        outcome = record["outcome"]
        if outcome not in OUTCOMES:
            raise MapCheckError(f"{where}: unknown outcome {outcome!r}")
        year = _year(record["year"], where)
        tier = record["tier"]
        figures = [record["value"], record["lo"], record["hi"]]
        if tier == WITHHELD:
            if any(text != "" for text in figures):
                raise MapCheckError(f"{where}: a withheld row has a figure")
            value = lo = hi = None
        else:
            value, lo, hi = (
                _decimal(text, f"{where}: {name}")
                for name, text in zip(("value", "lo", "hi"), figures)
            )
        row = Row(
            level=record["level"],
            area_code=record["area_code"],
            area_name=record.get("area_name") or record["area_code"],
            reform=record["reform"],
            year=year,
            outcome=outcome,
            tier=tier,
            value=value,
            lo=lo,
            hi=hi,
        )
        areas = table.setdefault(
            (row.level, row.reform, row.year, row.outcome), {}
        )
        if row.area_code in areas:
            raise MapCheckError(f"{where}: the row repeats an earlier one")
        areas[row.area_code] = row
    if not table:
        raise MapCheckError(f"{label} has no rows")
    return table


# -- the map's colour rule ----------------------------------------------------


def category_index(outcome: str, value: Decimal) -> int:
    """The position in CATEGORIES of one figure (classify.js categoryIndex)."""
    small, large = CATEGORY_BREAKS[outcome]
    magnitude = abs(value)
    if magnitude < small:
        return 2
    is_large = magnitude >= large
    if value > 0:
        return 4 if is_large else 3
    return 0 if is_large else 1


def classify(row: Optional[Row]) -> Optional[str]:
    """The map category of a row (classify.js classifyRow): one of
    CATEGORIES, TOO_UNCERTAIN, or None for a withheld or missing row."""
    if row is None or row.tier == WITHHELD:
        return None
    low = category_index(row.outcome, row.lo)
    high = category_index(row.outcome, row.hi)
    if high - low > 1:
        return TOO_UNCERTAIN
    return CATEGORIES[category_index(row.outcome, row.value)]


def shown(row: Optional[Row]) -> str:
    """What the map shows for a row: a category, or why it has none."""
    if row is None:
        return ABSENT
    return classify(row) or NOT_PUBLISHED


# -- the national figure ------------------------------------------------------


@dataclass
class National:
    """Each measure's name and national average change per household."""

    names: dict[str, str] = field(default_factory=dict)
    averages: dict[tuple[str, int], Optional[Decimal]] = field(
        default_factory=dict
    )
    order: list[str] = field(default_factory=list)


def _json(source, relative: str) -> dict:
    data = source.read(relative)
    if data is None:
        return {}
    try:
        document = json.loads(data)
    except json.JSONDecodeError:
        raise MapCheckError(f"{source.label}/{relative} is not JSON") from None
    return document if isinstance(document, dict) else {}


def load_national(source) -> National:
    """Read each mapped measure's national average change per household.

    The area provenance names the national artifact each map measure was
    checked against; the manifest names the rest. The figure is the
    ``all`` row of that artifact's ``winners_losers.csv``: the weighted
    mean change in household net income over households in an income
    decile. A blank cell (withheld) reads as None.
    """
    national = National()
    measures = _json(source, MANIFEST).get("measures")
    bound = _json(source, PROVENANCE).get("reforms")
    # A section of another shape names no artifact; the report then shows
    # n/a for the national figures instead of stopping.
    measures = measures if isinstance(measures, dict) else {}
    bound = bound if isinstance(bound, dict) else {}
    artifacts: dict[str, str] = {}
    for reform, entry in measures.items():
        national.order.append(reform)
        if isinstance(entry, dict):
            if entry.get("name"):
                national.names[reform] = str(entry["name"])
            if entry.get("artifact"):
                artifacts[reform] = str(entry["artifact"])
    for reform, entry in bound.items():
        if isinstance(entry, dict) and entry.get("artifact"):
            artifacts[reform] = str(entry["artifact"])
    for reform, artifact in artifacts.items():
        data = source.read(f"{artifact}/{NATIONAL_TABLE}")
        if data is None:
            continue
        for record in csv.DictReader(io.StringIO(data.decode("utf-8"))):
            if record.get("decile") != NATIONAL_ROW:
                continue
            where = f"{source.label}/{artifact}/{NATIONAL_TABLE}"
            text = record.get("avg_change") or ""
            national.averages[(reform, _year(record.get("year"), where))] = (
                _decimal(text, where) if text else None
            )
    return national


def load_households(path: Path) -> dict[str, Decimal]:
    """Household counts by area from a CSV with ``area_code,households``."""
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or ())
        if not {"area_code", "households"} <= columns:
            raise MapCheckError(
                f"{path} needs the columns area_code and households"
            )
        weights = {}
        for record in reader:
            count = _decimal(record["households"], f"{path}: households")
            if count <= 0:
                raise MapCheckError(f"{path}: households must be positive")
            weights[record["area_code"]] = count
    return weights


def load_local_uk(path: Path) -> dict[tuple[str, int], Decimal]:
    """The local-area file's UK-level average change, from a private audit.

    Reads ``disclosure_audit.csv`` and keeps the national level's
    ``average_change`` rows only: one exact figure per measure and year,
    each an aggregate over every household in the file. No area row is
    read.
    """
    figures = {}
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        needed = {"level", "reform", "year", "outcome", "exact_value"}
        if not needed <= set(reader.fieldnames or ()):
            raise MapCheckError(
                f"{path} is not a disclosure audit: it lacks {sorted(needed)}"
            )
        for record in reader:
            if record["level"] != NATIONAL_LEVEL:
                continue
            if record["outcome"] != AVERAGE_CHANGE:
                continue
            year = _year(record["year"], str(path))
            figures[(record["reform"], year)] = _decimal(
                record["exact_value"], f"{path}: exact_value"
            )
    if not figures:
        raise MapCheckError(f"{path} has no UK-level average change rows")
    return figures


# -- the comparison -----------------------------------------------------------


@dataclass(frozen=True)
class Move:
    """One area in one group: its old and new rows and what changed."""

    area_code: str
    area_name: str
    old: Optional[Row]
    new: Optional[Row]

    @property
    def both_published(self) -> bool:
        return bool(
            self.old and self.new and self.old.published and self.new.published
        )

    @property
    def change(self) -> Optional[Decimal]:
        if not self.both_published:
            return None
        return self.new.value - self.old.value

    @property
    def outside_old_interval(self) -> bool:
        """Whether the new figure lies outside the old 90% interval."""
        if not self.both_published:
            return False
        return not self.old.lo <= self.new.value <= self.old.hi

    @property
    def shown_old(self) -> str:
        return shown(self.old)

    @property
    def shown_new(self) -> str:
        return shown(self.new)

    @property
    def colour_changed(self) -> bool:
        return self.shown_old != self.shown_new


def _mean(
    rows: Sequence[Row], weights: Optional[Mapping[str, Decimal]]
) -> Optional[Decimal]:
    """The mean of the rows' figures: simple, or weighted by households."""
    if not rows:
        return None
    if weights is None:
        return sum(row.value for row in rows) / len(rows)
    unknown = sorted(r.area_code for r in rows if r.area_code not in weights)
    if unknown:
        raise MapCheckError(
            f"the households file has no count for {unknown[:5]}"
            + (f" and {len(unknown) - 5} more" if len(unknown) > 5 else "")
        )
    total = sum(weights[row.area_code] for row in rows)
    return sum(weights[row.area_code] * row.value for row in rows) / total


@dataclass
class Comparison:
    """One measure, year and outcome: every area's move and the summary."""

    level: str
    reform: str
    year: int
    outcome: str
    moves: list[Move]
    mean_old: Optional[Decimal] = None
    mean_new: Optional[Decimal] = None
    mean_old_both: Optional[Decimal] = None
    mean_new_both: Optional[Decimal] = None

    def _count(self, side: str, published: bool) -> int:
        rows = [getattr(move, side) for move in self.moves]
        return sum(
            1 for r in rows if r is not None and r.published is published
        )

    @property
    def published_old(self) -> int:
        return self._count("old", True)

    @property
    def published_new(self) -> int:
        return self._count("new", True)

    @property
    def withheld_old(self) -> int:
        return self._count("old", False)

    @property
    def withheld_new(self) -> int:
        return self._count("new", False)

    @property
    def both(self) -> list[Move]:
        return [move for move in self.moves if move.both_published]

    @property
    def moved(self) -> int:
        return sum(1 for move in self.both if move.change != 0)

    @property
    def outside(self) -> int:
        return sum(1 for move in self.moves if move.outside_old_interval)

    @property
    def colour_changes(self) -> int:
        return sum(1 for move in self.moves if move.colour_changed)

    @property
    def colour_transitions(self) -> Counter:
        return Counter(
            (move.shown_old, move.shown_new)
            for move in self.moves
            if move.colour_changed
        )

    @property
    def median_move(self) -> Optional[Decimal]:
        sizes = [abs(move.change) for move in self.both]
        return statistics.median(sizes) if sizes else None

    @property
    def largest_move(self) -> Optional[Decimal]:
        sizes = [abs(move.change) for move in self.both]
        return max(sizes) if sizes else None

    @property
    def silent(self) -> bool:
        """Nothing to report: every row either table holds reads zero."""
        rows = [r for m in self.moves for r in (m.old, m.new) if r]
        return all(r.value == 0 for r in rows)


def compare(
    old: Mapping[Group, Mapping[str, Row]],
    new: Mapping[Group, Mapping[str, Row]],
    *,
    weights: Optional[Mapping[str, Decimal]] = None,
) -> list[Comparison]:
    """Compare two tables group by group, over the areas of either."""
    comparisons = []
    for group in sorted(set(old) | set(new)):
        before, after = old.get(group, {}), new.get(group, {})
        moves = []
        for code in sorted(set(before) | set(after)):
            o, n = before.get(code), after.get(code)
            name = (n or o).area_name
            moves.append(Move(code, name, o, n))
        comparison = Comparison(*group, moves=moves)
        published_old = [m.old for m in moves if m.old and m.old.published]
        published_new = [m.new for m in moves if m.new and m.new.published]
        comparison.mean_old = _mean(published_old, weights)
        comparison.mean_new = _mean(published_new, weights)
        both = comparison.both
        comparison.mean_old_both = _mean([m.old for m in both], weights)
        comparison.mean_new_both = _mean([m.new for m in both], weights)
        comparisons.append(comparison)
    return comparisons


def relative_move(
    old: Optional[Decimal], new: Optional[Decimal]
) -> Optional[Decimal]:
    """``new / old - 1``, or None where old is zero or either is missing."""
    if old is None or new is None or old == 0:
        return None
    return new / old - 1


def map_against_national(
    comparison: Comparison,
    national_old: Optional[Decimal],
    national_new: Optional[Decimal],
) -> Optional[Decimal]:
    """How far the map moved beyond the national figure.

    Over the areas with a figure in both tables, the ratio of the new mean
    to the old one, divided by the same ratio of the national average,
    less 1. Zero means the map moved in step with the national figure.
    None where a ratio is undefined or a mean changes sign.
    """
    areas = relative_move(comparison.mean_old_both, comparison.mean_new_both)
    nation = relative_move(national_old, national_new)
    if areas is None or nation is None:
        return None
    if areas <= -1 or nation <= -1:
        return None
    return (1 + areas) / (1 + nation) - 1


# -- the report ---------------------------------------------------------------


def year_label(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


def _plain(number: Decimal) -> str:
    text = format(number.normalize(), "f")
    return "0" if text in ("-0", "0") else text


def figure(outcome: str, number: Optional[Decimal], places: int = 1) -> str:
    """A figure in its outcome's units: pounds a year, or % of income."""
    if number is None:
        return "n/a"
    if outcome == RELATIVE_CHANGE:
        shifted = (number * 100).quantize(Decimal(1).scaleb(-(places + 2)))
        return f"{_plain(shifted)}%"
    rounded = number.quantize(Decimal(1).scaleb(-places))
    text = _plain(abs(rounded))
    return f"-£{text}" if rounded < 0 and text != "0" else f"£{text}"


def percent(number: Optional[Decimal]) -> str:
    if number is None:
        return "n/a"
    rounded = (number * 100).quantize(Decimal("0.1"))
    return f"{'+' if rounded > 0 else ''}{_plain(rounded)}%"


def _interval(row: Optional[Row]) -> str:
    if row is None:
        return "no row"
    if not row.published:
        return "not published"
    return (
        f"{figure(row.outcome, row.value, 4)} "
        f"({figure(row.outcome, row.lo, 4)} to "
        f"{figure(row.outcome, row.hi, 4)})"
    )


def _table(header: Sequence[str], rows: Iterable[Sequence[str]]) -> list[str]:
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join(["---"] + ["---:"] * (len(header) - 1)) + "|",
    ]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return lines


def _ordered(
    comparisons: Sequence[Comparison], order: Sequence[str]
) -> list[Comparison]:
    rank = {reform: index for index, reform in enumerate(dict.fromkeys(order))}
    return sorted(
        comparisons,
        key=lambda c: (rank.get(c.reform, len(rank)), c.reform, c.year),
    )


def top_movers(comparisons: Sequence[Comparison], top: int) -> list[Move]:
    """The areas of one measure that move most, each at the year of its
    largest move; ties go to the earlier year, then the area code."""
    best: dict[str, tuple[Decimal, int, Move]] = {}
    for comparison in sorted(comparisons, key=lambda c: c.year):
        for move in comparison.both:
            size = abs(move.change)
            held = best.get(move.area_code)
            if size > 0 and (held is None or size > held[0]):
                best[move.area_code] = (size, comparison.year, move)
    ranked = sorted(best.values(), key=lambda b: (-b[0], b[2].area_code))
    return [move for _, _, move in ranked[:top]]


def _national_row(
    c: Comparison, name: str, national_old: National, national_new: National
) -> list[str]:
    """One row of the map against the national figure."""
    before = national_old.averages.get((c.reform, c.year))
    after = national_new.averages.get((c.reform, c.year))

    def pair(old: Optional[Decimal], new: Optional[Decimal]) -> str:
        return f"{figure(c.outcome, old, 2)} → {figure(c.outcome, new, 2)}"

    return [
        name,
        year_label(c.year),
        pair(before, after),
        pair(c.mean_old, c.mean_new),
        str(len(c.both)),
        pair(c.mean_old_both, c.mean_new_both),
        percent(relative_move(before, after)),
        percent(relative_move(c.mean_old_both, c.mean_new_both)),
        percent(map_against_national(c, before, after)),
    ]


def render_report(
    comparisons: Sequence[Comparison],
    *,
    old_label: str,
    new_label: str,
    old_digest: str,
    new_digest: str,
    national_old: National,
    national_new: National,
    outcome: str,
    top: int,
    weighted_by: Optional[str] = None,
) -> str:
    """The Markdown report for one outcome."""
    chosen = [c for c in comparisons if c.outcome == outcome]
    order = national_new.order + national_old.order
    chosen = _ordered(chosen, order)
    names = {**national_old.names, **national_new.names}

    def name(reform: str) -> str:
        return names.get(reform, reform)

    unit = (
        "average change in household net income, £ a year per household"
        if outcome == AVERAGE_CHANGE
        else "change in household net income, % of income"
    )
    mean_kind = (
        f"weighted by the household counts in {weighted_by}"
        if weighted_by
        else "simple: each constituency counts once"
    )
    lines = [
        "# Before/after map check",
        "",
        f"- Old table: {old_label} (sha256 `{old_digest[:12]}`).",
        f"- New table: {new_label} (sha256 `{new_digest[:12]}`).",
        f"- Figure: {unit}.",
        f"- Means of constituencies: {mean_kind}.",
        "",
        "## What changed, by measure and year",
        "",
    ]
    loud = [c for c in chosen if not c.silent]
    quiet = sorted({name(c.reform) for c in chosen if c.silent})
    lines += _table(
        [
            "Measure",
            "Year",
            "With a figure, old → new",
            "Not published, old → new",
            "Figure moved",
            "New figure outside old interval",
            "Changed colour",
            "Median move",
            "Largest move",
        ],
        (
            [
                name(c.reform),
                year_label(c.year),
                f"{c.published_old} → {c.published_new}",
                f"{c.withheld_old} → {c.withheld_new}",
                f"{c.moved} of {len(c.both)}",
                str(c.outside),
                str(c.colour_changes),
                figure(outcome, c.median_move, 4),
                figure(outcome, c.largest_move, 4),
            ]
            for c in loud
        ),
    )
    lines += [
        "",
        "A figure counts as moved when both tables publish it and the two "
        "differ. Changed colour counts every constituency whose map "
        "category differs, including those that gain or lose a figure.",
    ]
    if quiet:
        lines += [
            "",
            "Left out: years in which every constituency reads zero in both "
            f"tables ({', '.join(quiet)}).",
        ]

    changes = Counter()
    for c in loud:
        changes.update(c.colour_transitions)
    if changes:
        lines += ["", "## Colour changes, all measures and years", ""]
        lines += _table(
            ["Old → new", "Constituency-years"],
            (
                [f"{SHOWN_LABELS[a]} → {SHOWN_LABELS[b]}", str(count)]
                for (a, b), count in sorted(
                    changes.items(), key=lambda item: (-item[1], item[0])
                )
            ),
        )

    if outcome == AVERAGE_CHANGE:
        lines += ["", "## The map against the national figure", ""]
        lines += _table(
            [
                "Measure",
                "Year",
                "National average, old → new",
                "Mean of constituencies with a figure, old → new",
                "In both tables",
                "Mean of those, old → new",
                "National moved",
                "Those constituencies moved",
                "Map against national",
            ],
            (
                _national_row(c, name(c.reform), national_old, national_new)
                for c in loud
            ),
        )
        lines += [
            "",
            "The national average is the national file's average change per "
            "household (the `all` row of the measure's `winners_losers.csv`); "
            "n/a marks a figure the national tables do not publish. Map "
            "against national compares how far the constituencies with a "
            "figure in both tables moved with how far the national average "
            "moved: 0% means the map moved in step with the national figure.",
            "",
            "The mean of the map is not the local-area file's national "
            "average: it leaves out the constituencies with no published "
            "figure, and the published figures carry rounding.",
        ]

    lines += ["", "## Constituencies that move most", ""]
    listed = False
    reforms = list(dict.fromkeys(c.reform for c in loud))
    for reform in reforms:
        movers = top_movers([c for c in loud if c.reform == reform], top)
        if not movers:
            continue
        listed = True
        lines += [f"### {name(reform)}", ""]
        lines += _table(
            [
                "Constituency",
                "Year",
                "Old (90% interval)",
                "New (90% interval)",
                "Move",
                "Colour, old → new",
            ],
            (
                [
                    move.area_name,
                    year_label(move.new.year),
                    _interval(move.old),
                    _interval(move.new),
                    figure(outcome, move.change, 4),
                    (
                        f"{SHOWN_LABELS[move.shown_old]} → "
                        f"{SHOWN_LABELS[move.shown_new]}"
                        if move.colour_changed
                        else SHOWN_LABELS[move.shown_new]
                    ),
                ]
                for move in movers
            ),
        )
        lines.append("")
    if not listed:
        lines += ["No constituency's published figure moved.", ""]
    lines += [
        "Every figure above comes from a row of the two public tables or "
        "of the national tables.",
    ]
    return "\n".join(lines) + "\n"


DETAIL_COLUMNS = (
    "level",
    "area_code",
    "area_name",
    "reform",
    "year",
    "outcome",
    "old_value",
    "old_lo",
    "old_hi",
    "old_tier",
    "old_shown",
    "new_value",
    "new_lo",
    "new_hi",
    "new_tier",
    "new_shown",
    "change",
    "new_outside_old_interval",
    "colour_changed",
)


def _text(number: Optional[Decimal]) -> str:
    return "" if number is None else str(number)


def write_details(comparisons: Sequence[Comparison], path: Path) -> None:
    """Write one row per area, measure, year and outcome: public rows of
    the two tables side by side. It lists every constituency, so keep it
    out of ``public/``."""
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(DETAIL_COLUMNS)
        for c in comparisons:
            for move in c.moves:
                old, new = move.old, move.new
                writer.writerow(
                    [
                        c.level,
                        move.area_code,
                        move.area_name,
                        c.reform,
                        c.year,
                        c.outcome,
                        _text(old.value) if old else "",
                        _text(old.lo) if old else "",
                        _text(old.hi) if old else "",
                        old.tier if old else "",
                        move.shown_old,
                        _text(new.value) if new else "",
                        _text(new.lo) if new else "",
                        _text(new.hi) if new else "",
                        new.tier if new else "",
                        move.shown_new,
                        _text(move.change),
                        str(move.outside_old_interval).lower(),
                        str(move.colour_changed).lower(),
                    ]
                )


def render_local_uk(
    local: Mapping[tuple[str, int], Decimal], national: National
) -> str:
    """The local-area file's UK-level average beside the national file's.

    For the terminal only: the figures come from a private audit, so this
    block never goes into the report.
    """
    lines = [
        "From the private audit's UK-level rows (not part of the report).",
        "Local-area file's national average change per household, beside",
        "the national file's. The national file's average leaves out",
        "households with no income decile.",
        "",
    ]
    rank = {reform: index for index, reform in enumerate(national.order)}
    keys = sorted(local, key=lambda k: (rank.get(k[0], len(rank)), k[0], k[1]))
    for reform, year in keys:
        if (reform, year) not in national.averages:
            continue
        ours = national.averages[(reform, year)]
        theirs = local[(reform, year)]
        if ours is None or (ours == 0 and theirs == 0):
            continue
        gap = relative_move(ours, theirs)
        lines.append(
            f"{national.names.get(reform, reform)}, {year_label(year)}: "
            f"local {figure(AVERAGE_CHANGE, theirs, 2)}, national "
            f"{figure(AVERAGE_CHANGE, ours, 2)}, local against national "
            f"{percent(gap)}"
        )
    return "\n".join(lines) + "\n"


# -- command line -------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare the published table of results by constituency with a "
            "regenerated one, and write a short report."
        )
    )
    old = parser.add_mutually_exclusive_group()
    old.add_argument(
        "--old-ref",
        help="git ref whose public/data holds the old table "
        "(default: origin/main)",
    )
    old.add_argument(
        "--old-dir", type=Path, help="a folder with the old table"
    )
    new = parser.add_mutually_exclusive_group()
    new.add_argument(
        "--new-dir",
        type=Path,
        help="a folder with the new table (default: this checkout's "
        "public/data)",
    )
    new.add_argument(
        "--new-ref", help="git ref whose public/data holds the new table"
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=REPO,
        help="the repository to read refs in",
    )
    parser.add_argument(
        "--outcome",
        choices=OUTCOMES,
        default=AVERAGE_CHANGE,
        help="the figure to report (default: average_change)",
    )
    parser.add_argument(
        "--reforms", nargs="+", help="only these measure ids (default: all)"
    )
    parser.add_argument(
        "--years", nargs="+", type=int, help="only these years (default: all)"
    )
    parser.add_argument(
        "--top",
        type=int,
        default=5,
        help="constituencies to list for each measure (default: 5)",
    )
    parser.add_argument(
        "--households",
        type=Path,
        help="CSV with area_code,households, to weight the means",
    )
    parser.add_argument(
        "--local-uk-audit",
        type=Path,
        help="a private disclosure_audit.csv of the new run: prints the "
        "local-area file's UK-level average beside the national file's on "
        "the terminal, never in the report",
    )
    parser.add_argument(
        "--report", type=Path, help="write the report here (default: print it)"
    )
    parser.add_argument(
        "--details",
        type=Path,
        help="write every constituency's old and new row here (CSV)",
    )
    return parser


def _keep(
    table: Mapping[Group, Mapping[str, Row]],
    reforms: Optional[Sequence[str]],
    years: Optional[Sequence[int]],
) -> dict[Group, Mapping[str, Row]]:
    return {
        group: areas
        for group, areas in table.items()
        if (not reforms or group[1] in reforms)
        and (not years or group[2] in years)
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parsed = _parser().parse_args(argv)
    old_source = (
        DirectorySource(parsed.old_dir, parsed.repo)
        if parsed.old_dir
        else GitSource(parsed.repo, parsed.old_ref or "origin/main")
    )
    new_source = (
        GitSource(parsed.repo, parsed.new_ref)
        if parsed.new_ref
        else DirectorySource(
            parsed.new_dir or parsed.repo / DATA_PREFIX, parsed.repo
        )
    )
    try:
        tables, digests = [], []
        for source in (old_source, new_source):
            data = source.read(TABLE)
            if data is None:
                raise MapCheckError(f"{source.label} has no {TABLE}")
            digests.append(hashlib.sha256(data).hexdigest())
            table = load_table(data, f"{source.label}/{TABLE}")
            tables.append(_keep(table, parsed.reforms, parsed.years))
        weights = (
            load_households(parsed.households) if parsed.households else None
        )
        comparisons = compare(*tables, weights=weights)
        if not comparisons:
            raise MapCheckError("no rows match --reforms and --years")
        national_old = load_national(old_source)
        national_new = load_national(new_source)
        report = render_report(
            comparisons,
            old_label=old_source.describe(),
            new_label=new_source.describe(),
            old_digest=digests[0],
            new_digest=digests[1],
            national_old=national_old,
            national_new=national_new,
            outcome=parsed.outcome,
            top=parsed.top,
            weighted_by=parsed.households.name if parsed.households else None,
        )
        local = (
            load_local_uk(parsed.local_uk_audit)
            if parsed.local_uk_audit
            else None
        )
    except MapCheckError as error:
        print(f"map check: {error}", file=sys.stderr)
        return 2
    if parsed.report:
        parsed.report.write_text(report, encoding="utf-8")
        print(f"Report: {parsed.report}", file=sys.stderr)
    else:
        sys.stdout.write(report)
    if parsed.details:
        write_details(comparisons, parsed.details)
        print(f"Details: {parsed.details}", file=sys.stderr)
    if local is not None:
        sys.stderr.write("\n" + render_local_uk(local, national_new))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
