# Drill 2: mock Autumn Budget, Monday 5 October 2026

MOCK DATA. Rehearsal only; nothing here is a real Budget. Do not merge.

Drill 1 ([PR #4](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/4)) had five measures. Its retrospective is [issue #6](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/6). Drill 2 changes four things:

- The Table 4.1 is longer and more realistic.
- The packet is released at set times from a sealed set.
- The roles are split three ways.
- A reconciliation gates every release of numbers: first against the statement (G2), then against Table 4.1 (G3).

## Timetable (BST)

| Time | What | Who |
|---|---|---|
| By Mon 5 Oct, 10:00 | Pre-drill checklist below done or explicitly accepted | Vahid, María |
| 10:00–12:00 | Setup only: remove the five drill 1 `mock_*` measures; G0 freeze record; preview check; roles confirmed. No drill 2 measures coded | all |
| **12:30** | **Statement released** (`MOCK-statement.md`). Drill clock starts | open from the packet folder |
| 12:30–12:45 | Lock the measure list and the coverage ledger rows from the statement | reconciler |
| 13:15 target | Provisional first numbers, gated by G2 (statement figures only) | integrator |
| **13:40** | **Documents released:** Table 4.1, costings with Annex A, OBR tables, specimen households, scoring sheet | open from the packet folder |
| 13:40–14:00 | Re-base on Annex A and the OBR tables (**one owner, the integrator**) | integrator |
| 14:30 target | Full page on the drill preview; reconciliation filled; scoring sheet filled | all |
| **15:30** | **Stop.** Log the stop commit | integrator |
| 16:00 | Answer key attached to PR #7 by Vahid, who holds it; scoring against it | Vahid, then the scorer |

## Roles

One person per role. Nobody else pushes to the drill branch.

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | The drill branch, the clock table, every commit, data regeneration, preview deploys, re-basing | Score households |
| **Reconciler** (María, until 13:40) | The locked measure list, the coverage ledger, `MOCK-drill2-reconciliation.csv`, decile plausibility checks. Posts each defect as a PR comment within 5 minutes of finding it | Push code; review comments go to the integrator |
| **Scorer** (María, from 13:40) | Runs the specimen households. Each scoring run is pinned to **one commit SHA** written in the sheet. If the integrator later changes a scored measure, the affected rows are rerun on the new SHA. Fills the scoring sheet on the stated basis | Edit reform code |

If only two people are available, the reconciler and scorer roles are one person, but reconciliation comes first.

## Gates

| Gate | Condition | Logged in |
|---|---|---|
| **G0** | Freeze record written before 12:30: the start commit SHA, `policyengine-uk` version, dataset name and SHA-256, constituency weights present or explicitly absent, and the live household API version | the clock table below |
| **G1** | Measure list locked from the statement: each measure is either **coded** or a **ledger row**, with a reason | `MOCK-drill2-coverage-ledger.csv` |
| **G2** | **Provisional, statement-based.** No first numbers on the preview until (a) every coded measure with a figure in the statement has a reconciliation row against it, with `comparator` = `statement`, and (b) one specimen-style household has been checked by hand for each coded measure. A measure with no statement figure may go on the preview only if it is marked "awaiting Table 4.1". The full comparison waits for G3 | `MOCK-drill2-reconciliation.csv` |
| **G3** | Re-based on Annex A; every reconciliation row filled against Table 4.1 and the static costing. Each gap over 10% has a written reason | `MOCK-drill2-reconciliation.csv` |
| **G4** | Full page: all coded measures on the preview with the MOCK banner, noindex, and the drill-only Vercel project | the clock table below |

## Coding order

Code in waves:

1. Parameter changes.
2. Simulation modifiers and input changes.
3. Anything needing a new variable.

Ledger-only rows go to the reconciler at G1.

## Preview and MOCK hygiene

- **Deploy target:** the drill-only Vercel project `uk-autumn-budget-2026-drill` only. Its protection is team login, and `NEXT_PUBLIC_MOCK=1` is set in every environment.
- **Deploy command:** `vercel deploy --target preview`. Never `--prod`, and never the dashboard's public URL.
- **Check before 12:30:** the MOCK banner, `noindex, nofollow` (both meta and header), and the Personal impact route returning a result.

## Pre-drill checklist (fix or accept by 10:00 Monday)

**Blocker:** the engine choice. Option (a) is cheap: freeze all four NICs thresholds in any pinned baseline. **Accept and label by default:** the fuel duty VAT base, HVCTS on renters, and the fiscal-year option. An item still open on Monday is recorded as accepted, not as a failure.

These are carried over from drill 1 (issue #6 and María's drill 1 evaluation on PR #4).

- [ ] **Engine version.**
  - **Option (a):** stay on `policyengine-uk` 2.90.2, and freeze **all four** NICs thresholds (PT, LPL, UEL, UPL) in any baseline that pins them. This avoids [policyengine-uk#1878](https://github.com/PolicyEngine/policyengine-uk/issues/1878).
  - **Option (b):** upgrade to ≥ 2.102.1 **and** confirm the live household API moves with it. The Personal impact adapter checks the version.
  - Write the choice in G0.
- [ ] **Fuel duty VAT base.** Decide whether the dashboard's national figure is duty-only, VAT-inclusive, or both. Table 4.1 is duty-only; specimen households are VAT-inclusive. Drill 1 put VAT on every litre, business fuel included, which put fuel 18–28% above Table 4.1.
- [ ] **HVCTS on renters.** Either gate the national surcharge on owner tenure, or accept and label it. Drill 1 charged about 27,000 private-renter households, and only the Personal impact path was fixed.
- [ ] **Fiscal-year option.** The household path returns calendar-year amounts for monthly-dated measures (fuel duty, VAT). Either add a fiscal-year option, or **accept the exception**: the scorer converts by even monthly proration and records the method in `cause`.
- [ ] **Measure templates.** Have the templates ready from drill 1: rate change, threshold change, freeze to a date, monthly duty path, VAT base modifier, lump-sum payment by benefit receipt, and an age-conditioned allowance. Also keep the checklist of every file a measure touches:
  - `reforms.py`
  - `policyConfig.js`
  - `personalImpactApi.ts`
  - `personal_impact.py`
  - the validator
  - the tests
- [ ] **Start point.** Drill 2 starts from this branch. In the setup window, before 12:30, remove the five drill 1 `mock_*` measures **together with** the validator's measure selections and the generated `public/data` CSVs. Remove them from `reforms.py`, `policyConfig.js`, the Personal impact files and `scripts/validate_published_data.py`. Run the tests and the validator on that commit, and record it as the G0 start commit.
- [ ] **Dataset.** Name and hash the enhanced FRS H5 used for the national run. Constituency weights are present, or the constituency tab is explicitly marked unavailable.

## Packet

The packet is in `data_inputs/mock_drill2/packet/`. **Don't open the 12:30 file before 12:30 or the 13:40 files before 13:40.** The answer key is **not** in the repository. Vahid holds it (`~/drill2-sealed/sealed/`). He attaches it to PR #7 at 16:00 and logs the time in the clock table, and the scorer checks its hash before scoring. Check every file against its hash with `shasum -a 256 <file>`.

| Release | File | SHA-256 |
|---|---|---|
| 12:30 | `MOCK-statement.md` | `b4a3b47e44dc368dcd4280fcb23c5460aa64efe28f186b8e835ba185f9fe1018` |
| 13:40 | `MOCK-policy-decisions.xlsx` (Table 4.1) | `2b629b26e7d96e77530bffb47324e820df8aadecdeed2d308f62f12b120c3bd9` |
| 13:40 | `MOCK-policy-costings.md` (with Annex A) | `a9dcfac6edc53c0377d79f4bca63406f875d81f571effeba1a7fb940f5170768` |
| 13:40 | `MOCK-obr-economy-forecast.xlsx` (Tables 1.6 and 1.7) | `d96e885c7aa514aef9e941a850b1e42ab589b0146a9c4b278c4937e0694f0c85` |
| 13:40 | `MOCK-specimen-inputs.md` | `4f2474d1b76332ed988da66782fb5498d90771b66b8ae4897f06b23671402b24` |
| 13:40 | `MOCK-drill2-scoring.csv` (blank) | `dc9be77c7764155c96ead37a673140d41190cf7cfcb3827d6ea45b9641082e28` |
| 16:00 | `MOCK-drill2-answer-key.csv` (sealed) | `f60f7a509bee986497a5bba012a246152acbb169646249e98705d18a7bf9a36f` |

The specimen file states the scoring basis once: fiscal years, each measure on its own against Annex A, static, and fuel duty including VAT on the duty change.

## Templates in this PR

`data_inputs/mock_drill2/`:

- `MOCK-drill2-coverage-ledger.csv`: one row per Table 4.1 line, with status `coded` or `ledger`. The first data line records the scored commit, engine version and dataset hash.
- `MOCK-drill2-reconciliation.csv`: one row per coded measure and fiscal year. It sets our static figure against the Table 4.1 post-behavioural figure and the costing's static figure, with the gap and its reason. It replaces the blank `obr_comparison.csv` from drill 1.

Filled copies of the scoring sheet, ledger and reconciliation are committed here after the stop.

## Clock

| Event | Time (BST) | Commit |
|---|---|---|
| G0 freeze record: `policyengine-uk` version; dataset and SHA-256; API version | | |
| Drill start: statement released | | |
| G1 measure list locked | | |
| G2 first numbers (preview URL) | | |
| Documents released | | |
| G3 re-based and reconciled | | |
| G4 full page on preview (preview URL) | | |
| Scoring runs, one SHA each (list them; mark the one matching the stop) | | |
| Scoring sheet complete | | |
| Answer key attached (16:00) | | |
| Stop | | |
