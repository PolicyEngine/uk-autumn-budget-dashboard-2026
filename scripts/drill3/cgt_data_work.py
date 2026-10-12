"""MOCK drill 3, measure 4 data work: CGT projection before/after (EXPERIMENTAL).

Usage:
  uv run python scripts/drill3/cgt_data_work.py run before OUT.json [dataset]
  uv run python scripts/drill3/cgt_data_work.py run after  OUT.json [dataset]
  uv run python scripts/drill3/cgt_data_work.py combine BEFORE.json AFTER.json

`run` computes, on the national dataset, baseline gross realised gains,
taxpayers (positive CGT liability), baseline CGT liability and measure 4
(mock3_cgt_higher_rate_aea) liability change by tax year. BEFORE is the
engine default (GDP-per-capita uprating); AFTER applies
uk_budget_data.mock_drill3_cgt_projection in both baseline and reform.

`combine` converts liabilities to cash (FY = 7% x L(FY) + 93% x L(FY-1)),
retains the 2031-32 liability beyond the forecast, adds the costing
cross-check (4% x higher-rate chargeable gains + AEA contribution), and writes
data_inputs/mock_drill3/MOCK-data-work-results-filled.csv and
data_inputs/mock_drill3/drill3-cgt-projection-artifact.json.
"""
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
YEARS = [2024, 2027, 2028, 2029, 2030, 2031]
REFORM_YEARS = [2027, 2028, 2029, 2030, 2031]
SAME_YEAR = 0.07
INPUTS_CSV = ROOT / "data_inputs/mock_drill3/packet/MOCK-cgt-projection-inputs.csv"
TEMPLATE = ROOT / "data_inputs/mock_drill3/packet/MOCK-data-work-results.csv"
OUT_CSV = ROOT / "data_inputs/mock_drill3/MOCK-data-work-results-filled.csv"
OUT_JSON = ROOT / "data_inputs/mock_drill3/drill3-cgt-projection-artifact.json"


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _person(sim, var, year):
    return np.asarray(sim.calculate(var, year, map_to="person"))


def run(mode: str, out: str, dataset: str):
    from policyengine_uk import Microsimulation

    from uk_budget_data.mock_drill3_cgt_projection import with_cgt_projection
    from uk_budget_data.reforms import get_reform

    reform = get_reform("mock3_cgt_higher_rate_aea")
    if mode == "after":
        reform = with_cgt_projection(reform)
    base = Microsimulation(
        dataset=dataset, scenario=reform.to_drill_scenario(baseline=True)
    )
    ref = Microsimulation(dataset=dataset, scenario=reform.to_drill_scenario())
    res = {"mode": mode, "years": {}, "factors": getattr(base, "mock3_cgt_factors", None)}
    for y in YEARS:
        w = _person(base, "person_weight", y)
        gains = _person(base, "capital_gains_before_response", y)
        cgt = _person(base, "capital_gains_tax", y)
        row = {
            "gross_realised_gains_bn": float((w * gains).sum() / 1e9),
            "taxpayers_thousands": float(w[cgt > 0].sum() / 1e3),
            "baseline_liability_bn": float((w * cgt).sum() / 1e9),
            "people_with_gains_thousands": float(w[gains > 0].sum() / 1e3),
        }
        if y in REFORM_YEARS:
            wr = _person(ref, "person_weight", y)
            cgt_r = _person(ref, "capital_gains_tax", y)
            row["reform_liability_bn"] = float((wr * cgt_r).sum() / 1e9)
            row["measure4_liability_change_m"] = (
                row["reform_liability_bn"] - row["baseline_liability_bn"]
            ) * 1e3
        res["years"][str(y)] = row
        print(mode, y, row, flush=True)
    Path(out).write_text(json.dumps(res, indent=2))


def cash(liab: dict) -> dict:
    """FY cash from tax-year liability changes (L2026 = 0), full precision."""
    out = {}
    for fy in range(2027, 2032):
        out[fy] = SAME_YEAR * liab.get(fy, 0.0) + (1 - SAME_YEAR) * liab.get(fy - 1, 0.0)
    out["retained_beyond_2031_32"] = (1 - SAME_YEAR) * liab[2031]
    return out


def combine(before_path: str, after_path: str):
    b = json.loads(Path(before_path).read_text())
    a = json.loads(Path(after_path).read_text())
    with open(INPUTS_CSV, newline="") as f:
        packet = list(csv.DictReader(f.read().splitlines()[1:]))
    pk = {int(r["tax_year"][:4]): r for r in packet}
    xcheck_liab = {
        y: 0.04 * float(pk[y]["higher_rate_chargeable_gains_bn"]) * 1e3
        + float(pk[y]["aea_static_contribution_m"])
        for y in REFORM_YEARS
    }
    out = {}
    for tag, d in (("before", b), ("after", a)):
        liab = {int(y): d["years"][str(y)]["measure4_liability_change_m"] for y in REFORM_YEARS}
        out[tag] = {"liability_m": liab, "cash_m": cash(liab)}
    out["costing_crosscheck"] = {"liability_m": xcheck_liab, "cash_m": cash(xcheck_liab)}

    data_sha = sha256(DEFAULT_DATASET)
    code_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True
    ).stdout.strip()
    common = dict(
        code_sha=f"see receipt (parent {code_sha[:12]})",
        data_sha256=data_sha,
        engine_version="policyengine-uk 2.125.1",
        core_version="policyengine-core 3.33.0",
        validation_status="experimental, unvalidated under this engine",
    )
    amount_note = (
        "AFTER: amount multiplier path(y)/118 over 2024-25 observed gains, engine GDP-pc "
        "uprating cancelled; weights unchanged; 2024-25 untouched; no extra level adjustment"
    )
    filled = {}

    def put(metric, period, before, after, bench, basis, assumptions, residual):
        filled[(metric, period)] = dict(
            before=before, after=after, benchmark=bench, basis=basis,
            assumptions=assumptions, residual_or_limitation=residual, **common
        )

    for y, period in ((2024, "2024-25"), (2027, "2027-28")):
        by, ay = b["years"][str(y)], a["years"][str(y)]
        put("gross_realised_gains", period, f"{by['gross_realised_gains_bn']:.4f}",
            f"{ay['gross_realised_gains_bn']:.4f}", pk[y]["gross_realised_gains_bn"],
            "weighted sum capital_gains_before_response; benchmark = packet path (not level-matched)",
            amount_note,
            "dataset 2024-25 level differs from packet anchor 118.0 (no level adjustment); "
            f"after/2024 = {ay['gross_realised_gains_bn'] / a['years']['2024']['gross_realised_gains_bn']:.4f} vs path "
            f"{float(pk[y]['gross_realised_gains_bn']) / 118.0:.4f}: gap is engine person_weight growth "
            "(population uprating), which the amount-only factor does not offset")
        put("taxpayers", period, f"{by['taxpayers_thousands']:.1f}",
            f"{ay['taxpayers_thousands']:.1f}", pk[y]["taxpayers_thousands"],
            "weighted persons with capital_gains_tax > 0",
            "taxpayer determinants NOT applied to weights (incidence held at observed year)",
            f"residual vs path: after - benchmark = {ay['taxpayers_thousands'] - float(pk[y]['taxpayers_thousands']):.1f}k (unreconciled)")
        put("baseline_liability", period, f"{by['baseline_liability_bn']:.4f}",
            f"{ay['baseline_liability_bn']:.4f}", "",
            "weighted sum capital_gains_tax (tax-year liability), pre-measure baseline",
            amount_note + "; no forestalling in baseline", "no packet liability benchmark")
    for fy, period in ((2027, "2027-28"), (2031, "2031-32")):
        put("measure_4_static_cash", period, f"{out['before']['cash_m'][fy]:.2f}",
            f"{out['after']['cash_m'][fy]:.2f}", f"{out['costing_crosscheck']['cash_m'][fy]:.2f}",
            "mock3_cgt_higher_rate_aea reform-baseline capital_gains_tax; cash = 7% L(FY) + 93% L(FY-1); "
            "benchmark = 4% x higher-rate chargeable gains + AEA contribution, same cash rule",
            "static (no forestalling/realisation response); full precision, round to £5m only for display",
            f"retained 2031-32 liability beyond forecast (93%): before {out['before']['cash_m']['retained_beyond_2031_32']:.2f}m, "
            f"after {out['after']['cash_m']['retained_beyond_2031_32']:.2f}m, costing {out['costing_crosscheck']['cash_m']['retained_beyond_2031_32']:.2f}m")

    with open(TEMPLATE, newline="") as f:
        lines = f.read().splitlines()
    first, rows = lines[0], list(csv.DictReader(lines[1:]))
    fields = list(rows[0].keys())
    for r in rows:
        key = (r["metric"], r["period"])
        if r["exercise"] == "CGT" and key in filled:
            r.update(filled[key])
    with open(OUT_CSV, "w", newline="") as f:
        f.write(first.replace("blank before/after", "before/after (CGT rows filled by agent, experimental)") + "\n")
        wr = csv.DictWriter(f, fieldnames=fields)
        wr.writeheader()
        wr.writerows(rows)

    receipt = {
        "mock": True,
        "measure": "4 (mock3_cgt_higher_rate_aea) CGT projection data work, EXPERIMENTAL",
        "parent_code_sha": code_sha,
        "dataset": DEFAULT_DATASET,
        "data_sha256": data_sha,
        "inputs_csv": str(INPUTS_CSV.relative_to(ROOT)),
        "inputs_sha256": sha256(INPUTS_CSV),
        "engine": "policyengine-uk 2.125.1 / policyengine-core 3.33.0",
        "validation_status": "experimental, unvalidated under this engine",
        "factors_by_year": a.get("factors"),
        "before": b, "after": a, "revenue": out,
        "limitations": [
            "Amount multiplier only; taxpayer determinants not applied to weights.",
            "Dataset 2024-25 level not matched to packet 118.0 anchor; only path growth applied.",
            "Engine person_weight grows after 2024 (population uprating), so the weighted gains aggregate exceeds path(y)/118 x 2024 aggregate by the weight growth (~1.5% in 2027).",
            "Static: no forestalling or realisation response; engine elasticity default.",
        ],
    }
    OUT_JSON.write_text(json.dumps(receipt, indent=2, default=str))
    print(json.dumps(out, indent=2, default=str))
    print("artifact sha256", sha256(OUT_JSON))


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else DEFAULT_DATASET)
    else:
        combine(sys.argv[2], sys.argv[3])
