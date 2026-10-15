"""A household API stand-in on a real local port, for the smoke checker.

The pipelines run deploy_smoke on plain Python with its standard-library
client, so tests that exercise that path need a real HTTP server rather
than a TestClient.
"""

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@contextmanager
def serving(version: dict, impact: dict, health_status: int = 200):
    """Serve /api/health, /api/version and /api/personal-impact; yield the
    base URL. Each POST body is recorded on ``server.posted``."""
    posted = []

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
