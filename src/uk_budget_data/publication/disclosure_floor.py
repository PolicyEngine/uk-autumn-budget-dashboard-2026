"""Thin cells in an artifact's household tables.

The decile tables (``distributional_impact``, ``winners_losers``) and the
age table (``age_impact``) average each household's change over a group. A
group whose change comes from fewer than SURVEY_HOUSEHOLD_FLOOR survey
households rests on too few cases to publish, however many households the
group holds: its average is those households' change over a group size
anyone can estimate. The floor is the UK Data Service's minimum threshold
for Safeguarded data, which the End User Licence binds us to (CD171
version 18, section 5.2.1: never report a cell "based on only one or two
cases"). The same section advises, but does not require, 10 against
secondary disclosure, and the FRS adds no condition of its own
(microcosm#1278); the binned scatter, the income mobility shares and the
results by area keep 10. Microcosm builds several records
from one survey household, so the floor counts the survey households behind
the changed records (``pipeline.scatter_survey_households``), as the binned
scatter and the results by area do.

The age table may leave rows out, so its thin cells are withheld with
whatever would give them back by difference (``withheld_age_labels``): a
thin single year of age takes the other single ages of its band with it,
so the bands and "all" stay; a thin band leaves only "all"; a thin "all"
leaves no row. The decile tables keep their identifying columns and
withhold every value in a thin decile's row, plus the winners and losers
"all" row that would give it back by difference. A combined run also
withholds its members' withheld cells. When "all" itself is thin, the
whole measure and its costing rest on too few households: that run keeps
the warning and publication refusal, or is refused before writing when
THIN_DECILES_ENV is "refuse".
"""

import os
from typing import Optional

import numpy as np
import pandas as pd

from uk_budget_data.calculators import (
    AGE_BAND_ALL,
    AGE_BANDS,
    SINGLE_AGE_MIN_RECORDS,
    age_band_of,
    single_age_of,
)

SURVEY_HOUSEHOLD_FLOOR = 3
# A household whose net income moves by less than this, £ a year, has not
# changed: the difference is rounding in the engine.
CHANGE_TOLERANCE = 0.01
DECILE_TABLES = ("distributional_impact", "winners_losers")
AGE_TABLE = "age_impact"
# The tables the floor holds: the decile and age tables, and the binned
# scatter, whose rows name their survey household once it has run.
FLOOR_TABLES = (*DECILE_TABLES, AGE_TABLE, "household_scatter_binned")
# Groups no row shows but the rows give back by difference (``age_groups``):
# a band's people whose age has no row of its own, labelled with the band
# and this, and anyone in no band.
OTHER_AGES = " (ages without a row)"
NO_BAND = "all (in no band)"
THIN_DECILES_ENV = "UK_BUDGET_THIN_DECILES"


def refuses_thin_deciles() -> bool:
    """Whether a run with a thin "all" group is refused (THIN_DECILES_ENV
    set to "refuse") rather than written with a warning (the default, or
    "warn"; #208 review, finding 11). Read where the generation starts and
    carried on each run (``generate.ArtifactRun.refuse_thin_deciles``),
    never where a run is made. Any other setting stops the generation, so a
    mistyped one never picks a mode."""
    mode = os.environ.get(THIN_DECILES_ENV) or "warn"
    if mode not in ("warn", "refuse"):
        raise ValueError(
            f"{THIN_DECILES_ENV} is {mode!r}: set it to 'warn' (the "
            "default) or 'refuse'"
        )
    return mode == "refuse"


def thin_groups(
    groups: dict[str, np.ndarray], changed: np.ndarray, survey: np.ndarray
) -> list[str]:
    """The groups whose change comes from 1 to SURVEY_HOUSEHOLD_FLOOR - 1
    survey households.

    ``groups`` maps each published label to a mask over the rows,
    ``changed`` marks the rows whose household changed and ``survey`` names
    each row's survey household. A group in which no household changed
    shows no change, which is safe to publish.
    """
    thin = []
    for label, members in groups.items():
        count = len(np.unique(survey[members & changed]))
        if 0 < count < SURVEY_HOUSEHOLD_FLOOR:
            thin.append(label)
    return thin


def decile_groups(decile: np.ndarray) -> dict[str, np.ndarray]:
    """The winners and losers groups, by household: each income decile and
    "all" (households with a decile), as the calculators publish them."""
    groups = {str(n): decile == n for n in range(1, 11)}
    groups["all"] = decile >= 1
    return groups


def age_groups(age: np.ndarray, decile: np.ndarray) -> dict[str, np.ndarray]:
    """The age table's groups, by person, as ``AgeImpactCalculator``
    publishes them: the age bands, "all", and each single year of age with
    at least SINGLE_AGE_MIN_RECORDS records. People whose household has no
    income decile are left out.

    Also the groups the published rows give back by difference, which no
    row shows: each band's people whose age has no row of its own (the band
    less its single ages, labelled with OTHER_AGES), and anyone in no band
    ("all" less the bands, NO_BAND)."""
    kept = decile >= 1
    bands = age_band_of(age)
    groups = {label: kept & (bands == label) for label, _, _ in AGE_BANDS}
    groups[AGE_BAND_ALL] = kept
    groups[NO_BAND] = kept & (bands == "")
    singles = single_age_of(age)
    with_a_row = np.zeros(len(age), dtype=bool)
    for label in np.unique(singles[kept]):
        members = kept & (singles == label)
        if members.sum() >= SINGLE_AGE_MIN_RECORDS:
            groups[str(label)] = members
            with_a_row |= members
    for label, _, _ in AGE_BANDS:
        groups[label + OTHER_AGES] = groups[label] & ~with_a_row
    return groups


def _values(simulation, variable: str, year: int, map_to: str) -> np.ndarray:
    return np.asarray(
        simulation.calculate(variable, period=year, map_to=map_to).values
    )


def thin_cells(
    baseline, reformed, years: list[int], survey
) -> dict[tuple[str, int], list[str]]:
    """Each (table, year) with a thin cell, and the cells' labels.

    ``survey`` names the survey household behind each of the simulations'
    households, in the engine's household order.
    """
    survey = np.asarray(survey)
    households = pd.Index(
        _values(baseline, "household_id", years[0], "household")
    )
    if len(households) != len(survey):
        raise ValueError(
            f"{len(survey)} survey households for {len(households)} households"
        )
    position = households.get_indexer(
        _values(baseline, "household_id", years[0], "person")
    )
    if (position < 0).any():
        raise ValueError("a person's household is not among the households")
    found = {}
    for year in years:
        change = _values(
            reformed, "household_net_income", year, "household"
        ) - _values(baseline, "household_net_income", year, "household")
        changed = np.abs(change) >= CHANGE_TOLERANCE
        decile = _values(
            baseline, "household_income_decile", year, "household"
        )
        thin = thin_groups(decile_groups(decile), changed, survey)
        if thin:
            for table in DECILE_TABLES:
                found[(table, year)] = thin
        groups = age_groups(
            _values(baseline, "age", year, "person"),
            _values(baseline, "household_income_decile", year, "person"),
        )
        thin = thin_groups(groups, changed[position], survey[position])
        if thin:
            found[(AGE_TABLE, year)] = thin
    return found


def floor_record(
    found: dict[tuple[str, int], list[str]],
    *,
    withheld: Optional[dict[tuple[str, int], list[str]]] = None,
    not_checked_because: Optional[str] = None,
) -> dict:
    """Record the floor in an artifact's receipt.

    ``dashboard.disclosure_floor`` names the cells found thin by table,
    year and group label, never a figure, and whether any is still published.
    A thin "all" always keeps the refusal, including the costing. An
    omitted ``withheld`` keeps the meaning of receipts made before decile
    withholding. A run whose survey households cannot be told apart
    records that it was not checked, and why."""
    cells = [
        {"table": table, "year": year, "groups": list(labels)}
        for (table, year), labels in sorted(found.items())
    ]
    record = {
        "survey_households": SURVEY_HOUSEHOLD_FLOOR,
        "checked": not_checked_because is None,
        "thin_cells": cells,
        "thin_cells_in_tables": any(
            table in DECILE_TABLES
            and (
                "all" in labels
                or any(
                    label not in (withheld or {}).get((table, year), [])
                    for label in labels
                )
            )
            for (table, year), labels in found.items()
        ),
    }
    if withheld is not None:
        record["withheld_cells"] = [
            {"table": table, "year": year, "groups": list(labels)}
            for (table, year), labels in sorted(withheld.items())
            if labels
        ]
    if not_checked_because is not None:
        record["not_checked_because"] = not_checked_because
    return record


def decile_label(label) -> str:
    """Return the canonical group label for numeric or ordinal decile rows."""
    value = str(label)
    for suffix in ("st", "nd", "rd", "th"):
        if value.endswith(suffix):
            return value[: -len(suffix)]
    return value


def withheld_decile_cells(
    found: dict[tuple[str, int], list[str]],
    inherited: Optional[dict[tuple[str, int], list[str]]] = None,
) -> dict[tuple[str, int], list[str]]:
    """Return decile cells withheld for thin groups and a package's members.

    The winners and losers "all" row is withheld in every affected year,
    since a weighted total and the other deciles can give a decile back.
    Distributional impact has no "all" row. A thin "all" keeps the whole
    measure refusal instead of withholding its costing's underlying cases.
    """
    withheld = {
        cell: set(labels) for cell, labels in (inherited or {}).items()
    }
    whole_years = {
        year
        for (table, year), labels in found.items()
        if table in DECILE_TABLES and "all" in labels
    }
    for (table, year), labels in found.items():
        if table in DECILE_TABLES and year not in whole_years:
            withheld.setdefault((table, year), set()).update(labels)
    for year in {year for (_, year), labels in withheld.items() if labels}:
        withheld.setdefault(("winners_losers", year), set()).add("all")
    return {
        cell: sorted(
            labels,
            key=lambda label: (
                label == "all",
                int(label) if label != "all" else 0,
            ),
        )
        for cell, labels in sorted(withheld.items())
        if labels
    }


def withhold_decile_rows(
    rows: list[dict],
    table: str,
    withheld: dict[tuple[str, int], list[str]],
) -> list[dict]:
    """Keep decile row identifiers and blank every withheld value."""
    identifying = {"reform_id", "reform_name", "year", "decile"}
    return [
        (
            {
                name: value if name in identifying else None
                for name, value in row.items()
            }
            if decile_label(row["decile"])
            in withheld.get((table, row["year"]), [])
            else row
        )
        for row in rows
    ]


def recorded_withheld_cells(record: dict) -> dict[tuple[str, int], list[str]]:
    """Read a member's decile withholding, accepting older floor records."""
    if not isinstance(record, dict):
        raise ValueError("its disclosure floor is not an object")
    cells = record.get("withheld_cells", [])
    if not isinstance(cells, list):
        raise ValueError("its withheld cells are not a list")
    found: dict[tuple[str, int], list[str]] = {}
    for cell in cells:
        if not isinstance(cell, dict):
            raise ValueError("its withheld cell is not an object")
        table, year, labels = (
            cell.get("table"),
            cell.get("year"),
            cell.get("groups"),
        )
        allowed = {str(n) for n in range(1, 11)}
        if table == "winners_losers":
            allowed.add("all")
        if (
            table not in DECILE_TABLES
            or type(year) is not int
            or not isinstance(labels, list)
            or any(
                not isinstance(label, str) or label not in allowed
                for label in labels
            )
        ):
            raise ValueError(
                "its withheld cell has invalid table, year or groups"
            )
        found.setdefault((table, year), []).extend(labels)
    return withheld_decile_cells({}, found)


def thin_cells_reason(found: dict[tuple[str, int], list[str]]) -> str:
    """The thin cells, naming tables, years and group labels, never a
    figure."""
    parts = [
        f"{table} {year} ({', '.join(labels)})"
        for (table, year), labels in sorted(found.items())
    ]
    return (
        f"cells resting on fewer than {SURVEY_HOUSEHOLD_FLOOR} survey "
        f"households: {'; '.join(parts)}"
    )


def _band_of_single_age(label: str) -> str:
    """The band a single year of age's label ("40", "90+") falls in."""
    return age_band_of(np.array([int(label.rstrip("+"))]))[0]


def withheld_age_labels(
    thin: list[str], labels: list[str]
) -> Optional[set[str]]:
    """Which of a year's age table ``labels`` to withhold, given its
    ``thin`` groups (``age_groups``), so that no published row, nor any sum
    or difference of them, rests on a thin group; None withholds them all.

    - "all" thin: every row.
    - A band thin, or the people in no band: every row but "all", since the
      bands add up to it.
    - Otherwise every single year of age in a band with a thin single age,
      or whose ages without a row are thin; the bands, "all" and the other
      bands' single ages stay. Each band is then either whole, giving back
      only its ages without a row, which are not thin, or shown as one row.
    """
    if AGE_BAND_ALL in thin:
        return None
    bands = {label for label, _, _ in AGE_BANDS}
    if NO_BAND in thin or bands & set(thin):
        return {label for label in labels if label != AGE_BAND_ALL}
    dirty = {
        (
            label[: -len(OTHER_AGES)]
            if label.endswith(OTHER_AGES)
            else _band_of_single_age(label)
        )
        for label in thin
    }
    return {
        label
        for label in labels
        if label not in bands
        and label != AGE_BAND_ALL
        and _band_of_single_age(label) in dirty
    }


def withhold_thin_age_rows(
    rows: list[dict], found: dict[tuple[str, int], list[str]]
) -> list[dict]:
    """The age table's rows without its thin cells, nor any row that would
    give one back (``withheld_age_labels``), year by year."""
    labels: dict[int, list[str]] = {}
    for row in rows:
        labels.setdefault(row["year"], []).append(row["age_band"])
    withheld = {
        year: withheld_age_labels(found[(AGE_TABLE, year)], year_labels)
        for year, year_labels in labels.items()
        if (AGE_TABLE, year) in found
    }
    kept = []
    for row in rows:
        if row["year"] in withheld:
            dropped = withheld[row["year"]]
            if dropped is None or row["age_band"] in dropped:
                continue
        kept.append(row)
    return kept


def survey_scatter_rows(rows: list[dict], household_ids, survey) -> list[dict]:
    """The household scatter's rows, each naming its survey household, so
    that ``tables.bin_scatter`` counts survey households rather than
    records. ``household_ids`` and ``survey`` are in the engine's household
    order."""
    by_household = dict(zip(np.asarray(household_ids).tolist(), survey))
    return [
        {**row, "survey_household": by_household[row["household_id"]]}
        for row in rows
    ]
