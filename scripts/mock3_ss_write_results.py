"""Write MOCK drill 3 measure 20 rows from the calibration artifact (MOCK)."""

import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "data_inputs/mock_drill3/drill3-ss-calibration-artifact.json"
OUT = ROOT / "data_inputs/mock_drill3/MOCK-data-work-results-ss.csv"
HEADER = "exercise,metric,period,units,before,after,benchmark,basis,code_sha,data_sha256,engine_version,core_version,validation_status,assumptions,residual_or_limitation".split(",")

code_sha = sys.argv[1]
a = json.loads(ART.read_text())
b, af, t = a["before"], a["after"], a["targets_m"]
dsha = a["inputs"]["data_sha256"]
basis_cal = "national records 2026-27 (engine year 2026); earned-income bracket allocation; weighted by household_weight"
assump = ("Annex A 2026-27 schedules; contractual = employment_income + pension_contributions_via_salary_sacrifice (engine employment_income is cash net of sacrifice); "
          "employment income only, other income/charges excluded; PA-taper relief allocated to the band where taxable income sits; bands bind, rounded total diagnostic; "
          "per-group multiplicative factors on households by dominant relief band; fixture S2 crosses the 37,700 edge (54 basic + 1,492 higher = 1,546, not 1,600)")
rows = []


def add(metric, period, units, before, after, bench="", basis=basis_cal, resid=""):
    rows.append(["salary_sacrifice", metric, period, units,
                 "" if before is None else f"{before:.3f}",
                 "" if after is None else f"{after:.3f}",
                 bench, basis, code_sha, dsha, "2.125.1", "3.33.0",
                 "experimental, unvalidated under this engine", assump, resid])


for k in ("basic", "higher", "additional"):
    tv = t[f"salary_sacrifice_it_relief_{k}"]
    add(f"it_relief_{k}", "2026-27", "GBP m", b[f"relief_{k}_m"], af[f"relief_{k}_m"], f"{tv}",
        resid=f"binding; after-target {af[f'relief_{k}_m'] - tv:.3f}")
tt = t["salary_sacrifice_it_relief_total_rounded"]
add("it_relief_total", "2026-27", "GBP m", b["relief_total_m"], af["relief_total_m"], f"{tt}",
    resid=f"diagnostic only (not bound); after-total {af['relief_total_m'] - tt:.3f}")
add("contributions_total", "2026-27", "GBP m", b["contributions_m"], af["contributions_m"])
add("sacrificers", "2026-27", "million", b["sacrificers_m"], af["sacrificers_m"])
add("kish_ess_all_households", "2026-27", "households", b["kish_ess_all"], af["kish_ess_all"])
add("kish_ess_sacrificing_households", "2026-27", "households", b["kish_ess_sacrificing_hh"], af["kish_ess_sacrificing_hh"])
add("employee_ni_relief", "2026-27", "GBP m", b["relief_employee_ni_m"], af["relief_employee_ni_m"],
    resid="uncapped 2026-27 schedule on full sacrifice (8% PT-UEL, 2% above)")
add("employer_ni_relief", "2026-27", "GBP m", b["relief_employer_ni_m"], af["relief_employer_ni_m"],
    resid="uncapped 2026-27 schedule on full sacrifice (15% above 5,000)")
rev = a.get("measure20_static_revenue_m") or {}
for y, fy in (("2029", "2029-30"), ("2031", "2031-32")):
    r = rev.get(y)
    bench = {"2029": "780", "2031": "850"}[y]
    basis = ("mock3_salary_sacrifice_cap vs drill baseline; gross employee+employer NICs change; "
             "haircut, employer cost pass-through and LSR set to zero in both runs; weights before vs after calibration factors")
    if r:
        for leg in ("ni_employee", "ni_employer", "gross_total"):
            add(f"m20_static_{leg}", fy, "GBP m", r["before"][leg], r["after"][leg],
                bench if leg == "gross_total" else "", basis,
                resid="liability basis in engine year; no cash timing applied" if leg == "gross_total" else "")
    else:
        add("m20_static_gross_total", fy, "GBP m", None, None, bench, basis, resid="rerun not completed by deadline")

with OUT.open("w", newline="") as f:
    f.write("MOCK DATA: drill 3 measure 20 salary-sacrifice data-work evidence (EXPERIMENTAL). Skip one line when reading this CSV.\n")
    w = csv.writer(f)
    w.writerow(HEADER)
    w.writerows(rows)
print(OUT, len(rows), "rows")
print("artifact sha256", hashlib.sha256(ART.read_bytes()).hexdigest())
