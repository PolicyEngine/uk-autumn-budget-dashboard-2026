"""Native model-input provenance, without population or tax calculations."""

import copy
import json
from pathlib import Path

import pytest

from uk_budget_data import forecast as model_forecast
from uk_budget_data.living_standards import build, forecast
from uk_budget_data.living_standards.obr import ParsedSeries

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "data_inputs/living_standards"
OCTOBER = INPUTS / "efo-october-2026-detailed-forecast-tables-economy.xlsx"


def outlook():
    return json.loads(
        (ROOT / "public/data/living_standards_outlook.json").read_text()
    )


@pytest.fixture(scope="module")
def native_post():
    return forecast.read_post_document(
        OCTOBER,
        outlook(),
        "OBR October 2026 (Autumn Budget)",
        forecast.NATIVE_OCTOBER_SOURCE_URL,
    )


def test_exact_october_source_keeps_published_series_distinct_from_native_inputs(
    native_post,
):
    readback = native_post["model_inputs"]
    assert (
        native_post["source"]["file_sha256"] == forecast.OCTOBER_ECONOMY_SHA256
    )
    assert readback["source_workbook"] == native_post["source"]
    assert (
        readback["model_version"] == "2.174.1" and readback["mode"] == "native"
    )
    assert set(readback["parameter_changes"]) == set(
        model_forecast.NATIVE_FORECAST_PATHS
    )
    assert "1 January" in readback["readback_basis"]
    assert (
        "not parameter changes or complete annual schedules"
        in readback["readback_basis"]
    )
    # The published chart keeps its explicit rounding; the native model's
    # exact input is preserved separately, not substituted for the OBR row.
    assert native_post["series"]["cpi"]["values"]["2027"] == 0.034
    assert (
        readback["parameter_changes"][
            model_forecast.OBR + "consumer_price_index"
        ]["values"]["2027-01-01.2027-12-31"]
        == 0.0342
    )


def test_native_derived_inputs_match_the_actual_model_and_september_rule(
    native_post,
):
    parameters = model_forecast.forecast_parameters()
    series = native_post["series"]
    assert series["cpi_ahc"]["values"]["2027"] == 0.0341
    assert series["social_rent"]["values"]["2029"] == 0.03
    assert series["social_rent"]["values"]["2030"] == 0.032
    for year in (2029, 2030):
        september = parameters.gov.economic_assumptions.statutory_uprating_inputs.cpi_september(
            f"{year - 1}-09-01"
        )
        expected = round(round(september * 100, 1) / 100 + 0.01, 4)
        assert series["social_rent"]["values"][str(year)] == expected
    assert "September" in series["social_rent"]["source"]
    assert "not an OBR" in series["cpi_ahc"]["source"]
    for leaf in (
        "per_capita.gdp",
        "per_capita.non_labour_income",
        "consumer_price_index_ahc",
        "social_rent",
    ):
        path = model_forecast.OBR + leaf
        for interval, value in native_post["model_inputs"][
            "parameter_changes"
        ][path]["values"].items():
            assert value == parameters.get_child(path)(interval[:10])


def test_forecast_only_application_preserves_old_projection_metadata_and_march_inputs(
    native_post,
):
    original = outlook()
    applied = forecast.apply_post(copy.deepcopy(original), native_post)
    assert {k: v for k, v in applied.items() if k != "forecast"} == {
        k: v for k, v in original.items() if k != "forecast"
    }
    before = {
        s["key"]: s["pre"]
        for group in original["forecast"]["sections"]
        for s in group["series"]
    }
    after = {
        s["key"]: s["pre"]
        for group in applied["forecast"]["sections"]
        for s in group["series"]
    }
    assert before == after
    forecast.check_pre_is_march(
        applied["forecast"],
        INPUTS / "efo-march-2026-detailed-forecast-tables-economy.xlsx",
    )


def test_unknown_future_workbook_never_reuses_installed_october_derivations(
    tmp_path, monkeypatch
):
    synthetic = tmp_path / "synthetic-future-efo.xlsx"
    synthetic.write_bytes(b"Synthetic workbook marker; no real EFO values.")
    chart = outlook()
    keys = [s.key for s in forecast.OBR_SERIES]
    parsed = {
        key: ParsedSeries(
            key, {y: 0.05 for y in range(2026, 2031)}, "synthetic test series"
        )
        for key in keys
    }
    monkeypatch.setattr(forecast, "read_forecast", lambda *args: parsed)

    def forbidden():
        raise AssertionError(
            "An unknown EFO must not read installed October derivations"
        )

    monkeypatch.setattr(forecast, "native_model_forecast_inputs", forbidden)
    doc = forecast.read_post_document(
        synthetic,
        chart,
        "Synthetic future EFO",
        "https://example.invalid/synthetic",
    )
    assert "model_inputs" not in doc
    assert "approximation" in doc["series"]["cpi_ahc"]["source"]
    assert "proxy" in doc["series"]["social_rent"]["source"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("mode", "overlay"),
        ("model_version", "2.165.1"),
        ("source_url", "https://example.invalid/"),
        ("source", "unverified source"),
    ],
)
def test_native_readback_refuses_a_mismatched_source(
    native_post, monkeypatch, field, value
):
    record = copy.deepcopy(native_post["model_inputs"])
    record[field] = value
    monkeypatch.setattr(model_forecast, "forecast_record", lambda: record)
    with pytest.raises(
        forecast.ForecastTableError, match="source does not match"
    ):
        forecast.native_model_forecast_inputs()


def test_native_october_workbook_refuses_an_unreviewed_model(monkeypatch):
    monkeypatch.setattr(forecast, "version", lambda name: "2.165.1")
    with pytest.raises(forecast.ForecastTableError, match="not reviewed"):
        forecast.read_post_document(
            OCTOBER,
            outlook(),
            "OBR October 2026",
            forecast.NATIVE_OCTOBER_SOURCE_URL,
        )


def test_current_native_cpi_ahc_note_does_not_claim_a_pending_march_fix(
    monkeypatch,
):
    def forbidden(*args):
        raise AssertionError(
            "Native October must not compare to historical March correction literals"
        )

    monkeypatch.setattr(build, "cpi_ahc_2531_effect", forbidden)
    note = build.cpi_ahc_note([], 2031)
    assert "native model's October 2026" in note
    assert "would be" not in note and "#2531" not in note


def test_historical_march_correction_note_remains_explicitly_historical(
    monkeypatch,
):
    monkeypatch.setattr(build, "version", lambda name: "2.151.0")
    monkeypatch.setattr(build, "cpi_ahc_2531_effect", lambda *args: 0.05)
    synthetic = [
        {"year": "2027-28", "real": 100},
        {"year": "2031-32", "real": 110},
    ]
    assert "corrected index in policyengine-uk#2531" in build.cpi_ahc_note(
        synthetic, 2031
    )


@pytest.mark.parametrize("unreviewed", ["2.132.6", "2.165.1", "2.175.0"])
def test_an_unreviewed_model_cannot_fall_back_to_the_old_march_note(
    monkeypatch, unreviewed
):
    monkeypatch.setattr(build, "version", lambda name: unreviewed)
    monkeypatch.setattr(forecast, "version", lambda name: unreviewed)
    with pytest.raises(forecast.ForecastTableError, match="not reviewed"):
        build.cpi_ahc_note([], 2031)
