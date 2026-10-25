"""Read OBR Economic and fiscal outlook (EFO) detailed forecast tables: economy.

Two readers:

- :func:`extract_rhdi`: real household disposable income per person
  (Table 1.5), the ``obr_rhdi`` block. Ported from
  PolicyEngine/uk-living-standards-outlook pipeline/extract_obr.py (6e28822).
- :func:`read_forecast`: the calendar-year growth series the Forecast
  changes sub-tab shows (CPI, CPIH, RPI, earnings, non-labour income, house
  prices, rents, mortgage interest), as policyengine-uk's
  ``gov.economic_assumptions.yoy_growth.obr`` parameters take them.

The forecast reader finds each table by its title and each series by its
column heading, never by a fixed sheet, row or column number, since the OBR
renumbers its tables between forecasts. Calendar-year rows are found by the
year in the period column. A table, column or year it cannot find raises
:class:`ForecastTableError` naming the series; nothing is filled in.
"""

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

# --- Real household disposable income per person (Table 1.5) -------------

RHDI_URL = (
    "https://obr.uk/download/"
    "march-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/"
)
EFO_FILE_NAME = "efo-march-2026-detailed-forecast-tables-economy.xlsx"
RHDI_OUTPUT_NAME = "obr_rhdi.json"
RHDI_YEARS = [f"{y}-{str(y + 1)[-2:]}" for y in range(2021, 2031)]
LAST_OUTTURN = "2024-25"  # 2025-26 onwards include OBR forecast quarters


def extract_rhdi(path: Path) -> dict:
    """Table 1.5 "Per person", block "By total population": RHDI per head.

    Index 2008Q1=100 (column D) and £ thousands in 2023 prices (column G),
    fiscal-year rows. RHDI (chained volume measure, ONS NRJR) divided by
    total population (ONS EBAQ): a national-accounts measure, not the
    survey-based HBAI income the rest of the tab uses.
    """
    p = Path(path)
    df = pd.read_excel(p, sheet_name="1.5", header=None)
    assert "Per person" in str(df.iloc[1, 1])
    assert "By total population" in str(df.iloc[2, 2])
    assert "Real household disposable income" in str(df.iloc[4, 3])
    assert "2008Q1=100" in str(df.iloc[3, 2])
    assert "Real household disposable income" in str(df.iloc[4, 6])
    assert "2023 prices" in str(df.iloc[3, 6])
    labels = df[1].astype(str).str.strip()
    rows = []
    prev = None
    for y in RHDI_YEARS:
        r = df[labels == y]
        assert len(r) == 1, y
        excel_row = int(r.index[0]) + 1
        index = float(r.iloc[0, 3])
        level = float(r.iloc[0, 6]) * 1000
        rows.append(
            {
                "year": y,
                "index_2008q1_100": round(index, 3),
                "gbp_2023_prices": round(level),
                "growth": None if prev is None else round(index / prev - 1, 5),
                "type": "outturn" if y <= LAST_OUTTURN else "forecast",
                "cell_row": excel_row,
            }
        )
        prev = index
    return {
        "source": {
            "release": (
                "OBR Economic and fiscal outlook, March 2026: detailed "
                "forecast tables, economy"
            ),
            "url": RHDI_URL,
            "file_sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            "table": (
                "Table 1.5 (Per person), By total population: Real household "
                "disposable income, columns D (index, 2008Q1=100) and G "
                "(£ thousands, 2023 prices), fiscal-year rows"
            ),
            "definition": (
                "RHDI (chained volume measure, ONS NRJR) divided by total "
                "population (ONS EBAQ)"
            ),
        },
        "series": rows,
    }


def write_rhdi(path: Path, out: Path) -> dict:
    """Extract and write obr_rhdi.json."""
    payload = extract_rhdi(path)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


# --- Forecast series ------------------------------------------------------


class ForecastTableError(ValueError):
    """An EFO table, series or year the reader could not find."""


@dataclass(frozen=True)
class SeriesSpec:
    """Where one forecast series lives in the EFO economy tables.

    table: pattern for the table title (after its number), e.g. Inflation.
    column: pattern the column heading must match in full (case-insensitive,
        whitespace collapsed); the first such column, left to right.
    kind: "growth" (the column is already per cent growth) or "level"
        (growth is computed from consecutive calendar-year levels).
    decimals: rounding of the per cent value before it becomes a fraction
        (1 where policyengine-uk takes the 1 d.p. figure of Table A.1),
        or None for 4 d.p. of the fraction.
    """

    key: str
    table: str
    column: str
    kind: str = "growth"
    decimals: Optional[int] = None


# The OBR series the sub-tab shows, keyed as in the outlook's forecast block.
OBR_SERIES = (
    SeriesSpec("cpi", r"inflation", r"cpi", decimals=1),
    SeriesSpec("cpih", r"inflation", r"cpih"),
    SeriesSpec("rpi", r"inflation", r"rpi", decimals=1),
    SeriesSpec(
        "earnings",
        r"labour market",
        r"average weekly earnings growth.*",
        decimals=1,
    ),
    SeriesSpec(
        "non_labour_income",
        r"household disposable income.*",
        r"non-labour income",
        kind="level",
    ),
    SeriesSpec(
        "house_prices",
        r"housing market",
        r"house price index \(per cent change.*",
        decimals=1,
    ),
    SeriesSpec("rent", r"inflation", r"actual rents for housing"),
    SeriesSpec(
        "mortgage_interest", r"inflation", r"mortgage interest payments"
    ),
)

# Series derived by PolicyEngine from the OBR forecast, not OBR series.
DERIVED_SERIES = ("cpi_ahc", "social_rent")

# Years a series may lack in an EFO, and why; the pre-Budget value is then
# kept and the series' source says so. Any other gap raises.
CARRIED_YEARS = {
    "mortgage_interest": (
        "the OBR does not forecast mortgage interest payments that far",
    ),
}

_TITLE = re.compile(
    r"^\s*(?:table\s+)?(\d+\.\d+[a-z]?)\s*:?\s+(.+?)\s*$", re.I
)
_QUARTER = re.compile(r"^\d{4}\s*Q[1-4]$", re.I)


def _norm(text) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def _cell_year(value) -> Optional[int]:
    """2026, 2026.0 or "2026" -> 2026; anything else -> None."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(value) and float(value).is_integer():
            return int(value)
        return None
    text = _norm(value)
    return int(text) if re.fullmatch(r"\d{4}", text) else None


@dataclass
class Table:
    """One EFO sheet: its number, title, header cells and calendar rows."""

    sheet: str
    number: str
    title: str
    frame: pd.DataFrame
    period_col: int
    header_rows: int

    def column(self, pattern: str) -> tuple[int, str]:
        """First column, left to right, whose heading matches in full."""
        regex = re.compile(pattern, re.I)
        for col in range(self.frame.shape[1]):
            if col == self.period_col:
                continue
            for row in range(self.header_rows):
                heading = _norm(self.frame.iat[row, col])
                if heading and regex.fullmatch(heading):
                    return col, heading
        raise KeyError(pattern)

    def calendar_rows(self) -> dict[int, int]:
        """Calendar year -> row index, for rows labelled with a bare year."""
        rows = {}
        for row in range(self.header_rows, self.frame.shape[0]):
            year = _cell_year(self.frame.iat[row, self.period_col])
            if year is not None and year not in rows:
                rows[year] = row
        return rows

    def value(self, col: int, year: int) -> Optional[float]:
        row = self.calendar_rows().get(year)
        if row is None:
            return None
        cell = self.frame.iat[row, col]
        try:
            value = float(cell)
        except (TypeError, ValueError):
            return None
        return value if math.isfinite(value) else None


def _read_table(sheet: str, frame: pd.DataFrame) -> Optional[Table]:
    """A sheet as a Table, or None if it has no numbered title or periods."""
    number = title = None
    for row in range(min(4, frame.shape[0])):
        for col in range(min(4, frame.shape[1])):
            m = _TITLE.match(_norm(frame.iat[row, col]))
            if m and not _QUARTER.match(_norm(frame.iat[row, col])):
                number, title = m.group(1), _norm(m.group(2))
                break
        if title:
            break
    if not title:
        return None
    # The period column holds quarter labels such as 2026Q1; data start at
    # the first of them, and every row above is heading.
    for col in range(min(4, frame.shape[1])):
        cells = [_norm(v) for v in frame.iloc[:, col].tolist()]
        first = next(
            (i for i, v in enumerate(cells) if _QUARTER.match(v)), None
        )
        if first is not None:
            return Table(sheet, number, title, frame, col, first)
    return None


def read_tables(path: Path) -> list[Table]:
    """Every titled sheet of an EFO economy workbook."""
    sheets = pd.read_excel(Path(path), sheet_name=None, header=None)
    tables = [_read_table(name, frame) for name, frame in sheets.items()]
    return [t for t in tables if t is not None]


def _find_table(tables: list[Table], spec: SeriesSpec) -> Table:
    regex = re.compile(spec.table, re.I)
    found = [t for t in tables if regex.fullmatch(t.title)]
    if len(found) != 1:
        titles = ", ".join(f"{t.number} {t.title}" for t in tables)
        raise ForecastTableError(
            f"{spec.key}: expected one table titled like "
            f"{spec.table!r}, found {len(found)}. Tables: {titles}"
        )
    return found[0]


def _growth(spec: SeriesSpec, table: Table, col: int, year: int):
    if spec.kind == "level":
        now, before = table.value(col, year), table.value(col, year - 1)
        if now is None or before is None or before == 0:
            return None
        percent = (now / before - 1) * 100
    else:
        percent = table.value(col, year)
        if percent is None:
            return None
    if spec.decimals is not None:
        return round(round(percent, spec.decimals) / 100, 4)
    return round(percent / 100, 4)


@dataclass
class ParsedSeries:
    key: str
    values: dict[int, Optional[float]]
    source: str


def read_forecast(path: Path, years: list[int]) -> dict[str, ParsedSeries]:
    """Calendar-year growth (fractions) for every OBR series, by key.

    A year with no value is None; :func:`apply_forecast` decides whether that
    is allowed (``CARRIED_YEARS``). A missing table or column raises.
    """
    tables = read_tables(path)
    out = {}
    for spec in OBR_SERIES:
        table = _find_table(tables, spec)
        try:
            col, heading = table.column(spec.column)
        except KeyError:
            raise ForecastTableError(
                f"{spec.key}: no column headed like {spec.column!r} in "
                f"Table {table.number} {table.title} (sheet {table.sheet!r})"
            ) from None
        if not table.calendar_rows():
            raise ForecastTableError(
                f"{spec.key}: Table {table.number} {table.title} has no "
                "calendar-year rows"
            )
        how = (
            "growth in the calendar-year level"
            if spec.kind == "level"
            else "calendar year"
        )
        out[spec.key] = ParsedSeries(
            key=spec.key,
            values={y: _growth(spec, table, col, y) for y in years},
            source=f"Table {table.number} {table.title}, {heading} ({how})",
        )
    return out


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
