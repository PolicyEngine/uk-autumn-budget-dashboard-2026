"""The check run on a freshly deployed household impact app.

``household_impact_smoke`` asks the deployed URL for ``/health`` and for one
household, with the standard library only, and fails unless both answer
and the household's change is its net income after minus before. A route
that fails or never answers is a problem in the report, not a crash.
"""

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import household_impact_smoke
from uk_budget_data.household_impact_api import create_app

GOOD = {
    "year": 2029,
    "net_income": {"before": 30_000.0, "after": 29_900.0, "change": -100.0},
    "measures": {"included": ["x"], "not_affected": [], "not_modelled": []},
    "versions": {"policyengine": "6.10.0"},
}
HEALTHY = {"status": "ok", "versions": {"policyengine": "6.10.0"}}


@contextmanager
def serving(answer=GOOD, health=HEALTHY, answer_status=200, health_status=200):
    """A stand-in app on a real local port; yields the base URL and the
    bodies posted to it."""
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
            if self.path == "/health":
                self._send(health_status, health)
            else:
                self._send(404, {"detail": "not found"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            posted.append(json.loads(self.rfile.read(length) or b"null"))
            if self.path == "/household-impact":
                self._send(answer_status, answer)
            else:
                self._send(404, {"detail": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", posted
    finally:
        server.shutdown()
        server.server_close()


def check(url):
    return household_impact_smoke.main(["--base-url", url, "--timeout", "5"])


def with_change(**net_income):
    return {**GOOD, "net_income": {**GOOD["net_income"], **net_income}}


def test_a_good_app_passes_and_is_asked_for_one_household():
    with serving() as (url, posted):
        assert check(url) == 0
    assert posted == [household_impact_smoke.SMOKE_REQUEST]


@pytest.mark.parametrize(
    "answer",
    [
        with_change(change=5.0),
        with_change(after=None),
        {**GOOD, "net_income": None},
        {**GOOD, "detail": "calculation failed"},
        ["not", "an", "object"],
    ],
)
def test_an_answer_that_is_not_a_calculation_fails(answer, capsys):
    with serving(answer=answer) as (url, _):
        assert check(url) == 1
    assert "/household-impact" in capsys.readouterr().out


@pytest.mark.parametrize(
    "serve, problem",
    [
        ({"health_status": 503}, "/health returned HTTP 503"),
        ({"health": {"status": "starting"}}, "/health is not ok"),
        ({"answer_status": 500}, "/household-impact returned HTTP 500"),
    ],
)
def test_failing_routes_are_reported(serve, problem, capsys):
    with serving(**serve) as (url, _):
        assert check(url) == 1
    assert problem in json.loads(capsys.readouterr().out)["problems"]


def test_an_app_that_never_answers_is_a_problem_not_a_crash(capsys):
    # Nothing listens on port 9 (discard) on the test machine
    assert check("http://127.0.0.1:9") == 1
    report = json.loads(capsys.readouterr().out)
    assert any("did not answer" in problem for problem in report["problems"])


def test_the_real_app_passes_the_check():
    """Differential: the app this repo deploys passes the checker it runs."""
    report = household_impact_smoke.run(TestClient(create_app()))
    assert report["pass"], report["problems"]
