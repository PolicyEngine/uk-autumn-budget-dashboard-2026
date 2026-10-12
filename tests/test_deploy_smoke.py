"""Tests for the pre-traffic smoke test of a household API revision."""

import math

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

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


GOOD_ANSWER = {
    "household_input": {"employment_income": 30000},
    "years": {
        "2026": {"baseline": {"household_net_income": 25000.0}},
        "2027": {"baseline": {"household_net_income": 25500.0}},
    },
    "policies": {
        "x": {
            "name": "X",
            "years": {
                "2026": {"net_income_change": -12.5},
                "2027": {"net_income_change": 0.0},
            },
        }
    },
    "totals": {"cumulative": -12.5},
}


def fake_api(
    version=None, impact=None, health_status=200, impact_status=200
) -> TestClient:
    app = FastAPI()

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


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"policies": {}},
        {"error": "failed", "code": 500},
        0,
        [1, 2],
        {
            "household_input": {"employment_income": 30000},
            "years": {},
            "policies": {},
            "totals": {"cumulative": 0},
        },
        {**GOOD_ANSWER, "policies": {}},
        {
            **GOOD_ANSWER,
            "policies": {"x": {"years": {"2026": {"net_income_change": 1}}}},
        },
        {**GOOD_ANSWER, "years": {"2026": {"baseline": {}}}},
        {**GOOD_ANSWER, "detail": "Calculation error"},
    ],
)
def test_answers_that_are_not_a_calculation_fail(body):
    """Review finding: any finite number in a 200 used to pass."""
    result = run_smoke(fake_api(impact=body), SHA, BUILD)
    assert not result["pass"], body


def test_zero_effects_are_a_valid_answer():
    zero = {
        **GOOD_ANSWER,
        "policies": {
            "x": {
                "years": {
                    "2026": {"net_income_change": 0.0},
                    "2027": {"net_income_change": 0.0},
                }
            }
        },
    }
    assert run_smoke(fake_api(impact=zero), SHA, BUILD)["pass"]


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


def test_the_real_api_passes_its_own_smoke_test(monkeypatch):
    """Differential: the API's /api/version agrees with the image's view."""
    monkeypatch.setenv("GIT_SHA", SHA)
    result = run_smoke(TestClient(real_app), SHA)
    assert result["pass"], result["problems"]
    assert all(math.isfinite(n) for n in numbers(result["version"]))
