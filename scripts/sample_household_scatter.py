#!/usr/bin/env python
"""Sample household scatter data for git storage.

The full household_scatter_full.csv (~100MB) contains all ~46k households
per reform/year. This script samples it to ~500 households using weighted
sampling to create household_scatter.csv for git.

IMPORTANT: We sample the SAME households across all reforms so that when
combining policies in the frontend, the dots represent consistent households
that just move position (not shuffle randomly).

Usage:
    python scripts/sample_household_scatter.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

SAMPLE_SIZE = 500  # Households (same across all reforms AND all years)
SEED = 42  # For reproducibility


def sample_scatter_data(
    input_path: Path,
    output_path: Path,
    sample_size: int = SAMPLE_SIZE,
) -> None:
    """Sample household scatter data using weighted sampling.

    Samples the SAME households across all reforms AND all years for consistency.
    Uses the stable FRS household_id to ensure consistent identification.

    CRITICAL: We sample households ONCE globally (not per-year), then keep those
    SAME households across ALL reforms AND ALL years. This ensures:
    1. Dots move consistently when policies are combined (same households)
    2. Dots move consistently when changing years (same households tracked over time)

    Args:
        input_path: Path to full household_scatter_full.csv
        output_path: Path to write sampled household_scatter.csv
        sample_size: Number of households to sample (same across all years/reforms)
    """
    print(f"Reading {input_path}...")
    df = pd.read_csv(input_path)
    print(f"  {len(df):,} rows")

    # Check if stable household_id is available (from updated pipeline)
    # If not, fall back to baseline_income + household_weight combo
    if "household_id" not in df.columns:
        print(
            "  Note: Using baseline_income + weight as household_id (legacy mode)"
        )
        df["household_id"] = (
            df["baseline_income"].astype(str)
            + "_"
            + df["household_weight"].astype(str)
        )
    else:
        # Convert to int for consistent matching
        df["household_id"] = df["household_id"].astype(int)

    rng = np.random.default_rng(seed=SEED)

    # Step 1: Find households that exist in ALL years
    # This ensures we can track the same households over time
    years = sorted(df["year"].unique())
    print(f"  Years: {years}")

    # Get household_ids present in each year
    households_by_year = {}
    for year in years:
        year_ids = set(df[df["year"] == year]["household_id"].unique())
        households_by_year[year] = year_ids
        print(f"  Year {year}: {len(year_ids)} unique households")

    # Find households present in ALL years
    common_households = households_by_year[years[0]]
    for year in years[1:]:
        common_households = common_households.intersection(
            households_by_year[year]
        )

    print(f"  Households present in ALL years: {len(common_households)}")

    # Step 2: Sample from households that exist in all years
    # Use weights from first year for sampling
    first_year_data = df[df["year"] == years[0]]
    common_df = first_year_data[
        first_year_data["household_id"].isin(common_households)
    ].copy()

    common_df = common_df.drop_duplicates("household_id")
    n_common = len(common_df)
    if n_common <= sample_size:
        sampled_ids = set(common_df["household_id"].values)
        print(f"  Kept all {n_common} common households")
    else:
        # Weighted sampling - higher weight = higher chance
        weights = common_df["household_weight"].values
        probs = weights / weights.sum()

        indices = rng.choice(
            n_common,
            size=sample_size,
            replace=False,
            p=probs,
        )
        sampled_ids = set(common_df.iloc[indices]["household_id"].values)
        print(f"  Sampled {sample_size} from {n_common} common households")

    # Step 3: Filter all data to only include sampled households
    # This keeps all reforms and all years for each sampled household
    result = df[df["household_id"].isin(sampled_ids)].copy()

    # Sort by reform_id, year, household_id for consistent ordering
    result = result.sort_values(
        ["reform_id", "year", "household_id"]
    ).reset_index(drop=True)

    # Verify consistency
    years_per_hh = result.groupby("household_id")["year"].nunique()
    reforms_per_hh_year = result.groupby(["year", "household_id"])[
        "reform_id"
    ].nunique()

    print(f"\n  Total rows after sampling: {len(result):,}")
    print(f"  Unique households: {result['household_id'].nunique()}")
    print(
        f"  Years per household: min={years_per_hh.min()}, max={years_per_hh.max()}, avg={years_per_hh.mean():.1f}"
    )
    print(
        f"  Reforms per household/year: avg={reforms_per_hh_year.mean():.1f}, max={reforms_per_hh_year.max()}"
    )

    print(f"Writing {output_path}...")
    print(f"  {len(result):,} rows (sampled from {len(df):,})")
    result.to_csv(output_path, index=False)

    # Show size comparison
    input_size = input_path.stat().st_size / 1e6
    output_size = output_path.stat().st_size / 1e6
    print(f"  Size: {input_size:.1f}MB -> {output_size:.1f}MB")


def main():
    data_dir = Path("public/data")
    input_path = data_dir / "household_scatter_full.csv"
    output_path = data_dir / "household_scatter.csv"

    if not input_path.exists():
        print(f"Error: {input_path} not found")
        print("Run 'uv run uk-budget-data' first to generate full data")
        return 1

    sample_scatter_data(input_path, output_path)
    print("Done!")
    return 0


if __name__ == "__main__":
    exit(main())
