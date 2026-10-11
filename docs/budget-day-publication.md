# Publishing the Budget dashboard incrementally (proposal)

**Status: proposal for Vahid and María's review.** Nothing here changes the Budget-day workflow until they agree. Comment on the PR that adds this file.

The UK Autumn Budget is on Wednesday 28 October 2026, and the briefing is due by 07:00 on 29 October. There is no model freeze; the model keeps improving through Budget day. So each number on the dashboard and in the briefing has to carry evidence of what produced it, and pass checks, before it is published, measure by measure as measures are coded.

## Where things stand (11 October)

- **No production 2026 dashboard exists.**
  - `https://policyengine.org/uk/autumn-budget-2026` returns 404, and policyengine-app-v2 has no rewrite for it.
  - The only Vercel project linked to this repository is `uk-autumn-budget-2026-drill`. It tracks `main` as its production branch, is login-protected and sets `NEXT_PUBLIC_MOCK` in every environment, so a merge to `main` deploys a MOCK page.
  - No deployed household API URL is recorded in the repository or its PRs.
- **CI has been red on every PR since at least 9 October.** Hugging Face rejects the repository's token, and the one dataset test skipped whenever the token was absent. #12 fixes both.
- **PR #3 holds the real 2026 foundation**: the measure registry, the PolicyEngine-backed household route and the published-data validator. Three things remain:
  - certified regeneration (review item C2);
  - the old combined builder, still labelled 2026 (C3);
  - a recursion in `_build_scenario` when dated changes and a custom modifier coexist.
- **The page cannot show combined figures safely yet.** On `main` and on #3, the browser:
  - substitutes zero for missing rows;
  - adds up standalone effects;
  - reads affected population, poverty and Gini from the first selected measure for 2026.

- **No household API is deployed for 2026.**
  - `main`'s Personal impact tab throws unless `NEXT_PUBLIC_LIFECYCLE_API_URL` is set ("Point it at the 2026 lifecycle API"), and the drill project sets no such variable.
  - It was built for the separate 2025 "Lifetime tax model" service (`uk-autumn-budget-lifecycle-578039519715.europe-west1.run.app`, routes `/` and `/calculate`), which is still live. That service is a standalone hardcoded tax model, not PolicyEngine.
  - No `uk-budget-api-2026` Cloud Run service exists in that Google Cloud project. Its deterministic URL returns Google's not-found page.
  - No Cloud Build trigger posts statuses to this repository.
  - Other projects could not be checked without gcloud access.
- **Years past the dataset's projection.** W4 found that policyengine-uk projects datasets only to 2030, yet returns non-zero 2031–32 totals by a mechanism still being checked. Until that is settled, years beyond the dataset's projected years are marked **unsupported** and shown as unavailable, not as final figures.

## Decisions for Vahid and María

Each has a proposal. Nothing is built into the Budget-day workflow until you agree.

| # | Decision | Proposal |
|---|---|---|
| 1 | **Production route.** Who presses merge on the day? | A new non-MOCK Vercel project tracking `main`, plus a policyengine-app-v2 rewrite for `/uk/autumn-budget-2026` (exact setup below). A merge to `main` publishes, behind required checks. The integrator (Vahid) merges. |
| 2 | **Household API hosting** | Cloud Run `uk-budget-api-2026` in the project that hosts the 2025 services, deployed with no traffic, smoke-tested, then switched over (below). The alternative is Modal. The runbook records the actual URL. |
| 3 | **Treasury gate** | Our static figure against the static costing passes when the difference is within 10% or £50m, whichever is larger. Table 4.1's post-behavioural figure is shown alongside but not gated. Anything larger needs an exception in your closed classes, reviewed by María and bound to the output digest. Before the documents arrive, figures go up as provisional statement figures only. |
| 4 | **#3** | W5 takes it over the line under your review: rebase onto #12 and #13, regenerate on certified data with constituency weights from the same release, rename the old combined builder, fix the `_build_scenario` recursion. Or you finish it. Your choice. |
| 5 | **Rehearsal** | A full run on the deployed routes by **Friday 23 October**: intake, dashboard, briefing, including one model upgrade and regeneration. Repeat after any material change. |
| 6 | **Combined totals** | Only from one combined simulation of exactly the selected measures, for the selected year. Standalone bars plus an interaction segment. Any other selection shows standalone effects and says combined figures are unavailable. The full package and any presets you name are precomputed. |
| 7 | **Corrections** | A complete new run, staged so the old entry is kept as superseded. Combined runs that include a changed measure turn stale automatically. An approval or exception carries over only for byte-identical outputs. |
| 8 | **Model upgrades on the day** | Replace the "freeze by 21 October" idea with adoption of the latest qualified release by PR. Every published measure and the combined run are regenerated and re-gated on the new identity before merge. Otherwise stay on the current identity; mixing identities is refused. |
| 9 | **Personal impact tab** | #3's PolicyEngine-backed household route becomes the tab, and the lifecycle calculator is removed. It points at a 2025 standalone tax model and has no 2026 service. Household fixtures go through the deployed route, ±£0.01, on the same model version (#15). |
| 10 | **Briefing** | Charts and tables are exported only from an approved manifest revision, stamped with model, data and revision. The hardcoded figures in `generate_combined_charts.py` go. Who writes and reviews the briefing, and on what timetable? |
| 11 | **Required checks on `main`** | Python tests, Certified data, Python lint, Frontend build, tests and lint, and Publication gate. Emergency bypass: Max only, recorded. |
| 12 | **Drill fixes** | Extract them as tested measure templates and regressions (VAT once, NICs bands, owner-only surcharge, pension rounding, £10 allowance rounding, GB benefit-receipt payment, the False Pension Credit flag), with no mock measures. Do any need to land on #3 first? |

## Production setup (proposal for decision 1 and 2)

**Dashboard (Vercel)**, mirroring the 2025 dashboard project, whose production alias serves behind the policyengine.org rewrite:

| Setting | Value |
|---|---|
| Project | `uk-autumn-budget-2026`, team `policy-engine`, linked to `PolicyEngine/uk-autumn-budget-dashboard-2026` |
| Production branch | `main` (a merge publishes; required checks gate the merge) |
| Framework | Next.js. Install with `bun install --frozen-lockfile`, build with `bun run build`, Node 24.x |
| Environment, Production and Preview | **No `NEXT_PUBLIC_MOCK`.** `NEXT_PUBLIC_BASE_PATH` unset, so the code default `/uk/autumn-budget-2026` applies. `BUDGET_API_URL` set to the household API (server-side, used by #3's proxy). |
| Deployment protection | Standard protection, as on the 2025 project (`all_except_custom_domains`): previews need a team login; the production alias is public. Check the production alias returns 200 before enabling the rewrite. |
| Public URL | `https://policyengine.org/uk/autumn-budget-2026`, via a draft rewrite in policyengine-app-v2 to `https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026`, mirroring the 2025 entry |
| Rollback target | Record the previous production deployment ID before every Budget-day merge |

The drill project `uk-autumn-budget-2026-drill` stays as it is for rehearsals. Its production alias is not public.

**Household API (Cloud Run)**, in the project that hosts the 2025 services (number 578039519715, `europe-west1`):

| Step | Detail |
|---|---|
| Build | `cloudbuild.yaml` builds the Dockerfile with `GIT_SHA=$COMMIT_SHA` (#15), so `/api/version` reports the build |
| Deploy | `gcloud run deploy uk-budget-api-2026 --no-traffic --tag candidate`, then smoke-test the tagged URL: `/api/version` must match the bundle, and one household fixture must pass |
| Promote | `gcloud run services update-traffic uk-budget-api-2026 --to-latest` only after the smoke test passes |
| Trigger | None today. Manual `gcloud builds submit` by the deploy owner, or a trigger on `main`. Your call. |
| Rollback | `gcloud run services update-traffic uk-budget-api-2026 --to-revisions <previous>=100` |

These need gcloud access and an owner with deploy rights. Nothing is created until you agree.

## Principles

1. **Measure-agnostic.** On the day measures are coded live, so everything here works for any registered measure.
2. **One entry point.** The browser and every briefing export read one publication manifest. A number that is not in an approved manifest entry is not shown.
3. **Unavailable, never zero.** A missing row, a stale artifact or an unapproved measure shows as "unavailable", with the reason.
4. **Combined means simulated together.** Combined statistics come from one simulation of exactly the selected measures, for the selected year, on one declared baseline. Standalone effects and the interaction term are shown separately; interactions are real, so the parts need not sum to the whole.
5. **Approvals bind to bytes.** An approval names the output digest it approved. If regeneration changes the outputs, the approval lapses; byte-identical outputs keep it.
6. **No freeze.** A newer qualified policyengine release is adopted by a PR that regenerates every measure on the new execution identity and re-runs every gate.

## Artifacts and the manifest

```
public/data/
  manifest.json
  artifacts/<measure id, or combined--<ids>>/<digest prefix>/
    budgetary_impact.csv  distributional_impact.csv  winners_losers.csv
    metrics.csv  income_curve.csv  household_scatter.csv
    [constituency.csv  demographic_constituency.csv]
    receipt.json  reconciliation.json
```

- **Generation.** `uk-budget-data generate` writes a new, immutable artifact directory for each measure it runs, and for each combined set it is asked for. It never touches existing directories, so a single-measure run cannot overwrite or erase another measure's numbers.
- **Publishing.** `uk-budget-data publish` is the only command that writes `manifest.json`. It validates first, then replaces the file in one step. Each deploy is one git commit, so the public page switches all at once.
- **Entry status:**
  - `approved`;
  - `provisional`: statement figures only, labelled on the page;
  - `stale`: set automatically, for example when a member of a combined run changes;
  - `withdrawn`.
- **Corrections.** A correction stages a complete new run. The superseded entry stays in the manifest for audit, as in drill 3.

## Receipts

Every artifact carries `receipt.json` with two parts.

**1. An execution receipt** in the schema policyengine.py publishes for this purpose (execution receipt v1, PolicyEngine/policyengine.py#571). It records:
- the installed wrapper, model and core versions;
- the data release and build;
- the SHA-256 of the dataset bytes simulated;
- whether the model and data pair is certified, with the certificate digest;
- digests of the reform and baseline;
- the fiscal-year convention (year 2027 means 2027-28);
- the reported years;
- a digest of the artifact's outputs.

Every digest is computed over RFC 8785 canonical JSON, so Python and the browser produce identical bytes.

**2. Dashboard fields:**
- measure IDs, and for a combined run each member's reform and baseline digests;
- per-file hashes;
- the git commit, and whether the working tree was clean;
- the command that produced it;
- the forecast and calibration **basis**: `pre_budget` or `updated`, with source and vintage.

An artifact is publishable only if its receipt says `certified` and the tree was clean. An explicitly supplied local dataset whose bytes don't match the certified release can never be approved.

## Checks before a measure can be approved

1. **Supported years.** Years beyond the dataset's projected years are marked unsupported. They show as unavailable and are not gated or approved as final figures.
2. **Schema and completeness:**
   - required files and columns are present, with one row per key;
   - every required year is covered, with exact decile sets;
   - all values are finite.

   These are #3's validator checks, applied to artifacts.
3. **One execution identity.** The receipt's execution identity equals the manifest's, and the receipt is certified.
4. **Integrity.** File hashes on disk equal the receipt's.
5. **Treasury reconciliation.** Each comparable fiscal year passes or carries an accepted exception (below). Provisional entries skip this check and are labelled.
6. **Household checks.** The measure's household fixtures pass through the deployed route against the same execution identity.
7. **An approval** naming the current output digest.

A **combined** entry is current only if each member's approved digest equals the digest it was computed alongside. Otherwise it is marked stale in the same step that changed the member.

## Treasury reconciliation

- **Inputs.** The Treasury table is entered once, as rows recording:
  - source document, table, row ID and label;
  - fiscal year;
  - value (£bn);
  - basis: static costing or post-behavioural;
  - sign convention.

  A mapping file links each measure to its rows.
- **Comparison.** Our static figure against the **static costing**, following the drill-3 rubric. Table 4.1's post-behavioural figure is shown alongside and not gated.
- **Proposed rule** (the numbers are a decision for the team). A year passes when |ours − Treasury| ≤ max(10% × |Treasury|, £50m).
  - Zero against zero passes.
  - A nonzero estimate against a zero costing needs an exception.
- **Exceptions.** Each records:
  - the residual;
  - one of the drill-3 explanation classes: `behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved` or `interaction`;
  - a quantified explanation;
  - the reviewer;
  - the output digest it accepts.

  If the numbers change, the exception lapses.
- **Out of scope.** Rows that are outside scope or on a different basis are classified explicitly, with a reason and a reviewer, never dropped.
- **Before the documents arrive**, a measure can be published only as provisional: "awaiting Treasury costing".

## Combined statistics

`uk-budget-data generate --combined <ids>` runs one simulation of the set. Before simulating, it checks that every parameter value each member sets in its own scenario holds unchanged in the combined scenario. This catches, for example, a parameter-mutating modifier wiped by a later parameter reset.

Each published package needs a combined run: "the Budget", plus any presets the team names. Arbitrary subsets (2^N of them) are not precomputed. What the page shows depends on the selection:
- **Exactly matches a combined run.** The combined fiscal totals, decile effects, affected population, poverty and Gini for the selected year. Each standalone bar is shown too, plus an "interaction" segment equal to the combined result minus the sum of the standalones.
- **One measure.** Its own artifact is the combined result.
- **Anything else.** Standalone effects only, with "combined figures are unavailable for this selection", naming the sets that have them.

## Household checks through the deployed route

A script posts each household fixture through the deployed household route. It:
- checks the API's reported versions against the manifest's execution identity;
- compares each answer to an independently computed expected value (±£0.01, as in the drills);
- writes a household receipt.

The same script is the runbook's household step and the post-deploy smoke test.

## Deployment and rollback

The exact setup is in "Production setup" above.
- **Dashboard rollback.** Vercel Instant Rollback to the recorded previous production deployment, then `git revert` and redeploy. Promote the fixed deployment afterwards, because rollback pauses automatic domain assignment.
- **Household API rollback.** Move traffic back to the previous revision, then re-run the household checks on the live route.

## Runbook

`docs/budget-day-runbook.md` will be written with Vahid and María. Every step has a command, its expected output and its gate. It follows the drill structure:

| Gate | Step |
|---|---|
| G0 | Start receipt: execution identity, certified-data check, household route identity |
| G1 | Coverage ledger |
| G2 | Provisional numbers on statement figures |
| G3 | Treasury reconciliation with exceptions |
| G4 | Combined runs and publish |
| G5 | Corrections as complete new runs |
| — | Briefing export from an approved manifest revision |
| — | Rollback |

The runbook records the actual household URL and the production publishing triggers. It is rehearsed end to end on the deployed routes by 23 October, and again after any material change.

## PR sequence

| # | PR | Depends on |
|---|---|---|
| 1 | #12: CI fails rather than skips, runs on every PR, uses the lockfile | Admin: data-token access |
| 2 | #13: certified bundle 6.2.6 (UK 2.125.1, data 1.58.0) | 1 |
| 3 | Publication core: receipts, artifacts, manifest, `publish` checks, reconciliation, combined runs | 2 |
| 4 | Frontend: manifest loader, unavailable states, combined-only statistics, interaction display, UI regression tests | 3 and #3 |
| 5 | Briefing exports gated on the manifest; hardcoded figures removed | 3 |
| 6 | #15: household route checker, `/api/version`, build identity. Then a Cloud Build no-traffic deploy with smoke test | #13, deployed API |
| 6b | #16: Treasury Table 4.1 importer with printed-totals check | #13 |
| 6c | policyengine-app-v2: draft rewrite for `/uk/autumn-budget-2026` | Decision 1 |
| 7+ | Drill-fix extraction: one small PR per fix with its regression, no mock measures | 2 |
| R | Runbook and rehearsal receipts | All |
