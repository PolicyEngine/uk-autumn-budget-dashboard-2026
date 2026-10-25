"""The household route on Modal: the API as one web app, its simulations
fanned out, one container each, all at once.

On Cloud Run a household's detail (the split by policy, nine simulations,
and the earnings sweep, two) queues on the instance's few worker slots. Here
``_run_all`` sends each simulation to its own ``Household`` container
(``HOUSEHOLD_RUNNER=modal``), so the detail takes about one simulation's
time. The route builds one synthetic household from the answers: no survey
data and no Hugging Face token, so the data licence question does not arise.

Cost (Modal's published rates, 25 October 2026: $0.0473 per core-hour,
$0.008 per GiB-hour): no container is kept warm by default
(``MIN_CONTAINERS`` 0), so an idle app costs nothing; a container lives
``SCALEDOWN_SECONDS`` after its last call. Keeping containers warm is a
decision with a price (see the runbook), not a default.

    uv run --with modal modal deploy src/uk_budget_data/modal_household.py
    uv run --with modal modal app stop uk-budget-household   # when done
"""

import os
import time
from pathlib import Path

import modal

APP_NAME = "uk-budget-household"
# One core: a simulation runs on one thread, so a second core would add
# cost, not speed. Memory from the measured peak of one worker (about
# 0.4 GB) with headroom.
CPU = 1.0
MEMORY_MB = 1024
# Cloud Run's request limit; a household run takes seconds.
TIMEOUT_SECONDS = 300
# Eleven simulations at most per request; a twelfth container lets two
# requests overlap a little. A ceiling on what a burst can cost.
MAX_CONTAINERS = 12
# 0: nothing runs, and nothing is paid, while no one asks. Raise only for a
# set window (the webinar), knowing the price.
MIN_CONTAINERS = int(os.environ.get("HOUSEHOLD_MODAL_MIN_CONTAINERS", "0"))
SCALEDOWN_SECONDS = 120


def build_image() -> modal.Image:
    """The image, from the repository the command runs in; in a container
    it is already built, and this stands in for it."""
    if not modal.is_local():
        return modal.Image.debian_slim()
    root = Path(__file__).resolve().parents[2]
    return (
        modal.Image.debian_slim(
            python_version=(root / ".python-version").read_text().strip()
        )
        .uv_sync(str(root), frozen=True)
        .env(
            {
                "NUMEXPR_MAX_THREADS": "1",
                "OMP_NUM_THREADS": "1",
                "HOUSEHOLD_RUNNER": "modal",
                "HOUSEHOLD_WORKERS": "1",
                "GIT_SHA": os.environ.get("GIT_SHA", ""),
            }
        )
        .workdir("/root")
        .add_local_dir(str(root / "data_inputs"), "/root/data_inputs")
        # The whole package directory: its data files (budget_years.json
        # and the like) as well as its modules, which
        # add_local_python_source alone would leave out.
        .add_local_dir(
            str(root / "src" / "uk_budget_data"),
            "/root/uk_budget_data",
            ignore=["**/__pycache__/**"],
        )
    )


app = modal.App(APP_NAME, image=build_image())


@app.cls(
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=TIMEOUT_SECONDS,
    max_containers=MAX_CONTAINERS,
    min_containers=MIN_CONTAINERS,
    scaledown_window=SCALEDOWN_SECONDS,
    retries=0,
)
class Household:
    """One simulation per call, in a container that loaded the engine and
    ran one household as it started."""

    @modal.enter()
    def warm(self):
        # Kept and returned by each call rather than raised: a start-up that
        # raises makes Modal restart the container again and again.
        import traceback

        self.start_error = None
        try:
            from uk_budget_data import household_impact as hi

            people, benunit, household = hi.household_entities(
                hi.HouseholdAnswers(), 2027
            )
            sides = hi.measure_sides(hi.measure_ids())
            hi.run_scenario(people, benunit, household, 2027, sides.before)
        except Exception:
            self.start_error = traceback.format_exc()

    @modal.method()
    def run(self, job: tuple) -> dict:
        if self.start_error:
            raise RuntimeError(
                f"Container start-up failed:\n{self.start_error}"
            )
        from uk_budget_data import household_impact as hi

        return hi.run_scenario(*job)


def fan_out(jobs: list) -> list:
    """Each job in its own ``Household`` container, at once, in order."""
    started = time.perf_counter()
    results = list(Household().run.map(jobs))
    print(
        f"household fan-out: {len(jobs)} runs in {time.perf_counter() - started:.1f} s"
    )
    return results


@app.function(
    cpu=1.0,
    memory=MEMORY_MB,
    timeout=TIMEOUT_SECONDS,
    max_containers=4,
    min_containers=MIN_CONTAINERS and 1,
    scaledown_window=SCALEDOWN_SECONDS,
)
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def web():
    """The same API as on Cloud Run, its runs fanned out (``fan_out``)."""
    import sys

    # Modal loads this file as the app's own module, the one whose
    # functions it has connected to the running app. household_impact
    # imports uk_budget_data.modal_household by name, which would load a
    # second, unconnected copy: point the name at this one.
    sys.modules["uk_budget_data.modal_household"] = sys.modules[__name__]
    from uk_budget_data.api import app as api

    return api
