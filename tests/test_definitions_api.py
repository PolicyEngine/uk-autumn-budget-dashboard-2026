"""POST /api/household-impact?definition=<id>:<commit>.

The answer carries the named measures' definitions (uk_budget_data.
definitions), recomputed at each approved commit from this build's code, in
the same response as the household figures, so the page can bind both. The
definitions don't depend on the household and the household answer doesn't
depend on them: the cached answer is shared whatever commits are named.
"""

import re
import sys
import uuid
import warnings

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from uk_budget_data import api, definitions, household_impact
from uk_budget_data.models import Reform

client = TestClient(api.app)
ROUTE = "/api/household-impact"
MEASURES = household_impact.measure_ids()
COMMIT = "0123456789abcdef" * 2 + "01234567"
OTHER = "fedcba9876543210" * 2 + "76543210"
REQUEST = {
    "year": 2028,
    "policies": [MEASURES[0]],
    "household": {"employment_income": 30_000, "salary_year": 2028},
    "include": [],
}
ANSWER = {"net_income": {"baseline": 1.0, "reform": 2.0, "change": 1.0}}


@pytest.fixture(autouse=True)
def _fake_calculation(monkeypatch):
    calls = []

    def calculate(answers, reform_ids, year, include=(), workers=1):
        calls.append((tuple(reform_ids), year, tuple(include)))
        return dict(ANSWER)

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate
    )
    api._cached_household_impact.cache_clear()
    definitions._definition.cache_clear()
    yield calls
    api._cached_household_impact.cache_clear()
    definitions._definition.cache_clear()


def _query(pairs) -> str:
    return "&".join(f"definition={m}:{sha}" for m, sha in pairs)


def test_with_none_named_the_definitions_are_empty_but_present():
    response = client.post(ROUTE, json=REQUEST)
    assert response.status_code == 200
    assert response.json()["definitions"] == {}


def test_each_named_definition_is_the_measures_at_that_commit():
    pairs = [(MEASURES[0], COMMIT), (MEASURES[-1], OTHER)]
    response = client.post(f"{ROUTE}?{_query(pairs)}", json=REQUEST)
    assert response.status_code == 200
    assert response.json()["definitions"] == {
        m: definitions.measure_definition(m, sha) for m, sha in pairs
    }


def test_a_measure_need_not_be_among_the_requests_policies():
    # The page names every displayed measure it compares, whichever the
    # reader selected.
    response = client.post(
        f"{ROUTE}?{_query([(MEASURES[-1], COMMIT)])}", json=REQUEST
    )
    assert set(response.json()["definitions"]) == {MEASURES[-1]}


def test_the_household_answer_is_shared_whatever_commits_are_named(
    _fake_calculation,
):
    plain = client.post(ROUTE, json=REQUEST).json()
    named = client.post(
        f"{ROUTE}?{_query([(MEASURES[0], COMMIT)])}", json=REQUEST
    ).json()
    other = client.post(
        f"{ROUTE}?{_query([(MEASURES[0], OTHER)])}", json=REQUEST
    ).json()
    assert len(_fake_calculation) == 1
    for body in (plain, named, other):
        assert body["net_income"] == ANSWER["net_income"]
    if named["definitions"][MEASURES[0]]["reform"]["binding"] == "content":
        assert (
            named["definitions"][MEASURES[0]]["reform"]
            == other["definitions"][MEASURES[0]]["reform"]
        )


def test_a_cached_answer_does_not_keep_an_earlier_requests_definitions():
    client.post(f"{ROUTE}?{_query([(MEASURES[0], COMMIT)])}", json=REQUEST)
    again = client.post(ROUTE, json=REQUEST).json()
    assert again["definitions"] == {}


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    year=st.sampled_from([2027, 2028, 2031]),
    income=st.integers(0, 200_000),
    include=st.sampled_from([[], ["by_policy"], ["by_policy", "sweep"]]),
)
def test_definitions_do_not_depend_on_the_household(year, income, include):
    request = {
        "year": year,
        "policies": MEASURES[:2],
        "household": {"employment_income": income, "salary_year": year},
        "include": include,
    }
    pairs = [(m, COMMIT) for m in MEASURES]
    body = client.post(f"{ROUTE}?{_query(pairs)}", json=request).json()
    assert body["definitions"] == {
        m: definitions.measure_definition(m, COMMIT) for m in MEASURES
    }


@pytest.mark.parametrize(
    "query",
    [
        "definition=x",
        f"definition={MEASURES[0]}:abc",
        f"definition={MEASURES[0]}:{COMMIT.upper()}",
        f"definition={MEASURES[0]}:{COMMIT}&definition={MEASURES[0]}:{OTHER}",
    ],
)
def test_a_malformed_definition_is_a_400_before_any_calculation(
    query, _fake_calculation
):
    response = client.post(f"{ROUTE}?{query}", json=REQUEST)
    assert response.status_code == 400
    assert "definition" in response.json()["detail"]
    assert _fake_calculation == []


def test_measures_unregistered_in_the_body_are_the_422_the_page_reads(
    _fake_calculation,
):
    """The page lists such measures unavailable by reading this 422
    (``unregisteredMeasures`` in householdImpactApi.js): every item on
    ``body.policies``, its message ending ``Unknown measures: `` and the
    ids, sorted and joined by ", ". Change one side, change the other
    (review of 52ec7a10)."""
    policies = ["zz_new_measure", MEASURES[0], "aa_other"]
    response = client.post(ROUTE, json={**REQUEST, "policies": policies})
    assert response.status_code == 422
    [item] = response.json()["detail"]
    assert item["loc"] == ["body", "policies"]
    match = re.search(r"Unknown measures: (.+)$", item["msg"])
    assert match is not None
    assert match.group(1).split(", ") == ["aa_other", "zz_new_measure"]
    assert _fake_calculation == []


@pytest.mark.parametrize(
    "unknown", ["added_since_this_revision", "autumn_budget_2026_combined"]
)
def test_a_measure_this_revision_does_not_register_is_reported_not_refused(
    unknown,
):
    """Review of #125, round 2: the page names every displayed measure, and
    a wave can add one while the previous API revision still serves (or
    after a rollback). A 400 would fail every Personal impact request; the
    unknown measure is reported unavailable and the rest still bind. A
    combined run is not a measure the household calculation registers."""
    pairs = [(unknown, COMMIT), (MEASURES[0], COMMIT)]
    response = client.post(f"{ROUTE}?{_query(pairs)}", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["definitions"] == {
        unknown: {"git_sha": COMMIT, "error": definitions.UNREGISTERED},
        MEASURES[0]: definitions.measure_definition(MEASURES[0], COMMIT),
    }
    assert body["net_income"] == ANSWER["net_income"]


def test_a_measure_the_running_code_cannot_bind_is_reported_not_refused(
    monkeypatch,
):
    def unbindable(measure_id, git_sha):
        return {"git_sha": git_sha, "error": "cannot be bound"}

    monkeypatch.setattr(definitions, "measure_definition", unbindable)
    body = client.post(
        f"{ROUTE}?{_query([(MEASURES[0], COMMIT)])}", json=REQUEST
    ).json()
    assert body["net_income"] == ANSWER["net_income"]
    assert body["definitions"][MEASURES[0]] == {
        "git_sha": COMMIT,
        "error": "cannot be bound",
    }


def test_one_measure_failing_does_not_fail_the_others(monkeypatch):
    real = definitions.get_reform

    def get_reform(measure_id):
        if measure_id == MEASURES[0]:
            raise RuntimeError("broken registration")
        return real(measure_id)

    monkeypatch.setattr(definitions, "get_reform", get_reform)
    pairs = [(MEASURES[0], COMMIT), (MEASURES[1], COMMIT)]
    response = client.post(f"{ROUTE}?{_query(pairs)}", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["definitions"][MEASURES[0]] == {
        "git_sha": COMMIT,
        "error": "RuntimeError: broken registration",
    }
    assert "error" not in body["definitions"][MEASURES[1]]
    assert body["net_income"] == ANSWER["net_income"]


WARNING_MODIFIER = """import warnings


def modifier(sim):
    warnings.warn("attributed to this module")
    return sim
"""


def test_an_in_process_run_cannot_unbind_the_definitions_it_answers_with(
    tmp_path, monkeypatch
):
    """With one worker, household runs share the API's process, and a
    warning attributed to a bound module leaves it unbindable. The answer's
    definitions are taken before the run, so the run cannot change them;
    a definition first asked for after such a run is reported as an
    error, which the page shows as the measure unavailable."""
    name = f"definitions_api_mutant_{uuid.uuid4().hex}"
    (tmp_path / f"{name}.py").write_text(WARNING_MODIFIER)
    monkeypatch.syspath_prepend(str(tmp_path))
    module = __import__(name)
    monkeypatch.setitem(sys.modules, name, module)
    reform = Reform(
        id=MEASURES[0], name="Mutant", simulation_modifier=module.modifier
    )
    monkeypatch.setattr(definitions, "get_reform", lambda _id: reform)
    expected = definitions.measure_definition(MEASURES[0], COMMIT)
    assert "error" not in expected
    definitions._definition.cache_clear()

    def calculate_in_process(answers, reform_ids, year, include=(), workers=1):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            module.modifier(None)
        return dict(ANSWER)

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate_in_process
    )
    body = client.post(
        f"{ROUTE}?{_query([(MEASURES[0], COMMIT)])}", json=REQUEST
    ).json()
    assert body["definitions"][MEASURES[0]] == expected
    assert "__warningregistry__" in vars(module)
    after = client.post(
        f"{ROUTE}?{_query([(MEASURES[0], OTHER)])}", json=REQUEST
    ).json()
    assert "error" in after["definitions"][MEASURES[0]]
