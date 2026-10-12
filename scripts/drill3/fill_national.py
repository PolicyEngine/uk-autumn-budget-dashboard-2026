"""MOCK drill 3: fill the national scoring sheet from budgetary_impact.csv.

Usage: uv run python scripts/drill3/fill_national.py <budgetary_impact.csv> <run_sha> <out.csv> [fuel_fiscal.csv]
Our figures are converted to each costing's stated basis where the costing gives the rule
(cash timing), so the explanation class compares like with like. Liability figures by tax year
come from the engine (static). Classes are PROPOSED for the scorer to confirm.
"""
import csv, sys
sys.path.insert(0, "scripts/drill3")
from costings import FY, STATIC, POST, ID, INTERACTION_1_2_STATIC_2031

impact, sha, out = sys.argv[1:4]
fuel_fiscal = sys.argv[4] if len(sys.argv) > 4 else None
liab = {}
for r in csv.DictReader(open(impact)):
    liab[(r["reform_id"], int(r["year"]))] = float(r["value"]) * 1000  # £bn -> £m
YEARS = list(range(2026, 2032))

def L(no, y):
    return liab.get((ID[no], y), 0.0)

# Cash conversion rules from the costing notes.
def cash(no, y):
    if no == 4:  # CGT: 7% same fiscal year, 93% next
        return 0.07 * L(no, y) + 0.93 * L(no, y - 1)
    if no == 10:  # Class 4: a quarter in-year, three-quarters next
        return 0.25 * L(no, y) + 0.75 * L(no, y - 1)
    if no == 7:  # ART: 80% PAYE in-year, 20% SA next
        return 0.80 * L(no, y) + 0.20 * L(no, y - 1)
    if no == 1:  # Threshold freeze: IT 90% in-year (rest beyond forecast); NI in-year — engine total
        return L(no, y)  # see basis note: engine gives liability; costing's static is liability at 2031-32 base
    return L(no, y)

fuel = {}
if fuel_fiscal:
    for r in csv.DictReader(open(fuel_fiscal)):
        fuel[r["fiscal_year"]] = float(r["duty_only_bn"]) * 1000

BASIS = {
    1: "Static liability (accruals), fiscal/tax year 2031-32; income tax rUK + PA/NI UK-wide; employee Class 1 + Class 4; households (whole personal sector)",
    2: "Static income tax liability, tax year; UK; households",
    3: "Spending, gross, fiscal year of credit; England and Wales; households (benefit-receipt proxy)",
    4: "Static CGT, converted to cash: 7% same fiscal year + 93% next (costing rule); individuals in households",
    5: "Gross employer Class 1 NICs, static, fiscal year; employees aged 21 in household data",
    6: "Surcharge receipts, accrued to financial year; England, owners; households",
    7: "Static income tax converted to cash: 80% in-year + 20% next (costing rule); rUK non-savings + UK savings/dividends",
    8: "Spending (UC/HB), fiscal year; Great Britain; households",
    9: "Duty only (VAT excluded), fiscal year Apr-Mar from monthly gaps; household road fuel only",
    10: "Class 4 NICs converted to cash: 25% in-year + 75% next (costing rule); self-employed in households",
    20: "Gross employee + employer Class 1 NICs, static, fiscal/tax year; UK; contributions fixed, no haircut/response",
}

def cls(no, ours, static):
    if static == 0 and abs(ours) < 0.5:
        return "none_expected"
    if static == 0:
        return "undefined_gap: see rationale"
    gap = (ours - static) / abs(static)
    return "none_expected" if abs(gap) <= 0.10 else None

PROPOSED = {  # primary class when |gap| > 10% (scorer to confirm)
    1: "baseline_mismatch", 2: "takeup_caseload", 3: "takeup_caseload", 4: "data_forward_path",
    5: "takeup_caseload", 6: "top_tail_data", 7: "top_tail_data", 8: "takeup_caseload",
    9: "coverage_business", 10: "timing_fiscal_calendar", 20: "data_forward_path",
}
rows = []
for no in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]:
    for i, y in enumerate(YEARS):
        if no == 9:
            ours = fuel[FY[i]]  # duty-only fiscal from fuel_fiscal.py (required)
        else:
            ours = cash(no, y)
        st, po = STATIC[no][i], POST[no][i]
        c = cls(no, ours, st) or PROPOSED[no]
        gap = "" if st == 0 else f"{(ours - st) / abs(st) * 100:.1f}%"
        cpost = "behavioural" if st != po and c == "none_expected" else c
        rows.append([no, None, FY[i], st, po, round(ours, 1), BASIS[no], c, cpost,
                     f"Static gap {gap or 'n/a'}; PROPOSED class, scorer to confirm", sha, ""])
    if no == 10:
        rows.append(["1+2", "Interaction of measures 1 and 2", "2031-32", INTERACTION_1_2_STATIC_2031, "", "", "Static: measure 2 after measure 1 minus measure 2 alone (2031-32)", "", "", "Combined run pending", sha, ""])
for i, y in enumerate(YEARS):
    no = 20; ours = L(20, y); st, po = STATIC[20][i], POST[20][i]
    c = cls(20, ours, st) or PROPOSED[20]
    gap = "" if st == 0 else f"{(ours - st) / abs(st) * 100:.1f}%"
    rows.append([20, None, FY[i], st, po, round(ours, 1), BASIS[20], c, "behavioural" if c == "none_expected" and st != po else c, f"Static gap {gap or 'n/a'}; PROPOSED", sha, ""])
names = {1: "Threshold freeze extension", 2: "Pensioner Allowance", 3: "Warm Home Discount top-up", 4: "Capital Gains Tax", 5: "Employer NICs for under-22s", 6: "High Value Council Tax Surcharge bands", 7: "Additional rate threshold", 8: "Local Housing Allowance", 9: "Fuel duty", 10: "Class 4 NICs", 20: "Pension salary-sacrifice cap"}
for r in rows:
    if r[1] is None: r[1] = names[r[0]]
with open(out, "w", newline="") as f:
    f.write("MOCK DATA: rehearsal Budget for PolicyEngine drill 3, 12 October 2026. Not a real Budget. Team figures from run " + sha + "; policyengine-uk 2.125.1 / core 3.33.0; microcosm_uk_2024_25.h5 aa31bdf6 (unvalidated under this engine). Explanation classes PROPOSED by the integrator for the scorer to confirm. Skip one line when reading this CSV.\n")
    w = csv.writer(f)
    w.writerow(["measure_no","measure","fiscal_year","costing_static_m","table41_post_m","team_figure_m","team_basis","explanation_class_vs_static","explanation_class_vs_post","rationale","run_sha","rerun_after_later_correction"])
    w.writerows(rows)
print(len(rows), "rows")
