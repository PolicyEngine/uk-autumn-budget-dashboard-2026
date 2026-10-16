"""A calculation spread over worker processes gives exactly what one
process gives, and the worker count follows the instance's CPUs."""

import asyncio
import json
import multiprocessing.forkserver
import multiprocessing.process
import multiprocessing.resource_tracker
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil
import pytest

import uk_budget_data
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
    assert json.dumps(parallel) == json.dumps(serial)
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


def record_pid(kind, pid):
    """Keep an optional audit of only the processes these tests start."""
    if pid is not None and (path := os.environ.get("WORKER_PID_LOG")):
        with open(path, "a") as output:
            output.write(f"{kind} {pid}\n")


def stop_owned_processes(processes):
    """Emergency cleanup independent of the runner's tracking lock."""
    for process in processes:
        if process.is_alive():
            process.kill()
    for process in processes:
        process.join(5)


@pytest.fixture(autouse=True)
def started_processes(monkeypatch):
    """Record owned workers and stop them even when a cleanup mutant fails.

    The forkserver and resource tracker belong to this pytest invocation;
    record them too, but leave them available for subsequent tests.
    """
    processes = []
    real_start = multiprocessing.process.BaseProcess.start
    forkserver = multiprocessing.forkserver._forkserver
    resource_tracker = multiprocessing.resource_tracker._resource_tracker
    real_forkserver_ensure = forkserver.ensure_running
    real_tracker_ensure = multiprocessing.resource_tracker.ensure_running

    def ensure_forkserver():
        try:
            return real_forkserver_ensure()
        finally:
            record_pid("forkserver", forkserver._forkserver_pid)
            record_pid("resource_tracker", resource_tracker._pid)

    def ensure_tracker():
        try:
            return real_tracker_ensure()
        finally:
            record_pid("resource_tracker", resource_tracker._pid)

    def start(process):
        real_start(process)
        processes.append(process)
        record_pid("worker", process.pid)
        record_pid(
            "forkserver",
            multiprocessing.forkserver._forkserver._forkserver_pid,
        )
        record_pid(
            "resource_tracker",
            multiprocessing.resource_tracker._resource_tracker._pid,
        )

    # Process.start can wait for a cold forkserver's engine preload. Audit
    # helpers as soon as launched so a startup timeout still owns their PIDs.
    monkeypatch.setattr(forkserver, "ensure_running", ensure_forkserver)
    monkeypatch.setattr(
        multiprocessing.resource_tracker, "ensure_running", ensure_tracker
    )
    monkeypatch.setattr(resource_tracker, "ensure_running", ensure_tracker)
    monkeypatch.setattr(multiprocessing.process.BaseProcess, "start", start)
    try:
        yield processes
    finally:
        # A cleanup mutant can block in join while holding _workers_lock.
        # Reap our recorded children before asking the tracker to stop them.
        stop_owned_processes(processes)
        personal_impact.stop_workers()


def wait_for_workers(count, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        processes = personal_impact.live_workers()
        if len(processes) >= count:
            return processes
        time.sleep(0.01)
    pytest.fail(f"{count} workers did not start")


def test_each_job_runs_in_a_process_of_its_own():
    # Cold engine preload is setup, separate from the four calls below.
    personal_impact.run_in_workers(1, [(os.getpid, ())], 180)
    pids = personal_impact.run_in_workers(2, [(os.getpid, ())] * 4, 60)
    assert os.getpid() not in pids
    assert len(set(pids)) == 4
    assert personal_impact.live_workers() == []


def test_workers_import_this_worktree():
    package = Path(__file__).resolve().parents[1] / "src" / "uk_budget_data"
    expected = (package / "__init__.py", package / "personal_impact.py")
    assert (
        Path(uk_budget_data.__file__).resolve(),
        Path(personal_impact.__file__).resolve(),
    ) == expected
    [worker_paths] = personal_impact.run_in_workers(
        1,
        [
            (
                eval,
                (
                    "(__import__('uk_budget_data').__file__, "
                    "__import__('uk_budget_data.personal_impact', "
                    "fromlist=['personal_impact']).__file__)",
                ),
            )
        ],
        60,
    )
    assert tuple(Path(path).resolve() for path in worker_paths) == expected


def test_results_come_back_in_call_order():
    # The sleeping call finishes last but must retain its first position.
    assert personal_impact.run_in_workers(
        2,
        [(time.sleep, (0.3,)), (int, ("42",)), (str, ("last",))],
        60,
    ) == [None, 42, "last"]
    assert personal_impact.live_workers() == []


def test_a_call_error_stops_its_other_workers(started_processes):
    with pytest.raises(ValueError, match="invalid literal"):
        personal_impact.run_in_workers(
            2, [(time.sleep, (60,)), (int, ("invalid",))], 10
        )
    assert len(started_processes) == 2
    assert all(process.exitcode is not None for process in started_processes)
    assert personal_impact.live_workers() == []


def raise_unpicklable_error():
    error = ValueError("unpicklable error")
    error.unpicklable = lambda: None
    raise error


def test_an_unpicklable_error_becomes_a_runtime_error():
    with pytest.raises(RuntimeError, match="ValueError.*unpicklable error"):
        personal_impact.run_in_workers(1, [(raise_unpicklable_error, ())], 10)
    assert personal_impact.live_workers() == []


def test_a_worker_dying_mid_call_fails_only_that_run():
    # Warm the forkserver before the deliberately short death deadline.
    personal_impact.run_in_workers(1, [(os.getpid, ())], 180)
    # Short timeout: retaining the parent's writer must fail with TimeoutError
    # rather than leave this test waiting forever for the missing EOF.
    error = None
    try:
        personal_impact.run_in_workers(1, [(os._exit, (1,))], 2)
    except Exception as caught:
        error = caught
    assert isinstance(error, personal_impact.WorkerDied), repr(error)
    assert "0" in str(error)
    assert personal_impact.live_workers() == []
    [pid] = personal_impact.run_in_workers(1, [(os.getpid, ())], 60)
    assert pid != os.getpid()
    assert personal_impact.live_workers() == []


def test_an_oserror_reading_a_result_means_the_worker_died(monkeypatch):
    context = personal_impact._worker_context()
    real_pipe = context.Pipe

    def fail_recv():
        raise OSError("broken worker result pipe")

    def pipe(*args, **kwargs):
        reader, writer = real_pipe(*args, **kwargs)
        monkeypatch.setattr(reader, "recv", fail_recv)
        return reader, writer

    monkeypatch.setattr(context, "Pipe", pipe)
    monkeypatch.setattr(personal_impact, "_worker_context", lambda: context)
    with pytest.raises(personal_impact.WorkerDied, match="0") as error:
        personal_impact.run_in_workers(1, [(os.getpid, ())], 60)
    assert isinstance(error.value.__cause__, OSError)
    assert personal_impact.live_workers() == []


def test_a_calculation_past_its_deadline_is_abandoned(started_processes):
    # Startup is covered separately; this test needs two sleeping workers.
    personal_impact.run_in_workers(1, [(os.getpid, ())], 180)
    seen = {}
    seen_lock = threading.Lock()
    stop = threading.Event()
    outcome = {}

    def watch():
        while not stop.wait(0.005):
            for process in personal_impact.live_workers():
                with seen_lock:
                    seen[process.pid] = process

    def run():
        try:
            personal_impact.run_in_workers(2, [(time.sleep, (60,))] * 2, 2)
        except Exception as error:
            outcome["error"] = error

    watcher = threading.Thread(target=watch, daemon=True)
    runner = threading.Thread(target=run, daemon=True)
    watcher.start()
    started = time.monotonic()
    runner.start()
    try:
        runner.join(10)
        finished = not runner.is_alive()
        elapsed = time.monotonic() - started
        with seen_lock:
            exitcodes = {
                pid: process.exitcode for pid, process in seen.items()
            }
    finally:
        stop.set()
        # Freeze the observations above before emergency cleanup can hide
        # missing SIGKILLs. This also releases a mutant blocked in join.
        stop_owned_processes(started_processes)
        runner.join(5)
        watcher.join(5)
    assert finished, "Worker runner did not finish within its test deadline"
    assert elapsed < 30
    assert isinstance(outcome.get("error"), TimeoutError), repr(outcome)
    assert len(exitcodes) == 2
    assert all(code == -signal.SIGKILL for code in exitcodes.values())
    assert personal_impact.live_workers() == []


def test_run_jobs_maps_calls_and_passes_the_calculation_deadline(
    monkeypatch,
):
    seen = {}

    def run(workers, calls, timeout):
        seen.update(workers=workers, calls=calls, timeout=timeout)
        return ["result"]

    monkeypatch.setattr(personal_impact, "run_in_workers", run)
    monkeypatch.setattr(personal_impact, "CALCULATION_TIMEOUT_SECONDS", 17)
    situation, years, scenario = {"people": {}}, [2026], "scenario"
    assert personal_impact.run_jobs(
        2, [(years, situation, "unused", scenario)]
    ) == ["result"]
    assert seen == {
        "workers": 2,
        "calls": [
            (personal_impact.simulate_years, (situation, years, scenario))
        ],
        "timeout": 17,
    }


def test_the_deadline_counts_from_before_submission(monkeypatch):
    """A slow Process.start uses the same deadline as the jobs it starts."""
    personal_impact.run_in_workers(1, [(os.getpid, ())], 60)
    real_start = multiprocessing.process.BaseProcess.start

    def slow_start(process):
        time.sleep(0.3)
        real_start(process)

    monkeypatch.setattr(
        multiprocessing.process.BaseProcess, "start", slow_start
    )
    monkeypatch.setattr(personal_impact, "simulate_years", pow)
    monkeypatch.setattr(personal_impact, "CALCULATION_TIMEOUT_SECONDS", 0.1)
    with pytest.raises(TimeoutError):
        personal_impact.run_jobs(1, [(2, 10, "unused", 7)])
    assert personal_impact.live_workers() == []


def test_concurrent_runs_own_their_workers():
    outcome = {}

    def run():
        try:
            outcome["result"] = personal_impact.run_in_workers(
                1, [(time.sleep, (1,))], 10
            )
        except Exception as error:
            outcome["error"] = error

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        [process] = wait_for_workers(1)
        with pytest.raises(ValueError):
            personal_impact.run_in_workers(1, [(int, ("invalid",))], 10)
        # Failing a separate run does not kill this run's process.
        assert process.exitcode != -signal.SIGKILL
        thread.join(15)
        assert not thread.is_alive()
        assert outcome == {"result": [None]}
        assert personal_impact.live_workers() == []
    finally:
        personal_impact.stop_workers()
        thread.join(10)


@pytest.mark.parametrize("body_raises", [False, True])
def test_the_server_stops_its_workers_when_it_stops(body_raises):
    from fastapi.testclient import TestClient

    from uk_budget_data.api import app, lifespan

    outcome = {}

    def run():
        try:
            personal_impact.run_in_workers(1, [(time.sleep, (60,))], 120)
        except Exception as error:
            outcome["error"] = error

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        [process] = wait_for_workers(1)
        if body_raises:

            async def failed_lifespan():
                async with lifespan(app):
                    raise ValueError("lifespan body failed")

            with pytest.raises(ValueError, match="lifespan body failed"):
                asyncio.run(failed_lifespan())
        else:
            with TestClient(app):
                pass
        thread.join(5)
        assert process.exitcode == -signal.SIGKILL
        assert not thread.is_alive()
        assert isinstance(outcome.get("error"), personal_impact.WorkerDied)
        assert personal_impact.live_workers() == []
    finally:
        personal_impact.stop_workers()
        thread.join(10)


@pytest.mark.parametrize(
    "pause_stage, expected_started",
    [("context_setup", 0), ("second_process", 1)],
)
def test_shutdown_cancels_a_run_before_its_next_worker_starts(
    monkeypatch, started_processes, pause_stage, expected_started
):
    context = personal_impact._worker_context()
    real_process = context.Process
    paused = threading.Event()
    release = threading.Event()
    constructed = 0
    context_calls = 0
    outcome = {}

    def worker_context():
        nonlocal context_calls
        context_calls += 1
        if pause_stage == "context_setup" and context_calls == 1:
            paused.set()
            assert release.wait(30), "Context setup was never released"
        return context

    def process(*args, **kwargs):
        nonlocal constructed
        constructed += 1
        if pause_stage == "second_process" and constructed == 2:
            paused.set()
            assert release.wait(30), "Second worker was never released"
        return real_process(*args, **kwargs)

    def run():
        try:
            outcome["result"] = personal_impact.run_in_workers(
                1, [(os.getpid, ())] * 2, 60
            )
        except Exception as error:
            outcome["error"] = error

    monkeypatch.setattr(context, "Process", process)
    monkeypatch.setattr(personal_impact, "_worker_context", worker_context)
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        assert paused.wait(30), f"Runner never paused during {pause_stage}"
        personal_impact.stop_workers()
        release.set()
        thread.join(10)
        assert not thread.is_alive()
        assert isinstance(outcome.get("error"), personal_impact.WorkerDied)
        assert f"call {expected_started}" in str(outcome["error"])
        assert len(started_processes) == expected_started
        assert personal_impact.live_workers() == []
        [pid] = personal_impact.run_in_workers(1, [(os.getpid, ())], 60)
        assert pid != os.getpid()
        assert personal_impact.live_workers() == []
    finally:
        release.set()
        stop_owned_processes(started_processes)
        thread.join(10)
        personal_impact.stop_workers()


# A real script is importable as __mp_main__ in a forkserver child. The
# worker acknowledges entering its helper before the server kills itself;
# a worker that failed while unpickling would otherwise pass this test.
SERVER_KILLED = """
import multiprocessing.forkserver
import multiprocessing.resource_tracker
import os
from pathlib import Path
import signal
import sys
import threading
import time


def record(kind, pid, path):
    if pid is not None:
        with open(path, "a") as output:
            output.write(f"{kind} {pid}\\n")
        audit = os.environ.get("WORKER_PID_LOG")
        if audit:
            with open(audit, "a") as output:
                output.write(f"server_{kind} {pid}\\n")


def sleeping_job(started_path, pid_path):
    record("worker", os.getpid(), pid_path)
    Path(started_path).write_text(str(os.getpid()))
    time.sleep(600)


if __name__ == "__main__":
    pid_path, started_path = sys.argv[1:]
    record("server", os.getpid(), pid_path)
    from uk_budget_data import personal_impact

    forkserver = multiprocessing.forkserver._forkserver
    resource_tracker = multiprocessing.resource_tracker._resource_tracker
    real_forkserver_ensure = forkserver.ensure_running
    real_tracker_ensure = multiprocessing.resource_tracker.ensure_running

    def ensure_forkserver():
        try:
            return real_forkserver_ensure()
        finally:
            record("forkserver", forkserver._forkserver_pid, pid_path)
            record("resource_tracker", resource_tracker._pid, pid_path)

    def ensure_tracker():
        try:
            return real_tracker_ensure()
        finally:
            record("resource_tracker", resource_tracker._pid, pid_path)

    forkserver.ensure_running = ensure_forkserver
    multiprocessing.resource_tracker.ensure_running = ensure_tracker
    resource_tracker.ensure_running = ensure_tracker

    def run():
        personal_impact.run_in_workers(
            1, [(sleeping_job, (started_path, pid_path))], 660
        )

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    recorded = set()
    deadline = time.monotonic() + 180
    while True:
        pids = [
            ("worker", process.pid)
            for process in personal_impact.live_workers()
        ] + [
            (
                "forkserver",
                multiprocessing.forkserver._forkserver._forkserver_pid,
            ),
            (
                "resource_tracker",
                multiprocessing.resource_tracker._resource_tracker._pid,
            ),
        ]
        for kind, pid in pids:
            if pid is not None and pid not in recorded:
                record(kind, pid, pid_path)
                recorded.add(pid)
        if Path(started_path).exists():
            break
        if not thread.is_alive() or time.monotonic() >= deadline:
            raise RuntimeError("Worker never acknowledged starting its job")
        time.sleep(0.01)
    os.kill(os.getpid(), signal.SIGKILL)
"""


def running(pid):
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def test_nothing_outlives_a_server_killed_outright(tmp_path, monkeypatch):
    script = tmp_path / "server.py"
    script.write_text(SERVER_KILLED)
    pids_path, started_path = tmp_path / "pids.txt", tmp_path / "started.txt"
    out, err = tmp_path / "stdout.txt", tmp_path / "stderr.txt"
    server_pids = []
    real_popen = subprocess.Popen

    def popen(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        server_pids.append(process.pid)
        record_pid("server", process.pid)
        return process

    monkeypatch.setattr(subprocess, "Popen", popen)

    def recorded_pids():
        if not pids_path.exists():
            return {}
        records = {}
        for line in pids_path.read_text().splitlines():
            fields = line.split()
            # A timed-out server can be killed while appending a record.
            if len(fields) == 2 and fields[1].isdigit():
                records[int(fields[1])] = fields[0]
        return records

    try:
        with out.open("w") as stdout, err.open("w") as stderr:
            # File output cannot be held open by an orphan as a pipe can.
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    str(pids_path),
                    str(started_path),
                ],
                stdout=stdout,
                stderr=stderr,
                # Allow the cold server import and forkserver preload;
                # orphan detection below still has its own short deadline.
                timeout=300,
            )
        assert result.returncode == -signal.SIGKILL, err.read_text()
        records = recorded_pids()
        assert started_path.exists(), err.read_text()
        assert records[int(started_path.read_text())] == "worker"
        if "forkserver" in multiprocessing.get_all_start_methods():
            assert "forkserver" in records.values(), err.read_text()
        deadline = time.monotonic() + 10
        left = list(records)
        while left and time.monotonic() < deadline:
            time.sleep(0.05)
            left = [pid for pid in left if running(pid)]
        assert (
            not left
        ), f"Processes outlived server: {left}; {err.read_text()}"
    finally:
        pids = set(recorded_pids()) | set(server_pids)
        for pid in pids:
            if running(pid):
                os.kill(pid, signal.SIGKILL)
        deadline = time.monotonic() + 5
        while (
            any(running(pid) for pid in pids) and time.monotonic() < deadline
        ):
            time.sleep(0.05)
