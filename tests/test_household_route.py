"""Tests for the deployed-route household checker and the version route."""

import json
from importlib import metadata

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data.household_route import (
    DEFAULT_TOLERANCE,
    FixtureError,
    expected_versions,
    identity_mismatches,
    load_fixture,
    path_tokens,
    resolve_path,
    run_checks,
    within_tolerance,
)
from uk_budget_data.runtime_identity import runtime_identity

UK_VERSION = "9.9.9"
CORE_VERSION = "8.8.8"


def fake_api(answer: float, versions=None, status: int = 200) -> TestClient:
    """A stand-in household API returning a fixed impact."""
    app = FastAPI()
    reported = versions or {
        "policyengine-uk": UK_VERSION,
        "policyengine-core": CORE_VERSION,
    }

    @app.get("/api/version")
    def version():
        return {"service": "fake", "git_sha": "abc", "packages": reported}

    @app.post("/api/personal-impact")
    def impact(body: dict):
        if status != 200:
            from fastapi import HTTPException

            raise HTTPException(status_code=status, detail="boom")
        return {"policies": {"rate": {"years": [{"impact": answer}]}}}

    return TestClient(app)


def write_fixture(tmp_path, name="one", value=100.0, **extra) -> str:
    fixture = {
        "name": name,
        "route": "/api/personal-impact",
        "request": {"employment_income": 30000},
        "expect": [{"path": "policies.rate.years[0].impact", "value": value}],
        "source": "hand calculation for this test",
        **extra,
    }
    path = tmp_path / f"{name}.json"
    path.write_text(json.dumps(fixture))
    return path


EXPECTED = {"policyengine-uk": UK_VERSION, "policyengine-core": CORE_VERSION}


def test_matching_answer_and_identity_passes(tmp_path):
    receipt = run_checks(
        fake_api(100.004), [write_fixture(tmp_path)], EXPECTED
    )
    assert receipt["pass"] is True
    assert receipt["fixtures"][0]["status"] == "pass"
    assert receipt["identity_mismatches"] == []


def test_answer_off_by_more_than_a_penny_fails(tmp_path):
    receipt = run_checks(fake_api(100.02), [write_fixture(tmp_path)], EXPECTED)
    assert receipt["pass"] is False
    mismatch = receipt["fixtures"][0]["mismatches"][0]
    assert mismatch["expected"] == 100.0
    assert mismatch["actual"] == 100.02


def test_wrong_model_version_fails_even_with_right_answers(tmp_path):
    client = fake_api(
        100.0,
        versions={
            "policyengine-uk": "1.0.0",
            "policyengine-core": CORE_VERSION,
        },
    )
    receipt = run_checks(client, [write_fixture(tmp_path)], EXPECTED)
    assert receipt["fixtures"][0]["status"] == "pass"
    assert receipt["pass"] is False
    assert receipt["identity_mismatches"] == [
        {
            "package": "policyengine-uk",
            "expected": UK_VERSION,
            "actual": "1.0.0",
        }
    ]


def test_http_error_fails(tmp_path):
    receipt = run_checks(
        fake_api(0, status=503), [write_fixture(tmp_path)], EXPECTED
    )
    assert receipt["fixtures"][0]["status"] == "error"
    assert receipt["pass"] is False


def test_missing_path_is_a_mismatch(tmp_path):
    path = write_fixture(tmp_path)
    fixture = json.loads(path.read_text())
    fixture["expect"][0]["path"] = "policies.missing.years[0].impact"
    path.write_text(json.dumps(fixture))
    receipt = run_checks(fake_api(100.0), [path], EXPECTED)
    assert receipt["pass"] is False
    assert "error" in receipt["fixtures"][0]["mismatches"][0]


def test_drafts_are_skipped_and_never_count_as_a_pass(tmp_path):
    draft = write_fixture(tmp_path, name="draft", draft=True)
    receipt = run_checks(fake_api(100.0), [draft], EXPECTED)
    assert receipt["fixtures"][0]["status"] == "skipped-draft"
    assert receipt["pass"] is False  # nothing was checked

    included = run_checks(
        fake_api(100.0), [draft], EXPECTED, include_drafts=True
    )
    assert included["pass"] is True


def test_invalid_fixture_fails_the_run(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"name": "bad"}))
    good = write_fixture(tmp_path)
    receipt = run_checks(fake_api(100.0), [bad, good], EXPECTED)
    statuses = {f["status"] for f in receipt["fixtures"]}
    assert statuses == {"invalid", "pass"}
    assert receipt["pass"] is False


def test_load_fixture_rejects_non_finite_expectations(tmp_path):
    path = write_fixture(tmp_path)
    fixture = json.loads(path.read_text())
    fixture["expect"][0]["value"] = "nan"
    path.write_text(json.dumps(fixture))
    with pytest.raises(FixtureError, match="finite"):
        load_fixture(path)


def test_expected_versions_read_the_manifest_execution_identity():
    manifest = {
        "execution": {
            "identity": {
                "wrapper": {"name": "policyengine", "version": "6.2.6"},
                "model": {"name": "policyengine-uk", "version": "2.125.1"},
                "core": {"name": "policyengine-core", "version": "3.33.0"},
            }
        }
    }
    assert expected_versions(manifest, {}) == {
        "policyengine": "6.2.6",
        "policyengine-uk": "2.125.1",
        "policyengine-core": "3.33.0",
    }
    assert expected_versions(manifest, {"policyengine-uk": "2.126.0"})[
        "policyengine-uk"
    ] == ("2.126.0")


def test_no_identity_is_a_mismatch_when_versions_are_expected():
    assert identity_mismatches(None, EXPECTED) == [
        {"error": "the API reported no identity"}
    ]


def test_nothing_to_check_against_is_a_mismatch():
    """Review finding: no manifest and a 404 on /api/version passed."""
    problems = identity_mismatches(None, {})
    assert {"error": "no expected version for policyengine-uk"} in problems
    assert {"error": "the API reported no identity"} in problems
    assert identity_mismatches({"packages": {}}, {"policyengine-uk": "1"})


def test_a_run_with_no_version_route_and_no_manifest_fails(tmp_path):
    app = FastAPI()

    @app.post("/api/personal-impact")
    def impact(body: dict):
        return {"policies": {"rate": {"years": [{"impact": 100.0}]}}}

    receipt = run_checks(TestClient(app), [write_fixture(tmp_path)], {})
    assert not receipt["pass"]


@pytest.mark.parametrize("tolerance", ["inf", "nan", -0.01, 1.01, 1e9])
def test_unbounded_tolerances_are_refused(tmp_path, tolerance):
    path = write_fixture(tmp_path)
    fixture = json.loads(path.read_text())
    fixture["expect"][0]["tolerance"] = tolerance
    path.write_text(json.dumps(fixture))
    with pytest.raises(FixtureError, match="tolerance"):
        load_fixture(path)


def test_a_missing_manifest_named_on_the_command_line_fails(tmp_path):
    from uk_budget_data.household_route import main

    code = main(
        [
            "--base-url",
            "http://127.0.0.1:9",
            "--fixtures",
            str(tmp_path),
            "--manifest",
            str(tmp_path / "missing.json"),
        ]
    )
    assert code == 2


def test_path_tokens():
    assert path_tokens("a.b[2].c") == ["a", "b", 2, "c"]
    assert path_tokens("years[0][1]") == ["years", 0, 1]
    assert path_tokens("2027") == ["2027"]
    for bad in ("", "a..b", "a.[0]", "a[x]", "a]"):
        with pytest.raises(KeyError):
            path_tokens(bad)


@given(
    expected=st.floats(-1e6, 1e6, allow_nan=False),
    offset=st.floats(-0.05, 0.05, allow_nan=False),
)
def test_tolerance_boundary_is_inclusive_at_a_penny(expected, offset):
    actual = expected + offset
    verdict = within_tolerance(actual, expected, DEFAULT_TOLERANCE)
    if abs(actual - expected) <= DEFAULT_TOLERANCE:
        assert verdict
    elif abs(actual - expected) > DEFAULT_TOLERANCE + 1e-9:
        assert not verdict


@given(st.sampled_from([float("nan"), float("inf"), "1.0", None, True]))
def test_non_numbers_never_match(actual):
    assert not within_tolerance(actual, 1.0, 1e9)


@given(
    st.recursive(
        st.floats(allow_nan=False, allow_infinity=False),
        lambda inner: st.lists(inner, min_size=1, max_size=3)
        | st.dictionaries(
            st.text("abcxyz", min_size=1, max_size=3), inner, min_size=1
        ),
        max_leaves=10,
    )
)
def test_resolve_path_reaches_every_leaf(document):
    """Every leaf of any JSON document is reachable by the path to it."""

    def leaves(node, prefix):
        if isinstance(node, dict):
            for key, value in node.items():
                yield from leaves(value, f"{prefix}.{key}" if prefix else key)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                yield from leaves(value, f"{prefix}[{index}]")
        else:
            yield prefix, node

    for path, value in leaves({"root": document}, ""):
        assert resolve_path({"root": document}, path) == value


def test_runtime_identity_reports_installed_packages(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "deadbeef")
    identity = runtime_identity()
    assert identity["git_sha"] == "deadbeef"
    assert identity["packages"]["policyengine-uk"] == metadata.version(
        "policyengine-uk"
    )


def test_version_route_serves_runtime_identity(monkeypatch):
    from uk_budget_data.api import app

    monkeypatch.delenv("GIT_SHA", raising=False)
    response = TestClient(app).get("/api/version")
    assert response.status_code == 200
    body = response.json()
    assert body["git_sha"] is None
    assert body["packages"]["policyengine-core"] == metadata.version(
        "policyengine-core"
    )
