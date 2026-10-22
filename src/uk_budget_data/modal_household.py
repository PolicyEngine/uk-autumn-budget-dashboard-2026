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

Deploy from a commit on main with the "Deploy the household impact app"
workflow (``deploy-household-impact.yml``), which runs::

    modal deploy src/uk_budget_data/modal_household.py
"""

import os
from pathlib import Path

import modal

APP_NAME = "uk-budget-2026-household-impact"
# The repository: pyproject.toml and uv.lock
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_VERSION = (PROJECT_ROOT / ".python-version").read_text().strip()
# Idle seconds before a container stops; none run while nobody asks
SCALEDOWN_WINDOW = 15 * 60
MAX_CONTAINERS = 20
# The year the snapshot's warm-up household is calculated in
WARMUP_YEAR = 2029

image = (
    modal.Image.debian_slim(python_version=PYTHON_VERSION)
    .uv_sync(str(PROJECT_ROOT), frozen=True)
    .env({"GIT_SHA": os.environ.get("GIT_SHA", "")})
    .add_local_python_source("uk_budget_data")
)

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
