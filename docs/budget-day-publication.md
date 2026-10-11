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

1. **Schema and completeness:**
   - required files and columns are present, with one row per key;
   - every required year is covered, with exact decile sets;
   - all values are finite.

   These are #3's validator checks, applied to artifacts.
2. **One execution identity.** The receipt's execution identity equals the manifest's, and the receipt is certified.
3. **Integrity.** File hashes on disk equal the receipt's.
4. **Treasury reconciliation.** Each comparable fiscal year passes or carries an accepted exception (below). Provisional entries skip this check and are labelled.
5. **Household checks.** The measure's household fixtures pass through the deployed route against the same execution identity.
6. **An approval** naming the current output digest.

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

## Deployment and rollback (proposal)

- **Dashboard.** A new production Vercel project, not MOCK, tracking `main`, plus a rewrite in policyengine-app-v2 for `/uk/autumn-budget-2026`.
  - A merge to `main` publishes.
  - Required checks gate the merge, including a **Publication gate** job that runs `publish check` on the committed manifest.
  - Rollback: Vercel Instant Rollback to the previous production deployment, then `git revert`.
  - The drill project stays for rehearsals.
- **Household API.** Cloud Run `uk-budget-api-2026`.
  - Deploy with no traffic, smoke-test `/health` and one fixture, then switch traffic over.
  - Rollback moves traffic back to the previous revision.
  - Whether it stays on Cloud Run is the team's call.

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
| 6 | Household route checker and fixtures; Cloud Build no-traffic deploy with smoke test | #3, deployed API |
| 7+ | Drill-fix extraction: one small PR per fix with its regression, no mock measures | 2 |
| R | Runbook and rehearsal receipts | All |
