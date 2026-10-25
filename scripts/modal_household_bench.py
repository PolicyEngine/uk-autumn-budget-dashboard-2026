"""Time the household detail fanned out on Modal: one container per
simulation, the engine imported and warmed in each container's start-up.

No survey data: the household route builds one synthetic household from
the answers, so the image needs no dataset and no Hugging Face token.

    uv run --with modal python scripts/modal_household_bench.py
"""

import json
import os
import sys
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
CPU = float(os.environ.get("MODAL_HOUSEHOLD_CPU", "2"))


def build_image() -> modal.Image:
    """The image, from the repository where the script runs; in a container
    it is already built and this stands in for it."""
    if not modal.is_local():
        return modal.Image.debian_slim()
    return (
        modal.Image.debian_slim(
            python_version=(ROOT / ".python-version").read_text().strip()
        )
        .uv_sync(str(ROOT), frozen=True)
        .env({"NUMEXPR_MAX_THREADS": "1", "OMP_NUM_THREADS": "1"})
        .workdir("/root")
        .add_local_dir(str(ROOT / "data_inputs"), "/root/data_inputs")
        # The whole package directory: its data files (budget_years.json and
        # the like) as well as its Python modules, which
        # add_local_python_source alone would leave out.
        .add_local_dir(
            str(ROOT / "src" / "uk_budget_data"),
            "/root/uk_budget_data",
            ignore=["**/__pycache__/**"],
        )
    )


image = build_image()
app = modal.App("uk-budget-household-bench", image=image)


@app.cls(cpu=CPU, memory=2048, timeout=300, scaledown_window=60, retries=0)
class Household:
    @modal.enter()
    def warm(self):
        # A start-up error is kept and returned by the first call, never
        # raised here: a raising start-up makes Modal restart the container
        # over and over.
        import traceback

        self.warm_seconds = -1.0
        self.start_error = None
        t = time.perf_counter()
        try:
            from uk_budget_data import household_impact as hi

            answers = hi.HouseholdAnswers()
            people, benunit, household = hi.household_entities(answers, 2027)
            sides = hi.measure_sides(hi.measure_ids())
            hi.run_scenario(people, benunit, household, 2027, sides.before)
        except Exception:
            self.start_error = traceback.format_exc()
        self.warm_seconds = time.perf_counter() - t

    @modal.method()
    def run(self, job):
        import traceback

        if self.start_error:
            return {"error": self.start_error}, 0.0, self.warm_seconds
        from uk_budget_data import household_impact as hi

        t = time.perf_counter()
        try:
            out = hi.run_scenario(*job)
        except Exception:
            return {"error": traceback.format_exc()}, 0.0, self.warm_seconds
        return out, time.perf_counter() - t, self.warm_seconds


def jobs_for(answers, year, part):
    from uk_budget_data import household_impact as hi

    sides = hi.measure_sides(hi.measure_ids())
    people, benunit, household = hi.household_entities(answers, year)
    salary, _ = hi.salaries_in(answers, year)

    def job(side, axes=None, net_only=False):
        return (people, benunit, household, year, side, axes, net_only)

    if part == "by_policy":
        return [job(sides.singles[i], net_only=True) for i in sides.included]
    if part == "sweep":
        axes, _ = hi.sweep_axes(salary)
        return [job(sides.before, axes, True), job(sides.after, axes, True)]
    return [job(sides.before), job(sides.after)]


def main():
    from uk_budget_data import household_impact as hi

    answers = hi.HouseholdAnswers(
        age=30,
        employment_income=34_200,
        region="NORTH_WEST",
        tenure="RENT_PRIVATELY",
        monthly_rent=975,
        claims_universal_credit=True,
        petrol_spending=620,
        diesel_spending=340,
    )
    rows = []
    with modal.enable_output(), app.run():
        worker = Household()
        # One short call first: a container that cannot start stops the run
        # here, rather than a fan-out of containers failing to start.
        probe = worker.run.remote(jobs_for(answers, 2027, "sweep")[0])
        if "error" in probe[0]:
            print(probe[0]["error"][-3000:])
            return 1
        print(
            json.dumps(
                {
                    "probe_sim_s": round(probe[1], 2),
                    "container_warmup_s": round(probe[2], 2),
                }
            ),
            flush=True,
        )
        for round_ in ("cold", "warm", "warm again"):
            for part in ("by_policy", "sweep"):
                jobs = jobs_for(answers, 2027, part)
                t = time.perf_counter()
                results = list(worker.run.map(jobs))
                if part == "by_policy":
                    remote_by_policy = [r[0] for r in results]
                wall = time.perf_counter() - t
                errors = [r[0]["error"] for r in results if "error" in r[0]]
                if errors:
                    print(errors[0][-3000:])
                    return 1
                sims = [r[1] for r in results]
                rows.append(
                    {
                        "round": round_,
                        "part": part,
                        "simulations": len(jobs),
                        "wall_s": round(wall, 2),
                        "slowest_sim_s": round(max(sims), 2),
                        "container_warmup_s": round(
                            max(r[2] for r in results), 2
                        ),
                    }
                )
                print(json.dumps(rows[-1]), flush=True)
    # The local answer for the same jobs, to check Modal's are identical.
    local = [hi.run_scenario(*j) for j in jobs_for(answers, 2027, "by_policy")]
    print("identical to local:", local == remote_by_policy)


if __name__ == "__main__":
    sys.exit(main())
