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

The derived series are separate from the eight OBR-published series:

- The exact October workbook and reviewed native model/source select actual
  native CPI-AHC and social-rent inputs. Social rent uses statutory
  September CPI, not calendar-year average CPI. The model-input readback
  also records native per-capita GDP/non-labour income and their population
  basis without deriving them from historical chart values.
- A generic or future EFO gets explicitly labelled approximations for
  derived series; it never silently inherits installed October inputs.

This changes only the page's forecast series. The model's own uprating
(the national results, and every projection on the Baseline outlook) uses
the OBR forecast in the policyengine-uk release the bundle pins, and
changes only with a new policyengine-uk release.
"""

import copy
import json
import re
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from typing import Optional

from .historical_forecast import PRE_SOURCE
from .obr import (
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
NATIVE_OCTOBER_MODEL_VERSIONS = frozenset({"2.174.1"})
NATIVE_OCTOBER_SOURCE_URL = (
    "https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/"
)
OCTOBER_ECONOMY_SHA256 = (
    "96795d1747bb5a4978c7fb768689d5fd31f568e5223db8a94b1bd92ba7f6c118"
)

# meta.notes' line from the build while no later forecast is loaded
STALE_POST_NOTE = (
    "Until a later OBR forecast is loaded, the post series repeat the "
    "March 2026 forecast."
)

SOCIAL_RENT_FIXED_YEAR = 2026  # set by September 2025 CPI outturn
# September CPI outturns that set a later year's cap: April 2027 is
# September 2026 CPI (ONS D7G7, published 21 October 2026) + 1%, not a
# forecast.
PUBLISHED_SEPTEMBER_CPI = {2026: 0.035}


def _series_by_key(forecast: dict) -> dict:
    return {s["key"]: s for sec in forecast["sections"] for s in sec["series"]}


def _pre(series: dict) -> dict[int, float]:
    return {int(p["year"]): p["value"] for p in series["pre"]}


def compute_post(
    forecast: dict,
    parsed: dict,
    absent: Optional[dict] = None,
    published_september_cpi: Optional[dict] = None,
    model_cpi_ahc: Optional[dict] = None,
    model_social_rent: Optional[dict] = None,
    model_source: Optional[str] = None,
) -> dict:
    """Post values (fractions by year) and source per series key.

    ``absent`` maps a series key the source does not carry to why (the
    EFO PDF's Table A.1 has no CPIH, for example): that series gets
    ``values: None`` and the reason as its source. Any other series must be
    read. Raises ForecastTableError naming every series and year it lacks,
    beyond the gaps CARRIED_YEARS allows. ``published_september_cpi``
    (default PUBLISHED_SEPTEMBER_CPI) sets social rent where the September
    CPI behind it is published; the March check passes {}, since the March
    forecast was made before it. ``model_cpi_ahc`` and
    ``model_social_rent`` are explicit native readbacks supplied only after
    October workbook and model/source guards pass. A generic or future EFO
    uses labelled approximations, never installed October derivations.
    Historical March checks supply no native readbacks.
    """
    absent = absent or {}
    if published_september_cpi is None:
        published_september_cpi = PUBLISHED_SEPTEMBER_CPI
    model_cpi_ahc = model_cpi_ahc or {}
    model_social_rent = model_social_rent or {}
    if (model_cpi_ahc or model_social_rent) and not model_source:
        raise ForecastTableError(
            "Native derived readbacks require model/source provenance"
        )
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
        if model_cpi_ahc:
            missing = sorted(set(pre) - set(model_cpi_ahc))
            if missing:
                raise ForecastTableError(
                    f"Native cpi_ahc readback lacks years: {missing}"
                )
            values = {y: model_cpi_ahc[y] for y in pre}
            source = (
                f"Native {model_source}: "
                "create_ahc_deflator on the OBR's CPI and actual rents "
                "(Table 1.7) and Ofwat water bills (not an OBR series)"
            )
        else:
            values = {
                y: round(pre[y] + (cpi_post[y] - cpi_pre[y]), 4) for y in pre
            }
            source = (
                "PolicyEngine approximation: the pre-Budget CPI after "
                "housing costs moved by the change in OBR CPI for the same "
                "year (not an OBR series)"
            )
        out["cpi_ahc"] = {"values": values, "source": source, "carried": []}
    if "social_rent" in by_key:
        pre = _pre(by_key["social_rent"])
        if model_social_rent:
            missing = sorted(set(pre) - set(model_social_rent))
            if missing:
                raise ForecastTableError(
                    f"Native social_rent readback lacks years: {missing}"
                )
            out["social_rent"] = {
                "values": {y: model_social_rent[y] for y in pre},
                "source": (
                    f"Native {model_source}: England social rent policy cap, "
                    "previous September CPI + 1 percentage point. Published "
                    "September outturns and native statutory September CPI "
                    "forecasts from OBR receipts Table 4.19; not an "
                    "OBR-published social rent series."
                ),
                "carried": [],
            }
            return out
        values = {}
        for y in pre:
            if y <= SOCIAL_RENT_FIXED_YEAR:
                values[y] = pre[y]
                continue
            # The year before may precede the years shown (2026 for 2027):
            # read_post_document reads it from the EFO too.
            cpi = published_september_cpi.get(y - 1, cpi_post.get(y - 1))
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
                "PolicyEngine approximation of England social rent policy cap: September CPI + 1%; 2026 "
                "and 2027 set by the September 2025 and 2026 CPI outturns, "
                "later years by OBR calendar-year CPI for the year before "
                "(annual CPI is a proxy for future September CPI, not a native model readback or OBR social-rent forecast)"
            ),
            "carried": [],
        }
    return out


def native_model_forecast_inputs() -> dict:
    """Read the supported native model, never a dashboard overlay.

    Native per-capita GDP and non-labour-income paths retain the model's
    population basis; they are not reconstructed from historical inputs.
    """
    from uk_budget_data.forecast import NATIVE_FORECAST_PATHS, forecast_record

    installed = version("policyengine-uk")
    if installed not in NATIVE_OCTOBER_MODEL_VERSIONS:
        raise ForecastTableError(
            f"Native October readback is not reviewed for policyengine-uk {installed}"
        )
    record = forecast_record()
    expected_source = f"policyengine-uk {installed}: native OBR October 2026 inputs and the model's documented derived and carried series"
    if (
        record.get("model_version") != installed
        or record.get("mode") != "native"
        or record.get("vintage") != "OBR EFO October 2026"
        or record.get("source_url") != NATIVE_OCTOBER_SOURCE_URL
        or record.get("source") != expected_source
        or set(record.get("parameter_changes", {}))
        != set(NATIVE_FORECAST_PATHS)
    ):
        raise ForecastTableError(
            "The native October forecast source does not match the installed model's readback"
        )
    return {
        **record,
        "readback_basis": (
            "Point observations at 1 January of each calendar year, not "
            "parameter changes or complete annual schedules. Inputs that "
            "preserve calendar dates, including statutory forecast gaps, "
            "can change later in the year."
        ),
    }


def _native_series(record: dict, leaf: str) -> dict:
    path = "gov.economic_assumptions.yoy_growth.obr." + leaf
    return {
        int(key[:4]): value
        for key, value in record["parameter_changes"][path]["values"].items()
    }


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
        {
            int(p["year"])
            for s in _series_by_key(forecast).values()
            for p in s["pre"]
        }
    )
    computed = compute_post(
        forecast,
        read_forecast(efo, [years[0] - 1, *years]),
        published_september_cpi={},
        model_cpi_ahc={},
    )
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
        forecast.pop("model_inputs", None)
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
    if "model_inputs" in post:
        forecast["model_inputs"] = copy.deepcopy(post["model_inputs"])
    else:
        forecast.pop("model_inputs", None)
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
    doc = load_post(efo, label, url)
    native = (
        native_model_forecast_inputs()
        if doc["source"]["file_sha256"] == OCTOBER_ECONOMY_SHA256
        else None
    )
    computed = compute_post(
        forecast,
        parsed,
        model_cpi_ahc=(
            _native_series(native, "consumer_price_index_ahc")
            if native
            else {}
        ),
        model_social_rent=(
            _native_series(native, "social_rent") if native else {}
        ),
        model_source=(
            f"policyengine-uk {native['model_version']}" if native else None
        ),
    )
    if native:
        doc["model_inputs"] = {
            **native,
            "source_workbook": dict(doc["source"]),
        }
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
