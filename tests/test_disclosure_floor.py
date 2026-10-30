"""The floor on survey households behind an artifact's household tables.

A decile or age group whose change comes from a few survey households is
refused, however many records Microcosm built from them; the binned scatter
counts survey households in artifacts too.
"""

import itertools
from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.publication_support import DATASET_NAME, SMALL_DATASET_NAME
from uk_budget_data.publication import disclosure_floor as floor
from uk_budget_data.publication.receipt import ReceiptUnavailable
from uk_budget_data.publication.tables import (
    SCATTER_MIN_HOUSEHOLDS,
    bin_scatter,
)

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
    # "few": eight records, at least FLOOR, from two survey households.
    survey = np.array([0, 0, 0, 0, 1, 1, 1, 1] + list(range(2, 12)))
    groups = {
        "few": np.arange(len(survey)) < 8,
        "enough": np.arange(len(survey)) >= 8,
    }
    changed = np.ones(len(survey), dtype=bool)
    assert floor.thin_groups(groups, changed, survey) == ["few"]
    # A group in which no household changed shows no change: not thin.
    assert floor.thin_groups(groups, ~changed, survey) == []


def test_a_measure_moved_by_two_survey_households_is_thin_including_all():
    # Survey households 80 and 81 are in decile 5; their six records change.
    baseline, reformed, survey = _population({80, 81})
    found = floor.thin_cells(baseline, reformed, [YEAR], survey)
    assert found[("distributional_impact", YEAR)] == ["5", "all"]
    assert found[("winners_losers", YEAR)] == ["5", "all"]
    # Everyone is 40, so the single year of age is a row too.
    assert found[("age_impact", YEAR)] == ["35-49", "all", "40"]


def test_enough_survey_households_in_every_changed_group_pass():
    # FLOOR survey households in decile 5, none elsewhere.
    baseline, reformed, survey = _population(set(range(80, 80 + FLOOR)))
    assert floor.thin_cells(baseline, reformed, [YEAR], survey) == {}


def test_the_floor_is_the_licence_minimum_threshold():
    """CD171 v18 section 5.2.1: no cell "based on only one or two cases".
    The 10 it advises against secondary disclosure is not required, and
    the binned scatter keeps it."""
    assert FLOOR == 3
    assert SCATTER_MIN_HOUSEHOLDS == 10


@given(
    survey=st.lists(st.integers(0, 6), min_size=1, max_size=40),
    data=st.data(),
)
def test_a_group_is_thin_exactly_when_one_or_two_households_changed(
    survey, data
):
    """For every grouping and change: a group is thin if and only if the
    rows that changed in it come from 1 to FLOOR - 1 survey households,
    however many records each household has."""
    n = len(survey)
    survey = np.array(survey)
    changed = np.array(
        data.draw(st.lists(st.booleans(), min_size=n, max_size=n))
    )
    labels = np.array(
        data.draw(st.lists(st.sampled_from("abc"), min_size=n, max_size=n))
    )
    groups = {label: labels == label for label in "abc"}
    # Real groups overlap: "all" holds every decile, as a band its ages.
    groups["all"] = np.ones(n, dtype=bool)
    thin = floor.thin_groups(groups, changed, survey)
    for label, members in groups.items():
        households = len(set(survey[members & changed].tolist()))
        assert (label in thin) == (0 < households < FLOOR)


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


def test_generation_refuses_a_run_with_a_thin_all(monkeypatch):
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
    with pytest.raises(ReceiptUnavailable, match=f"fewer than {FLOOR} survey"):
        generate._apply_disclosure_floor(
            "a", _job(refuse_thin_deciles=True), baseline, reformed, result
        )


@pytest.mark.parametrize("refuse", [False, True])
def test_generation_withholds_one_thin_decile_and_the_complement(
    refuse, monkeypatch
):
    """A narrow decile leaves the measure and its other deciles publishable."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    baseline, reformed, survey = _population({0, 1, 2, 80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    identifiers = {"reform_id": "a", "reform_name": "A", "year": YEAR}
    result = SimpleNamespace(
        distributional_impact=[
            {**identifiers, "decile": label, "value": 1.0}
            for label in ("1st", "5th")
        ],
        winners_losers=[
            {**identifiers, "decile": label, "avg_change": 100.0, "extra": 2.0}
            for label in ("1", "5", "all")
        ],
        age_impact=[],
        household_scatter=[],
    )
    warnings, record = generate._apply_disclosure_floor(
        "a", _job(refuse_thin_deciles=refuse), baseline, reformed, result
    )
    assert warnings == []
    assert result.distributional_impact[0]["value"] == 1.0
    assert result.distributional_impact[1] == {
        **identifiers,
        "decile": "5th",
        "value": None,
    }
    assert [row["avg_change"] for row in result.winners_losers] == [
        100.0,
        None,
        None,
    ]
    assert [row["extra"] for row in result.winners_losers] == [2.0, None, None]
    assert record["thin_cells_in_tables"] is False
    assert record["withheld_cells"] == [
        {"table": "distributional_impact", "year": YEAR, "groups": ["5"]},
        {"table": "winners_losers", "year": YEAR, "groups": ["5", "all"]},
    ]


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


def test_a_package_inherits_only_withheld_years_it_generates():
    """Members can cover more years than the requested package."""
    from uk_budget_data.publication import generate

    baseline, reformed, _ = _population(set())
    job = _job()
    job.member_withheld_cells = {
        ("distributional_impact", YEAR): ["5"],
        ("distributional_impact", YEAR + 1): ["7"],
        ("winners_losers", YEAR + 1): ["7", "all"],
    }
    result = SimpleNamespace(
        distributional_impact=[{"year": YEAR, "decile": "5th", "value": 1.0}],
        winners_losers=[{"year": YEAR, "decile": "all", "avg_change": 100.0}],
        age_impact=[],
        household_scatter=[],
    )
    warnings, record = generate._apply_disclosure_floor(
        "combined--a+b", job, baseline, reformed, result
    )
    assert warnings == []
    assert record["withheld_cells"] == [
        {"table": "distributional_impact", "year": YEAR, "groups": ["5"]},
        {"table": "winners_losers", "year": YEAR, "groups": ["all"]},
    ]
    assert result.distributional_impact[0]["value"] is None
    assert result.winners_losers[0]["avg_change"] is None


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
    """Written as the run says, even where the process it runs in says
    "refuse" (#208 review, finding 3: the mode travels with the run)."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    monkeypatch.setenv(floor.THIN_DECILES_ENV, "refuse")
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
    assert "never commit it" in warning
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
    "setting, refuses",
    [(None, False), ("", False), ("warn", False), ("refuse", True)],
)
def test_every_run_carries_the_mode_its_generation_started_with(
    monkeypatch, setting, refuses
):
    """#208 review, finding 3: the mode was read where each run was made,
    and a Modal container's environment never says "refuse". Warn is the
    default (finding 11)."""
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


def test_a_mistyped_mode_stops_the_generation(monkeypatch):
    monkeypatch.setenv(floor.THIN_DECILES_ENV, "Refuse")
    with pytest.raises(ValueError, match="'warn' \\(the default\\) or"):
        floor.refuses_thin_deciles()


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
        floor.floor_record(
            {}, withheld={}, not_checked_because=generate.NO_DATASET
        ),
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


def test_a_thin_all_remains_refused_even_with_inherited_blanks():
    """A package's inherited blanks never clear a whole-measure refusal."""
    found = {("winners_losers", YEAR): ["1", "all"]}
    inherited = {
        ("distributional_impact", YEAR): ["1"],
        ("winners_losers", YEAR): ["1", "all"],
    }
    withheld = floor.withheld_decile_cells(found, inherited)
    assert (
        floor.floor_record(found, withheld=withheld)["thin_cells_in_tables"]
        is True
    )


def test_a_warned_run_is_recorded_and_never_staged(monkeypatch):
    """#208 review, findings 4 and 11: a run written with a thin decile
    cell names the cells in its receipt, and the gate takes it at no level,
    not even staged, so publish review-rows deletes it before anything is
    committed. No acknowledgement lifts that."""
    from tests.publication_support import World
    from tests.test_publication_flow import YEARS, fake_process, reform
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import PublishError, stage

    found = {("distributional_impact", 2027): ["5", "all"]}

    def floor_finds(subject, job, baseline, reformed, result):
        assert job.refuse_thin_deciles is False
        return ["thin"], floor.floor_record(found)

    monkeypatch.setattr(generate, "_apply_disclosure_floor", floor_finds)
    monkeypatch.delenv(floor.THIN_DECILES_ENV, raising=False)
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
        for provisional in (False, True):
            with pytest.raises(
                PublishError,
                match=f"fewer than {FLOOR} survey households: "
                "distributional_impact 2027",
            ):
                stage(
                    manifest,
                    reference.path,
                    provisional=provisional,
                    **arguments,
                )
        assert "alpha" not in manifest.measures
    finally:
        world.close()


# --- #340: a package withholds the age rows its members withhold ----------


def _age_rows_for(labels, year=YEAR):
    return [_age_row(year, label) for label in labels]


def test_a_package_leaves_out_the_age_rows_a_member_leaves_out():
    """#340: a member's thin single age takes its band's single ages out of
    the member's table; the package leaves out the same rows, in the years
    it generates, and names them in its receipt."""
    from uk_budget_data.publication import generate

    baseline, reformed, _ = _population(set())
    job = _job()
    # A member year the package does not generate is not applied to it
    job.member_thin_age_groups = {YEAR: ["70"], YEAR + 1: ["40"]}
    result = SimpleNamespace(
        age_impact=_age_rows_for(ROW_LABELS)
        + _age_rows_for(ROW_LABELS, YEAR + 1),
        household_scatter=[],
    )
    warnings, record = generate._apply_disclosure_floor(
        "combined--a+b", job, baseline, reformed, result
    )
    assert warnings == []
    assert [(row["year"], row["age_band"]) for row in result.age_impact] == [
        (YEAR, label) for label in BANDS + ["all", "16", "36", "40"]
    ] + [(YEAR + 1, label) for label in ROW_LABELS]
    assert record["withheld_cells"] == [
        {"table": "age_impact", "year": YEAR, "groups": ["70", "90+"]}
    ]


def test_a_package_on_checked_data_adds_its_members_thin_ages_to_its_own(
    monkeypatch,
):
    """The package's own thin cells (none here) and its members' are
    withheld together, and the receipt records no member cell as thin."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    baseline, reformed, survey = _population(set())
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = _job()
    job.member_thin_age_groups = {YEAR: ["35-49"]}
    result = SimpleNamespace(
        age_impact=_age_rows_for(ROW_LABELS), household_scatter=[]
    )
    _, record = generate._apply_disclosure_floor(
        "combined--a+b", job, baseline, reformed, result
    )
    assert [row["age_band"] for row in result.age_impact] == ["all"]
    assert record["thin_cells"] == []
    assert record["withheld_cells"] == [
        {
            "table": "age_impact",
            "year": YEAR,
            "groups": floor.age_labels_in_order(set(ROW_LABELS) - {"all"}),
        }
    ]


def test_a_member_receipt_gives_its_thin_ages_from_either_record():
    """Receipts made before #340 name a member's thin ages only in
    thin_cells; later ones also name the rows left out in withheld_cells."""
    record = {
        "thin_cells": [
            {"table": "winners_losers", "year": YEAR, "groups": ["5"]},
            {"table": "age_impact", "year": YEAR, "groups": ["70"]},
        ],
        "withheld_cells": [
            {"table": "winners_losers", "year": YEAR, "groups": ["5", "all"]},
            {"table": "age_impact", "year": YEAR + 1, "groups": ["36", "40"]},
        ],
    }
    assert floor.recorded_thin_age_groups(record) == {
        YEAR: ["70"],
        YEAR + 1: ["36", "40"],
    }
    # The decile reader takes the age cell without counting it as a decile
    assert floor.recorded_withheld_cells(record) == {
        ("winners_losers", YEAR): ["5", "all"]
    }
    with pytest.raises(ValueError):
        floor.recorded_withheld_cells(
            {
                "withheld_cells": [
                    {"table": "age_impact", "year": YEAR, "groups": ["101"]}
                ]
            }
        )


def test_the_validators_require_withheld_age_rows_to_be_absent():
    from uk_budget_data.publication.validate import withholding_problems

    floor_record = {
        "withheld_cells": [
            {"table": "age_impact", "year": YEAR, "groups": ["70", "90+"]}
        ]
    }
    kept = _age_rows_for(BANDS + ["all", "40"])
    assert withholding_problems({"age_impact": kept}, floor_record) == []
    assert withholding_problems({}, floor_record) == []
    assert withholding_problems(
        {"age_impact": kept + _age_rows_for(["70"])}, floor_record
    ) == [f"age_impact {YEAR} 70 publishes a withheld row"]
    bad = {
        "withheld_cells": [
            {"table": "age_impact", "year": YEAR, "groups": ["70", "70"]}
        ]
    }
    assert withholding_problems({}, bad) == [
        "disclosure_floor.withheld_cells has an invalid cell"
    ]


# Single ages (one per band, and a band with two) for the by-difference
# property: each band's people without a row of their own are a group too.
SINGLES = ["7", "20", "30", "36", "40", "55", "70", "90+"]
PROPERTY_LABELS = BANDS + ["all"] + SINGLES
THIN_CHOICES = (
    SINGLES + BANDS + [band + floor.OTHER_AGES for band in BANDS] + ["all"]
)


def _atoms():
    """The groups no row splits: each single age with a row, each band's
    ages without a row, and the people in no band."""
    return (
        SINGLES + [band + floor.OTHER_AGES for band in BANDS] + [floor.NO_BAND]
    )


def _atoms_of(label):
    """The atoms a row or a thin group adds up."""
    if label == "all":
        return set(_atoms())
    if label in BANDS:
        return {
            single
            for single in SINGLES
            if floor._band_of_single_age(single) == label
        } | {label + floor.OTHER_AGES}
    return {label}


def _published_span(published, package):
    """The members' published rows and the package's, as vectors over
    (member, atom), the package's row of a label being the sum of the
    members' (its interactions aside). Each row is a sum of its atoms'
    totals, and people counts are published, so means are as good as
    totals."""
    atoms = _atoms()
    members = list(published)
    width = len(members) * len(atoms)

    def vector(member_atoms):
        row = np.zeros(width)
        for m, chosen in member_atoms.items():
            for atom in chosen:
                row[members.index(m) * len(atoms) + atoms.index(atom)] = 1
        return row

    equations = [
        vector({m: _atoms_of(label)})
        for m, labels in published.items()
        for label in labels
    ] + [vector({m: _atoms_of(label) for m in members}) for label in package]
    span = np.array(equations) if equations else np.zeros((0, width))
    return span, vector


def _in_span(span, target):
    """Whether ``target`` is a sum or difference of the published rows."""
    rank = np.linalg.matrix_rank(span) if len(span) else 0
    return np.linalg.matrix_rank(np.vstack([span, target])) == rank


def _recoverable(published, package, thin):
    """Which (member, thin group) the published rows give back."""
    span, vector = _published_span(published, package)
    return [
        (m, group)
        for m, groups in thin.items()
        for group in groups
        if _in_span(span, vector({m: _atoms_of(group)}))
    ]


def _published(labels, thin):
    dropped = floor.withheld_age_labels(thin, labels) if thin else set()
    return (
        []
        if dropped is None
        else [label for label in labels if label not in dropped]
    )


@given(
    st.lists(
        st.lists(st.sampled_from(THIN_CHOICES), max_size=3, unique=True),
        min_size=2,
        max_size=4,
    )
)
def test_package_less_members_never_gives_back_a_withheld_age(thin_lists):
    """#340: the package's rows less its members' published rows, and any
    sum or difference of them, give back no member's thin age group."""
    thin = {f"m{i}": groups for i, groups in enumerate(thin_lists)}
    published = {m: _published(PROPERTY_LABELS, t) for m, t in thin.items()}
    inherited = {YEAR: sorted({g for groups in thin.values() for g in groups})}
    rows = floor.withhold_thin_age_rows(
        _age_rows_for(PROPERTY_LABELS), {}, inherited
    )
    package = [row["age_band"] for row in rows]
    assert _recoverable(published, package, thin) == []


def test_without_inheritance_the_package_gives_back_a_member_thin_age():
    """The case #340 found: one member's thin single age (70) is published
    by the package and every other member, so the difference gives it."""
    thin = {"a": ["70"], "b": []}
    published = {m: _published(PROPERTY_LABELS, t) for m, t in thin.items()}
    own_only = floor.withhold_thin_age_rows(_age_rows_for(PROPERTY_LABELS), {})
    package = [row["age_band"] for row in own_only]
    assert ("a", "70") in _recoverable(published, package, thin)
    inherited = floor.withhold_thin_age_rows(
        _age_rows_for(PROPERTY_LABELS), {}, {YEAR: ["70"]}
    )
    package = [row["age_band"] for row in inherited]
    assert _recoverable(published, package, thin) == []


def test_two_members_thin_at_the_same_age_stay_hidden_as_a_sum():
    """#340's 359 two-member cells: both members leave the age out, and the
    package must too, or it less the third member gives back their sum."""
    thin = {"a": ["70"], "b": ["70"], "c": []}
    published = {m: _published(PROPERTY_LABELS, t) for m, t in thin.items()}
    rows = _age_rows_for(PROPERTY_LABELS)

    def their_sum_is_given_back(package):
        span, vector = _published_span(published, package)
        return _in_span(span, vector({"a": {"70"}, "b": {"70"}}))

    own_only = [r["age_band"] for r in floor.withhold_thin_age_rows(rows, {})]
    assert their_sum_is_given_back(own_only)
    package = [
        r["age_band"]
        for r in floor.withhold_thin_age_rows(rows, {}, {YEAR: ["70"]})
    ]
    assert "70" not in package and "65+" in package
    assert not their_sum_is_given_back(package)
    assert _recoverable(published, package, thin) == []


# #358: withhold only the thin single ages, and further ages only while the
# withheld ones, with the band's ages without a row, are under the floor.


def _band(changed, other_households=1, mixed=None):
    """Band 35-49 by survey household, ten single-person records each:
    20 households aged 36 (0-19), 20 aged 38 (20-39) and 20 aged 40
    (40-59), and ``other_households`` aged 45 (60 on) with five records
    each, too few for a row of their own; and 20 households aged 70
    (200-219). Those in ``changed`` gain £100. Survey household ``mixed``,
    aged 38, has five of its people aged 40 instead."""
    survey = np.concatenate(
        [
            np.repeat(np.arange(60), 10),
            np.repeat(np.arange(60, 60 + other_households), 5),
            np.repeat(np.arange(200, 220), 10),
        ]
    )
    age = np.select(
        [survey < 20, survey < 40, survey < 60, survey < 200],
        [36, 38, 40, 45],
        70,
    )
    if mixed is not None:
        age[np.flatnonzero(survey == mixed)[:5]] = 40
    household_id = np.arange(len(survey)) + 1_000
    decile = survey % 10 + 1
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


BAND_LABELS = BANDS + ["all", "36", "38", "40", "70"]
# Twelve households aged 36 change and five aged 38: neither is thin
SAFE = set(range(12)) | set(range(20, 25))


def _withheld_in_band(changed, inherited=None, other_households=1, mixed=None):
    """The age rows left out of BAND_LABELS, and the extra ages chosen."""
    baseline, reformed, survey = _band(changed, other_households, mixed)
    found, extra = floor.thin_cells_and_extra_ages(
        baseline, reformed, [YEAR], survey, inherited
    )
    rows = floor.withhold_thin_age_rows(
        _age_rows_for(BAND_LABELS), found, inherited, extra
    )
    kept = {row["age_band"] for row in rows}
    return set(BAND_LABELS) - kept, extra


def test_one_thin_age_whose_group_clears_the_floor_is_withheld_alone():
    """40 rests on two survey households; with the band's three changed
    households aged 45, which have no row, the group the band less its
    published ages gives back rests on five."""
    withheld, extra = _withheld_in_band(
        SAFE | {40, 41} | {60, 61, 62}, other_households=3
    )
    assert withheld == {"40"}
    assert extra == {}


def test_a_thin_age_whose_group_is_still_thin_takes_the_smallest_safe_age():
    """40 rests on two households and no one aged 45 changes, so 40 with
    the ages without a row is still thin: 38, with fewer households than 36,
    joins it, and 36 stays."""
    withheld, extra = _withheld_in_band(SAFE | {40, 41})
    assert withheld == {"38", "40"}
    assert extra == {YEAR: {"35-49": ["38"]}}
    # The receipt names the extra age, never a count
    record = floor.floor_record({}, extra_ages=extra)
    assert record["age_extra_cells"] == [
        {
            "table": "age_impact",
            "year": YEAR,
            "band": "35-49",
            "groups": ["38"],
        }
    ]
    assert floor.recorded_extra_ages(record) == extra


def test_extra_ages_tie_by_youngest():
    # 36 and 38 each have five changed households
    changed = set(range(5)) | set(range(20, 25)) | {40, 41}
    withheld, extra = _withheld_in_band(changed)
    assert withheld == {"36", "40"}
    assert extra == {YEAR: {"35-49": ["36"]}}


def test_two_thin_ages_that_together_clear_the_floor_take_no_other_age():
    # 38 rests on one household, 40 on two: three together
    withheld, extra = _withheld_in_band(set(range(12)) | {20} | {40, 41})
    assert withheld == {"38", "40"}
    assert extra == {}


def test_a_household_with_two_thin_ages_counts_once():
    """Survey household 20 has people aged 38 and 40 and changes; so does
    household 40, aged 40. 38 rests on one household and 40 on two: summed,
    three, but together they rest on two, so the group is still thin and
    36 joins it (María, #367: the union, not the sum)."""
    withheld, extra = _withheld_in_band(set(range(12)) | {20} | {40}, mixed=20)
    assert withheld == {"36", "38", "40"}
    assert extra == {YEAR: {"35-49": ["36"]}}


def test_thin_ages_without_a_row_take_the_smallest_safe_age():
    """The one changed household aged 45 has no row, but the band less its
    single ages would give it back: 38 is withheld with it."""
    withheld, extra = _withheld_in_band(SAFE | {60})
    assert withheld == {"38"}
    assert extra == {YEAR: {"35-49": ["38"]}}


def test_a_thin_band_still_leaves_only_all():
    # 35-49 rests on two households; five aged 70 change too
    withheld, extra = _withheld_in_band({40, 41} | set(range(200, 205)))
    assert withheld == set(BAND_LABELS) - {"all"}
    assert extra == {}


def test_a_thin_all_still_leaves_no_row():
    baseline, reformed, survey = _band({40})
    found, extra = floor.thin_cells_and_extra_ages(
        baseline, reformed, [YEAR], survey
    )
    assert "all" in found[("age_impact", YEAR)]
    assert extra == {}
    rows = floor.withhold_thin_age_rows(
        _age_rows_for(BAND_LABELS), found, None, extra
    )
    assert rows == []


def test_the_package_adds_ages_by_its_own_survey_households():
    """A member left out 40 and 38 (its thin age and its extra one,
    ``recorded_thin_age_groups``). In the package each rests on one
    household, two together, so the package adds 36 to them; it inherits
    both, so it never publishes an age the member left out."""
    changed = set(range(12)) | {20} | {40}
    withheld, extra = _withheld_in_band(changed, {YEAR: ["38", "40"]})
    assert withheld == {"36", "38", "40"}
    assert extra == {YEAR: {"35-49": ["36"]}}
    # Where its own households clear the floor, it adds nothing
    withheld, extra = _withheld_in_band(SAFE | {40, 41, 42}, {YEAR: ["40"]})
    assert withheld == {"40"}
    assert extra == {}


def test_without_counted_households_a_band_is_withheld_whole():
    """A run not held to the floor (no survey households) has no extra
    ages to apply, so it keeps the rule from before #358."""
    assert floor.withheld_age_labels(["40"], ROW_LABELS) == {"36", "40"}
    assert floor.withheld_age_labels(["40"], ROW_LABELS, {}) == {"40"}
    assert floor.withheld_age_labels(
        ["40"], ROW_LABELS, {"35-49": ["36"]}
    ) == {"36", "40"}


def test_an_invalid_extra_age_record_is_refused():
    with pytest.raises(ValueError):
        floor.recorded_extra_ages(
            {
                "age_extra_cells": [
                    {
                        "table": "age_impact",
                        "year": YEAR,
                        "band": "35-49",
                        "groups": ["all"],
                    }
                ]
            }
        )
    assert floor.recorded_extra_ages({}) == {}


# The #358 property, with survey households counted. Band 35-49 has three
# single ages with a row, so a member's extra age is one choice among
# several, and the package cannot recompute it.
SINGLES_358 = ["7", "20", "30", "36", "40", "45", "55", "70", "90+"]
LABELS_358 = BANDS + ["all"] + SINGLES_358
ATOMS_358 = SINGLES_358 + [band + floor.OTHER_AGES for band in BANDS]
POOL = 6  # survey households behind each atom, one person each


def _band_atoms(band):
    return [
        atom
        for atom in ATOMS_358
        if atom == band + floor.OTHER_AGES
        or (
            not atom.endswith(floor.OTHER_AGES)
            and floor._band_of_single_age(atom) == band
        )
    ]


# Atoms to touch, band 35-49's four drawn four times as often: the cases
# that need an extra age are a thin and a safe age in the same band.
WEIGHTED = list(range(len(ATOMS_358))) + 3 * [
    ATOMS_358.index(atom) for atom in _band_atoms("35-49")
]


def _atoms_358(label):
    if label == "all":
        return set(ATOMS_358)
    if label in BANDS:
        return set(_band_atoms(label))
    return {label}


ATOM_OF_PERSON = np.repeat(np.array(ATOMS_358, dtype=object), POOL)
SURVEY_358 = np.arange(len(ATOM_OF_PERSON))
GROUPS_358 = {atom: ATOM_OF_PERSON == atom for atom in ATOMS_358}
GROUPS_358.update(
    {band: np.isin(ATOM_OF_PERSON, _band_atoms(band)) for band in BANDS}
)
GROUPS_358["all"] = np.ones(len(ATOM_OF_PERSON), dtype=bool)


def _households(changed, atoms):
    members = np.isin(ATOM_OF_PERSON, list(atoms))
    return len(np.unique(SURVEY_358[members & changed]))


class _Hypothesis:
    """Draws from hypothesis's ``st.data()``."""

    def __init__(self, data):
        self.data = data

    def choice(self, options):
        return self.data.draw(st.sampled_from(list(options)))

    def integer(self, low, high):
        return self.data.draw(st.integers(low, high))


class _Seeded:
    """The same draws from a seeded generator, for a fixed search."""

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)

    def choice(self, options):
        options = list(options)
        return options[self.rng.integers(len(options))]

    def integer(self, low, high):
        return int(self.rng.integers(low, high + 1))


def _draw_changed(draw, touched=6, counts=(1, 2, 3, 4)):
    """Changed survey households: a few atoms touched (most reforms touch
    few groups thinly), each with a count from ``counts`` taken from a
    drawn place in its pool, so members overlap in some households and not
    others."""
    changed = np.zeros(len(ATOM_OF_PERSON), dtype=bool)
    chosen = {draw.choice(WEIGHTED) for _ in range(draw.integer(0, touched))}
    for index in sorted(chosen):
        count = draw.choice(counts)
        start = draw.integer(0, POOL - 1)
        for k in range(count):
            changed[index * POOL + (start + k) % POOL] = True
    return changed


def _member_extra(draw, changed, thin):
    """A member's extra ages under #358, each chosen at random among the
    band's single ages that are not withheld and have a change (so at least
    SURVEY_HOUSEHOLD_FLOOR households): any such choice clears the floor,
    and the package must not rely on recomputing the member's."""
    if "all" in thin or set(BANDS) & set(thin):
        return {}
    extra = {}
    for band in BANDS:
        singles = [a for a in _band_atoms(band) if a in SINGLES_358]
        withheld = [a for a in singles if a in thin]
        other = band + floor.OTHER_AGES
        if not withheld and other not in thin:
            continue
        group = set(withheld) | {other}
        added = []
        while 0 < _households(changed, group) < floor.SURVEY_HOUSEHOLD_FLOOR:
            candidates = [
                a
                for a in singles
                if a not in group and _households(changed, {a}) > 0
            ]
            assert candidates, "a band that is not thin always has one"
            choice = draw.choice(candidates)
            added.append(choice)
            group.add(choice)
        if added:
            extra[band] = added
    return extra


def _published_rows(dropped):
    return (
        []
        if dropped is None
        else [label for label in LABELS_358 if label not in dropped]
    )


def _span_basis(published, package):
    """An orthonormal basis of the published rows as vectors over (member,
    atom); the package's row of a label is the members' rows added up (its
    interactions aside)."""
    members = list(published)
    width = len(members) * len(ATOMS_358)

    def vector(member_atoms):
        row = np.zeros(width)
        for m, atoms in member_atoms.items():
            for atom in atoms:
                row[
                    members.index(m) * len(ATOMS_358) + ATOMS_358.index(atom)
                ] = 1
        return row

    rows = [
        vector({m: _atoms_358(label)})
        for m, labels in published.items()
        for label in labels
    ] + [vector({m: _atoms_358(label) for m in members}) for label in package]
    if not rows:
        return np.zeros((0, width)), vector
    _, singular, vt = np.linalg.svd(np.array(rows), full_matrices=False)
    return vt[singular > 1e-9], vector


def _given_back(basis, target):
    """Whether ``target`` is a sum or difference of the published rows."""
    if not len(basis):
        return False
    return np.linalg.matrix_rank(np.vstack([basis, target])) == len(basis)


def _subsets(atoms):
    for size in range(1, len(atoms) + 1):
        yield from itertools.combinations(atoms, size)


def _thin_group_given_back(
    draw, inherit_withheld_rows=True, package_extras=True
):
    """One draw of the #358 package: members with counted survey households
    and random extra ages, their receipts, and the package built from them
    as ``generate`` builds it. Returns what leaks: a member's thin group
    the published rows give back, or a package group that rests on 1 or 2
    of its own survey households."""
    n = draw.integer(2, 4)
    changed = {f"m{i}": _draw_changed(draw) for i in range(n)}
    published, inherited = {}, set()
    for m, mask in changed.items():
        thin = floor.thin_groups(GROUPS_358, mask, SURVEY_358)
        extra = _member_extra(draw, mask, thin)
        dropped = (
            floor.withheld_age_labels(sorted(thin), LABELS_358, extra)
            if thin
            else set()
        )
        published[m] = _published_rows(dropped)
        withheld = set(LABELS_358) - set(published[m])
        record = floor.floor_record(
            {(floor.AGE_TABLE, YEAR): thin} if thin else {},
            withheld=(
                {(floor.AGE_TABLE, YEAR): floor.age_labels_in_order(withheld)}
                if inherit_withheld_rows
                else {}
            ),
            extra_ages={YEAR: extra} if extra else None,
        )
        inherited |= set(floor.recorded_thin_age_groups(record).get(YEAR, []))
    # The package's own households: the members' and its interactions'
    package_changed = np.logical_or.reduce(list(changed.values()))
    package_changed |= _draw_changed(draw, touched=2, counts=(1, 2))
    own_thin = floor.thin_groups(GROUPS_358, package_changed, SURVEY_358)
    extra = (
        floor.age_extra_ages(
            GROUPS_358,
            package_changed,
            SURVEY_358,
            sorted(set(own_thin) | inherited),
        )
        if package_extras
        else {}
    )
    rows = floor.withhold_thin_age_rows(
        _age_rows_for(LABELS_358),
        {(floor.AGE_TABLE, YEAR): own_thin} if own_thin else {},
        {YEAR: sorted(inherited)} if inherited else None,
        {YEAR: extra},
    )
    package = [row["age_band"] for row in rows]
    leaks = []
    basis, vector = _span_basis(published, package)
    for m, mask in changed.items():
        for band in BANDS:
            for group in _subsets(_band_atoms(band)):
                count = _households(mask, group)
                if 0 < count < floor.SURVEY_HOUSEHOLD_FLOOR and _given_back(
                    basis, vector({m: group})
                ):
                    leaks.append((m, group))
    for band in BANDS:
        if band not in package:
            continue
        group = set(_band_atoms(band)) - set(package)
        count = _households(package_changed, group)
        if 0 < count < floor.SURVEY_HOUSEHOLD_FLOOR:
            leaks.append(("package", tuple(sorted(group))))
    return leaks


@settings(max_examples=300, deadline=None)
@given(st.data())
def test_under_358_the_package_gives_back_no_withheld_age(data):
    """#340 under #358: each member leaves out only its thin single ages
    and extra ones chosen at random among its safe ages; the package
    inherits every age a member left out and adds ages by its own survey
    households (members' and interactions'). No sum or difference of the
    members' and package's rows gives back a group of a member's that rests
    on 1 or 2 survey households (interactions aside), and the package's
    own band less its published ages clears the floor."""
    assert _thin_group_given_back(_Hypothesis(data)) == []


SEEDS = range(400)


def test_under_358_the_property_holds_for_fixed_seeds():
    for seed in SEEDS:
        assert _thin_group_given_back(_Seeded(seed)) == [], seed


@pytest.mark.parametrize(
    "safeguard",
    [{"inherit_withheld_rows": False}, {"package_extras": False}],
    ids=["thin-only inheritance", "no package extras"],
)
def test_each_safeguard_is_needed_under_358(safeguard):
    """With either safeguard off alone, the same draws give a group back
    (María, #367): a package inheriting only its members' thin groups
    publishes a member's extra age, and one adding no ages of its own
    leaves its own band's withheld group thin."""
    leaks = [
        seed
        for seed in SEEDS
        if _thin_group_given_back(_Seeded(seed), **safeguard)
    ]
    assert leaks
