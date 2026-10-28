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
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from uk_budget_data.living_standards.obr import (
    CARRIED_YEARS,
    NOT_IN_PDF_TABLE_A1,
    OBR_SERIES,
    ForecastTableError,
    read_forecast,
    read_pdf_table_a1,
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

# meta.notes' line from the build while no later forecast is loaded
STALE_POST_NOTE = (
    "Until a later OBR forecast is loaded, the post series repeat the "
    "March 2026 forecast."
)

SOCIAL_RENT_FIXED_YEAR = 2026  # set by September 2025 CPI outturn


def _series_by_key(forecast: dict) -> dict:
    return {s["key"]: s for sec in forecast["sections"] for s in sec["series"]}


def _pre(series: dict) -> dict[int, float]:
    return {int(p["year"]): p["value"] for p in series["pre"]}


def compute_post(
    forecast: dict, parsed: dict, absent: Optional[dict] = None
) -> dict:
    """Post values (fractions by year) and source per series key.

    ``absent`` maps a series key the source does not carry to why (the
    EFO PDF's Table A.1 has no CPIH, for example): that series gets
    ``values: None`` and the reason as its source. Any other series must be
    read. Raises ForecastTableError naming every series and year it lacks,
    beyond the gaps CARRIED_YEARS allows.
    """
    absent = absent or {}
    by_key = _series_by_key(forecast)
    missing_keys = [
        k for k in by_key if k not in parsed and k not in absent
    ] + [k for k in (s.key for s in OBR_SERIES) if k not in by_key]
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
        if key in absent and key not in parsed:
            out[key] = {"values": None, "source": absent[key], "carried": []}
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
            # The year before may precede the years shown (2026 for 2027):
            # read_post_document reads it from the EFO too.
            cpi = cpi_post.get(y - 1)
            if cpi is None and "cpi" in parsed:
                cpi = parsed["cpi"].values.get(y - 1)
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


def check_pre_is_march(forecast: dict, efo: Path) -> None:
    """Refuse a forecast block whose pre series are not the March 2026 EFO.

    ``efo`` is the committed March 2026 economy tables
    (data_inputs/living_standards/, obr.EFO_FILE_NAME). Every OBR series
    must read back exactly from it; the two PolicyEngine-derived series and
    the years CARRIED_YEARS allows are not in it. So a build that took
    ``pre`` from a patched forecast (with_forecast's October 2026 CPI, for
    example) fails here instead of drawing October as March.
    """
    years = sorted(
        {int(p["year"]) for s in _series_by_key(forecast).values() for p in s["pre"]}
    )
    computed = compute_post(forecast, read_forecast(efo, [years[0] - 1, *years]))
    wrong = [
        key
        for key, series in _series_by_key(forecast).items()
        if key in computed and computed[key]["values"] != _pre(series)
    ]
    if wrong:
        raise ForecastTableError(
            "The pre-Budget series are not the OBR March 2026 forecast: "
            + ", ".join(sorted(wrong))
        )


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
    # The build's note that post repeats pre stops being true
    notes = outlook.get("meta", {}).get("notes")
    if notes and STALE_POST_NOTE in notes:
        outlook["meta"]["notes"] = [n for n in notes if n != STALE_POST_NOTE]
    forecast["post_label"] = post["label"]
    forecast["post_source"] = dict(post["source"])
    for key, s in by_key.items():
        series = post["series"][key]
        # A series the loaded forecast does not carry: no post line, and
        # post_source says why
        s["post"] = (
            None
            if series["values"] is None
            else [
                {"year": p["year"], "value": series["values"][p["year"]]}
                for p in s["pre"]
            ]
        )
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
    doc["series"] = _doc_series(computed)
    return doc


def _years(outlook: dict) -> list[int]:
    return sorted(
        {
            int(p["year"])
            for s in _series_by_key(outlook["forecast"]).values()
            for p in s["pre"]
        }
    )


def _doc_series(computed: dict) -> dict:
    return {
        key: {
            "values": (
                None
                if c["values"] is None
                else {str(y): v for y, v in c["values"].items()}
            ),
            "source": c["source"],
            "carried": [str(y) for y in c["carried"]],
        }
        for key, c in computed.items()
    }


def read_post_document_from_pdf(
    pdf: Path, text: Path, outlook: dict, label: str, url: str
) -> dict:
    """The post document from the EFO PDF's Table A.1, before the tables.

    ``text`` is the PDF's text extract (one cell a line, pages marked
    ``=====PAGE n``), committed beside the PDF. Table A.1 carries CPI, RPI,
    average weekly earnings and house prices; the series it lacks
    (NOT_IN_PDF_TABLE_A1) get no post line until ``--efo`` loads the
    detailed forecast tables, which replace this document.
    """
    years = _years(outlook)
    parsed, page = read_pdf_table_a1(
        Path(text).read_text(), [years[0] - 1, *years]
    )
    absent = {
        key: (
            f"{label}: not in the EFO PDF's Table A.1; the OBR's {name} "
            "forecast is in the detailed forecast tables (economy), not yet "
            "loaded"
        )
        for key, name in NOT_IN_PDF_TABLE_A1.items()
    }
    computed = compute_post(outlook["forecast"], parsed, absent)
    doc = load_post(pdf, label, url)
    when = re.search(r"[A-Z][a-z]+ \d{4}", label)
    doc["source"]["release"] = (
        "OBR Economic and fiscal outlook"
        + (f", {when.group(0)}" if when else "")
        + ": Table A.1, Economy forecast"
    )
    doc["source"]["table"] = f"Table A.1: Economy forecast, PDF page {page}"
    doc["source"]["text_extract"] = Path(text).name
    doc["source"]["text_extract_sha256"] = sha256_file(Path(text))
    doc["series"] = _doc_series(computed)
    return doc


def save_post(doc: dict, path: Path) -> None:
    path.write_text(json.dumps(doc, indent=2) + "\n")


def read_saved_post(path: Path) -> Optional[dict]:
    return json.loads(path.read_text()) if path.exists() else None
