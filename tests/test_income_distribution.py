"""Income distribution: IncomeDistributionCalculator and ``generate --only``.

The expected values are worked out by hand in the comments, from tiny
synthetic populations, so they do not depend on the calculator's own code.
"""

import numpy as np
import pandas as pd

from uk_budget_data.calculators import (
    DISTRIBUTION_PERCENTILES,
    IncomeDistributionCalculator,
    distribution_points,
)


def test_points_are_band_means_weighted_by_people():
    # 1,000 households of one person each, incomes 1..1000, so person i
    # sits at the midpoint (i - 0.5) / 10 percent. The 50th percentile's
    # band [49.5, 50.5) holds people 496..505: mean 500.5.
    income = np.arange(1, 1001, dtype=float)
    points = distribution_points(
        income, np.ones(1000), percentiles=(50,), min_households=1
    )
    assert points == [(50, 500.5, 10)]


def test_people_not_households_set_the_rank():
    # Two households: £10 with 3 people, £20 with 1. Three quarters of
    # people have £10, so the 50th percentile is £10 (midpoint 37.5% sits
    # in no 1-point band, so use a wide band covering 0-75).
    points = distribution_points(
        np.array([20.0, 10.0]),
        np.array([1.0, 3.0]),
        percentiles=(37,),
        band=74,
        min_households=1,
    )
    assert points == [(37, 10.0, 1)]


def test_thin_band_has_no_point():
    # Ten households: each 1-point band holds at most one, under a floor
    # of two, so nothing is published.
    assert (
        distribution_points(
            np.arange(10.0), np.ones(10), percentiles=(50,), min_households=2
        )
        == []
    )


def test_floor_counts_survey_households_not_records():
    # 1,000 records but only two survey households behind the 50th
    # percentile's ten records: under a floor of three, no point.
    income = np.arange(1, 1001, dtype=float)
    ids = np.arange(1000) // 5
    assert distribution_points(
        income, np.ones(1000), ids, percentiles=(50,), min_households=3
    ) == []
    assert distribution_points(
        income, np.ones(1000), ids, percentiles=(50,), min_households=2
    ) == [(50, 500.5, 2)]


def test_rows_rank_each_side_against_its_own_distribution():
    # 20,000 one-person households, incomes 1..20000; the measure adds
    # £100 to everyone. Each side is ranked on its own incomes, so every
    # "reform" point is the "baseline" point plus £100 and the rank of
    # each household is unchanged.
    n = 20_000
    frame = pd.DataFrame(
        {
            "people": np.ones(n),
            "baseline": np.arange(1, n + 1, dtype=float),
            "reform": np.arange(1, n + 1, dtype=float) + 100,
        }
    )
    rows = IncomeDistributionCalculator().calculate_from_dataframe(
        "m", "Measure", 2027, frame
    )
    by = {(r["side"], r["percentile"]): r for r in rows}
    assert {r["percentile"] for r in rows} == set(DISTRIBUTION_PERCENTILES)
    assert len(rows) == 2 * len(DISTRIBUTION_PERCENTILES)
    # 50th: people 9,901..10,100, mean 10,000.5, rounded to £10,000 (half
    # to even).
    assert by[("baseline", 50)]["equivalised_net_income"] == 10_000
    assert by[("reform", 50)]["equivalised_net_income"] == 10_100
    assert set(rows[0]) == {
        "reform_id",
        "reform_name",
        "year",
        "side",
        "percentile",
        "equivalised_net_income",
    }


def test_cli_offers_income_distribution():
    from uk_budget_data.cli import parse_args

    parsed = parse_args(["generate", "--only", "income_distribution"])
    assert parsed.only == "income_distribution"


def test_comparable_income_leaves_out_what_the_calculator_never_counts():
    # Household net income £50,000 includes £7,000 of NHS spending in kind
    # and is net of £1,000 business rates, £100 corporate stamp duty and
    # £600 stamp duty: £50,000 - £7,000 + £1,700 = £44,700.
    from types import SimpleNamespace

    from uk_budget_data.calculators import comparable_net_income

    values = {
        "household_net_income": 50_000,
        "nhs_spending": 7_000,
        "business_rates": 1_000,
        "corporate_sdlt": 100,
        "expected_sdlt": 600,
        "expected_ltt": 0,
        "expected_lbtt": 0,
    }
    sim = SimpleNamespace(
        calculate=lambda variable, period, map_to: SimpleNamespace(
            values=np.array([values[variable]], dtype=float)
        )
    )
    assert comparable_net_income(sim, 2027).tolist() == [44_700.0]
