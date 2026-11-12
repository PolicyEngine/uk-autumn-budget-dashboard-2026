"""Read the historical March chart inputs without loading a current model.

The OBR workbook supplies its eight published series. Two model-derived
series and the missing annual mortgage-interest value come from explicit
dated literals in the archived model used by the published March chart.
Neither source depends on the engine installed for current projections.
"""

import math
from datetime import date
from pathlib import Path

import yaml

from .obr import (
    EFO_FILE_NAME,
    ForecastTableError,
    ParsedSeries,
    read_forecast,
    sha256_file,
)

MARCH_SHA256 = (
    "fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510"
)
MODEL_FILE_NAME = "policyengine-uk-2.151.0-yoy-growth.yaml"
MODEL_SHA256 = (
    "dae6875dab02126247b0be4381d5980139f36e77a2d16be8cff35afa4d028102"
)
MODEL_COMMIT = "455fe47cdfa3c8c5677408c1e38009f7d9d62630"
MODEL_PATH = (
    "policyengine_uk/parameters/gov/economic_assumptions/yoy_growth.yaml"
)
MODEL_URL = (
    "https://github.com/PolicyEngine/policyengine-uk/blob/"
    f"{MODEL_COMMIT}/{MODEL_PATH}"
)
PRE_SOURCE = {
    "release": "OBR Economic and fiscal outlook, March 2026",
    "url": "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/",
    "file": EFO_FILE_NAME,
    "file_sha256": MARCH_SHA256,
    "via": "committed March workbook and frozen historical model inputs",
    "model_inputs": {
        "policyengine_uk": "2.151.0",
        "commit": MODEL_COMMIT,
        "file": MODEL_FILE_NAME,
        "file_sha256": MODEL_SHA256,
        "url": MODEL_URL,
        "series": ["cpi_ahc", "social_rent", "mortgage_interest (2030 only)"],
    },
}


def _check_source(path: Path, expected: str) -> None:
    try:
        actual = sha256_file(path)
    except OSError as error:
        raise ForecastTableError(
            f"Missing historical March forecast source: {path.name}"
        ) from error
    if actual != expected:
        raise ForecastTableError(
            f"Historical March forecast source changed: {path.name}; "
            f"expected SHA-256 {expected}, got {actual}"
        )


def _literal(model: dict, key: str, year: int) -> float:
    try:
        value = model["obr"][key]["values"][date(year, 1, 1)]
    except (KeyError, TypeError) as error:
        raise ForecastTableError(
            f"Missing historical model input: obr.{key} {year}-01-01 "
            f"in {MODEL_FILE_NAME}"
        ) from error
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ForecastTableError(
            f"Historical model input is not a numeric literal: obr.{key} "
            f"{year}-01-01 in {MODEL_FILE_NAME}"
        )
    return float(value)


def read_historical_march_pre(
    inputs_dir: Path, years: list[int]
) -> dict[str, ParsedSeries]:
    """Read the chart's 2027-2030 pre series from hash-bound source inputs.

    Do not evaluate formulas, extend a dated value, or use an installed
    model when a source or an explicit historical value is absent.
    """
    if not years or any(year not in range(2027, 2031) for year in years):
        raise ForecastTableError(
            "Historical March chart inputs cover only 2027-2030; "
            f"requested {years}"
        )
    workbook = Path(inputs_dir) / EFO_FILE_NAME
    model_file = Path(inputs_dir) / MODEL_FILE_NAME
    _check_source(workbook, MARCH_SHA256)
    _check_source(model_file, MODEL_SHA256)
    model = yaml.safe_load(model_file.read_bytes())
    parsed = read_forecast(workbook, years)
    for key, series in parsed.items():
        for year in years:
            if series.values.get(year) is not None:
                continue
            if key == "mortgage_interest" and year == 2030:
                series.values[year] = _literal(model, key, year)
                series.source += (
                    "; 2030: explicit input in policyengine-uk 2.151.0, "
                    "carried from the November 2025 EFO, not a March value"
                )
            else:
                raise ForecastTableError(
                    f"Missing historical March forecast input: {key} {year}"
                )
    for key, leaf in (
        ("cpi_ahc", "consumer_price_index_ahc"),
        ("social_rent", "social_rent"),
    ):
        parsed[key] = ParsedSeries(
            key=key,
            values={year: _literal(model, leaf, year) for year in years},
            source=(
                f"Historical policyengine-uk 2.151.0 input obr.{leaf}; "
                f"{MODEL_URL} (not an OBR-published series)"
            ),
        )
    return parsed
