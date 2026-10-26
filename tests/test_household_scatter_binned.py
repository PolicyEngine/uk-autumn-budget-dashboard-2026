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
    SCATTER_INCOME_BASIS_YEAR,
    SCATTER_MIN_HOUSEHOLDS,
    TABLES,
    bin_scatter,
    scatter_basis_year,
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
    assert set(frame["change_band_upper"]) == {150.0}
    assert set(frame["households"]) == {20_000.0}
    assert set(frame["income_basis_year"]) == {2027}


def _synthetic_run(tmp_path, monkeypatch, years):
    """``generate --only household_scatter`` on a tiny synthetic survey.

    Two groups of 12 households. Group A earns £20,100 in 2027 and its
    income grows by £3,000 a year; group B earns £33,000 in 2027 and its
    income falls by £4,000 a year. By its own year's income, group A would
    move up from the £20,000 band and group B down from the £30,000 band.
    The reform's gain also changes from year to year, and so do weights.
    """
    from uk_budget_data import pipeline

    group = 12
    households = 2 * group
    start = np.array([20_100.0] * group + [33_000.0] * group)
    drift = np.array([3_000.0] * group + [-4_000.0] * group)

    built = []

    def build(dataset_path, scenario=None):
        # The baseline is built first, then the reform
        built.append(scenario)
        return {"reformed": len(built) % 2 == 0}

    def values(simulation, variable, year):
        step = year - 2027
        if variable == "household_weight":
            return np.full(households, 500.0 + 100.0 * step)
        income = start + drift * step
        if simulation["reformed"]:
            income = income + np.array([30.0 + 100.0 * step] * households)
        return income

    reform = Reform(id="a", name="A")
    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    monkeypatch.setattr(
        pipeline,
        "scatter_survey_households",
        lambda simulation, dataset: np.arange(households),
    )
    monkeypatch.setattr("uk_budget_data.geography.household_values", values)
    for module in (pipeline.data_limits, pipeline.model_limits):
        monkeypatch.setattr(module, "limits_touched", lambda *a, **k: [])
    config = pipeline.DataConfig(output_dir=tmp_path, years=years)
    return pipeline.generate_household_scatter(reforms=[reform], config=config)


def test_a_household_keeps_its_income_row_across_years(tmp_path, monkeypatch):
    frame = _synthetic_run(tmp_path, monkeypatch, [2027, 2028, 2029, 2030])
    rows = {
        year: sorted(
            zip(
                frame.loc[frame["year"] == year, "income_band"],
                frame.loc[frame["year"] == year, "households"],
            )
        )
        for year in (2027, 2028, 2029, 2030)
    }
    # Every year, the same two rows: the 2027 bands of groups A and B,
    # though by 2030 A earns £29,100 and B £21,000 ...
    for year, cells in rows.items():
        assert [band for band, _ in cells] == [20_000.0, 30_000.0], year
    # ... each holding its 12 households at that year's weight
    assert rows[2027] == [(20_000.0, 6_000.0), (30_000.0, 6_000.0)]
    assert rows[2030] == [(20_000.0, 10_000.0), (30_000.0, 10_000.0)]
    # The change still comes from each year's own incomes
    by_year = frame.set_index("year")["change_band"].groupby("year").first()
    assert by_year[2027] == 25.0 and by_year[2030] == 300.0
    assert set(frame["income_basis_year"]) == {2027}


def test_households_are_kept_by_their_basis_year_income(tmp_path, monkeypatch):
    from uk_budget_data.pipeline import household_scatter_rows

    rows = [
        row
        for year, base in (
            (2027, [100.0, 149_000.0]),
            (2028, [-50.0, 151_000.0]),
        )
        for row in household_scatter_rows(
            Reform(id="a", name="A"),
            year,
            baseline_incomes=np.array(base),
            reform_incomes=np.array(base) + 10.0,
            weights=np.array([1.0, 1.0]),
            survey_households=np.array([1, 2]),
            max_income=150_000,
            reference_incomes=np.array([100.0, 149_000.0]),
            basis_year=2027,
        )
    ]
    # Both households in both years, though in 2028 one is below £0 and
    # one above the maximum by their own incomes
    assert [(row["year"], row["survey_household"]) for row in rows] == [
        (2027, 1),
        (2027, 2),
        (2028, 1),
        (2028, 2),
    ]
    assert {row["income_basis_year"] for row in rows} == {2027}


def test_the_basis_year_is_2027_when_the_run_covers_it():
    assert SCATTER_INCOME_BASIS_YEAR == 2027
    assert scatter_basis_year([2026, 2027, 2031]) == 2027
    assert scatter_basis_year([2032, 2033]) == 2032


def test_rows_that_mix_basis_incomes_and_none_are_refused():
    rows = [
        _row(survey, reference_income=20_100.0, income_basis_year=2027)
        for survey in range(SCATTER_MIN_HOUSEHOLDS)
    ]
    del rows[0]["reference_income"]
    with pytest.raises(ValueError, match="basis-year income"):
        bin_scatter(rows)


def test_calculator_rows_carry_the_basis_year_income():
    from uk_budget_data.calculators import HouseholdScatterCalculator

    calc = HouseholdScatterCalculator(max_income=50_000, basis_year=2027)
    rows = calc.calculate_from_arrays(
        reform_id="a",
        reform_name="A",
        year=2029,
        baseline_incomes=np.array([60_000.0, 40_000.0]),
        income_changes=np.array([10.0, 20.0]),
        weights=np.array([1.0, 1.0]),
        household_ids=np.array([1, 2]),
        reference_incomes=np.array([45_000.0, 55_000.0]),
    )
    # Kept by the 2027 income, not the 2029 one
    assert [row["household_id"] for row in rows] == [1]
    assert rows[0]["reference_income"] == 45_000.0
    assert rows[0]["income_basis_year"] == 2027


def test_a_change_band_off_the_contracts_edges_is_refused():
    from uk_budget_data.publication.validate import table_problems

    cell = {
        "reform_id": "alpha",
        "reform_name": "Alpha",
        "year": 2027,
        "income_band": 20_000.0,
        "change_band": 100.0,
        "change_band_upper": 150.0,
        "households": 1000.0,
        "income_basis_year": 2027,
    }

    def scatter_problems(cells):
        return [
            p
            for p in table_problems(
                {"household_scatter_binned": cells},
                key="alpha",
                years=[2027],
            )
            if p.startswith("household_scatter_binned:")
        ]

    assert scatter_problems([cell]) == []
    # The old £100 bands are no longer the contract's
    assert scatter_problems([{**cell, "change_band_upper": 200.0}]) == [
        "household_scatter_binned: 1 change bands not in the contract's "
        "change_edges"
    ]


def test_a_measure_banded_by_two_basis_years_is_refused():
    from uk_budget_data.publication.validate import table_problems

    cell = {
        "reform_id": "alpha",
        "reform_name": "Alpha",
        "year": 2027,
        "income_band": 20_000.0,
        "change_band": 100.0,
        "change_band_upper": 150.0,
        "households": 1000.0,
        "income_basis_year": 2027,
    }
    later = {**cell, "year": 2028, "income_basis_year": 2028}
    problems = table_problems(
        {"household_scatter_binned": [cell, later]},
        key="alpha",
        years=[2027, 2028],
    )
    assert (
        "household_scatter_binned: a measure's cells band households by "
        "more than one income basis year"
    ) in problems
