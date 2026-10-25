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
    household_impact: Optional[dict] = None,
):
    """Serve /api/health, /api/version, /api/personal-impact and
    /api/household-impact; yield the base URL.
    Each POST body is recorded on ``server.posted``, and each POST's
    query string on ``server.queries``."""
    posted = []
    queries = []
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
            path, _, query = self.path.partition("?")
            queries.append(query)
            if path == "/api/personal-impact":
                self._send(200, impact)
            elif path == "/api/household-impact":
                self._send(200, household_impact)
            else:
                self._send(404, {"detail": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.posted = posted
    server.queries = queries
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", server
    finally:
        server.shutdown()
        server.server_close()
