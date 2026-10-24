"""A household API stand-in on a real local port, for the smoke checker.

The pipelines run deploy_smoke on plain Python with its standard-library
client, so tests that exercise that path need a real HTTP server rather
than a TestClient.
"""

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


def lifecycle_answer(
    first_year: int = 2026,
    first_age: int = 19,
    last_age: int = 85,
    retirement_age: int = 67,
    pay: float = 23_600,
) -> dict:
    """A /api/lifecycle/calculate answer of the real route's shape: one row
    a year, flat pay to retirement and none after."""
    return {
        "data": [
            {
                "age": age,
                "year": first_year + (age - first_age),
                "employment_income": pay if age <= retirement_age else 0,
                "baseline_net_income": 20_000,
                "impact_threshold_freeze": -50,
            }
            for age in range(first_age, last_age + 1)
        ]
    }


def household_impact_answer(baseline=25_000.0, reform=24_895.2) -> dict:
    """A /api/household-impact headline of the real route's shape."""
    return {
        "year": 2029,
        "net_income": {
            "baseline": baseline,
            "reform": reform,
            "change": round(reform - baseline, 2),
        },
        "by_policy": None,
        "sweep": None,
        "engine": {"policyengine": "6.10.1", "policyengine-uk": "2.132.6"},
    }


@contextmanager
def serving(
    version: dict,
    impact: dict,
    health_status: int = 200,
    lifecycle: Optional[dict] = None,
    household_impact: Optional[dict] = None,
):
    """Serve /api/health, /api/version, /api/personal-impact,
    /api/lifecycle/calculate and /api/household-impact; yield the base URL.
    Each POST body is recorded on ``server.posted``."""
    posted = []
    lifecycle = lifecycle_answer() if lifecycle is None else lifecycle
    if household_impact is None:
        household_impact = household_impact_answer()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/api/health":
                self._send(health_status, {"status": "healthy"})
            elif self.path == "/api/version":
                self._send(200, version)
            else:
                self._send(404, {"detail": "not found"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            posted.append(json.loads(self.rfile.read(length) or b"null"))
            if self.path == "/api/personal-impact":
                self._send(200, impact)
            elif self.path == "/api/lifecycle/calculate":
                self._send(200, lifecycle)
            elif self.path == "/api/household-impact":
                self._send(200, household_impact)
            else:
                self._send(404, {"detail": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.posted = posted
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", server
    finally:
        server.shutdown()
        server.server_close()
