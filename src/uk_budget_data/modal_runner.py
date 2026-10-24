"""Run the flat CSVs' measures on Modal (``generate --backend modal``).

The runner sends each unit to ``modal_generate.Generator.run`` and returns
the outcomes in unit order, so the files written are the ones a local run
writes. It imports ``modal`` only when it runs, so the package works
without it; tests give it a fake ``remote`` instead.

Only the flat CSVs (and ``--only``) run on Modal. ``--artifacts`` does not:
a receipt binds the execution it was made in (platform, Python and package
versions), and a container's differs from the entries made locally.
"""

from typing import Callable, Iterable, Optional, Sequence

# ``remote(units)`` yields one outcome per unit, in unit order.
Remote = Callable[[Sequence], Iterable]


class ModalUnavailable(RuntimeError):
    """Raised when Modal cannot be used: not installed, or no credentials."""


def _modal_remote(units: Sequence) -> Iterable:
    """Run the units in an ephemeral Modal app, one container each."""
    try:
        import modal
    except ImportError as error:
        raise ModalUnavailable(
            "--backend modal needs the modal package: run the command with "
            "`uv run --with modal==1.6.2 uk-budget-data ...`"
        ) from error
    from uk_budget_data import modal_generate

    with modal.enable_output(), modal_generate.app.run():
        generator = modal_generate.Generator()
        yield from generator.run.map(units, order_outputs=True)


class ModalRunner:
    """Units on Modal, one container per unit, results in unit order."""

    def __init__(
        self,
        say: Callable[[str], None] = print,
        remote: Optional[Remote] = None,
    ):
        self.say = say
        self.remote = remote or _modal_remote

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        from uk_budget_data.pipeline import run_flat_unit

        if function is not run_flat_unit:
            raise ModalUnavailable(
                "--backend modal runs the flat CSVs' measures only "
                f"(not {getattr(function, '__name__', function)})"
            )
        units = list(units)
        for unit in units:
            if unit.dataset_path is not None:
                raise ModalUnavailable(
                    "--backend modal runs on the bundle's dataset only: a "
                    "local --dataset is not in the container"
                )
        self.say(f"Modal: {len(units)} measures, one container each")
        results = []
        for index, outcome in enumerate(self.remote(units)):
            if index >= len(units):
                raise ModalUnavailable(
                    "Modal returned more results than units"
                )
            if outcome.reform_id != _unit_id(units[index]):
                raise ModalUnavailable(
                    f"Modal returned {outcome.reform_id} in place of "
                    f"{_unit_id(units[index])}"
                )
            results.append(outcome)
            on_result(index, outcome)
        if len(results) != len(units):
            raise ModalUnavailable(
                f"Modal returned {len(results)} results for {len(units)} units"
            )
        return results


def _unit_id(unit) -> str:
    return unit.reform.id
