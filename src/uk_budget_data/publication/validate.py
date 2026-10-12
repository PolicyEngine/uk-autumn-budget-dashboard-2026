"""Completeness checks on an artifact's tables.

These are the national checks from the team's published-data validator
(``scripts/validate_published_data.py`` on PR #3), applied to one artifact:
every required year is covered, each table has exactly the rows it should
for each year, the decile sets are exact, and a measure shows no effect
before the year it starts. (The validator's check that the household sample
is identical across years does not apply: an artifact's sample is chosen by
household id, and which households fall in the plotted income range varies
by year.) Types, finiteness and duplicate keys are already enforced when a
table is read.
"""

from collections import defaultdict
from typing import Mapping, Optional

from uk_budget_data.publication.tables import (
    BRIEFING_TABLES,
    TABLES,
    TableError,
    normalise,
)

ROWS_PER_YEAR = {
    "budgetary_impact": 1,
    "distributional_impact": 10,
    "winners_losers": 11,
    "metrics": 1,
    "income_curve": 201,
}
DECILES = frozenset(
    f"{n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'}"
    for n in range(1, 11)
)
WINNERS_GROUPS = frozenset({*(str(n) for n in range(1, 11)), "all"})
KEY_SETS = {
    "distributional_impact": ("decile", DECILES),
    "winners_losers": ("decile", WINNERS_GROUPS),
}
# How each table expresses a change, for the before-start check.
NO_EFFECT_TOLERANCE = 1e-4


def _effect(table: str, row: Mapping) -> Optional[float]:
    if table == "income_curve":
        return row["reform_net_income"] - row["baseline_net_income"]
    if table == "winners_losers":
        return row["avg_change"]
    if table == "briefing_deciles":
        return row["avg_change_gbp"]
    if table == "briefing_poverty":
        return row["change_pp"]
    if table == "briefing_winners_losers":
        return row["share_pct"] - (100 if row["category"] == "no_change" else 0)
    if table in ("budgetary_impact", "distributional_impact"):
        return row["value"]
    return None


def table_problems(
    tables: Mapping[str, list[dict]],
    *,
    key: str,
    years: list[int],
    income_curve_points: int = ROWS_PER_YEAR["income_curve"],
    effective_from_year: Optional[int] = None,
) -> list[str]:
    """List every way the tables fall short of a complete artifact.

    Args:
        tables: Table name -> typed rows, as ``read_tables`` returns.
        key: The artifact key; every row must carry it as ``reform_id``.
        years: The years the receipt says were reported.
        income_curve_points: Points per year on the income curve.
        effective_from_year: The first year the measure applies, if
            declared; earlier years must show no effect.
    """
    problems = []
    expected_rows = {**ROWS_PER_YEAR, "income_curve": income_curve_points}
    for name, spec in TABLES.items():
        if name not in tables:
            if spec.required:
                problems.append(f"{name}: missing")
            continue
        rows = tables[name]
        if name in BRIEFING_TABLES:
            try:
                normalise(name, rows)
            except TableError as error:
                problems.append(str(error))
                continue
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
                if spec.required or name in BRIEFING_TABLES:
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

    return problems
