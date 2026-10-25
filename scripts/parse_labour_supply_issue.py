"""Parse the per-drill tables in issue #120 into labour_supply.csv and the dashboard's labour_supply.json.

Issue #120 (María Juaristi, 25 October 2026) reports each drill measure-year
statically and with labour supply responses on policyengine-uk 2.153.0. It
publishes no data file, so this reads the issue's own tables, kept verbatim in
labour_supply/issue-120.md, and copies every value as written: n/r, withheld
and not-rerun cells stay as they are, with their marks.

Usage: python scripts/parse_labour_supply_issue.py [--dir docs/drill-reruns/2026-10-24]
"""

import argparse
import csv
import json
import re
from pathlib import Path

ISSUE = "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/120"
# Names for drill 1's carried-over measures, which the rerun dashboard
# (data.json) doesn't list; every other name comes from data.json.
NAMES = {
    "autumn_budget_2025_combined": "Autumn Budget 2025 package",
    "bus_fare_cap": "Bus fare cap",
    "cgt_equalisation": "CGT equalisation",
    "dividend_tax_increase_2pp": "Dividend tax up 2 points",
    "freeze_student_loan_thresholds": "Student loan thresholds frozen",
    "fuel_duty_freeze": "Fuel duty freeze (Budget 2025)",
    "fuel_duty_rise_cancellation": "Fuel duty rise cancelled (Budget 2025)",
    "property_tax_increase_2pp": "Property income tax up 2 points",
    "rail_fares_freeze": "Rail fares freeze",
    "salary_sacrifice_cap": "Salary sacrifice cap",
    "savings_tax_increase_2pp": "Savings income tax up 2 points",
    "threshold_freeze_extension": "Threshold freeze extended",
    "two_child_limit": "Two-child limit removed",
}
COLS = ["drill_published_bn", "drill_obr_m", "now_static_bn", "now_obr_m", "now_param_m"]


def value(cell: str):
    """Number in a cell, or None; marks are returned separately."""
    c = cell.replace("−", "-").replace(",", "")
    m = re.match(r"^\s*([+-]?\d+(?:\.\d+)?)", c)
    return float(m.group(1)) if m else None


def marks(cell: str) -> str:
    out = []
    for sym, name in (("‡", "not_reproduced"), ("†", "param_blind"), ("¶", "not_comparable"), ("n/r", "nr"), ("<10", "withheld")):
        if sym in cell:
            out.append(name)
    return " ".join(out)


def rerun(cell: str):
    m = re.search(r"\(rerun ([+-−]?\d+(?:\.\d+)?)\)", cell)
    return float(m.group(1).replace("−", "-")) if m else None


def parse(md: str):
    rows = []
    for block in re.finditer(r"<summary>Drill (\d)[^<]*</summary>(.*?)</details>", md, re.S):
        drill, body = block.group(1), block.group(2)
        for line in body.splitlines():
            if not line.startswith("| `"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            mid, year = cells[0].strip("`"), cells[1]
            row = {"drill": drill, "measure_id": mid, "year": year}
            if year == "–":
                row.update({k: None for k in COLS})
                row.update({f"{k}_raw": "" for k in COLS})
                row["status"] = "withheld" if "withheld" in cells[2] else "not_rerun"
                row["status_note"] = cells[2]
                row["moves"] = ""
                rows.append(row)
                continue
            for k, c in zip(COLS, cells[2:7]):
                row[k] = value(c)
                row[f"{k}_raw"] = c
            row["drill_rerun_bn"] = rerun(cells[2])
            row["moves"] = cells[7] if len(cells) > 7 else ""
            row["status"] = "ok"
            row["status_note"] = ""
            row["marks"] = " ".join(sorted({m for c in cells[2:7] for m in marks(c).split()}))
            rows.append(row)
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dir", default="docs/drill-reruns/2026-10-24")
    a = p.parse_args()
    base = Path(a.dir) / "labour_supply"
    md = (base / "issue-120.md").read_text()
    rows = parse(md)
    known = {r["id"]: r["name"] for r in json.loads((Path(a.dir) / "dashboard" / "data.json").read_text())["rows"]}
    for r in rows:
        r["name"] = known.get(r["measure_id"]) or NAMES[r["measure_id"]]
    fields = ["drill", "measure_id", "name", "year", "status", "status_note", "marks", "moves", "drill_rerun_bn"]
    fields += [k for c in COLS for k in (c, f"{c}_raw")]
    with open(base / "labour_supply.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    # The page reads its own copy, so the dashboard folder deploys on its own.
    (Path(a.dir) / "dashboard" / "labour_supply.json").write_text(json.dumps({"source": ISSUE, "rows": rows}, ensure_ascii=False))
    print(len(rows), "rows;", sum(r["status"] == "ok" for r in rows), "measure-years")


if __name__ == "__main__":
    main()
