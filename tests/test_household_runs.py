"""fan_out keeps a request's run answers only when every run was answered by
a container of its own build (household_runs.kept_results)."""

import ast
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data.household_runs import (
    OtherBuildError,
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


def test_modal_household_reports_each_runs_build_and_fan_out_checks_them():
    """modal_household needs Modal to import, so its source is read: the
    run answers with run_answer and fan_out keeps answers with
    kept_results."""
    tree = ast.parse(MODAL_HOUSEHOLD.read_text(encoding="utf-8"))
    assert "run_answer" in _calls(_function(tree, "run"))
    assert "kept_results" in _calls(_function(tree, "fan_out"))
