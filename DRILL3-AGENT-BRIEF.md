# Drill 3 agent brief: run the integrator role (Monday 12 October 2026)

MOCK DATA rehearsal. Read this first, then [DRILL3.md](DRILL3.md) and [docs/drill3-scoring-rubric.md](docs/drill3-scoring-rubric.md). You are the **integrator**. María (`juaristi22`) is the reconciler and then the scorer. Setup (G0) is already done. Do not redo it.

## Hard rules

1. **Release times are real clock times (BST).** Check with `date` before opening anything.
   - `MOCK-statement.md`: open no earlier than **12:30**.
   - The 13:40 files: open no earlier than **13:40**. These are Table 4.1, the costings, the OBR workbook, the specimen inputs, both blank scoring sheets, and the data-work files (`MOCK-cgt-projection-inputs.csv`, `MOCK-salary-sacrifice-*.csv`, `MOCK-data-work*.{md,csv}`).
   - `MOCK-obr-correction-notice.md`: open no earlier than **14:20**.

   Until a file's time, don't read, grep, hash-print or summarise it. The only exception is checking hashes with `shasum -a 256 -c`, which prints names only.
2. **Never open `~/drill3-sealed/`.** It holds the answer key, which is released separately at 16:00.
3. **Branch:**
   - push only to `drill3-mock-budget` (PR #9);
   - never merge;
   - never use `--prod`;
   - every push deploys the drill-only Vercel preview.
4. **Don't edit packet files.** Score nothing: household and national scoring is María's job.
5. **Communicate with María on PR #9** (`gh pr comment 9`): post defects, SHAs and gate times there. Answer her review points by number.
6. **One SHA per scoring run.** After the 14:20 correction, a new complete run goes on a new SHA, and the old run is marked superseded.
7. **Label national figures "unvalidated under this engine".** The runtime and dataset are not a certified pair (see G0 in DRILL3.md).

## Environment (already set up)

- **Repo:** `~/uk-autumn-budget-dashboard-2026`, branch `drill3-mock-budget`. Run `git pull` first.
- **Python:** `uv run …`, pinned to policyengine.py 6.2.7, policyengine-uk 2.125.1 and core 3.33.0. Do not upgrade.
- **Dataset:**
  - path: `~/drill2-data/microcosm_uk_2024_25.h5`;
  - SHA-256 `aa31bdf6…88af`;
  - set `UK_BUDGET_DATASET` to that path, or pass `--dataset`.
- **Checks:**
  - `uv run python -c 'from uk_budget_data.drill_setup import verify_runtime, verify_dataset; print(verify_runtime(), verify_dataset())'`
  - `uv run python scripts/validate_published_data.py --pre-start`, which must pass before 12:30.
- **Local household API** (for hand checks):

  ```sh
  NEXT_PUBLIC_MOCK=1 PORT=8000 UK_BUDGET_DATASET=~/drill2-data/microcosm_uk_2024_25.h5 uv run uk-budget-api
  ```

  Then `POST localhost:8000/api/personal-impact` with `{"policy_ids":[...], ...inputs}`. Pass `"years":[2031,2032]` for terminal-year work.
- **Preview:** https://uk-autumn-budget-2026-drill-git-drill3-moc-483daf-policy-engine.vercel.app (team login). Get the deploy status with `gh api repos/PolicyEngine/uk-autumn-budget-dashboard-2026/commits/<sha>/status`.
  - The signed-in banner check and the hosted household calculator are **not yet verified**.
  - If the hosted Personal impact errors, use the local API for household checks, and note this on PR #9.
- **Measure templates and files each measure touches:**
  - [docs/drill2-measure-templates.md](docs/drill2-measure-templates.md);
  - drill 2's `mock2_*` code in `src/uk_budget_data/reforms.py` and `src/uk_budget_data/mock_drill2_structural.py`, kept as worked examples.
- **Files a measure touches:**
  - `src/uk_budget_data/reforms.py`: register the measure in `_get_autumn_budget_2026_reforms`;
  - `src/utils/policyConfig.js`: `POLICIES`, with an explanation starting `MOCK basis:`;
  - `scripts/validate_published_data.py`: `FEATURED_POLICIES`;
  - the tests, with hand-computed values.

## Timeline

| Time (BST) | Do |
|---|---|
| **Before 12:30** | `git pull`; run the two checks; confirm the pre-start check passes; read DRILL3.md and the rubric. Don't open any packet file |
| **12:30** | Open `MOCK-statement.md`. Log "Drill start" in the DRILL3.md clock table (time, start SHA), then commit and push |
| 12:30–12:45 | Draft the coverage ledger (`data_inputs/mock_drill3/MOCK-drill3-coverage-ledger.csv`): one row per statement measure, `coded` or `ledger`, with a reason. Post it on PR #9 for María to lock (G1). Log G1 when she confirms |
| 12:35–13:15 | Code the coded measures in waves: parameters, then modifiers, then new variables. Use agents in git worktrees if useful, and merge their work yourself. Add a hand-checked test per measure. Use statement figures only, and baseline on the engine's native parameters until Annex A arrives |
| **13:15 target, G2** | Fill `MOCK-drill3-reconciliation.csv` statement rows (`comparator=statement`). Get María's one hand-checked household per measure. Then generate (command below), validate, commit the data, push, and log G2 with the preview URL. Mark any measure with no statement figure "awaiting Table 4.1" |
| **13:40** | Open the 13:40 files. Log "Documents released" |
| 13:40–14:10, **G3** | Re-base every measure on **Annex A** (baselines, paths, rates), regenerate, and give María the code SHA for scoring. Help her fill the national sheet: for each measure and year, our static figure, the basis (gross or net; duty only or VAT-inclusive; fiscal or calendar; coverage), and an explanation class for any gap over 10%, using the closed list in DRILL3.md. Do the **data-work exercise** in `MOCK-data-work.md` (CGT forward projection; salary-sacrifice calibration). Produce a separately hashed data artifact with before/after diagnostics, and keep it labelled experimental |
| **14:20** | Open `MOCK-obr-correction-notice.md`. Log it |
| 14:20–14:50, **G5** | Apply the correction, regenerate, push a new SHA, and tell María. She makes a complete new scoring run on that SHA; the old run is kept and marked superseded. Log G5 |
| **14:50 target, G4** | Full page on the preview with every coded measure. Log G4 with the preview URL |
| **15:30** | **Stop.** Commit and push the filled sheets (scoring, national, ledger, reconciliation) if María has supplied them. Log the stop commit and the complete scoring run that matches it |
| 16:00 | The answer key is released by the key holder (another session), not by you. Don't open `~/drill3-sealed` |

## Commands after G1

```sh
uv run uk-budget-data generate --dataset ~/drill2-data/microcosm_uk_2024_25.h5 \
  --reforms <locked IDs> --years 2026 2027 2028 2029 2030 2031 --skip-input-check
uv run python scripts/validate_published_data.py --policies <locked IDs> --years 2026 2027 2028 2029 2030 2031
uv run pytest -q && bunx vitest run --exclude '.claude/**'
```

The validator takes IDs as separate arguments: in zsh write each one out, or use `${=IDS}`. The generate step takes about 1–2 minutes per measure. Run it in the background and keep coding.

## Lessons from drill 2 (avoid repeats)

- **Fiscal vs calendar.** Engine model year Y means fiscal year Y–Y+1 for parameters. Calendar-month measures (fuel, energy VAT) need monthly schedules. Prorate them 9/12 + 3/12 only when use is even across months, and record the method.
- **State Pension rounding.** Round to the nearest 5p when the documents say DWP practice applies. Household State Pension entered as given needs the reform ratio applied; see `_mock2_sp_household_modifier`.
- **Pension Credit.** The specimens state whether a household claims; use `claims_pension_credit`. Annex A may put the guarantee on earnings, not CPI.
- **Employer NI.** Specimen earnings are fixed, so the household change is £0. The national figure is gross employer NI, not the net `gov_balance`. State the basis.
- **TypeScript build.** Run `bunx tsc --noEmit -p .` before pushing, because a failed build breaks the preview.
- **Explain gaps against the matching basis.** Don't call a gap "calibration" without checking it against official data.

## Report

At the stop, post a short summary on PR #9:
- the gate times;
- the stop SHA;
- the scoring runs;
- what's still open.
