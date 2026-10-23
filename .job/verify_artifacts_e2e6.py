"""Verify scratch artifacts and retain hashes/schema/counts only, never rows.

Pass one or more completed generate_e2e6.py timings.json files. The verifier
loads only the existing pure-stdlib CSV and RFC 8785 helpers by file path;
it never imports a model, changes an artifact, stages, or approves a release.
"""
from __future__ import annotations

import argparse
import ast
import copy
import csv
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys


sys.dont_write_bytecode = True
JOB = Path(__file__).resolve().parent
TABLE_SOURCE = JOB / "runtime/src/uk_budget_data/publication/tables.py"
DASHBOARD_RECEIPT_SOURCE = JOB / "runtime/src/uk_budget_data/publication/receipt.py"
WRAPPER = JOB / "runtime/.venv/lib/python3.13/site-packages/policyengine"
CANONICAL_SOURCE = WRAPPER / "provenance/canonical.py"
RECEIPT_SOURCE = WRAPPER / "provenance/receipt.py"
EXPECTED_YEARS = [2026, 2027, 2028, 2029, 2030]
TABLE_NAMES = {
    "budgetary_impact", "distributional_impact", "winners_losers", "metrics",
    "income_curve", "household_scatter_binned",
}
CERTIFICATE_IDENTITY_FIELDS = (
    "bundle_version", "country_id", "certificate_sha256", "compatibility_basis",
    "certified_for_model_version", "certified_for_core_version",
    "certified_dataset_sha256", "certified_by",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load_stdlib_helper(name, path):
    """Skip the package __init__ files that import country models."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"Cannot load verification helper {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolves its defining module.
    spec.loader.exec_module(module)
    return module


def source_constant(path, name):
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError(f"Cannot locate contract constant {name}")


def checked_scratch_path(path):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(JOB):
        raise ValueError("Verification inputs and reports must stay in workspace scratch")
    return resolved


def verify_one(timing_path, tables, canonical, volatile_fields):
    timing_path = checked_scratch_path(timing_path)
    timing_bytes = timing_path.read_bytes()
    timing = json.loads(timing_bytes)
    measure = timing["measure"]
    if timing.get("refused") or set(timing.get("written", {})) != {measure}:
        raise ValueError("Timing record does not describe one completed artifact")
    if timing.get("years") != EXPECTED_YEARS:
        raise ValueError("Timing record does not cover all five years")
    artifact = checked_scratch_path(timing["written"][measure])
    receipt_bytes = (artifact / "receipt.json").read_bytes()
    document = json.loads(receipt_bytes)
    if document.get("schema") != "uk-budget-dashboard/artifact-receipt/v1":
        raise ValueError("Unexpected dashboard receipt schema")
    dashboard = document["dashboard"]
    execution = document["execution_receipt"]
    if dashboard.get("key") != measure:
        raise ValueError("Receipt key differs from timing measure")
    if execution.get("schema_version") != 1 or execution.get("receipt_type") != "policyengine.execution_receipt":
        raise ValueError("Unexpected execution receipt schema")
    if execution.get("years") != EXPECTED_YEARS:
        raise ValueError("Execution receipt does not cover all five years")
    if not set(EXPECTED_YEARS) <= set(execution.get("supported_years", [])):
        raise ValueError("Execution receipt marks a requested year unsupported")
    if execution["data"].get("dataset_sha256") != timing["hashes"]["national"]:
        raise ValueError("Receipt dataset bytes differ from the verified national input")
    for side, name, version in (
        ("wrapper", "policyengine", "6.10.0"),
        ("model", "policyengine-uk", "2.132.6"),
        ("core", "policyengine-core", "3.33.3"),
    ):
        if execution[side].get("name") != name or execution[side].get("version") != version:
            raise ValueError("Receipt runtime identities differ from the frozen certified pair")
    if dashboard.get("basis") != timing.get("basis"):
        raise ValueError("Receipt forecast basis differs from the generation timing record")

    expected_files = {name + ".csv" for name in TABLE_NAMES}
    actual_files = {path.name for path in artifact.glob("*.csv")}
    listed_files = dashboard.get("files", {})
    if actual_files != expected_files or set(listed_files) != expected_files:
        raise ValueError("Artifact and receipt must contain exactly the six aggregate CSVs")

    summaries = {}
    actual_hashes = {}
    for table in sorted(TABLE_NAMES):
        filename = table + ".csv"
        data = (artifact / filename).read_bytes()
        actual_hashes[filename] = sha256(data)
        if actual_hashes[filename] != listed_files[filename]:
            raise ValueError(f"Recorded file digest mismatch for {filename}")
        header = next(csv.reader(io.StringIO(data.decode("utf-8"), newline="")), [])
        identifiers = {column for column in header if column.endswith("_id") and column != "reform_id"}
        if identifiers:
            raise ValueError(f"Private identifiers in {filename}")
        if table == "household_scatter_binned" and set(header) & {
            "baseline_income", "income_change", "household_weight", "household_id",
            "person_id", "benunit_id",
        }:
            raise ValueError("Binned scatter contains individual-record fields")
        try:
            # The actual dashboard schema validates numeric columns as finite
            # while retaining textual reform names and decile labels as text.
            rows = tables.parse_csv(table, data)
            canonical_bytes = tables.canonical_csv(table, rows)
        except Exception as error:
            raise ValueError(f"CSV schema/numeric validation failed for {filename} ({type(error).__name__})") from None
        if canonical_bytes != data:
            raise ValueError(f"CSV is not in canonical form: {filename}")
        if not rows or any(row["reform_id"] != measure for row in rows):
            raise ValueError(f"CSV is empty or contains another measure: {filename}")
        years = sorted({row["year"] for row in rows})
        if years != EXPECTED_YEARS:
            raise ValueError(f"CSV does not cover all five years: {filename}")
        summaries[table] = {
            "sha256": actual_hashes[filename],
            "columns": header,
            "row_count": len(rows),
            "years": years,
            "finite_numeric_columns": [name for name, kind in tables.TABLES[table].columns if kind in (tables.INT, tables.FLOAT)],
            "schema_and_canonical_bytes_verified": True,
        }

    content_hash = lambda value: canonical.canonical_sha256(canonical.drop_null_members(value))
    outputs_hash = content_hash(actual_hashes)
    recorded = dashboard["digests"]
    if outputs_hash != execution.get("outputs_sha256") or outputs_hash != recorded.get("outputs_sha256"):
        raise ValueError("Actual table digests do not match receipt outputs_sha256")
    # These are exactly ExecutionReceipt.execution_identity and
    # receipt_payload in the inspected installed schema-v1 implementation.
    identity = {name: execution[name] for name in (
        "schema_version", "country_id", "wrapper", "model", "core", "data", "certification_status",
    )}
    certificate = execution.get("certificate")
    if certificate is not None:
        identity["certificate"] = {name: certificate[name] for name in CERTIFICATE_IDENTITY_FIELDS if name in certificate}
    identity_hash = content_hash(identity)
    receipt_payload = copy.deepcopy(execution)
    receipt_payload.pop("runtime", None)
    for side in ("reform", "baseline"):
        receipt_payload[side].pop("name", None)
    receipt_hash = content_hash(receipt_payload)
    if identity_hash != recorded.get("execution_identity_sha256"):
        raise ValueError("Recomputed execution identity digest differs")
    if receipt_hash != recorded.get("receipt_sha256"):
        raise ValueError("Recomputed receipt digest differs")
    artifact_hash = content_hash({
        "schema": document["schema"],
        "execution_receipt": execution,
        "dashboard": {name: value for name, value in dashboard.items() if name not in volatile_fields},
    })
    if artifact.name != artifact_hash[:16]:
        raise ValueError("Artifact directory does not match its receipt digest")

    status = execution.get("certification_status")
    if status not in ("certified", "uncertified"):
        raise ValueError("Unknown recorded certification status")
    if (status == "certified") != (certificate is not None):
        raise ValueError("Recorded certification status and certificate conflict")
    if certificate is not None:
        expected = {
            "country_id": execution["country_id"],
            "bundle_version": execution["wrapper"]["version"],
            "certified_for_model_version": execution["model"]["version"],
            "certified_for_core_version": execution["core"]["version"],
            "certified_dataset_sha256": execution["data"]["dataset_sha256"],
        }
        if any(certificate.get(name) != value for name, value in expected.items()):
            raise ValueError("Certificate fields conflict with runtime identities")

    return {
        "timing_path": str(timing_path),
        "timing_file_sha256": sha256(timing_bytes),
        "measure": measure,
        "artifact_path": str(artifact),
        "receipt_file_sha256": sha256(receipt_bytes),
        "receipt_sha256": receipt_hash,
        "execution_identity_sha256": identity_hash,
        "outputs_sha256": outputs_hash,
        "artifact_sha256": artifact_hash,
        "tables": summaries,
        "recorded_certification_status": status,
        "recorded_certificate_basis": certificate.get("compatibility_basis") if certificate else None,
        "recorded_certificate": certificate,
        "certificate_cross_field_consistency_verified": True,
        "certificate_trust_note": "Recorded claim and identity consistency only; publisher certificate verification and release approval remain the normal publication gates.",
        "runtime_identities": {name: execution[name] for name in ("wrapper", "model", "core", "data")},
        "years": execution["years"],
        "supported_years": execution["supported_years"],
        "git_sha": dashboard.get("git_sha"),
        "integrity_and_aggregate_shape_verified": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timings", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    sources = (TABLE_SOURCE, DASHBOARD_RECEIPT_SOURCE, CANONICAL_SOURCE, RECEIPT_SOURCE)
    source_hashes = {str(path): sha256(path.read_bytes()) for path in sources}
    modules_before = set(sys.modules)
    tables = load_stdlib_helper("_e2e_dashboard_tables", TABLE_SOURCE)
    canonical = load_stdlib_helper("_e2e_receipt_canonical", CANONICAL_SOURCE)
    if any(name.startswith(("policyengine", "numpy", "pandas")) for name in set(sys.modules) - modules_before):
        raise RuntimeError("Verifier imported a model or numerical dependency")
    volatile_fields = source_constant(DASHBOARD_RECEIPT_SOURCE, "VOLATILE_DASHBOARD_FIELDS")
    results = [verify_one(path, tables, canonical, volatile_fields) for path in args.timings]
    for path, value in source_hashes.items():
        if sha256(Path(path).read_bytes()) != value:
            raise RuntimeError("Verification helper source changed during verification")
    report = {
        "verified_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "Scratch artifact integrity and aggregate schema only; no release approval",
        "helper_source_sha256": source_hashes,
        "artifacts": results,
    }
    output = args.output
    if output is None:
        identity = sha256(json.dumps([str(path.resolve()) for path in args.timings], separators=(",", ":")).encode())[:12]
        output = JOB / "verification" / f"artifacts-{identity}.json"
    output = checked_scratch_path(output)
    if output.is_relative_to(JOB / "outputs"):
        raise ValueError("Keep verification evidence outside the original artifact outputs")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(output), "verified_artifacts": len(results), "passed": True}))


if __name__ == "__main__":
    main()
