# Drill 1: mock Autumn Budget 2026

MOCK DATA. Rehearsal only; nothing here is a real Budget.

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| Setup only (preview, MOCK banner, noindex); no measures coded | 10:06 | `2ed90bd` (PR #3) |
| **Drill start**: statement released | 12:30 | _to fill_ |
| Measure list locked | _to fill_ | |
| Budget documents, OBR forecast and specimen households released | 13:40 | |
| First numbers | _to fill_ | _to fill_ |
| Full page on preview | _to fill_ | _to fill_ |
| Stop for Nuffield call | 14:55 | |

## Preview

Drill-only Vercel project `uk-autumn-budget-2026-drill` (team `policy-engine`), protected by team login. `NEXT_PUBLIC_MOCK=1` is set for every environment of that project: MOCK banner plus `noindex, nofollow` as a meta tag and an `X-Robots-Tag` header. Never deployed to the dashboard's public URL.

With `NEXT_PUBLIC_MOCK=1`, the preview serves the dashboard at `/`, so the PR's Preview link should open after team sign-in. The normal multizone build still uses `/uk/autumn-budget-2026` unless `NEXT_PUBLIC_BASE_PATH` is explicitly set.

The Personal impact tab uses the PolicyEngine UK household API through the dashboard's server-side route. It requires the API's current model to match the dashboard's pinned PolicyEngine UK 2.90.2 and needs no `BUDGET_API_URL` in the drill project. `BUDGET_API_URL` remains an optional override for the dedicated Python backend. If the public API is unavailable or its model version changes, calculations return a visible error instead of unreviewed estimates.

## Measure list

Locked from the statement at 12:30.
