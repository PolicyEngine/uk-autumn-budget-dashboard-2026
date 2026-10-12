"""MOCK drill 3: reproducibly build the run 2 national sheet.

  uv run python scripts/drill3/fill_national.py public/data/budgetary_impact.csv 619dc67 OUT data_inputs/mock_drill3/drill3-fuel-fiscal-4b72684.csv
  uv run python scripts/drill3/restate_run2.py OUT

Restatements (all from data_inputs/mock_drill3/drill3-run2-components.csv, written by
scripts/drill3/run2_components.py on code 619dc67):
- M1 2031-32: cash = 90% income tax + 100% employee Class 1 + 25% Class 4 liabilities.
- M2: gross income tax change (not gov_balance); 2031-32 stacked = standalone + interaction.
- M10: gross ni_class_4 change with the 25/75 cash split (benefit offsets excluded).
- M20: gross employee + employer Class 1 NICs.
- 1+2 interaction from scripts/drill3/interaction_1_2.py (code 4b72684; modules unchanged).
"""
import csv, sys
sys.path.insert(0, "scripts/drill3")
from costings import STATIC

out = sys.argv[1]
comp = {}
L = open("data_inputs/mock_drill3/drill3-run2-components.csv").read().splitlines()[1:]
for r in csv.DictReader(L):
    comp[(r["measure_no"], int(r["year"]), r["metric"])] = float(r["value"])
INTERACTION = -318.5
FYI = {"2026-27": 2026, "2027-28": 2027, "2028-29": 2028, "2029-30": 2029, "2030-31": 2030, "2031-32": 2031}
RERUN = {"1", "3", "7", "8", "10", "20"}
L = open(out).read().split("\n"); first = L[0]
rows = list(csv.reader([l for l in L[1:] if l]))

def gap_class(no, i, ours, default):
    st = STATIC[no][i]
    if st == 0:
        return ("none_expected" if abs(ours) < 0.5 else default), "n/a"
    g = (ours - st) / abs(st)
    return ("none_expected" if abs(g) <= 0.10 else default), f"{g*100:+.1f}%"

for r in rows[1:]:
    no, fy = r[0], r[2]
    y = FYI.get(fy)
    i = y - 2026 if y else None
    r[11] = ("yes: re-run on 619dc67 after 14:20 correction" if no in RERUN else
             f"carried forward from run 1 row ({no}, {fy}); receipt drill3-run2-receipt.json")
    if no == "1" and fy == "2031-32":
        it, c1, c4 = (comp[("1", 2031, k)] for k in ("income_tax_change_m", "ni_class_1_employee_change_m", "ni_class_4_change_m"))
        v = 0.9 * it + c1 + 0.25 * c4
        cls, g = gap_class(1, i, v, "baseline_mismatch")
        r[5] = f"{v:.1f}"; r[6] = f"Cash: 0.9 x IT {it:.1f} + Class 1 {c1:.1f} + 0.25 x Class 4 {c4:.1f} (liabilities, 2031-32); static"
        r[7] = r[8] = cls
        r[9] = f"RESTATEMENT (cash basis). Gap {g}; IT leg vs costing PA+BRL 3,020; Class 1 net {c1:.0f} vs costing 224; PROPOSED"
    if no == "2" and y and y >= 2027:
        it = comp[("2", y, "income_tax_gross_change_m")]; n = comp[("2", y, "tax_cut_beneficiaries_m")]
        v = it + (INTERACTION if y == 2031 else 0.0)
        cls, g = gap_class(2, i, v, "top_tail_data")
        r[5] = f"{v:.1f}"
        r[6] = "Gross income tax change (static liability), tax year; UK" + ("; 2031-32 stacked after measure 1 (standalone + interaction)" if y == 2031 else "")
        r[7] = r[8] = cls
        r[9] = (f"{'RESTATEMENT: stacked, not a carried row. ' if y == 2031 else ''}Gap {g}; tax-cut beneficiaries {n:.2f}m (costing 3.4m 2027-28 / 4.6m 2031-32). "
                "87% of gainers have SP above the flat rate; capped-at-£13,040 what-if gives avg £84.88 (costing ~£85); residual is count. PROPOSED top_tail_data (alt incidence_basis)")
        if y != 2031: r[11] = "re-extracted from run 1 code (module unchanged): gross income_tax series instead of gov_balance"
    if no == "10" and y:
        cur = comp[("10", y, "ni_class_4_gross_change_m")]; prev = comp.get(("10", y - 1, "ni_class_4_gross_change_m"), 0.0)
        v = 0.25 * cur + 0.75 * prev
        cls, g = gap_class(10, i, v, "takeup_caseload")
        r[5] = f"{v:.1f}"; r[6] = "Gross Class 4 NICs (ni_class_4), 25% in-year + 75% next (costing rule); benefit offsets excluded; self-employed in household data"
        r[7] = r[8] = cls if cls == "none_expected" else "takeup_caseload"
        if cls == "none_expected" and STATIC[10][i] != 0: r[8] = "behavioural"
        r[9] = f"Gap {g}; main-band profit base £42.1bn vs £61bn, contributors 2.66m vs 3.1m (2027); NI eligibility reconciliation open; PROPOSED"
    if no == "20" and y and y >= 2029:
        ee, er, it = (comp[("20", y, k)] for k in ("ni_class_1_employee_change_m", "ni_class_1_employer_change_m", "income_tax_change_m"))
        v = ee + er
        cls, g = gap_class(20, i, v, "incidence_basis")
        r[5] = f"{v:.1f}"; r[6] = "Gross employee + employer Class 1 NICs (costing basis), static; pass-through/response/haircut off in both runs"
        r[7] = cls; r[8] = "behavioural" if cls == "none_expected" else cls
        r[9] = f"Gap {g} (employee {ee:.1f} + employer {er:.1f}). Pipeline gov_balance adds income tax {it:.1f} the engine charges on above-cap sacrifice although relief continues (engine limitation, outside costing basis)"
    if no == "1+2":
        r[5] = f"{INTERACTION}"; r[6] = "Static gov_tax change 2031-32: (m1+m2) - m1 - m2 (scripts/drill3/interaction_1_2.py, code 4b72684; m1/m2 modules unchanged for these legs)"
        r[7] = r[8] = "interaction"; r[9] = "Gap -48% vs source -215 (kept separate); PROPOSED"
        r[11] = "computed separately (interaction run); not a carried sheet row"
first = first.split(" Skip one line")[0].replace("Team figures from run 619dc67", "RUN 2 (complete, supersedes run 1): code 619dc67") + "; restated by scripts/drill3/restate_run2.py from drill3-run2-components.csv. Skip one line when reading this CSV."
with open(out, "w", newline="") as fh:
    fh.write(first + "\n"); csv.writer(fh).writerows(rows)
print("restated", out)
