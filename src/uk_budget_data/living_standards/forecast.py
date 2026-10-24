"""Load a new OBR forecast into the outlook's ``post`` series.

``uk-budget-data obr-forecast --efo <economy tables xlsx>`` reads every OBR
series the Forecast changes sub-tab shows from the new EFO's detailed
forecast tables (:func:`.obr.read_forecast`), recomputes the two
PolicyEngine-derived series from it, and writes:

- data_inputs/living_standards/obr_forecast_post.json, the loaded forecast,
  so a later ``uk-budget-data living-standards`` keeps it;
- the ``forecast`` block of public/data/living_standards_outlook.json, with
  ``post_published: true``, the post label and the source (file name,
  sha256, OBR page); nothing else in the file changes.

The derived series:

- CPI after housing costs: policyengine-uk's series is a PolicyEngine
  derivation (ONS ad hoc 2863 definition) that cannot be rebuilt from the
  EFO tables, so its post value is the pre-Budget value moved by the change
  in OBR CPI for the same year. The series' source says so.
- Social rent: the England rent cap, CPI + 1%, applied from April. Year Y
  takes the OBR calendar-year CPI for Y-1 (rounded to 1 d.p.) + 1 point,
  as policyengine-uk does; 2026 is set by September 2025 CPI outturn
  (3.8%), so it keeps its pre-Budget value.

This changes only the page's forecast series. The model's own uprating
(the national results, and every projection on the Baseline outlook) uses
the OBR forecast in the policyengine-uk release the bundle pins, and
changes only with a new policyengine-uk release.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from uk_budget_data.living_standards.obr import (
    CARRIED_YEARS,
    OBR_SERIES,
    ForecastTableError,
    read_forecast,
    sha256_file,
)

POST_FILE_NAME = "obr_forecast_post.json"
DEFAULT_POST_LABEL = "OBR October 2026 (Autumn Budget)"
OBR_FORECAST_URL = "https://obr.uk/efo/"

# Where the pre-Budget series come from (policyengine-uk's parameters).
PRE_SOURCE = {
    "release": "OBR Economic and fiscal outlook, March 2026",
    "url": "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
    "via": (
        "policyengine-uk parameters "
        "gov.economic_assumptions.yoy_growth.obr.*"
    ),
}

SOCIAL_RENT_FIXED_YEAR = 2026  # set by September 2025 CPI outturn


def _series_by_key(forecast: dict) -> dict:
    return {s["key"]: s for sec in forecast["sections"] for s in sec["series"]}


def _pre(series: dict) -> dict[int, float]:
    return {int(p["year"]): p["value"] for p in series["pre"]}


def compute_post(forecast: dict, parsed: dict) -> dict:
    """Post values (fractions by year) and source per series key.

    Raises ForecastTableError naming every series and year it lacks, beyond
    the gaps CARRIED_YEARS allows.
    """
    by_key = _series_by_key(forecast)
    missing_keys = [k for k in by_key if k not in parsed] + [
        k for k in (s.key for s in OBR_SERIES) if k not in by_key
    ]
    derived = {"cpi_ahc", "social_rent"}
    missing_keys = [k for k in missing_keys if k not in derived]
    if missing_keys:
        raise ForecastTableError(
            "Series in the outlook with no reader, or read but not in the "
            f"outlook: {', '.join(sorted(missing_keys))}"
        )
    out, gaps = {}, []
    for key, series in by_key.items():
        if key in derived:
            continue
        pre = _pre(series)
        values = {}
        carried = []
        for year in pre:
            value = parsed[key].values.get(year)
            if value is None:
                if key in CARRIED_YEARS and year == max(pre):
                    values[year] = pre[year]
                    carried.append(year)
                    continue
                gaps.append(f"{key} {year}")
                continue
            values[year] = value
        source = parsed[key].source
        if carried:
            years = ", ".join(str(y) for y in carried)
            source += (
                f"; {years} kept at the pre-Budget value: "
                f"{CARRIED_YEARS[key][0]}"
            )
        out[key] = {"values": values, "source": source, "carried": carried}
    if gaps:
        raise ForecastTableError(
            "No value in the new forecast for: " + ", ".join(gaps)
        )

    cpi_pre = _pre(by_key["cpi"])
    cpi_post = out["cpi"]["values"]
    if "cpi_ahc" in by_key:
        pre = _pre(by_key["cpi_ahc"])
        out["cpi_ahc"] = {
            "values": {
                y: round(pre[y] + (cpi_post[y] - cpi_pre[y]), 4) for y in pre
            },
            "source": (
                "PolicyEngine approximation: the pre-Budget CPI after housing "
                "costs moved by the change in OBR CPI for the same year (not "
                "an OBR series)"
            ),
            "carried": [],
        }
    if "social_rent" in by_key:
        pre = _pre(by_key["social_rent"])
        values = {}
        for y in pre:
            if y <= SOCIAL_RENT_FIXED_YEAR:
                values[y] = pre[y]
                continue
            cpi = cpi_post.get(y - 1)
            if cpi is None:
                raise ForecastTableError(
                    f"social_rent {y}: no OBR CPI for {y - 1} in the "
                    "new forecast"
                )
            values[y] = round(round(cpi * 100, 1) / 100 + 0.01, 4)
        out["social_rent"] = {
            "values": values,
            "source": (
                "England social rent policy cap: OBR calendar-year CPI for "
                "the year before + 1%; 2026 set by September 2025 CPI "
                "outturn (not an OBR forecast)"
            ),
            "carried": [],
        }
    return out


def load_post(efo: Path, label: str, url: str = OBR_FORECAST_URL) -> dict:
    """Read the EFO into the post document saved in data_inputs."""
    return {
        "label": label,
        "source": {
            "release": label,
            "file": Path(efo).name,
            "file_sha256": sha256_file(Path(efo)),
            "url": url,
        },
        "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def apply_post(outlook: dict, post: Optional[dict]) -> dict:
    """Set the outlook's forecast block from a post document (or none).

    With no post document, post repeats pre and post_published is false.
    """
    forecast = outlook["forecast"]
    forecast["pre_source"] = dict(PRE_SOURCE)
    by_key = _series_by_key(forecast)
    if post is None:
        forecast["post_published"] = False
        forecast["post_source"] = None
        for s in by_key.values():
            s["post"] = [dict(p) for p in s["pre"]]
            s.pop("post_source", None)
        return outlook
    forecast["post_published"] = True
    forecast["post_label"] = post["label"]
    forecast["post_source"] = dict(post["source"])
    for key, s in by_key.items():
        series = post["series"][key]
        s["post"] = [
            {"year": p["year"], "value": series["values"][p["year"]]}
            for p in s["pre"]
        ]
        s["post_source"] = series["source"]
    return outlook


def read_post_document(efo: Path, outlook: dict, label: str, url: str):
    """Parse the EFO for every series in the outlook's forecast block."""
    forecast = outlook["forecast"]
    years = sorted(
        {
            int(p["year"])
            for s in _series_by_key(forecast).values()
            for p in s["pre"]
        }
    )
    # Social rent for year Y needs CPI for Y-1.
    parsed = read_forecast(efo, [years[0] - 1, *years])
    computed = compute_post(forecast, parsed)
    doc = load_post(efo, label, url)
    doc["series"] = {
        key: {
            "values": {str(y): v for y, v in c["values"].items()},
            "source": c["source"],
            "carried": [str(y) for y in c["carried"]],
        }
        for key, c in computed.items()
    }
    return doc


def save_post(doc: dict, path: Path) -> None:
    path.write_text(json.dumps(doc, indent=2) + "\n")


def read_saved_post(path: Path) -> Optional[dict]:
    return json.loads(path.read_text()) if path.exists() else None
