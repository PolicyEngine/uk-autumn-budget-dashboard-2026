"""Results by constituency on Modal: one container per measure, the release
in one more.

``uk-budget-data constituencies --backend modal`` plans the run here, as a
local run does (the cut resolved and checked, the gates, the plan), then
sends each measure's unit to ``Constituencies.simulate`` and, once every
measure has passed, the release to ``Constituencies.release``. Only the
validated public table and the timings come back; everything a unit or the
release keeps (each year's household net income, the dataset's own arrays,
the disclosure layer's audit) stays on the private Modal Volume ``VOLUME``,
which only the policyengine workspace can read. Nothing is served: there is
no web endpoint.

Each container downloads the local-area cut itself, with the Hugging Face
token from the Modal secret ``HF_SECRET`` alone, and checks its SHA-256
against the cut's release manifest, as a local run does. No dataset file is
ever sent from this machine.

Units run in parallel, so each keeps its own copy of the dataset's arrays
(``datasets/<reform>.npz``); the release checks they are identical before it
uses them, which a local run checks unit by unit instead.

``smoke_app`` tests the plumbing where the licensed data may not go: no
secret, no cut, its own Volume, synthetic arrays only.

Cost guards: no warm containers, no retries, a timeout on every function,
at most ``MAX_CONTAINERS`` at once, and the app is ephemeral, so it stops
when the command ends.

Needs ``modal`` (not a dependency of the package): run the command with
``uv run --with modal==1.6.2``. See docs/budget-day-runbook.md, "Results by
constituency on Modal".
"""

import os
import resource
import time
from pathlib import Path

import modal

APP_NAME = "uk-budget-2026-constituencies"
# The workspace's existing fine-grained read token for
# policyengine/populace-uk-private (key HUGGING_FACE_TOKEN), created by
# Anthony; checked on Modal on 25 October (#119). No new secret is needed.
HF_SECRET = "pe-uk-private-hf-read-token"
VOLUME = "uk-budget-2026-constituencies-private"
SMOKE_VOLUME = "uk-budget-2026-constituencies-smoke"
MOUNT = "/private"
# #138 targets a 64 GB laptop for one measure at a time; start there and
# lower it once a real run has measured the peaks.
MEMORY_MB = 64 * 1024
CPU = 4.0
UNIT_TIMEOUT_S = 90 * 60
MAX_CONTAINERS = 11
PACKAGE_IGNORE = ["**/__pycache__/**"]
WORKDIR = "/root"
HDF5_ENV = {"HDF5_USE_FILE_LOCKING": "FALSE"}


def build_image() -> modal.Image:
    """The image, from the repository where the command runs: exactly what
    ``uv.lock`` pins, the package and ``data_inputs``."""
    if not modal.is_local():
        return modal.Image.debian_slim()
    project_root = Path(__file__).resolve().parents[2]
    python_version = (project_root / ".python-version").read_text().strip()
    return (
        modal.Image.debian_slim(python_version=python_version)
        .uv_sync(str(project_root), frozen=True)
        .env(HDF5_ENV)
        .workdir(WORKDIR)
        .add_local_dir(
            str(project_root / "data_inputs"), f"{WORKDIR}/data_inputs"
        )
        .add_local_python_source("uk_budget_data", ignore=PACKAGE_IGNORE)
    )


IMAGE = build_image()
app = modal.App(APP_NAME, image=IMAGE)
smoke_app = modal.App(f"{APP_NAME}-smoke", image=IMAGE)
volume = modal.Volume.from_name(VOLUME, create_if_missing=True)
smoke_volume = modal.Volume.from_name(SMOKE_VOLUME, create_if_missing=True)


def _peak_rss() -> int:
    """This container's peak resident size, in bytes (Linux reports KiB)."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024


def container_paths(run_id: str, reform: str) -> dict:
    """Where a unit keeps its files on the Volume."""
    from uk_budget_data.constituencies_remote import unit_paths

    return unit_paths(MOUNT, run_id, reform)


def _fetch_cut_here(spec: dict) -> str:
    """Download and check the cut in this container; return its path."""
    from huggingface_hub import HfApi

    from uk_budget_data.certified_data import TOKEN_ENV
    from uk_budget_data.constituencies import fetch_cut, resolve_cut

    token = os.environ[TOKEN_ENV]
    api = HfApi()
    cut = resolve_cut(spec["cut_tag"], api=api, token=token)
    if cut.sha256 != spec["cut_sha256"]:
        raise ValueError(
            f"The cut resolved here ({cut.sha256[:12]}) is not the one "
            f"planned ({spec['cut_sha256'][:12]})"
        )
    return str(fetch_cut(cut, api=api, token=token, dataset=None))


@app.cls(
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=UNIT_TIMEOUT_S,
    retries=0,
    max_containers=MAX_CONTAINERS,
    volumes={MOUNT: volume},
    secrets=[
        modal.Secret.from_name(HF_SECRET, required_keys=["HUGGING_FACE_TOKEN"])
    ],
)
class Constituencies:
    @modal.method()
    def simulate(self, spec: dict) -> dict:
        """One measure on the cut, its arrays kept on the Volume. Returns
        what the unit recorded, with the container's wall time and peak
        resident size."""
        from uk_budget_data.constituencies_remote import simulate_here

        started = time.perf_counter()
        result = simulate_here(
            spec,
            root=MOUNT,
            dataset=_fetch_cut_here(spec),
            data_inputs=f"{WORKDIR}/data_inputs",
        )
        volume.commit()
        return {
            **result,
            "container": {
                "wall_s": time.perf_counter() - started,
                "max_rss": _peak_rss(),
            },
        }

    @modal.method()
    def release(self, spec: dict) -> dict:
        """The release over every unit. The audit stays on the Volume; only
        the public table's bytes come back."""
        from uk_budget_data.constituencies_remote import release_here

        started = time.perf_counter()
        volume.reload()
        result, files = release_here(
            spec, root=MOUNT, data_inputs=f"{WORKDIR}/data_inputs"
        )
        volume.commit()
        result["container"] = {
            "wall_s": time.perf_counter() - started,
            "max_rss": _peak_rss(),
        }
        return {"result": result, "files": files}


# -- the smoke test: synthetic arrays, no secret, no cut ----------------------


@smoke_app.function(
    cpu=1.0,
    memory=2 * 1024,
    timeout=10 * 60,
    retries=0,
    max_containers=MAX_CONTAINERS,
    volumes={MOUNT: smoke_volume},
)
def smoke_unit(run_id: str, reform: str, households: int, years: list) -> dict:
    """A stand-in unit: synthetic arrays written to the smoke Volume where a
    real unit writes its own, and committed, as ``simulate`` does."""
    import numpy as np

    started = time.perf_counter()
    paths = container_paths(run_id, reform)
    rng = np.random.default_rng(abs(hash(reform)) % 2**32)
    Path(paths["arrays"]).parent.mkdir(parents=True, exist_ok=True)
    Path(paths["dataset_arrays"]["arrays"]).parent.mkdir(
        parents=True, exist_ok=True
    )
    arrays = {}
    for year in years:
        base = rng.uniform(10_000, 80_000, households)
        arrays[f"baseline_{year}"] = base
        arrays[f"reformed_{year}"] = base + rng.normal(0, 50, households)
        arrays[f"weight_{year}"] = np.full(households, 1_000.0)
    np.savez(paths["arrays"], **arrays)
    np.savez(
        paths["dataset_arrays"]["arrays"],
        source_ids=np.arange(households),
        seat_labels=np.array([f"S{i % 650}" for i in range(households)]),
    )
    smoke_volume.commit()
    return {
        "reform": reform,
        "status": "simulated",
        "container": {
            "wall_s": time.perf_counter() - started,
            "max_rss": _peak_rss(),
        },
    }


@smoke_app.function(
    cpu=1.0,
    memory=2 * 1024,
    timeout=10 * 60,
    retries=0,
    volumes={MOUNT: smoke_volume},
)
def smoke_release(run_id: str, reforms: list, years: list) -> dict:
    """A stand-in release: reads every unit's arrays back from the Volume
    (so the units' commits are visible to another container), checks the
    dataset arrays agree, and returns a stand-in table's bytes."""
    import numpy as np

    started = time.perf_counter()
    smoke_volume.reload()
    run = f"{MOUNT}/geography/{run_id}"
    first = None
    rows = ["reform_id,year,mean_change"]
    for reform in reforms:
        with np.load(f"{run}/datasets/{reform}.npz") as data:
            ids = data["source_ids"]
        if first is None:
            first = ids
        elif not np.array_equal(first, ids):
            raise ValueError(f"{reform}: dataset arrays differ")
        with np.load(f"{run}/units/{reform}.npz") as data:
            for year in years:
                change = data[f"reformed_{year}"] - data[f"baseline_{year}"]
                rows.append(f"{reform},{year},{change.mean():.4f}")
    return {
        "files": {"smoke_constituency.csv": ("\n".join(rows) + "\n").encode()},
        "container": {
            "wall_s": time.perf_counter() - started,
            "max_rss": _peak_rss(),
        },
    }
