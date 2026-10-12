"""MOCK drill 3 run 2: gross component series used to restate the national sheet.

Writes data_inputs/mock_drill3/drill3-run2-components.csv with, per measure/year (£m, static,
engine liabilities on code 619dc67, data aa31bdf6): Class 4 gross ni_class_4 change; Pensioner
Allowance gross income_tax change and tax-cut beneficiary count; measure 1 legs (2031);
measure 20 gross employee/employer Class 1 NICs.
"""
import csv
import numpy as np
from policyengine_uk import Microsimulation
from uk_budget_data.reforms import get_reform

DS = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
OUT = "data_inputs/mock_drill3/drill3-run2-components.csv"
rows = []

def pair(rid):
    r = get_reform(rid)
    return (Microsimulation(dataset=DS, scenario=r.to_drill_scenario(baseline=True)),
            Microsimulation(dataset=DS, scenario=r.to_drill_scenario()))

def d(b, f, v, y):
    return (float(f.calculate(v, y).sum()) - float(b.calculate(v, y).sum())) / 1e6

b, f = pair("mock3_class4_main_rate")
for y in range(2026, 2032):
    rows.append(("10", y, "ni_class_4_gross_change_m", d(b, f, "ni_class_4", y)))
    rows.append(("10", y, "gov_balance_change_m", d(b, f, "gov_balance", y)))
b, f = pair("mock3_pensioner_allowance")
for y in range(2026, 2032):
    rows.append(("2", y, "income_tax_gross_change_m", d(b, f, "income_tax", y)))
    itb = np.asarray(b.calculate("income_tax", y)); itf = np.asarray(f.calculate("income_tax", y))
    w = np.asarray(b.calculate("household_weight", y, map_to="person"))
    rows.append(("2", y, "tax_cut_beneficiaries_m", float((w * ((itb - itf) > 0.005)).sum()) / 1e6))
b, f = pair("mock3_threshold_freeze_2032")
for v in ("income_tax", "ni_class_1_employee", "ni_class_4"):
    rows.append(("1", 2031, f"{v}_change_m", d(b, f, v, 2031)))
b, f = pair("mock3_salary_sacrifice_cap")
for y in (2029, 2030, 2031):
    for v in ("ni_class_1_employee", "ni_class_1_employer", "income_tax"):
        rows.append(("20", y, f"{v}_change_m", d(b, f, v, y)))
with open(OUT, "w", newline="") as fh:
    fh.write("MOCK DATA: drill 3 run 2 component series (code 619dc67, data aa31bdf6, unvalidated under this engine). Skip this line when reading CSV.\n")
    w = csv.writer(fh); w.writerow(["measure_no", "year", "metric", "value"])
    for r in rows: w.writerow([r[0], r[1], r[2], f"{r[3]:.4f}"])
print("wrote", OUT, len(rows))
