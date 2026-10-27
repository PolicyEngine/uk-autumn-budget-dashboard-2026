# OBR effect of the Budget's measures on CPI inflation (Budget day)

The card "Effect of the Budget's measures on CPI inflation (OBR)" on Pre-measures forecast → Forecast changes shows the OBR's own estimate of how the Budget's measures change CPI inflation, year by year. It is the OBR's figure, not PolicyEngine's. The card reads `public/data/obr_cpi_policy_effect.json` and is not drawn until that file is published (a 404 is the normal state before the Budget). Code: `src/utils/livingStandards/obrCpiEffect.js` (checks and the sentence) and `src/components/livingStandards/ObrCpiEffectCard.jsx`.

## Where the numbers are

In the EFO published with the Budget, chapter 3 ("Policy measures"), find the chart of the effect of Budget policies on CPI inflation. In November 2025 it was **Chart 3.4: Impact of Budget policies on CPI inflation**, printed page 64, with the text in paragraph 3.17. Take the values from the chapter 3 "charts and tables" workbook on the EFO's page (sheet `C3.4` in November 2025), not from reading the chart. The workbook gives one column per measure plus `Output gap` (the package's indirect effect) and `Total`, by **fiscal year**.

## The file

```json
{
  "schema": "uk-budget-obr-cpi-policy-effect/v1",
  "budget": "Autumn Budget 2026",
  "budget_date": "2026-10-28",
  "efo": "Economic and fiscal outlook, October 2026",
  "efo_url": "https://obr.uk/efo/...",
  "source_table": "Chart 3.x: Impact of Budget policies on CPI inflation",
  "source_file": "chapter 3 charts and tables workbook, sheet C3.x",
  "page": 64,
  "basis": "fiscal_years",
  "years": [{ "year": "2026-27", "pp": -0.43 }],
  "by_measure": [
    { "measure": "Energy bills package", "years": [{ "year": "2026-27", "pp": -0.25 }] },
    { "measure": "Output gap", "indirect": true, "years": [{ "year": "2026-27", "pp": 0.02 }] }
  ],
  "notes": ["Optional caveats from the EFO, one sentence each, for About this chart."]
}
```

- `budget` must be exactly `Autumn Budget 2026` (`CURRENT_BUDGET`); any other Budget is refused unless the file says `"previous_budget": true`, and then the title names that Budget and EFO.
- `basis` is `fiscal_years` (years `2026-27`) or `calendar_years` (years `2026`).
- `pp` is percentage points, unrounded as in the workbook; the page rounds to 0.1.
- `by_measure` is optional. Each measure needs the same years as `years`, and in each year the measures must add up to the total to within 0.01 points, or the card is not drawn. Mark the output gap (or any other indirect effect) `"indirect": true`.
- `page` is the printed page number.

## Publishing it

1. Write the file, then check the card on a local preview (`?tab=outlook&sub=forecast`): the sentence under the title is built from the rounded figures and should match the EFO's paragraph.
2. Add its review row to `data_inputs/public_data_review.csv` (SHA-256, reviewer, date, basis). Without it `scripts/check-public-files.mjs` fails the build and `scripts/check_public_data.py` fails CI.
3. Commit the file and the review row in a PR.

Never commit last year's file (`previous_budget: true`): it is for local previews only.
