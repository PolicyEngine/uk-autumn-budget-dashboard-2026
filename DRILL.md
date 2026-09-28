# Drill 1: mock Autumn Budget 2026

MOCK DATA. Rehearsal only; nothing here is a real Budget.

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| Setup only (preview, MOCK banner, noindex); no measures coded | 10:06 | `2ed90bd` (PR #3) |
| **Drill start**: statement released; Vahid said start | 12:32 | `9c6ac12` (= `2ed90bd` + setup commits + María's 12:22 household-API fix; PR #3 still unmerged) |
| Measure list locked | 12:32 | this commit |
| Budget documents, OBR forecast and specimen households released | 13:40 | |
| First numbers | _to fill_ | _to fill_ |
| Full page on preview | _to fill_ | _to fill_ |
| Stop for Nuffield call | 14:55 | |

## Preview

Drill-only Vercel project `uk-autumn-budget-2026-drill` (team `policy-engine`), protected by team login. `NEXT_PUBLIC_MOCK=1` is set for every environment of that project: MOCK banner plus `noindex, nofollow` as a meta tag and an `X-Robots-Tag` header. Never deployed to the dashboard's public URL.

With `NEXT_PUBLIC_MOCK=1`, the preview serves the dashboard at `/`, so the PR's Preview link should open after team sign-in. The normal multizone build still uses `/uk/autumn-budget-2026` unless `NEXT_PUBLIC_BASE_PATH` is explicitly set.

The Personal impact tab uses the PolicyEngine UK household API through the dashboard's server-side route. It requires the API's current model to match the dashboard's pinned PolicyEngine UK 2.90.2 and needs no `BUDGET_API_URL` in the drill project. `BUDGET_API_URL` remains an optional override for the dedicated Python backend. If the public API is unavailable or its model version changes, calculations return a visible error instead of unreviewed estimates.

## Measure list

Locked from the statement. Five measures, and only these, go on the drill page; PR #3's seven candidates are not in this Budget and come off it.

Coded in the dashboard (Table 4.1 measures 1 to 5):

| # | Measure | Start | Scored year |
|---|---|---|---|
| 1 | Fuel duty: cancel the 1 March 2027 2p rise and the April 2027 RPI rise; main rates held at 55.95p to 31 March 2028, then RPI | 1 Mar 2027 | 2027-28 |
| 2 | VAT: zero rate on domestic electricity and gas in Great Britain, then 5% again | 1 Apr 2027 to 31 Mar 2028 | 2027-28 |
| 3 | Child Benefit: £30.00 a week eldest or only child, £20.00 each additional child, CPI after | Apr 2027 | 2027-28 |
| 4 | National Insurance: Primary Threshold and Lower Profits Limit £12,570 → £13,000, held to April 2031 | 6 Apr 2027 | 2027-28 |
| 5 | High Value Council Tax Surcharge: threshold £2m → £1.5m, England only; £2,500 band covers £1.5m–£2.5m | 1 Apr 2028 | 2028-29 |

Ledger rows only (María's coverage ledger), not coded:

- 6 Pensions: Lump Sum Allowance £268,275 → £100,000 from 6 April 2028
- 7 Bank Corporation Tax Surcharge 3% → 6% from 1 April 2027
