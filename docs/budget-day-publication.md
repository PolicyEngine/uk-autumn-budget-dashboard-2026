# Publishing the Budget dashboard incrementally

**Status, 19 October.** On 12 October Max ruled that changes which only fix bugs or add opt-in tooling are obvious improvements, and land on the normal review gates. Most of this design has since merged (see "Status of the work"). Six questions for Vahid and María are below. The third, on required checks, is partly settled: since 15 October `main` requires six. Comment on the PR that adds this file.

The UK Autumn Budget is on Wednesday 28 October 2026, and the briefing is due by 07:00 on 29 October. There is no model freeze; the model keeps improving through Budget day. So each number on the dashboard and in the briefing has to carry evidence of what produced it, and pass checks, before it is published, measure by measure as measures are coded.

## Questions for Vahid and María

| # | Question | Proposal |
|---|---|---|
| 1 | **Who presses merge on the day, and who reviews reconciliation exceptions?** | Vahid integrates and merges; María reviews exceptions and approves. Nobody approves their own exception. |
| 2 | **When does `generate` switch from the flat CSVs to the gated path** (one write-once artifact per measure, published through the manifest)? | After a rehearsal on the deployed routes shows the page reading the manifest. Until then `--artifacts` is opt-in and the flat CSVs stay the default. |
| 3 | **Should `main` require checks before a merge?** **Settled 15 October** (d1538): the ruleset "Protect main" requires a pull request and six checks: Python tests, Python lint, Certified data, Frontend build, Frontend tests and Frontend lint. | Still open: whether to add Publication gate to the required checks. |
| 4 | **How does #3 land, and with it the Personal impact tab?** W5 will not rebase, rewrite or supersede #3 or the drill branches (#4, #7, #9, #52), and builds so they keep working. | Tell us when you expect to merge #3. The page wiring in #20 follows it, and #3's household route replaced the hand-typed calculator the tab used before (see "The household API" below). |
| 5 | **When is the rehearsal?** | A full run on the deployed routes by Friday 23 October: intake, dashboard and briefing, including one model upgrade and regeneration, and again after any material change. |
| 6 | **Where do Budget-day `simulation_modifier` functions live?** A receipt binds a modifier only from a module holding nothing but imports, literal constants and undecorated functions (policyengine.py#571). `reforms.py` keeps caches it fills at run time, so a modifier defined there cannot be receipted: on `main` today, `rail_fares_freeze` and `freeze_student_loan_thresholds` are refused. (`dividend_tax_increase_2pp` now states its pre-Budget rates as parameter changes, so it binds.) Measures made only of parameter changes still bind. | A new `src/uk_budget_data/budget_measures.py` of that shape holds every modifier, and `reforms.py` imports them. **Done 24 October** on branch `ab2026-candidates`: `budget_measures.py` holds every candidate measure's modifier. |

The Treasury tolerance and floor in `data_inputs/treasury/policy.yaml` remain proposals until the methodology call (cos d1344) is ruled.

## Status of the work

As of 19 October. Merge dates are when each pull request landed on `main`.

| Work | Where | State |
|---|---|---|
| CI fails rather than skips, and runs on every PR base | #12 | **Merged** 12 October |
| Certified bundles, each adopted with its model and data together | #13 (6.2.6), #25 (6.3.3), #35 (6.4.1), #50 (6.5.0), #56 (6.6.0) | **Merged** 12 to 16 October. `main` runs policyengine 6.6.0 (policyengine-uk 2.130.1, uk-data 1.58.1). #18's workflow has since opened drafts #57 (6.7.0), #58 (6.7.3) and #61 (6.8.0); merging one stays your call |
| Household route checker and `/api/version` | #15 | **Merged** 13 October |
| Household API deploy: a new revision takes no traffic until a smoke test passes | #21 | **Merged** 13 October |
| Household API deploys and rollbacks from GitHub Actions (Workload Identity Federation), so Budget day needs no laptop login | #28 | **Merged** 15 October. Grants made 15 October (d1538): a custom role `ukBudgetApiBuilds` (`cloudbuild.builds.create`, `.get`, `.list` and `storage.buckets.list`) in place of `cloudbuild.builds.editor`. The first three runs failed at "Submit the build" without `storage.buckets.list`: gcloud lists the project's buckets to check that the default staging bucket is its own. #28's description lists every grant. A deploy and a rollback were rehearsed through it on 15 October (runbook) |
| Builds run as a dedicated builder, and the service as an account with no roles | #41 | Draft, waiting on grants that are Max's call |
| The household calculator applies a measure as the national run does | #32, #37, #39 | **Merged** 15 October |
| The household route made fast enough to answer within Cloud Run's 300 s: one simulation per distinct scenario, the calculation off the event loop, spread over the instance's vCPUs, its workers stopped for certain | #42, #45, #46, #49 | **Merged** 15 and 16 October. Timings below |
| Read a household API revision's memory from a workflow, read-only | #54 | **Merged** 16 October |
| Treasury Table 4.1 import with a printed-totals check | #16, #27, #31 | **Merged** 13 to 15 October |
| Reconciliation and responsiveness gates | #17, #34 | **Merged** 15 October; the thresholds are proposals |
| A draft upgrade PR on each qualified policyengine release, never merged automatically; merging an upgrade on the day stays Vahid and María's call | #18 | **Merged** 15 October (opens draft PRs only) |
| Receipted, write-once artifacts, the manifest, the `publish` commands and combined runs, all opt-in | #19 | **Merged** 15 October |
| W4's receipt code vendored from policyengine.py; later replaced by policyengine's released receipt APIs | #38, #50 | **Merged** 15 and 16 October |
| The page shows only published figures: unavailable instead of zero, combined statistics only from the combined run, no hardcoded 2026 | #20 | **Merged** 15 October: modules, components and tests. Wiring into the page follows #3 |
| Briefing exports from an approved manifest only; hardcoded figures removed | #22 | Draft, waiting for your review |
| Drill fixes as tested measure templates and regressions, no mock measures; UC health measures built on the rebalancing amounts | #23, #47 | **Merged** 15 October |
| Last year's chart pages no longer served | #26 | **Merged** 15 October |
| Every public file checked for disclosure; the household scatter withdrawn from public paths | #30 | **Merged** 15 October (María, UK-24) |
| Results by region and constituency, through the disclosure layer | #48 | **Merged** 16 October (María, UK-24) |
| Results by area on the Microcosm data pair | #59 | Draft, opened 19 October (María) |
| Measures the certified data cannot cost (the SDLT higher rates, non-residential purchases) published as not computable, never as £0 | #51 | **Merged** 21 October |
| Production Vercel project | Created 12 October | Deploys `main` at every merge (below) |
| `policyengine.org/uk/autumn-budget-2026` | PolicyEngine/policyengine-app-v2#1249 | Draft until the page shows real, gated 2026 numbers |
| Runbook | [`budget-day-runbook.md`](budget-day-runbook.md) | Draft, yours to rewrite |

## Where things stand (19 October)

- **CI** passes on `main`, and the six required checks guard every merge.
- **Production dashboard.** Every merge to `main` deploys it; the latest production deployment is of `5324080` (16 October). `main`'s main route still charts last year's measures' CSVs once a policy is selected, until #3 regenerates them (the runbook's "Nothing published says 2025" table).
- **The household route answers, but slowly.** Measured on the live revision `uk-budget-api-2026-00018-xuv` (2 CPU, 2 GiB, 300 s timeout), 16 October, one request at a time:

  | Household | Time |
  |---|---|
  | £30,000 earner | 77.5 s |
  | Couple on £40,000 and £20,000, four children | 87.1 s |
  | £40,000 earner, children 19, 22, 24 and 13 (built three times over, as two turn 25 within 2025-30) | 176.7 s, and 171.7 s again |

  All four answered HTTP 200. Memory peaked at 0.65 of 2 GiB (p99 per minute), with no out-of-memory kills (`read-api-memory.yml`, run 38962235988). On 12 October `main` gave no answer within 300 s. Concurrency on the day (Cloud Run `--concurrency`, and the cost of more instances) is Max's call, through the coordinator.
- **PR #3 holds the real 2026 foundation**: the measure registry, the PolicyEngine-backed household route and the published-data validator. It is still open.
- **The page cannot show combined figures safely yet.** On `main` and on #3, the browser:
  - substitutes zero for missing rows;
  - adds up standalone effects;
  - reads affected population, poverty and Gini from the first selected measure for 2026.

  #20's modules fix all three once they are wired in after #3. The metrics bar also labels the poverty change "relative AHC", but the national calculator uses policyengine-uk's `in_poverty_bhc`, which is absolute poverty before housing costs.
- **Years past the dataset's projection.** On policyengine 6.10.0 (policyengine-uk 2.132.6), the pinned Microcosm UK 2024-25 data are projected to 2032, so every policy year in `budget_years.json`, to 2031-32, is supported, and every default year list in the pipeline is those policy years. Past the OBR's March 2026 forecast (to 2030-31) the projection follows policyengine-uk's long-run assumptions (`yoy_growth.yaml`: CPI at the 2% target from 2031; RPI, CPIH and earnings converging to steady state by 2035–36). Years beyond the dataset's projected years are marked **unsupported** and shown as unavailable, not as final figures.

## Production setup (as created)

**Dashboard: Vercel project `uk-autumn-budget-2026`** (team `policy-engine`, ID `prj_SelxVbakBqqSLdsoS74Qw36wp2E8`), created 12 October:

| Setting | Value |
|---|---|
| Repository | `PolicyEngine/uk-autumn-budget-dashboard-2026`, production branch `main`: a merge publishes |
| Framework | Next.js, Node 24.x. Install is Vercel's default, `bun install`, chosen because `bun.lock` is present; the build is `bun run build`, from `vercel.json`, as in CI |
| Environment | `NEXT_PUBLIC_HOUSEHOLD_API_URL=https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact`, for Production and Preview, added at 23:19:54Z on 24 October, just before #69 merged (read from the project's environment on 25 October). It is the only variable set. It must end in `/api/household-impact`, with no trailing slash: the page POSTs to the value itself (`src/utils/householdImpactApi.js`; see "Household route" below). It is baked in at build time, so setting it takes a new build. A Vercel production build without it fails (`scripts/household-api-env.mjs`, run by `next.config.ts`), except a drill build (`NEXT_PUBLIC_MOCK` set); a value in the wrong form fails every build. The tab no longer reads `NEXT_PUBLIC_LIFECYCLE_API_URL`, which is not set on the project. No `NEXT_PUBLIC_MOCK`; `NEXT_PUBLIC_BASE_PATH` unset, so the code default `/uk/autumn-budget-2026` applies. `BUDGET_API_URL` (#3's proxy) gets the household API URL once #3 lands |
| Deployment protection | Standard (`all_except_custom_domains`), as on the 2025 project `uk-autumn-budget-dashboard` |
| Production domain | `uk-autumn-budget-2026.vercel.app` |
| Deployments | One at every merge to `main`; the latest production deployment is of `5fd6925` (#69), live at 23:21:16Z on 24 October. `main` carries the nine 2026 candidate measures' CSVs, regenerated on 24 October, until Budget day replaces them with the announced measures |

The drill project `uk-autumn-budget-2026-drill` is unchanged. It sets `NEXT_PUBLIC_MOCK` in every environment, and its production target is a `drill1-mock-budget` deployment.

**Household API: Cloud Run `uk-budget-api-2026`**, in `policyengine-apps` (number 578039519715), `europe-west1`, beside the 2025 services:

| Setting | Value |
|---|---|
| URL | `https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` |
| Created | 12 October by Cloud Build `80178569-c9a7-4e24-b2ba-1342802df254`, from commit `f47099d` on #21 before merge |
| Serving | Revision `uk-budget-api-2026-00018-xuv` since 16 October (git `5324080`; policyengine 6.6.0, policyengine-uk 2.130.1, core 3.33.0), deployed through the workflow (run 38960332978). Rollback target: `00016-tes`. Nothing links to it |
| Limits | 2 CPU, 2 GiB, 300 s, public calls with the invoker IAM check off (as on the 2025 `uk-autumn-budget-lifecycle`) |
| Images | `europe-west1-docker.pkg.dev/policyengine-apps/cloud-run-source-deploy/uk-budget-api-2026:<commit>` |
| Deploy | The "Deploy the household API" workflow (#28), action `deploy`, which submits the Cloud Build pipeline. Push deploys stay off until the repository variable `API_DEPLOY_ON_PUSH` is `true` (your call). The fallback is `gcloud builds submit --region europe-west1` on an exact `git archive` of a pushed commit, with `_GIT_SHA` naming it (runbook, "Before the day"). Either way, the build checks the source is that commit, deploys by image digest under a tag only it uses, smoke-tests that tag, and promotes only if traffic has not changed meanwhile (#21). |
| Rollback | The same workflow, action `rollback` (#28), which checks the target's provenance and reruns `main`'s smoke test before moving traffic. Fallback: the build log ends with the allocation it replaced and the `gcloud run services update-traffic … --to-revisions …` command that restores it. |

What else was in the project, read on 12 October: the 2025 services `uk-autumn-budget-dashboard` (2 CPU, 8 GiB) and `uk-autumn-budget-lifecycle` (1 CPU, 512 MiB), each deployed by a Cloud Build trigger on `main` of its own repository. Before 12 October no 2026 service existed there or in `policyengine-api` or `policyengine-household-api`, and no Cloud Build trigger in `policyengine-apps` or `policyengine-api` built this repository. Cloud Run is not enabled in `policyengine-app-v2`, and `policyengine-research` was not readable.


### Household route: `POST /api/household-impact`

The Personal impact tab asks this route about one household, one policy year and a list of measures. It is on the same Cloud Run service as `/api/personal-impact`, and it is computed by `src/uk_budget_data/household_impact.py` through policyengine.py's `pe.uk.calculate_household`, with no dataset, from the same measure definitions and merge as the national figures (`reforms.py`, `publication.combine.merged_changes`).

**How the page reaches it.** The page POSTs to `${NEXT_PUBLIC_HOUSEHOLD_API_URL}` itself. The variable is the service URL followed by the route's path, `/api/household-impact`, with no trailing slash, baked in at build time (so setting it takes a new build), set for Production and Preview:

```
NEXT_PUBLIC_HOUSEHOLD_API_URL=https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact
```

Locally, with `HOUSEHOLD_WORKERS=2 PORT=8010 uv run uk-budget-api`, it is `http://localhost:8010/api/household-impact` (`.env.example`). `scripts/household-api-env.mjs` checks its form at build time: a Vercel production build without it fails, and a value in the wrong form fails every build.

**Request.** `year` (a policy year, 2026 to 2031), `policies` (measure ids; every measure when left out), `household` (the answers; salaries are for `salary_year`, default 2026, and are grown to `year` with the OBR average earnings index; the answer returns the grown salary as `salary_used`) and `include` (`["by_policy", "sweep"]` by default). A field out of range is a 422 naming it. Ask in stages: `include: []` gives the headline and programmes in two runs, then `["by_policy", "sweep"]` adds one run per measure and two sweep runs. Answers are kept per request (64 of them per instance), so moving between years or measures already asked about is immediate.

**Answer.** Net income before ("baseline", pre-Budget law for the selected measures) and after ("reform"), and the change; each measure's own change (that measure switched to its Budget setting, the other selected measures held at pre-Budget law), its status ("not_affected" only for exactly £0) and the residual between the combined change and the sum of the singles; the programmes before and after; each child's dependant status; the rent area used; an earnings sweep of 50 points of the head's employment income with marginal effective tax rates and their own point; and the policyengine and policyengine-uk versions.

**Definitions** (`uk_budget_data.definitions`). Name a measure and the commit its approved receipt was made at with `?definition=<measure id>:<commit>`, once per measure. The answer's `definitions` then gives each one's baseline and reform identities (`kind`, `representation`, `reform_sha256` and `binding`, the fields the receipt's digest depends on), recomputed at that commit from the running build's code. A measure the running code can't bind gets `error` instead.
- **What it binds.** A receipt binds parameter changes by content, and a simulation modifier by its source, its module's source, its default arguments and the commit. The commit is a label in the digest, and the sources are the running build's. So the identities equal the approved receipt's (`execution_receipt.baseline` and `.reform`) exactly when the measure's parameter changes and its modifier's module are the approved ones. A change to either shows up as a difference; a change anywhere else doesn't (below).
- **What it binds, exactly.** A modifier's own source and default arguments, its module's whole source, and the commit (policyengine.py's `_modifier_identity`). The module's loaded state must match its source: every function keeps its literal defaults and every constant its value. policyengine.py refuses to bind a module edited since it was imported, anything in it reassigned at run time, or a namespace holding names its source doesn't bind, such as the `__warningregistry__` a warning attributed to it leaves. A refusal is reported as `error`, never cached, and the definitions in an answer are taken before its calculation runs, so that answer's own run can't change them. An earlier run in the same process (with one worker) can leave a bound module unbindable for later answers: each measure in it is then reported with its `error`, and shown unavailable, never as a match.
- **What it doesn't.** Everything else that is calculation code: code a modifier calls in another module (the templates in `measure_templates.py`, and their module state), the household calculation (`household_impact.py`, `personal_impact.py`, `publication/combine.py`), the request's defaults in `api.py`, the locked dependencies beyond the versions the `engine` field reports, and the image itself (the `Dockerfile`, and its base layers, `python:3.13-slim` and `uv:latest`, which change with no commit). Receipts bind those only through the commit, and listing what changed since one needs git history, which the API image doesn't have; the runbook's G5 says how to list them.
- **Where it is computed.** In the API's image, from a copy of the source with no git history, which gives the same definitions as a checkout (`test_it_is_the_same_from_a_copy_outside_any_repository`). One measure that fails is reported with its `error`, and so is a measure the running code doesn't register (one added since its revision, which the page can name while that revision still serves or after a rollback to it, as `not a measure the running code registers`); the others are still answered. A malformed `definition`, or a measure named twice, is a 400.
- **Why a query parameter.** The body refuses fields it doesn't know, so a build without definitions would refuse a new body field with a 422. It ignores a query parameter, and its answer has no `definitions`. The cached answer is shared whatever commits are named, and `definitions` is always present, empty when none are named.
- **Today the page doesn't name any.** The follow-up to #104 makes it compare each selected measure with its approved receipt, on the headline and on the breakdown, and show one that differs as unavailable.
- `uk-budget-data publish definitions` makes the same comparison for every displayed measure in the manifest, from the local code. With `--api <URL>` it asks a deployed revision instead, in one household request naming every displayed measure at its receipt's commit, and compares what that revision's image serves with the receipts.

**Not modelled for one household.** The rail fares freeze (a national cost spread by rail use: it is in the national figures only); a local authority's choice of BRMA (policyengine-uk reads the BRMA, defaulting to the region's BRMA with the most private-rented households, and reads the local authority only for the few Council Tax Reduction schemes it models).

**Council Tax.** Left out of the request, it is estimated from `council_tax_band` and the region's average Band D for 2026-27 (MHCLG Table 10, tax-base weighted by region; Welsh Government £2,283; Scottish Government £1,653.44), grown with policyengine-uk's OBR Council Tax series; none in Northern Ireland (domestic rates). The answer says which in `council_tax_used`. No measure changes it.

**Concurrency.** See the runbook: requests share the workers run by run, and Cloud Run `--concurrency 4` is the setting to pair with `--cpu 2`.

**Time** (24 October, on a laptop, one household of two earners and three children, warm process): the headline alone about 3 s; every measure with the per-measure split and the sweep about 17 s with 2 workers (the instance's 2 vCPUs, `HOUSEHOLD_WORKERS=2`) and about 10 s with 4. Below 10 s for the whole answer needs 4 vCPUs, and so about 4 GiB (each worker peaks at about 400 MB): `--cpu 4 --memory 4Gi --update-env-vars HOUSEHOLD_WORKERS=4`. That is a cost decision, not made here.

**Smoke test.** The deploy smoke test (`deploy_smoke.py`) asks the route for one headline on an image that has it (`SMOKE_HOUSEHOLD_IMPACT`: a £30,000 earner in 2028 under `badr_lifetime_limit_cut`), and checks the answer is complete. An image older than the route is not checked for it. On an image with definitions, the same request names every registered measure at the deployed commit. The candidate must serve exactly the definitions its image computes (`expected_definitions`, written out by the pipelines' expectations step), and the image must bind every measure, so a definition the served code binds differently, or that the image can't bind, stops the deploy.

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
    metrics.csv  income_curve.csv  household_scatter_binned.csv
    receipt.json  reconciliation.json
    (a not-computable artifact: receipt.json alone)
```

- **No household rows.** #30 (15 October) withdrew the household scatter from every public path: one row per survey household, with its id and weight, is unit-record data under the UK Data Service licence. An artifact carries the scatter binned only, in `household_scatter_binned.csv`: the weighted number of households in each £5,000 baseline income band × £100 income change band, outer bands open-ended, cells with fewer than 10 survey households left out, counts rounded to the nearest 1,000. The sampler reads and writes only in the private directory.
- **Results by area** come from the disclosure layer (#48), not from the artifacts.
- **Not computable.** A measure the certified data cannot cost (#51), or a combined run including one, is written as `receipt.json` alone: its receipt lists no files, so no figure is published, even as a file. Its entry is listed with its reason, and its name comes from the receipt.
- **Generation.** `uk-budget-data generate` writes a new, immutable artifact directory for each measure it runs, and for each combined set it is asked for. It never touches existing directories, so a single-measure run cannot overwrite or erase another measure's numbers.
- **Clearing up.** `publish review-rows` deletes everything under `public/data/artifacts/` that no current manifest entry names, with its review rows, before it writes the new ones. So stage an artifact before writing the review rows, or it goes, and don't write them while a `generate` is running. A hand-written modifier's artifact held for its two-person attestation (#91) can't be staged until the attestation is committed, so commit its attestation and stage it first, or keep the artifact outside the checkout until then.
- **Publishing.** `uk-budget-data publish` is the only command that writes `manifest.json`. It validates first, then replaces the file in one step. Each deploy is one git commit, so the public page switches all at once.
- **Entry status:**
  - `staged`: recorded in the manifest, not shown;
  - `approved`;
  - `provisional`: statement figures only, labelled on the page;
  - `stale`: set automatically, for example when a member of a combined run changes;
  - `withdrawn`;
  - `not_computable`: listed with its reason, never with a figure, and never approved.
- **Corrections.** A correction stages a complete new run. The superseded entry stays in the manifest for audit, as in drill 3. Its artifact is deleted from `public/` the next time the review rows are written.

## Receipts

Every artifact carries `receipt.json` with two parts.

**1. An execution receipt** in the schema policyengine.py publishes for this purpose (execution receipt v1, PolicyEngine/policyengine.py#571, with combined runs in #579). It records:
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
- the name the page shows, which the entry and any tables must also carry;
- per-file hashes;
- the git commit, and whether the working tree was clean;
- the command that produced it;
- the forecast and calibration **basis**: `pre_budget` or `updated`, with source and vintage.

An artifact is publishable only if its receipt says `certified`, the certificate verifies against the bundle it names, and the tree was clean. An explicitly supplied local dataset whose bytes don't match the certified release can never be approved.

### What the receipt asks of measure code

The receipt binds a measure by what it is, so a measure has to be written in a form that can be bound. This changes how measures are coded on the day:

- **Prefer `parameter_changes`.** They are bound by content.
- **A `simulation_modifier` must be a module-level function**, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. It is bound by its source and this repository's commit. Closures, lambdas, nested functions and `functools.partial` are refused, because the values they capture cannot be bound. The tested measure templates are helpers to call from such a function.
- **Its module must have a fixed shape**: at module level only docstrings, imports, one-name literal assignments and undecorated functions, each name bound once, and nothing that changes module state at run time (no caches filled through `global`, no classes, decorators, computed assignments or calls at import). Anything else makes every modifier in the module unbindable, with the line named. `tests/template_measures.py` is a working example. Anywhere in the module, these are refused too: `global` statements; `globals()`, `vars()`, `eval`, `exec`, `compile`, `__import__` and `id`; `is` other than against `None`, `True`, `False` or `...`; reading dunder attributes other than `__init__` and `__name__`; and annotations that call anything (question 6).
- **Infinite values bind.** `float("inf")` for "no cap" is digested as a marked non-finite value (policyengine.py#588), so a cap held at infinity binds as written. NaN is still refused.
- **A combined run** is bound as the ordered list of its members' identities. Before simulating, the dashboard checks that no two members set the same parameter differently, and that every value a member sets alone still holds in the combined scenario.

A measure that cannot be bound fails at generation, naming the measure and the reason. It is never published without a receipt.

## Checks before a measure can be approved

1. **Supported years.** Years beyond the dataset's projected years are marked unsupported. They show as unavailable and are not gated or approved as final figures.
2. **Schema and completeness:**
   - required files and columns are present, with one row per key;
   - every required year is covered, with exact decile sets;
   - all values are finite.

   These are #3's validator checks, applied to artifacts.
3. **One execution identity.** The receipt's execution identity equals the manifest's, and the receipt is certified.
4. **Integrity.** File hashes on disk equal the receipt's.
5. **Reform responsiveness.** Where an effect is expected, the measure's fiscal impact has the expected sign and is at least £1m and 5% of the Treasury's figure. An inert or wrong-direction measure is never published, provisional or approved, and no exception can waive it.
6. **Treasury reconciliation.** Each comparable fiscal year passes or carries an accepted exception (below). Provisional entries skip this check and are labelled.
7. **Household checks.** The measure's household fixtures pass through the deployed route against the same execution identity.
8. **An approval** naming the current output digest.

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
- **Proposed rule** (the numbers are a decision for the team; they live in `data_inputs/treasury/policy.yaml`). A year passes when |ours − Treasury| ≤ max(10% × |Treasury|, £50m).
  - A figure the Treasury prints as zero tolerates only £2.5m, its own rounding.
  - Anything larger needs an exception.
- **Responsiveness** is separate and cannot be excepted (#17). The expectation comes from a reviewed declaration made when the measure is coded, or failing that from the sign of the Treasury's own figure. A measure with neither is "undeclared" and cannot be published.
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

This is separate from the deploy's smoke test (#21), which checks only that a new revision answers with a real calculation, not that the answers are right. The household fixtures are the check on the answers.

## Deployment and rollback

The exact setup is in "Production setup" above.
- **Dashboard rollback.** Vercel Instant Rollback to the recorded previous production deployment, then `git revert` through a pull request. Then promote the fixed deployment with `vercel promote`: after a rollback, Vercel stops assigning the production domain to new deployments, so the fix does not go live until it is promoted ([Vercel's Instant Rollback page](https://vercel.com/docs/instant-rollback), read 12 October).
- **Household API.** Each deploy runs as a revision with no traffic, under a tag only that build uses. It takes traffic only after its smoke test passes on its own URL. A rollback is a Cloud Build pipeline too (#28). It restores only a revision whose own deploy build succeeded and pushed the image it runs. It reruns main's current smoke test on that revision before moving traffic, under the same one-at-a-time lock as deploys, and the workflow then checks the live route. Deploys use main's checker as well, whatever commit they build.

## Runbook

A first draft is in [`budget-day-runbook.md`](budget-day-runbook.md), with the commands as built on the PR stack. It is Vahid and María's to rewrite. Every step has a command and its gate. It follows the drill structure:

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

## Follow-ups after Budget day

- **Read period keys in #3's household calculator as the engine does.** `main`'s calculator has done so since #32 (15 October). #3's `annual_reform_parameters` keeps a key for the year its first four characters name, while the national run on policyengine-uk 2.126.12 also reads `"start.stop"` intervals. Until #3's calculator applies changes through the engine's own route, measures keep to bare-year keys (the runbook's rule, checked in CI by #23), and the templates refuse intervals.
- (Done: the vendored receipt code was deleted when #50 moved to policyengine's released receipt APIs, 55aaa87.)
