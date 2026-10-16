# Drill 4: mock Autumn Budget on Monday 19 October 2026

MOCK DATA. This is a rehearsal only; nothing here is a real Budget. Do not merge.

The real Budget is on **Wednesday 28 October 2026** (Chancellor John Healey, PM Andy Burnham). Drill 4 is the last drill before it. Earlier drills: [#4](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/4) / [#6](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/6), [#7](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/7) / [#8](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/8), [#9](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/9) / [#10](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/10).

## Purpose

Drills 1–3 tested speed and accuracy on a drill fork. Drill 4 tests two things:

1. **Readiness.** Can we score the real Budget on the setup we will actually use on 28 October? That means `main`, the certified engine bundle, the gated publish path and the hosted household API.
2. **Where the work is.** Which kinds of change are slow or impossible on the day, so the next nine days go to the right places.

The packet therefore over-weights measures we have **never modelled** but that are probable. The 20 real candidates are in [`docs/autumn-budget-2026-candidate-reforms.md`](docs/autumn-budget-2026-candidate-reforms.md) (16 October).

## The three questions this drill must answer

Each question has a measurement inside the drill and an answer due at the debrief.

| # | Question | How the drill measures it | Answer recorded in |
|---|---|---|---|
| Q1 | **Do Budget-day reform changes go in this dashboard repo, or in policyengine-uk?** | At G1, every coded line is given a **route**: `dashboard-param`, `dashboard-structural`, `pe-uk-param`, `pe-uk-variable`, `data`, `ledger` or `not-computable`. The clock table logs minutes-to-first-number and minutes-to-published for each route. At least one line needs a pe-uk variable that **was pre-built upstream between Friday and Monday**, and at least one needs a variable **nobody anticipated**, so the fallback path is timed | route table in the clock; debrief |
| Q2 | **Do new reforms need data work, modelling work or parameter work?** | The key gives each line a **cause class** for any gap: `parameter`, `formula`, `data_missing_input`, `data_calibration`, `behavioural`, `basis` or `not_in_scope`. At least one line is blocked by a **missing input variable** in the certified dataset, not by a missing formula | national sheet; debrief |
| Q3 | **Are we on the latest engine, and should we move?** | G0 records the bundle (policyengine 6.5.0 → policyengine-uk 2.130.1, enhanced FRS 2024-25 from uk-data 1.58.1) and what newer policyengine-uk releases exist (2.134.2 on PyPI, which 6.5.0 cannot pair with). The Friday preflight tests an upgrade and writes the **freeze decision** | G0; debrief |

### The working answer to Q1 (to be confirmed or overturned by the drill)

`main`'s publication gate refuses any model and data pair that the policyengine bundle has not certified. A change made in policyengine-uk therefore reaches a Budget-day publication only after it is:

1. merged;
2. released to PyPI;
3. picked up by a new certified policyengine.py bundle; and
4. adopted by this repo (as in #50), followed by regenerating everything.

Drills 1–3 show that chain takes days, not hours. So the working rule is:

- **On the day:** measures are written in this repo (`src/uk_budget_data/reforms.py`), as `parameter_changes` where a pe-uk parameter exists and as a structural reform where it does not, on the certified engine.
- **Before the freeze:** anything needed upstream (a missing variable, a wrong baseline) is merged, released and bundled first.
- **After the day:** dashboard workarounds are upstreamed so the engine is right for everyone.

The drill has to test two points in this rule. First, whether a structural reform can be receipted by the publish gate at all (#14 Q6). Second, whether a git-installed policyengine-uk branch can stand in when the bundle refuses it.

## What drills 1–3 taught us

| Finding | Change in drill 4 |
|---|---|
| No drill ran on the Budget-day setup. All three drills scored national figures on Microcosm `aa31bdf6` (now superseded by the 15 October release) with drill-fork code | The drill branch is cut from **`main` at `e74f350`** (policyengine 6.5.0), with no stacking on drills 1–3. National figures use the bundle's certified dataset |
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
| P1 | Fresh `uv sync` on this branch; record `policyengine`, `policyengine-uk`, `policyengine-core` and the certified dataset SHA-256 | Q3 baseline |
| P2 | Upgrade trial: does a newer policyengine-uk (2.134.2) install alongside 6.5.0? Record what the bundle gate says and what a baseline diff shows. Do not merge the trial | Q3; the freeze decision |
| P3 | Dated reforms on `main`: a one-date and a two-date fuel duty change through `Scenario(parameter_changes=…)` on 2.130.1 (day-weighted since policyengine-uk #2305). Check the fiscal-year totals by hand | Fuel duty is the most probable household measure |
| P4 | Receipting a structural reform: register one throwaway `simulation_modifier` measure and run `publish stage`. Does it receipt or get refused? | Q1: whether `dashboard-structural` can publish at all |
| P5 | Git-installed policyengine-uk: can a branch install replace the 2.130.1 wheel without breaking `managed_microsimulation`, and what does the publication gate say? | Q1 fallback |
| P6 | Hosted household API: `BUDGET_API_URL` set on the drill preview; one family case timed cold and warm | Drill 3 never verified it |
| P7 | Gross tax-head output: can `generate` emit income tax, NICs, VAT and duty heads next to `gov_balance`? If not, record the restatement route | The basis failure in drills 2 and 3 |
| P8 | One pre-built upstream variable: a draft policyengine-uk PR for the Warm Home Discount baseline (£150) with a contrib top-up parameter, opened for review only | Exercises the `pe-uk-variable` route; flagged in all three drills and never built |

## Gates

| Gate | Condition (met = committed and posted with receipt) |
|---|---|
| **G0** | Start SHA; bundle versions and dataset SHA-256; certified or not; hosted API version and health; preflight P1–P8 results |
| **G1** | Every statement line is coded or ledger, with a route and a reason |
| **G2** | First numbers for `dashboard-param` lines through `publish stage`; one hand-checked household; the hosted API answers one specimen (time recorded) |
| **G3** | Rebased on Annex A. Each national row has our figure, its basis (gross or net; cash or accrued; duty only or VAT-inclusive; fiscal or calendar), an explanation class for gaps over 10%, and a cause class |
| **G5** | After the 14:20 inject: the old run is preserved and marked superseded, and a complete new single-SHA run is posted |
| **G4** | `publish check` passes for the coded lines on the drill-only preview, with the MOCK banner and noindex. Lines that cannot be computed are published as not computable, never as £0 (#51) |

## Scoring at 16:00

| Part | What is scored | Weight |
|---|---|---|
| Households | `team_change` against the statutory key, to ±1p | 20% |
| National | Basis matches the costing's basis; explanation class matches | 30% |
| Ledger, route and cause | Each line classified correctly as coded or ledger; route matches the key's route; cause class matches | 25% |
| Publication path | The coded lines publish through the gate; refusals are recorded with the reason | 10% |
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
| 16:00 (sealed key) | `MOCK-drill4-answer-key-ledger.csv` | `0e5d533cb79e2e8db6e959eafc8a9755e6af53ec08e381efba3b862da810fbb2` |
| 16:00 (sealed key) | `MOCK-drill4-answer-key-national.csv` | `696d60b82565aee590ab89de9f329f7d68a8e7ea6d6c07e8032123ce550b16ca` |

`SHA256SUMS` lists all 12 files above.

**Packet shape:** 28 Table 4.1 lines (14 coded, 14 ledger; numbering mixes the two), 14 specimen households (England 6, Scotland 3, Wales 3, Northern Ireland 2), a six-year window (2026-27 to 2031-32) and a 14:20 inject. The blank sheets have 238 household rows, 85 national rows and 28 ledger lines. Every route class and every cause class appears at least once. The generator is deterministic: three runs gave byte-identical files. Every household value was computed two independent ways and agrees to the penny. The spoiler-free attestation is in `~/drill4-sealed/ATTESTATION.md`.

**Known limit:** the key holder could not run the certified engine (6.5.0 / 2.130.1 / enhanced FRS 1.58.1) locally, so the national classes rest on the candidate document and the engine audit. The household key follows statute; one baseline discrepancy found against policyengine-uk 2.125.1 is recorded in the sealed key, for filing at the debrief.

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
| Preflight P1–P8 | integrator | **UNCONFIRMED** |
| Sealed packet: hashes committed, two generator runs agree, independent household recalculation agrees to ±1p | key holder | **UNCONFIRMED** |
| Drill-only preview: MOCK banner, `noindex, nofollow`, hosted API healthy | Vahid, María | **UNCONFIRMED** |
| Scoring rubric frozen (SHA recorded) | María, key holder | **UNCONFIRMED** |

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| G0 | | |
| Drill start: statement released | | |
| G1 measure list, routes locked | | |
| G2 first numbers (gated path; hosted API time) | | |
| Documents released | | |
| G3 rebased; national sheet | | |
| Inject released | | |
| G5 re-run | | |
| G4 publish check on preview | | |
| Stop | | |
| Upstream findings filed | | |
| Answer key released | | |

### Route timing (fill in during the drill)

| Line | Route | Statement → first number (min) | → rebased (min) | → published (min) | Refused by gate? Reason |
|---|---|---|---|---|---|
| | | | | | |
