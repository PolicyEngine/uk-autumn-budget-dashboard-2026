"""Tests for the pre-traffic smoke test of a household API revision."""

import json
import math

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from tests.smoke_server import lifecycle_answer, serving
from uk_budget_data import deploy_smoke
from uk_budget_data.api import app as real_app
from uk_budget_data.deploy_smoke import (
    identity_problems,
    numbers,
    run_smoke,
)

SHA = "a" * 40
BUILD = {
    "service": "uk-budget-api-2026",
    "git_sha": SHA,
    "packages": {"policyengine-uk": "2.125.1", "policyengine-core": "3.33.0"},
}


YEARS = ["2026", "2027"]
POLICIES = ["x", "y"]


def answer(change=-12.5, years=YEARS, policies=POLICIES):
    return {
        "household_input": {"employment_income": 30000},
        "years": {
            year: {"baseline": {"household_net_income": 25000.0}}
            for year in years
        },
        "policies": {
            name: {
                "name": name.upper(),
                "years": {
                    year: {"net_income_change": change} for year in years
                },
            }
            for name in policies
        },
        "totals": {"cumulative": change},
    }


GOOD_ANSWER = answer()


@pytest.fixture(autouse=True)
def coverage(monkeypatch):
    """Tests use their own expected years and policies."""
    from uk_budget_data import deploy_smoke

    monkeypatch.setattr(
        deploy_smoke, "expected_coverage", lambda: (YEARS, POLICIES)
    )


def fake_api(
    version=None,
    impact=None,
    health_status=200,
    impact_status=200,
    lifecycle=None,
    lifecycle_status=200,
) -> TestClient:
    app = FastAPI()

    @app.post("/api/lifecycle/calculate")
    def lifecycle_route(body: dict):
        if lifecycle_status != 200:
            raise HTTPException(status_code=lifecycle_status)
        return lifecycle_answer() if lifecycle is None else lifecycle

    @app.get("/api/health")
    def health():
        if health_status != 200:
            raise HTTPException(status_code=health_status)
        return {"status": "healthy"}

    @app.get("/api/version")
    def version_route():
        return BUILD if version is None else version

    @app.post("/api/personal-impact")
    def impact_route(body: dict):
        if impact_status != 200:
            raise HTTPException(status_code=impact_status)
        return GOOD_ANSWER if impact is None else impact

    return TestClient(app)


def test_a_matching_build_passes():
    result = run_smoke(fake_api(), SHA, BUILD)
    assert result == {"pass": True, "problems": [], "version": BUILD}


def test_a_different_commit_fails():
    result = run_smoke(fake_api(), "b" * 40, BUILD)
    assert not result["pass"]
    assert "commit" in result["problems"][0]


def test_a_different_model_version_fails():
    served = {**BUILD, "packages": {**BUILD["packages"]}}
    served["packages"]["policyengine-uk"] = "2.90.2"
    result = run_smoke(fake_api(version=served), SHA, BUILD)
    assert not result["pass"]
    assert any("policyengine-uk" in p for p in result["problems"])


def test_failing_routes_fail():
    assert not run_smoke(fake_api(health_status=503), SHA, BUILD)["pass"]
    assert not run_smoke(fake_api(impact_status=500), SHA, BUILD)["pass"]


class _TimesOut:
    """A client whose household route never answers."""

    def __init__(self, inner):
        self.inner = inner

    def request(self, method, route, **kwargs):
        if route == "/api/personal-impact":
            import httpx

            raise httpx.ReadTimeout("timed out")
        return self.inner.request(method, route, **kwargs)


def test_a_route_that_never_answers_is_a_problem_not_a_crash():
    result = run_smoke(_TimesOut(fake_api()), SHA, BUILD)
    assert not result["pass"]
    assert result["problems"][0].startswith(
        "/api/personal-impact did not answer"
    )
    assert "ReadTimeout" in result["problems"][0]


def _without(body, *path):
    import copy

    body = copy.deepcopy(body)
    target = body
    for step in path[:-1]:
        target = target[step]
    del target[path[-1]]
    return body


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"policies": {}},
        {"error": "failed", "code": 500},
        0,
        [1, 2],
        {**GOOD_ANSWER, "detail": "Calculation error"},
        {**GOOD_ANSWER, "policies": {}},
        # Review round 2: nested errors, scalars, metadata and gaps.
        {
            "years": {"2026": {"baseline": {"error": "failed", "code": 500}}},
            "policies": {"x": {"years": {"2026": {"code": 500}}}},
        },
        {
            "years": {"2026": {"baseline": 0}},
            "policies": {"x": {"years": {"2026": 0}}},
        },
        {
            "years": {"2026": {"baseline": {"employment_income": 30000}}},
            "policies": {
                "x": {"years": {"2026": {"employment_income": 30000}}}
            },
        },
        _without(GOOD_ANSWER, "policies", "y"),
        _without(GOOD_ANSWER, "years", "2027"),
        _without(GOOD_ANSWER, "policies", "x", "years", "2027"),
        _without(
            GOOD_ANSWER, "policies", "x", "years", "2026", "net_income_change"
        ),
    ],
)
def test_answers_that_are_not_a_complete_calculation_fail(body):
    """Review findings: any finite number in a 200 used to pass."""
    result = run_smoke(fake_api(impact=body), SHA, BUILD)
    assert not result["pass"], body


def test_zero_effects_are_a_valid_answer():
    assert run_smoke(fake_api(impact=answer(change=0.0)), SHA, BUILD)["pass"]


def test_the_expectation_comes_from_the_image_calculator(monkeypatch):
    from uk_budget_data import deploy_smoke, personal_impact

    monkeypatch.undo()
    years, policies = deploy_smoke.expected_coverage()
    assert years == [str(y) for y in personal_impact.YEARS]
    assert policies == list(personal_impact.POLICY_IDS)


@given(
    st.recursive(
        st.none()
        | st.booleans()
        | st.integers()
        | st.floats(allow_nan=True, allow_infinity=True)
        | st.text(max_size=3),
        lambda children: st.lists(children, max_size=3)
        | st.dictionaries(st.text(max_size=3), children, max_size=3),
        max_leaves=12,
    )
)
def test_numbers_finds_every_number_and_no_boolean(value):
    found = list(numbers(value))
    assert not any(isinstance(n, bool) for n in found)

    def count(v):
        if isinstance(v, bool):
            return 0
        if isinstance(v, (int, float)):
            return 1
        if isinstance(v, dict):
            return sum(count(m) for m in v.values())
        if isinstance(v, list):
            return sum(count(m) for m in v)
        return 0

    assert len(found) == count(value)


def test_identity_problems_needs_an_object():
    assert identity_problems(["not", "an", "object"], SHA, BUILD)


@pytest.mark.slow
def test_the_real_api_passes_its_own_smoke_test(monkeypatch):
    """Differential: the real API answers everything its calculator says."""
    monkeypatch.undo()  # the real years and policies, not the test ones
    monkeypatch.setenv("GIT_SHA", SHA)
    result = run_smoke(TestClient(real_app), SHA)
    assert result["pass"], result["problems"]
    assert all(math.isfinite(n) for n in numbers(result["version"]))


@pytest.mark.parametrize(
    "path",
    [
        ("policies", "x", "years", "2026"),
        ("years", "2027", "baseline"),
        ("policies", "y"),
    ],
)
@pytest.mark.parametrize("key", sorted(deploy_smoke.ERROR_KEYS))
def test_a_failure_reported_beside_a_number_fails(path, key):
    """Review round 3: an error beside a numeric fallback passed, because
    only the top level was searched for failure markers."""
    import copy

    body = copy.deepcopy(GOOD_ANSWER)
    target = body
    for step in path:
        target = target[step]
    target[key] = "calculation failed"
    problems = deploy_smoke.impact_problems(
        body, years=YEARS, policies=POLICIES
    )
    assert problems and "reported a failure" in problems[0], problems


def test_a_null_error_field_is_not_a_failure():
    body = {**GOOD_ANSWER, "error": None}
    assert (
        deploy_smoke.impact_problems(body, years=YEARS, policies=POLICIES)
        == []
    )


# --- review round 2 of #28: main's checker, on plain Python ---------------


def _expectations(tmp_path, **changes):
    data = {"identity": BUILD, "years": YEARS, "policies": POLICIES}
    data.update(changes)
    path = tmp_path / "expectations.json"
    path.write_text(json.dumps(data))
    return str(path)


def test_the_standard_library_client_checks_a_real_server(tmp_path):
    with serving(BUILD, GOOD_ANSWER) as (url, server):
        code = deploy_smoke.main(
            [
                "--base-url",
                url,
                "--expect-git-sha",
                SHA,
                "--expectations",
                _expectations(tmp_path),
            ]
        )
    assert code == 0
    assert server.posted == [
        deploy_smoke.SMOKE_HOUSEHOLD,
        deploy_smoke.SMOKE_LIFECYCLE_HOUSEHOLD,
    ]


def test_the_checker_judges_with_its_own_logic_not_the_images(tmp_path):
    """Review A: an older image's checker passed an answer with a nested
    error that today's rejects. The expectations file carries data only, so
    today's logic decides."""
    body = answer()
    body["policies"]["x"]["years"]["2026"]["error"] = "calculation failed"
    with serving(BUILD, body) as (url, _):
        code = deploy_smoke.main(
            [
                "--base-url",
                url,
                "--expect-git-sha",
                SHA,
                "--expectations",
                _expectations(tmp_path),
            ]
        )
    assert code == 1


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"policies": []}, "names no policies"),
        ({"years": []}, "names no years"),
        ({"years": [2026]}, "names no years"),
        ({"identity": {**BUILD, "git_sha": "b" * 40}}, "is for commit"),
        ({"identity": None}, "names no identity"),
    ],
)
def test_expectations_that_would_make_the_checks_vacuous_are_refused(
    tmp_path, capsys, changes, message
):
    with serving(BUILD, GOOD_ANSWER) as (url, _):
        code = deploy_smoke.main(
            [
                "--base-url",
                url,
                "--expect-git-sha",
                SHA,
                "--expectations",
                _expectations(tmp_path, **changes),
            ]
        )
    assert code == 1
    assert message in capsys.readouterr().err


def test_a_server_error_is_a_problem_not_a_crash(tmp_path):
    with serving(BUILD, GOOD_ANSWER, health_status=503) as (url, _):
        client = deploy_smoke.StdlibClient(url, 5)
        result = deploy_smoke.run_smoke(client, SHA, BUILD, YEARS, POLICIES)
    assert not result["pass"]
    assert "/api/health returned HTTP 503" in result["problems"]


# --- the lifecycle route the Personal impact tab calls ---------------------


def _real_lifecycle_answer() -> dict:
    response = TestClient(real_app).post(
        deploy_smoke.LIFECYCLE_ROUTE,
        json=deploy_smoke.SMOKE_LIFECYCLE_HOUSEHOLD,
    )
    assert response.status_code == 200
    return response.json()


def _under_22_bug() -> dict:
    """The live API's answer on 23 October, before #69's fix: inputs read
    as 2025, so 2026 starts at age 20, and pay at 22 falls by 54%."""
    body = lifecycle_answer(first_year=2026, first_age=20)
    for row in body["data"]:
        if 22 <= row["age"] <= 67:
            row["employment_income"] = 10_727
    body["data"][1]["employment_income"] = 23_366
    return body


def test_the_real_lifecycle_route_passes():
    """Differential: this build's calculator, through the real route,
    passes the strict check."""
    body = _real_lifecycle_answer()
    assert deploy_smoke.expected_lifecycle() == {"input_year": 2026}
    assert deploy_smoke.lifecycle_problems(body, 2026) == []
    rows = body["data"]
    assert (rows[0]["year"], rows[0]["age"]) == (2026, 19)


def test_the_under_22_bug_fails_the_strict_check():
    problems = deploy_smoke.lifecycle_problems(_under_22_bug(), 2026)
    assert "/api/lifecycle/calculate starts at age 20, not 19" in problems
    assert any(
        "pay falls from 23366 at 21 to 10727 at 22" in p for p in problems
    )
    result = run_smoke(fake_api(lifecycle=_under_22_bug()), SHA, BUILD)
    assert not result["pass"]


def test_a_start_year_other_than_2026_fails():
    body = lifecycle_answer(first_year=2025)
    assert deploy_smoke.lifecycle_problems(body, 2026) == [
        "/api/lifecycle/calculate starts in 2025, not 2026"
    ]


def test_an_image_that_declares_no_input_year_is_checked_for_shape_only():
    """A rollback runs main's checker against an older image. One without
    INPUT_YEAR predates the under-22 fix, so its pay path is not a reason
    to refuse the rollback; its shape still is."""
    assert deploy_smoke.lifecycle_problems(_under_22_bug(), None) == []
    result = run_smoke(
        fake_api(lifecycle=_under_22_bug()),
        SHA,
        BUILD,
        lifecycle={"input_year": None},
    )
    assert result["pass"], result["problems"]


def _shape(body):
    return deploy_smoke.lifecycle_problems(body, None)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda b: b.update(data=[]), "returned no rows"),
        (lambda b: b.pop("data"), "returned no rows"),
        (lambda b: b["data"].__setitem__(3, "x"), "returned no rows"),
        (lambda b: b["data"][5].pop("age"), "has a row with no age"),
        (
            lambda b: b["data"][5].update(employment_income=None),
            "has a row with no employment_income",
        ),
        (
            lambda b: b["data"][5].update(age=b["data"][4]["age"]),
            "age does not rise by one a year",
        ),
        (
            lambda b: b["data"].reverse(),
            "age does not rise by one a year",
        ),
        (
            lambda b: b["data"][7].update(year=b["data"][7]["year"] + 1),
            "year does not rise by one a year",
        ),
        (
            lambda b: b.update(detail="Calculation error: boom"),
            "reported a failure at detail",
        ),
        (
            lambda b: b["data"][2].update(impact_threshold_freeze=math.inf),
            "returned a non-finite number",
        ),
    ],
)
def test_a_lifecycle_answer_of_the_wrong_shape_always_fails(mutate, message):
    body = lifecycle_answer()
    mutate(body)
    problems = _shape(body)
    assert problems and message in problems[0], problems


def test_a_lifecycle_route_that_fails_is_a_problem():
    result = run_smoke(fake_api(lifecycle_status=404), SHA, BUILD)
    assert "/api/lifecycle/calculate returned HTTP 404" in result["problems"]


def test_expectations_without_a_lifecycle_entry_check_shape_only(tmp_path):
    """An expectations file written before the lifecycle check (no
    "lifecycle" key) still runs; one that names the input year is strict."""
    for changes, code in [({}, 0), ({"lifecycle": {"input_year": 2026}}, 1)]:
        with serving(BUILD, GOOD_ANSWER, lifecycle=_under_22_bug()) as (
            url,
            _,
        ):
            assert (
                deploy_smoke.main(
                    [
                        "--base-url",
                        url,
                        "--expect-git-sha",
                        SHA,
                        "--expectations",
                        _expectations(tmp_path, **changes),
                    ]
                )
                == code
            )


@pytest.mark.parametrize(
    "lifecycle", [{"input_year": "2026"}, {"input_year": True}, [2026]]
)
def test_a_malformed_lifecycle_expectation_is_refused(
    tmp_path, capsys, lifecycle
):
    with serving(BUILD, GOOD_ANSWER) as (url, _):
        code = deploy_smoke.main(
            [
                "--base-url",
                url,
                "--expect-git-sha",
                SHA,
                "--expectations",
                _expectations(tmp_path, lifecycle=lifecycle),
            ]
        )
    assert code == 1
    assert "lifecycle input year" in capsys.readouterr().err
