"""Run ``constituencies`` on Modal (``--backend modal``).

The plan is made here, exactly as for a local run; this module only
replaces where the steps run. Each measure goes to its own container
(``modal_constituencies.Constituencies.simulate``), and once every measure
has passed, the release goes to one more. Only the public table and the
timings come back: the units' arrays and the disclosure layer's audit stay
on the private Modal Volume. The table is then checked with
``validate_public`` here, and its review row printed, as after a local run.

It imports ``modal`` only when it runs, so the package works without it;
tests pass a fake ``session`` instead.
"""

import contextlib
from pathlib import Path
from typing import Callable, Iterator, Optional, Sequence

from rich.markup import escape

from uk_budget_data import constituencies as c
from uk_budget_data import geography

SECRET_MISSING = (
    "Modal secret missing: the policyengine workspace needs the secret "
    "'pe-uk-private-hf-read-token' (key HUGGING_FACE_TOKEN, a read-only "
    "token for populace-uk-private) before the constituency run can read "
    "the local-area cut. "
    "Owner: Anthony. Until then, run locally (--backend local)."
)


class ModalUnavailable(RuntimeError):
    """Modal cannot be used: not installed, no credentials, or no secret."""


class Session:
    """What ``execute`` needs of a backend: the units, then the release."""

    def simulate(self, specs: Sequence[dict]) -> Iterator:
        raise NotImplementedError

    def release(self, spec: dict) -> dict:
        raise NotImplementedError


@contextlib.contextmanager
def modal_session() -> Iterator[Session]:
    """An ephemeral Modal app for one run: it stops when the run ends."""
    try:
        import modal
    except ImportError as error:
        raise ModalUnavailable(
            "--backend modal needs the modal package: run the command with "
            "`uv run --with modal==1.6.2 uk-budget-data constituencies ...`"
        ) from error
    from uk_budget_data import modal_constituencies as mc

    class _Modal(Session):
        def __init__(self):
            self.remote = mc.Constituencies()

        def simulate(self, specs):
            return self.remote.simulate.map(
                specs, order_outputs=True, return_exceptions=True
            )

        def release(self, spec):
            return self.remote.release.remote(spec)

    try:
        with modal.enable_output(), mc.app.run():
            yield _Modal()
    except modal.exception.NotFoundError as error:
        raise ModalUnavailable(f"{SECRET_MISSING} ({error})") from error


def unit_spec(run: c.RunPlan, unit: c.Unit, dataset_spec: dict) -> dict:
    """What a container needs to simulate one measure: no local paths, and
    the cut by tag and SHA-256, never the file."""
    return {
        "reform": unit.reform,
        "key": unit.key,
        "run_id": run.run_id,
        "cut_tag": run.cut.tag,
        "cut_sha256": run.cut.sha256,
        "years": run.years,
        # geography._plan refused the file unless it is one.
        "microcosm_export": True,
        "dataset_key": dataset_spec["key"],
    }


def _measured(record: dict, ok: bool) -> c.Measured:
    container = record.get("container") or {}
    return c.Measured(
        returncode=0 if ok else 1,
        wall_s=float(container.get("wall_s") or 0.0),
        max_rss=container.get("max_rss"),
    )


def execute(
    run: c.RunPlan,
    units: list[c.Unit],
    dataset_spec: dict,
    directory: Path,
    steps: list[c.Step],
    release: list[c.Step],
    *,
    session: Optional[Callable[[], contextlib.AbstractContextManager]] = None,
) -> int:
    """Each measure in its own container, then, once every measure has
    passed, the release in one more. Appends each step as it ends; returns
    the exit code. Nothing is reused from an earlier run: the units' arrays
    live on the Volume, not here."""
    session = session or modal_session
    specs = [unit_spec(run, unit, dataset_spec) for unit in units]
    with session() as backend:
        c.console.print(
            f"Modal: {len(specs)} measure(s), one container each "
            f"(max {_max_containers()} at once)"
        )
        for unit, outcome in zip(units, backend.simulate(specs)):
            if isinstance(outcome, BaseException):
                c.console.print(
                    f"[red]{escape(unit.reform)}: failed on Modal: "
                    f"{escape(str(outcome))}[/red]"
                )
                steps.append(
                    c.Step(
                        name=unit.reform,
                        status=f"{c.FAILED} (Modal)",
                        measured=c.Measured(returncode=1, wall_s=0.0),
                    )
                )
                continue
            c._write_json(unit.result, outcome)
            step = c._step(
                unit.reform,
                outcome,
                c.SIMULATED,
                measured=_measured(outcome, True),
            )
            steps.append(step)
            c.console.print(f"{unit.reform}: {c._summary(step)}")
        if not c._every_unit_passed(run, steps):
            return 1

        stamp = c._stamp()
        release_name = f"{geography.MICROCOSM}-{stamp}"
        prior = (
            run.prior_regional.read_text(encoding="utf-8")
            if run.prior_regional
            else None
        )
        spec = {
            "run_id": run.run_id,
            "stamp": stamp,
            "release_name": release_name,
            "units": [{"reform": unit.reform} for unit in units],
            "years": run.years,
            "packages": {p: list(m) for p, m in run.packages.items()},
            "seat_reforms": run.ids,
            "prior_regional_csv": prior,
            "allow_demotions": run.allow_demotions,
            "simulate_s": sum(
                step.timings.get("simulate_s") or 0.0 for step in steps
            ),
        }
        c.console.print("Release: estimating, checking and writing, on Modal")
        try:
            payload = backend.release(spec)
            result, files = payload["result"], payload["files"]
        except Exception as error:  # noqa: BLE001 - reported, then stop
            c.console.print(
                f"[red]Error: the release failed on Modal: "
                f"{escape(str(error))}[/red]"
            )
            release.append(
                c.Step(
                    name="release",
                    status=f"{c.FAILED} (Modal)",
                    measured=c.Measured(returncode=1, wall_s=0.0),
                )
            )
            return 1
    status = result.get("status") or c.FAILED
    release.append(
        c.Step(
            name="release",
            status=status,
            timings=result,
            measured=_measured(result, status == "written"),
            record=result,
        )
    )
    if result.get("audit"):
        c.console.print(
            "Private audit: on the Modal Volume "
            f"{escape(_volume_name())}, {escape(result['audit'])}"
        )
    if status != "written":
        c.console.print(
            f"[red]Error: the release wrote no table ({escape(status)}).[/red]"
        )
        return 1
    out_dir = Path(run.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tables = []
    for name, data in files.items():
        if "/" in name or name in ("", ".", ".."):
            raise ModalUnavailable(f"Modal returned a bad file name {name!r}")
        path = out_dir / name
        path.write_bytes(data)
        tables.append(path)
    return c.report_tables(run, tables, release_name)


def _max_containers() -> int:
    try:
        from uk_budget_data.modal_constituencies import MAX_CONTAINERS

        return MAX_CONTAINERS
    except ImportError:
        return 11


def _volume_name() -> str:
    try:
        from uk_budget_data.modal_constituencies import VOLUME

        return VOLUME
    except ImportError:
        return "uk-budget-2026-constituencies-private"
