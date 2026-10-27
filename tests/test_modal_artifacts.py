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

from uk_budget_data.modal_runner import (
    ModalRunner,
    ModalRunsFailed,
    ModalUnavailable,
    Timed,
    assemble,
    phase_line,
)
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


def test_assembly_keeps_a_rerun_whose_receipt_differs_only_in_when(
    tmp_path, monkeypatch
):
    """A rerun at the same commit writes the same tables and a receipt
    whose artifact digest is the same (only the time and command line
    differ): unchanged, as locally, and the first receipt is kept."""
    from uk_budget_data.publication import receipt

    monkeypatch.setattr(
        receipt, "artifact_sha256", lambda document: document["digest"]
    )
    first = {**FILES, "receipt.json": b'{"digest": "d", "at": "1"}\n'}
    rerun = {**FILES, "receipt.json": b'{"digest": "d", "at": "2"}\n'}
    assemble(*_returned("alpha", first), tmp_path)
    again = assemble(*_returned("alpha", rerun), tmp_path)
    assert not again.reference.created
    target = tmp_path / "alpha" / "abcd1234abcd1234"
    assert (target / "receipt.json").read_bytes() == first["receipt.json"]
    other = {**FILES, "receipt.json": b'{"digest": "e", "at": "2"}\n'}
    with pytest.raises(ArtifactError, match="different files"):
        assemble(*_returned("alpha", other), tmp_path)


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


def test_one_failed_container_keeps_every_other_artifact(tmp_path):
    """A container that raises comes back in its place (Modal's
    return_exceptions): the artifacts before and after it are still written
    here, then the run stops naming the failed one and the written ones, so
    only the failed one is run again."""
    jobs = [
        Job("alpha", tmp_path),
        Job("beta", tmp_path),
        Job("gamma", tmp_path),
    ]
    said = []

    def remote_artifacts(sent, smoke):
        yield _returned("alpha", FILES)
        yield TimeoutError("Function timed out")
        yield _returned("gamma", FILES)

    reported = {}
    runner = ModalRunner(say=said.append, remote_artifacts=remote_artifacts)
    with pytest.raises(ModalRunsFailed) as raised:
        runner.map(
            run_artifact,
            jobs,
            on_result=lambda i, r: reported.setdefault(i, r),
        )
    for key in ("alpha", "gamma"):
        assert (tmp_path / key / "abcd1234abcd1234" / "receipt.json").exists()
    assert not (tmp_path / "beta").exists()
    # Every index is reported, the failed one as an outcome with no
    # artifact and no refusal, so an in-order report moves past it.
    assert sorted(reported) == [0, 1, 2]
    failed = reported[1]
    assert failed.key == "beta"
    assert failed.reference is None and failed.refused is None
    assert failed.progress == [
        "beta: FAILED in its Modal container: TimeoutError: Function timed out"
    ]
    assert raised.value.failed == {"beta": "TimeoutError: Function timed out"}
    assert [Path(p).parent.name for p in raised.value.written] == [
        "alpha",
        "gamma",
    ]
    assert "FAILED beta" in str(raised.value)


def test_a_rerun_after_a_failure_leaves_the_written_artifacts_unchanged(
    tmp_path,
):
    """Rerunning the whole set at the same commit is safe: the artifacts
    written before are unchanged (write-once), the failed one is written."""
    jobs = [Job("alpha", tmp_path), Job("beta", tmp_path)]
    first = ModalRunner(
        say=lambda m: None,
        remote_artifacts=lambda sent, smoke: [
            _returned("alpha", FILES),
            RuntimeError("out of memory"),
        ],
    )
    with pytest.raises(ModalRunsFailed):
        first.map(run_artifact, jobs)
    again = ModalRunner(
        say=lambda m: None,
        remote_artifacts=lambda sent, smoke: [
            _returned(job.key, FILES) for job in sent
        ],
    ).map(run_artifact, jobs)
    assert [r.reference.created for r in again] == [False, True]


def test_the_container_s_time_is_split_by_phase():
    times = []
    timed = Timed(lambda x: x * 2, times)
    assert timed(3) == 6 and len(times) == 1 and times[0] >= 0
    line = phase_line("alpha", 100.0, [40.0, 15.0], [30.0])
    assert line == (
        "alpha: 100 s in its Modal container (builds 40 + 15 s, tables 30 s, "
        "checks and receipt 15 s)"
    )
    assert phase_line("alpha", 5.0, [], []) == (
        "alpha: 5 s in its Modal container (checks and receipt 5 s)"
    )


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


def test_the_command_lists_failures_apart_from_refusals_and_the_rerun(
    monkeypatch,
):
    """generate --artifacts prints a failed container's run apart from a
    refusal, names the combined runs not started, says what to rerun (only
    the failed ones) and exits 1."""
    from types import SimpleNamespace

    from uk_budget_data.models import Reform
    from uk_budget_data.publication import commands, generate
    from uk_budget_data.publication.generate import GenerationReport

    alpha, beta = Reform(id="alpha", name="Alpha"), Reform(id="beta", name="B")

    def fake_generate(reforms, config, *, combined_sets, **options):
        return GenerationReport(
            refused={"gamma": "a decile cell under 10 households"},
            failed={"beta": "FunctionTimeoutError: timed out"},
            not_started={"combined--alpha+beta": ["alpha", "beta"]},
        )

    monkeypatch.setattr(generate, "generate_artifacts", fake_generate)
    lines = []
    code = commands.run_generate_artifacts(
        SimpleNamespace(combined=[["alpha", "beta"]], artifacts_root=None),
        None,
        [alpha, beta],
        {"alpha": alpha, "beta": beta}.get,
        out=lines.append,
    )
    assert code == 1
    assert lines[0] == (
        "0 artifacts written, 1 refused, 1 failed in their Modal containers, "
        "1 combined runs not started"
    )
    assert "REFUSED gamma: a decile cell under 10 households" in lines
    assert "FAILED beta: FunctionTimeoutError: timed out" in lines
    assert any(line.startswith("NOT STARTED combined--") for line in lines)
    assert any(line.endswith("--reforms beta") for line in lines)
    assert any(line.endswith("--combined alpha beta") for line in lines)
    assert not any("--reforms alpha" in line for line in lines)
