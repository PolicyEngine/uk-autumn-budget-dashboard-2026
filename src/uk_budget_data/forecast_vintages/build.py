"""Build ``public/data/obr_forecast_vintages.json``: OBR forecasts beside outturn.

For each variable in :mod:`.variables` the file holds:

- the outturn, from the ONS series (or the UK House Price Index) saved
  under ``data_inputs/forecast_vintages`` by ``--fetch``;
- every OBR forecast of it, June 2010 to March 2026, from the Historical
  official forecasts database, or (quarterly RHDI per person) from each
  forecast's own Table 1.5. Each forecast keeps the values it published
  from its launch period on (:mod:`.periods` says how the launch is set).

Before anything is written:

- every OBR file's bytes must match the SHA-256 pinned in :mod:`.sources`,
  and every ONS and House Price Index file the SHA-256 ``--fetch``
  recorded in ``retrieved.json``;
- each outturn is set against the database's own outturn row (the OBR's
  outturn "as available at last forecast") over the last eight periods
  both have, and must agree within the variable's tolerance;
- each forecast's values must run on from its launch with no gaps;
- no forecast after March 2026 is taken: the tab shows forecasts made
  before the Budget's measures, and later ones wait for the post-Budget
  rules (docs/budget-day-runbook.md).

A failed check raises :class:`BuildError` and writes nothing.
"""

import csv
import hashlib
import io
import json
import math
from pathlib import Path

from uk_budget_data.forecast_vintages import efo, hofd, ons, periods, sources
from uk_budget_data.forecast_vintages import variables as V

OUTPUT_PATH = Path("public/data/obr_forecast_vintages.json")
NEWEST_VINTAGE = (2026, 3)
CHECK_PERIODS = 8
DECIMALS = 4

# This parliament: from the quarter (year, fiscal year) before the July
# 2024 general election to the last complete quarter (year, fiscal year)
# before the next one must be held.
PARLIAMENT = {
    "start": {"quarterly": "2024Q2", "calendar": 2024, "fiscal": "2024-25"},
    "end": {"quarterly": "2029Q2", "calendar": 2029, "fiscal": "2029-30"},
}

LAUNCH_RULES = {
    "quarterly": (
        "Two quarters before the quarter the forecast was published in: "
        "the last quarter of household income outturn it had."
    ),
    "calendar": "The calendar year before the forecast was published.",
    "fiscal": (
        "The last complete fiscal year (April to March) before the "
        "forecast was published."
    ),
}


class BuildError(ValueError):
    """An input that fails a check: nothing is written."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _key(period) -> str:
    return str(period)


def _ordered(values: dict) -> dict:
    return {
        _key(p): round(values[p], DECIMALS)
        for p in sorted(values, key=periods.sort_key)
    }


def verify_archived(file: sources.ArchivedFile, root: Path) -> Path:
    path = root / file.path
    if not path.is_file():
        raise BuildError(
            f"Missing {path}: run uk-budget-data forecast-vintages --fetch"
        )
    digest = _sha256(path.read_bytes())
    if digest != file.sha256:
        raise BuildError(f"{path}: sha256 {digest}, expected {file.sha256}")
    return path


def read_retrieved(root: Path) -> dict:
    path = root / sources.RETRIEVED_PATH
    if not path.is_file():
        raise BuildError(
            f"Missing {path}: run uk-budget-data forecast-vintages --fetch"
        )
    return json.loads(path.read_text())


def load_ons(root: Path, retrieved: dict) -> dict:
    series = {}
    for cdid, source in sources.ONS.items():
        record = retrieved.get("ons", {}).get(cdid)
        if record is None:
            raise BuildError(f"retrieved.json has no record of ONS {cdid}")
        path = root / source.path
        if not path.is_file():
            raise BuildError(f"Missing {path}")
        loaded = ons.read_series(path, cdid, source.dataset)
        if loaded.sha256 != record["sha256"]:
            raise BuildError(
                f"{path}: sha256 {loaded.sha256}, but retrieved.json "
                f"records {record['sha256']}"
            )
        series[cdid] = loaded
    return series


def read_hpi(path: Path) -> dict:
    """Monthly UK average price, all property types: {"2024-01": price}."""
    prices = {}
    reader = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig")))
    column = "Average price All property types"
    if column not in (reader.fieldnames or []):
        raise BuildError(f"{path}: no {column!r} column")
    for row in reader:
        if row["Name"] != "United Kingdom":
            raise BuildError(f"{path}: a row for {row['Name']!r}")
        month = row["Period"]
        if len(month) != 7 or month[4] != "-":
            raise BuildError(f"{path}: unexpected period {month!r}")
        if month in prices:
            raise BuildError(f"{path}: {month} twice")
        text = (row[column] or "").strip()
        if text:
            price = float(text)
            if not math.isfinite(price):
                raise BuildError(f"{path}: {month}'s price is {text!r}")
            prices[month] = price
    return prices


def load_hpi(root: Path, retrieved: dict) -> dict:
    record = retrieved.get("hpi")
    if record is None:
        raise BuildError(
            "retrieved.json has no record of the House Price Index"
        )
    path = root / sources.HPI_PATH
    if not path.is_file():
        raise BuildError(f"Missing {path}")
    digest = _sha256(path.read_bytes())
    if digest != record["sha256"]:
        raise BuildError(
            f"{path}: sha256 {digest}, but retrieved.json records "
            f"{record['sha256']}"
        )
    return read_hpi(path)


def _comparable(measure: V.Measure, outturn: dict) -> dict:
    """The outturn in the database row's terms: growth rates for growth."""
    return ons.growth(outturn) if measure.kind == "growth" else outturn


def check_outturn(
    variable: V.Variable, measure: V.Measure, outturn: dict, row: dict
) -> dict:
    """Set the outturn against the database's outturn row; raise if apart."""
    mine = _comparable(measure, outturn)
    common = sorted(set(mine) & set(row), key=periods.sort_key)[
        -CHECK_PERIODS:
    ]
    if len(common) < CHECK_PERIODS:
        raise BuildError(
            f"{variable.id}: only {len(common)} periods to set against the "
            "database's outturn"
        )
    gaps = []
    for period in common:
        gap = mine[period] - row[period]
        size = abs(gap) / abs(row[period]) if measure.relative else abs(gap)
        # A value that is not a number (or a zero row under a relative
        # tolerance) never passes
        if not math.isfinite(size):
            raise BuildError(
                f"{variable.id} ({measure.unit}): outturn {mine[period]!r} "
                f"in {period} cannot be set against the database's "
                f"{row[period]!r}"
            )
        gaps.append((period, gap, size))
    worst = max(gaps, key=lambda g: g[2])
    if worst[2] > measure.tolerance:
        raise BuildError(
            f"{variable.id} ({measure.unit}): outturn {mine[worst[0]]:.3f} "
            f"in {worst[0]} against the database's {row[worst[0]]:.3f}, "
            f"beyond the tolerance of {measure.tolerance}"
            + (" (share)" if measure.relative else "")
        )
    in_terms = (
        "% change on a year earlier"
        if measure.kind == "growth"
        else measure.unit
    )
    return {
        "against": "the outturn row of the OBR's database",
        "in": in_terms,
        "periods": [_key(p) for p in common],
        "largest_gap": round(worst[1], DECIMALS),
        "largest_gap_period": _key(worst[0]),
        "tolerance": measure.tolerance,
        "tolerance_is_share": measure.relative,
    }


def _check_newest(name: str, vintages) -> None:
    for vintage in vintages:
        if (vintage.year, vintage.month) > NEWEST_VINTAGE:
            raise BuildError(
                f"{name}: holds the {vintage.label} forecast; this tab shows "
                "forecasts to March 2026 until the post-Budget rules are set"
            )
    if (
        not vintages
        or (vintages[-1].year, vintages[-1].month) != NEWEST_VINTAGE
    ):
        raise BuildError(f"{name}: its newest forecast is not March 2026")


def vintage_record(
    variable: V.Variable,
    measure: V.Measure,
    label: str,
    year: int,
    month: int,
    values: dict,
) -> dict:
    """One forecast from its launch period on, with no gaps."""
    launch = periods.launch(variable.frequency, year, month)
    start = periods.sort_key(launch)
    kept = {p: v for p, v in values.items() if periods.sort_key(p) >= start}
    # An index needs its launch value to carry the forecast on from the
    # outturn; a level is drawn as published, so it may start a period
    # later (the November 2023 employment forecast starts in 2023).
    first = launch if measure.kind == "index" else periods.next_period(launch)
    if first not in kept:
        raise BuildError(
            f"{variable.id}: the {label} forecast has no value for {first}"
        )
    keys = sorted(kept, key=periods.sort_key)
    for before, after in zip(keys, keys[1:]):
        if periods.next_period(before) != after:
            raise BuildError(
                f"{variable.id}: the {label} forecast skips from {before} "
                f"to {after}"
            )
    if len(kept) < 2:
        raise BuildError(f"{variable.id}: the {label} forecast has no horizon")
    month_name = hofd.MONTH_NAMES[month - 1]
    return {
        "id": f"{month_name.lower()}_{year}",
        "label": f"{month_name} {year}",
        "year": year,
        "month": month,
        "launch": _key(launch),
        "values": _ordered(kept),
    }


def _sheet_source(sheet: hofd.Sheet) -> str:
    # Many sheet titles already end with their unit: "(£ billion)"
    named = sheet.unit and f"({sheet.unit.lower()})" in sheet.title.lower()
    unit = f" ({sheet.unit})" if sheet.unit and not named else ""
    return (
        "OBR, Historical official forecasts database, Spring 2026: sheet "
        f"{sheet.name}, {sheet.title}{unit}"
    )


def build_measure(
    variable, measure, series, hpi, workbook, efo_tables
) -> dict:
    outturn = measure.outturn(series, hpi)
    if not outturn:
        raise BuildError(f"{variable.id}: no outturn")
    if measure.sheet:
        sheet = hofd.read_sheet(workbook, measure.sheet)
        _check_newest(f"{variable.id} ({measure.sheet})", sheet.vintages)
        check = check_outturn(variable, measure, outturn, sheet.outturn)
        vintages = [
            vintage_record(
                variable, measure, v.label, v.year, v.month, v.values
            )
            for v in sheet.vintages
        ]
        forecast_source = _sheet_source(sheet)
    else:
        vintages = [
            vintage_record(variable, measure, label, year, month, values)
            for label, year, month, values in efo_tables
        ]
        check = check_index(variable, measure, outturn, efo_tables[-1])
        forecast_source = (
            "OBR, Economic and fiscal outlook, economy tables of each "
            "forecast: Table 1.5, real household disposable income per "
            "person by total population (index, 2008 Q1 = 100)"
        )
    return {
        "unit": measure.unit,
        "kind": measure.kind,
        "decimals": measure.decimals,
        "outturn_source": measure.outturn_source,
        "forecast_source": forecast_source,
        "check": check,
        "outturn": _ordered(outturn),
        "vintages": vintages,
    }


INDEX_TOLERANCE = 1.5  # percentage points, year-on-year growth


def check_index(variable, measure, outturn, newest) -> dict:
    """Set the outturn's growth against the newest Table 1.5's, to its launch.

    Table 1.5 divides households' and non-profit institutions' income by
    the whole population; the ONS's per-head series is households' alone,
    so the two differ by a little.
    """
    label, year, month, values = newest
    launch = periods.quarter_number(periods.launch("quarterly", year, month))

    def yoy(levels):
        out = {}
        for p, v in levels.items():
            back = periods.quarter_from_number(periods.quarter_number(p) - 4)
            if back in levels and levels[back]:
                out[p] = (v / levels[back] - 1) * 100
        return out

    mine, theirs = yoy(outturn), yoy(values)
    common = sorted(
        (
            p
            for p in set(mine) & set(theirs)
            if periods.quarter_number(p) <= launch
        ),
        key=periods.sort_key,
    )[-CHECK_PERIODS:]
    if len(common) < CHECK_PERIODS:
        raise BuildError(f"{variable.id}: too few quarters to check")
    gaps = [(p, mine[p] - theirs[p]) for p in common]
    worst = max(gaps, key=lambda g: abs(g[1]))
    if abs(worst[1]) > INDEX_TOLERANCE:
        raise BuildError(
            f"{variable.id}: growth {mine[worst[0]]:.2f}% in {worst[0]} "
            f"against Table 1.5's {theirs[worst[0]]:.2f}% ({label})"
        )
    return {
        "against": f"Table 1.5 of the {label} forecast, to its launch quarter",
        "in": "% change on a year earlier",
        "periods": common,
        "largest_gap": round(worst[1], DECIMALS),
        "largest_gap_period": worst[0],
        "tolerance": INDEX_TOLERANCE,
        "tolerance_is_share": False,
    }


def read_efo_tables(root: Path) -> list:
    tables = []
    for file in sources.EFO_TABLES:
        path = verify_archived(file, root)
        when = hofd.parse_vintage_label(file.vintage)
        if when is None:
            raise BuildError(f"{file.id}: no vintage")
        year, month = when
        if (year, month) > NEWEST_VINTAGE:
            raise BuildError(f"{file.id}: after March 2026")
        values = efo.read_rhdi_per_person(path, file.member)
        tables.append((file.vintage, year, month, values))
    order = [(t[1], t[2]) for t in tables]
    if order != sorted(order) or order[-1] != NEWEST_VINTAGE:
        raise BuildError(
            "The economy tables are not in date order to March 2026"
        )
    return tables


def _sources_meta(series: dict, retrieved: dict, hpi: dict) -> dict:
    obr = []
    for file in (sources.HOFD,) + sources.EFO_TABLES:
        obr.append(
            {
                "id": file.id,
                "title": file.title,
                "url": file.url,
                "archive_url": file.archive_url,
                "file": file.path.as_posix(),
                "member": file.member,
                "sha256": file.sha256,
            }
        )
    ons_meta = []
    for cdid, source in sources.ONS.items():
        record = retrieved["ons"][cdid]
        s = series[cdid]
        ons_meta.append(
            {
                "cdid": cdid,
                "dataset": source.dataset,
                "title": s.title,
                "page": source.page,
                "url": source.url,
                "release_date": s.release_date,
                "retrieved": record["retrieved"],
                "file": source.path.as_posix(),
                "sha256": s.sha256,
            }
        )
    record = retrieved["hpi"]
    return {
        "obr": obr,
        "ons": ons_meta,
        "hpi": {
            "title": (
                "HM Land Registry and ONS, UK House Price Index: average "
                "price, all property types, United Kingdom"
            ),
            "page": sources.HPI_PAGE,
            "url": record["url"],
            "retrieved": record["retrieved"],
            "latest_month": max(hpi),
            "file": sources.HPI_PATH.as_posix(),
            "sha256": record["sha256"],
        },
    }


def build(root: Path = Path(".")) -> dict:
    verify_archived(sources.HOFD, root)
    retrieved = read_retrieved(root)
    series = load_ons(root, retrieved)
    hpi = load_hpi(root, retrieved)
    workbook = hofd.open_workbook(root / sources.HOFD.path)
    efo_tables = read_efo_tables(root)

    out = []
    for variable in V.VARIABLES:
        record = {
            "id": variable.id,
            "label": variable.label,
            "group": variable.group,
            "frequency": variable.frequency,
            "default_unit": variable.default_unit,
            "units": variable.units,
            "notes": list(variable.notes),
            "level": build_measure(
                variable, variable.level, series, hpi, workbook, efo_tables
            ),
            "share": (
                build_measure(
                    variable, variable.share, series, hpi, workbook, efo_tables
                )
                if variable.share
                else None
            ),
        }
        for unit, spec in variable.units.items():
            if spec["from"] == "share" and variable.share is None:
                raise BuildError(
                    f"{variable.id}: {unit} reads a share it lacks"
                )
        if variable.default_unit not in variable.units:
            raise BuildError(f"{variable.id}: default unit not offered")
        out.append(record)

    return {
        "meta": {
            "built_by": "uk-budget-data forecast-vintages",
            "newest_vintage": "March 2026",
            "parliament": PARLIAMENT,
            "launch_rules": LAUNCH_RULES,
            "left_out": [{"what": w, "why": y} for w, y in V.LEFT_OUT],
            "gaps": [
                (
                    "Real household disposable income per person: no economy "
                    "tables with Table 1.5's per-person index were found for "
                    "forecasts before November 2016, or for March 2018, "
                    "November 2020 and October 2021."
                ),
            ],
            "sources": _sources_meta(series, retrieved, hpi),
        },
        "variables": out,
    }


def output_text(doc: dict) -> str:
    """The file's bytes: two-space JSON and a final newline.

    A value that is not a number (NaN, infinity) has no JSON form and
    stops the build rather than writing what a browser cannot read.
    """
    return json.dumps(doc, indent=2, ensure_ascii=True, allow_nan=False) + "\n"
