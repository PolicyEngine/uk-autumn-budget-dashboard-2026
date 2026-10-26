"""The floor on survey households behind an artifact's household tables.

A decile or age group whose change comes from a few survey households is
refused, however many records Microcosm built from them; the binned scatter
counts survey households in artifacts too.
"""

from types import SimpleNamespace

import numpy as np
import pytest

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


def test_generation_refuses_a_run_with_a_thin_cell(monkeypatch):
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    baseline, reformed, survey = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = SimpleNamespace(
        dataset_path=None, config=SimpleNamespace(years=[YEAR])
    )
    result = SimpleNamespace(household_scatter=[])
    with pytest.raises(ReceiptUnavailable, match="fewer than 10 survey"):
        generate._apply_disclosure_floor("a", job, baseline, reformed, result)


def test_generation_names_survey_households_in_the_scatter(monkeypatch):
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    baseline, reformed, survey = _population(set())
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = SimpleNamespace(
        dataset_path=None, config=SimpleNamespace(years=[YEAR])
    )
    rows = [{"household_id": 1_000}, {"household_id": 1_005}]
    result = SimpleNamespace(household_scatter=rows, age_impact=[])
    generate._apply_disclosure_floor("a", job, baseline, reformed, result)
    assert [row["survey_household"] for row in result.household_scatter] == [
        0,
        1,
    ]


def _age_row(year, band):
    return {"year": year, "age_band": band, "mean_change": 1.0}


def test_a_thin_age_year_keeps_only_its_all_row():
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


def test_warn_mode_writes_a_thin_decile_run_with_a_warning(monkeypatch):
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    monkeypatch.setenv(floor.THIN_DECILES_ENV, "warn")
    baseline, reformed, survey = _population({80, 81})
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    job = SimpleNamespace(
        dataset_path=None, config=SimpleNamespace(years=[YEAR])
    )
    result = SimpleNamespace(
        household_scatter=[],
        age_impact=[_age_row(YEAR, "35-49"), _age_row(YEAR, "all")],
    )
    (warning,) = generate._apply_disclosure_floor(
        "a", job, baseline, reformed, result
    )
    assert "winners_losers 2027 (5, all)" in warning
    # "all" is thin in the age table too, so no age row is left.
    assert result.age_impact == []


def test_stand_in_simulations_are_not_checked():
    from uk_budget_data.publication import generate

    baseline, reformed, _ = _population({80, 81})
    result = SimpleNamespace(household_scatter=[], age_impact=[])
    job = SimpleNamespace(
        dataset_path=None, config=SimpleNamespace(years=[YEAR])
    )
    assert (
        generate._apply_disclosure_floor("a", job, baseline, reformed, result)
        == []
    )
