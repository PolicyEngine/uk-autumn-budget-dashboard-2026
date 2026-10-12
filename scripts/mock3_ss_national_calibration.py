"""MOCK drill 3 measure 20: national salary-sacrifice relief calibration.

EXPERIMENTAL, unvalidated under this engine. Rehearsal only (MOCK DATA).

Engine semantics (policyengine-uk 2.125.1, checked): ``employment_income``
is already the cash salary net of sacrifice (``taxable_employment_income`` and
``ni_class_1_income`` equal it, and sacrifice is not deducted again), so
contractual = employment_income + pension_contributions_via_salary_sacrifice
and cash = employment_income.

Binding constraints: the three band targets (basic/higher/additional). The
rounded total is the same relief in a second representation, so it is left
as a diagnostic only (binding both would over-identify / conflict).

Method: each household with any sacrificing person is assigned to a group by
its dominant (largest) relief band. A multiplicative factor f_j per group
scales those households' weights; the factors solve the 3x3 linear system
A f = T exactly, with A[k, j] = weighted band-k relief of group-j households.
Non-sacrificing households keep their weights.
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from policyengine_uk import Microsimulation

from uk_budget_data.mock_drill3_ss_calibration import (
    CATEGORIES,
    allocate_arrays,
    kish_ess,
)
from uk_budget_data.reforms import get_reform

DATA = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
ROOT = Path(__file__).resolve().parents[1]
PACKET = ROOT / "data_inputs/mock_drill3/packet"
OUT_JSON = ROOT / "data_inputs/mock_drill3/drill3-ss-calibration-artifact.json"
CAL_YEAR = 2026


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def load_targets():
    lines = (PACKET / "MOCK-salary-sacrifice-targets.csv").read_text().splitlines()[2:]
    t = {}
    for ln in lines:
        _, name, _, v, role = ln.split(",")
        t[name] = (float(v), role)
    return t


def household_index(sim, year):
    hh_id = sim.calculate("household_id", year).values
    p_hh = sim.calculate("person_household_id", year).values
    order = {h: i for i, h in enumerate(hh_id)}
    return np.array([order[h] for h in p_hh]), len(hh_id)


def main(skip_reform=False):
    sim = Microsimulation(dataset=DATA)
    y = CAL_YEAR
    ei = sim.calculate("employment_income", y).values
    ss = sim.calculate("pension_contributions_via_salary_sacrifice", y).values
    country = sim.calculate("country", y).values.astype(str)
    hw = sim.calculate("household_weight", y).values
    pidx, nh = household_index(sim, y)
    sac = ss > 0
    nations = np.where(country == "SCOTLAND", "Scotland", "rUK")
    rel = {k: np.zeros_like(ei) for k in (*CATEGORIES, "total", "employee_ni", "employer_ni")}
    alloc = allocate_arrays((ei + ss)[sac], ss[sac], nations[sac])
    for k in rel:
        rel[k][sac] = alloc[k]
    assert np.allclose(rel["basic"] + rel["higher"] + rel["additional"], rel["total"])

    # household-level band relief
    hh_rel = {k: np.bincount(pidx, rel[k], minlength=nh) for k in rel}
    hh_ss = np.bincount(pidx, ss, minlength=nh)
    hh_sac = np.bincount(pidx, sac.astype(float), minlength=nh) > 0
    band_mat = np.vstack([hh_rel[k] for k in CATEGORIES])  # 3 x nh
    group = np.where(hh_sac, band_mat.argmax(axis=0), -1)

    def summary(w):
        return {
            **{f"relief_{k}_m": float((w * hh_rel[k]).sum() / 1e6) for k in rel},
            "contributions_m": float((w * hh_ss).sum() / 1e6),
            "sacrificers_m": float(np.bincount(pidx, sac.astype(float), minlength=nh) @ w / 1e6),
            "kish_ess_all": kish_ess(w),
            "kish_ess_sacrificing_hh": kish_ess(w[hh_sac]),
        }

    before = summary(hw)
    targets = load_targets()
    T = np.array([targets[f"salary_sacrifice_it_relief_{k}"][0] * 1e6 for k in CATEGORIES])
    A = np.array([[(hw * band_mat[k] * (group == j)).sum() for j in range(3)] for k in range(3)])
    f = np.linalg.solve(A, T)
    factors = {CATEGORIES[j]: float(f[j]) for j in range(3)}
    hh_factor = np.ones(nh)
    for j in range(3):
        hh_factor[group == j] = f[j]
    w_after = hw * hh_factor
    after = summary(w_after)
    print("factors", factors)
    print("before", json.dumps(before, indent=1))
    print("after", json.dumps(after, indent=1))
    if (f <= 0).any():
        print("WARNING: non-positive factor; solution infeasible as weights")

    revenue = {}
    if not skip_reform:
        reform = get_reform("mock3_salary_sacrifice_cap")
        for year in (2029, 2031):
            base = Microsimulation(dataset=DATA)
            ref = Microsimulation(dataset=DATA, reform=reform.parameter_changes)
            hwy = base.calculate("household_weight", year).values
            pidx_y, _ = household_index(base, year)
            out = {}
            for label, wy in (("before", hwy), ("after", hwy * hh_factor)):
                for s in (base, ref):
                    s.set_input("household_weight", year, wy)
                vals = {}
                for v in ("ni_employee", "ni_employer"):
                    b = base.calculate(v, year).values
                    r = ref.calculate(v, year).values
                    vals[v] = float(((r - b) * wy[pidx_y]).sum() / 1e6)
                vals["gross_total"] = vals["ni_employee"] + vals["ni_employer"]
                out[label] = vals
            revenue[str(year)] = out
            print(year, out)

    artifact = {
        "label": "MOCK drill 3 measure 20 salary-sacrifice calibration (EXPERIMENTAL, unvalidated under this engine)",
        "inputs": {
            "dataset": DATA,
            "data_sha256": sha(DATA),
            "targets_csv_sha256": sha(PACKET / "MOCK-salary-sacrifice-targets.csv"),
            "records_csv_sha256": sha(PACKET / "MOCK-salary-sacrifice-records.csv"),
            "allocator_sha256": sha(ROOT / "src/uk_budget_data/mock_drill3_ss_calibration.py"),
            "script_sha256": sha(__file__),
            "engine": "policyengine-uk 2.125.1",
            "core": "policyengine-core 3.33.0",
            "calibration_year": CAL_YEAR,
        },
        "binding_constraints": [f"salary_sacrifice_it_relief_{k}" for k in CATEGORIES],
        "diagnostic_only": ["salary_sacrifice_it_relief_total_rounded"],
        "binding_choice_rationale": "Band targets bind; the rounded total is the same relief summed and rounded, so binding it as well would double-count one quantity.",
        "method": "Exact 3x3 solve for multiplicative weight factors per dominant-relief-band household group; non-sacrificing households unchanged.",
        "engine_semantics": "employment_income is cash (net of sacrifice); contractual = employment_income + pension_contributions_via_salary_sacrifice.",
        "allocation_scope": "Earned (employment) income only; PA taper on employment income only; other income, reliefs and charges ignored.",
        "targets_m": {k: v[0] for k, v in targets.items()},
        "factors": factors,
        "households_per_group": {CATEGORIES[j]: int((group == j).sum()) for j in range(3)},
        "before": before,
        "after": after,
        "total_rounded_diagnostic_residual_m": after["relief_total_m"] - targets["salary_sacrifice_it_relief_total_rounded"][0],
        "measure20_static_revenue_m": revenue,
    }
    OUT_JSON.write_text(json.dumps(artifact, indent=2))
    print("artifact sha256", sha(OUT_JSON))


if __name__ == "__main__":
    main(skip_reform="--skip-reform" in sys.argv)
