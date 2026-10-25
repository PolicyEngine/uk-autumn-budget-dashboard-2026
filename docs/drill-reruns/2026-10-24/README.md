# Drills 1–4 rerun on policyengine 6.10.2 (24 October 2026)

MOCK DATA. These are rehearsal measures, not a real Budget.

Every `mock*_` measure from the four mock-Budget drills was rerun on today's latest engine, **policyengine 6.10.2** (policyengine-uk 2.132.6, policyengine-core 3.33.3). The data is the Microcosm national file that 6.10.2 certifies, `microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71` (SHA-256 `810ba980…0951ece`). The rerun results are then compared with the flat national CSVs committed on each drill branch.

- `comparison.csv`: one row per drill, measure and year (209 rows).
- `summary.csv`: the per-drill headline numbers.
- `runs.json`: the commands, timings, peak RSS and dataset hash for each run.
- `drill2-minimal-fix.diff`, `drill3-minimal-fix.diff`: the only code changes needed to run.
- `probe_monthly_fuel_duty.py`: the check behind the fuel duty finding below.

The sealed folders and answer keys were not opened. Drill-day figures come from `public/data/*.csv` on each drill branch. The drills' mock costings come from the filled national scoring sheets committed there. The dashboard's benchmarks are real published costings instead (see "External benchmarks" below).

## What was rerun

| Drill | Code (worktree SHA) | Drill-day engine | Drill-day data | Measures × years | Rerun time | Peak RSS |
|---|---|---|---|---|---|---|
| 1 (#4) | `1b2d8bd` (stop; data from `3b0eab7`, same reform code) | policyengine 6.0.0 / pe-uk 2.90.2 | 6.0.0 bundle default (enhanced FRS) | 5 × 2026–30 | 7.0 min | 8.0 GB |
| 2 (#7) | `e05274b` (final national data run) | policyengine 6.2.1 / pe-uk 2.120.0 | Microcosm `aa31bdf6` | 8 × 2026–30 | 13.6 min | 8.6 GB |
| 3 (#9) | `8aef1c1` (run 2 on code `619dc67`) | policyengine 6.2.7 / pe-uk 2.125.1 | Microcosm `aa31bdf6` | 11 × 2026–31 | 40.5 min | 9.4 GB |
| 4 (#52) | `ab79af1` (G5 run; definitions = final `2761f29`) | policyengine 6.7.6 / pe-uk 2.130.1 | Microcosm `810ba980` | 13 (incl. `mock4_combined`) × 2026–31 | 29.2 min | 7.8 GB |

All four runs exited 0. Runs were sequential, and each started only when swap was under 30 GB. Drill 3's time is inflated: it ran while swap was 30–34 GB, alongside another agent's generate. Peak RSS is the `/usr/bin/time -l` maximum resident set size. It understates the true footprint when pages are swapped.

Geography (regions and constituencies) was skipped.

Drill 3's drill-day CSV is itself mixed. Per its run-2 receipt, 6 measures were rerun on `619dc67` and 5 were carried forward from run 1 (code `4b72684`) with unchanged definitions.

**What each drill isolates:**

- **Drill 4:** only the engine changes (6.7.6 / pe-uk 2.130.1 → 6.10.2 / pe-uk 2.132.6, same dataset).
- **Drills 2 and 3:** engine and dataset change together (Microcosm `aa31bdf6` → `810ba980`). The two effects are not separated here.
- **Drill 1:** engine and dataset change together, from the enhanced FRS to Microcosm.

## Code fixes needed

| Drill | Fix | Why |
|---|---|---|
| 1 | None. `uv lock --upgrade-package policyengine && uv sync` only | `policyengine[uk]>=6.0.0` |
| 2, 3 | `pyproject.toml`: `policyengine==6.10.2`, `policyengine-uk==2.132.6`, `policyengine-core==3.33.3` (were exact 6.2.x pins) | Exact pins block the lock upgrade |
| 2, 3 | `drill_setup.py`: `MODEL_VERSION`/`CORE_VERSION` to 2.132.6/3.33.3; `DATASET_SHA256` to `810ba980…`; `DATASET_RELEASE`/`DATASET_REVISION` to the 19 October cut; `DATASET_BUILD_MODEL_VERSION` to 2.132.6 | The runtime guard refuses any other engine or file. `DATASET_BUILD_CORE_VERSION` and `_PYTHON_VERSION` are provenance only and were left stale |
| 4 | None. `scripts/drill4_generate.sh` already pins `810ba980` | |

No reform code was changed. The fuel duty issue below was **not** fixed, because a fix would change the measures rather than let them run.

## Finding: the drills 1–3 fuel duty measures lose their duty change on pe-uk 2.132.6

Drills 1–3 set the fuel duty rate with **month-dated ranges** (`"2027-01-01.2027-01-31": rate`, one per month). On pe-uk 2.132.6 these ranges leave the baseline and reform rates identical, so the duty part of each measure disappears and only the drills' pump-VAT modifier is scored.

`probe_monthly_fuel_duty.py` shows this directly. It builds a one-household simulation under each measure's baseline and reform scenarios, with the modifier removed:

| Measure | 2027 fuel duty, baseline vs reform |
|---|---|
| `mock_fuel_duty_freeze` (drill 1) | £594.52 vs £594.52 |
| `mock2_fuel_duty_hold` (drill 2) | £594.52 vs £594.52 |
| `mock3_fuel_duty_phasing` (drill 3) | £594.52 vs £594.52 |
| `mock4_fuel_duty` (drill 4, open-ended dated steps) | £595.01 vs £556.98 |

The effect on the scores:

- Drills 2 and 3 fall by exactly 82.9% in every year. That is the VAT-only share of a duty-plus-20%-VAT measure (about 1/6), plus the litres change.
- Drill 1 falls by 47.5%. Its gap also includes the move from enhanced FRS to Microcosm litres.

These rows are marked in `comparison.csv` (`rerun_note`) and left out of the medians below. **They are not valid rerun scores.**

The drills ran on pe-uk 2.90.2, 2.120.0 and 2.125.1, where the ranges applied. Drill 4, already on 2.130.1, used open-ended steps and is unaffected. Two pe-uk changes are candidate causes:

- 2.126.12: "Every reform route now writes dated changes onto the statutory parameter timeline and reprocesses it."
- 2.109.6: model-year day-weighting of fuel duty.

This is not confirmed by bisection. The lesson for Budget day: write dated fuel duty as open-ended steps, as drill 4 did, and check a household before and after.

## Summary per drill

The median and maximum are taken over "material" cells: those where the drill-day revenue is at least £0.01bn, excluding the invalid fuel rows. The size change is (|rerun| − |drill day|) / |drill day|.

| Drill | Material cells (invalid excluded) | Median abs. size change | Max abs. size change | Closer / further vs the external costing (year cells) | Closer / further vs the drill mock costing |
|---|---|---|---|---|---|
| 1 | 17 (4) | 9.98% | 20.3% | 2 / 2 | n/a: no filled national sheet |
| 2 | 23 (4) | 2.95% | 17.4% | 0 / 2 | 7 / 7 |
| 3 | 41 (5) | 1.95% | 14.6% | 1 / 0 (1 unchanged) | 23 / 10 |
| 4 | 51 (0) | 0.00% | 0.36% | none compared | 6 / 0 (all moves under 0.4%) |

"Closer/further" compares each year cell's drill-day and rerun figures with a benchmark. The dashboard uses the external costing (`vs_external` in `comparison.csv`); the mock column is kept for reference (`vs_official_static`, like-for-like mock figure, see "Benchmark basis" below). Model year Y is fiscal year Y–Y+1, as the drill code states. Cells with a model limitation and the invalid fuel duty cells are left out (`vs_official_static` = `model_limitation` or `invalid` in `comparison.csv`).

### External benchmarks

The drills' costings were invented for the rehearsals, so the dashboard compares against **real published costings** of the same or an equivalent policy. `scripts/build_drill_rerun_dashboard.py` holds each source, the exact row or page, and the scaling (`EXTERNAL`). It writes `external_bn`, `external_match`, `external_source`, `external_url` and `vs_external` into `comparison.csv`. The mock figure stays on the dashboard as a second line, "drill mock".

Match quality:

- **Same change**: read straight off the source.
- **Rescaled**: the same kind of change scaled to this size, for example a £430 threshold rise as 4.13 × HMRC's £2-a-week row.
- **Derived**: official counts × the measure's amount.
- **Different basis**: a real figure that is post-behavioural where our model is static (CGT). Shown, not compared.
- **Related policy only**: a real costing of a related policy (for example the real £2m surcharge for a £1.5m band). Context, not compared.

Only same-change, rescaled and derived figures that are not just an upper or lower bound count towards closer/further and the "differs most" list.

| Drill | Measure | Match | External figure (£bn, + = revenue) | Source |
|---|---|---|---|---|
| 1 | Child Benefit £30/£20 | Rescaled | −1.19 (2027-28), −1.18 (2028-29) | [HMRC ready reckoner, June 2025](https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes): CB first and subsequent child £1/week |
| 1 | NI threshold to £13,000 | Rescaled | −1.01, −1.12 | Ready reckoner: employee entry threshold £2/week; lower profits limit £104 |
| 1 | VAT zero rate on household energy | Rescaled, upper bound | −2.40 (2027-28) | Ready reckoner: VAT reduced rate 1 point × 5 |
| 1, 2, 3, 4 | Fuel duty measures | Related | Real measure −2.37 (2026-27), about −0.85 a year after | [Budget 2025 policy costings](https://assets.publishing.service.gov.uk/media/692872fd2a37784b16ecf676/Budget_2025-Policy_Costings.pdf#page=14), p. 14 |
| 1, 2, 3 | Council tax surcharge variants | Related | Real £2m+ surcharge: static +0.61 (2028-29), post-behavioural +0.40 | [Budget 2025 policy costings](https://assets.publishing.service.gov.uk/media/692872fd2a37784b16ecf676/Budget_2025-Policy_Costings.pdf#page=51), p. 51 |
| 2 | Electricity VAT zero rate | Rescaled, upper bound | −1.70 (2027-28) | [HM Treasury, 21 July 2026](https://www.gov.uk/government/news/new-pm-cuts-tax-on-household-electricity-bills-to-give-breathing-space-on-cost-of-living): about £850m for October 2026 to March 2027, doubled |
| 2 | Employer NI threshold +£500 | Rescaled | −2.07, −2.26 | Ready reckoner: employer threshold £2/week |
| 2 | CGT 18→20%, 24→28% | Different basis | −0.14, −0.66 (post-behavioural) | Ready reckoner: CGT rate rows, interpolated |
| 2 | £150 energy payment | Derived, lower bound | −1.01 (2026-27) | [DWP Universal Credit statistics, Feb 2026](https://www.gov.uk/government/statistics/universal-credit-quarterly-statistics-29-april-2013-to-12-february-2026/universal-credit-quarterly-statistics-29-april-2013-to-12-february-2026): 6.7m households × £150 |
| 3 | CGT 28% and exempt amount £2,000 | Different basis | −0.09, −0.60 (post-behavioural) | Ready reckoner |
| 3 | Class 4 main rate +1 point | Same change | +0.53, +0.45 | Ready reckoner: Class 4 main rate 1 point |
| 3 | Warm Home Discount +£100 | Derived, upper bound | −0.67 a winter | [DESNZ consultation](https://www.gov.uk/government/consultations/expanding-the-warm-home-discount-scheme-2025-to-2026/expanding-the-warm-home-discount-scheme-2025-to-2026-consultation-document-accessible-webpage): £1bn for £150 in Great Britain |
| 3, 4 | LHA to 30th percentile | Related | 2024 reset: −1.66 (2027-28), −1.70 | [Autumn Statement 2023 policy costings](https://assets.publishing.service.gov.uk/media/6560c3ef3d77410012420197/Autumn_Statement_2023_Policy_Costings_-_Final.pdf#page=16), p. 16 |
| 3 | Salary sacrifice cap £1,000 | Related | Real £2,000 cap: +4.85 (2029-30), +2.59 | [Budget 2025 policy costings](https://assets.publishing.service.gov.uk/media/692872fd2a37784b16ecf676/Budget_2025-Policy_Costings.pdf#page=47), p. 47 |
| 3, 4 | Threshold freeze to 2032 | Related | First year of the real freeze: +3.37 (2028-29) | [Budget 2025 Table 4.1](https://assets.publishing.service.gov.uk/media/69269df29fd433badebc31b3/Table_4.1_-_Budget_2025_Policy_Decisions.xlsx), line 46 |
| 4 | Carer's Allowance limit +£26 | Rescaled (model limitation) | −0.06, −0.08, −0.10 | [Autumn Budget 2024 policy costings](https://assets.publishing.service.gov.uk/media/6721d2c54da1c0d41942a8d2/Policy_Costing_Document_-_Autumn_Budget_2024.pdf#page=64), p. 64: +£45 rise, scaled |
| 4 | CGT higher rate 26% | Different basis | +0.00, −0.24 (post-behavioural) | Ready reckoner |
| 4 | Savings starting band to £2,000 | Rescaled (model limitation) | +0.15 (2028-29) | Ready reckoner: starting rate limit £100 × 30 |
| 4 | Warm Home Discount top-up | Derived, approximate | −0.83 (2026-27) | DESNZ consultation |

**No external costing found:** State Pension personal allowance, State Pension double lock, Pensioner Allowance, State Pension Top-up Allowance, additional rate threshold at £100,000, employer NI relief for under-22s and under-23s, Child Benefit Early Years Addition, UC child element +£12.50, VAT cut on road fuel, and the drill 4 package. None is a real announced policy with a published costing, and none maps onto a ready-reckoner row.

The ready reckoner covers 2026-27 to 2028-29 only, on the Spring Statement 2025 baseline, and includes behavioural effects for income tax, NICs and CGT.

### Benchmark basis

This section is about the drills' **mock costings**: the invented Treasury-style costings written for each rehearsal (each packet says "Every figure is invented for a PolicyEngine rehearsal"). The dashboard shows them as a second line, "drill mock", linked to each drill's costing note.

The rerun figure is a standalone tax-year liability, on a net `gov_balance` basis. The costings are on different bases:

- **Drill 2:** National Accounts (accruals), so timing matches. Some figures are gross.
- **Drills 3 and 4:** cash for income tax, CGT and NICs. Each costing note also prints the tax-year liability.

Where the drill's own costing note prints the figure on our basis, `comparison.csv` uses it as `official_like_for_like_bn`, with `like_for_like_source` giving the note and line. These substitutions are listed in `LIKE_FOR_LIKE` in `scripts/rerun_drills.py`:

| Drill | Measure | Year | Headline mock static | Like-for-like (mock) | Why |
|---|---|---|---|---|---|
| 2 | Employer NI threshold | 2027–30 | −2.25 to −2.40 | −1.85 / −1.89 / −1.93 / −1.97 | Our output is net of pay pass-through; the post-behavioural figure is net (costings note line 105) |
| 2 | State Pension uprating | 2030 | +1.66 | +1.15 | Net of Pension Credit and income tax, like ours (line 165) |
| 3 | CGT higher rate and AEA | 2027 | +0.115 | +1.650 | Tax-year liability; only 7% is cash in-year (line 51) |
| 3 | Additional rate threshold | 2027 | +1.46 | +1.826 | Liability; the static is cash, 80% in-year (line 86) |
| 3 | Class 4 main rate | 2027 | +0.155 | +0.61 | Liability: 1 point on the £61bn profit base; a quarter is cash in-year (line 119) |
| 3 | Threshold freeze | 2031 | +2.945 | +3.258 | Liability, the sum of the legs (line 18) |
| 3 | Pensioner Allowance | 2031 | −1.855 | −1.640 | Standalone; the static is stacked after the freeze (line 29) |
| 4 | CGT higher rate | 2027 | +0.07 | +0.770 | Liability; only 9% is cash in-year (line 73) |
| 4 | State Pension Top-up Allowance | 2027 | −0.07 | −0.113 | Liability; 60% is cash in-year (line 29) |
| 4 | State Pension Top-up Allowance | 2031 | −0.31 | −0.187 | Standalone liability; the static is stacked (line 29) |
| 4 | Threshold freeze | 2031 | +3.705 | +4.038 | Liability, the sum of the legs (line 18) |

In later years of CGT, Class 4 and the Top-up Allowance, the cash and liability figures differ by under about 5% (payment lag). Those cells keep the cash figure.

These cells have a **model limitation**, so they are not compared:

- **Drill 4 Carer's Allowance earnings limit:** take-up is set from current receipt, so people newly entitled by the higher limit cannot appear.
- **Drill 4 savings starting band:** policyengine-uk defect #1799, about 2.5 times too high.
- **Drill 3 salary sacrifice cap:** the engine doesn't take the sacrificed pay out of adjusted net income, which adds income tax through the allowance taper and the child benefit charge.
- **Drill 2 electricity VAT:** the cost is split across calendar years. The fiscal 2027-28 total is −1.38 against −1.76.

### Largest movers and their causes

| Drill | Measure | Drill day → rerun (£bn) | Size change | Cause |
|---|---|---|---|---|
| 1 | NICs PT/LPL to £13,000, 2027 | −0.789 → −0.949 | +20.3% | The drill-1 retro (#6) recorded −0.79bn against about −0.985bn, caused by the Class 4 NI additional-band bug at non-round thresholds (policyengine-uk#1878). On 2.132.6 the 2027 figure is in line with 2028–30 (−0.96 to −0.97), and decile 10's 2027 change rises from £14 to £49, as in later years. This is consistent with the fix; it is not separately bisected |
| 1 | Child Benefit £30/£20, 2027–30 | −1.21 → −0.98 (2027) | −18.5% | Mainly the dataset (enhanced FRS → Microcosm). Decile 10's gain falls from about £5 to £0.5. Engine HICBC changes (2.121.0 opted-out claimants; 2.126.11 HICBC rounding) also apply. Not decomposed |
| 1 | Energy VAT zero rate, 2027–28 | −1.88 → −1.69 (2027) | −10 to −12% | Dataset energy spending (enhanced FRS → Microcosm). Not decomposed |
| 1 | HVCTS from £1.5m, 2028–30 | 0.269 → 0.249 | −7.4% | pe-uk 2.123.1 charges the surcharge only on owner-occupiers. Decile 1's average loss falls from £27 to £9 and decile 10's rises from £8 to £41, the pattern expected when renters drop out. The dataset change also applies |
| 2 | Employer NI ST £5,000 → £5,500 | −1.31 → −1.08 (2030) | −3.6 to −17.4% | Engine and dataset together (`aa31bdf6` → `810ba980`). Not decomposed |
| 2 | Electricity VAT zero | −0.94 → −1.04 (2027) | +10.5% | Engine and dataset together. Not decomposed |
| 2 | State Pension personal allowance | −0.35 → −0.39 (2027) | +0.9 to +11.2% | Engine and dataset. The rerun also shows −£0.024bn in 2026, where the drill day had £0. pe-uk 2.131.1 changed how bare-year and 1-January keys on uprated household parameters are dated, which could account for that. Not confirmed |
| 3 | LHA to 30th percentile, 2031 | −0.99 → −1.14 | +14.6% | pe-uk 2.128.0 projects datasets to 2032. On 2.125.1 (drill day), 2031 was served from 2030 data, which is why the drill-day 2031 figure fell below 2030's. Other years move −0.1% to −5.8% (engine and dataset) |
| 3 | Threshold freeze to 2032, 2031 | 4.455 → 4.332 | −2.8% | 2031 is now a real dataset year (2.128.0). pe-uk 2.126.2 also changed the 2031-32 indexation of PA/BRL, which moves the counterfactual |
| 3 | Pensioner Allowance | −2.99 → −3.09 (2031) | +2 to +3.5% | Engine and dataset together. Not decomposed |
| 4 | All 13 measures | | at most 0.36% | Same dataset; engine only. Revenue is unchanged to the third decimal for 10 of 13 measures. The State Pension Top-up Allowance moves 0.3%, which is not attributed |

### Decile changes

Decile 1's average change moves more than revenue, even in drill 4, where only the engine changed. Median absolute change in decile 1's average:

| Drill 1 | Drill 2 | Drill 3 | Drill 4 |
|---|---|---|---|
| 14% | 31% | 48% | 4.5% |

In drill 4, measures that hit capital income show the largest decile 1 shifts, with revenue the same:

- CGT higher rate: decile 1 −£5.1 → −£9.2.
- Savings starting band: decile 1 −£0.6 → −£1.1.

This is consistent with pe-uk 2.132.4. It resets negative HBAI income to zero and now places those households in the bottom decile instead of excluding them. Before, they had decile −1. Decile 1 tables from before and after 2.132.4 should not be compared directly.

### Winners and losers

The flat tables have no winner and loser shares. The nearest field is `metrics.people_affected` (the % of people whose income changes), which is in `comparison.csv` as `people_affected_pct_drill_day` / `_rerun`.

## How to rerun

```sh
export HUGGING_FACE_TOKEN=$(cat ~/.cache/huggingface/token)
export RERUN_DATASET=/path/to/microcosm_uk_2024_25.h5   # SHA-256 810ba980…
W=/tmp/drill-rerun
uv run python scripts/rerun_drills.py setup   --work-dir $W   # worktrees, minimal fixes, lock upgrade, sync
uv run python scripts/rerun_drills.py run     --work-dir $W   # one drill at a time, swap < 30 GB gate
uv run python scripts/rerun_drills.py compare --work-dir $W --out docs/drill-reruns/2026-10-24
```

`run` takes `--drills d2 d3` to run a subset, and `--wait-for-jobs` to also wait until no other `uk-budget-data generate` process is running. Outputs go to `$W/out/dN`, never to `public/data`. To check the fuel finding, run the probe from a drill worktree: `cd $W/d2 && .venv/bin/python <repo>/docs/drill-reruns/2026-10-24/probe_monthly_fuel_duty.py mock2_fuel_duty_hold`.
