# Measure templates and implementation checklist

These patterns contain no drill 2 measures. Do not populate them from the packet before its release. Drill 1 implementations remain in Git history at `965caf0` for reference.

Use `Reform(id=..., name=..., parameter_changes=..., baseline_parameter_changes=...)` for parameter measures. `to_drill_scenario(baseline=True)` and `to_drill_scenario()` compose explicit measure overrides on the latest engine's native baseline, preserving annual-parameter-before-modifier order. Both the population pipeline and Python household calculator use these methods.

| Pattern | Implementation and check |
|---|---|
| Rate change | `parameter_changes={path: {str(year): rate}}`; verify units and compare a household inside each affected band. |
| Threshold change | Set annual parameter values for every affected year; verify the native baseline and change only the stated thresholds through `to_drill_scenario`. Check below, at and above each threshold. |
| Freeze to a date | State the counterfactual uprating and supply all affected years; use ISO dates only for genuinely dated rates. Check the first and last affected periods. |
| Monthly duty path | Supply explicit full-month ranges for baseline and reform, for example `2029-04-01.2029-04-30`; a lone `2029-04-01` changes one day only. Confirm all 12 months, annual litres basis and separate duty/VAT totals. `Reform._build_scenario` preserves dated and annual overrides together before running a modifier. |
| VAT base modifier | In a `simulation_modifier`, calculate the eligible spending and subtract VAT once from `vat`; do not also subtract from `vat_change`. Check government receipts and household resources with the opposite sign. |
| Lump sum by benefit receipt | Calculate the benefit-receipt eligibility on its native entity, project deliberately, and add the payment once to the selected income/benefit channel. Check recipients and non-recipients, including multi-benefit households. |
| Age-conditioned allowance | Use a parameter if supported; otherwise a modifier/structural variable with explicit eligibility dates. Check both sides of the boundary and pension/benefit interactions. |

For every measure, update the registry in `reforms.py`, selector in `policyConfig.js`, locked coverage ledger, appropriate calculator/form input coverage, validator's active policy IDs and numerical tests. The local Python route executes registered drill scenarios; do not add a second JavaScript implementation of drill formulas. The public API adapter remains legacy-only and version-gated.

Never use national totals to validate a household, never sum sampled household-scatter rows as population totals, and never treat an absent comparator as zero. Enter the statement comparison and one hand-checked household before G2, then fiscal-year static/Table 4.1 comparisons before G3. Run numerical validation with the full locked list after generation; the empty-state validator cannot approve publication.
