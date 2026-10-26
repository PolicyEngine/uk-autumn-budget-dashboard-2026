# Living standards inputs

The Pre-measures forecast tab (`?tab=outlook`), and Population impact's growth and poverty cards with the measures, read `public/data/living_standards_outlook.json` (shape in [`docs/DATA_CONTRACT.md`](../../docs/DATA_CONTRACT.md)). `uk-budget-data living-standards` writes it from the files here and a baseline run on the pinned policyengine.py bundle and its certified Microcosm dataset (`src/uk_budget_data/living_standards/`). Until 24 October 2026 the file was copied from PolicyEngine/uk-living-standards-outlook; that repository is no longer its source.

## Source files

Committed unedited. The extracts beside them are what the build reads; each records its source file's SHA-256, and the tests check that re-extracting gives the same bytes.

| File | What | Source | SHA-256 |
|---|---|---|---|
| `summary-hbai-1994-95-2024-25-tables.ods` | DWP, Households Below Average Income: FYE 1995 to FYE 2025 (26 March 2026), summary tables 1.2b, 1.3a to 1.6a | [gov.uk release](https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025), [file](https://assets.publishing.service.gov.uk/media/69c28ffcb920af63be1c7767/summary-hbai-1994-95-2024-25-tables.ods) | `38586ace5e06ca0029f9b5345a6047c54143ee03c644a2c0553d77813ca27a21` |
| `efo-march-2026-detailed-forecast-tables-economy.xlsx` | OBR, Economic and fiscal outlook, March 2026: detailed forecast tables, economy (3 March 2026) | [OBR EFO March 2026](https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/), [file](https://obr.uk/download/march-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/) | `fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510` |

## Extracts

| File | Written by | From |
|---|---|---|
| `hbai_outturn.json` | `uk-budget-data living-standards --hbai-ods <ods>` (`living_standards/hbai.py`) | HBAI poverty rates, equivalised income and inequality, 2021-22 to 2024-25 |
| `obr_rhdi.json` | `uk-budget-data living-standards --rhdi-efo <xlsx>` (`living_standards/obr.py`) | OBR Table 1.5, real household disposable income per person (the `obr_rhdi` block; not shown on the page) |
| `obr_forecast_post.json` (only after the Budget forecast) | `uk-budget-data obr-forecast --efo <xlsx>` (`living_standards/forecast.py`) | The Budget forecast's series for the Forecast changes sub-tab, with the file's name and SHA-256 |

The pre-Budget forecast series are not read from the xlsx: they are policyengine-uk's `gov.economic_assumptions.yoy_growth.obr` parameters, so they match the model's uprating. The xlsx is kept because the tests check the forecast reader against it: parsing it reproduces every pre-Budget OBR series.
