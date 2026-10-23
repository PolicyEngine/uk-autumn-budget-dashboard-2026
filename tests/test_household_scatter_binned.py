"""The binned household scatter: ``generate --only household_scatter``.

The page publishes the scatter binned only (#30). On Microcosm several
records come from one survey household, so a cell's floor counts survey
households, not records.
"""

import numpy as np
import pandas as pd
import pytest

from uk_budget_data.models import Reform
from uk_budget_data.publication.tables import (
    SCATTER_MIN_HOUSEHOLDS,
    TABLES,
    bin_scatter,
)


def _row(survey, **overrides):
    row = {
        "reform_id": "a",
        "reform_name": "A",
        "year": 2027,
        "baseline_income": 20_100.0,
        "income_change": -50.0,
        "household_weight": 100.0,
        "survey_household": survey,
    }
    row.update(overrides)
    return row


def test_records_from_few_survey_households_are_left_out():
    # Many records, but from one fewer survey household than the floor
    rows = [
        _row(survey % (SCATTER_MIN_HOUSEHOLDS - 1))
        for survey in range(5 * SCATTER_MIN_HOUSEHOLDS)
    ]
    assert bin_scatter(rows) == []


def test_enough_survey_households_publish_the_cell():
    rows = [_row(survey) for survey in range(SCATTER_MIN_HOUSEHOLDS)]
    (cell,) = bin_scatter(rows)
    assert cell["households"] == 1_000.0
    assert "survey_household" not in cell


def test_rows_that_mix_survey_ids_and_none_are_refused():
    rows = [_row(survey) for survey in range(SCATTER_MIN_HOUSEHOLDS)]
    del rows[0]["survey_household"]
    with pytest.raises(ValueError, match="survey household"):
        bin_scatter(rows)


def test_rows_keep_households_from_zero_to_the_maximum_income():
    from uk_budget_data.pipeline import household_scatter_rows

    rows = household_scatter_rows(
        Reform(id="a", name="A"),
        2027,
        baseline_incomes=np.array([-10.0, 0.0, 150_000.0, 150_001.0]),
        reform_incomes=np.array([0.0, 50.0, 149_900.0, 150_001.0]),
        weights=np.array([1.0, 2.0, 3.0, 4.0]),
        survey_households=np.array([7, 8, 9, 10]),
        max_income=150_000,
    )
    assert [row["survey_household"] for row in rows] == [8, 9]
    assert [row["income_change"] for row in rows] == [50.0, -100.0]


def test_only_household_scatter_writes_one_binned_file(tmp_path, monkeypatch):
    """``generate --only household_scatter`` writes only the binned file,
    for every reform and year, with no household-level column."""
    from uk_budget_data import cli, pipeline

    households = 4 * SCATTER_MIN_HOUSEHOLDS
    built = []

    def build(dataset_path, scenario=None):
        built.append(scenario)
        return {"reformed": len(built) % 2 == 0}

    def values(simulation, variable, year):
        if variable == "household_weight":
            return np.full(households, 500.0)
        change = 120.0 if simulation["reformed"] else 0.0
        return np.full(households, 30_000.0 + change)

    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    monkeypatch.setattr(
        pipeline,
        "scatter_survey_households",
        lambda simulation, dataset: np.arange(households) // 2,
    )
    monkeypatch.setattr("uk_budget_data.geography.household_values", values)
    for module in (pipeline.data_limits, pipeline.model_limits):
        monkeypatch.setattr(module, "limits_touched", lambda *a, **k: [])
    monkeypatch.setattr(
        cli,
        "get_reforms_from_ids",
        lambda ids: [Reform(id=i, name=i.upper()) for i in ids],
    )
    (tmp_path / "winners_losers.csv").write_text("untouched\n")
    status = cli.main(
        [
            "generate",
            "--only",
            "household_scatter",
            "--reforms",
            "a",
            "b",
            "--years",
            "2027",
            "2028",
            "--output-dir",
            str(tmp_path),
        ]
    )
    assert status == 0
    assert len(built) == 4
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "household_scatter_binned.csv",
        "winners_losers.csv",
    ]
    assert (tmp_path / "winners_losers.csv").read_text() == "untouched\n"
    frame = pd.read_csv(tmp_path / "household_scatter_binned.csv")
    assert tuple(frame.columns) == tuple(
        TABLES["household_scatter_binned"].column_names
    )
    # One cell per reform and year: 20 survey households, 40 records
    assert len(frame) == 4
    assert set(frame["change_band"]) == {100.0}
    assert set(frame["households"]) == {20_000.0}
