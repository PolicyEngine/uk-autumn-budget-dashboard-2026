"""Build data.json for the drill-rerun comparison dashboard.

MOCK DATA. Reads ``comparison.csv`` and ``summary.csv`` written by
``scripts/rerun_drills.py compare`` and writes ``dashboard/data.json`` next
to them, adding a one-line description per mock measure and the attributed
cause of each move (from the README in the same folder).

Usage (from the repository root)::

    python3 scripts/build_drill_rerun_dashboard.py \
        --dir docs/drill-reruns/2026-10-24

Then serve ``<dir>/dashboard`` with any static file server.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

# One line per measure, condensed from the `description` of each Reform on
# the drill branches (src/uk_budget_data/reforms.py, mock_drill2_structural.py
# and mock_drill3_*.py on origin/drill{1,2,3,4}-mock-budget).
DESCRIPTIONS = {
    # Drill 1
    "mock_fuel_duty_freeze": "Cancels the March 2027 2p rise and April 2027 RPI rise; main rates held at 55.95p a litre to March 2028.",
    "mock_energy_vat_zero_rate": "Zero rate of VAT on domestic electricity and gas in Great Britain, April 2027 to March 2028.",
    "mock_child_benefit_increase": "Child Benefit to £30 a week for the eldest child and £20 for others from April 2027, then CPI.",
    "mock_nics_threshold_rise": "Primary Threshold and Lower Profits Limit from £12,570 to £13,000 from April 2027, held to April 2031.",
    "mock_hvcts_extension": "High Value Council Tax Surcharge extended to English homes worth £1.5m+ from April 2028 (£2,500 band to £2.5m).",
    # Drill 2
    "mock2_fuel_duty_hold": "January and March 2027 rises cancelled; 52.95p to August 2027, 55.95p from September 2027, RPI from April 2028.",
    "mock2_electricity_vat_zero": "Zero VAT on domestic electricity in Great Britain continues April 2027 to March 2028; gas stays at 5%.",
    "mock2_employer_ni_threshold": "Employer NI Secondary Threshold from £5,000 to £5,500 a year from April 2027, held flat to 2030-31.",
    "mock2_cgt_rates": "CGT rates rise from 18% to 20% and 24% to 28% from 6 April 2027, including residential property.",
    "mock2_hvcts_band": "New £1,500 High Value Council Tax Surcharge band for English homes worth £1.5m to £2m from April 2028.",
    "mock2_state_pension_uprating": "From April 2030 the State Pension rises by the higher of CPI and 2.5%; earnings leave the triple lock.",
    "mock2_state_pension_personal_allowance": "£13,100 personal allowance at State Pension age from April 2027, tapered at £1 per £2 above £20,000.",
    "mock2_energy_price_payment": "One-off £150 per household on UC or Pension Credit guarantee credit, paid January 2027.",
    # Drill 3
    "mock3_fuel_duty_phasing": "January and March 2027 rises deferred: 52.95p to March 2027, 55.95p from April, 57.95p from October 2027.",
    "mock3_whd_top_up": "Extra £100 per Warm Home Discount household in England and Wales, winters 2026-27 and 2027-28.",
    "mock3_lha_30th_percentile": "Local Housing Allowance rates in Great Britain return to the 30th percentile of local rents from April 2027.",
    "mock3_pensioner_allowance": "Allowance equal to the State Pension where above the PA, from April 2027, withdrawn above £30,000 of income.",
    "mock3_employer_ni_under_22": "No employer NI on earnings of employees aged under 22, up to the UEL, from April 2027.",
    "mock3_additional_rate_threshold": "45p additional rate starts at £100,000 instead of £125,140 from April 2027 (rUK and dividends).",
    "mock3_cgt_higher_rate_aea": "CGT higher rate 24% to 28% and a lower annual exempt amount from 6 April 2027.",
    "mock3_salary_sacrifice_cap": "NI-exempt pension salary sacrifice limit falls from £2,000 to £1,000 a year from April 2029.",
    "mock3_hvcts_top_bands": "Higher High Value Council Tax Surcharge bands for English homes worth £5m+ from April 2028.",
    "mock3_threshold_freeze_2032": "PA, basic rate limit, NI PT/UEL and Class 4 limits frozen for one more year, to April 2032.",
    "mock3_class4_main_rate": "Class 4 NI main rate for the self-employed rises from 6% to 7% from April 2027.",
    # Drill 4
    "mock4_cb_early_years_addition": "Child Benefit Early Years Addition of £10 a week per child under 1 from April 2027.",
    "mock4_state_pension_topup_allowance": "Income tax allowance for State Pension recipients equal to the excess of State Pension over the PA, from April 2027.",
    "mock4_fuel_vat_cut": "VAT on petrol and diesel cut from 20% to 15%, 1 December 2026 to 31 May 2027.",
    "mock4_employer_ni_under23": "No employer Class 1 NI on earnings up to £25,000 for employees under 23 from April 2027.",
    "mock4_fuel_duty": "Fuel duty rises cancelled and restaged: 52.95p to February 2027, 54.95p, then 56.95p from October 2027.",
    "mock4_uc_child_element": "UC child element up £12.50 a month per child from April 2027.",
    "mock4_lha_reset": "LHA rates in Great Britain reset to the 30th percentile in April 2027, then frozen.",
    "mock4_carers_allowance_limit": "Carer's Allowance earnings limit from £204 to £230 a week from April 2027.",
    "mock4_cgt_higher_rate": "CGT higher rate from 24% to 26% from 6 April 2027, including residential property.",
    "mock4_savings_starting_band": "Starting rate band for savings cut from £5,000 to £2,000 from April 2028.",
    "mock4_threshold_freeze_2032": "PA, basic rate limit, NI thresholds, UEL and Class 4 limits held at 2030-31 levels for 2031-32.",
    "mock4_combined": "All drill 4 coded measures together.",
}

# What changed between drill day and the rerun, per drill (README "What each
# drill isolates").
DRILL_CHANGE = {
    "1": "Engine 6.0.0 → 6.10.2 and data enhanced FRS → Microcosm",
    "2": "Engine 6.2.1 → 6.10.2 and Microcosm aa31bdf6 → 810ba980",
    "3": "Engine 6.2.7 → 6.10.2 and Microcosm aa31bdf6 → 810ba980",
    "4": "Engine only: 6.7.6 → 6.10.2, same Microcosm 810ba980",
}

DEFAULT_CAUSE = {
    "1": "Engine and dataset together; not decomposed",
    "2": "Engine and dataset together; not decomposed",
    "3": "Engine and dataset together; not decomposed",
    "4": "Engine only; same dataset",
}

INVALID_NOTE = "Month-dated fuel duty ignored by pe-uk 2.132.6; VAT part only (see callout)"


def cause(drill: str, mid: str, year: int) -> str:
    """Attributed cause of the move, from the README's largest-movers table."""
    if mid == "mock_nics_threshold_rise" and year == 2027:
        return "NICs UEL/UPL baseline fix (policyengine-uk#1878); consistent with the fix, not bisected"
    if mid == "mock_child_benefit_increase":
        return "Mainly the dataset (enhanced FRS → Microcosm); HICBC engine changes also apply"
    if mid == "mock_energy_vat_zero_rate":
        return "Dataset energy spending (enhanced FRS → Microcosm); not decomposed"
    if mid == "mock_hvcts_extension":
        return "HVCTS charged on owner-occupiers only (pe-uk 2.123.1); dataset change also applies"
    if mid == "mock2_state_pension_personal_allowance" and year == 2026:
        return "Now −£0.024bn where drill day had £0; possibly pe-uk 2.131.1 parameter dating, not confirmed"
    if drill == "3" and year == 2031:
        if mid == "mock3_lha_30th_percentile":
            return "2031 projection: pe-uk 2.128.0 projects data to 2032; drill day served 2031 from 2030 data"
        if mid == "mock3_threshold_freeze_2032":
            return "2031 is now a real dataset year (2.128.0); 2.126.2 changed 2031-32 PA/BRL indexation"
        return "2031 is now a real dataset year (pe-uk 2.128.0 projects to 2032)"
    if mid in ("mock4_cgt_higher_rate", "mock4_savings_starting_band"):
        return "Revenue unchanged; decile 1 moves with the negative-income change (pe-uk 2.132.4)"
    if mid == "mock4_state_pension_topup_allowance":
        return "About 0.3% move; not attributed"
    return DEFAULT_CAUSE[drill]


def num(v: str):
    return None if v in ("", None) else float(v)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dir", default="docs/drill-reruns/2026-10-24")
    args = p.parse_args()
    base = Path(args.dir)

    with open(base / "comparison.csv", newline="") as f:
        comp = list(csv.DictReader(f))
    with open(base / "summary.csv", newline="") as f:
        summ = {r["drill"]: r for r in csv.DictReader(f)}

    rows = []
    for r in comp:
        y = int(r["year"])
        invalid = bool(r["rerun_note"])
        vs = r["vs_official_static"] or None
        rows.append(
            {
                "drill": r["drill"],
                "id": r["measure_id"],
                "name": r["measure_name"].removeprefix("MOCK: "),
                "desc": DESCRIPTIONS.get(r["measure_id"], ""),
                "year": y,
                "fy": f"{y}-{(y + 1) % 100:02d}",
                "old": num(r["revenue_bn_drill_day"]),
                "new": num(r["revenue_bn_rerun"]),
                "diff": num(r["revenue_bn_diff"]),
                "pct": num(r["revenue_pct_diff"]),
                "size_pct": num(r["magnitude_pct_diff"]),
                "static": num(r["official_static_bn"]),
                "post": num(r["official_post_behavioural_bn"]),
                "vs": None if invalid else vs,
                "invalid": invalid,
                "note": INVALID_NOTE if invalid else cause(r["drill"], r["measure_id"], y),
                "d": {
                    k: [num(r[f"{k}_drill_day"]), num(r[f"{k}_rerun"])]
                    for k in (
                        "d1_avg_change",
                        "d5_avg_change",
                        "d10_avg_change",
                        "people_affected_pct",
                    )
                },
            }
        )

    tiles = []
    for drill in sorted(summ):
        s = summ[drill]
        has_sheet = any(
            r["drill"] == drill and r["static"] is not None for r in rows
        )
        tiles.append(
            {
                "drill": drill,
                "median": float(s["median_abs_pct_diff"]),
                "max": float(s["max_abs_pct_diff"]),
                "material": int(s["material_cells"]),
                "invalid": int(s["invalid_cells_excluded"]),
                "changed": DRILL_CHANGE[drill],
                "closer": int(s["closer_to_official"]) if has_sheet else None,
                "further": int(s["further_from_official"]) if has_sheet else None,
            }
        )

    out = base / "dashboard"
    out.mkdir(exist_ok=True)
    (out / "data.json").write_text(
        json.dumps({"tiles": tiles, "rows": rows}, ensure_ascii=False, indent=0)
    )
    print(f"wrote {out / 'data.json'}: {len(rows)} rows, {len(tiles)} tiles")


if __name__ == "__main__":
    main()
