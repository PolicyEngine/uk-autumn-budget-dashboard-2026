"""page_measures_check: the APIs and presets must cover the page's measures."""

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from uk_budget_data import page_measures_check as check
from uk_budget_data.publication import manifest as m

DIGEST = "0" * 64

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


def write_manifest(tmp_path, ids, statuses=None):
    """A manifest whose measures are `ids`, approved unless `statuses` says."""
    statuses = statuses or {}
    manifest = m.Manifest()
    for key in ids:
        manifest.measures[key] = m.Entry(
            name=key,
            status=statuses.get(key, m.APPROVED),
            artifact=f"artifacts/{key}/{DIGEST[:16]}",
            outputs_sha256=DIGEST,
            receipt_sha256=DIGEST,
            execution_identity_sha256=DIGEST,
            artifact_sha256=DIGEST,
            years=[2027],
        )
    data_root = tmp_path / "data"
    m.save_manifest(manifest, data_root)
    return data_root


def write_presets(tmp_path, ids, packages=PACKAGES):
    path = tmp_path / "household_presets.json"
    path.write_text(
        json.dumps({"engine": packages, "policies": ids, "entries": []})
    )
    return path


def test_reads_the_displayable_measures(tmp_path):
    data_root = write_manifest(
        tmp_path, ["b", "a", "held"], {"a": m.PROVISIONAL, "held": m.STAGED}
    )
    assert check.page_measure_ids(data_root) == ["a", "b"]


def test_no_manifest_is_a_problem(tmp_path):
    problems = check.check(["http://127.0.0.1:9"], tmp_path / "none")
    assert len(problems) == 1 and "publish index" in problems[0]


def test_an_api_that_knows_every_measure_passes(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as url:
        problems = check.check(
            [url],
            write_manifest(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert problems == []


def test_an_api_missing_a_measure_fails_and_names_it(tmp_path):
    ids = ["fuel", "vat", "gas"]
    with api({"fuel"}) as url:
        problems = check.check(
            [url + "/api/household-impact"],
            write_manifest(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert len(problems) == 1
    assert "gas, vat" in problems[0] and "deploy it" in problems[0]


def test_every_api_is_checked(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as good, api({"fuel"}) as stale:
        problems = check.check(
            [good, stale],
            write_manifest(tmp_path, ids),
            write_presets(tmp_path, ids),
            timeout=10,
        )
    assert len(problems) == 1 and stale in problems[0]


def test_presets_for_other_measures_fail(tmp_path):
    ids = ["fuel", "vat"]
    with api({"fuel", "vat"}) as url:
        problems = check.check(
            [url],
            write_manifest(tmp_path, ids),
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
            write_manifest(tmp_path, ids),
            write_presets(tmp_path, ids, old),
            timeout=10,
        )
    assert len(problems) == 1 and "policyengine-uk '2.100.0'" in problems[0]


def test_an_api_that_does_not_answer_is_a_problem_not_a_crash(tmp_path):
    ids = ["fuel"]
    problems = check.check(
        ["http://127.0.0.1:9"],
        write_manifest(tmp_path, ids),
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
                "--data-root",
                str(write_manifest(tmp_path, ids)),
                "--presets",
                str(write_presets(tmp_path, ids)),
            ]
        )
    assert code == 1 and "FAIL" in capsys.readouterr().out


# #136: the page uses the presets only when they record each measure's
# approved definition, and leaves out an answer reporting another


def approval(commit="1" * 40):
    """A measure's definition as a receipt approves it (synthetic)."""
    return {
        "git_sha": commit,
        "baseline": {
            "kind": "current_law",
            "representation": None,
            "reform_sha256": None,
            "binding": "content",
        },
        "reform": {
            "kind": "reform",
            "representation": "policyengine-uk.scenario/v1",
            "reform_sha256": "d" * 64,
            "binding": "content",
        },
    }


def presets_with(tmp_path, ids, recorded, entries=()):
    path = tmp_path / "household_presets.json"
    document = {"engine": PACKAGES, "policies": ids, "entries": list(entries)}
    if recorded is not None:
        document["definitions"] = recorded
    path.write_text(json.dumps(document))
    return path


def answer(definitions):
    return {
        "preset_id": "x",
        "year": 2027,
        "response": {"definitions": definitions},
    }


IDS = ["fuel", "vat"]
APPROVED = {key: approval() for key in IDS}


def test_presets_recording_the_approved_definitions_pass(tmp_path):
    # Answers that report none of their own ({}, as the precompute's) take
    # the file's record
    path = presets_with(tmp_path, IDS, APPROVED, [answer({}), answer(None)])
    assert check.preset_problems(path, IDS, PACKAGES, APPROVED) == []


def test_presets_recording_no_definitions_fail(tmp_path):
    path = presets_with(tmp_path, IDS, None)
    (problem,) = check.preset_problems(path, IDS, PACKAGES, APPROVED)
    assert "records no measure definitions" in problem


def test_presets_recording_another_definition_fail_and_name_it(tmp_path):
    recorded = {**APPROVED, "vat": approval("2" * 40)}
    path = presets_with(tmp_path, IDS, recorded)
    (problem,) = check.preset_problems(path, IDS, PACKAGES, APPROVED)
    assert "records other definitions" in problem
    assert "for vat," in problem and "fuel" not in problem
    # One the code could not bind records another definition
    path = presets_with(tmp_path, IDS, {**APPROVED, "vat": {"error": "x"}})
    (problem,) = check.preset_problems(path, IDS, PACKAGES, APPROVED)
    assert "records other definitions" in problem and "for vat," in problem


def test_presets_leaving_a_measure_out_say_it_records_none_for_it(tmp_path):
    # Review of 79ae9c12, P3: a measure missing from the record (or null)
    # records no definition, not another one
    for recorded in ({"fuel": APPROVED["fuel"]}, {**APPROVED, "vat": None}):
        path = presets_with(tmp_path, IDS, recorded)
        (problem,) = check.preset_problems(path, IDS, PACKAGES, APPROVED)
        assert "records no definition for vat," in problem
        assert "other definitions" not in problem and "fuel" not in problem
    # Both at once: each named under its own
    path = presets_with(tmp_path, IDS, {"fuel": approval("2" * 40)})
    missing, other = check.preset_problems(path, IDS, PACKAGES, APPROVED)
    assert "records no definition for vat," in missing
    assert "records other definitions" in other and "for fuel," in other


def test_an_answer_reporting_another_definition_is_counted(tmp_path):
    entries = [
        answer({}),
        answer({"vat": approval("2" * 40)}),
        answer(APPROVED),
    ]
    path = presets_with(tmp_path, IDS, APPROVED, entries)
    (problem,) = check.preset_problems(path, IDS, PACKAGES, APPROVED)
    assert problem.startswith("1 of ") and "3 answers" in problem


def test_only_measures_with_an_approval_are_checked(tmp_path):
    # vat has none: publish definitions reports that, not this check
    path = presets_with(tmp_path, IDS, {"fuel": APPROVED["fuel"]})
    approved = {"fuel": APPROVED["fuel"]}
    assert check.preset_problems(path, IDS, PACKAGES, approved) == []
    # And with no approval at all, as before #136
    assert (
        check.preset_problems(presets_with(tmp_path, IDS, None), IDS, PACKAGES)
        == []
    )


def test_check_reads_the_approvals_from_the_receipts(tmp_path, monkeypatch):
    from uk_budget_data import definitions

    data_root = write_manifest(tmp_path, IDS)
    seen = {}

    def approved_definitions(root, ids):
        seen["args"] = (root, list(ids))
        return APPROVED

    monkeypatch.setattr(
        definitions, "approved_definitions", approved_definitions
    )
    with api(set(IDS)) as url:
        problems = check.check(
            [url], data_root, presets_with(tmp_path, IDS, None), timeout=10
        )
    assert seen["args"] == (data_root, IDS)
    assert (
        len(problems) == 1 and "records no measure definitions" in problems[0]
    )
