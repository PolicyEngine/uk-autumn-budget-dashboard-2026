"""Receipted artifacts on Modal (``generate --artifacts --backend modal``).

Modal itself is never called here: the runner takes a fake
``remote_artifacts``, and the container side (``modal_generate``) is
exercised through ``_pack`` and ``assemble`` only.
"""

import io
import tarfile
from dataclasses import dataclass
from pathlib import Path

import pytest

from uk_budget_data.modal_runner import ModalRunner, ModalUnavailable, assemble
from uk_budget_data.publication.artifacts import ArtifactError, ArtifactRef
from uk_budget_data.publication.generate import ArtifactOutcome, run_artifact


@dataclass
class Job:
    key: str
    artifacts_root: Path
    dataset_path: str = None


def _packed(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def _returned(key: str, files: dict[str, bytes], digest="abcd1234abcd1234"):
    container = Path("/tmp/artifact-x/artifacts") / key / digest
    outcome = ArtifactOutcome(
        key=key,
        reference=ArtifactRef(
            key=key,
            path=container,
            outputs_sha256="1" * 64,
            receipt_sha256="2" * 64,
            execution_identity_sha256="3" * 64,
            artifact_sha256="4" * 64,
            created=True,
        ),
        progress=[f"{key}: wrote {container}"],
    )
    return outcome, f"{key}/{digest}", _packed(files)


FILES = {"receipt.json": b"{}\n", "budgetary_impact.csv": b"a,b\n1,2\n"}


def test_assembly_writes_the_container_files_locally_and_once(tmp_path):
    outcome = assemble(*_returned("alpha", FILES), tmp_path)
    target = tmp_path / "alpha" / "abcd1234abcd1234"
    assert outcome.reference.path == target and outcome.reference.created
    assert {p.name: p.read_bytes() for p in target.iterdir()} == FILES
    assert outcome.progress == [f"alpha: wrote {target}"]
    again = assemble(*_returned("alpha", FILES), tmp_path)
    assert not again.reference.created
    assert again.progress == [f"alpha: unchanged {target}"]


def test_assembly_never_replaces_published_bytes(tmp_path):
    assemble(*_returned("alpha", FILES), tmp_path)
    changed = {**FILES, "budgetary_impact.csv": b"a,b\n1,3\n"}
    with pytest.raises(ArtifactError, match="different files"):
        assemble(*_returned("alpha", changed), tmp_path)


def test_assembly_refuses_paths_outside_the_measure(tmp_path):
    outcome, _, files = _returned("alpha", FILES)
    for relative in ("beta/abcd", "../alpha/abcd", "/alpha/abcd"):
        with pytest.raises(ModalUnavailable):
            assemble(outcome, relative, files, tmp_path)
    nested = _packed({"sub/receipt.json": b"{}"})
    with pytest.raises(ModalUnavailable, match="archive entry"):
        assemble(outcome, "alpha/abcd", nested, tmp_path)


def test_a_refused_run_comes_back_as_it_is(tmp_path):
    refused = ArtifactOutcome(key="alpha", refused="no receipt")
    assert assemble(refused, None, None, tmp_path) is refused
    assert not any(tmp_path.iterdir())


def test_the_runner_fans_out_artifacts_in_order(tmp_path):
    jobs = [Job("alpha", tmp_path), Job("beta", tmp_path)]
    seen = []

    def remote_artifacts(sent, smoke):
        seen.append((list(sent), smoke))
        return [_returned(job.key, FILES) for job in sent]

    reported = []
    results = ModalRunner(
        say=lambda m: None, remote_artifacts=remote_artifacts
    ).map(run_artifact, jobs, on_result=lambda i, r: reported.append(i))
    assert [r.key for r in results] == ["alpha", "beta"]
    assert reported == [0, 1] and seen[0][1] is False
    assert (tmp_path / "beta" / "abcd1234abcd1234" / "receipt.json").exists()


def test_the_runner_refuses_a_result_for_another_measure(tmp_path):
    jobs = [Job("alpha", tmp_path)]
    runner = ModalRunner(
        say=lambda m: None,
        remote_artifacts=lambda sent, smoke: [_returned("beta", FILES)],
    )
    with pytest.raises(ModalUnavailable, match="beta in place of alpha"):
        runner.map(run_artifact, jobs)


def test_synthetic_runs_use_the_smoke_app_and_files_are_never_sent(tmp_path):
    smoke = []
    runner = ModalRunner(
        say=lambda m: None,
        remote_artifacts=lambda sent, is_smoke: smoke.append(is_smoke)
        or [_returned(job.key, FILES) for job in sent],
    )
    runner.map(run_artifact, [Job("alpha", tmp_path, "synthetic:10:1")])
    assert smoke == [True]
    with pytest.raises(ModalUnavailable, match="never sends a dataset"):
        runner.map(run_artifact, [Job("alpha", tmp_path, "local.h5")])
    with pytest.raises(ModalUnavailable, match="mixes"):
        runner.map(
            run_artifact,
            [Job("alpha", tmp_path, "synthetic:10:1"), Job("beta", tmp_path)],
        )


def test_modal_artifacts_need_a_clean_tree_on_the_bundle_s_data(monkeypatch):
    from uk_budget_data import cli
    from uk_budget_data.publication import receipt

    dirty = receipt.CodeRevision("a" * 40, False, ("src/x.py",))
    monkeypatch.setattr(receipt, "code_revision", lambda root: dirty)
    assert "clean working tree" in cli.modal_artifacts_problem(None)
    assert cli.modal_artifacts_problem("synthetic:10:1") == ""
    clean = receipt.CodeRevision("a" * 40, True)
    monkeypatch.setattr(receipt, "code_revision", lambda root: clean)
    assert cli.modal_artifacts_problem(None) == ""


def test_the_synthetic_dataset_is_the_same_wherever_it_is_built():
    from uk_budget_data import synthetic_dataset

    spec = synthetic_dataset.spec(20, 7)
    assert synthetic_dataset.parse(spec) == (20, 7)
    first = synthetic_dataset.build(20, 7)
    second = synthetic_dataset.build(20, 7)
    for table in ("person", "benunit", "household"):
        assert getattr(first, table).equals(getattr(second, table))
    assert len(first.household) == 20
    with pytest.raises(ValueError):
        synthetic_dataset.parse("data.h5")
