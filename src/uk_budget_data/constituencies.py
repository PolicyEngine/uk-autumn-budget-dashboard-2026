"""Results by constituency on Microcosm's local-area cut, one measure per
process (#115).

``uk-budget-data constituencies`` is ``geography``'s seats pass
(``--dataset-kind microcosm --levels constituency``, every chosen reform
published by constituency) on a published local-area cut, run so that it
fits a 64 GB laptop and can be timed:

1. **The cut.** The latest tag of the local-area release in
   policyengine/populace-uk-private
   (``microcosm-uk-2024-25-dense-<YYYYMMDDTHHMMSSZ>-<8 hex digits>``; the
   release is published as tags only), or ``--cut``. The cut's release
   manifest names its file, with a SHA-256 that the file's Hugging Face
   metadata and the downloaded bytes must match, and the model it was built
   for, which must be the installed one. The latest cut must also be the
   one the installed bundle routes constituencies to; another runs only
   when ``--cut`` names it.
2. **The plan**, by ``geography``'s own checks (``geography._plan``),
   before anything is simulated: approved ids only, from the publication
   manifest; a Microcosm export; the seat lookup; a published regional
   table, if there is one, as a prior. The package runs when the manifest
   approves it. Each reform's baseline and reform identities must be its
   approved receipt's (``geography.area_provenance``), as for a
   ``geography`` run, and a regional table already in ``--out-dir`` must
   be the one its own run recorded (``carried_provenance``).
3. **A fresh process for each measure**, and for the package: its two
   simulations, each year's household net income and weights read under
   the data-limit watch, then the data-limit and model-limit checks, as
   ``geography`` runs each measure. What it read goes to the private run
   directory. So the process's memory goes back to the machine when it
   ends, and a run that stops resumes with the measures still to do.
4. **One disclosure release over every measure**, in a fresh process too,
   once each has passed: estimated, resolved and written as ``geography``
   writes it, ``constituency.csv`` through ``policyengine.disclosure``
   (``validate_public``), the layer's audit to
   ``$UK_BUDGET_DISCLOSURE_AUDIT_DIR``. Then ``area_provenance.json``,
   which ``publish index`` needs before it binds the table: what each
   reform in it was made from, and the SHA-256 of ``constituency.csv`` and
   of a regional table beside it, whose reforms are recorded as its own
   run recorded them.
5. **A table of time and memory**: seconds by measure, year and step, each
   process's peak memory footprint and maximum resident size
   (``/usr/bin/time -l``), and swap before and after.

A measure a data or model limit refuses is reported with its reason and no
table is written, as ``geography`` does: leave it, and the package, out of
``--reforms``, and the next run reuses every measure already simulated.
``--dry-run`` stops after the plan.

Nothing here prints a value, a count or a support figure from the data:
only labels, hashes, times and memory.
"""

import argparse
import contextlib
import csv
import hashlib
import io
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from packaging.specifiers import InvalidSpecifier, SpecifierSet
from policyengine.disclosure import validate_public
from rich.console import Console
from rich.markup import escape

from uk_budget_data import area_routing, data_limits, geography
from uk_budget_data.certified_data import TOKEN_ENV, load_bundle_manifest
from uk_budget_data.private_outputs import (
    AUDIT_DIR_ENV,
    PrivateOutputError,
    private_directory,
)
from uk_budget_data.publication import manifest as publication_manifest
from uk_budget_data.publication import receipt as publication_receipt
from uk_budget_data.publication import release_index
from uk_budget_data.reforms import DEFAULT_YEARS
from uk_budget_data.runtime_identity import PACKAGES, installed_version

# Lines are never wrapped: paths and commands are printed to be copied.
console = Console(soft_wrap=True)

MODULE = "uk_budget_data.constituencies"
REPOSITORY = "policyengine/populace-uk-private"
REPOSITORY_TYPE = "dataset"
RELEASE_ID = "microcosm-uk-2024-25-dense"
# A cut's tag: the release, when the cut was made (UTC) and 8 hex digits.
CUT_TAG = re.compile(
    rf"^{re.escape(RELEASE_ID)}-(?P<at>\d{{8}}T\d{{6}}Z)-(?P<id>[0-9a-f]{{8}})$"
)
RELEASE_MANIFEST = f"releases/{RELEASE_ID}/release_manifest.json"
MICRODATA = "microdata"
MODEL_PACKAGE = "policyengine-uk"
SHA256 = re.compile(r"[0-9a-f]{64}")
# Each process opens the cut's file itself, and HDF5's file locks can make
# opening a file another process holds fail ("unable to lock file"), so
# every process here reads it with locking off.
HDF5_ENV = {"HDF5_USE_FILE_LOCKING": "FALSE"}
DEFAULT_MANIFEST = publication_manifest.manifest_path()
DEFAULT_OUT_DIR = publication_manifest.DATA_ROOT
DEFAULT_PRIOR = DEFAULT_OUT_DIR / geography.TABLE_FILES[geography.REGION]
TABLE = geography.TABLE_FILES[geography.CONSTITUENCY]
RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
TIME = Path("/usr/bin/time")
GB = 1024**3

# What a measure's process found.
SIMULATED = "simulated"
REFUSED = "refused"
FAILED = "failed"
REUSED = "reused"


class ConstituencyRunError(RuntimeError):
    """The run cannot go ahead. Messages carry labels only."""


# -- the cut -----------------------------------------------------------------


@dataclass(frozen=True)
class Cut:
    """A published local-area cut, as its release manifest names it."""

    tag: str
    path: str
    sha256: str
    built_with: Optional[str]
    # Whether the installed bundle routes constituencies to this cut.
    pinned: bool

    @property
    def short(self) -> str:
        """The tag's 8 hex digits."""
        return CUT_TAG.match(self.tag)["id"]


def cut_tags(api, token: str) -> list[str]:
    """The local-area release's tags, oldest first."""
    refs = api.list_repo_refs(
        REPOSITORY, repo_type=REPOSITORY_TYPE, token=token
    )
    tags = [ref.name for ref in refs.tags if CUT_TAG.match(ref.name)]
    return sorted(tags, key=lambda tag: (CUT_TAG.match(tag)["at"], tag))


def bundle_pin() -> Optional[dict]:
    """The dataset the installed bundle routes constituencies to: its name,
    repository, path, revision and SHA-256, or None if it routes none."""
    release = load_bundle_manifest()["data_releases"]["uk"]
    routed = (release.get("region_datasets") or {}).get(
        geography.CONSTITUENCY
    ) or {}
    template = routed.get("path_template")
    for name, entry in sorted((release.get("datasets") or {}).items()):
        if template and entry.get("path") == template:
            return {"dataset": name, **entry}
    return None


def _release_manifest(api, tag: str, token: str) -> dict:
    """The cut's release manifest, read at its tag."""
    with tempfile.TemporaryDirectory() as directory:
        path = api.hf_hub_download(
            repo_id=REPOSITORY,
            filename=RELEASE_MANIFEST,
            revision=tag,
            repo_type=REPOSITORY_TYPE,
            token=token,
            local_dir=directory,
        )
        return json.loads(Path(path).read_text(encoding="utf-8"))


def _incompatible(manifest: dict) -> list[str]:
    """What the cut was built for that is not installed: each compatible
    model and core package the installed version does not satisfy, and a
    model it does not name."""
    entries = [
        entry if isinstance(entry, dict) else {}
        for field_name in (
            "compatible_model_packages",
            "compatible_core_packages",
        )
        for entry in manifest.get(field_name) or []
    ]
    found = []
    if not any(entry.get("name") == MODEL_PACKAGE for entry in entries):
        found.append(f"no {MODEL_PACKAGE} version")
    for entry in entries:
        name, specifier = entry.get("name"), entry.get("specifier", "")
        installed = installed_version(name) if name else None
        try:
            fits = installed is not None and SpecifierSet(specifier).contains(
                installed
            )
        except InvalidSpecifier:
            fits = False
        if not fits:
            found.append(
                f"{name}{specifier} (installed: {installed or 'none'})"
            )
    return found


def resolve_cut(tag: Optional[str], *, api, token: str) -> Cut:
    """The cut to run: ``tag``, or the latest one published.

    Raises:
        ConstituencyRunError: If there is no such cut, its release manifest
            does not name one microdata file at this tag, the file's
            Hugging Face metadata carries another SHA-256, the installed
            model is not the one it was built for, or, with no ``tag``, the
            latest cut is not the one the installed bundle pins.
    """
    from huggingface_hub.errors import HfHubHTTPError

    try:
        tags = cut_tags(api, token)
    except HfHubHTTPError as error:
        raise ConstituencyRunError(
            f"Could not list the tags of {REPOSITORY}: "
            f"{str(error).splitlines()[0]}"
        ) from error
    if not tags:
        raise ConstituencyRunError(
            f"{REPOSITORY} has no tag of the local-area release {RELEASE_ID}"
        )
    explicit = tag is not None
    if tag is None:
        tag = tags[-1]
    elif not CUT_TAG.match(tag):
        raise ConstituencyRunError(
            f"--cut {tag} is not a cut of {RELEASE_ID}: expected "
            f"{RELEASE_ID}-<YYYYMMDDTHHMMSSZ>-<8 hex digits>"
        )
    elif tag not in tags:
        raise ConstituencyRunError(f"{REPOSITORY} has no tag {tag}")
    try:
        manifest = _release_manifest(api, tag, token)
    except (HfHubHTTPError, OSError, ValueError) as error:
        raise ConstituencyRunError(
            f"Could not read {RELEASE_MANIFEST} at {tag}: "
            f"{str(error).splitlines()[0]}"
        ) from error
    build = manifest.get("build") or {}
    artifacts = [
        artifact
        for artifact in (manifest.get("artifacts") or {}).values()
        if isinstance(artifact, dict) and artifact.get("kind") == MICRODATA
    ]
    if len(artifacts) != 1:
        raise ConstituencyRunError(
            f"The release manifest at {tag} names {len(artifacts)} "
            "microdata files, not one"
        )
    (artifact,) = artifacts
    if build.get("cut_tag") != tag or artifact.get("revision") != tag:
        raise ConstituencyRunError(
            f"The release manifest at {tag} describes another cut"
        )
    if (artifact.get("repo_id") or REPOSITORY) != REPOSITORY:
        raise ConstituencyRunError(
            f"The release manifest at {tag} puts its file in another "
            "repository"
        )
    sha256, path = str(artifact.get("sha256")), artifact.get("path")
    if not path or not SHA256.fullmatch(sha256):
        raise ConstituencyRunError(
            f"The release manifest at {tag} gives its file no path or "
            "SHA-256"
        )
    try:
        infos = api.get_paths_info(
            REPOSITORY,
            [path],
            revision=tag,
            repo_type=REPOSITORY_TYPE,
            token=token,
        )
    except HfHubHTTPError as error:
        raise ConstituencyRunError(
            f"Could not read the metadata of {path} at {tag}: "
            f"{str(error).splitlines()[0]}"
        ) from error
    remote = next(
        (
            getattr(getattr(info, "lfs", None), "sha256", None)
            for info in infos
            if info.path == path
        ),
        None,
    )
    if remote != sha256:
        raise ConstituencyRunError(
            f"{path} at {tag} has SHA-256 {remote} on Hugging Face, but its "
            f"release manifest records {sha256}"
        )
    problems = _incompatible(manifest)
    pin = bundle_pin()
    if problems:
        # A newer cut published for the next pair stops a run on the
        # installed one: name the cut the installed bundle routes to.
        hint = (
            f" Pass --cut {pin['revision']}, the cut the installed bundle "
            "routes constituencies to."
            if not explicit and pin and pin.get("revision") != tag
            else ""
        )
        raise ConstituencyRunError(
            f"The cut {tag} was built for {'; '.join(problems)}. Run it on "
            f"the bundle that pairs them.{hint}"
        )
    pinned = (
        pin is not None
        and pin.get("revision") == tag
        and pin.get("sha256") == sha256
    )
    if not pinned and not explicit:
        pinned_tag = (pin or {}).get("revision") or "none"
        raise ConstituencyRunError(
            f"The latest local-area cut, {tag}, is not the one the installed "
            f"bundle routes constituencies to ({pinned_tag}). Pass --cut "
            f"{pinned_tag} to run that one, or --cut {tag} to run the newer "
            "one."
        )
    return Cut(
        tag=tag,
        path=path,
        sha256=sha256,
        built_with=(build.get("built_with_model_package") or {}).get(
            "version"
        ),
        pinned=pinned,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_cut(
    cut: Cut, *, api, token: str, dataset: Optional[Path] = None
) -> Path:
    """The cut's file on this machine, checked against its SHA-256: the
    ``dataset`` given, or a download into the Hugging Face cache (reused if
    it is there already)."""
    if dataset is None:
        console.print(
            f"Fetching {cut.path} at {cut.tag} (the Hugging Face cache keeps "
            "it for the next run)"
        )
        dataset = Path(
            api.hf_hub_download(
                repo_id=REPOSITORY,
                filename=cut.path,
                revision=cut.tag,
                repo_type=REPOSITORY_TYPE,
                token=token,
            )
        )
    dataset = dataset.expanduser()
    if not dataset.is_file():
        raise ConstituencyRunError(f"No file at {dataset}")
    found = sha256_file(dataset)
    if found != cut.sha256:
        raise ConstituencyRunError(
            f"{dataset} has SHA-256 {found}, not the cut's {cut.sha256}"
        )
    return dataset


# -- the plan ----------------------------------------------------------------


@dataclass
class RunPlan:
    """A run, checked by geography's own planning before any simulation."""

    cut: Cut
    dataset: Path
    run_id: str
    ids: list[str]
    years: list[int]
    packages: dict[str, tuple[str, ...]]
    prior_regional: Optional[Path]
    manifest: Path
    out_dir: Path
    data_inputs_dir: Path
    allow_demotions: bool
    argv: list[str]
    # geography.area_provenance's, for area_provenance.json, which the
    # laptop writes after the table (report_tables), on either backend
    provenance: dict
    # The other area tables in out_dir, whose records it carries
    carried: list[str]


def default_reforms(manifest: Path) -> list[str]:
    """The manifest's approved measures, in its order, then each package
    whose combined run it approves with exactly that package's members
    (``geography.approved_reforms``'s defaults, as ``geography`` takes them).

    The defaults follow the manifest, not ``geography.PACKAGES``: on Budget
    day the approved measures are the announced ones, not the candidates a
    package lists, and asking for an unapproved candidate refused the whole
    run.
    """
    return geography.approved_reforms(_parsed_manifest(manifest))


def _parsed_manifest(path: Path) -> publication_manifest.Manifest:
    if not path.is_file():
        raise ConstituencyRunError(
            f"No publication manifest at {path}: there is nothing the "
            "national page may publish yet."
        )
    return publication_manifest.parse_manifest(path.read_bytes(), str(path))


def _in_repository(path: Path) -> bool:
    path = Path(path).expanduser().resolve()
    return any((folder / ".git").exists() for folder in (path, *path.parents))


def geography_argv(
    *,
    dataset: Path,
    ids: list[str],
    years: list[int],
    manifest: Path,
    out_dir: Path,
    data_inputs_dir: Path,
    prior_regional: Optional[Path],
    allow_demotions: bool,
) -> list[str]:
    """The ``geography`` command a run stands for: the seats pass on the
    local file, every chosen reform published by constituency."""
    argv = [
        "geography",
        "--dataset",
        str(dataset),
        "--dataset-kind",
        geography.MICROCOSM,
        "--levels",
        geography.CONSTITUENCY,
        "--reforms",
        *ids,
        "--seat-reforms",
        *ids,
        "--years",
        *(str(year) for year in years),
        "--manifest",
        str(manifest),
        "--out-dir",
        str(out_dir),
        "--data-inputs-dir",
        str(data_inputs_dir),
    ]
    if prior_regional is not None:
        argv += ["--prior-regional", str(prior_regional)]
    if allow_demotions:
        argv.append("--allow-demotions")
    return argv


def _geography_namespace(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="uk-budget-data")
    geography.add_geography_parser(parser.add_subparsers(dest="command"))
    return parser.parse_args(argv)


def check_gates(parsed: argparse.Namespace) -> list[str]:
    """The reforms to run, once the publication manifest approves them all,
    before anything is downloaded. Tables made under any manifest but the
    publication one may not go into a repository."""
    scratch = Path(parsed.manifest).resolve() != DEFAULT_MANIFEST.resolve()
    if scratch and _in_repository(parsed.out_dir):
        raise ConstituencyRunError(
            f"--manifest {parsed.manifest} is not the publication manifest "
            f"({DEFAULT_MANIFEST}), so its tables may not go into a "
            "repository: pass an --out-dir outside any git repository."
        )
    ids = (
        list(dict.fromkeys(parsed.reforms))
        if parsed.reforms is not None
        else default_reforms(parsed.manifest)
    )
    geography.approved_reforms(_parsed_manifest(parsed.manifest), ids)
    return ids


def plan_run(
    parsed: argparse.Namespace, ids: list[str], cut: Cut, dataset: Path
) -> RunPlan:
    """Check the run as ``geography`` checks it, and a published regional
    table against it, before any simulation."""
    prior = parsed.prior_regional
    if prior is None and DEFAULT_PRIOR.is_file():
        prior = DEFAULT_PRIOR
    years = sorted(set(parsed.years))
    argv = geography_argv(
        dataset=dataset,
        ids=ids,
        years=years,
        manifest=parsed.manifest,
        out_dir=parsed.out_dir,
        data_inputs_dir=parsed.data_inputs_dir,
        prior_regional=prior,
        allow_demotions=parsed.allow_demotions,
    )
    plan = geography._plan(_geography_namespace(argv))
    chosen = [reform.id for reform in plan.reforms]
    if plan.prior_regional is not None:
        # build_release checks this too, but only once every measure is
        # simulated.
        runs = {
            (level, reform, year)
            for level in geography._LEVELS
            for reform in chosen
            for year in plan.years
        }
        geography._check_prior_matches(
            geography.regional_prior(plan.prior_regional),
            dict.fromkeys(runs),
            areas=False,
        )
    # As a geography run does before simulating: each reform's identities
    # are its approved receipt's.
    provenance = geography.area_provenance(
        plan.manifest,
        plan.manifest_bytes,
        chosen,
        data_root=Path(parsed.manifest).parent,
        years=plan.years,
    )
    # The release checks this again before it writes; here it stops a run
    # whose table publish index would refuse, before hours of simulation.
    _, carried = carried_provenance(Path(parsed.out_dir), provenance)
    run_id = parsed.run_id or f"constituencies-{cut.short}"
    if not RUN_ID.fullmatch(run_id):
        raise ConstituencyRunError(
            f"--run-id {run_id!r} must be a plain name (letters, digits, "
            "dots, dashes and underscores)"
        )
    return RunPlan(
        cut=cut,
        dataset=dataset,
        run_id=run_id,
        ids=chosen,
        years=list(plan.years),
        packages=dict(plan.packages),
        prior_regional=Path(prior) if prior is not None else None,
        manifest=Path(parsed.manifest),
        out_dir=Path(parsed.out_dir),
        data_inputs_dir=Path(parsed.data_inputs_dir),
        allow_demotions=parsed.allow_demotions,
        argv=argv,
        provenance=provenance,
        carried=[path.name for path in carried],
    )


def carried_provenance(
    out_dir: Path, provenance: dict
) -> tuple[dict, list[Path]]:
    """What ``area_provenance.json`` records once this run's table is in
    ``out_dir``, and the other area tables there that it records too.

    ``publish index`` binds the area tables only when that file records the
    SHA-256 of every one present and every reform they carry, and refuses
    them otherwise ("rerun the area run"). ``geography`` records only the
    tables it writes, so a seats run beside a published ``regional.csv``
    records both: this run's reforms, and the regional table's as its own
    run recorded them. That record is taken only while the file records
    the table's bytes as they are, and only where this run binds each
    reform in both tables to the same approved entry. Otherwise the
    regional table was made for something else, and its run comes first.
    Raises ConstituencyRunError, with labels only.
    """
    out_dir = Path(out_dir)
    others = [
        out_dir / name
        for name in release_index.AREA_FILES
        if name != TABLE and (out_dir / name).is_file()
    ]
    if not others:
        return provenance, []
    again = "run its area run again first, or pass an --out-dir without it"
    record_file = release_index.AREA_PROVENANCE_FILE
    try:
        document = json.loads((out_dir / record_file).read_bytes())
    except (OSError, ValueError):
        document = None
    if release_index.area_provenance_document_problems(document):
        raise ConstituencyRunError(
            f"{others[0].name} is in {out_dir} with no readable "
            f"{record_file}: {again}"
        )
    reforms = dict(provenance["reforms"])
    for path in others:
        content = path.read_bytes()
        if (
            document["files"].get(path.name)
            != hashlib.sha256(content).hexdigest()
        ):
            raise ConstituencyRunError(
                f"{record_file} in {out_dir} does not record {path.name} "
                f"as it is: {again}"
            )
        try:
            used = release_index._reform_ids(content)
        except (UnicodeError, ValueError, csv.Error) as error:
            raise ConstituencyRunError(
                f"{path.name} in {out_dir} is not a readable CSV with a "
                "reform column"
            ) from error
        for reform_id in sorted(used):
            record = document["reforms"].get(reform_id)
            if record is None:
                raise ConstituencyRunError(
                    f"{path.name}: {reform_id} is not recorded by its area "
                    f"run: {again}"
                )
            if reforms.setdefault(reform_id, record) != record:
                raise ConstituencyRunError(
                    f"{path.name} was made for an approval of {reform_id} "
                    f"other than the one this run binds: {again}"
                )
    return {**provenance, "reforms": reforms}, others


# -- what each measure's process keeps ---------------------------------------


def code_digest(data_inputs_dir: Path) -> str:
    """What decides a measure's arrays, besides the cut: this package's code
    and data files, the lockfile, and the region and seat lookups."""
    package = Path(__file__).resolve().parent
    named = [
        (path.relative_to(package).as_posix(), path)
        for path in sorted(package.rglob("*"))
        if path.is_file() and path.suffix in (".py", ".json")
    ]
    lock = package.parents[1] / "uv.lock"
    if lock.is_file():
        named.append(("uv.lock", lock))
    for name in (geography.REGIONS_FILE, geography.SEATS_FILE):
        named.append((f"data_inputs/{name}", Path(data_inputs_dir) / name))
    digest = hashlib.sha256()
    for name, path in named:
        digest.update(f"{name}\0{sha256_file(path)}\n".encode())
    return digest.hexdigest()


def _key(**fields) -> str:
    fields["packages"] = {name: installed_version(name) for name in PACKAGES}
    text = json.dumps(fields, sort_keys=True, default=str)
    return hashlib.sha256(text.encode()).hexdigest()


@dataclass
class Unit:
    """One measure's process: its spec, and the files it leaves."""

    reform: str
    key: str
    spec: Path
    result: Path
    arrays: Path
    # The result of an earlier run with the same key, reused.
    cached: Optional[dict] = None


def _reusable(unit: Unit) -> Optional[dict]:
    try:
        record = json.loads(unit.result.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if record.get("key") != unit.key:
        return None
    if record.get("status") == SIMULATED and unit.arrays.is_file():
        return record
    return record if record.get("status") == REFUSED else None


def plan_units(
    run: RunPlan, directory: Path, *, fresh: bool
) -> tuple[list[Unit], dict]:
    """Each reform's unit, with what an earlier run left that can be reused,
    and the spec of the dataset's own arrays (survey households, regions and
    seats), which every unit records or checks."""
    units_dir = private_directory(directory, subdirectory="units")
    code = code_digest(run.data_inputs_dir)
    dataset = {
        "arrays": str(directory / "dataset.npz"),
        "key": _key(cut=run.cut.sha256, code=code),
        "record": str(directory / "dataset.json"),
    }
    try:
        recorded = json.loads(Path(dataset["record"]).read_text("utf-8"))
    except (OSError, ValueError):
        recorded = {}
    # Arrays from another cut or code version: every unit runs again.
    stale = fresh or recorded.get("key") != dataset["key"]
    units = []
    for reform in run.ids:
        unit = Unit(
            reform=reform,
            key=_key(
                reform=reform, years=run.years, cut=run.cut.sha256, code=code
            ),
            spec=units_dir / f"{reform}.spec.json",
            result=units_dir / f"{reform}.json",
            arrays=units_dir / f"{reform}.npz",
        )
        if not stale:
            unit.cached = _reusable(unit)
        units.append(unit)
    return units, dataset


def _write_private(path: Path, write) -> None:
    """Write a file only its owner can read, replacing ``path`` only once it
    is complete."""
    descriptor, name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            write(handle)
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def _write_json(path: Path, value) -> None:
    text = json.dumps(value, indent=2, sort_keys=True) + "\n"
    _write_private(Path(path), lambda handle: handle.write(text.encode()))


def _savable(values: np.ndarray) -> np.ndarray:
    """An array np.load reads back without pickling."""
    values = np.asarray(values)
    return values if values.dtype.kind in "biuf" else values.astype(str)


def _record_dataset(collector, spec: dict) -> None:
    """Write the dataset's own arrays, or check them against those an
    earlier unit wrote for the same cut and code: every unit must run on the
    same households, in the same order."""
    arrays = {
        "source_ids": _savable(collector.source_ids),
        "region_codes": _savable(collector.region_codes),
        "seat_labels": _savable(collector.seat_labels),
    }
    path, record = Path(spec["arrays"]), Path(spec["record"])
    try:
        known = json.loads(record.read_text("utf-8")).get("key")
    except (OSError, ValueError):
        known = None
    if known == spec["key"] and path.is_file():
        with np.load(path, allow_pickle=False) as stored:
            if sorted(stored.files) != sorted(arrays) or not all(
                np.array_equal(stored[name], value)
                for name, value in arrays.items()
            ):
                raise ConstituencyRunError(
                    "This measure's survey households, regions or seats "
                    "differ from those an earlier measure recorded for the "
                    "same cut"
                )
        return
    _write_private(path, lambda handle: np.savez(handle, **arrays))
    _write_json(record, {"key": spec["key"]})


# -- one measure's process ---------------------------------------------------


def _read_year(reform_id: str, year: int, baseline, reformed) -> tuple:
    """One year's household net income in both runs, and the household
    weights, read as ``GeographyCollector.collect`` reads them."""
    weight = geography.household_values(baseline, "household_weight", year)
    other = geography.household_values(reformed, "household_weight", year)
    if not np.array_equal(weight, other):
        raise ValueError(
            f"household_weight differs between the runs of {reform_id} in "
            f"{year}"
        )
    return (
        geography.household_values(baseline, "household_net_income", year),
        geography.household_values(reformed, "household_net_income", year),
        weight,
    )


def simulate_unit(spec: dict) -> dict:
    """Simulate one measure as ``geography`` simulates each one, and keep
    what the release needs of it in the private run directory.

    Its two simulations are built under the data-limit build watch, and
    each year's figures are read under the run watch, then the data limits
    and model limits it touched are judged on those simulations. A measure
    that touches one keeps only its reasons; any other keeps each year's
    household net income in both runs and the household weights. The
    dataset's own arrays are read last, once the watch and the checks are
    done.
    """
    reform = geography.get_reform(spec["reform"])
    if reform is None:
        raise ConstituencyRunError(f"Unknown reform {spec['reform']}")
    years = [int(year) for year in spec["years"]]
    inputs = Path(spec["data_inputs_dir"])
    regions = geography.load_regions(inputs / geography.REGIONS_FILE)
    seat_regions = geography.seat_region_map(
        inputs / geography.SEATS_FILE, regions
    )
    timings: dict = {"calculate_s": {}}
    start = time.perf_counter()
    baseline, reformed = geography.simulate_reform(
        reform, spec["dataset"], years
    )
    timings["build_s"] = time.perf_counter() - start
    # With no limit registered, nothing is watched (as geography).
    watch = (
        data_limits.observing(baseline, reformed)
        if data_limits.DATA_LIMITS
        else contextlib.nullcontext()
    )
    runs = {}
    with watch as observed:
        for year in years:
            start = time.perf_counter()
            runs[year] = _read_year(reform.id, year, baseline, reformed)
            timings["calculate_s"][str(year)] = time.perf_counter() - start
    start = time.perf_counter()
    limited = (
        geography.reform_data_limits(
            reform, baseline, reformed, observed, years
        )
        if data_limits.DATA_LIMITS
        else []
    )
    held = geography.reform_model_limits(reform, baseline, reformed, years)
    timings["limits_s"] = time.perf_counter() - start
    collector = geography.GeographyCollector.from_simulation(
        baseline,
        kind=geography.MICROCOSM,
        regions=regions,
        seat_regions=seat_regions,
        microcosm_export=bool(spec["microcosm_export"]),
    )
    # The observation holds both simulations: free it with them.
    del baseline, reformed, observed
    timings["simulate_s"] = (
        timings["build_s"]
        + sum(timings["calculate_s"].values())
        + timings["limits_s"]
    )
    start = time.perf_counter()
    _record_dataset(collector, spec["dataset_arrays"])
    status = REFUSED if limited or held else SIMULATED
    if status == SIMULATED:
        arrays = {
            f"{name}_{year}": values
            for year, run in runs.items()
            for name, values in zip(("baseline", "reformed", "weight"), run)
        }
        _write_private(
            Path(spec["arrays"]), lambda handle: np.savez(handle, **arrays)
        )
    timings["save_s"] = time.perf_counter() - start
    result = {
        "reform": reform.id,
        "key": spec["key"],
        "status": status,
        "years": years,
        "limited": limited,
        "held": held,
        "timings": timings,
        "finished_at": _stamp(),
    }
    _write_json(Path(spec["result"]), result)
    return result


# -- the release -------------------------------------------------------------


def build_tables(spec: dict, *, settings=None) -> dict:
    """One release over every measure, from what their processes kept:
    estimated, resolved and written as ``geography`` writes a run, the
    layer's audit to the private directory and ``constituency.csv``
    through ``geography.write_public_tables``, which replaces it only once
    ``validate_public`` passes it. ``area_provenance.json`` is written by
    the caller's machine afterwards (``report_tables``), as on Modal."""
    inputs = Path(spec["data_inputs_dir"])
    regions = geography.load_regions(inputs / geography.REGIONS_FILE)
    seats = geography.load_seats(inputs / geography.SEATS_FILE)
    seat_regions = geography.seat_region_map(
        inputs / geography.SEATS_FILE, regions
    )
    with np.load(spec["dataset_arrays"], allow_pickle=False) as data:
        collector = geography.GeographyCollector(
            source_ids=data["source_ids"],
            region_codes=data["region_codes"].astype(object),
            national=False,
            seat_labels=data["seat_labels"].astype(object),
            seat_regions=seat_regions,
        )
    years = [int(year) for year in spec["years"]]
    for unit in spec["units"]:
        with np.load(unit["arrays"], allow_pickle=False) as arrays:
            for year in years:
                collector.add(
                    unit["reform"],
                    year,
                    baseline=arrays[f"baseline_{year}"],
                    reformed=arrays[f"reformed_{year}"],
                    weight=arrays[f"weight_{year}"],
                )
    prior = None
    if spec["prior_regional"]:
        prior = pd.read_csv(
            spec["prior_regional"], dtype=str, keep_default_na=False
        )
    run_timings: dict = {}
    geo = geography.build_release(
        collector,
        levels=[geography.CONSTITUENCY],
        seat_reforms=spec["seat_reforms"],
        packages={p: tuple(m) for p, m in spec["packages"].items()},
        prior_regional=prior,
        settings=settings,
        run_timings=run_timings,
    )
    geo.timings["simulate_s"] = spec["simulate_s"]
    log = geography.resolve(geo)
    audit = geography.write_private_audit(
        geo,
        log,
        run_id=spec["run_id"],
        release_name=spec["release_name"],
        certification_reason=geography.MICROCOSM_UNCERTIFIED,
    )
    result = {
        "status": "demoted",
        "audit": str(audit),
        "written": [],
        "estimate_s": geo.timings.get("estimate_s"),
        "resolve_s": geo.timings.get("resolve_s"),
        "run_estimate_s": {
            f"{reform}|{year}": seconds
            for (reform, year), seconds in sorted(run_timings.items())
        },
        "demotions": [list(run) for run in log.demotions],
    }
    for reform, year in log.demotions:
        console.print(
            f"[yellow]Demoted: constituency {reform} {year} is not "
            "published (no legal fix)[/yellow]"
        )
    if log.demotions and not spec["allow_demotions"]:
        console.print(
            f"[red]Error: {len(log.demotions)} constituency run(s) demoted; "
            "no table written. Pass --allow-demotions to publish the "
            "rest.[/red]"
        )
    else:
        written = geography.write_public_tables(
            geo.release,
            Path(spec["out_dir"]),
            geography.area_names(regions, seats),
            levels=geo.published_levels,
        )
        result["status"] = "written"
        result["written"] = [str(path) for path in written.values()]
    _write_json(Path(spec["result"]), result)
    return result


# -- processes, memory and swap ----------------------------------------------


@dataclass(frozen=True)
class Measured:
    """How a step's process ended and what it held, from /usr/bin/time."""

    returncode: int
    wall_s: float
    peak_footprint: Optional[int] = None
    max_rss: Optional[int] = None


# macOS's /usr/bin/time -l report begins with the real, user and sys times,
# GNU time -v's with the command; each gives the maximum resident size, and
# macOS the peak memory footprint, which counts compressed pages too.
_MAC_TIMES = re.compile(r"^\s*[\d.]+ real\s+[\d.]+ user\s+[\d.]+ sys\s*$")
_MAC_FIELD = re.compile(
    r"^\s*(\d+)\s+(maximum resident set size|peak memory footprint)\s*$"
)
_GNU_START = re.compile(r"^\s*Command being timed:")
_GNU_RSS = re.compile(r"^\s*Maximum resident set size \(kbytes\):\s*(\d+)")


def timed(command: list[str]) -> list[str]:
    """``command`` measured by /usr/bin/time, where the machine has it."""
    if not TIME.is_file():
        return list(command)
    flag = "-l" if platform.system() == "Darwin" else "-v"
    return [str(TIME), flag, *command]


def split_time_report(stderr: str) -> tuple[str, str]:
    """A step's standard error as (the time report, everything else)."""
    lines = stderr.splitlines(keepends=True)
    for index in range(len(lines) - 1, -1, -1):
        if _MAC_TIMES.match(lines[index]) or _GNU_START.match(lines[index]):
            return "".join(lines[index:]), "".join(lines[:index])
    return "", stderr


def time_report(report: str) -> dict:
    """The peak footprint and maximum resident size, in bytes, if given."""
    found = {"peak_footprint": None, "max_rss": None}
    for line in report.splitlines():
        if match := _MAC_FIELD.match(line):
            name = (
                "max_rss" if match[2].startswith("max") else "peak_footprint"
            )
            found[name] = int(match[1])
        elif match := _GNU_RSS.match(line):
            found["max_rss"] = int(match[1]) * 1024
    return found


def run_process(command: list[str], env: dict) -> tuple[int, str]:
    """Run a step; its output shows as it goes, its standard error after."""
    completed = subprocess.run(
        command, env=env, stderr=subprocess.PIPE, text=True, check=False
    )
    return completed.returncode, completed.stderr


def launch(command: list[str], env: dict) -> Measured:
    """Run a step in a fresh process, measured by /usr/bin/time."""
    start = time.perf_counter()
    returncode, stderr = run_process(timed(command), env)
    wall = time.perf_counter() - start
    report, rest = split_time_report(stderr or "")
    if rest.strip():
        sys.stderr.write(rest)
    return Measured(returncode=returncode, wall_s=wall, **time_report(report))


def swap_used() -> Optional[int]:
    """Swap in use, in bytes, or None where it cannot be read."""
    try:
        if platform.system() == "Darwin":
            out = subprocess.run(
                ["sysctl", "-n", "vm.swapusage"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            used = re.search(r"used = ([\d.]+)M", out)
            return int(float(used[1]) * 1024**2) if used else None
        if platform.system() == "Linux":
            values = {}
            with open("/proc/meminfo") as meminfo:
                for line in meminfo:
                    name, rest = line.split(":", 1)
                    values[name] = int(rest.split()[0]) * 1024
            return values["SwapTotal"] - values["SwapFree"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        return None
    return None


def physical_memory() -> Optional[int]:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (OSError, ValueError, AttributeError):
        return None


# -- the timing table --------------------------------------------------------


@dataclass
class Step:
    """One step's line in the timing table, and what its process recorded."""

    name: str
    status: str
    timings: dict = field(default_factory=dict)
    measured: Optional[Measured] = None
    swap: tuple = (None, None)
    record: dict = field(default_factory=dict)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _seconds(value) -> str:
    return "" if value is None else f"{value:,.1f}"


def _clock(seconds) -> str:
    if seconds is None:
        return ""
    minutes, rest = divmod(int(round(seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    return (
        f"{hours}:{minutes:02d}:{rest:02d}"
        if hours
        else f"{minutes}:{rest:02d}"
    )


def _gb(value) -> str:
    return "" if value is None else f"{value / GB:.1f}"


def _swap(pair) -> str:
    before, after = pair
    if before is None and after is None:
        return ""
    return f"{_gb(before) or '?'} → {_gb(after) or '?'}"


def _row(cells) -> str:
    return "| " + " | ".join(cells) + " |"


def _memory(measured: Optional[Measured]) -> list[str]:
    """A process's wall time, peak footprint and maximum resident size."""
    if measured is None:
        return ["", "", ""]
    return [
        _clock(measured.wall_s),
        _gb(measured.peak_footprint),
        _gb(measured.max_rss),
    ]


def render_timings(
    run: RunPlan,
    steps: list[Step],
    release: Optional[Step],
    *,
    started_at: str,
    total_s: float,
    swap: tuple,
) -> str:
    """The time and memory each step took, as Markdown: no figure from the
    data, so it can go in the pull request."""
    estimates = (release.timings if release else {}).get("run_estimate_s", {})
    per_run: dict = {}
    for name, seconds in estimates.items():
        reform, year = name.rsplit("|", 1)
        per_run.setdefault(reform, {})[year] = seconds
    versions = ", ".join(
        f"{name} {installed_version(name)}"
        for name in ("policyengine", MODEL_PACKAGE)
    )
    memory = physical_memory()
    lines = [
        "## Results by constituency: time and memory",
        "",
        f"- Cut `{run.cut.tag}`"
        + ("" if run.cut.pinned else " (not the installed bundle's pin)")
        + f"; {versions}.",
        f"- Years {', '.join(str(year) for year in run.years)}; one fresh "
        "process per measure, then one for the release; started "
        f"{started_at}.",
        f"- Machine: {platform.system()} {platform.machine()}"
        + (f", {memory / GB:.0f} GB" if memory else "")
        + ". Memory in GB of 1024³ bytes; peak footprint and maximum "
        "resident size from `/usr/bin/time -l`.",
        "- A reused measure shows the times of the run that simulated it.",
        "",
        _row(
            [
                "Step",
                "Status",
                "build_s",
                "calculate_s",
                "limits_s",
                "simulate_s",
                "estimate_s",
                "resolve_s",
                "Wall",
                "Peak footprint",
                "Max RSS",
                "Swap before → after",
            ]
        ),
        _row(["---"] * 12),
    ]
    for step in steps:
        timings = step.timings
        calculate = timings.get("calculate_s") or {}
        estimate = per_run.get(step.name)
        lines.append(
            _row(
                [
                    f"`{step.name}`",
                    step.status,
                    _seconds(timings.get("build_s")),
                    _seconds(sum(calculate.values()) if calculate else None),
                    _seconds(timings.get("limits_s")),
                    _seconds(timings.get("simulate_s")),
                    _seconds(sum(estimate.values()) if estimate else None),
                    "",
                    *_memory(step.measured),
                    _swap(step.swap),
                ]
            )
        )
    names = {step.name for step in steps}
    for reform, estimate in sorted(per_run.items()):
        if reform not in names:
            # A package's interaction: estimated in the release only.
            lines.append(
                _row(
                    [f"`{reform}`", "release only", *[""] * 4]
                    + [_seconds(sum(estimate.values()))]
                    + [""] * 5
                )
            )
    released = release.timings if release is not None else {}
    if release is not None:
        lines.append(
            _row(
                ["Release (all measures)", release.status, *[""] * 4]
                + [
                    _seconds(released.get("estimate_s")),
                    _seconds(released.get("resolve_s")),
                    *_memory(release.measured),
                    _swap(release.swap),
                ]
            )
        )
    simulated = sum(step.timings.get("simulate_s") or 0.0 for step in steps)
    lines.append(
        _row(
            ["Total", "", "", "", "", _seconds(simulated)]
            + [
                _seconds(released.get("estimate_s")),
                _seconds(released.get("resolve_s")),
                _clock(total_s),
                "",
                "",
                _swap(swap),
            ]
        )
    )
    lines += [
        "",
        "By year: calculate_s / estimate_s.",
        "",
        _row(["Step", *(str(year) for year in run.years)]),
        _row(["---"] * (len(run.years) + 1)),
    ]
    timings_of = {step.name: step.timings for step in steps}
    for name in [step.name for step in steps] + sorted(set(per_run) - names):
        calculate = (timings_of.get(name) or {}).get("calculate_s") or {}
        estimate = per_run.get(name) or {}
        lines.append(
            _row(
                [f"`{name}`"]
                + [
                    f"{_seconds(calculate.get(str(year))) or '–'} / "
                    f"{_seconds(estimate.get(str(year))) or '–'}"
                    for year in run.years
                ]
            )
        )
    return "\n".join(lines) + "\n"


# -- the command -------------------------------------------------------------


def add_constituencies_parser(subparsers) -> None:
    """The ``constituencies`` command (see this module's docstring)."""
    parser = subparsers.add_parser(
        "constituencies",
        help="Results by constituency on the published local-area cut, a "
        "fresh process per measure",
    )
    parser.add_argument(
        "--cut",
        default=None,
        help=f"A cut of {RELEASE_ID}, a tag of {REPOSITORY} "
        "(default: the latest)",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="A copy of the cut's file on this machine, checked against "
        "its SHA-256 (default: fetch it into the Hugging Face cache)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve and check the cut, check the gates and print the "
        "plan; simulate nothing",
    )
    parser.add_argument(
        "--reforms",
        nargs="+",
        default=None,
        help="Reform IDs (default: the package's measures, and the package "
        "when the publication manifest approves it)",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=list(DEFAULT_YEARS),
        help=(
            "Years (default: the policy years in budget_years.json, "
            f"{DEFAULT_YEARS[0]} to {DEFAULT_YEARS[-1]})"
        ),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Publication manifest (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Where {TABLE} goes (default: {DEFAULT_OUT_DIR})",
    )
    parser.add_argument(
        "--prior-regional",
        type=Path,
        default=None,
        help="An already published regional table, whose cells are known "
        f"(default: {DEFAULT_PRIOR}, if there is one)",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="The private run directory, under "
        f"${AUDIT_DIR_ENV}/geography (default: constituencies-<the cut's "
        "8 hex digits>). Measures it holds for the same cut, years and "
        "code are reused.",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Simulate every measure again, reusing none (for timing)",
    )
    parser.add_argument(
        "--allow-demotions",
        action="store_true",
        help=(
            "Write the table even when some constituency runs had to be "
            "demoted to unpublished; without it such a run stops with an "
            "error after the private audit"
        ),
    )
    parser.add_argument(
        "--backend",
        choices=("local", "modal"),
        default="local",
        help="Where the measures run: here, a fresh process each (local), "
        "or on Modal, a container each and the release in one more "
        "(modal; needs `uv run --with modal==1.6.2` and the Modal secret, "
        "see uk_budget_data.modal_constituencies)",
    )
    parser.add_argument(
        "--data-inputs-dir",
        type=Path,
        default=Path("./data_inputs"),
        help="Directory with the region and seat lookups "
        "(default: ./data_inputs)",
    )


def run_constituencies(parsed: argparse.Namespace, *, api=None) -> int:
    """Run the ``constituencies`` command. ``api`` is a
    ``huggingface_hub.HfApi`` stand-in, for tests. Prints labels, hashes,
    times and memory only."""
    console.print(geography.MICROCOSM_UNCERTIFIED)
    try:
        return _run(parsed, api=api)
    except (
        ConstituencyRunError,
        PrivateOutputError,
        geography.GeographyError,
        geography.publication_receipt.ReceiptUnavailable,
        KeyError,
        OSError,
        ValueError,
        publication_receipt.ReceiptUnavailable,
    ) as error:
        console.print(f"[red]Error: {escape(str(error))}[/red]")
        return 1
    finally:
        console.print(geography.MICROCOSM_UNCERTIFIED)


def _print_plan(run: RunPlan, units: list[Unit], directory: Path) -> None:
    cut = run.cut
    console.print(f"Local-area cut: {cut.tag}")
    console.print(
        f"  {cut.path}, SHA-256 {cut.sha256}: its release manifest, its "
        "Hugging Face metadata and the file agree"
    )
    console.print(
        f"  built with {MODEL_PACKAGE} {cut.built_with or 'unknown'}; "
        f"installed {installed_version(MODEL_PACKAGE)}"
    )
    if cut.pinned:
        console.print(
            "  the cut the installed bundle routes constituencies to"
        )
    else:
        console.print(
            "[yellow]  Not the cut the installed bundle routes "
            "constituencies to: run because --cut names it.[/yellow]"
        )
    console.print(f"  file: {escape(str(run.dataset))}")
    packages = [r for r in run.ids if r in run.packages]
    console.print(
        "Measures: "
        + ", ".join(r for r in run.ids if r not in run.packages)
        + (f"; package: {', '.join(packages)}" if packages else "; no package")
    )
    console.print(
        f"Years: {', '.join(str(year) for year in run.years)}. Every "
        "measure is published by constituency; regions and the UK are "
        "references."
    )
    console.print(
        "Prior regional table: "
        + (escape(str(run.prior_regional)) if run.prior_regional else "none")
    )
    reused = [unit.reform for unit in units if unit.cached is not None]
    console.print(
        "Already simulated, reused: " + (", ".join(reused) or "none")
    )
    console.print(f"Private run directory: {escape(str(directory))}")
    console.print(
        "Approved receipts: each reform's current definition is the one its "
        f"manifest entry approved ({len(run.provenance.get('reforms', {}))} "
        "checked)"
    )
    console.print(f"Table: {escape(str(run.out_dir / TABLE))}")
    console.print(
        "Area provenance: "
        + escape(str(run.out_dir / release_index.AREA_PROVENANCE_FILE))
        + f", for {TABLE}"
        + "".join(
            f" and {name} (its record carried from its own run)"
            for name in run.carried
        )
        + "; every reform's baseline and reform match its approved receipt"
    )
    console.print(
        "As: uk-budget-data " + escape(" ".join(run.argv)) + ", with each "
        "measure simulated in a process of its own"
    )


def _refusal_lines(steps: list[Step]) -> list[str]:
    """What each refused reform touched, as ``geography`` reports it."""
    lines = []
    for step in steps:
        for key, label in (
            ("limited", "Not computable on current data"),
            ("held", "Mis-costed by this model"),
        ):
            touched = step.record.get(key) or []
            if touched:
                reasons = " ".join(item["reason"] for item in touched)
                lines.append(f"{label}: {step.name}: {reasons}")
    return lines


def _review_row(table: Path, run: RunPlan, release_name: str) -> Optional[str]:
    """The review row a reviewer adds once they have reviewed the table, as
    CSV, if the table is in a repository's public directory."""
    path = table.resolve()
    root = next(
        (
            folder
            for folder in path.parents
            if (folder / ".git").exists() and (folder / "public").is_dir()
        ),
        None,
    )
    if root is None:
        return None
    basis = (
        "Change in household net income by Westminster constituency (2024 "
        "boundaries), average and relative, by measure and year "
        f"({run.years[0]}-{run.years[-1]}), through policyengine.disclosure "
        "(a floor of 10 distinct source households, dominance and p% rules, "
        "differencing checks, rounding; validate_public 0 problems), from "
        f"uk-budget-data constituencies on Microcosm's local-area cut "
        f"{run.cut.tag} (policyengine {installed_version('policyengine')}, "
        f"{MODEL_PACKAGE} {installed_version(MODEL_PACKAGE)}); private "
        f"audit {run.run_id}/{release_name}."
    )
    text = io.StringIO()
    csv.writer(text, lineterminator="").writerow(
        [
            path.relative_to(root).as_posix(),
            "disclosure_table",
            sha256_file(path),
            "<reviewer>",
            datetime.now(timezone.utc).date().isoformat(),
            "",
            basis,
        ]
    )
    return text.getvalue()


def _run(parsed: argparse.Namespace, *, api) -> int:
    started, started_at = time.perf_counter(), _stamp()
    os.environ.update(HDF5_ENV)
    base = private_directory()
    if (
        area_routing.installed_routing()["area_views"]
        != area_routing.AVAILABLE
    ):
        raise ConstituencyRunError(
            "The installed bundle routes no results by area "
            f"({area_routing.PATH} says not_available), so the page would "
            "show no table from this run. Adopt a release that routes the "
            "local-area cut first."
        )
    ids = check_gates(parsed)
    token = os.environ.get(TOKEN_ENV)
    if not token:
        raise ConstituencyRunError(
            f"{TOKEN_ENV} is not set: the cut is read from {REPOSITORY}."
        )
    if api is None:
        from huggingface_hub import HfApi

        api = HfApi()
    cut = resolve_cut(parsed.cut, api=api, token=token)
    dataset = fetch_cut(cut, api=api, token=token, dataset=parsed.dataset)
    run = plan_run(parsed, ids, cut, dataset)
    directory = private_directory(base, subdirectory=f"geography/{run.run_id}")
    units, dataset_spec = plan_units(run, directory, fresh=parsed.fresh)
    _print_plan(run, units, directory)
    if parsed.dry_run:
        console.print("Dry run: nothing simulated.")
        return 0

    steps: list[Step] = []
    release: list[Step] = []
    swap_at_start = swap_used()
    try:
        if getattr(parsed, "backend", "local") == "modal":
            from uk_budget_data import modal_constituencies_runner

            code = modal_constituencies_runner.execute(
                run, units, dataset_spec, directory, steps, release
            )
        else:
            code = _execute(
                run, units, dataset_spec, directory, steps, release
            )
    except KeyboardInterrupt:
        console.print(
            "[red]Interrupted. Run the same command again to resume: the "
            "measures already simulated are reused.[/red]"
        )
        code = 130
    text = render_timings(
        run,
        steps,
        release[0] if release else None,
        started_at=started_at,
        total_s=time.perf_counter() - started,
        swap=(swap_at_start, swap_used()),
    )
    path = directory / f"timings-{started_at}.md"
    _write_private(path, lambda handle: handle.write(text.encode()))
    sys.stdout.write("\n" + text + "\n")
    console.print(f"Time and memory: {escape(str(path))}")
    return code


def _command(step: str, spec: Path) -> list[str]:
    return [sys.executable, "-m", MODULE, step, "--spec", str(spec)]


def _execute(
    run: RunPlan,
    units: list[Unit],
    dataset_spec: dict,
    directory: Path,
    steps: list[Step],
    release: list[Step],
) -> int:
    """Each measure's process, then, once every measure has passed, the
    release's. Appends each step as it ends; returns the exit code."""
    env = {**os.environ, **HDF5_ENV}
    for index, unit in enumerate(units, start=1):
        label = f"({index} of {len(units)}) {unit.reform}"
        if unit.cached is not None:
            console.print(
                f"{label}: reused (simulated "
                f"{unit.cached.get('finished_at', 'earlier')})"
            )
            steps.append(_step(unit.reform, unit.cached, REUSED))
            continue
        console.print(f"{label}: simulating in a fresh process")
        _write_json(
            unit.spec,
            {
                "reform": unit.reform,
                "key": unit.key,
                "dataset": str(run.dataset),
                "years": run.years,
                "data_inputs_dir": str(run.data_inputs_dir.resolve()),
                # geography._plan refused the file unless it is one.
                "microcosm_export": True,
                "result": str(unit.result),
                "arrays": str(unit.arrays),
                "dataset_arrays": dataset_spec,
            },
        )
        unit.result.unlink(missing_ok=True)
        before = swap_used()
        measured = launch(_command("worker", unit.spec), env)
        steps.append(_unit_step(unit, measured, (before, swap_used())))
        console.print(f"{label}: {_summary(steps[-1])}")
    if not _every_unit_passed(run, steps):
        return 1

    stamp = _stamp()
    release_name = f"{geography.MICROCOSM}-{stamp}"
    spec, result_path = (
        directory / f"release-{stamp}.spec.json",
        directory / f"release-{stamp}.json",
    )
    _write_json(
        spec,
        {
            "run_id": run.run_id,
            "release_name": release_name,
            "dataset_arrays": dataset_spec["arrays"],
            "units": [
                {"reform": unit.reform, "arrays": str(unit.arrays)}
                for unit in units
            ],
            "years": run.years,
            "packages": {p: list(m) for p, m in run.packages.items()},
            "seat_reforms": run.ids,
            "prior_regional": (
                str(run.prior_regional.resolve())
                if run.prior_regional
                else None
            ),
            "data_inputs_dir": str(run.data_inputs_dir.resolve()),
            "out_dir": str(run.out_dir.resolve()),
            "allow_demotions": run.allow_demotions,
            "simulate_s": sum(
                step.timings.get("simulate_s") or 0.0 for step in steps
            ),
            "result": str(result_path),
        },
    )
    console.print(
        "Release: estimating, checking and writing, in a fresh process"
    )
    before = swap_used()
    measured = launch(_command("release", spec), env)
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        result = {}
    status = result.get("status") or f"{FAILED} (exit {measured.returncode})"
    release.append(
        Step(
            name="release",
            status=status,
            timings=result,
            measured=measured,
            swap=(before, swap_used()),
            record=result,
        )
    )
    if result.get("audit"):
        console.print(
            f"Private audit: {escape(result['audit'])} (${AUDIT_DIR_ENV})"
        )
    if measured.returncode != 0 or status != "written":
        console.print(
            f"[red]Error: the release wrote no table ({escape(status)}).[/red]"
        )
        return 1
    return report_tables(
        run, [Path(p) for p in result["written"]], release_name
    )


def report_tables(run: RunPlan, tables: list[Path], release_name: str) -> int:
    """Check each written table with ``validate_public``, write the run's
    ``area_provenance.json`` beside them, as ``geography`` does, carrying
    the record of any other area table there (``carried_provenance``,
    checked again against that table as it is now), and print each
    table's review row. Both backends end here, on this machine."""
    for table in tables:
        problems = validate_public(table)
        if problems:
            raise ConstituencyRunError(
                f"{table.name} fails validation: {problems[:5]}"
            )
    try:
        # Checked again here, against the regional table as it is now
        provenance, carried = carried_provenance(run.out_dir, run.provenance)
    except ConstituencyRunError:
        # No new table without a record publish index would accept
        for table in tables:
            table.unlink(missing_ok=True)
        raise
    path = release_index.write_area_provenance(
        run.out_dir, provenance, [*tables, *carried]
    )
    recorded = [table.name for table in tables] + [p.name for p in carried]
    console.print(
        f"[green]Wrote {escape(str(path))}: records "
        f"{' and '.join(recorded)} for publish index[/green]"
    )
    for table in tables:
        console.print(
            f"[green]Wrote {escape(str(table))}: validate_public, 0 "
            f"problems; SHA-256 {sha256_file(table)}[/green]"
        )
        row = _review_row(table, run, release_name)
        if row is not None:
            console.print(
                "Once it is reviewed, its row in "
                "data_inputs/public_data_review.csv (the reviewer's name in "
                "place of <reviewer>):"
            )
            sys.stdout.write(row + "\n")
    console.print(
        f"{release_index.AREA_PROVENANCE_FILE} gets its row from `publish "
        "review-rows`, after `publish index`."
    )
    return 0


def _every_unit_passed(run: RunPlan, steps: list[Step]) -> bool:
    """Report the reforms a limit refused and the processes that failed."""
    refused = {s.name for s in steps if s.status.startswith(REFUSED)}
    failed = [s for s in steps if s.status.startswith(FAILED)]
    for line in _refusal_lines([s for s in steps if s.name in refused]):
        console.print(f"[red]{escape(line)}[/red]")
    if refused:
        kept = [
            reform
            for reform in run.ids
            if reform not in refused
            and not refused & set(run.packages.get(reform, ()))
        ]
        console.print(
            f"[red]Error: {len(refused)} reform(s) touch a data or model "
            "limit, so no table was written. Leave them, and any package "
            "including them, out: run again with the same options and these "
            "reforms, and the measures already simulated are reused.[/red]"
        )
        console.print("  --reforms " + " ".join(kept))
    for step in failed:
        console.print(
            f"[red]Error: {step.name} did not finish ({step.status}). Run "
            "the same command again to retry it.[/red]"
        )
    return not refused and not failed


def _step(name: str, record: dict, status: str, **kwargs) -> Step:
    """A unit's step from what its process recorded."""
    if record.get("status") == REFUSED:
        kinds = [
            kind
            for kind, key in (
                ("data limit", "limited"),
                ("model limit", "held"),
            )
            if record.get(key)
        ]
        status = f"{REFUSED} ({', '.join(kinds)})" + (
            ", reused" if status == REUSED else ""
        )
    return Step(
        name=name,
        status=status,
        timings=dict(record.get("timings") or {}),
        record=record,
        **kwargs,
    )


def _unit_step(unit: Unit, measured: Measured, swap: tuple) -> Step:
    """A finished process's step: what it recorded, or that it failed."""
    try:
        record = json.loads(unit.result.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        record = None
    if (
        measured.returncode != 0
        or record is None
        or record.get("key") != unit.key
    ):
        status = f"{FAILED} (exit {measured.returncode})"
        if measured.returncode in (-9, 137):
            status += ", killed: likely out of memory"
        return Step(
            name=unit.reform, status=status, measured=measured, swap=swap
        )
    return _step(unit.reform, record, SIMULATED, measured=measured, swap=swap)


def _summary(step: Step) -> str:
    measured = step.measured
    parts = [step.status]
    if measured is not None:
        parts.append(f"{_clock(measured.wall_s)} wall")
        if measured.peak_footprint is not None:
            parts.append(f"peak footprint {_gb(measured.peak_footprint)} GB")
    return ", ".join(parts)


def main(argv: Optional[list[str]] = None) -> int:
    """One step of ``uk-budget-data constituencies``, in a process of its
    own: ``worker`` simulates a measure, ``release`` writes the table."""
    parser = argparse.ArgumentParser(
        prog=f"python -m {MODULE}",
        description=main.__doc__.splitlines()[0],
    )
    parser.add_argument("step", choices=("worker", "release"))
    parser.add_argument("--spec", type=Path, required=True)
    args = parser.parse_args(argv)
    os.environ.update(HDF5_ENV)
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    try:
        if args.step == "worker":
            simulate_unit(spec)
        else:
            build_tables(spec)
    except (
        ConstituencyRunError,
        PrivateOutputError,
        geography.GeographyError,
        KeyError,
        TypeError,
        ValueError,
    ) as error:
        console.print(f"[red]Error: {escape(str(error))}[/red]")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
