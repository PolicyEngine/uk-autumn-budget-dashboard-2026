"""Briefing methodology properties on synthetic weighted frames only."""

import importlib.util
from importlib.machinery import SourceFileLoader
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings, strategies as st
from microdf import MicroDataFrame

from uk_budget_data.briefing_calculator import (
    CATEGORIES,
    BriefingCalculator,
    calculate_distributional_impact,
    calculate_poverty_rates,
    calculate_winners_losers_by_decile,
)

YEAR = 2027
KEY = "synthetic"
N = 32
POSITIVE = st.floats(min_value=0.1, max_value=10_000, allow_nan=False)
FINITE = st.floats(
    min_value=-100_000, max_value=500_000, allow_nan=False
)
PROPERTY_SETTINGS = settings(max_examples=30, deadline=None)


class FrameSimulation:
    """Return MicroSeries just as Microsimulation.calculate does."""

    def __init__(self, households, people):
        self.households = households
        self.people = people

    def calculate(self, variable, *, period, map_to):
        assert period == YEAR
        frame = self.households if map_to == "household" else self.people
        return frame[variable]


@st.composite
def simulation_pairs(draw):
    """Include every decile/group, unequal weights, and invalid deciles."""
    incomes = np.array(draw(st.lists(FINITE, min_size=N, max_size=N)))
    changes = np.array(draw(st.lists(FINITE, min_size=N, max_size=N)))
    weights = draw(st.lists(POSITIVE, min_size=N, max_size=N))
    household_data = {
        "household_net_income": incomes,
        "household_income_decile": [*np.tile(np.arange(1, 11), 3), 0, -1],
        "household_count_people": draw(
            st.lists(st.integers(1, 6), min_size=N, max_size=N)
        ),
        "household_weight": weights,
    }
    people_data = {
        "person_weight": draw(st.lists(POSITIVE, min_size=N, max_size=N)),
        "is_child": np.arange(N) % 3 == 0,
        "is_WA_adult": np.arange(N) % 3 == 1,
        "is_SP_age": np.arange(N) % 3 == 2,
    }
    reform_people = {}
    for variable in (
        "in_poverty_bhc",
        "in_poverty_ahc",
        "in_relative_poverty_bhc",
        "in_relative_poverty_ahc",
    ):
        people_data[variable] = draw(
            st.lists(st.booleans(), min_size=N, max_size=N)
        )
        reform_people[variable] = draw(
            st.lists(st.booleans(), min_size=N, max_size=N)
        )
    baseline = FrameSimulation(
        MicroDataFrame(pd.DataFrame(household_data), weights="household_weight"),
        MicroDataFrame(pd.DataFrame(people_data), weights="person_weight"),
    )
    reform = FrameSimulation(
        MicroDataFrame(
            pd.DataFrame({**household_data, "household_net_income": incomes + changes}),
            weights="household_weight",
        ),
        MicroDataFrame(
            pd.DataFrame({**people_data, **reform_people}), weights="person_weight"
        ),
    )
    return baseline, reform


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_shares_are_bounded_and_sum_to_100(simulations):
    rows = calculate_winners_losers_by_decile(*simulations, YEAR, KEY)
    for decile in {row["decile"] for row in rows}:
        shares = [row["share_pct"] for row in rows if row["decile"] == decile]
        assert all(0 <= share <= 100 for share in shares)
        assert sum(shares) == pytest.approx(100, abs=1e-9)


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_unchanged_households_are_always_no_change(simulations):
    baseline, _ = simulations
    rows = calculate_winners_losers_by_decile(baseline, baseline, YEAR, KEY)
    assert all(
        row["share_pct"] == (100 if row["category"] == "no_change" else 0)
        for row in rows
    )


@PROPERTY_SETTINGS
@given(simulation_pairs(), st.floats(min_value=0.01, max_value=100))
def test_weight_scaling_leaves_shares_and_poverty_rates_unchanged(simulations, scale):
    baseline, reform = simulations
    original = BriefingCalculator().calculate(baseline, reform, KEY, YEAR)
    scaled = FrameSimulation(
        MicroDataFrame(
            pd.DataFrame(baseline.households).assign(
                household_weight=baseline.households["household_weight"].values * scale
            ),
            weights="household_weight",
        ),
        MicroDataFrame(
            pd.DataFrame(baseline.people).assign(
                person_weight=baseline.people["person_weight"].values * scale
            ),
            weights="person_weight",
        ),
    )
    recalculated = BriefingCalculator().calculate(scaled, reform, KEY, YEAR)
    for name, numeric in (
        ("briefing_winners_losers", ("share_pct",)),
        ("briefing_poverty", ("baseline_rate_pct", "reform_rate_pct", "change_pp")),
        ("briefing_deciles", ("avg_change_gbp",)),
    ):
        for expected, actual in zip(original[name], recalculated[name]):
            for column in numeric:
                assert actual[column] == pytest.approx(expected[column], abs=1e-9)


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_identical_reform_has_zero_poverty_and_decile_change(simulations):
    baseline, _ = simulations
    tables = BriefingCalculator().calculate(baseline, baseline, KEY, YEAR)
    assert all(row["avg_change_gbp"] == 0 for row in tables["briefing_deciles"])
    assert all(row["change_pp"] == 0 for row in tables["briefing_poverty"])


@pytest.fixture(scope="module")
def gist():
    saved = Path(
        "/Users/maxghenis/PolicyEngine/_drafts/continuous-budget-ci/w5/reference/"
        "vahid-gist-generate_combined_metrics@6b9f8b7.py"
    )
    # Exact archived source also travels with the tests so CI needs no network.
    path = saved if saved.exists() else Path(__file__).parent / "fixtures" / "vahid_gist_generate_combined_metrics_6b9f8b7.py.txt"
    loader = SourceFileLoader("vahid_combined_reference", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_winners_losers_agree_with_saved_gist(gist, simulations):
    baseline, reform = simulations
    expected = gist.calculate_winners_losers_by_decile(baseline, reform, YEAR)
    rows = calculate_winners_losers_by_decile(baseline, reform, YEAR, KEY)
    actual = {(row["decile"], row["category"]): row["share_pct"] for row in rows}
    for row in expected.to_dict("records"):
        for category in CATEGORIES:
            column = category if category == "no_change" else f"{category}pct"
            assert round(actual[(row["decile"].lower(), category)], 2) == row[column]


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_decile_averages_agree_with_saved_gist(gist, simulations):
    baseline, reform = simulations
    expected = gist.calculate_distributional_impact(baseline, reform, YEAR)
    actual = {
        row["decile"]: row["avg_change_gbp"]
        for row in calculate_distributional_impact(baseline, reform, YEAR, KEY)
    }
    for row in expected:
        assert round(actual[row["decile"].lower()], 2) == row["avg_change"]


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_absolute_poverty_rates_agree_with_saved_gist(gist, simulations):
    baseline, reform = simulations
    # The gist also computes a percentage reduction and divides by the
    # baseline rate. Give every group a positive baseline poverty rate.
    for variable in ("in_poverty_bhc", "in_poverty_ahc"):
        baseline.people.loc[:2, variable] = True
    expected = gist.calculate_poverty_rates(baseline, reform, YEAR)
    rows = calculate_poverty_rates(baseline, reform, YEAR, KEY)
    for row in rows:
        if row["measure"] != "absolute":
            continue
        group = "wa" if row["group"] == "working_age" else row["group"]
        prefix = f"{group}_{row['housing']}"
        for column, suffix in (
            ("baseline_rate_pct", "baseline"),
            ("reform_rate_pct", "reformed"),
            ("change_pp", "change_pp"),
        ):
            assert round(row[column], 2) == expected[f"{prefix}_{suffix}"]


def test_winners_losers_threshold_boundaries_and_one_pound_baseline_cap():
    changes_pct = np.array([-5.001, -5, -0.011, -0.01, 0, 0.01, 0.011, 5, 5.001])
    deciles = np.repeat(np.arange(1, 11), len(changes_pct))
    original = np.tile([-100, 0, 0, 0, 0, 0, 0, 0, 0], 10)
    changes = np.tile(changes_pct, 10) / 100
    household_data = {
        "household_net_income": original,
        "household_income_decile": deciles,
        "household_weight": np.ones(len(deciles)),
        "household_count_people": np.ones(len(deciles)),
    }
    baseline = FrameSimulation(
        MicroDataFrame(pd.DataFrame(household_data), weights="household_weight"), None
    )
    reform = FrameSimulation(
        MicroDataFrame(
            pd.DataFrame({**household_data, "household_net_income": original + changes}),
            weights="household_weight",
        ), None
    )
    rows = calculate_winners_losers_by_decile(baseline, reform, YEAR, KEY)
    expected_counts = dict(zip(CATEGORIES, [1, 2, 3, 2, 1]))
    for row in rows:
        assert row["share_pct"] == pytest.approx(expected_counts[row["category"]] / 9 * 100)


def test_zero_weight_population_is_refused():
    data = pd.DataFrame(
        {
            "household_net_income": np.ones(10),
            "household_income_decile": np.arange(1, 11),
            "household_weight": np.zeros(10),
            "household_count_people": np.ones(10),
        }
    )
    simulation = FrameSimulation(MicroDataFrame(data, weights="household_weight"), None)
    with pytest.raises(ValueError, match="no positive weighted population"):
        calculate_winners_losers_by_decile(simulation, simulation, YEAR, KEY)


@PROPERTY_SETTINGS
@given(simulation_pairs())
def test_relative_poverty_reads_model_relative_series(simulations):
    baseline, reform = simulations
    rows = calculate_poverty_rates(baseline, reform, YEAR, KEY)
    weights = baseline.people["person_weight"].values
    for row in rows:
        group = row["group"]
        mask = np.ones(N, dtype=bool) if group == "overall" else baseline.people[
            {"child": "is_child", "working_age": "is_WA_adult", "pensioner": "is_SP_age"}[group]
        ].values
        variable = (
            f"in_relative_poverty_{row['housing']}" if row["measure"] == "relative"
            else f"in_poverty_{row['housing']}"
        )
        for simulation, column in ((baseline, "baseline_rate_pct"), (reform, "reform_rate_pct")):
            poor = simulation.people[variable].values
            expected = weights[poor & mask].sum() / weights[mask].sum() * 100
            assert row[column] == pytest.approx(expected)
