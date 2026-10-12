"""MOCK drill 3: fill statement-comparator reconciliation rows from budgetary_impact.csv.

Usage: uv run python scripts/drill3/fill_reconciliation.py <budgetary_impact.csv> <calc_sha> <gate>
Statement figures are post-behavioural (Table 4.1 basis); costing static figures arrive at 13:40.
Sign convention: our value is the engine's net budgetary impact (positive = revenue), in £bn.
"""
import csv, sys
from pathlib import Path

OUT = Path("data_inputs/mock_drill3/MOCK-drill3-reconciliation.csv")
# Statement "Budget in numbers" (post-behavioural, £bn; minus = cost).
STATEMENT = {
    1: ("Fuel duty", "mock3_fuel_duty_phasing", {2027: -1.2, 2029: -0.9, 2031: -0.9}),
    3: ("Local Housing Allowance", "mock3_lha_30th_percentile", {2027: -1.8, 2029: -2.1, 2031: -2.4}),
    4: ("Pensioner Allowance", "mock3_pensioner_allowance", {2027: -0.3, 2029: -1.0, 2031: -1.8}),
    7: ("Additional rate threshold", "mock3_additional_rate_threshold", {2027: 0.8, 2029: 1.0, 2031: 1.1}),
    8: ("Capital Gains Tax", "mock3_cgt_higher_rate_aea", {2027: 1.3, 2029: 0.5, 2031: 1.0}),
    9: ("Pension salary sacrifice", "mock3_salary_sacrifice_cap", {2027: 0.0, 2029: 0.7, 2031: 0.8}),
    12: ("Thresholds", "mock3_threshold_freeze_2032", {2027: 0.0, 2029: 0.0, 2031: 2.8}),
}
BASIS = {
    1: "Engine static; CALENDAR year (monthly schedules); duty plus 20% pump VAT (VAT-inclusive); net budgetary impact",
    3: "Engine static; fiscal year; GB only; net budgetary impact (UC/HB spending)",
    4: "Engine static; fiscal year; UK; provisional 50% taper; income tax only",
    7: "Engine static; fiscal year; rUK non-savings plus UK savings/dividends; income tax only",
    8: "Engine static; fiscal (tax) year; liabilities basis, not receipts; no realisation response",
    9: "Engine static; fiscal year; gross employee plus employer NI",
    12: "Engine static; fiscal year; income tax rUK plus employee/employer NI; net budgetary impact",
}
NO_FIGURE = {2: "Warm Home Discount +£100", 5: "Employer NI under-22", 10: "HVCTS top bands", 13: "Class 4 main rate"}

def main(impact_path, sha, gate):
    ours = {}
    if impact_path != "-":
        for r in csv.DictReader(open(impact_path)):
            ours[(r["reform_id"], int(r["year"]))] = float(r["value"]) / 1e9 if abs(float(r["value"])) > 1e5 else float(r["value"])
    header = OUT.read_text().split("\n")[0]
    header = (f"MOCK DATA: rehearsal Budget for PolicyEngine drill 3, 12 October 2026. Not a real Budget. "
              f"calculation SHA {sha}; engine policyengine-uk 2.125.1 (policyengine.py 6.2.7, core 3.33.0); "
              f"dataset microcosm_uk_2024_25.h5 sha256 aa31bdf6…88af; validated pair no (unvalidated under this engine); "
              f"gate {gate}; source release statement (12:30); basis engine static, fiscal years, net budgetary impact. Skip this line when reading CSV.")
    cols = ["measure_no","measure","fiscal_year","comparator","our_static_bn","our_basis","our_commit",
            "table41_post_behavioural_bn","costing_static_bn","gap_vs_static_bn","gap_vs_static_pct","gap_reason","gate"]
    rows = []
    for no, (name, rid, figs) in STATEMENT.items():
        for y, fig in figs.items():
            v = ours.get((rid, y))
            rows.append({"measure_no": no, "measure": name, "fiscal_year": f"{y}-{str(y+1)[2:]}",
                "comparator": "statement", "our_static_bn": "" if v is None else round(v, 4),
                "our_basis": BASIS[no] + " (unvalidated under this engine)",
                "our_commit": sha, "table41_post_behavioural_bn": fig, "costing_static_bn": "",
                "gap_vs_static_bn": "", "gap_vs_static_pct": "",
                "gap_reason": "Statement figure is post-behavioural; static costing awaits Annex A at 13:40" + ("" if v is not None else "; our figure pending generation"),
                "gate": gate})
    for no, name in NO_FIGURE.items():
        rows.append({"measure_no": no, "measure": name, "fiscal_year": "", "comparator": "statement",
            "our_static_bn": "", "our_basis": "", "our_commit": sha, "table41_post_behavioural_bn": "",
            "costing_static_bn": "", "gap_vs_static_bn": "", "gap_vs_static_pct": "",
            "gap_reason": "awaiting Table 4.1 (no statement figure)", "gate": gate})
    rows.sort(key=lambda r: (int(r["measure_no"]), r["fiscal_year"]))
    with OUT.open("w", newline="") as f:
        f.write(header + "\n")
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
    print(f"{len(rows)} rows written")

if __name__ == "__main__":
    main(*sys.argv[1:4])
