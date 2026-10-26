"""Run measures on Modal (``generate --backend modal``).

The runner sends each unit to ``modal_generate`` and returns the outcomes
in unit order, so the files written are the ones a local run writes. It
imports ``modal`` only when it runs, so the package works without it;
tests give it a fake ``remote`` (flat units) or ``remote_artifacts``
(receipted artifacts) instead.

Receipted artifacts (``--artifacts``) come back as files: the runner
writes each under the local artifacts root at the path the container gave
it, write-once (``assemble``). A receipt binds the execution it was made
in (platform, Python and package versions), so a Modal artifact carries
the container's execution identity, not this machine's: every artifact a
manifest holds must come from the same place, or staging needs
``--adopt-execution``, which marks every other entry stale.
"""

import io
import os
import shutil
import tarfile
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Callable, Iterable, Optional, Sequence

# ``remote(units)`` yields one outcome per unit, in unit order.
Remote = Callable[[Sequence], Iterable]
# ``remote_artifacts(jobs, smoke)`` yields ``(outcome, relative path,
# packed files)`` per job, in job order.
RemoteArtifacts = Callable[[Sequence, bool], Iterable]

SECRET_MISSING = (
    "Modal secret missing: the policyengine workspace needs the secret "
    "'pe-uk-private-hf-read-token' (key HUGGING_FACE_TOKEN, a read-only "
    "token for populace-uk-private) before measures can run on the "
    "bundle's dataset. Owner: Anthony. Until then, run locally with "
    "--jobs 1."
)


class ModalUnavailable(RuntimeError):
    """Raised when Modal cannot be used: not installed, or no credentials."""


def _import_modal():
    try:
        import modal
    except ImportError as error:
        raise ModalUnavailable(
            "--backend modal needs the modal package: run the command with "
            "`uv run --with modal==1.6.2 uk-budget-data ...`"
        ) from error
    return modal


def _modal_remote(units: Sequence) -> Iterable:
    """Run the units in an ephemeral Modal app, one container each."""
    modal = _import_modal()
    from uk_budget_data import modal_generate

    try:
        with modal.enable_output(), modal_generate.app.run():
            generator = modal_generate.Generator()
            yield from generator.run.map(units, order_outputs=True)
    except modal.exception.NotFoundError as error:
        raise ModalUnavailable(f"{SECRET_MISSING} ({error})") from error


def _modal_remote_artifacts(jobs: Sequence, smoke: bool) -> Iterable:
    """Run the artifacts in an ephemeral Modal app, one container each:
    the smoke app on the synthetic dataset, else the real one."""
    modal = _import_modal()
    from uk_budget_data import modal_generate

    target = modal_generate.smoke_app if smoke else modal_generate.app
    try:
        with modal.enable_output(), target.run():
            generator = (
                modal_generate.SmokeGenerator()
                if smoke
                else modal_generate.Generator()
            )
            yield from generator.run_artifact.map(jobs, order_outputs=True)
    except modal.exception.NotFoundError as error:
        raise ModalUnavailable(f"{SECRET_MISSING} ({error})") from error


def _unpack(files: bytes) -> dict[str, bytes]:
    out = {}
    with tarfile.open(fileobj=io.BytesIO(files), mode="r:gz") as archive:
        for member in archive.getmembers():
            name = member.name
            if not member.isfile() or "/" in name or name in ("", ".", ".."):
                raise ModalUnavailable(
                    f"Modal returned an unexpected archive entry {name!r}"
                )
            out[name] = archive.extractfile(member).read()
    return out


def assemble(outcome, relative: Optional[str], files: Optional[bytes], root):
    """Write a container's artifact under ``root``, as ``write_artifact``
    would: atomically, and never over different bytes. Returns the outcome
    with its reference pointing at the local directory."""
    from uk_budget_data.publication.artifacts import ArtifactError

    if outcome.reference is None:
        return outcome
    if relative is None or files is None:
        raise ModalUnavailable(
            f"{outcome.key}: Modal reported an artifact but sent no files"
        )
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ModalUnavailable(f"{outcome.key}: bad artifact path {relative}")
    if relative_path.parts[0] != outcome.key:
        raise ModalUnavailable(
            f"{outcome.key}: Modal returned the artifact of {relative}"
        )
    contents = _unpack(files)
    root = Path(root)
    target = root / relative_path
    container_path = outcome.reference.path
    created = True
    if target.exists():
        existing = {path.name: path.read_bytes() for path in target.iterdir()}
        if existing != contents:
            raise ArtifactError(
                f"{target} already exists with different files"
            )
        created = False
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=target.parent))
        try:
            for name, data in contents.items():
                (staging / name).write_bytes(data)
            os.replace(staging, target)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    outcome.reference = replace(
        outcome.reference, path=target, created=created
    )
    outcome.progress = [
        line.replace(str(container_path), str(target)).replace(
            ": wrote ", ": unchanged " if not created else ": wrote "
        )
        for line in outcome.progress
    ]
    return outcome


class ModalRunner:
    """Units on Modal, one container per unit, results in unit order."""

    def __init__(
        self,
        say: Callable[[str], None] = print,
        remote: Optional[Remote] = None,
        remote_artifacts: Optional[RemoteArtifacts] = None,
    ):
        self.say = say
        self.remote = remote or _modal_remote
        self.remote_artifacts = remote_artifacts or _modal_remote_artifacts

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        from uk_budget_data.pipeline import run_flat_unit
        from uk_budget_data.publication.generate import run_artifact

        if function is run_artifact:
            return self._map_artifacts(list(units), on_result)
        if function is not run_flat_unit:
            raise ModalUnavailable(
                "--backend modal runs the flat CSVs' measures and receipted "
                f"artifacts only (not {getattr(function, '__name__', function)})"
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

    def _map_artifacts(self, jobs, on_result) -> list:
        from uk_budget_data import synthetic_dataset

        if not jobs:
            return []
        synthetic = [
            job.dataset_path is not None
            and str(job.dataset_path).startswith(synthetic_dataset.PREFIX)
            for job in jobs
        ]
        for job, is_synthetic in zip(jobs, synthetic):
            if job.dataset_path is not None and not is_synthetic:
                raise ModalUnavailable(
                    "--backend modal never sends a dataset file: use the "
                    "bundle's dataset, or a synthetic: dataset to test"
                )
        if any(synthetic) and not all(synthetic):
            raise ModalUnavailable("one run mixes synthetic and real data")
        smoke = all(synthetic)
        self.say(
            f"Modal: {len(jobs)} artifacts, one container each"
            + (" (synthetic smoke test)" if smoke else "")
        )
        results = []
        for index, returned in enumerate(self.remote_artifacts(jobs, smoke)):
            if index >= len(jobs):
                raise ModalUnavailable("Modal returned more results than runs")
            outcome, relative, files = returned
            if outcome.key != jobs[index].key:
                raise ModalUnavailable(
                    f"Modal returned {outcome.key} in place of "
                    f"{jobs[index].key}"
                )
            outcome = assemble(
                outcome, relative, files, jobs[index].artifacts_root
            )
            results.append(outcome)
            on_result(index, outcome)
        if len(results) != len(jobs):
            raise ModalUnavailable(
                f"Modal returned {len(results)} results for {len(jobs)} runs"
            )
        return results


def _unit_id(unit) -> str:
    return unit.reform.id
