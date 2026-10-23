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

    def command(action, *options):
        argv = ["publish", "--data-root", str(data_root), "--inputs", str(inputs),
                action, *options]
        output = io.StringIO()
        started = time.perf_counter()
        with contextlib.redirect_stdout(output):
            status = dashboard_cli(argv)
        elapsed = time.perf_counter() - started
        result = {"argv": argv, "exit_code": status, "seconds": elapsed,
                  "output": output.getvalue()}
        calls.append(result)
        common.event("staging_command", action=action, exit_code=status,
                     seconds=elapsed, output=output.getvalue())
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
            "timed_commands_seconds": sum(call["seconds"] for call in calls),
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
    return save_result(True, None if preparation["source_manifest_present"] else
                       "Source origin/main has no tracked publication manifest; created scratch manifest, so no existing-entry adoption transition was measured")


if __name__ == "__main__":
    main()
