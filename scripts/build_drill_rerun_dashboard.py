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
import re
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

# Icon per measure, by policy area (rendered as inline SVG on the page).
ICONS = {
    "mock_fuel_duty_freeze": "fuel", "mock2_fuel_duty_hold": "fuel", "mock3_fuel_duty_phasing": "fuel",
    "mock4_fuel_duty": "fuel", "mock4_fuel_vat_cut": "fuel",
    "mock_energy_vat_zero_rate": "zap", "mock2_electricity_vat_zero": "zap", "mock2_energy_price_payment": "zap",
    "mock3_whd_top_up": "zap", "mock4_whd_topup": "zap",
    "mock_child_benefit_increase": "baby", "mock4_cb_early_years_addition": "baby",
    "mock4_uc_child_element": "users", "mock4_carers_allowance_limit": "heart",
    "mock_nics_threshold_rise": "briefcase", "mock2_employer_ni_threshold": "briefcase",
    "mock3_employer_ni_under_22": "briefcase", "mock4_employer_ni_under23": "briefcase",
    "mock3_class4_main_rate": "briefcase", "mock3_salary_sacrifice_cap": "briefcase",
    "mock_hvcts_extension": "home", "mock2_hvcts_band": "home", "mock3_hvcts_top_bands": "home",
    "mock3_lha_30th_percentile": "home", "mock4_lha_reset": "home",
    "mock2_cgt_rates": "trending", "mock3_cgt_higher_rate_aea": "trending", "mock4_cgt_higher_rate": "trending",
    "mock4_savings_starting_band": "trending",
    "mock2_state_pension_uprating": "pension", "mock2_state_pension_personal_allowance": "pension",
    "mock3_pensioner_allowance": "pension", "mock4_state_pension_topup_allowance": "pension",
    "mock3_additional_rate_threshold": "percent", "mock3_threshold_freeze_2032": "percent",
    "mock4_threshold_freeze_2032": "percent",
    "mock4_combined": "layers",
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


# Largest genuine gaps against the like-for-like mock official costing
# (large-gap benchmark audit). One representative cell each; the related
# cells give the range shown in the tooltip.
GAPS = [
    {"label": "Capital Gains Tax", "cell": ("2", "mock2_cgt_rates", 2027),
     "related": [("2", "mock2_cgt_rates"), ("3", "mock3_cgt_higher_rate_aea"), ("4", "mock4_cgt_higher_rate")],
     "reason": "our data has about 3× the gains",
     "detail": "Microcosm's higher-rate gains base is about £108bn against the costings' £36–38.5bn."},
    {"label": "Pensioner Allowance", "cell": ("3", "mock3_pensioner_allowance", 2030),
     "related": [("3", "mock3_pensioner_allowance")],
     "reason": "more pensioners above the flat rate",
     "detail": "87% of gainers have State Pension above the flat rate; 4.46m beneficiaries against 3.4m."},
    {"label": "Local Housing Allowance", "cell": ("3", "mock3_lha_30th_percentile", 2030),
     "related": [("3", "mock3_lha_30th_percentile")],
     "reason": "fewer claimants gain",
     "detail": "Modelled gainers and gains fall well short of 1.15m × £1,480; uniform Annex A scaling halves the rise."},
    {"label": "Threshold freeze", "cell": ("3", "mock3_threshold_freeze_2032", 2031),
     "related": [("3", "mock3_threshold_freeze_2032"), ("4", "mock4_threshold_freeze_2032")],
     "reason": "2031 income path in the new data",
     "detail": "Against the tax-year liability; the income tax leg is £4.5bn against £3.0bn."},
    {"label": "Employer NI threshold", "cell": ("2", "mock2_employer_ni_threshold", 2030),
     "related": [("2", "mock2_employer_ni_threshold"), ("4", "mock4_employer_ni_under23")],
     "reason": "unexplained; employment counts",
     "detail": "Against the net post-behavioural figure; full pay pass-through and no corporation tax in the model. Drill 4 under-23s: more 21–22 employments in the data."},
]


def gap_rows(rows):
    by = {(r["drill"], r["id"], r["year"]): r for r in rows}
    out = []
    for g in GAPS:
        r = by[g["cell"]]
        rel = [x for x in rows if (x["drill"], x["id"]) in g["related"] and x["lfl"] and not zero_cell(x)]
        out.append({
            "label": g["label"], "drill": r["drill"], "id": r["id"], "fy": r["fy"], "icon": r["icon"],
            "ours": r["new"], "drill_day": r["old"], "official": r["lfl"],
            "gap": r["new"] - r["lfl"], "gap_drill_day": r["old"] - r["lfl"],
            "ratio": abs(r["new"]) / abs(r["lfl"]),
            "range": [[x["drill"], x["fy"], x["new"], x["lfl"]] for x in rel],
            "reason": g["reason"], "detail": g["detail"],
        })
    return sorted(out, key=lambda x: -abs(x["gap"]))


# Real published benchmarks. The drill costings are invented, so each measure
# is matched to the closest real published costing of the same or an
# equivalent policy, rescaled where the size of the change differs. Values are
# £bn by model year (2027 = 2027-28); revenue is positive, cost negative.
#
# match:
#   direct    the same change, read straight off the source
#   rescaled  the same kind of change, scaled to this size (shown in "calc")
#   derived   official counts × the measure's amount (shown in "calc")
#   basis     a real figure on a different basis (post-behavioural); shown,
#             not scored
#   related   a real costing of a related policy; context only, not scored
#   none      no external costing found
# bound: the figure is only an upper or lower bound, or approximate.
# Only direct, rescaled and derived figures without a bound are compared
# (closer/further); the rest are shown for context.
RR = {
    "source": "HMRC, Direct effects of illustrative tax changes (June 2025)",
    "url": "https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes",
    "file": "https://assets.publishing.service.gov.uk/media/68552862b46781eacfd71d71/June_2025_TRR_ODS__1_.ods",
    "basis": "Spring Statement 2025 baseline; National Accounts; behavioural effects included for income tax, NICs and CGT",
}
B25 = "https://assets.publishing.service.gov.uk/media/692872fd2a37784b16ecf676/Budget_2025-Policy_Costings.pdf"
B25T = "https://assets.publishing.service.gov.uk/media/69269df29fd433badebc31b3/Table_4.1_-_Budget_2025_Policy_Decisions.xlsx"
AB24 = "https://assets.publishing.service.gov.uk/media/6721d2c54da1c0d41942a8d2/Policy_Costing_Document_-_Autumn_Budget_2024.pdf"
AS23 = "https://assets.publishing.service.gov.uk/media/6560c3ef3d77410012420197/Autumn_Statement_2023_Policy_Costings_-_Final.pdf"
ELEC = "https://www.gov.uk/government/news/new-pm-cuts-tax-on-household-electricity-bills-to-give-breathing-space-on-cost-of-living"
WHD = ("https://www.gov.uk/government/consultations/expanding-the-warm-home-discount-scheme-2025-to-2026/"
       "expanding-the-warm-home-discount-scheme-2025-to-2026-consultation-document-accessible-webpage")
UCS = ("https://www.gov.uk/government/statistics/universal-credit-quarterly-statistics-29-april-2013-to-12-february-2026/"
       "universal-credit-quarterly-statistics-29-april-2013-to-12-february-2026")


def _rr(where, calc, values, match="rescaled", bound=None):
    e = {"match": match, "source": RR["source"], "short": "HMRC ready reckoner", "url": RR["url"], "file": RR["file"],
         "where": where, "basis": RR["basis"], "calc": calc, "values": values}
    if bound:
        e["bound"] = bound
    return e


FUEL_REL = {
    "match": "related", "source": "HM Treasury, Budget 2025 policy costings, p. 14",
    "url": f"{B25}#page=14",
    "where": "Fuel Duty: cancel uprating for 2026-27; extend the 5p cut to 31 August 2026, then staged rises",
    "basis": "post-behavioural",
    "calc": "Real Budget 2025 fuel duty measure: −£2.37bn (2026-27), then about −£0.85bn a year from 2027-28. "
            "Rule of thumb from the HMRC ready reckoner: a 1% change in petrol and diesel duty is £235m in 2027-28 (about £0.4bn per 1p a litre).",
    "values": {2026: -2.37, 2027: -0.855, 2028: -0.855, 2029: -0.85, 2030: -0.84},
}
HVCTS_REL = {
    "match": "related", "source": "HM Treasury, Budget 2025 policy costings, p. 51",
    "url": f"{B25}#page=51",
    "where": "High Value Council Tax Surcharge on homes over £2m in England from April 2028",
    "basis": "static and post-behavioural",
    "calc": "The real surcharge (£2m and above, 165,000 homes): static +£0.61bn in 2028-29, +£0.62bn, +£0.64bn; "
            "post-behavioural +£0.40bn, +£0.43bn, +£0.44bn (Table 4.1). Shown: the static figures. Different bands, so not comparable.",
    "values": {2028: 0.605, 2029: 0.62, 2030: 0.635},
}
LHA_REL = {
    "match": "related", "source": "HM Treasury, Autumn Statement 2023 policy costings, p. 16",
    "url": f"{AS23}#page=16",
    "where": "Local Housing Allowance: set to the 30th percentile from April 2024",
    "basis": "post-behavioural (landlords and claimants)",
    "calc": "The 2024 reset after a four-year freeze: −£1.29bn (2024-25), −£1.49bn, −£1.59bn, −£1.66bn (2027-28), −£1.70bn (2028-29). "
            "A 2027 reset starts from a different gap between rates and rents, so this is context, not a benchmark.",
    "values": {2027: -1.66, 2028: -1.70},
}
FREEZE_REL = {
    "match": "related", "source": "HM Treasury, Budget 2025 Table 4.1, line 46, and policy costings p. 40",
    "url": f"{B25}#page=40",
    "where": "Personal tax: maintain income tax and NICs thresholds for three further years to April 2031",
    "basis": "post-behavioural (static in the costings document)",
    "calc": "The first frozen year of the real extension raises +£3.37bn in 2028-29 (static +£3.33bn). "
            "A one-year freeze in 2031-32 is the same kind of measure three years later, on a larger income base, so it should be somewhat larger. Shown against 2031-32 for reference.",
    "values": {2031: 3.365},
}
CGT_RULE = ("HMRC's CGT rows are post-behavioural and non-linear; points between the 1- and 5-point rows are "
            "interpolated linearly. Our model is static, so this is not compared.")
NONE = {"match": "none"}

EXTERNAL = {
    # Drill 1
    "mock_child_benefit_increase": _rr(
        "Child Benefit: increase first child rate by £1 a week (cost); increase subsequent child rate by £1 a week (cost)",
        "Rise over the April 2027 baseline (£27.67 / £18.31, policyengine-uk): +£2.33 eldest, +£1.69 others. "
        "2027-28: 2.33 × £335m + 1.69 × £240m = £1.19bn; 2028-29: 2.33 × £330m + 1.69 × £245m = £1.18bn. Includes the HICBC offset.",
        {2027: -1.186, 2028: -1.183}),
    "mock_nics_threshold_rise": _rr(
        "Change employee entry threshold by £2 per week; change lower profits limit by £104 per year",
        "£430 a year = 4.13 × £104. 2027-28: 4.13 × (£230m + £15m) = £1.01bn; 2028-29: 4.13 × (£250m + £20m) = £1.12bn.",
        {2027: -1.013, 2028: -1.116}),
    "mock_energy_vat_zero_rate": _rr(
        "VAT: change reduced rate by 1 percentage point",
        "5 points × £480m = £2.40bn in 2027-28. An upper bound: the 5% rate also covers a few other goods, and the row is UK-wide while the measure is Great Britain only.",
        {2027: -2.40}, bound="upper"),
    "mock_fuel_duty_freeze": FUEL_REL,
    "mock_hvcts_extension": HVCTS_REL,
    # Drill 2
    "mock2_fuel_duty_hold": FUEL_REL,
    "mock2_electricity_vat_zero": {
        "match": "rescaled", "source": "HM Treasury news release, 21 July 2026", "short": "HM Treasury, July 2026",
        "url": ELEC, "where": "Zero rate of VAT on domestic electricity in Great Britain, 1 October 2026 to 31 March 2027",
        "basis": "Treasury estimate on estimated electricity prices",
        "calc": "The real cut costs around £850m for six months (2026-27). Doubled for a full year in 2027-28: £1.70bn. "
                "The upper end: October to March is the higher-use half of the year.",
        "values": {2027: -1.70}, "bound": "upper"},
    "mock2_employer_ni_threshold": _rr(
        "Change employer threshold by £2 per week",
        "£500 a year = 4.81 × £104. 2027-28: 4.81 × £430m = £2.07bn; 2028-29: 4.81 × £470m = £2.26bn.",
        {2027: -2.067, 2028: -2.260}),
    "mock2_cgt_rates": _rr(
        "Increase lower / higher Capital Gains Tax rate by 1 and 5 percentage points",
        "Lower rate +2 points: +£13m (2027-28), +£1m (2028-29); higher rate +4 points: −£156m, −£660m. Total −£0.14bn and −£0.66bn: "
        "after behaviour, HMRC expects the rise to lose money. " + CGT_RULE,
        {2027: -0.144, 2028: -0.659}, match="basis"),
    "mock2_hvcts_band": HVCTS_REL,
    "mock2_state_pension_uprating": NONE,
    "mock2_state_pension_personal_allowance": NONE,
    "mock2_energy_price_payment": {
        "match": "derived", "source": "DWP, Universal Credit statistics to 12 February 2026", "short": "DWP Universal Credit statistics",
        "url": UCS, "where": "6.7 million households on Universal Credit with a payment, Great Britain, February 2026",
        "basis": "count × amount; no take-up or behaviour",
        "calc": "6.7m × £150 = £1.01bn. A lower bound: Pension Credit households not on Universal Credit are left out.",
        "values": {2026: -1.005}, "bound": "lower"},
    # Drill 3
    "mock3_fuel_duty_phasing": FUEL_REL,
    "mock3_whd_top_up": {
        "match": "derived", "source": "DESNZ, Expanding the Warm Home Discount scheme 2025 to 2026 (consultation)", "short": "DESNZ Warm Home Discount",
        "url": WHD, "where": "Expanded scheme: around 6.1 million households in Great Britain, spend from around £600m to £1bn",
        "basis": "scheme spend × amount",
        "calc": "£1bn for £150 a household, so £100 is £0.67bn a winter. Great Britain; the measure is England and Wales only, so a little less.",
        "values": {2026: -0.667, 2027: -0.667}, "bound": "upper"},
    "mock3_lha_30th_percentile": LHA_REL,
    "mock3_pensioner_allowance": NONE,
    "mock3_employer_ni_under_22": NONE,
    "mock3_additional_rate_threshold": NONE,
    "mock3_cgt_higher_rate_aea": _rr(
        "Increase higher Capital Gains Tax rate by 1 and 5 percentage points; increase Annual Exempt Amount by £500",
        "Higher rate +4 points: −£156m (2027-28), −£660m (2028-29); exempt amount −£1,000: +£70m, +£60m. Total −£0.09bn and −£0.60bn. " + CGT_RULE,
        {2027: -0.086, 2028: -0.600}, match="basis"),
    "mock3_salary_sacrifice_cap": {
        "match": "related", "source": "HM Treasury, Budget 2025 policy costings, p. 47",
        "url": f"{B25}#page=47", "where": "Salary Sacrifice: limit NICs relief to £2,000 a year from 6 April 2029",
        "basis": "post-behavioural (Table 4.1)",
        "calc": "The real £2,000 cap: +£4.85bn (2029-30), +£2.59bn (2030-31); static +£4.87bn, +£5.07bn. The drill cuts the cap again to £1,000, which is not costed anywhere.",
        "values": {2029: 4.845, 2030: 2.585}},
    "mock3_hvcts_top_bands": HVCTS_REL,
    "mock3_threshold_freeze_2032": FREEZE_REL,
    "mock3_class4_main_rate": _rr(
        "Change Class 4 main rate by 1 percentage point",
        "Exactly this change: +£525m (2027-28), +£445m (2028-29). Self-assessment timing: part of the first year's yield is paid later.",
        {2027: 0.525, 2028: 0.445}, match="direct"),
    # Drill 4
    "mock4_cb_early_years_addition": NONE,
    "mock4_state_pension_topup_allowance": NONE,
    "mock4_fuel_vat_cut": NONE,
    "mock4_employer_ni_under23": NONE,
    "mock4_fuel_duty": FUEL_REL,
    "mock4_uc_child_element": NONE,
    "mock4_lha_reset": LHA_REL,
    "mock4_carers_allowance_limit": {
        "match": "rescaled", "source": "HM Treasury, Autumn Budget 2024 policy costings, p. 64", "short": "Autumn Budget 2024 costing",
        "url": f"{AB24}#page=64", "where": "Carer's Allowance: earnings limit from £151 to £196 a week from April 2025",
        "basis": "costing of newly eligible claimants",
        "calc": "The real +£45 rise costs £105m (2027-28), £135m, £165m. Scaled to +£26: £61m, £78m, £95m. Linear scaling is rough: who is near the limit differs.",
        "values": {2027: -0.061, 2028: -0.078, 2029: -0.095}},
    "mock4_cgt_higher_rate": _rr(
        "Increase higher Capital Gains Tax rate by 1 and 5 percentage points",
        "Higher rate +2 points: +£1m (2027-28), −£240m (2028-29). " + CGT_RULE,
        {2027: 0.001, 2028: -0.240}, match="basis"),
    "mock4_savings_starting_band": _rr(
        "Change starting rate limit for savings income by £100",
        "£3,000 cut = 30 × £5m = £150m in 2028-29.",
        {2028: 0.150}),
    "mock4_threshold_freeze_2032": FREEZE_REL,
    "mock4_combined": {"match": "none", "calc": "A package of drill measures; no single external costing."},
    "mock4_whd_topup": {
        "match": "derived", "source": "DESNZ, Expanding the Warm Home Discount scheme 2025 to 2026 (consultation)", "short": "DESNZ Warm Home Discount",
        "url": WHD, "where": "Expanded scheme: around 6.1 million households in Great Britain, spend from around £600m to £1bn",
        "basis": "scheme spend × amount",
        "calc": "£1bn for £150 a household, so £125 is £0.83bn for winter 2026-27. Great Britain, and the £75 Pension Credit part is not separated, so approximate.",
        "values": {2026: -0.833}, "bound": "approximate"},
}

# Other organisations' published estimates (think tanks, party costings).
# Shown and labelled; never scored. Same rules: exact quote, URL checked,
# scaling shown.
TPA = "https://taxpolicy.org.uk/2026/07/07/mansion-tax-1-5m-burnham/"
RF_TL = "https://resolutionfoundation.org/app/uploads/2024/05/Under-triple-lock-and-key.pdf"
TL_PLUS = {
    "match": "related", "kind": "think tank", "source": "Resolution Foundation, Under triple lock and key (May 2024)",
    "short": "Resolution Foundation", "url": RF_TL,
    "where": "The Conservatives' 'triple lock plus': a higher personal allowance for pensioners, rising with the triple lock",
    "basis": "static, by 2029-30",
    "calc": "\"around 8 million tax-paying pensioners would see an annual tax cut of around £250 a year by the end of the next Parliament, at a cost of just over £2 billion\". "
            "A broader allowance for all pensioners, so context only. Shown against 2029-30.",
    "values": {2029: -2.0}}
EXTRA = {
    "mock_energy_vat_zero_rate": [{
        "match": "direct", "kind": "think tank", "source": "Nesta, Is removing VAT really the best way to cut energy bills? (22 September 2025)",
        "short": "Nesta", "url": "https://www.nesta.org.uk/blog/is-removing-vat-really-the-best-way-to-cut-energy-bills/",
        "where": "Removing VAT from household electricity and gas", "basis": "full year, no year or price basis stated",
        "calc": "\"it will cost £2.5 billion per year to implement\". The commonly cited £1.75bn is on 2021 energy spending.",
        "values": {2027: -2.5}}],
    "mock_hvcts_extension": [{
        "match": "rescaled", "kind": "think tank", "source": "Tax Policy Associates, What if Andy Burnham lowered the mansion tax threshold to £1.5m? (updated 19 September 2026)",
        "short": "Tax Policy Associates", "url": TPA,
        "where": "Revenue table, 2028-29: adding a £1.5m band at £1,500 (other bands unchanged)", "basis": "static, OBR-scaled",
        "calc": "Static £850m with the £1,500 band against £605m for the £2m tax: +£245m. The drill charges £2,500 on £1.5m to £2m homes: £245m × 2,500 / 1,500 = £408m.",
        "values": {2028: 0.408}}],
    "mock2_hvcts_band": [{
        "match": "direct", "kind": "think tank", "source": "Tax Policy Associates, What if Andy Burnham lowered the mansion tax threshold to £1.5m? (updated 19 September 2026)",
        "short": "Tax Policy Associates", "url": TPA,
        "where": "Revenue table, 2028-29: adding a £1.5m band at £1,500 (other bands unchanged)", "basis": "static, OBR-scaled",
        "calc": "The same band: static £850m against £605m for the £2m tax, so +£245m (dynamic about £520m against £400m, +£120m).",
        "values": {2028: 0.245}}],
    "mock2_state_pension_personal_allowance": [TL_PLUS],
    "mock3_pensioner_allowance": [TL_PLUS],
    "mock4_state_pension_topup_allowance": [TL_PLUS],
    "mock3_lha_30th_percentile": [{
        "match": "direct", "kind": "think tank", "source": "Resolution Foundation, Saving private renters (19 September 2026)",
        "short": "Resolution Foundation", "url": "https://www.resolutionfoundation.org/publications/saving-private-renters/",
        "where": "Relinking LHA to the 30th percentile in April 2027 and keeping the link", "basis": "current prices, 2029-30",
        "calc": "\"relinking LHA to the 30th percentile in April 2027 and maintaining the link thereafter would cost £2 billion a year\" (in current prices) by 2029-30.",
        "values": {2029: -2.0}}],
    "mock3_employer_ni_under_22": [{
        "match": "related", "kind": "party", "source": "Conservative Party pledge, 6 October 2026 (reported by PA)",
        "short": "Conservative Party costing", "url": "https://www.irishnews.com/news/uk/tories-pledge-to-halve-employer-national-insurance-for-young-people-D7AUPBRM2NOJ7LDU4HJVXSGA4E/",
        "where": "Halve employer NI (15% to 7.5%) for workers aged 21 to 24", "basis": "static; party's own figure",
        "calc": "Static cost £3.25bn, \"which officials estimate would fall to a 'dynamic' cost of £2.3 billion in 2029-30\". Different ages and rate, so context only. Shown against 2029-30.",
        "values": {2029: -3.25}}],
    "mock4_uc_child_element": [{
        "match": "rescaled", "kind": "think tank", "source": "Child Poverty Action Group, Universal credit: a three-step plan (2024)",
        "short": "CPAG", "url": "https://cpag.org.uk/sites/default/files/2024-05/Universal_credit_three_steps.pdf",
        "where": "Increasing the child element by £20 a week", "basis": "2024 caseload",
        "calc": "\"Increasing the child element by £20 a week would reduce child poverty by 400,000 at a cost of £3 billion.\" £12.50 a month = £2.88 a week: £3bn × 2.88 / 20 = £0.43bn. Before the two-child limit was removed, so likely low.",
        "values": {2027: -0.433}}],
}
EXTRA["mock4_employer_ni_under23"] = EXTRA["mock3_employer_ni_under_22"]

SCORED = ("direct", "rescaled", "derived")
MATCH_LABEL = {
    "direct": "Same change", "rescaled": "Rescaled", "derived": "Derived from official counts",
    "basis": "Different basis", "related": "Related policy only", "none": "No external costing found",
}


def entries(mid):
    """Official entry first, then other organisations; drop 'none' when
    anything else exists."""
    es = [EXTERNAL.get(mid, NONE)] + EXTRA.get(mid, [])
    keep = [e for e in es if e["match"] != "none"]
    return keep or es[:1]


def is_scored(e):
    return e.get("kind", "official") == "official" and e["match"] in SCORED and "bound" not in e


def rank(e):
    """Which figure the External column shows when several exist for a year."""
    if is_scored(e):
        return 0
    if e.get("kind", "official") == "official" and e["match"] != "related":
        return 1
    if e.get("kind", "official") != "official" and e["match"] != "related":
        return 2
    return 3


def word(e):
    """Plain words for what a figure is."""
    k = e.get("kind", "official")
    if k == "think tank":
        return "think tank" + (", related policy" if e["match"] == "related" else "")
    if k == "party":
        return "party costing, related policy"
    if e["match"] == "related":
        return "related policy"
    if e["match"] == "basis":
        return "after behaviour"
    return {"upper": "up to", "lower": "at least", "approximate": "about"}.get(e.get("bound"), "")


def vs_ext(old, new, ext):
    if ext is None:
        return None
    a, b = abs(old - ext), abs(new - ext)
    if abs(a - b) < 0.005:
        return "same"
    return "closer" if b < a else "further"


def ext_gaps(rows, k=5):
    """Largest gaps between the rerun and a scored external figure: one cell
    per measure (its largest gap), top k by size."""
    best = {}
    for r in rows:
        if r["ext"] is None or r["invalid"] or r["limit"] or zero_cell(r):
            continue
        gap = r["new"] - r["ext"]
        if r["id"] not in best or abs(gap) > abs(best[r["id"]]["gap"]):
            best[r["id"]] = {
                "label": r["name"], "drill": r["drill"], "id": r["id"], "fy": r["fy"], "icon": r["icon"],
                "ours": r["new"], "drill_day": r["old"], "official": r["ext"],
                "gap": gap, "gap_drill_day": r["old"] - r["ext"],
                "ratio": abs(r["new"]) / abs(r["ext"]),
                "match": EXTERNAL[r["id"]]["match"],
                "source": EXTERNAL[r["id"]]["source"], "url": EXTERNAL[r["id"]]["url"],
                "short": EXTERNAL[r["id"]].get("short", EXTERNAL[r["id"]]["source"]),
                "calc": EXTERNAL[r["id"]]["calc"],
            }
    return sorted(best.values(), key=lambda x: -abs(x["gap"]))[:k]


def write_csv_columns(path, comp, rows):
    """Add the external benchmark columns to comparison.csv (idempotent)."""
    by = {(r["drill"], r["id"], r["year"]): r for r in rows}
    cols = ["external_bn", "external_match", "external_source", "external_url", "vs_external"]
    fields = [c for c in comp[0].keys() if c not in cols] + cols
    for c in comp:
        r = by[(c["drill"], c["measure_id"], int(c["year"]))]
        es = entries(r["id"])
        if r["xs"]:
            e, v = es[r["xs"][0][0]], r["xs"][0][1]
        else:
            e, v = es[0], None
        c["external_bn"] = "" if v is None else f"{v:g}"
        c["external_match"] = (e["match"] + (f" ({e['bound']})" if "bound" in e else "")
                               + ("" if e.get("kind", "official") == "official" else f"; {e['kind']}"))
        c["external_source"] = e.get("source", "")
        c["external_url"] = e.get("url", "")
        c["vs_external"] = ("invalid" if r["invalid"] else "model_limitation" if r["limit"] and r["ext"] is not None
                            else {"same": "unchanged"}.get(r["vs"], r["vs"] or ""))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(comp)


def zero_cell(x):
    return abs(x["old"] or 0) < 0.005 and abs(x["new"] or 0) < 0.005


def gh_anchor(heading: str) -> str:
    """GitHub's heading anchor: lower case, drop punctuation, spaces to -."""
    return re.sub(r"[^\w\- ]", "", heading.strip().lower()).replace(" ", "-")


def note_sections(mod) -> dict:
    """(drill, measure id) -> the measure's section in its mock costing note.

    Each drill's scoring sheet numbers its measures as the costing note does
    ("## 5. Employer ..."), so the sheet's measure number finds the heading.
    """
    out = {}
    for cfg in mod.DRILLS.values():
        d = cfg["drill"]
        if cfg["sheet"] is None or d not in mod.COSTING_NOTES:
            continue
        sha, path = mod.COSTING_NOTES[d]
        lines = git("show", f"{sha}:{path}").splitlines()
        for num, rid in cfg["sheet"]["map"].items():
            for i, line in enumerate(lines):
                if line.startswith(f"## {num}. "):
                    title = line[3:]
                    out[(str(d), rid)] = {
                        "url": f"{GH}/blob/{sha}/{path}#{gh_anchor(title)}",
                        "title": title.split(":")[0] if len(title) > 80 else title,
                        "file": path, "line": i + 1,
                    }
                    break
    return out


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
    return mod


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
    mod = load_drills()
    drills = mod.DRILLS
    sheets = {str(c["drill"]): sheet_rows(c) for c in drills.values()}
    notes = note_sections(mod)

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
        # Like-for-like benchmark: the costing-note figure that matches our
        # basis where the audit found one, else the headline static.
        key = (int(d), mid, y)
        sub = mod.LIKE_FOR_LIKE.get(key)
        lfl = num(r["official_like_for_like_bn"])
        lfl_src = None
        if sub:
            sha, path = mod.COSTING_NOTES[int(d)]
            lfl_src = {"url": f"{GH}/blob/{sha}/{path}?plain=1#L{sub[1]}",
                       "file": path, "line": sub[1], "why": sub[3]}
        limit = mod.MODEL_LIMITATION.get(mid) if sh else None
        v = r["vs_official_static"] or None
        vs = {"unchanged": "same"}.get(v, v) if v in ("closer", "further", "unchanged") else None
        note, links = (None, []) if invalid else cause(d, mid, y)
        es = entries(mid)
        cands = sorted(((rank(e), i, e["values"][y]) for i, e in enumerate(es) if y in e.get("values", {})))
        ext = next((v for rk, i, v in cands if rk == 0), None)
        xs = [[i, v] for rk, i, v in cands]
        xvs = None if (invalid or limit) else vs_ext(old, new, ext)
        name = NAMES.get(mid, r["measure_name"].removeprefix("MOCK: ").replace(" (MOCK)", ""))
        rows.append({
            "drill": d, "id": mid, "name": name[0].upper() + name[1:],
            "desc": DESCRIPTIONS.get(mid, ""), "icon": ICONS.get(mid, "percent"), "year": y,
            "fy": f"{y}-{(y + 1) % 100:02d}",
            "old": old, "new": new, "diff": num(r["revenue_bn_diff"]),
            "pct": num(r["revenue_pct_diff"]), "size_pct": num(r["magnitude_pct_diff"]),
            "static": static, "post": post, "team": team,
            "sheet": None if not sh else {"url": sh["url"], "file": sh["file"], "line": sh["line"]},
            "note_sec": notes.get((d, mid)) if sh else None,
            "lfl": lfl, "lfl_src": lfl_src, "limit": limit, "mock_vs": vs, "invalid": invalid,
            "ext": ext, "xs": xs, "vs": xvs,
            "note": note, "links": links,
            "d": {k: [num(r[f"{k}_drill_day"]), num(r[f"{k}_rerun"])]
                  for k in ("d1_avg_change", "d5_avg_change", "d10_avg_change", "people_affected_pct")},
        })

    groups = []
    for d in sorted({r["drill"] for r in rows}):
        g = [r for r in rows if r["drill"] == d]
        mat = [r for r in g if abs(r["old"]) >= 0.01 and not r["invalid"]]
        sizes = [abs(r["size_pct"]) for r in mat]
        has_ext = any(r["ext"] is not None for r in g)
        m = DRILL_META[d]
        groups.append({
            "drill": d, **m,
            "pr_url": f"{GH}/pull/{m['pr']}", "issue_url": f"{GH}/issues/{m['issue']}",
            "median": statistics.median(sizes), "max": max(sizes), "n": len(mat),
            "closer": sum(r["vs"] == "closer" for r in g) if has_ext else None,
            "further": sum(r["vs"] == "further" for r in g) if has_ext else None,
            "mock_closer": sum(r["mock_vs"] == "closer" for r in g),
            "mock_further": sum(r["mock_vs"] == "further" for r in g),
            "limited": sorted({r["name"] for r in g if r["limit"]}),
        })

    out = base / "dashboard"
    out.mkdir(exist_ok=True)
    ext_meta = {mid: [{**{k: v for k, v in e.items() if k != "values"}, "kind": e.get("kind", "official"),
                       "word": word(e), "scored": is_scored(e),
                       "label": MATCH_LABEL[e["match"]] + (f" ({e['bound']}{' bound' if e['bound'] != 'approximate' else ''})" if "bound" in e else "")}
                      for e in entries(mid)]
                for mid in EXTERNAL}
    # The drills' invented costings stay in comparison.csv only.
    for r in rows:
        for k in ("lfl", "lfl_src", "static", "post", "team", "sheet", "note_sec", "mock_vs"):
            r.pop(k, None)
    for g in groups:
        g.pop("mock_closer", None)
        g.pop("mock_further", None)
    (out / "data.json").write_text(json.dumps(
        {"drills": groups, "rows": rows, "gaps": ext_gaps(rows), "ext": ext_meta}, ensure_ascii=False))
    write_csv_columns(base / "comparison.csv", comp, rows)
    print(f"wrote {out / 'data.json'}: {len(rows)} rows")
    for g in groups:
        print(g["drill"], round(g["median"], 3), round(g["max"], 3), g["n"], g["closer"], g["further"], g["limited"])


if __name__ == "__main__":
    main()
