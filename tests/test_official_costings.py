"""Tests for the official costings export the page's comparison reads."""

import json

import pytest

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.official_costings import (
    SCHEMA,
    main,
    official_costings,
)
from uk_budget_data.publication.reconcile import (
    MappingRow,
    ReconciliationInputError,
    SourceRow,
    fiscal_year_label,
)

DIGEST = "a" * 64


def entry(years=(2026, 2027)):
    return {
        "name": "A measure",
        "status": "provisional",
        "artifact": "artifacts/m/aaaa",
        "outputs_sha256": DIGEST,
        "receipt_sha256": DIGEST,
        "execution_identity_sha256": DIGEST,
        "artifact_sha256": DIGEST,
        "years": list(years),
    }


def manifest(**measures):
    return m.Manifest.model_validate(
        {"schema": m.SCHEMA, "measures": measures}
    )


def source(year, value, basis="static_costing", row_id="1"):
    return SourceRow("S", row_id, fiscal_year_label(year), value, basis)


def test_both_bases_by_year_under_the_manifest_key():
    doc = official_costings(
        manifest(rate=entry()),
        [
            source(2026, -1.0),
            source(2026, -0.8, "post_behavioural"),
            source(2027, -1.2),
        ],
        [MappingRow("rate", "S", "1")],
    )
    assert doc["schema"] == SCHEMA
    assert doc["release"] == m.CURRENT_RELEASE
    assert doc["budget"] == m.CURRENT_BUDGET
    assert doc["measures"] == {
        "rate": {
            "years": {
                "2026": {"static_costing": -1.0, "post_behavioural": -0.8},
                "2027": {"static_costing": -1.2, "post_behavioural": None},
            }
        }
    }


def test_rows_sum_with_scale_and_a_partial_sum_is_null():
    doc = official_costings(
        manifest(rate=entry()),
        [source(2026, 1.0), source(2026, 0.5, row_id="2"), source(2027, 1.0)],
        [
            MappingRow("rate", "S", "1"),
            MappingRow("rate", "S", "2", scale=0.5, reviewer="R", reason="x"),
        ],
    )
    years = doc["measures"]["rate"]["years"]
    assert years["2026"]["static_costing"] == pytest.approx(1.25)
    # Row 2 has no 2027 figure yet: no partial sum is shown
    assert "2027" not in years


def test_only_manifest_measures_and_never_not_comparable_ones():
    doc = official_costings(
        manifest(rate=entry(), other=entry()),
        [source(2026, 1.0)],
        [
            MappingRow("not_in_manifest", "S", "1"),
            MappingRow(
                "other",
                "S",
                "1",
                status="not_comparable",
                reason="r",
                reviewer="R",
            ),
        ],
    )
    assert doc["measures"] == {}


def test_no_mapping_no_entry():
    doc = official_costings(manifest(rate=entry()), [source(2026, 1.0)], [])
    assert doc["measures"] == {}


def test_a_figure_entered_twice_is_refused():
    with pytest.raises(ReconciliationInputError):
        official_costings(
            manifest(rate=entry()),
            [source(2026, 1.0), source(2026, 2.0)],
            [MappingRow("rate", "S", "1")],
        )


def test_cli_writes_the_file(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "manifest.json").write_text(
        json.dumps({"schema": m.SCHEMA, "measures": {"rate": entry()}})
    )
    inputs = tmp_path / "treasury"
    (inputs / "sources").mkdir(parents=True)
    (inputs / "sources" / "S.csv").write_text(
        "source_id,document,table,row_id,row_label,fiscal_year,value_bn,"
        "basis,sign_convention,head,notes\n"
        "S,Budget,costings,7,Rate,2026-27,-1.5,static_costing,"
        "exchequer_positive,tax,\n"
        "S,Budget,costings,7,Rate,2027-28,,static_costing,"
        "exchequer_positive,tax,\n"
    )
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,"
        "reviewer\nrate,S,7,,,,,\n"
    )
    assert main(["--data-root", str(data), "--inputs", str(inputs)]) == 0
    doc = json.loads((data / "official_costings.json").read_text())
    assert doc["measures"]["rate"]["years"] == {
        "2026": {"static_costing": -1.5, "post_behavioural": None}
    }


def test_cli_refuses_without_a_manifest(tmp_path):
    (tmp_path / "treasury" / "sources").mkdir(parents=True)
    assert (
        main(
            [
                "--data-root",
                str(tmp_path),
                "--inputs",
                str(tmp_path / "treasury"),
            ]
        )
        == 2
    )


def test_a_year_classified_not_comparable_says_so_with_its_reason():
    reason = "Allowance ends 5 April 2030; timing after the end"
    doc = official_costings(
        manifest(rate=entry(years=(2029, 2030))),
        [
            source(2029, -0.15, "post_behavioural"),
            source(2030, 0.05, "post_behavioural"),
        ],
        [
            MappingRow(
                "rate",
                "S",
                "1",
                not_comparable_years=("2030-31",),
                reason=reason,
                reviewer="vahid-ahmadi",
            )
        ],
    )
    assert doc["measures"]["rate"]["years"] == {
        "2029": {"static_costing": None, "post_behavioural": -0.15},
        "2030": {
            "static_costing": None,
            "post_behavioural": None,
            "not_comparable": {"reason": reason},
        },
    }


def test_a_measure_not_comparable_in_every_year_it_reports_is_left_out():
    doc = official_costings(
        manifest(rate=entry(years=(2030,))),
        [source(2030, 0.05, "post_behavioural")],
        [
            MappingRow(
                "rate",
                "S",
                "1",
                not_comparable_years=("2030-31",),
                reason="Timing",
                reviewer="R",
            )
        ],
    )
    assert doc["measures"] == {}
