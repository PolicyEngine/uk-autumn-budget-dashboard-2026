"""Withheld decile values remain blank through publication's contracts."""

import json
from dataclasses import replace

import pytest

from tests.publication_support import World, make_tables
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import receipt as receipt_module
from uk_budget_data.publication.artifacts import (
    capture,
    captured_file_problems,
)
from uk_budget_data.publication.disclosure_floor import (
    floor_record,
    withhold_decile_rows,
)
from uk_budget_data.publication.publish import approve, gate_problems, stage
from uk_budget_data.publication.tables import (
    TableError,
    canonical_csv,
    parse_csv,
)
from uk_budget_data.publication.validate import (
    table_problems,
    withheld_file_problems,
    withholding_problems,
)

YEAR = 2027
WITHHELD = {
    ("distributional_impact", YEAR): ["1"],
    ("winners_losers", YEAR): ["1", "all"],
}


def withheld_tables():
    tables = make_tables("alpha", {YEAR: -1.0})
    for table in ("distributional_impact", "winners_losers"):
        tables[table] = withhold_decile_rows(tables[table], table, WITHHELD)
    return tables


def record():
    return floor_record({}, withheld=WITHHELD)


def test_withheld_rows_round_trip_as_blanks_and_stay_complete():
    tables = withheld_tables()
    assert table_problems(tables, key="alpha", years=[YEAR]) == []
    assert withholding_problems(tables, record()) == []
    for table, column in (
        ("distributional_impact", "value"),
        ("winners_losers", "avg_change"),
    ):
        data = canonical_csv(table, tables[table])
        assert b"None" not in data
        assert b"nan" not in data
        rows = parse_csv(table, data)
        assert any(row[column] is None for row in rows)
        assert canonical_csv(table, rows) == data


def test_nulls_are_allowed_only_in_decile_value_columns():
    tables = make_tables("alpha", {YEAR: -1.0})
    tables["budgetary_impact"][0]["value"] = None
    with pytest.raises(TableError, match="missing value"):
        canonical_csv("budgetary_impact", tables["budgetary_impact"])
    tables = withheld_tables()
    tables["distributional_impact"][0]["year"] = None
    with pytest.raises(TableError, match="missing value"):
        canonical_csv("distributional_impact", tables["distributional_impact"])


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
@pytest.mark.parametrize(
    "table,column",
    [("distributional_impact", "value"), ("winners_losers", "avg_change")],
)
def test_nullable_decile_values_still_refuse_nonfinite_numbers(
    value, table, column
):
    rows = make_tables("alpha", {YEAR: -1.0})[table]
    rows[0][column] = value
    with pytest.raises(TableError, match="missing value|not finite"):
        canonical_csv(table, rows)


def test_blank_cells_need_receipt_authorization_and_all_complement():
    tables = withheld_tables()
    assert any(
        "without a recorded withholding" in item
        for item in withholding_problems(tables, {})
    )
    floor = record()
    floor["withheld_cells"][1]["groups"].remove("all")
    assert (
        f"winners_losers {YEAR} all must be withheld too"
        in withholding_problems(tables, floor)
    )


@pytest.mark.parametrize(
    "cells",
    [None, {}, [None], [{"table": "metrics", "year": YEAR, "groups": ["1"]}]],
)
def test_malformed_withholding_records_are_refused(cells):
    assert withholding_problems({}, {"withheld_cells": cells})


def test_a_bound_artifact_with_withheld_cells_can_be_staged_and_approved(
    monkeypatch,
):
    original = receipt_module.build_receipt_document
    monkeypatch.setattr(
        receipt_module,
        "build_receipt_document",
        lambda baseline, reformed, inputs: original(
            baseline, reformed, replace(inputs, disclosure_floor=record())
        ),
    )
    world = World()
    try:
        reference = world.ready(
            "alpha", {YEAR: -1.0}, tables=withheld_tables()
        )
        manifest = m.Manifest()
        arguments = dict(data_root=world.data_root, inputs=world.inputs)
        stage(manifest, reference.path, **arguments)
        approve(manifest, "alpha", "Reviewer", **arguments)
        assert manifest.measures["alpha"].status == m.APPROVED
        (reference.path / "distributional_impact.json").write_text("[]\n")
        assert (
            "distributional_impact.json is present but not receipted"
            in captured_file_problems(capture(reference.path))
        )
    finally:
        world.close()


@pytest.mark.parametrize(
    "table,column",
    [("distributional_impact", "value"), ("winners_losers", "avg_change")],
)
def test_all_gate_levels_refuse_a_receipted_value_in_a_withheld_cell(
    monkeypatch, table, column
):
    original = receipt_module.build_receipt_document
    monkeypatch.setattr(
        receipt_module,
        "build_receipt_document",
        lambda baseline, reformed, inputs: original(
            baseline, reformed, replace(inputs, disclosure_floor=record())
        ),
    )
    tables = withheld_tables()
    next(row for row in tables[table] if row["decile"] in ("1st", "1"))[
        column
    ] = 0.0
    world = World()
    try:
        reference = world.ready("alpha", {YEAR: -1.0}, tables=tables)
        for level in (m.STAGED, m.PROVISIONAL, m.APPROVED):
            problems, _ = gate_problems(
                "alpha",
                reference.path,
                m.Manifest(),
                level=level,
                data_root=world.data_root,
                inputs=world.inputs,
            )
            assert any(
                "publishes a value in a withheld cell" in item
                for item in problems
            )
    finally:
        world.close()


def test_public_receipt_checks_both_csv_and_json_even_when_csv_is_blank(
    tmp_path,
):
    tables = withheld_tables()
    for table in WITHHELD:
        name = table[0]
        (tmp_path / f"{name}.csv").write_bytes(
            canonical_csv(name, tables[name])
        )
    document = {"dashboard": {"disclosure_floor": record()}}
    assert withheld_file_problems(tmp_path, document) == []
    next(
        row
        for row in tables["distributional_impact"]
        if row["decile"] == "1st"
    )["value"] = 0.0
    (tmp_path / "distributional_impact.json").write_text(
        json.dumps(tables["distributional_impact"])
    )
    assert any(
        "publishes a value in a withheld cell" in item
        for item in withheld_file_problems(tmp_path, document)
    )
