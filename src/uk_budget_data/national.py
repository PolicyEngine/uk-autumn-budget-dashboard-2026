"""The national results in one run (``generate --national``).

Before this, the national results took four commands, each its own cold
Modal app, each container downloading the Microcosm dataset again:
``--artifacts --reforms <ids>``, ``--combined <ids>``, and ``--only
income_growth`` and ``--only income_distribution`` with
``--published-package``. ``generate --national --reforms <ids>`` makes the
same files in one:

1. each measure's receipted artifact, one container per measure, all at
   once (``publication.generate.generate_artifacts``, unchanged);
2. then the package, the combined run of every measure given, in one more
   container, planned only once every member is written (its receipt binds
   their outputs and their withheld cells, and it still refuses mismatched
   members);
3. in the same container as each artifact, straight after it, that run's
   rows of ``income_distribution.csv``, ``income_mobility.csv`` and
   ``income_growth_with_measures.csv``, read from the two simulations the
   artifact has just built (``pipeline.read_flat_tables``) instead of
   building them again;
4. here, once every artifact is written, the three files, by the same
   ``generate_income_distribution`` and ``generate_income_growth`` that
   ``--only ... --published-package`` calls, answered from those rows
   (``StashRunner``): the same rows in the same order, the same rounding
   and floors, so the same bytes.

Nothing about an artifact changes: the same jobs, receipts, digests and
execution identity, the same write-once assembly. The flat tables are read
after the artifact is written, outside its data-limit watch, so they cannot
change what its receipt records. They reuse the artifact's simulations
only when those are the ones ``run_flat_unit`` would build (the same
baseline and reform scenarios); otherwise the container builds the flat
path's own two, as ``run_flat_unit`` does.

The flat files are written only when every artifact of the run was written
(none refused, failed or not started) and the run has the package; they
then bind this run's measures and package under ``combine.combined_key``,
as ``--published-package`` does once the package is staged. Otherwise they
are left as they are, and the old ``--only ... --published-package``
commands make them after staging.

On Modal (``modal_generate.national_app``) the whole run is one ephemeral
app: one small container first fills the dataset cache on a Modal Volume
(``dataset_cache``), so the measures' containers copy the dataset from it
and never download it. Locally (``--backend local``) the same steps run
one after another in this process.
"""

import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Optional

from uk_budget_data.models import DataConfig, Reform

# The package files' tables, read in each artifact's container.
NATIONAL_TABLES = frozenset({"income_distribution", "income_growth"})


class NationalError(RuntimeError):
    """The national run cannot write its flat files as asked."""


class CapturingBuild:
    """``build``, keeping each (scenario, simulation) it builds, in order.
    It returns the very simulation built, so the artifact is made exactly
    as without it."""

    def __init__(self, build: Callable, built: list):
        self.build = build
        self.built = built

    def __call__(self, dataset_path, scenario=None):
        simulation = self.build(dataset_path, scenario)
        self.built.append((scenario, simulation))
        return simulation


def _flat_build(dataset_path, scenario=None):
    from uk_budget_data.pipeline import build_microsimulation

    return build_microsimulation(dataset_path, scenario)


def flat_simulations(job, reform, built: list, build: Callable = _flat_build):
    """The two simulations ``run_flat_unit`` would read ``reform``'s rows
    from, and whether they are the artifact's own (``built``).

    The artifact builds its baseline with ``baseline_scenario_for(config,
    uses_config_baseline)`` and its reform with ``to_scenario()``; the flat
    path with ``baseline_scenario_for(config)`` and ``to_scenario()``. The
    reform side is the same call. The baseline is the same when the two
    ``uses_config`` agree, or when the scenarios they give are equal;
    otherwise the flat path's own two are built here."""
    from uk_budget_data import data_limits

    config = job.config
    flat_uses_config = not reform.has_custom_baseline()
    same_baseline = flat_uses_config == job.uses_config_baseline
    if not same_baseline:
        try:
            same_baseline = reform.baseline_scenario_for(
                config, job.uses_config_baseline
            ) == reform.baseline_scenario_for(config)
        except Exception:  # noqa: BLE001 - any doubt means build anew
            same_baseline = False
    if same_baseline and len(built) == 2:
        return built[0][1], built[1][1], True
    baseline = data_limits.watched_build(
        build, job.dataset_path, reform.baseline_scenario_for(config)
    )
    reformed = data_limits.watched_build(
        build, job.dataset_path, reform.to_scenario()
    )
    return baseline, reformed, False


def flat_tables_for(job, built: list, tables=NATIONAL_TABLES):
    """``job``'s rows of the package files, as one whole ``run_flat_unit``
    over every year makes them for each table."""
    from uk_budget_data.pipeline import read_flat_tables
    from uk_budget_data.publication.generate import _run_reform

    reform, _ = _run_reform(job)
    baseline, reformed, reused = flat_simulations(job, reform, built)
    outcome = read_flat_tables(
        reform, job.config, job.dataset_path, tables, baseline, reformed
    )
    outcome.messages.insert(
        0,
        f"{job.key}: package-file rows from "
        + (
            "the artifact's simulations"
            if reused
            else "the flat path's own simulations (its baseline differs)"
        ),
    )
    return outcome


def run_national_job(job, tables=NATIONAL_TABLES, row_times=None):
    """One artifact, then its package-file rows from the same simulations.

    Returns ``(ArtifactOutcome, FlatOutcome or None)``. The artifact is
    ``run_artifact``'s, unchanged; a run that wrote no artifact (refused)
    reads no rows. ``row_times``, if given, gets the seconds the rows
    took (for the container's progress line)."""
    from uk_budget_data.publication.generate import run_artifact

    built: list = []
    outcome = run_artifact(
        replace(job, build=CapturingBuild(job.build, built))
    )
    if outcome.reference is None:
        return outcome, None
    started = time.perf_counter()
    flat = flat_tables_for(job, built, tables)
    if row_times is not None:
        row_times.append(time.perf_counter() - started)
    del built
    return outcome, flat


class LocalNationalRunner:
    """``generate_artifacts``' runner for ``--national --backend local``:
    each artifact and its rows in this process, one after another."""

    jobs = 1
    in_process = True

    def __init__(self, stash: dict, tables=NATIONAL_TABLES, run=None):
        self.stash = stash
        self.tables = tables
        self.run = run or run_national_job

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        from uk_budget_data.publication.generate import run_artifact

        if function is not run_artifact:
            raise NationalError("the national runner runs artifacts only")
        results = []
        for index, job in enumerate(units):
            outcome, flat = self.run(job, self.tables)
            if flat is not None:
                self.stash[job.key] = flat
            results.append(outcome)
            on_result(index, outcome)
        return results


class StashRunner:
    """Answers ``generate_income_distribution`` and
    ``generate_income_growth``'s whole units from the rows the artifacts'
    containers read, by measure (or package) key, so those functions write
    the files exactly as with any other runner. A measure's lines are said
    once, with the first file."""

    jobs = 1
    in_process = True

    def __init__(self, stash: dict):
        self.stash = stash
        self.said: set = set()

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        from uk_budget_data.pipeline import FlatOutcome, run_flat_unit

        if function is not run_flat_unit:
            raise NationalError("the stash answers flat units only")
        results = []
        for index, unit in enumerate(units):
            key = unit.reform.id
            if unit.years is not None:
                raise NationalError(f"{key}: per-year units are not stashed")
            if not unit.tables <= NATIONAL_TABLES:
                raise NationalError(f"{key}: {sorted(unit.tables)} not read")
            if key not in self.stash:
                raise NationalError(f"{key}: no package-file rows came back")
            flat = self.stash[key]
            if flat.reform_id != key:
                raise NationalError(
                    f"{key}: the rows that came back are {flat.reform_id}'s"
                )
            answer = FlatOutcome(
                reform_id=flat.reform_id,
                reform_name=flat.reform_name,
                distribution_rows=list(flat.distribution_rows),
                mobility_rows=list(flat.mobility_rows),
                growth_rows=list(flat.growth_rows),
                messages=[] if key in self.said else list(flat.messages),
            )
            self.said.add(key)
            results.append(answer)
            on_result(index, answer)
        return results


@dataclass
class NationalReport:
    """The artifacts' report, and what became of the flat files."""

    artifacts: object
    package_key: Optional[str]
    flat_files: list = field(default_factory=list)
    flat_skipped: Optional[str] = None


def package_key(reforms: list[Reform]) -> Optional[str]:
    from uk_budget_data.publication import combine

    if len(reforms) < 2:
        return None
    return combine.combined_key([reform.id for reform in reforms])


def run_national(
    reforms: list[Reform],
    config: DataConfig,
    runner,
    stash: dict,
    *,
    artifacts_root: Path,
    generator_argv: Optional[list] = None,
    write_flat: bool = True,
    on_progress: Callable[[str], None] = print,
    repo_root: Path = Path("."),
) -> NationalReport:
    """The artifacts (measures, then their package) through ``runner``,
    which fills ``stash`` with each run's package-file rows, then the three
    flat files from ``stash`` when every artifact was written."""
    from uk_budget_data import pipeline
    from uk_budget_data.publication.generate import generate_artifacts

    key = package_key(reforms)
    report = generate_artifacts(
        reforms,
        config,
        combined_sets=[list(reforms)] if key else [],
        artifacts_root=artifacts_root,
        repo_root=repo_root,
        generator_argv=generator_argv,
        on_progress=on_progress,
        runner=runner,
    )
    result = NationalReport(artifacts=report, package_key=key)
    if not write_flat:
        result.flat_skipped = "--no-flat-files"
        return result
    if key is None:
        result.flat_skipped = (
            "the run has no package (one measure): the files' package rows "
            "would be missing"
        )
        return result
    problems = (
        list(report.refused) + list(report.failed) + list(report.not_started)
    )
    if problems:
        result.flat_skipped = (
            "not every artifact was written (" + ", ".join(problems) + ")"
        )
        return result
    missing = [
        reform_id
        for reform_id in [reform.id for reform in reforms] + [key]
        if reform_id not in stash
    ]
    if missing:
        result.flat_skipped = "no package-file rows for " + ", ".join(missing)
        return result
    # As --published-package selects them: the measures by id, then the
    # package of exactly those.
    measures = sorted(reforms, key=lambda reform: reform.id)
    answer = StashRunner(stash)
    pipeline.generate_income_distribution(
        measures, config, runner=answer, combined_sets=[measures]
    )
    pipeline.generate_income_growth(
        measures, config, runner=answer, combined_sets=[measures]
    )
    result.flat_files = [
        config.output_dir / pipeline.INCOME_DISTRIBUTION_FILE,
        config.output_dir / pipeline.INCOME_MOBILITY_FILE,
        config.output_dir / pipeline.INCOME_GROWTH_FILE,
    ]
    return result


# Expected wall times on Modal, for the plan (minutes). From the 26 October
# breakdown: a six-year measure container is 293-354 s with a cold download
# (builds about 82 s, tables about 260 s); the combined run about 7 min;
# the flat tables, read from simulations whose years are already computed,
# are estimated, not measured.
EXPECTED_MINUTES = (
    ("app start, image and the dataset cache (one download if empty)", "1-2"),
    ("measures, one container each, all at once (artifact + rows)", "6-8"),
    ("package, once every member is written (artifact + rows)", "6-8"),
    ("flat files written here, from the rows", "<1"),
)
EXPECTED_TOTAL = "about 13-17 min"


def plan_lines(
    reforms: list[Reform],
    backend: str,
    output_dir: Path,
    artifacts_root: Path,
    write_flat: bool,
) -> list[str]:
    """What ``generate --national`` will run, for ``--dry-run``."""
    from uk_budget_data import modal_limits

    key = package_key(reforms)
    ids = [reform.id for reform in reforms]
    lines = [
        f"National run ({backend}): {len(ids)} measures"
        + (f" and their package {key}" if key else " (no package: one)"),
        "  measures: " + ", ".join(ids),
    ]
    if backend == "modal":
        lines += [
            f"  one ephemeral Modal app ({modal_limits.NATIONAL_APP_NAME}); "
            "it stops when the command ends, nothing is left running",
            f"  0. prime the dataset cache: Volume "
            f"{modal_limits.DATASET_VOLUME}, keyed by SHA-256; one small "
            f"container, {modal_limits.PRIME_TIMEOUT_S // 60} min limit, "
            f"{modal_limits.DOWNLOAD_ATTEMPTS} attempts on a Hugging Face "
            "5xx",
            f"  1. {len(ids)} measure containers at once (at most "
            f"{modal_limits.MAX_CONTAINERS}, "
            f"{modal_limits.MEMORY_MB // 1024} GB, {modal_limits.CPU:g} CPU, "
            f"{modal_limits.NATIONAL_TIMEOUT_S // 60} min limit, no "
            "retries): artifact, then its package-file rows",
        ]
    else:
        lines.append(
            f"  1. {len(ids)} measures here, one after another: artifact, "
            "then its package-file rows"
        )
    if key:
        lines.append(
            f"  2. then {key}, once every member is written: artifact, then "
            "its package-file rows"
        )
    lines.append(f"  artifacts under {artifacts_root}")
    if write_flat and key:
        lines.append(
            "  3. if every artifact is written: income_distribution.csv, "
            "income_mobility.csv, income_growth_with_measures.csv in "
            f"{output_dir} (measures by id, then {key})"
        )
    else:
        lines.append("  3. flat files: not written by this run")
    if backend == "modal":
        lines.append("  expected on Modal:")
        lines += [
            f"    {step}: {minutes} min" for step, minutes in EXPECTED_MINUTES
        ]
        lines.append(f"    total: {EXPECTED_TOTAL}")
    return lines
