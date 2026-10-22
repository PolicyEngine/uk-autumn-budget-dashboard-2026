"""Results by demographic group, through the disclosure layer.

The dashboard's demographic views show the change in household net income
for the people in each group: by policyengine.py's age groups
(``policyengine.outputs.AGE_GROUPS``), by age band within them, and, among
18 to 24-year-olds, by whether they are in work or education. Every figure
rests on UKDS-licensed survey microdata, so it goes through
``policyengine.disclosure`` as the results by area do (``geography``): a
floor on the survey households behind it, a dominance rule, bootstrap
intervals, rounding, and a check on what a reader recovers by subtraction
across groups.

The age levels nest (age groups in the nation, age bands in the age groups,
18 to 24-year-olds in their band), so the layer checks every subtraction
between them. Employment status cuts across ages: the layer can't check
subtraction between it and the age levels (``unchecked_overlap``), a
finding only a reviewer may accept. So employment groups are published only
when a named reviewer accepts that finding (``employment_reviewer``), in the
same release, where the layer still runs every check it can; without one
they are left out.

Records are people. Each carries their household's net income before and
after (one household's change counts once per member, so a group's figure is
the average change in household net income of the people in it), their
person weight, and the survey household behind their household
(``geography.survey_household_ids``), so the floor counts survey households,
never copies or clones.

The simulations are the national run's (``pipeline.build_microsimulation``,
policyengine.py's ``managed_microsimulation``), so the groups add up to the
national figures. Ages and statuses are the dataset's: policyengine-uk's
projection holds them at the data year's values in every year, so a 2029-30
age band holds the people who were that age in the data year. Training is
recorded only for dependent 16 to 19-year-olds, and the young people's
groups start at 18 to nest in policyengine.py's age groups, so "not in work
or education" is not the ONS's NEET measure (16 to 24).

Poverty by age group comes from the same simulations: the share of people
in each of policyengine.py's ``AGE_GROUPS`` in absolute poverty before
housing costs (``in_poverty_bhc``), before and after. policyengine.py's
``calculate_uk_poverty_by_age`` takes only its own ``Simulation`` objects,
which would need a second set of runs, uprated differently from the
national figures. These groups hold millions of people each; their rates
are published as rates only, without counts.
"""

import argparse
import contextlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Optional, Sequence

import numpy as np
import pandas as pd
from policyengine.disclosure import (
    UNASSIGNED,
    AreaEstimates,
    AreaWeights,
    DisclosureSettings,
    Release,
    estimate_change,
)
from policyengine.disclosure.schema import (
    FAMILY_CHANGE,
    RECOVERABLE_PARENT,
    RECOVERABLE_REMAINDER,
    UNCHECKED_OVERLAP,
    WITHHELD,
)
from policyengine.outputs import AGE_GROUPS

from uk_budget_data import data_limits, geography
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.geography import (
    FAMILY_OUTCOME,
    NATIONAL,
    NATIONAL_CODE,
    PUBLISHED_OUTCOMES,
    dataset_tables,
    national_prior,
    survey_household_ids,
)
from uk_budget_data.private_outputs import (
    AUDIT_DIR_ENV,
    PrivateOutputError,
    private_directory,
)
from uk_budget_data.publication import manifest as publication_manifest

AGE_BAND = "age_band"
AGE_GROUP = "age_group"
EMPLOYMENT = "employment"
YOUNG_PEOPLE = "young_people"
# Published always: they nest, so every subtraction between them is checked
AGE_LEVELS = (AGE_GROUP, AGE_BAND, YOUNG_PEOPLE)
LEVELS = (*AGE_LEVELS, EMPLOYMENT)

# (code, lowest age, highest age or None for no limit). Each band lies
# inside one of policyengine.py's AGE_GROUPS (BAND_GROUP).
AGE_BANDS = (
    ("AGE_0_17", 0, 17),
    ("AGE_18_24", 18, 24),
    ("AGE_25_34", 25, 34),
    ("AGE_35_49", 35, 49),
    ("AGE_50_64", 50, 64),
    ("AGE_65_79", 65, 79),
    ("AGE_80_PLUS", 80, None),
)
YOUNG_PEOPLE_BAND = "AGE_18_24"
YOUNG_PEOPLE_AGES = (18, 24)

EMPLOYMENT_GROUPS = {
    "FT_EMPLOYED": "EMPLOYEE",
    "PT_EMPLOYED": "EMPLOYEE",
    "FT_SELF_EMPLOYED": "SELF_EMPLOYED",
    "PT_SELF_EMPLOYED": "SELF_EMPLOYED",
    "UNEMPLOYED": "UNEMPLOYED",
    "RETIRED": "RETIRED",
    "STUDENT": "STUDENT",
    "CARER": "CARER",
    "LONG_TERM_DISABLED": "SICK_OR_DISABLED",
    "SHORT_TERM_DISABLED": "SICK_OR_DISABLED",
    "OTHER_INACTIVE": "OTHER_INACTIVE",
    "CHILD": "CHILD",
}
WORKING = frozenset(
    {"FT_EMPLOYED", "PT_EMPLOYED", "FT_SELF_EMPLOYED", "PT_SELF_EMPLOYED"}
)
NOT_IN_EDUCATION = "NOT_IN_EDUCATION"

AGE_GROUP_NAMES = {
    "child": "Children (under 18)",
    "adult": "Working age (18 to 64)",
    "senior": "Pensioners (65 and over)",
}
GROUP_NAMES = {
    AGE_BAND: {
        "AGE_0_17": "0 to 17",
        "AGE_18_24": "18 to 24",
        "AGE_25_34": "25 to 34",
        "AGE_35_49": "35 to 49",
        "AGE_50_64": "50 to 64",
        "AGE_65_79": "65 to 79",
        "AGE_80_PLUS": "80 and over",
    },
    AGE_GROUP: {group: AGE_GROUP_NAMES[group] for group in AGE_GROUPS},
    EMPLOYMENT: {
        "EMPLOYEE": "Employees",
        "SELF_EMPLOYED": "Self-employed",
        "UNEMPLOYED": "Unemployed",
        "RETIRED": "Retired",
        "STUDENT": "Students",
        "CARER": "Carers",
        "SICK_OR_DISABLED": "Sick or disabled",
        "OTHER_INACTIVE": "Other not working",
        "CHILD": "Dependent children",
    },
    YOUNG_PEOPLE: {
        "NOT_IN_WORK_OR_EDUCATION": "Not in work or education",
        "IN_WORK_OR_EDUCATION": "In work or education",
    },
}

POVERTY_COLUMNS = [
    "reform",
    "year",
    "age_group",
    "baseline_rate",
    "reform_rate",
    "change_pp",
]
_SORT = ["level", "area_code", "reform", "year", "outcome"]


class DemographicsError(RuntimeError):
    """The demographic results can't be published as they stand."""


# -- groups ---------------------------------------------------------------------


def age_band_labels(ages: Sequence) -> np.ndarray:
    """Each person's age band code."""
    ages = np.asarray(ages, dtype=float)
    labels = np.full(len(ages), UNASSIGNED, dtype=object)
    for code, lowest, highest in AGE_BANDS:
        inside = ages >= lowest
        if highest is not None:
            inside &= ages <= highest
        labels[inside] = code
    return labels


def age_group_labels(ages: Sequence) -> np.ndarray:
    """Each person's age group, by policyengine.py's ``AGE_GROUPS``."""
    ages = np.asarray(ages, dtype=float)
    labels = np.full(len(ages), UNASSIGNED, dtype=object)
    for group, rule in AGE_GROUPS.items():
        if rule.get("filter_variable") != "age":
            raise DemographicsError(f"AGE_GROUPS[{group!r}] is not by age")
        inside = np.ones(len(ages), dtype=bool)
        if rule.get("filter_variable_geq") is not None:
            inside &= ages >= rule["filter_variable_geq"]
        if rule.get("filter_variable_leq") is not None:
            inside &= ages <= rule["filter_variable_leq"]
        if rule.get("filter_variable_eq") is not None:
            inside &= ages == rule["filter_variable_eq"]
        labels[inside] = group
    return labels


def employment_labels(statuses: Sequence) -> np.ndarray:
    """Each person's employment group (children are a group of their own,
    so the groups cover everyone)."""
    statuses = np.asarray(statuses, dtype=object)
    unknown = sorted(set(statuses) - set(EMPLOYMENT_GROUPS))
    if unknown:
        raise ValueError(f"Unknown employment status: {', '.join(unknown)}")
    return np.asarray(
        [EMPLOYMENT_GROUPS[status] for status in statuses], dtype=object
    )


def band_groups() -> dict[str, str]:
    """The age group each age band lies inside.

    Raises:
        DemographicsError: If a band straddles two of policyengine.py's
            ``AGE_GROUPS``, so the levels would not nest.
    """
    parents = {}
    for code, lowest, highest in AGE_BANDS:
        ends = age_group_labels(
            [lowest, highest if highest is not None else 120]
        )
        if ends[0] != ends[1] or ends[0] == UNASSIGNED:
            raise DemographicsError(
                f"{code} straddles policyengine.py's age groups"
            )
        parents[code] = ends[0]
    return parents


def young_people_labels(
    ages: Sequence,
    statuses: Sequence,
    education: Sequence,
    training: Sequence,
) -> np.ndarray:
    """For 18 to 24-year-olds, whether they are in work or education
    (approved training counts); no label for anyone else."""
    ages = np.asarray(ages, dtype=float)
    statuses = np.asarray(statuses, dtype=object)
    education = np.asarray(education, dtype=object)
    training = np.asarray(training, dtype=bool)
    lowest, highest = YOUNG_PEOPLE_AGES
    in_band = (ages >= lowest) & (ages <= highest)
    working = np.isin(statuses, list(WORKING))
    learning = education != NOT_IN_EDUCATION
    neither = in_band & ~working & ~learning & ~training
    labels = np.full(len(ages), UNASSIGNED, dtype=object)
    labels[in_band] = "IN_WORK_OR_EDUCATION"
    labels[neither] = "NOT_IN_WORK_OR_EDUCATION"
    return labels


def group_labels(
    ages: Sequence,
    statuses: Sequence,
    education: Sequence,
    training: Sequence,
) -> dict[str, np.ndarray]:
    """Each person's group at every level."""
    return {
        AGE_BAND: age_band_labels(ages),
        AGE_GROUP: age_group_labels(ages),
        EMPLOYMENT: employment_labels(statuses),
        YOUNG_PEOPLE: young_people_labels(ages, statuses, education, training),
    }


# -- people from the simulations -----------------------------------------------


def person_values(simulation, variable: str, year: int) -> np.ndarray:
    """A variable for one year, one value per person, in engine order."""
    return np.asarray(
        simulation.calculate(
            variable, period=year, map_to="person", unweighted=True
        )
    )


@dataclass(frozen=True)
class PersonRun:
    """One reform's year, per person."""

    baseline: np.ndarray
    reformed: np.ndarray
    poverty_before: np.ndarray
    poverty_after: np.ndarray


class DemographicCollector:
    """People's incomes, weights and groups, run by run, and the survey
    household behind each person."""

    def __init__(self, source_ids: Sequence) -> None:
        self.source_ids = np.asarray(source_ids)
        self.n_records = len(self.source_ids)
        self._runs: dict[tuple[str, int], PersonRun] = {}
        self._weights: dict[int, np.ndarray] = {}
        self._labels: dict[int, dict[str, np.ndarray]] = {}

    @classmethod
    def from_simulation(
        cls, simulation, *, kind: str, microcosm_export: bool = False
    ) -> "DemographicCollector":
        """The survey household behind each person a simulation runs on:
        their household's (``geography.survey_household_ids``), matched
        by position, as policyengine-uk keeps household ids as int32."""
        tables = dataset_tables(simulation)
        household_sources = survey_household_ids(
            tables.household,
            tables.person,
            kind,
            microcosm_export=microcosm_export,
        )
        households = np.asarray(
            simulation.populations["household"].members_entity_id
        )
        return cls(source_ids=household_sources[households])

    def collect(self, reform_id: str, year: int, baseline, reformed) -> None:
        """Read one reform's year from its baseline and reformed runs."""
        weight = person_values(baseline, "person_weight", year).astype(float)
        other = person_values(reformed, "person_weight", year).astype(float)
        if not np.array_equal(weight, other):
            raise ValueError(
                f"person_weight differs between the runs of {reform_id} in "
                f"{year}"
            )
        labels = group_labels(
            person_values(baseline, "age", year),
            person_values(baseline, "employment_status", year),
            person_values(baseline, "current_education", year),
            person_values(baseline, "is_in_approved_training", year),
        )
        self.add(
            reform_id,
            year,
            baseline=person_values(baseline, "household_net_income", year),
            reformed=person_values(reformed, "household_net_income", year),
            weight=weight,
            labels=labels,
            poverty_before=person_values(baseline, "in_poverty_bhc", year),
            poverty_after=person_values(reformed, "in_poverty_bhc", year),
        )

    def add(
        self,
        reform_id: str,
        year: int,
        *,
        baseline: Sequence,
        reformed: Sequence,
        weight: Sequence,
        labels: Mapping[str, Sequence],
        poverty_before: Sequence,
        poverty_after: Sequence,
    ) -> None:
        """Add one reform's year, one value per person."""
        arrays = {
            "baseline": np.asarray(baseline, dtype=float),
            "reformed": np.asarray(reformed, dtype=float),
            "weight": np.asarray(weight, dtype=float),
            "poverty_before": np.asarray(poverty_before, dtype=bool),
            "poverty_after": np.asarray(poverty_after, dtype=bool),
        }
        for name, values in arrays.items():
            if len(values) != self.n_records:
                raise ValueError(
                    f"{name} has {len(values)} people, not {self.n_records}"
                )
        labels = {
            level: np.asarray(labels[level], dtype=object) for level in LEVELS
        }
        year = int(year)
        if year in self._weights:
            if not np.array_equal(self._weights[year], arrays["weight"]):
                raise ValueError(
                    f"person_weight differs between reforms in {year}"
                )
        else:
            self._weights[year] = arrays["weight"]
            self._labels[year] = labels
        self._runs[(reform_id, year)] = PersonRun(
            baseline=arrays["baseline"],
            reformed=arrays["reformed"],
            poverty_before=arrays["poverty_before"],
            poverty_after=arrays["poverty_after"],
        )

    @property
    def reforms(self) -> list[str]:
        return list(dict.fromkeys(reform for reform, _ in self._runs))

    @property
    def years(self) -> list[int]:
        return sorted(self._weights)

    def run(self, reform_id: str, year: int) -> PersonRun:
        return self._runs[(reform_id, int(year))]

    def weight(self, year: int) -> np.ndarray:
        return self._weights[int(year)]

    def labels(self, year: int) -> dict[str, np.ndarray]:
        return self._labels[int(year)]


# -- estimates and the release -----------------------------------------------------


def estimate_all(
    collector: DemographicCollector, settings: DisclosureSettings
) -> dict[tuple[str, str, int], AreaEstimates]:
    """Every level's estimates, the national one included, for every reform
    and year, on the same records and source ids."""
    national = np.full(collector.n_records, NATIONAL_CODE, dtype=object)
    estimates = {}
    for year in collector.years:
        weight = collector.weight(year)
        labels = collector.labels(year)
        areas = {NATIONAL: AreaWeights.from_labels(national, weight)}
        for level in LEVELS:
            areas[level] = AreaWeights.from_labels(labels[level], weight)
        for reform in collector.reforms:
            run = collector.run(reform, year)
            for level, level_areas in areas.items():
                estimates[(level, reform, year)] = estimate_change(
                    level=level,
                    reform=reform,
                    year=year,
                    areas=level_areas,
                    source_ids=collector.source_ids,
                    baseline=run.baseline,
                    reformed=run.reformed,
                    settings=settings,
                )
    return estimates


# A cell: (level, area code, reform, year, family)
Cell = tuple[str, str, str, int, str]
FAMILIES = (FAMILY_CHANGE, "share_gaining", "share_losing")


@dataclass(frozen=True)
class Nesting:
    """A level whose groups tile groups of another (child to parent)."""

    child: str
    parent: str
    parent_of: Mapping[str, str]


class _Resolver:
    """Withholds cells until the release has nothing left to resolve, by
    the rules the results by area follow (``geography.resolve``): the cell
    the layer suggests, else the legal cell with the fewest survey
    households, else the parent; then, once the layer finds nothing, a
    second cell beside any withheld cell one subtraction recovers exactly.
    A finding withholding can't answer is refused: nothing is guessed."""

    def __init__(self, release, estimates, collector, nestings, levels):
        self.release = release
        self.estimates = estimates
        self.collector = collector
        self.nestings = {nesting.child: nesting for nesting in nestings}
        self.levels = frozenset(levels)
        self.withheld: set[Cell] = set()

    def tier(self, cell: Cell) -> str:
        level, area, reform, year, family = cell
        if cell in self.withheld:
            return WITHHELD
        tiers = self.estimates[(level, reform, year)].family_tiers(family)
        return tiers.get(area, WITHHELD)

    def public(self, cell: Cell) -> bool:
        """Shown, or known: the national figure is treated as public."""
        return cell[0] == NATIONAL or self.tier(cell) != WITHHELD

    def can_withhold(self, cell: Cell) -> bool:
        level, area, reform, year, _ = cell
        return (
            level in self.levels
            and area in self.estimates[(level, reform, year)].areas.area_codes
            and self.tier(cell) != WITHHELD
        )

    def sources(self, cell: Cell, *, contributors: bool) -> int:
        """The survey households behind a group's people (only those whose
        household's income changes, for ``contributors``)."""
        level, area, reform, year, _ = cell
        inside = self.collector.labels(year)[level] == area
        if contributors:
            run = self.collector.run(reform, year)
            inside &= np.abs(run.reformed - run.baseline) > 1
        return len(np.unique(self.collector.source_ids[inside]))

    def weakest(self, cells, *, contributors: bool):
        legal = [
            cell
            for cell in cells
            if self.can_withhold(cell)
            and self.sources(cell, contributors=contributors) > 0
        ]
        return min(
            legal,
            key=lambda cell: (
                self.sources(cell, contributors=contributors),
                cell,
            ),
            default=None,
        )

    def children(self, nesting: Nesting, parent: str, reform, year, family):
        areas = self.estimates[(nesting.child, reform, year)].areas.area_codes
        return [
            (nesting.child, area, reform, int(year), family)
            for area in areas
            if nesting.parent_of.get(area) == parent
        ]

    def contained(
        self, inner: str, outer: str, area: str, reform, year, family
    ):
        """The groups of level ``inner`` whose people all lie in group
        ``area`` of level ``outer``, as cells."""
        labels = self.collector.labels(year)
        weight = self.collector.weight(year)
        outer_labels = (
            np.full(self.collector.n_records, NATIONAL_CODE, dtype=object)
            if outer == NATIONAL
            else labels[outer]
        )
        cells = []
        for code in self.estimates[(inner, reform, year)].areas.area_codes:
            people = (labels[inner] == code) & (weight > 0)
            if people.any() and np.all(outer_labels[people] == area):
                cells.append((inner, code, reform, int(year), family))
        return cells

    def fix(self, finding) -> Cell:
        """One blocking finding's cell to withhold. A nesting's children
        come from its parent map; a containment's (levels released
        together without one, as employment and the age levels are) are
        the inner level's groups lying wholly inside the outer group."""
        code = finding.code
        relation = getattr(finding, "relation", None)
        if code not in (RECOVERABLE_REMAINDER, RECOVERABLE_PARENT) or (
            relation not in ("nesting", "containment")
        ):
            raise DemographicsError(f"Withholding can't resolve {code}")
        reform, year, family = (
            finding.reform,
            int(finding.year),
            finding.family,
        )
        if relation == "nesting":
            nesting = self.nestings.get(finding.level)
            if nesting is None:
                raise DemographicsError(f"Withholding can't resolve {code}")
            children = self.children(
                nesting, finding.group, reform, year, family
            )
        else:
            children = self.contained(
                finding.level,
                finding.group_level,
                finding.group,
                reform,
                year,
                family,
            )
        parent = (finding.group_level, finding.group, reform, year, family)
        fix = None
        if code == RECOVERABLE_REMAINDER:
            if finding.suggested:
                suggested = (
                    finding.level,
                    finding.suggested,
                    reform,
                    year,
                    family,
                )
                if self.can_withhold(suggested) and self.sources(
                    suggested, contributors=True
                ):
                    fix = suggested
            if fix is None:
                fix = self.weakest(children, contributors=True)
            if fix is None and self.can_withhold(parent):
                fix = parent
        else:
            fix = self.weakest(children, contributors=False)
        if fix is None:
            raise DemographicsError(f"No cell can resolve {code}")
        return fix

    def exposures(self) -> set[Cell]:
        """A second cell beside each withheld cell that one subtraction
        recovers exactly: the only withheld child of a public parent, or a
        withheld parent of public children."""
        found: set[Cell] = set()
        for nesting in self.nestings.values():
            parents = sorted(set(nesting.parent_of.values()))
            for reform in self.collector.reforms:
                for year in self.collector.years:
                    for family in FAMILIES:
                        for parent in parents:
                            fix = self._exposure_fix(
                                nesting, parent, reform, year, family
                            )
                            if fix is not None:
                                found.add(fix)
        return found

    def _exposure_fix(self, nesting, parent, reform, year, family):
        children = self.children(nesting, parent, reform, year, family)
        if not children:
            return None
        hidden = [child for child in children if not self.public(child)]
        parent_cell = (nesting.parent, parent, reform, int(year), family)
        parent_public = self.public(parent_cell)
        exposed = (len(hidden) == 1 and parent_public) or (
            not hidden and not parent_public
        )
        if not exposed:
            return None
        fix = self.weakest(children, contributors=False)
        if fix is None:
            raise DemographicsError(
                f"No cell can protect {nesting.child} in {parent}"
            )
        return fix

    def run(self, max_rounds: int) -> None:
        for _ in range(max_rounds):
            blocking = [f for f in self.release.check() if f.blocking]
            cells = (
                {self.fix(finding) for finding in blocking}
                if blocking
                else self.exposures()
            )
            if not cells:
                return
            added = cells - self.withheld
            if not added:
                raise DemographicsError("A round of withholding added nothing")
            for level, area, reform, year, family in sorted(added):
                self.release.withhold(
                    level=level,
                    area_code=area,
                    reform=reform,
                    year=year,
                    outcome=FAMILY_OUTCOME[family],
                )
                self.withheld.add((level, area, reform, year, family))
        raise DemographicsError(
            f"Disclosure findings still block after {max_rounds} rounds"
        )


@dataclass(frozen=True)
class DemographicRelease:
    """A checked release with nothing blocking, the levels it publishes,
    and who accepted the employment overlap, if anyone did."""

    release: Release
    levels: tuple[str, ...]
    employment_reviewer: Optional[str] = None


def build_release(
    collector: DemographicCollector,
    *,
    settings: Optional[DisclosureSettings] = None,
    employment_reviewer: Optional[str] = None,
    max_rounds: int = 50,
) -> DemographicRelease:
    """The groups' estimates as one checked release with nothing blocking.

    The national figure is a reference, treated as public (as the results
    by area treat it). Age groups nest in it, age bands in the age groups,
    and the 18 to 24-year-olds' two groups in their band, so a withheld
    group can't be recovered by subtraction. Employment groups (nesting in
    the nation) join only with ``employment_reviewer``, who accepts the
    layer's ``unchecked_overlap`` finding between them and the age levels.

    Raises:
        DemographicsError: If a blocking finding can't be resolved, or the
            reviewer is blank.
    """
    if employment_reviewer is not None and not employment_reviewer.strip():
        raise DemographicsError("Name the reviewer who accepts the overlap")
    levels = AGE_LEVELS + ((EMPLOYMENT,) if employment_reviewer else ())
    settings = (settings or DisclosureSettings()).revalidated()
    release = Release(
        settings,
        prior_public=[national_prior(collector.reforms, collector.years)],
        acknowledge=[UNCHECKED_OVERLAP] if employment_reviewer else [],
    )
    estimates = {
        key: value
        for key, value in estimate_all(collector, settings).items()
        if key[0] == NATIONAL or key[0] in levels
    }
    for key, value in sorted(estimates.items()):
        release.add(value, publish=key[0] != NATIONAL)
    nestings = [
        Nesting(
            AGE_GROUP,
            NATIONAL,
            {group: NATIONAL_CODE for group in GROUP_NAMES[AGE_GROUP]},
        ),
        Nesting(AGE_BAND, AGE_GROUP, band_groups()),
        Nesting(
            YOUNG_PEOPLE,
            AGE_BAND,
            {code: YOUNG_PEOPLE_BAND for code in GROUP_NAMES[YOUNG_PEOPLE]},
        ),
    ]
    if EMPLOYMENT in levels:
        nestings.append(
            Nesting(
                EMPLOYMENT,
                NATIONAL,
                {group: NATIONAL_CODE for group in GROUP_NAMES[EMPLOYMENT]},
            )
        )
    for nesting in nestings:
        release.add_nesting(
            nesting.child,
            nesting.parent,
            parent_of=(
                None if nesting.parent == NATIONAL else nesting.parent_of
            ),
        )
    _Resolver(release, estimates, collector, nestings, levels).run(max_rounds)
    return DemographicRelease(
        release=release,
        levels=levels,
        employment_reviewer=(
            employment_reviewer.strip() if employment_reviewer else None
        ),
    )


def public_table(built: DemographicRelease) -> pd.DataFrame:
    """The published rows: the release's levels' average and relative
    change, with each group's name, sorted."""
    frame = built.release.to_public().to_frame()
    frame = frame[
        frame["outcome"].isin(PUBLISHED_OUTCOMES)
        & frame["level"].isin(built.levels)
    ].copy()
    names = [
        GROUP_NAMES[level][code]
        for level, code in zip(frame["level"], frame["area_code"])
    ]
    frame.insert(frame.columns.get_loc("area_code") + 1, "area_name", names)
    return frame.sort_values(_SORT, kind="mergesort").reset_index(drop=True)


def poverty_by_age(collector: DemographicCollector) -> pd.DataFrame:
    """The share of people in each age group in absolute poverty before
    housing costs, before and after each reform, in per cent."""
    rows = []
    for reform in collector.reforms:
        for year in collector.years:
            run = collector.run(reform, year)
            weight = collector.weight(year)
            groups = collector.labels(year)[AGE_GROUP]
            for group in AGE_GROUPS:
                inside = groups == group
                total = weight[inside].sum()
                if total <= 0:
                    continue
                before = (
                    100 * weight[inside & run.poverty_before].sum() / total
                )
                after = 100 * weight[inside & run.poverty_after].sum() / total
                rows.append(
                    {
                        "reform": reform,
                        "year": year,
                        "age_group": group,
                        "baseline_rate": round(float(before), 2),
                        "reform_rate": round(float(after), 2),
                        "change_pp": round(float(after - before), 2),
                    }
                )
    return pd.DataFrame(rows, columns=POVERTY_COLUMNS)


# -- command line ------------------------------------------------------------

TABLE_FILE = "demographics.csv"
POVERTY_FILE = "poverty_by_age.csv"
console = geography.console


def add_demographics_parser(subparsers) -> None:
    """The ``demographics`` command: results by demographic group."""
    parser = subparsers.add_parser(
        "demographics",
        help="Write disclosure-controlled results by demographic group",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="A local dataset (.h5) or bundle dataset name; "
        "default: the bundle's dataset",
    )
    parser.add_argument(
        "--dataset-kind",
        choices=geography.DATASET_KINDS,
        default=geography.EFRS,
        help="efrs (the national dataset) or microcosm (a Microcosm export)",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=publication_manifest.manifest_path(),
        help="Publication manifest (default: public/data/manifest.json)",
    )
    parser.add_argument(
        "--reforms",
        nargs="+",
        default=None,
        help="Approved reform IDs, a package or its measures, not both "
        "(default: the approved packages, else the approved measures)",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=list(POLICY_YEARS),
        help=(
            "Years (default: the policy years in budget_years.json, "
            f"{POLICY_YEARS[0]} to {POLICY_YEARS[-1]})"
        ),
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("./public/data"),
        help=f"Where {TABLE_FILE} and {POVERTY_FILE} go (default: ./public/data)",
    )
    parser.add_argument(
        "--employment-reviewer",
        default=None,
        help=(
            "Publish employment groups too: the reviewer who accepts the "
            "disclosure layer's unchecked overlap between them and the age "
            "groups (default: employment groups are left out)"
        ),
    )


@dataclass
class _Plan:
    """A demographics run, checked before any simulation."""

    reforms: list
    years: list[int]
    microcosm_export: bool


def _plan(parsed: argparse.Namespace) -> _Plan:
    """Check a demographics run's options, with the checks the results by
    area make (``geography._plan``). Raises ValueError with labels."""
    kind = parsed.dataset_kind
    if kind == geography.MICROCOSM and parsed.dataset is None:
        raise ValueError("--dataset-kind microcosm needs --dataset")
    # Read from the file, never inferred from the kind: the ids check it too.
    local = geography._local_dataset(parsed.dataset)
    microcosm_export = local is not None and geography.is_microcosm_export(
        local
    )
    if kind == geography.MICROCOSM and not microcosm_export:
        raise ValueError(
            "--dataset-kind microcosm needs a Microcosm export; a file "
            "built by policyengine-uk-data goes through --dataset-kind efrs"
        )
    if kind == geography.EFRS and microcosm_export:
        raise ValueError("--dataset-kind efrs refuses a Microcosm export")
    if kind == geography.EFRS and local is None:
        name, repository = (
            geography._bundle_dataset()
            if parsed.dataset is None
            else geography._bundle_dataset(str(parsed.dataset))
        )
        if not name.startswith("enhanced_frs_"):
            raise ValueError(
                f"--dataset-kind efrs needs enhanced FRS, but the installed "
                f"bundle gives {name} from {repository}: pass a Microcosm "
                "export with --dataset-kind microcosm --dataset"
            )
    if not parsed.manifest.is_file():
        raise ValueError(
            f"No publication manifest at {parsed.manifest}: there is "
            "nothing the national page may publish yet."
        )
    manifest = publication_manifest.parse_manifest(
        parsed.manifest.read_bytes(), str(parsed.manifest)
    )
    ids = geography.approved_reforms(manifest, parsed.reforms)
    if parsed.reforms is None:
        ids = [i for i in ids if i in geography.PACKAGES] or ids
    unknown = [i for i in ids if geography.get_reform(i) is None]
    if unknown:
        raise ValueError(f"Unknown reforms: {unknown}")
    reforms = [geography.get_reform(i) for i in dict.fromkeys(ids)]
    chosen = {reform.id for reform in reforms}
    for package, components in geography.PACKAGES.items():
        together = sorted(chosen & set(components))
        if package in chosen and together:
            raise ValueError(
                f"Publish a package or its measures, not both: {package} "
                f"with {', '.join(together)}"
            )
    return _Plan(
        reforms=reforms,
        years=sorted(set(parsed.years)),
        microcosm_export=microcosm_export,
    )


def write_private_audit(
    built: DemographicRelease,
    *,
    subdirectory: str,
    reforms: Sequence[str],
    years: Sequence[int],
    certification_reason: Optional[str] = None,
) -> Path:
    """Write the layer's audit and a summary (labels only) to a private
    directory under ``$UK_BUDGET_DISCLOSURE_AUDIT_DIR``, outside any git
    repository."""
    directory = private_directory(subdirectory=subdirectory)
    built.release.write_audit(directory)
    summary = {
        "levels": list(built.levels),
        "reforms": list(reforms),
        "years": [int(year) for year in years],
        "employment_reviewer": built.employment_reviewer,
        "certified": certification_reason is None,
        "certification_reason": certification_reason,
    }
    path = directory / "summary.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(summary, handle, indent=2, sort_keys=True)
    os.chmod(path, 0o600)
    return directory


def write_public_tables(
    built: DemographicRelease, collector: DemographicCollector, out_dir: Path
) -> list[Path]:
    """Write demographics.csv once the layer validates it, then the
    poverty rates by age group."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    table = geography._write_validated(
        public_table(built), out_dir / TABLE_FILE
    )
    rates = out_dir / POVERTY_FILE
    poverty_by_age(collector).to_csv(rates, index=False, lineterminator="\n")
    os.chmod(rates, 0o644)
    return [table, rates]


def run_demographics(parsed: argparse.Namespace) -> int:
    """Run the ``demographics`` command. Prints labels only."""
    reason = (
        geography.MICROCOSM_UNCERTIFIED
        if geography._uses_microcosm(parsed)
        else None
    )
    if reason:
        console.print(reason)
    try:
        return _run_demographics(parsed, certification_reason=reason)
    finally:
        if reason:
            console.print(reason)


def _run_demographics(
    parsed: argparse.Namespace, *, certification_reason: Optional[str]
) -> int:
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    subdirectory = f"demographics/{run_id}/{parsed.dataset_kind}"
    try:
        private_directory(subdirectory=subdirectory)
    except PrivateOutputError as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    try:
        plan = _plan(parsed)
    except (ValueError, OSError) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    dataset = str(parsed.dataset) if parsed.dataset else None
    ids = [reform.id for reform in plan.reforms]
    console.print(
        f"Demographics: {parsed.dataset_kind}, reforms {' '.join(ids)}, "
        f"years {' '.join(map(str, plan.years))}"
    )
    try:
        collector = None
        limited = {}
        for reform in plan.reforms:
            console.print(f"Simulating {reform.id}")
            baseline, reformed = geography.simulate_reform(
                reform, dataset, plan.years
            )
            if collector is None:
                collector = DemographicCollector.from_simulation(
                    baseline,
                    kind=parsed.dataset_kind,
                    microcosm_export=plan.microcosm_export,
                )
            # As the results by area do: a measure the data can't cost has
            # no figure by group either.
            watch = (
                data_limits.observing(baseline, reformed)
                if data_limits.DATA_LIMITS
                else contextlib.nullcontext()
            )
            with watch as observed:
                for year in plan.years:
                    collector.collect(reform.id, year, baseline, reformed)
            if data_limits.DATA_LIMITS:
                touched = geography.reform_data_limits(
                    reform, baseline, reformed, observed, plan.years
                )
                if touched:
                    limited[reform.id] = touched
            del baseline, reformed, observed
        if limited:
            for reform_id, touched in limited.items():
                reasons = " ".join(item["reason"] for item in touched)
                console.print(
                    f"[red]Not computable on current data: {reform_id}: "
                    f"{reasons}[/red]"
                )
            console.print(
                f"[red]Error: {len(limited)} reform(s) touch a data limit, "
                "so no tables were written.[/red]"
            )
            return 1
        console.print("Estimating and checking")
        built = build_release(
            collector, employment_reviewer=parsed.employment_reviewer
        )
        audit = write_private_audit(
            built,
            subdirectory=subdirectory,
            reforms=ids,
            years=plan.years,
            certification_reason=certification_reason,
        )
        written = write_public_tables(built, collector, parsed.out_dir)
    except (
        DemographicsError,
        geography.GeographyError,
        KeyError,
        PrivateOutputError,
        TypeError,
        ValueError,
    ) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    for path in written:
        console.print(f"[green]Wrote {path}[/green]")
    console.print(f"Private audit: {audit} (${AUDIT_DIR_ENV})")
    return 0
