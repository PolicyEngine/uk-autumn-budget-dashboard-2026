"""Combine recorded external timings without rerunning any model or command.

Missing, failed, or partly written evidence produces an explicit incomplete
summary. External command walls already contain imports, child gates and their
construction/calculation counters. Only supervisor gates outside those walls
are added, once per selected phase. Concurrent child walls are never summed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

JOB = Path(__file__).resolve().parent
YEARS = list(range(2026, 2031))


def finite_seconds(value):
    return isinstance(value, (float, int)) and math.isfinite(value) and value >= 0


def read_json(path, issues):
    if not path.is_file():
        issues.append({"path": str(path), "issue": "missing"})
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        issues.append({"path": str(path), "issue": str(error)})
        return None


def phase_rows(path, issues):
    if not path.is_file():
        issues.append({"path": str(path), "issue": "missing"})
        return []
    rows = []
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            issues.append({"path": str(path), "line": number, "issue": str(error)})
    return rows


def find_phase(rows, script, argument=None, containing=None):
    matches = []
    for row in rows:
        argv = [str(token) for token in row.get("command", [])]
        if script not in [Path(token).name for token in argv]:
            continue
        if argument is not None and str(argument) not in argv:
            continue
        if containing is not None and not any(containing in token for token in argv):
            continue
        matches.append(row)
    return matches[-1] if matches else None


def external_component(name, phase):
    result = {"name": name, "source": "phases.jsonl", "complete": False}
    if phase is None:
        result["reason"] = "No completed external phase record"
        return result
    result.update(label=phase.get("label"), exit_code=phase.get("exit_code"),
                  external_wall_seconds=phase.get("external_wall_seconds"),
                  supervisor_gate_seconds=phase.get("supervisor_gate_seconds", 0))
    if phase.get("exit_code") != 0:
        result["reason"] = "Latest matching command did not pass"
    elif not all(finite_seconds(result[key]) for key in
                 ("external_wall_seconds", "supervisor_gate_seconds")):
        result["reason"] = "Missing or invalid external/gate duration"
    else:
        result["complete"] = True
        result["counted_seconds"] = result["external_wall_seconds"] + result["supervisor_gate_seconds"]
    return result


def direct_import_component(name, record, supervisor_gate=0):
    result = {"name": name, "source": "importer-certified-timings.json", "complete": False,
              "supervisor_gate_seconds": supervisor_gate}
    if record is None:
        result["reason"] = "Primary certified-pin command record is missing"
        return result
    result.update(external_wall_seconds=record.get("external_seconds"),
                  exit_code=record.get("returncode"))
    if result["exit_code"] != 0:
        result["reason"] = "Primary certified-pin command did not pass"
    elif not finite_seconds(result["external_wall_seconds"]):
        result["reason"] = "Missing or invalid external duration"
    else:
        result["complete"] = True
        result["counted_seconds"] = result["external_wall_seconds"] + supervisor_gate
    return result


def finish_clock(seconds):
    start = dt.datetime(2026, 10, 23, 13, 30)
    finish = start + dt.timedelta(seconds=seconds)
    return finish.isoformat(timespec="seconds")


def timed_projection(base, batch_wall, count, gate, reference, budget, measures,
                     full_launcher_wall=None):
    batches = math.ceil(measures / count)
    total = base + batches * batch_wall + gate
    result = {
        "concurrency": count, "projected_measures": measures,
        "projected_batches": batches, "observed_batch_wall_seconds": batch_wall,
        "projected_generation_seconds": batches * batch_wall,
        "batch_supervisor_gate_counted_once_seconds": gate,
        "critical_path_seconds": total,
        "machine_margin_seconds": budget - total,
        "machine_fits": total <= budget,
        "finish_clock_from_1330": finish_clock(total),
        "maximum_remaining_human_review_and_rework_seconds": max(0, budget - total),
    }
    if reference is not None:
        repeated = total + reference
        result["conservative_repeat_frozen_reference"] = {
            "critical_path_seconds": repeated, "reference_added_once_seconds": reference,
            "machine_margin_seconds": budget - repeated, "machine_fits": repeated <= budget,
            "finish_clock_from_1330": finish_clock(repeated),
        }
    if finite_seconds(full_launcher_wall):
        envelope = base + batches * full_launcher_wall + gate
        result["conservative_repeat_full_batch_launcher"] = {
            "observed_launcher_external_seconds": full_launcher_wall,
            "critical_path_seconds": envelope, "machine_margin_seconds": budget - envelope,
            "machine_fits": envelope <= budget,
            "finish_clock_from_1330": finish_clock(envelope),
        }
    return result


def summarize(acquisition_seconds=600., measures=15, budget_seconds=8100.):
    issues = []
    phases = phase_rows(JOB / "phases.jsonl", issues)
    importer = read_json(JOB / "importer-certified-timings.json", issues) or {}
    inputs = read_json(JOB / "scratch/reviewed-inputs-certified/input-readiness.json", issues)
    reference = read_json(JOB / "probes/reference.json", issues)
    rebased = read_json(JOB / "probes/rebased.json", issues)
    serial = read_json(JOB / "outputs/serial-two-child/timings.json", issues)
    staging = read_json(JOB / "staging-results.json", issues)
    batches = {count: read_json(JOB / f"concurrency-{count}.json", issues)
               for count in (2, 3)}

    importer_phase = find_phase(phases, "import_workbooks_certified.py")
    # The importer launcher supervises both direct commands if present. Its
    # outer wall overlaps them; only its outside gate is assigned to step 1.
    importer_gate = (importer_phase.get("supervisor_gate_seconds", 0)
                     if importer_phase else 0)
    components = [
        {"name": "acquisition_estimate", "complete": True,
         "counted_seconds": acquisition_seconds, "estimated": True,
         "note": "Planning estimate for browser acquisition; no October download was timed"},
        direct_import_component("primary_certified_importer",
                                importer.get("certified_module_cli"), importer_gate),
        direct_import_component("reviewed_inputs_machine_only",
                                importer.get("certified_reviewed_inputs")),
        external_component("rebased_subset_probe",
                           find_phase(phases, "probes_e2e6.py", "rebased")),
        external_component("one_serial_national_measure",
                           find_phase(phases, "generate_e2e6.py", "two_child_limit",
                                      "serial-two-child")),
        external_component("scratch_staging_including_labelled_fixture",
                           find_phase(phases, "stage_e2e6.py")),
    ]
    reference_component = external_component(
        "frozen_reference_prepublication", find_phase(phases, "probes_e2e6.py", "reference"))
    reference_seconds = reference_component.get("counted_seconds")
    input_pass = bool(inputs and inputs.get("machine_only") is True
                      and inputs.get("forecast_sha256") ==
                      "6ae39003ef6897fa3cc591eb19eeefd45947df77de26eadcd2d602d6550284c3")
    reference_pass = bool(reference and reference.get("mode") == "reference"
                          and [row.get("year") for row in reference.get("rows", [])] == YEARS
                          and reference_component["complete"])
    probe_pass = bool(rebased and rebased.get("comparison", {}).get("passed") is True
                     and [row.get("year") for row in rebased.get("rows", [])] == YEARS
                     and reference and rebased.get("identity") == reference.get("identity"))
    serial_pass = bool(serial and serial.get("measure") == "two_child_limit"
                      and serial.get("years") == YEARS and not serial.get("refused")
                      and len(serial.get("years_by_table", {})) == 6
                      and all(years == YEARS for years in serial.get("years_by_table", {}).values()))
    staging_pass = bool(staging and staging.get("staged") is True)
    fixture_pass = bool(staging and (staging.get("labelled_basis_adoption_fixture") or {}).get("passed") is True)
    checks = {
        "certified_importer_command_passed": components[1]["complete"],
        "reviewed_inputs_command_passed": components[2]["complete"],
        "reviewed_input_readiness_valid": input_pass,
        "frozen_reference_valid": reference_pass,
        "rebased_subset_comparison_passed": probe_pass,
        "serial_measure_six_tables_five_years": serial_pass,
        "authentic_scratch_staging_passed": staging_pass,
        "labelled_real_receipt_basis_fixture_passed": fixture_pass,
        "all_required_external_phase_records_present_and_passed": all(row["complete"] for row in components),
    }
    base_complete = all(row["complete"] for row in components)
    base_seconds = sum(row.get("counted_seconds", 0) for row in components)
    concurrency = {}
    successful = []
    for count, batch in batches.items():
        phase = find_phase(phases, "concurrency_e2e6.py", count)
        phase_component = external_component(f"concurrency_{count}", phase)
        item = {
            "count": count, "evidence_present": batch is not None,
            "status": batch.get("status") if batch else "missing",
            "external_phase": phase_component,
            "complete": False,
        }
        if batch:
            item.update(batch_wall_seconds=batch.get("batch_wall_seconds"),
                        skip_reason=batch.get("skip_reason"),
                        resource_snapshot=batch.get("resource_snapshot"),
                        measured_peak_memory_decimal_gb_by_process={
                            child.get("measure", str(index)): child.get("peak_memory_decimal_gb")
                            for index, child in enumerate(batch.get("children", []))},
                        child_wall_times_counted=False)
            children = batch.get("children", [])
            item["complete"] = bool(batch.get("status") == "completed"
                                    and len(children) == count
                                    and all(child.get("complete") is True for child in children)
                                    and finite_seconds(batch.get("batch_wall_seconds"))
                                    and phase_component["complete"])
            if item["complete"]:
                successful.append(count)
                wall = batch["batch_wall_seconds"]
                gate = phase_component["supervisor_gate_seconds"]
                item["launcher_external_overhead_beyond_batch_seconds"] = max(
                    0, phase_component["external_wall_seconds"] - wall)
                if base_complete:
                    item["projection"] = timed_projection(
                        base_seconds, wall, count, gate, reference_seconds,
                        budget_seconds, measures, phase_component["external_wall_seconds"])
        concurrency[str(count)] = item
    checks["concurrency_two_assessed"] = bool(batches[2] and batches[2].get("status") in
                                             ("completed", "skipped_resource_gate"))
    checks["concurrency_three_assessed"] = bool(batches[3] and batches[3].get("status") in
                                               ("completed", "skipped_resource_gate"))
    checks["at_least_one_concurrent_batch_completed"] = bool(successful)
    selected_count = max(successful) if successful else None
    selected = concurrency[str(selected_count)].get("projection") if selected_count else None
    complete = all(checks.values())
    verdict = "INCOMPLETE: required measured stages have not all passed"
    if complete and selected:
        verdict = ("MACHINE ROUTE FITS; acquisition is estimated and human review remains unmeasured"
                   if selected["machine_fits"] else
                   "MACHINE ROUTE DOES NOT FIT the 13:30–15:45 window")
    diagnostic = importer.get("source_verification_and_parameter_copy", {})
    return {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "verdict": verdict, "complete_for_measured_machine_projection": complete,
        "firm_full_release_claim_supported": False,
        "remaining_checks": [name for name, passed in checks.items() if not passed],
        "checks": checks, "input_issues": issues,
        "window": {"start_clock": "13:30:00", "first_cut_clock": "15:45:00",
                   "available_seconds": budget_seconds, "clock_timezone": "Budget-day publication local clock"},
        "planning": {"acquisition_estimate_seconds": acquisition_seconds,
                     "projected_measure_count": measures,
                     "human_review_seconds": None, "human_review_counted": False,
                     "measure_heterogeneity_and_rework_measured": False,
                     "about_fifteen_measure_projection_is_extrapolation": True},
        "critical_path_components_before_projected_batches": components,
        "known_component_seconds": base_seconds,
        "all_base_components_measured_or_explicitly_estimated": base_complete,
        "prepublication_frozen_reference": reference_component,
        "prepublication_importer_source_verification_and_parameter_copy_seconds": diagnostic.get("seconds"),
        "concurrency": concurrency,
        "selected_largest_successfully_measured_concurrency": selected_count,
        "selected_projection": selected,
        "staging": {"source_manifest_present": staging.get("source_manifest_present") if staging else None,
                    "actual_existing_entry_basis_transition_tested": staging.get("basis_adoption_transition_tested") if staging else None,
                    "labelled_fixture": staging.get("labelled_basis_adoption_fixture") if staging else None},
        "counting_rules": [
            "Use each chosen external command wall once; its imports, child gates, construction and calculations are included already.",
            "Add a selected phase's supervisor_gate_seconds once because that gate preceded its external timer.",
            "Use ceil(15/k) times observed batch_wall_seconds; concurrent child walls and detailed subcounters are never added.",
            "Frozen references are prepublication; the repeat-reference variant adds their external wall and supervisor gate once.",
            "The full-launcher variant repeats observed batch admission/snapshot overhead as well as its child batch.",
            "Actual staging external wall conservatively includes the separately labelled basis-adoption fixture.",
            "Environment installation, diagnostic UK2.145 importer, and failed preparation attempts are excluded from the prepared Budget-day critical path.",
        ],
    }


def markdown(summary):
    lines = [summary["verdict"], ""]
    selected = summary.get("selected_projection")
    if selected:
        lines.extend([
            f"Selected concurrency: {selected['concurrency']}; {selected['projected_batches']} batches for 15 measures.",
            f"Machine critical path: {selected['critical_path_seconds'] / 60:.2f} min; "
            f"finish {selected['finish_clock_from_1330'][11:]}; "
            f"margin {selected['machine_margin_seconds'] / 60:.2f} min.",
            "",
        ])
    lines.extend(["| Concurrency | Status | Machine total | Margin |", "|---|---|---:|---:|"])
    for count, item in summary["concurrency"].items():
        projection = item.get("projection")
        total = f"{projection['critical_path_seconds'] / 60:.2f} min" if projection else "unmeasured"
        margin = f"{projection['machine_margin_seconds'] / 60:.2f} min" if projection else "—"
        lines.append(f"| {count} | {item['status']} | {total} | {margin} |")
    lines.extend(["", "Acquisition is a 10-minute estimate. Human review, approval and rework remain unmeasured and are excluded."])
    if summary["remaining_checks"]:
        lines.extend(["", "Incomplete checks: " + ", ".join(summary["remaining_checks"]) + "."])
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition-seconds", type=float, default=600.)
    parser.add_argument("--measures", type=int, default=15)
    parser.add_argument("--output", type=Path, default=JOB / "summary-e2e6.json")
    parser.add_argument("--markdown", type=Path, nargs="?", const=JOB / "summary-e2e6.md")
    args = parser.parse_args(argv)
    if not finite_seconds(args.acquisition_seconds) or args.measures <= 0:
        parser.error("Acquisition must be finite/nonnegative and measure count positive")
    for path in [args.output, args.markdown]:
        if path is not None and not path.resolve().is_relative_to(JOB):
            parser.error("Summary outputs must remain inside this workspace's .job")
    summary = summarize(args.acquisition_seconds, args.measures)
    args.output.write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    if args.markdown:
        args.markdown.write_text(markdown(summary))
    print(json.dumps({"verdict": summary["verdict"], "output": str(args.output),
                      "selected_projection": summary["selected_projection"],
                      "remaining_checks": summary["remaining_checks"]}, indent=2))


if __name__ == "__main__":
    main()
