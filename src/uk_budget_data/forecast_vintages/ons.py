"""Read ONS time series saved from the ONS website's JSON route.

Each series is saved unedited from
``https://www.ons.gov.uk/<uri>/data`` (the route the ONS time series pages
offer as "JSON"), so its bytes and SHA-256 can be checked later. The file
holds the series' annual, quarterly and monthly observations as strings;
:func:`read_series` turns them into numbers keyed by period, and the
helpers here aggregate them to the periods the OBR forecasts:

- calendar years: the ONS's own annual figure (``years``), which for these
  series is the year's total, or average, as the ONS publishes it;
- fiscal years (April to March): the sum of four quarters, or the value at
  the end of March for a stock such as debt.

A period the ONS leaves blank is missing, never zero.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

ONS_DATA_URL = "https://www.ons.gov.uk/{uri}/data"
MONTHS = (
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
)


class OnsSeriesError(ValueError):
    """A saved ONS series that is not the series it claims to be."""


@dataclass(frozen=True)
class OnsSeries:
    """One ONS series: its id, dataset, title and observations."""

    cdid: str
    dataset: str
    title: str
    unit: str
    release_date: str
    sha256: str
    years: dict = field(default_factory=dict)  # {2024: value}
    quarters: dict = field(default_factory=dict)  # {"2024Q1": value}
    months: dict = field(default_factory=dict)  # {"2024-01": value}


def _number(text) -> Optional[float]:
    if text is None:
        return None
    text = str(text).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _quarter_key(date: str) -> str:
    year, quarter = date.split()
    if quarter not in ("Q1", "Q2", "Q3", "Q4"):
        raise OnsSeriesError(f"Unexpected quarter {date!r}")
    return f"{int(year)}{quarter}"


def _month_key(date: str) -> str:
    year, month = date.split()
    return f"{int(year)}-{MONTHS.index(month[:3].upper()) + 1:02d}"


def read_series(path: Path, cdid: str, dataset: str) -> OnsSeries:
    """Read a saved ONS series and check it is ``cdid`` in ``dataset``."""
    raw = Path(path).read_bytes()
    doc = json.loads(raw)
    description = doc.get("description") or {}
    if str(description.get("cdid", "")).upper() != cdid.upper():
        raise OnsSeriesError(
            f"{path}: holds {description.get('cdid')!r}, not {cdid}"
        )
    if str(description.get("datasetId", "")).upper() != dataset.upper():
        raise OnsSeriesError(
            f"{path}: dataset {description.get('datasetId')!r}, not {dataset}"
        )

    def collect(key, to_key):
        values = {}
        for row in doc.get(key) or []:
            value = _number(row.get("value"))
            if value is not None:
                values[to_key(row["date"])] = value
        return values

    return OnsSeries(
        cdid=cdid.upper(),
        dataset=dataset.upper(),
        title=str(description.get("title", "")).strip(),
        unit=str(description.get("unit", "")).strip(),
        release_date=str(description.get("releaseDate", ""))[:10],
        sha256=hashlib.sha256(raw).hexdigest(),
        years=collect("years", lambda d: int(d)),
        quarters=collect("quarters", _quarter_key),
        months=collect("months", _month_key),
    )


def fiscal_label(start: int) -> str:
    """2024 -> "2024-25"."""
    return f"{start}-{str(start + 1)[-2:]}"


def fiscal_sum(quarters: dict) -> dict:
    """Fiscal-year totals: Q2, Q3 and Q4 of one year and Q1 of the next.

    Only complete fiscal years are returned.
    """
    starts = sorted({int(k[:4]) for k in quarters})
    out = {}
    for y in starts:
        keys = [f"{y}Q2", f"{y}Q3", f"{y}Q4", f"{y + 1}Q1"]
        if all(k in quarters for k in keys):
            out[fiscal_label(y)] = sum(quarters[k] for k in keys)
    return out


def fiscal_end_march(months: dict) -> dict:
    """A stock's fiscal-year value: its level at the end of March."""
    out = {}
    for key, value in months.items():
        year, month = key.split("-")
        if month == "03":
            out[fiscal_label(int(year) - 1)] = value
    return out


def calendar_from_quarters(quarters: dict, how: str = "mean") -> dict:
    """Calendar-year mean or sum of four quarters (complete years only)."""
    out = {}
    for y in sorted({int(k[:4]) for k in quarters}):
        keys = [f"{y}Q{q}" for q in range(1, 5)]
        if all(k in quarters for k in keys):
            total = sum(quarters[k] for k in keys)
            out[y] = total / 4 if how == "mean" else total
    return out


def growth(levels: dict) -> dict:
    """Percentage change on the previous period, for consecutive keys."""
    keys = sorted(levels)
    out = {}
    for prev, key in zip(keys, keys[1:]):
        if levels[prev]:
            out[key] = (levels[key] / levels[prev] - 1) * 100
    return out
