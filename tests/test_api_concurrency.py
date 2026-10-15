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


def client():
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    )


def post(session, income):
    return session.post(
        "/api/personal-impact", json={"employment_income": income}
    )


def test_version_answers_while_a_household_is_calculated(monkeypatch):
    calculator = RecordingCalculator()
    monkeypatch.setattr(api, "get_calculator", lambda: calculator)

    async def run():
        async with client() as session:
            household = asyncio.create_task(post(session, 30_000))
            # Wait until the calculation has really started.
            loop = asyncio.get_running_loop()
            assert await loop.run_in_executor(None, calculator.started.wait, 5)
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
