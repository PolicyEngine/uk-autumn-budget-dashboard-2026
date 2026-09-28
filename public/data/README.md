# Dashboard data status

MOCK DATA: the five 2026 Budget measures and their estimates are invented for drill 1. The seven national CSVs contain **provisional local-preview estimates** rerun after review fixes on 28 September 2026. They are not certified public policy estimates. The source enhanced FRS file has not been matched to its claimed private release, and aligned constituency weights were unavailable.

## Corrected PR #4 rows and source

- The five `mock_*` measures were rerun for 2026–2030 in `budgetary_impact`, `distributional_impact`, `winners_losers`, `metrics`, `household_scatter`, `income_curve`, and `obr_comparison`. Only their rows were replaced; the older candidate, carried-over, and 2025 historical rows were preserved for legacy links. Those older rows were not recalculated against the corrected mock code. The corrected result is the third scoring round; the reviewed PR #4 head is archived separately as round 2.
- The run used the prior-workspace `enhanced_frs_2024_25.h5`, SHA-256 `ef34c1ae28219367981fbc3c1144f58ea1f8a77554165fe02ff395b04c5ffea5`, with policyengine.py 6.0.0 and policyengine-uk 2.90.2 from the locked environment. This hash identifies the exact local file, not an independently verified release. A nearby metadata claim of private revision `25af520a` / version `1.57.3` remains unverified.
- Annex A of the supplied MOCK policy costings fixes the fuel duty baseline and reform rates through 2030, the Child Benefit baseline at £27.80/£18.40 a week, and the NIC baseline at £12,570 through April 2031. Child Benefit uprating uses the mock CPI growth in Table 1.7 of the supplied MOCK OBR workbook. The third-quarter CPI figure proxies September uprating; the workbook does not provide monthly September CPI.
- The energy VAT zero rate is represented as 9/12 of each annual bill in calendar 2027 and 3/12 in calendar 2028. The model now deducts VAT once from household income and once from government VAT receipts. This even-month approximation omits seasonal differences in energy use.
- Fuel duty savings include the direct duty reduction and 20% VAT pass-through at the pump, with litres spread evenly over the calendar year. The revised rates follow the rounded Annex A costings rather than reconstructing them from annual-average RPI.
- All five mock measures are absent from the constituency CSVs. Maps stay unavailable; existing constituency weights/provenance are not verified. `obr_comparison.csv` leaves official OBR fields blank because the fictional costings are fiscal-year estimates, while dashboard outputs mix tax-year and calendar-year periods. Blank does not mean zero.

Relative to the reviewed head, the corrected local run changed the fuel duty 2027 budgetary estimate from −£1.297bn to −£1.718bn, the energy VAT estimate from −£2.511bn in 2027 and £0 in 2028 to −£1.881bn and −£0.642bn, and the NIC 2029 estimate from −£0.398bn to −£0.959bn. These are changes in provisional dashboard estimates, not official fiscal costings.

## Reproduction and checks

```bash
PYTHONPATH=src .venv/bin/python -m uk_budget_data.cli generate \
  --output-dir "$OUTPUT_DIR" --dataset "$DATASET_PATH" \
  --reforms mock_fuel_duty_freeze mock_energy_vat_zero_rate mock_child_benefit_increase mock_nics_threshold_rise mock_hvcts_extension \
  --years 2026 2027 2028 2029 2030 --skip-input-check
PYTHONPATH=src .venv/bin/python scripts/validate_published_data.py public/data
```

The staging results were merged by replacing only the 25 policy-year mock rows and their matching chart rows. The default national validator now checks the five displayed mock IDs and passes all seven CSVs. The `--skip-input-check` flag was needed because matched constituency weights were unavailable; it is not evidence of source certification. The income curves and sampled household scatter are illustrative; scatter rows must not be summed as a population total.

Current working-tree national CSV SHA-256 values:

| File | SHA-256 |
|---|---|
| `budgetary_impact.csv` | `1417ce6b760804270086289825a6ed2b07dd40308d6aa10ee40f4c84a5f8c144` |
| `distributional_impact.csv` | `69821b67ffb662f91a72620d6e751426883d4fde5ae7e8ffccacdc55ba0881ad` |
| `winners_losers.csv` | `f87f5cf49c9437d639245d58b254e3ab92ec36bf78db792df939abb739757e0f` |
| `metrics.csv` | `796e6c3a6b08cd05d63c6e207a48f966a390267d4dd034fa429c0250a23e40aa` |
| `household_scatter.csv` | `ac181bed91def470d34b64e792ca9e2dd7b2b2276de3ae59cd63dc1db6d06fc7` |
| `income_curve.csv` | `e78c71f0f84744a17864a26021dc8567105674f27a134b16269cb85448eaa51f` |
| `obr_comparison.csv` | `5ee3b6a44653206e0566e1655563c7a19ec492bca168813705878e02a83fa1f0` |

## Legacy CGT behavioural sensitivity (provisional 2027 check)

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

Obtain the certified enhanced FRS release and matched constituency weights, record release IDs and hashes, then rerun and validate all featured national and local outputs before any public publication or merge. This drill PR remains for a private preview with the MOCK banner and noindex. Each policy is estimated separately; the dashboard sums selected effects rather than computing an interaction-aware combined scenario. Household fuel and VAT figures assume full pass-through and fixed use.
