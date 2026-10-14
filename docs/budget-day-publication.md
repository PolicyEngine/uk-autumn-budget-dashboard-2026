# Publishing the Budget dashboard incrementally

**Status, 12 October.** Max ruled that changes which only fix bugs or add opt-in tooling are obvious improvements and land on the normal review gates. Most of this design is therefore landing (see "Status of the work"). Six questions remain for Vahid and María; they are below. Comment on the PR that adds this file.

The UK Autumn Budget is on Wednesday 28 October 2026, and the briefing is due by 07:00 on 29 October. There is no model freeze; the model keeps improving through Budget day. So each number on the dashboard and in the briefing has to carry evidence of what produced it, and pass checks, before it is published, measure by measure as measures are coded.

## Questions for Vahid and María

| # | Question | Proposal |
|---|---|---|
| 1 | **Who presses merge on the day, and who reviews reconciliation exceptions?** | Vahid integrates and merges; María reviews exceptions and approves. Nobody approves their own exception. |
| 2 | **When does `generate` switch from the flat CSVs to the gated path** (one write-once artifact per measure, published through the manifest)? | After a rehearsal on the deployed routes shows the page reading the manifest. Until then `--artifacts` is opt-in and the flat CSVs stay the default. |
| 3 | **Should `main` require checks before a merge?** | Python tests, Certified data, Python lint, Frontend build, Frontend tests, Frontend lint and Publication gate. Emergency bypass by Max only, recorded. |
| 4 | **How does #3 land, and with it the Personal impact tab?** W5 will not rebase, rewrite or supersede #3 or the drill branches (#4, #7, #9), and builds so they keep working. | Tell us when you expect to merge #3. The page wiring in #20 follows it, and #3's household route replaces the lifecycle calculator (see "The household API" below). |
| 5 | **When is the rehearsal?** | A full run on the deployed routes by Friday 23 October: intake, dashboard and briefing, including one model upgrade and regeneration, and again after any material change. |
| 6 | **Where do Budget-day `simulation_modifier` functions live?** A receipt binds a modifier only from a module holding nothing but imports, literal constants and undecorated functions (policyengine.py#571). `reforms.py` keeps caches it fills at run time, so a modifier defined there cannot be receipted: on `main` today, `rail_fares_freeze`, `freeze_student_loan_thresholds` and `dividend_tax_increase_2pp` (through its baseline modifier) are refused. Measures made only of parameter changes still bind. | A new `src/uk_budget_data/budget_measures.py` of that shape holds every modifier, and `reforms.py` imports them. We can make that move in a PR after #3 lands, or you can make it in #3. |

The Treasury tolerance and floor in `data_inputs/treasury/policy.yaml` remain proposals until the methodology call (cos d1344) is ruled.

## Status of the work

| Work | Where | State |
|---|---|---|
| CI fails rather than skips, and runs on every PR base | #12 | **Merged** 12 October (3ae8edd) |
| Certified bundle 6.2.6 (UK 2.125.1, data 1.58.0); the student loan freeze, which crashed on it, fixed | #13 | **Merged** 13 October (c8e1788) |
| Certified bundle 6.3.3 (UK 2.126.12, data 1.58.0): a scenario's parameter changes now come before its modifier | #25 | **Merged** 13 October (93d0609). **#3 needs `main` merged in**, so its numbers come from 2.126.12 |
| Household route checker and `/api/version` | #15 | **Merged** 13 October (8401528) |
| Household API deploy: a new revision takes no traffic until a smoke test passes | #21 | **Merged** 13 October (18601b0). The service exists (below) |
| Treasury Table 4.1 import with a printed-totals check | #16 | **Merged** 13 October (ec29ebd). Two narrower layout gaps from its last review close in a follow-up PR |
| Reconciliation and responsiveness gates | #17 | Landing on gates; thresholds are proposals |
| A draft upgrade PR on each qualified policyengine release, never merged automatically | #18 | Landing on gates |
| Receipted, write-once artifacts, the manifest, the `publish` commands and combined runs, all opt-in. The household scatter as today (sampled, same columns) and binned | #19 | Landing on gates |
| The page shows only published figures: unavailable instead of zero, combined statistics only from the combined run, no hardcoded 2026 | #20 | Modules, components and tests done; wiring into the page follows #3 |
| Briefing exports from an approved manifest only; hardcoded figures removed | #22 | Landing on gates |
| Drill fixes as tested measure templates and regressions, no mock measures | #23 | Landing on gates |
| Production Vercel project | Created 12 October | Below |
| `policyengine.org/uk/autumn-budget-2026` | PolicyEngine/policyengine-app-v2#1249 | Draft until the page shows real, gated 2026 numbers |
| Runbook | [`budget-day-runbook.md`](budget-day-runbook.md) | Draft, yours to rewrite |

## Where things stand (12 October)

- **CI.** Hugging Face rejected the repository's token, so CI was red on every PR, and the one dataset test skipped without a token. #12 fixes both, using the org token granted on 12 October.
- **Production dashboard.** The Vercel project exists but has not deployed yet (details below). Nothing public links to it.
- **The household route is too slow for Budget day, on `main` and on #3.** Measured on Cloud Run, 2 CPUs, 12 October:

  | Code | Plain earner (£30,000) | Family with every input filled |
  |---|---|---|
  | `main` | no answer after 300 s (HTTP 504) | not tried |
  | #3 (no-traffic revision `pr3`) | 25 s, and 27 s warm | 114 s |

  Neither loads the population dataset: both build single-household simulations. The time goes on building them. #3 builds a new simulation for every year, policy and side: 12 for the plain earner, 58 for the family. Each takes about 1 second to build on policyengine-uk 2.125.1 (measured locally), while calculating on a built simulation takes about 0.1 s. One simulation per policy and side, covering all six years, would cut the family's 58 builds to about 10. Concurrent requests also share an instance's 2 CPUs (Cloud Run allows 80 at once by default), so latency grows with traffic.
- **PR #3 holds the real 2026 foundation**: the measure registry, the PolicyEngine-backed household route and the published-data validator.
- **The page cannot show combined figures safely yet.** On `main` and on #3, the browser:
  - substitutes zero for missing rows;
  - adds up standalone effects;
  - reads affected population, poverty and Gini from the first selected measure for 2026.

  #20 fixes all three once it is wired in. The metrics bar also labels the poverty change "relative AHC", but the national calculator uses policyengine-uk's `in_poverty_bhc`, which in 2.126.12 is absolute poverty before housing costs.
- **Years past the dataset's projection.** policyengine-uk projects datasets only to 2030. Years beyond the dataset's projected years are marked **unsupported** and shown as unavailable, not as final figures.

## Production setup (as created)

**Dashboard: Vercel project `uk-autumn-budget-2026`** (team `policy-engine`, ID `prj_SelxVbakBqqSLdsoS74Qw36wp2E8`), created 12 October:

| Setting | Value |
|---|---|
| Repository | `PolicyEngine/uk-autumn-budget-dashboard-2026`, production branch `main`: a merge publishes |
| Framework | Next.js, Node 24.x, Vercel's defaults for install and build |
| Environment | None set. No `NEXT_PUBLIC_MOCK`; `NEXT_PUBLIC_BASE_PATH` unset, so the code default `/uk/autumn-budget-2026` applies. `BUDGET_API_URL` (#3's proxy) gets the household API URL once #3 lands |
| Deployment protection | Standard (`all_except_custom_domains`), as on the 2025 project `uk-autumn-budget-dashboard` |
| Production domain | `uk-autumn-budget-2026.vercel.app` |
| Deployments | None yet. The first production deployment happens at the next merge to `main`. Until the measures are regenerated, `main` still carries the 2025 measures' CSVs |

The drill project `uk-autumn-budget-2026-drill` is unchanged. It sets `NEXT_PUBLIC_MOCK` in every environment, and its production target is a `drill1-mock-budget` deployment.

**Household API: Cloud Run `uk-budget-api-2026`**, in `policyengine-apps` (number 578039519715), `europe-west1`, beside the 2025 services:

| Setting | Value |
|---|---|
| URL | `https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` |
| Created | 12 October by Cloud Build `80178569-c9a7-4e24-b2ba-1342802df254`, from commit `f47099d` on #21 before merge |
| Serving | Revision `uk-budget-api-2026-00001-gow`. A service's first revision must take traffic; nothing links to it |
| Limits | 2 CPU, 2 GiB, 300 s, public calls with the invoker IAM check off (as on the 2025 `uk-autumn-budget-lifecycle`) |
| Images | `europe-west1-docker.pkg.dev/policyengine-apps/cloud-run-source-deploy/uk-budget-api-2026:<commit>` |
| Deploy | No trigger. `gcloud builds submit --region europe-west1` on an exact `git archive` of a pushed commit, with `_GIT_SHA` naming it (runbook, "Before the day"). The build checks the source is that commit, deploys by image digest under a tag only it uses, smoke-tests that tag, and promotes only if traffic has not changed meanwhile (#21). |
| Rollback | The build log ends with the allocation it replaced and the `gcloud run services update-traffic … --to-revisions …` command that restores it. |

What else is in the project, read on 12 October: the 2025 services `uk-autumn-budget-dashboard` (2 CPU, 8 GiB) and `uk-autumn-budget-lifecycle` (1 CPU, 512 MiB), each deployed by a Cloud Build trigger on `main` of its own repository. Before 12 October no 2026 service existed there or in `policyengine-api` or `policyengine-household-api`, and no Cloud Build trigger in `policyengine-apps` or `policyengine-api` built this repository. Cloud Run is not enabled in `policyengine-app-v2`, and `policyengine-research` was not readable.

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
    [constituency.csv  demographic_constituency.csv]
    receipt.json  reconciliation.json
```

- **The household scatter, as today.** Max decided on 12 October to keep the household-level scatter files that `main` and the 2025 site publish (cos d1397), so each artifact carries `household_scatter.csv` with exactly today's columns (reform, year, baseline income, income change, household weight and household id) for a weighted sample of 500 households, as `scripts/sample_household_scatter.py` makes it: seed 42, households present in every year, kept in every year. The sample is drawn household by household (each gets a key from its id and weight), so every measure and combined run shows the same households wherever they are in the plotted range, and the dots move rather than reshuffle when measures are combined.
- **And binned.** Each artifact also carries `household_scatter_binned.csv`: the weighted number of households in each £5,000 baseline income band × £100 income change band, outer bands open-ended, cells with fewer than 10 survey households left out, counts rounded to the nearest 1,000. The page can use either.
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
- per-file hashes;
- the git commit, and whether the working tree was clean;
- the command that produced it;
- the forecast and calibration **basis**: `pre_budget` or `updated`, with source and vintage.

An artifact is publishable only if its receipt says `certified`, the certificate verifies against the bundle it names, and the tree was clean. An explicitly supplied local dataset whose bytes don't match the certified release can never be approved.

### What the receipt asks of measure code

The receipt binds a measure by what it is, so a measure has to be written in a form that can be bound. This changes how measures are coded on the day:

- **Prefer `parameter_changes`.** They are bound by content.
- **A `simulation_modifier` must be a module-level function**, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. It is bound by its source and this repository's commit. Closures, lambdas, nested functions and `functools.partial` are refused, because the values they capture cannot be bound. The tested measure templates are helpers to call from such a function.
- **Its module must have a fixed shape**: at module level only docstrings, imports, one-name literal assignments and undecorated functions, each name bound once, and nothing that changes module state at run time (no caches filled through `global`, no classes, decorators, computed assignments or calls at import). Anything else makes every modifier in the module unbindable, with the line named. `tests/template_measures.py` is a working example Anywhere in the module, these are refused too: `global` statements; `globals()`, `vars()`, `eval`, `exec`, `compile`, `__import__` and `id`; `is` other than against `None`, `True`, `False` or `...`; reading dunder attributes other than `__init__` and `__name__`; and annotations that call anything (question 6).
- **Infinite values bind.** `float("inf")` for "no cap" is digested as a marked non-finite value (policyengine.py#588), so `salary_sacrifice_cap` binds as written. NaN is still refused.
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
- **Household API.** Each deploy runs as a revision tagged `candidate` with no traffic. It takes traffic only after its smoke test passes on its own URL. Rollback moves traffic back to the revision the build log names, then re-runs the household checks on the live route.

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

- **Read period keys in the household calculator as the engine does.** On `main`, `personal_impact.create_simulation` applies a parameter change only where the key is the year itself; #3's `annual_reform_parameters` keeps a key for the year its first four characters name. The national run on policyengine-uk 2.126.12 also reads `"start.stop"` intervals. Until the household calculator applies changes through the engine's own route, measures keep to bare-year keys (the runbook's rule, checked in CI by #23), and the templates refuse intervals.
- **Delete the vendored receipt code** (`publication/_vendor_w4`) once the dashboard pins a policyengine release containing policyengine.py #571, #579 and #588.
