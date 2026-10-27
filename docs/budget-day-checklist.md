# Budget-day checklist (one page)

The order of the day on one page. Every step's detail, and every reason, is in [`budget-day-runbook.md`](budget-day-runbook.md); where the two differ, the runbook wins and this page is wrong. Times are UTC (UK time equals UTC from 25 October). Roles as in the runbook: **Integrator** generates, stages and opens the PRs; **Reconciler** reconciles, approves and writes the review rows. Names go in the clock table, not here.

Every Modal command starts `uv run --with modal==1.6.2 python -m uk_budget_data.cli`, written `MODAL` below. The `uk-budget-data` script form fails with `--with modal` (it runs the project's own Python, which has no `modal`). Commands without Modal stay `uv run uk-budget-data ...`.

## Tuesday 27 October

| When | Who | Step |
|---|---|---|
| by 17:30 | Integrator | Confirm which calculation-path PRs are in (#222). Nothing under `src/uk_budget_data/`, `tests/`, `scripts/`, `.github/`, `data_inputs/` (except review rows and attestations) or any `.py` merges after this until Budget day is over, except the day's own measures. |
| before 18:00 | Integrator | Build both Modal images on the final `uv.lock` (about 12 min each if the lock changed; 1–3 min if not): `uv run --with modal==1.6.2 python scripts/budget_day/modal_smoke.py --root /tmp/modal-smoke threshold_freeze_2031_32` and `uv run --with modal==1.6.2 python scripts/budget_day/modal_constituencies_smoke.py`. |
| 18:00 | Coordinator | Full regeneration on the final `main`, on Modal, as in "The full run on Modal" (the same three parallel shells as G2 below). |
| after it | two reviewers | Attest the regenerated hand-written receipts (`plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`, `carers_allowance_earnings_taper`) and the eight-measure package `combined--9f29f8fddfb61a5c` (employer NI and BADR are withdrawn and unregistered): `uv run python scripts/draft_attestation.py public/data/artifacts/<id>/<digest>/`, then two different people fill `checker`, `second`, `released_at` and commit. An attestation from before 18:00 no longer matches. |

## Wednesday 28 October

| When | Who | Step | Runs alongside |
|---|---|---|---|
| by 06:00 | Integrator | Final cut adopted (runbook, "Rolling re-cuts") | |
| 07:00 | Coordinator | Go/no-go | |
| by 11:30 | Integrator | **G0** start receipt: the block under "G0" in the runbook, then `uv run uk-budget-data publish check` | |
| 12:30–12:45 | Reconciler | **G1** coverage ledger | encoding starts |
| from G1 | Integrator | Encode each measure (module, `reforms.py`, `expected_effects.csv`, `DECLARED`, one test), **commit**: a dirty tree refuses the Modal run | |
| 13:15 | Integrator | **G2** generate, three shells at once, each from the same clean commit: | the three shells |
| | | 1. `MODAL generate --artifacts --backend modal --reforms <template and parameter ids>` (about 8–9 min) | 2, 3 |
| | | 2. one call per hand-written modifier: `MODAL generate --artifacts --backend modal --reforms <one id>` (about 7 min each) | 1, 3 |
| | | 3. only if a flat file needs re-cutting: `MODAL generate --backend modal --only income_distribution` (about 4 min). Not the package's files (`--published-package`, #233): they wait for the last manifest change, at G4 | 1, 2 |
| | Integrator | `publish reconcile`, `publish stage --provisional`, `publish check` for each written directory; household check per measure | |
| | Reconciler | Move each `reconciliation.json` outside the checkout, then `publish review-rows` (never while a `generate` is running) | |
| | Integrator | Publish PR, CI, merge | Documents |
| 13:40 | Reconciler | **Documents**: OBR workbooks by hand in a browser | |
| 13:40–14:10 | Reconciler | **G3** reconcile, exceptions, `publish stage`, `publish approve <id> --by <approver>` | attestations |
| | two reviewers | Attest any hand-written measure regenerated today (fresh receipt, fresh attestation) | G3 |
| 14:50 | Integrator | **G4** once every member is staged: `MODAL generate --combined <member ids> --backend modal` (about 7 min), stage; Reconciler approves once every member is approved. Start it before the area run: the area run's tables make the tree dirty | area run |
| from G3 approval | Integrator | Area run: `UK_BUDGET_DISCLOSURE_AUDIT_DIR=<private dir> MODAL constituencies --backend modal` (14–21 min), from the same clean commit; approved single measures only, no package | G4 combined run |
| after the last manifest change | Integrator | After the last `stage`, `approve` or `withdraw`: `MODAL generate --only income_distribution --published-package --backend modal` and `MODAL generate --only income_growth --published-package --backend modal`, two shells at once (2:46 for both, two measures, rehearsal 27 Oct). Then the Reconciler re-reviews `income_distribution.csv`, `income_mobility.csv` and `income_growth_with_measures.csv` by hand in `data_inputs/public_data_review.csv` (new SHA-256, reviewer, date, basis): `publish review-rows` does not write these three rows | |
| then | Integrator, Reconciler | In this order: `publish index` (only once the area run has written its tables: with none it refuses, "no flat view file to bind"), `publish check`; Reconciler: `publish review-rows`; then `git add` the artifacts, `manifest.json`, the regenerated flat files and `public_data_review.csv`, and run `uv run python scripts/check_public_data.py` and `bun scripts/check-public-files.mjs`. Before `review-rows` both checks fail on every new file; before `git add`, `check_public_data.py` reports each one as "reviewed, but not tracked" | |
| | Integrator | Publish PR, CI, merge; `curl` the live `manifest.json`; household check | |
| 15:45 | Media first cut | Comparables review first (runbook, "First cut") | |

## Never

1. **Never put a hand-written modifier in the shared call, and never run `--artifacts` without `--reforms`** (that runs every measure, hand-written ones included). Each run of a hand-written modifier writes a new artifact that needs its own two-person attestation; on 26 October this left two artifacts for each. If it happens, attest and stage one of them; `review-rows` then deletes the other.
2. **Never run `publish review-rows` while a `generate` is running**, or before every artifact you want is staged: it deletes unstaged artifact directories.
3. **Never interrupt a Modal run that has gone quiet.** Results come back in measure order, so one slow container holds back the rest (up to the 45-minute timeout). Ctrl-C loses everything not yet written.
4. **Never mix local and Modal artifacts in one release** without deciding to: staging then needs `--adopt-execution`, which makes every other entry stale.

## If a Modal container fails

The command prints `<id>: FAILED in its Modal container: <error>` in its place, writes every other artifact, starts no combined run in that call, ends with `FAILED <id>` lines (apart from `REFUSED` ones) and the rerun steps, and exits 1. Then:
1. Stage the written ones as they are.
2. Rerun only the printed ids: `MODAL generate --artifacts --backend modal --reforms <failed ids>` (each hand-written one in its own call), and stage them.
3. Then the combined run with the printed member ids.

A **refusal** is not a failure: a gate refused the measure (a data limit, a scored year, a thin decile cell once #208 is in) and a rerun gives the same answer. Fix the measure or leave it out.
