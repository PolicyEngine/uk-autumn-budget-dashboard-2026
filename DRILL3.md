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
| **Key holder: Claude Code on Vahid's machine** (`~/drill3-sealed/sealed_v2/`, confirmed 12 Oct) | Releases the answer key at 16:00: commits the three keys to the packet folder and posts the hashes on PR #9 | Take part in scoring. Vahid does not open the sealed folder before 16:00 |

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

`behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`, `takeup_caseload`, `none_expected`. (`takeup_caseload` matches the list in the released specimen file.)

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
| 16:00 | `MOCK-drill3-answer-key-households.csv` (sealed, revised 12 Oct) | `b8d04a8b13e8e594d7ad32e699e8c94a0845ef0b1456df01ff574af90f49652d` |
| 16:00 | `MOCK-drill3-answer-key-national.csv` (sealed, revised 12 Oct) | `960f0b2b368b38d9a25b8c67a0527f492971c5967b1aa612c7a80d95f075e6de` |
| 16:00 | `MOCK-drill3-answer-key-ledger.csv` (sealed, revised 12 Oct) | `d3a9821b0f46b9317b9cc4f7fa534b668fe79597f048e54402f20f2d1627feb6` |

**Packet shape:** 20 Table 4.1 lines (11 coded, 9 ledger), 14 specimen households across all four nations, a six-year forecast window (2026-27 to 2031-32), and a 14:20 correction notice. The blank household sheet has 172 rows: the original 168 plus four dedicated pension-cap cases. The blank national sheet has 67 rows: the original 61 plus six years for measure 20. The data release also contains a projection series, eight independent pension diagnostic records, band-relief targets and a blank before/after evidence template. The 14:20 notice changes the same household value and costing as before; the revised keys must record both releases so the scorer can see whether the team re-ran.

The key holder keeps the generator and answer keys outside the repository. **The answer keys were regenerated on 12 October from the revised packet (`4501ed0`); the earlier key hashes are superseded.** The keys cover 172 household rows (1 correction-version row), 67 national rows (2 correction-version rows) and the 20 Table 4.1 lines (plus 2 baseline-only rows with no weight). Two builds give byte-identical keys, and an independent recalculation of every household value agrees to the penny. The spoiler-free attestation (inventories, identifiers, hashes, checks) is posted on PR #9.

**Templates** in `data_inputs/mock_drill3/`: `MOCK-drill3-coverage-ledger.csv` and `MOCK-drill3-reconciliation.csv` (as in drill 2). The national scoring sheet comes with the 13:40 release.

## Real research for 28 October (not MOCK)

- [`docs/autumn-budget-2026-candidate-reforms.md`](docs/autumn-budget-2026-candidate-reforms.md): 24 candidate measures with sources, likelihood, cost and how PolicyEngine would model them, as of 8 October.
- [`docs/budget-day-model-risk-register.md`](docs/budget-day-model-risk-register.md): 15 places where the UK model and data most need challenging, with evidence from the scorecard and drill 2.

## Setup acceptance

Friday setup remains **unconfirmed** until the participants fill every required field below. A blank field blocks sign-off. This table records operator evidence; no check below has already passed for drill 3.

| Required evidence | Owner | Record / acceptance |
|---|---|---|
| Key holder | key holder | **Confirmed 12 Oct:** Claude Code on Vahid's machine holds `sealed_v2/` and releases it at 16:00. Not fully independent, because it runs on the integrator's machine; Vahid has not opened the sealed folder, and the release is logged with hashes on PR #9 |
| Custody of all three sealed keys; published hashes match; two generator runs agree; independent household recalculation agrees to ±1p; correction versions and row inventories checked | key holder | **UNCONFIRMED**; spoiler-free attestation, time and receipt |
| Exact 16:00 BST delivery route and recipient | key holder, María | **UNCONFIRMED**; private attachment route; verify hashes on receipt |
| Chosen model/core and dataset name/SHA-256; certification receipt or explicit unvalidated-publication plan | Vahid, María | **Chosen 12 Oct 09:30:** policyengine.py 6.2.7, policyengine-uk 2.125.1, core 3.33.0 (latest). Dataset: latest released Microcosm national file `microcosm_uk_2024_25.h5`, SHA-256 `aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af` (HF revision `9d4a76ba`, release `microcosm-uk-2024-25-national`, built under UK 2.100.0; no newer national release exists). Not a certified pair, so every national figure is labelled **unvalidated under this engine**. `verify_runtime` and `verify_dataset` pass |
| Signed-in drill-only preview: URL/deployment SHA, MOCK banner, robots meta and X-Robots-Tag `noindex, nofollow`, matching backend version and baseline-only HTTP 200 | Vahid, María | **UNCONFIRMED**; record health versions and empty-selection response; Vercel login alone does not pass |
| Rubric SHA, denominators/row-version inventory and equivalent-class acceptance sets frozen without revealing answers | María, key holder | **UNCONFIRMED**; see scoring rubric |
| Revised packet/key alignment: measure 20, H13/H14, CGT data assumptions, unchanged correction cases and replacement hashes | key holder | **Done 12 Oct**: keys regenerated against all 13 revised release files (hashes verified); totals, costings, data inputs and household facts consistent; replacement hashes in the packet table |
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
| G0 freeze record | 10:23 | Setup commit `092a916` (empty registries; reset; pre-start PASS). Runtime policyengine.py 6.2.7 / policyengine-uk 2.125.1 / core 3.33.0. Dataset `microcosm_uk_2024_25.h5` sha256 `aa31bdf6…88af` (HF `9d4a76ba`, built under UK 2.100.0): **unvalidated pair**, national figures labelled. Local household API healthy on 2.125.1, baseline-only HTTP 200 (2025–2031). Rubric sha256 `c365c30d408f…`. Preview deployed for `092a916` (Vercel ready, noindex header); signed-in banner and hosted-calculator check still open |
| Drill start: statement released | 12:30:07 | Start SHA `212f3dc`; `MOCK-statement.md` opened at 12:30:07 BST (sha256 verified `69c93e92…`) |
| G1 measure list locked | 12:53:31 (late; due 12:45) | María locked ledger commit `c4a384e` on PR #9: 20 lines, 11 coded (1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13), 9 ledger; no changes |
| G2 first numbers (preview URL) | 13:14:41 | Code/data `4e6dfb1` (policy source identical to generation SHA `9bd9e3f`; data `c857e96`); María's 11 hand-checked households confirmed on PR #9; statement reconciliation rows present; preview https://uk-autumn-budget-2026-drill-git-drill3-moc-483daf-policy-engine.vercel.app (Vercel ready, SSO, `x-robots-tag: noindex`). Qualifications: provisional statement/native baselines; fuel calendar-year VAT-inclusive; national figures unvalidated under this engine; API BRMA input and form salary-sacrifice field open; signed-in banner/calculator smoke open |
| Documents released | 13:40:14 | 13:40 files opened at 13:40:14 BST (hashes verified before release); code at release `83dd174` |
| G3 re-based; national sheet filled | 14:11 (late; due 14:10) | Code `4b72684` (all 11 rebased on Annex A except LHA baseline: engine April 2024 vs Annex A April 2025); data + prefilled national sheet `a71a742` (`MOCK-drill3-national-scoring-run1.csv`, classes PROPOSED for María). Ledger re-locked by María on Table 4.1 numbering at 14:10:46 (`e004ff9`; line 1 `constructed_counterfactual` confirmed); released-basis ledger wording updated after. Household_scatter resampled across all reforms after the shard merge; validator passes 11 × 6 |
| Correction notice released | 14:20:05 | `MOCK-obr-correction-notice.md` opened at 14:20:05 BST (hash verified before release). Affects measure 8 (CGM 2-bed baseline £985.00, national costing unchanged) and measure 3 (caseload 5.1m/5.2m; costing −510/−520). Run 1 (code `4b72684`) to be superseded by a complete run 2 on a new SHA |
| G5 correction re-run and re-pinned | 14:37 | Run 2 complete on code `619dc67`, data + sheet `8aef1c1` (`MOCK-drill3-national-scoring-run2.csv`, receipt `drill3-run2-receipt.json`): measures 1, 3, 7, 8, 10, 20 re-run; 2, 4, 5, 6, 9 carried forward with code-diff receipt. Run 1 (`4b72684`) preserved and SUPERSEDED. Household sheet for run 2 with María |
| G4 full page on preview (preview URL) | 14:38 | Preview for `165675b` (run 2 data) deployed (Vercel success): https://uk-autumn-budget-2026-drill-git-drill3-moc-483daf-policy-engine.vercel.app — SSO, `x-robots-tag: noindex`; María confirmed signed-in MOCK banner, all 11 measures and `noindex, nofollow` (PR #9, 14:28). Validator passes 11 × 6. Qualification: hosted Personal impact needs `BUDGET_API_URL` (pinned backend not configured); household checks via local pinned API. Household scoring sheet with María |
| Scoring runs, one SHA each (list them; mark the one matching the stop) | | Run 1: code `4b72684` (13:40 release), superseded at G5. Run 2: code `619dc67` (after 14:20 correction), current |
| Stop | | |
| Answer key released | | |
