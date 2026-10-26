"""The household route doesn't block the server, and reports its timing.

A household calculation takes seconds to minutes of CPU. Run on the event
loop (as ``async def`` calling the calculation directly), it held every
other request to the instance, ``/api/version`` included (seen on Cloud
Run on 15 October, on the since-removed ``/api/personal-impact`` route).
So ``/api/household-impact`` runs each calculation in a worker thread,
through its own limiter (``HOUSEHOLD_REQUESTS``), and reports in
Server-Timing how long it calculated and how long it waited for that
limiter.
"""

import asyncio
import threading
import time

import anyio
import httpx
import pytest

from uk_budget_data import api

HOLD_SECONDS = 0.3


class RecordingCalculation:
    """Stands in for the household calculation: holds its thread for a
    while, and records when each household's calculation started and
    ended."""

    def __init__(self):
        self.started = threading.Event()
        self.runs = []

    def __call__(self, data, requested=None):
        start = time.perf_counter()
        self.started.set()
        time.sleep(HOLD_SECONDS)
        self.runs.append(
            (data.household.employment_income, start, time.perf_counter())
        )
        return {"net_income": {}, "definitions": {}}


def client():
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    )


def post(session, income):
    return session.post(
        "/api/household-impact",
        json={
            "year": 2028,
            "household": {"employment_income": income, "salary_year": 2028},
            "include": [],
        },
    )


def test_version_answers_while_a_household_is_calculated(monkeypatch):
    calculation = RecordingCalculation()
    monkeypatch.setattr(api, "_household_impact", calculation)

    async def run():
        async with client() as session:
            household = asyncio.create_task(post(session, 30_000))
            # Wait until the calculation has really started.
            loop = asyncio.get_running_loop()
            assert await loop.run_in_executor(
                None, calculation.started.wait, 5
            )
            started = time.perf_counter()
            version = await session.get("/api/version")
            waited = time.perf_counter() - started
            running = not household.done()
            return version, waited, running, await household

    version, waited, running, response = asyncio.run(run())
    assert version.status_code == 200 and response.status_code == 200
    # The version came back while the calculation was still running.
    assert running
    assert waited < HOLD_SECONDS


def timing(response):
    """The Server-Timing entries, as {name: dur in ms or desc}."""
    entries = {}
    for entry in response.headers["server-timing"].split(", "):
        name, _, value = entry.partition(";")
        entries[name] = (
            float(value.split("=", 1)[1])
            if value.startswith("dur=")
            else value
        )
    return entries


@pytest.mark.parametrize("peak", [3 * 2**30, None])
def test_the_household_route_reports_its_time_and_memory(
    peak, monkeypatch, tmp_path
):
    """Server-Timing carries the calculation's own time, its wait for the
    limiter, and, where the container's cgroup reports it, the peak memory.
    With a limit of one, the second of two requests sent together waits
    for the first."""
    calculation = RecordingCalculation()
    monkeypatch.setattr(api, "_household_impact", calculation)
    monkeypatch.setattr(api, "HOUSEHOLD_REQUESTS", anyio.CapacityLimiter(1))
    path = tmp_path / "memory.peak"
    if peak is not None:
        path.write_text(f"{peak}\n")
    monkeypatch.setattr(api, "MEMORY_PEAK_FILES", (path,))

    async def run():
        async with client() as session:
            first = asyncio.create_task(post(session, 10_000))
            await asyncio.sleep(0.02)
            second = asyncio.create_task(post(session, 20_000))
            return await first, await second

    first, second = asyncio.run(run())
    assert first.status_code == second.status_code == 200
    assert [run[0] for run in calculation.runs] == [10_000, 20_000]
    held = HOLD_SECONDS * 1000
    for response in (first, second):
        entries = timing(response)
        assert entries["calculate"] >= held * 0.9
        if peak is None:
            assert "memory" not in entries
        else:
            assert entries["memory"] == 'desc="peak 3072 MiB"'
    # The second request queued behind the first's calculation.
    assert timing(first)["queue"] < held / 2
    assert timing(second)["queue"] >= held * 0.5
