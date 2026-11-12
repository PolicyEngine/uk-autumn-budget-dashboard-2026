"""Historical input checks that load no PolicyEngine package or model.

Run locally with --noconftest: the repository conftest initializes models.
The file loader isolates these pure readers from uk_budget_data.__init__.
"""

import builtins
import copy
import importlib.util
import sys
import types
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "data_inputs/living_standards"
SOURCE = ROOT / "src/uk_budget_data/living_standards"
YEARS = [2027, 2028, 2029, 2030]


@pytest.fixture
def readers(monkeypatch):
    original_import = builtins.__import__

    def without_models(name, *args, **kwargs):
        if name.startswith(("policyengine", "uk_budget_data")):
            raise AssertionError(f"Historical reader imported {name}")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_models)
    package_name = "_historical_forecast_pure_tests"
    package = types.ModuleType(package_name)
    package.__path__ = [str(SOURCE)]
    monkeypatch.setitem(sys.modules, package_name, package)

    def load(name):
        qualified = f"{package_name}.{name}"
        spec = importlib.util.spec_from_file_location(
            qualified, SOURCE / f"{name}.py"
        )
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, qualified, module)
        spec.loader.exec_module(module)
        return module

    return load("historical_forecast"), load("forecast")


def test_march_inputs_keep_the_historical_forecast_without_a_current_model(
    readers,
):
    historical, _ = readers
    result = historical.read_historical_march_pre(INPUTS, YEARS)
    expected = {
        "cpi": [0.02, 0.02, 0.02, 0.02],
        "cpih": [0.0211, 0.0204, 0.0209, 0.0212],
        "rpi": [0.03, 0.028, 0.029, 0.023],
        "earnings": [0.024, 0.021, 0.022, 0.024],
        "non_labour_income": [0.0513, 0.035, 0.0301, 0.0317],
        "house_prices": [0.029, 0.027, 0.026, 0.024],
        "rent": [0.0302, 0.023, 0.0238, 0.0258],
        "mortgage_interest": [0.104, 0.0476, 0.0468, 0.0553],
        "cpi_ahc": [0.0188, 0.0194, 0.0194, 0.0192],
        "social_rent": [0.033, 0.03, 0.03, 0.03],
    }
    assert set(result) == set(expected)
    for key, values in expected.items():
        assert [result[key].values[y] for y in YEARS] == values
    assert "not a March value" in result["mortgage_interest"].source
    assert "not an OBR-published series" in result["cpi_ahc"].source
    assert historical.MODEL_COMMIT in result["social_rent"].source


def test_the_existing_march_guard_accepts_the_reader_and_still_refuses_october(
    readers,
):
    historical, forecast = readers
    result = historical.read_historical_march_pre(INPUTS, YEARS)
    chart = {
        "sections": [
            {
                "series": [
                    {
                        "key": key,
                        "pre": [
                            {"year": str(y), "value": series.values[y]}
                            for y in YEARS
                        ],
                    }
                    for key, series in result.items()
                ]
            }
        ]
    }
    workbook = INPUTS / historical.EFO_FILE_NAME
    forecast.check_pre_is_march(chart, workbook)
    changed = copy.deepcopy(chart)
    cpi = next(
        s for s in changed["sections"][0]["series"] if s["key"] == "cpi"
    )
    cpi["pre"][0]["value"] = 0.034  # October 2027, not historical March.
    with pytest.raises(historical.ForecastTableError, match="cpi"):
        forecast.check_pre_is_march(changed, workbook)


@pytest.mark.parametrize(
    "filename",
    [
        "efo-march-2026-detailed-forecast-tables-economy.xlsx",
        "policyengine-uk-2.151.0-yoy-growth.yaml",
    ],
)
def test_changed_source_bytes_are_refused_before_reading(
    readers, tmp_path, filename
):
    historical, _ = readers
    for source in (historical.EFO_FILE_NAME, historical.MODEL_FILE_NAME):
        (tmp_path / source).write_bytes((INPUTS / source).read_bytes())
    (tmp_path / filename).write_bytes(b"Changed historical source")
    with pytest.raises(historical.ForecastTableError, match=filename):
        historical.read_historical_march_pre(tmp_path, YEARS)


def test_a_missing_historical_model_source_is_named_without_a_model_fallback(
    readers, tmp_path
):
    historical, _ = readers
    (tmp_path / historical.EFO_FILE_NAME).write_bytes(
        (INPUTS / historical.EFO_FILE_NAME).read_bytes()
    )
    with pytest.raises(
        historical.ForecastTableError, match=historical.MODEL_FILE_NAME
    ):
        historical.read_historical_march_pre(tmp_path, YEARS)


def test_missing_dated_literal_is_named_instead_of_extending_an_earlier_year(
    readers,
):
    historical, _ = readers
    model = {"obr": {"social_rent": {"values": {date(2026, 1, 1): 0.048}}}}
    with pytest.raises(
        historical.ForecastTableError, match="social_rent 2027-01-01"
    ):
        historical._literal(model, "social_rent", 2027)


@pytest.mark.parametrize(
    "value", ["formula()", {"value": 0.03}, True, float("nan")]
)
def test_formulas_or_nonfinite_values_are_not_historical_literals(
    readers, value
):
    historical, _ = readers
    model = {"obr": {"social_rent": {"values": {date(2027, 1, 1): value}}}}
    with pytest.raises(
        historical.ForecastTableError, match="not a numeric literal"
    ):
        historical._literal(model, "social_rent", 2027)


def test_future_years_require_an_explicit_new_historical_source(readers):
    historical, _ = readers
    with pytest.raises(historical.ForecastTableError, match="only 2027-2030"):
        historical.read_historical_march_pre(INPUTS, [2031])
