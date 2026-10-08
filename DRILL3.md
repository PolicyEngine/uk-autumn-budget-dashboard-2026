# Drill 3: mock Autumn Budget on Monday 12 October 2026

MOCK DATA. This is a rehearsal only; nothing here is a real Budget. Do not merge.

The real Budget is on **Wednesday 28 October 2026**. Drill 1 is [PR #4](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/4) and its retrospective is [issue #6](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/6). Drill 2 is [PR #7](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/7) and [issue #8](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/8).

## What drill 2 taught us

| Finding in drill 2 | Change in drill 3 |
|---|---|
| The setup window wasn't used; G0 was written at 12:13 | G0 is due by **Monday 11:30**, and the setup starts on **Friday 9 October** |
| Households were nearly solved (78/80 to the penny). Both misses were State Pension rounding | The household score counts for less. The specimen basis now states the rounding rule, Pension Credit claiming and fixed earnings |
| National gaps were explained late or wrongly. Two of four "calibration" flags were withdrawn once checked against official data | A new **national scoring sheet**: for each coded measure and year the team records its figure, its basis and an **explanation class** from a closed list. The key scores them |
| Our net employer NI was compared with a gross costing, and our VAT-inclusive fuel with a duty-only costing | Every costing states its basis. Matching the basis is scored |
| One scoring run became a mixed-SHA sheet | **Each scoring run is pinned to one SHA.** The 14:20 correction notice forces a re-run, logged as a new run |
| Engine 2.120.0 ran on data built under 2.100.0 | **G0 must name a validated engine and data pair, or label every national figure "unvalidated under this engine"** |
| The answer key had household rows only | The key has three parts: households, national (static, post-behavioural and expected explanation class) and ledger classification |

## Timetable (BST)

| Time | What | Who |
|---|---|---|
| Fri 9 Oct | Setup: engine and data pair chosen, drill branch ready, preview checked | integrator, reconciler |
| Mon 12 Oct, 10:00–11:30 | Remove the drill 2 `mock2_*` measures; regenerate the empty data; write G0 | integrator |
| **12:30** | **Statement released** (`MOCK-statement.md`). Drill clock starts | open from the packet folder |
| 12:30–12:45 | G1: lock the measure list and coverage ledger from the statement | reconciler |
| 13:15 target | G2: provisional first numbers (statement-based) | integrator |
| **13:40** | **Documents released:** Table 4.1, costings with Annex A, OBR tables, specimen households, scoring sheets | open from the packet folder |
| 13:40–14:10 | G3: re-base on Annex A; national scoring sheet filled | integrator, then reconciler |
| **14:20** | **OBR correction notice released** (`release_1420/`). Re-run what it touches | integrator |
| 14:20–14:50 | G5: corrected figures re-based and re-pinned; affected household rows rerun on the new SHA | integrator, scorer |
| 14:50 target | G4: full page on the drill preview; household and national sheets complete | all |
| **15:30** | **Stop.** Log the stop commit | integrator |
| 16:00 | Answer key released and scored | key holder, then scorer |

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | The drill branch, every commit, data regeneration, preview deploys, re-basing, the clock table | Score households, or see the packet before release |
| **Reconciler, then scorer** (María) | G1 ledger, the reconciliation, the national scoring sheet, then the household scoring sheet (one SHA per run) | Push code |
| **Key holder** | Releases the answer key at 16:00 | Take part in the drill |

## Gates

| Gate | Condition | Logged in |
|---|---|---|
| **G0** | Before 11:30: start SHA; `policyengine-uk` version; dataset name and SHA-256; whether that pair is validated; the live household API version | clock table |
| **G1** | Every statement measure is **coded** or a **ledger** row, with a reason | coverage ledger |
| **G2** | Provisional, statement-based. Each coded measure with a statement figure has a reconciliation row, and one hand-checked household | reconciliation |
| **G3** | Re-based on Annex A. Each national row has our static figure, its basis (gross or net; duty only or VAT-inclusive; fiscal or calendar) and an explanation class for any gap over 10% | national scoring sheet |
| **G5** | After the 14:20 notice: the affected measures are re-run, the changed rows re-pinned to the new SHA, and the old run marked superseded | clock table, both sheets |
| **G4** | Full page on the drill-only preview, with the MOCK banner and noindex | clock table |

## Scoring at 16:00

| Part | What is scored | Weight |
|---|---|---|
| Households | `team_change` against the statutory key, to the penny (±1p) | 30% |
| National | Our figure's basis matches the costing's stated basis, and the explanation class matches the key's class | 40% |
| Ledger | Each Table 4.1 line is classified correctly as coded or ledger, with the right reason | 15% |
| Process | Gates met on time; one SHA per scoring run; correction re-run logged | 15% |

### Explanation classes (closed list)

`behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`, `none_expected`.

## Packet

The packet is in `data_inputs/mock_drill3/packet/`. **Don't open the 12:30 file before 12:30, the 13:40 files before 13:40, or the 14:20 file before 14:20.** The answer key is **not** in the repository. Check each file with `shasum -a 256 <file>`.

| Release | File | SHA-256 |
|---|---|---|
| 12:30 | `MOCK-statement.md` | `d4c528d5d762bcc6a20766daa48aef759478a1a6295bcb2ce6b4eb80bdde3eac` |
| 13:40 | `MOCK-policy-decisions.xlsx` (Table 4.1) | `b0293b0774b12c90652f7303add32480ebc0bf28c0805d87313dcc577cb48ee2` |
| 13:40 | `MOCK-policy-costings.md` (with Annex A) | `bbc8e2d57adb328ebde9c94fd818256b385785d0e41abf29d0b4fc85a66d2725` |
| 13:40 | `MOCK-obr-economy-forecast.xlsx` | `4e0736b137658fcaf091d2a1a3aef358270924e447999059cd75e820851d57e4` |
| 13:40 | `MOCK-specimen-inputs.md` | `0f1fd8b0b688323d42e115171a2b14190865c19b6cb22d65ef7a092971fbd1c6` |
| 13:40 | `MOCK-drill3-scoring.csv` (households, blank) | `90edcd36301367e03d50215683bc0211897274192d9fb68c43bd2fe6df8de8ef` |
| 13:40 | `MOCK-drill3-national-scoring.csv` (national, blank) | `8b35462aee5c71face925a5cee179d16c763448faf7cdbcb7931a28a4880b057` |
| 14:20 | `MOCK-obr-correction-notice.md` | `3b8d9b24de1cd6cb610497b5da4909d550628011023e5fb1051dec2a87f6809e` |
| 16:00 | `MOCK-drill3-answer-key-households.csv` (sealed) | `a9b8d646a12860a1396a9d9f1973a82136426dc593fc59f4323feaf9dd0026d5` |
| 16:00 | `MOCK-drill3-answer-key-national.csv` (sealed) | `2ae4ecd5c9ff40f195df31c1fd94a826a8e6fbb104491096eee1c14503a1bae6` |
| 16:00 | `MOCK-drill3-answer-key-ledger.csv` (sealed) | `5b1f5250faa8b0556f5ee7141fde707ad6630b59817d11a7b52455d6d20a7e36` |

**Packet shape:** 19 Table 4.1 lines (10 coded, 9 ledger), 12 specimen households across all four nations, a six-year forecast window (2026-27 to 2031-32), and a 14:20 correction notice. The household key has 168 rows, including one row per household that scores a pair of measures together. The national key has 61 rows and the ledger key 21. The 14:20 notice changes one household value and one costing figure; the keys record both the 13:40 and corrected values, so the scorer can see whether the team re-ran.

The key holder keeps the generator and answer key outside the repository. Two runs of the generator give byte-identical files, and an independent recalculation of every household value agrees to the penny.

**Templates** in `data_inputs/mock_drill3/`: `MOCK-drill3-coverage-ledger.csv` and `MOCK-drill3-reconciliation.csv` (as in drill 2). The national scoring sheet comes with the 13:40 release.

## Real research for 28 October (not MOCK)

- [`docs/autumn-budget-2026-candidate-reforms.md`](docs/autumn-budget-2026-candidate-reforms.md): 24 candidate measures with sources, likelihood, cost and how PolicyEngine would model them, as of 8 October.
- [`docs/budget-day-model-risk-register.md`](docs/budget-day-model-risk-register.md): 15 places where the UK model and data most need challenging, with evidence from the scorecard and drill 2.

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| G0 freeze record | | |
| Drill start: statement released | | |
| G1 measure list locked | | |
| G2 first numbers (preview URL) | | |
| Documents released | | |
| G3 re-based; national sheet filled | | |
| Correction notice released | | |
| G5 correction re-run and re-pinned | | |
| G4 full page on preview (preview URL) | | |
| Scoring runs, one SHA each (list them; mark the one matching the stop) | | |
| Stop | | |
| Answer key released | | |
