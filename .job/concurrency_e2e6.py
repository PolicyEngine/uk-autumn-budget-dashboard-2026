"""Run a resource-admitted two- or three-measure national generation batch.

No model is imported in the launcher. Each member runs the certified, guarded
generator in its own interpreter and writes aggregate artifacts to scratch.
Use batch_wall_seconds once in the critical path; child durations overlap.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import e2e_common as common


JOB = Path(__file__).resolve().parent
WORKSPACE = JOB.parent
SERIAL = JOB / "outputs/serial-two-child/timings.json"
MEASURES = (
    "two_child_limit",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
)
MINIMUM_PEAK_GB = 18.6
RESERVE_GB = 5.0


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def resource_snapshot(required_memory_gb):
    fs = os.statvfs(JOB)
    vm = subprocess.check_output(["vm_stat"], text=True)
    match = re.search(r"page size of (\d+) bytes", vm)
    if match is None:
        raise RuntimeError("Cannot determine vm_stat page size")
    page_bytes = int(match.group(1))
    pages = {}
    for kind in ("free", "inactive"):
        match = re.search(r"Pages " + kind + r":\s+(\d+)", vm)
        if match is None:
            raise RuntimeError(f"Cannot determine vm_stat {kind} pages")
        pages[kind] = int(match.group(1))
    headroom = max(0.0, page_bytes * sum(pages.values()) / 1e9 - RESERVE_GB)
    load = os.getloadavg()[0]
    free_disk = fs.f_bavail * fs.f_frsize / 1e9
    checks = {
        "load1_at_most_110": load <= 110,
        "free_disk_at_least_55_decimal_gb": free_disk >= 55,
        "memory_headroom_sufficient": headroom >= required_memory_gb,
    }
    return {
        "utc": utc_now(),
        "load1": load,
        "free_disk_decimal_gb": free_disk,
        "memory_page_bytes": page_bytes,
        "memory_free_pages": pages["free"],
        "memory_inactive_pages": pages["inactive"],
        "memory_reserve_decimal_gb": RESERVE_GB,
        "memory_headroom_decimal_gb": headroom,
        "required_memory_decimal_gb": required_memory_gb,
        "checks": checks,
        "passed": all(checks.values()),
    }


def save_report(report, path):
    path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    common.event(
        "concurrency_report",
        count=report["count"],
        status=report["status"],
        output=str(path),
        batch_wall_seconds=report.get("batch_wall_seconds"),
    )


def wait_one(member):
    returncode = member["process"].wait()
    return {
        "measure": member["measure"],
        "pid": member["process"].pid,
        "returncode": returncode,
        "external_wall_seconds": time.perf_counter() - member["started"],
        "finished_utc": utc_now(),
    }


def terminate_children(members):
    for member in members:
        if member["process"].poll() is None:
            member["process"].terminate()
    for member in members:
        try:
            member["process"].wait(timeout=20)
        except subprocess.TimeoutExpired:
            member["process"].kill()
            member["process"].wait()


def run(count):
    common.configure_environment()
    report_path = JOB / f"concurrency-{count}.json"
    measured = json.loads(SERIAL.read_text())
    serial_peak = float(measured["peak_memory_decimal_gb"])
    if not math.isfinite(serial_peak) or serial_peak <= 0:
        raise RuntimeError("Completed serial timing has no valid measured memory peak")
    if measured["measure"] != "two_child_limit" or measured["years"] != list(range(2026, 2031)):
        raise RuntimeError("Serial reference is not the expected five-year two-child measure")
    if measured["refused"]:
        raise RuntimeError("Serial generation was refused; do not run a batch")
    per_process = max(MINIMUM_PEAK_GB, serial_peak)
    required = count * per_process
    report = {
        "count": count,
        "requested_measures": list(MEASURES[:count]),
        "serial_timing_file": str(SERIAL),
        "serial_measured_peak_decimal_gb": serial_peak,
        "minimum_per_process_decimal_gb": MINIMUM_PEAK_GB,
        "admission_per_process_decimal_gb": per_process,
        "required_batch_memory_decimal_gb": required,
        "status": "preflight",
        "children": [],
        "timing_note": (
            "Use batch_wall_seconds once for the measured critical path. "
            "Child wall times overlap and must not be summed with the batch."
        ),
    }
    try:
        common.reservation(f"concurrency-{count} snapshot")
        snapshot = resource_snapshot(required)
        report["resource_snapshot"] = snapshot
        common.event("concurrency_snapshot", count=count, **snapshot)
        if not snapshot["passed"]:
            report["status"] = "skipped_resource_gate"
            report["skip_reason"] = [name for name, passed in snapshot["checks"].items() if not passed]
            report["worker_processes_started"] = 0
            save_report(report, report_path)
            return 0
        common.gate(f"concurrency-{count} admission", memory_gb=required)
    except Exception as error:
        report.update(status="stopped_preflight", error=str(error), worker_processes_started=0)
        save_report(report, report_path)
        return 1

    logs = JOB / "logs"
    logs.mkdir(exist_ok=True)
    plans = []
    for measure in MEASURES[:count]:
        output = JOB / "outputs" / f"concurrency-{count}-{measure}"
        log = logs / f"concurrency-{count}-{measure}.log"
        if output.exists() or log.exists():
            raise RuntimeError(f"Preserving existing batch output or log for {measure}")
        plans.append((measure, output, log))

    members = []
    streams = []
    batch_started = time.perf_counter()
    report["batch_started_utc"] = utc_now()
    try:
        for measure, output, log in plans:
            # A refusal after a prior spawn must stop the batch cleanly. No
            # later child starts, and the exception path terminates survivors.
            common.reservation(f"concurrency-{count} launch {measure}")
            if dt.datetime.now(dt.timezone.utc) >= dt.datetime(2026, 10, 23, 15, 30, tzinfo=dt.timezone.utc):
                raise RuntimeError("15:30Z no-start boundary reached")
            stream = log.open("x")
            streams.append(stream)
            command = [sys.executable, "-B", "-u", str(JOB / "generate_e2e6.py"), measure, str(output)]
            started = time.perf_counter()
            process = subprocess.Popen(
                command,
                cwd=WORKSPACE,
                env=os.environ.copy(),
                stdout=stream,
                stderr=subprocess.STDOUT,
            )
            members.append({
                "measure": measure,
                "process": process,
                "started": started,
                "output": output,
                "log": log,
                "command": command,
            })
            common.event("concurrency_child_started", count=count, measure=measure, child_pid=process.pid)
        # All processes have started before any wait. A waiter per child
        # observes its own completion promptly even if another is slower.
        completions = {}
        pool = ThreadPoolExecutor(max_workers=count)
        try:
            futures = [pool.submit(wait_one, member) for member in members]
            for future in as_completed(futures):
                result = future.result()
                completions[result["measure"]] = result
                common.event("concurrency_child_finished", count=count, **result)
        finally:
            # Do not defer the outer cancellation handler until long-running
            # children finish; it terminates survivors and then reaps them.
            pool.shutdown(wait=False)
        report["batch_wall_seconds"] = time.perf_counter() - batch_started
        report["batch_finished_utc"] = utc_now()
        for member in members:
            child = completions[member["measure"]]
            child.update(output=str(member["output"]), log=str(member["log"]), command=member["command"])
            timing_path = member["output"] / "timings.json"
            if child["returncode"] == 0 and timing_path.is_file():
                timing = json.loads(timing_path.read_text())
                child.update(
                    peak_memory_bytes=timing["peak_memory_bytes"],
                    peak_memory_decimal_gb=timing["peak_memory_decimal_gb"],
                    timings=timing["timings"],
                    years_by_table=timing["years_by_table"],
                    refused=timing["refused"],
                )
                child["complete"] = (
                    timing["measure"] == child["measure"]
                    and not timing["refused"]
                    and len(timing["years_by_table"]) == 6
                    and all(years == list(range(2026, 2031)) for years in timing["years_by_table"].values())
                )
            else:
                child["complete"] = False
                partial_path = member["output"] / "partial-timings.json"
                if partial_path.is_file():
                    partial = json.loads(partial_path.read_text())
                    child.update(
                        partial_timing_file=str(partial_path),
                        peak_memory_decimal_gb=partial.get("peak_memory_decimal_gb"),
                        peak_is_for_incomplete_run=True,
                        stop_reason=partial.get("error"),
                    )
            report["children"].append(child)
        report["worker_processes_started"] = len(members)
        report["status"] = "completed" if all(child["complete"] for child in report["children"]) else "failed"
        save_report(report, report_path)
        return 0 if report["status"] == "completed" else 1
    except BaseException as error:
        terminate_children(members)
        report.update(
            status="stopped_batch",
            error=str(error),
            worker_processes_started=len(members),
            batch_wall_seconds=time.perf_counter() - batch_started,
            batch_finished_utc=utc_now(),
        )
        report["children"] = [{
            "measure": member["measure"],
            "pid": member["process"].pid,
            "returncode": member["process"].returncode,
            "external_wall_seconds_through_cleanup": time.perf_counter() - member["started"],
            "output": str(member["output"]),
            "log": str(member["log"]),
            "complete": False,
        } for member in members]
        save_report(report, report_path)
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        return 1
    finally:
        for stream in streams:
            stream.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("count", type=int, choices=(2, 3))
    sys.exit(run(parser.parse_args().count))
