"""Build data.json for the drill-rerun comparison dashboard.

MOCK DATA. Reads ``comparison.csv`` (written by ``scripts/rerun_drills.py
compare``) and each drill's filled national scoring sheet straight from git,
and writes ``<dir>/dashboard/data.json``. It adds a one-line description per
mock measure, the attributed cause of each move (from the README in the same
folder), the exact sheet row behind every official costing, and whether the
drill-day figure and the official costing are on the same basis.

Usage (from the repository root)::

    python3 scripts/build_drill_rerun_dashboard.py \
        --dir docs/drill-reruns/2026-10-24

Then serve ``<dir>/dashboard`` with any static file server.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import io
import json
import statistics
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GH = "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026"
PEUK_CHANGELOG = (
    "https://github.com/PolicyEngine/policyengine-uk/blob/main/CHANGELOG.md"
)

# One line per measure, condensed from the `description` of each Reform on
# the drill branches (src/uk_budget_data/reforms.py, mock_drill2_structural.py
# and mock_drill3_*.py on origin/drill{1,2,3,4}-mock-budget; the drill 3
# Pensioner Allowance text is from src/utils/policyConfig.js there).
DESCRIPTIONS = {
    # Drill 1
    "mock_fuel_duty_freeze": "Cancels the 1 March 2027 2p rise and the April 2027 inflation rise; main rates held at 55.95p a litre to 31 March 2028.",
    "mock_energy_vat_zero_rate": "Zero rate of VAT on domestic electricity and gas in Great Britain, 1 April 2027 to 31 March 2028.",
    "mock_child_benefit_increase": "Child Benefit to £30.00 a week for the eldest child and £20.00 for each other child from April 2027.",
    "mock_nics_threshold_rise": "Primary Threshold and Lower Profits Limit from £12,570 to £13,000 from 6 April 2027, held until April 2031.",
    "mock_hvcts_extension": "High Value Council Tax Surcharge extended to homes in England worth £1.5 million or more from 1 April 2028.",
    # Drill 2
    "mock2_fuel_duty_hold": "The 3p (1 January 2027) and 2p (1 March 2027) rises do not go ahead; 52.95p a litre to 31 August 2027, then 55.95p.",
    "mock2_electricity_vat_zero": "Zero VAT on domestic electricity in Great Britain continues from 1 April 2027 to 31 March 2028; gas stays at 5%.",
    "mock2_employer_ni_threshold": "Employer NI Secondary Threshold from £5,000 to £5,500 a year from April 2027, held flat to 2030-31.",
    "mock2_cgt_rates": "Capital Gains Tax rates rise from 18% to 20% and from 24% to 28% from 6 April 2027, including residential property.",
    "mock2_hvcts_band": "New £1,500 High Value Council Tax Surcharge band for homes in England worth £1.5 million to £2 million from April 2028.",
    "mock2_state_pension_uprating": "From April 2030 the State Pension rises by the higher of CPI and 2.5%; average earnings leave the triple lock.",
    "mock2_state_pension_personal_allowance": "£13,100 personal allowance at State Pension age from April 2027, withdrawn at £1 per £2 of income above £20,000.",
    "mock2_energy_price_payment": "One-off £150 per household in Great Britain on Universal Credit or Pension Credit guarantee credit, paid January 2027.",
    # Drill 3
    "mock3_fuel_duty_phasing": "The January and March 2027 rises are deferred: 52.95p a litre to 31 March 2027, 55.95p from 1 April, 57.95p from 1 October 2027.",
    "mock3_whd_top_up": "Extra £100 per Warm Home Discount household in England and Wales in winters 2026-27 and 2027-28.",
    "mock3_lha_30th_percentile": "Local Housing Allowance rates in Great Britain return to the 30th percentile of local rents from April 2027.",
    "mock3_pensioner_allowance": "Allowance equal to the State Pension where above the Personal Allowance, from April 2027, withdrawn above £30,000 of income.",
    "mock3_employer_ni_under_22": "No employer National Insurance on earnings of employees aged under 22, up to the upper earnings limit, from April 2027.",
    "mock3_additional_rate_threshold": "The 45p additional rate starts at £100,000 of taxable income instead of £125,140 from April 2027.",
    "mock3_cgt_higher_rate_aea": "Capital Gains Tax higher rate from 24% to 28% and annual exempt amount from £3,000 to £2,000, from 6 April 2027.",
    "mock3_salary_sacrifice_cap": "Pension salary sacrifice exempt from National Insurance falls from £2,000 to £1,000 a year from 6 April 2029.",
    "mock3_hvcts_top_bands": "High Value Council Tax Surcharge of £10,000 for homes in England worth £5 million to £10 million and £15,000 above, from April 2028.",
    "mock3_threshold_freeze_2032": "Personal Allowance (£12,570), basic rate limit (£37,700), NI Primary Threshold, UEL and Class 4 limits stay at 2030-31 levels in 2031-32.",
    "mock3_class4_main_rate": "Class 4 National Insurance main rate for the self-employed rises from 6% to 7% from April 2027.",
    # Drill 4
    "mock4_cb_early_years_addition": "Child Benefit Early Years Addition of £10 a week for each child under 1 from April 2027.",
    "mock4_state_pension_topup_allowance": "Income tax allowance for State Pension recipients equal to the amount their State Pension exceeds their personal allowance, from April 2027.",
    "mock4_fuel_vat_cut": "VAT on petrol and diesel falls from 20% to 15% from 1 December 2026 to 31 May 2027.",
    "mock4_employer_ni_under23": "No employer Class 1 National Insurance on earnings up to £25,000 a year for employees under 23, from April 2027.",
    "mock4_fuel_duty": "Fuel duty stays at 52.95p to 22 February 2027, 54.95p from 23 February 2027 and 56.95p from 1 October 2027.",
    "mock4_uc_child_element": "Universal Credit child element up £12.50 a month per child from April 2027.",
    "mock4_lha_reset": "Local Housing Allowance rates in Great Britain reset to the 30th percentile in April 2027, then frozen.",
    "mock4_carers_allowance_limit": "Carer's Allowance earnings limit from £204 to £230 a week from April 2027.",
    "mock4_cgt_higher_rate": "Capital Gains Tax higher rate from 24% to 26% from 6 April 2027, including residential property.",
    "mock4_savings_starting_band": "Starting rate band for savings cut from £5,000 to £2,000 from April 2028.",
    "mock4_threshold_freeze_2032": "Personal Allowance, basic rate limit, NI thresholds and Class 4 limits held at 2030-31 levels for 2031-32.",
    "mock4_combined": "All twelve coded drill 4 measures scored together.",
    "mock4_whd_topup": "Winter 2026-27 only: a further £125 for Warm Home Discount households on means-tested benefits and £75 for Pension Credit households, England and Wales.",
}

# Sentence-case display names where the drill's own name has a MOCK tag or an
# odd case.
NAMES = {
    "mock4_combined": "All drill 4 measures together",
    "mock4_threshold_freeze_2032": "Thresholds frozen to April 2032",
    "mock4_savings_starting_band": "Savings starting-rate band £2,000",
    "mock4_fuel_duty": "Fuel duty rises cancelled and restaged",
    "mock4_fuel_vat_cut": "VAT cut on road fuel",
    "mock4_lha_reset": "LHA reset to 30th percentile",
    "mock4_employer_ni_under23": "Employer NI relief for under-23s",
    "mock4_whd_topup": "Warm Home Discount top-up",
}

DRILL_META = {
    "1": {"date": "28 September 2026", "pr": 4, "issue": 6, "issue_label": "retro",
          "engine": "6.0.0 (pe-uk 2.90.2)",
          "data": "Enhanced FRS → Microcosm",
          "what": "Engine and data both changed; their effects are not split."},
    "2": {"date": "5 October 2026", "pr": 7, "issue": 8, "issue_label": "drill issue",
          "engine": "6.2.1 (pe-uk 2.120.0)",
          "data": "Earlier Microcosm → current",
          "what": "Engine and data both changed; their effects are not split."},
    "3": {"date": "12 October 2026", "pr": 9, "issue": 10, "issue_label": "drill issue",
          "engine": "6.2.7 (pe-uk 2.125.1)",
          "data": "Earlier Microcosm → current",
          "what": "Engine and data both changed; their effects are not split."},
    "4": {"date": "19 October 2026", "pr": 52, "issue": 53, "issue_label": "drill issue",
          "engine": "6.7.6 (pe-uk 2.130.1)",
          "data": "Same data",
          "what": "Same Microcosm data; engine-only change 6.7.6 → 6.10.2, so close to zero change is expected. It did rerun: the State Pension Top-up Allowance and the package move by about 0.3%, and decile 1 moves with pe-uk 2.132.4."},
}


def peuk(v: str, date: str) -> str:
    return f"{PEUK_CHANGELOG}#{v.replace('.', '')}---{date}"


# Links for the pe-uk changes cited in notes (verified to exist in the pe-uk
# CHANGELOG; 2.128.0 is in the changelog but was first published to PyPI in
# 2.130.1).
L1878 = "https://github.com/PolicyEngine/policyengine-uk/issues/1878"
L21231 = peuk("2.123.1", "2026-10-07")
L21262 = peuk("2.126.2", "2026-10-10")
L21280 = peuk("2.128.0", "2026-10-12")
L21311 = peuk("2.131.1", "2026-10-14")
L21324 = peuk("2.132.4", "2026-10-15")


def cause(drill: str, mid: str, year: int):
    """Plain-English cause of the move (README largest-movers table).

    Each link is [label, url, tooltip]; the technical detail sits in the
    tooltip so the main view stays readable.
    """
    if mid == "mock_nics_threshold_rise" and year == 2027:
        return ("Likely the fix of a National Insurance bug that the drill 1 review flagged",
                [["details", L1878, "policyengine-uk#1878: Class 4 NI dropped the additional-rate band at non-round thresholds. Consistent with the move; not confirmed by bisection."]])
    if mid == "mock_child_benefit_increase":
        return ("Mostly the new data", [])
    if mid == "mock_energy_vat_zero_rate":
        return ("Energy spending in the new data", [])
    if mid == "mock_hvcts_extension":
        return ("The surcharge now falls on owners only, not tenants; the new data adds to it",
                [["details", L21231, "policyengine-uk 2.123.1 changelog: the High Value Council Tax Surcharge is charged only on owner-occupiers."]])
    if mid == "mock2_state_pension_personal_allowance" and year == 2026:
        return ("A small new cost in 2026-27 where the drill day had £0; possibly how the engine now dates parameters; not confirmed",
                [["details", L21311, "policyengine-uk 2.131.1 changelog: bare-year and 1 January reform keys now name the calendar year."]])
    if drill == "3" and year == 2031:
        if mid == "mock3_threshold_freeze_2032":
            return ("2031-32 now has its own data, and the 2031-32 allowance uprating rule changed",
                    [["details", L21280, "policyengine-uk 2.128.0 changelog: data projected to 2032, so 2031-32 is a data year."],
                     ["rule", L21262, "policyengine-uk 2.126.2 changelog: from 2031-32 the personal allowance and basic rate limit follow September CPI with statutory rounding."]])
        return ("2031-32 now has its own data; on the drill day it reused 2030's",
                [["details", L21280, "policyengine-uk 2.128.0 changelog: data projected to 2032, so 2031-32 is a data year. First published in 2.130.1."]])
    if mid in ("mock4_cgt_higher_rate", "mock4_savings_starting_band"):
        return ("Revenue unchanged; the decile 1 figure moves because negative incomes are now counted there",
                [["details", L21324, "policyengine-uk 2.132.4 changelog: negative household income is reset to zero and counted in decile 1."]])
    if mid == "mock4_state_pension_topup_allowance":
        return ("Small move (about 0.3%); cause not found", [])
    if drill == "4":
        return ("Only the engine changed; same data", [])
    return ("Engine and data both changed; not split", [])


def num(v):
    return None if v in ("", None) else float(v)


def git(*a) -> str:
    return subprocess.check_output(["git", *a], cwd=REPO).decode()


def load_drills():
    spec = importlib.util.spec_from_file_location(
        "rerun_drills", REPO / "scripts" / "rerun_drills.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.DRILLS


def sheet_rows(cfg) -> dict:
    """(measure_id, model year) -> source row of the filled national sheet."""
    s = cfg["sheet"]
    if s is None:
        return {}
    sha = git("rev-parse", cfg["sha"]).strip()
    text = git("show", f"{sha}:{s['path']}")
    lines = text.splitlines()
    out = {}
    reader = csv.DictReader(io.StringIO("\n".join(lines[1:])))
    for i, row in enumerate(reader):
        rid = s["map"].get(str(row[s["key"]]).strip())
        if rid is None:
            continue
        fy = row["fiscal_year"].strip()
        line = i + 3  # line 1 = note, line 2 = header

        def v(col):
            x = row.get(col, "")
            try:
                return float(x) * s["unit"]
            except ValueError:
                return None

        out[(rid, int(fy[:4]))] = {
            "fy": fy,
            "line": line,
            "static": v(s["static"]),
            "post": v(s["post"]),
            "team": v(s["team"]),
            "file": s["path"],
            "url": f"{GH}/blob/{sha}/{s['path']}?plain=1#L{line}",
            "cols": [s["static"], s["post"], s["team"]],
        }
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dir", default="docs/drill-reruns/2026-10-24")
    args = p.parse_args()
    base = Path(args.dir)
    drills = load_drills()
    sheets = {str(c["drill"]): sheet_rows(c) for c in drills.values()}

    with open(base / "comparison.csv", newline="") as f:
        comp = list(csv.DictReader(f))

    rows = []
    for r in comp:
        d, mid, y = r["drill"], r["measure_id"], int(r["year"])
        invalid = bool(r["rerun_note"])
        old, new = num(r["revenue_bn_drill_day"]), num(r["revenue_bn_rerun"])
        sh = sheets[d].get((mid, y))
        static = sh["static"] if sh else None
        post = sh["post"] if sh else None
        team = sh["team"] if sh else None
        # Same basis: the drill team compared our figure with the costing as
        # it stood. Where their reconciled figure differs from the drill-day
        # figure, they converted it first (cash timing, fiscal-year
        # proration, in-year share), so the raw figure is not like-for-like.
        aligned = None
        if sh and static is not None:
            aligned = team is not None and abs(old - team) <= max(0.005, 0.02 * abs(old))
        vs = None
        if sh and static is not None and not invalid and aligned and abs(static) > 1e-9:
            go, gn = abs(old - static), abs(new - static)
            vs = "same" if abs(gn - go) < 0.0005 else ("closer" if gn < go else "further")
        note, links = (None, []) if invalid else cause(d, mid, y)
        name = NAMES.get(mid, r["measure_name"].removeprefix("MOCK: ").replace(" (MOCK)", ""))
        rows.append({
            "drill": d, "id": mid, "name": name[0].upper() + name[1:],
            "desc": DESCRIPTIONS.get(mid, ""), "year": y,
            "fy": f"{y}-{(y + 1) % 100:02d}",
            "old": old, "new": new, "diff": num(r["revenue_bn_diff"]),
            "pct": num(r["revenue_pct_diff"]), "size_pct": num(r["magnitude_pct_diff"]),
            "static": static, "post": post, "team": team,
            "sheet": None if not sh else {"url": sh["url"], "file": sh["file"], "line": sh["line"]},
            "aligned": aligned, "vs": vs, "invalid": invalid,
            "note": note, "links": links,
            "d": {k: [num(r[f"{k}_drill_day"]), num(r[f"{k}_rerun"])]
                  for k in ("d1_avg_change", "d5_avg_change", "d10_avg_change", "people_affected_pct")},
        })

    groups = []
    for d in sorted({r["drill"] for r in rows}):
        g = [r for r in rows if r["drill"] == d]
        mat = [r for r in g if abs(r["old"]) >= 0.01 and not r["invalid"]]
        sizes = [abs(r["size_pct"]) for r in mat]
        has_sheet = any(r["sheet"] for r in g)
        m = DRILL_META[d]
        groups.append({
            "drill": d, **m,
            "pr_url": f"{GH}/pull/{m['pr']}", "issue_url": f"{GH}/issues/{m['issue']}",
            "median": statistics.median(sizes), "max": max(sizes), "n": len(mat),
            "closer": sum(r["vs"] == "closer" for r in g) if has_sheet else None,
            "further": sum(r["vs"] == "further" for r in g) if has_sheet else None,
            "basis_diff": sum(r["aligned"] is False and not r["invalid"] for r in g),
        })

    out = base / "dashboard"
    out.mkdir(exist_ok=True)
    (out / "data.json").write_text(json.dumps({"drills": groups, "rows": rows}, ensure_ascii=False))
    print(f"wrote {out / 'data.json'}: {len(rows)} rows")
    for g in groups:
        print(g["drill"], round(g["median"], 3), round(g["max"], 3), g["n"], g["closer"], g["further"], g["basis_diff"])


if __name__ == "__main__":
    main()
