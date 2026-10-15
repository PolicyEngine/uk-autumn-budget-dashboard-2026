"""Results by region and constituency, through the disclosure layer (#24).

The dashboard publishes the change in household net income by region and by
Westminster constituency. Those figures rest on UKDS-licensed survey
microdata, so every published cell goes through ``policyengine.disclosure``:
a floor on the survey households behind it, a dominance rule, bootstrap
intervals, rounding, and a check on what a reader recovers by subtraction
across levels and across a package and its measures. Only the release's
public rows reach public/data. Its exact values and counts go to a private
directory outside any git repository.

Three levels go into one release. National is a reference: the national
tables publish it already, so its change cells are known. On the national
dataset (the enhanced FRS) the region level is published and seats come from
the eFRS seat weight matrix. On a local dataset (Microcosm) each household
carries its seat, and the region level is a reference, since the regional
table comes from the national dataset. Seats are published for the chosen
reforms only; every other reform is a reference there with every cell
withheld, so a package's measures are checked without being shown.

Nothing here prints a value, a count or a support figure: only labels.
"""

import argparse
import json
import math
import os
import re
import tempfile
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional, Union

import h5py
import numpy as np
import pandas as pd
from policyengine.disclosure import (
    AreaEstimates,
    AreaWeights,
    DisclosureSettings,
    Finding,
    PriorPublic,
    Release,
    estimate_change,
    validate_public,
)
from policyengine.disclosure.schema import (
    FAMILY_CHANGE,
    NOISE_REFERENCE_PUBLIC,
    OUTCOME_FAMILY,
    OUTCOMES,
    RECOVERABLE_PARENT,
    RECOVERABLE_REMAINDER,
    UNCHECKED_OVERLAP,
    WITHHELD,
)
from rich.console import Console

from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import build_microsimulation
from uk_budget_data.private_outputs import (
    AUDIT_DIR_ENV,
    PrivateOutputError,
    private_directory,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    DEFAULT_YEARS,
    get_autumn_budget_2026_reforms,
    get_reform,
)

console = Console()

NATIONAL = "national"
REGION = "region"
CONSTITUENCY = "constituency"
NATIONAL_CODE = "UK"
_LEVELS = (NATIONAL, REGION, CONSTITUENCY)
TABLE_FILES = {REGION: "regional.csv", CONSTITUENCY: "constituency.csv"}
PUBLISHED_OUTCOMES = ("average_change", "relative_change")
SHARE_FAMILIES = ("share_gaining", "share_losing")
# The outcome Release.withhold takes for each family; withholding one
# outcome withholds its whole family.
FAMILY_OUTCOME = {
    FAMILY_CHANGE: "average_change",
    "share_gaining": "share_gaining",
    "share_losing": "share_losing",
}
INTERACTION_SUFFIX = "__interaction"
# Packages published by area: the combined reform and the measures in it.
PACKAGES = {
    AUTUMN_BUDGET_2026_COMBINED_ID: AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
}

EFRS = "efrs"
MICROCOSM = "microcosm"
DATASET_KINDS = (EFRS, MICROCOSM)
# Flags on the copies a dataset adds to its survey households.
COPY_FLAGS = (
    "household_is_spi_synthetic",
    "household_is_capital_gains_clone",
    "household_is_cgt_band_donor",
)
_COPY_FLAG_PATTERN = re.compile(r"^household_is_.*(clone|copy)")
# What a copy shares with the household it was copied from.
EFRS_KEY_COLUMNS = ("region", "tenure_type", "accommodation_type")

REGION_CODES = (
    "E12000001",
    "E12000002",
    "E12000003",
    "E12000004",
    "E12000005",
    "E12000006",
    "E12000007",
    "E12000008",
    "E12000009",
    "W92000004",
    "S92000003",
    "N92000002",
)
REGION_COLUMNS = (
    "code",
    "name",
    "frs_region",
    "microcosm_region_code",
    "constituencies_region",
)
REGIONS_FILE = "regions.csv"
SEATS_FILE = "constituencies_2024.csv"
SEAT_WEIGHTS_FILE = "parliamentary_constituency_weights.h5"
# Seat weights are read in double precision: single precision saves memory
# but not time, since the layer's per-seat support checks dominate.
SEAT_MATRIX_DTYPE = np.float64
MAX_ROUNDS = 50

# (level, area_code, reform, year, family) and (reform, year).
Cell = tuple[str, str, str, int, str]
Run = tuple[str, int]


class GeographyError(RuntimeError):
    """The geography release cannot be built, resolved or written.

    Messages carry labels only: levels, area codes, reforms, years and
    finding codes, never values or counts.
    """


# -- regions and seats -------------------------------------------------------


def load_regions(path: Union[str, Path]) -> pd.DataFrame:
    """The canonical region table, checked complete.

    Raises:
        ValueError: If a column is missing, the codes are not the twelve ONS
            region and nation codes, a source's labels repeat, or the FRS
            labels are not policyengine-uk's region enum without UNKNOWN.
    """
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in REGION_COLUMNS if c not in frame.columns]
    if missing:
        raise ValueError(f"{path}: missing columns {missing}")
    if sorted(frame["code"]) != sorted(REGION_CODES):
        raise ValueError(f"{path}: the codes are not the twelve UK regions")
    for column in REGION_COLUMNS:
        if (frame[column] == "").any() or frame[column].duplicated().any():
            raise ValueError(f"{path}: {column} has blank or repeated labels")
    from policyengine_uk.system import system

    enum = system.variables["region"].possible_values
    expected = {member.name for member in enum} - {"UNKNOWN"}
    if set(frame["frs_region"]) != expected:
        raise ValueError(
            f"{path}: frs_region does not match policyengine-uk's regions"
        )
    return frame.reset_index(drop=True)


def _label(value: object) -> str:
    """A label as a stripped string: from text, bytes or an enum member."""
    if isinstance(value, Enum):
        return value.name
    if isinstance(value, bytes):
        return value.decode("utf-8").strip()
    if isinstance(value, str):
        return value.strip()
    if value is None or value is pd.NA:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    raise TypeError(f"A label of type {type(value).__name__} is not text")


def _translate(
    values: object,
    mapping: Mapping[str, str],
    *,
    source: str,
    unassigned: Iterable[str] = ("",),
) -> np.ndarray:
    """Each value's label translated through ``mapping``.

    Labels in ``unassigned`` become ``""``; any other unknown label raises.
    """
    codes, uniques = pd.factorize(
        pd.Series(np.asarray(values, dtype=object)), use_na_sentinel=True
    )
    labels = [_label(value) for value in uniques]
    blank = set(unassigned)
    unknown = sorted(
        {x for x in labels if x not in mapping and x not in blank}
    )
    if unknown:
        raise ValueError(f"Unknown {source} labels: {unknown[:5]}")
    translated = np.array(
        [mapping.get(x, "") for x in labels] + [""], dtype=object
    )
    return np.asarray(translated[codes])


def frs_region_codes(values: object, regions: pd.DataFrame) -> np.ndarray:
    """ONS codes from policyengine-uk region labels; UNKNOWN is unassigned.

    Values may be enum names as text or bytes, or enum members.
    """
    mapping = dict(zip(regions["frs_region"], regions["code"]))
    return _translate(
        values, mapping, source="FRS region", unassigned=("", "UNKNOWN")
    )


def microcosm_region_codes(
    values: object, regions: pd.DataFrame
) -> np.ndarray:
    """ONS codes from Microcosm's ``region_code_oa``.

    Microcosm codes Wales, Scotland and Northern Ireland as W99999999,
    S99999999 and N99999999.
    """
    mapping = dict(zip(regions["microcosm_region_code"], regions["code"]))
    return _translate(values, mapping, source="Microcosm region")


def lookup_region_codes(labels: object, regions: pd.DataFrame) -> np.ndarray:
    """ONS codes from the constituency lookup's region labels."""
    mapping = dict(zip(regions["constituencies_region"], regions["code"]))
    return _translate(
        labels, mapping, source="constituency lookup region", unassigned=()
    )


def load_seats(path: Union[str, Path]) -> pd.DataFrame:
    """The constituency lookup: one row per seat, sorted by code."""
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in ("code", "name", "region") if c not in frame]
    if missing:
        raise ValueError(f"{path}: missing columns {missing}")
    codes = frame["code"]
    if (codes == "").any() or codes.duplicated().any():
        raise ValueError(f"{path}: seat codes are blank or repeated")
    if list(codes) != sorted(codes):
        raise ValueError(f"{path}: seats are not sorted by code")
    return frame.reset_index(drop=True)


def seat_region_map(
    constituencies_csv: Union[str, Path], regions: pd.DataFrame
) -> dict[str, str]:
    """Seat code to ONS region code, in the lookup's (and matrix's) order.

    Raises:
        ValueError: If a seat's region is unknown or a region has no seat.
    """
    seats = load_seats(constituencies_csv)
    codes = lookup_region_codes(seats["region"], regions)
    if set(codes) != set(regions["code"]):
        raise ValueError(f"{constituencies_csv}: a region has no seat")
    return dict(zip(seats["code"], codes))


def area_names(
    regions: pd.DataFrame, seats: pd.DataFrame
) -> dict[str, dict[str, str]]:
    """Area names by level, for the published tables."""
    return {
        REGION: dict(zip(regions["code"], regions["name"])),
        CONSTITUENCY: dict(zip(seats["code"], seats["name"])),
    }


def normalise_seat_labels(
    values: object, seat_regions: Mapping[str, str]
) -> np.ndarray:
    """Seat codes per household; blank is unassigned, unknown raises."""
    mapping = {code: code for code in seat_regions}
    return _translate(values, mapping, source="seat")


# -- survey households -------------------------------------------------------


def copy_flag_columns(household: pd.DataFrame) -> list[str]:
    """The copy flags a household table carries: the named ones, and any
    other ``household_is_*clone*`` or ``household_is_*copy*`` column."""
    return [
        column
        for column in household.columns
        if column in COPY_FLAGS or _COPY_FLAG_PATTERN.match(column)
    ]


def _flagged(household: pd.DataFrame, columns: Sequence[str]) -> np.ndarray:
    """Whether each row has any of the flags set."""
    flagged = np.zeros(len(household), dtype=bool)
    for column in columns:
        values = household[column]
        if pd.api.types.is_bool_dtype(values):
            flagged |= values.to_numpy(dtype=bool)
        elif pd.api.types.is_numeric_dtype(values):
            flagged |= values.fillna(0).to_numpy() != 0
        else:
            raise TypeError(f"The copy flag {column} is not boolean")
    return flagged


def _microcosm_source_ids(household: pd.DataFrame) -> np.ndarray:
    if "source_household_id" not in household.columns:
        raise ValueError(
            "A Microcosm household table needs source_household_id"
        )
    ids = household["source_household_id"]
    if ids.isna().any():
        raise ValueError("source_household_id is missing on some rows")
    flags = copy_flag_columns(household)
    if ids.is_unique and _flagged(household, flags).any():
        raise ValueError(
            "source_household_id is unique per row while copy flags "
            f"({', '.join(flags)}) are set, so it does not link copies to "
            "the survey households they were made from."
        )
    return ids.to_numpy()


def _members(person: pd.DataFrame) -> pd.Series:
    """Each household's members as a sorted, joined multiset of age:gender."""
    gender_codes, genders = pd.factorize(
        pd.Series(np.asarray(person["gender"], dtype=object))
    )
    gender = np.array([_label(g) for g in genders] + [""], dtype=object)
    member = person["age"].astype(str).to_numpy(dtype=object) + ":"
    member = member + gender[gender_codes]
    frame = pd.DataFrame(
        {
            "household": person["person_household_id"].to_numpy(),
            "member": member,
        }
    )
    frame = frame.sort_values(["household", "member"], kind="mergesort")
    return frame.groupby("household", sort=False)["member"].agg("|".join)


def _efrs_source_ids(
    household: pd.DataFrame, person: pd.DataFrame
) -> np.ndarray:
    needed = ("household_id", *EFRS_KEY_COLUMNS)
    missing = [c for c in needed if c not in household.columns]
    missing += [
        c
        for c in ("person_household_id", "age", "gender")
        if c not in person.columns
    ]
    if missing:
        raise ValueError(f"The eFRS tables lack columns {missing}")
    household_ids = household["household_id"].to_numpy()
    if not pd.Index(person["person_household_id"]).isin(household_ids).all():
        raise ValueError("Some people belong to no household of the table")
    members = (
        pd.Series(household_ids)
        .map(_members(person))
        .fillna("")
        .to_numpy(dtype=object)
    )
    key = members
    for column in EFRS_KEY_COLUMNS:
        codes, uniques = pd.factorize(
            pd.Series(np.asarray(household[column], dtype=object))
        )
        labels = np.array([_label(u) for u in uniques] + [""], dtype=object)
        key = labels[codes] + "\x1f" + key
    flags = [c for c in COPY_FLAGS if c in household.columns]
    flagged = _flagged(household, flags)
    if (~pd.Index(key[flagged]).isin(key[~flagged])).any():
        raise ValueError(
            f"Some rows flagged as copies ({', '.join(flags)}) share their "
            "key with no unflagged row, so the key cannot link them to the "
            "households they were copied from."
        )
    codes, _ = pd.factorize(pd.Series(key))
    return codes.astype(np.int64)


def survey_household_ids(
    household: pd.DataFrame, person: pd.DataFrame, kind: str
) -> np.ndarray:
    """The survey household behind each row of the household table.

    The layer counts the households behind a number by these ids, so a copy
    or clone must share its original's id.

    - ``microcosm``: ``source_household_id``, refused when it is unique per
      row while some row is flagged as a copy.
    - ``efrs``: the enhanced FRS's ``source_household_id`` equals
      ``household_id`` and links no copies, so it is not used. The id is a
      key built from what a copy shares with its original: region, tenure,
      accommodation and the sorted ages and genders of the members. Every
      row flagged as a copy must share its key with an unflagged row.
      Merging distinct households only undercounts support. Returns integer
      codes.

    Raises:
        ValueError: For another kind, or when the ids cannot link copies.
    """
    if kind == MICROCOSM:
        return _microcosm_source_ids(household)
    if kind == EFRS:
        return _efrs_source_ids(household, person)
    raise ValueError(f"Unknown dataset kind {kind!r}")


# -- simulations -------------------------------------------------------------


@dataclass(frozen=True)
class DatasetTables:
    """The dataset year's household and person tables, in engine order."""

    year: int
    household: pd.DataFrame
    person: pd.DataFrame


def household_values(simulation, variable: str, year: int) -> np.ndarray:
    """A household variable for one year, in the engine's household order."""
    result = simulation.calculate(
        variable, period=year, map_to="household", unweighted=True
    )
    return np.asarray(result, dtype=float)


def check_household_alignment(
    household: pd.DataFrame,
    *,
    engine_ids: object,
    engine_weight: object,
) -> None:
    """Check that the table's rows are the engine's households, by position.

    policyengine-uk keeps ``household_id`` as int32, so ids past its range
    (Microcosm's clones) wrap and cannot be matched by value. The engine
    orders households by the dataset's ids and sets every input by
    position, so the rows match by position when the table is sorted by id
    and the weights agree.

    Raises:
        ValueError: If the counts, the order or the weights differ.
    """
    engine_ids = np.asarray(engine_ids)
    engine_weight = np.asarray(engine_weight)
    if len(engine_ids) != len(household) or len(engine_weight) != len(
        household
    ):
        raise ValueError(
            "The simulation and its dataset's household table hold "
            "different numbers of households."
        )
    if not np.array_equal(engine_ids, household["household_id"].to_numpy()):
        raise ValueError(
            "The household table is not in the engine's order (by id), so "
            "its rows cannot be matched to households by position."
        )
    table_weight = household["household_weight"].to_numpy(dtype=np.float32)
    if not np.array_equal(engine_weight.astype(np.float32), table_weight):
        raise ValueError(
            "household_weight differs, by position, between the simulation "
            "and its dataset's household table."
        )


def dataset_tables(simulation) -> DatasetTables:
    """The household and person tables a simulation was built from.

    ``Microsimulation.dataset`` keeps the dataset the engine loaded (a local
    single-year file is extended to later years); its first year holds the
    survey inputs and sets the engine's households.
    """
    dataset = simulation.dataset
    year = int(dataset.years[0])
    tables = dataset[year]
    household = tables.household.reset_index(drop=True)
    person = tables.person.reset_index(drop=True)
    check_household_alignment(
        household,
        engine_ids=simulation.populations["household"].ids,
        engine_weight=household_values(simulation, "household_weight", year),
    )
    return DatasetTables(year=year, household=household, person=person)


# -- per-record arrays -------------------------------------------------------


@dataclass(frozen=True)
class SeatMatrix:
    """Seat x household weights by year: the national dataset's seats.

    ``codes`` are in the matrix's row order; ``load`` reads one year.
    """

    codes: tuple[str, ...]
    parent_of: Mapping[str, str]
    load: Callable[[int], np.ndarray]

    @classmethod
    def from_h5(
        cls, path: Union[str, Path], seat_regions: Mapping[str, str]
    ) -> "SeatMatrix":
        """Weights keyed by year, rows in the constituency lookup's order."""
        path = Path(path)

        def load(year: int) -> np.ndarray:
            with h5py.File(path, "r") as handle:
                key = str(year)
                if key not in handle:
                    raise KeyError(
                        f"{path} has no seat weights for {year}; it has "
                        f"{sorted(handle.keys())}"
                    )
                return np.asarray(handle[key][...], dtype=SEAT_MATRIX_DTYPE)

        return cls(
            codes=tuple(seat_regions),
            parent_of=dict(seat_regions),
            load=load,
        )


class GeographyCollector:
    """One dataset's per-household arrays, gathered for the release.

    It holds what does not change with the reform (source ids, region codes,
    the seat route) and, per reform and year, household net income in the
    baseline and reformed runs, with that year's household weights.
    ``ReformProcessor`` feeds it through ``collect`` when given one.

    Args:
        source_ids: The survey household behind each record.
        region_codes: ONS region code per record (``""`` unassigned).
        national: Whether this is the national dataset, whose region level
            is published. A local dataset's regions are references.
        seat_labels: Seat code per record (a local dataset).
        seat_matrix: Seat weights by year (the national dataset).
        seat_regions: Seat code to region code, needed with either seat
            route.
    """

    def __init__(
        self,
        *,
        source_ids: object,
        region_codes: object,
        national: bool,
        seat_labels: object = None,
        seat_matrix: Optional[SeatMatrix] = None,
        seat_regions: Optional[Mapping[str, str]] = None,
    ) -> None:
        self.source_ids = np.asarray(source_ids)
        self.n_records = len(self.source_ids)
        self.region_codes = np.asarray(region_codes, dtype=object)
        if self.region_codes.shape != (self.n_records,):
            raise ValueError("region_codes must have one entry per record")
        self.national = bool(national)
        if seat_labels is not None and seat_matrix is not None:
            raise ValueError("Give seat labels or a seat matrix, not both")
        if seat_matrix is not None:
            seat_regions = seat_matrix.parent_of
        if (seat_labels is not None or seat_matrix is not None) and (
            seat_regions is None
        ):
            raise ValueError("Seats need seat_regions")
        self.seat_matrix = seat_matrix
        self.seat_regions = dict(seat_regions) if seat_regions else {}
        self.seat_labels = None
        if seat_labels is not None:
            labels = np.asarray(seat_labels, dtype=object)
            if labels.shape != (self.n_records,):
                raise ValueError("seat_labels must have one entry per record")
            self._check_seats_in_regions(labels)
            self.seat_labels = labels
        self._changes: dict[Run, tuple[np.ndarray, np.ndarray]] = {}
        self._weights: dict[int, np.ndarray] = {}

    def _check_seats_in_regions(self, labels: np.ndarray) -> None:
        unknown = sorted(set(labels) - set(self.seat_regions) - {""})
        if unknown:
            raise ValueError(f"Unknown seats: {unknown[:5]}")
        expected = np.array(
            [self.seat_regions.get(label, "") for label in labels],
            dtype=object,
        )
        assigned = labels != ""
        if (expected[assigned] != self.region_codes[assigned]).any():
            raise ValueError(
                "Some households sit in a seat outside their region"
            )

    @property
    def has_seats(self) -> bool:
        return self.seat_labels is not None or self.seat_matrix is not None

    @classmethod
    def from_simulation(
        cls,
        simulation,
        *,
        kind: str,
        regions: pd.DataFrame,
        seat_regions: Mapping[str, str],
        seat_weights: Optional[Union[str, Path]] = None,
    ) -> "GeographyCollector":
        """The dataset-level arrays of the dataset a simulation runs on.

        ``kind`` is ``efrs`` (the national dataset; seats from the weight
        matrix at ``seat_weights``, if given) or ``microcosm`` (a local
        dataset; seats from ``constituency_code_oa``).
        """
        tables = dataset_tables(simulation)
        household = tables.household
        source_ids = survey_household_ids(household, tables.person, kind)
        if kind == EFRS:
            return cls(
                source_ids=source_ids,
                region_codes=frs_region_codes(household["region"], regions),
                national=True,
                seat_matrix=(
                    SeatMatrix.from_h5(seat_weights, seat_regions)
                    if seat_weights is not None
                    else None
                ),
            )
        return cls(
            source_ids=source_ids,
            region_codes=microcosm_region_codes(
                household["region_code_oa"], regions
            ),
            national=False,
            seat_labels=normalise_seat_labels(
                household["constituency_code_oa"], seat_regions
            ),
            seat_regions=seat_regions,
        )

    def collect(self, reform_id: str, year: int, baseline, reformed) -> None:
        """Read one reform's year from its baseline and reformed runs."""
        weight = household_values(baseline, "household_weight", year)
        other = household_values(reformed, "household_weight", year)
        if not np.array_equal(weight, other):
            raise ValueError(
                f"household_weight differs between the runs of {reform_id} "
                f"in {year}"
            )
        self.add(
            reform_id,
            year,
            baseline=household_values(baseline, "household_net_income", year),
            reformed=household_values(reformed, "household_net_income", year),
            weight=weight,
        )

    def add(
        self,
        reform_id: str,
        year: int,
        *,
        baseline: object,
        reformed: object,
        weight: object,
    ) -> None:
        """Add one reform's year from per-record arrays."""
        year = int(year)
        arrays = [
            np.asarray(values, dtype=float)
            for values in (baseline, reformed, weight)
        ]
        for array in arrays:
            if array.shape != (self.n_records,):
                raise ValueError("Each array needs one entry per record")
            if not np.isfinite(array).all():
                raise ValueError("Each array must be finite")
        if (reform_id, year) in self._changes:
            raise ValueError(f"{reform_id} {year} is already collected")
        known = self._weights.get(year)
        if known is not None and not np.array_equal(known, arrays[2]):
            raise ValueError(
                f"household_weight for {year} differs between reforms"
            )
        self._weights.setdefault(year, arrays[2])
        self._changes[(reform_id, year)] = (arrays[0], arrays[1])

    @property
    def reforms(self) -> list[str]:
        """The reforms collected, in the order they came."""
        return list(dict.fromkeys(reform for reform, _ in self._changes))

    @property
    def years(self) -> list[int]:
        return sorted(self._weights)

    def has(self, reform: str, year: int) -> bool:
        return (reform, int(year)) in self._changes

    def weight(self, year: int) -> np.ndarray:
        return self._weights[year]

    def runs(self, reform: str, year: int) -> tuple[np.ndarray, np.ndarray]:
        """Baseline and reformed household net income."""
        return self._changes[(reform, year)]

    def change(self, reform: str, year: int) -> np.ndarray:
        baseline, reformed = self.runs(reform, year)
        return reformed - baseline

    def seat_areas(self, year: int) -> AreaWeights:
        """The constituency level's weights for one year."""
        if self.seat_labels is not None:
            return AreaWeights.from_labels(self.seat_labels, self.weight(year))
        if self.seat_matrix is None:
            raise ValueError("This dataset has no constituency geography")
        matrix = self.seat_matrix.load(year)
        if matrix.shape != (len(self.seat_matrix.codes), self.n_records):
            raise ValueError(
                f"The seat weights for {year} do not match the seats and "
                "the dataset's households"
            )
        return AreaWeights.from_matrix(matrix, self.seat_matrix.codes)


# -- the release -------------------------------------------------------------


def interaction_id(package: str) -> str:
    """The reference that carries what a package adds beyond its measures."""
    return f"{package}{INTERACTION_SUFFIX}"


def national_prior(
    reforms: Iterable[str], years: Iterable[int]
) -> PriorPublic:
    """The national change cells, which the national tables publish."""
    cells = [
        (NATIONAL, NATIONAL_CODE, reform, int(year), outcome)
        for reform in reforms
        for year in years
        for outcome in PUBLISHED_OUTCOMES
    ]
    return PriorPublic(name="national tables", cells=cells)


def regional_prior(
    frame: pd.DataFrame, name: str = "regional table"
) -> PriorPublic:
    """The cells an already published regional table shows.

    Withheld rows are dropped first: ``PriorPublic.from_frame`` keeps them.
    """
    shown = frame[frame["tier"].astype(str) != WITHHELD]
    noise = set(shown["noise"].astype(str)) if "noise" in shown else set()
    if len(noise) > 1:
        raise ValueError(f"{name} mixes noised and plain rows")
    return PriorPublic.from_frame(name, shown, noise=noise == {"True"})


def _check_prior_matches(
    prior: PriorPublic,
    estimates: Mapping[tuple[str, str, int], Optional[AreaEstimates]],
    *,
    areas: bool = True,
) -> None:
    """Every prior cell must name an estimate's cell: the layer drops the
    others silently. With ``areas=False`` only the runs are checked."""
    unmatched = []
    for level, area, reform, year, outcome in prior.cells:
        key = (level, reform, int(year))
        if (
            key not in estimates
            or outcome not in OUTCOMES
            or (areas and area not in estimates[key].areas.area_codes)
        ):
            unmatched.append(f"{level} {area} {reform} {year} {outcome}")
    if unmatched:
        raise ValueError(
            f"{prior.name!r} has cells that match no estimate: "
            f"{sorted(unmatched)[:5]}"
        )


class GeographyRelease:
    """The estimates of one dataset, and the layer's release built on them.

    Estimates are made once; the release is rebuilt from them when a
    constituency run is demoted, since a release cannot unpublish. Cells
    are ``(level, area_code, reform, year, family)``.
    """

    def __init__(
        self,
        *,
        estimates: dict[tuple[str, str, int], AreaEstimates],
        settings: DisclosureSettings,
        published_levels: Sequence[str],
        seat_reforms: Sequence[str],
        packages: Mapping[str, Sequence[str]],
        seat_regions: Mapping[str, str],
        seat_parent_of: Optional[Mapping[str, str]],
        priors: Sequence[PriorPublic],
        timings: Optional[dict[str, float]] = None,
    ) -> None:
        self.estimates = estimates
        self.settings = settings
        self.published_levels = tuple(published_levels)
        self.seat_reforms = frozenset(seat_reforms)
        self.packages = {p: tuple(c) for p, c in packages.items()}
        self.interactions = frozenset(interaction_id(p) for p in packages)
        self.seat_regions = dict(seat_regions)
        self.seat_parent_of = (
            dict(seat_parent_of) if seat_parent_of is not None else None
        )
        self.priors = tuple(priors)
        self.known: frozenset[tuple[str, str, str, int, str]] = frozenset(
            (level, area, reform, int(year), OUTCOME_FAMILY[outcome])
            for prior in self.priors
            for level, area, reform, year, outcome in prior.cells
            if outcome in OUTCOME_FAMILY
        )
        self.levels = tuple(sorted({key[0] for key in estimates}))
        self.reforms = tuple(
            dict.fromkeys(
                key[1] for key in estimates if key[1] not in self.interactions
            )
        )
        self.years = tuple(sorted({key[2] for key in estimates}))
        self.timings = dict(timings or {})
        self.demoted: frozenset[Run] = frozenset()
        self.secondary: set[Cell] = set()
        self._tiers: dict[tuple, dict[str, str]] = {}
        self._sources: dict[tuple, dict[str, int]] = {}
        self._assemble()

    # -- what is published, known and withheld

    def is_published(self, key: tuple[str, str, int]) -> bool:
        level, reform, year = key
        if reform in self.interactions or level not in self.published_levels:
            return False
        if level == CONSTITUENCY:
            return (
                reform in self.seat_reforms
                and (reform, year) not in self.demoted
            )
        return level == REGION

    def _all_withheld(self, key: tuple[str, str, int]) -> bool:
        """References that no table publishes: every cell is secret."""
        level, reform, _ = key
        if reform in self.interactions:
            return True
        return level == CONSTITUENCY and not self.is_published(key)

    def prewithheld(self) -> set[Cell]:
        """Shares everywhere (only change outcomes are published), and every
        change cell of a reference no table publishes."""
        cells: set[Cell] = set()
        for key, estimate in self.estimates.items():
            level, reform, year = key
            families = SHARE_FAMILIES
            if self._all_withheld(key):
                families = (FAMILY_CHANGE, *SHARE_FAMILIES)
            for area in estimate.areas.area_codes:
                for family in families:
                    cells.add((level, area, reform, year, family))
        return cells

    def tier(self, cell: Cell) -> str:
        """A cell's tier as the release stands."""
        level, area, reform, year, family = cell
        if cell in self._manual:
            return WITHHELD
        key = (level, reform, year, family)
        if key not in self._tiers:
            estimate = self.estimates[(level, reform, year)]
            self._tiers[key] = estimate.family_tiers(family)
        return self._tiers[key][area]

    def sources(self, cell: Cell) -> int:
        level, area, reform, year, family = cell
        key = (level, reform, year, family)
        if key not in self._sources:
            estimate = self.estimates[(level, reform, year)]
            self._sources[key] = estimate.family_sources(family)
        return int(self._sources[key][area])

    def has_records(self, cell: Cell) -> bool:
        level, area, reform, year, _ = cell
        records, _ = self.estimates[(level, reform, year)].areas.area_records(
            area
        )
        return len(records) > 0

    def can_withhold(self, cell: Cell) -> bool:
        """Whether resolving may withhold a cell: published here, in an
        estimate's areas, not known from a prior and not withheld yet."""
        level, area, reform, year, _ = cell
        key = (level, reform, year)
        return (
            key in self.estimates
            and self.is_published(key)
            and area in self.estimates[key].areas.area_codes
            and cell not in self.known
            and self.tier(cell) != WITHHELD
        )

    def children(
        self, child_level: str, parent_area: str, reform: str, year: int
    ) -> list[str]:
        """The child areas the layer groups under one parent area."""
        codes = self.estimates[(child_level, reform, year)].areas.area_codes
        if child_level == REGION:
            return list(codes)
        return [c for c in codes if self.seat_regions.get(c) == parent_area]

    # -- changing the release

    def _assemble(self) -> None:
        release = Release(self.settings, prior_public=self.priors)
        for key in sorted(self.estimates):
            release.add(self.estimates[key], publish=self.is_published(key))
        release.add_nesting(REGION, NATIONAL)
        if CONSTITUENCY in self.levels:
            release.add_nesting(
                CONSTITUENCY, REGION, parent_of=self.seat_parent_of
            )
        for package, components in self.packages.items():
            release.add_package(package, components)
            release.add_package(
                package, (*components, interaction_id(package))
            )
        self._manual = self.prewithheld() | self.secondary
        for cell in sorted(self._manual):
            self._withhold(release, cell)
        self.release = release

    @staticmethod
    def _withhold(release: Release, cell: Cell) -> None:
        level, area, reform, year, family = cell
        release.withhold(
            level=level,
            area_code=area,
            reform=reform,
            year=year,
            outcome=FAMILY_OUTCOME[family],
        )

    def withhold(self, cells: Iterable[Cell]) -> None:
        """Withhold cells to resolve findings (secondary withholding)."""
        for cell in sorted(set(cells)):
            if not self.can_withhold(cell):
                raise GeographyError(f"Cannot withhold {cell}")
            self._withhold(self.release, cell)
            self.secondary.add(cell)
            self._manual.add(cell)

    def demote(self, runs: Iterable[Run]) -> None:
        """Make constituency runs references with every cell withheld, and
        rebuild the release from scratch: earlier secondary withholdings
        are dropped, since they answered findings that may be gone."""
        self.demoted = self.demoted | frozenset(runs)
        self.secondary = set()
        self._assemble()


def _estimate_all(
    collector: GeographyCollector,
    *,
    levels: Sequence[str],
    packages: Mapping[str, Sequence[str]],
    settings: DisclosureSettings,
) -> dict[tuple[str, str, int], AreaEstimates]:
    """Every level's estimates for every reform, year and interaction.

    One set of area weights per level and year, and one source id array,
    serve every reform: the layer relates estimates only on the same
    records, sources and areas.
    """
    n = collector.n_records
    national_codes = np.full(n, NATIONAL_CODE, dtype=object)
    estimates = {}
    for year in collector.years:
        weight = collector.weight(year)
        areas = {
            NATIONAL: AreaWeights.from_labels(national_codes, weight),
            REGION: AreaWeights.from_labels(collector.region_codes, weight),
        }
        if CONSTITUENCY in levels:
            areas[CONSTITUENCY] = collector.seat_areas(year)
        runs = [(r, *collector.runs(r, year)) for r in collector.reforms]
        for package, components in packages.items():
            residual = collector.change(package, year) - sum(
                collector.change(component, year) for component in components
            )
            runs.append((interaction_id(package), np.zeros(n), residual))
        for reform, baseline, reformed in runs:
            for level, level_areas in areas.items():
                estimates[(level, reform, year)] = estimate_change(
                    level=level,
                    reform=reform,
                    year=year,
                    areas=level_areas,
                    source_ids=collector.source_ids,
                    baseline=baseline,
                    reformed=reformed,
                    settings=settings,
                )
    return estimates


def build_release(
    collector: GeographyCollector,
    *,
    levels: Sequence[str] = (REGION, CONSTITUENCY),
    seat_reforms: Sequence[str] = (),
    packages: Optional[Mapping[str, Sequence[str]]] = None,
    prior_regional: Optional[pd.DataFrame] = None,
    settings: Optional[DisclosureSettings] = None,
) -> GeographyRelease:
    """Estimate every level and assemble the release.

    National is always a reference, with its change cells known from the
    national tables. Regions are published on the national dataset and are
    a reference on a local one. Seats are published for ``seat_reforms``;
    every other reform is a reference there with every cell withheld. Each
    package also gets an interaction reference, its change minus its
    measures' changes, withheld everywhere, and is declared twice: as the
    sum of its measures and as the sum of its measures and the interaction.
    Only change outcomes are published, so shares are withheld throughout.

    Args:
        collector: The dataset's arrays, with every reform for every year.
        levels: The levels to publish: ``region``, ``constituency`` or both.
        seat_reforms: The reforms published by constituency.
        packages: Package reform to its measures; all must be collected.
        prior_regional: An already published regional table, if any.
        settings: Disclosure settings (the layer's defaults if None).
    """
    unknown = sorted(set(levels) - set(TABLE_FILES))
    if unknown or not levels:
        raise ValueError(f"levels must be among {sorted(TABLE_FILES)}")
    published = [
        level
        for level in TABLE_FILES
        if level in levels and (level != REGION or collector.national)
    ]
    if not published:
        raise ValueError(
            "Nothing to publish: a local dataset's regions are references"
        )
    reforms, years = collector.reforms, collector.years
    if not reforms:
        raise ValueError("The collector holds no reforms")
    missing_runs = [
        f"{r} {y}" for r in reforms for y in years if not collector.has(r, y)
    ]
    if missing_runs:
        raise ValueError(f"Missing runs: {missing_runs[:5]}")
    packages = {p: tuple(c) for p, c in (packages or {}).items()}
    for package, components in packages.items():
        absent = sorted(set((package, *components)) - set(reforms))
        if absent or package in components or not components:
            raise ValueError(
                f"Package {package} needs itself and its measures: {absent}"
            )
    if CONSTITUENCY in levels:
        if not collector.has_seats:
            raise ValueError("This dataset has no constituency geography")
        if not seat_reforms or set(seat_reforms) - set(reforms):
            raise ValueError("seat_reforms must name collected reforms")
    settings = (settings or DisclosureSettings()).revalidated()
    priors = [national_prior(reforms, years)]
    if prior_regional is not None:
        priors.append(regional_prior(prior_regional))
    # Refuse a prior for runs this release does not make before estimating;
    # its areas are checked once the estimates exist.
    runs = {(level, r, y) for level in _LEVELS for r in reforms for y in years}
    for prior in priors:
        _check_prior_matches(prior, dict.fromkeys(runs), areas=False)

    start = time.perf_counter()
    estimates = _estimate_all(
        collector, levels=levels, packages=packages, settings=settings
    )
    timings = {"estimate_s": time.perf_counter() - start}
    for prior in priors:
        _check_prior_matches(prior, estimates)
    return GeographyRelease(
        estimates=estimates,
        settings=settings,
        published_levels=published,
        seat_reforms=seat_reforms,
        packages=packages,
        seat_regions=collector.seat_regions,
        seat_parent_of=(
            collector.seat_matrix.parent_of
            if collector.seat_matrix is not None
            else None
        ),
        priors=priors,
        timings=timings,
    )


# -- resolving findings ------------------------------------------------------


class ResolutionError(GeographyError):
    """Findings remain that withholding cannot resolve.

    ``findings`` holds labels only: the finding code, relation, level,
    reform, year, family and group.
    """

    def __init__(self, message: str, findings: Iterable[Finding] = ()):
        self.findings = [finding_label(f) for f in findings]
        detail = "; ".join(self.findings[:10])
        super().__init__(f"{message}: {detail}" if detail else message)


def finding_label(finding: Finding) -> str:
    """A finding as labels only."""
    parts = (
        finding.code,
        finding.relation,
        finding.level,
        finding.reform,
        finding.year,
        finding.family,
        finding.group_level,
        finding.group,
    )
    return " ".join(str(part) for part in parts if part is not None)


@dataclass
class ResolutionLog:
    """What resolving did, as labels: rounds, withheld cells, demotions."""

    rounds: int = 0
    passes: int = 1
    withheld: list[Cell] = field(default_factory=list)
    demotions: list[Run] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)


def _weakest(geo: GeographyRelease, cells: Iterable[Cell], *, contributors):
    """The legal cell with the fewest sources, then the first label.

    A remainder fix needs contributors: withholding a cell nobody changes
    in adds nothing to a remainder. A parent fix needs only records.
    """
    legal = [
        cell
        for cell in cells
        if geo.can_withhold(cell)
        and (geo.sources(cell) > 0 if contributors else geo.has_records(cell))
    ]
    return min(legal, key=lambda c: (geo.sources(c), c), default=None)


def _nesting_fix(geo: GeographyRelease, finding: Finding) -> Optional[Cell]:
    level, reform, year = finding.level, finding.reform, finding.year
    family = finding.family

    def cell(area: str) -> Cell:
        return (level, area, reform, year, family)

    children = [
        cell(area) for area in geo.children(level, finding.group, reform, year)
    ]
    if finding.code == RECOVERABLE_REMAINDER:
        if finding.suggested is not None:
            suggested = cell(finding.suggested)
            if geo.can_withhold(suggested) and geo.sources(suggested) > 0:
                return suggested
        child = _weakest(geo, children, contributors=True)
        if child is not None:
            return child
        parent = (finding.group_level, finding.group, reform, year, family)
        return parent if geo.can_withhold(parent) else None
    return _weakest(geo, children, contributors=False)


def _package_fix(geo: GeographyRelease, finding: Finding) -> Optional[Cell]:
    level, package, year, area = (
        finding.level,
        finding.reform,
        finding.year,
        finding.group,
    )

    def cell(reform: str) -> Cell:
        return (level, area, reform, year, FAMILY_CHANGE)

    components = [cell(c) for c in geo.packages[package]]
    if finding.code == RECOVERABLE_REMAINDER:
        if finding.suggested is not None:
            suggested = cell(finding.suggested)
            if geo.can_withhold(suggested) and geo.sources(suggested) > 0:
                return suggested
        component = _weakest(geo, components, contributors=True)
        if component is not None:
            return component
        whole = cell(package)
        return whole if geo.can_withhold(whole) else None
    return _weakest(geo, components, contributors=False)


def _demotion(geo: GeographyRelease, finding: Finding) -> frozenset[Run]:
    """The published constituency runs a finding with no legal fix demotes."""
    if finding.level != CONSTITUENCY:
        raise ResolutionError("No legal fix", [finding])
    reforms = {finding.reform}
    if finding.relation == "package":
        reforms |= set(geo.packages[finding.reform])
    runs = frozenset(
        (reform, finding.year)
        for reform in reforms
        if geo.is_published((CONSTITUENCY, reform, finding.year))
    )
    if not runs:
        raise ResolutionError("No legal fix and nothing to demote", [finding])
    return runs


def _fix(geo: GeographyRelease, finding: Finding) -> Union[Cell, frozenset]:
    """One finding's fix: a cell to withhold, or runs to demote."""
    if finding.code in (NOISE_REFERENCE_PUBLIC, UNCHECKED_OVERLAP):
        raise ResolutionError("Withholding cannot resolve", [finding])
    if finding.code not in (RECOVERABLE_REMAINDER, RECOVERABLE_PARENT):
        raise ResolutionError("Unknown finding", [finding])
    if finding.relation == "nesting":
        cell = _nesting_fix(geo, finding)
    elif finding.relation == "package":
        cell = _package_fix(geo, finding)
    else:
        raise ResolutionError("Unexpected relation", [finding])
    return cell if cell is not None else _demotion(geo, finding)


def resolve(
    geo: GeographyRelease, *, max_rounds: int = MAX_ROUNDS
) -> ResolutionLog:
    """Withhold cells until no blocking finding remains. Deterministic.

    Each round checks, gathers one fix per blocking finding and applies
    them together. A fix withholds a published cell that is not known from
    a prior: the cell the layer suggests, or the legal one with the fewest
    sources, or else the parent (the package). A finding with no legal fix
    demotes its constituency run to a reference with every cell withheld,
    and the release is rebuilt; at the region level it raises. Findings
    that withholding cannot answer (noise against a public reference,
    unchecked overlap) raise, as does a round that adds nothing or more
    than ``max_rounds`` rounds.

    The layer checks each relation on its own. A cell withheld to protect
    another in one relation (a measure withheld beside a thin measure in a
    package) can still be recovered through a second one (national minus
    the other regions), which this resolver does not look for either.

    Raises:
        ResolutionError: With the remaining findings as labels.
    """
    log = ResolutionLog()
    start = time.perf_counter()
    while True:
        findings = geo.release.check()
        blocking = [finding for finding in findings if finding.blocking]
        if not blocking:
            log.withheld = sorted(geo.secondary)
            log.demotions = sorted(geo.demoted)
            log.notices = sorted({finding_label(f) for f in findings})
            geo.timings["resolve_s"] = time.perf_counter() - start
            return log
        if log.rounds >= max_rounds:
            raise ResolutionError(
                f"Unresolved after {max_rounds} rounds", blocking
            )
        log.rounds += 1
        cells: set[Cell] = set()
        demotions: set[Run] = set()
        for finding in blocking:
            fix = _fix(geo, finding)
            if isinstance(fix, frozenset):
                demotions |= fix
            else:
                cells.add(fix)
        if demotions:
            geo.demote(demotions)
            log.passes += 1
            continue
        new = cells - geo.secondary
        if not new:
            raise ResolutionError("A round added nothing", blocking)
        geo.withhold(new)


# -- public tables and the private audit -------------------------------------


_SORT = ["level", "area_code", "reform", "year", "outcome"]


def _write_validated(table: pd.DataFrame, path: Path) -> Path:
    """Write to a temporary file beside ``path``, validate it, then replace
    ``path`` with it. Nothing is replaced when validation finds a problem."""
    descriptor, name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", newline="", encoding="utf-8") as f:
            table.to_csv(f, index=False, lineterminator="\n")
        problems = validate_public(temporary)
        if problems:
            raise GeographyError(
                f"{path.name} fails validation: {problems[:5]}"
            )
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def write_public_tables(
    release: Release,
    out_dir: Union[str, Path],
    names: Mapping[str, Mapping[str, str]],
    *,
    levels: Optional[Sequence[str]] = None,
) -> dict[str, Path]:
    """Write regional.csv and constituency.csv from a resolved release.

    Keeps the published levels and the average and relative change, puts
    ``area_name`` after ``area_code``, sorts by level, area, reform, year
    and outcome, and replaces each file only once ``validate_public``
    passes it.

    Args:
        release: A checked release with no blocking finding.
        out_dir: Where the tables go (public/data for the dashboard).
        names: Area names by level and code.
        levels: The levels to write (default: those with published rows).

    Raises:
        GeographyError: If an area has no name or a table fails validation.
    """
    frame = release.to_public().to_frame()
    frame = frame[frame["outcome"].isin(PUBLISHED_OUTCOMES)]
    if levels is None:
        levels = [lv for lv in TABLE_FILES if (frame["level"] == lv).any()]
    unknown = sorted(set(levels) - set(TABLE_FILES))
    if unknown:
        raise GeographyError(f"No table for levels {unknown}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for level in levels:
        table = frame[frame["level"] == level].copy()
        level_names = names.get(level, {})
        unnamed = sorted(set(table["area_code"]) - set(level_names))
        if unnamed:
            raise GeographyError(f"No name for {level} areas {unnamed[:5]}")
        table.insert(
            table.columns.get_loc("area_code") + 1,
            "area_name",
            table["area_code"].map(level_names),
        )
        table = table.sort_values(_SORT, kind="mergesort")
        written[level] = _write_validated(
            table.reset_index(drop=True), out_dir / TABLE_FILES[level]
        )
    return written


def release_summary(
    geo: GeographyRelease, log: ResolutionLog
) -> dict[str, object]:
    """The private summary: tier counts, withholdings, rounds, demotions
    and timings. Never printed or published."""
    frame = geo.release.to_public().to_frame()
    frame = frame[frame["outcome"].isin(PUBLISHED_OUTCOMES)]
    tiers: dict[str, dict] = {}
    counts = frame.groupby(["level", "reform", "year", "outcome", "tier"])
    for (level, reform, year, outcome, tier), rows in counts:
        tiers.setdefault(level, {}).setdefault(reform, {}).setdefault(
            str(year), {}
        ).setdefault(outcome, {})[tier] = len(rows)
    return {
        "published_levels": list(geo.published_levels),
        "reforms": list(geo.reforms),
        "years": list(geo.years),
        "seat_reforms": sorted(geo.seat_reforms),
        "packages": {p: list(c) for p, c in geo.packages.items()},
        "tiers": tiers,
        "secondary_withholdings": len(log.withheld),
        "withheld": [list(cell) for cell in log.withheld],
        "rounds": log.rounds,
        "passes": log.passes,
        "demotions": [list(run) for run in log.demotions],
        "notices": log.notices,
        "timings_s": {k: round(v, 3) for k, v in geo.timings.items()},
    }


def write_private_audit(
    geo: GeographyRelease,
    log: ResolutionLog,
    *,
    run_id: str,
    release_name: str,
    root: Optional[Path] = None,
) -> Path:
    """Write the layer's audit and a summary to a private directory.

    The directory is ``geography/{run_id}/{release_name}`` under
    ``root`` (default ``$UK_BUDGET_DISCLOSURE_AUDIT_DIR``), outside any git
    repository.

    Raises:
        PrivateOutputError: If no directory is set, or it is in a repository.
    """
    directory = private_directory(
        root, subdirectory=f"geography/{run_id}/{release_name}"
    )
    geo.release.write_audit(directory)
    path = directory / "summary.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(release_summary(geo, log), handle, indent=2, sort_keys=True)
    os.chmod(path, 0o600)
    return directory


# -- command line ------------------------------------------------------------


def add_geography_parser(subparsers) -> None:
    """The ``geography`` command: results by region and constituency."""
    parser = subparsers.add_parser(
        "geography",
        help="Write disclosure-controlled results by region and constituency",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="A local dataset (.h5); default: the bundle's enhanced FRS",
    )
    parser.add_argument(
        "--dataset-kind",
        choices=DATASET_KINDS,
        default=EFRS,
        help="efrs (the national dataset) or microcosm (a local one)",
    )
    parser.add_argument(
        "--levels",
        nargs="+",
        choices=list(TABLE_FILES),
        default=list(TABLE_FILES),
        help="Levels to publish (default: region constituency)",
    )
    parser.add_argument(
        "--seat-weights",
        type=Path,
        default=None,
        help="eFRS seat weight matrix (default: "
        f"<data-dir>/{SEAT_WEIGHTS_FILE})",
    )
    parser.add_argument(
        "--seat-reforms",
        nargs="+",
        default=None,
        help="Reforms published by constituency (default: the combined "
        "reform)",
    )
    parser.add_argument(
        "--reforms",
        nargs="+",
        default=None,
        help="Reform IDs (default: all Autumn Budget reforms)",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=list(DEFAULT_YEARS),
        help="Years (default: 2026 to 2030)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("./public/data"),
        help="Where regional.csv and constituency.csv go "
        "(default: ./public/data)",
    )
    parser.add_argument(
        "--prior-regional",
        type=Path,
        default=None,
        help="An already published regional table, whose cells are known",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("./data"),
        help="Directory with the seat weights (default: ./data)",
    )
    parser.add_argument(
        "--data-inputs-dir",
        type=Path,
        default=Path("./data_inputs"),
        help="Directory with the region and seat lookups "
        "(default: ./data_inputs)",
    )


@dataclass
class _Plan:
    """A geography run, checked before any simulation."""

    reforms: list[Reform]
    years: list[int]
    packages: dict[str, tuple[str, ...]]
    seat_reforms: list[str]
    levels: list[str]
    regions: pd.DataFrame
    seats: pd.DataFrame
    seat_regions: dict[str, str]
    seat_weights: Optional[Path]
    prior_regional: Optional[pd.DataFrame]


def _plan(parsed: argparse.Namespace) -> _Plan:
    """Check a geography run's options. Raises ValueError with labels."""
    kind = parsed.dataset_kind
    if kind == MICROCOSM and parsed.dataset is None:
        raise ValueError("--dataset-kind microcosm needs --dataset")
    if kind == MICROCOSM and parsed.seat_weights is not None:
        raise ValueError("--seat-weights is for the eFRS only")
    ids = parsed.reforms or [r.id for r in get_autumn_budget_2026_reforms()]
    unknown = [i for i in ids if get_reform(i) is None]
    if unknown:
        raise ValueError(f"Unknown reforms: {unknown}")
    reforms = [get_reform(i) for i in dict.fromkeys(ids)]
    chosen = [r.id for r in reforms]
    packages = {p: tuple(c) for p, c in PACKAGES.items() if p in chosen}
    for package, components in packages.items():
        absent = [c for c in components if c not in chosen]
        if absent:
            raise ValueError(f"{package} needs its measures: {absent}")
    levels = list(dict.fromkeys(parsed.levels))
    seat_reforms = []
    if CONSTITUENCY in levels:
        seat_reforms = parsed.seat_reforms or [
            p for p in PACKAGES if p in chosen
        ]
        if not seat_reforms or set(seat_reforms) - set(chosen):
            raise ValueError("--seat-reforms must name chosen reforms")
    inputs = parsed.data_inputs_dir
    regions = load_regions(inputs / REGIONS_FILE)
    seats = load_seats(inputs / SEATS_FILE)
    seat_regions = seat_region_map(inputs / SEATS_FILE, regions)
    seat_weights = None
    if kind == EFRS and CONSTITUENCY in levels:
        seat_weights = parsed.seat_weights or (
            parsed.data_dir / SEAT_WEIGHTS_FILE
        )
        if not seat_weights.is_file():
            raise ValueError(f"No seat weights at {seat_weights}")
    prior = None
    if parsed.prior_regional is not None:
        prior = pd.read_csv(
            parsed.prior_regional, dtype=str, keep_default_na=False
        )
    return _Plan(
        reforms=reforms,
        years=sorted(set(parsed.years)),
        packages=packages,
        seat_reforms=list(seat_reforms),
        levels=levels,
        regions=regions,
        seats=seats,
        seat_regions=seat_regions,
        seat_weights=seat_weights,
        prior_regional=prior,
    )


def simulate_reform(reform: Reform, dataset: Optional[str], years) -> tuple:
    """A reform's baseline and reformed microsimulations."""
    config = DataConfig(years=list(years))
    baseline = build_microsimulation(
        dataset, reform.baseline_scenario_for(config)
    )
    reformed = build_microsimulation(dataset, reform.to_scenario())
    return baseline, reformed


def run_geography(parsed: argparse.Namespace) -> int:
    """Run the ``geography`` command. Prints labels only."""
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    release_name = parsed.dataset_kind
    try:
        private_directory(subdirectory=f"geography/{run_id}/{release_name}")
    except PrivateOutputError as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    try:
        plan = _plan(parsed)
    except (ValueError, OSError) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    dataset = str(parsed.dataset) if parsed.dataset else None
    console.print(
        f"Geography: {parsed.dataset_kind}, levels {' '.join(plan.levels)}, "
        f"years {' '.join(map(str, plan.years))}"
    )

    start = time.perf_counter()
    collector = None
    for reform in plan.reforms:
        console.print(f"Simulating {reform.id}")
        baseline, reformed = simulate_reform(reform, dataset, plan.years)
        if collector is None:
            collector = GeographyCollector.from_simulation(
                baseline,
                kind=parsed.dataset_kind,
                regions=plan.regions,
                seat_regions=plan.seat_regions,
                seat_weights=plan.seat_weights,
            )
        for year in plan.years:
            collector.collect(reform.id, year, baseline, reformed)
        del baseline, reformed
    simulate_s = time.perf_counter() - start

    console.print("Estimating and checking")
    try:
        geo = build_release(
            collector,
            levels=plan.levels,
            seat_reforms=plan.seat_reforms,
            packages=plan.packages,
            prior_regional=plan.prior_regional,
        )
        geo.timings["simulate_s"] = simulate_s
        log = resolve(geo)
        audit = write_private_audit(
            geo, log, run_id=run_id, release_name=release_name
        )
        names = area_names(plan.regions, plan.seats)
        written = write_public_tables(
            geo.release, parsed.out_dir, names, levels=geo.published_levels
        )
    except (GeographyError, ValueError, PrivateOutputError) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    for path in written.values():
        console.print(f"[green]Wrote {path}[/green]")
    console.print(f"Private audit: {audit} (${AUDIT_DIR_ENV})")
    return 0
