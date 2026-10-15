"""A calculation spread over worker processes gives exactly what one
process gives, and the worker count follows the instance's CPUs."""

import os
import signal
import threading
import time
from concurrent.futures.process import BrokenProcessPool

import pytest

from uk_budget_data import personal_impact
from uk_budget_data.personal_impact import HouseholdInput, household_workers


@pytest.mark.slow
def test_workers_give_exactly_the_serial_answer(monkeypatch):
    """Differential: the same household through two workers and through
    this process alone. Two of its children turn 25 within the years, so
    the workers share three situations' simulations; a 17-year-old turns
    18 in a year read after another. Years and measures are cut to keep
    it short; the PR has the full twelve-household comparison."""
    monkeypatch.setattr(personal_impact, "YEARS", [2025, 2026, 2028, 2030])
    monkeypatch.setattr(
        personal_impact,
        "POLICY_IDS",
        [
            "two_child_limit",
            "threshold_freeze_extension",
            "rail_fares_freeze",
            # A measure whose modifier changes households: it must reach
            # the workers (pickled by reference) and act there.
            "dividend_tax_increase_2pp",
        ],
    )
    household = HouseholdInput(
        employment_income=30_000,
        dividend_income=20_000,
        children_ages=[22, 24, 17, 3],
    )
    calls = []
    real_run_jobs = personal_impact.run_jobs

    def recording_run_jobs(workers, jobs):
        calls.append(workers)
        return real_run_jobs(workers, jobs)

    monkeypatch.setattr(personal_impact, "run_jobs", recording_run_jobs)
    assert (
        len(
            personal_impact.build_situations(
                household, [2025, 2026, 2028, 2030]
            )
        )
        == 3
    )
    serial = personal_impact.PersonalImpactCalculator(workers=1).calculate(
        household
    )
    parallel = personal_impact.PersonalImpactCalculator(workers=2).calculate(
        household
    )
    assert parallel == serial
    # The serial run used no workers; the parallel one did.
    assert calls == [2]
    assert any(
        serial["policies"]["dividend_tax_increase_2pp"]["years"][year][
            "net_income_change"
        ]
        for year in [2025, 2026, 2028, 2030]
    )
    assert any(
        serial["policies"][policy_id]["years"][year]["net_income_change"]
        for policy_id in ["two_child_limit", "threshold_freeze_extension"]
        for year in [2025, 2026, 2028, 2030]
    )


@pytest.mark.parametrize(
    "env, cpu_max, expected",
    [
        ("3", "200000 100000", 3),  # the setting wins
        ("0", None, 1),  # never fewer than one
        (None, "200000 100000", 2),  # Cloud Run's 2 vCPU quota
        (None, "400000 100000", 4),
        (None, "150000 100000", 1),  # a fraction rounds down
        (None, "max 100000", 1),  # no quota
        (None, None, 1),  # no cgroup: one process
        ("2.0", "200000 100000", 2),  # malformed: the quota decides
        ("two", None, 1),
    ],
)
def test_the_worker_count_follows_the_cpu_quota(
    env, cpu_max, expected, monkeypatch, tmp_path
):
    if env is None:
        monkeypatch.delenv("HOUSEHOLD_WORKERS", raising=False)
    else:
        monkeypatch.setenv("HOUSEHOLD_WORKERS", env)
    path = tmp_path / "cpu.max"
    if cpu_max is not None:
        path.write_text(cpu_max + "\n")
    monkeypatch.setattr(personal_impact, "CGROUP_CPU_MAX", path)
    assert household_workers() == expected


def small(monkeypatch):
    """Cut the years and measures, so a calculation takes seconds."""
    monkeypatch.setattr(personal_impact, "YEARS", [2026, 2027])
    monkeypatch.setattr(
        personal_impact, "POLICY_IDS", ["two_child_limit", "rail_fares_freeze"]
    )
    return HouseholdInput(employment_income=30_000, children_ages=[2, 5, 9])


def test_each_job_runs_in_a_process_of_its_own():
    """Workers are child processes, and each runs one job and exits
    (max_tasks_per_child=1), so nothing a build leaves behind carries over."""
    pool = personal_impact.worker_pool(2)
    pids = [pool.submit(os.getpid).result() for _ in range(4)]
    assert os.getpid() not in pids
    assert len(set(pids)) == 4


def test_a_pool_broken_between_calculations_is_replaced(monkeypatch):
    """A worker (or the forkserver) dying between calculations leaves the
    shared pool broken; the next calculation replaces it."""
    household = small(monkeypatch)
    pool = personal_impact.worker_pool(2)
    with pytest.raises(BrokenProcessPool):
        pool.submit(os._exit, 1).result()
    results = personal_impact.PersonalImpactCalculator(workers=2).calculate(
        household
    )
    assert results["policies"]
    assert personal_impact.worker_pool(2) is not pool


def test_a_worker_killed_mid_calculation_fails_only_that_calculation(
    monkeypatch,
):
    household = small(monkeypatch)
    calculator = personal_impact.PersonalImpactCalculator(workers=2)
    pool = personal_impact.worker_pool(2)
    outcome = {}

    def calculate():
        try:
            outcome["results"] = calculator.calculate(household)
        except Exception as error:  # noqa: BLE001 - recorded for the test
            outcome["error"] = error

    thread = threading.Thread(target=calculate)
    thread.start()
    deadline = time.monotonic() + 60
    while not pool._processes and time.monotonic() < deadline:
        time.sleep(0.01)
    os.kill(next(iter(pool._processes)), signal.SIGKILL)
    thread.join(120)
    assert isinstance(outcome.get("error"), BrokenProcessPool)
    # The next calculation gets a new pool and succeeds.
    assert calculator.calculate(household)["policies"]


def test_a_calculation_past_its_deadline_is_abandoned(monkeypatch):
    household = small(monkeypatch)
    monkeypatch.setattr(personal_impact, "CALCULATION_TIMEOUT_SECONDS", 0.05)
    pool = personal_impact.worker_pool(2)
    with pytest.raises(TimeoutError):
        personal_impact.PersonalImpactCalculator(workers=2).calculate(
            household
        )
    # Its workers were stopped and the pool dropped.
    assert personal_impact.worker_pool(2) is not pool
