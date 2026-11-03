"""Measures on Modal: one container per measure.

``uk-budget-data generate --backend modal`` sends each measure (one unit:
its two simulations, every year and table read from them) to a function
below and writes the results here, exactly as a local run writes them
(``uk_budget_data.modal_runner.ModalRunner``). Nothing is served: there is
no web endpoint, so nothing is public and no proxy auth is needed. The
functions run only while a generation calls them, in an ephemeral app that
stops when the command ends.

Two kinds of unit run here:

- the flat CSVs' measures (``Generator.run``, ``pipeline.run_flat_unit``);
- receipted artifacts (``generate --artifacts``, ``Generator.run_artifact``,
  ``publication.generate.run_artifact``). The container writes the
  artifact into its own scratch directory and sends back its files; the
  runner writes them under the local artifacts root, write-once, as a local
  run would.

The image installs exactly what ``uv.lock`` pins (``uv_sync``), as the
household app of #97 does, so the containers calculate with the same
policyengine.py, policyengine-uk and policyengine-core as a local run. The
package and ``data_inputs`` are the working tree's, which the runner
requires to be the committed tree (``CodeRevision.tree_clean``) for a run
on the bundle's data. The container needs the Hugging Face token to
download the bundle's Microcosm dataset: it comes from the Modal secret
``HF_SECRET`` alone, and nothing else is given to the container.

``SmokeGenerator`` runs artifacts on ``synthetic_dataset`` only. It has no
secret, never downloads the bundle's dataset, and refuses any other
dataset: it tests the plumbing where the licensed data may not go.

Modal imports this module twice: where the command runs, with the
repository checked out, to define the image; and again in every container,
from the image's files. So the image is defined only where the repository
is (``modal.is_local()``).

Needs ``modal`` (not a dependency of the package): run the command with
``uv run --with modal==1.6.2``. See docs/budget-day-runbook.md, "Budget day
on Modal".
"""

import io
import os
import tarfile
import tempfile
import time
from dataclasses import replace
from pathlib import Path

import modal

from uk_budget_data import modal_limits

APP_NAME = "uk-budget-2026-generate"
# The Modal secret holding HUGGING_FACE_TOKEN (read-only), and nothing else:
# the workspace's existing fine-grained read token for
# policyengine/populace-uk-private, created by Anthony (decision on #119,
# 25 October). It reads the certified data, so no new secret is needed.
HF_SECRET = "pe-uk-private-hf-read-token"
# One receipted measure peaked at 14-17 GB locally on 25 October; leave
# headroom.
MEMORY_MB = 32 * 1024
CPU = 2.0
# One measure takes about 3 minutes locally; a cold container also downloads
# the dataset.
TIMEOUT_S = 45 * 60
# No retries: a failed measure fails the run and is rerun on purpose, never
# paid for twice silently.
RETRIES = 0
# At most 16 containers at once: a ceiling on what a run can cost.
MAX_CONTAINERS = 16
PACKAGE_IGNORE = ["**/__pycache__/**"]
# Where the container finds the repository's inputs (budget years, the
# publication basis, measure inputs); its working directory.
WORKDIR = "/root"


def build_image() -> modal.Image:
    """The image, defined from the repository where the command runs. In a
    container it is already built, and this stands in for it."""
    if not modal.is_local():
        return modal.Image.debian_slim()
    project_root = Path(__file__).resolve().parents[2]
    python_version = (project_root / ".python-version").read_text().strip()
    return (
        modal.Image.debian_slim(python_version=python_version)
        .uv_sync(str(project_root), frozen=True)
        .env({"GIT_SHA": os.environ.get("GIT_SHA", "")})
        .workdir(WORKDIR)
        .add_local_dir(
            str(project_root / "data_inputs"), f"{WORKDIR}/data_inputs"
        )
        .add_local_python_source("uk_budget_data", ignore=PACKAGE_IGNORE)
    )


IMAGE = build_image()
app = modal.App(APP_NAME, image=IMAGE)
# The smoke test's own app, so it never needs the real app's secret.
smoke_app = modal.App(f"{APP_NAME}-smoke", image=IMAGE)
# The one secret, shared by the artifacts' app and the national run's.
HF = [modal.Secret.from_name(HF_SECRET, required_keys=["HUGGING_FACE_TOKEN"])]


def _pack(directory: Path) -> bytes:
    """An artifact directory's files as a gzipped tar, names relative."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path in sorted(directory.iterdir()):
            archive.add(path, arcname=path.name, recursive=False)
    return buffer.getvalue()


def run_artifact_here(job, allow_bundle: bool, flat_tables=None):
    """One receipted artifact in this container.

    Returns ``(outcome, relative_path, files)``: the outcome as a local run
    returns it, the artifact's directory relative to the artifacts root,
    and its files packed (``_pack``), or ``None`` for both when nothing was
    written. A ``synthetic:`` dataset is built here; any other local dataset
    path is refused, since no dataset file is ever sent to Modal.

    With ``flat_tables`` (the national run), the artifact is made by
    ``national.run_national_job``, which then reads its package-file rows
    from the same simulations, and a fourth item is returned: those rows
    (a ``FlatOutcome``), or None when no artifact was written.
    """
    from uk_budget_data import synthetic_dataset
    from uk_budget_data.modal_runner import Timed, phase_line
    from uk_budget_data.publication.generate import run_artifact

    scratch = Path(tempfile.mkdtemp(prefix="artifact-"))
    dataset = job.dataset_path
    if dataset is not None and dataset.startswith(synthetic_dataset.PREFIX):
        households, seed = synthetic_dataset.parse(dataset)
        dataset = str(
            synthetic_dataset.write(scratch / "synthetic.h5", households, seed)
        )
    elif dataset is not None:
        raise ValueError(
            f"{job.key}: a local dataset ({dataset}) is never sent to Modal"
        )
    elif not allow_bundle:
        raise ValueError(
            f"{job.key}: the smoke test runs on the synthetic dataset only"
        )
    root = scratch / "artifacts"
    builds: list = []
    processes: list = []
    started = time.perf_counter()
    here = replace(
        job,
        artifacts_root=root,
        dataset_path=dataset,
        build=Timed(job.build, builds),
        process=Timed(job.process, processes),
    )
    flat = None
    rows: list = []
    if flat_tables is None:
        outcome = run_artifact(here)
    else:
        from uk_budget_data.national import run_national_job

        outcome, flat = run_national_job(here, flat_tables, rows)
    outcome.progress.append(
        phase_line(
            job.key, time.perf_counter() - started, builds, processes, rows
        )
    )
    extra = () if flat_tables is None else (flat,)
    if outcome.reference is None:
        return (outcome, None, None, *extra)
    relative = outcome.reference.path.relative_to(root)
    return (outcome, str(relative), _pack(outcome.reference.path), *extra)


@app.cls(
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=TIMEOUT_S,
    retries=RETRIES,
    max_containers=MAX_CONTAINERS,
    enable_memory_snapshot=True,
    secrets=HF,
)
class Generator:
    @modal.enter(snap=True)
    def load(self):
        """Import the engine and its parameters before the first unit. No
        dataset is read here: the token is not used before a unit runs.

        The snapshot this asks for is never taken: Modal takes memory
        snapshots for deployed apps only, and this app is ephemeral (every
        run logs "Memory snapshots are disabled for ephemeral apps"). So
        each container imports the engine itself, cold."""
        import policyengine_uk.system  # noqa: F401

        import uk_budget_data.pipeline  # noqa: F401
        import uk_budget_data.publication.generate  # noqa: F401

    @modal.method()
    def run(self, unit):
        """One measure: ``pipeline.run_flat_unit``, as a local worker runs
        it, gates included."""
        from uk_budget_data.pipeline import run_flat_unit

        started = time.perf_counter()
        outcome = run_flat_unit(unit)
        outcome.messages.append(
            f"{outcome.reform_id}: {time.perf_counter() - started:.0f} s in "
            "its Modal container"
        )
        return outcome

    @modal.method()
    def run_artifact(self, job):
        """One receipted artifact on the bundle's dataset."""
        return run_artifact_here(job, allow_bundle=True)


@smoke_app.cls(
    cpu=CPU,
    memory=8 * 1024,
    timeout=TIMEOUT_S,
    retries=0,
    max_containers=MAX_CONTAINERS,
)
class SmokeGenerator:
    """Artifacts on the synthetic dataset only: no secret, no bundle data."""

    @modal.method()
    def run_artifact(self, job):
        return run_artifact_here(job, allow_bundle=False)

    @modal.method()
    def transport_check(self, key: str):
        """An artifact-shaped directory sent back as a real run's is (the
        same ``_pack``), to test the return path and the runner's
        ``assemble`` where no receipt can be made: the synthetic dataset is
        not a bundle dataset, so the receipt gate refuses it. Its files are
        stand-ins and never stageable."""
        import hashlib
        import json

        body = f"reform_id,year,value\n{key},2027,0.0\n".encode()
        digest = hashlib.sha256(body).hexdigest()
        target = (
            Path(tempfile.mkdtemp(prefix="transport-")) / key / digest[:16]
        )
        target.mkdir(parents=True)
        (target / "budgetary_impact.csv").write_bytes(body)
        (target / "receipt.json").write_text(
            json.dumps(
                {
                    "schema": "transport-check",
                    "files": {"budgetary_impact.csv": digest},
                },
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        return f"{key}/{digest[:16]}", _pack(target)


# --- The national run: one app for measures, package and their rows ------
#
# ``generate --national --backend modal`` (``national``,
# ``modal_runner.national_modal_session``). Its own app, so the artifacts'
# app above is unchanged. One small container first fills the dataset cache
# on a Volume (``dataset_cache``); each measure's container then copies the
# dataset from it and never downloads it. Names and guards are in
# ``modal_limits``.

national_app = modal.App(modal_limits.NATIONAL_APP_NAME, image=IMAGE)
dataset_volume = modal.Volume.from_name(
    modal_limits.DATASET_VOLUME, create_if_missing=True
)


@national_app.function(
    cpu=modal_limits.PRIME_CPU,
    memory=modal_limits.PRIME_MEMORY_MB,
    timeout=modal_limits.PRIME_TIMEOUT_S,
    retries=0,
    max_containers=1,
    volumes={modal_limits.DATASET_CACHE_MOUNT: dataset_volume},
    secrets=HF,
)
def prime_dataset() -> dict:
    """The pinned files in the cache, downloaded only if missing (with
    retries on a Hugging Face 5xx), each checked against its digest."""
    from uk_budget_data import dataset_cache

    dataset_volume.reload()
    done = dataset_cache.ensure_cached(
        dataset_cache.pinned_files(),
        Path(modal_limits.DATASET_CACHE_MOUNT),
    )
    if "downloaded" in done.values():
        dataset_volume.commit()
    return done


@national_app.cls(
    cpu=modal_limits.CPU,
    memory=modal_limits.MEMORY_MB,
    timeout=modal_limits.NATIONAL_TIMEOUT_S,
    retries=0,
    max_containers=modal_limits.MAX_CONTAINERS,
    scaledown_window=modal_limits.NATIONAL_SCALEDOWN_S,
    volumes={modal_limits.DATASET_CACHE_MOUNT: dataset_volume},
    secrets=HF,
)
class NationalGenerator:
    @modal.enter()
    def load(self):
        """Import the engine before the first run; the dataset is copied
        from the cache at the first run on it (``_seed``)."""
        import policyengine_uk.system  # noqa: F401

        import uk_budget_data.national  # noqa: F401
        import uk_budget_data.pipeline  # noqa: F401
        import uk_budget_data.publication.generate  # noqa: F401

        self.seeded = False

    def _seed(self):
        """Copy the cached dataset to where policyengine looks for it
        (``./data``), each file checked against its digest, once per
        container. policyengine then finds it and downloads nothing."""
        if self.seeded:
            return
        from uk_budget_data import dataset_cache

        started = time.perf_counter()
        dataset_volume.reload()
        dataset_cache.seed(
            dataset_cache.pinned_files(),
            Path(modal_limits.DATASET_CACHE_MOUNT),
            Path(WORKDIR),
        )
        self.seeded = True
        print(
            f"dataset copied from the cache in {time.perf_counter() - started:.0f} s"
        )

    @modal.method()
    def run(self, job):
        """One artifact and its package-file rows."""
        from uk_budget_data.national import NATIONAL_TABLES

        if job.dataset_path is None:
            self._seed()
        return run_artifact_here(
            job, allow_bundle=True, flat_tables=NATIONAL_TABLES
        )
