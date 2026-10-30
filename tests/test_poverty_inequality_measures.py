"""Poverty and inequality measures in metrics.csv, on small synthetic frames."""

import numpy as np
import pandas as pd
import pytest

from uk_budget_data.calculators import (
    POVERTY_GROUPS,
    POVERTY_MEASURES,
    MetricsCalculator,
    inequality_changes,
    inequality_measures,
    poverty_change,
)
from uk_budget_data.publication.generate import result_tables
from uk_budget_data.publication.tables import (
    POVERTY_INEQUALITY_COLUMNS,
    TABLES,
    TableError,
    canonical_csv,
    parse_csv,
)


def test_poverty_change_counts_weighted_people():
    # Weights 1, 2, 3, 4: 3 of 10 in poverty before, 1 of 10 after
    before = np.array([True, True, False, False])
    after = np.array([True, False, False, False])
    pp, pct = poverty_change(before, after, np.array([1.0, 2, 3, 4]))
    assert pp == pytest.approx(-20.0)
    assert pct == pytest.approx(-2 / 3 * 100)


def test_poverty_change_for_a_group_uses_the_group_as_denominator():
    before = np.array([True, True, False, False])
    after = np.array([False, True, False, True])
    weight = np.array([1.0, 1, 1, 1])
    child = np.array([True, False, True, False])
    # Children: 1 of 2 before, 0 of 2 after
    pp, pct = poverty_change(before, after, weight, child)
    assert pp == pytest.approx(-50.0)
    assert pct == pytest.approx(-100.0)


def test_poverty_change_refuses_an_empty_baseline():
    with pytest.raises(ValueError, match="undefined"):
        poverty_change(np.zeros(2, bool), np.ones(2, bool), np.ones(2))
    with pytest.raises(ValueError, match="No weighted people"):
        poverty_change(
            np.ones(2, bool), np.ones(2, bool), np.ones(2), np.zeros(2, bool)
        )


def test_inequality_measures_on_ten_equal_weights():
    income = np.arange(1.0, 11.0)
    measures = inequality_measures(income, np.ones(10))
    assert measures["top_10_share"] == pytest.approx(10 / 55)
    # The top 1% of ten equal people is a tenth of the richest one
    assert measures["top_1_share"] == pytest.approx(0.1 * 10 / 55)
    assert measures["p90_p10"] == pytest.approx(9.0)
    assert measures["gini"] > 0


def test_inequality_measures_respect_weights():
    # Doubling a household's weight equals listing it twice
    weighted = inequality_measures(np.array([1.0, 5, 10]), np.array([1, 2, 1]))
    repeated = inequality_measures(np.array([1.0, 5, 5, 10]), np.ones(4))
    for name in weighted:
        assert weighted[name] == pytest.approx(repeated[name])


def test_inequality_measures_refuse_a_zero_tenth_percentile():
    with pytest.raises(ValueError, match="90/10"):
        inequality_measures(np.array([0.0, 0, 5, 10]), np.ones(4))


def test_inequality_changes_units():
    before = {"top_10_share": 0.25, "top_1_share": 0.08, "p90_p10": 4.0}
    after = {"top_10_share": 0.24, "top_1_share": 0.075, "p90_p10": 3.8}
    changes = inequality_changes(before, after)
    assert changes["top_10_share_change_pp"] == pytest.approx(-1.0)
    assert changes["top_1_share_change_pp"] == pytest.approx(-0.5)
    assert changes["p90_p10_change"] == pytest.approx(-0.05)


class FakeSim:
    """Answers calculate() from fixed arrays, as a microsimulation would."""

    def __init__(self, values):
        self.values = values

    def calculate(self, variable, period=None, map_to=None):
        return pd.Series(np.asarray(self.values[variable]))


def _sims():
    # Two households of two people each: household 1 is a parent and a
    # child, household 2 two adults.
    household = {
        "household_count_people": [2, 2],
        "household_weight": [1.0, 1.0],
        "household_income_decile": [1, 10],
        "equiv_household_net_income": [10_000.0, 40_000.0],
        "household_net_income": [15_000.0, 60_000.0],
    }
    person = {
        "person_weight": [1.0, 1.0, 1.0, 1.0],
        "is_hbai_dependent_child": [False, True, False, False],
    }
    poor = [True, True, False, False]
    baseline = {**household, **person}
    baseline.update({variable: poor for variable in POVERTY_MEASURES.values()})
    reformed = dict(baseline)
    reformed["household_net_income"] = [17_000.0, 60_000.0]
    reformed["equiv_household_net_income"] = [12_000.0, 40_000.0]
    # The reform lifts household 1 out of absolute poverty only
    reformed["in_poverty_bhc"] = [False, False, False, False]
    reformed["in_poverty_ahc"] = [False, False, False, False]
    return FakeSim(baseline), FakeSim(reformed)


def test_calculate_adds_every_measure_and_keeps_the_headline():
    baseline, reformed = _sims()
    [row] = MetricsCalculator().calculate(baseline, reformed, "r", "R", 2027)

    # The headline columns, unchanged in meaning
    assert row["poverty_change_pp"] == pytest.approx(-50.0)
    assert row["poverty_change_pp"] == row["poverty_abs_bhc_change_pp"]
    assert row["poverty_change_pct"] == row["poverty_abs_bhc_change_pct"]

    for measure in POVERTY_MEASURES:
        for prefix in POVERTY_GROUPS:
            assert f"{prefix}poverty_{measure}_change_pp" in row
            assert f"{prefix}poverty_{measure}_change_pct" in row
    assert row["child_poverty_abs_ahc_change_pp"] == pytest.approx(-100.0)
    assert row["poverty_rel_bhc_change_pp"] == 0
    assert row["child_poverty_rel_ahc_change_pct"] == 0

    # Household 1's income rises: inequality falls on every measure
    assert row["gini_change"] < 0
    assert row["top_10_share_change_pp"] < 0
    assert row["p90_p10_change"] == pytest.approx(
        (40_000 / 12_000) / (40_000 / 10_000) - 1
    )


def _result(metrics):
    class Result:
        budgetary_impact = distributional_impact = winners_losers = []
        income_curve = household_scatter = age_impact = []
        official_basis = []

    Result.metrics = metrics
    return Result()


def test_artifacts_keep_the_contracted_metrics_columns():
    baseline, reformed = _sims()
    metrics = MetricsCalculator().calculate(baseline, reformed, "r", "R", 2027)
    [row] = result_tables(_result(metrics))["metrics"]
    assert tuple(row) == TABLES["metrics"].column_names


def test_artifacts_carry_the_other_measures_in_poverty_inequality():
    """The 19 measures the flat metrics.csv adds go to the receipted
    artifact's poverty_inequality table, with the same values."""
    baseline, reformed = _sims()
    [full] = MetricsCalculator().calculate(baseline, reformed, "r", "R", 2027)
    [row] = result_tables(_result([full]))["poverty_inequality"]
    assert tuple(row) == TABLES["poverty_inequality"].column_names
    assert row == {column: full[column] for column in row}
    # Exactly the calculator's columns beyond the headline, in its order
    extras = tuple(c for c in full if c not in TABLES["metrics"].column_names)
    assert tuple(c for c, _ in POVERTY_INEQUALITY_COLUMNS) == extras
    assert len(extras) == 19
    # And it writes as a canonical table that reads back to the same values
    data = canonical_csv("poverty_inequality", [row])
    assert parse_csv("poverty_inequality", data) == [row]


def test_rows_without_the_measures_give_no_poverty_inequality_table():
    """Rows from before the measures (a fake processor, say) give metrics
    only, so the artifact is written as before."""
    headline = {
        "reform_id": "r",
        "reform_name": "R",
        "year": 2027,
        "people_affected": 1.0,
        "gini_change": 0.0,
        "poverty_change_pp": 0.0,
        "poverty_change_pct": 0.0,
    }
    tables = result_tables(_result([headline]))
    assert tables["poverty_inequality"] == []
    assert tables["metrics"] == [headline]


def test_a_row_with_only_some_measures_is_refused():
    partial = {
        "reform_id": "r",
        "reform_name": "R",
        "year": 2027,
        "people_affected": 1.0,
        "gini_change": 0.0,
        "poverty_change_pp": 0.0,
        "poverty_change_pct": 0.0,
        "p90_p10_change": 0.1,
    }
    rows = result_tables(_result([partial]))["poverty_inequality"]
    with pytest.raises(TableError, match="missing columns"):
        canonical_csv("poverty_inequality", rows)
