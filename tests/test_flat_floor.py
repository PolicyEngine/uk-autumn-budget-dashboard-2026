"""The flat CSVs' writer holds its rows to the floor of survey households.

``generate`` without ``--artifacts`` writes the flat national CSVs
(metrics.csv, age_impact.csv and the decile tables) into public/data by
default. The page reads none of them, but they are public, so they are held
to the same floor as an artifact's tables (#285 review, finding 3):
``pipeline.hold_flat_to_floor``.
"""

from types import SimpleNamespace

import numpy as np
import pytest

from tests.test_disclosure_floor import (
    FLOOR,
    POVERTY_COLUMNS,
    YEAR,
    _Dataset,
    _metrics_population,
    _population,
    _summary_row,
)
from uk_budget_data import pipeline


def _decile_rows(year):
    return [
        {"reform_id": "a", "year": year, "decile": str(n), "value": 1.0}
        for n in range(1, 11)
    ]


def _age_rows(year):
    return [
        {"reform_id": "a", "year": year, "age_band": band, "mean_change": 1.0}
        for band in ("35-49", "all", "40")
    ]


def _outcome(years=(YEAR,)):
    """A flat unit's outcome as ``ReformProcessor`` fills it, every cell
    holding a figure."""
    return pipeline.FlatOutcome(
        reform_id="a",
        reform_name="A",
        result=SimpleNamespace(
            metrics=[_summary_row(year) for year in years],
            distributional_impact=[r for y in years for r in _decile_rows(y)],
            winners_losers=[r for y in years for r in _decile_rows(y)],
            age_impact=[r for y in years for r in _age_rows(y)],
        ),
    )


def _with_dataset(monkeypatch, population):
    baseline, reformed, survey = population
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    return baseline, reformed


def test_a_thin_summary_figure_is_an_empty_cell_in_the_flat_metrics(
    monkeypatch,
):
    """One survey household crosses the line: everyone's poverty columns
    are empty in the flat metrics rows, nothing else changes, and the
    unit's lines name them, never a figure."""
    baseline, reformed = _with_dataset(
        monkeypatch, _metrics_population(crossing=(5,))
    )
    outcome = _outcome()
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    (row,) = outcome.result.metrics
    everyone = [c for c in POVERTY_COLUMNS if not c.startswith("child_")]
    withheld = {"poverty_change_pp", "poverty_change_pct", *everyone}
    assert {c for c, value in row.items() if value is None} == withheld
    assert len(outcome.result.distributional_impact) == 10
    assert len(outcome.result.age_impact) == 3
    (line,) = outcome.messages
    assert line.startswith(
        f"A: WITHHELD, resting on fewer than {FLOOR} survey households: "
        f"metrics {YEAR} (poverty_change_pp, poverty_change_pct)"
    )
    assert "0.5" not in line


def test_a_year_with_a_thin_decile_has_no_decile_rows(monkeypatch):
    """Two survey households in the fifth decile gain: the decile tables
    cannot leave one decile out, so the measure has no decile rows that
    year; the age table's "all" is thin, so no age row is left; people
    affected rests on the two and is empty. The other year stays."""
    baseline, reformed = _with_dataset(monkeypatch, _population({80, 81}))
    outcome = _outcome(years=(YEAR,))
    outcome.result.distributional_impact += _decile_rows(YEAR + 1)
    outcome.result.winners_losers += _decile_rows(YEAR + 1)
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    for table in ("distributional_impact", "winners_losers"):
        rows = getattr(outcome.result, table)
        assert {row["year"] for row in rows} == {YEAR + 1}
    assert outcome.result.age_impact == []
    (row,) = outcome.result.metrics
    assert row["people_affected"] is None
    assert any(
        f"no decile rows for {YEAR}" in line
        and f"winners_losers {YEAR} (5, all)" in line
        for line in outcome.messages
    )


def test_nothing_thin_leaves_the_rows_and_says_nothing(monkeypatch):
    baseline, reformed = _with_dataset(
        monkeypatch, _population(set(range(0, 200, 2)))
    )
    outcome = _outcome()
    before = [dict(row) for row in outcome.result.metrics]
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert outcome.result.metrics == before
    assert len(outcome.result.winners_losers) == 10
    assert len(outcome.result.age_impact) == 3
    assert outcome.messages == []


def test_only_age_impact_withholds_its_thin_age_rows(monkeypatch):
    """``generate --only age_impact`` fills the age rows alone; they are
    held to the floor too, and no decile is named."""
    baseline, reformed = _with_dataset(monkeypatch, _population({80, 81}))
    outcome = pipeline.FlatOutcome(
        reform_id="a", reform_name="A", age_rows=_age_rows(YEAR)
    )
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert outcome.age_rows == []
    (line,) = outcome.messages
    assert line == (
        f"A: WITHHELD, resting on fewer than {FLOOR} survey households: "
        f"age_impact {YEAR} (35-49, all, 40)"
    )


def test_stand_in_simulations_are_said_to_be_unchecked():
    baseline, reformed, _ = _population({80, 81})
    outcome = _outcome()
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert len(outcome.result.winners_losers) == 10
    assert outcome.messages == [
        "A: not held to the floor of survey households (its simulations "
        "were not built from a dataset)"
    ]


def test_survey_households_that_cannot_be_told_apart_are_said_loudly(
    monkeypatch,
):
    baseline, reformed, _ = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()

    def cannot(sim, path):
        raise ValueError("no survey ids")

    monkeypatch.setattr(pipeline, "scatter_survey_households", cannot)
    outcome = _outcome()
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert len(outcome.result.winners_losers) == 10
    (line,) = outcome.messages
    assert "NOT HELD TO THE FLOOR" in line and "Never commit" in line


def test_a_flat_unit_holds_its_rows_to_the_floor(monkeypatch):
    """``run_flat_unit`` runs the floor on its two simulations: here a
    ``--only age_impact`` unit, whose thin "all" leaves no age row."""
    from uk_budget_data.models import DataConfig, Reform

    population = _population({80, 81})
    baseline, reformed = _with_dataset(monkeypatch, population)
    built = iter([baseline, reformed])
    monkeypatch.setattr(
        pipeline,
        "build_microsimulation",
        lambda dataset_path, scenario=None: next(built),
    )
    for module in (pipeline.data_limits, pipeline.model_limits):
        monkeypatch.setattr(module, "limits_touched", lambda *a, **k: [])

    class _Ages:
        def calculate(self, baseline, reformed, reform_id, name, year):
            return _age_rows(year)

    monkeypatch.setattr(pipeline, "AgeImpactCalculator", _Ages)
    outcome = pipeline.run_flat_unit(
        pipeline.FlatUnit(
            reform=Reform(id="a", name="A"),
            config=DataConfig(years=[YEAR]),
            dataset_path=None,
            tables=pipeline.AGE,
        )
    )
    assert outcome.age_rows == []
    assert any("WITHHELD" in line for line in outcome.messages)


@pytest.mark.parametrize("crossing", [(5,), (5, 6, 7)])
def test_the_flat_floor_withholds_what_the_artifact_floor_does(
    monkeypatch, crossing
):
    """Differential: on the same simulations, the flat writer and
    generation withhold the same summary figures and age rows."""
    from uk_budget_data.publication import generate

    population = _metrics_population(crossing=crossing, changed=(5, 6))
    baseline, reformed = _with_dataset(monkeypatch, population)
    flat = _outcome()
    pipeline.hold_flat_to_floor(flat, baseline, reformed, None, [YEAR])
    artifact = SimpleNamespace(
        household_scatter=[],
        age_impact=_age_rows(YEAR),
        metrics=[_summary_row(YEAR)],
    )
    generate._apply_disclosure_floor(
        "a",
        SimpleNamespace(
            dataset_path=None,
            config=SimpleNamespace(years=[YEAR]),
            refuse_thin_deciles=False,
        ),
        baseline,
        reformed,
        artifact,
    )
    assert flat.result.metrics == artifact.metrics
    assert flat.result.age_impact == artifact.age_impact
    assert np.any([v is None for v in flat.result.metrics[0].values()])
