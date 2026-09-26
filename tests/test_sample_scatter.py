"""Tests for consistent scatter sampling across reform/year combinations."""

import pandas as pd

from scripts.sample_household_scatter import sample_scatter_data


def test_sample_requires_household_in_every_reform_year(tmp_path):
    """A household present in each year overall can still miss one policy."""
    rows = []
    for reform in ("first", "second"):
        for year in (2026, 2027):
            for household_id in (1, 2, 3):
                if reform == "second" and year == 2027 and household_id == 3:
                    continue
                rows.append(
                    {
                        "reform_id": reform,
                        "year": year,
                        "household_id": household_id,
                        "baseline_income": 30000,
                        "income_change": 1,
                        "household_weight": 1,
                    }
                )
    source = tmp_path / "full.csv"
    output = tmp_path / "sample.csv"
    pd.DataFrame(rows).to_csv(source, index=False)
    sample_scatter_data(source, output, sample_size=2)
    sampled = pd.read_csv(output)
    assert set(sampled.household_id) == {1, 2}
    assert sampled.groupby(["reform_id", "year"]).size().eq(2).all()
