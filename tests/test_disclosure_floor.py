"""The floor on survey households behind an artifact's household tables.

A decile or age group whose change comes from a few survey households is
refused, however many records Microcosm built from them; the binned scatter
counts survey households in artifacts too.
"""

from types import SimpleNamespace

import numpy as np
import pytest

from tests.publication_support import DATASET_NAME, SMALL_DATASET_NAME
from uk_budget_data.publication import disclosure_floor as floor
from uk_budget_data.publication.receipt import ReceiptUnavailable
from uk_budget_data.publication.tables import bin_scatter

FLOOR = floor.SURVEY_HOUSEHOLD_FLOOR
YEAR = 2027


class _Simulation:
    """Household and person arrays, the same in every year."""

    def __init__(self, household, person):
        self.arrays = {"household": household, "person": person}

    def calculate(self, variable, period, map_to):
        return SimpleNamespace(
            values=np.asarray(self.arrays[map_to][variable])
        )


class _Dataset(dict):
    """Stands for a dataset with tables by year (survey ids are patched)."""

    years = [YEAR]


def _population(changed_survey, records_each=3):
    """Ten deciles of 20 survey households, each built into
    ``records_each`` records of one adult aged 40. The households in
    ``changed_survey`` gain £100."""
    survey = np.repeat(np.arange(200), records_each)
    household_id = np.arange(len(survey)) + 1_000
    decile = survey // 20 + 1
    base = np.full(len(survey), 20_000.0)
    gain = np.where(np.isin(survey, list(changed_survey)), 100.0, 0.0)
    person = {
        "household_id": household_id,
        "age": np.full(len(survey), 40),
        "household_income_decile": decile,
    }
    baseline = _Simulation(
        {
            "household_id": household_id,
            "household_net_income": base,
            "household_income_decile": decile,
        },
        person,
    )
    reformed = _Simulation(
        {
            "household_id": household_id,
            "household_net_income": base + gain,
            "household_income_decile": decile,
        },
        person,
    )
    return baseline, reformed, survey


def test_thin_groups_count_survey_households_not_records():
    survey = np.array(
        [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2] + list(range(3, 13))
    )
    groups = {
        "few": np.arange(len(survey)) < 12,
        "enough": np.arange(len(survey)) >= 12,
    }
    changed = np.ones(len(survey), dtype=bool)
    assert floor.thin_groups(groups, changed, survey) == ["few"]
    # A group in which no household changed shows no change: not thin.
    assert floor.thin_groups(groups, ~changed, survey) == []


def test_a_decile_moved_by_two_survey_households_is_refused():
    # Survey households 80 and 81 are in decile 5; their six records change.
    baseline, reformed, survey = _population({80, 81})
    found = floor.thin_cells(baseline, reformed, [YEAR], survey)
    assert found[("distributional_impact", YEAR)] == ["5", "all"]
    assert found[("winners_losers", YEAR)] == ["5", "all"]
    # Everyone is 40, so the single year of age is a row too.
    assert found[("age_impact", YEAR)] == ["35-49", "all", "40"]


def test_enough_survey_households_in_every_changed_group_pass():
    # Ten survey households in decile 5, none elsewhere.
    baseline, reformed, survey = _population(set(range(80, 80 + FLOOR)))
    assert floor.thin_cells(baseline, reformed, [YEAR], survey) == {}


def test_the_reason_names_tables_years_and_groups_but_no_figure():
    baseline, reformed, survey = _population({80, 81})
    reason = floor.thin_cells_reason(
        floor.thin_cells(baseline, reformed, [YEAR], survey)
    )
    assert "winners_losers 2027 (5, all)" in reason
    assert "100" not in reason


def test_the_age_groups_are_the_ones_the_age_table_publishes():
    age = np.array([5, 20, 40, 70] + [33] * 100)
    groups = floor.age_groups(age, np.ones(len(age)))
    assert {"16-24", "35-49", "65+", "all", "33"} <= set(groups)
    # Fewer records than SINGLE_AGE_MIN_RECORDS: no single-age row.
    assert "40" not in groups


def test_scatter_rows_name_their_survey_household():
    """Twelve records in one cell from three survey households: the cell is
    published when records are counted, and left out once each row names
    its survey household."""
    household_ids = np.arange(12) + 500
    survey = np.repeat([7, 8, 9], 4)
    rows = [
        {
            "reform_id": "a",
            "reform_name": "A",
            "year": YEAR,
            "baseline_income": 20_100.0,
            "income_change": -50.0,
            "household_weight": 100.0,
            "household_id": int(household),
        }
        for household in household_ids
    ]
    assert len(bin_scatter(rows)) == 1
    named = floor.survey_scatter_rows(rows, household_ids, survey)
    assert [row["survey_household"] for row in named] == list(survey)
    assert bin_scatter(named) == []


def _job(refuse_thin_deciles=True, dataset_path=None):
    """A run as ``generate.ArtifactRun`` carries what the floor reads."""
    return SimpleNamespace(
        dataset_path=dataset_path,
        config=SimpleNamespace(years=[YEAR]),
        refuse_thin_deciles=refuse_thin_deciles,
    )


def test_generation_refuses_a_run_with_a_thin_cell(monkeypatch):
    """Refused as the run says, even where it runs under "warn" (#208
    review, finding 3: the mode travels with the run)."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    monkeypatch.setenv(floor.THIN_DECILES_ENV, "warn")
    baseline, reformed, survey = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    result = SimpleNamespace(household_scatter=[])
    with pytest.raises(ReceiptUnavailable, match="fewer than 10 survey"):
        generate._apply_disclosure_floor(
            "a", _job(refuse_thin_deciles=True), baseline, reformed, result
        )


def test_generation_names_survey_households_in_the_scatter(monkeypatch):
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    baseline, reformed, survey = _population(set())
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = _job()
    rows = [{"household_id": 1_000}, {"household_id": 1_005}]
    result = SimpleNamespace(household_scatter=rows, age_impact=[])
    generate._apply_disclosure_floor("a", job, baseline, reformed, result)
    assert [row["survey_household"] for row in result.household_scatter] == [
        0,
        1,
    ]


def _age_row(year, band):
    return {"year": year, "age_band": band, "mean_change": 1.0}


def test_a_thin_band_keeps_only_all_and_a_thin_all_keeps_nothing():
    rows = [
        _age_row(year, band)
        for year in (2027, 2028, 2029)
        for band in ("35-49", "40", "all")
    ]
    found = {("age_impact", 2027): ["35-49"], ("age_impact", 2028): ["all"]}
    kept = floor.withhold_thin_age_rows(rows, found)
    assert [(row["year"], row["age_band"]) for row in kept] == [
        (2027, "all"),
        (2029, "35-49"),
        (2029, "40"),
        (2029, "all"),
    ]


BANDS = [label for label, _, _ in floor.AGE_BANDS]
ROW_LABELS = BANDS + ["all", "16", "36", "40", "70", "90+"]


@pytest.mark.parametrize(
    "thin, withheld",
    [
        (["40"], {"36", "40"}),
        (["90+"], {"70", "90+"}),
        (["65+" + floor.OTHER_AGES], {"70", "90+"}),
        (["16", "40"], {"16", "36", "40"}),
        (["35-49"], set(ROW_LABELS) - {"all"}),
        ([floor.NO_BAND], set(ROW_LABELS) - {"all"}),
        (["all"], None),
    ],
)
def test_what_is_withheld_with_each_thin_group(thin, withheld):
    """#208 review, finding 6: one thin single age left only "all", which
    blanked the sections built from bands and single ages. A thin single age
    now takes its band's single ages with it: the band then shows as one
    row, and no sum or difference of the rows left gives the thin one
    back."""
    assert floor.withheld_age_labels(thin, ROW_LABELS) == withheld


def test_a_year_with_a_thin_single_age_keeps_its_bands():
    rows = [_age_row(YEAR, label) for label in ROW_LABELS]
    kept = floor.withhold_thin_age_rows(rows, {("age_impact", YEAR): ["40"]})
    assert [row["age_band"] for row in kept] == BANDS + [
        "all",
        "16",
        "70",
        "90+",
    ]


def test_ages_without_a_row_of_their_own_are_a_group():
    """A band less its single ages gives back the ages with too few records
    for a row, so the floor checks them too."""
    age = np.array([33] * 100 + [30] * 5)
    groups = floor.age_groups(age, np.ones(len(age)))
    assert "30" not in groups
    other = groups["25-34" + floor.OTHER_AGES]
    assert other.sum() == 5 and not other[:100].any()
    assert groups["35-49" + floor.OTHER_AGES].sum() == 0
    assert groups[floor.NO_BAND].sum() == 0


def _ages(changed):
    """People in single-person records, ten records to a survey household:
    households 0-49 aged 36, 50-99 aged 40, 100-199 aged 70. Those in
    ``changed`` gain £100."""
    survey = np.repeat(np.arange(200), 10)
    age = np.select([survey < 50, survey < 100], [36, 40], 70)
    household_id = np.arange(len(survey)) + 1_000
    decile = survey // 20 + 1
    base = np.full(len(survey), 20_000.0)
    gain = np.where(np.isin(survey, list(changed)), 100.0, 0.0)
    person = {
        "household_id": household_id,
        "age": age,
        "household_income_decile": decile,
    }

    def simulation(net):
        return _Simulation(
            {
                "household_id": household_id,
                "household_net_income": net,
                "household_income_decile": decile,
            },
            person,
        )

    return simulation(base), simulation(base + gain), survey


def test_a_thin_single_age_in_a_band_that_is_not_thin_is_found_alone():
    # Twelve survey households aged 36 change, and two aged 40.
    baseline, reformed, survey = _ages(set(range(12)) | {50, 51})
    found = floor.thin_cells(baseline, reformed, [YEAR], survey)
    assert found[("age_impact", YEAR)] == ["40"]


def test_warn_mode_writes_a_thin_decile_run_with_a_warning(monkeypatch):
    """Written as the run says, even where it runs under the default, as a
    Modal container does (#208 review, finding 3)."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    monkeypatch.delenv(floor.THIN_DECILES_ENV, raising=False)
    baseline, reformed, survey = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = _job(refuse_thin_deciles=False)
    result = SimpleNamespace(
        household_scatter=[],
        age_impact=[_age_row(YEAR, "35-49"), _age_row(YEAR, "all")],
    )
    (warning,), record = generate._apply_disclosure_floor(
        "a", job, baseline, reformed, result
    )
    assert "winners_losers 2027 (5, all)" in warning
    # "all" is thin in the age table too, so no age row is left.
    assert result.age_impact == []
    # The receipt says which cells are thin and that the deciles' are still
    # in the tables (#208 review, finding 4).
    assert record["checked"] is True
    assert record["thin_cells_in_tables"] is True
    assert {
        "table": "winners_losers",
        "year": YEAR,
        "groups": ["5", "all"],
    } in (record["thin_cells"])


@pytest.mark.parametrize(
    "dataset_path, kind",
    [
        (None, "microcosm"),
        (DATASET_NAME, "microcosm"),
        (SMALL_DATASET_NAME, "efrs"),
    ],
)
def test_a_bundle_dataset_is_known_by_its_package_not_opened_as_a_file(
    monkeypatch, dataset_path, kind
):
    """#208 review, finding 1: a dataset given by name (the certified-data
    test's small enhanced FRS) was opened as a local H5 file."""
    from uk_budget_data import geography, pipeline

    monkeypatch.setattr(
        geography,
        "dataset_tables",
        lambda sim: SimpleNamespace(household=None, person=None),
    )

    def is_export(path):
        raise AssertionError(f"{path} opened as a file")

    monkeypatch.setattr(geography, "is_microcosm_export", is_export)
    seen = []

    def survey_ids(household, person, kind, *, microcosm_export):
        seen.append((kind, microcosm_export))
        return np.arange(3)

    monkeypatch.setattr(geography, "survey_household_ids", survey_ids)
    pipeline.scatter_survey_households(object(), dataset_path)
    assert seen == [(kind, kind == "microcosm")]


def _cannot_tell_apart(monkeypatch):
    from uk_budget_data import pipeline

    def survey(sim, path):
        raise ValueError("The tables lack the copy flags")

    monkeypatch.setattr(pipeline, "scatter_survey_households", survey)


@pytest.mark.parametrize(
    "dataset_path", [SMALL_DATASET_NAME, "/scratch/synthetic.h5"]
)
def test_uncertified_data_without_survey_households_is_written_unchecked(
    monkeypatch, dataset_path
):
    """#208 review, findings 1 and 2: uncertified data is never approved, so
    a run whose survey households cannot be told apart is written without
    the floor and says so; the certified-data test and the Modal smoke test
    reach their receipts."""
    from uk_budget_data.publication import generate

    _cannot_tell_apart(monkeypatch)
    baseline, reformed, _ = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    job = _job(dataset_path=dataset_path)
    rows = [_age_row(YEAR, "35-49"), _age_row(YEAR, "all")]
    result = SimpleNamespace(
        household_scatter=[{"household_id": 1_000}], age_impact=list(rows)
    )
    (warning,), record = generate._apply_disclosure_floor(
        "a", job, baseline, reformed, result
    )
    assert "not held to the floor" in warning
    assert "can never be approved" in warning
    assert record["checked"] is False
    assert record["not_checked_because"] == "The tables lack the copy flags"
    assert result.age_impact == rows
    assert result.household_scatter == [{"household_id": 1_000}]


@pytest.mark.parametrize(
    "dataset_path",
    [None, DATASET_NAME, f"/copies/{DATASET_NAME}.h5"],
    ids=["default", "by name", "local copy"],
)
def test_certifiable_data_without_survey_households_is_refused(
    monkeypatch, dataset_path
):
    from uk_budget_data.publication import generate

    _cannot_tell_apart(monkeypatch)
    baseline, reformed, _ = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    job = _job(dataset_path=dataset_path)
    result = SimpleNamespace(household_scatter=[], age_impact=[])
    with pytest.raises(ReceiptUnavailable, match="cannot be told apart"):
        generate._apply_disclosure_floor("a", job, baseline, reformed, result)


class _Planned:
    """A runner that keeps the runs it is given, unrun, as a worker pool or
    Modal is sent them."""

    jobs = 2
    in_process = False

    def __init__(self):
        self.runs = []

    def map(self, function, units, on_result=lambda index, result: None):
        self.runs.extend(units)
        return []


@pytest.mark.parametrize(
    "setting, refuses", [(None, True), ("refuse", True), ("warn", False)]
)
def test_every_run_carries_the_mode_its_generation_started_with(
    monkeypatch, setting, refuses
):
    """#208 review, finding 3: the mode was read where each run was made,
    and a Modal container's environment never says "warn"."""
    from tests.publication_support import World
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication import generate

    if setting is None:
        monkeypatch.delenv(floor.THIN_DECILES_ENV, raising=False)
    else:
        monkeypatch.setenv(floor.THIN_DECILES_ENV, setting)
    world = World()
    try:
        monkeypatch.setattr(
            generate, "code_revision", lambda root: world.revision()
        )
        runner = _Planned()
        generate.generate_artifacts(
            [
                Reform(
                    id="a",
                    name="A",
                    parameter_changes={
                        "gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.21}
                    },
                )
            ],
            DataConfig(years=[YEAR]),
            artifacts_root=world.artifacts,
            runner=runner,
        )
    finally:
        world.close()
    (run,) = runner.runs
    assert run.refuse_thin_deciles is refuses


def test_stand_in_simulations_are_recorded_as_not_checked():
    """#208 review, finding 9: the gate shows no artifact whose receipt
    records nothing of the floor, so a run whose simulations were not built
    from a dataset, as a test's stand-ins, records why it was not
    checked."""
    from uk_budget_data.publication import generate

    baseline, reformed, _ = _population({80, 81})
    result = SimpleNamespace(household_scatter=[], age_impact=[])
    job = _job()
    assert generate._apply_disclosure_floor(
        "a", job, baseline, reformed, result
    ) == (
        [],
        floor.floor_record({}, not_checked_because=generate.NO_DATASET),
    )


def test_an_artifact_made_before_the_floor_is_never_shown():
    """#208 review, finding 9: an artifact whose receipt records no check
    against the floor, as one generated before it, still stages, but is
    never made provisional or approved until it is regenerated."""
    from tests.publication_support import World
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.publish import (
        PublishError,
        approve,
        stage,
    )

    world = World()
    try:
        values = {2027: -1.0, 2028: -2.0}
        arguments = dict(data_root=world.data_root, inputs=world.inputs)
        manifest = m.Manifest()
        before = world.ready("alpha", values, before_the_floor=True)
        unchecked = "no check of its household tables against the floor"
        with pytest.raises(PublishError, match=unchecked):
            stage(manifest, before.path, provisional=True, **arguments)
        stage(manifest, before.path, **arguments)
        with pytest.raises(PublishError, match=unchecked):
            approve(manifest, "alpha", "Reviewer", **arguments)
        regenerated = world.ready("alpha", values)
        stage(manifest, regenerated.path, **arguments)
        approve(manifest, "alpha", "Reviewer", **arguments)
        assert manifest.measures["alpha"].status == m.APPROVED
    finally:
        world.close()


def test_the_record_names_cells_never_figures_and_flags_decile_ones():
    found = {
        ("winners_losers", YEAR): ["5", "all"],
        (floor.AGE_TABLE, YEAR): ["40"],
    }
    record = floor.floor_record(found)
    assert record == {
        "survey_households": FLOOR,
        "checked": True,
        "thin_cells": [
            {"table": floor.AGE_TABLE, "year": YEAR, "groups": ["40"]},
            {"table": "winners_losers", "year": YEAR, "groups": ["5", "all"]},
        ],
        "thin_cells_in_tables": True,
    }
    # The age table's thin cells are withheld, so none is left in a table.
    withheld = floor.floor_record({(floor.AGE_TABLE, YEAR): ["40"]})
    assert withheld["thin_cells_in_tables"] is False


def test_a_warned_run_is_recorded_staged_and_never_approved(monkeypatch):
    """#208 review, finding 4: a run written under "warn" left no trace
    once written. Its receipt now names the thin cells, it can be staged to
    be looked at, and the gate refuses to show it; no acknowledgement lifts
    that."""
    from tests.publication_support import World
    from tests.test_publication_flow import YEARS, fake_process, reform
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import (
        PublishError,
        approve,
        stage,
    )

    found = {("distributional_impact", 2027): ["5", "all"]}

    def floor_finds(subject, job, baseline, reformed, result):
        assert job.refuse_thin_deciles is False
        return ["thin"], floor.floor_record(found)

    monkeypatch.setattr(generate, "_apply_disclosure_floor", floor_finds)
    monkeypatch.setenv(floor.THIN_DECILES_ENV, "warn")
    world = World()
    try:
        monkeypatch.setattr(
            generate, "code_revision", lambda root: world.revision()
        )
        values = {"alpha": {2027: -1.0, 2028: -2.0}}
        (reference,) = generate.generate_artifacts(
            [reform("alpha")],
            DataConfig(years=YEARS),
            artifacts_root=world.artifacts,
            generator_argv=["test"],
            build=lambda dataset, scenario=None: world.sim(),
            process=fake_process(values),
        ).written
        dashboard = read_receipt(reference.path)["dashboard"]
        assert dashboard["disclosure_floor"] == floor.floor_record(found)
        manifest = m.Manifest()
        arguments = dict(data_root=world.data_root, inputs=world.inputs)
        world.costing("alpha", values["alpha"])
        world.reconcile(reference)
        stage(manifest, reference.path, **arguments)
        with pytest.raises(
            PublishError,
            match="fewer than 10 survey households: distributional_impact "
            "2027",
        ):
            approve(manifest, "alpha", "Reviewer", **arguments)
    finally:
        world.close()
