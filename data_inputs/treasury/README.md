# Treasury reconciliation inputs

`uv run python -m uk_budget_data.publication.reconcile <artifact dir>` compares a measure's fiscal impact with the Treasury's costing, and checks that the measure moves at all. It writes `reconciliation.json` beside the artifact. A measure cannot be approved until that file says the reconciliation is `pass` or `accepted` **and** the measure is `responsive`.

## Files

| File | What goes in it | Who fills it |
|---|---|---|
| `sources/<source_id>.csv` | Treasury figures: one row per table row, fiscal year and basis, in £bn with the Exchequer sign (positive improves the public finances). `uk_budget_data.treasury_import` writes Table 4.1 (`post_behavioural`) and a blank `static_costing` sheet. | Reconciler. Static figures come from the policy costings document. A blank `value_bn` means "not entered yet". |
| `mapping.csv` | Which Treasury row each measure is compared with. `scale` defaults to 1 and `year_offset` to 0 (model year 2027 is fiscal year 2027-28). Several rows for one measure are summed. `status: not_comparable` needs a `reason` and a `reviewer`, and so does any `scale` other than 1. A scale must be above zero: every figure is entered with the Exchequer sign, so none needs flipping, and a row that should not count is classified `not_comparable`. `not_comparable_years` (Treasury fiscal years, `;`-separated, such as `2030-31;2031-32`) classifies the row not comparable in those years only and compares it in the others, for a figure the Treasury prints in a year the measure is not in force (timing or behaviour before it starts or after it ends); it too needs a `reason` and a `reviewer`, and cannot be combined with `status: not_comparable`. | Reconciler |
| `expected_effects.csv` | What each measure should do: `direction` (`positive` improves the government balance, `negative` worsens it) from `from_year` to `to_year`. Needed before the Treasury figures arrive; afterwards the sign of the Treasury's own figure is used for any year not declared. | Integrator, when the measure is coded |
| `exceptions.yaml` | Reviewed acceptances of a year's residual. | Reviewer |
| `policy.yaml` | The thresholds. They are a proposal until the team agrees them. | — |
| `behavioural_adjustments.csv` | Reference only: what behaviour each official costing includes, whether it explains our residual, and its size in £bn where a published source gives one. Nothing reads it; published figures stay static. See [Behavioural responses](#behavioural-responses). | Reconciler |

## Budget 2026 (28 October 2026)

- `sources/AB2026-T6.1.csv`: Table 6.1, "Budget 2026 policy decisions", all 98 rows, post-behavioural, imported with

  ```sh
  uv run python -m uk_budget_data.treasury_import Table_6.1_and_6.2_Budget_2026_Policy_Decisions.xlsx \
    --sheet "Table 6.1" --table 6.1 --source-id AB2026-T6.1 --document "Budget 2026" \
    --out data_inputs/treasury/sources/AB2026-T6.1.csv
  ```

  from <https://assets.publishing.service.gov.uk/media/6ae187a2779378370fd80a9a/Table_6.1_and_6.2_Budget_2026_Policy_Decisions.xlsx> (SHA-256 `359958df6b1ab9746073725f6f8017ebdbb55040e57cf28612891f1e294a7f15`). The workbook is not kept here: a file under `data_inputs/treasury/` other than CSV, YAML or Markdown would count as calculation code to the combined and area runs (#174). Every row matched the printed totals.
- **No static costing is published.** The policy costings document (<https://assets.publishing.service.gov.uk/media/6ae1883fe4367e5c8b0467df/AB26_Policy_Costing.pdf>, SHA-256 `f716efada8a4d0726ce12b0f97d3f0dac671c31b2d005ecf300a48ff309638bf`) prints one Exchequer impact per measure, the same as Table 6.1, and says it includes a behavioural response for electricity VAT, fuel duty, Carer's Allowance, property income and savings income. The Pension Tax Allowance costing "assumes no behavioural response". The Household Energy Payment (row 1, RDEL) has no page in it. So no `static_costing` sheet is written, and `policy.yaml` gates on `post_behavioural` (Vahid, 28 October 2026). Measures listed under `includes_behaviour` (the costing says it includes a behavioural response) pass within `behavioural_relative_tolerance` (proposed 25%) or the £50m floor, whichever is larger; the Pension Tax Allowance and the Household Energy Payment keep the ordinary band.
- `mapping.csv`: nine measures, one per Table 6.1 row (1, 2, 3, 4, 7, 15, 52, 61 and 62), scale 1, offset 0. Savings income (row 62, `savings_income_rates_up`) is mapped but held back from the release ([README](../../README.md)). Five rows are not comparable in some years (`not_comparable_years`), each with its `reason` in the CSV: row 4 (£2 bus fare cap) in 2028-29 and 2029-30; row 15 (trading allowance) in 2027-28; row 52 (Pension Tax Allowance) in 2030-31 and 2031-32; row 61 (property income) in 2027-28 and 2028-29; row 62 (savings income) in 2026-27, 2027-28 and 2028-29.

## Behavioural responses

Our figures are static; Table 6.1 and the policy costings document are post-behavioural. `behavioural_adjustments.csv` records, per measure and fiscal year:

- `official_behaviour`: the response the costing describes, and `direction`: whether it raises or lowers the cost (or the yield).
- `explains_residual`: whether that direction runs from the official figure towards ours. Where it does not (electricity VAT, fuel duty, Carer's Allowance), adding behaviour to ours widens the gap, and the gap has another cause.
- `central_bn`, `low_bn`, `high_bn`: the adjustment to our static figure, Exchequer sign: the smaller and the larger end of the range, and a central value. Blank where no published source sizes it.
- `method` and `source`.

Only property income has a published size of its own (OBR, Economic and fiscal outlook, October 2026, para 3.17). Fuel duty applies HMRC's fuel price elasticities (HM Treasury and HMRC, *Analysis of the dynamic effects of fuel duty reductions*, 2014, Table 3.1) to our own base. The values and the arithmetic are in the file's `method` column. The file feeds no calculation and no page.

## The rule

For each model year, with the Treasury figure on the gated basis (`comparator_basis` in `policy.yaml`):

- **pass**: the difference is within the larger of 10% of the Treasury figure and £50m. A measure listed under `includes_behaviour`, when the gated basis is `post_behavioural`, gets the wider `behavioural_relative_tolerance` and `behavioural_absolute_floor_bn` instead. A figure the Treasury prints as zero tolerates only £2.5m, its own rounding.
- **failed**: anything larger, unless an exception accepts it (**accepted**).
- **awaiting_source**: no figure entered for that year yet.
- **not_comparable**: a reviewer classified the row as outside scope or on a different basis, in every year or in that year (`not_comparable_years`). A year in which every mapped row is not comparable has no residual and no expectation from the Treasury's figure; the official costings card shows it as not comparable, with the reason.
- **unsupported**: the year is beyond the dataset's projected years.

The measure, output digest, years and supported years come from the artifact's `receipt.json`. A command-line flag may supply one the receipt does not state, and one that contradicts the receipt is refused.

Every year the artifact reports (its receipt's `years`) must have exactly one model output, a finite number. A year with none **fails**, and no exception can accept it. Two rows for one year, or a value that is not a finite number, are refused.

A `policy.yaml` that exists must hold the thresholds as a mapping. An empty file, or one that reads as `false`, `0` or a list, is refused rather than taken for the defaults.

## Exceptions

```yaml
- measure_id: rate_change
  fiscal_year: "2028-29"
  residual_bn: 0.31            # ours minus the Treasury's, to the nearest £1m
  explanation_class: behavioural
  explanation: The costing includes a forestalling yield we do not model.
  reviewer: María Juaristi
  accepted_at: "2026-10-28T15:05:00Z"
  outputs_sha256: <the artifact's outputs_sha256>
  comparator_sha256: <comparator.sha256 of this year's row in reconciliation.json>
```

- `explanation_class` is one of `behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`.
- An exception applies only to the outputs it names. If the measure is regenerated and its numbers change, the exception lapses.
- It also applies only to the Treasury comparison it names. `comparator_sha256` covers the gated basis, every Treasury figure behind the comparison with its scale and year offset, and the rows classified not comparable. If any of them changes (a corrected figure, a remapped row, a different basis), the exception lapses, even when the total is the same.
- A declared residual that does not match the computed one is rejected.
- One exception per measure, year and outputs: a second is refused.

## Responsiveness

Where an effect is expected, the measure's impact must have the expected sign and be at least £1m and 5% of the Treasury's figure. Otherwise it is **inert** or **wrong_direction**, and **no exception can waive that**: a reform that silently does nothing must not be published as a small number. A measure with no declared effect and no Treasury figure is **undeclared** and cannot be published either. A year classified not comparable (`not_comparable_years`) only stops the Treasury's figure from implying an expectation; a year `expected_effects.csv` declares is still checked.
