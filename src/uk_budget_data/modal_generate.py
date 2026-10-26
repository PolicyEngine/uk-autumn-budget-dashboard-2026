"""The flat CSVs' measures on Modal: one container per measure.

``uk-budget-data generate --backend modal`` sends each measure (one unit:
its two simulations, every year and table read from them) to the function
below and writes the results here, exactly as a local run writes them
(``uk_budget_data.modal_runner.ModalRunner``). Nothing is served: there is
no web endpoint, so nothing is public and no proxy auth is needed. The
function runs only while a generation calls it, in an ephemeral app that
stops when the command ends.

The image installs exactly what ``uv.lock`` pins (``uv_sync``), as the
household app of #97 does, so the containers calculate with the same
policyengine.py, policyengine-uk and policyengine-core as a local run. The
image also carries the working tree's ``data_inputs`` at the container's
working directory, so ``DataConfig``'s relative ``./data_inputs`` (the
OBR estimates, the constituency list) reads the same files as a local run.
The container needs the Hugging Face token to download the bundle's Microcosm
dataset: it comes from the Modal secret ``HF_SECRET`` alone, and nothing
else is given to the container. Cold starts restore a memory snapshot
taken after the engine and its parameters are imported.

Modal imports this module twice: where the command runs, with the
repository checked out, to define the image; and again in every container,
from the image's files. So the image is defined only where the repository
is (``modal.is_local()``).

Needs ``modal`` (not a dependency of the package): run the command with
``uv run --with modal==1.6.2``. See docs/budget-day-runbook.md, "Faster
generation on Budget day".
"""

import os
from pathlib import Path

import modal

APP_NAME = "uk-budget-2026-generate"
# The Modal secret holding HUGGING_FACE_TOKEN (read-only), and nothing else:
# the policyengine workspace's existing fine-grained read token for
# policyengine/populace-uk-private, created by Anthony (decision on #119,
# 25 October). It reads the certified data, so no new secret is needed.
HF_SECRET = "pe-uk-private-hf-read-token"
# One measure peaked at 14-20 GB locally; leave headroom.
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
# The container's working directory, where ./data_inputs is found.
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


app = modal.App(APP_NAME, image=build_image())


@app.cls(
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=TIMEOUT_S,
    retries=RETRIES,
    max_containers=MAX_CONTAINERS,
    enable_memory_snapshot=True,
    secrets=[
        modal.Secret.from_name(HF_SECRET, required_keys=["HUGGING_FACE_TOKEN"])
    ],
)
class Generator:
    @modal.enter(snap=True)
    def load(self):
        """Import the engine and its parameters, so the snapshot holds them
        loaded. No dataset is read here: the token is not used before a
        unit runs."""
        import policyengine_uk.system  # noqa: F401

        import uk_budget_data.pipeline  # noqa: F401

    @modal.method()
    def run(self, unit):
        """One measure: ``pipeline.run_flat_unit``, as a local worker runs
        it, gates included."""
        from uk_budget_data.pipeline import run_flat_unit

        return run_flat_unit(unit)
