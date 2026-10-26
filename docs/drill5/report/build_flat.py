"""Drill 5 local view: the new pair's approved artifacts as #185's flat files."""
import csv, json, sys
from pathlib import Path

src = Path(sys.argv[1])   # new-pair public/data
out = Path(sys.argv[2])   # #185 template public/data
combined_name = sys.argv[3]
m = json.loads((src / "manifest.json").read_text())
dirs = [(k, src / e["artifact"]) for k, e in sorted(m["measures"].items()) if e["status"] == "approved"]
dirs += [("autumn_budget_2026_combined", src / e["artifact"]) for k, e in m["combined"].items() if e["status"] == "approved"]
for table in ["budgetary_impact", "distributional_impact", "winners_losers", "metrics", "age_impact", "household_scatter_binned", "income_curve"]:
    rows, header = [], None
    for rid, d in dirs:
        with open(d / f"{table}.csv", newline="") as f:
            r = csv.reader(f); h = next(r); header = header or h
            for row in r:
                if rid == "autumn_budget_2026_combined":
                    row[0], row[1] = rid, combined_name
                rows.append(row)
    with open(out / f"{table}.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n"); w.writerow(header); w.writerows(rows)
    print(table, len(rows), "rows")
# The OBR comparison: PolicyEngine's column only, OBR columns empty until 28 October
with open(out / "budgetary_impact.csv") as f:
    bi = list(csv.DictReader(f))
with open(out / "obr_comparison.csv", "w", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["reform_id", "reform_name", "year", "policyengine_value", "obr_static_value", "obr_post_behavioural_value"])
    for r in bi: w.writerow([r["reform_id"], r["reform_name"], r["year"], r["value"], "", ""])
print("obr_comparison", len(bi), "rows")
