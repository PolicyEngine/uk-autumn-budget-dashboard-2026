"""The household route doesn't block the server's other requests.

``/api/personal-impact`` takes minutes of CPU. Declared ``async def``, it
ran on the event loop, so a running calculation held every other request
to the instance, ``/api/version`` included (seen on Cloud Run on 15
October). As a plain ``def`` FastAPI runs it in its thread pool.
"""

import asyncio
import time

import httpx
import pytest

from uk_budget_data import api

SLOW_SECONDS = 1.0


class SlowCalculator:
    """Stands in for the calculator: holds its thread like the real one."""

    def calculate(self, household):
        time.sleep(SLOW_SECONDS)
        return {"years": {}, "policies": {}, "totals": {"cumulative": 0}}


@pytest.fixture
def slow_calculator(monkeypatch):
    monkeypatch.setattr(api, "get_calculator", lambda: SlowCalculator())


def test_version_answers_while_a_household_is_calculated(slow_calculator):
    async def run():
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            household = asyncio.create_task(
                client.post(
                    "/api/personal-impact", json={"employment_income": 30_000}
                )
            )
            # Let the calculation start before asking for the version.
            await asyncio.sleep(0.1)
            started = time.perf_counter()
            version = await client.get("/api/version")
            waited = time.perf_counter() - started
            done = household.done()
            response = await household
            return version, waited, done, response

    version, waited, done_when_version_answered, response = asyncio.run(run())
    assert version.status_code == 200
    assert response.status_code == 200
    # The version came back while the calculation was still running.
    assert not done_when_version_answered
    assert waited < SLOW_SECONDS / 2


@pytest.mark.parametrize("peak", [3 * 2**30, None])
def test_the_household_route_reports_its_time_and_memory(
    peak, monkeypatch, tmp_path
):
    """Server-Timing carries how long the calculation took and, where the
    container's cgroup reports it, its peak memory."""
    monkeypatch.setattr(api, "get_calculator", lambda: SlowCalculator())
    path = tmp_path / "memory.peak"
    if peak is not None:
        path.write_text(f"{peak}\n")
    monkeypatch.setattr(api, "MEMORY_PEAK_FILES", (path,))

    async def run():
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.post(
                "/api/personal-impact", json={"employment_income": 30_000}
            )

    response = asyncio.run(run())
    assert response.status_code == 200
    timing = response.headers["server-timing"]
    duration = float(timing.split("calculate;dur=")[1].split(",")[0])
    assert duration >= SLOW_SECONDS * 1000 * 0.9
    if peak is None:
        assert "memory" not in timing
    else:
        assert 'memory;desc="peak 3072 MiB"' in timing
