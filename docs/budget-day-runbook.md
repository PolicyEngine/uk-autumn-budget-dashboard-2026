# Budget-day runbook (draft)

**Status: draft for Vahid and María, who own this document and the workflow it describes.** It follows the drill 3 structure (G0 to G5). Commands marked with a PR number exist once that PR merges. Times are the drill's, to be replaced by the real release times. The design behind it is in [`budget-day-publication.md`](budget-day-publication.md).

Wednesday 28 October 2026. Briefing by 07:00 on Thursday 29 October.

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | Every commit, generation, `publish stage`, the pull request that deploys | Approve their own reconciliation exceptions |
| **Reconciler, then scorer** (María) | Coverage ledger, Treasury entry, reconciliation, exception review, `publish approve`, household fixtures | Push measure code |
| **Deploy and rollback** (Vahid, W5 on standby) | The merge that publishes; Vercel and Cloud Run rollback (the Cloud Run deploy and rollback through the GitHub Actions workflow, #28) | Deploy from a laptop except as a fallback |
| **Briefing** (to be agreed) | Export from an approved manifest revision; the article | Use any number not in the manifest |
| **Media first cut** (to be agreed) | Sends ITV the first-cut figures and puts them in the webinar slides (see "First cut" below) | Send any figure that is not approved in that manifest revision |

## Before the day: the deployed-route rehearsal, by Friday 23 October

- [ ] **Production route live.** The dashboard serves at `https://policyengine.org/uk/autumn-budget-2026` (policyengine-app-v2#1249, still a draft) from the production Vercel project, which tracks `main`.
  - Project: `uk-autumn-budget-2026`, team `policy-engine`, ID `prj_SelxVbakBqqSLdsoS74Qw36wp2E8` (created 12 October).
  - Domain: `uk-autumn-budget-2026.vercel.app`.
  - Last production deployment ID, the rollback target: record before every merge on the day.
- [ ] **Household API live.**
  - URL, **the household URL for the day**: `https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` (Cloud Run `uk-budget-api-2026`, project `policyengine-apps`, `europe-west1`).
  - Serving revision and image: record after the last deploy before the day. On 25 October it is `uk-budget-api-2026-00024-lir` (git `5fd6925`, the merge of #69; policyengine 6.10.2, policyengine-uk 2.132.6, core 3.33.3), deployed by Vahid at 23:27Z on 24 October. Each re-cut redeploys it (see "Rolling re-cuts" below).
  - **How long one household answer takes.** Since #69 the Personal impact tab calls `/api/household-impact`: one household, one year, the selected measures. It asks in two stages: the headline first (`include: []`), then each measure's own effect and the earnings sweep (`by_policy`, `sweep`). It waits 90 s for the first and 200 s for the second (`householdImpactApi.js`), and the server gives up at 280 s with a 504 (`HOUSEHOLD_CALCULATION_TIMEOUT`). On `00024-lir`, for a household new to the revision, a headline took 16.7 to 17.3 s and a breakdown 81.0 to 83.9 s.
    - **What the gates cover.** The deploy's smoke test asks `/api/household-impact` for one headline of one measure (`SMOKE_HOUSEHOLD_IMPACT` in `deploy_smoke.py`: `badr_lifetime_limit_cut`, 2028, `include: []`), and makes one full `/api/personal-impact` request for the £30,000 earner (six years, now nine measures), a route the page no longer calls. The same request took 96.1 s on `00024-lir` in the timings below. The household check posts only to each fixture's `route`, and the plumbing fixture's is `/api/personal-impact`.
    - **So no gate asks for a breakdown,** the stage the page waits longest for. A revision whose breakdown passes 200 s, or 280 s, would still take traffic. So after each deploy, time one breakdown (see "Adopting a release").
    - Cloud Run serves both routes on 2 CPUs with a 300 s request timeout, so a smoke-test request that takes more than 300 s fails it, and the revision never takes traffic. Don't loosen the smoke test or raise the timeout to get a deploy through. Time #3's route against these figures. The timings are under "Deploy and roll back once" below.
  - **Deploy through GitHub Actions**, not from a laptop: the "Deploy the household API" workflow (#28), action `deploy`, on `main`. It needs no one's gcloud login: it authenticates through Workload Identity Federation, with the grants made on 15 October (Max, d1538). It runs the same Cloud Build pipeline as the command below, waits for it, and checks that the live `/api/version` names the commit. Push deploys stay off until the repository variable `API_DEPLOY_ON_PUSH` is `true` (your call: `main`'s household route has passed the smoke test since 15 October).
  - **Fallback only**, if Actions is down: the same deploy from a laptop, as an exact archive of a commit already pushed to `main`. It needs a gcloud login that can re-authenticate, which failed twice in the week of 12 October. Run it from an up-to-date checkout of `main`, and submit **that checkout's** `cloudbuild.yaml`, never the archive's own. An older commit's copy lacks the one-deploy-at-a-time lock and the traffic check. To deploy an older commit, change `commit` and keep the config:

    ```sh
    git fetch origin && git switch --detach origin/main
    commit=$(git rev-parse origin/main)
    dir=$(mktemp -d)
    git archive "$commit" | tar -x -C "$dir"
    gcloud builds submit "$dir" --project policyengine-apps \
      --region europe-west1 \
      --config cloudbuild.yaml --substitutions _GIT_SHA="$commit"
    ```

    **One deploy at a time:** deploys run only in `europe-west1` (a build submitted without `--region europe-west1` stops before touching the service), and a build that finds another deploy of the service running there stops. The build refuses source that is not exactly that commit. It tests the new revision under its own tag. It moves traffic only if the smoke test passes and nothing else changed traffic meanwhile. The log ends with the allocation it replaced and the command that restores it.

  `curl -s "$HOUSEHOLD_API/api/version"` must report the bundle's model and core versions (#15).
- [ ] **Required checks on `main`.** Since 15 October the ruleset "Protect main" (id 25151682) requires a pull request (no approvals) and these checks:
  - Python tests;
  - Certified data;
  - Python lint;
  - Frontend build, tests and lint.

  Force-push and deletion are blocked. Org admins can bypass through a pull request, and the policyengine App always. Whether to require Publication gate too is your call (question 3 in `budget-day-publication.md`).
- [ ] **Household fixtures: specimen households before the rehearsal.** `data_inputs/household_fixtures/` (#15) holds its README, a draft example (`example-zero-income.json`, marked `"draft": true`, which the checker skips) and the plumbing fixture (#65).
  - **The plumbing fixture** is a single employee on £12,000. It checks that the route answers on the bundle's versions, with the response's shape, and that each of the route's nine measures changes a household it can't reach by £0 in every year, and that it gets no Universal Credit in the baseline (since #69; before, seven of eight measures, and no measure giving it Universal Credit). It checks no non-zero answer.
  - **It is enough for the check to pass.** The check needs at least one non-draft fixture, and passes when every fixture it checks passes and the API's versions match the bundle's (`run_checks`). So with the plumbing fixture alone, the household check can pass at G0, G2 and G4 on `main`'s route. The checker doesn't require a fixture for each measure.
  - **The accuracy check is still to come:** specimen households whose non-zero answers are computed independently of the API (the README says how), at least one reached by each measure. Proposed: María's specimen households. Whether the checker should refuse to pass until every measure has one is your call.
- [ ] **Nothing published says 2025.** The repository began as a copy of last year's dashboard. Checked on 13 October against `main` (93d0609) and #3; the first two rows re-checked on 19 October against `main` (5324080):

  | Where | What it says | Shown today? | Who fixes it |
  |---|---|---|---|
  | `public/combined_reforms/*.html` (five pages) | Four titled "Combined Autumn Budget 2025", and an untitled `revenue.html`, all with last year's figures | **No.** Removed by #26 (15 October), which also tests that no static page names another year's Budget | Done. The briefing export (#22) writes this year's from an approved manifest |
  | `public/data/budgetary_impact.csv`, `distributional_impact.csv`, `winners_losers.csv`, `metrics.csv` | **24 October (branch `ab2026-candidates`):** regenerated on the ten candidate 2026 measures (`reforms.py`), replacing last year's nine; the salary sacrifice cap candidate was dropped later that day (nine measures), and the combined package regenerated without it. `obr_comparison.csv` still holds last year's OBR rows, under last year's ids, so it pairs with nothing: the comparison says it is not available until the OBR publishes on 28 October | Yes, with the candidate banner under the intro | Budget day replaces the candidates with the announced measures |
  | `OBRComparisonTable.jsx` | "November 2025 Economic and Fiscal Outlook", with a link to it | **Yes**, on the Population impact tab, when its OBR comparison panel is opened | #3, which changes the file and stops showing the table |
  | The Personal impact tab's hand-typed calculator | "Household inputs (2025)", "Ages of children in 2025", "2025 £" | No | Deleted in #69: the tab now calls `/api/household-impact` (policyengine.py) |
  | `PersonalImpactForm.jsx` | "Your annual employment income (2025)", "Children (ages in 2025)" | Not on `main`. **Yes once #3 merges** | #3. Its `build_situation` grows income and ages from a 2025 base, so this is a choice of base year, not only a label |
  | `policyConfig.js` in #3, and the flat `public/data/*.csv` | A policy named "Autumn Budget 2025 (combined)" (id `autumn_budget_2025_combined`), with last year's rows | In #3, only through an old shared URL | #3 keeps it for old links: **your call** whether a 2026 page should still answer them |
  | `Results.jsx`, `HouseholdImpactChart.jsx` | "2025 to 2030"; a hardcoded "in 2025" figure | No: nothing imported them, on `main`, in #3 or in the drills | Deleted in #69 (the UI redesign) |
  | `scripts/generate_combined_charts.py` | Chart titles "Combined Autumn Budget 2025" | Not a page | #22 |

  The page title and heading already say "UK Autumn Budget 2026".
- [ ] **Deploy and roll back once through the workflow (#28)**, after the grants in d1538: deploy `main`'s head, roll back to the previous revision, deploy again. Record the revisions here.
  - **15 October, deploy of `main` at 7c5e4fa** (run 38716544528, build fb42c4a6): every step up to the smoke test passed with the d1538 grants. The candidate `uk-budget-api-2026-00003-jic` (policyengine 6.4.1, policyengine-uk 2.130.1, core 3.33.0) took no traffic. The smoke test failed with `/api/personal-impact returned HTTP 504`: the full household request did not finish within Cloud Run's 300 s. Traffic was left as it was: `uk-budget-api-2026-00001-gow` at 100%. That is 12 October's revision (git f47099d, policyengine 6.2.6, policyengine-uk 2.125.1), and `/api/version` confirms it is live.
  - **15 October, deploy of `main` at 1ce4984** (#39 and #42; run 38732006985): the candidate `uk-budget-api-2026-00004-fur` passed the smoke test and took all traffic, about 6.5 minutes from submit to live. Before: `uk-budget-api-2026-00001-gow` at 100%. `/api/version` reports 1ce4984 with policyengine 6.4.1, policyengine-uk 2.130.1 and core 3.33.0.
  - **On 15 October the rollback target was `00004-fur`,** then the only revision that passed `main`'s smoke test. A rollback runs that test against its target before moving traffic, and `00001-gow` (12 October's) doesn't answer within 300 s, so a rollback to it would be refused before traffic moves. (The target now is below.)
  - **15 October, rollback rehearsal, through the workflow each time:**

    | Step | Run | What happened | Live afterwards |
    |---|---|---|---|
    | 1. Deploy `main` (1ce4984) | 38734841265 | `00006-qih` passed the smoke test and replaced `00004-fur` | `00006-qih`, 1ce4984 |
    | 2. Roll back to `00004-fur` | 38735958536 | **Refused, no traffic moved.** Provenance and tagging passed. The smoke test's `/api/personal-impact` got HTTP 503 after 98.8 s: Cloud Run killed the instance for exceeding its memory ("Memory limit of 2048 MiB exceeded with 2050 MiB used", 12:40:03Z, from the coordinator's read of the logs). A retry minutes later answered HTTP 200 in 130 s | `00006-qih` |
    | 2, again | 38736878049 | Rolled back to `00004-fur`, replacing `00006-qih`; `/api/version` named `00004-fur` (1ce4984) | `00004-fur`, 1ce4984 |
    | 3. Deploy `main` (d488145) | 38737646035 | `00012-ruy` passed the smoke test and replaced `00004-fur` | `00012-ruy`, d488145 |

    `/api/version` after step 3: d488145, with policyengine 6.4.1, policyengine-uk 2.130.1 and core 3.33.0. The revision numbers jumped from 00006 to 00012; W5 didn't create 00007 to 00011.
  - **Deploys since, each through the workflow, each passing the smoke test before taking all traffic:**

    | Deployed | Run | Revision | What changed |
    |---|---|---|---|
    | 15 October, `759c0a6` | 38765842833 | `00014-coj`, replacing `00012-ruy` | #46: each request spread over the instance's vCPUs |
    | 16 October, `5482ca6` | 38867243746 | `00016-tes`, replacing `00014-coj` | #49: workers stopped for certain; policyengine 6.5.0 |
    | 16 October, `5324080` | 38960332978 | `00018-xuv`, replacing `00016-tes` | policyengine 6.6.0 (#56) |
    | 22 October, `ff217d3` | 39698257053 | `00020-pal`, replacing `00018-xuv` | policyengine 6.10.0 (#72): Microcosm data 0.1.0, policyengine-uk 2.132.6 |
    | 24 October, `1acbd44` | 40114977669 | `00022-suw`, replacing `00020-pal` | policyengine 6.10.2 (#102): the same policyengine-uk and data as 6.10.0; only version strings change |
    | 24 October, `5fd6925` | 40142327478 | `00024-lir`, replacing `00022-suw` | #69, the UI redesign: adds `/api/household-impact`, the route the Personal impact tab calls, and removes `/api/lifecycle/calculate`. Dispatched by Vahid |

  - **Live and rollback target, 25 October:** `00024-lir` is live. The revision it replaced, `00022-suw`, passed the smoke test when it was deployed, but **it can't serve the page that is live now.**
    - **Why:** since #69 the Personal impact tab calls `/api/household-impact`, which no revision before `00024-lir` has (`household_impact.py` doesn't exist at `1acbd44`). Rolling the API back to `00022-suw` or earlier keeps the rest of the page, but the tab fails for every household.
    - **The rollback pipeline doesn't catch it.** Its smoke test checks `/api/household-impact` only on an image that has the route (`expected_household_impact` in `deploy_smoke.py`), so a rollback to `00022-suw` passes and moves traffic.
    - **Rolling the dashboard back to before #69 doesn't help either.** Its Personal impact tab, the lifetime calculator, never calculated in production: it throws before any request when `NEXT_PUBLIC_LIFECYCLE_API_URL` is unset (`LifecycleCalculator.jsx` at `1329312`). None of the 70 production builds before #69 (12 to 24 October) had that variable. The production project's only variable is `NEXT_PUBLIC_HOUSEHOLD_API_URL` (production and preview), added at 23:19:54Z on 24 October, just before #69 merged.
    - **So until the next deploy,** keeping a working Personal impact tab through an API fault means fixing forward, or redeploying `main` if the fault isn't in its code. From the next deploy on, its rollback target is `00024-lir`, the first revision with the route.
  - **The household route can exceed 2 GiB.** Cloud Run killed two instances for exceeding the 2 GiB limit. Those are the only two such kills since 12 October, from the coordinator's read of the logs:
    - `00004-fur` at 12:40:03Z (2050 MiB), which gave step 2's 503;
    - `00003-jic` at 10:09:59Z (2054 MiB), during the first deploy's smoke test, so that 504 may have been memory as well as the 300 s limit.

    One full request, or a later request on an instance that has already run some (policyengine-core keeps what each build registers), could pass 2 GiB then. A smoke test or a rollback can therefore fail on memory, and retrying is not a fix. The memory setting is in the capacity decision going to Max.
  - **Memory since #49:** the `read-api-memory.yml` workflow (#54) read a peak of 0.62 of 2 GiB on `00016-tes`, 0.65 on `00018-xuv`, 0.59 on `00020-pal` (about 1,208 MiB; run 39705395549) as p99 per minute over the timing runs below, with no out-of-memory lines. On `00022-suw` it read 0.64 (about 1,311 MiB; run 40116261683), peaking at 17:17Z during the deploy's smoke test; the window also covered the household check and the timing runs. On `00024-lir` it read 0.66 (about 1,351 MiB; run 40166629627) over the smoke test, the household check and both routes' timing runs, again with no out-of-memory lines.
  - **Cold start:** 32.6 s to the first response from an idle revision (`/api/version`).
  - **How long one household answer takes on Cloud Run, one request at a time:**

    | Request | `00004-fur`, 15 October | `00016-tes`, 16 October | `00018-xuv`, 16 October | `00020-pal`, 22 October (6.10.0) | `00022-suw`, 24 October (6.10.2) | `00024-lir`, 25 October (#69, nine measures) |
    |---|---|---|---|---|---|---|
    | £30,000 earner | 142.5 s | 85.0 s | 77.5 s | 83.8 s | 71.3 s | 96.1 s |
    | Couple on £40,000 and £20,000, children 3, 6, 9 and 12 | not timed | 94.4 s | 87.1 s | 77.5 s | 70.8 s | 90.4 s |
    | £40,000 earner, children 19, 22, 24 and 13 | 504 after 300 s | 187.6 s, then 195.8 s | 176.7 s, then 171.7 s | 182.6 s, then 167.2 s | 171.7 s, then 165.5 s | 195.1 s, then 193.7 s |

    These are `/api/personal-impact` requests. The last household has two children who turn 25 within 2025-30, so it is built three times over, and it is the slowest answer found. It failed on `00004-fur` (which had #42); it answered on every revision timed since #46 (`00016-tes` to `00024-lir`). `00024-lir` is slower. Its route covers nine different measures (the 2026 candidates, in place of last year's eight), and #69 also changed how runs share the workers (`FairSlots`). Every household is slower, by 14% to 35%, more than the earlier change between `00020-pal` and `00022-suw` on the same code (1% to 15% faster). Which of the two changes, if either, caused it isn't measured.
  - **The route the page calls, `/api/household-impact`, on `00024-lir`** (25 October, one request at a time, each household new to the revision):

    | Request | Headline (`include: []`) | Breakdown (`by_policy`, `sweep`) |
    |---|---|---|
    | £31,000 earner, 2027-28 | 16.7 s | 81.0 s |
    | Couple on £41,000 and £21,000, children 3 and 7, 2028-29 | 17.3 s | 83.9 s, then 68.2 s |

    The couple's request also sent `monthly_rent: 950`, but no `tenure`, so the default (owned with a mortgage) applied and no rent was counted. The repeated breakdown wasn't answered from the route's per-process cache (`_cached_household_impact` in `api.py`), which would have returned it at once. The image runs one uvicorn process, so another instance answering it would explain this, but that isn't established. The timings since 16 October are sequential `curl` requests to the live URL (`runs/household-api-<revision>.log` in W5's folder); each answer's `Server-Timing` header gives the calculation's own time, which was within 0.3 s of the total.
  - **Concurrent household calculations share the workers.** `/api/household-impact` admits up to `HOUSEHOLD_CONCURRENT_REQUESTS` requests per instance at once (default 4; 1 when `HOUSEHOLD_WORKERS` is 1), and their runs share the instance's `HOUSEHOLD_WORKERS` processes run by run (`FairSlots` in `personal_impact.py`; `/api/personal-impact` takes the same slots), so a second visitor's headline starts as soon as any run finishes instead of after the first visitor's whole calculation, and memory stays bounded by the workers. Measured on 24 October on a laptop with 2 workers, three different full requests at once: before, 23, 47 and 73 s (each queued behind the last); after, 54, 58 and 59 s. Three visitors asking in the page's two stages: headlines in 4–11 s either way, the last breakdown at 68 s before and 53 s after. The page now waits 90 s for a headline and 200 s for a breakdown; the server gives up at 280 s with a 504.
    **Cloud Run setting needed:** `--concurrency` should match what an instance can serve in time. With `--cpu 2` and `HOUSEHOLD_WORKERS=2`, set `--concurrency 4` (equal to `HOUSEHOLD_CONCURRENT_REQUESTS`), so a fifth visitor goes to another instance rather than queueing; the deploy does not set it today, so Cloud Run's default of 80 applies. Not changed in `cloudbuild.yaml` here: it is a cost decision (more instances), Max's call through the coordinator.
- [ ] **Rehearsal.** Intake, dashboard and briefing on the deployed routes, including one model upgrade and regeneration. Record the receipt here. Repeat after any material change.
  - **Time the regeneration** (regenerate, stage, reconcile: the fifth row of the table under "How long one adoption takes" below), as that section says, and post the time to the coordinator on GitHub. The coordinator sets the final cut's times from it.

## How a measure must be written

Every published measure is receipted, and the receipt can only bind a measure written in one of these forms:

- **`parameter_changes`**, wherever the measure can be expressed that way.
- **A module-level function** as `simulation_modifier`, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. The tested templates (#23) are helpers to call from such a function.
- **In a module of fixed shape**: only imports, literal constants and undecorated functions, each name bound once. Not in `reforms.py`, whose run-time caches make every modifier in it unbindable (question 6 in `budget-day-publication.md`). `tests/template_measures.py` is the pattern.

**Its name and description may name only the taxes it moves.** Both are public: the personal impact API returns them. Every registered measure must be declared in `DECLARED` in `tests/test_measure_descriptions.py` with the taxes whose rules its code changes, and the required Python tests fail until it is. They also fail on copy that names a tax the measure doesn't declare, or one the module doesn't know (add it to `TAX_NAMES`, and its parameters to `TAX_PARAMETERS`), on an unnamed "tax", "taxed" or "taxable" in a measure that doesn't move income tax, on an unnamed "duty" in one that moves no duty, and on an unnamed "levy" in one that moves no levy. Second-round and modelling effects don't count: a measure declares the taxes whose rules its code changes, not every tax the model moves.

**Every scored year must be written for an uprated amount** (policyengine-uk #2430). On either side of a measure, give an explicit value for every scored year from the first changed year onwards. State Pension, benefit rates and the LEL otherwise return to the old projected path after a bounded change; the personal allowance and threshold freeze are unaffected. Generation keeps the other measures and refuses a gap with `REFUSED <id>: <path> has no value for <years>; after a bounded change an uprated amount returns to the old path (policyengine-uk #2430). Write every scored year.` The flat pipeline warns instead.

**The engine's wealth-tax scales are refused** (UK hub, `budget-triage/JUDGED.md` S4). Both tax a gross base, so an announcement on net assets would use the wrong one:
- `wealth_tax` applies `gov.contrib.ubi_center.wealth_tax` to `total_wealth`: gross wealth, including private pensions, with no debts netted (S4).
- `non_primary_residence_wealth_tax` applies `gov.contrib.cec.non_primary_residence_wealth_tax` to `total_wealth` less `main_residence_value`: the same gross wealth, less the main home's full value rather than its equity. S4 names only the first; this one was read in policyengine-uk 2.132.6.

Both count in `household_tax` and `gov_tax`.
- **The templates refuse any path under either scale.**
- **Generation refuses a measure that changes either scale,** before any figure is made, with `REFUSED <id>: <path> is under <scale>, …`. The other measures are still written. It looks in two places:
  - the measure's `parameter_changes`, on either side and in the configured baseline, before any simulation is built;
  - its two built simulations, compared with each other as the model limits compare theirs. This catches a hand-written modifier that edits a scale's brackets or rebinds it, with no `parameter_changes`, on one side or differently on the two sides. The same edit made on both sides leaves the two simulations agreeing, so it isn't caught; written as `parameter_changes`, it is.
- **The flat pipeline warns instead.**
- **Registering such a measure fails CI** (`tests/test_wealth_tax_template.py`).
- **A hand-written modifier that taxes a base it reads directly from `wealth_tax`, `non_primary_residence_wealth_tax` or `total_wealth`** is held not computable by hand, for the same reason. Nothing in the code catches one, since the scales are unchanged.
- **A modifier that taxes `net_wealth`** (total wealth less mortgage, consumer and student-loan debt) is on the net base, so this reason doesn't apply to it, but give it a scale of its own. Generation refuses a change to either engine scale, even from a modifier that re-points the engine's formula at `net_wealth`, and the refusal then names the engine's gross base. Review it like any other hand-written modifier.

**An HVCTS band uses the engine's own index.** `apply_property_band_surcharge` reads the native formula's compiled index names and uses the same index, as the engine does: it deflates property values by OBR GDP per capita, or projects the band's bounds by the OBR house-price index. It refuses a formula reading neither or both, so a new band cannot overlap the native bands because it uses a different index.

**A measure on pension tax relief, the annual allowance, its taper or the MPAA is expected to fail the Treasury reconciliation. By default it is held for the 07:00 briefing pending review** (Vahid and María to confirm).
- **Why:** the UK hub's rebuild of policyengine-uk #2240 replays the Spring Budget 2023 pension changes at about −£12.9bn over four years against the OBR's −£1.55bn, roughly 8 times over. The remaining causes are mostly data: the imputation of pension inputs, defined-benefit accrual, the taper's income measure and carry-forward. A pensions decomposition is queued; revisit this row when it reports.
- **The limitation sentence** (final; from the UK hub, 16 Oct, for the dashboard methodology and wherever such a measure is listed):

  > "The model overstates the pension annual allowance charge: for 2024-25 it finds 262,000 people with pension savings above their allowance, against 30,440 in HMRC's provisional self-assessment statistics for the same year, and £2.7 billion of annual allowance charge against HMRC's provisional estimate of £0.3 billion, so pension tax relief and annual allowance measures are not published on Budget day without review."

  - **Sources, all tax year 2024-25:** HMRC private pension statistics (July 2026), Table 7, row "2024 to 2025 [provisional]": 30,440 individuals reporting contributions above their allowance through self assessment. Table 6, column "2024 to 2025 tax year [provisional]": £300m of annual allowance charges. The model's 262,304 people and £2.699bn are model year 2024 (tax year 2024-25), from uk-data 1.58.1 with policyengine-uk #2240's charge formulas: counts and aggregates only.
  - **Cause:** the UK hub's research report attributes it mostly to the imputation of employer pension contributions, tracked as uk-data#606, which lands after the Budget.
- **What the gate does:** approval needs the reconciliation to pass or carry an accepted exception, and the briefing exports take approved entries only. So such a measure stays out of the briefing unless someone approves an exception. The default is to hold it, not to approve a named-reviewer exception on the day.
- **Still open, for Vahid and María:**
  - whether it is shown on the page meanwhile: staging it as provisional does not need the reconciliation, and the page labels it provisional;
  - who may approve an exception for it, if anyone;
  - where the limitation sentence appears on the page (the methodology section, the measure's own entry, or both).

**A measure on the SDLT higher rates, or on non-residential purchases, is published as not computable on current data, never as a figure** (#51).
- **On `main` since #51.** Generation records the limit, and the gate and the page refuse a figure for it, as below.
- **Why:** policyengine-uk #2241 (merged 15 Oct, fixing issue #2238) makes `additional_residential_property_purchased` and `non_residential_property_purchased` inputs, nil unless a dataset imputes them. The certified dataset (uk-data 1.58.1, sha256 `056e80fd…`) holds only the property stocks, not those columns. So these rates apply to nothing; before #2241, to a buyer's whole stock of other property. On Microcosm, see "The data line changed" below: 6.10.0's data has no purchases either, and its policyengine-uk (2.132.6) predates #2241, so the whole-stock case applies.
- **Partly computable measures publish with a figure** (#51's scope since its round 3). A measure that changes a total including these purchases, such as SDLT `abolish` or LBTT's main residential scale, records no limit. Its figure includes the purchases as the model and data give them: a buyer's whole stock of other property before policyengine-uk #2241 (as in 6.10.0's 2.132.6), and nothing after it until certified data impute purchases. Say so wherever such a figure appears.
- **Which parameters:** `uk_budget_data.data_limits` lists them:
  - SDLT `gov.hmrc.stamp_duty.residential.purchase.additional` (the higher rates for additional dwellings) and `gov.hmrc.stamp_duty.non_residential.purchase`;
  - the LBTT additional dwelling supplement and non-residential rates;
  - the LTT higher residential and non-residential rates.

  Main-home rates are computable.
- **What happens** (the coordinator's option (d), 22 October):
  - generation records the limit in the measure's receipt, whether the change is in `parameter_changes` or a modifier, on either side. It still runs the measure, but writes only the receipt: no tables, and the receipt lists no files;
  - `publish reconcile` skips it ("not computable on current data; nothing to reconcile") and writes nothing beside it;
  - `publish stage` lists it as `not_computable`, with the reason, whatever level was asked for. Its name is the one its receipt records, never the key;
  - `publish check` fails if its directory holds anything but `receipt.json`, or if the entry's name isn't its receipt's;
  - `publish review-rows` writes one row, for its receipt, reading "not computable, staged by <stager>";
  - every level that shows a figure refuses it, and so does approval;
  - the page shows "Not computable on current data" and the reason, never a number;
  - a combined package that includes such a measure is not computable too, since its total would leave that measure out;
  - building one with the templates warns (`DataLimitedWarning`).
- **What to say:** the measure is in the Budget, but the survey data can't cost it yet. Where to place that wording, and whether a package total excluding it should be shown separately, is Vahid and María's call.
- **When it lifts:** once certified data impute the purchases. `tests/test_data_limits.py`'s certified-data tripwire then fails, and the limit is removed in that bundle's adoption PR.
  - **On Microcosm** (see "The data line changed" below), María's pre-Budget build imputes them (microcosm#1308, a port of policyengine-uk-data #573), so the tripwire should fire when that build is adopted. María ruled on the imputation in Microcosm on 16 and 17 October. When the limit is lifted, carry its two disclosures, re-measured on the adopted build (where they sit is your call):
    - **additional dwellings:** the allocation is an assumption, not an observed household series, and "probably overstates" households' purchases (microcosm#1308);
    - **non-residential:** the purchasers' stock can't carry HMRC's value, so every purchaser buys at its stock, and the fit reaches about 81% of HMRC's value (transactions within 1%; microcosm#1308), an understatement.

    (d1354, which tied lifting to policyengine-uk-data #573, is parked.)
- **Before #2241 is in a certified bundle,** a higher-rates figure from the engine charges whole stocks, so it is wrong as well as uncertain. The limit applies from now.
- **Every measure published on the day comes from the templates, unless it passes the human check below** (`uk_budget_data.measure_templates`, bound from a fixed-shape module like `tests/template_measures.py`; coordinator's ruling on d1625, 16 Oct). The detector watches what changed formulas read as the run calculates, but no check of this kind can be proven against arbitrary code. Issue #55 lists what it can't see.
  - **A hand-written modifier needs a named human check of its data limits before it publishes.** The reviewer confirms whether it changes how additional-dwelling or non-residential purchases are priced. They record their name and finding in the measure's PR. If the detector marks it not computable, either convert it to a template or accept that it's withheld; don't try to defeat the probe (coordinator, 18 Oct).
    - **Held by default** (coordinator's ruling on #51, 21 October, after round 18): "While a data limit is active, any hand-written modifier that touches a limited tax's variables, parameters or inputs is held not computable by hand, whatever the detector records. That includes the SDLT, LBTT and LTT trees and their purchase, value and property_purchased ingredients, by any route: parameter changes, update_variable metadata (`end`, `defined_for`), gov.abolitions, set_input on either side, or a derived product. It is released only if the human data-limits check records, in the receipt, why the modifier cannot change how purchases are priced, and a second person agrees."
      - **What "touches" means** (coordinator, 21 October, on round 19's F4): it means *changes*. That covers a limited tax's variables, parameters or inputs, or a purchase price or purchase-based charge computed from them, directly or through ingredients. So a modifier that derives purchases from value × `property_purchased` is held.
        - **Not touching:** reading a property stock value to tax the stock, such as council tax bands or an annual property-value levy.
        - **Scope:** this bounds what the human check may release. The automatic hold in code is unchanged.
      - **The hold in code** (the hardening PR): while any data limit is active, the publication gate holds **every artifact binding a hand-written modifier on either side**, including combined runs and wrappers that call a template helper. It refuses staged, provisional and approved figures until two people attest the current receipt. Parameter-only measures and modifiers proven to consist solely of registered templates are exempt. The proof is recorded as `dashboard.modifier_templates`, with an ordered list for each side: a non-empty list of template ids for each pure modifier, or `null` for each hand-written modifier. An absent or malformed proof is refused.
      - **Why the default flips:** eighteen rounds showed that no detector is complete against hand-written plain-Python modifiers. The detector now catches round 18's metadata, abolitions and one-sided stored-input routes on missing purchase inputs and their direct readers. These routes remain reasons to require the human check (#55):
        - recomputed purchase ingredients and helper-module memoisation;
        - a value seeded into the engine's calculation cache for a limited tax, such as `sdlt_on_non_residential_property_transactions`, with `put_in_cache(..., derived=True)`;
        - changes to totals that contain a limited tax: neutralising `sdlt_on_transactions`, abolishing it through `gov.abolitions`, replacing its formula with zero, supplying a one-sided input on it, or setting `sdlt_liable` false. This is the "partly computable" scope accepted for `gov.hmrc.stamp_duty.abolish` in #51's review (round 19, finding F9).

        Modifiers that seed the cache or change these totals are both held today as hand-written modifiers. The gate does not infer what a hand-written modifier touches.
      - **Release the exact generation:** commit `data_inputs/publication/attestations/<key>.json` through the measure's PR. Its fields are `measure_id` (the artifact key, including a combined key), `receipt_sha256`, `reason`, `checker`, `second` and `released_at`. Both names must be non-empty and distinct after stripping and Unicode case-folding. The timestamp must be ISO 8601 with a timezone. The reason must be factual and contain no survey-level values. The manifest copies the review record, so the published release names both people and their reason.
      - **Which digest:** `receipt_sha256` here means `uk_budget_data.publication.attestations.receipt_document_sha256(document)`: the released receipt API's canonical SHA-256 of the **whole `receipt.json` document**, including `generated_at` and the hand-written generation's `generation_id`. It is different from `dashboard.digests.receipt_sha256` (the execution receipt), the outputs digest and the artifact digest. Every hand-written regeneration gets a fresh generation id, even with unchanged figures, so an old attestation never releases it. Regenerate, review, commit a matching attestation and restage. A release cannot override a recorded data limit, certification, model limit or any other publication check.
      - **While held:** list it in the coverage ledger with the gate's reason and stage no figures. A receipt that actually records a data limit can still be listed as not computable with its reason; an attestation never makes those figures publishable. With an empty data-limit registry this automatic hold is inactive.
    - **Reject the modifier if its own code uses any of these** (coordinator's ruling on #51, 19 Oct). The detector isn't required to see through them, so #55 lists what they can hide:
      1. **another simulation or system:** building or holding a simulation or tax-benefit system other than the one it's given (a clone, or a branch with a cloned system), or that simulation's parameters, entities, populations or holders;
      2. **state changed mid-run:** changing state its formulas hold (a dict, a list, an object's fields) while the simulations run;
      3. **a metaclass:** any class whose metaclass isn't plain `type`. That includes `ABC` bases and other `abc.ABCMeta` classes, and any call to an ABC's `register()`, library ABCs such as `collections.abc.Mapping` included. These ABC cases change what `isinstance` and `issubclass` return (coordinator, 21 October).
    - **The reviewer confirms each one's absence by name in the measure's PR**, for example: "Data-limits check, <name>, <date>: no other simulation or system; no state changed mid-run; no metaclass; changes purchase pricing: no."
    - **The rule covers the modifier's own code only.** Templates and the model's own code, such as policyengine-uk's behavioural-response branching (the capital gains response route), stay inside the detector's line: a miss through them is a bug to fix, not a listed limitation.
  - Templates are tested:
    - every template measure must stay computable;
    - no template may use any of the three constructions above, checked in the templates' source and by running each template measure (`tests/test_data_limits.py`). A template that needed one would stay fully covered by the detector, and any miss through it would block.
- **When a computable measure is marked not computable.** These known false positives all fail safe: the measure is withheld, never shown with a wrong figure.
  - **The forms (#51, round 15):**
    - the changed variable was calculated before the run was watched, so its cached value is used without its formula running, or the watch couldn't run: every limit, with an `UnwatchedFormulaWarning` naming the reason;
    - an original wrapped and used only inside a narrow band, or only past an amount the check's moves (quarter-decades of purchase from £100 to £1tn) never reach, or an original that reads a limited rate but no limited input. Only a hand-written modifier can reach these: no template uses its original that way. The coordinator ruled on 18 Oct that they don't block #51;
    - a limited input's name written in a formula that ran, even if it's never read.
  - **Two more (#51, round 18; #55):**
    - a hand-written modifier that reads, while the measure is built, a total that includes SDLT (a means test on net income, or a payment tested against tax): every limit, though the same reading done live records none. Clear it by computing the total in the formula as the run calculates. A means test on net income can't be: it is a cycle there, so such a measure is held;
    - a household situation that sets a limited input: the model's own build reads it (`build_from_situation`), so every measure on that household records `build:<input>`, templates included. Generation and the pipeline build certified microsimulations, where these inputs are never stored, so this reaches tests and probes, not published measures. Use a household that doesn't set them.
  - (The source forms listed here until #51's round 13 are no longer false positives, since reads are now watched as the run calculates: lambdas and callable wrappers, results in containers, annotation-only statements, unreadable state, and names built at run time.)
  - **To clear one:** there is no override. Rewrite the measure in a form whose reads the watch sees: a template, or a call to the original used for its result. Make sure nothing calculates the changed variable before the run, and don't write a limited input's name in code that runs. Then regenerate, and record the reason in the measure's PR.

**A UC health (LCWRA) measure: change the rebalancing amounts, not the element's amount.** In 2026 to 2029 the engine's UC rebalancing overwrites every claimant's health element:
- pre-2026 claimants get `gov.dwp.universal_credit.rebalancing.protected_health_element` (or the UC Act 2025 s. 4 floor where that is null);
- new claimants get `gov.dwp.universal_credit.rebalancing.new_claimant_health_element`.

These are monthly amounts. A change to `gov.dwp.universal_credit.elements.disabled.amount` in those years therefore scores £0: on policyengine-uk 2.130.1, £600 a month on it moved no claimant's element in 2026 or 2029, while £600 on the claimant's rebalancing amount gave £7,200 a year. In 2025 and 2030 it is the other way round: only the element's own amount moves the element.
- **Switching `rebalancing.active` off is not the law before the Universal Credit Act 2025 either:** the 2026 element amount is already the new claimants' rate, so every claimant would get it.
- **Build the measure with `uc_health_element_change(protected=..., new_claimant=...)`** (#47), in the years in `UC_REBALANCED_YEARS` (2026-29 on policyengine-uk 2.132.6). The templates refuse the element's amount in those years, and `rebalancing.active` in any year.
- **After the last rebalanced year (from 2030 on 2.132.6), change the element's own amount** with `rate_change(UC_LCWRA_AMOUNT, ...)`. The rebalancing has stopped, so every claimant, protected or not, gets that amount (next bullet).
- **Found by the UK hub.** Its engine-side fix is policyengine-uk #2428 (below), merged on 16 October. Re-check this row on the first certified pair that carries it.
- **2030-31 UC will move up when a fix for policyengine-uk issue #2282 is certified.** The rebalancing runs for 2026 to 2029 only (`range(2026, 2030)` in `uc_reform.py`, policyengine-uk 2.130.1). So in 2030 every protected claimant's element falls to the formula's amount, the new claimants' rate, and the 2030-31 baseline understates UC (UK hub). The fix extends the rebalancing. Once a certified bundle with it is adopted:
  - the dashboard's 2030-31 UC figures rise, and so does any measure's 2030-31 effect that runs through UC. That is a correct change to the baseline, not a regression: say so wherever those figures were shown before.
  - `UC_REBALANCED_YEARS` now follows `policyengine_uk.scenarios.uc_reform.REBALANCING_YEARS` automatically, with `range(2026, 2030)` as the fallback for engines without the export. policyengine-uk #2428 (merged 16 October; not in 6.10.0's policyengine-uk 2.132.6) extends the rebalancing to 2032 and exports those years, so UC health measures for 2026–2032 then go through `uc_health_element_change`. #47's engine table (`tests/test_uc_health_template.py`) still checks the actual award edges against the template's years, including on the fallback: extending the rebalancing without exporting its years must fail that check.
  - policyengine-uk #2284 (merged 15 Oct, UC Act 2025 s. 3) freezes the element's amount through 2029-30, so 2030-31's baseline amount falls from £235.86 to £221.60 a month. It changes no template rule.

**A State Pension measure (one that moves the basic or new State Pension's full rate) needs policyengine-uk #2336 in the adopted pair. Without it, the measure is staged provisional, not approved** (the UK hub, via the coordinator, 21 October). The model-limit guard (#73, `uk_budget_data.model_limits`) enforces this.
- **Why:** additional pensions (SERPS and S2P) and new State Pension protected payments rise each April by prices, not with the full rates. Prices are the statutory floor (Social Security Administration Act 1992 ss. 150 and 151A), and the Up-rating Orders give September CPI.
  - The 2026 Order (SI 2026/148, articles 4(3)(a) and 6(3)(b)) raises them by 3.8%, against about 4.8% for the full rates (articles 4(2) and 6(1)).
  - Up to policyengine-uk #2336, the model raises them by the full rate's own ratio (`additional_state_pension`). So anything that moves the full rates moves them too. 6.6.0 (policyengine-uk 2.130.1) and 6.10.0 (2.132.6) both lack the fix.
  - #2336 (fixing issue #1941) uprates them by September CPI, and leaves them alone when the full rates change. It has been on policyengine-uk's `main` since 21 October, 20:32Z (coordinator), and policyengine-uk 2.146.5 (on PyPI 22 October) has it.
- **How much, on uk-data 1.58.1** (W3's aggregate-impact report on #2336, CI run 39506093016):
  - under a "raise the State Pension by 10%" reform, State Pension rises £1.1bn to £1.5bn a year less with the fix over 2025-26 to 2031-32, and £1.26bn to £1.48bn over the dashboard's years;
  - the net cost is £0.76bn to £1.11bn a year lower over 2025-26 to 2031-32, and £0.85bn to £1.06bn over 2026-27 to 2030-31;
  - in the baseline, #2336's own runs put State Pension £353m lower in 2025-26 and £782m lower in 2030-31.

  So without the fix, a 10% rise's net cost is overstated by about £0.85bn to £1.06bn a year, and more for a bigger rise. These figures are not re-measured on Microcosm.
- **The check, in G0's commands for the adopted pair and again before a State Pension measure is staged:**

  ```sh
  uv run python -c "from uk_budget_data.model_limits import MODEL_LIMITS; print({limit.key: limit.installed_fixed() for limit in MODEL_LIMITS})"
  ```

  - **What it prints:** each model limit's key, with whether the installed model has its fix. For `state_pension_add_on_uprating`, `True` means the installed policyengine-uk uprates the add-on by September CPI, as #2336 does, and `False` means it doesn't: 6.6.0 and 6.10.0 both print `False`. Once a fix is in the adopted pair, its adoption PR removes the limit, so its key no longer appears.
  - **How it decides:** this is the guard's own check. It parses the installed `additional_state_pension` and requires every formula to read the index as an attribute, so a comment or a string naming it doesn't count.
  - **The CI cross-check:** a test compares this check with the model's behaviour: whether the add-on moves when either full rate rises, for a new State Pension recipient and for a basic one. So a release that fools the code check, or fixes only one pension's add-on, fails CI instead of lifting the guard.
- **Which measures:** any change that moves either full rate, or September CPI, in any year, on either side: `parameter_changes`, `baseline_parameter_changes` or either side's modifier. For example, a change to:
  - `gov.dwp.state_pension.basic_state_pension.amount` or `gov.dwp.state_pension.new_state_pension.amount`;
  - anything under `gov.dwp.state_pension.triple_lock`;
  - the statutory uprating inputs the triple lock is built from, `gov.economic_assumptions.statutory_uprating_inputs` (May to July earnings, September CPI). Setting the 2026 earnings input to 10% (from 3.9%) moved a basic pensioner's 2027 add-on from £1,797.57 to £1,903.11 on both models (#71's review, a one-person in-memory dataset);
  - a macro scenario on `gov.economic_assumptions.yoy_growth.obr.average_earnings` or `consumer_price_index`, which moves those inputs in years not yet published;
  - a change to September CPI, `gov.economic_assumptions.indices.september_cpi_uprating`, even one the triple lock doesn't pass on. Without the fix the add-on ignores CPI, so such a change mis-costs it.
- **If the check prints `False`,** such a measure is staged provisional at most. The guard does this by itself:
  - **Generation:** it records `state_pension_add_on_uprating` in the measure's receipt, with the reason, whenever the measure's two simulations differ under a covered parameter and the model lacks the fix.
  - **Staging and approval:** `publish stage --provisional` accepts the measure; `publish approve` refuses it ("held at provisional, not approved", with the reason).
  - **The page,** once #20's modules are wired in after #3, shows such a measure as provisional and refuses to show it as approved, even from a manifest edited by hand, because its receipt records the limit. The loader already does.
  - **The templates** warn (`ModelLimitedWarning`) when a measure is built on one of the guard's own parameters: either full rate, the triple lock or the September CPI index. A template change elsewhere that moves them, such as to the statutory uprating inputs, doesn't warn, but generation still records it.
  - **The flat pipeline** prints "MIS-COSTED BY THIS MODEL".
  - **When #2336 lands,** nothing more is recorded. The guard's tripwire test then fails in the adoption PR, with the other tests that assume the limit is active, so the limit and those tests are removed there.
    - **Retarget, don't delete, the guard's general tests.** Some tests of how the guard works are written against this limit: cache hygiene, rebound nodes, added leaves, cached views, modifiers, the baseline side, generation, the flat pipeline and the template warning. The other limits rely on the same code, so move those tests to a remaining limit, such as the September CPI limit with a 2027 PIP change, including those built on the State Pension record `HELD`, such as the combined run's approval refusal (review of #90).
  - **If the adopted pair has #2336 but not #2557** (#2533's fix, below), the add-on's April 2027 rise reads the September 2026 input, which is still a forecast there. policyengine-uk 2.146.5 is that case, so the next bundle may be too. Until #2557 is in the pair, the September CPI limit below holds:
    - **a measure that moves the September CPI index from 2027** (coordinator, 22 October);
    - **a measure on the triple lock's rule,** such as dropping its earnings leg, or anything else that moves the triple lock index from 2027. Its April 2027 CPI leg reads the same forecast: 2.1% on 2.146.5, against the 3.5% outturn (review of #90; coordinator on #90, 22 October). A rule change dated later, such as dropping the earnings link from 2030, is held too until #2557, since the limit applies from 2027: that fails safe.
  - **A measure on the full rates alone is not held then.** After #2336 it doesn't move the add-on. Its cost is still slightly off through means tests such as Pension Credit, since the 2027-28 baseline's add-on uses the forecast: disclose that (see "Data and model limitations" below; coordinator on #90, 22 October).
  - **The page doesn't show the reason.** It is in the receipt, and the page labels every provisional entry "Provisional: statement figures, awaiting Treasury costing", once #20's modules are wired in after #3. Record it in the coverage ledger too. **Your call:** whether such a figure is shown on the page meanwhile, as for a held pension tax relief measure.
  - **The first cut and the briefing:** it stays out of both, because they take approved entries only.
  - **G4:** it holds up the combined run's approval, as a provisional CGT measure does ("Which ids" at G4). A combined run including it can still be staged provisional.
- **With the fix,** a measure that also raises the add-on itself, above prices, needs a change to `additional_state_pension`. A rate change alone no longer reaches it, and no template covers it. That makes it a hand-written modifier, which needs the named human data-limits check above.
- **The adoption PR that brings #2336 must update a test.** `tests/test_measure_templates.py::test_native_pension_responds_to_rates_without_total_income_override` asserts that the add-on moves with the full rates, the behaviour #2336 removes. With #2336's formula, #71's review found two of its four cases fail (new and basic State Pension at £20,000). Update it there to expect the add-on to stay with prices, as the UC row asks of #47's table.

**A measure on 2027-28 benefit levels needs policyengine-uk #2533 in the adopted pair.** Until then, the model-limit guard holds it at provisional, not approved (coordinator, 22 October, from the UK hub's triage).
- **Why:** the benefit uprating index follows lagged calendar-year CPI, so the parameters on it rise by 2.3% in April 2027, against September 2026 CPI of 3.5% (ONS D7G7, published 21 October). That covers most CPI-linked benefits, the UC standard allowance among them.
  - **The September 2026 statutory input is still null,** so it's a forecast. The UC protected health element's 2027 amount is the UC Act 2025 s. 4 floor, which reads that input, so it's off too.
  - **The 2026-27 rates** are hard-coded and unaffected.
  - **The Pension Credit minimum guarantee** is on the index too, but in law it rises at least with earnings. #2557 keeps it on lagged CPI, so it has a limit of its own (the next section).
  - **Additional State Pension and new State Pension protected payments,** once #2336 is in the pair, rise by the September CPI index, which reads the same September 2026 input.
- **Which measures:** changes from 2027 onwards, on either side of the measure, to:
  - any parameter whose uprating metadata names the benefit uprating index (79 prefixes, the UC standard allowance among them);
  - the UC protected health element;
  - the September CPI index, `gov.economic_assumptions.indices.september_cpi_uprating`, by any route that moves it: the index itself, the September input, or a CPI growth path;
  - or the triple lock: its rule, `gov.dwp.state_pension.triple_lock`, or anything that moves the index it builds, `gov.economic_assumptions.indices.triple_lock`.

  Without #2336 the State Pension limit holds the last two as well. A measure on the State Pension's full rates alone isn't held by this limit.

  The registry pins those prefixes, and a test compares the pin with the installed engine's metadata.
  - **Not held:** a structural measure that changes no covered parameter, such as repealing the two-child limit. The 2027 benefit levels it interacts with are still about 1.2% low.
- **What the guard does:** generation records `benefit_uprating_september_cpi` and its reason in the receipt. Provisional staging is allowed; approval is refused, and the browser refuses an approved receipt carrying the limit. The templates warn (`ModelLimitedWarning`), and the flat pipeline prints "MIS-COSTED BY THIS MODEL". Such measures stay out of the first cut and briefing, which take approved entries only; a combined run including one is provisional at most.
- **At an adoption before #2557, update the pin, keeping what's still lagged.** On policyengine-uk 2.146.5 the pinned-metadata test fails (review of #90):
  - three `aged_from_cutoff` Housing Benefit allowances join the index. Add them to the pin, and to the Pension Credit limit below;
  - the UC standard allowance and the UC LCWRA element (`elements.disabled.amount`) move to indices of their own, `uc_standard_allowance` and `uc_health_element`, which are still built from the lagged benefit index. Keep both in this limit beside the protected health element, rather than repinning to the metadata alone, until #2557. The new claimants' health element (`rebalancing.new_claimant_health_element`) also names `uc_health_element` there, though it had no uprating rule on 2.132.6: add it beside them.
- **When it lifts:** the adopted pair must include both steps of #2533: enter the September 2026 outturn (`0.035`) in `statutory_uprating_inputs.cpi_september`, and make the benefit uprating index follow the September CPI index. The guard checks the input and the resulting April 2026 to April 2027 uprating; entering the outturn alone does not lift it. The fix is policyengine-uk #2557, which also repoints the UC Act indices and so fixes the UC protected health element (coordinator, 22 October). Its adoption PR removes this limit when the tripwire test finds the fix in the adopted model.

**A measure on the Pension Credit minimum guarantee, the pension-age Housing Benefit allowances or the savings credit threshold, from 2027, needs the UK hub's earnings fix for the guarantee in the adopted pair.** Until then, the model-limit guard holds it at provisional, not approved (`pc_minimum_guarantee_uprating`; coordinator, 22 October).
- **Why:** the Social Security Administration Act 1992, s. 150A(2), requires the standard minimum guarantee to rise at least with earnings: 3.9% for April 2027, the May to July 2026 figure. The model raises it by lagged CPI, 2.3%.
  - #2557, #2533's fix, deliberately keeps the guarantee on lagged CPI.
  - The fix is the UK hub's separate earnings build, stacked on #2557 and aimed at Saturday's re-cut. It also covers the pension-age Housing Benefit allowances and the savings credit threshold.
- **Which measures:** changes from 2027 onwards, on either side, to:
  - the standard minimum guarantee, single or couple;
  - the savings credit threshold;
  - the pension-age Housing Benefit allowances: the three `aged` ones on policyengine-uk 2.132.6, and the six of later releases, which add `aged_from_cutoff`. The adoption PR for such a release lists the new three here and in the September CPI limit's pinned list; a test of each fails until it does;
  - the May to July earnings input, `statutory_uprating_inputs.awe_total_pay_may_july`, by any route that moves it, such as an earnings growth path. Without the fix the guarantee ignores earnings, so such a change misses it.

  The first three are also on the benefit index, so until #2557 is in the pair they record the September CPI limit too.
- **What the guard does:** as for the September CPI limit. Generation records `pc_minimum_guarantee_uprating` and its reason in the receipt. The measure can be staged provisional, approval is refused, and the browser refuses an approved receipt carrying the limit. The templates warn (`ModelLimitedWarning`), and the flat pipeline prints "MIS-COSTED BY THIS MODEL". Such a measure stays out of the first cut and the briefing, and a combined run including one is provisional at most.
- **When it lifts:** when, in the model as built, the uprating rule for both rates of the guarantee names an index other than the benefit index (`gov.benefit_uprating_cpi`), and that index's April 2026 to April 2027 step reaches the published May to July 2026 earnings growth.
  - The check reads the tree as the model built it, so neither a parameter change nor a template can satisfy it, and 2027-28 rates typed in over a CPI rule don't count. #2557 alone doesn't lift it. A hand-written modifier can change that tree, as for VAT below: treat one that repoints the guarantee's uprating rule there, or rebuilds the parameters on both sides, as a change to the model, not a measure.
  - **If the UK hub's build raises the guarantee some other way,** such as with a formula or typed-in rates, `test_the_fix_check_agrees_with_the_guarantee_pensioners_get` fails in the adoption PR, and a person decides there whether the limit goes.
  - **Otherwise** the guard's tripwire test fails in the adoption PR, which removes the limit.

**A VAT measure (one on a VAT rate, the VAT base or the consumption VAT is charged on) needs policyengine-uk #2187 in the adopted pair.** Until then, the model-limit guard holds it at provisional, not approved (`vat_consumption_coverage`; coordinator on #88, 22 October, from the UK hub).
- **Why:** the model grosses household VAT on survey consumption up to receipts by dividing it by one factor, `gov.simulation.microdata_vat_coverage`: 0.38 on policyengine-uk 2.132.6.
  - #2187 divides instead by survey consumption coverage times the household share of VAT receipts: 0.67 × 0.7 = 0.469. So without it, VAT, and measures that work through the grossed liability (a rate, the reduced-rate share, consumption), run about 23% high (0.469 / 0.38). The energy VAT template's own figure doesn't (below).
  - The UK hub measures VAT about 24% high on Microcosm without the fix (its notice 59).
  - For comparison only, the coordinator gives the live API on policyengine-uk 2.130.1: it costs a 1-point VAT rise at £15.4bn, against HMRC's £8.8bn. W5's reading: that run is probably on the API's default enhanced FRS, not Microcosm, so it doesn't measure #2187's effect.
  - #2187 is in policyengine-uk 2.145.0 and later. 6.10.0's 2.132.6 lacks it; 2.146.5 has it.
  - **Energy VAT is one of the policies flagged for the App V3 demo,** so the hold bites if Friday's rehearsal runs on 6.10.0.
- **Which measures:** any change, in any year, on either side (`parameter_changes`, `baseline_parameter_changes` or either side's modifier), to:
  - a VAT rate or the reduced-rate share of consumption: anything under `gov.hmrc.vat`;
  - the grossing factor itself, `gov.simulation.microdata_vat_coverage`;
  - either of those in the engine's copy of the tree as built, under `baseline.`. `baseline_vat` reads that copy and `vat_change` subtracts it, so a modifier that edits it moves VAT;
  - the index consumption rises by in years after the data's, `gov.economic_assumptions.indices.obr.consumer_price_index`, by any route that moves it, such as a CPI growth path. A test fails if the installed model uprates consumption by another index.
    - In a household calculation, such a path moves projected consumption, and so VAT, without changing a VAT parameter or a stored input (W5's test on policyengine-uk 2.132.6, 22 October).
    - On the dashboard's dataset route the projected consumption inputs change too, and record as `variable:<category>`.
    - Holding the index itself is W5's addition, awaiting the coordinator's confirmation;
  - a variable VAT is built from, recorded as `variable:<name>`: `vat`, `baseline_vat`, `vat_change`, the two consumption bases, the full-rated share of spending, `consumption` and its 12 categories. A variable counts when:
    - its formula changes, or what decides how it runs (its end date, uprating rule, `defined_for` or how an input is spread). The VAT base template, `apply_vat_base_change`, replaces `vat`'s formula, so the energy VAT measure is held;
    - it is neutralised, or missing on one side;
    - a modifier sets an input for it on one side, or sets one to another value;
    - a value stored for it differs where both sides hold one, calculated or cached. The guard runs after the figures are made, so this catches a modifier that edits a calculated value in place or caches one. It also catches the template applied on both sides with its spending input changed on one side only, as `variable:vat` and `variable:vat_change`. So a VAT measure's record also lists the variables its figures moved, such as `variable:vat` beside a rate.

  The registry pins the categories, and a test compares the pin with the installed `consumption`.
- **Not held: private school VAT** (`gov.contrib.labour.private_school_vat`, `gov.simulation.private_school_vat` and the `private_school_vat` variable). Its formula multiplies pupils by fees, the rate and the VAT basis, and reads no grossing factor. #2187 leaves it unchanged, so its figure doesn't depend on the fix. W5 has put this to the coordinator with the energy VAT question below.
- **What the guard does:** as for the September CPI limit. Generation records `vat_consumption_coverage` and its reason in the receipt. The measure can be staged provisional, approval is refused, and the browser refuses an approved receipt carrying the limit. The templates warn (`ModelLimitedWarning`): `rate_change` on a VAT parameter, and `apply_vat_base_change` itself. The flat pipeline prints "MIS-COSTED BY THIS MODEL". Such a measure stays out of the first cut and the briefing, and a combined run including one is provisional at most.
- **The area view is held too.**
  - Area runs (`uk-budget-data geography`, with `--reforms` or `--seat-reforms`) take approved ids only, and a model-limited measure is never approved.
  - The area run also judges its own simulations, as generation does. If any measure touches a model limit, it prints "Mis-costed by this model" and writes no tables. That catches a VAT measure approved before this limit was registered, and one approved on a pair with #2187 but run by area on a model without it.
  - So no VAT measure's area results are produced for the page while the limit holds. That includes Microcosm's local-area cut run on policyengine-uk 2.132.6 (the coordinator's "dense cut paired on 2.132.6 under the accepted mismatch").
  - **Regenerate, and stage provisional, any VAT measure approved before this limit was registered.** Its receipt carries the old registry digest, so the page refuses it already, and the area run refuses it.
- **When it lifts:** once a pair with #2187 is adopted, that is with policyengine-uk 2.145.0 or later. Any re-cut on 2.145.0 or later has it.
  - **The check** needs both of #2187's factors (`gov.simulation.vat.survey_consumption_coverage` and `household_share_of_receipts`) in the tree as the model built it. It also needs every formula of `baseline_vat` to look up `vat_grossing_factor`, the helper that returns their product (or the old factor, if a measure moves it from its default), which the formulas divide by. For the installed model it also parses `vat` and `baseline_vat`, and needs every formula of each to call that helper.
  - **Neither check reads anything a parameter change or the VAT base template changes.** That template replaces `vat`'s formula, on whichever side calls it, and never `baseline_vat`'s. A rate change, or setting the old factor to 0.469, adds neither factor. Factors added to the tree as built don't count on their own, because no formula reads them.
  - **The payment template** takes any annual household variable with a formula as its channel, so pointed at `baseline_vat` it replaces that formula. The replacement reads no grossing factor, so that side counts as unfixed and the measure is held: that fails safe. The property-surcharge template refuses `baseline_vat`, whose formula reads neither of the OBR indices a band deflates by.
  - **A hand-written modifier can still change both things the check reads:** the tree as built (the parameters' `baseline` child) and `baseline_vat`'s formulas.
    - Replacing `baseline_vat` on one side of a model without the fix holds the measure, since the variable then differs between the sides: that fails safe.
    - Adding #2187's factors to the tree as built and replacing `baseline_vat` on both sides with formulas that look up `vat_grossing_factor` makes 2.132.6 count as fixed, so nothing is held: that fails open.
    - Neither the code nor the named human data-limits check, whose items are listed above, guards against this. W5 has raised it with the coordinator. Meanwhile, treat such a modifier as a change to the model, not a measure.
  - **The CI cross-check:** a test reads behaviour. A household's VAT, divided by what its consumption owes at the statutory rates, must be 1 / 0.469 exactly when the checks say the model has the fix, for `vat` and `baseline_vat` alike.
  - **On enhanced FRS, #2187 doesn't settle it.** Its survey coverage, 0.67, is calibrated to Microcosm's national release. Its own derivation note puts VAT on enhanced FRS 2024-25 38% or 44% above receipts. So a VAT run on the eFRS route (such as `uk-budget-data geography --dataset-kind efrs`) needs the coordinator's call even after adoption.
  - **The adoption PR removes the limit** when the guard's tripwire test fails. On 2.146.5 the tests in `tests/test_vat_model_limit.py` that assume the limit is active fail with it: the measures recorded without the fix, the template warnings, the scenarios, generation and the area run's refusal. The checks and the CI cross-check pass there. On a venv swapped to 2.146.5 by hand, the area tests also error, because that model and data pair isn't certified.
  - **With the limit, drop the fixture's `iota` measure** (`scripts/make_publication_fixture.py`) and its rows in the JS publication tests (`digest.test.js`, `load.test.js` and `manifest.test.js`). Then regenerate the fixture and `contract.json`.
  - **Only this limit covers variables.** When it goes, keep the variable comparison's tests against another limit, or remove the `variables` field with it.
- **The energy VAT template's own figure doesn't depend on #2187.** The term it adds, eligible spending × the rate change / (1 + the old rate), isn't divided by any grossing factor, so its cost is the same with or without the fix. The same goes for the template on both sides with its spending input changed on one. W5 has put this to the coordinator; their scope holds it until they rule.

**Dated changes: key every year by its bare fiscal year.**

| Key | What it means | Use it? |
|---|---|---|
| `"2027": 0.21` | The whole UK fiscal year 2027-28, 6 April 2027 to 5 April 2028. The national run and the household calculator both read it. | **Yes.** List every year the change applies, through 2030. |
| `"2027-04-06": 0.21` | That one day only. Depending on the parameter, the year's figure either does not move at all (the personal allowance; tested in #23) or moves by about one day's share of the change. Fuel duty, for example, moved by 0.27% of the change in 2027-28 (probe, 14 October, policyengine-uk 2.126.12). | **Never.** |
| `"2027-04-06.2100-12-31": 0.21` | In the national run, on policyengine-uk 2.126.12: every year from 2027-28 on, held flat. In the household calculator: on `main` since #32 (15 October), as the national run reads it; in #3, 2027 only, because it keeps a key for the year its first four characters name (`annual_reform_parameters`). | **No.** The national figure would move in years where #3's household calculator showed no change. |

**A macro path is the exception: never key it by a bare year** (coordinator, 21 October). The OBR growth series under `gov.economic_assumptions.yoy_growth.obr` are stored at 1 January of each calendar year, and the statutory uprating inputs read them from there. Which year a bare-year key reaches has changed between models. With `Scenario(applied_before_data_load=True)`, a change of `"2026": 0.10` to `consumer_price_index` moved:
- on policyengine-uk 2.130.1, the September **2027** CPI input;
- on policyengine-uk 2.132.6, the September **2026** input.

`"2026-01-01"` and `"2026-01-01.2026-12-31"` both moved the September 2026 input on both models (W5, 21 October).
- **The cause is policyengine-uk #2404, first in 2.131.1.** Since then, a bare year on the economic growth rates names the calendar year, as intended. Before it, a bare year named the fiscal year from 6 April, and so moved the next year: 2.131.1's changelog gives a 2027 earnings growth rate that moved the 2028 index and the April 2029 triple lock.
- **So anything generated on 6.6.0 (policyengine-uk 2.130.1, `main`'s pin before #72) with bare-year growth keys is off by a year.** Regenerate it on the adopted pair.
- **Key a macro path by its calendar year,** `"YYYY-01-01.YYYY-12-31"`, whatever the model.
- **Apply it only through `Scenario(applied_before_data_load=True)`.** That is the PolicyEngine-wide rule for macro paths.
- **Before the scenario is used, probe the adopted pair.** Put the scenario's own change in `CHANGES`, and in `INPUT` the statutory input it should move (`cpi_september`, or `awe_total_pay_may_july` for earnings). The probe prints the instants that moved: `['2026-09-01']` for the example below.
  - **Earnings move on 1 July.** With `awe_total_pay_may_july`, a 2027 earnings change prints `['2027-07-01']` on both models.
  - **`[]` means that year is already published,** not that the key is wrong. May to July 2026 is published (3.9%), so a 2026 earnings change prints `[]`. A published year never moves (see "Which measures" above). Don't fall back to a bare year: on 2.130.1 it silently moves the next year instead.
- **A change to an uprating input projects the data, however the measure is written** (UK hub's OBR-growth routes report, 22 October).
  - **Since policyengine-uk 2.132.3 (#2405),** a scenario's dated parameter changes that alter a dataset-uprating input are applied before the data is built, so incomes follow, exactly as with `Scenario(applied_before_data_load=True)`.
  - **Which inputs count:** the paths `uprating_input_paths()` returns in the installed policyengine-uk, 23 on 2.132.6. They include `yoy_growth.obr.average_earnings` and `consumer_price_index`. The statutory uprating inputs aren't on the list, because they feed the triple lock, not the data. Neither are several growth series, such as `rpi`. The list grows in later releases.
  - **Registered measures are included, on either side:** `Reform.to_scenario` returns `Scenario(parameter_changes=…)`, and `baseline_parameter_changes` take the same route. On 6.10.0 (policyengine-uk 2.132.6), `average_earnings {"2026": 0.10}` grew each household's employment income 10.00% in 2026, against 3.40% under current law. That was on a 1-in-40 subsample of the Microcosm cut, through the dashboard's own `managed_microsimulation` route.
  - **So such a measure is a macro scenario.** A registered measure can only use bare-year keys and the after-load route, not the calendar-range keys and before-load route that the macro-path rules above ask for. On 6.10.0 the two come out the same: a bare year names the calendar year (#2404), and the after-load route re-uprates the data (#2405). Still run the probe above on the adopted pair.
  - **Check that no registered measure changes an uprating input by accident.** On 2.132.6 none of the ten does, on either side (#87's review). The list widens in later releases, so check again on each adopted pair.
  - **With a modifier as well,** the parameter changes still move before the build and the modifier runs after. That is read from policyengine-uk's code, not run.
- **Only on the dashboard's route.** The data follow only when policyengine-uk gets a single-year dataset, as `pe.uk.managed_microsimulation` gives it for this cut.
  - **policyengine.py's own `Simulation(policy=…)`** projects its year files under current law and passes a multi-year dataset, which no route re-uprates. It moves the parameters only, which is an inconsistent scenario: on the subsample, employment income was identical with and without the change.
  - **Read from code, not run:** the same holds for `dynamic=`, and for any route on a multi-year dataset.
  - **So keep the dashboard on `managed_microsimulation`** with a single-year dataset.

```sh
uv run python - <<'EOF'
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario
INPUT = "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"
CHANGES = {"gov.economic_assumptions.yoy_growth.obr.consumer_price_index": {"2026-01-01.2026-12-31": 0.10}}
H = {"people": {"p": {"age": {2026: 70}}}, "benunits": {"b": {"members": ["p"]}}, "households": {"h": {"members": ["p"]}}}
def stored(changes=None):
    scenario = Scenario(parameter_changes=changes, applied_before_data_load=True) if changes else None
    leaf = Simulation(situation=H, scenario=scenario).tax_benefit_system.parameters.get_child(INPUT)
    return {v.instant_str: v.value for v in leaf.values_list}
base, changed = stored(), stored(CHANGES)
print(sorted(k for k in base.keys() | changed.keys() if base.get(k) != changed.get(k)))
EOF
```

**#3's household calculator moves less than the national figure for some measures** (probed 15 October). #3's calculator (`calculate_personal_net_income`) writes a change on 1 January only, while the national run applies it to the whole fiscal year before policyengine-uk derives its other parameters. `main`'s did the same until #32 (15 October; issue #33). One earner on £50,000, 2027:

| Change | Household calculator | National |
|---|---|---|
| Fuel duty to 90p (monthly `fuel_duty` sees January only) | −£25.05 (#3) | −£300.62 |
| Beer duty to £30 (a calendar-preserved duty) | £0.00 (#3) | −£37.10 |
| Personal allowance to £20,000 (read on 1 January) | +£1,486.00 | +£1,486.00 |

On 1 January only, the 2025 placeholder `fuel_duty_freeze` showed exactly 1/12 of its national effect for every household and year. Building the household reform through `Scenario(parameter_changes=…, simulation_modifier=…)` with the measure's bare-year keys, as the national run does, closes every gap found. #32 did that for `main`'s calculator, checked by `tests/test_household_route_parity.py`, which no longer expects any gap. **Your call**, for #3.

**#3 keys the pre-Budget fuel duty baseline by lone dates** (`"2026-03-22"`, `"2027-04-01"`, and so on, through `Reform._build_scenario`). On the bundle on `main` on 14 October (policyengine-uk 2.126.12), a lone date moves fuel duty only in the fiscal year that contains it (6 April to 5 April), and only by about one day's share of the change. `"2027-04-01"` falls in 2026-27, so 2027-28 stays at current law, and 2026-27 moves by a sliver: the #23 review measured 2026's rate moving from £0.539527 to £0.539526 a litre.

An earlier version of this runbook said these keys have no effect at all. That was wrong: the effect is small, not zero. Either way, the baseline is not the one the measure intends. The same values keyed by bare year, as `main`'s `fuel_duty_freeze` keys them, change every year. This needs changing in #3 when it merges `main`.

The templates' `rate_change` and `threshold_change` build bare-year keys and refuse the other two, and a test checks that every registered measure uses only bare-year keys (#23). That test will fail on #3's lone-date keys once both are on `main`: **your call** whether it stays. A measure that still scores £0 is refused at staging by the responsiveness gate, but it is better caught when it is written.

Three things are refused:
- closures, lambdas, nested functions and `functools.partial`;
- NaN. The receipt binds an infinite value, such as `float("inf")` for "no cap" (policyengine.py#588), but the templates take only finite numbers;
- two measures in one combined run that set the same parameter differently.

A measure that cannot be bound is refused at generation: the command prints `REFUSED <id>: <reason>` and exits non-zero. The other measures in the same run are still written.

## G0: start receipt (by 11:30)

```sh
git switch main && git pull
uv sync --locked --extra dev
mkdir -p receipts
uv run python -m uk_budget_data.certified_data \
  --also enhanced_frs_2024_25_tiny
REQUIRE_CERTIFIED_DATA=1 uv run pytest tests/ -m certified_data
uv run python -c "from uk_budget_data.model_limits import MODEL_LIMITS; print({limit.key: limit.installed_fixed() for limit in MODEL_LIMITS})"
curl -s "$HOUSEHOLD_API/api/version"
uv run python -m uk_budget_data.household_route \
  --base-url "$HOUSEHOLD_API" --fixtures data_inputs/household_fixtures \
  --expect-model-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine-uk"))')" \
  --expect-core-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine-core"))')" \
  --expect-wrapper-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine"))')" \
  --out receipts/g0-households.json
uv run uk-budget-data publish check
uv run uk-budget-data publish status
```

What they check:
- `certified_data`: the token reads the bundle's data and the tests' small dataset, each file by its pinned hash (#12, #70);
- the certified-data tests, which fail rather than skip here;
- the model-limit check: whether the model has each limit's fix (policyengine-uk #2336, #2533's fix, the minimum guarantee's earnings fix and #2187);
- `/api/version`: the household API's versions must match the bundle's (#15), and the household check compares them again;
- `publish check`: every gate over each entry the page lists (#19); `publish status` lists the manifest's entries.

The shell blocks in this runbook carry no comments, so they paste into zsh as they are, once any `<placeholder>` in them is filled in.

Record in the clock table:
- the start SHA;
- the manifest revision and its execution identity;
- the dataset SHA-256;
- the household API identity;
- the basis in `data_inputs/publication_basis.json` (expected `pre_budget`);
- which model limits are active: each key the model-limit check prints with `False`. While active, `state_pension_add_on_uprating` holds every State Pension measure at provisional and `vat_consumption_coverage` every VAT measure, in every year; `benefit_uprating_september_cpi` and `pc_minimum_guarantee_uprating` hold their measures from 2027 (see "How a measure must be written").

**The gate fails** if any command fails, or the API's versions differ from the bundle's. With only the plumbing fixture, the household check can pass on plumbing alone, and checks no measure's non-zero answer (see "Household fixtures" above). The household check takes the bundle's versions from the installed packages here, because `main` has no `public/data/manifest.json` until the first entry is published (`--manifest` on a missing file exits 2). Once a manifest is published, pass `--manifest public/data/manifest.json` instead, as at G4.

## G1: coverage (12:30 to 12:45)

María classifies every statement measure as `coded` or `ledger`, with a reason, in the coverage ledger.

## Construction (from G1)

For each coded measure:
1. **Write it** in one of the bindable forms above: a template called from a module-level function, in a fixed-shape module, not in `reforms.py` itself (question 6 in `budget-day-publication.md`). Register it in `reforms.py`, which imports it, and in `policyConfig.js`.
2. **Declare what it should do** in `data_inputs/treasury/expected_effects.csv`. The columns are `measure_id,direction,from_year,to_year,reviewer,note`; `to_year` and `note` may be blank. `positive` improves the government balance and `negative` worsens it. Without this, and before any Treasury figure exists, the measure is "undeclared" and cannot be published.
3. **Declare the taxes it moves** in `DECLARED` in `tests/test_measure_descriptions.py`, and check that its name and description name only those (see "How a measure must be written" above). Without this, the required Python tests fail on the new id.
4. **Add one numerical test.**
5. **Commit.** A receipt from a dirty tree is not publishable.

## G2: provisional numbers (13:15)

```sh
uv run uk-budget-data generate --artifacts --reforms <ids> \
  --years 2026 2027 2028 2029 2030
uv run uk-budget-data publish reconcile public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish stage --provisional public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish check
```

- **One artifact per measure.** `generate --artifacts` writes one new directory per measure and never touches another measure's. It prints each directory it wrote; use that path in the commands that follow.
- **A hand-written modifier is generated alone:** one id per `generate` call, in its own process. Measures in one call share the Python process, so a value a helper module keeps from one measure's build can reach the next measure's without being read under its watch (#51 round 18, family 4; #55). Template and `parameter_changes` measures may share a call.
- **Supported years.** Years the dataset does not cover (from 2033 on 6.10.0, whose projection reaches 2032; every policy year, to 2031-32, is covered) are recorded as unsupported. The page shows them as unavailable once #20's modules are wired in after #3.
- **What "provisional" needs.** The measure must move in the declared direction. A measure that returns zero, or the wrong sign, is refused.
- **Household check.** One hand-checked household per measure, through the deployed route: add its fixture to `data_inputs/household_fixtures/` and run the `household_route` command from G0, writing `receipts/<id>-households.json`.
- **Review rows.** Before the pull request is opened, the Reconciler moves each `reconciliation.json` **outside the checkout**, for example to `~/private/uk-budget-2026/reconciliation/<id>/`, and runs `uv run uk-budget-data publish review-rows --reviewer <name> --staged-by <Integrator>`.
  - **Why it moves:** the gates recompute reconciliation and never read the file, and under the coordinator's ruling it gets no row.
  - **Why outside the checkout:** an untracked file anywhere in the tree makes the next receipt dirty, so every later `generate` writes an unpublishable receipt.
  - **Move it again after every `publish reconcile`** (G3, G5, each re-cut). `data_inputs/public_data_review.csv` goes in the same commit as the artifacts. Each row is the Reconciler's attestation that they reviewed those bytes.
  - **What it covers.** Rows go to the displayed entries' files, each not-computable entry's `receipt.json`, and the manifest. The command refuses, writing and deleting nothing, if any file is not what the gate bound.
  - **Not-computable entries** (coordinator's ruling, 22 October, option (d)). Such an artifact is its `receipt.json` alone, and its row reads "not computable, staged by <stager>". So `--staged-by` is needed while any provisional or not-computable entry is listed. Anything else in its directory, a stray table or `reconciliation.json` included, makes the command refuse.
  - **What it deletes.** Before it writes, it deletes everything under `public/data/artifacts/` that no current manifest entry names, with the rows for those files, and prints each path. That covers runs generated but not staged, and superseded artifacts after a G5 correction or a re-cut. **Stage every artifact you want to keep before running it, and never run it while a `generate` is running in the same checkout:** it would delete that run's half-written directory.
    - **A hand-written modifier's artifact held for its attestation can't be staged, so it would go too** (see "Held by default" above). Its attestation binds that exact receipt, so a regeneration needs a fresh two-person review. Commit its attestation and stage it before running the command, or keep the artifact outside the checkout until then, as for `reconciliation.json`. Never run the command in a checkout holding one.
  - **What it leaves.** It lists each file under `public/data` it left with no row, and the build fails on those; the command still exits 0, so read its list. The area routing status, `public/data/area-routing.json`, takes no row, so it is never listed. A staged entry's artifact can stay out of the commit until it is approved, since `publish check` skips staged entries.
  - **What it keeps.** Artifacts of staged, stale and withdrawn entries stay, since their entries still name them. It keeps them by the path the manifest spells, so it refuses, writing and deleting nothing, if any current entry's artifact is reached through a symbolic link or holds one, lies behind or holds anything it cannot list or read, is not a directory, or is spelled otherwise on disk, as a Mac's case-insensitive disk allows. It removes an artifact's row only when its file is gone, so a withdrawn entry's artifact keeps the row it had while displayed. It also removes a row for the area routing status, which both checks refuse, and prints it as removed.
- **Publish.** Open a pull request, wait for the checks, then merge, which deploys. The page labels these "Provisional: statement figures, awaiting Treasury costing" once #20's modules are wired in after #3.

## Documents arrive (13:40)

**Download the OBR's workbooks in a browser, by hand.**
- **Who:** María, with Vahid as backup. *Proposed; yours to confirm.*
- **When:** as soon as the documents publish, about 13:40 in the drill timetable.
- **Why by hand:** obr.uk refuses scripted downloads, and not always the same way.
  - W3 saw HTTP 403.
  - uk-data #536 records a 200 answer that is an HTML page titled "No Access - Office for Budget Responsibility" instead of the workbook.
  - On 15 October, from W5's machine, the March 2026 EFO receipts workbook downloaded by script, but the expenditure workbook got that "No Access" page.
  - On 25 October (dry run), curl got that "No Access" page for all three workbooks below, with HTTP 200 and `text/html` (88,552 bytes each).

  A browser download works: on 25 October each workbook took under a second.
- **What:** three of the EFO's *detailed forecast tables* workbooks, each its own link on the EFO page (each appears twice there, as an "xlsx" icon and as its title):
  - **economy**, for the Living standards tab (next section);
  - **receipts** and **expenditure**, for the OBR targets in policyengine-uk-data.

  The page also offers aggregates, policy, debt interest and a zip of all of them; none is needed. Take the single workbooks, not the zip: an unzipped file's modification time is not its download time.
- **Check each file is a workbook**, not the "No Access" page saved as `.xlsx`: `file <file>` must say "Microsoft Excel 2007+", not "HTML document".
- **Record:** each file's name and SHA-256 (`shasum -a 256 <file>`) in the coverage ledger as it lands, so the ingest's record can be checked against what was downloaded.
- **Receipts and expenditure go to policyengine-uk-data's ingest** (`policyengine_uk_data/targets/obr_sources.py`). In a policyengine-uk-data checkout, dry run first; it writes nothing and prints each workbook's title, SHA-256 and every OBR target's old and new value:

  ```sh
  uv run python -m policyengine_uk_data.targets.obr_sources ingest \
    --vintage october_2026 --label "October 2026" \
    --receipts <receipts xlsx> --expenditure <expenditure xlsx> \
    --receipts-url https://obr.uk/download/<receipts page>/ \
    --expenditure-url https://obr.uk/download/<expenditure page>/ \
    --first-year 2025 --last-year 2031 --dry-run
  ```

  The `--*-url` values are the obr.uk download pages the files came from (on the EFO page, the links' addresses without the `?tmstv=` query); every target cites them. The ingest refuses a workbook whose title doesn't name the vintage. Then run it again without `--dry-run`: it moves the files under `storage/obr_efo/october_2026/` and writes the vintage's manifest; pointing `sources.yaml` at that manifest adopts it, in a policyengine-uk-data pull request. About 40 s, nearly all start-up.

  Dry run, 25 October, on the March 2026 workbooks (`--vintage march_2026 --label "March 2026" --first-year 2024 --last-year 2030`): both files matched the committed manifest's SHA-256 (receipts `f65b6cb7…`, expenditure `700bfd70…`), all 168 target-years were unchanged, and it ended "a rehearsal, nothing to write".

**Treasury tables come from gov.uk by script.** On 15 October `assets.publishing.service.gov.uk` served a spreadsheet to both curl's and python-requests' user agents (HTTP 200, the right content type), so gov.uk does not refuse scripted downloads. The importer below reads a workbook from a local path and fetches nothing itself. If gov.uk does refuse on the day, download Table 4.1 in a browser the same way and pass its path.

```sh
uv run python -m uk_budget_data.treasury_import <Table 4.1 xlsx> \
  --source-id AB2026-T4.1 --document "Autumn Budget 2026" \
  --out data_inputs/treasury/sources/AB2026-T4.1.csv \
  --static-template data_inputs/treasury/sources/AB2026-static.csv
```

- **Totals check.** The importer (#16) checks the rows against Table 4.1's printed totals and stops on a mis-keyed row.
- **Static costings.** María fills `AB2026-static.csv` from the policy costings document. These static costings are the gated comparator.
- **Mapping.** María fills `data_inputs/treasury/mapping.csv` (measure to row). A row outside scope or on a different basis is marked `not_comparable`, with a reason and reviewer. A `scale` other than 1 also needs a reason and reviewer, and must be above zero (#17).

## Budget day: OBR forecast (Living standards tab, from 13:40)

The Living standards tab's **Forecast changes** sub-tab shows the OBR March 2026 forecast as "pre-Budget". Once the OBR publishes the Budget EFO, load its economy tables as the "post" series, so every chart draws both lines and the tiles show the change. The tab's data come from this repository (`uk-budget-data living-standards`, `src/uk_budget_data/living_standards/`); PolicyEngine/uk-living-standards-outlook is no longer its source.

1. **Download** the EFO's *detailed forecast tables: economy* (.xlsx) in a browser, as above, and record its SHA-256.
2. **Load it** (Vahid):

   ```sh
   uv run uk-budget-data obr-forecast \
     --efo ~/Downloads/<economy tables>.xlsx \
     --label "OBR October 2026 (Autumn Budget)" \
     --url https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/
   ```

   It takes about 2 seconds. It writes `data_inputs/living_standards/obr_forecast_post.json` and the `forecast` block of `public/data/living_standards_outlook.json` (nothing else in the file changes), and sets that file's review row to pending, with a new SHA-256 and a 14-day expiry.
3. **Check what it printed:**
   - every series, with its values for 2027 to 2030: CPI, CPIH, RPI, earnings, non-labour income, house prices, rent and mortgage interest from the OBR tables, then CPI after housing costs and social rent recomputed by PolicyEngine. The console prints values only; the table and column each was read from are in each series' `post_source` in `public/data/living_standards_outlook.json`;
   - the file name and SHA-256 match the download;
   - any "kept at the pre-Budget value" line. Only mortgage interest 2030 may say this, and on the March 2026 tables it does, because the OBR stops forecasting it after 2030 Q1. That line is expected; any other series saying it is not.

   If a table, column or year is missing, it stops and names the series; nothing is written. Don't fill a value by hand: fix the reader's pattern in `living_standards/obr.py` (`OBR_SERIES`), with a test.
4. **Commit** both files and the review row in a pull request; the page then reads "OBR March 2026 (pre-Budget)" against the new label.

**Rehearsing with the March tables.** Loading the March 2026 economy workbook (SHA-256 `fde1de4b…`, the same bytes as `data_inputs/living_standards/efo-march-2026-detailed-forecast-tables-economy.xlsx`) under a test `--label` gives post equal to pre: on 25 October all 40 values of the 10 series matched, and the Forecast changes sub-tab showed the test label, "no change" on each headline and the post line drawn over the pre line. Don't commit a rehearsal. Undo it with `git checkout -- public/data/living_standards_outlook.json data_inputs/public_data_review.csv` and `rm data_inputs/living_standards/obr_forecast_post.json`.

**This does not change the model.** The national results, and every projection on the Baseline outlook, uprate with the OBR forecast in the policyengine-uk release the bundle pins (March 2026 on 2.132.6). Moving the model onto the Budget forecast needs a policyengine-uk release and a bundle adoption, then `uk-budget-data living-standards` to rerun the projections (it keeps the loaded post forecast). The tab runs 2027-28 to 2031-32 on any engine; below policyengine-uk 2.134.4 its baseline applies that release's UC health element fix for 2030-31 and 2031-32 itself (`living_standards/uc_health_element.py`, policyengine-uk #2428).

**To regenerate the baseline projections** (any time the bundle changes): `export HUGGING_FACE_TOKEN=…`, then `uv run uk-budget-data living-standards`. About 40 s and 8 GB. A new HBAI release: add `--hbai-ods <summary tables .ods>`; OBR household income per person from a new EFO: `--rhdi-efo <economy tables .xlsx>`. Sources and hashes are in `data_inputs/living_standards/README.md`.

## G3: rebase and reconcile (13:40 to 14:10)

- **If the forecast is rebased** on the Budget's OBR tables: update `data_inputs/publication_basis.json` (`forecast.status: updated`, with source and vintage), regenerate every measure, and stage with `--adopt-basis`. Every entry on the old basis becomes stale.
- **Reconcile** each measure: `uv run uk-budget-data publish reconcile <artifact>`. A year passes within 10% or £50m of the static costing, whichever is larger. *The numbers are still to be agreed.* Every year the artifact reports must have one model output; a missing year fails and no exception can accept it (#17).
- **A failed year** is fixed, or María adds an exception to `data_inputs/treasury/exceptions.yaml`:
  - one of the closed explanation classes;
  - a quantified explanation;
  - the reviewer's name;
  - the artifact's `outputs_sha256`;
  - the failed row's `comparator.sha256` from `reconciliation.json` (read it before the file is moved outside the checkout, or from its moved copy), as `comparator_sha256`. The exception then lapses if any Treasury figure, mapping or the basis behind that comparison changes (#17).

  Then reconcile again.
- **Approve:**

  ```sh
  uv run uk-budget-data publish stage public/data/artifacts/<id>/<digest>/
  uv run uk-budget-data publish approve <id> --by "María Juaristi" \
    --household-receipt receipts/<id>-households.json
  ```

  Approval is refused until every gate passes. It names the exact outputs approved and stores the household receipt in the manifest. *The household receipt is optional in the code today (`REQUIRE_HOUSEHOLD_CHECKS` in `publish.py`); it becomes required once the specimen households exist.*

## G4: combined run and publish (14:50)

```sh
uv run uk-budget-data generate --combined <all coded ids> --years 2026 2027 2028 2029 2030
uv run uk-budget-data publish stage public/data/artifacts/combined--<ids>/<digest>/
uv run uk-budget-data publish approve combined--<ids> --by "María Juaristi"
uv run uk-budget-data publish check
```

- **Combined only.** `--combined` without `--reforms` generates only the combined run. It prints the directory it wrote.
- **Results by area** (`uk-budget-data geography`): `--manifest` defaults to `public/data/manifest.json`. The command defaults to its approved single-measure ids, in manifest order, followed by approved packages whose exact members are all approved, and refuses explicit ids that are not approved, including held, provisional and not-computable measures. A package needs its own approved combined entry; approving its members alone is not enough. Constituency results default to the package; without an approved package, pass `--seat-reforms`. A missing manifest or one with no approved ids means there is nothing the national page may publish yet.
  - **What #76 checks:** when a reform touches a data limit in what the area run calculates, the command names it and writes no tables at all.
  - **What it doesn't:** the manifest records publication approval, but the command does not read the holds ledger. The Reconciler still checks that measures held by hand have not been approved. A limit read only outside household net income, or in a year outside `--years`, isn't seen by the area run (#76's gap note).
  - **Microcosm is uncertified:** every run using Microcosm, however supplied, prints the uncertified label at the start and end and records `certified: false` and the reason in the private audit (policyengine.py#685). **The coordinator's ruling on the page caveat** (22 October): the area views show approved ids only, labelled as estimates from Microcosm's local-area file, which the national certificate doesn't cover (policyengine.py#685). Vahid and María choose the wording and placement. Until it's added, the page doesn't show the label, and the CSVs carry no dataset field to drive it. The disclosure CSV schema is unchanged. The default `efrs` route refuses 6.10.0's Microcosm bundle rather than mixing it with enhanced-FRS seat weights, and points to PR #59.
- **Which ids.** A measure that isn't approved blocks the combined run's approval: a CGT measure that depends on taxpayer numbers (held provisional), a pension measure held for review, a State Pension measure held provisional for want of policyengine-uk #2336, or an SDLT measure that isn't computable. If the call is to leave such measures out of the combined run, list every coded id but those, and say so wherever the package total appears. The results by area label their package reform "All measures (the full package)" when every measure on the page is selected (`src/utils/geography/selection.js`). If that package leaves a measure out, that label must change too.
- **Before simulating**, the combined run is checked: every parameter each member sets alone must hold in the combination. Conflicting measures are refused, naming both.
- **Approval** needs every member approved.
- **Review rows.** As at G2, before the pull request is opened: `uv run uk-budget-data publish review-rows --reviewer <name>`, with `--staged-by <Integrator>` while any provisional or not-computable entry is listed. The review list goes in the same commit as the artifacts. Each row is the Reconciler's attestation that they reviewed those bytes.
- **Publish.** Open a pull request. The six required checks must pass. Publication gate runs too: it isn't required (question 3), but don't merge if it fails. Merge, and production deploys.
- **Verify on the live route:**

  ```sh
  curl -s https://policyengine.org/uk/autumn-budget-2026/data/manifest.json | head -5
  ```

  Until policyengine-app-v2#1249 is live, and at the rehearsal, read the Vercel deployment instead:

  ```sh
  curl -s https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026/data/manifest.json | head -5
  ```

  Either way, then run the household check:

  ```sh
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" \
    --fixtures data_inputs/household_fixtures --manifest public/data/manifest.json
  ```

## First cut for media and the webinar (proposed: 15:45)

**Before it goes, a comparables review (Max, 21 October).** For each analysis it features, run a fresh comparables review, dated within 7 days. An unexplained gap of more than 25% from a comparable estimate is pulled or explained before anything is sent. The same applies to any newsletter, social post, webinar or press push featuring PolicyEngine estimates.

**Proposed, not agreed.** Max is asking Vahid and María to confirm the time, and who sends ITV the figures.

- **Why 15:45.** ITV's evening segment needs our analysis by 16:00 UK time on 28 October (18:00 at a stretch), and the webinar starts at 16:30.
- **What goes.** Whatever is approved in the manifest at 15:45: each measure approved at G3, and the combined run if it was approved at G4. Use one manifest revision, and record it in the clock.
- **What is held.** A measure that has not been approved by the cut is held for the 07:00 briefing. It is not given to media as provisional, and it is left out of the webinar slides. This is the rule from the call with Nuffield on 13 October: publish only what the team is fully confident in, and drop anything not nailed down. #22's export commands enforce it, because they refuse any entry that is not approved. #22 is a draft: until it merges, they are not on `main`.
- **No totals by addition.** If the combined run is not approved by the cut, the first cut carries per-measure figures only.
- **How, once #22 has merged.** Export from that revision, to a directory of your choosing:

  ```sh
  uv run python scripts/generate_blog_charts.py --manifest public/data/manifest.json \
    --keys <approved ids> --out-dir <dir>
  uv run python scripts/generate_combined_charts.py --manifest public/data/manifest.json \
    --key combined--<ids> --out-dir <dir>
  ```

  The ITV figures and the webinar slides come from that export and nothing else.
- **If #22 hasn't merged,** `main`'s two scripts take none of these flags: they read the flat CSVs, and `generate_combined_charts.py` still writes last year's titles. Don't use them for the first cut. Take the figures from the artifacts of the approved entries in that manifest revision (each entry names its artifact directory), and record which.
- **The webinar** has no guest panelist, so its deck needs only our own approved results. Marketing materials go to Nuffield by Wednesday 21 October; they are not built from this runbook.
- **Your call: the dashboard's "Provisional" label.** G2 publishes statement figures on the dashboard labelled provisional. Keep that for the dashboard, or show only approved figures there too. Either way, media and the webinar get approved figures only.

## G5: corrections (whenever one arrives)

1. **Fix the measure and commit.**
2. **Regenerate it.** This writes a new artifact; the old one is untouched until step 5's review rows delete it (its entry stays in `superseded` for audit).
3. **Reconcile and stage it.** The previous entry moves to `superseded`. Any combined run that included it becomes **stale** automatically.
4. **Regenerate the combined run**, stage it, and approve both.
5. **Write the review rows, as at G2, and publish through a pull request.**

An approval or an exception carries over only where the outputs are byte-identical.

## Rolling re-cuts, and the 07:00 go/no-go (Max, 22 October)

Max, relayed by the UK hub and the coordinator on 22 October: "i think we should keep improving the model as much as we can as long as we can". So there is no single lock. The dashboard adopts each certified re-cut, under d1152 ("latest certified release"). UK time equals UTC from Sunday 25 October.

- **The cuts:**
  - **Rehearsal cut, Thursday 22:** the first policyengine-uk release with the 21 October merges. Friday's rehearsal uses it if it's adopted by 11:00Z on Friday. Otherwise the rehearsal runs on 6.10.0.
  - **Re-cuts, Saturday 24, Monday 26 and Tuesday 27:** each only if a material fix landed.
  - **The final cut, Tuesday 27:** its adoption is complete by **06:00Z on Wednesday 28**. That means merged, the household API deployed, the household check passed, a breakdown answered under 200 s, and the revert PR green. Its build start and release time (16:00Z and about 22:00Z for now) are placeholders until Friday; see "The schedule" below.
- **Each cut is an adoption,** as in "Adopting a release (each re-cut)" below:
  1. the draft PR, and its CI;
  2. regenerate, stage, reconcile and approve on the branch, and write the review rows (`publish review-rows`, as at G2);
  3. merge with a merge commit (`gh pr merge --merge`), since `git revert -m 1` needs one, and open its revert PR as a draft;
  4. redeploy the household API;
  5. run the household check, time one breakdown (see "Adopting a release"), and run the "Read API memory" workflow on the new revision.
- **Approval for re-cuts and the final cut: on the adoption branch, before the merge** (coordinator, 22 October). It's an ordering change, not a lower bar. Use the same order for the rehearsal cut, so that the rehearsal exercises it.
  - **Who:** the named approvers approve on the branch, on the new release's figures.
  - **Right after the merge and the API deploy,** run the household check and time one breakdown.
  - **If it fails,** merge the prepared revert PR and roll the API back to the previous revision, or redeploy it from the reverted `main` if that revision predates the route the page calls (see "The fast revert" below).
  - **Why this order:** the approvals then live in the adoption PR, which is what keeps the revert clean.
- **The 07:00Z go/no-go, Wednesday 28:**
  - **Go** with the final cut only if every gate is green and its change against the previous cut is attributed (d1682).
  - **Otherwise go back to the previous cut.** By then the final cut is merged and deployed, so going back means the fast revert below.
  - **After 07:00Z,** only an emergency revert to the previous cut. G0's start receipt at 11:30 pins whatever is live.
- **How long one adoption takes** (measured 19 to 22 October, with the runner queue as it was):

  | Step | Quiet runners | 21–22 October's queue |
  |---|---|---|
  | The release reaches the dashboard (policyengine.py's dispatch, or W5's by hand) | a few minutes | 40 min |
  | Adoption workflow to draft PR | 10–21 min | 80 min |
  | CI on the lock change | 20 min | 46–105 min |
  | Review of a lock-only PR | 15 min | 15 min |
  | Regenerate, stage, reconcile and approve every published measure and the combined run | **not yet measured** | **not yet measured** |
  | CI again, with the regenerated artifacts and manifest | 20 min | 46–105 min |
  | Merge, then deploy the household API (smoke test included) | 6–7 min | 10 min |
  | Household timings and memory read | 15 min | 15 min |
  | The revert PR's CI, alongside the deploy and the checks | 20 min | 46–105 min |

  - **The critical path:**
    1. dispatch;
    2. the adoption workflow;
    3. the longer of the lock's CI and regeneration, which run side by side, with the review alongside;
    4. CI with the artifacts;
    5. merge;
    6. the longer of the deploy plus checks and the revert PR's CI.

    Approval on the branch needs no CI run of its own.
  - **Totals:**
    - **Quiet runners:** about 1 h 20 min, plus any regeneration beyond 20 min.
    - **At 21–22 October's queue:** about 7 h 15 min, plus any regeneration beyond about 1 h 45 min.
  - **Where CI time goes:** each CI run's ten jobs queue separately for runners. In #72's run the work took about 16 minutes; the rest was queueing.
  - **Time the regeneration** at the rehearsal and at every re-cut, and record it in the clock table:
    - **What to time:** regenerate every published measure and the combined run, stage, and reconcile, as the final cut would. Hand-written modifiers each take a `generate` call of their own.
    - **How:** run `date -u` before the first `generate`, and again after the last `publish stage` or `publish reconcile`, whichever comes last.
    - **What to record:** both times, how many measures and combined runs were regenerated, and the bundle. The rehearsal may carry fewer measures than the day, so the count lets the time be scaled.
    - **Who:** whoever runs the rehearsal's regeneration, probably the Integrator (pending Max's answer on #88). W5's cloud session has no data access, so it can't time it itself.
  - **To fit the overnight window:**
    - W5 dispatches the adoption by hand as soon as the release is on PyPI, as it did for 6.10.0;
    - start regenerating on the adoption branch as soon as the lock is in, alongside its CI;
    - approve on the adoption branch, as above. That also saves the separate approval PR's CI run.
  - **The schedule, worked back from 06:00Z** (coordinator, 22 October), on busy-queue figures:
    - **A:** adoption plus regeneration. That's W5's figure: the table above, plus regeneration measured at Friday's rehearsal.
    - **B:** the Microcosm build. The UK hub's build runbook gives it.
    - **C:** certification plus release: the policyengine.py PR's CI, then `push.yaml`. Measured for 6.10.0:
      - **The PR's CI:** about 1 h 15 min at #685's final head (run 39588831360).
      - **`push.yaml`:** about 3 h 10 min from merge to PyPI (#685 merged at 13:30Z, and was on PyPI at 16:41:14Z), about 2 hours of it waiting for runners.
      - **In all,** about 4 h 25 min.
      - **The dispatch:** policyengine.py's consumer dispatch then waited 40 min for a runner. W5 avoids that by dispatching by hand promptly.
    - **A margin of 1 hour.**
    - **So:** the final release must be out by 06:00Z − A − 1 h, and the final build must start by 06:00Z − A − 1 h − C − B.
    - **Placeholders:** 16:00Z and 22:00Z stand until A, B and C are measured. After the rehearsal the coordinator sets the real times and tells W5 and the hub.
    - **If the computed start falls before 08:00Z on Tuesday,** the final cut is effectively Monday's re-cut, and the coordinator says so.
    - **For scale:**
      - At 21–22 October's queue, A is at least about 7 h 15 min. So with the hour's margin, the release must be out by about 21:45Z, even if regeneration takes under 1 h 45 min.
      - Every minute of regeneration beyond that moves the release earlier, minute for minute.
      - So report the regeneration time measured at Friday's rehearsal.
- **The fast revert to the previous cut:**
  - **Keep the previous cut ready.** Its API revision stays in Cloud Run as the rollback target; record it in the clock table. The workflow's `rollback` took about 5 minutes on 15 October.
  - **Prepare the revert at the merge.** Right after an adoption merges, open its revert PR (`git revert -m 1 <merge>`; see "Rollback") as a draft, and let its CI finish. Green means every check passes, the Publication gate included, though it isn't a required check. A revert is then the merge of a green PR, not a wait in the runner queue.
  - **Keep it current.** Checks don't require a branch to be up to date. So if anything merges to `main` after the revert PR's CI ran, update the revert PR and let its CI run again.
  - **That stays clean only while nothing is published after the adoption.** That's why approval happens in the adoption PR. After any later publish PR, refresh the revert PR (keeping `main`'s publication files, as "Rollback" says), regenerate on it, write the review rows, and re-run its CI. On 28 October that means the revert stops being fast after G2's first publish PR.
  - **Then, to revert:**
    1. mark the revert PR ready (a draft can't be merged), and merge it;
    2. run the API `rollback` to the recorded revision. If that revision predates the route the live page calls (any revision before `00024-lir`, for #69's `/api/household-impact`), `deploy` the reverted `main` instead;
    3. run the household check, and time one breakdown (see "Adopting a release").

    The previous cut's artifacts, manifest and approvals come back with the revert, still certified on its release.
  - **The 14 October cut, only if a release ever falls back to it** (UK hub, S6, 22 October). That cut predates Microcosm's weight-index fix (0f0bb869), so it carries a +0.72% calibration-year weight skew. No dashboard release has used it: 6.10.0's cut has the fix, and so do later re-cuts. So a revert to the dashboard's previous cut doesn't carry it.

## Adopting a release (each re-cut)

**On 28 October no upgrade is adopted after the 07:00Z go/no-go.** Only an emergency revert to the previous cut is allowed (see "Rolling re-cuts" above). The steps below are how each re-cut is adopted before then.

- **Upgrade PR.** When policyengine.py releases a qualified bundle, a draft upgrade pull request opens automatically (#18). If its dispatch is late, W5 dispatches the adoption by hand. The workflow opens draft PRs only. Each re-cut's PR merges on its gates, after approval on the branch.
- **First, regenerate the area routing status on the upgrade branch, with the new release installed:** from the repository root, `uv run python -m uk_budget_data.area_routing --write`, and commit `public/data/area-routing.json` if it changed. The command reads the installed bundle, not the lock: run before the install, it would record the old release's routing. Do this before regenerating the measures: an uncommitted change makes the tree dirty, and a receipt generated on a dirty tree is not publishable.
  - **What it is:** whether the new bundle routes constituencies and local authorities, read from its UK release manifest (`regional_release_kind` and `region_datasets`). The page labels its constituency view "not available on this release" when the file says `not_available` (see "The weekend release is national only" below).
  - **Why every time:** `tests/test_area_routing.py` pins the file to the installed bundle, so an adoption that changes the routing fails CI until the file is regenerated. Its message names the command. The file takes no review entry: both public file checks accept only the few texts the command writes, and refuse an entry for it; `publish review-rows` doesn't list it as unreviewed, and removes a row for it.
  - **How the label lifts.** Regenerating the file at the adoption of a release that routes results by area again flips it to `available`. The page then draws whatever constituency file `public/data/` holds, and nothing ties that file to a release. So the same upgrade PR carries the area run's tables from the new release, with their review rows; otherwise the page shows the tables of an earlier release. A clean revert of the adoption brings the previous file back with it; one that keeps `main`'s publication files doesn't (see "A model release" under rolling back).
- **Regenerate on the upgrade branch, before merging.** With the new release installed, regenerate every published measure and the combined run, stage the first with `--adopt-execution`, and reconcile. Every other entry becomes stale until it is re-staged.
  - **The regenerated artifacts and the manifest go in the upgrade PR,** with their review rows (`publish review-rows`, as at G2). `publish check`, which CI runs as the Publication gate, re-checks the certificate of every displayed entry against the installed release ("the certificate is for policyengine X, but Y is installed"). So once anything is displayed, a PR that changes only the lock fails.
  - **The Living standards outlook too (since #69).** With the new release installed, run `uv run uk-budget-data living-standards` (about 40 s and 8 GB; it needs `HUGGING_FACE_TOKEN`). Commit `public/data/living_standards_outlook.json` and `data_inputs/public_data_review.csv`, where the command sets the file's review row to pending.
    - **Commit it before the first `generate`, or run it after the last.** An uncommitted outlook or review list makes the tree dirty, and only the manifest and artifacts are exempt (`is_publication_path` in `publication/receipt.py`), so receipts generated meanwhile aren't publishable.
    - **Why:** `test_the_committed_outlook_meets_the_contract_on_the_pinned_engine` (`tests/test_living_standards.py`) requires the file's `meta` to name the installed policyengine, policyengine-uk and certified dataset, so an upgrade PR that changes only the lock fails the Python tests.
    - **It also keeps the revert clean:** carried in the upgrade PR, a clean revert brings the previous file back with it.
    - **And bring the view's tests up to date, in the same commit.** They read the committed outlook, so after regenerating, run `bun run test src/components/livingStandards src/utils/livingStandards` (the view tests and the outlook schema test) and update every assertion the new file changes, or Frontend tests fails. The ones known to depend on it:
      - **The engine and the data build** in `LivingStandardsView.test.jsx`'s Methodology test ("policyengine 6.10.2 (policyengine-uk 2.132.6)", "Microcosm UK national (19 Oct 2026, 6cba5d71)"). Set them to what the Methodology page shows for the regenerated file. A new policyengine changes the first (a new policyengine-uk, its bracket), and a new data cut the second; a133 changes both.
      - **The UC health element row** in the same test (the `PolicyEngine/policyengine-uk#2428` link and "For 2030-31 and 2031-32 this baseline applies that fix itself"). From policyengine-uk 2.134.4 the baseline no longer applies the fix itself (`FIXED_IN` in `living_standards/uc_health_element.py`), so the page drops the row: remove those assertions, or assert the row is absent. a133, on policyengine-uk 2.147.2, does this.
      - **The poverty figures for couples with children** ("19.8% → 19.8%no change", "2027-2819.8%", "ChangeNo change"), if the regenerated relative AHC rates round differently.
  - **So does whatever the new release's tests demand,** for example removing a lifted data limit or updating the State Pension test for #2336 (each above). `UC_REBALANCED_YEARS` needs no change: it follows the engine's export.
- **Merge, then redeploy the household API by hand.** The deploy builds only a commit on `main` ("Choose the commit" in `deploy-api.yml`, and the ancestry check in `cloudbuild.yaml`), and merging doesn't start it: deploys on push stay off while the repository variable `API_DEPLOY_ON_PUSH` is unset. So after the merge, run the "Deploy the household API" workflow with action `deploy`, then run the household checks. Until the deploy has run, G0's household check fails on the version mismatch, as designed.
  - **Dispatch it as soon as the merge lands.** Until the deploy finishes, the previous revision serves the Personal impact tab. The dashboard goes live about a minute after the merge. The API goes live only when the deploy promotes its revision, about 6 to 7 minutes after dispatch. On 24 October, #69's merge was live on the dashboard at 23:21:16Z (Vercel), and `00024-lir` had taken traffic by 23:27:13Z (run 40142327478, dispatched at 23:20:24Z; the workflow confirmed the live version at 23:27:15Z).
  - **Then time one breakdown.** No gate asks for one (see "How long one household answer takes"). After the household check, run this. The first number printed must be 200, and the second, the seconds, under 200, the page's limit. Treat anything else like a failed household check. An answer within a few seconds came from the route's cache (`_cached_household_impact`), so change `employment_income` and run it again.

    ```sh
    curl -s -o /dev/null -w '%{http_code} %{time_total}\n' --max-time 300 -H 'content-type: application/json' -d '{"year": 2027, "household": {"employment_income": 31000}, "include": ["by_policy", "sweep"]}' https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact
    ```

  - **What the gap does:** in a model adoption, the tab answers from the previous release while the national figures come from the new one. In a merge that changes the route the tab calls, as #69 did, the tab fails until the deploy finishes. The page doesn't compare the API's versions with the publication's, so nothing on it says when they differ.
- **Approve on the upgrade branch, before merging, for re-cuts and the final cut** (coordinator, 22 October; see "Rolling re-cuts" above).
  - **Why it's possible:** approval doesn't require a household receipt today (`REQUIRE_HOUSEHOLD_CHECKS` is `False` in `publish.py`).
  - **What it avoids:** a gap. If approval came after the merge, figures that were approved would show at most as provisional from the merge until approval (re-staging them with `--provisional` keeps them visible).
  - **The cost:** the figures are approved before any household check has run on the new release. So run the household check and time one breakdown immediately after the merge and the deploy, and revert if either fails.
- **Fallback.** If that cannot finish before a deadline, stay on the current release. `publish check` refuses a manifest that mixes releases.

## The data line changed: Microcosm (21 October)

policyengine.py#685 (merged 21 October) makes Microcosm UK 2024-25 the UK default data, in place of policyengine-uk-data's enhanced FRS. Constituencies and local authorities route to its local-area cut. As relayed by the coordinator:
- **6.10.0**, releasing from policyengine.py#685, pairs Microcosm data 0.1.0 with policyengine-uk 2.132.6 (tagged 15 October). That model predates policyengine-uk #2240, #2241, #2242, #2284, #2419 (a retention-rate elasticity of 1 as the default CGT response), #2428, #2436, #2437, #2440 and #2441. It is adopted as a shakedown of the switch.
- **The Budget-day pair** is María's pre-Budget Microcosm build (microcosm#1329, merged), with a newer policyengine-uk (microcosm#1333, an open draft waiting on a policyengine-uk release). It is hand-certified by María.
- **The rehearsal** runs on whichever is the latest certified release on Friday morning (d1152).
- **uk-data pairs are no longer promoted,** so uk-data 1.59.1 (tagged 21 October) won't be adopted.

**What in this runbook was measured on the old data, and needs re-measuring on Microcosm before it is used:**
- the two data limitations below: the age-80 cap, and the £1m+ record count (both measured on uk-data 1.58.1);
- the capital gains tax paragraph below (uk-data 1.59.1). On 6.10.0, policyengine.py#685's evidence puts CGT at £27.3bn, 21% above Microcosm's HMRC target of £22.5bn. The taxpayer-count rule (Max's d1735) stands until he rules otherwise; a Microcosm count updates the disclosure only;
- the pension annual allowance sentence and its cause (uk-data#606, measured with policyengine-uk #2240, which 6.10.0 lacks);
- the 2030-31 UC note, and the UC health row's "from 2030" advice: policyengine-uk 2.132.6 lacks #2428, which extends the rebalancing to 2032, while the Budget-day pair's model has it, so the advice flips there;
- the SDLT "Why" row: the certified dataset it names is uk-data 1.58.1. The tripwire re-checks it when new data are adopted;
- the State Pension row's figures: #2336's reports ran on uk-data 1.58.1;
- the household API timings and memory: re-measured on 6.10.2 with #69's route (`00024-lir`, 25 October, above). Re-measure after each re-cut's redeploy;
- results by area: Microcosm's local-area cut is not yet certified (policyengine.py#685).

Until a row is re-measured, don't quote its figures.

## The weekend release is national only (coordinator, 23 October)

Saturday's data cut (a133f37a, as the UK hub names it, with policyengine-uk 2.147.2) is being certified by the UK hub with `--drop-regional-release`. So its bundle routes no constituency or local-authority data, and those outputs are absent until Monday's cut.
- **Nothing breaks,** the note says, since the area gate already refuses. Our reading of that gate, not yet confirmed with the coordinator: policyengine.py 6.10.0, installed now, lists constituencies and local authorities among its UK regions only when the bundle routes them to a local-area release (`build_uk_region_registry`), so with no routing it lists none. Check that the weekend bundle's policyengine.py still does before adopting it. This dashboard doesn't use that registry: the area run (`uk-budget-data geography`) does not read the routing, so the page's label, below, is what keeps an earlier release's constituency file off the page.
- **The page labels the constituency view** "Results by constituency are not available on this release." It shows no figures from any constituency file, since none belongs to this release.
  - **What drives it:** `public/data/area-routing.json`, regenerated at adoption (see "Adopting a release" above). On this release it reads `not_available`.
  - **The view draws only when the file says `available`.** While it loads, the view says "Loading map…", and keeps saying so if the request never answers. If the file is missing or can't be read, on any release, the view says "Results by constituency could not be loaded." and shows no figures, search or export.
- **The region view is not labelled.** The area run publishes regions only from an enhanced FRS run (`--dataset-kind efrs`), never from a local-area release, and that run does not read the bundle's routing, so dropping the routing does not affect it. No region file is published yet, so the view says "Results by region are not yet published."
- **Nothing else needs the label.** The page has no local-authority view, the household calculator has no area selector, and the page calls no area route.

## Data and model limitations: say these wherever a measure depends on them

The UK hub measured two limitations of the data on uk-data 1.58.1 (`enhanced_frs_2024_25.h5`, SHA-256 `056e80fd…`), and a third, on capital gains tax, on uk-data 1.59.1 (below). The data line has since changed (see "The data line changed" above): once they are re-measured on the adopted Microcosm build, state the first two wherever a measure's figures depend on very old ages or the highest incomes: in the dashboard's methodology, and in the 07:00 briefing's limitations section. You may reword them for the briefing.

- **Ages:** "The Family Resources Survey records adult ages only up to 80, so the 3.6 million people aged 80 or over in our data (7,718 survey records) all appear as exactly 80, and results that depend on ages above 80 rely on that grouping."
- **£1m+ incomes:** "Fewer than 10 survey records have a total income of £1 million or more, all from self-employment alone, so the data cannot represent the £35.5bn of employment income and £11.1bn of dividends that HMRC's Survey of Personal Incomes records for people on £1 million or more in 2023-24, and estimates for measures aimed at the highest incomes rest on very little data."

W5 re-measured on the same file for 2025:
- **Ages:** the oldest age is 80, nobody is above it, and 7,718 records are aged exactly 80, weighing 3.62 million people.
- **Incomes:** fewer than 10 records have `total_income` of £1 million or more, all with self-employment income and no other income type, so no employment income or dividends.

**Source of the £1m+ figures:** HMRC's Survey of Personal Incomes, 2023-24: £35.5bn of employment income for 21,000 people, and £11.1bn of dividends for 19,000. An earlier draft called these a 2025 HMRC projection. The 2025 calibration targets are PolicyEngine's own uprating of them: £37.4bn and £11.6bn on 1.58.1 (`storage/incomes_projection.csv`; corrected by the UK hub, uk-data#593).

**Capital gains tax: taxpayer counts (measured on uk-data 1.59.1).** Batch 3 of uk-data (policyengine-uk-data #608, with #571, which starts capital gains on HMRC's 2024-25 size-of-gain table) was published as 1.59.1 on 21 October, with a reviewed widening of the CGT taxpayer-count test's bound (policyengine-uk-data #631; Max's decision d1735, 20 October). The dashboard won't adopt it: the Budget-day pair is on Microcosm (see "The data line changed" above), and these figures are to be re-measured there. The rule below stands until Max rules otherwise. 1.59.1's built count of CGT taxpayers is about a third below HMRC's: 375,000 weighted against 548,000.
- **A measure that depends on the number of taxpayers** (a change to the annual exempt amount, or to a threshold) is staged provisional on the day, not approved. The 07:00 briefing takes approved entries only, so it stays out of the briefing too.
  - **This also holds up G4.** A combined run is approved only when every member is, so a combined run that includes such a measure can't be approved, and the first cut then carries per-measure figures only. **Your call, before the day:** leave such a measure out of the combined run (and say so wherever the package total appears), or accept per-measure figures only.
- **A CGT rate change** goes through G3 as any measure does: reconciled, then approved. It depends mainly on total gains. On 1.59.1 these are 10% to 25% off the calibration target, the OBR's March 2026 capital gains tax receipts forecast (`obr/capital_gains_tax` in uk-data's `obr_march_2026.yaml`), against 25% to 50% before.

**Model gaps the UK hub found (22 October).** These are from the UK hub's Budget-relevance triage of 22 October, relayed by the coordinator. Most are limits of the model; #1911, #1912 and #547 also need data the survey doesn't hold. They apply on any adopted pair until a fix lands. **Say each one wherever a figure depends on it.** The figures will come from the UK hub. The coordinator has asked it to post its re-measured aggregates on GitHub, in this repository: aggregates and counts only, with small cells suppressed. W5 adds them here. Don't quote any until then.
- **AHC absolute poverty runs high.** From 2025-26 both absolute poverty lines rise by headline OBR CPI. HBAI's after-housing-costs deflator is CPI excluding housing, which the model carries but doesn't use for the poverty lines. Headline CPI is above that series in every year to 2030, so the AHC absolute line, and AHC absolute poverty with it, runs high. Disclose this wherever AHC absolute poverty appears.
- **Capital gains tax runs above the OBR's receipts** in 2026-27 (policyengine-uk #2272). It inflates the leading CGT measure, aligning CGT rates with income tax rates.
- **The CGT behavioural response adds nothing back to income tax** (policyengine-uk #1982).
  - **At an elasticity of 1,** the total is netted, but the split between CGT and income tax is wrong.
  - **At an elasticity that assumes an income tax offset,** such as the OBR's 3.6, the offset is missed, so the total is wrong as well as the split.
  - **On 6.10.0,** policyengine-uk 2.132.6 costs statically by default: its elasticities are 0 (its separate BADR elasticity applies only when switched on). So the gap appears only when a response is switched on. An elasticity of 1 is the default from #2419.
  - **Disclose it with the elasticity used.**
- **Projected years have no ageing** (policyengine-uk #1929). They copy the data year, with one population factor growing every weight. So State Pension spending grows more slowly than DWP projects over 2025-26 to 2030-31, which understates the State Pension baseline and the later-year costs of `pension_uprating` measures.
- **The High Value Council Tax Surcharge covers owner-occupied main homes only:** let properties, second homes and company-held homes aren't charged (policyengine-uk #2171). There's no deferral or support scheme either (#2492).
- **Housing Benefit for supported and temporary accommodation isn't modelled** (policyengine-uk #1911).
- **Universal Credit has no transitional element for managed migrants** (policyengine-uk #1912).
- **Universal Credit doesn't exclude full-time students** (policyengine-uk #2346).
- **Children aged 9 to 11 months get no working-parent childcare hours** (policyengine-uk-data #547): the data store whole-year ages.

**State Pension measures from 2027-28, in a pair with #2336 but without #2557** (coordinator on #90, 22 October). Say this wherever such a measure's figure appears, and in the briefing's caveats when one is published:

> "Until #2557 is in the adopted pair, the 2027-28 baseline's additional State Pension and protected payments use forecast September CPI, so a full-rate measure's cost is slightly off through means tests such as Pension Credit."

It lifts with #2557. A measure that moves September CPI or the triple lock is held at provisional instead (the September CPI limit above).

**Where they go:** the data limitations describe the national results, not the household calculator, which uses the visitor's own ages and incomes; whatever is placed should say so. The model gaps can also reach a household answer wherever the household has the circumstance, for example a full-time student claiming UC. The dashboard has no methodology section today. The only data notes are in two measures' descriptions in `App.jsx`, which #3 rewrites. The briefing has no template yet; #22 exports its tables. Where the text sits is your call.

## Briefing (overnight, by 07:00)

**Before it goes, the same comparables review as the first cut:** dated within 7 days for each analysis featured, with an unexplained gap of more than 25% pulled or explained.

Exports are built only from approved entries of one manifest revision. A measure held at the first cut joins the briefing once it is approved. Each chart is stamped with the model, the data and the manifest revision (#22, a draft). Use no figure that is not in that revision.

## Rollback

- **Dashboard.**
  1. Use Vercel Instant Rollback to the recorded previous production deployment (dashboard, or `vercel rollback <deployment> --scope policy-engine`).
  2. Revert the bad merge through a pull request, and wait for its deployment to build. This repository merges with merge commits, so use GitHub's Revert button or `git revert -m 1 <merge>`; a plain `git revert` of a merge commit fails.
  3. Run `vercel promote <fixed deployment> --scope policy-engine`. After a rollback, Vercel stops assigning the production domain to new deployments, so the fix does not go live until it is promoted. Promoting also turns automatic assignment back on.
- **Don't roll the household API back past `00024-lir`.** An older revision can't serve the live page's Personal impact tab, and a dashboard deployment from before #69 has no working Personal impact tab at all (see "Live and rollback target" above).
- **Household API.** Run the "Deploy the household API" workflow (#28) with action `rollback` and the revision to restore (the deploy's log names the one it replaced). The rollback runs as its own Cloud Build pipeline, and only one deploy or rollback runs at a time, however it was started. The pipeline:
  - accepts only a ready revision whose own deploy build succeeded. That build must be of a commit on `main`, and must have pushed the exact image the revision runs (checked against Cloud Build's record, not only the revision's labels);
  - reruns `main`'s current smoke test on that revision before any traffic moves. The checker never comes from the revision's own image, which only reports its versions and coverage;
  - moves all traffic only if nothing else changed it in the meantime, and logs how to undo the rollback.

  The workflow then checks that all traffic is on that revision and that `/api/version` names its commit. If the revision to restore fails the smoke test (for example, a household route slower than 300 s), nothing moves. You then decide whether to use the fallback anyway.

  **One rare case:** a deploy pushes its image to the registry again after it promotes. If that final push fails, traffic has moved but the build ends FAILURE. The workflow reports the traffic it finds. That revision can't be a rollback target, because a rollback needs a successful deploy build.

  **Fallback only**, from a laptop with a working gcloud login: run the command the deploy's log printed ("Roll back with: …"). It restores the exact allocation the deploy replaced, but skips every check above, for example:

  ```sh
  gcloud run services update-traffic uk-budget-api-2026 \
    --project policyengine-apps --region europe-west1 \
    --to-revisions <revision>=100
  ```

  **After either path,** the workflow's `rollback` or this fallback, re-run the household check against the live route, and time one breakdown (see "Adopting a release").
- **A model release.** To go back to the previous bundle after an upgrade:
  1. **Revert the upgrade's merge** through a pull request, as for the dashboard (GitHub's Revert button or `git revert -m 1 <merge>`). That undoes the upgrade PR's whole net change: the lock, and anything it carried, such as regenerated artifacts, the manifest, and test or registry changes.
     - **If anything was staged or approved since the upgrade,** the revert conflicts on the manifest, and the Revert button can't resolve that. Revert locally and keep `main`'s publication files (`git checkout HEAD -- public/data data_inputs/public_data_review.csv`), so the revert undoes only the lock and code. Step 2 then marks the newer release's entries stale.
     - Check that nothing else merged since depends on what is reverted.
  2. **Regenerate on the revert branch, before merging, if anything was published after the upgrade.** With the previous release installed, regenerate every published measure and the combined run, stage the first with `--adopt-execution`, reconcile, approve, and write the review rows (as at G2), as for a re-cut. A revert that leaves any displayed entry certified on the newer release fails its own Publication gate.
     - **The area routing status and the constituency tables too, if the revert kept `main`'s publication files.** Those still hold the newer release's. With the previous release installed, regenerate the status (`uv run python -m uk_budget_data.area_routing --write`) and commit it; `tests/test_area_routing.py` fails until you do if the two releases route differently. If the previous release routes results by area, bring back its constituency tables with their review rows, as the adoption step does; if it doesn't, the page shows the label and no figures.
     - **The Living standards outlook, if the upgrade PR didn't carry it, `main` has changed it since, or the revert kept `main`'s publication files.** With the previous release installed, rerun `uv run uk-budget-data living-standards` on the revert branch and commit the file with its review row. Otherwise the outlook test fails on the version (see "Adopting a release"). Update the view's tests with it, as at adoption. #110, the prepared revert of #102 (6.10.2), needed both: #102 predates #69, so its revert left the outlook on 6.10.2.
     - **A clean revert needs no regeneration.** If nothing was published after the upgrade, the revert brings back the previous lock with its manifest, artifacts and approvals together, and `publish check` passes.
  3. **Merge, then roll the household API back:** the workflow's `rollback` to the last revision on the previous release, or `deploy` on the reverted `main`. **Deploy, don't roll back, when that revision predates the route the live page calls.** For example, `00020-pal` (6.10.0) and `00022-suw` (6.10.2) both predate #69's `/api/household-impact` (see "Live and rollback target" above). Merging doesn't redeploy it (see "Adopting a release (each re-cut)"). A rollback's smoke test takes the versions it expects from the target revision's own image, so a revision on the previous release passes it while `main` is still on the new one.
  4. **Run the household checks, and time one breakdown** (see "Adopting a release"). After a clean revert, the previous cut's approvals are already back, with its manifest.

## Clock

| Event | Time | SHA | Manifest revision | Notes |
|---|---|---|---|---|
| Final cut adopted (by 06:00) | | | | Regeneration time; API revision; rollback target |
| Go/no-go (07:00) | | | | Final cut or previous; the change's attribution (d1682) |
| G0 | | | | |
| G1 | | | | |
| G2 published | | | | |
| Documents | | | | |
| G3 approved | | | | |
| G4 published | | | | |
| First cut (proposed 15:45) | | | | Sent to ITV by; in the webinar slides |
| G5 corrections | | | | |
| Briefing exported | | | | |
