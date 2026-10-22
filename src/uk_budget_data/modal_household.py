"""The household calculation on Modal, restored from a memory snapshot.

Serves ``household_impact_api.create_app()`` (``GET /health``, ``POST
/household-impact``) from the Modal app ``uk-budget-2026-household-impact``.
The Next.js route ``/api/household-impact`` forwards to it, from the URL in
its ``HOUSEHOLD_IMPACT_API_URL`` environment variable.

Cold starts restore a memory snapshot taken after policyengine.py and
policyengine-uk are imported and one household has been calculated under
every measure, so the tax-benefit system, its parameters and the formula
caches are already in memory: a new container answers its first request in
seconds instead of loading the models first. Each container answers one
request at a time; Modal adds containers under load (up to
``MAX_CONTAINERS``) and stops them after ``SCALEDOWN_WINDOW`` seconds idle.
The same pattern serves the child tax credit dashboards' household
calculators and the household API's Modal worker.

The image installs exactly what ``uv.lock`` pins (``uv_sync``), so the app
calculates with the same policyengine.py, policyengine-uk and
policyengine-core as the national figures.

Modal imports this module twice: where it is deployed from, with the
repository checked out, to define the image; and again in every container,
from /root/modal_household.py, with only the image's files. So the image is
defined only where the repository is (``modal.is_local()``): any other work
at import that needs the repository would deploy cleanly and then stop
every container from starting.

Deploy from a commit on main with the "Deploy the household impact app"
workflow (``deploy-household-impact.yml``), which runs::

    modal deploy src/uk_budget_data/modal_household.py
"""

import os
from pathlib import Path

import modal

APP_NAME = "uk-budget-2026-household-impact"
# Idle seconds before a container stops; none run while nobody asks
SCALEDOWN_WINDOW = 15 * 60
MAX_CONTAINERS = 20
# The year the snapshot's warm-up household is calculated in
WARMUP_YEAR = 2029
# Files of the package the image leaves out. Modal's default leaves out
# every file but .py, and the package reads budget_years.json on import.
PACKAGE_IGNORE = ["**/__pycache__/**"]


def build_image() -> modal.Image:
    """The image, defined from the repository where the app is deployed
    from. In a container it is already built, and this stands in for it."""
    if not modal.is_local():
        return modal.Image.debian_slim()
    # The repository: .python-version, pyproject.toml and uv.lock
    project_root = Path(__file__).resolve().parents[2]
    python_version = (project_root / ".python-version").read_text().strip()
    return (
        modal.Image.debian_slim(python_version=python_version)
        .uv_sync(str(project_root), frozen=True)
        .env({"GIT_SHA": os.environ.get("GIT_SHA", "")})
        .add_local_python_source("uk_budget_data", ignore=PACKAGE_IGNORE)
    )


image = build_image()

app = modal.App(APP_NAME, image=image)


@app.cls(
    cpu=2.0,
    memory=4096,
    enable_memory_snapshot=True,
    scaledown_window=SCALEDOWN_WINDOW,
    max_containers=MAX_CONTAINERS,
    timeout=120,
)
class HouseholdImpactApi:
    @modal.enter(snap=True)
    def load(self):
        """Import the models and calculate one household under every
        measure, so the snapshot holds them loaded and warm."""
        from uk_budget_data import household_impact

        household_impact.calculate_household_impact(
            household_impact.HouseholdAnswers(),
            household_impact.measure_ids(),
            WARMUP_YEAR,
        )

    @modal.asgi_app()
    def web(self):
        from uk_budget_data.household_impact_api import create_app

        return create_app()
