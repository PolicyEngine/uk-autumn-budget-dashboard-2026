"""Read the OBR's Historical official forecasts database.

The database (one workbook, updated after each Economic and fiscal outlook)
holds every official forecast of each variable, one sheet per variable:

- row 4 holds the periods: calendar years (economy sheets) or fiscal years
  such as ``2024-25`` (fiscal sheets);
- each later row is one forecast, named by its month (``March 2026``),
  oldest first, with values under the periods it covers;
- an ``Outturn data*`` row holds outturn "as available at last forecast";
- footnotes and ``Memo:`` rows (restated or supplementary forecasts) follow.

Forecasts before June 2010 are HM Treasury's; the OBR's start with June
2010, and :func:`read_sheet` returns those only. A row whose name is not a
month and year, or a cell that is not a number, is never guessed at: the
row is left out, or the cell missing.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import openpyxl

MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
HEADER_ROW = 4  # 1-based: "Back to contents", then the periods
OUTTURN_LABEL = re.compile(r"^outturn data", re.I)
VINTAGE_LABEL = re.compile(r"^(?P<month>[A-Za-z]+)\s*(?P<year>\d{4})$")
FISCAL = re.compile(r"^(\d{4})-(\d{2})$")
FIRST_OBR_VINTAGE = (2010, 6)  # June 2010, the OBR's first forecast


class HofdError(ValueError):
    """A sheet that does not have the database's layout."""


@dataclass(frozen=True)
class Vintage:
    """One forecast: its name, month and values by period."""

    label: str  # "March 2026"
    year: int
    month: int
    values: dict  # {period: value}; period is an int year or "2024-25"

    @property
    def id(self) -> str:
        return f"{MONTH_NAMES[self.month - 1].lower()}_{self.year}"

    @property
    def is_obr(self) -> bool:
        return (self.year, self.month) >= FIRST_OBR_VINTAGE


@dataclass(frozen=True)
class Sheet:
    """One variable's sheet: title, unit note, periods, forecasts, outturn."""

    name: str
    title: str
    unit: str
    notes: tuple
    periods: tuple
    vintages: tuple  # of Vintage, oldest first
    outturn: dict


def parse_vintage_label(text) -> Optional[tuple]:
    """``"March 2026"`` (or ``"March2026"``) -> (2026, 3); else None."""
    if text is None:
        return None
    match = VINTAGE_LABEL.match(str(text).strip())
    if not match:
        return None
    name = match["month"].capitalize()
    if name not in MONTH_NAMES:
        return None
    return int(match["year"]), MONTH_NAMES.index(name) + 1


def _period(value):
    """A header cell as a period: an int year, or a fiscal ``2024-25``."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and float(value).is_integer():
        year = int(value)
        return year if 1900 < year < 2100 else None
    text = str(value).strip()
    if text.isdigit() and len(text) == 4:
        return int(text)
    match = FISCAL.match(text.replace("/", "-"))
    if match:
        start = int(match[1])
        if (start + 1) % 100 != int(match[2]):
            raise HofdError(f"Fiscal year {text!r} does not run on")
        return f"{start}-{match[2]}"
    return None


def _number(value) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def read_sheet(workbook, name: str) -> Sheet:
    """Read one variable's sheet from an open workbook."""
    if name not in workbook.sheetnames:
        raise HofdError(f"No sheet {name!r}")
    rows = list(workbook[name].iter_rows(values_only=True))
    if len(rows) < HEADER_ROW + 1:
        raise HofdError(f"{name}: too few rows")
    title = str(rows[0][1] if len(rows[0]) > 1 else rows[0][0]).strip()
    unit = str(rows[1][0] or "").strip()
    notes = tuple(
        str(c).strip()
        for r in rows[1:3]
        for c in r[1:]
        if isinstance(c, str) and c.strip()
    )
    header = rows[HEADER_ROW - 1]
    if str(header[0] or "").strip().lower() != "back to contents":
        raise HofdError(f"{name}: row {HEADER_ROW} is not the period row")
    columns = {j: _period(c) for j, c in enumerate(header) if j > 0}
    columns = {j: p for j, p in columns.items() if p is not None}
    periods = tuple(columns.values())
    if len(set(periods)) != len(periods):
        raise HofdError(f"{name}: a period appears twice")

    vintages, outturn = [], None
    for row in rows[HEADER_ROW:]:
        if not row or row[0] is None:
            continue
        label = str(row[0]).strip()
        values = {}
        for j, period in columns.items():
            if j < len(row):
                number = _number(row[j])
                if number is not None:
                    values[period] = number
        if OUTTURN_LABEL.match(label):
            if outturn is not None:
                raise HofdError(f"{name}: two outturn rows")
            outturn = values
            continue
        when = parse_vintage_label(label)
        if when is None or not values:
            continue  # footnotes, memo rows
        year, month = when
        vintages.append(
            Vintage(
                label=f"{MONTH_NAMES[month - 1]} {year}",
                year=year,
                month=month,
                values=values,
            )
        )
    if outturn is None:
        raise HofdError(f"{name}: no outturn row")
    # The OBR's forecasts only: HM Treasury's earlier rows are left out
    # (the fiscal sheets name July 1996 twice among them).
    vintages = [v for v in vintages if v.is_obr]
    order = [(v.year, v.month) for v in vintages]
    if order != sorted(order) or len(set(order)) != len(order):
        raise HofdError(f"{name}: forecasts are not in date order")
    return Sheet(
        name=name,
        title=title,
        unit=unit,
        notes=notes,
        periods=periods,
        vintages=tuple(vintages),
        outturn=outturn,
    )


def open_workbook(path: Path):
    return openpyxl.load_workbook(Path(path), read_only=True, data_only=True)
