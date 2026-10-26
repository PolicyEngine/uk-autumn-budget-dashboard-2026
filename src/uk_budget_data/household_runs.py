"""Which of the Modal household service's run answers ``fan_out`` keeps.
Kept apart from ``modal_household`` so it can be tested without Modal
installed.

Each run reports the build commit of the container that ran it. A deploy's
change-over leaves containers of the previous version answering for a
while, and the response carries the commit of the container that serves it
(``runtime_identity``), not of the runs'. So a request any of whose runs
another build answered is refused: the page then asks Cloud Run for that
part, and no breakdown run partly by other code carries this build's
commit."""


class OtherBuildError(RuntimeError):
    """A run was answered by a container of another build."""


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
