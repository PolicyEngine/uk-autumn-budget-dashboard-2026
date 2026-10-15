"""The household scatter, sampled as the dashboard has always published it.

Max kept the household-level scatter files as published (cos d1397), so the
artifacts carry the same columns as public/data/household_scatter.csv, for
a weighted sample of households kept in every year. Invariants:

- the columns are exactly the published file's;
- at most SCATTER_SAMPLE_SIZE households, the same ones in every year;
- the sample depends only on the households, their first-year weights and
  the seed, never on the measure's reform: two measures over the same
  households and weights keep the same ones (weights are the dataset's,
  which a baseline changes only if it rewrites them);
- a household must be present in every reported year, and the sample
  never holds more than SCATTER_SAMPLE_SIZE households;
- removing other households never drops a sampled household that remains
  eligible (so measures whose baselines move a few households across the
  income range still share almost all of their sample);
- the table round-trips through the canonical CSV and the validator.
"""

import random

from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data.publication.tables import (
    SCATTER_SAMPLE_SIZE,
    TABLES,
    canonical_csv,
    parse_csv,
    sample_household_scatter,
)
from uk_budget_data.publication.validate import table_problems

PUBLISHED_COLUMNS = (
    "reform_id",
    "reform_name",
    "year",
    "baseline_income",
    "income_change",
    "household_weight",
    "household_id",
)


def rows(reform_id, households, years=(2027, 2028), seed=0):
    rng = random.Random(seed)
    return [
        {
            "reform_id": reform_id,
            "reform_name": reform_id.title(),
            "year": year,
            "baseline_income": rng.uniform(0, 150_000),
            "income_change": rng.uniform(-500, 500),
            "household_weight": weight,
            "household_id": household,
        }
        for household, weight in households.items()
        for year in years
    ]


def ids(sample):
    return {row["household_id"] for row in sample}


def test_the_columns_are_the_published_files():
    assert TABLES["household_scatter"].column_names == PUBLISHED_COLUMNS
    sample = sample_household_scatter(rows("alpha", {1: 10.0, 2: 20.0}))
    assert all(tuple(row) == PUBLISHED_COLUMNS for row in sample)


def test_the_same_households_in_every_year_and_at_most_the_sample_size():
    households = {n: 1.0 + n % 7 for n in range(1, 2_001)}
    sample = sample_household_scatter(rows("alpha", households))
    by_year = {
        year: {row["household_id"] for row in sample if row["year"] == year}
        for year in (2027, 2028)
    }
    assert by_year[2027] == by_year[2028]
    assert len(by_year[2027]) == SCATTER_SAMPLE_SIZE


def test_households_missing_from_a_year_are_not_sampled():
    data = rows("alpha", {1: 1.0, 2: 1.0, 3: 1.0})
    data = [
        r for r in data if not (r["household_id"] == 3 and r["year"] == 2028)
    ]
    assert ids(sample_household_scatter(data)) == {1, 2}


def test_two_measures_over_the_same_households_keep_the_same_ones():
    households = {n: 1.0 + (n * 37) % 11 for n in range(1, 3_001)}
    alpha = sample_household_scatter(rows("alpha", households, seed=1))
    beta = sample_household_scatter(rows("beta", households, seed=2))
    assert ids(alpha) == ids(beta)


@settings(max_examples=50, deadline=None)
@given(
    weights=st.lists(
        st.floats(min_value=0.01, max_value=1e4), min_size=1, max_size=60
    ),
    dropped=st.sets(st.integers(min_value=0, max_value=59)),
    size=st.integers(min_value=1, max_value=20),
)
def test_removing_other_households_never_drops_a_sampled_one(
    weights, dropped, size
):
    everyone = {n: w for n, w in enumerate(weights)}
    fewer = {n: w for n, w in everyone.items() if n not in dropped}
    full = ids(sample_household_scatter(rows("m", everyone), size=size))
    part = ids(sample_household_scatter(rows("m", fewer), size=size))
    assert full & set(fewer) <= part
    assert len(part) == min(size, len(fewer))


def test_households_with_no_weight_are_never_sampled():
    sample = sample_household_scatter(rows("m", {1: 0.0, 2: 5.0}))
    assert ids(sample) == {2}


def test_the_table_round_trips_and_validates():
    sample = sample_household_scatter(
        rows("alpha", {n: 1.0 + n for n in range(1, 50)})
    )
    data = canonical_csv("household_scatter", sample)
    assert parse_csv("household_scatter", data) == sample
    problems = table_problems(
        {"household_scatter": sample}, key="alpha", years=[2027, 2028]
    )
    assert not [p for p in problems if p.startswith("household_scatter:")]


def test_a_sample_that_differs_between_years_is_refused():
    sample = sample_household_scatter(rows("alpha", {1: 1.0, 2: 1.0}))
    sample = [
        r for r in sample if not (r["household_id"] == 2 and r["year"] == 2028)
    ]
    problems = table_problems(
        {"household_scatter": sample}, key="alpha", years=[2027, 2028]
    )
    assert (
        "household_scatter: the sampled households differ between years"
        in (problems)
    )


def test_a_year_with_no_households_in_range_empties_the_sample():
    """Review round 5: a year with no rows was missing from the
    intersection, so the sample kept households absent from that year."""
    data = rows("alpha", {1: 1.0, 2: 1.0}, years=(2027,))
    assert sample_household_scatter(data, years=[2027, 2028]) == []
    assert ids(sample_household_scatter(data, years=[2027])) == {1, 2}


def test_more_households_than_the_sample_size_are_refused():
    """Review round 5: the validator did not limit the sample's size."""
    households = {n: 1.0 for n in range(SCATTER_SAMPLE_SIZE + 1)}
    problems = table_problems(
        {"household_scatter": rows("alpha", households)},
        key="alpha",
        years=[2027, 2028],
    )
    assert any("more than the 500 sampled" in p for p in problems)
