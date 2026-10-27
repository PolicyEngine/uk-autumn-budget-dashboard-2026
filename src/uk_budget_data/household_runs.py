"""Which of the Modal household service's run answers ``fan_out`` keeps,
and the build both ``Household.run`` and ``fan_out`` read. Kept apart from
``modal_household`` so it can be tested without Modal installed.

Each run reports the build commit of the container that ran it. A deploy's
change-over leaves containers of the previous version answering for a
while, and the response carries the commit of the container that serves it
(``runtime_identity``), not of the runs'. So a request any of whose runs
another build answered is refused: the page then asks Cloud Run for that
part, and no breakdown run partly by other code carries this build's
commit."""

import os
import time
from collections.abc import Callable, Iterable, Mapping


class OtherBuildError(RuntimeError):
    """A run was answered by a container of another build."""


def container_build(environ: Mapping[str, str] = os.environ) -> str | None:
    """This container's build: the commit its image reports (``GIT_SHA``),
    or None when it reports none (a deploy whose files are not exactly its
    checkout's commit). ``Household.run`` reports it with each run and
    ``fan_out`` compares the runs' with its own, so both read it here."""
    return environ.get("GIT_SHA") or None


def run_answer(
    result: object, seconds: float, container: str, build: str | None
) -> dict:
    """What ``Household.run`` returns: the run's result, its time and
    container for ``fan_out``'s log line, and the container's build."""
    return {
        "result": result,
        "seconds": seconds,
        "container": container,
        "git_sha": build,
    }


def _is_run_answer(answer: object) -> bool:
    return isinstance(answer, dict) and {
        "result",
        "seconds",
        "container",
        "git_sha",
    } <= set(answer)


def kept_results(answers: list, build: str | None) -> tuple[list, str]:
    """The runs' results, in order, and the log line's detail, when every
    run was answered by a container of ``build`` (this container's).

    Raises:
        OtherBuildError: when any answer comes from another build: another
            commit, or a container from before runs reported one (its
            answer is the bare result).
    """
    other = [
        index
        for index, answer in enumerate(answers)
        if not _is_run_answer(answer) or answer["git_sha"] != build
    ]
    if other:
        raise OtherBuildError(
            f"{len(other)} of {len(answers)} runs were answered by another "
            f"build than {build!r} (a deploy's change-over): ask Cloud Run"
        )
    runs = ", ".join(f"{float(answer['seconds']):.1f}" for answer in answers)
    containers = len({answer["container"] for answer in answers})
    detail = f"on {containers} containers (each run, s: {runs})"
    return [answer["result"] for answer in answers], detail


def fan_out_answers(
    run_map: Callable[[list], Iterable],
    jobs: list,
    environ: Mapping[str, str] = os.environ,
    on_result: Callable[[int, object], None] | None = None,
) -> list:
    """What ``fan_out`` does, given the map that sends each job to its own
    ``Household`` container (``Household().run.map``) and this container's
    environment: the runs' results, in order, logged with their times.

    ``on_result(index, result)`` is called for each run as its answer
    arrives (the map gives them in order), so a request waiting on the
    first runs (the headline's before and after, jobs 0 and 1) is answered
    without waiting for the rest of the batch (the split by policy's or the
    sweep's runs). Only answers of this container's build are handed over,
    and none after the first of another build.

    Raises:
        OtherBuildError: when a container of another build than this
            container's (``container_build``) answered any run; the page
            then asks Cloud Run.
    """
    started = time.perf_counter()
    build = container_build(environ)
    answers = []
    handing_over = on_result is not None
    for index, answer in enumerate(run_map(jobs)):
        answers.append(answer)
        if handing_over:
            if _is_run_answer(answer) and answer["git_sha"] == build:
                on_result(index, answer["result"])
            else:
                handing_over = False
    try:
        results, detail = kept_results(answers, build)
    except OtherBuildError as error:
        print(f"household fan-out refused: {error}")
        raise
    print(
        f"household fan-out: {len(jobs)} runs in "
        f"{time.perf_counter() - started:.1f} s {detail}"
    )
    return results
