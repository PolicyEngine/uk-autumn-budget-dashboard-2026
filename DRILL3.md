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
| CGT forward projections and salary-sacrifice calibration still need implementation work | The revised packet includes both reforms, national data inputs, bracket-crossing pension cases and a before/after evidence template. Data-repair checks inform the debrief; they add no gate or points |

## Timetable (BST)

| Time | What | Who |
|---|---|---|
| Fri 9 Oct | Setup: engine and data pair chosen, drill branch ready, preview checked | integrator, reconciler |
| Mon 12 Oct, 10:00–11:30 | Remove the drill 2 `mock2_*` measures; regenerate the empty data; write G0 | integrator |
| **12:30** | **Statement released** (`MOCK-statement.md`). Drill clock starts | open from the packet folder |
| 12:30–12:45 | G1: lock the measure list and coverage ledger from the statement | reconciler |
| 13:15 target | G2: provisional first numbers (statement-based) | integrator |
| **13:40** | **Documents released:** Table 4.1, costings with Annex A, OBR tables, specimen households, scoring sheets and national data-work inputs | open from the packet folder |
| 13:40–14:10 | G3: re-base on Annex A; national scoring sheet filled | integrator, then reconciler |
| **14:20** | **OBR correction notice released** (`packet/MOCK-obr-correction-notice.md`). Re-run what it touches | integrator |
| 14:20–14:50 | G5: preserve the first run; create complete corrected sheets on one new SHA; rerun affected rows and verify any carry-forward | integrator, scorer |
| 14:50 target | G4: full page on the drill preview; household and national sheets complete | all |
| **15:30** | **Stop.** Log the stop commit | integrator |
| 16:00 | Answer key released and scored | key holder, then scorer |

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | The drill branch, every commit, data regeneration, preview deploys, re-basing, the clock table | Score households, or see the packet before release |
| **Reconciler, then scorer** (María) | G1 ledger, the reconciliation, the national scoring sheet, then the household scoring sheet (one SHA per run) | Push code |
| **Independent key holder — UNCONFIRMED (Friday blocker)** | Releases the answer key at 16:00 | Take part in the drill |

## Gates

| Gate | Condition | Logged in |
|---|---|---|
| **G0** | Before 11:30: start SHA; `policyengine-uk` version; dataset name and SHA-256; whether that pair is validated; the live household API version | clock table |
| **G1** | Every statement measure is **coded** or a **ledger** row, with a reason | coverage ledger |
| **G2** | Provisional, statement-based. Each coded measure with a statement figure has a reconciliation row, and one hand-checked household | reconciliation |
| **G3** | Re-based on Annex A. Each national row has our static figure, its basis (gross or net; duty only or VAT-inclusive; fiscal or calendar) and an explanation class for any gap over 10% | national scoring sheet |
| **G5** | After the 14:20 notice: preserve the old run, complete a new single-SHA run, rerun affected measures, verify unchanged-row carry-forward and mark the old run superseded | clock table, both sheets |
| **G4** | Full page on the drill-only preview, with the MOCK banner and noindex | clock table |

The [unsealed scoring rubric](docs/drill3-scoring-rubric.md) defines complete runs, carry-forward evidence, denominators, partial credit and process points. Freeze its SHA at G0.

Both selected data tasks are part of the Monday implementation exercise. The packet supplies a CGT projection path and salary-sacrifice calibration inputs, with a before/after results template. The integrator attempts the data changes and rescores under the existing clock. Evaluate the diagnosis, artifact provenance, fixed assumptions and checks during the debrief. **There is no additional data-repair gate or scoring weight.** Preflight national data and pipeline access and a practical incremental rebuild route during setup; a small diagnostic fixture alone does not establish a national data repair.

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
| 12:30 | `MOCK-statement.md` | `69c93e92ec63069ffd191f6e90c4d6d9a05ad3e74269e453e12cccdf42870f57` |
| 13:40 | `MOCK-policy-decisions.xlsx` (Table 4.1) | `649d4eb246b552847441059d7429365b6b4b54f3337dc33e1e92c5b2ace04f5f` |
| 13:40 | `MOCK-policy-costings.md` (with Annex A) | `6edc9e1111303c4baf9e23d05b9fcd9c0733df444d890fe1e2f65a401a17e190` |
| 13:40 | `MOCK-obr-economy-forecast.xlsx` | `d00c6c2a5a00b9c7aa4633573f18806e5db8190081fb2778b8631a973caabcd4` |
| 13:40 | `MOCK-specimen-inputs.md` | `ef3ec5520ae4845e51863bf07f536ef4eb239fe6990dfb6e521442c9ba226051` |
| 13:40 | `MOCK-drill3-scoring.csv` (households, blank) | `ffb3ec4bfdd64b18cac4a4b9c9824ab3032e9157ae27a381924c0f7c33ab3819` |
| 13:40 | `MOCK-drill3-national-scoring.csv` (national, blank) | `5ed8c18a89276629de47ba99410031e83b5909cc28d7a3ff7556072dca1bffc3` |
| 13:40 | `MOCK-cgt-projection-inputs.csv` | `484f7f549ab546dcda47043307eeba88a7c35d6cdf5e66bb7c88f1d280a7fa50` |
| 13:40 | `MOCK-data-work-results.csv` | `87278919e156a66735196584e3faee1524d1f53cd3aed94f9882dd8d423e8d4c` |
| 13:40 | `MOCK-data-work.md` | `be05e2b880450ab77f37e07131d7c9b3f4aff61e7182ab93a6ba62441db4cf5d` |
| 13:40 | `MOCK-salary-sacrifice-records.csv` | `ddddaf300436bb5db2e2d7bd88b2be07c5ebec3e3f57c74f493e488f05b31d37` |
| 13:40 | `MOCK-salary-sacrifice-targets.csv` | `401672cedea7fefb4da13d0e03aaec502996d2c7643e864fa121b9d28657061d` |
| 14:20 | `MOCK-obr-correction-notice.md` | `74412d4e0428e418ac510f1edd9dc7c30b53f869927d2ab5d6b57f5082c55957` |
| 16:00 | `MOCK-drill3-answer-key-households.csv` (sealed) | **PENDING — regenerate for revised packet** |
| 16:00 | `MOCK-drill3-answer-key-national.csv` (sealed) | **PENDING — regenerate for revised packet** |
| 16:00 | `MOCK-drill3-answer-key-ledger.csv` (sealed) | **PENDING — regenerate for revised packet** |

**Packet shape:** 20 Table 4.1 lines (11 coded, 9 ledger), 14 specimen households across all four nations, a six-year forecast window (2026-27 to 2031-32), and a 14:20 correction notice. The blank household sheet has 172 rows: the original 168 plus four dedicated pension-cap cases. The blank national sheet has 67 rows: the original 61 plus six years for measure 20. The data release also contains a projection series, eight independent pension diagnostic records, band-relief targets and a blank before/after evidence template. The 14:20 notice changes the same household value and costing as before; the revised keys must record both releases so the scorer can see whether the team re-ran.

The key holder keeps the generator and answer keys outside the repository. **The previous three key hashes are superseded by this packet revision.** The original key bundle/generator was unavailable to the packet editor, so no revised-key determinism or household attestation is claimed. Before release, the key holder must add the four H13/H14 rows, six measure 20 national rows and its ledger classification; check CGT explanations against the revised projection exercise, costing bases, correction versions and updated totals; then publish replacement hashes and physical/version-aware inventories. Regeneration must give byte-identical files in two runs, with an independent household recalculation to ±1p. Keep all answers outside this repository.

**Templates** in `data_inputs/mock_drill3/`: `MOCK-drill3-coverage-ledger.csv` and `MOCK-drill3-reconciliation.csv` (as in drill 2). The national scoring sheet comes with the 13:40 release.

## Real research for 28 October (not MOCK)

- [`docs/autumn-budget-2026-candidate-reforms.md`](docs/autumn-budget-2026-candidate-reforms.md): 24 candidate measures with sources, likelihood, cost and how PolicyEngine would model them, as of 8 October.
- [`docs/budget-day-model-risk-register.md`](docs/budget-day-model-risk-register.md): 15 places where the UK model and data most need challenging, with evidence from the scorecard and drill 2.

## Setup acceptance

Friday setup remains **unconfirmed** until the participants fill every required field below. A blank field blocks sign-off. This table records operator evidence; no check below has already passed for drill 3.

| Required evidence | Owner | Record / acceptance |
|---|---|---|
| Independent key holder (full name and contact) | key holder | **UNCONFIRMED — supply a nonparticipant before Friday sign-off** |
| Custody of all three sealed keys; published hashes match; two generator runs agree; independent household recalculation agrees to ±1p; correction versions and row inventories checked | key holder | **UNCONFIRMED**; spoiler-free attestation, time and receipt |
| Exact 16:00 BST delivery route and recipient | key holder, María | **UNCONFIRMED**; private attachment route; verify hashes on receipt |
| Chosen model/core and dataset name/SHA-256; certification receipt or explicit unvalidated-publication plan | Vahid, María | **UNCONFIRMED**; retaining UK 2.120.0 with the UK 2.100.0-built data requires “unvalidated under this engine” on every national figure |
| Signed-in drill-only preview: URL/deployment SHA, MOCK banner, robots meta and X-Robots-Tag `noindex, nofollow`, matching backend version and baseline-only HTTP 200 | Vahid, María | **UNCONFIRMED**; record health versions and empty-selection response; Vercel login alone does not pass |
| Rubric SHA, denominators/row-version inventory and equivalent-class acceptance sets frozen without revealing answers | María, key holder | **UNCONFIRMED**; see scoring rubric |
| Revised packet/key alignment: measure 20, H13/H14, CGT data assumptions, unchanged correction cases and replacement hashes | key holder | **PENDING — original off-repository generator and keys must be updated before release** |
| Participant role and Monday release/stop times acknowledged | Vahid, María, key holder | **UNCONFIRMED**; names and time |

The household API uses the pinned Python backend for the drill. The legacy public-API adapter retains its historical horizon and is outside drill scoring. Friday preview testing may use an empty policy selection before Monday registry removal.

### Monday empty-state reset and G0

During the scheduled **10:00–11:30 BST** setup, Vahid empties the active backend list in `src/uk_budget_data/reforms.py` and the frontend `POLICIES` array in `src/utils/policyConfig.js`. Keep historical definitions for shared links. Change the backend list to `[]` and the frontend declaration to `export const POLICIES = [];`; update validator policy defaults and registration assertions for that empty state. Do not perform this removal before Monday.

From the repository root, with the pinned environment already available:

```sh
uv run uk-budget-data reset --check-only
uv run uk-budget-data reset
uv run python scripts/validate_published_data.py --pre-start
uv run pytest tests/test_drill_setup.py tests/test_cli.py tests/test_reset_drill_data.py
bun run test
```

The reset requires both active registries empty, checks every named generated CSV before writing, and preserves each header. It resets the seven national CSVs plus `constituency.csv` and `demographic_constituency.csv`; geography, unknown files and private inputs remain intact. If the validator finds another generated CSV, inspect and clear its result rows explicitly; do not delete unknown files. The numerical `generate` command remains a post-release operation and rejects an empty registry.

After the empty-state check and preview smoke pass, commit the setup and record its final SHA externally in G0 by **Monday 11:30 BST**, with the runtime/data receipt and rubric SHA. A commit cannot contain its own final SHA. After G1, register only released measures and pass their IDs explicitly to publication validation:

```sh
uv run uk-budget-data generate --dataset /path/to/pinned.h5 --output-dir /tmp/drill3-stage --reforms <locked IDs> --years 2026 2027 2028 2029 2030 2031
uv run python scripts/validate_published_data.py /tmp/drill3-stage --policies <locked IDs> --years 2026 2027 2028 2029 2030 2031
```

### Terminal-year scoring route

The shared policy horizon covers 2026–2031. The MOCK household API defaults to base year 2025 and all six policy years, and accepts ordered unique `years` through 2032. For boundary work, send the released household inputs with `"years": [2031, 2032]` and the relevant released `policy_ids`. The UI reports the six policy years and excludes boundary diagnostics from its cumulative total.

These API results retain the engine's annual mixed basis (`period_basis=engine_annual_mixed`, `fiscal_conversion_applied=false`). Native fiscal variables keep their engine treatment. For a separately justified calendar-only measure with even monthly incidence, the opt-in `calendar_to_fiscal_even_months({2031: annual_2031, 2032: annual_2032}, 2031)` helper uses nine months from 2031 and three from 2032. It rejects a missing 2032 value. Never apply it to whole household net income or a native fiscal result. Dated/nonuniform measures require their actual April–March month schedule and a documented measure-specific comparator; record that method in the sheets.

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
