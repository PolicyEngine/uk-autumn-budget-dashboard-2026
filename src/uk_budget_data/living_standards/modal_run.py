"""``uk-budget-data living-standards --backend modal``: the baseline run on Modal.

One container runs the projections (:mod:`.projections`) on the bundle's
certified dataset and assembles the outlook (:mod:`.build`) from the
committed inputs, exactly as a local run does, and returns the
projections and the file's text. The command writes the file and marks its
review row pending where it runs, so nothing heavier than Modal's client is
loaded there.

The image installs exactly what ``uv.lock`` pins (``uv_sync``) and carries
the working tree's ``data_inputs/living_standards`` at the container's
working directory. The Hugging Face token comes from the Modal secret
``HF_SECRET`` alone (the policyengine workspace's read token for the
certified data, as ``generate --backend modal`` uses on #178).

Cost guards: one container, no retries, a timeout. The app is ephemeral
and stops when the command ends; nothing is served.

Needs ``modal`` (not a dependency of the package): run the command with
``uv run --with modal==1.6.2``.
"""

import os
from pathlib import Path

import modal

APP_NAME = "uk-budget-2026-living-standards"
HF_SECRET = "pe-uk-private-hf-read-token"
# One baseline over eight years; the local run peaked near 20 GB.
MEMORY_MB = 32 * 1024
CPU = 2.0
# The local run takes about 25 minutes; a cold container also downloads
# the dataset.
TIMEOUT_S = 75 * 60
# No retries: a failed run fails the command and is rerun on purpose.
RETRIES = 0
MAX_CONTAINERS = 1
WORKDIR = "/root"
PACKAGE_IGNORE = ["**/__pycache__/**"]


def build_image() -> modal.Image:
    if not modal.is_local():
        return modal.Image.debian_slim()
    project_root = Path(__file__).resolve().parents[3]
    python_version = (project_root / ".python-version").read_text().strip()
    return (
        modal.Image.debian_slim(python_version=python_version)
        .uv_sync(str(project_root), frozen=True)
        .env({"GIT_SHA": os.environ.get("GIT_SHA", "")})
        .workdir(WORKDIR)
        .add_local_dir(
            str(project_root / "data_inputs" / "living_standards"),
            f"{WORKDIR}/data_inputs/living_standards",
        )
        .add_local_python_source("uk_budget_data", ignore=PACKAGE_IGNORE)
    )


app = modal.App(APP_NAME, image=build_image())


@app.function(
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=TIMEOUT_S,
    retries=RETRIES,
    max_containers=MAX_CONTAINERS,
    secrets=[
        modal.Secret.from_name(HF_SECRET, required_keys=["HUGGING_FACE_TOKEN"])
    ],
)
def run_outlook() -> dict:
    """The projections and the outlook's text, as a local run makes them."""
    import json

    from uk_budget_data.living_standards import INPUTS_DIR
    from uk_budget_data.living_standards.build import (
        build_outlook,
        outlook_text,
    )
    from uk_budget_data.living_standards.forecast import (
        POST_FILE_NAME,
        apply_post,
        read_saved_post,
    )
    from uk_budget_data.living_standards.hbai import OUTPUT_NAME as HBAI
    from uk_budget_data.living_standards.obr import RHDI_OUTPUT_NAME
    from uk_budget_data.living_standards.projections import run_projections

    projections = run_projections()
    outlook = build_outlook(
        projections,
        json.loads((INPUTS_DIR / HBAI).read_text()),
        json.loads((INPUTS_DIR / RHDI_OUTPUT_NAME).read_text()),
    )
    apply_post(outlook, read_saved_post(INPUTS_DIR / POST_FILE_NAME))
    return {"projections": projections, "text": outlook_text(outlook)}


def run_remote() -> dict:
    """Run :func:`run_outlook` in an ephemeral app and return its result."""
    with modal.enable_output(), app.run():
        return run_outlook.remote()
