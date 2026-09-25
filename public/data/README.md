# Dashboard data status

The seven featured reforms have **provisional national estimates** for 2026–2030 generated against the current reform code. These are suitable for a local dashboard preview, but **not certified or publishable policy estimates**. The enhanced FRS file used for the rerun has not been matched to its claimed private release, and aligned constituency weights were unavailable.

## Current rows and source

- Seven featured reform IDs were rerun for every year from 2026 through 2030 in the seven national CSVs: `budgetary_impact`, `distributional_impact`, `winners_losers`, `metrics`, `household_scatter`, `income_curve`, and `obr_comparison`. This includes the three candidates and four carried-over tax measures. The generated rows reflect the current bus geography/timing and fuel baseline/rate code.
- The five 2025 historical shared-link measures and their combined scenario remain from earlier PR commit `17771bc`. Their original dataset revision and source hash have not been verified. They are kept as prior checked-in estimates for historical links, not as part of the new rerun.
- The rerun used `/Users/mariajuaristi/Documents/Codex/2026-09-15/is-x20/work/input/enhanced_frs_2024_25.h5`, SHA-256 `ef34c1ae28219367981fbc3c1144f58ea1f8a77554165fe02ff395b04c5ffea5`, with policyengine.py 6.0.0 and policyengine-uk 2.90.2 from the locked environment. This file is a prior-workspace copy; its hash has **not** been independently matched to the claimed private release/revision. A nearby metadata claim of private revision `25af520a` / version `1.57.3` is a lead, not verification.
- `constituency.csv` and `demographic_constituency.csv` contain the six historical IDs and four carried-over IDs from the earlier PR commit. The three candidates have no rows. The carried-over local rows were **not regenerated with the national rerun** and their weights/provenance are unverified, so the dashboard shows an unavailable message for all seven featured maps. No matching `parliamentary_constituency_weights.h5` was available.
- `obr_comparison.csv` has blank official OBR fields for all seven featured measures. The available OBR figures are fiscal-year receipt forecasts, while these modeled outputs mix tax-year liability and calendar-year transport effects. Blank means no like-for-like comparison has been established; it does not mean zero. Historical 2025 rows retain their earlier figures from the November 2025 forecast.

The income curves use an illustrative household with two adults, three children, £10,000 pension contributions, £10,000 gains before behavioural response, £1,200 petrol spending and £800 bus/coach spending a year. Four carried-over income-tax measures can have a zero illustrative effect when that household lacks the corresponding income source. `household_scatter.csv` samples households and must not be summed as a population total.

## Local reproduction and checks

The seven-policy rerun was made in a separate staging directory, then its featured rows were merged into the working-tree CSVs while preserving the six historical IDs:

```bash
uv sync --extra dev --frozen
uv run uk-budget-data generate \
  --output-dir /Users/mariajuaristi/Documents/Codex/2026-09-25/rev/work/pr3-recovery/preview-v2 \
  --dataset /Users/mariajuaristi/Documents/Codex/2026-09-15/is-x20/work/input/enhanced_frs_2024_25.h5 \
  --reforms cgt_equalisation fuel_duty_rise_cancellation bus_fare_cap threshold_freeze_extension dividend_tax_increase_2pp savings_tax_increase_2pp property_tax_increase_2pp \
  --years 2026 2027 2028 2029 2030 --skip-input-check
uv run python scripts/validate_published_data.py public/data
uv run python scripts/validate_published_data.py public/data --require-constituency
```

The national validator passes: seven featured policies, five years, seven files, complete unique chart keys, finite numeric fields, consistent sampled household IDs, matching PolicyEngine and comparison-table values, and zero 2026 bus/fuel effects. The staged rows were merged into these national CSVs after validation, preserving all six historical IDs and their previous values. The constituency validator fails with 30 missing candidate policy-year file coverages, 30 matching map-code errors, and 5,130 cross-file average-gain mismatches in the existing carried-over local rows. The `--skip-input-check` flag was required for this unverified local source and must not be used as evidence of certification.

Current working-tree national CSV SHA-256 values after the merge:

| File | SHA-256 |
|---|---|
| `budgetary_impact.csv` | `0d9ea8d0cd65f331f6bc3927c9805cdf009cc11e1623f7ee034cc59579e78572` |
| `distributional_impact.csv` | `c353a7536fbfcf36c9b519f304c6c74511bfd66ff22d4d1224c7d732dec28cd7` |
| `winners_losers.csv` | `dfc5bb9964372a4a902024a67c7b3a6355e499142ab7374b76780459c8d0c6b6` |
| `metrics.csv` | `c4869bd05d529d5ea76723bb71e410668337ee618a39bb08ee297f55e4a76669` |
| `household_scatter.csv` | `61883fc45158c325dcb386d25db660d81c5b28f1863c045db22a12c107092d64` |
| `income_curve.csv` | `43af81f8d1be4bce0f8dbd38b570b73c6a6a524c86172060ff3f8ca062562357` |
| `obr_comparison.csv` | `27c781f2d3d38d7ed5164f935aa94d19570104f6315fad81e300036049d64c24` |

## CGT behavioural sensitivity (provisional 2027 check)

The pinned UK model applies a **retention-rate** elasticity to each person's realised gains: `reformed gains / gains before response = exp(ε × [ln(max(1 − reform MTR, 0.001)) − ln(max(1 − baseline MTR, 0.001))])`. The central scenario uses ε = 1.0; [CenTax's 2024 report](https://centax.org.uk/wp-content/uploads/2024/10/AdvaniLonsdaleSummers2024_CGTReform.pdf) discusses that retention-rate convention. Using the same unverified local H5 and pinned model, with only ε varied, gives:

| Retention elasticity | 2027 government-balance impact (£bn) | Realised gains (£bn) |
|---:|---:|---:|
| 0 (static reference) | +11.088 | 46.122 |
| 0.5 | +7.409 | 37.853 |
| **1.0 (featured central row)** | **+4.278** | **30.794** |
| 2.0 | −0.654 | 19.616 |

The central +£4.278bn exactly matches the checked-in 2027 CGT row. These results show that the simplified scenario's fiscal sign changes within the tested range; the central estimate is not a revenue floor. The source H5 is not certified, the model combines gain classes, and the calculation omits the wider tax-base changes and short-run timing responses in the CenTax package. These are sensitivity outputs, not official or publishable fiscal estimates.

The separate [PolicyEngine MTR convention](https://www.policyengine.org/uk/research/behavioural-responses) uses an elasticity of −0.7 with respect to the **marginal tax rate**, not the retention rate. For illustration only, a 24%→45% marginal-rate change gives realised-gain factors of 0.851, 0.724 and 0.524 under retention ε = 0.5, 1.0 and 2.0; the simple MTR power rule `(0.45 / 0.24)^−0.7` gives 0.644. Each household has its own measured MTR, so that illustration cannot be substituted for an aggregate MTR −0.7 costing in this pinned model.

Reproduce the population check without modifying published CSVs:

```bash
UV_CACHE_DIR=/tmp/uv-cache-pr3 uv run --no-sync python /Users/mariajuaristi/Documents/Codex/2026-09-25/rev/work/pr3-recovery/cgt-sensitivity-2027.py \
  --dataset /Users/mariajuaristi/Documents/Codex/2026-09-15/is-x20/work/input/enhanced_frs_2024_25.h5 \
  --output /Users/mariajuaristi/Documents/Codex/2026-09-25/rev/work/pr3-recovery/cgt-sensitivity-2027.json
```

## Merge gate

1. Obtain the certified enhanced FRS release and constituency weights from the **same release and household ordering**. Record release IDs, SHA-256 hashes, model/lock versions and retrieval date.
2. Rerun all seven featured reforms for 2026–2030 into a staging directory using the certified source. Inspect magnitudes, household charts, and fuel clearances/baseline assumptions. Compare any available official OBR costing only on a like-for-like basis.
3. Regenerate constituency rows for all seven featured reforms with the matched weights, then require `scripts/validate_published_data.py public/data --require-constituency` to pass before enabling featured maps or merging published estimates. Coverage alone does not verify dataset provenance or cross-file consistency.

Each reform is estimated separately. The dashboard sums selected effects and does not model interactions between them. Annual income-tax model year 2027 represents the tax year starting April 2027; fuel and bus outputs use calendar 2027, so summed policy values mix periods. The 2027 fuel baseline applies 55.95p/L in January–February and 57.95p/L in March–December against 52.95p/L in every reform month; the March rate is held from 2028 as an illustrative later-year assumption. The bus cap uses household region and a 12.5% reduction in all bus/coach spending as proxies for eligible services. Its matching imputed subsidy is treated as a service benefit in household resources, not cash income. The CGT result uses one undifferentiated gains input and is a simplified scenario, not a full-schedule costing.
