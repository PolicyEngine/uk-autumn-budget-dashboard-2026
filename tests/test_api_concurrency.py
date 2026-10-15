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
