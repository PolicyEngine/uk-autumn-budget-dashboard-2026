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

The age table's columns rest on different people (``age_change_sets``):
the households that changed (the means), those better off, worse off or
neither under the 0.01% share people affected uses (the shares), and the
people whose own taxes or earnings moved (people directly affected), each
with the people a share or count gives back as its complement. An age
group thin under any of them is thin, so its "all" row is thin whenever
people affected is. The age table may leave rows out, so its thin cells
are withheld with whatever would give them back by difference
(``withheld_age_labels``): a thin single year of age takes the other
single ages of its band with it, so the bands and "all" stay; a thin band
leaves only "all"; a thin "all" leaves no row. The decile tables must
hold every decile, so a run with a thin decile cell is written with a
warning naming the cells (``generate._apply_disclosure_floor``), and the
publication gate never stages or shows it, so ``publish review-rows``
deletes it before anything is committed. With THIN_DECILES_ENV set to
"refuse" where the generation starts, such a run is refused and nothing is
written.

The summary statistics (``metrics`` and ``poverty_inequality``) are held to
the same floor (``thin_metrics``). A poverty change rests on the survey
households behind the people whose poverty flag the measure changes, and
people affected on the survey households behind the households it
affects (``calculators.household_income_changed``). A figure resting on 1
to SURVEY_HOUSEHOLD_FLOOR - 1 of them is withheld, with its partner: a
change in percentage points with its change in % of the baseline rate,
a child poverty change when the people other than children would be
given back by difference from everyone's, and people affected when the
households it does not affect are that few, since it is 100 less their
share. A withheld figure is an empty cell, and the receipt names its
table, year and column, never a figure.
Unlike a thin decile cell it is the intended outcome, so the artifact
still stages and shows. Differences across runs (one measure's figure
against the package's) are not checked.
"""

import os
from typing import Optional

import numpy as np
import pandas as pd

from uk_budget_data.calculators import (
    AGE_BAND_ALL,
    AGE_BANDS,
    DIRECT_EFFECT_MIN_GBP,
    HEADLINE_POVERTY,
    POVERTY_GROUPS,
    POVERTY_MEASURES,
    SINGLE_AGE_MIN_RECORDS,
    age_band_of,
    household_income_changed,
    income_change_direction,
    own_income_change,
    single_age_of,
)
from uk_budget_data.publication.tables import TABLES

SURVEY_HOUSEHOLD_FLOOR = 3
# A household whose net income moves by less than this, £ a year, has not
# changed: the difference is rounding in the engine.
CHANGE_TOLERANCE = 0.01
DECILE_TABLES = ("distributional_impact", "winners_losers")
AGE_TABLE = "age_impact"
# The tables a receipt's floor record covers, and names in its "tables"
# (``floor_record``): the decile and age tables,
# held to SURVEY_HOUSEHOLD_FLOOR, and the binned scatter, whose rows name
# their survey household once it has run and which ``tables.bin_scatter``
# holds to its own SCATTER_MIN_HOUSEHOLDS.
# The summary statistics' tables, whose thin figures are withheld
# (``thin_metrics``): the headline ones in metrics, the poverty measures by
# group in poverty_inequality.
METRICS_TABLES = ("metrics", "poverty_inequality")
FLOOR_TABLES = (
    *DECILE_TABLES,
    AGE_TABLE,
    "household_scatter_binned",
    *METRICS_TABLES,
)
# What the floor covered before its record named its tables (#271): a
# receipt with no "tables" covers these, and not the summary statistics.
FLOOR_TABLES_BEFORE_THE_LIST = (
    *DECILE_TABLES,
    AGE_TABLE,
    "household_scatter_binned",
)
# The people a group's poverty figure and everyone's give back by
# difference: those outside the group (``thin_metrics``).
OUTSIDE = " (outside)"
# Groups no row shows but the rows give back by difference (``age_groups``):
# a band's people whose age has no row of its own, labelled with the band
# and this, and anyone in no band.
OTHER_AGES = " (ages without a row)"
NO_BAND = "all (in no band)"
THIN_DECILES_ENV = "UK_BUDGET_THIN_DECILES"


def refuses_thin_deciles() -> bool:
    """Whether a run with a thin decile cell is refused (THIN_DECILES_ENV
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


def _person_households(baseline, year: int, survey: np.ndarray) -> np.ndarray:
    """Each person's household's position in the engine's household order,
    which ``survey`` follows."""
    households = pd.Index(_values(baseline, "household_id", year, "household"))
    if len(households) != len(survey):
        raise ValueError(
            f"{len(survey)} survey households for {len(households)} households"
        )
    position = households.get_indexer(
        _values(baseline, "household_id", year, "person")
    )
    if (position < 0).any():
        raise ValueError("a person's household is not among the households")
    return position


def age_change_sets(
    baseline_net, reform_net, own_change, position
) -> dict[str, np.ndarray]:
    """The people each of the age table's columns rests on, by person, as
    ``AgeImpactCalculator`` makes them (#285 review, findings 2 and 5):

    - ``changed``: their household's net income moved by CHANGE_TOLERANCE
      or more, behind ``mean_change`` and ``mean_equivalised_change``.
    - ``better``, ``worse`` and ``affected``: it moved up, down, or either
      way by more than the calculator's share of baseline income
      (``calculators.income_change_direction``), behind ``pct_better_off``
      and ``pct_worse_off``. ``affected`` is ``household_income_changed``,
      the people_affected rule, so the "all" row is thin whenever
      metrics' people_affected is: its better and worse off add up to it.
    - ``unchanged``: neither, behind ``pct_unchanged``.
    - ``not better``, ``not worse``, ``not affected``: the people the
      shares give back as 100 less them.
    - ``direct`` and ``not direct``: their own taxes or earnings moved by
      DIRECT_EFFECT_MIN_GBP or more (``calculators.own_income_change``),
      behind ``people_directly_affected``; ``people`` less it gives back
      the others.

    ``baseline_net`` and ``reform_net`` are by household, ``own_change``
    by person, and ``position`` is each person's household."""
    change = reform_net - baseline_net
    better, worse = income_change_direction(baseline_net, reform_net)
    affected = household_income_changed(baseline_net, reform_net)
    direct = own_change >= DIRECT_EFFECT_MIN_GBP
    return {
        "changed": (np.abs(change) >= CHANGE_TOLERANCE)[position],
        "better": better[position],
        "worse": worse[position],
        "affected": affected[position],
        "unchanged": ~(better | worse)[position],
        "not better": ~better[position],
        "not worse": ~worse[position],
        "not affected": ~affected[position],
        "direct": direct,
        "not direct": ~direct,
    }


def thin_cells(
    baseline, reformed, years: list[int], survey
) -> dict[tuple[str, int], list[str]]:
    """Each (table, year) with a thin cell, and the cells' labels.

    A decile is thin when 1 to SURVEY_HOUSEHOLD_FLOOR - 1 survey households
    in it changed by CHANGE_TOLERANCE or more. An age group is thin when
    it is under any of ``age_change_sets``, so no column of its row rests
    on 1 or 2 survey households, nor gives them back. The labels keep the
    groups' order.

    ``survey`` names the survey household behind each of the simulations'
    households, in the engine's household order.
    """
    survey = np.asarray(survey)
    position = _person_households(baseline, years[0], survey)
    found = {}
    for year in years:
        baseline_net = _values(
            baseline, "household_net_income", year, "household"
        )
        reform_net = _values(
            reformed, "household_net_income", year, "household"
        )
        changed = np.abs(reform_net - baseline_net) >= CHANGE_TOLERANCE
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
        sets = age_change_sets(
            baseline_net,
            reform_net,
            own_income_change(baseline, reformed, year),
            position,
        )
        flagged = set()
        for members in sets.values():
            flagged.update(thin_groups(groups, members, survey[position]))
        thin = [label for label in groups if label in flagged]
        if thin:
            found[(AGE_TABLE, year)] = thin
    return found


def _crossed(baseline, reformed, variable: str, year: int) -> np.ndarray:
    """The people whose ``variable`` (a poverty flag) the measure changes."""
    before = _values(baseline, variable, year, "person").astype(bool)
    return before != _values(reformed, variable, year, "person").astype(bool)


def _with_partners(table: str, columns: set[str]) -> list[str]:
    """``columns`` with each change in percentage points' partner in % of
    the baseline rate (one gives the other back, given the rate), in the
    table's column order."""
    columns = columns | {
        column[: -len("_pp")] + "_pct"
        for column in columns
        if column.endswith("_pp")
    }
    return [name for name in TABLES[table].column_names if name in columns]


def thin_metrics(
    baseline, reformed, years: list[int], survey
) -> dict[tuple[str, int], list[str]]:
    """Each (table, year) of the summary statistics with a figure resting
    on 1 to SURVEY_HOUSEHOLD_FLOOR - 1 survey households, and the columns
    to withhold, its partners included. With the calculator's variables
    and definitions (``calculators.MetricsCalculator``), so the check is of
    what is published:

    - ``people_affected``: the survey households behind the households
      ``household_income_changed`` counts, of those with an income decile;
      or behind those it does not, since people_affected is 100 less
      their share (#285 review, finding 5).
    - ``poverty_change_pp`` and ``_pct`` (HEADLINE_POVERTY, everyone), and
      each POVERTY_MEASURES column for each POVERTY_GROUPS group: the
      survey households behind the people in the group whose flag the
      measure changes. Nobody crossing is an exact zero, which is safe.
    - A group's column, when the people outside it are thin and
      everyone's is not: everyone's and the group's give theirs back by
      difference.

    ``survey`` names the survey household behind each of the simulations'
    households, in the engine's household order.
    """
    survey = np.asarray(survey)
    person_survey = survey[_person_households(baseline, years[0], survey)]
    found = {}
    for year in years:
        changed = household_income_changed(
            _values(baseline, "household_net_income", year, "household"),
            _values(reformed, "household_net_income", year, "household"),
        )
        decile = _values(
            baseline, "household_income_decile", year, "household"
        )
        valid = {"people_affected": decile >= 1}
        withheld = {
            "metrics": set(thin_groups(valid, changed, survey))
            | set(thin_groups(valid, ~changed, survey)),
            "poverty_inequality": set(),
        }
        everyone = np.ones(len(person_survey), dtype=bool)
        if thin_groups(
            {"poverty_change_pp": everyone},
            _crossed(baseline, reformed, HEADLINE_POVERTY, year),
            person_survey,
        ):
            withheld["metrics"].add("poverty_change_pp")
        groups = {
            prefix: (
                everyone
                if flag is None
                else _values(baseline, flag, year, "person").astype(bool)
            )
            for prefix, flag in POVERTY_GROUPS.items()
        }
        groups.update(
            {
                prefix + OUTSIDE: ~groups[prefix]
                for prefix, flag in POVERTY_GROUPS.items()
                if flag is not None
            }
        )
        for measure, variable in POVERTY_MEASURES.items():
            thin = set(
                thin_groups(
                    groups,
                    _crossed(baseline, reformed, variable, year),
                    person_survey,
                )
            )
            for label in thin:
                prefix = label.removesuffix(OUTSIDE)
                if label.endswith(OUTSIDE) and "" in thin:
                    # Everyone's is withheld, so nothing gives these back.
                    continue
                withheld["poverty_inequality"].add(
                    f"{prefix}poverty_{measure}_change_pp"
                )
        for table, columns in withheld.items():
            if columns:
                found[(table, year)] = _with_partners(table, columns)
    return found


def withhold_metrics(
    rows: list[dict], found: dict[tuple[str, int], list[str]]
) -> list[dict]:
    """The summary statistics' rows (``ReformResult.metrics``, which carry
    both tables' columns) with each thin figure ``thin_metrics`` found set
    to None, which the tables write as an empty cell."""
    withheld: dict[int, set[str]] = {}
    for (table, year), columns in found.items():
        if table in METRICS_TABLES:
            withheld.setdefault(year, set()).update(columns)
    return [
        {
            column: (
                None if column in withheld.get(row["year"], ()) else value
            )
            for column, value in row.items()
        }
        for row in rows
    ]


def floor_record(
    found: dict[tuple[str, int], list[str]],
    *,
    not_checked_because: Optional[str] = None,
) -> dict:
    """What an artifact's receipt records of the floor
    (``dashboard.disclosure_floor``): the cells found thin, by table, year
    and group label, never a figure, and whether any is still in the tables
    (a decile table's, unless the run was refused), which the publication
    gate and the public data check refuse. ``survey_households`` is the
    decile, age and summary tables' floor, SURVEY_HOUSEHOLD_FLOOR; the
    binned scatter's is SCATTER_MIN_HOUSEHOLDS. ``tables`` names the tables
    the floor covers (FLOOR_TABLES), so the gate can tell a receipt made
    before it covered one (``publish._floor_problems``). A run on data
    whose survey households cannot be told apart records that it was not
    checked, and why."""
    cells = [
        {"table": table, "year": year, "groups": list(labels)}
        for (table, year), labels in sorted(found.items())
    ]
    record = {
        "survey_households": SURVEY_HOUSEHOLD_FLOOR,
        "tables": list(FLOOR_TABLES),
        "checked": not_checked_because is None,
        "thin_cells": cells,
        "thin_cells_in_tables": any(
            cell["table"] in DECILE_TABLES for cell in cells
        ),
    }
    if not_checked_because is not None:
        record["not_checked_because"] = not_checked_because
    return record


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
