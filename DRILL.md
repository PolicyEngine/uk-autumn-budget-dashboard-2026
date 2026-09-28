# Drill 1: mock Autumn Budget 2026

MOCK DATA. Rehearsal only; nothing here is a real Budget.

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| Setup only (preview, MOCK banner, noindex); no measures coded | 10:06 | `2ed90bd` (PR #3) |
| **Drill start**: statement released; Vahid said start | 12:32 | `9c6ac12` (= `2ed90bd` + setup commits + María's 12:22 household-API fix; PR #3 still unmerged) |
| Measure list locked | 12:32 | this commit |
| Budget documents, OBR forecast and specimen households released; re-basing started | 13:41 | |
| Re-based on Annex A and mock OBR CPI (María) | 13:50 | `3b0eab7` |
| First numbers (statement only; preview pzj070s38) | 13:01 | `34b3db7` |
| Full page on preview (egr12zevb), re-based | 13:59 | `b023f59` |
| Stop for Nuffield call | 14:55 | |

## Preview

Drill-only Vercel project `uk-autumn-budget-2026-drill` (team `policy-engine`), protected by team login. `NEXT_PUBLIC_MOCK=1` is set for every environment of that project: MOCK banner plus `noindex, nofollow` as a meta tag and an `X-Robots-Tag` header. Never deployed to the dashboard's public URL.

With `NEXT_PUBLIC_MOCK=1`, the preview serves the dashboard at `/`, so the PR's Preview link should open after team sign-in. The normal multizone build still uses `/uk/autumn-budget-2026` unless `NEXT_PUBLIC_BASE_PATH` is explicitly set.

The Personal impact tab uses the PolicyEngine UK household API through the dashboard's server-side route. It requires the API's current model to match the dashboard's pinned PolicyEngine UK 2.90.2 and needs no `BUDGET_API_URL` in the drill project. `BUDGET_API_URL` remains an optional override for the dedicated Python backend. If the public API is unavailable or its model version changes, calculations return a visible error instead of unreviewed estimates.

## Measure list

Locked from the statement. Five measures, and only these, go on the drill page; PR #3's seven candidates are not in this Budget and come off it.

Coded in the dashboard (the five measures in the 12:30 statement; numbers 1 to 5 follow the statement order):

| # | Measure | Start | Scored year |
|---|---|---|---|
| 1 | Fuel duty: cancel the 1 March 2027 2p rise and the April 2027 RPI rise; main rates held at 55.95p to 31 March 2028, then RPI | 1 Mar 2027 | 2027-28 |
| 2 | VAT: zero rate on domestic electricity and gas in Great Britain, then 5% again | 1 Apr 2027 to 31 Mar 2028 | 2027-28 |
| 3 | Child Benefit: £30.00 a week eldest or only child, £20.00 each additional child, CPI after | Apr 2027 | 2027-28 |
| 4 | National Insurance: Primary Threshold and Lower Profits Limit £12,570 → £13,000, held to April 2031 | 6 Apr 2027 | 2027-28 |
| 5 | High Value Council Tax Surcharge: threshold £2m → £1.5m, England only; £2,500 band covers £1.5m–£2.5m | 1 Apr 2028 | 2028-29 |

Ledger rows only (María's coverage ledger), not coded (also in the statement):

- 6 Pensions: Lump Sum Allowance £268,275 → £100,000 from 6 April 2028
- 7 Bank Corporation Tax Surcharge 3% → 6% from 1 April 2027

## 13:40 re-basing

María's `3b0eab7` re-bases the five measures on the documents (Vahid's parallel re-basing, `drill1-vahid-backup-1350`, reached the same baselines and is superseded):

- **Annex A baselines:** fuel duty 57.95p from March 2027, then 60.10p, 62.13p, 63.98p, 65.85p (reform 55.95p to March 2028, then 57.84p, 59.57p, 61.31p); Child Benefit £27.80 and £18.40 from April 2027; Primary Threshold and Lower Profits Limit fixed at £12,570 to April 2031.
- **Mock OBR Table 1.7:** September CPI uprates Child Benefit from April 2028, to the nearest 5p. Fuel duty paths come from the costings directly. Revised earnings and the wider engine uprating indices are not loaded.
- **Energy VAT** comes off `vat` only (`vat_change` derives from it; cutting both double-counted), prorated 9/12 to calendar 2027 and 3/12 to 2028. **Fuel duty** also passes the duty cut through to 20% VAT at the pump, so its cost exceeds Table 4.1's duty-only figure.

## Specimen check

`scripts/drill1_specimen_check.py` runs the nine households through the dashboard's reform code. Change in household net income, £ a year, engine years (calendar 2027 for measures 1 to 4, 2028 for measure 5):

| | Fuel | Energy VAT | Child Benefit | NICs | Surcharge (2028) |
|---|---|---|---|---|---|
| H1 | 39.35 | 58.93 | 0 | 34.40 | 0 |
| H2 | 35.41 | 67.86 | 197.60 | 15.48 | 0 |
| H3 | 0 | 53.57 | 0 | 0 | 0 |
| H4 | 51.16 | 82.14 | 98.80 | 34.41 | 0 |
| H5 | 55.09 | 92.86 | 0 | 68.81 | 0 |
| H6 | 43.29 | 60.71 | 0 | 25.80 | 0 |
| H7 | 0 | 50.00 | 114.40 | 0 | 0 |
| H8 | 35.41 | 85.71 | 0 | 0 | −2,500.00 |
| H9 | 43.29 | 103.57 | 0 | 34.41 | 0 |

All follow from hand calculations. Child Benefit is (£2.20 + £1.60) × 52 before the HICBC (H4 50% taper, H9 fully withdrawn). NICs is 8% × £430 (6% for H6), after the 55% UC taper for H2 and nil for H7 below the threshold. Only H8 newly pays the surcharge (H5 Scotland, H9 already liable).

For the fiscal 2027-28 scoring year: energy VAT is the full bill × 5/105 (H1 £78.57; the table shows the 9/12 in calendar 2027), and fuel duty is 4.15p a litre plus 20% VAT all year (1,000 litres: £49.80; calendar 2027 includes January to March at a smaller gap). Specimen homes are April 2026 valuations; the engine deflates `main_residence_value` by per-capita GDP, so the 2028 input must be uprated (×1.0643), or H8 wrongly shows £0.
