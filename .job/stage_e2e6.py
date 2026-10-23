"""Reconcile and hidden-stage one generated artifact only in the scratch repo."""
from __future__ import annotations

import time

COMMAND_STARTED = time.perf_counter()

import argparse
import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
JOB = Path(__file__).resolve().parent


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--repo-root", type=Path, default=JOB / "staging-repo")
    args = parser.parse_args(argv)
    source = args.artifact.resolve()
    repo = args.repo_root.resolve()
    if not source.is_relative_to(JOB) or not repo.is_relative_to(JOB):
        parser.error("Artifact and scratch repository must remain inside this job workspace")
    preparation = json.loads((JOB / "staging-preparation.json").read_text())

    import e2e_common as common

    common.configure_environment()
    initial_gates = common.COUNTERS["gates_s"]
    started = time.perf_counter()
    common.load_runtime()
    from uk_budget_data.cli import main as dashboard_cli
    from uk_budget_data.publication import manifest as manifest_api
    imports_seconds = time.perf_counter() - started
    startup_gate_seconds = common.COUNTERS["gates_s"] - initial_gates
    imports_seconds -= startup_gate_seconds
    common.gate("scratch artifact reconciliation and basis staging")

    data_root = repo / "public/data"
    inputs = repo / "data_inputs/treasury"
    receipt = json.loads((source / "receipt.json").read_text())
    key = receipt["dashboard"]["key"]
    target = data_root / "artifacts" / key / source.name
    started = time.perf_counter()
    if target.exists():
        for path in source.iterdir():
            if path.is_file() and path.name != "reconciliation.json":
                if (target / path.name).read_bytes() != path.read_bytes():
                    raise RuntimeError("Scratch copy already exists with different artifact bytes")
    else:
        shutil.copytree(source, target)
    copy_seconds = time.perf_counter() - started
    manifest_path = manifest_api.manifest_path(data_root)
    before = manifest_path.read_bytes() if manifest_path.exists() else None
    old_manifest = manifest_api.load_manifest(data_root)
    changed_basis = old_manifest.basis is not None and old_manifest.basis != receipt["dashboard"]["basis"]
    receipt_execution = receipt["dashboard"]["digests"]["execution_identity_sha256"]
    old_execution = (old_manifest.execution.execution_identity_sha256
                     if old_manifest.execution is not None else None)
    changed_execution = old_execution is not None and old_execution != receipt_execution
    calls = []
    fixture_result = None

    def command(action, *options, fixture=False, data_root_override=None):
        selected_root = data_root_override or data_root
        argv = ["publish", "--data-root", str(selected_root), "--inputs", str(inputs),
                action, *options]
        output = io.StringIO()
        started = time.perf_counter()
        with contextlib.redirect_stdout(output):
            status = dashboard_cli(argv)
        elapsed = time.perf_counter() - started
        result = {"argv": argv, "exit_code": status, "seconds": elapsed,
                  "output": output.getvalue(),
                  "scope": "labelled_basis_adoption_fixture" if fixture else "authentic_source_copy"}
        calls.append(result)
        common.event("staging_command", action=action, exit_code=status,
                     seconds=elapsed, output=output.getvalue(), scope=result["scope"])
        return result

    def save_result(staged, reason=None):
        after = manifest_path.read_bytes() if manifest_path.exists() else None
        payload = {
            "artifact": str(target), "staged": staged, "reason": reason,
            "source_dashboard_sha": preparation["source_dashboard_sha"],
            "source_manifest_present": preparation["source_manifest_present"],
            "scratch_manifest_present_before": before is not None,
            "old_execution_identity_sha256": old_execution,
            "artifact_execution_identity_sha256": receipt_execution,
            "changed_execution": changed_execution, "changed_basis": changed_basis,
            "basis_adoption_transition_tested": bool(before is not None and changed_basis and staged),
            "manifest_before_sha256": hashlib.sha256(before).hexdigest() if before else None,
            "manifest_after_sha256": hashlib.sha256(after).hexdigest() if after else None,
            "imports_seconds": imports_seconds, "startup_gate_seconds": startup_gate_seconds,
            "copy_seconds": copy_seconds, "commands": calls,
            "timed_commands_seconds": sum(call["seconds"] for call in calls
                                            if call["scope"] == "authentic_source_copy"),
            "labelled_basis_adoption_fixture": fixture_result,
            "fixture_timed_commands_seconds": sum(call["seconds"] for call in calls
                                                    if call["scope"] == "labelled_basis_adoption_fixture"),
            "whole_process_seconds_through_result": time.perf_counter() - COMMAND_STARTED,
            "scope": "Scratch hidden staging only; no approval, provisional display, real public write, or execution-identity adoption",
        }
        (JOB / "staging-results.json").write_text(json.dumps(payload, indent=2) + "\n")
        common.event("staging_complete", staged=staged, reason=reason,
                     source_manifest_present=preparation["source_manifest_present"],
                     copy_seconds=copy_seconds,
                     timed_commands_seconds=payload["timed_commands_seconds"])
        return payload

    reconciled = command("reconcile", str(target))
    if reconciled["exit_code"]:
        save_result(False, "Reconciliation command refused")
        raise SystemExit(reconciled["exit_code"])
    if changed_basis or changed_execution:
        refused = command("stage", str(target))
        if refused["exit_code"] == 0:
            save_result(False, "Unexpected acceptance without required adoption")
            raise RuntimeError("Stage accepted changed identity/basis without adoption")
        after_refusal = manifest_path.read_bytes() if manifest_path.exists() else None
        if after_refusal != before:
            save_result(False, "Refused staging changed the scratch manifest")
            raise RuntimeError("Refused staging changed the scratch manifest")
        if changed_execution:
            save_result(False, "Real source manifest execution identity differs; --adopt-basis alone cannot adopt it")
            raise SystemExit("Execution identity differs; stopped without --adopt-execution")
        if "stage with --adopt-basis" not in refused["output"]:
            save_result(False, "Refusal did not identify the expected basis-adoption gate")
            raise RuntimeError("Unexpected no-adoption refusal")
    adopted = command("stage", "--adopt-basis", str(target))
    if adopted["exit_code"]:
        save_result(False, "Hidden stage --adopt-basis refused under unchanged gates")
        raise SystemExit(adopted["exit_code"])
    staged_manifest = manifest_api.load_manifest(data_root)
    if staged_manifest.basis != receipt["dashboard"]["basis"]:
        raise RuntimeError("Scratch manifest did not adopt receipt basis")
    if staged_manifest.entries()[key].approval is not None:
        raise RuntimeError("Scratch hidden staging unexpectedly carried approval")

    # This deliberately constructed, separately labelled manifest exercises a
    # changed basis even though authentic origin/main currently has no manifest.
    # Its artifact and certification receipt are the actual generated bytes.
    fixture_result = {
        "label": "EXPLICIT SYNTHETIC MANIFEST FIXTURE: original main pre_budget basis, no entries or execution; actual unmodified generated artifact and certification receipt",
        "passed": False,
        "tests_existing_entry_staleness": False,
    }
    try:
        started = time.perf_counter()
        fixture_root = JOB / "basis-adoption-fixture"
        fixture_artifact = fixture_root / "artifacts" / key / target.name
        if fixture_artifact.exists():
            shutil.rmtree(fixture_artifact)
        shutil.copytree(target, fixture_artifact)
        original_basis = json.loads(subprocess.check_output([
            "git", f"--git-dir={JOB / 'history.git'}", "show",
            f"{preparation['source_dashboard_sha']}:data_inputs/publication_basis.json",
        ], text=True))
        if original_basis["forecast"]["status"] != "pre_budget":
            raise RuntimeError("Original main forecast basis is not pre_budget")
        if original_basis == receipt["dashboard"]["basis"]:
            raise RuntimeError("Fixture does not change the declared basis")
        fixture_manifest = manifest_api.Manifest(basis=original_basis)
        manifest_api.save_manifest(fixture_manifest, fixture_root)
        fixture_manifest_path = manifest_api.manifest_path(fixture_root)
        fixture_before = fixture_manifest_path.read_bytes()
        fixture_receipt_bytes = (fixture_artifact / "receipt.json").read_bytes()
        if fixture_receipt_bytes != (target / "receipt.json").read_bytes():
            raise RuntimeError("Fixture changed the actual certification receipt")
        fixture_result.update({
            "data_root": str(fixture_root), "artifact": str(fixture_artifact),
            "preparation_seconds": time.perf_counter() - started,
            "receipt_sha256": hashlib.sha256(fixture_receipt_bytes).hexdigest(),
            "receipt_unmodified": True,
            "manifest_before_sha256": hashlib.sha256(fixture_before).hexdigest(),
        })
        refused = command("stage", str(fixture_artifact), fixture=True,
                          data_root_override=fixture_root)
        if refused["exit_code"] == 0 or "stage with --adopt-basis" not in refused["output"]:
            raise RuntimeError("Fixture did not refuse the changed basis without adoption")
        if fixture_manifest_path.read_bytes() != fixture_before:
            raise RuntimeError("Fixture refusal changed the manifest")
        fixture_result["refused_without_adopt_and_manifest_unchanged"] = True
        adopted = command("stage", "--adopt-basis", str(fixture_artifact),
                          fixture=True, data_root_override=fixture_root)
        if adopted["exit_code"]:
            raise RuntimeError("Fixture --adopt-basis refused under the real staging gates")
        fixture_after = manifest_api.load_manifest(fixture_root)
        if fixture_after.basis != receipt["dashboard"]["basis"]:
            raise RuntimeError("Fixture did not adopt the actual receipt basis")
        if fixture_after.entries()[key].approval is not None:
            raise RuntimeError("Fixture staging unexpectedly carried an approval")
        if (fixture_artifact / "receipt.json").read_bytes() != fixture_receipt_bytes:
            raise RuntimeError("Fixture staging changed the certification receipt")
        fixture_result.update({
            "passed": True,
            "manifest_after_sha256": hashlib.sha256(fixture_manifest_path.read_bytes()).hexdigest(),
            "execution_identity_sha256": fixture_after.execution.execution_identity_sha256,
        })
    except Exception as error:
        fixture_result["error"] = f"{type(error).__name__}: {error}"
        save_result(True, "Authentic scratch staging completed; separately labelled basis-adoption fixture failed")
        raise
    return save_result(True, None if preparation["source_manifest_present"] else
                       "Source origin/main has no tracked publication manifest; created scratch manifest, so no existing-entry adoption transition was measured")


if __name__ == "__main__":
    main()
