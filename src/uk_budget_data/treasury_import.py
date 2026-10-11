"""Import HM Treasury's Table 4.1 policy-decisions scorecard.

On Budget day the Treasury publishes Table 4.1, "Policy decisions" (in £
million), as a spreadsheet whose presentational sheet lists each measure's
number, description, head (tax or spend) and Exchequer impact for each
fiscal year, followed by printed totals. This module turns that sheet into
reconciliation source rows, one per measure and fiscal year, and checks the
measure rows against the printed totals, so a mis-keyed figure or a parsing
slip fails loudly instead of flowing into a reconciliation.

Table 4.1 figures are post-behavioural. Static costings come from the policy
costings document and are entered separately (``--static-template`` writes a
blank sheet with the same rows to fill in).

Usage::

    uv run python -m uk_budget_data.treasury_import policy-decisions.xlsx \\
        --source-id AB2026-T4.1 --document "Autumn Budget 2026" \\
        --out data_inputs/treasury/sources/AB2026-T4.1.csv
"""

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

FISCAL_YEAR = re.compile(r"^(\d{4})-(\d{2})$")
# Each printed figure is rounded; the Treasury rounds to the nearest £5m, so
# a total can differ from the sum of its rows by up to £2.5m per row plus
# £2.5m for the total itself.
ROUNDING_PER_FIGURE_M = 2.5
NEGLIGIBLE = "*"
NIL = {"-", "–", "—", ""}

SOURCE_COLUMNS = [
    "source_id",
    "document",
    "table",
    "row_id",
    "row_label",
    "fiscal_year",
    "value_bn",
    "basis",
    "sign_convention",
    "head",
    "notes",
]

TOTAL_LABELS = {
    "total policy decisions": None,
    "total spending policy decisions": "spend",
    "total tax policy decisions": "tax",
}


class ScorecardError(ValueError):
    """Raised when the sheet cannot be parsed unambiguously."""


class TotalsMismatch(ScorecardError):
    """Raised when measure rows do not add up to the printed totals."""


@dataclass
class Measure:
    """One Table 4.1 line."""

    number: str
    label: str
    head: str
    values_m: dict[str, Optional[float]]
    negligible: set[str] = field(default_factory=set)


@dataclass
class Scorecard:
    """A parsed Table 4.1 sheet."""

    sheet: str
    fiscal_years: list[str]
    measures: list[Measure]
    totals_m: dict[Optional[str], dict[str, float]]


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def parse_figure(value) -> tuple[Optional[float], bool]:
    """Parse one cell in £m, returning (value, negligible).

    A nil marker is 0. The negligible marker ``*`` (under £2.5m either way)
    is 0 and flagged. Anything else must be a number.
    """
    if isinstance(value, bool):
        raise ScorecardError(f"unexpected boolean cell {value!r}")
    if isinstance(value, (int, float)):
        return float(value), False
    text = _text(value)
    if text in NIL:
        return 0.0, False
    if text == NEGLIGIBLE:
        return 0.0, True
    try:
        return float(text.replace(",", "")), False
    except ValueError as error:
        raise ScorecardError(f"not a figure: {value!r}") from error


def _find_header(rows: list[tuple]) -> tuple[int, dict[int, str], int]:
    """Locate the header row, its fiscal-year columns and the head column."""
    for index, row in enumerate(rows):
        years = {
            column: _text(cell)
            for column, cell in enumerate(row)
            if FISCAL_YEAR.match(_text(cell))
        }
        if len(years) >= 3:
            head_columns = [
                column
                for column, cell in enumerate(row)
                if _text(cell).lower().startswith("head")
            ]
            if len(head_columns) != 1:
                raise ScorecardError(
                    "the header row needs exactly one 'Head' column"
                )
            for column, label in years.items():
                start, end = FISCAL_YEAR.match(label).groups()
                if (int(start) + 1) % 100 != int(end):
                    raise ScorecardError(f"malformed fiscal year {label!r}")
            return index, years, head_columns[0]
    raise ScorecardError("no header row with at least three fiscal years")


def parse_rows(rows: list[tuple], sheet: str = "") -> Scorecard:
    """Parse a scorecard from its cell values, row by row."""
    header_index, year_columns, head_column = _find_header(rows)
    fiscal_years = [year_columns[c] for c in sorted(year_columns)]
    first_year_column = min(year_columns)
    measures: list[Measure] = []
    totals: dict[Optional[str], dict[str, float]] = {}
    seen_numbers: set[str] = set()

    for row in rows[header_index + 1 :]:
        cells = list(row) + [None] * (first_year_column + 1 - len(row))
        raw_values = [
            cells[c] if c < len(cells) else None for c in sorted(year_columns)
        ]
        label_cells = [_text(c) for c in cells[:head_column] if _text(c)]
        if all(_text(v) == "" for v in raw_values):
            continue  # section heading, blank line or footnote
        label = max(label_cells, key=len) if label_cells else ""
        lowered = label.lower()
        if lowered in TOTAL_LABELS:
            totals[TOTAL_LABELS[lowered]] = {
                year: parse_figure(value)[0]
                for year, value in zip(fiscal_years, raw_values)
            }
            continue
        numbers = [
            _text(c)
            for c in cells[:head_column]
            if re.fullmatch(r"\d+[a-z]?", _text(c))
        ]
        if len(numbers) != 1 or not label or label == numbers[0]:
            raise ScorecardError(
                f"cannot read the measure number and description in {row!r}"
            )
        number = numbers[0]
        if number in seen_numbers:
            raise ScorecardError(f"measure {number} appears twice")
        seen_numbers.add(number)
        head = _text(cells[head_column]).lower()
        if head not in {"tax", "spend"}:
            raise ScorecardError(f"measure {number}: head {head!r}")
        values: dict[str, Optional[float]] = {}
        negligible: set[str] = set()
        for year, value in zip(fiscal_years, raw_values):
            figure, is_negligible = parse_figure(value)
            values[year] = figure
            if is_negligible:
                negligible.add(year)
        measures.append(Measure(number, label, head, values, negligible))

    if not measures:
        raise ScorecardError("no measure rows found")
    return Scorecard(sheet, fiscal_years, measures, totals)


def check_totals(scorecard: Scorecard) -> list[str]:
    """Compare measure rows with every printed total.

    Returns one line per total checked. Raises TotalsMismatch, listing each
    year that differs by more than the rounding allowance.
    """
    if None not in scorecard.totals_m:
        raise TotalsMismatch("the sheet prints no 'Total policy decisions'")
    report = []
    problems = []
    for head, printed in scorecard.totals_m.items():
        rows = [
            m for m in scorecard.measures if head is None or m.head == head
        ]
        allowance = ROUNDING_PER_FIGURE_M * (len(rows) + 1)
        for year in scorecard.fiscal_years:
            computed = sum(m.values_m[year] for m in rows)
            gap = computed - printed[year]
            label = head or "all"
            if abs(gap) > allowance:
                problems.append(
                    f"{label} {year}: rows sum to {computed:,.0f}m, "
                    f"printed total {printed[year]:,.0f}m"
                )
            report.append(
                f"{label} {year}: rows {computed:,.0f}m vs printed "
                f"{printed[year]:,.0f}m (allowance ±{allowance:g}m)"
            )
    if problems:
        raise TotalsMismatch("; ".join(problems))
    return report


def read_workbook(path: Path, sheet: Optional[str] = None) -> Scorecard:
    """Read Table 4.1 from a workbook (cached values, not formulas)."""
    from openpyxl import load_workbook

    workbook = load_workbook(path, data_only=True, read_only=True)
    if sheet is None:
        candidates = [
            ws.title
            for ws in workbook.worksheets
            if "scorecard" in ws.title.lower()
        ]
        sheet = (
            candidates[0] if len(candidates) == 1 else workbook.sheetnames[0]
        )
    worksheet = workbook[sheet]
    rows = [tuple(row) for row in worksheet.iter_rows(values_only=True)]
    return parse_rows(rows, sheet)


def source_rows(
    scorecard: Scorecard,
    source_id: str,
    document: str,
    table: str = "4.1",
    basis: str = "post_behavioural",
) -> list[dict]:
    """Reconciliation source rows: one per measure and fiscal year."""
    rows = []
    for measure in scorecard.measures:
        for year in scorecard.fiscal_years:
            rows.append(
                {
                    "source_id": source_id,
                    "document": document,
                    "table": table,
                    "row_id": measure.number,
                    "row_label": measure.label,
                    "fiscal_year": year,
                    "value_bn": f"{measure.values_m[year] / 1000:.4f}",
                    "basis": basis,
                    "sign_convention": "exchequer_positive",
                    "head": measure.head,
                    "notes": (
                        "negligible (*)" if year in measure.negligible else ""
                    ),
                }
            )
    return rows


def static_template(rows: list[dict], source_id: str) -> list[dict]:
    """Blank static-costing rows matching the Table 4.1 rows."""
    return [
        {
            **row,
            "source_id": source_id,
            "table": "policy costings",
            "value_bn": "",
            "basis": "static_costing",
            "notes": "fill from the policy costings document",
        }
        for row in rows
    ]


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=SOURCE_COLUMNS, lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.treasury_import",
        description="Import HM Treasury's Table 4.1 policy decisions.",
    )
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--document", required=True)
    parser.add_argument("--sheet", default=None)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--static-template",
        type=Path,
        default=None,
        help="also write a blank static-costing sheet with the same rows",
    )
    args = parser.parse_args(argv)
    try:
        scorecard = read_workbook(args.workbook, args.sheet)
        report = check_totals(scorecard)
    except ScorecardError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    rows = source_rows(scorecard, args.source_id, args.document)
    write_csv(rows, args.out)
    if args.static_template:
        write_csv(
            static_template(rows, f"{args.source_id}-static"),
            args.static_template,
        )
    print(
        f"{len(scorecard.measures)} measures × "
        f"{len(scorecard.fiscal_years)} years from sheet "
        f"{scorecard.sheet!r} -> {args.out}"
    )
    for line in report:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
