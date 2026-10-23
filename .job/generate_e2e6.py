"""Time one rebased national registered measure through the real generator.

Only aggregate tables and timing records are persisted. The generator's own
exact-byte dataset copy, receipt construction and output writer remain active.
Run each concurrency member in its own interpreter and output directory.
"""
from __future__ import annotations

import time

COMMAND_STARTED = time.perf_counter()

import argparse
import copy
import functools
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import resource
import sys
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
NATIONAL = Path(
    "/Users/maxghenis/PolicyEngine/uk-autumn-budget-dashboard-2026/"
    ".claude/worktrees/practical-kapitsa-1b128a/data/microcosm_uk_2024_25.h5"
)
FORECAST = Path(
    "/Users/maxghenis/reviews/uk-hub/jobs/obr-rebase-dry-run/inputs/forecast.json"
)
EXPECTED = {
    "national": "810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece",
    "forecast": "6ae39003ef6897fa3cc591eb19eeefd45947df77de26eadcd2d602d6550284c3",
}
YEARS = [2026, 2027, 2028, 2029, 2030]
TABLES = {
    "budgetary_impact", "distributional_impact", "winners_losers", "metrics",
    "income_curve", "household_scatter_binned",
}


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def registered_measures(forecast):
    """The PR #94 factory refresh, preserving every policy and modifier."""
    from policyengine_uk.tax_benefit_system import CountryTaxBenefitSystem
    from policyengine_uk.utils.scenario import Scenario
    from uk_budget_data import reforms as registry

    forecast_system = CountryTaxBenefitSystem()
    assignments = Scenario.from_reform(forecast).dated_assignments()
    if forecast and not assignments:
        raise RuntimeError("Forecast produced no dated assignments")
    forecast_system.apply_parameter_assignments(assignments)
    system_module = importlib.import_module("policyengine_uk.system")
    rpi_path = "gov.economic_assumptions.indices.obr.rpi"
    old_rpi = system_module.system.parameters.get_child(rpi_path)
    new_rpi = forecast_system.parameters.get_child(rpi_path)
    if any(
        not math.isclose(old_rpi(f"{year}-{day}"), new_rpi(f"{year}-{day}"),
                         rel_tol=1e-12)
        for year in YEARS for day in ("04-01", "04-06")
    ):
        raise RuntimeError("Processed RPI changed; review hardcoded fuel-duty counterfactuals")
    cache_names = [name for name in vars(registry) if name.endswith("_CACHE")]
    aliases = ["PRE_AUTUMN_BUDGET_BASELINE", "FREEZE_STUDENT_LOAN_THRESHOLDS",
               "AUTUMN_BUDGET_2026_REFORMS", "ALL_REFORMS"]
    with patch.object(system_module, "system", forecast_system), \
            patch.multiple(registry, **{name: None for name in cache_names + aliases}):
        fresh = [measure.model_copy(deep=True)
                 for measure in registry.get_autumn_budget_2026_reforms()]

    def merged(policy):
        policy = policy or {}
        collisions = sorted(set(forecast) & set(policy))
        if collisions:
            raise RuntimeError("Review forecast/policy collisions: " + ", ".join(collisions))
        return {**copy.deepcopy(forecast), **copy.deepcopy(policy)}

    return [measure.model_copy(deep=True, update={
        "parameter_changes": merged(measure.parameter_changes),
        "baseline_parameter_changes": merged(measure.baseline_parameter_changes),
    }) for measure in fresh]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("measure")
    parser.add_argument("outputdir", type=Path)
    parser.add_argument("--repo-root", type=Path, default=ROOT / "staging-repo")
    args = parser.parse_args(argv)
    if args.measure in ("dividend_tax_increase_2pp", "autumn_budget_2026_combined"):
        parser.error("Use a standalone measure without the separately reviewed dividend period defect")
    output = args.outputdir.resolve()
    if not output.is_relative_to(ROOT.resolve()):
        parser.error("Output directory must stay within this workspace's .job")
    repo_root = args.repo_root.resolve()
    if not repo_root.is_relative_to(ROOT.resolve()):
        parser.error("Scratch repository must stay within this workspace's .job")

    import e2e_common as common

    common.configure_environment()
    # The common loader checks actual import certification before any model run.
    initial_gates = common.COUNTERS["gates_s"]
    import_cpu_started = time.process_time()
    import_started = time.perf_counter()
    common.load_runtime()
    from uk_budget_data.models import DataConfig
    from uk_budget_data.pipeline import ReformProcessor
    from uk_budget_data.publication import generate
    framework = importlib.import_module("policyengine_uk.simulation")
    startup_gate_seconds = common.COUNTERS["gates_s"] - initial_gates
    import_seconds = time.perf_counter() - import_started - startup_gate_seconds
    import_cpu_seconds = time.process_time() - import_cpu_started

    verification_started = time.perf_counter()
    hashes = {"national": digest(NATIONAL), "forecast": digest(FORECAST)}
    if hashes != EXPECTED:
        raise RuntimeError(f"Input hash mismatch: {hashes}")
    forecast = json.loads(FORECAST.read_text())
    basis = json.loads((repo_root / "data_inputs/publication_basis.json").read_text())
    if basis["forecast"]["status"] != "updated":
        raise RuntimeError("Scratch receipt basis must declare updated forecast status")
    verification_seconds = time.perf_counter() - verification_started

    registry_started = time.perf_counter()
    measures = registered_measures(forecast)
    selected = [measure for measure in measures if measure.id == args.measure]
    if len(selected) != 1:
        raise RuntimeError(f"Expected one registered measure {args.measure!r}")
    registry_seconds = time.perf_counter() - registry_started
    output.mkdir(parents=True, exist_ok=True)
    cfg = DataConfig(dataset_path=NATIONAL, years=YEARS, output_dir=output)

    # Durations of root calls are disjoint. Internal constructor durations are
    # diagnostic only and never added to the root constructor accumulator.
    ledger = {
        "gate_seconds": 0.0,
        "construction_seconds": 0.0,
        "build_seconds_excluding_gates": 0.0,
        "build_construction_seconds": 0.0,
        "process_seconds_excluding_gates": 0.0,
        "process_construction_seconds": 0.0,
        "constructors": [], "builds": [], "processes": [], "calculators": [],
    }
    constructor_depth = 0
    phase = "generation"
    original_init = framework.Simulation.__init__
    original_build = generate._default_build

    def gated(label):
        started = time.perf_counter()
        common.gate(label)
        duration = time.perf_counter() - started
        ledger["gate_seconds"] += duration
        return duration

    @functools.wraps(original_init)
    def guarded_init(self, *positional, **kwargs):
        nonlocal constructor_depth
        root_call = constructor_depth == 0
        depth = constructor_depth
        gated(f"generate {args.measure}: {phase} Simulation depth={depth}")
        before_gates = ledger["gate_seconds"]
        started = time.perf_counter()
        constructor_depth += 1
        try:
            return original_init(self, *positional, **kwargs)
        finally:
            constructor_depth -= 1
            seconds = time.perf_counter() - started - (ledger["gate_seconds"] - before_gates)
            ledger["constructors"].append({"phase": phase, "depth": depth,
                                            "seconds_excluding_gates": seconds})
            if root_call:
                ledger["construction_seconds"] += seconds
                if phase in ("build", "process"):
                    ledger[phase + "_construction_seconds"] += seconds
                common.event("generation_construction", measure=args.measure, phase=phase,
                             seconds_excluding_gates=seconds)

    def build(dataset_path, scenario=None):
        nonlocal phase
        previous = phase
        phase = "build"
        before_gates = ledger["gate_seconds"]
        started = time.perf_counter()
        try:
            gated(f"generate {args.measure}: default-build private-copy")
            # Preserve the dashboard's official exact-byte private-copy path.
            return original_build(dataset_path, scenario)
        finally:
            seconds = time.perf_counter() - started - (ledger["gate_seconds"] - before_gates)
            ledger["build_seconds_excluding_gates"] += seconds
            ledger["builds"].append({"seconds_excluding_gates": seconds})
            common.event("generation_build", measure=args.measure,
                         seconds_excluding_gates=seconds)
            phase = previous

    def process(measure, config, baseline, reformed, baseline_scenario):
        nonlocal phase
        previous = phase
        phase = "process"
        processor = ReformProcessor(measure, config)
        for name in ("budgetary_calc", "distributional_calc", "winners_losers_calc",
                     "metrics_calc", "income_curve_calc", "household_scatter_calc"):
            calculator = getattr(processor, name)
            original_calculate = calculator.calculate

            def measured(*positional, _name=name, _calculate=original_calculate, **kwargs):
                gates = ledger["gate_seconds"]
                constructors = ledger["construction_seconds"]
                started = time.perf_counter()
                try:
                    return _calculate(*positional, **kwargs)
                finally:
                    seconds = (time.perf_counter() - started
                               - (ledger["gate_seconds"] - gates)
                               - (ledger["construction_seconds"] - constructors))
                    ledger["calculators"].append({"calculator": _name,
                                                   "calculation_seconds": seconds})
            calculator.calculate = measured
        gates = ledger["gate_seconds"]
        started = time.perf_counter()
        try:
            return processor.process(baseline, reformed, baseline_scenario)
        finally:
            seconds = time.perf_counter() - started - (ledger["gate_seconds"] - gates)
            ledger["process_seconds_excluding_gates"] += seconds
            ledger["processes"].append({"seconds_excluding_gates": seconds})
            common.event("generation_process", measure=args.measure,
                         seconds_excluding_gates=seconds)
            phase = previous

    common.event("generation_start", measure=args.measure, output=str(output),
                 imports_seconds=import_seconds, registry_seconds=registry_seconds)
    generation_started = time.perf_counter()
    generation_cpu_started = time.process_time()
    with patch.object(framework.Simulation, "__init__", guarded_init):
        report = generate.generate_artifacts(
            selected, cfg, artifacts_root=output / "artifacts", repo_root=repo_root,
            generator_argv=["generate_e2e6.py", args.measure, str(output)],
            build=build, process=process,
            on_progress=lambda message: common.event("generation_progress", message=message),
        )
    generation_seconds = time.perf_counter() - generation_started
    generation_cpu_seconds = time.process_time() - generation_cpu_started
    written = {reference.key: str(reference.path) for reference in report.written}
    if report.refused or set(written) != {args.measure}:
        raise RuntimeError(f"Generation did not complete: {report.refused}; written={written}")
    artifact_path = Path(written[args.measure])
    actual_tables = {path.stem for path in artifact_path.glob("*.csv")}
    if actual_tables != TABLES:
        raise RuntimeError(f"Expected all six tables, got {actual_tables}")
    import csv
    rows_by_table = {}
    years_by_table = {}
    for table in sorted(TABLES):
        with (artifact_path / f"{table}.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        rows_by_table[table] = len(rows)
        years_by_table[table] = sorted({int(row["year"]) for row in rows})
        if years_by_table[table] != YEARS:
            raise RuntimeError(f"Incomplete five-year table {table}: {years_by_table[table]}")
    calculation_seconds = (ledger["process_seconds_excluding_gates"]
                           - ledger["process_construction_seconds"])
    build_overhead_seconds = (ledger["build_seconds_excluding_gates"]
                              - ledger["build_construction_seconds"])
    generator_overhead_seconds = (generation_seconds - ledger["gate_seconds"]
                                  - ledger["build_seconds_excluding_gates"]
                                  - ledger["process_seconds_excluding_gates"])
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_bytes = peak if sys.platform == "darwin" else peak * 1024
    result = {
        "measure": args.measure, "basis": basis, "hashes": hashes,
        "years": YEARS, "written": written, "refused": report.refused,
        "rows_by_table": rows_by_table, "years_by_table": years_by_table,
        "timings": {
            "imports_seconds": import_seconds,
            "imports_process_cpu_seconds": import_cpu_seconds,
            "startup_gate_seconds": startup_gate_seconds,
            "verification_seconds": verification_seconds,
            "registry_seconds": registry_seconds,
            "generation_seconds_including_gates": generation_seconds,
            "generation_process_cpu_seconds": generation_cpu_seconds,
            "gate_seconds": ledger["gate_seconds"],
            "construction_seconds_excluding_gates": ledger["construction_seconds"],
            "calculation_seconds_excluding_construction_and_gates": calculation_seconds,
            "build_copy_and_wrapper_overhead_seconds": build_overhead_seconds,
            "generator_receipt_and_writer_overhead_seconds": generator_overhead_seconds,
            "whole_process_seconds_through_validation": time.perf_counter() - COMMAND_STARTED,
        },
        "timing_note": "Generation total overlaps its disjoint gate/construction/calculation/build-overhead/generator-overhead components; constructor and calculator call records are diagnostic detail.",
        "peak_memory_bytes": peak_bytes, "peak_memory_decimal_gb": peak_bytes / 1e9,
        "process_cpu_seconds": time.process_time(),
        "instrumentation": ledger,
    }
    (output / "timings.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    common.event("generation_complete", **{key: result[key] for key in
                                          ("measure", "written", "timings", "peak_memory_decimal_gb", "rows_by_table")})
    return result


if __name__ == "__main__":
    main()
