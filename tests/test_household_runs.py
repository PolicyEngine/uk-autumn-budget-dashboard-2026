"""fan_out keeps a request's run answers only when every run was answered by
a container of its own build (household_runs.kept_results), the build each
run reports and the one fan_out compares them with both being the
container's GIT_SHA (household_runs.container_build)."""

import ast
import re
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data.household_runs import (
    OtherBuildError,
    container_build,
    fan_out_answers,
    kept_results,
    run_answer,
)

BUILD = "a" * 40
OTHER = "b" * 40
MODAL_HOUSEHOLD = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "uk_budget_data"
    / "modal_household.py"
)


def test_answers_from_this_build_are_kept_in_order():
    answers = [
        run_answer({"run": 0}, 1.25, "c1", BUILD),
        run_answer({"run": 1}, 2.0, "c2", BUILD),
        run_answer({"run": 2}, 0.5, "c1", BUILD),
    ]
    results, detail = kept_results(answers, BUILD)
    assert results == [{"run": 0}, {"run": 1}, {"run": 2}]
    assert detail == "on 2 containers (each run, s: 1.2, 2.0, 0.5)"


def test_a_run_answered_by_another_commit_refuses_the_request():
    answers = [
        run_answer({"run": 0}, 1.0, "c1", BUILD),
        run_answer({"run": 1}, 1.0, "c9", OTHER),
    ]
    with pytest.raises(OtherBuildError, match="1 of 2 runs"):
        kept_results(answers, BUILD)


def test_a_container_from_before_runs_reported_a_build_is_another_build():
    # Its answer is run_scenario's result alone
    answers = [run_answer({"run": 0}, 1.0, "c1", BUILD), {"household": 1}]
    with pytest.raises(OtherBuildError):
        kept_results(answers, BUILD)


def test_a_build_with_no_commit_keeps_only_answers_with_none():
    # A deploy that reports no commit: the page uses none of its parts, but
    # its runs still must not mix with a committed build's
    kept, _ = kept_results([run_answer(1, 1.0, "c1", None)], None)
    assert kept == [1]
    with pytest.raises(OtherBuildError):
        kept_results([run_answer(1, 1.0, "c1", BUILD)], None)
    with pytest.raises(OtherBuildError):
        kept_results([run_answer(1, 1.0, "c1", None)], BUILD)


_builds = st.sampled_from([BUILD, OTHER, None, "bare"])


@given(own=st.sampled_from([BUILD, OTHER, None]), builds=st.lists(_builds))
def test_kept_exactly_when_every_run_is_this_builds(own, builds):
    answers = [
        (
            index
            if build == "bare"
            else run_answer(index, 1.0, f"c{index}", build)
        )
        for index, build in enumerate(builds)
    ]
    if all(build == own for build in builds):
        results, _ = kept_results(answers, own)
        assert results == list(range(len(builds)))
    else:
        with pytest.raises(OtherBuildError):
            kept_results(answers, own)


@pytest.mark.parametrize(
    ("environ", "build"),
    [({"GIT_SHA": BUILD}, BUILD), ({"GIT_SHA": ""}, None), ({}, None)],
)
def test_container_build_is_git_sha_or_none(environ, build):
    assert container_build(environ) == build


def test_container_build_reads_this_containers_environment(monkeypatch):
    # Household.run calls it with no argument
    monkeypatch.setenv("GIT_SHA", BUILD)
    assert container_build() == BUILD
    monkeypatch.delenv("GIT_SHA")
    assert container_build() is None


def _run_map(answers: list):
    """A stand-in for ``Household().run.map``: the given answers, one per
    job, as a generator (as Modal's map gives them), and the jobs it was
    sent."""
    sent = []

    def run_map(jobs):
        sent.append(list(jobs))
        return (answer for answer in answers)

    return run_map, sent


def test_fan_out_keeps_runs_of_this_build_in_order_and_logs_them(capsys):
    run_map, sent = _run_map(
        [
            run_answer({"run": 0}, 1.25, "c1", BUILD),
            run_answer({"run": 1}, 2.0, "c2", BUILD),
            run_answer({"run": 2}, 0.5, "c1", BUILD),
        ]
    )
    jobs = [("job", 0), ("job", 1), ("job", 2)]
    results = fan_out_answers(run_map, jobs, {"GIT_SHA": BUILD})
    assert results == [{"run": 0}, {"run": 1}, {"run": 2}]
    assert sent == [jobs]
    assert re.fullmatch(
        r"household fan-out: 3 runs in \d+\.\d s on 2 containers "
        r"\(each run, s: 1\.2, 2\.0, 0\.5\)\n",
        capsys.readouterr().out,
    )


@pytest.mark.parametrize(
    "other",
    [
        run_answer({"run": 1}, 1.0, "c9", OTHER),
        # A container from before runs reported a build: the bare result
        {"run": 1},
        # A container whose image reports no commit
        run_answer({"run": 1}, 1.0, "c9", None),
    ],
    ids=["another commit", "bare result", "no commit"],
)
def test_fan_out_refuses_a_run_of_another_build_and_raises(other, capsys):
    run_map, _ = _run_map([run_answer({"run": 0}, 1.0, "c1", BUILD), other])
    with pytest.raises(OtherBuildError, match="1 of 2 runs"):
        fan_out_answers(run_map, [0, 1], {"GIT_SHA": BUILD})
    assert capsys.readouterr().out == (
        f"household fan-out refused: 1 of 2 runs were answered by another "
        f"build than {BUILD!r} (a deploy's change-over): ask Cloud Run\n"
    )


@pytest.mark.parametrize(
    "environ",
    [{"GIT_SHA": BUILD}, {"GIT_SHA": ""}, {}],
    ids=["this commit", "empty", "unset"],
)
def test_fan_out_compares_runs_with_its_own_build_not_theirs(environ):
    # Every run agrees with the others, all from a build not this one's
    run_map, _ = _run_map(
        [run_answer(index, 1.0, "c1", OTHER) for index in range(3)]
    )
    with pytest.raises(OtherBuildError, match="3 of 3 runs"):
        fan_out_answers(run_map, [0, 1, 2], environ)


@pytest.mark.parametrize(
    "environ", [{"GIT_SHA": ""}, {}], ids=["empty", "unset"]
)
def test_fan_out_with_no_commit_keeps_runs_with_no_commit(environ):
    # A deploy from a checkout whose files differ from its commit: the page
    # uses none of its parts, but its runs are its own
    run_map, _ = _run_map(
        [run_answer(index, 1.0, "c1", None) for index in [0, 1]]
    )
    assert fan_out_answers(run_map, [0, 1], environ) == [0, 1]


def test_fan_out_hands_over_each_run_as_it_arrives():
    """Each answer of this build is handed to on_result as the map gives
    it, before the later runs are answered (the headline's before and after
    runs, jobs 0 and 1, are not held back by a breakdown's other runs)."""
    seen = []
    produced = []

    def run_map(jobs):
        for index in jobs:
            # By the time run ``index`` is produced, every earlier run has
            # been handed over
            assert seen == [(i, {"run": i}) for i in range(index)]
            produced.append(index)
            yield run_answer({"run": index}, 1.0, "c1", BUILD)

    results = fan_out_answers(
        run_map,
        [0, 1, 2],
        {"GIT_SHA": BUILD},
        on_result=lambda i, result: seen.append((i, result)),
    )
    assert produced == [0, 1, 2]
    assert seen == [(0, {"run": 0}), (1, {"run": 1}), (2, {"run": 2})]
    assert results == [{"run": 0}, {"run": 1}, {"run": 2}]


@pytest.mark.parametrize(
    "other",
    [
        run_answer({"run": 1}, 1.0, "c9", OTHER),
        {"run": 1},
        run_answer({"run": 1}, 1.0, "c9", None),
    ],
    ids=["another commit", "bare result", "no commit"],
)
def test_fan_out_hands_over_nothing_from_or_after_another_build(other):
    """A run of another build is never handed over, nor any run after it,
    and the request is still refused as a whole."""
    seen = []
    run_map, _ = _run_map(
        [
            run_answer({"run": 0}, 1.0, "c1", BUILD),
            other,
            run_answer({"run": 2}, 1.0, "c1", BUILD),
        ]
    )
    with pytest.raises(OtherBuildError, match="1 of 3 runs"):
        fan_out_answers(
            run_map,
            [0, 1, 2],
            {"GIT_SHA": BUILD},
            on_result=lambda i, result: seen.append(i),
        )
    assert seen == [0]


_environs = st.sampled_from(
    [
        ({"GIT_SHA": BUILD}, BUILD),
        ({"GIT_SHA": OTHER}, OTHER),
        ({"GIT_SHA": ""}, None),
        ({}, None),
    ]
)


@given(environ_build=_environs, builds=st.lists(_builds))
def test_fan_out_returns_exactly_when_every_run_is_this_containers(
    environ_build, builds
):
    environ, own = environ_build
    answers = [
        (
            index
            if build == "bare"
            else run_answer(index, 1.0, f"c{index}", build)
        )
        for index, build in enumerate(builds)
    ]
    run_map, _ = _run_map(answers)
    jobs = list(range(len(builds)))
    if all(build == own for build in builds):
        assert fan_out_answers(run_map, jobs, environ) == jobs
    else:
        with pytest.raises(OtherBuildError):
            fan_out_answers(run_map, jobs, environ)


def _function(tree: ast.Module, name: str) -> ast.AST:
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
        ):
            return node
    raise AssertionError(f"modal_household has no {name}")


def _calls(node: ast.AST) -> set:
    return {
        call.func.id if isinstance(call.func, ast.Name) else call.func.attr
        for call in ast.walk(node)
        if isinstance(call, ast.Call)
        and isinstance(call.func, (ast.Name, ast.Attribute))
    }


def _is_call_to(node: ast.AST, name: str) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == name
    )


def test_modal_household_reports_each_runs_build_and_fan_out_checks_them():
    """modal_household needs Modal to import, so its source is read: the
    run answers with run_answer and the container's own build
    (container_build, which reads its environment), and fan_out is
    fan_out_answers over Household().run.map, with no handling of its own
    that could swallow OtherBuildError."""
    tree = ast.parse(MODAL_HOUSEHOLD.read_text(encoding="utf-8"))
    run = _function(tree, "run")
    assert "run_answer" in _calls(run)
    (answer,) = [
        node for node in ast.walk(run) if _is_call_to(node, "run_answer")
    ]
    build = (
        answer.args[3]
        if len(answer.args) > 3
        else {k.arg: k.value for k in answer.keywords}.get("build")
    )
    assert _is_call_to(build, "container_build")
    assert not build.args and not build.keywords

    fan_out = _function(tree, "fan_out")
    assert not [
        node
        for node in ast.walk(fan_out)
        if isinstance(node, (ast.Try, ast.TryStar))
    ]
    (returned,) = [
        node.value
        for node in ast.walk(fan_out)
        if isinstance(node, ast.Return)
    ]
    assert _is_call_to(returned, "fan_out_answers")
    run_map, jobs = returned.args
    # Only on_result, passed on as given: the container's own environment
    # (the default) is the build the runs are compared with
    ((keyword),) = returned.keywords
    assert keyword.arg == "on_result"
    assert isinstance(keyword.value, ast.Name)
    assert keyword.value.id == "on_result"
    # Household().run.map
    assert isinstance(run_map, ast.Attribute) and run_map.attr == "map"
    assert isinstance(run_map.value, ast.Attribute)
    assert run_map.value.attr == "run"
    assert _is_call_to(run_map.value.value, "Household")
    assert isinstance(jobs, ast.Name) and jobs.id == "jobs"
