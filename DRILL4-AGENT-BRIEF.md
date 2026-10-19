# Drill 4 agent brief: run the integrator role (Monday 19 October 2026)

MOCK DATA rehearsal. Read this first, then [DRILL4.md](DRILL4.md). You are the **integrator**. María (`juaristi22`) is the reconciler and then the scorer. All times are **London time (BST)**. Check with `TZ=Europe/London date` before acting on a time.

## Hard rules

1. **The packet arrives on this branch at its release time.** The key holder pushes a commit to `drill4-mock-budget` at each time, into `data_inputs/mock_drill4/packet/`:
   - **12:30:** `MOCK-drill4-statement.md`.
   - **13:40:** the household and national scoring sheets, the ledger sheet, the OBR economy workbook, the policy costings (with Annex A), the policy decisions workbook (Table 4.1) and the specimen inputs.
   - **14:20:** `MOCK-drill4-inject-1420.md`.

   Run `git pull` at each time. If a file hasn't arrived 3 minutes after its time, say so on PR #52, then wait. Don't look for the files anywhere else. If a packet file is ever on the branch before its time, don't open it.
2. **Never open `~/drill4-sealed/`.** It holds the answer key, which the key holder releases at 16:00.
3. **Branch:**
   - push only to `drill4-mock-budget` (PR #52), and pull before every push;
   - never merge;
   - never use `--prod`;
   - every push deploys previews to both Vercel projects, and both sit behind team login.
4. **Don't edit packet files.** Score nothing: scoring is María's job.
5. **Communicate on PR #52** (`gh pr comment 52`): post SHAs, gate times and defects there. Answer María's points by number.
6. **One SHA per scoring run.** After the 14:20 inject, a new complete run goes on a new SHA, and the old run is marked superseded.
7. **Microcosm only, through the guard.** Never call `uk-budget-data generate` directly. Label every national figure "unvalidated under this engine".

## Environment

- **Repo:** `~/uk-budget-drill4` (a worktree), branch `drill4-mock-budget`. Run `git pull` first.
- **Python:** `uv run …`, pinned to policyengine **6.7.6** (latest on PyPI, released 19 October 00:27 UTC), policyengine-uk 2.130.1 and core 3.33.0. policyengine-uk 2.137.0 is on PyPI too, but 6.7.6 pins 2.130.1, so it can't be used. Don't upgrade during the drill; record both versions at G0.
- **Dataset:**

  ```sh
  export DRILL4_DATASET=~/drill4-data/staged/uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3/microcosm_uk_2024_25.h5
  export HUGGING_FACE_TOKEN=$(cat ~/.cache/huggingface/token)
  ```

  The guard must print `dataset OK … 04a496f2…`. Log that line at G0.
- **Generate** (about 40 s per measure per year):

  ```sh
  scripts/drill4_generate.sh --output-dir public/data --reforms <locked IDs> \
    --years 2026 2027 2028 2029 2030 2031 --skip-input-check
  ```

  It writes the flat CSVs that the page reads (G4 (b)).
- **Gate path:** add `--artifacts` to the same command. On Microcosm it prints `REFUSED … cannot resolve dataset 'microcosm_uk_2024_25'` for every measure, and still exits 0. Record the refusal per coded line: that **is** G4 (a), so don't work around it.
- **Constituencies (don't skip):** seats run on Microcosm's latest **local** build (staged, not released; hash-checked):

  ```sh
  export UK_BUDGET_DISCLOSURE_AUDIT_DIR=~/drill4-private/disclosure-audit
  uv run uk-budget-data geography \
    --dataset ~/drill4-data/staged/uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe/microcosm_uk_2024_25_local.h5 \
    --dataset-kind microcosm --levels constituency \
    --reforms <locked IDs> --seat-reforms <locked IDs> --years <years> --out-dir <dir>
  ```

  SHA-256 `8e10e130…5872`. Takes about 3 minutes per measure per year; run it in the background after G3, once for the package. Log the hash at G0. Disclosure control withholds some seats: publish what it allows, never the private audit folder.
- **Regions:** the geography tool publishes regions only from the national dataset, and it refuses the national Microcosm file (missing eFRS copy flag `household_is_cgt_band_donor`). So regions run on the bundle's **certified eFRS**, the one sanctioned exception to Microcosm-only: `uv run uk-budget-data geography --dataset-kind efrs --levels region --reforms <locked IDs> --years <years> --out-dir <dir>` (about 30 s per measure; all 12 regions). Label them "regions: certified eFRS".
- **Tests:** `uv run pytest -q`; `bunx vitest run --exclude '.claude/**'`; `bunx tsc --noEmit -p .` before every push, because a failed build breaks the preview.
- **Local household API** (for hand checks): `PORT=8000 uv run uk-budget-api`, then `POST localhost:8000/api/personal-impact`. Household specimens use no population dataset.
- **Previews** (team login):
  - https://uk-autumn-budget-2026-drill-git-drill4-moc-2e3f4b-policy-engine.vercel.app
  - https://uk-autumn-budget-2026-git-drill4-mock-budget-policy-engine.vercel.app
- **Files a measure touches:**
  - `src/uk_budget_data/reforms.py`: register the measure in `_get_autumn_budget_2026_reforms`, with a `mock4_` ID prefix;
  - `src/utils/policyConfig.js`: `POLICIES`, with an explanation starting `MOCK basis:`;
  - the tests, with hand-computed values.

## Known gaps (decided 19 October; log them, don't fix them)

- **No MOCK banner on this branch (P0a).** Both previews are behind Vercel login and send `X-Robots-Tag: noindex`. Log this as covered at the edge, banner missing.
- **No `reset` (P0b).** The registry still holds the November 2025 measures. Register the drill measures alongside them and generate only the locked `mock4_` IDs.
- **No manifest loader.** The page reads the flat CSVs only, and staged entries are never displayed (María, C1).

## Timeline (London)

| Time | Do |
|---|---|
| **Before 12:30** | `git pull`; set the two exports; run `scripts/drill4_generate.sh --list-reforms` (must print `dataset OK`); `uv run pytest -q`. Log G0 in the DRILL4.md clock table (start SHA, versions, guard line), then commit and push |
| **12:30** | `git pull`; open the statement. Log "Drill start" (time, SHA, `shasum -a 256` of the file), then commit and push |
| 12:30–13:00, **G1** | Coverage ledger: every statement line is `coded` or `ledger`, with a **route** and a reason (route classes are in DRILL4.md). Post it on PR #52 for María to lock |
| 12:35–13:15, **G2** | Code the coded lines in waves: parameters, then modifiers, then new variables. Use agents in git worktrees if useful, and merge their work yourself. Add a hand-checked test per measure. Generate, then push, and log G2 with the preview URL and one hosted household check (time it) |
| **13:40** | `git pull`; open the documents. Log "Documents released" |
| 13:40–14:15, **G3** | Rebase on Annex A and regenerate. Give María the code SHA. For each national row: our figure, its **basis** (gross or net; cash or accrued; duty only or VAT-inclusive; fiscal or calendar), an explanation class for any gap over 10%, and a cause class |
| **14:20** | `git pull`; open the inject. Log it |
| 14:20–14:50, **G5** | Apply the inject, regenerate on a new SHA and tell María. The old run stays, marked superseded. Log G5 |
| **14:50 target, G4** | (a) `--artifacts` refusals recorded per coded line; (b) the full page on the preview from the same SHA. Lines that can't be computed show as not computable, never £0 |
| 14:50–15:30 | Constituency run for the package on the final SHA (and regions, see Environment). Log it with the seat count published and withheld |
| **15:30** | **Stop.** Commit and push the filled sheets. Log the stop commit |
| 15:30–16:00 | Each engine or data finding becomes a **draft** issue text on PR #52. File nothing upstream without Vahid's go |
| 16:00 | The key holder (another session) releases the answer key. Don't open `~/drill4-sealed` |

## Lessons from drills 1–3 (avoid repeats)

- **Basis.** National costings are gross tax heads on a cash basis; the pipeline gives net `gov_balance`. State the basis on every row. This was the top failure in drills 2 and 3.
- **Fiscal vs calendar.** Model year Y means fiscal year Y–Y+1. Dated changes inside a year are day-weighted on 2.130.1 (policyengine-uk #2305); check one by hand.
- **Employer NI.** Specimen earnings are fixed, so the household change is £0; the national figure is gross employer NI.
- **"Logged" means committed and pushed with the receipt.** Gates in drill 3 scored zero when the logging and the handover happened at different times.
- **Don't call a gap "calibration"** without checking it against official data.

## Report

At the stop, post a short summary on PR #52:
- the gate times;
- the stop SHA;
- the scoring runs;
- what's still open.
