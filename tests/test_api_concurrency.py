"""The household route doesn't block the server, and runs one calculation
at a time.

``/api/personal-impact`` takes minutes of CPU. Run on the event loop (as
``async def`` calling the calculator directly), a calculation held every
other request to the instance, ``/api/version`` included (seen on Cloud
Run on 15 October). Run in the thread pool without a limit, calculations
at once share the CPU and all finish together, later than each would
alone. So the route runs each in a worker thread, one at a time, in
arrival order.
"""

import asyncio
import threading
import time

import httpx
import pytest

from uk_budget_data import api

HOLD_SECONDS = 0.3


class RecordingCalculator:
    """Stands in for the calculator: holds its thread for a while, and
    records when each household's calculation started and ended."""

    def __init__(self):
        self.started = threading.Event()
        self.runs = []

    def calculate(self, household):
        start = time.perf_counter()
        self.started.set()
        time.sleep(HOLD_SECONDS)
        self.runs.append(
            (household.employment_income, start, time.perf_counter())
        )
        return {"years": {}, "policies": {}, "totals": {"cumulative": 0}}


class ControlledCalculator:
    """Hold each real worker until its test releases it explicitly."""

    def __init__(self, incomes):
        self.started = {income: threading.Event() for income in incomes}
        self.release = {income: threading.Event() for income in incomes}
        self.runs = []

    def calculate(self, household):
        income = household.employment_income
        started = time.perf_counter()
        self.started[income].set()
        if not self.release[income].wait(timeout=10):
            raise RuntimeError("The test did not release its calculation")
        self.runs.append((income, started, time.perf_counter()))
        return {"years": {}, "policies": {}, "totals": {"cumulative": 0}}

    def release_all(self):
        for event in self.release.values():
            event.set()


async def wait_until(predicate):
    """Wait for an observed state, with a generous failure bound."""

    async def poll():
        while not predicate():
            await asyncio.sleep(0.001)

    await asyncio.wait_for(poll(), timeout=5)


def client():
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    )


def post(session, income):
    return session.post(
        "/api/personal-impact", json={"employment_income": income}
    )


def test_version_answers_while_a_household_is_calculated(monkeypatch):
    calculator = ControlledCalculator([30_000])
    monkeypatch.setattr(api, "get_calculator", lambda: calculator)

    async def run():
        async with client() as session:
            household = asyncio.create_task(post(session, 30_000))
            try:
                await wait_until(calculator.started[30_000].is_set)
                version = await asyncio.wait_for(
                    session.get("/api/version"), timeout=5
                )
                # The calculation remains held until the independent route answers.
                assert not household.done()
                assert not calculator.runs
                calculator.release[30_000].set()
                return version, await household
            finally:
                calculator.release_all()
                await asyncio.gather(household, return_exceptions=True)

    version, response = asyncio.run(run())
    assert version.status_code == response.status_code == 200


def test_calculations_run_one_at_a_time_in_arrival_order(monkeypatch):
    calculator = RecordingCalculator()
    monkeypatch.setattr(api, "get_calculator", lambda: calculator)
    incomes = [10_000, 20_000, 30_000]

    async def run():
        async with client() as session:
            tasks = []
            for income in incomes:
                tasks.append(asyncio.create_task(post(session, income)))
                # Let each request arrive before the next is sent.
                await asyncio.sleep(0.02)
            return await asyncio.gather(*tasks)

    responses = asyncio.run(run())
    assert [r.status_code for r in responses] == [200, 200, 200]
    assert [run[0] for run in calculator.runs] == incomes
    # Each calculation starts only once the one before has ended.
    for (_, _, previous_end), (_, start, _) in zip(
        calculator.runs, calculator.runs[1:]
    ):
        assert start >= previous_end


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
    """The real limiter queues the second request; reported times cover
    the observed calculation and wait, independent of host scheduling."""
    calculator = ControlledCalculator([10_000, 20_000])
    monkeypatch.setattr(api, "get_calculator", lambda: calculator)
    path = tmp_path / "memory.peak"
    if peak is not None:
        path.write_text(f"{peak}\n")
    monkeypatch.setattr(api, "MEMORY_PEAK_FILES", (path,))

    async def run():
        elapsed = {}
        async with client() as session:

            async def measured(income):
                started = time.perf_counter()
                response = await post(session, income)
                elapsed[income] = (time.perf_counter() - started) * 1000
                return response

            tasks = []
            try:
                first = asyncio.create_task(measured(10_000))
                tasks.append(first)
                await wait_until(calculator.started[10_000].is_set)
                second = asyncio.create_task(measured(20_000))
                tasks.append(second)
                # Observe the actual limiter, rather than assuming a delay queued it.
                await wait_until(
                    lambda: api.CALCULATIONS.statistics().tasks_waiting == 1
                )
                assert not calculator.started[20_000].is_set()
                queued_at = time.perf_counter()
                version = await asyncio.wait_for(
                    session.get("/api/version"), timeout=5
                )
                assert version.status_code == 200
                assert not first.done() and not second.done()
                minimum_queue_ms = (time.perf_counter() - queued_at) * 1000
                calculator.release[10_000].set()
                first_response = await first
                await wait_until(calculator.started[20_000].is_set)
                calculator.release[20_000].set()
                second_response = await second
                return (
                    first_response,
                    second_response,
                    elapsed,
                    minimum_queue_ms,
                )
            finally:
                calculator.release_all()
                await asyncio.gather(*tasks, return_exceptions=True)

    first, second, elapsed, minimum_queue_ms = asyncio.run(run())
    assert first.status_code == second.status_code == 200
    assert [income for income, _, _ in calculator.runs] == [10_000, 20_000]
    assert calculator.runs[1][1] >= calculator.runs[0][2]
    for income, started, ended in calculator.runs:
        response = first if income == 10_000 else second
        entries = timing(response)
        # Header durations are rounded to whole milliseconds. Their sum cannot
        # exceed the complete request; calculation covers the held worker interval.
        assert entries["calculate"] + 1 >= (ended - started) * 1000
        assert entries["queue"] >= 0
        assert entries["calculate"] + entries["queue"] <= elapsed[income] + 1
        if peak is None:
            assert "memory" not in entries
        else:
            assert entries["memory"] == 'desc="peak 3072 MiB"'
    assert timing(second)["queue"] + 1 >= minimum_queue_ms
