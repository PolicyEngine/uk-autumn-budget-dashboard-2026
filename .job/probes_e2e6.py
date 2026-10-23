"""Frozen, aggregate-only subset input/statutory probes for the certified pair.

Run ``reference`` and then ``rebased`` in separate serial processes. The
reference identity deliberately excludes the as-yet-unpublished forecast.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as metadata
import json
import math
import platform
from pathlib import Path
import subprocess
import sys
import time

import e2e_common as common


JOB = Path(__file__).resolve().parent
RUNTIME = JOB / "runtime"
INPUTS = Path.home() / "reviews/uk-hub/jobs/obr-rebase-dry-run/inputs"
SUBSET = INPUTS / "every40.h5"
FORECAST = INPUTS / "forecast.json"
SUBSET_SHA256 = "29a6c3c3c445a5a9edffa85e3f65c69f1693cbe76756efbcfc9a954d2c3a6740"
FORECAST_SHA256 = "6ae39003ef6897fa3cc591eb19eeefd45947df77de26eadcd2d602d6550284c3"
YEARS = (2026, 2027, 2028, 2029, 2030)
VARIABLES = (
    "employment_income_before_lsr",
    "food_and_non_alcoholic_beverages_consumption",
    "dividend_income",
    "main_residence_value",
    "council_tax",
)
RTOL = 1e-4
ATOL = 1e-6


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def checked_hash(path, expected):
    actual = sha256(path)
    if actual != expected:
        raise RuntimeError(f"Input hash changed for {path.name}: {actual}")
    return actual


def frozen_identity():
    """The exact source, environment, probe and dataset identities."""
    files = sorted((RUNTIME / "src/uk_budget_data").rglob("*.py"))
    source = hashlib.sha256()
    for file in files:
        source.update(file.relative_to(RUNTIME).as_posix().encode() + b"\0")
        source.update(file.read_bytes())
        source.update(b"\0")
    dashboard_sha = subprocess.check_output(
        ["git", f"--git-dir={JOB / 'history.git'}", "rev-parse", "origin/main"],
        text=True,
    ).strip()
    return {
        "dashboard_origin_main_sha": dashboard_sha,
        "dashboard_python_source_sha256": source.hexdigest(),
        "lock_sha256": sha256(RUNTIME / "uv.lock"),
        "probe_code_sha256": sha256(__file__),
        "guard_code_sha256": sha256(JOB / "e2e_common.py"),
        "python": platform.python_version(),
        "versions": {name: metadata.version(name) for name in common.PINS},
        "subset_sha256": checked_hash(SUBSET, SUBSET_SHA256),
        "years": list(YEARS),
        "stored_input_variables": list(VARIABLES),
        "ratio_rtol": RTOL,
        "ratio_atol": ATOL,
    }


def parameters(p, year):
    statutory = "gov.economic_assumptions.statutory_uprating_inputs."
    return {
        "previous_september_cpi": float(
            p.get_child(statutory + "cpi_september")(f"{year-1}-09-01")
        ),
        "previous_may_july_awe": float(
            p.get_child(statutory + "awe_total_pay_may_july")(f"{year-1}-07-01")
        ),
        "triple_lock": float(
            p.get_child("gov.economic_assumptions.yoy_growth.triple_lock")(
                f"{year}-04-30"
            )
        ),
        "basic_pension_weekly_gbp": float(
            p.get_child("gov.dwp.state_pension.basic_state_pension.amount")(
                f"{year}-04-30"
            )
        ),
        "new_pension_weekly_gbp": float(
            p.get_child("gov.dwp.state_pension.new_state_pension.amount")(
                f"{year}-04-30"
            )
        ),
    }


def expected_factors(year):
    # Exact reviewed calendar factors from the runbook. Do not replace these
    # with an observed rounded ratio or silently widen the tolerance.
    return {
        "employment_income_before_lsr": 1 if year == 2026 else 1.019 / 1.024,
        "food_and_non_alcoholic_beverages_consumption": (
            1.028 / 1.023
            if year == 2026
            else (1.028 / 1.023) * (1.025 / 1.020)
        ),
        "main_residence_value": 1 if year == 2026 else 1.049 / 1.029,
        "dividend_income": 1 if year == 2026 else 1.0293 / 1.0323,
        "council_tax": 1,
    }


def compare(reference, rebased):
    checks = []
    failures = []
    for old, new in zip(reference["rows"], rebased["rows"], strict=True):
        if old["year"] != new["year"]:
            raise RuntimeError("Reference/probe year mismatch")
        year = old["year"]
        for variable, factor in expected_factors(year).items():
            for aggregation in ("weighted_gbp", "unweighted_gbp"):
                before = old["totals"][variable][aggregation]
                after = new["totals"][variable][aggregation]
                measured = after / before if before else None
                passed = (
                    measured is not None
                    and math.isfinite(measured)
                    and abs(measured - factor) <= ATOL + RTOL * abs(factor)
                )
                row = {
                    "year": year,
                    "variable": variable,
                    "aggregation": aggregation,
                    "measured_ratio": measured,
                    "expected_ratio": factor,
                    "passed": passed,
                }
                checks.append(row)
                if not passed:
                    failures.append(row)
    # Statutory observations and the next year's derived triple lock remain
    # independently testable from stored household inputs.
    by_year = {row["year"]: row["parameters"] for row in rebased["rows"]}
    expected = {
        2027: {
            "previous_september_cpi": .035,
            "previous_may_july_awe": .039,
            "triple_lock": .039,
        },
        2028: {
            "previous_september_cpi": .02572,
            "previous_may_july_awe": .01927,
            "triple_lock": .026,
        },
    }
    statutory_checks = []
    for year, values in expected.items():
        for parameter, value in values.items():
            measured = by_year[year][parameter]
            passed = math.isclose(measured, value, rel_tol=0, abs_tol=1e-10)
            row = {
                "year": year,
                "parameter": parameter,
                "measured": measured,
                "expected": value,
                "passed": passed,
            }
            statutory_checks.append(row)
            if not passed:
                failures.append(row)
    return {
        "ratio_rtol": RTOL,
        "ratio_atol": ATOL,
        "stored_input_checks": checks,
        "statutory_checks": statutory_checks,
        "failures": failures,
        "passed": not failures,
    }


def counter_delta(before):
    return {name: value - before[name] for name, value in common.COUNTERS.items()}


def run(mode):
    started = time.perf_counter()
    output_dir = JOB / "probes"
    output_dir.mkdir(exist_ok=True)
    reference_path = output_dir / "reference.json"
    common.configure_environment()
    identity = frozen_identity()
    forecast_hash = checked_hash(FORECAST, FORECAST_SHA256)
    reference = None
    if mode == "rebased":
        reference = json.loads(reference_path.read_text())
        if reference["identity"] != identity:
            raise RuntimeError("Frozen reference identity changed; precompute again")
    before = dict(common.COUNTERS)
    import_started = time.perf_counter()
    pe = common.load_runtime()
    import numpy as np
    common.install_constructor_guards()
    import_wall = time.perf_counter() - import_started
    import_counters = counter_delta(before)
    forecast = json.loads(FORECAST.read_text()) if mode == "rebased" else None

    before = dict(common.COUNTERS)
    construction_started = time.perf_counter()
    common.gate(f"{mode} subset managed_microsimulation")
    kwargs = {"reform": forecast} if forecast is not None else {}
    sim = pe.uk.managed_microsimulation(
        dataset=str(SUBSET), allow_unmanaged=True, **kwargs
    )
    construction_wall = time.perf_counter() - construction_started
    construction_counters = counter_delta(before)
    rows = []
    query_counters = dict(common.COUNTERS)
    query_started = time.perf_counter()
    for year in YEARS:
        year_started = time.perf_counter()
        totals = {}
        for variable in VARIABLES:
            values = sim.calculate(variable, year)
            weighted = float(values.sum())
            unweighted = float(np.asarray(values).sum(dtype=np.float64))
            if not all(math.isfinite(v) and v > 0 for v in (weighted, unweighted)):
                raise RuntimeError(f"Unexpected nonpositive/nonfinite {variable} {year}")
            totals[variable] = {
                "weighted_gbp": weighted,
                "unweighted_gbp": unweighted,
            }
        row = {
            "year": year,
            "totals": totals,
            "parameters": parameters(sim.tax_benefit_system.parameters, year),
            "query_seconds": time.perf_counter() - year_started,
        }
        rows.append(row)
        common.event("probe_year", mode=mode, year=year, seconds=row["query_seconds"])
    query_wall = time.perf_counter() - query_started
    query_counter_deltas = counter_delta(query_counters)
    result = {
        "mode": mode,
        "identity": identity,
        "candidate_forecast_sha256": forecast_hash,
        "scope": "subset stored-input/statutory probes only; not calibrated national estimates",
        "rows": rows,
        "timings": {
            "runtime_import_wall_including_gates_s": import_wall,
            "runtime_import_excluding_gates_s": import_wall - import_counters["gates_s"],
            "runtime_import_counters": import_counters,
            "construction_wall_including_gates_s": construction_wall,
            "construction_wall_excluding_gates_s": construction_wall - construction_counters["gates_s"],
            "construction_counters": construction_counters,
            "queries_wall_including_gates_s": query_wall,
            "queries_wall_excluding_gates_and_construction_s": (
                query_wall - query_counter_deltas["gates_s"] - query_counter_deltas["construction_s"]
            ),
            "query_counters": query_counter_deltas,
        },
    }
    if mode == "rebased":
        comparison_started = time.perf_counter()
        result["comparison"] = compare(reference, result)
        result["timings"]["comparison_s"] = time.perf_counter() - comparison_started
    result["timings"]["script_wall_s"] = time.perf_counter() - started
    path = output_dir / f"{mode}.json"
    path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    common.finish(mode=mode, output=str(path), seconds=result["timings"]["script_wall_s"])
    if mode == "rebased" and not result["comparison"]["passed"]:
        raise RuntimeError(
            "STOP: synthetic stored-input/statutory checks failed; inspect aggregate "
            "comparison before any national phase. Preserve factors and tolerance."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("reference", "rebased"))
    run(parser.parse_args().mode)
