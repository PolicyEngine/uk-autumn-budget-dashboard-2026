"""page_measures_check: the APIs and presets must cover the page's measures."""

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from uk_budget_data import page_measures_check as check

PACKAGES = {
    "policyengine": "6.10.2",
    "policyengine-uk": "2.132.6",
    "policyengine-core": "3.33.3",
}


@contextmanager
def api(known: set, packages: dict = PACKAGES):
    """A household API stand-in that refuses measures it doesn't know, as
    the real one does (HTTP 422, "Unknown measures: …")."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, body):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            self._send(
                200, {"service": "uk-budget-api-2026", "packages": packages}
            )

        def do_POST(self):
            body = json.loads(
                self.rfile.read(int(self.headers["Content-Length"]))
            )
            unknown = [p for p in body["policies"] if p not in known]
            if unknown:
                self._send(
                    422,
                    {
                        "detail": [
                            {
                                "loc": ["body", "policies"],
                                "msg": "Value error, Unknown measures: "
                                + ", ".join(unknown),
                            }
                        ]
                    },
                )
            else:
                self._send(
                    200,
                    {
                        "net_income": {
                            "baseline": 1.0,
                            "reform": 1.0,
                            "change": 0.0,
                        }
                    },
                )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()


def write_policies(tmp_path, ids):
    path = tmp_path / "policies.js"
    entries = "".join(
        f'  {{\n    id: "{i}",\n    name: "{i}",\n  }},\n' for i in ids
    )
    path.write_text(
        f"/** doc */\nexport const POLICIES = [\n{entries}];\n\nexport const X = 1;\n"
    )
    return path


def write_presets(tmp_path, ids, packages=PACKAGES):
    path = tmp_path / "household_presets.json"
    path.write_text(
        json.dumps({"engine": packages, "policies": ids, "entries": []})
    )
    return path


def test_reads_the_page_measures_in_order(tmp_path):
    assert check.page_measure_ids(write_policies(tmp_path, ["b", "a"])) == [
        "b",
        "a",
    ]


def test_the_real_page_lists_measures():
    ids = check.page_measure_ids()
    assert ids and len(ids) == len(set(ids))


def test_an_api_that_knows_every_measure_passes(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as url:
        problems = check.check(
            [url],
            write_policies(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert problems == []


def test_an_api_missing_a_measure_fails_and_names_it(tmp_path):
    ids = ["fuel", "vat", "gas"]
    with api({"fuel"}) as url:
        problems = check.check(
            [url + "/api/household-impact"],
            write_policies(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert len(problems) == 1
    assert "vat, gas" in problems[0] and "deploy it" in problems[0]


def test_every_api_is_checked(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as good, api({"fuel"}) as stale:
        problems = check.check(
            [good, stale],
            write_policies(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert len(problems) == 1 and stale in problems[0]


def test_presets_for_other_measures_fail(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as url:
        problems = check.check(
            [url],
            write_policies(tmp_path, ids),
            write_presets(tmp_path, ["fuel", "old"]),
            timeout=10,
        )
    assert len(problems) == 1
    assert (
        "missing vat" in problems[0] and "not on the page old" in problems[0]
    )


def test_presets_on_another_engine_fail(tmp_path):
    ids = ["fuel"]
    old = {**PACKAGES, "policyengine-uk": "2.100.0"}
    with api({"fuel"}) as url:
        problems = check.check(
            [url],
            write_policies(tmp_path, ids),
            write_presets(tmp_path, ids, old),
            timeout=10,
        )
    assert len(problems) == 1 and "policyengine-uk '2.100.0'" in problems[0]


def test_an_api_that_does_not_answer_is_a_problem_not_a_crash(tmp_path):
    ids = ["fuel"]
    problems = check.check(
        ["http://127.0.0.1:9"],
        write_policies(tmp_path, ids),
        write_presets(tmp_path, ids),
        timeout=2,
    )
    assert problems and all("127.0.0.1:9" in p for p in problems)


def test_main_exits_1_on_a_problem(tmp_path, capsys):
    ids = ["fuel", "vat"]
    with api({"fuel"}) as url:
        code = check.main(
            [
                "--base-url",
                url,
                "--policies",
                str(write_policies(tmp_path, ids)),
                "--presets",
                str(write_presets(tmp_path, ids)),
            ]
        )
    assert code == 1 and "FAIL" in capsys.readouterr().out
