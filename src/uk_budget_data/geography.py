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
tables publish it already, so its change cells are known. On a national
dataset the region level is published: the enhanced FRS, whose seats come
from its seat weight matrix, or Microcosm's national file, which has none.
On Microcosm's local file each household carries its seat, and the region
level is a reference, since the regional table comes from the national
dataset. Seats are published for the chosen reforms only; every other reform
is a reference there with every cell withheld, so a package's measures are
checked without being shown.

Microcosm's national and local files are a pair, built from the same survey
households. Regions come from the national file and seats from the local
one, which takes the regional table as a prior. ``pair_consistency`` then
compares the two files' national and regional estimates, privately.

Nothing here prints a value, a count or a support figure: only labels.
"""

import argparse
import hashlib
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
from pathlib import Path, PurePosixPath
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
    save_private_csv,
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
MICROCOSM_NATIONAL = "microcosm-national"
DATASET_KINDS = (EFRS, MICROCOSM, MICROCOSM_NATIONAL)
MICROCOSM_KINDS = (MICROCOSM, MICROCOSM_NATIONAL)
# Columns only Microcosm's local file carries: each household's areas.
MICROCOSM_LOCAL_COLUMNS = ("region_code_oa", "constituency_code_oa")
# The roles a build's release_manifest.json gives the two files of the pair,
# each entry of its artifacts naming a file by path, with its sha256 and
# role. Assumed until Microcosm defines the manifest's file roles: today's
# manifests give none, and a role not listed here (such as a plain
# "dataset") leaves the columns to tell the files apart, as before.
MICROCOSM_FILE_ROLES = {
    "national_dataset": MICROCOSM_NATIONAL,
    "local_area_dataset": MICROCOSM,
}
# The page shows the one reform ending in this as the full package
# (src/utils/geography/selection.js).
PACKAGE_SUFFIX = "_combined"
# Flags on the copies policyengine-uk-data stacks onto the FRS households to
# build the enhanced FRS, in the order it stacks them.
COPY_FLAGS = (
    "household_is_spi_synthetic",
    "household_is_capital_gains_clone",
    "household_is_cgt_band_donor",
)
_COPY_FLAG_PATTERN = re.compile(r"^household_is_.*(clone|copy)")
# What a copy shares with the household it was copied from.
EFRS_KEY_COLUMNS = ("region", "tenure_type", "accommodation_type")
# Written at the root of every H5 Microcosm exports; policyengine-uk-data
# never writes it.
MICROCOSM_EXPORT_ATTRIBUTE = "populace_household_weight_kind"

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
# The layer's private audit, and the pair check written beside it.
AUDIT_FILE = "disclosure_audit.csv"
PAIR_REPORT_FILE = "pair_consistency.csv"
# How far the local file's national and regional estimates may sit from the
# national file's before the pair check flags them (María, 19 October): a
# share of the national file's value, never less than a floor in the
# outcome's unit. Report only: a flag never stops a run.
PAIR_TOLERANCE = {"national": 0.05, "region": 0.10}
PAIR_FLOOR = {"average_change": 5.0, "relative_change": 0.0005}
RUN_ID = re.compile(r"[A-Za-z0-9._-]{1,80}")

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


def is_microcosm_export(path: Union[str, Path]) -> bool:
    """Whether an H5 file was exported by Microcosm."""
    with h5py.File(path, "r") as handle:
        return MICROCOSM_EXPORT_ATTRIBUTE in handle.attrs


def _orphaned(ids: np.ndarray, flagged: np.ndarray) -> bool:
    """Whether a row flagged as a copy carries an id no unflagged row does."""
    return bool((~pd.Index(ids[flagged]).isin(ids[~flagged])).any())


def _microcosm_source_ids(
    household: pd.DataFrame, microcosm_export: bool
) -> np.ndarray:
    if not microcosm_export:
        raise ValueError(
            "The dataset is not a Microcosm export: its H5 has no "
            f"{MICROCOSM_EXPORT_ATTRIBUTE} attribute. A file built by "
            "policyengine-uk-data goes through --dataset-kind efrs, whose "
            "lineage checks it must pass."
        )
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
    if "source_household_key" in household.columns:
        pairs = household[
            ["source_household_id", "source_household_key"]
        ].drop_duplicates()
        if not (
            pairs["source_household_id"].is_unique
            and pairs["source_household_key"].is_unique
        ):
            raise ValueError(
                "source_household_id and source_household_key do not name "
                "the same survey households one to one."
            )
    if "region" in household.columns:
        region = pd.Series(np.asarray(household["region"], dtype=object))
        spans = region.map(_label).groupby(ids.to_numpy()).nunique()
        if (spans > 1).any():
            raise ValueError(
                "Some survey households span more than one region."
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


def _survey_key(household: pd.DataFrame, person: pd.DataFrame) -> np.ndarray:
    """What a copy shares with its original: region, tenure, accommodation
    and the sorted ages and genders of the members."""
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
    key = (
        pd.Series(household_ids)
        .map(_members(person))
        .fillna("")
        .to_numpy(dtype=object)
    )
    for column in EFRS_KEY_COLUMNS:
        codes, uniques = pd.factorize(
            pd.Series(np.asarray(household[column], dtype=object))
        )
        labels = np.array([_label(u) for u in uniques] + [""], dtype=object)
        key = labels[codes] + "\x1f" + key
    return key


def _lineage_ids(
    household: pd.DataFrame, flagged: np.ndarray
) -> Optional[np.ndarray]:
    """``source_household_id``, if it names the FRS household behind every
    row: policyengine-uk-data#597's rule for a built file, that every copy
    carries an id some unflagged row also carries. Files built before that
    fix give a copy its own stacked id, and fail it."""
    if "source_household_id" not in household.columns:
        return None
    ids = household["source_household_id"]
    if ids.isna().any():
        return None
    ids = ids.to_numpy()
    if flagged.any() and _orphaned(ids, flagged):
        return None
    return ids


def _unstacked_ids(household: pd.DataFrame) -> Optional[np.ndarray]:
    """FRS household ids recovered by undoing the enhanced FRS's stacking.

    policyengine-uk-data's ``stack_datasets`` shifts a copy's ids to one
    more than the largest id already present. It stacks the SPI copies onto
    the FRS, then doubles the result for capital gains, then adds the CGT
    band donors, each a copy of a row already there that keeps that row's
    flags. Undoing the shifts in reverse gives each row's FRS household.
    Returns None unless every row lands on an unflagged household.
    """
    if any(flag not in household.columns for flag in COPY_FLAGS):
        return None
    ids = household["household_id"].to_numpy().astype(np.int64)
    spi, gains, donor = (_flagged(household, [f]) for f in COPY_FLAGS)
    original = ~(spi | gains | donor)
    if not original.any() or not pd.Index(ids).is_unique:
        return None
    spi_shift = ids[original].max() + 1
    gains_shift = ids[~gains & ~donor].max() + 1
    donor_shift = ids[~donor].max() + 1
    source = ids.copy()
    donors = np.flatnonzero(donor)
    if len(donors):
        position = pd.Series(np.arange(len(ids)), index=ids)
        copied = position.reindex(ids[donors] - donor_shift).to_numpy()
        if np.isnan(copied).any():
            return None
        copied = copied.astype(int)
        if donor[copied].any():
            return None
        source[donors] = ids[copied]
        spi, gains = spi.copy(), gains.copy()
        spi[donors], gains[donors] = spi[copied], gains[copied]
    source = np.where(gains, source - gains_shift, source)
    source = np.where(spi, source - spi_shift, source)
    if not np.isin(source, ids[original]).all():
        return None
    return source


def _copies_match(
    household: pd.DataFrame,
    person: pd.DataFrame,
    ids: np.ndarray,
    flagged: np.ndarray,
) -> bool:
    """Whether every copy shares its key with the original its id names."""
    key = _survey_key(household, person)
    originals = pd.Series(key[~flagged]).groupby(ids[~flagged])
    if (originals.nunique() > 1).any():
        return False
    expected = originals.first().reindex(ids[flagged]).to_numpy()
    return bool((expected == key[flagged]).all())


def _efrs_source_ids(
    household: pd.DataFrame, person: pd.DataFrame
) -> np.ndarray:
    # Without its copy flags, every row would count as its own household.
    missing = [flag for flag in COPY_FLAGS if flag not in household.columns]
    if missing:
        raise ValueError(
            f"The enhanced FRS tables lack the copy flags {missing}, so its "
            "copies cannot be told from the households they were made from."
        )
    flags = list(COPY_FLAGS)
    flagged = _flagged(household, flags)
    ids = _lineage_ids(household, flagged)
    route = "source_household_id"
    if ids is None:
        ids = _unstacked_ids(household)
        route = "the stacking offsets"
    if ids is None:
        raise ValueError(
            "The enhanced FRS's source_household_id does not name the FRS "
            "household behind every copy (policyengine-uk-data#591), and "
            "undoing its stacking offsets does not recover them either, so "
            "its results by area cannot be counted by survey household."
        )
    if not _copies_match(household, person, ids, flagged):
        raise ValueError(
            f"The ids from {route} pair some copy with a household it does "
            "not match on region, tenure, accommodation or members."
        )
    return ids.astype(np.int64)


def file_sha256(path: Union[str, Path]) -> str:
    """The SHA-256 of a file's bytes, read in chunks."""
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def release_manifest_file_role(
    manifest_path: Union[str, Path], dataset_path: Union[str, Path]
) -> Optional[str]:
    """Which file of the pair a build's release manifest says a dataset is.

    The dataset's entry is the one of the manifest's ``artifacts`` whose
    ``path`` ends in the dataset's file name. Its ``role`` counts only when
    it is one of ``MICROCOSM_FILE_ROLES``, and then only if the entry's
    ``sha256`` is the dataset's, so a role is never taken from a manifest
    that lists another file of the same name. Any other role, or none, as in
    today's manifests, returns None: the columns then decide, as before,
    and the file is not hashed.

    Raises:
        ValueError: If the manifest is not a JSON object with an
            ``artifacts`` mapping, does not list the dataset's file name
            exactly once, or gives the dataset a pair role without its
            sha256.
    """
    try:
        manifest = json.loads(Path(manifest_path).read_text())
    except ValueError:
        raise ValueError(
            f"The release manifest {manifest_path} is not JSON"
        ) from None
    artifacts = (
        manifest.get("artifacts") if isinstance(manifest, dict) else None
    )
    if not isinstance(artifacts, dict):
        raise ValueError(
            f"The release manifest {manifest_path} has no artifacts mapping"
        )
    name = Path(dataset_path).name
    entries = [
        entry
        for entry in artifacts.values()
        if isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and PurePosixPath(entry["path"]).name == name
    ]
    if not entries:
        raise ValueError(
            f"The release manifest {manifest_path} lists no file named {name}"
        )
    if len(entries) > 1:
        raise ValueError(
            f"The release manifest {manifest_path} lists {name} more than once"
        )
    role = entries[0].get("role")
    if not isinstance(role, str) or role not in MICROCOSM_FILE_ROLES:
        return None
    listed = entries[0].get("sha256")
    if not isinstance(listed, str) or listed.lower() != file_sha256(
        dataset_path
    ):
        raise ValueError(
            f"The release manifest gives {name} the role {role} without the "
            "file's sha256, so the role is not this file's"
        )
    return role


def check_file_role(file_role: str, kind: str) -> None:
    """Refuse a file whose manifest role names the other file of the pair.

    Raises:
        ValueError: If ``file_role`` is not one of ``MICROCOSM_FILE_ROLES``
            or names another kind than ``kind``.
    """
    if file_role not in MICROCOSM_FILE_ROLES:
        raise ValueError(f"Unknown Microcosm file role {file_role!r}")
    expected = MICROCOSM_FILE_ROLES[file_role]
    if expected != kind:
        raise ValueError(
            f"The release manifest gives this file the role {file_role}; "
            f"use --dataset-kind {expected}"
        )


def check_microcosm_file(
    household: pd.DataFrame, kind: str, file_role: Optional[str] = None
) -> None:
    """Refuse a Microcosm file given as the other file of the pair.

    Both files carry the same export marker, so their columns tell them
    apart: only the local file places each household in its areas.

    With ``file_role``, the role the build's release manifest gives the file
    (``release_manifest_file_role``), the role must name ``kind``, and the
    columns must not contradict it: a file the role calls national may not
    carry the local file's area columns, and one it calls local needs them.

    Raises:
        ValueError: If the columns, or the role, do not match ``kind``.
    """
    if file_role is not None:
        check_file_role(file_role, kind)
        area_columns = [
            column
            for column in MICROCOSM_LOCAL_COLUMNS
            if column in household.columns
        ]
        if kind == MICROCOSM_NATIONAL:
            if area_columns:
                raise ValueError(
                    "The release manifest gives this file the role "
                    f"{file_role}, but it carries {area_columns}, which "
                    "only Microcosm's local file has"
                )
            if "region" not in household.columns:
                raise ValueError("A Microcosm national file needs region")
            return
        missing = [
            column
            for column in MICROCOSM_LOCAL_COLUMNS
            if column not in area_columns
        ]
        if missing:
            raise ValueError(f"A Microcosm local file needs {missing}")
        return
    local = [c for c in MICROCOSM_LOCAL_COLUMNS if c in household.columns]
    if kind == MICROCOSM_NATIONAL:
        if local:
            raise ValueError(
                f"This is a Microcosm local file (it carries {local}); use "
                "--dataset-kind microcosm for it"
            )
        if "region" not in household.columns:
            raise ValueError("A Microcosm national file needs region")
    elif kind == MICROCOSM and len(local) < len(MICROCOSM_LOCAL_COLUMNS):
        missing = [c for c in MICROCOSM_LOCAL_COLUMNS if c not in local]
        raise ValueError(
            f"This Microcosm file lacks {missing}, so it is not a local file; "
            "use --dataset-kind microcosm-national for the national one"
        )


def survey_household_ids(
    household: pd.DataFrame,
    person: Optional[pd.DataFrame],
    kind: str,
    *,
    microcosm_export: bool = False,
) -> np.ndarray:
    """The survey household behind each row of the household table.

    The layer counts the households behind a number by these ids, so a copy
    or clone must carry its original's id, and two households never share
    one: every rule depends on it, including the p% rule, which a merge of
    two households can weaken.

    - ``efrs``: ``source_household_id`` if every copy carries an id an
      unflagged row also carries (policyengine-uk-data#597's rule for a
      built file); otherwise the FRS ids recovered by undoing the stacking
      offsets, if every row lands on an unflagged household. Either way,
      every copy must match its original on region, tenure, accommodation
      and the ages and genders of its members. Otherwise the dataset is
      refused.
    - ``microcosm`` and ``microcosm-national``: ``source_household_id`` of a
      Microcosm export (``microcosm_export``, from
      :func:`is_microcosm_export`), refused if it is unique per row while
      copies are flagged, does not match ``source_household_key`` one to
      one, or spans regions. A local file is a sample, so a copy's original
      need not be in it; files that are not Microcosm exports go through
      ``efrs`` instead.

    Raises:
        ValueError: For another kind, or when the ids cannot be trusted.
    """
    if kind in MICROCOSM_KINDS:
        return _microcosm_source_ids(household, microcosm_export)
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
    ``years`` are the years the file holds, if it does not hold every year
    asked for: a later year then takes the latest earlier year's weights,
    rescaled to that year's household weights (see
    ``GeographyCollector.seat_areas``). None means ``load`` serves any year.
    """

    codes: tuple[str, ...]
    parent_of: Mapping[str, str]
    load: Callable[[int], np.ndarray]
    years: Optional[tuple[int, ...]] = None

    def base_year(self, year: int) -> int:
        """The year whose weights serve ``year``."""
        if self.years is None or year in self.years:
            return year
        earlier = [y for y in self.years if y <= year]
        if not earlier:
            raise KeyError(
                f"No seat weights for {year} or any earlier year; the file "
                f"has {list(self.years)}"
            )
        return max(earlier)

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

        with h5py.File(path, "r") as handle:
            years = tuple(sorted(int(key) for key in handle.keys()))
        return cls(
            codes=tuple(seat_regions),
            parent_of=dict(seat_regions),
            load=load,
            years=years,
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
        # The year whose seat weights served each year (see seat_areas).
        self.seat_weight_years: dict[int, int] = {}

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
        microcosm_export: bool = False,
        file_role: Optional[str] = None,
    ) -> "GeographyCollector":
        """The dataset-level arrays of the dataset a simulation runs on.

        ``kind`` is ``efrs`` (the national dataset; seats from the weight
        matrix at ``seat_weights``, if given), ``microcosm-national``
        (Microcosm's national file; regions from ``region``, no seats) or
        ``microcosm`` (Microcosm's local file; seats from
        ``constituency_code_oa``). ``file_role`` is the role the build's
        release manifest gives a Microcosm file, when it names one of the
        pair (see :func:`check_microcosm_file`).
        """
        tables = dataset_tables(simulation)
        household = tables.household
        if kind in MICROCOSM_KINDS:
            check_microcosm_file(household, kind, file_role)
        source_ids = survey_household_ids(
            household,
            tables.person,
            kind,
            microcosm_export=microcosm_export,
        )
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
        if kind == MICROCOSM_NATIONAL:
            return cls(
                source_ids=source_ids,
                region_codes=frs_region_codes(household["region"], regions),
                national=True,
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
        base = self.seat_matrix.base_year(year)
        matrix = self.seat_matrix.load(base)
        if matrix.shape != (len(self.seat_matrix.codes), self.n_records):
            raise ValueError(
                f"The seat weights for {base} do not match the seats and "
                "the dataset's households"
            )
        if base != year:
            # Keep each household's split across seats from the base year,
            # scaled to its weight in this year, so the seats add up to the
            # same households as the nation and the regions do.
            totals = matrix.sum(axis=0)
            weight = self.weight(year)
            scale = np.divide(
                weight,
                totals,
                out=np.zeros_like(weight, dtype=float),
                where=totals > 0,
            )
            matrix = matrix * scale[None, :]
        self.seat_weight_years[year] = base
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


def regional_withheld(frame: pd.DataFrame) -> set[Cell]:
    """The cells an already published regional table withheld.

    In a later release on the same areas they must stay withheld, even where
    that release only uses them as references: a reference that passes
    counts as public, and nothing would then check that the later release's
    seats do not add up to a region the first table hid.
    """
    hidden = frame[frame["tier"].astype(str) == WITHHELD]
    return {
        (level, area, reform, int(year), OUTCOME_FAMILY[outcome])
        for level, area, reform, year, outcome in hidden[
            ["level", "area_code", "reform", "year", "outcome"]
        ].itertuples(index=False, name=None)
        if outcome in OUTCOME_FAMILY
    }


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
        prior_withheld: Iterable[Cell] = (),
        seat_weight_years: Optional[Mapping[int, int]] = None,
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
        self.prior_withheld = frozenset(prior_withheld)
        # The year whose seat weights served each year (see seat_areas).
        self.seat_weight_years = dict(seat_weight_years or {})
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
        self._loose: dict[tuple, bool] = {}
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
        """Shares everywhere (only change outcomes are published), every
        change cell of a reference no table publishes, and every cell an
        earlier table withheld."""
        cells: set[Cell] = set(self.prior_withheld)
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

    def parent(self, child_level: str, area: str) -> tuple[str, str]:
        """The level and code of the area a child area nests in."""
        if child_level == REGION:
            return NATIONAL, NATIONAL_CODE
        return REGION, self.seat_regions[area]

    def has_loose(
        self, child_level: str, parent_area: str, reform: str, year: int
    ) -> bool:
        """Whether a parent area holds weighted records in no child area.

        The layer adds them to every remainder of a nesting given as
        labels; a weight matrix has none.
        """
        key = (child_level, parent_area, reform, year)
        if key not in self._loose:
            child = self.estimates[(child_level, reform, year)].areas
            parent_level = NATIONAL if child_level == REGION else REGION
            parent = self.estimates[(parent_level, reform, year)].areas
            self._loose[key] = child.one_area_per_record and bool(
                (
                    (parent.labels == parent_area)
                    & (child.record_weights([], include_unassigned=True) > 0)
                ).any()
            )
        return self._loose[key]

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
    prior_withheld: set[Cell] = set()
    if prior_regional is not None:
        priors.append(regional_prior(prior_regional))
        prior_withheld = regional_withheld(prior_regional)
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
    unmatched = [
        cell
        for cell in prior_withheld
        if (cell[0], cell[2], cell[3]) not in estimates
        or cell[1]
        not in estimates[(cell[0], cell[2], cell[3])].areas.area_codes
    ]
    if unmatched:
        raise ValueError(
            "The regional table withholds cells that match no estimate: "
            f"{sorted(unmatched)[:5]}"
        )
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
        prior_withheld=prior_withheld,
        seat_weight_years=collector.seat_weight_years,
        timings=timings,
    )


# -- resolving findings ------------------------------------------------------


class ResolutionError(GeographyError):
    """Findings remain that withholding cannot resolve.

    ``findings`` holds labels only: the finding code, relation, level,
    reform, year, family and group.
    """

    def __init__(
        self, message: str, findings: Iterable[Union[Finding, str]] = ()
    ):
        self.findings = [
            finding_label(f) if isinstance(f, Finding) else f for f in findings
        ]
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


def _demote(
    geo: GeographyRelease,
    level: str,
    reforms: Iterable[str],
    year: int,
    label: Union[Finding, str],
) -> frozenset[Run]:
    """The published constituency runs a problem with no legal fix demotes.

    ``reforms`` are the relation's: the reform of a nesting, or a package
    and its measures.
    """
    if level != CONSTITUENCY:
        raise ResolutionError("No legal fix", [label])
    runs = frozenset(
        (reform, year)
        for reform in reforms
        if geo.is_published((CONSTITUENCY, reform, year))
    )
    if not runs:
        raise ResolutionError("No legal fix and nothing to demote", [label])
    return runs


def _demotion(geo: GeographyRelease, finding: Finding) -> frozenset[Run]:
    """The published constituency runs a finding with no legal fix demotes."""
    reforms = {finding.reform}
    if finding.relation == "package":
        reforms |= set(geo.packages[finding.reform])
    return _demote(geo, finding.level, reforms, finding.year, finding)


def _public(geo: GeographyRelease, cell: Cell) -> bool:
    """Whether a reader sees a cell: known from a prior, or not withheld (a
    reference cell that passes counts as public elsewhere)."""
    return cell in geo.known or geo.tier(cell) != WITHHELD


def _alone_in_nesting(geo: GeographyRelease, cell: Cell) -> bool:
    level, area, reform, year, family = cell
    parent_level, parent_area = geo.parent(level, area)
    parent_key = (parent_level, reform, year)
    if parent_area not in geo.estimates[parent_key].areas.area_codes:
        return False
    parent = (parent_level, parent_area, reform, year, family)
    if not _public(geo, parent) or geo.has_loose(
        level, parent_area, reform, year
    ):
        return False
    siblings = [
        (level, other, reform, year, family)
        for other in geo.children(level, parent_area, reform, year)
        if other != area
    ]
    return all(_public(geo, s) or not geo.has_records(s) for s in siblings)


def _alone_in_package(geo: GeographyRelease, cell: Cell, package: str) -> bool:
    level, area, reform, year, family = cell
    if not _public(geo, (level, area, package, year, family)):
        return False
    return all(
        _public(geo, (level, area, other, year, family))
        for other in geo.packages[package]
        if other != reform
    )


def exposures(geo: GeographyRelease) -> list[tuple[str, Cell]]:
    """Withheld published cells that subtraction recovers exactly.

    The layer lets a withheld cell that meets the rules on its own stand
    alone, since it is not sensitive itself. But a cell withheld beside
    another (a measure beside a thin measure in a package, a region beside
    its thin seats) protects it only while it cannot be recovered. A
    withheld change cell is recovered when it is the only withheld cell of
    its nesting group, whose parent and other children are public and which
    holds no loose records; or the only withheld measure of a package whose
    cell is public, the interaction taken as small, as the package's first
    declaration takes it. Each is returned with ``nesting`` or the package.
    """
    found = []
    for key in sorted(geo.estimates):
        level, reform, year = key
        if level == NATIONAL or not geo.is_published(key):
            continue
        for area in geo.estimates[key].areas.area_codes:
            cell = (level, area, reform, year, FAMILY_CHANGE)
            if _public(geo, cell):
                continue
            if _alone_in_nesting(geo, cell):
                found.append(("nesting", cell))
            for package, components in sorted(geo.packages.items()):
                if reform in components and _alone_in_package(
                    geo, cell, package
                ):
                    found.append((package, cell))
    return found


def exposure_label(kind: str, cell: Cell) -> str:
    """An exposure as labels only."""
    level, area, reform, year, family = cell
    return f"exposed {kind} {level} {area} {reform} {year} {family}"


def _exposure_fix(
    geo: GeographyRelease, kind: str, cell: Cell
) -> Union[Cell, frozenset]:
    """Withhold a second cell of the group, so neither is recovered alone:
    another child (or measure) with contributors, else with records, else
    the parent (or the package). With none legal, demote or raise."""
    level, area, reform, year, family = cell
    if kind == "nesting":
        parent_level, parent_area = geo.parent(level, area)
        group = [
            (level, other, reform, year, family)
            for other in geo.children(level, parent_area, reform, year)
            if other != area
        ]
        whole = (parent_level, parent_area, reform, year, family)
        reforms = {reform}
    else:
        group = [
            (level, area, other, year, family)
            for other in geo.packages[kind]
            if other != reform
        ]
        whole = (level, area, kind, year, family)
        reforms = {kind, *geo.packages[kind]}
    fix = _weakest(geo, group, contributors=True) or _weakest(
        geo, group, contributors=False
    )
    if fix is None and geo.can_withhold(whole):
        fix = whole
    if fix is not None:
        return fix
    return _demote(geo, level, reforms, year, exposure_label(kind, cell))


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
    """Withhold cells until no blocking finding or exposure remains.

    Deterministic. Each round checks, gathers one fix per blocking finding
    and applies them together. A fix withholds a published cell that is not known from
    a prior: the cell the layer suggests, or the legal one with the fewest
    sources, or else the parent (the package). A finding with no legal fix
    demotes its constituency run to a reference with every cell withheld,
    and the release is rebuilt; at the region level it raises. Findings
    that withholding cannot answer (noise against a public reference,
    unchecked overlap) raise, as does a round that adds nothing or more
    than ``max_rounds`` rounds.

    The layer checks each relation on its own, so a cell withheld to
    protect another in one relation could be recovered through a second.
    Once the layer finds nothing, each round also looks for withheld cells
    that subtraction recovers exactly through one relation (``exposures``)
    and withholds a second cell beside each, until there are none. That
    builds the rectangles a table with public totals needs. Recovery
    through several relations at once is not searched for.

    Raises:
        ResolutionError: With the remaining problems as labels.
    """
    log = ResolutionLog()
    start = time.perf_counter()
    while True:
        findings = geo.release.check()
        blocking = [finding for finding in findings if finding.blocking]
        exposed = [] if blocking else exposures(geo)
        if not blocking and not exposed:
            log.withheld = sorted(geo.secondary)
            log.demotions = sorted(geo.demoted)
            log.notices = sorted({finding_label(f) for f in findings})
            geo.timings["resolve_s"] = time.perf_counter() - start
            return log
        problems = blocking or [exposure_label(*e) for e in exposed]
        if log.rounds >= max_rounds:
            raise ResolutionError(
                f"Unresolved after {max_rounds} rounds", problems
            )
        log.rounds += 1
        if blocking:
            added, demotions = _apply_finding_fixes(geo, blocking)
        else:
            added, demotions = _apply_exposure_fixes(geo, exposed)
        if demotions:
            geo.demote(demotions)
            log.passes += 1
            continue
        if not added:
            raise ResolutionError("A round added nothing", problems)


def _apply_finding_fixes(
    geo: GeographyRelease, blocking: Sequence[Finding]
) -> tuple[int, set[Run]]:
    """One fix per blocking finding, applied together."""
    fixes = [_fix(geo, finding) for finding in blocking]
    demotions = set().union(
        *(fix for fix in fixes if isinstance(fix, frozenset))
    )
    if demotions:
        return 0, demotions
    new = {fix for fix in fixes if not isinstance(fix, frozenset)}
    new -= geo.secondary
    geo.withhold(new)
    return len(new), set()


def _apply_exposure_fixes(
    geo: GeographyRelease, exposed: Sequence[tuple[str, Cell]]
) -> tuple[int, set[Run]]:
    """Fix exposures one at a time, so a cell withheld for one can close
    the next: each is checked again before it is fixed."""
    added, demotions = 0, set()
    for kind, cell in exposed:
        alone = (
            _alone_in_nesting(geo, cell)
            if kind == "nesting"
            else _alone_in_package(geo, cell, kind)
        )
        if not alone:
            continue
        fix = _exposure_fix(geo, kind, cell)
        if isinstance(fix, frozenset):
            demotions |= fix
        else:
            geo.withhold([fix])
            added += 1
    return added, demotions


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
        "seat_weights_from": {
            str(year): base
            for year, base in sorted(geo.seat_weight_years.items())
        },
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


# -- the pair check ----------------------------------------------------------


_PAIR_KEY = ["level", "area_code", "reform", "year", "outcome"]


def _audit_cells(path: Union[str, Path]) -> pd.DataFrame:
    """A private audit's national and regional change cells, exact."""
    frame = pd.read_csv(
        path,
        usecols=[*_PAIR_KEY, "exact_value"],
        dtype={key: str for key in _PAIR_KEY if key != "year"},
        keep_default_na=False,
    )
    keep = (
        frame["level"].isin(PAIR_TOLERANCE)
        & frame["outcome"].isin(PUBLISHED_OUTCOMES)
        & ~frame["reform"].str.endswith(INTERACTION_SUFFIX)
    )
    frame = frame[keep].copy()
    frame["year"] = frame["year"].astype(int)
    frame["exact_value"] = frame["exact_value"].astype(float)
    return frame


def pair_consistency(
    national_audit: Union[str, Path], local_audit: Union[str, Path]
) -> pd.DataFrame:
    """Compare a Microcosm pair's national and regional estimates. Private.

    The two files carry their own weights, so their estimates differ; a
    large gap points to a bug or to miscalibration. Each row is a national
    or regional change cell from the two runs' private audits: both exact
    values, the gap, the gap allowed (``PAIR_TOLERANCE`` of the national
    file's value, at least ``PAIR_FLOOR``) and a status. A cell only one run
    holds is marked so. The table holds exact values: it stays in the
    private directory.
    """
    national = _audit_cells(national_audit)
    local = _audit_cells(local_audit)
    merged = national.merge(
        local,
        on=_PAIR_KEY,
        how="outer",
        suffixes=("_national", "_local"),
        indicator=True,
    )
    national_value = merged["exact_value_national"]
    local_value = merged["exact_value_local"]
    gap = (local_value - national_value).abs()
    allowed = np.maximum(
        merged["level"].map(PAIR_TOLERANCE) * national_value.abs(),
        merged["outcome"].map(PAIR_FLOOR),
    )
    side = merged["_merge"].astype(str)
    status = np.select(
        [side == "left_only", side == "right_only", gap > allowed],
        ["national_only", "local_only", "beyond_tolerance"],
        default="within_tolerance",
    )
    report = merged[_PAIR_KEY].copy()
    report["national_value"] = national_value
    report["local_value"] = local_value
    report["gap"] = gap
    report["allowed"] = allowed
    report["status"] = status
    return report.sort_values(_PAIR_KEY, kind="mergesort").reset_index(
        drop=True
    )


def pair_summary(report: pd.DataFrame) -> str:
    """The pair check as counts of cells, never values."""
    counts = report["status"].value_counts()
    one_side = int(counts.get("national_only", 0)) + int(
        counts.get("local_only", 0)
    )
    return (
        f"Pair check (report only): {len(report)} national and regional "
        f"cells, {int(counts.get('beyond_tolerance', 0))} beyond tolerance, "
        f"{one_side} in one run only. Private report: {PAIR_REPORT_FILE}"
    )


def add_pair_check_parser(subparsers) -> None:
    """The ``pair-check`` command: compare two geography runs' audits."""
    parser = subparsers.add_parser(
        "pair-check",
        help="Compare a Microcosm pair's national and regional estimates, "
        "privately",
    )
    parser.add_argument(
        "--national-audit",
        type=Path,
        required=True,
        help="The national file's run: its private audit directory",
    )
    parser.add_argument(
        "--local-audit",
        type=Path,
        required=True,
        help="The local file's run: its private audit directory, where the "
        "report goes",
    )


def run_pair_check(parsed: argparse.Namespace) -> int:
    """Run the ``pair-check`` command. Prints counts only."""
    try:
        directory = private_directory(parsed.local_audit)
        report = pair_consistency(
            parsed.national_audit / AUDIT_FILE, directory / AUDIT_FILE
        )
        save_private_csv(report, directory / PAIR_REPORT_FILE)
    except (OSError, PrivateOutputError, ValueError) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    console.print(pair_summary(report))
    return 0


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
        help="efrs (the national eFRS), microcosm-national (Microcosm's "
        "national file, for regions) or microcosm (Microcosm's local file, "
        "for seats)",
    )
    parser.add_argument(
        "--release-manifest",
        type=Path,
        default=None,
        help="The Microcosm file's release_manifest.json: a role it gives "
        f"the file ({' or '.join(MICROCOSM_FILE_ROLES)}) must agree with "
        "--dataset-kind and with the file's columns",
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
        "reform; with --package, the package and every measure)",
    )
    parser.add_argument(
        "--package",
        default=None,
        help="Also simulate the chosen reforms together as one package with "
        f"this id (ending in {PACKAGE_SUFFIX}), checked against its measures",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Names the private audit directory, geography/<run-id>/<kind> "
        "(default: the start time), so a pair's two runs can be compared",
    )
    parser.add_argument(
        "--compare-with",
        type=Path,
        default=None,
        help="A Microcosm national run's private audit directory: compare "
        "this local run's national and regional estimates with it, "
        "privately (report only)",
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
        "--seat-lookup",
        type=Path,
        default=None,
        help=(
            "The constituency lookup the seat weights were built from "
            "(default: constituencies_2024.csv beside them); its seats must "
            "match the dashboard's, in order"
        ),
    )
    parser.add_argument(
        "--prior-regional",
        type=Path,
        default=None,
        help="An already published regional table, whose cells are known",
    )
    parser.add_argument(
        "--allow-demotions",
        action="store_true",
        help=(
            "Write the tables even when some constituency runs had to be "
            "demoted to unpublished; without it such a run stops with an "
            "error after the private audit"
        ),
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
    microcosm_export: bool = False
    compare_with: Optional[Path] = None
    microcosm_file_role: Optional[str] = None


def _plan(parsed: argparse.Namespace) -> _Plan:
    """Check a geography run's options. Raises ValueError with labels."""
    kind = parsed.dataset_kind
    if kind in MICROCOSM_KINDS and parsed.dataset is None:
        raise ValueError(f"--dataset-kind {kind} needs --dataset")
    if kind in MICROCOSM_KINDS and parsed.seat_weights is not None:
        raise ValueError("--seat-weights is for the eFRS only")
    if kind == MICROCOSM_NATIONAL and CONSTITUENCY in parsed.levels:
        raise ValueError(
            "--dataset-kind microcosm-national has no seats; they come from "
            "the local file (--dataset-kind microcosm). Pass --levels region"
        )
    if parsed.release_manifest is not None and kind not in MICROCOSM_KINDS:
        raise ValueError("--release-manifest is for a Microcosm file")
    if parsed.compare_with is not None:
        if kind != MICROCOSM:
            raise ValueError("--compare-with is for a Microcosm local run")
        if not (parsed.compare_with / AUDIT_FILE).is_file():
            raise ValueError(f"No {AUDIT_FILE} in {parsed.compare_with}")
    # Read from the file, never inferred from the kind: the ids check it too.
    microcosm_export = kind in MICROCOSM_KINDS and is_microcosm_export(
        parsed.dataset
    )
    if kind in MICROCOSM_KINDS and not microcosm_export:
        raise ValueError(
            f"--dataset-kind {kind} needs a Microcosm export; a file "
            "built by policyengine-uk-data goes through --dataset-kind efrs"
        )
    # A role in the build's release manifest that names one of the pair's
    # files must name this kind, before any simulation. The columns are
    # checked later: against the role, or on their own without one.
    microcosm_file_role = None
    if parsed.release_manifest is not None:
        microcosm_file_role = release_manifest_file_role(
            parsed.release_manifest, parsed.dataset
        )
        if microcosm_file_role is not None:
            check_file_role(microcosm_file_role, kind)
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
    package = parsed.package
    if package is not None:
        if packages:
            raise ValueError(
                f"--package cannot join a registered package: {sorted(packages)}"
            )
        # Named among --reforms too, it is the package, not a measure.
        reforms = [r for r in reforms if r.id != package]
        chosen = [r.id for r in reforms]
    published = [*chosen, package] if package is not None else chosen
    levels = list(dict.fromkeys(parsed.levels))
    seat_reforms = []
    if CONSTITUENCY in levels:
        default = (
            published if package else [p for p in PACKAGES if p in chosen]
        )
        seat_reforms = parsed.seat_reforms or default
        if not seat_reforms or set(seat_reforms) - set(published):
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
        # The matrix carries no codes: its rows follow the lookup it was
        # built from, which the data release ships beside it.
        lookup = parsed.seat_lookup or seat_weights.parent / SEATS_FILE
        if not lookup.is_file():
            raise ValueError(
                f"No seat lookup at {lookup}: pass --seat-lookup with the "
                "constituencies_2024.csv the seat weights were built from"
            )
        shipped = pd.read_csv(lookup, dtype=str, keep_default_na=False)
        if list(shipped.get("code", [])) != list(seats["code"]):
            raise ValueError(
                f"The seat weights' lookup {lookup} does not list the seats "
                f"of {inputs / SEATS_FILE} in the same order"
            )
    prior = None
    if parsed.prior_regional is not None:
        prior = pd.read_csv(
            parsed.prior_regional, dtype=str, keep_default_na=False
        )
    years = sorted(set(parsed.years))
    if package is not None:
        # Last: it builds household simulations to check the combination.
        reforms.append(build_package(package, reforms, years))
        packages[package] = tuple(chosen)
    return _Plan(
        reforms=reforms,
        years=years,
        packages=packages,
        seat_reforms=list(seat_reforms),
        levels=levels,
        regions=regions,
        seats=seats,
        seat_regions=seat_regions,
        seat_weights=seat_weights,
        prior_regional=prior,
        microcosm_export=microcosm_export,
        compare_with=parsed.compare_with,
        microcosm_file_role=microcosm_file_role,
    )


def uses_current_law(reform: Reform, years) -> bool:
    """Whether a reform is measured against current law."""
    return reform.baseline_scenario_for(DataConfig(years=list(years))) is None


def simulate_reform(
    reform: Reform, dataset: Optional[str], years, *, current_law=None
) -> tuple:
    """A reform's baseline and reformed microsimulations.

    A reform measured against current law takes ``current_law`` as its
    baseline when given one, so a single simulation serves every such
    reform and the engine computes each year's baseline once.
    """
    if current_law is not None and uses_current_law(reform, years):
        baseline = current_law
    else:
        config = DataConfig(years=list(years))
        baseline = build_microsimulation(
            dataset, reform.baseline_scenario_for(config)
        )
    reformed = build_microsimulation(dataset, reform.to_scenario())
    return baseline, reformed


def build_package(name: str, measures: Sequence[Reform], years) -> Reform:
    """The measures as one reform named ``name``, simulated whole.

    A reform registered under ``name`` is the package, so the tables by area
    show the same package as the national tables; otherwise it is built the
    way ``generate --combined`` builds a combined run. Either way it is
    checked to change exactly what its measures change before anything is
    simulated.

    Raises:
        ValueError: If the name is not a package id or the package is not
            exactly its measures.
    """
    from uk_budget_data.publication import combine

    if not name.endswith(PACKAGE_SUFFIX):
        raise ValueError(
            f"--package {name} must end in {PACKAGE_SUFFIX}, the suffix the "
            "page reads as the full package"
        )
    ordered = combine.member_order(list(measures))
    if len(ordered) < 2:
        raise ValueError("--package needs at least two measures")
    config = DataConfig(years=list(years))
    package = get_reform(name)
    if package is None:
        package = combine.combine_measures(ordered, config).model_copy(
            update={"id": name}
        )
    combine.check_consistency(package, ordered, config, list(config.years))
    return package


def run_geography(parsed: argparse.Namespace) -> int:
    """Run the ``geography`` command. Prints labels only."""
    run_id = parsed.run_id or datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    if not RUN_ID.fullmatch(run_id):
        console.print(
            "[red]Error: --run-id takes letters, digits, '.', '_' and '-' "
            "only[/red]"
        )
        return 1
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

    try:
        start = time.perf_counter()
        collector = None
        # One current-law baseline serves every reform measured against it.
        current_law = None
        for reform in plan.reforms:
            console.print(f"Simulating {reform.id}")
            baseline, reformed = simulate_reform(
                reform, dataset, plan.years, current_law=current_law
            )
            if current_law is None and uses_current_law(reform, plan.years):
                current_law = baseline
            if collector is None:
                collector = GeographyCollector.from_simulation(
                    baseline,
                    kind=parsed.dataset_kind,
                    regions=plan.regions,
                    seat_regions=plan.seat_regions,
                    seat_weights=plan.seat_weights,
                    microcosm_export=plan.microcosm_export,
                    file_role=plan.microcosm_file_role,
                )
            for year in plan.years:
                collector.collect(reform.id, year, baseline, reformed)
            del baseline, reformed
        simulate_s = time.perf_counter() - start

        console.print("Estimating and checking")
        geo = build_release(
            collector,
            levels=plan.levels,
            seat_reforms=plan.seat_reforms,
            packages=plan.packages,
            prior_regional=plan.prior_regional,
        )
        geo.timings["simulate_s"] = simulate_s
        for year, base in sorted(collector.seat_weight_years.items()):
            if base != year:
                console.print(
                    f"Seat weights for {year}: {base}'s, rescaled to "
                    f"{year}'s household weights"
                )
        log = resolve(geo)
        audit = write_private_audit(
            geo, log, run_id=run_id, release_name=release_name
        )
        if plan.compare_with is not None:
            report = pair_consistency(
                plan.compare_with / AUDIT_FILE, audit / AUDIT_FILE
            )
            save_private_csv(report, audit / PAIR_REPORT_FILE)
            console.print(pair_summary(report))
        for reform, year in log.demotions:
            console.print(
                f"[yellow]Demoted: constituency {reform} {year} is not "
                "published (no legal fix)[/yellow]"
            )
        if log.demotions and not parsed.allow_demotions:
            console.print(
                f"[red]Error: {len(log.demotions)} constituency run(s) "
                "demoted; no tables written. Pass --allow-demotions to "
                "publish the rest.[/red]"
            )
            console.print(f"Private audit: {audit} (${AUDIT_DIR_ENV})")
            return 1
        names = area_names(plan.regions, plan.seats)
        written = write_public_tables(
            geo.release, parsed.out_dir, names, levels=geo.published_levels
        )
    except (
        GeographyError,
        KeyError,
        PrivateOutputError,
        TypeError,
        ValueError,
    ) as error:
        console.print(f"[red]Error: {error}[/red]")
        return 1
    for path in written.values():
        console.print(f"[green]Wrote {path}[/green]")
    console.print(f"Private audit: {audit} (${AUDIT_DIR_ENV})")
    return 0
