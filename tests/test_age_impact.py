"""Results by age band: AgeImpactCalculator and ``generate --only``.

The expected values are worked out by hand in the comments, from a tiny
synthetic population, so they do not depend on the calculator's own code.
"""

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from uk_budget_data.calculators import (
    AGE_BANDS,
    SINGLE_AGE_MIN_RECORDS,
    AgeImpactCalculator,
    single_age_of,
)

# One row per person. own_change is the largest change in their own taxes
# or earnings.
PEOPLE = pd.DataFrame(
    [
        # age, weight, decile, household net income before/after,
        # equivalised before/after, own_change
        # A: 20, gains £100 (0.5% of £20,000): better off
        (20, 100, 3, 20_000, 20_100, 10_000, 10_050, 0.0),
        # B: 22, no change: unchanged; own change 50p is under £1
        (22, 300, 5, 30_000, 30_000, 15_000, 15_000, 0.5),
        # C: 40, loses £1,000: worse off, directly affected
        (40, 200, 7, 50_000, 49_000, 25_000, 24_500, 1_000.0),
        # D: 10, in A's household: better off
        (10, 100, 3, 20_000, 20_100, 10_000, 10_050, 0.0),
        # E: 30, household with no income decile: left out
        (30, 50, 0, -5, 1_000, -2, 500, 0.0),
        # F: 70, gains £1 on £15,000 (0.0067%, under 0.01%): unchanged
        (70, 100, 2, 15_000, 15_001, 7_500, 7_500.5, 0.0),
    ],
    columns=[
        "age",
        "weight",
        "decile",
        "baseline_income",
        "reform_income",
        "baseline_equivalised",
        "reform_equivalised",
        "own_change",
    ],
)


def _rows():
    rows = AgeImpactCalculator().calculate_from_dataframe(
        "m", "Measure", 2027, PEOPLE
    )
    return {row["age_band"]: row for row in rows}


def test_young_people_by_hand():
    young = _rows()["16-24"]
    # A (100) and B (300)
    assert young["people"] == 400
    assert young["sample_size"] == 2
    # (100 x £100 + 300 x £0) / 400
    assert young["mean_change"] == pytest.approx(25.0)
    # (100 x £50) / 400
    assert young["mean_equivalised_change"] == pytest.approx(12.5)
    assert young["pct_better_off"] == pytest.approx(25.0)
    assert young["pct_worse_off"] == pytest.approx(0.0)
    assert young["pct_unchanged"] == pytest.approx(75.0)
    # B's own change is under £1
    assert young["people_directly_affected"] == 0


def test_all_people_by_hand():
    everyone = _rows()["all"]
    # A, B, C, D and F; E has no income decile
    assert everyone["people"] == 800
    assert everyone["sample_size"] == 5
    # (100 x 100 + 0 + 200 x -1,000 + 100 x 100 + 100 x 1) / 800
    assert everyone["mean_change"] == pytest.approx(-224.875)
    # A and D better off, C worse off, B and F unchanged
    assert everyone["pct_better_off"] == pytest.approx(25.0)
    assert everyone["pct_worse_off"] == pytest.approx(25.0)
    assert everyone["pct_unchanged"] == pytest.approx(50.0)
    assert everyone["people_directly_affected"] == 200


def test_bands_with_nobody_are_left_out():
    rows = _rows()
    # E was the only 25- to 34-year-old, and has no decile; nobody is 50-64
    assert list(rows) == ["0-15", "16-24", "35-49", "65+", "all"]
    for row in rows.values():
        assert row["pct_better_off"] + row["pct_worse_off"] + row[
            "pct_unchanged"
        ] == pytest.approx(100.0)


def test_bands_cover_every_age_once():
    covered = []
    for _, low, high in AGE_BANDS:
        covered.extend(range(low, min(high, 120) + 1))
    assert covered == list(range(0, 121))
    assert ("16-24", 16, 24) in AGE_BANDS


def _single_age_frame():
    """Records at ages 17, 18, 92 and 95, enough at 17 and in 90+ only."""

    def people(age, count, change):
        return [
            (age, 10, 4, 20_000, 20_000 + change, 10_000, 10_000, 0.0)
        ] * count

    records = (
        # 17: 100 records, each £50 better off
        people(17, SINGLE_AGE_MIN_RECORDS, 50)
        # 18: one record short of a row
        + people(18, SINGLE_AGE_MIN_RECORDS - 1, 50)
        # 92 and 95 share the 90+ row: 60 records lose £20, 40 gain £30
        + people(92, 60, -20)
        + people(95, 40, 30)
    )
    return pd.DataFrame(records, columns=PEOPLE.columns)


def test_single_years_of_age_by_hand():
    rows = AgeImpactCalculator().calculate_from_dataframe(
        "m", "Measure", 2027, _single_age_frame()
    )
    labels = [row["age_band"] for row in rows]
    # Bands, then all, then single years; 18 has too few records
    assert labels == ["16-24", "65+", "all", "17", "90+"]
    by_label = {row["age_band"]: row for row in rows}
    assert by_label["17"]["sample_size"] == SINGLE_AGE_MIN_RECORDS
    assert by_label["17"]["people"] == 1_000
    assert by_label["17"]["mean_change"] == pytest.approx(50)
    assert by_label["17"]["pct_better_off"] == pytest.approx(100)
    # (60 x -20 + 40 x 30) / 100 = 0
    assert by_label["90+"]["mean_change"] == pytest.approx(0)
    assert by_label["90+"]["pct_worse_off"] == pytest.approx(60)
    assert by_label["90+"]["pct_better_off"] == pytest.approx(40)


def test_single_age_labels():
    labels = single_age_of(np.array([0, 16.5, 89, 90, 104]))
    assert list(labels) == ["0", "16", "89", "90+", "90+"]


class _Values:
    def __init__(self, values):
        self.values = np.asarray(values, dtype=float)


class _FakeSimulation:
    """Person-level variables for two people: aged 20 and 45."""

    def __init__(self, income, tax):
        self.variables = {
            "age": [20, 45],
            "person_weight": [1_000, 3_000],
            "household_income_decile": [2, 8],
            "household_net_income": income,
            "equiv_household_net_income": income,
            "income_tax": tax,
            "national_insurance": [0, 0],
            "student_loan_repayment": [0, 0],
            "employment_income": [18_000, 60_000],
        }

    def calculate(self, variable, period=None, map_to=None):
        assert map_to == "person"
        return _Values(self.variables[variable])


def test_calculate_reads_the_simulations():
    baseline = _FakeSimulation([18_000, 50_000], [800, 9_000])
    # The 20-year-old pays £200 less tax; the 45-year-old's household
    # loses £500
    reformed = _FakeSimulation([18_200, 49_500], [600, 9_000])
    rows = AgeImpactCalculator().calculate(
        baseline, reformed, "m", "Measure", 2026
    )
    young = next(row for row in rows if row["age_band"] == "16-24")
    assert young["mean_change"] == pytest.approx(200)
    assert young["people_directly_affected"] == 1_000
    everyone = next(row for row in rows if row["age_band"] == "all")
    # (1,000 x 200 + 3,000 x -500) / 4,000
    assert everyone["mean_change"] == pytest.approx(-325)


def test_only_age_impact_writes_one_file(tmp_path, monkeypatch):
    """``generate --only age_impact`` builds the runs and writes only
    age_impact.csv, for every reform and year asked for."""
    from uk_budget_data import cli, pipeline
    from uk_budget_data.models import Reform

    built = []

    def build(dataset_path, scenario=None):
        built.append(scenario)
        if len(built) % 2:
            return _FakeSimulation([18_000, 50_000], [800, 9_000])
        return _FakeSimulation([18_200, 49_500], [600, 9_000])

    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    # Stand-in simulations have no tax-benefit system to check limits on
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
            "age_impact",
            "--reforms",
            "a",
            "b",
            "--years",
            "2026",
            "2027",
            "--output-dir",
            str(tmp_path),
        ]
    )
    assert status == 0
    assert len(built) == 4
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "age_impact.csv",
        "winners_losers.csv",
    ]
    assert (tmp_path / "winners_losers.csv").read_text() == "untouched\n"
    frame = pd.read_csv(tmp_path / "age_impact.csv")
    assert set(frame["reform_id"]) == {"a", "b"}
    assert set(frame["year"]) == {2026, 2027}
    # 16-24, 35-49 and all, for two reforms and two years
    assert len(frame) == 12


def test_only_refuses_artifacts():
    from uk_budget_data import cli

    assert cli.main(["generate", "--only", "age_impact", "--artifacts"]) == 1


def test_the_table_is_optional_in_artifacts():
    """Artifacts written before results by age existed stay complete."""
    from uk_budget_data.publication.tables import TABLES

    spec = TABLES["age_impact"]
    assert spec.required is False
    assert spec.key == ("reform_id", "year", "age_band")
    rows = AgeImpactCalculator().calculate_from_dataframe(
        "m", "Measure", 2027, PEOPLE
    )
    assert set(rows[0]) == set(spec.column_names)


def test_result_tables_carry_it():
    from uk_budget_data.publication.generate import result_tables

    result = SimpleNamespace(
        budgetary_impact=[],
        distributional_impact=[],
        winners_losers=[],
        metrics=[],
        income_curve=[],
        household_scatter=[],
        age_impact=[{"age_band": "16-24"}],
        official_basis=[],
    )
    assert result_tables(result)["age_impact"] == [{"age_band": "16-24"}]
