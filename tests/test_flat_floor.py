"""The flat CSVs' writer holds its rows to the floor of survey households.

``generate`` without ``--artifacts`` writes the flat national CSVs
(metrics.csv, age_impact.csv and the decile tables) into public/data by
default. The page reads none of them, and #285 removed the committed ones,
but anything written there is public once committed, so they are held to
the same floor as an artifact's tables (#285 review, finding 3, and its
second review): ``pipeline.hold_flat_to_floor`` and
``pipeline.hold_packages_to_members``.
"""

from types import SimpleNamespace

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
    """Two survey households in the fifth decile gain, and 20 in each of
    the first three: the fifth decile is thin, "all" is not. The measure
    has no decile rows that year, which leaves out what an artifact
    withholds (the fifth decile and winners and losers' "all"); its
    costing, summary figures and other years stay."""
    changed = {80, 81} | set(range(60))
    baseline, reformed = _with_dataset(monkeypatch, _population(changed))
    outcome = _outcome(years=(YEAR,))
    outcome.result.budgetary_impact = [{"year": YEAR, "value": 1.0}]
    outcome.result.distributional_impact += _decile_rows(YEAR + 1)
    outcome.result.winners_losers += _decile_rows(YEAR + 1)
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    for table in ("distributional_impact", "winners_losers"):
        rows = getattr(outcome.result, table)
        assert {row["year"] for row in rows} == {YEAR + 1}
    assert outcome.result.budgetary_impact == [{"year": YEAR, "value": 1.0}]
    (row,) = outcome.result.metrics
    assert row["people_affected"] is not None
    assert outcome.withheld_whole is False
    assert outcome.withheld_decile_years == {YEAR}
    assert any(
        f"no decile rows for {YEAR}" in line
        and f"winners_losers {YEAR} (5)" in line
        for line in outcome.messages
    )


def test_a_thin_all_withholds_every_row_of_the_measure(monkeypatch):
    """Two survey households gain in all: the measure's whole change, its
    costing and inequality figures included, rests on them, so none of its
    rows is written, in any table or year, as the gate never shows such an
    artifact (#285 second review)."""
    baseline, reformed = _with_dataset(monkeypatch, _population({80, 81}))
    outcome = _outcome(years=(YEAR,))
    outcome.result.budgetary_impact = [{"year": YEAR, "value": 1.0}]
    outcome.result.income_curve = [{"year": YEAR}]
    outcome.result.distributional_impact += _decile_rows(YEAR + 1)
    outcome.age_rows = _age_rows(YEAR)
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    for table in (
        "budgetary_impact",
        "distributional_impact",
        "winners_losers",
        "metrics",
        "income_curve",
        "age_impact",
    ):
        assert getattr(outcome.result, table) == [], table
    assert outcome.age_rows == []
    assert outcome.withheld_whole is True
    (line,) = outcome.messages
    assert line == (
        f"A: WITHHELD, the whole measure: cells resting on fewer than "
        f"{FLOOR} survey households: distributional_impact {YEAR} (5, all); "
        f"winners_losers {YEAR} (5, all); none of its rows is written"
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
    held to the floor too: here the whole measure rests on two survey
    households, so no age row is left."""
    baseline, reformed = _with_dataset(monkeypatch, _population({80, 81}))
    outcome = pipeline.FlatOutcome(
        reform_id="a", reform_name="A", age_rows=_age_rows(YEAR)
    )
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert outcome.age_rows == []
    (line,) = outcome.messages
    assert line.startswith("A: WITHHELD, the whole measure: ")


def test_only_age_impact_withholds_a_thin_age_group(monkeypatch):
    """With no thin decile, the age table's thin groups alone go: one
    survey household's people are 70, so the 65+ band and its single age
    are thin, and a thin band leaves only "all" (``withheld_age_labels``);
    the line names them, never a figure."""
    baseline, reformed, survey = _population(set(range(0, 200, 2)))
    age = baseline.arrays["person"]["age"]
    age[survey == 0] = 70
    baseline, reformed = _with_dataset(
        monkeypatch, (baseline, reformed, survey)
    )
    rows = [
        {"reform_id": "a", "year": YEAR, "age_band": band, "mean_change": 1.0}
        for band in ("35-49", "65+", "70", "all", "40")
    ]
    outcome = pipeline.FlatOutcome(
        reform_id="a", reform_name="A", age_rows=rows
    )
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert [row["age_band"] for row in outcome.age_rows] == ["all"]
    (line,) = outcome.messages
    assert line.startswith(
        f"A: WITHHELD, resting on fewer than {FLOOR} survey households: "
        f"age_impact {YEAR} ("
    )
    assert "65+" in line


def test_stand_in_simulations_are_said_to_be_unchecked():
    baseline, reformed, _ = _population({80, 81})
    outcome = _outcome()
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert len(outcome.result.winners_losers) == 10
    assert outcome.messages == [
        "A: not held to the floor of survey households (its simulations "
        "were not built from a dataset)"
    ]


def _cannot_tell_apart(monkeypatch, certifiable):
    from uk_budget_data.publication import generate

    baseline, reformed, _ = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()

    def cannot(sim, path):
        raise ValueError("no survey ids")

    monkeypatch.setattr(pipeline, "scatter_survey_households", cannot)
    monkeypatch.setattr(generate, "_certifiable", lambda path: certifiable)
    return baseline, reformed


def test_survey_households_that_cannot_be_told_apart_refuse_certifiable_data(
    monkeypatch,
):
    """As generation refuses it (#285 second review): on data that could
    be certified, the flat run stops rather than write unfloored rows."""
    baseline, reformed = _cannot_tell_apart(monkeypatch, certifiable=True)
    outcome = _outcome()
    with pytest.raises(ValueError, match="cannot be told apart"):
        pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])


def test_survey_households_that_cannot_be_told_apart_write_nothing(
    monkeypatch,
):
    """On uncertified data none of the measure's rows is written (they
    would land in public/data by default), and it is said loudly."""
    baseline, reformed = _cannot_tell_apart(monkeypatch, certifiable=False)
    outcome = _outcome()
    outcome.age_rows = _age_rows(YEAR)
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, "x.h5", [YEAR])
    assert outcome.result.winners_losers == []
    assert outcome.result.metrics == []
    assert outcome.age_rows == []
    assert outcome.withheld_whole is True
    (line,) = outcome.messages
    assert "NOT HELD TO THE FLOOR" in line
    assert "none of its rows is written" in line


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


_ORDINALS = {1: "st", 2: "nd", 3: "rd"}


def _artifact(year):
    """An artifact's tables as generation holds them, every cell a figure."""
    named = {"reform_id": "a", "reform_name": "A", "year": year}
    return SimpleNamespace(
        household_scatter=[],
        age_impact=_age_rows(year),
        metrics=[_summary_row(year)],
        distributional_impact=[
            {**named, "decile": f"{n}{_ORDINALS.get(n, 'th')}", "value": 1.0}
            for n in range(1, 11)
        ],
        winners_losers=[
            {**named, "decile": label, "avg_change": 1.0}
            for label in [str(n) for n in range(1, 11)] + ["all"]
        ],
    )


@pytest.mark.parametrize(
    "crossing, changed",
    [
        # A thin poverty change; every household's income moves
        ((5,), tuple(range(40))),
        # Enough cross; every household's income moves
        ((5, 6, 7), tuple(range(40))),
        # The second decile is thin (two of its four), "all" is not
        ((5,), (0, 1, 2, 4, 5)),
        # Only two households change: "all" is thin
        ((5, 6, 7), (5, 6)),
    ],
    ids=["thin-poverty", "nothing-thin", "thin-decile", "thin-all"],
)
def test_the_flat_floor_withholds_what_the_artifact_floor_does(
    monkeypatch, crossing, changed
):
    """Differential, on the same simulations: where generation's receipt
    keeps the artifact from ever being shown (a thin "all"), the flat
    writer writes none of the measure's rows; otherwise both withhold the
    same summary figures and age rows, and every decile cell the artifact
    withholds is absent from the flat rows."""
    from uk_budget_data.publication import disclosure_floor, generate

    population = _metrics_population(crossing=crossing, changed=changed)
    baseline, reformed = _with_dataset(monkeypatch, population)
    flat = _outcome()
    pipeline.hold_flat_to_floor(flat, baseline, reformed, None, [YEAR])
    artifact = _artifact(YEAR)
    _, record = generate._apply_disclosure_floor(
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
    assert flat.withheld_whole is record["thin_cells_in_tables"]
    if flat.withheld_whole:
        assert flat.result.metrics == flat.result.age_impact == []
        return
    assert flat.result.metrics == artifact.metrics
    assert flat.result.age_impact == artifact.age_impact
    published = {
        (table, row["year"], disclosure_floor.decile_label(row["decile"]))
        for table in disclosure_floor.DECILE_TABLES
        for row in getattr(flat.result, table)
    }
    for cell in record["withheld_cells"]:
        for group in cell["groups"]:
            assert (cell["table"], cell["year"], group) not in published
    if changed == (0, 1, 2, 4, 5):
        assert record["withheld_cells"] and not published


def test_a_package_carries_its_members_floor():
    """A member with no decile rows in a year leaves the package none that
    year, and a member withheld whole withholds the package whole, so the
    package less its other members never gives a member's figures back
    (as a combined artifact inherits its members' cells, #279)."""
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    def outcome(reform_id, years=(YEAR, YEAR + 1)):
        made = _outcome(years=years)
        made.reform_id = made.reform_name = reform_id
        made.result.budgetary_impact = [{"year": y} for y in years]
        return made

    thin, plain, package = (
        outcome("thin"),
        outcome("plain"),
        outcome(AUTUMN_BUDGET_2026_COMBINED_ID),
    )
    other = outcome("combined--plain+thin")
    thin.withheld_decile_years = {YEAR}
    lines = pipeline.hold_packages_to_members([package, thin, plain, other])
    for combined in (package, other):
        for table in ("distributional_impact", "winners_losers"):
            rows = getattr(combined.result, table)
            assert {row["year"] for row in rows} == {YEAR + 1}
        assert len(combined.result.budgetary_impact) == 2
    assert {row["year"] for row in plain.result.winners_losers} == {
        YEAR,
        YEAR + 1,
    }
    assert lines == [
        f"{AUTUMN_BUDGET_2026_COMBINED_ID}: WITHHELD, no decile rows for "
        f"{YEAR}, as a member has none",
        f"combined--plain+thin: WITHHELD, no decile rows for {YEAR}, as a "
        "member has none",
    ]

    package = outcome(AUTUMN_BUDGET_2026_COMBINED_ID)
    plain.withheld_whole = True
    lines = pipeline.hold_packages_to_members([package, plain])
    assert package.withheld_whole is True
    assert package.result.budgetary_impact == []
    assert package.result.metrics == []
    assert lines == [
        f"{AUTUMN_BUDGET_2026_COMBINED_ID}: WITHHELD, the whole package: its "
        "members plain are withheld whole; none of its rows is written"
    ]
    # Nothing withheld: nothing changes, nothing said
    package, plain = outcome(AUTUMN_BUDGET_2026_COMBINED_ID), outcome("plain")
    assert pipeline.hold_packages_to_members([package, plain]) == []
    assert len(package.result.winners_losers) == 20


def test_the_flat_run_holds_its_package_to_its_members(monkeypatch):
    """``DataPipeline.run`` applies the members' floor to the package
    before it aggregates and saves."""
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    def flat_units(reforms, config, dataset_path, tables, runner=None):
        made = []
        for reform in reforms:
            outcome = _outcome(years=(YEAR, YEAR + 1))
            outcome.reform_id, outcome.reform_name = reform.id, reform.name
            outcome.result.reform_id = reform.id
            made.append(outcome)
        made[1].withheld_decile_years = {YEAR}
        return made

    saved = {}
    monkeypatch.setattr(pipeline, "flat_units", flat_units)
    monkeypatch.setattr(
        pipeline,
        "aggregate_results",
        lambda results, config: {"results": results},
    )
    monkeypatch.setattr(
        pipeline.DataPipeline,
        "_save_all",
        lambda self, data: saved.update(data),
    )
    reforms = [
        Reform(id=AUTUMN_BUDGET_2026_COMBINED_ID, name="Package"),
        Reform(id="thin", name="Thin"),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[YEAR])).run(
        skip_input_check=True
    )
    package = saved["results"][0]
    assert {row["year"] for row in package.winners_losers} == {YEAR + 1}


def test_the_age_only_run_holds_its_package_to_its_members(
    monkeypatch, tmp_path
):
    """``generate --only age_impact``: a member withheld whole leaves its
    package no age rows either, since the package less the other members
    would give the member's back."""
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    def flat_units(reforms, config, dataset_path, tables, runner=None):
        made = [
            pipeline.FlatOutcome(
                reform_id=reform.id,
                reform_name=reform.name,
                age_rows=[
                    {**row, "reform_id": reform.id} for row in _age_rows(YEAR)
                ],
            )
            for reform in reforms
        ]
        made[1].age_rows, made[1].withheld_whole = [], True
        return made

    monkeypatch.setattr(pipeline, "flat_units", flat_units)
    frame = pipeline.generate_age_impact(
        [
            Reform(id=AUTUMN_BUDGET_2026_COMBINED_ID, name="Package"),
            Reform(id="thin", name="Thin"),
            Reform(id="plain", name="Plain"),
        ],
        DataConfig(years=[YEAR], output_dir=tmp_path),
    )
    assert set(frame["reform_id"]) == {"plain"}
    assert len(frame) == len(_age_rows(YEAR))


def _empty_result(reform_id, **tables):
    """A measure's flat result with only ``tables`` holding rows."""
    from uk_budget_data.models import ReformResult

    empty = {
        name: []
        for name in (
            "budgetary_impact",
            "distributional_impact",
            "winners_losers",
            "metrics",
            "income_curve",
            "household_scatter",
            "constituency",
            "demographic_constituency",
        )
    }
    return ReformResult(
        reform_id=reform_id, reform_name=reform_id, **{**empty, **tables}
    )


def _run_flat(monkeypatch, tmp_path, outcome):
    """``DataPipeline.run`` on one measure's outcome, writing to tmp_path."""
    from uk_budget_data.models import DataConfig, Reform

    monkeypatch.setattr(
        pipeline,
        "flat_units",
        lambda reforms, config, dataset_path, tables, runner=None: [outcome],
    )
    config = DataConfig(
        years=[YEAR], output_dir=tmp_path, data_inputs_dir=tmp_path / "in"
    )
    pipeline.DataPipeline([Reform(id="a", name="A")], config).run(
        skip_input_check=True
    )


STALE = "rows written before this run\n"


def test_a_table_the_floor_empties_leaves_no_earlier_file(
    monkeypatch, tmp_path, capsys
):
    """#285 re-review, P1: when the floor withholds a measure whole, none
    of its flat tables keeps an earlier file, whose rows were never held to
    this run's floor, in its place: each is removed and the run says so,
    naming the file, never a figure."""
    files = [
        "budgetary_impact.csv",
        "distributional_impact.csv",
        "winners_losers.csv",
        "metrics.csv",
        "income_curve.csv",
        "obr_comparison.csv",
        "age_impact.csv",
    ]
    for name in (*files, "household_scatter_binned.csv"):
        (tmp_path / name).write_text(STALE)
    outcome = pipeline.FlatOutcome(
        reform_id="a", reform_name="A", result=_empty_result("a")
    )
    outcome.withheld_whole = True
    _run_flat(monkeypatch, tmp_path, outcome)
    assert [name for name in files if (tmp_path / name).exists()] == []
    # Not a flat table of this run: left as it is
    assert (tmp_path / "household_scatter_binned.csv").read_text() == STALE
    said = capsys.readouterr().out
    for name in files:
        assert f"WITHHELD {name}: the floor of survey households" in said


def test_a_table_the_run_did_not_write_is_left_alone(monkeypatch, tmp_path):
    """Only the tables the floor emptied are removed: a year with a thin
    decile empties the decile tables, while a table the run made no rows
    for, the floor apart, keeps its file, and the summary rows are
    written."""
    for name in (
        "distributional_impact.csv",
        "winners_losers.csv",
        "income_curve.csv",
    ):
        (tmp_path / name).write_text(STALE)
    outcome = pipeline.FlatOutcome(
        reform_id="a",
        reform_name="A",
        result=_empty_result("a", metrics=[_summary_row(YEAR)]),
    )
    outcome.withheld_decile_years = {YEAR}
    _run_flat(monkeypatch, tmp_path, outcome)
    assert not (tmp_path / "distributional_impact.csv").exists()
    assert not (tmp_path / "winners_losers.csv").exists()
    assert (tmp_path / "income_curve.csv").read_text() == STALE
    assert (tmp_path / "metrics.csv").read_text() != STALE


def test_the_age_only_run_leaves_no_earlier_file_when_all_is_withheld(
    monkeypatch, tmp_path
):
    """``generate --only age_impact``: when the floor withholds every age
    row, the earlier file is removed, never kept and never replaced by a
    file with no header."""
    from uk_budget_data.models import DataConfig, Reform

    (tmp_path / "age_impact.csv").write_text(STALE)
    outcome = pipeline.FlatOutcome(reform_id="a", reform_name="A")
    outcome.withheld_age_years = {YEAR}
    monkeypatch.setattr(
        pipeline,
        "flat_units",
        lambda reforms, config, dataset_path, tables, runner=None: [outcome],
    )
    frame = pipeline.generate_age_impact(
        [Reform(id="a", name="A")],
        DataConfig(years=[YEAR], output_dir=tmp_path),
    )
    assert frame.empty
    assert not (tmp_path / "age_impact.csv").exists()


def test_the_floor_records_the_years_it_left_age_rows_out(monkeypatch):
    """``hold_flat_to_floor`` records the years it withheld age rows in,
    with no thin decile and so no whole measure withheld, so the writers
    know the age table was held to the floor: one survey household's people
    are 70, as in ``test_only_age_impact_withholds_a_thin_age_group``."""
    baseline, reformed, survey = _population(set(range(0, 200, 2)))
    baseline.arrays["person"]["age"][survey == 0] = 70
    baseline, reformed = _with_dataset(
        monkeypatch, (baseline, reformed, survey)
    )
    outcome = pipeline.FlatOutcome(
        reform_id="a", reform_name="A", age_rows=_age_rows(YEAR)
    )
    pipeline.hold_flat_to_floor(outcome, baseline, reformed, None, [YEAR])
    assert outcome.withheld_whole is False
    assert outcome.withheld_age_years == {YEAR}
