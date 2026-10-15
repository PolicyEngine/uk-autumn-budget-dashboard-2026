"""A calculation spread over worker processes gives exactly what one
process gives, and the worker count follows the instance's CPUs."""

import os
import signal
import subprocess
import sys
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


def jobs_submitted(monkeypatch):
    """An event set once run_jobs has submitted every job and is waiting
    for them, with the pool they went to and its worker processes then."""
    event, seen = threading.Event(), {}
    real_wait = personal_impact.wait

    def waiting(futures, **kwargs):
        pool = personal_impact._pool
        seen.setdefault("pool", pool)
        seen.setdefault("processes", list(pool._processes.values()))
        seen.setdefault("timeout", kwargs.get("timeout"))
        event.set()
        return real_wait(futures, **kwargs)

    monkeypatch.setattr(personal_impact, "wait", waiting)
    return event, seen


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
    submitted, seen = jobs_submitted(monkeypatch)
    outcome = {}

    def calculate():
        try:
            outcome["results"] = calculator.calculate(household)
        except Exception as error:  # noqa: BLE001 - recorded for the test
            outcome["error"] = error

    thread = threading.Thread(target=calculate)
    thread.start()
    # Only once every job is submitted: a worker killed before that (an
    # idle one left by an earlier calculation, say) breaks the pool while
    # it is still being submitted to, and run_jobs rightly replaces it.
    assert submitted.wait(120)
    os.kill(seen["processes"][0].pid, signal.SIGKILL)
    thread.join(120)
    assert isinstance(outcome.get("error"), BrokenProcessPool)
    # The next calculation gets a new pool and succeeds.
    assert calculator.calculate(household)["policies"]


def test_a_calculation_past_its_deadline_is_abandoned(monkeypatch):
    household = small(monkeypatch)
    monkeypatch.setattr(personal_impact, "CALCULATION_TIMEOUT_SECONDS", 0.05)
    # A pool of its own, so every worker is one of this calculation's.
    personal_impact.shutdown_pool()
    submitted, seen = jobs_submitted(monkeypatch)
    with pytest.raises(TimeoutError):
        personal_impact.PersonalImpactCalculator(workers=2).calculate(
            household
        )
    # The pool was dropped and its workers stopped mid-job: a worker left
    # to finish its one job would exit by itself, with 0.
    assert personal_impact.worker_pool(2) is not seen["pool"]
    assert seen["processes"]
    for process in seen["processes"]:
        process.join(60)
        assert process.exitcode == -signal.SIGTERM


def test_the_deadline_counts_from_before_submission(monkeypatch):
    """A slow start (a cold forkserver, say) comes out of the calculation's
    time, not on top of it."""
    household = small(monkeypatch)
    real_pool = personal_impact.worker_pool

    def slow_pool(workers):
        time.sleep(0.5)
        return real_pool(workers)

    monkeypatch.setattr(personal_impact, "worker_pool", slow_pool)
    submitted, seen = jobs_submitted(monkeypatch)
    personal_impact.PersonalImpactCalculator(workers=2).calculate(household)
    assert seen["timeout"] <= (
        personal_impact.CALCULATION_TIMEOUT_SECONDS - 0.5
    )


def test_a_pool_shut_down_before_submission_is_replaced(monkeypatch):
    """Submitting to a shut-down pool raises RuntimeError, not
    BrokenProcessPool; the calculation still gets a new pool."""
    household = small(monkeypatch)
    pool = personal_impact.worker_pool(2)
    pool.shutdown(wait=True)
    results = personal_impact.PersonalImpactCalculator(workers=2).calculate(
        household
    )
    assert results["policies"]
    assert personal_impact.worker_pool(2) is not pool


def test_a_pool_discarded_twice_is_harmless():
    """A shut-down executor has no process table (_processes is None)."""
    pool = personal_impact.worker_pool(2)
    pool.submit(os.getpid).result()
    personal_impact.discard_pool(pool)
    personal_impact.discard_pool(pool)
    assert personal_impact.worker_pool(2) is not pool


def test_the_server_stops_its_workers_when_it_stops():
    """uvicorn re-raises SIGTERM after its graceful shutdown, so the
    interpreter dies by the signal and concurrent.futures' exit hook never
    runs; the app's lifespan stops the workers before that. A worker left
    alone would sleep on."""
    from fastapi.testclient import TestClient

    from uk_budget_data.api import app

    pool = personal_impact.worker_pool(2)
    busy = pool.submit(time.sleep, 60)
    processes = list(pool._processes.values())
    assert processes
    with TestClient(app):
        pass
    for process in processes:
        process.join(10)
        assert process.exitcode == -signal.SIGTERM
    assert busy.done()
    assert personal_impact._pool is None


# A server that starts a worker on a long job, prints its workers' and its
# forkserver's PIDs, and is then killed outright, so no shutdown hook runs.
SERVER_KILLED = """
import os, signal, time
import multiprocessing.forkserver as forkserver
from uk_budget_data import personal_impact
pool = personal_impact.worker_pool(2)
pool.submit(time.sleep, 600)
pids = list(pool._processes) + [forkserver._forkserver._forkserver_pid]
print(" ".join(str(pid) for pid in pids), flush=True)
os.kill(os.getpid(), signal.SIGKILL)
"""


def running(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_nothing_outlives_a_server_killed_outright(tmp_path):
    """Each worker watches the server and exits once it has gone; with no
    worker left holding its lifeline, the forkserver exits too. The killed
    server stays a zombie until subprocess.run reaps it, which a PID check
    would mistake for alive."""
    out, err = tmp_path / "pids.txt", tmp_path / "stderr.txt"
    with out.open("w") as stdout, err.open("w") as stderr:
        # Files, not pipes: an orphan holding a pipe would block the run.
        result = subprocess.run(
            [sys.executable, "-c", SERVER_KILLED],
            stdout=stdout,
            stderr=stderr,
            timeout=600,
        )
    pids = [int(pid) for pid in out.read_text().split()]
    try:
        assert result.returncode == -signal.SIGKILL, err.read_text()
        assert len(pids) >= 2
        deadline = time.monotonic() + 60
        left = pids
        while left and time.monotonic() < deadline:
            time.sleep(0.5)
            left = [pid for pid in left if running(pid)]
        assert not left
    finally:
        for pid in pids:
            if running(pid):
                os.kill(pid, signal.SIGKILL)
