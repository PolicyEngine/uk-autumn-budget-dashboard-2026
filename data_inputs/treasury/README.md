# Treasury reconciliation inputs

`uv run python -m uk_budget_data.publication.reconcile <artifact dir>` compares a measure's fiscal impact with the Treasury's costing, and checks that the measure moves at all. It writes `reconciliation.json` beside the artifact. A measure cannot be approved until that file says the reconciliation is `pass` or `accepted` **and** the measure is `responsive`.

## Files

| File | What goes in it | Who fills it |
|---|---|---|
| `sources/<source_id>.csv` | Treasury figures: one row per table row, fiscal year and basis, in £bn with the Exchequer sign (positive improves the public finances). `uk_budget_data.treasury_import` writes Table 4.1 (`post_behavioural`) and a blank `static_costing` sheet. | Reconciler. Static figures come from the policy costings document. A blank `value_bn` means "not entered yet". |
| `mapping.csv` | Which Treasury row each measure is compared with. `scale` defaults to 1 and `year_offset` to 0 (model year 2027 is fiscal year 2027-28). Several rows for one measure are summed. `status: not_comparable` needs a `reason` and a `reviewer`, and so does any `scale` other than 1. A scale must be above zero: every figure is entered with the Exchequer sign, so none needs flipping, and a row that should not count is classified `not_comparable`. | Reconciler |
| `expected_effects.csv` | What each measure should do: `direction` (`positive` improves the government balance, `negative` worsens it) from `from_year` to `to_year`. Needed before the Treasury figures arrive; afterwards the sign of the Treasury's own figure is used for any year not declared. | Integrator, when the measure is coded |
| `exceptions.yaml` | Reviewed acceptances of a year's residual. | Reviewer |
| `policy.yaml` | The thresholds. They are a proposal until the team agrees them. | — |

## The rule

For each model year, with the Treasury figure on the gated basis (`static_costing`):

- **pass**: the difference is within the larger of 10% of the Treasury figure and £50m. A figure the Treasury prints as zero tolerates only £2.5m, its own rounding.
- **failed**: anything larger, unless an exception accepts it (**accepted**).
- **awaiting_source**: no figure entered for that year yet.
- **not_comparable**: a reviewer classified the row as outside scope or on a different basis.
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

Where an effect is expected, the measure's impact must have the expected sign and be at least £1m and 5% of the Treasury's figure. Otherwise it is **inert** or **wrong_direction**, and **no exception can waive that**: a reform that silently does nothing must not be published as a small number. A measure with no declared effect and no Treasury figure is **undeclared** and cannot be published either.

Rehearsal 26 October (MOCK DATA): this line is a Treasury-input commit made after the members were staged, to check that the combined run still binds them (#174).
