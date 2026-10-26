"""Completeness checks on an artifact's tables.

These are the national checks from the team's published-data validator
(``scripts/validate_published_data.py`` on PR #3), applied to one artifact:
every required year is covered, each table has exactly the rows it should
for each year, the decile sets are exact, and a measure shows no effect
before the year it starts, and the household scatter samples the same
households in every year, as the validator requires. Types, finiteness and
duplicate keys are already enforced when a table is read.
"""

from collections import defaultdict
from typing import Mapping, Optional

from uk_budget_data.example_households import (
    CURVE_POINTS,
    HOUSEHOLD_IDS,
    X_VARIABLES,
)
from uk_budget_data.publication.tables import (
    SCATTER_BINS,
    SCATTER_SAMPLE_SIZE,
    TABLES,
)

ROWS_PER_YEAR = {
    "budgetary_impact": 1,
    "distributional_impact": 10,
    "winners_losers": 11,
    "metrics": 1,
    "poverty_inequality": 1,
    # Every example household, at each point on its income grid
    "income_curve": CURVE_POINTS * len(HOUSEHOLD_IDS),
}
# Optional tables that, when an artifact has them, cover every year.
COMPLETE_WHEN_PRESENT = frozenset({"poverty_inequality"})
DECILES = frozenset(
    f"{n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'}"
    for n in range(1, 11)
)
WINNERS_GROUPS = frozenset({*(str(n) for n in range(1, 11)), "all"})
KEY_SETS = {
    "distributional_impact": ("decile", DECILES),
    "winners_losers": ("decile", WINNERS_GROUPS),
}
# The change bands a binned scatter cell may name, as (lower, upper): the
# bands between consecutive edges, except the one across zero, which is
# (-1, 1), and the open-ended bands beyond the outermost edges, named by
# that edge on both sides (tables.change_band).
_EDGES = SCATTER_BINS["change_edges"]
SCATTER_CHANGE_BANDS = frozenset(
    {(lower, upper) for lower, upper in zip(_EDGES, _EDGES[1:])}
    | {(_EDGES[0], _EDGES[0]), (_EDGES[-1], _EDGES[-1])}
)


# How each table expresses a change, for the before-start check.
NO_EFFECT_TOLERANCE = 1e-4


def _effect(table: str, row: Mapping) -> Optional[float]:
    if table == "income_curve":
        return row["reform_net_income"] - row["baseline_net_income"]
    if table == "winners_losers":
        return row["avg_change"]
    if table in ("budgetary_impact", "distributional_impact"):
        return row["value"]
    return None


def _income_curve_problems(
    rows: list[dict], year: int, points: int
) -> list[str]:
    """Each example household, on its own x-axis, at every grid point."""
    problems = []
    by_household = defaultdict(list)
    for row in rows:
        by_household[row["household"]].append(row)
    if set(by_household) != set(HOUSEHOLD_IDS):
        problems.append(
            f"income_curve: households for {year} are "
            f"{sorted(by_household)}, expected {sorted(HOUSEHOLD_IDS)}"
        )
    for household, household_rows in sorted(by_household.items()):
        expected = X_VARIABLES.get(household)
        if expected is not None and any(
            row["x_variable"] != expected for row in household_rows
        ):
            problems.append(
                f"income_curve: {household} in {year} is not on " f"{expected}"
            )
        if len(household_rows) != points:
            problems.append(
                f"income_curve: {household} has {len(household_rows)} "
                f"points in {year}, expected {points}"
            )
    return problems


def table_problems(
    tables: Mapping[str, list[dict]],
    *,
    key: str,
    years: list[int],
    income_curve_points: int = CURVE_POINTS,
    effective_from_year: Optional[int] = None,
) -> list[str]:
    """List every way the tables fall short of a complete artifact.

    Args:
        tables: Table name -> typed rows, as ``read_tables`` returns.
        key: The artifact key; every row must carry it as ``reform_id``.
        years: The years the receipt says were reported.
        income_curve_points: Points per year on each example household's
            income curve.
        effective_from_year: The first year the measure applies, if
            declared; earlier years must show no effect.
    """
    problems = []
    expected_rows = {
        **ROWS_PER_YEAR,
        "income_curve": income_curve_points * len(HOUSEHOLD_IDS),
    }
    for name, spec in TABLES.items():
        if name not in tables:
            if spec.required:
                problems.append(f"{name}: missing")
            continue
        rows = tables[name]
        foreign = {row["reform_id"] for row in rows} - {key}
        if foreign:
            problems.append(f"{name}: rows for {sorted(foreign)}")
        by_year = defaultdict(list)
        for row in rows:
            by_year[row["year"]].append(row)
        extra_years = sorted(set(by_year) - set(years))
        if extra_years:
            problems.append(f"{name}: unexpected years {extra_years}")
        for year in years:
            matching = by_year.get(year, [])
            if not matching:
                # An optional table may be absent, but one that is present
                # covers every year, as metrics does
                if spec.required or name in COMPLETE_WHEN_PRESENT:
                    problems.append(f"{name}: missing {year}")
                continue
            count = expected_rows.get(name)
            if count is not None and len(matching) != count:
                problems.append(
                    f"{name}: {year} has {len(matching)} rows, expected {count}"
                )
            if name in KEY_SETS:
                column, allowed = KEY_SETS[name]
                if {row[column] for row in matching} != allowed:
                    problems.append(f"{name}: incomplete {column} for {year}")
            if name == "income_curve":
                problems.extend(
                    _income_curve_problems(matching, year, income_curve_points)
                )
            if (
                effective_from_year is not None
                and year < effective_from_year
                and any(
                    abs(_effect(name, row) or 0.0) > NO_EFFECT_TOLERANCE
                    for row in matching
                )
            ):
                problems.append(
                    f"{name}: an effect in {year}, before the measure "
                    f"starts in {effective_from_year}"
                )

    binned = tables.get("household_scatter_binned") or []
    unknown = {
        (row["change_band"], row["change_band_upper"])
        for row in binned
        if (row["change_band"], row["change_band_upper"])
        not in SCATTER_CHANGE_BANDS
    }
    if unknown:
        problems.append(
            f"household_scatter_binned: {len(unknown)} change bands not in "
            "the contract's change_edges"
        )
    # Every year's cells band households by the same year's income, so the
    # page can follow the same groups of households from year to year.
    bases = {(row["reform_id"], row["income_basis_year"]) for row in binned}
    if len({reform for reform, _ in bases}) < len(bases):
        problems.append(
            "household_scatter_binned: a measure's cells band households "
            "by more than one income basis year"
        )

    sample = tables.get("household_scatter")
    if sample:
        households = {
            year: {
                row["household_id"] for row in sample if row["year"] == year
            }
            for year in years
        }
        if any(not ids for ids in households.values()) or (
            len({frozenset(ids) for ids in households.values()}) > 1
        ):
            problems.append(
                "household_scatter: the sampled households differ between "
                "years"
            )
        sampled = {row["household_id"] for row in sample}
        if len(sampled) > SCATTER_SAMPLE_SIZE:
            problems.append(
                f"household_scatter: {len(sampled)} households, more than "
                f"the {SCATTER_SAMPLE_SIZE} sampled"
            )
    return problems
