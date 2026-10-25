# Data contract: `public/data/living_standards_outlook.json`

Written by `uk-budget-data living-standards` (`src/uk_budget_data/living_standards/`), read by the Living standards tab (`src/components/livingStandards/`). Ported on 24 October 2026 from PolicyEngine/uk-living-standards-outlook (`public/data/outlook.json`, `pipeline/build_outlook.py`), which is no longer this file's source.
Years are UK fiscal years as strings, e.g. `"2024-25"`. Rates are fractions (0.132). Equivalised income (HBAI basis) is in £ a year, adjusted for household size (shown for a couple with no children), unless a field says otherwise.

Projection years: the income (`living_standards`), poverty (`poverty`) and inequality (`inequality`) projections start at the model's own 2024-25 point, the latest HBAI outturn year, so the level gap to HBAI shows within 2024-25 rather than as a one-year change; they carry 2025-26 too. Every other projection (`income_by_decile`, `child_poverty_by_family`, `deep_poverty`, `poverty_by_group`) starts in 2027-28, the base year. Headline changes run from `meta.headline_start_year` (2027-28) to `meta.headline_end_year` (2031-32), and every model series stops at 2031-32, the dashboard's period. Real values are in 2027-28 prices (`meta.real_price_base`).

```json
{
  "meta": {
    "generated_at": "ISO timestamp",
    "policyengine": "6.10.2",
    "policyengine_uk": "x.y.z (the version policyengine pins)",
    "dataset": {"name": "microcosm_uk_2024_25", "tag": "HF revision tag", "sha256": "..."},
    "real_price_base": "2027-28",
    "headline_start_year": "2027-28",
    "deflator": "name of the index used for real terms",
    "outturn_source": "HBAI release name + URL",
    "headline_end_year": "2031-32",
    "headline_end_year_note": "one sentence: 2031-32 is past the OBR March 2026 forecast and uses policyengine-uk's long-run assumptions",
    "uc_health_element_extension": {"applied": true, "years": [2030, 2031], "upstream_fix": "PolicyEngine/policyengine-uk#2428", "upstream_fix_url": "...", "fixed_in": "2.134.4", "new_claimant_share": 0.22, "amounts": {"2030": {"protected_monthly": 466.29, "new_claimant_monthly": 221.6, "index_growth": 1.02}}},
    "cpi_ahc_note": "CPI after housing costs is a PolicyEngine derivation; effect of policyengine-uk#2531 on real AHC growth from the headline start year (does not restate the growth itself)",
    "units": {"median_equivalised_income": "£ a year, adjusted for household size (shown for a couple with no children)"},
    "method": {"<series key>": "how it is computed (variables, weights, parameters)"},
    "comparators": {"income_by_decile": "RF LSO 2026 ...", "child_poverty": "...", "deep_poverty": "..."},
    "validation_2024_25": {"median_equivalised_income_weekly": {"bhc": {"model": 762, "hbai": 719}}, "relative_ahc": {}, "gini": {}, "p90_p10": {}, "universal_credit_bn": {"model": 74.2}},
    "notes": ["at most ~8 notes, one plain sentence each, <= 160 characters"],
    "caveats": ["projection caveats and baseline gaps, one sentence each, <= 160 characters; shown as their own list on the page"]
  },
  "living_standards": {
    "metrics": {"mean_equivalised_income": "Mean equivalised income (BHC)", "median_equivalised_income": "Median equivalised income (BHC)",
                "mean_equivalised_income_ahc": "Mean equivalised income (AHC)", "median_equivalised_income_ahc": "Median equivalised income (AHC)"},
    "outturn":    {"median_equivalised_income": [{"year": "2021-22", "nominal": 0, "real": 0}], "median_equivalised_income_ahc": [{"year": "2021-22", "nominal": null, "real": 0}]},
    "projection": {"median_equivalised_income": [{"year": "2024-25", "nominal": 0, "real": 0}]}
  },
  "poverty": {
    "measures": {"absolute_bhc": "Absolute (BHC)", "absolute_ahc": "Absolute (AHC)", "relative_bhc": "Relative (BHC)", "relative_ahc": "Relative (AHC)"},
    "groups": {"all": "All people", "children": "Children", "working_age": "Working-age adults", "pensioners": "Pensioners"},
    "outturn":    {"absolute_bhc": {"all": [{"year": "2021-22", "rate": 0.15}]}},
    "projection": {"absolute_bhc": {"all": [{"year": "2024-25", "rate": 0.12}]}},
    "notes": ["the absolute poverty line and the level gap to HBAI"]
  },
  "forecast": {
    "pre_label": "OBR March 2026 (pre-Budget)",
    "post_label": "Budget forecast",
    "post_published": false,
    "headline": ["cpi", "rpi", "earnings"],
    "sections": [
      {"title": "Inflation and price indices", "series": [
        {"key": "cpi", "label": "CPI inflation",
         "pre": [{"year": "2027", "value": 0.02}], "post": [{"year": "2027", "value": 0.02}]}
      ]}
    ]
  }
}
```

Until the Budget forecast is published, `post` equals `pre` and `post_published` is `false`; the UI must say so visibly.

Both deflators (OBR CPI for BHC, CPI after housing costs for AHC) are rebased to 2027-28 = 1 (changed on 24 October 2026 from 2025-26 to 2026-27, and later that day to 2027-28).

`living_standards` changed on 20 October 2026: the unequivalised `mean_income` and `median_income` were removed (peers report equivalised HBAI income) and the AHC pair added. BHC series are deflated with OBR CPI, AHC series with CPI after housing costs (see `meta.deflator`). AHC outturn is real only (`nominal` is `null`): pe-uk's CPI-AHC index is flat before 2022, so cash values recovered with it are too high in 2021-22. Population groups in `poverty` now follow HBAI (`hbai_person_type`).

## Added sections (20 October 2026)

All are top-level keys. Years are fiscal, `"2027-28"` to `"2031-32"` (inequality projection from `"2024-25"`). Real values are in 2027-28 prices. Each section carries its own `notes` (section-specific caveats, one sentence each; may be empty).

### `income_by_decile`
Real growth in equivalised income by person-weighted income decile, and by quintile (re-ranked each year; growth compares positions, not people). Quintiles carry their own medians, not two deciles' averaged.
```json
{
  "base_year": "2027-28", "end_year": "2031-32", "statistic": "...", "deciles": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "quintiles": [1, 2, 3, 4, 5],
  "bases": {"bhc": "...", "ahc": "..."},
  "bhc": {"cumulative_growth_to_end": [10 fractions],
          "by_year": [{"year": "2027-28", "real_median": [10 x £], "cumulative_growth": [10 fractions vs 2027-28]}],
          "quintile_by_year": [{"year": "2027-28", "real_median": [5 x £], "cumulative_growth": [5 fractions vs 2027-28]}]},
  "ahc": {"...same shape..."},
  "non_pensioner_split": {"basis": "ahc", "statistic": "...", "groups": {"below_middle": "...", "above_middle": "..."},
                          "series": {"below_middle": [{"year": "2027-28", "real_mean": 0, "cumulative_growth": 0.0}], "above_middle": []}},
  "comparator": "Resolution Foundation, Living Standards Outlook 2026", "notes": []
}
```

### `child_poverty_by_family`
Child poverty (relative and absolute AHC) by number of HBAI dependent children in the benefit unit and lone parent vs couple.
```json
{
  "measures": {"relative_ahc": "Relative (AHC)", "absolute_ahc": "Absolute (AHC)"},
  "groups": {"all": "...", "one_child": "...", "two_children": "...", "three_plus_children": "...", "lone_parent": "...", "couple": "..."},
  "projection": {"relative_ahc": {"one_child": [{"year": "2027-28", "rate": 0.18}]}, "absolute_ahc": {}},
  "children_millions": {"all": [{"year": "2027-28", "value": 14.46}]},
  "unweighted_children": {"all": 38901},
  "notes": []
}
```
`two_child_limit_kept`, its notes and `sources` were removed on 24 October 2026 (the page no longer shows the two-child limit card), and so was the second simulation that produced them.

### `inequality`
```json
{
  "measures": {"gini": "Gini coefficient", "p90_p10": "90:10 ratio"}, "bases": {"bhc": "...", "ahc": "..."},
  "outturn":    {"gini": {"bhc": [{"year": "2021-22", "value": 0.332}], "ahc": []}, "p90_p10": {"bhc": [], "ahc": []}},
  "projection": {"gini": {"bhc": [{"year": "2024-25", "value": 0.302}], "ahc": []}, "p90_p10": {"bhc": [], "ahc": []}},
  "notes": []
}
```
Gini is a fraction (0.33, not 33). Outturn is HBAI Table 1.2b, 2021-22 to 2024-25.

### `deep_poverty`
JRF-style very deep poverty: people below 40% (and 50%) of the model's own median equivalised AHC income. Not `in_deep_poverty_ahc`.
```json
{
  "measures": {"below_40pc_median_ahc": "Very deep poverty: below 40% of median income (AHC, JRF-style)", "below_50pc_median_ahc": "Below 50% of median income (AHC)"},
  "projection": {"below_40pc_median_ahc": [{"year": "2027-28", "rate": 0.077, "people_millions": 5.3, "threshold_annual": 14294}], "below_50pc_median_ahc": []},
  "notes": []
}
```

### `poverty_by_group`
Relative AHC poverty and median equivalised BHC income by tenure, family type and region, for 2027-28 and 2031-32 (`years[0]` is the base year). The disability breakdown was removed on 21 October 2026: it recorded disability-benefit receipt, not HBAI's self-reported definition. Region stays in the file but is not shown on the page: it is not validated against official regional figures.
```json
{
  "years": ["2027-28", "2031-32"],
  "measures": {"relative_ahc": "...", "median_equivalised_income_bhc": "..."},
  "min_unweighted_households": 100,
  "breakdowns": {
    "tenure": {"label": "Tenure", "groups": {"owned_outright": "Owned outright"},
               "cells": {"owned_outright": {"2027-28": {"relative_ahc": 0.089, "median_equivalised_income_bhc": {"nominal": 0, "real": 0},
                                                          "people_millions": 0.0, "unweighted_households": 37727, "suppressed": false}}}},
    "family_type": {}, "region": {}
  },
  "notes": []
}
```
A cell with fewer than `min_unweighted_households` unweighted households has `suppressed: true` and `null` values (counts are kept).

### `obr_rhdi`
OBR real household disposable income per person (national accounts), fiscal years. Not comparable in level with the survey-based series.
```json
{
  "label": "OBR real household disposable income per person", "unit": "£ per person per year, 2023 prices (national accounts)",
  "basis": "Fiscal year", "source": "OBR EFO March 2026 economy tables, Table 1.5 ...", "definition": "NRJR / EBAQ", "url": "...", "file_sha256": "...",
  "series": [{"year": "2021-22", "value": 26124, "index_2008q1_100": 111.8, "growth": null, "type": "outturn", "source_row": 137}],
  "notes": []
}
```
`growth` is year-on-year (fraction); `type` is `"outturn"` up to 2024-25 and `"forecast"` after; `source_row` is the Excel row in Table 1.5.

### `meta.headline_start_year` and `meta.real_price_base` (24 October 2026, revised the same day)
`"2027-28"`, the first year of the dashboard's 2027-28 to 2031-32 period. Headline comparisons, `income_by_decile.base_year`, `cumulative_growth` (0 in 2027-28) and `poverty_by_group.years[0]` start here, and real values are in 2027-28 prices. Before 24 October 2026 both were `"2025-26"`, then briefly `"2026-27"`.

### `meta.headline_end_year` (20 October 2026, revised 21 and 24 October)
`"2031-32"`, the end of the dashboard's period. Every model series stops here, and headline comparisons (cumulative growth, start-to-end changes, group snapshots) end here; `income_by_decile.<basis>.cumulative_growth_to_end` runs to 2031-32. Until 24 October the series stopped at 2029-30 because of a model step in 2030-31 (see the UC health element patch below).

Calendar 2031, which fiscal 2031-32 uses, is past the OBR March 2026 forecast (calendar 2025 to 2030). policyengine-uk fills it with its long-run assumptions (`gov.economic_assumptions.yoy_growth`, "2031-2073: OBR long-run equilibrium assumptions"): CPI 2.0% (Bank of England target), RPI 2.3%, average earnings 3.32% (converging to 3.83%), CPI after housing costs 1.9%; a series with no 2031 value (rents, mortgage interest) grows at its 2030 rate. `meta.headline_end_year_note` says so on the page.

OBR series (`forecast`, `obr_rhdi`) are not model output and keep their own years: `forecast` shows OBR calendar years 2027 to 2030 (2026 was dropped on 24 October with the move to 2027-28; 2031 is not an OBR forecast), and `obr_rhdi` runs to 2030-31, the OBR's last fiscal year.

### UC health element patch: `meta.uc_health_element_extension` (24 October 2026)
policyengine-uk 2.132.6, which the latest bundle (policyengine 6.10.2) pins, sets the UC LCWRA (health) element only for 2026-27 to 2029-30 (`scenarios/uc_reform.py`, `range(2026, 2030)`, with a `post_2025_claimant_share` dict ending at 2029). From 2030-31 every claimant falls to the new-claimant amount, so protected (pre-2026) claimants lose about half their element in one year (pe-uk #2282): UC falls £2.4bn and child poverty (relative AHC) rises 0.9 points in 2030-31. PolicyEngine/policyengine-uk#2428 (merged 16 October 2026, first released in 2.134.4) fixed it. `living_standards/uc_health_element.py` applies the same rule to the baseline for 2030-31 and 2031-32, only when the installed policyengine-uk is below 2.134.4: the same seeded draw, with the new-claimant share held at its 2029-30 value (22%); the protected amount and the new-claimant amount (£217.26 a month in 2029-30) each uprated by the growth of the benefit uprating index (`gov.benefit_uprating_cpi` at 30 April, never below 1), the index #2428 uses in years the freeze does not cover. On the same claimants it gives 2.134.4's amounts to the penny (protected £466.29 and £475.61 a month, new claimant £221.60 and £226.04), and it leaves 2026-27 to 2029-30 unchanged (`tests/test_uc_health_element.py`). `uc_health_element_extension` records what was applied (`{"applied": false}` on a fixed engine), and the build refuses projections run without it on an engine that needs it.

### Provenance (24 October 2026)
`meta.policyengine`, `meta.policyengine_uk` and `meta.dataset` (name, build tag, sha256, Hugging Face repository) come from the installed policyengine.py bundle: the projections run through `pe.uk.managed_microsimulation()` on the bundle's certified dataset, and the command refuses to build if the run's dataset sha256 or engine versions differ from the bundle's. `meta.headline_end_year` is 2031-32 on every engine (`living_standards/engine.py`); below policyengine-uk 2.134.4 the UC health element patch above covers 2030-31 and 2031-32.

### `forecast` sources and the Budget forecast (24 October 2026)
`forecast.pre_source` names where the pre-Budget series come from: `{"release": "OBR Economic and fiscal outlook, March 2026", "url": "...", "via": "policyengine-uk parameters gov.economic_assumptions.yoy_growth.obr.*"}`. `forecast.post_source` is `null` until `uk-budget-data obr-forecast` loads a new EFO; it then holds `{"release", "file", "file_sha256", "url"}`, `post_published` is `true`, `post_label` names the forecast (e.g. `"OBR October 2026 (Autumn Budget)"`), and each series has `post` values from that file and a `post_source` string naming the table and column read (for the two PolicyEngine-derived series, how they were recomputed). Years and keys of `post` always equal those of `pre`. A year the EFO lacks is refused, except mortgage interest in the last year, which keeps its pre-Budget value and says so in `post_source`.
