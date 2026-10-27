"""A deadline for the Modal household service's answers: a clear 503 with
Retry-After, sent before Modal's own 150 s web limit, in place of an empty
answer. Kept apart from ``modal_household`` so it can be tested without
Modal installed.

Modal ends a web request that has not started its answer within 150 s and
redirects it (HTTP 303) to a result URL, which a cross-origin page cannot
follow: its CORS headers are not there in time
(https://modal.com/docs/guide/webhook-timeouts). On 27 October 2026 the
first household request to the idle test app came back empty after about
150 s while its containers started.

``StartingUpDeadline`` wraps the API: a request to a watched path that has
not started its answer within ``seconds`` is answered 503, with
``Retry-After`` and the same wait in the body (``retry_after_seconds``, as
a cross-origin page reads only the headers a service exposes), and CORS
headers of its own, so the page can read it. The calculation is not
stopped: it runs on in its thread (a thread cannot be cancelled), its runs
are kept (``household_impact._RUNS``), and a retry that reaches the same
Web container is answered from them, or waits for the runs still in flight,
rather than starting again. A retry that reaches another Web container
(up to 4) computes afresh.
"""

import asyncio
import json
from collections.abc import Iterable

# Below Modal's 150 s, with room for a Web container's own cold start (its
# snapshot restore) before the request reaches the app.
DEADLINE_SECONDS = 100.0
# What the page waits before asking again: long enough for containers that
# have started to finish, short against the page's 150 s budget.
RETRY_AFTER_SECONDS = 10
WATCHED_PATHS = ("/api/household-impact",)
# Requests answered 503 whose calculation runs on: held here, as the event
# loop keeps only a weak reference to a task
_LATE: set = set()
STARTING_UP_DETAIL = (
    "The calculator is starting up. Please try again in a few seconds."
)


def starting_up_response(retry_after: int) -> tuple[list, bytes]:
    """The 503's headers and body."""
    body = json.dumps(
        {"detail": STARTING_UP_DETAIL, "retry_after_seconds": retry_after}
    ).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"retry-after", str(retry_after).encode()),
        (b"cache-control", b"no-store"),
        # The API's CORSMiddleware is inside this wrapper, so the 503 says
        # it itself; and exposes Retry-After, which a page can't otherwise read
        (b"access-control-allow-origin", b"*"),
        (b"access-control-expose-headers", b"Retry-After"),
    ]
    return headers, body


class StartingUpDeadline:
    """ASGI wrapper: a watched POST not answered within ``seconds`` gets a
    503 with Retry-After; everything else passes straight through."""

    def __init__(
        self,
        app,
        seconds: float = DEADLINE_SECONDS,
        retry_after: int = RETRY_AFTER_SECONDS,
        paths: Iterable[str] = WATCHED_PATHS,
    ):
        self.app = app
        self.seconds = seconds
        self.retry_after = retry_after
        self.paths = tuple(paths)

    async def __call__(self, scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or scope.get("path") not in self.paths
        ):
            await self.app(scope, receive, send)
            return

        started = asyncio.Event()
        # Once the 503 is sent, the inner app's answer goes nowhere
        timed_out = False

        async def guarded_send(message):
            if timed_out:
                return
            if message["type"] == "http.response.start":
                started.set()
            await send(message)

        inner = asyncio.ensure_future(self.app(scope, receive, guarded_send))
        waiter = asyncio.ensure_future(started.wait())
        try:
            await asyncio.wait(
                {inner, waiter},
                timeout=self.seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            waiter.cancel()
        if started.is_set() or inner.done():
            # Answering (or answered, or failed): let it finish as it would
            await inner
            return
        timed_out = True
        print(
            f"household request not answered in {self.seconds:.0f} s: "
            f"503, retry after {self.retry_after} s (the runs carry on)"
        )
        headers, body = starting_up_response(self.retry_after)
        await send(
            {"type": "http.response.start", "status": 503, "headers": headers}
        )
        await send({"type": "http.response.body", "body": body})
        # Not cancelled: its runs finish and are kept for the retry. Its
        # outcome is logged, not raised, as no one is waiting for it.
        _LATE.add(inner)
        inner.add_done_callback(_log_late_outcome)


def _log_late_outcome(task: "asyncio.Future") -> None:
    _LATE.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        print(f"household request after its 503 failed: {error!r}")
