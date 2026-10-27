"""The Modal household service's deadline (27 October 2026): a clear 503
with Retry-After before Modal's 150 s web limit, not an empty answer."""

import asyncio
import json
import threading
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from uk_budget_data.household_deadline import (
    DEADLINE_SECONDS,
    RETRY_AFTER_SECONDS,
    StartingUpDeadline,
)


@pytest.fixture
def anyio_backend():
    # The wrapper uses asyncio, as Modal's ASGI server does
    return "asyncio"


def make_api(delay: float, finished: threading.Event):
    """An API like the real one (CORS inside), whose household route takes
    ``delay`` seconds in a worker thread, as the calculation does."""
    import anyio

    api = FastAPI()
    api.add_middleware(CORSMiddleware, allow_origins=["*"])

    def calculate():
        time.sleep(delay)
        finished.set()
        return {"net_income": {"change": 1.0}}

    @api.post("/api/household-impact")
    async def household():
        return await anyio.to_thread.run_sync(calculate)

    @api.post("/api/other")
    async def other():
        await asyncio.sleep(delay)
        return {"ok": True}

    return api


def client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def test_deadline_is_below_modals_web_limit():
    # Modal ends a web request that has not answered in 150 s
    assert DEADLINE_SECONDS + 30 < 150
    assert 0 < RETRY_AFTER_SECONDS <= 20


@pytest.mark.anyio
async def test_slow_request_gets_a_503_with_retry_after_and_cors():
    finished = threading.Event()
    app = StartingUpDeadline(make_api(0.5, finished), seconds=0.1)
    async with client(app) as c:
        started = time.perf_counter()
        response = await c.post(
            "/api/household-impact", json={}, headers={"Origin": "https://x"}
        )
        elapsed = time.perf_counter() - started
    assert response.status_code == 503
    assert elapsed < 0.4
    assert response.headers["retry-after"] == str(RETRY_AFTER_SECONDS)
    assert response.headers["access-control-allow-origin"] == "*"
    assert (
        "retry-after"
        in response.headers["access-control-expose-headers"].lower()
    )
    body = response.json()
    assert body["retry_after_seconds"] == RETRY_AFTER_SECONDS
    assert "starting up" in body["detail"]
    # The calculation was not stopped: it finishes, for the retry to reuse
    assert finished.wait(2)


@pytest.mark.anyio
async def test_prompt_request_passes_through_unchanged():
    finished = threading.Event()
    app = StartingUpDeadline(make_api(0.01, finished), seconds=1)
    async with client(app) as c:
        response = await c.post(
            "/api/household-impact", json={}, headers={"Origin": "https://x"}
        )
    assert response.status_code == 200
    assert response.json() == {"net_income": {"change": 1.0}}
    assert "retry-after" not in response.headers


@pytest.mark.anyio
async def test_other_routes_have_no_deadline():
    app = StartingUpDeadline(make_api(0.3, threading.Event()), seconds=0.05)
    async with client(app) as c:
        response = await c.post("/api/other")
        health = await c.get("/api/household-impact")
    assert response.status_code == 200
    # Only POST is watched (a GET is the API's own 405)
    assert health.status_code == 405


@pytest.mark.anyio
async def test_an_error_inside_the_deadline_is_the_apis_own():
    async def failing(scope, receive, send):
        raise RuntimeError("boom")

    app = StartingUpDeadline(failing, seconds=1)
    with pytest.raises(RuntimeError, match="boom"):
        await app(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/household-impact",
            },
            None,
            None,
        )


@pytest.mark.anyio
async def test_late_answer_is_dropped_after_the_503():
    sent = []

    async def slow(scope, receive, send):
        await asyncio.sleep(0.2)
        await send(
            {"type": "http.response.start", "status": 200, "headers": []}
        )
        await send({"type": "http.response.body", "body": b"late"})

    async def send(message):
        sent.append(message)

    app = StartingUpDeadline(slow, seconds=0.05)
    await app(
        {"type": "http", "method": "POST", "path": "/api/household-impact"},
        None,
        send,
    )
    await asyncio.sleep(0.3)
    statuses = [
        m["status"] for m in sent if m["type"] == "http.response.start"
    ]
    assert statuses == [503]
    bodies = [m["body"] for m in sent if m["type"] == "http.response.body"]
    assert json.loads(bodies[0])["retry_after_seconds"] == RETRY_AFTER_SECONDS
