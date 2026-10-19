# Drill 4: mock Autumn Budget on Monday 19 October 2026

MOCK DATA. This is a rehearsal only; nothing here is a real Budget. Do not merge.

**Running the drill as an agent?** Start with [DRILL4-AGENT-BRIEF.md](DRILL4-AGENT-BRIEF.md).

The real Budget is on **Wednesday 28 October 2026** (Chancellor John Healey, PM Andy Burnham). Drill 4 is the last drill before it. Earlier drills: [#4](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/4) / [#6](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/6), [#7](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/7) / [#8](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/8), [#9](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/9) / [#10](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/10).

## Purpose

Drills 1–3 tested speed and accuracy on a drill fork. Drill 4 tests two things:

1. **Readiness.** Can we score the real Budget on the setup we will actually use on 28 October? That means `main`, the engine bundle, **the Microcosm national dataset**, the gated publish path and the hosted household API.
2. **Where the work is.** Which kinds of change are slow or impossible on the day, so the next nine days go to the right places.

The packet therefore over-weights measures we have **never modelled** but that are probable. The 20 real candidates are in [`docs/autumn-budget-2026-candidate-reforms.md`](docs/autumn-budget-2026-candidate-reforms.md) (16 October).

## The three questions this drill must answer

Each question has a measurement inside the drill and an answer due at the debrief.

| # | Question | How the drill measures it | Answer recorded in |
|---|---|---|---|
| Q1 | **Do Budget-day reform changes go in this dashboard repo, or in policyengine-uk?** | At G1, every coded line is given a **route**: `dashboard-param`, `dashboard-structural`, `pe-uk-param`, `pe-uk-variable`, `data`, `ledger` or `not-computable`. The clock table logs minutes-to-first-number and minutes-to-published for each route. At least one line needs a pe-uk variable that **was pre-built upstream between Friday and Monday**, and at least one needs a variable **nobody anticipated**, so the fallback path is timed | route table in the clock; debrief |
| Q2 | **Do new reforms need data work, modelling work or parameter work?** | The key gives each line a **cause class** for any gap: `parameter`, `formula`, `data_missing_input`, `data_calibration`, `behavioural`, `basis` or `not_in_scope`. At least one line is blocked by a **missing input variable** in Microcosm, not by a missing formula | national sheet; debrief |
| Q3 | **Are we on the latest engine, and should we move?** | G0 records the engine (policyengine **6.7.6**, the latest, adopted on this branch on 19 October → policyengine-uk 2.130.1, the same pair as 6.5.0 and 6.6.0), the forced Microcosm files and what newer policyengine-uk releases exist (2.137.0 on PyPI, which 6.7.6 cannot pair with). The Friday preflight tests an upgrade and writes the **freeze decision** | G0; debrief |

### The working answer to Q1 (to be confirmed or overturned by the drill)

`main`'s publication gate refuses any model and data pair that the policyengine bundle has not certified. A change made in policyengine-uk therefore reaches a Budget-day publication only after it is:

1. merged;
2. released to PyPI;
3. picked up by a new certified policyengine.py bundle; and
4. adopted by this repo (as in #50), followed by regenerating everything.

Drills 1–3 show that chain takes days, not hours. So the working rule is:

- **On the day:** measures are written in this repo (`src/uk_budget_data/reforms.py`), as `parameter_changes` where a pe-uk parameter exists and as a structural reform where it does not.
- **Before the freeze:** anything needed upstream (a missing variable, a wrong baseline) is merged, released and bundled first.
- **After the day:** dashboard workarounds are upstreamed so the engine is right for everyone.

The drill has to test two points in this rule. First, whether a structural reform can be receipted by the publish gate at all (#14 Q6). Second, whether a git-installed policyengine-uk branch can stand in when the bundle refuses it.

## What drills 1–3 taught us

| Finding | Change in drill 4 |
|---|---|
| No drill ran on the Budget-day setup. All three drills scored national figures on Microcosm `aa31bdf6` (now superseded by the 15 October release) with drill-fork code | The drill branch is cut from **`main`** and was brought up to `main` at `5324080` on 18 October (policyengine 6.6.0, the #48 seat path), with no stacking on drills 1–3. Every population figure uses the **Microcosm pair** published on 19 October (national `810ba980…`, local `8e10e130…`), forced by `scripts/drill4_generate.sh` and `scripts/drill4_geography.sh` |
| The net-vs-gross basis failed in drills 2 and 3. The pipeline outputs net `gov_balance`; costings are gross tax heads on a cash basis | The pipeline must output gross tax-head series by G3, or each mismatch is scored as a basis miss |
| Hosted Personal impact was never verified; `BUDGET_API_URL` was unset in drill 3; the household route took 25–114 s, with an HTTP 504 on `main` (#14) | A G2 condition: the hosted household API answers one released specimen, with the time recorded, and the household-route parity check (#33) passes |
| G4/G5 scored zero because "logged" and "handed over" were different times | One definition: a gate is **met** when the complete sheet and its receipt are committed and posted |
| Households: 167/172 in drill 3. Misses came from unstated elections and rounding, not arithmetic | The specimen basis states every election, claim and rounding rule. Households weigh less |
| Five engine findings from drill 3 are still unfiled (LHA freeze year, under-21 employer NI, WHD qualifying date, income tax on above-cap salary sacrifice, threshold rounding) | **Filed during the debrief, same day.** Filing is a process point |
| Risk areas 13 (savings, dividend and property income) and 14 (SDLT and council tax) have never been exercised | The packet includes at least one line from each |
| The engine/data freeze rule is unsettled (#6 and #10 say freeze by 21 October; #14 says no freeze) | Q3 settles it at the debrief |

## Timetable (BST, London time)

Vahid was in Munich for drill 3 (Munich = London + 1h). Confirm location by Friday.

| Time | What | Who |
|---|---|---|
| **Fri 16 – Sun 18 Oct** | Preflight (see below). Sealed packet built and hashes committed | integrator; key holder |
| Mon 19 Oct, 10:00–11:30 | G0: start from this branch; registries empty; bundle receipt; hosted API health | integrator |
| **12:30** | **Statement released** (`MOCK-drill4-statement.md`). The clock starts | packet folder |
| 12:30–13:00 | G1: lock the measure list, coverage ledger and **route per line** (30-minute budget) | reconciler |
| 13:15 target | G2: first numbers on the gated path for the `dashboard-param` lines; hosted household check | integrator |
| **13:40** | **Documents released:** Table 4.1, costings with Annex A, OBR tables, specimen households, scoring sheets | packet folder |
| 13:40–14:15 | G3: rebase on Annex A; national sheet with basis, explanation class and cause class | integrator, then reconciler |
| **14:20** | **Inject released** (`MOCK-drill4-inject-1420.md`). Re-run what it touches | integrator |
| 14:20–14:50 | G5: a complete new single-SHA run, with the old run marked superseded | integrator, scorer |
| 14:50 target | G4: full page on the drill-only preview, through `publish stage` / `publish check` | all |
| **15:30** | **Stop.** Log the stop commit | integrator |
| 15:30–16:00 | Upstream filing: every engine or data finding becomes a draft issue in the right repo | integrator |
| 16:00 | Answer key released and scored | key holder, then scorer |

## Roles (proposed; each needs sign-off in the acceptance table)

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid, proposed) | The drill branch, every commit, generation, `publish` commands, preview deploys, the clock table | See the packet before release, or open `~/drill4-sealed/` before 16:00 |
| **Reconciler, then scorer** (María, proposed) | G1 ledger and routes, reconciliation, the national sheet, then household scoring (one SHA per run) | Push code |
| **Key holder** (Claude Code session on Vahid's machine, proposed) | `~/drill4-sealed/`; the 16:00 release with hashes on the PR | Take part in scoring |

## Friday–Sunday preflight

Each row needs evidence before Monday. A blank row blocks G0.

| # | Check | Why |
|---|---|---|
| P0a | Port the drill banner to this branch: `NEXT_PUBLIC_MOCK=1` gives the MOCK banner, a robots `noindex, nofollow` meta tag and an `X-Robots-Tag` header. `main` has none of these. Confirm which Vercel projects build this branch: pushes deploy previews to both `uk-autumn-budget-2026` and `uk-autumn-budget-2026-drill`. Confirm both are behind Vercel Authentication **before any mock measure is registered** | Nothing mock may reach an unprotected or indexable URL |
| P0b | A route from last Budget's registry to an empty one. `main`'s `reforms.py` still registers the November 2025 measures, and `main`'s CLI has only `generate` and `lifetime`, with no `reset` (the reset is on the drill 3 branch). Either port `reset` and the empty-state validator, or decide how PR #3 lands (#14 Q4). The same step is needed on 28 October | Without it, the Monday 10:00 window starts with an unplanned refactor |
| P1 | Fresh `uv sync` on this branch; record `policyengine`, `policyengine-uk` and `policyengine-core` | Q3 baseline |
| P1b | Download the Microcosm national file (see the dataset section) and run `scripts/drill4_generate.sh --list-reforms` with `DRILL4_DATASET` set. It must print `dataset OK`. Run one baseline-only generate and record the time | The drill is forced onto Microcosm |
| P2 | Upgrade trial: does a newer policyengine-uk (2.137.0) install alongside 6.7.6? Record what the bundle gate says and what a baseline diff shows. Do not merge the trial | Q3; the freeze decision |
| P3 | Dated reforms on `main`: a one-date and a two-date fuel duty change through `Scenario(parameter_changes=…)` on 2.130.1 (day-weighted since policyengine-uk #2305). Check the fiscal-year totals by hand | Fuel duty is the most probable household measure |
| P4 | Receipting a structural reform: register one throwaway `simulation_modifier` measure and run `publish stage`. Does it receipt or get refused? | Q1: whether `dashboard-structural` can publish at all |
| P5 | Git-installed policyengine-uk: can a branch install replace the 2.130.1 wheel without breaking `managed_microsimulation`, and what does the publication gate say? | Q1 fallback |
| P6 | Hosted household API: `BUDGET_API_URL` set on the drill preview; one family case timed cold and warm | Drill 3 never verified it |
| P7 | Gross tax-head output: can `generate` emit income tax, NICs, VAT and duty heads next to `gov_balance`? If not, record the restatement route | The basis failure in drills 2 and 3 |
| P9 | Constituency and regional results on Microcosm. **Answered 19 October (María):** the local build is released, and it pairs with the national file (same Microcosm commit and spine). Regions come from the national file and seats from the local file, both through the #48 disclosure path via `scripts/drill4_geography.sh`. That covers the package and every measure, every year. See the dataset section | 28 October publishes regions first, then seats (#24) |
| P8 | One pre-built upstream variable (**needs Vahid's go before anything is opened upstream**): a draft policyengine-uk PR for the Warm Home Discount baseline (£150) with a contrib top-up parameter, opened for review only | Exercises the `pe-uk-variable` route; flagged in all three drills and never built |

## Dataset: the Microcosm pair

Every **population** run in drill 4 uses the **Microcosm pair** published on 19 October, not the bundle's enhanced FRS. That covers national, distributional, regional and constituency figures. Both files come from the same Microcosm commit (`810315ac2`) and spine.

Household specimens use no population dataset: they run `Simulation(situation=…)` on the same engine and reform definitions. So a G2 household pass is not evidence that the Microcosm path works.

| Item | National file | Local file |
|---|---|---|
| Used for | National tables, distributional figures, regions | Constituencies |
| File | `microcosm_uk_2024_25.h5` | `microcosm_uk_2024_25_dense.h5` |
| SHA-256 | `810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece` | `8e10e130d0260e0b52e2e29902f0502ebdff76a14a3e57d2c876bf4cd8db5872` |
| Release tag (HF dataset `policyengine/populace-uk-private`) | `microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71` | `microcosm-uk-2024-25-dense-20261019T000432Z-ee5c2dbe` |
| Where | The file at the repo root at that tag; metadata in `releases/microcosm-uk-2024-25-national/` | The file at the repo root at that tag; metadata in `releases/microcosm-uk-2024-25-dense/` |
| Environment variable | `DRILL4_DATASET` | `DRILL4_LOCAL_DATASET` |
| Built under | policyengine-uk 2.132.6 / core 3.33.3 | policyengine-uk 2.132.6 / core 3.33.3 |

- **Local file:** byte-identical to the staged `staged/uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe/microcosm_uk_2024_25_local.h5` that the P9 dry run used, so a copy with this SHA-256 can be kept.
- **Superseded:** the national `04a496f2…` (15 October, `d12ff9b3`) and `aa31bdf6…`. The guard refuses both.

**Engine.** The drill runs on the bundle's certified engine: policyengine 6.7.6, policyengine-uk 2.130.1, core 3.33.0.
- The pair was built under 2.132.6, but policyengine 6.7.6 refuses 2.132.6 at import. The uk-data 1.58.1 release manifest certifies only 2.122.2 and 2.130.1, so the build engine can't be used without working around the certification.
- Known gap for 28 October: either a bundle that certifies the pair's engine, or a pair built under the bundle's engine.
- Between 2.130.1 and 2.132.6 the `household_net_income` formula is unchanged. The changes are:
  - trade-loss relief (Microcosm supplies no losses);
  - HBAI income measures: negative income before housing costs is reset to zero, so decile tables move;
  - dated-scenario timing;
  - calendar-year keys on uprating series.
- Every figure is labelled *unvalidated under this engine*.

**How it is forced:**

- **Generation.** Run all generation through `scripts/drill4_generate.sh`, never `uk-budget-data generate` directly.
  - The script checks the national file's SHA-256 against the pin above and refuses any other file, including the bundle's default enhanced FRS.
  - It also refuses a `--dataset` passed by hand, including the prefixes argparse would accept (`--datas`, `--datase`).
  - It passes the checked file last, so that is the value used.
- **Geography.** Regions and constituencies run only through `scripts/drill4_geography.sh`.
  - It checks both SHA-256s and refuses option overrides.
  - It runs regions on the national file, then seats on the local file with the regional table as a prior.
  - It compares the two files' national and regional estimates in a private report.
- **G0.** G0 logs the hash lines the scripts print.
- **Publish gate.** Microcosm runs **cannot be receipted, so they can't be staged either**.
  - Tested on 18 October, on the superseded `04a496f2` under policyengine 6.6.0: `generate --artifacts` refused every measure with "The uk bundle cannot resolve dataset 'microcosm_uk_2024_25'". policyengine's receipt code accepts only datasets in the certified bundle.
  - The run also exits 0 after refusing, so the clock must read the `REFUSED` line, not the exit code.
  - G4 (a) therefore records this refusal per coded line, and the figures reach the page through G4 (b).

**Dry run, 18 October, on the superseded `04a496f2`** (non-mock measure `fuel_duty_freeze`, 2026):
- The guard printed `dataset OK`.
- The plain `generate` ran in 36 s under policyengine 6.6.0 / UK 2.130.1 and wrote all six flat CSVs. The result was −£0.96bn, against the November 2025 OBR −£2.4bn; the gap is not investigated.
- `generate --artifacts` refused, as above.

**Constituencies and regions (P9, decided 19 October):**

- **Regions** come from the national file (`geography --dataset-kind microcosm-national`).
  - The eFRS copy flag `household_is_cgt_band_donor` isn't needed: Microcosm links each copy to its survey household through `source_household_id`, which the tool already trusts on the local file.
  - The eFRS exception is withdrawn.
- **Seats** come from the local file (`--dataset-kind microcosm`), where every household carries its constituency in every year. They are published for the package (`--package mock4_combined`) and for every measure, in all six years. In the P9 dry run (19 October, 6.7.6), the staged copy of this file wrote all 650 seats for a non-mock measure in about 3 minutes.
- **Consistency.** Seats don't add up exactly to the national figure.
  - Each file carries its own calibrated weights, published values are rounded, and some cells are withheld. Disclosure noise is off.
  - The guard compares the local file's national and regional estimates with the national file's, for every reform and year. It flags gaps above 5% nationally or 10% by region, with floors of £5 a household a year and 0.0005 relative.
  - The check is private and report-only.
- **Disclosure.** Both tables go through the #48 layer:
  - at least 10 survey households behind a figure;
  - the largest at most half of it;
  - the p% rule at 10%;
  - subtraction checks across seats, regions and the nation, and across the package and its measures.
- **Publish once.** Both tables are published from the final post-inject SHA only. A pre-inject seat table is never committed.

**The open question for 28 October:** if the real Budget also runs on Microcosm, the gate needs one of two things: a policyengine bundle that certifies the pair, with its engine, before the day, or an agreed, recorded exception.

**What this changes in the data story (Q2):**

- Microcosm has `capital_gains_badr` and the residential-property gains split, which enhanced FRS lacks.
- `main_residence_value` is top-coded at about £2.8–3.0m (microcosm #1112).
- There is no `additional_residential_property_purchased`, so SDLT higher rates come to nil.
- There are no alcohol or tobacco volumes.
- On Microcosm, a gap from a missing or weak input is classed as data.

## Gates

| Gate | Condition (met = committed and posted with receipt) |
|---|---|
| **G0** | Start SHA; engine versions; the Microcosm SHA-256s printed by `scripts/drill4_generate.sh` (national, must be `810ba980…`) and `scripts/drill4_geography.sh` (local, must be `8e10e130…`); hosted API version and health; preflight P0a–P9 results |
| **G1** | Every statement line is coded or ledger, with a route and a reason |
| **G2** | First numbers for `dashboard-param` lines through `publish stage`; one hand-checked household; the hosted API answers one specimen (time recorded) |
| **G3** | Rebased on Annex A. Each national row has our figure, its basis (gross or net; cash or accrued; duty only or VAT-inclusive; fiscal or calendar), an explanation class for gaps over 10%, and a cause class |
| **G5** | After the 14:20 inject: the old run is preserved and marked superseded, and a complete new single-SHA run is posted |
| **G4** | Two parts, both from the same run SHA. **(a) Gate:** every coded line is run through `generate --artifacts` and, if a receipt is written, `publish stage`. On Microcosm the receipt is refused at `generate` (see the dataset section); each refusal is recorded with its reason, not worked around. **(b) Page:** the figures shown on the drill-only preview come from the flat CSVs that the same `generate` run writes (`budgetary_impact`, `distributional_impact`, `winners_losers`, `metrics`), because `main`'s page reads those four files and has no manifest loader, and staged entries are never displayed (María, PR #52 C1). The page carries the MOCK banner and noindex. Lines that cannot be computed are published as not computable, never as £0 (#51). The missing manifest loader is logged as a finding for 28 October |

## Scoring at 16:00

| Part | What is scored | Weight |
|---|---|---|
| Households | `team_change` against the statutory key, to ±1p | 20% |
| National | Basis matches the costing's basis; explanation class matches | 30% |
| Ledger, route and cause | Each line classified correctly as coded or ledger; route matches the key's route; cause class matches | 25% |
| Publication path | G4 (a): every coded line goes through the gate, and each refusal is recorded with its reason. G4 (b): the preview shows the same run's figures | 10% |
| Process | Gates on time; one SHA per run; inject re-run logged; upstream findings filed by 16:00 | 15% |

**Explanation classes** (closed list, as in drill 3): `behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`, `takeup_caseload`, `none_expected`.

**Route classes:** `dashboard-param`, `dashboard-structural`, `pe-uk-param`, `pe-uk-variable`, `data`, `ledger`, `not-computable`.

**Cause classes:** `parameter`, `formula`, `data_missing_input`, `data_calibration`, `behavioural`, `basis`, `not_in_scope`.

**Rubric decisions (proposed; freeze before G0):**

1. The national sheet asks for an explanation class against the static figure and against the post-behavioural figure. Only the static column is scored; the post-behavioural column is evidence.
2. Rows that cannot be computed take the extra token `exempt_not_computable`. They are scored on their basis and on being published as not computable, never as £0.
3. Route and cause are scored once per line, on the G1 ledger sheet (`MOCK-drill4-ledger.csv`), not per national row.

## Packet

The packet is built by the key holder into `~/drill4-sealed/`. Only the release files are committed here, to `data_inputs/mock_drill4/packet/`, with their SHA-256 in the table below. The answer key and the generator stay outside the repository. **Don't open the 12:30 file before 12:30, the 13:40 files before 13:40, or the 14:20 file before 14:20.**

# Drill 4 packet hash table

MOCK DATA. Hashes only; no content. Paste the table into DRILL4.md's Packet section. Sealed keys stay in `~/drill4-sealed/sealed/` until 16:00; only their hashes are published.

| Release | File | SHA-256 |
|---|---|---|
| 12:30 | `MOCK-drill4-statement.md` | `09c6d96629b033fa8f8e9ec478460cbe4d8b81dddcadfde8c4e1fb16e6d8ae39` |
| 13:40 | `MOCK-drill4-household-scoring.csv` | `491395e848f6736f5ff8ee186e2cf7556b114e4cd590f8a54cf9581c4fb4c5d4` |
| 13:40 | `MOCK-drill4-ledger.csv` | `4fb0cb3dc181c041705c4d7ae0f0396980a28ce4872ce1ca00c70ca88711d873` |
| 13:40 | `MOCK-drill4-national-scoring.csv` | `c8b4d3dc68abe35d21fda9b7dbd70232752b9eb9124f124e8afea4bd2f13e781` |
| 13:40 | `MOCK-drill4-obr-economy-forecast.xlsx` | `c22347f69c06a9c0fe63cf91d2366389927ee597fc34dbcff4be63a6a0b6963a` |
| 13:40 | `MOCK-drill4-policy-costings.md` | `f4de78c004db6715c6c7f4f67bd02d732b31afd0978a20cc00b3206413e29848` |
| 13:40 | `MOCK-drill4-policy-decisions.xlsx` | `4965f78d6f4e9b709def0b04eabe5b383ee048751758291020de640d144b496a` |
| 13:40 | `MOCK-drill4-specimen-inputs.md` | `6741a5c882c86ceb0ab72160694dd3cfac08da3720661eb4d09163ced4750902` |
| 14:20 | `MOCK-drill4-inject-1420.md` | `d6ba4868d4a914c43506f8381ddf50638d2a73367a8ef848cd04736a783cd633` |
| 16:00 (sealed key) | `MOCK-drill4-answer-key-households.csv` | `a699c0908d7e34e8b97ed7b1233665dd8df3eaf8479a9612041e28d6e02065d3` |
| 16:00 (sealed key) | `MOCK-drill4-answer-key-ledger.csv` | `aa26852346d4af2b46066ae10f7332887d5b3c622bf654032cbca54995ca42be` |
| 16:00 (sealed key) | `MOCK-drill4-answer-key-national.csv` | `91315aeea740b247f74d8e896d938ae12411b9862afaab9f452ffc22c859a05d` |

`SHA256SUMS` lists all 12 files above.

**Packet shape:** 28 Table 4.1 lines (14 coded, 14 ledger; numbering mixes the two), 14 specimen households (England 6, Scotland 3, Wales 3, Northern Ireland 2), a six-year window (2026-27 to 2031-32) and a 14:20 inject. The blank sheets have 238 household rows, 85 national rows and 28 ledger lines. Every route class and every cause class appears at least once. The generator is deterministic: three runs gave byte-identical files. Every household value was computed two independent ways and agrees to the penny. The spoiler-free attestation is in `~/drill4-sealed/ATTESTATION.md`.

**Known limit:** the key holder could not run the drill engine (6.5.0 / 2.130.1) on Microcosm locally, so the national classes rest on the candidate document and the engine audit. The household key follows statute; one baseline discrepancy found against policyengine-uk 2.125.1 is recorded in the sealed key, for filing at the debrief.

## Debrief (same day, 16:30)

The debrief writes the answers to Q1–Q3 into the drill 4 issue. It also produces three lists, each with an owner and a date before 28 October:

1. Upstream work that must be **merged, released and bundled** before the freeze.
2. Data work: dataset variables, imputations and calibration targets, ranked by how many probable measures each one blocks.
3. Budget-day templates: one tested pattern per route in `reforms.py`.

## Setup acceptance

| Required evidence | Owner | Record |
|---|---|---|
| Roles and Monday times acknowledged | Vahid, María, key holder | **UNCONFIRMED** |
| Integrator location (London or Munich) and the time basis | Vahid | **UNCONFIRMED** |
| Preflight P0a–P9 | integrator | **UNCONFIRMED** |
| Sealed packet: hashes committed, two generator runs agree, independent household recalculation agrees to ±1p | key holder | **UNCONFIRMED** |
| Drill-only preview: MOCK banner, `noindex, nofollow`, hosted API healthy | Vahid, María | **UNCONFIRMED** |
| Scoring rubric frozen (SHA recorded) | María, key holder | **UNCONFIRMED** |

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| G0 | 12:31 (guard); logged 12:43. Late: G0 was due before 12:30 | start SHA `086aa1d`. policyengine 6.7.6 → policyengine-uk 2.130.1, core 3.33.0 (pe-uk 2.137.0 on PyPI, unpairable). Guard: `drill4: dataset OK: Microcosm microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71 (810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece); uncertified with this engine, label national figures unvalidated`. Local SHA-256 `8e10e130d0260e0b52e2e29902f0502ebdff76a14a3e57d2c876bf4cd8db5872` (staged copy). Known gap: pair built under pe-uk 2.132.6, run on 2.130.1. P0a banner missing (edge noindex + login), P0b no reset. pytest started 12:32, still running at log time |
| Drill start: statement released | 12:31 (arrived in `4fd06c1`); opened 12:43 | `4fd06c1`; statement SHA-256 `09c6d96629b033fa8f8e9ec478460cbe4d8b81dddcadfde8c4e1fb16e6d8ae39` |
| G1 measure list, routes locked | 12:43 posted (PR #52 comment 6266406897); awaiting María's lock | ledger: 14 coded / 14 ledger |
| G2 first numbers (gated path; hosted API time) | 13:34 (late; target 13:15). Code SHA `10552f7` pushed 13:07 | data `5633c5f`: 12 mock4 measures + `mock4_combined`, 2026–2031, flat CSVs (wave 1 generated on `21de64f`, wave 2 on `10552f7`; same definitions). `publish stage` not reachable on Microcosm (receipt refused; G4 (a)). Hand checks: pytest 107 passed, 1 skipped. Hosted API `uk-budget-api-2026` (main `5324080`, policyengine 6.6.0): healthy; family case cold 85.4 s, warm 82.7 s, matches local 6.7.6 to the penny; serves no mock4 measure (D1). Preview: https://uk-autumn-budget-2026-drill-git-drill4-moc-2e3f4b-policy-engine.vercel.app |
| Documents released | 13:41 (arrived in `e348634`); pulled 13:41 | `e348634`. SHA-256 prefixes: household-scoring 491395e8, ledger 4fb0cb3d, national-scoring c8b4d3dc, obr-economy c22347f6, costings f4de78c0, decisions 4965f78d, specimens 6741a5c8 |
| G3 rebased; national sheet | code `a2fac5c` pushed 13:51; run landed and sheet filled 14:24 (late; target 14:15) | data `6f31b5c`: 13 runs × 2026–2031; national sheet with basis, explanation and cause classes; ledger and household sheets filled. **Superseded** by the G5 run on `2088500` |
| Inject released | 14:21 (arrived in `3be5f61`); opened 14:21 | `3be5f61`; SHA-256 d6ba4868d4a914c43506f8381ddf50638d2a73367a8ef848cd04736a783cd633. Applied in `2088500` (14:22): SPTA threshold +£1,200; fuel duty 54.95p from 9 March 2027 |
| G5 re-run | code `2088500` 14:22; run landed 14:46; sheet posted 14:50 | data `ab79af1`; final code SHA `2761f29` (adds only the 1+3+7 stack; all 13 definitions identical to `2088500`). G3 run (`a2fac5c`/`6f31b5c`) superseded and kept. National sheet restated to cash per María (rows 1, 3, 5, 7, 8) |
| G4 staged on preview | 15:04 (late; target 14:50) | (a) `generate --artifacts` on code `d45b35e` (definitions = `2761f29`), all 12 coded lines REFUSED, 0 artifacts written: modifier measures (C3 WHD, C5 CB EYA, C7 SPTA, C2 fuel VAT, C9 employer NI) `uk_budget_data.reforms cannot be bound: line 732 assigns MOCK4_YEARS something other than a literal`; parameter measures (C1, C4, C6, C8, C10, C11, C13) `The uk bundle cannot resolve dataset 'microcosm_uk_2024_25'`. C12 and C14 not computable (not run). Logs: ~/drill4-private/logs/g4a4.log, g4a5.log. (b) Drill preview built from `d45b35e`; its `/data/budgetary_impact.csv` SHA-256 `5fc015f7…` equals the G5 commit's; the page lists C12/C14 as not computable (never £0) |
| Stop | 15:30 | stop SHA = this commit (filled national, ledger and household sheets already in `ab79af1`). Geography (seats) still checking at 15:30 on code `468916c` (= `2761f29` definitions); regions done in 709 s; result to be logged when it finishes |
| Upstream findings filed | | |
| Answer key released | | |

### Route timing (fill in during the drill)

Minutes from the statement (12:31). First number = G2 data commit 13:34; rebased = G3 14:24; published = G5 figures on the drill preview 14:51. All coded lines shared one pipeline, so the routes did not differ in time on the day; the pe-uk routes ran on dashboard-structural fallbacks.

| Line | Route | Statement → first number (min) | → rebased (min) | → published (min) | Refused by gate? Reason |
|---|---|---|---|---|---|
| C1 fuel duty | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C2 fuel VAT 15% | dashboard-structural | 63 | 113 | 140 | Refused: module cannot be bound (MOCK4_YEARS) |
| C3 WHD top-up | pe-uk-variable (dashboard-structural fallback) | 63 | 113 | 140 | Refused: module cannot be bound (MOCK4_YEARS) |
| C4 UC child element | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C5 CB Early Years Addition | dashboard-structural | 63 | 113 | 140 | Refused: module cannot be bound (MOCK4_YEARS) |
| C6 LHA reset | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C7 SP Top-up Allowance | pe-uk-variable (dashboard-structural fallback; G1 lock) | 63 | 113 | 140 | Refused: module cannot be bound (MOCK4_YEARS) |
| C8 CA earnings limit | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C9 employer NI under-23 | pe-uk-param (dashboard-structural fallback) | 63 | 113 | 140 | Refused: module cannot be bound (MOCK4_YEARS) |
| C10 CGT higher rate | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C11 savings starting band | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C12 SDLT surcharge | data | n/a | n/a | 140 (listed not computable) | not run (not computable) |
| C13 thresholds to 2032 | dashboard-param | 63 | 113 | 140 | Refused: bundle cannot resolve microcosm_uk_2024_25 |
| C14 alcohol duty | data (G1 lock; was not-computable) | n/a | n/a | 140 (listed not computable) | not run (not computable) |
