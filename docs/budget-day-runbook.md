# Budget-day runbook (draft)

**Status: draft for Vahid and María, who own this document and the workflow it describes.** It follows the drill 3 structure (G0 to G5). Commands marked with a PR number exist once that PR merges. Times are the drill's, to be replaced by the real release times. The design behind it is in [`budget-day-publication.md`](budget-day-publication.md).

Wednesday 28 October 2026. Briefing by 07:00 on Thursday 29 October.

> **Sign-off is off from Budget day evening (28 October 2026).** `REQUIRED = False` in [`src/uk_budget_data/sign_off.py`](../src/uk_budget_data/sign_off.py) turns off every human sign-off this runbook describes: a pull request merges once `main`'s required checks pass, with no signing step. No public file needs a row in `data_inputs/public_data_review.csv`, no hand-written modifier is held for a two-person attestation (`scripts/draft_attestation.py` is not needed), and no step waits for a second signer or for the Reconciler's rows. Where a step below says to attest, sign or write review rows, skip it. Writing review rows is optional, but `publish review-rows` still does the clearing up: the public-file checks refuse any file under `public/data/artifacts/` that no listed entry names, and the command deletes those. Every automated check still blocks: record-level identifiers, the floor of survey households and its withheld cells, `validate_public`, the area-code guard, file digests, certification, responsiveness, completeness, reconciliation and combined-run membership. A changed boundary file still needs its `reference_geography` row, which is the area-code guard's record. The README's "Review and sign-off" says how to turn sign-off back on.

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | Every commit, generation, `publish stage`, the pull request that deploys | Approve their own reconciliation exceptions |
| **Reconciler, then scorer** (María) | Coverage ledger, Treasury entry, reconciliation, exception review, `publish approve`, household fixtures | Push measure code |
| **Deploy and rollback** (Vahid, W5 on standby) | The merge that publishes; Vercel and Cloud Run rollback (the Cloud Run deploy and rollback through the GitHub Actions workflow, #28) | Deploy from a laptop except as a fallback |
| **Briefing** (to be agreed) | Export from an approved manifest revision; the article | Use any number not in the manifest |
| **Media first cut** (to be agreed) | Sends ITV the first-cut figures and puts them in the webinar slides (see "First cut" below) | Send any figure that is not approved in that manifest revision |

## Before the day: the deployed-route rehearsal, by Friday 23 October

- [ ] **Production route live.** The dashboard serves at `https://policyengine.org/uk/budgets/autumn-2026` (policyengine-app-v2#1249, still a draft) from the production Vercel project, which tracks `main`.
  - Project: `uk-autumn-budget-2026`, team `policy-engine`, ID `prj_SelxVbakBqqSLdsoS74Qw36wp2E8` (created 12 October).
  - Domain: `uk-autumn-budget-2026.vercel.app`.
  - Last production deployment ID, the rollback target: record before every merge on the day.
- [ ] **Household API live.**
  - URL, **the household URL for the day**: `https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` (Cloud Run `uk-budget-api-2026`, project `policyengine-apps`, `europe-west1`).
  - Serving revision and image: record after the last deploy before the day. On 25 October it is `uk-budget-api-2026-00026-xol` (git `65280bd`, the merge of #125; policyengine 6.10.2, policyengine-uk 2.132.6, core 3.33.3; image `sha256:3309d448…`), promoted at 11:24Z on 25 October (run 40188251705). Before it, `00024-lir` (git `5fd6925`, the merge of #69) served from 23:27Z on 24 October. Each re-cut redeploys it (see "Rolling re-cuts" below).
  - **How long one household answer takes.** Since #69 the Personal impact tab calls `/api/household-impact`: one household, one year, the selected measures. It asks in two stages: the headline first (`include: []`), then each measure's own effect and the earnings sweep (`by_policy`, `sweep`). It waits 90 s for the first and 200 s for the second (`householdImpactApi.js`), and the server gives up at 280 s with a 504 (`HOUSEHOLD_CALCULATION_TIMEOUT`). On `00024-lir`, for a household new to the revision, a headline took 16.7 to 17.3 s and a breakdown 81.0 to 83.9 s.
    - **What the gates cover.** The deploy's smoke test asks `/api/household-impact` for one headline of one measure (`SMOKE_HOUSEHOLD_IMPACT` in `deploy_smoke.py`: `threshold_freeze_2031_32`, 2028, `include: []`). From #125 the same request names every registered measure's definition at the deployed commit, and the candidate must serve exactly what its image computes. The smoke test also makes one full `/api/personal-impact` request for the £30,000 earner (six years, now nine measures), a route the page no longer calls. The same request took 96.1 s on `00024-lir` in the timings below. The household check posts only to each fixture's `route`, and the plumbing fixture's is `/api/personal-impact`.
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
  | `public/data/budgetary_impact.csv`, `distributional_impact.csv`, `winners_losers.csv`, `metrics.csv` | **24 October (branch `ab2026-candidates`):** regenerated on the ten candidate 2026 measures (`reforms.py`), replacing last year's nine; the salary sacrifice cap candidate was dropped later that day (nine measures), and the combined package regenerated without it. `obr_comparison.csv` was regenerated on 25 October on the same nine measures and combined run, with empty OBR columns. The page never binds it (it is not among the flat files a view may read), so the comparison says it is not available, and stays so after the OBR publishes until it has a verified route | No: the page reads approved artifacts only | Removed on 29 October (#339), with `age_impact.csv`, `income_curve.csv` and `household_scatter_binned.csv`: all eight still held the candidate run |
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
    | 25 October, `65280bd` | 40188251705 | `00026-xol`, replacing `00024-lir` | #125: `/api/household-impact` reports each measure's definition at its approved commit. The same policyengine, policyengine-uk and core as `00024-lir` |

  - **Live and rollback target, 25 October:** `00026-xol` is live, promoted at 11:24Z, and its rollback target is `00024-lir`, which reports no definitions. The revision before that, `00022-suw`, passed the smoke test when it was deployed, but **it can't serve the page that is live now.**
    - **Why:** since #69 the Personal impact tab calls `/api/household-impact`, which no revision before `00024-lir` has (`household_impact.py` doesn't exist at `1acbd44`). Rolling the API back to `00022-suw` or earlier keeps the rest of the page, but the tab fails for every household.
    - **The rollback pipeline doesn't catch it.** Its smoke test checks `/api/household-impact` only on an image that has the route (`expected_household_impact` in `deploy_smoke.py`), so a rollback to `00022-suw` passes and moves traffic.
    - **Rolling the dashboard back to before #69 doesn't help either.** Its Personal impact tab, the lifetime calculator, never calculated in production: it throws before any request when `NEXT_PUBLIC_LIFECYCLE_API_URL` is unset (`LifecycleCalculator.jsx` at `1329312`). None of the 70 production builds before #69 (12 to 24 October) had that variable. The production project's only variable is `NEXT_PUBLIC_HOUSEHOLD_API_URL` (production and preview), added at 23:19:54Z on 24 October, just before #69 merged.
    - **So never roll the API back past `00024-lir`,** the first revision with the route. Through an API fault, roll back to it or fix forward.
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
  - **Capacity for Budget week (#141, decided 25 October; recorded on #119).** `cloudbuild.yaml` deploys with `--cpu 8 --memory 8Gi --min-instances 1 --cpu-boost` and `HOUSEHOLD_WORKERS=8`.
    - **Why:** a full answer runs 11 simulations (9 measures alone, then the sweep's two sides). On 2 workers that took about 6 rounds of about 12 s, so the split by policy took about 85 s. On 8 it is estimated at about 35 s; this is to be measured after the deploy.
    - **Memory:** each worker peaks near 0.4 GB, so 8 workers and the parent fit in 8 GiB. The 2 GiB revisions peaked at about 1.35 GiB.
    - **Cost:** `--min-instances 1` keeps one 8 vCPU instance always on. After Budget week, set it back to `--min-instances 0` (and optionally `--cpu 2 --memory 2Gi`, `HOUSEHOLD_WORKERS=2`) in `cloudbuild.yaml` through a PR, then run the deploy workflow.
    - **Rollback:** the rollback workflow moves traffic to an earlier revision, which keeps that revision's own CPU and memory (2 vCPU, 2 GiB). A rollback is therefore also a capacity rollback, and is safe.
  - **Fewer runs: measures that cannot move the household are skipped (#147).** `household_impact.provably_unaffected` leaves a measure out of the split by policy when it is exactly £0 for this household and year: the employer NI relief always (an employer cost), the Warm Home Discount top-up outside 2026-27, the threshold freeze before 2031-32, Plan 2 without a Plan 2 borrower, the State Pension protection with no one at State Pension age, BADR (the answers carry no capital gains), the fuel measures with no fuel spending (the road fuel VAT cut also from 2028-29), and electricity VAT with no electricity spending or from 2028-29. The default household's split falls from 9 runs to 3 in 2027-28. Each rule was checked against the full run (40 generated households x every policy year, identical; `tests/test_household_impact.py` keeps a slow version). A new measure has no rule until one is added and checked.
  - **Optional: the slow parts on Modal (#147, live on production).** `src/uk_budget_data/modal_household.py` serves the same API on Modal, each simulation in its own one-core container, all at once. Measured on 25 October (default household, all nine measures, 2027-28, end to end over HTTPS): warm, headline 7-10 s, sweep 8-9 s, split by policy 10-14 s; cold (first request after idle) about 45 s, then warm. The page uses it when the build sets `NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL`. The sweep and the split go there, and are asked of Cloud Run instead when Modal fails, refuses the request, or answers from another build than the headline's. That is: other policyengine, policyengine-core or policyengine-uk versions; another build commit, or none (`git_sha`, which every answer carries); or a net income for the household more than a penny from the headline's. Net income alone can't show the build is the same: two builds can agree on one household's net income and differ elsewhere on its sweep, so a Modal answer is used only when it and the headline report the same commit. If Cloud Run's answer doesn't match the headline either (its packages, its net income, or a commit other than one the headline or the other part has already reported), the whole result is refused. A malformed commit matches nothing. `uk_budget_data` is not compared: the Modal image doesn't install the project, so it reports no version for it.
    - **Deploy Modal from the commit Cloud Run serves.** Cloud Run's commit comes from the deploy (`_GIT_SHA`, checked against the uploaded source). Modal's is the HEAD of the checkout `modal deploy` runs in, and only when every file the image copies (`src/uk_budget_data` less its `__pycache__` folders, `data_inputs`, `pyproject.toml`, `uv.lock`, `.python-version`) has exactly HEAD's bytes and nothing else is copied (`runtime_identity.checkout_commit`). It compares the files with HEAD's tree, not with git's status, so a file git has been told not to check (`assume-unchanged`, `skip-worktree`) still counts, and so does any symbolic link. It reads HEAD's commit once and lists that commit's own tree, ignoring replacement objects (`git replace`), so the commit it reports is the one whose files it compared. It counts only a checkout that is git's work tree itself: run the deploy from the checkout's top folder, not from a folder inside a larger work tree, and not with `GIT_DIR` or `GIT_WORK_TREE` naming another one. It reads the files once, before the upload, so don't edit the checkout while the deploy runs. Otherwise the deploy prints "No build commit" and the files that differ, reports none, and every breakdown goes to Cloud Run. So run the deploy from a clean checkout of the commit Cloud Run serves, and redeploy Modal whenever Cloud Run is redeployed. A Modal deploy older than this change reports no commit, so the page doesn't use it until it is redeployed.
    - **Before setting the variable,** check that `GET /api/version` reports the same `git_sha` and the same three package versions on both services.
    - **Where it stands (read 26 October, 00:00Z):** the production build already sets `NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL` to the Modal app (`https://policyengine--uk-budget-household-web.us-east.modal.run/api/household-impact`, in the live bundle). `/api/version` reports commit `9305d80` on Modal and `f3304ff` on Cloud Run, with the same three package versions. Neither deploy's answers carry a commit yet, so once this page is live it asks Cloud Run for every breakdown, until Cloud Run and then Modal are deployed from one commit that has this change.
    - **The page doesn't wait for a detail answer it can't use.** Under a headline with no commit it asks Cloud Run for the breakdown at once, without asking Modal. Once Modal answers from another build than the headline's (another commit, none, other package versions or another net income), the rest of the session asks Cloud Run alone (`useHouseholdImpact.js`). Before this, each breakdown waited for Modal's answer, then asked Cloud Run anyway. Measured around midnight UTC on 26-27 October, one household for 2027-28, all seven measures: 48-83 s to the complete answer, against 27-31 s from Cloud Run alone.
    - **A cold service: the page says so and asks again.** When an answer is empty, a 429, 502, 503 or 504, a timeout or no connection (`isStartingUp` in `householdImpactApi.js`), the page shows "The calculator is starting up. This can take up to a minute." and asks the same URL again: after 5 s, or the service's Retry-After up to 20 s, at most 3 times, within 150 s of the first attempt (`RETRY_POLICY`). A detail part that fails on Modal goes to Cloud Run at once, as before, and Cloud Run is the one asked again; the page stops waiting for Modal after 100 s (`MODAL_TIMEOUT_MS`), before Modal's 150 s web limit turns the request into an empty answer. A retried answer passes the same checks as a first one (the receipts' package versions, the headline's commit), so it never shows another model version's figures. If it still has no answer, the reader sees "The calculator is still starting up" with Try again.
    - **No survey data:** the household route builds one synthetic household, so no dataset and no Hugging Face token go to Modal.
    - **Cost rules:** one core and 1 GiB per container (`Household` and `Web` alike), at most 40 `Household` containers until 17 November, 300 s timeout. The deploy itself keeps none warm (`HOUSEHOLD_MODAL_MIN_CONTAINERS`, default 0). Then `warm_schedule` runs every 10 minutes and sets the warm `Household` workers and `Web` containers from the table `household_warm.WARM_WINDOWS`, in UK time (Europe/London; UK time is UTC throughout, the clocks went back on 25 October):

      | Days | Hours (UK) | Household workers | Web |
      |---|---|---|---|
      | Wed 28 Oct (Budget day) to Fri 30 Oct | 07:00-24:00 | 12 | 1 |
      | Their nights, to 07:00 on Thu 29, Fri 30 and Sat 31 Oct | 00:00-07:00 | 2 | 1 |
      | Sat 31 Oct to Mon 2 Nov | 07:00-23:00 | 6 | 1 |
      | Their nights, to 07:00 on Sun 1, Mon 2 and Tue 3 Nov | 23:00-07:00 | 1 | 1 |
      | Tue 3 Nov to Tue 17 Nov | 07:00-23:00 | 2 | 1 |
      | Any other time before 18 Nov 00:00 (tonight, 27 Oct, from 20:00; the nights from 23:00 on 3 Nov) | | 0 | 1 |
      | From Wed 18 Nov 00:00 (`WARM_UNTIL`, the hard stop) | | 0 | 0 |

      A night belongs to the day it starts on. With 0 workers warm, the `Web` container is warm but each run's worker starts cold, so the first request can take longer than 100 s and be answered 503: the page's 503 retry (#265) must be live before prod Modal runs this schedule. The cron changes the targets up to 10 minutes after each boundary.

      **The schedule is the deployed code's, not `main`'s.** Read on 27 October at 17:30 UK, the production app's `warm_schedule` log said `Household min_containers=2, web=0`: it still runs the schedule deployed on 25 October (Wednesday 12:00-22:00 only), not the widened one. This schedule reaches production only with a Modal redeploy (from the commit Cloud Run serves). A one-off `update_autoscaler` from a laptop does not hold: the deployed cron sets it back within 10 minutes.
    - **A slow request is answered 503, not left empty.** Modal ends a web request that has not answered in 150 s with a redirect that a cross-origin page cannot follow, so the page got an empty answer (27 October, cold test app, about 150 s). The `Web` endpoint now answers a household request it has not answered in 100 s (`household_deadline.DEADLINE_SECONDS`) with a 503, `Retry-After: 10` and `retry_after_seconds` in the body; the calculation runs on, and a retry that reaches the same `Web` container is answered from its runs. The page itself does not ask Modal again: a detail part that gets a 503 or times out on Modal goes to Cloud Run at once (`postHouseholdDetail` in `householdImpactApi.js`), as above, and the Modal runs carry on uncollected.

      Vahid approved this schedule on 27 October (replacing the 25 October one, about $35-40). Each warm container costs about $0.0553 an hour ($0.0473 per core-hour + $0.008 per GiB-hour, one core and 1 GiB), so 12 + 1 warm cost about $0.72 an hour. From tonight to 18 November it keeps about 1,950 container-hours warm (1,446 worker, 508 Web), about $108 in all; that is the whole warm bill (the test app scales to zero). Requests above the warm floor add their own run time, and the cron itself costs pennies. Deploy: `uv run --with modal modal deploy src/uk_budget_data/modal_household.py`; stop: `uv run --with modal modal app stop uk-budget-household`, then check `modal app list` shows no tasks.
      **After every `modal deploy` on Budget week, apply the schedule by hand.** A deploy resets the autoscaler to the decorators' values (Modal's `update_autoscaler`: "Subsequent deployments of the App containing this Function will reset the autoscaler back to its static configuration"), which are 0 (`MIN_CONTAINERS`), so nothing is warm until the next 10-minute cron tick. Straight after the deploy, run `uv run --with modal==1.6.2 python -c "import modal; modal.Function.from_name('uk-budget-household', 'warm_schedule').remote()"`, then send one household request so the new version takes its memory snapshots (about 2 minutes). This sets the same target the cron sets, so it holds (the "does not hold" above is for a different value).

      **A bad Modal deploy on the day.** Redeploy Modal from a clean checkout of the commit Cloud Run serves (`GET /api/version` on Cloud Run gives it), then apply the schedule as above. To switch Modal off instead: `uv run --with modal modal app stop uk-budget-household` and check `modal app list`; the page then asks Cloud Run for everything (it already does whenever Modal fails or reports another build), so watch Cloud Run latency. Do not `modal app rollback` to an earlier version: its commit does not match Cloud Run's, so the page refuses its answers anyway.
- [ ] **Rehearsal.** Intake, dashboard and briefing on the deployed routes, including one model upgrade and regeneration. Record the receipt here. Repeat after any material change.
  - **Time the regeneration** (regenerate, stage, reconcile: the fifth row of the table under "How long one adoption takes" below), as that section says, and post the time to the coordinator on GitHub. The coordinator sets the final cut's times from it.

## How a measure must be written

Every published measure is receipted, and the receipt can only bind a measure written in one of these forms:

- **`parameter_changes`**, wherever the measure can be expressed that way.
- **A module-level function** as `simulation_modifier`, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. The tested templates (#23) are helpers to call from such a function.
- **In a module of fixed shape**: only imports, literal constants and undecorated functions, each name bound once. Not in `reforms.py`, whose run-time caches make every modifier in it unbindable (question 6 in `budget-day-publication.md`). `tests/template_measures.py` is the pattern.
- **Each modifier has a module of its own, named after it, in `src/uk_budget_data/budget_measures/`.** The receipt binds a modifier's whole module (its source, and the default arguments of every function in it), so adding a function to a module, or editing one, changes the definition of every modifier there: each must be regenerated, and attested again where it needs attestation (see G5, steps 1 and 4). So a new modifier goes in a new module, `budget_measures/<its name>.py`, holding that one function, with any constant it uses written in that module; `reforms.py` imports it as `from uk_budget_data.budget_measures.<its name> import <its name>`. A helper two modifiers share goes outside the package, as the templates in `measure_templates.py` do: a change there reaches every measure whose modifier calls it, and no definition shows it (G5, step 1, "Code national generation also runs"). `tests/test_budget_measures.py` fails on a module holding more than one function or one not named after it, on a registered modifier from anywhere else (in the package or outside it; only the combined measure's composition of its members' is exempt), on a road fuel VAT rate that differs between the two modules writing it or a missing fuel module, and on a module the receipt can't bind; a new module, or a fix to one that keeps those, passes it. `tests/test_budget_measures_split.py` checks the split itself, each module only while its source is the one the split wrote: a later fix skips that module's comparison, saying so. (Until 25 October all seven were in one `budget_measures.py`, and any edit there changed all seven definitions.)

**Its name and description may name only the taxes it moves.** Both are public: the personal impact API returns them. Every registered measure must be declared in `DECLARED` in `tests/test_measure_descriptions.py` with the taxes whose rules its code changes, and the required Python tests fail until it is. They also fail on copy that names a tax the measure doesn't declare, or one the module doesn't know (add it to `TAX_NAMES`, and its parameters to `TAX_PARAMETERS`), on an unnamed "tax", "taxed" or "taxable" in a measure that doesn't move income tax, on an unnamed "duty" in one that moves no duty, and on an unnamed "levy" in one that moves no levy. Second-round and modelling effects don't count: a measure declares the taxes whose rules its code changes, not every tax the model moves.

**Every scored year must be written for an uprated amount** (policyengine-uk #2430). On either side of a measure, give an explicit value for every scored year from the first changed year onwards. State Pension, benefit rates and the LEL otherwise return to the old projected path after a bounded change; the personal allowance and threshold freeze are unaffected. Generation keeps the other measures and refuses a gap with `REFUSED <id>: <path> has no value for <years>; after a bounded change an uprated amount returns to the old path (policyengine-uk #2430). Write every scored year.` The flat pipeline warns instead.

**The engine's wealth-tax scales are refused** (UK hub, `budget-triage/JUDGED.md` S4). For an announcement on net assets, one taxes a gross base and the other a net base not yet checked against the data:
- `wealth_tax` applies `gov.contrib.ubi_center.wealth_tax` to `net_wealth` from policyengine-uk 2.151.0: `total_wealth` less `mortgage_debt`, `consumer_debt` and student loan balances. Before it, the scale applied to `total_wealth`: gross wealth, including private pensions, with no debts netted (S4). Both debts are inputs, nil unless the data set them. Microcosm's UK build lists them among its exports, but no check here shows that the certified a6299504 data carry them, so the scale stays refused until one does. Lifting the refusal is then a decision for the dashboard's owners, not part of an adoption.
- `non_primary_residence_wealth_tax` applies `gov.contrib.cec.non_primary_residence_wealth_tax` to `total_wealth` less `main_residence_value`: gross wealth, less the main home's full value rather than its equity. S4 names only the first; this one was read in policyengine-uk 2.132.6 and is unchanged at 2.151.0.

Both count in `household_tax` and `gov_tax`.
- **The templates refuse any path under either scale.**
- **Generation refuses a measure that changes either scale,** before any figure is made, with `REFUSED <id>: <path> is under <scale>, …`. The other measures are still written. It looks in two places:
  - the measure's `parameter_changes`, on either side and in the configured baseline, before any simulation is built;
  - its two built simulations, compared with each other as the model limits compare theirs. This catches a hand-written modifier that edits a scale's brackets or rebinds it, with no `parameter_changes`, on one side or differently on the two sides. The same edit made on both sides leaves the two simulations agreeing, so it isn't caught; written as `parameter_changes`, it is.
- **The flat pipeline warns instead.**
- **Registering such a measure fails CI** (`tests/test_wealth_tax_template.py`).
- **A hand-written modifier that taxes a base it reads directly from `non_primary_residence_wealth_tax` or `total_wealth`** is held not computable by hand, for the same reason. Nothing in the code catches one, since the scales are unchanged.
- **A modifier that taxes `net_wealth`, or reads `wealth_tax`** (on 2.151.0, the scale on `net_wealth`), is on the net base, but only as far as the data carry the two debts. Check that they do before it is approved, and give it a scale of its own: generation refuses a change to either engine scale, even from a modifier, and the refusal then names the scale's base. Review it like any other hand-written modifier.

**An HVCTS band uses the engine's own index.** `apply_property_band_surcharge` reads the native formula's compiled index names and uses the same index, as the engine does: it deflates property values by OBR GDP per capita, or projects the band's bounds by the OBR house-price index. It refuses a formula reading neither or both, so a new band cannot overlap the native bands because it uses a different index.

**A measure on pension tax relief, the annual allowance, its taper or the MPAA is expected to fail the Treasury reconciliation. By default it is held for the 07:00 briefing pending review** (Vahid and María to confirm).
- **Why:** the UK hub's rebuild of policyengine-uk #2240 replays the Spring Budget 2023 pension changes at about −£12.9bn over four years against the OBR's −£1.55bn, roughly 8 times over. The remaining causes are mostly data: the imputation of pension inputs, defined-benefit accrual, the taper's income measure and carry-forward. A pensions decomposition is queued; revisit this row when it reports.
- **The limitation sentence** (final; from the UK hub, 16 Oct, for the dashboard methodology and wherever such a measure is listed):

  > "The model overstates the pension annual allowance charge: for 2024-25 it finds 262,000 people with pension savings above their allowance, against 30,440 in HMRC's provisional self-assessment statistics for the same year, and £2.7 billion of annual allowance charge against HMRC's provisional estimate of £0.3 billion, so pension tax relief and annual allowance measures are not published on Budget day without review."

  - **Sources, all tax year 2024-25:** HMRC private pension statistics (July 2026), Table 7, row "2024 to 2025 [provisional]": 30,440 individuals reporting contributions above their allowance through self assessment. Table 6, column "2024 to 2025 tax year [provisional]": £300m of annual allowance charges. The model's 262,304 people and £2.699bn are model year 2024 (tax year 2024-25), from uk-data 1.58.1 with policyengine-uk #2240's charge formulas: counts and aggregates only.
  - **Cause:** the UK hub's research report attributes it mostly to the imputation of employer pension contributions, tracked as uk-data#606, which lands after the Budget.
- **What the gate does:** approval needs the reconciliation to pass or carry an accepted exception, and the briefing exports take approved entries only. So such a measure stays out of the briefing unless someone approves an exception. The default is to hold it, not to approve a named-reviewer exception on the day.
- **On the a133 cut and later, such a measure is not computable instead** (#124): it changes a parameter under `gov.hmrc.income_tax.allowances.annual_allowance`, whose limits hold it (see "From the a133 cut, 13 more data limits" below). So it's never shown, even as provisional, and needs no exception. At policyengine-uk 2.147.2 the annual allowance charge (`private_pension_contributions_tax`) also feeds no total, so a change to it would move no figure.
- **Still open, for Vahid and María:**
  - whether it is shown on the page meanwhile: staging it as provisional does not need the reconciliation, and the page labels it provisional;
  - who may approve an exception for it, if anyone;
  - where the limitation sentence appears on the page (the methodology section, the measure's own entry, or both).

**A measure on the SDLT higher rates, or on non-residential purchases, was published as not computable on current data, never as a figure** (#51), **until the a6299504 cut lifted both limits** (6.11.1's adoption, PR 238).
- **Lifted.** The a6299504 cut's certified data set `additional_residential_property_purchased` and `non_residential_property_purchased` in every year (the Certified data runs on PR 237 and PR 238). So the two limits are out of `DATA_LIMITS`, and a measure on these rates publishes with a figure like any other. Carry the two disclosures under "When it lifts" with any such figure: where they sit, and their figures re-measured on the adopted build, are Vahid and María's call. The rest of this section describes the mechanism, which still holds every other data limit; its tests keep the two purchase limits as stand-ins (`tests/data_limit_stand_ins.py`).
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
- **When it lifts:** once certified data impute the purchases. `tests/test_data_limits.py`'s certified-data tripwire then fails, and the limit is removed in that bundle's adoption PR. That was the a6299504 cut (6.11.1). The tripwire now names every lifted input in one run.
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
  - (Until #124, a household situation that set a limited input was another: the model's own build read it in `build_from_situation`, so every measure on that household recorded `build:<input>`. Since #124 the build watch leaves out the reads policyengine-uk makes while its own constructor builds a simulation, unless a measure's code lies between the read and the constructor: a modifier the constructor calls, or a formula one replaced. It had to: from policyengine-uk 2.147.2 the constructor runs the Universal Credit rebalancing on every simulation, certified ones included, and that reads three of the inputs the a133 cut leaves at their defaults, so every measure would have been held.)
  - (The source forms listed here until #51's round 13 are no longer false positives, since reads are now watched as the run calculates: lambdas and callable wrappers, results in containers, annotation-only statements, unreadable state, and names built at run time.)
  - **To clear one:** there is no override. Rewrite the measure in a form whose reads the watch sees: a template, or a call to the original used for its result. Make sure nothing calculates the changed variable before the run, and don't write a limited input's name in code that runs. Then regenerate, and record the reason in the measure's PR.

**From the a133 cut, 13 more data limits** (#124). policyengine.py#715's budget-inputs gate found 13 model inputs that the a133 cut (policyengine-uk 2.147.2) leaves at their defaults, and accepted them on condition that the dashboard holds any measure depending on one. Each is a data limit in `uk_budget_data.data_limits`, so a measure that changes a parameter under its prefixes, whose changed code reads the input, or whose modifier reads it while its simulation is built, is published as not computable on current data, exactly as the SDLT limits above. A parameter under several limits' prefixes (the annual allowance, Universal Credit capital, the capital sources lists) records each of them, and the receipt check accepts that. Each limit's reason states the default the model uses. They hold:
- **PIP:** the daily living and mobility points thresholds (`gov.dwp.pip.*.points_thresholds`). The data store PIP categories, not points, so a thresholds change would move no one and cost £0. A measure that changes the recorded categories is held too, as a precaution: in a year with no recorded category the model carries an earlier one forward unless newer points replace it, so the category's formula reads the points. The model's copy of the certified data records a category in every Budget year.
- **Bus fares:** `gov.dft.bus.fares`, `reference_fares`, `uncapped_single_fares` and `default_single_fare_share` (the single-fare cap acts through them; with no passenger's fares supplied, the model prices it from its own table of uncapped single fares in three bands, and the share of boardings bought as single tickets only scales that).
- **The annual allowance:** `gov.hmrc.income_tax.allowances.annual_allowance` (three inputs: pre-2015 salary sacrifice, taxable lump-sum death benefits and the defined-benefit share), and the defined-benefit input per contribution. See also the pension paragraph above.
- **Universal Credit's capital rules:** `gov.dwp.universal_credit.means_test.capital` (the two secured-debt inputs: nil by default, so such property counts at its market value less sale costs).
- **The means tests' lists of capital they count:** the six `...capital.sources` lists, for directly held shares and unit and investment trusts. Share-like capital counts corporate wealth whole unless holdings are itemised, so only a measure that counts some holdings and not others depends on them.
- **Childcare:** `gov.dfe.universal_childcare_entitlement`, `extended_childcare_entitlement`, `childcare_funding_rate`, `weeks_per_year` and `compulsory_school_age`, and `gov.scottish_government.funded_early_learning_childcare` (a deferred school start; the default is none).
- **Director NI:** the 2022-23 full-year category A director schedule.
- **Salary sacrifice returned to income** acts through no parameter. It holds a measure whose changed code reads it, that sets it or changes the stored employment income or employee pension contributions the model adds it to, or whose modifier reads it while its simulation is built. The salary sacrifice cap acts through NICs earnings, which don't read it, so a cap measure is not held by it.

**From the a6299504 cut, 16 more, and four of a133's lifted** (#124). policyengine.py#720's budget-inputs gate lists 25 inputs that the a6299504 cut (policyengine-uk 2.151.0) leaves at their defaults, against the 19 October cut: nine of a133's again and 16 new, accepted on the same condition. Its data carry a133's other four (the two secured debts and the two share holdings), so their limits are gone and `NO_LONGER_MISSING` says why: on this cut Universal Credit's capital rules and the capital sources lists are computable again. a133's record stays (the Budget coordinator's ruling, while a133 is the fallback): the chain from a6299504 doesn't pass through it, but every recorded cut's inputs still need a limit or a `NO_LONGER_MISSING` entry. The 16 hold:
- **Gambling duties:** every rate of general betting duty (fixed-odds, remote, financial spread, other spread and exchange commission), machine games duty's three rates, remote gaming, bingo, pool betting and lottery duty (bingo duty is abolished from 1 April 2026, so a measure reinstating it is held too), and gaming duty's bands with the model's casino effective rate (`household.consumption.gambling.casino_effective_rate`, the only parameter `gaming_duty` reads). The 15 bases are attributed to households and nil by default, so every gambling duty, and `gambling_duty` in household and government tax, is nil for every household: a change to any of them would score £0. Neither the catalogue nor #207's candidates has a gambling measure today; one in the Budget is published as not computable on this cut.
- **Housing Benefit's working-age residential capital exception:** `gov.dwp.housing_benefit.means_test.capital.working_age.residential_threshold` and `...working_age.tariff_income`. No claimant is treated as qualifying, so a change to the residential threshold moves no one, and a change to the ordinary threshold, step or amount can't be costed for qualifying residents. The upper capital limit and pension age's tariff income don't turn on it, so they aren't held.

Each later cut is checked the same way against its own list, which the UK hub posts on #124 (see "Adopting a release"). A G3 release of one of these measures, naming the person and the default, has no path through the gate yet: a not-computable entry carries no figures.

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

**State Pension measures are no longer held: policyengine-uk #2336 is in the adopted pair** (6.11.1, policyengine-uk 2.151.0; PR 238 removed `state_pension_add_on_uprating`). Until then the model-limit guard held any measure that moved either full rate, the triple lock or September CPI at provisional. The model raised additional pensions (SERPS and S2P) and new State Pension protected payments with the full rates, though each April's Up-rating Order raises them by September CPI (Social Security Administration Act 1992 ss. 150 and 151A; SI 2026/148, articles 4(3)(a) and 6(3)(b)). On 2.151.0, `additional_state_pension` is uprated from the data year by the September CPI index, and a change to the full rates leaves it alone.
- **A full-rate measure's figure now leaves the add-on out,** as the law does. W3's report on #2336 (uk-data 1.58.1, not re-measured on Microcosm) put a 10% rise's net cost £0.85bn to £1.06bn a year lower with the fix over the dashboard's years.
- **A measure that also raises the add-on itself, above prices,** needs a change to `additional_state_pension`. A rate change doesn't reach it, and no template covers it, so it is a hand-written modifier, which needs the named human data-limits check above.
- **The CI cross-check:** `tests/test_expired_model_limits.py` reads the installed model's behaviour: raising either full rate leaves a pensioner's add-on unchanged, for a new and a basic State Pension recipient. A pair without #2336, such as an adoption whose lock alone is reverted, fails there. A rollback reverts the adoption's merge (see "Rollback"), which restores the limit with the lock.
- **The guard's tests** were written around this limit. They run on stand-ins of the three expired limits (`tests/model_limit_stand_ins.py`), whose fix is a marker a test installs, so they still test a model with and without a fix.

**2027-28 benefit measures are no longer held: #2533's fix is in the adopted pair** (policyengine-uk #2557, in 2.151.0; PR 238 removed `benefit_uprating_september_cpi`). Until then the guard held changes from 2027 to parameters on the benefit uprating index, the UC protected health element, the September CPI index and the triple lock. The index followed lagged calendar-year CPI (2.3% in April 2027), and the September 2026 statutory input was still a forecast. On 2.151.0 that input holds the published outturn, 3.5% (ONS D7G7, 21 October), and the benefit uprating index follows the September CPI index, so CPI-linked benefits rise by 3.5% in April 2027.
- **The CI cross-check:** `tests/test_expired_model_limits.py` checks that the April 2027 rise of Attendance Allowance, PIP and Child Benefit equals the published September 2026 input.
- **The Pension Credit minimum guarantee is still held** (next section): #2557 keeps it on lagged CPI.

**A measure on the Pension Credit minimum guarantee, the pension-age Housing Benefit allowances or the savings credit threshold, from 2027, needs the UK hub's earnings fix for the guarantee in the adopted pair.** Until then, the model-limit guard holds it at provisional, not approved (`pc_minimum_guarantee_uprating`; coordinator, 22 October).
- **Why:** the Social Security Administration Act 1992, s. 150A(2), requires the standard minimum guarantee to rise at least with earnings: 3.9% for April 2027, the May to July 2026 figure. The model raises it by lagged CPI, 2.3%.
  - #2557, #2533's fix, deliberately keeps the guarantee on lagged CPI.
  - The fix is the UK hub's separate earnings build, stacked on #2557. It also covers the pension-age Housing Benefit allowances and the savings credit threshold. policyengine-uk 2.151.0 doesn't have it.
- **Which measures:** changes from 2027 onwards, on either side, to:
  - the standard minimum guarantee, single or couple;
  - the savings credit threshold;
  - the pension-age Housing Benefit allowances: all six on policyengine-uk 2.151.0, `aged` and `aged_from_cutoff` for single people, couples and lone parents (2.132.6 had the three `aged` ones). A test fails if a release adds more until they are listed;
  - the May to July earnings input, `statutory_uprating_inputs.awe_total_pay_may_july`, by any route that moves it, such as an earnings growth path. Without the fix the guarantee ignores earnings, so such a change misses it.

- **What the guard does:** generation records `pc_minimum_guarantee_uprating` and its reason in the receipt. The measure can be staged provisional, approval is refused, and the browser refuses an approved receipt carrying the limit. The templates warn (`ModelLimitedWarning`), and the flat pipeline prints "MIS-COSTED BY THIS MODEL". Such a measure stays out of the first cut and the briefing, and a combined run including one is provisional at most.
- **When it lifts:** when, in the model as built, the uprating rule for both rates of the guarantee names an index other than the benefit index (`gov.benefit_uprating_cpi`), and that index's April 2026 to April 2027 step reaches the published May to July 2026 earnings growth.
  - The check reads the tree as the model built it, so neither a parameter change nor a template can satisfy it, and 2027-28 rates typed in over a CPI rule don't count. #2557 alone doesn't lift it. A hand-written modifier can change that tree: treat one that repoints the guarantee's uprating rule there, or rebuilds the parameters on both sides, as a change to the model, not a measure.
  - **If the UK hub's build raises the guarantee some other way,** such as with a formula or typed-in rates, `test_the_fix_check_agrees_with_the_guarantee_pensioners_get` fails in the adoption PR, and a person decides there whether the limit goes.
  - **Otherwise** the guard's tripwire test fails in the adoption PR, which removes the limit.

**VAT measures are no longer held: policyengine-uk #2187 is in the adopted pair** (2.151.0; PR 238 removed `vat_consumption_coverage`). Until then the guard held any change to a VAT rate, the VAT base or the consumption VAT is charged on. The model grossed household VAT up to receipts by one factor, `gov.simulation.microdata_vat_coverage` (0.38). #2187 divides instead by survey consumption coverage times the household share of VAT receipts, 0.67 × 0.7 = 0.469, so without it VAT ran about 23% high (0.469 / 0.38); the UK hub measured about 24% on Microcosm (its notice 59).
- **The CI cross-check:** `tests/test_expired_model_limits.py` checks that a household's `vat` and `baseline_vat`, divided by what its consumption owes at the statutory rates, are 1 / 0.469.
- **On enhanced FRS, #2187 doesn't settle it.** Its survey coverage, 0.67, is calibrated to Microcosm's national release. Its own derivation note puts VAT on enhanced FRS 2024-25 38% or 44% above receipts. So a VAT run on the eFRS route (such as `uk-budget-data geography --dataset-kind efrs`) needs the coordinator's call.
- **The energy VAT template's own figure doesn't depend on #2187.** The term it adds, eligible spending × the rate change / (1 + the old rate), isn't divided by any grossing factor.
- **Only this limit covered variables.** The guard's comparison of covered variables (formulas, what decides how they run, stored and calculated values) stays in `model_limits` for the next limit that needs it; its tests run on this limit's stand-in (`tests/model_limit_stand_ins.py`).

**Dated changes: key every year by its bare fiscal year.**

| Key | What it means | Use it? |
|---|---|---|
| `"2027": 0.21` | The whole UK fiscal year 2027-28, 6 April 2027 to 5 April 2028. The national run and the household calculator both read it. | **Yes.** List every year the change applies, through 2031 (2031-32). |
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
# Household receipts live outside the checkout: an untracked file in the tree
# makes every later receipt dirty and the Modal runs refuse (cli.py)
mkdir -p ~/private/uk-budget-2026/receipts
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
  --out ~/private/uk-budget-2026/receipts/g0-households.json
uv run uk-budget-data publish check
uv run uk-budget-data publish status
```

What they check:
- `certified_data`: the token reads the bundle's data and the tests' small dataset, each file by its pinned hash (#12, #70);
- the certified-data tests, which fail rather than skip here;
- the model-limit check: whether the model has each limit's fix. At 6.11.1 one limit is left, the minimum guarantee's (`pc_minimum_guarantee_uprating`), and it prints `False`;
- `/api/version`: the household API's versions must match the bundle's (#15), and the household check compares them again;
- `publish check`: every gate over each entry the page lists (#19), the manifest file's own 2026 Budget identity, and, once results by area are bound, that `release-index.json` matches the manifest and the files' bytes; `publish status` lists the manifest's entries.
- **Once results by area are bound, re-bind after every manifest change.** Any `publish stage`, `approve` or `withdraw` gives the manifest a new revision, so the release index no longer matches it: the area views go unavailable and `publish check` fails until `uv run uk-budget-data publish index` runs again (G4). Rerun the area run first if an entry it used has changed; `publish index` refuses tables made for an earlier version of an entry.

The shell blocks in this runbook carry no comments, so they paste into zsh as they are, once any `<placeholder>` in them is filled in.

Record in the clock table:
- the start SHA;
- the manifest revision and its execution identity;
- the dataset SHA-256;
- the household API identity;
- the basis in `data_inputs/publication_basis.json` (expected `pre_budget`). The page's provisional label does not read it: a manifest last written before its `budget.date` (28 October) calls provisional entries candidates, and the first Budget-day stage, approval or withdrawal ends that label: from then on provisional (statement) entries carry no banner on the page, though the manifest still records them as provisional. Withdraw or replace the candidates in that first write, so none is shown as a Budget measure;
- which model limits are active: each key the model-limit check prints with `False`. While active, `pc_minimum_guarantee_uprating` holds its measures from 2027 (see "How a measure must be written"); the State Pension, September CPI and VAT limits expired at 6.11.1.

**The gate fails** if any command fails, or the API's versions differ from the bundle's. With only the plumbing fixture, the household check can pass on plumbing alone, and checks no measure's non-zero answer (see "Household fixtures" above). The household check takes the bundle's versions from the installed packages here, because `main` has no `public/data/manifest.json` until the first entry is published (`--manifest` on a missing file exits 2). Once a manifest is published, pass `--manifest public/data/manifest.json` instead, as at G4.

## G1: coverage (12:30 to 12:45)

María classifies every statement measure as `coded` or `ledger`, with a reason, in the coverage ledger.

## Construction (from G1)

For each coded measure:
1. **Write it** in one of the bindable forms above: a template called from a module-level function, in a fixed-shape module of its own, `src/uk_budget_data/budget_measures/<its name>.py`, never in `reforms.py` itself (question 6 in `budget-day-publication.md`) and never added to another modifier's module, where it would change that modifier's definition too. Register it in `reforms.py`, which imports it. The page lists it from the published manifest, so it needs no frontend change.
2. **Declare what it should do** in `data_inputs/treasury/expected_effects.csv`. The columns are `measure_id,direction,from_year,to_year,reviewer,note`; `to_year` and `note` may be blank. `positive` improves the government balance and `negative` worsens it. Without this, and before any Treasury figure exists, the measure is "undeclared" and cannot be published.
3. **Declare the taxes it moves** in `DECLARED` in `tests/test_measure_descriptions.py`, and check that its name and description name only those (see "How a measure must be written" above). Without this, the required Python tests fail on the new id.
4. **Add one numerical test.**
5. **Commit.** A receipt from a dirty tree is not publishable.

## G2: provisional numbers (13:15)

```sh
uv run uk-budget-data generate --artifacts --reforms <ids>
uv run uk-budget-data publish reconcile public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish stage --provisional public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish check
```

- **Local or Modal: the same backend as the release's other artifacts.** The block above is the local form. If Tuesday's regeneration ran on Modal, run the day's `generate` calls there too (`uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --artifacts --backend modal --reforms <ids>`, and `--combined ... --backend modal` and `constituencies --backend modal` at G4), in the parallel shells of [`budget-day-checklist.md`](budget-day-checklist.md). A local artifact staged beside Modal ones needs `--adopt-execution`, which makes every other entry stale.
- **Once results by area are bound** (after G4's first area run), staging unbinds them, and this `publish check` fails until the index is rebuilt. From then on, run `uv run uk-budget-data publish index` before it, after rerunning the area run if an entry it used has changed (G4).
- **One artifact per measure.** `generate --artifacts` writes one new directory per measure and never touches another measure's. It prints each directory it wrote; use that path in the commands that follow.
- **A hand-written modifier is generated alone:** one id per `generate` call, in its own process. Measures in one call share the Python process, so a value a helper module keeps from one measure's build can reach the next measure's without being read under its watch (#51 round 18, family 4; #55). Template and `parameter_changes` measures may share a call.
- **Years: leave `--years` out.** It defaults to the policy years in `src/uk_budget_data/budget_years.json`, 2026 to 2031. Narrowing it drops a scored year: `threshold_freeze_2031_32` changes only 2031-32, so a run without 2031 has nothing to score for it. The area run's `--years` has the same default.
- **Supported years.** Years the dataset does not cover (from 2033 on 6.10.0, whose projection reaches 2032; every policy year, to 2031-32, is covered) are recorded as unsupported. The page shows them as unavailable once #20's modules are wired in after #3.
- **What "provisional" needs.** The measure must move in the declared direction. A measure that returns zero, or the wrong sign, is refused.
- **The floor of 3 survey households** (`publication/disclosure_floor.py`): the UK Data Service's minimum threshold for Safeguarded data (CD171 version 18, section 5.2.1, no cell "based on only one or two cases"). It advises 10, but doesn't require it; the scatter, mobility shares and areas keep 10. A decile whose change rests on 1 or 2 distinct survey households has its figures withheld for that year in both decile tables. A decile in which nobody changed is not thin.
  - **The rest of the measure stays publishable, including its costing.** The row's measure, year and decile stay; its value columns are blank in CSV and null in JSON. The page labels it "Not published, to protect survey respondents' confidentiality", the one reason that is true for every withheld cell, including those withheld only as partners or inherited from a member; it gives no count. The winners and losers table's "all" row is also withheld for that year, since it and the other deciles could give the missing figure back. The distributional table has no "all" row. The receipt records the withheld table, year and group labels, never their figures.
  - **The combined run carries its members' withholding forward.** It withholds each member's withheld decile and "all" cell for the same table and year, as well as its own thin cells, so subtracting members from the package cannot give a member's cell back. Regenerate the combined run after a member changes.
  - **The gates check the blanks against the receipt.** Staging, provisional, approval and both public-file checks refuse a table that publishes a value its receipt says is withheld. They refuse any run with `thin_cells_in_tables: true`, including older receipts whose thin deciles remain published: regenerate those runs to use cell withholding.
  - **If "all" itself is thin, the whole measure is still held.** Generation writes a warning naming tables, years and groups, never a figure, and the run cannot be staged or shown. To stop that run instead, writing nothing, set `UK_BUDGET_THIN_DECILES=refuse` where generation starts. Each run carries the setting; any value other than `warn` or `refuse` stops generation. This setting does not refuse a measure whose thin deciles can be withheld safely.
  - **The age table keeps its existing withholding rule.** A thin single year of age takes the other single ages of its band with it, and the bands and "all" stay. A thin band leaves only "all"; a thin "all" leaves nothing. So a blank single-age or pensioners chart for one measure and year is the floor at work, not a bug. The combined run also leaves out the age rows its members leave out, by the same rule (#340), and the receipt's `withheld_cells` names the age rows left out; unlike decile cells, those rows are absent, not blank.
  - **Only artifacts generated since #208 have been through it.** One made earlier is unchanged, since artifacts are write-once. Its receipt records no check, so it still stages, but provisional, approval and `publish check` refuse it: regenerate it to show it.
  - **A whole-measure-thin run can't be on the page, not even its costing.** When "all" is among the thin groups, the measure's whole change rests on fewer than 3 survey households. On the day:
    - **Its figures stay private.** Quote none of them anywhere, its costing included: none has passed the gate.
    - **Leave it out of the combined run,** as for a held measure (G4, "Which ids"): list every coded id but it. A combined run that includes it is never shown, since its members must be, and its decile tables less the other measures' would give back the measure's own.
    - **Say why wherever the package total appears,** as G4 asks for any measure left out: too few households in the survey data are affected to publish its effects by income decile.
  - **Other tables' disclosure floors remain for review after Budget day.** `metrics` (including people affected), costing and `poverty_inequality` are unchanged. Relationships through those tables may reveal additional information; withholding deciles does not certify them against every cross-table or external-data inference. María must rule on those relationships separately.
- **Household check.** One hand-checked household per measure, through the deployed route: add its fixture to `data_inputs/household_fixtures/` and run the `household_route` command from G0, writing `~/private/uk-budget-2026/receipts/<id>-households.json`.
  - **Keep the receipts outside the checkout.** As for `reconciliation.json` below, an untracked file in the tree makes every later receipt dirty. `publish approve --household-receipt` reads the file from any path and copies it into the manifest, so it never needs committing.
  - **Commit fixtures before generating.** A fixture under `data_inputs/` counts as code to the commit binding, and an uncommitted one makes the tree dirty: every later receipt is unpublishable, and an area run with a code-bound scenario refuses. A member with a modifier generated before a fixture commit can't join the combined run or the area run until it is regenerated, restaged and, if hand-written, attested again ("Which later commits an area run accepts", G4).
  - **A fixture ready only after G2** stays outside the generating checkout until G4's runs are done, for example in `~/private/uk-budget-2026/fixtures/<id>/`. Pass that folder to `household_route --fixtures`, which reads every `*.json` in the folder it is given. Commit the fixture after G4.
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
- **Publish.** Open a pull request, wait for the checks, then merge, which deploys. The page shows no provisional banner for these statement figures; the manifest still marks them provisional until they are approved.

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
  - **economy**, for the Pre-measures forecast tab's Forecast changes (next section);
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

**Wording on the day: config only.** The page says nothing that stops being true on Budget day. Loading the OBR's figures is not config (see "Budget day: OBR forecast" below); the OBR comparison shows only through a verified route. The only text edit on the day is one key in `src/utils/sources.js`, as soon as it is published, with a label to match (the page's text comes from the labels):
- `obr_efo_current` names the forecast the microsimulation uprates with, in Methodology and the landing text. Point it at the October 2026 EFO only together with the change that moves the model onto it (#290); until then it stays March. The Forecast changes sub-tab names each forecast by its own key, `obr_efo_march_2026` and `obr_efo_october_2026`, so it is right either way.
- `budget_documents`: the Autumn Budget 2026 document and its policy costings on gov.uk.

Check each URL loads, then deploy. A test fails if a view other than Methodology says "pre-Budget", "28 October" or "candidate".

## Budget day: OBR forecast (Pre-measures forecast tab, from 13:40)

The Pre-measures forecast tab's **Forecast changes** sub-tab (`?tab=outlook&sub=forecast`) shows the OBR March 2026 economic forecast, the one behind the baseline. Once the OBR publishes the Budget EFO, import it as the "post" series: the sub-tab then draws both forecasts, March faded and October full, with "March 2026 forecast" and "October 2026 forecast" chips, and one sentence saying the Budget figures use the October 2026 forecast (Vahid's decisions, 28 October 2026; before them, the import withheld the sub-tab). The tab's Living standards and Poverty sub-tabs are unchanged. The tab's data come from this repository (`uk-budget-data living-standards`, `src/uk_budget_data/living_standards/`).

**Before the detailed tables are out** (28 October 2026: only the PDF was published at 13:38), load the PDF's Table A.1, which gives CPI, RPI, average weekly earnings and house prices. Save the PDF and its text extract (PyMuPDF: `"\n".join(f"=====PAGE {i+1}\n" + p.get_text() for i, p in enumerate(doc))`) under `data_inputs/obr/`, then:

   ```sh
   uv run uk-budget-data obr-forecast \
     --efo-pdf data_inputs/obr/OBR-Economic-and-Fiscal-Outlook-October-2026.pdf \
     --efo-text data_inputs/obr/OBR-Economic-and-Fiscal-Outlook-October-2026.txt \
     --label "OBR October 2026 (Autumn Budget)" \
     --url https://obr.uk/download/economic-and-fiscal-outlook-october-2026/
   ```

   CPIH, actual rents, mortgage interest payments and non-labour income are not in Table A.1: they get `post: null` and keep their March line alone. When the *detailed forecast tables: economy* arrive, load them with `--efo` as below; that replaces the PDF document and fills those four (CPIH, actual rents and mortgage interest payments from the Inflation table; non-labour income from the household disposable income table; calendar-year rows 2027 to 2030).

1. **Download** the EFO's *detailed forecast tables: economy* (.xlsx) in a browser, as above, and record its SHA-256.
2. **Load it** (Vahid):

   ```sh
   uv run uk-budget-data obr-forecast \
     --efo ~/Downloads/<economy tables>.xlsx \
     --label "OBR October 2026 (Autumn Budget)" \
     --url https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/
   ```

   It takes about 2 seconds. It writes `data_inputs/living_standards/obr_forecast_post.json` and the `forecast` block of `public/data/living_standards_outlook.json` (nothing else in the file changes), and sets that file's review row to pending, with a new SHA-256 and a 14-day expiry. A stored `post_published` flag does not authorise the figures on the page.
3. **Check what it printed:**
   - every series, with its values for 2027 to 2030: CPI, CPIH, RPI, earnings, non-labour income, house prices, rent and mortgage interest from the OBR tables, then CPI after housing costs and social rent recomputed by PolicyEngine. The console prints values only; the table and column each was read from are in each series' `post_source` in `public/data/living_standards_outlook.json`;
   - the file name and SHA-256 match the download;
   - any "kept at the pre-Budget value" line. Only mortgage interest 2030 may say this, and on the March 2026 tables it does, because the OBR stops forecasting it after 2030 Q1. That line is expected; any other series saying it is not.

   If a table, column or year is missing, it stops and names the series; nothing is written. Don't fill a value by hand: fix the reader's pattern in `living_standards/obr.py` (`OBR_SERIES`), with a test.
4. **Commit for review** both files and the review row in a pull request. Once merged, the Forecast changes sub-tab draws the October lines beside the March ones. The Living standards and Poverty sub-tabs are unaffected.
   - **Don't merge it between G2 and G4.** `data_inputs/living_standards/obr_forecast_post.json` counts as code to the commit binding. So with it merged into the generating checkout, every member with a modifier generated before it can't join the combined run or the area run until it is regenerated, restaged and, if hand-written, attested again ("Which later commits an area run accepts", G4). Merge it after G4's runs.

**Rehearsing with the March tables.** Loading the March 2026 economy workbook (SHA-256 `fde1de4b…`, the same bytes as `data_inputs/living_standards/efo-march-2026-detailed-forecast-tables-economy.xlsx`) under a test `--label` gives post equal to pre: on 25 October all 40 values of the 10 series matched. Don't commit a rehearsal. Undo it with `git checkout -- public/data/living_standards_outlook.json data_inputs/public_data_review.csv` and `rm data_inputs/living_standards/obr_forecast_post.json`.

**This does not change the model.** The national results, and every projection on the Pre-measures forecast tab's Living standards and Poverty sub-tabs, uprate with the OBR forecast in the policyengine-uk release the bundle pins (March 2026 on 2.132.6). Population impact's growth and poverty cards read their current-law growth and population counts from the same projections. Moving the model onto the Budget forecast needs a policyengine-uk release and a bundle adoption, then `uk-budget-data living-standards` to rerun the projections (it keeps the loaded post forecast). The tab runs 2027-28 to 2031-32 on any engine; below policyengine-uk 2.134.4 its baseline applies that release's UC health element fix for 2030-31 and 2031-32 itself (`living_standards/uc_health_element.py`, policyengine-uk #2428).

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
    --household-receipt ~/private/uk-budget-2026/receipts/<id>-households.json
  ```

  Approval is refused until every gate passes. It names the exact outputs approved and stores the household receipt in the manifest. Once results by area are bound, follow the approvals with `uv run uk-budget-data publish index`, then `uv run uk-budget-data publish check`, as at G4. *The household receipt is optional in the code today (`REQUIRE_HOUSEHOLD_CHECKS` in `publish.py`); it becomes required once the specimen households exist.*

## G4: combined run and publish (14:50)

```sh
uv run uk-budget-data generate --combined <all coded ids>
uv run uk-budget-data publish stage public/data/artifacts/combined--<ids>/<digest>/
uv run uk-budget-data publish approve combined--<ids> --by "María Juaristi"
```

**The area run doesn't wait for the combined run.** Start it once G3's approvals are in, alongside the combined run (`constituencies --backend modal` on Modal, `uk-budget-data geography` locally; both below). It needs only the approvals of the measures it covers, since it checks each against its approved receipt. Area tables made then stay bindable after the combined run is staged and approved: `publish index` (`release_index.area_problems`) and the page (`src/utils/publication/area.js`) compare each entry's identity (artifact, receipt, outputs and execution identity), not the manifest's revision.
  - **Start the combined run first, from the same clean commit.** Both read the working tree when they start, and the area run's tables (`constituency.csv`, `area_provenance.json`) land in `public/data/` outside `artifacts/`, so they make the tree dirty: a Modal `generate --combined` started after they're written refuses until they're committed. Started together, the combined run (about 7 min) finishes well before the area run (14–21 min).
  - **No package by area from this run.** Before the combined run is approved, the area run's default ids are the approved single measures only. Publishing the package by area would need another area run after the combined approval, and a registered package alias with exactly those members (#235).
  - **Finish with `publish index`, then `publish check`, after the last manifest change** ("Bind the results by area last"): the index still refuses a manifest whose revision moved after it was built.

- **After staging the package, confirm its `age_impact.csv` has every band in every year:** each year 2026 to 2031 has `all` and all six bands (`0-15` to `65+`), none withheld. By age reads the package's own rows when every policy is selected (a single may withhold its bands, as the State Pension income tax protection does from 2027-28), so a package missing a band shows that band as not drawn.
- **Combined only.** `--combined` without `--reforms` generates only the combined run. It prints the directory it wrote.
- **Results by area** (`uk-budget-data geography`): `--manifest` defaults to `public/data/manifest.json`. The command defaults to its approved single-measure ids, in manifest order, followed by approved packages whose exact members are all approved, and refuses explicit ids that are not approved, including held, provisional and not-computable measures. A package needs its own approved combined entry; approving its members alone is not enough. Constituency results default to the package; without an approved package, pass `--seat-reforms`. A missing manifest or one with no approved ids means there is nothing the national page may publish yet.
  - **What #76 checks:** when a reform touches a data limit in what the area run calculates, the command names it and writes no tables at all.
  - **What it doesn't:** the manifest records publication approval, but the command does not read the holds ledger. The Reconciler still checks that measures held by hand have not been approved. A limit read only outside household net income, or in a year outside `--years`, isn't seen by the area run (#76's gap note).
  - **Microcosm is uncertified:** every run using Microcosm, however supplied, prints the uncertified label at the start and end and records `certified: false` and the reason in the private audit (policyengine.py#685). **The coordinator's ruling on the page caveat** (22 October): the area views show approved ids only, labelled as estimates from Microcosm's local-area file, which the national certificate doesn't cover (policyengine.py#685). Vahid and María choose the wording and placement. Until it's added, the page doesn't show the label, and the CSVs carry no dataset field to drive it. The disclosure CSV schema is unchanged. The default `efrs` route refuses 6.10.0's Microcosm bundle rather than mixing it with enhanced-FRS seat weights, and points to PR #59.
- **Which ids.** A measure that isn't approved blocks the combined run's approval: a CGT measure that depends on taxpayer numbers (held provisional), a pension measure held for review, a 2027 Pension Credit measure held provisional for want of the minimum guarantee's earnings fix, or a measure that isn't computable. If the call is to leave such measures out of the combined run, list every coded id but those, and say so wherever the package total appears. The results by area label their package reform "All measures (the full package)" when every measure on the page is selected (`src/utils/geography/selection.js`). If that package leaves a measure out, that label must change too.
- **The package the page shows** is the combined run of exactly the measures it can display (approved and provisional). A held, staged or not-computable measure is listed on the page as unavailable and is not part of it, so a combined run that leaves such measures out is the one the page uses. If no displayable combined run has exactly those members, the package's figures (net income levels for the example households, results by area and the household scatter for all measures, young people's shares) show as unavailable.
- **Bind the results by area last, then check.** `regional.csv` and `constituency.csv` are the only files the page reads outside the artifacts. After the last `publish stage`, `approve` or `withdraw`, and after the area run (which writes `area_provenance.json`, recording the approved artifact, receipt and actual baseline/reform identities checked before simulation, plus the output and table digests), run these two in this order:

  ```sh
  uv run uk-budget-data publish index
  uv run uk-budget-data publish check
  ```

  `publish index` runs every gate, and refuses area tables made beside an earlier version of any entry (its artifact, receipt or outputs), tables not the ones the area run wrote, and figures for a staged, stale, withdrawn or not-computable entry. It writes `release-index.json` and the manifest's `flat_files` and `flat_aliases`: the manifest's new revision, the SHA-256 of each file, and the manifest key the area run's package alias stands for. The page shows the area views only while the index matches the manifest it loaded and each file's bytes match. With no index, only the area views are unavailable. Run the final `publish check` only after the index has been rebuilt for the last manifest change.
  - **Before simulating**, the area run compares the actual baseline and reform scenario identities with the approved receipts. Any parameter, structural code or baseline mismatch stops before simulation. Its closed-schema `area_provenance.json` records the approved artifact, receipt, execution identity and table digests. `publish index` binds its bytes as `flat_provenance_sha256`; publication, public-file and browser checks verify that record and its aliases against the approved receipts. Review this sidecar as `publication_provenance`, and each CSV as a disclosure table. A `geography` run's sidecar binds only the files that run wrote: an untouched `regional.csv` beside a later `geography` seats-only run is refused. `uk-budget-data constituencies` composes the two: it carries the regional table's record over from that table's own run, once that record matches the table's bytes and binds each measure in both tables to the same approved entry (see "Results by constituency on the local-area cut (#115)").
  - **Which later commits an area run accepts.** A measure with a `simulation_modifier` (seven of the nine candidates, each in its own module in `budget_measures`) is bound by the commit its receipt was made at and by its module's whole source. The area run binds it at that commit when HEAD descends from it and every file committed since is one that cannot change a calculation: attestations, `public/`, `data_inputs/public_data_review.csv`, `docs/` (Python files under either excepted), top-level Markdown, the page's own files under `src/` outside `src/uk_budget_data/`, and the Treasury reconciliation inputs (the CSV, YAML and Markdown files under `data_inputs/treasury/`: G3's Treasury entry, mapping and exceptions, and the expected effects), which only the publication commands interpret. (The household deploy also checks and copies their bytes with the rest of `data_inputs/`, so commit them before deploying.) This covers the repository's code only: inputs a command is given explicitly, such as a data directory, are that run's inputs. So attestation, Treasury-entry, artifact, manifest, review-row, docs and UI commits don't block a refresh. (Until the rehearsal of 26 October, Treasury inputs counted as calculation code, so G3's Treasury commit would have made G4's combined run refuse every member with a modifier.) A package's code-bound members are bound the same way, each at the commit its own approved receipt was made at, so the package needs each such member's manifest entry. Any other change refuses it and names the files, including anything in `src/uk_budget_data/`, `pyproject.toml` or `uv.lock`. Adding the next measure's module to `budget_measures` is such a change, though since the split it changes no other measure's identity. Before the area views can refresh after it, regenerate and re-approve those measures, with fresh attestations for hand-written modifiers. Time one area refresh in the rehearsal.
- **An open page follows the publication.** On focus, on becoming visible and every five minutes the page checks `manifest.json`. A newer one replaces the figures with its own verified ones, with a notice; a missing, invalid or unreachable one takes them away. A later successful check restores verified results without a page reload. So a withdrawal reaches readers with the page open within five minutes, or when they return to the tab. Personal impact also checks before each household request, so it never asks for a withdrawn measure once the withdrawal is live.
- **Personal impact asks only the published model.** It compares the household API's policyengine, policyengine-uk and policyengine-core versions with those the selected measures' receipts record, and shows an error naming the packages that differ instead of an answer from another model. So the household API must run the release the approved receipts were made with: deploy it straight after each adoption's merge (see "Adopting a release (each re-cut)"). **Check it at the rehearsal:** with the first cut published on staging, open Personal impact for a published measure and get an answer, not the error. The comparison needs the receipts' package names (`policyengine-uk` and so on) to match the keys the API reports, and only the test fixtures have checked that so far.
- **The official costings comparison (Public finances card) reads `official_costings.json`, never `obr_comparison.csv`.** `obr_comparison.csv` is still not among the flat files a view may read (`FLAT_VIEW_FILES`): the pipeline fills it from last year's `obr_estimates.csv`. Instead, once the Treasury figures and `mapping.csv` are entered for the reconciliation, export the same sums the gate compares, both bases, under the manifest's measure keys and its release and Budget:

  ```sh
  uv run python -m uk_budget_data.publication.official_costings
  ```

  It writes `public/data/official_costings.json`. The page shows it only when its `budget` is the manifest's, and joins it only to measures whose own figures verified; the PolicyEngine column comes from the verified artifacts, as the revenue chart's does. Rerun it after any change to the Treasury sheets or the mapping (not after restaging: the official figures do not depend on ours). The file needs a review row in `data_inputs/public_data_review.csv` (kind `national_table`, the file's `shasum -a 256`, the reviewer's name), signed on the final bytes. Until the file exists, the card shows the pending line "The official costings are published with the Budget documents on 28 October; this comparison fills in once we have added them." (`OBR_PENDING` in `OBRComparisonTable.jsx`; the 404 is expected, not a fault). For a selection the file has no figure for, it shows no comparison. Page side: #245. Set `obr_budget_2026_costings.url` in `src/utils/sources.js` to the costings document in the same PR as the Treasury figures (#2 on #251's plan), so no separate frontend change lands between generation and publication.
- **Before simulating**, the combined run is checked: every parameter each member sets alone must hold in the combination. Conflicting measures are refused, naming both.
- **Members keep their own identities.** A combined run binds each member it reads from the manifest at the commit that member's receipt was made at, by the area run's rule below: HEAD must descend from it, and nothing committed since may be able to change a calculation. Staging compares each member exactly with its own receipt, so generating the combined run after the members' attestation commits, and after G3's Treasury entry, mapping and exception commits, is fine. Any other change refuses the combined run before simulating, naming the member and the files; regenerate and restage that member first.
- **Approval** needs every member approved.
- **Review rows.** As at G2, before the pull request is opened: `uv run uk-budget-data publish review-rows --reviewer <name>`, with `--staged-by <Integrator>` while any provisional or not-computable entry is listed. The review list goes in the same commit as the artifacts. Each row is the Reconciler's attestation that they reviewed those bytes.
- **Publish.** Open a pull request. The six required checks must pass. Publication gate runs too: it isn't required (question 3), but don't merge if it fails. Merge, and production deploys.
- **Verify on the live route:**

  ```sh
  curl -s https://policyengine.org/uk/budgets/autumn-2026/data/manifest.json | head -5
  ```

  Until policyengine-app-v2#1249 is live, and at the rehearsal, read the Vercel deployment instead:

  ```sh
  curl -s https://uk-autumn-budget-2026.vercel.app/uk/budgets/autumn-2026/data/manifest.json | head -5
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

Personal impact asks the household API live, so a correction has to keep the published figures and the live answers on one definition. The page checks two things itself. Before each request it checks the live `manifest.json`, and drops the request if the snapshot it was made under is no longer live. And it refuses an answer whose policyengine, policyengine-uk or policyengine-core versions differ from those the selected measures' receipts record. Neither check sees a definition changed in this repository under the same package versions, such as a fix to a modifier's module in `budget_measures`. The API reports definitions since #125, but the page doesn't compare them until W5's page follow-up merges. So the order below does it: withdraw first, deploy the fix only once the withdrawal has been live for five minutes, and bring the measures back only after the deploy.

A fix that changes a package version (policyengine-uk, say) is a re-cut, not a G5 correction: see "Adopting a release (each re-cut)".

1. **Commit the fix on a branch, and list the measures it changes** (the "affected measures" below). Run `uv run uk-budget-data publish definitions` on the fixed commit (#125). For each displayed single measure (approved or provisional), it recomputes the measure's receipt identities from this code at the commit its receipt was made at, and prints `same` or `DIFFERS` against its receipt; it exits 1 if any differs. Withdrawn and not-computable entries aren't listed, and combined runs aren't compared (step 5 covers them). It takes a few seconds and needs no data.
   - **A fix in a modifier's module lists the measures that use that modifier, and only those.** The receipt binds a modifier's whole module, and each modifier has a module of its own (since 25 October; before, all seven shared `budget_measures.py`, and a fix there listed all seven). A comment counts. `connect_student_loan_repayments` is on both sides of `plan_2_threshold_unfreeze`, so a fix there lists that measure once, with both sides.
   - **The split itself changed all seven definitions once**, through each modifier's module: its name, its source, and its module defaults, which now hold only that function's own (none, for `connect_student_loan_repayments`). Nothing else changed: `tests/test_budget_measures_split.py` checks that the function sources and defaults are as they were, and that each measure gives the same figures. Receipts made before it differ from it; the next regeneration (Monday's rehearsal, or at the latest the final cut's) absorbs it.
   - **It can't see a fix outside the measures' own module.** A receipt binds everything else only through its commit. List what has changed since each displayed measure's receipt with `git diff --name-only <receipt commit> HEAD -- src pyproject.toml uv.lock data_inputs Dockerfile` (the commit is the one `publish definitions` prints, from the receipt's `dashboard.git_sha`). The image's base layers (`python:3.13-slim` and `uv:latest` in the `Dockerfile`) can change with no commit at all; the deploy smoke checks the served packages' versions, not those layers.
     - **Code national generation also runs** (`measure_templates.py`, `reforms.py`, `models.py`, the scenario helpers in `personal_impact.py`, or anything else a modifier calls): every measure it reaches is affected, as for a fix in its own module. The page can't tell these apart.
     - **Code only the household route runs** (`household_impact.py`, which only `api.py` imports, and the request defaults in `api.py`): no measure's definition changes and none is affected. Merge the fix to `main` anyway, since the deploy builds only commits on `main` (step 2, with no withdrawal), then deploy and check it as in step 3, and stop there: nothing national is regenerated. The deploy changes Personal impact's answers for every measure it reaches, and nothing on the page marks it. If those answers can't stand, withdraw the measures they reach in step 2 and carry on through step 7 for them.
     - **From the page follow-up (stacked on #104, which adds `calculation_changes_since`),** `publish definitions` lists these files itself.
   - **Every measure with a modifier needs a new receipt before the next combined run or area run, affected or not.** Those runs bind each one at the commit its receipt was made at, and refuse it once anything that could change a calculation has been committed since, whichever measure the change reaches (`approved_revision` in `receipt.py`). Only attestations, `public/`, `docs/`, `data_inputs/public_data_review.csv`, top-level Markdown, the page's files under `src/` outside `src/uk_budget_data/` and the Treasury reconciliation inputs (CSV, YAML and Markdown under `data_inputs/treasury/`) are exempt (`is_non_calculation_path`), so a household-only fix counts too. Only the affected measures change and are withdrawn; the other six regenerate with byte-identical outputs, so their approvals carry over. Parameter-only measures keep their receipts.
2. **Withdraw every affected measure, in the fix's pull request, and merge it.** Put the withdrawals in the same pull request as the fix, so the fix reaches `main` (the deploy builds only commits on `main`) with the affected measures already off the page. The household API still runs the previous code until step 3's deploy.

   ```sh
   uv run uk-budget-data publish withdraw <id> --reason "<why>"
   ```

   The withdrawal also makes stale any combined run that includes the measure. **Once results by area are bound** (the manifest has `flat_files`), the area tables still hold rows for the withdrawn measure and the stale package, so `publish index` refuses them and `publish check` fails. Take one of these two routes before checking:

   - **Quick: take the area views down.** This deletes `release-index.json`, `regional.csv`, `constituency.csv` and `area_provenance.json`, then saves the manifest without a flat binding. The area views show as unavailable; nothing else on the page changes. If it stops part way, `publish check` fails until you run it again. Bring the views back in step 6.

     ```sh
     uv run uk-budget-data publish index --without-area
     ```

   - **Or rerun the area run over what is still approved**, then `uv run uk-budget-data publish index`. It defaults to the approved ids, so the withdrawn measure and the stale package drop out. With no approved package, constituency results need `--seat-reforms <approved ids>`; or pass `--levels region` and delete `constituency.csv`, since the index refuses a table the run didn't write. Use this route only once the rehearsal has timed an area run. After the fix's commit it refuses every measure with a modifier until that measure is regenerated (step 1), so here it can rerun parameter-only measures alone; with any measure with a modifier approved, take the quick route and bring the views back in step 6.

   Then run `uv run uk-budget-data publish check`, write the review rows (`publish review-rows`, as at G2; they drop the rows of any area files taken down), and merge. Check it's live with the `curl` of the deployed `manifest.json` at G4: it shows the new revision. From then on, an open page sends no request for a withdrawn measure, since its next check finds the new snapshot.
3. **Wait five minutes, then deploy the household API** from `main` ("Merge, then redeploy the household API by hand" under "Adopting a release"). A request checked just before the withdrawal went live was sent at once, and the API answers or times out within 300 s (`--timeout 300` in `cloudbuild.yaml`). Starting the deploy after that means no request made under the old snapshot reaches the fixed API; the deploy's own build and smoke test add several minutes more before traffic moves. After the household check, `uv run uk-budget-data publish definitions --api https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` must print "same" for every measure still displayed.
4. **Regenerate every affected measure**, each alone as at G2, then reconcile and stage it. Before step 5 or 6, regenerate and stage every other measure with a modifier too (step 1). This can run while you wait for step 3: only publishing waits for the deploy. Each new artifact leaves the old one untouched until step 7's review rows delete it (its entry stays in `superseded` for audit). Any combined run that included it becomes **stale** automatically.
   - **Two need a fresh two-person attestation whenever they are regenerated, affected or not:** `plan_2_threshold_unfreeze` and `state_pension_income_tax_protection` have hand-written modifiers, and while any data limit is active each regenerated receipt is held until attested again (`attestations.py`: an attestation binds the whole receipt document). Budget the reviewers' time, or leave them withdrawn.
5. **Then regenerate the combined run**, stage it, and approve every regenerated entry. Generation binds each code-bound member at the commit its own receipt was made at, and refuses a member whose code has changed since, naming the member and the paths. So it runs only once every code-bound member is regenerated and staged: after any calculation commit, all seven measures with a modifier, the unaffected ones included (step 1). Until then the package views (example-household levels, results by area, the scatter, young people's shares) stay unavailable.
6. **Bring back results by area**, if step 2 took them down: the area run, then `publish index`, as at G4.
7. **Write the review rows, as at G2, and publish through a second pull request.** Merge it only after step 3's household check: the measures return to Personal impact on a revision that runs the fix.

An approval or an exception carries over only where the outputs are byte-identical.

## Rolling re-cuts, and the 07:00 go/no-go (Max, 22 October)

Max, relayed by the UK hub and the coordinator on 22 October: "i think we should keep improving the model as much as we can as long as we can". So there is no single lock. The dashboard adopts each certified re-cut, under d1152 ("latest certified release"). UK time equals UTC from Sunday 25 October.

- **The cuts:**
  - **Rehearsal cut, Thursday 22:** the first policyengine-uk release with the 21 October merges. Friday's rehearsal uses it if it's adopted by 11:00Z on Friday. Otherwise the rehearsal runs on 6.10.0.
  - **Re-cuts, Saturday 24, Monday 26 and Tuesday 27:** each only if a material fix landed.
  - **The final cut, Tuesday 27:** its adoption is complete by **06:00Z on Wednesday 28**. That means merged, the household API deployed, the household check passed, a breakdown answered under 200 s, and the revert PR green.
    - **Its regeneration is at 18:00Z on Tuesday 27** (tracker #222; [`budget-day-checklist.md`](budget-day-checklist.md)): the coordinator's full run on Modal, on the final `main` and its final `uv.lock`. Calculation-path PRs are confirmed by 17:30Z, and both Modal images are built before 18:00Z. This replaces the 16:00Z build start and about 22:00Z release that "The schedule" below worked back from: those placeholders are superseded. A release adopted after 18:00Z would need the whole regeneration, and the hand-written measures' attestations, again; none is scheduled.
    - **The regeneration uses the three parallel shells, as at G2** ("The full run on Modal" below), each from the same clean commit: one shared call with `--reforms <the template and parameter ids>`; each hand-written modifier (`plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`; the employer NI relief for under-25s is withdrawn) in a call of its own; and, only if a flat file needs re-cutting, `--only income_distribution`. Never run `--artifacts` without `--reforms`: it runs every measure, the hand-written ones included, and each extra artifact of a hand-written modifier needs its own two-person attestation. Then the combined run, once its members are written.
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
    - **Placeholders, now superseded:** 16:00Z and 22:00Z stood until A, B and C were measured. The final regeneration is set at 18:00Z on Tuesday 27, on the final `main` (see "The final cut" above). The working below is kept as the record of how the window was derived.
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

## Faster generation on Budget day

**What the page reads.** The Budget views read approved artifacts only, plus `regional.csv` and `constituency.csv` once `publish index` binds them (G4). The other flat tables in `public/data` (`budgetary_impact.csv` and the rest) are still written by a plain `generate`, but no view reads them, and their committed copies were removed on 29 October (#339): don't commit them again. So on Budget day `--jobs` speeds up these runs:
- G2's `generate --artifacts --reforms <ids> --jobs 2`;
- G4's `geography --jobs 2`.

`--artifacts` and `--combined` also run on Modal (#139, ported to `main`): `uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --artifacts --backend modal --reforms <ids>`, one container per measure (32 GB, 2 CPUs, no retries, at most 16 at once, 45 min timeout), with the workspace secret `pe-uk-private-hf-read-token`. The run needs a clean working tree (the receipts name the commit the containers ran) and never sends a dataset file. A receipt binds the execution it ran in, so Modal artifacts carry the container's execution identity: make every artifact of a release in one place, or staging needs `--adopt-execution`, which marks every other entry stale. A hand-written modifier still goes in a `generate` call of its own. `scripts/budget_day/modal_smoke.py` tests the plumbing on an invented dataset, with no secret. The local artifact and area timings below are estimates, not timed runs.

Measured on 24 October on a 64 GB laptop (policyengine 6.10.2, the pinned Microcosm national dataset). The draft PR "Faster generation" holds the details.

- **Where the time goes.** One measure is two microsimulations, built once and read for every year:
  - **Building them:** about 15 s each, all inside policyengine-uk's `Simulation.__init__` (the UC reform, enum encoding, uprating). Loading the dataset itself is not the cost.
  - **The example households' income curve** was the largest part: about 17 s per measure and year. It now runs one household simulation per scenario for every year. The rows are identical to the bit, and it is about four times faster.
  - **Everything else** (budgetary, distributional, winners and losers, age, scatter): about 5 s per year, mostly `gov_balance` and net income.
  - **Memory:** about 19 GB per measure over two years and 22.5 GB over six as peak footprint (compressed pages included), but about 6.5 GB resident at its peak with another measure running beside it ("Fast full run" below).
- **One pass writes every flat file.** `generate` now writes `household_scatter_binned.csv` from the same simulations, beside `age_impact.csv` and `income_curve.csv`, so `--only age_impact`, `--only household_scatter` and `income-curve` are needed only to rerun one file.
- **The package's rows in the three flat files the page reads directly** (`income_distribution.csv` and `income_mobility.csv` for Household impact's "Where you sit", `income_growth_with_measures.csv` for Living standards "with the selected measures") must be the manifest's package, under its combined key (#228). The page reads a package there only under the key of the manifest's combined run of exactly the measures it shows, and says the figures are not available otherwise. So run these two from the same checkout **after the last manifest change** (`stage --provisional`, `approve` or `withdraw`), when the manifest's provisional and approved measures are the set the page should show and their combined run is provisional or approved too. An entry staged without `--provisional` does not count: run before its `approve` and the command either refuses or rebuilds the previous set.

  `generate --national` now makes these with the artifacts, in one run (see "The national run in one command" below); these two commands remake them after staging.

  ```bash
  uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --only income_distribution --published-package --backend modal
  uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --only income_growth --published-package --backend modal
  ```

  Start them with `python -m`: the `uk-budget-data` script runs the project's own Python, which has no `modal`, so `uv run --with modal==1.6.2 uk-budget-data ...` stops on a fresh clone. To run locally, `uv run python -m uk_budget_data.cli generate --only income_distribution --published-package` (and the same for `income_growth`). If a container fails, rerun the whole command: these two write one file each, from every unit.

  **On Modal these two run one container per measure and year** (`flat_units` with `by_year`): a package of seven measures and its combined run over six years is 48 containers, all at once, and the command prints `Years: one container per measure and year`. Each measure's years are folded back into one result here, and the files are the same bytes as one container per measure: the rows in the same order (measure, then year), the same rounding, and `income_growth_with_measures.csv`'s floor applied across every year after the merge. `income_growth` sends back each year's group medians and makes the rows on your machine, with the same `growth_rows` and the same pinned policyengine-uk prices. Expected: about 3 minutes per container (two builds, about 82 s, and one year's tables, about 82 s, from the 26 October breakdown) in place of 5–6 minutes for six years, so each command takes about half the container time it did; about 3× the container-seconds, roughly $0.70–0.85 per command against $0.23–0.30. Per-year containers may run 64 at once (`YEAR_MAX_CONTAINERS`) with a 15-minute limit each (`YEAR_TIMEOUT_S`, worst case about $5.60); the other Modal runs keep 16 and 45 minutes. Both commands side by side are 96 containers of 32 GB: if the workspace's concurrency limit is lower, Modal queues the rest and the run is slower, not wrong.

  **Fallback:** add `--sequential` to run each measure's years in one container, as before:

  ```bash
  uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --only income_distribution --published-package --backend modal --sequential
  uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --only income_growth --published-package --backend modal --sequential
  ```

  A local run always keeps a measure's years in one unit (six builds per measure would be slower on one machine), so `--sequential` changes nothing there. **Check once before relying on the per-year default:** on a scratch `--output-dir`, run both commands with and without `--sequential` on Modal and `cmp` the three CSVs; they must be identical. The tests show it on the invented dataset (`tests/test_flat_files_by_year.py`), not on Microcosm.

  `--published-package` reads `public/data/manifest.json`: the measures with a provisional or approved status, and the displayable combined run of exactly those whose members' outputs are current. It refuses when there is no such run. `--combined <ids>` does the same for a set given by hand. Without either, the files keep the registry's `autumn_budget_2026_combined` (every candidate), which the page never reads. The regenerated files need fresh review rows, and `publish review-rows` does not write them (it rows only the manifest's entries and the manifest; rehearsal of 27 October): the Reconciler updates the three rows in `data_inputs/public_data_review.csv` by hand, for `income_distribution.csv`, `income_mobility.csv` and `income_growth_with_measures.csv`, each with the file's new SHA-256 (`shasum -a 256 <file>`), reviewer, date and a basis naming the package. Until then `check_public_data.py` and `check-public-files.mjs` report each as "changed since its review".
- **Run measures side by side** with `--jobs N` or `--jobs auto`, on `generate` (flat CSVs, `--only`, `--artifacts` and `--combined`) and on `geography`:

  ```bash
  uv run uk-budget-data generate --jobs auto
  uv run uk-budget-data generate --artifacts --reforms <ids> --jobs auto
  uv run uk-budget-data geography --jobs auto
  ```

  - **One worker process per measure,** started from a forkserver that has already imported the engine. The data-limit watch, the model-limit check and the receipt each read one measure's two simulations, so a measure is never split across workers.
  - **The same bytes as a serial run.** Results are written in measure order, and each artifact made from `parameter_changes` or tested templates gets the same digest. Only `receipt.json`'s run fields (`generated_at`, `generator_argv`) differ.
    - **Not a hand-written modifier's artifact.** Every hand-written regeneration gets a fresh `generation_id`, which the artifact digest includes ("Which digest" above). A serial and a parallel run of such a measure therefore give different artifact digests, as two serial runs do. That is expected, not a parallel-generation fault: compare their tables (`dashboard.digests.outputs_sha256`) instead, and give whichever is staged a fresh attestation.
  - **`auto` never pushes the machine into swap.** It takes as many workers as the free memory holds at the per-measure estimate, after keeping 6 GB back. A measure starts only when its memory is free, and one still starting up counts at its whole estimate. With more than 30 GB of swap already in use, measures run one at a time. The estimate is 6.5 GB for `generate` (measured resident peak) and the footprint above for `geography` (not yet measured side by side). `--unit-memory-gb` overrides it.
  - **Before a heavy run,** check `sysctl vm.swapusage` and `pgrep -fl uk-budget-data`. Other generations share the machine.
- **Expected times for the whole run** (10 measures × 6 years). These are scaled from the measured figures, not timed end to end:

  | Step | Before (serial) | Now, `--jobs 1` | Now, 2 jobs | Modal, about 10 containers |
  |---|---|---|---|---|
  | Flat CSVs, with age_impact and the binned scatter | 33 min, plus 12–23 min (age) and 10–24 min (scatter) | about 17 min | about 9 min | about 5 min |
  | `--artifacts`, every measure, plus the combined run | not measured | about 22 min | about 12 min (the combined run waits for its members) | about 8 min, then about 7 min for the combined run (measured; see "The full run on Modal") |
  | `geography` (simulation part; the estimate and checks add about 3 min) | about 24 min | about 24 min | about 12 min | `constituencies --backend modal`: 14–21 min (see "Results by constituency on Modal") |

  - **How many jobs fit.** On a quiet 64 GB laptop `auto` should pick 2 workers for six years. On 24 October, with other agents' sessions holding memory and 16 GB of swap, it picked 1.
  - **Modal** sends each measure to its own container. Each container downloads the dataset (about 1.5 GB) on its first run. 10 measures need 10 containers, so 20 containers buy nothing over 10.
- **`--backend modal`** (flat CSVs and `--only` only, opt-in):

  ```bash
  uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --backend modal
  ```

  - **Secret:** the `policyengine` workspace's existing `pe-uk-private-hf-read-token` (key `HUGGING_FACE_TOKEN`, a read-only token for `populace-uk-private`, created by Anthony; decision on #119). If it is missing, the command stops with "Modal secret missing" and names the owner. The person running the command needs a Modal token for the workspace (`modal token new`).
  - **What runs where.** The command starts an ephemeral app, `uk-budget-2026-generate`, that stops when the command ends. Nothing is deployed and nothing is served, so no proxy auth is needed. The containers get the Hugging Face token from that one secret and no other credential. The image carries the working tree's package and `data_inputs/`.
  - **Guards:** no retries, at most 16 containers, 32 GB and 2 CPUs each, 45 minutes per container.
  - **Measured on 26 October** (`main` at 9305d80 with this change; scratch `--output-dir`): 10 units in **8.1 min** end to end, **$0.41**; the laptop's process peaked at 3.1 GB. `household_scatter_binned.csv` and `income_curve.csv` were byte-identical to `public/data`. Every other file differed only in 2026 rows of the VAT measures, the Warm Home Discount top-up and the package, by at most 7.4e-10 relative (last-digit float differences; main's rows were made on a Mac). A second Modal run gave bit-identical rows.
  - **On pull requests:** `.github/workflows/results-on-modal.yml` runs this when a PR changes a measure, and uploads the files as a workflow artifact with a table of which differ. It never commits or signs: copy in the files you accept and sign their review rows yourself, in the same commit.
  - **The image is built from `uv.lock`** (`uv_sync`), as #97's household app is. The memory snapshot it asks for is never taken on this ephemeral app (see "The full run on Modal" below).
  - **`--artifacts` and `--combined` now run on Modal too (#206), and so does the area run (`constituencies --backend modal`).** Measured timings, the order to run them in and what to do when a container fails: "The full run on Modal: order, timings and failures" below. Make every artifact of a release in one place, or staging needs `--adopt-execution`.
  - **Linux and macOS may differ in the last bit of a float.** So check a Modal run's files against a local run once before relying on it.

## The national run in one command (`generate --national`, 28 October)

One command now does what the four national commands did: the measures' artifacts, the package's combined run, and the package's three flat files (`income_distribution.csv`, `income_mobility.csv`, `income_growth_with_measures.csv`). They used to be `--artifacts --reforms <ids>`, `--combined <ids>`, then `--only income_distribution --published-package` and `--only income_growth --published-package`. Each was its own cold Modal app, and every container downloaded the Microcosm dataset from Hugging Face again, so one Hugging Face 503 could break a run. The area run (`constituencies --backend modal`) is unchanged and stays a separate command; start it alongside as before.

```sh
# Plan only: prints the measures, the package key, the steps, the limits and the expected times. Runs nothing.
uv run python -m uk_budget_data.cli generate --national --backend modal --dry-run
# The run, from a clean checkout:
uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --national --backend modal --combined-key <the package key the plan printed>
```

- **The measures.** Without `--reforms`, the run takes the publication manifest's published set: its provisional and approved measures, sorted by id, as `--published-package` reads them (`--manifest` names another manifest). The package is the combined run of all of them, under `combine.combined_key` of their ids. For tonight's seven (savings rates held back) that key is `combined--f91fe847275730cb`. `--reforms <ids>` gives the set by hand instead. Pass `--combined-key` with the key you expect: if the set makes another key, the run stops before anything starts. Never pass every registered measure.
- **One Modal app** (`uk-budget-2026-national`, ephemeral: it stops when the command ends, and no container is left warm):
  0. One small container (1 CPU, 4 GB, 15-minute limit) fills the dataset cache. This is the Modal Volume `uk-budget-2026-dataset-cache`, which holds the pinned files under their SHA-256. A file already cached with the right digest is reused. Otherwise it is downloaded once, with up to 6 attempts on a 5xx, a 429, a dropped connection or a timeout (waits of 2, 4, 8, 16 and 30 s). It is kept only if it hashes to the bundle's digest. A 401, 403 or 404 is not retried.
  1. One container per measure, all at once: 32 GB, 2 CPUs, at most 16 at once, no retries, a 30-minute limit. Each copies the dataset from the cache to `./data` (digest checked) and never downloads it. policyengine's materializer then finds the file there and records the same URI, revision and digest as after a download. The container makes the measure's artifact exactly as `--artifacts` does. Then, from the same two simulations, it reads the measure's rows of the three flat files.
  2. The package, once every member is written, in one more container (an idle measure container waits up to 2 minutes for it, so it usually starts warm). It is planned exactly as `--artifacts --reforms <ids> --combined <ids>` plans it: it binds its members' outputs and withheld cells as written in this run, and it still refuses mismatched members.
  3. On your machine, the three files, written by the same `generate_income_distribution` and `generate_income_growth` that `--published-package` calls, from those rows: measures by id, then the package under its key. The rounding and floors are the same, so the bytes are the same.
- **Nothing an artifact binds changes.** Each artifact keeps its own receipt, digests and the container's execution identity (the same image as `--artifacts --backend modal`). It is assembled write-once here, as before. The flat rows are read after the artifact is written, outside its data-limit watch, so they cannot change its receipt. They reuse the artifact's simulations only when the flat path would build the same ones (the same baseline and reform scenarios). If not, the container builds the flat path's own two. The progress line says which.
- **The flat files are written only when every artifact was written.** If any measure or the package is refused, fails or doesn't start, the files are left as they are. The command prints why, and the rerun steps for any failure (the `--reforms`/`--combined` commands, as "If a container fails" below). Once the package is staged, make the files with the two `--only ... --published-package` commands. The files bind this run's set and package key. If staging later drops a measure, the published package changes, so remake them with those two commands.
- **A hand-written modifier is in the shared run.** The package needs every member, so a hand-written modifier (`state_pension_income_tax_protection`) runs in the same app as the others. Each artifact of it in a new directory needs a fresh two-person attestation, as before. After a failure, rerun only the failed ids with the old commands; don't rerun `--national`.
- **Expected on Modal (estimated, not yet timed):** app start, image and cache 1–2 min (a cache hit is a few seconds of hashing); measures 6–8 min (293–354 s measured on 26 October with a cold download, plus a minute or two for the rows); the package 6–8 min after them (about 7 min measured, plus the rows); the files under a minute. **About 13–17 minutes end to end**, against about 16–20 for the four commands. The package can't start beside its members, because its receipt binds their outputs and withheld cells. Worst case at the limits: 16 containers × 30 min at about $0.35 a container-hour is about $2.80.
- **Locally:** `--backend local` runs the same steps one after another in this process (no `--jobs`). It is slow on Microcosm, and is for parity checks on small data.
- **Tests:** `tests/test_national_run.py` checks that the artifacts are the same as `--artifacts --reforms --combined`'s (digest, outputs, execution identity, table bytes). It also checks that the files are the same bytes as the `--published-package` commands', and the ordering, refusals, failures, dry run and cost guards. Its slow test runs the engine on the invented dataset and compares the three files byte for byte. `tests/test_dataset_cache.py` covers the cache (digest checks, retries, no retry on 401/403/404).

## The full run on Modal: order, timings and failures (26 October)

The day's order on one page, with who runs what and what runs side by side: [`budget-day-checklist.md`](budget-day-checklist.md).

The measured version of G2 to G4 on Modal, from Monday's full regeneration (26 October, `main` at 0fc752f, policyengine-uk 2.132.6, $1.13 in all) and the Modal app history. The timing table in "Faster generation on Budget day" above is older and partly estimated; where they differ, this one is measured.

**Before the day (Tuesday evening, after the final lock):** build both images, or the first run of the day waits about 12 minutes for one. Neither needs the secret or data.

```sh
uv run --with modal==1.6.2 python scripts/budget_day/modal_smoke.py --root /tmp/modal-smoke threshold_freeze_2031_32
uv run --with modal==1.6.2 python scripts/budget_day/modal_constituencies_smoke.py
```

**Start the commands with `python -m`.** In a fresh clone on 26 October, `uv run --with modal==1.6.2 uk-budget-data generate ... --backend modal` stopped with "needs the modal package": the console script started the project's own `.venv` Python, which has no `modal`. This form works:

```sh
uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --artifacts --backend modal --reforms <ids>
```

**Run the independent commands side by side, each in its own shell.** Each starts its own ephemeral app, so they don't wait for each other:
- the template and `parameter_changes` measures in one `generate --artifacts --backend modal --reforms <ids>`;
- each hand-written modifier (`plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`; the employer NI relief for under-25s is withdrawn) in a call of its own, started at the same time;
- any flat file a re-cut needs (`generate --only income_distribution --backend modal`), at the same time too: it doesn't depend on the artifacts. The exception is the published package's files (`--only income_distribution --published-package` and `--only income_growth --published-package`, #233): they read the manifest, so they run after its last change, at G4, never beside G2.

Never put a hand-written modifier in the shared call, and never run `--artifacts` without `--reforms`: that runs every measure, the hand-written ones included, and each extra artifact of a hand-written modifier needs its own two-person attestation. This holds for Tuesday's 18:00Z regeneration as for G2.

Only the combined run must wait, because its receipt records each member's output digest: `generate --combined <ids> --backend modal` once its members are written (and, at G4, approved).

| Step | Wall time, measured | Per container | Cost |
|---|---|---|---|
| Nine measures, one call (`--artifacts --backend modal`) | 8:11 for the Modal app, about 8:45 for the command | 293–354 s | $0.36 |
| One hand-written modifier, its own call | 6:43 for the command | 354 s | $0.04 |
| Two combined runs (`--combined`, after the measures) | 6:13 for the app, about 7:10 for the command (57 s planning here) | 339–348 s | $0.07 |
| `--only income_distribution`, ten units (one container per measure; now `--sequential`) | 4:13 | | $0.23 |
| Area run, six measures then the release (`constituencies --backend modal`) | 13:53 and 14:32 | 3:40–6:32 per measure, 7:32–8:07 release | $0.51 |
| Area run, ten measures then the release (drill 5) | 21:18 | 3:36–5:22 per measure, 15:25 release | |

On Monday the four national commands took 20:09 end to end because `income_distribution` started only after the artifact run; side by side they take about 16 minutes, the length of the measures-then-combined command.

**Where a container's time goes.** Each artifact's progress now ends with a line splitting its container's time into the two builds, the tables, and the checks and receipt. The first build in a fresh container also downloads and checks the dataset, so the difference between the two builds is roughly the download. Measured on 26 October (one parameter-only measure, `badr_lifetime_limit_cut`, 2026 only): `176 s in its Modal container (builds 33 + 49 s, tables 82 s, checks and receipt 12 s)`, 3:27 for the command, $0.02. The first build includes the download, so the download is well under 33 s. Against the six-year containers (293–354 s), the tables take about 260 s, about 82 s for the first year and 35 s for each later one: about 70% of a container is the tables, and under 10% the download.

**The memory snapshot does nothing.** `enable_memory_snapshot=True` is ignored on an ephemeral app (every run logs "Memory snapshots are disabled for ephemeral apps"), so each container imports the engine cold. It costs seconds, not minutes.

**If a container fails** (an error in the run, the 45-minute timeout, out of memory):
- every other artifact still comes back and is written. The failed one is printed in its place (`<id>: FAILED in its Modal container: <error>`), and the summary lists it apart from the refusals (`FAILED <id>: ...`), with any combined run of the same call as `NOT STARTED` (a combined run binds its members' outputs, so none starts while one is missing). The command then prints what to rerun and exits 1. Before #226 one failure stopped the app and every artifact not yet written here was lost;
- **results come back in measure order.** A slow or hung container holds back every artifact after it until it finishes or reaches the 45-minute timeout. A pause after `<id>: wrote ...` means a container is still running: don't interrupt it. Ctrl-C loses every artifact not yet written, as before #226;
- stage the written ones as they are, then rerun only the ids the command prints (`--reforms <failed ids>`, each hand-written modifier in a call of its own), stage them, then the combined run (`--combined <member ids>`). Don't rerun the whole set: at the same commit a template or `parameter_changes` measure comes back "unchanged" (write-once), but a hand-written modifier gets a new directory and needs a fresh two-person attestation;
- a run killed mid-write (laptop asleep, terminal closed) can leave a `.staging-*` directory under `public/data/artifacts/<id>/`. It can never be staged (`publish stage` needs the directory named by its digest) and doesn't make the tree dirty (paths under `public/data/artifacts/` are the publication's own), and `publish review-rows` deletes it; never commit it;
- a refusal is not a failure: a measure the gates refuse (a data limit, a scored year left out, or a whole change resting on fewer than 3 survey households) comes back refused, with its reason, and no rerun changes it;
- Modal restarts a preempted container with the same input even with `retries=0`; that is safe under write-once, and costs at most one container's time;
- nothing reaches the manifest until `publish stage`, so a failed or partial run publishes nothing. Never run `publish review-rows` while a `generate` is writing in the same checkout: it deletes unstaged artifact directories.

## Fast full run

**Not a step of the day.** This run writes the flat tables, which no Budget view reads (see "What the page reads" above). It's kept here as a measure of the machine's speed and memory. To time the day's own runs, time G2's `generate --artifacts` and G4's area run at the rehearsal.

"Society" results: the nine candidate measures plus `autumn_budget_2026_combined`, every year (2026 to 2031), every flat table in `public/data` (`budgetary_impact`, `distributional_impact`, `winners_losers`, `metrics`, `age_impact`, `household_scatter_binned`, `income_curve`, and `obr_comparison`). One `generate` writes all of them.

**Measured end to end on 25 October** on an 18-core, 64 GB Mac (policyengine 6.10.2, `microcosm_uk_2024_25`). Other sessions were holding about 37 GB, with 10 to 20 GB of swap in use. Every parallel run's files were byte-identical to the serial run's. The serial run's seven dashboard tables were also byte-identical to the committed `public/data`.

| Configuration | Wall time | Units at once (observed) | Peak RSS, process tree | Swap rise |
|---|---|---|---|---|
| `--jobs 1` (serial) | 16.0 min | 1 | 10.3 GB | +5.3 GB |
| `--jobs auto` | 14.7 min | 1 (it chose 1: "21 GB free, 22.5 GB per unit") | 12.2 GB | 0 |
| `--jobs 2` (old 22.5 GB estimate) | not timed end to end: expected to be about serial + 1 min | 1: the 22.5 GB estimate never fitted, so units ran one at a time (seen in the interrupted runs) | n/a | n/a |
| **`--jobs 2 --unit-memory-gb 4`** | **7.8 min** | 2 | 12.8 GB | +5.3 GB |
| `--jobs 4 --unit-memory-gb 4` | 7.3 min | up to 3 | 16.4 GB | +5.3 GB |

- **`--jobs 2` is the setting to use, about 8 minutes here.** Four jobs save only about 30 s more, probably because the combined run is the long pole (inferred, since the log has no per-measure times). They also put more pressure on a machine others are using.
- **The per-unit estimate is now 6.5 GB** (it was 22.5 GB, a peak footprint that counts compressed pages). With 22.5 GB, `auto` and the admission check fell back to one unit at a time on this Mac. Two units at once peaked at 12.8 GB RSS (6.4 GB each), three at 16.4 GB, swap rose no more than in the serial run, and free memory never fell below 8.4 GB. With 6.5 GB and 21 GB free, `auto` picks 2 and the admission check lets a second unit start while the first ramps up, but not a third. The table's `--unit-memory-gb 4` rows are how this was measured before the change; 4 and 6.5 both admit two units on this machine.
- **Before 25 October,** `--jobs 2` waited forever for its first unit when the estimate never fitted. It now waits at most 60 s once per run, then starts the unit alone, as a serial run would.

```bash
cd <checkout of the release commit>
export HUGGING_FACE_TOKEN="$(cat ~/.cache/huggingface/token)"   # never echo it
sysctl vm.swapusage; pgrep -fl uk-budget-data                   # nothing else generating
top -l 1 -n 0 | grep PhysMem                                    # at least ~15 GB unused or inactive
uv run uk-budget-data generate --jobs 2                         # about 8 min, writes public/data
git status --short public/data                                  # review the diff before committing
```

- **Check against a serial run** on a scratch copy when there is time (16 min): `--output-dir /tmp/serial --jobs 1`, then `cmp` each CSV. They must be identical.
- **Fallbacks, in order:**
  1. If memory is short (less than about 10 GB free, or swap climbing past 30 GB), use `--jobs 1`: 16 min, peak about 10 GB RSS.
  2. If one measure fails or changes late, rerun the full set. `generate --reforms <ids>`, and `--only age_impact` / `--only household_scatter` with `--reforms`, replace the shared CSV with only those measures. They don't merge into it.
  3. Modal (`--backend modal`): about 8 min and $0.41 for every measure (see above).
- **Not covered here:**
  - **Results by area.** `geography` needs `public/data/manifest.json` approvals and the seat weights in `data/`. Neither is on #69, so it is not wired for this run (#115).
  - **Receipted `--artifacts`/`--combined` runs.** They were not timed on 25 October.

## Adopting a release (each re-cut)

**On 28 October no upgrade is adopted after the 07:00Z go/no-go.** Only an emergency revert to the previous cut is allowed (see "Rolling re-cuts" above). The steps below are how each re-cut is adopted before then.

- **Upgrade PR.** When policyengine.py releases a qualified bundle, a draft upgrade pull request opens automatically (#18). If its dispatch is late, W5 dispatches the adoption by hand. The workflow opens draft PRs only. Each re-cut's PR merges on its gates, after approval on the branch.
- **First, regenerate the area routing status on the upgrade branch, with the new release installed:** from the repository root, `uv run python -m uk_budget_data.area_routing --write`, and commit `public/data/area-routing.json` if it changed. The command reads the installed bundle, not the lock: run before the install, it would record the old release's routing. Do this before regenerating the measures: an uncommitted change makes the tree dirty, and a receipt generated on a dirty tree is not publishable.
  - **What it is:** whether the new bundle routes constituencies and local authorities, read from its UK release manifest (`regional_release_kind` and `region_datasets`). The page labels its constituency view "not available on this release" when the file says `not_available` (see "The weekend release is national only" below).
  - **Why every time:** `tests/test_area_routing.py` pins the file to the installed bundle, so an adoption that changes the routing fails CI until the file is regenerated. Its message names the command. The file takes no review entry: both public file checks accept only the few texts the command writes, and refuse an entry for it; `publish review-rows` doesn't list it as unreviewed, and removes a row for it.
  - **How the label lifts.** Regenerating the file at the adoption of a release that routes results by area again flips it to `available`. The page then draws whatever constituency file `public/data/` holds, and nothing ties that file to a release. So the same upgrade PR carries the area run's tables from the new release, with their review rows; otherwise the page shows the tables of an earlier release. A clean revert of the adoption brings the previous file back with it; one that keeps `main`'s publication files doesn't (see "A model release" under rolling back).
- **Then record the cut's newly missing inputs, and hold each one (since #124).** policyengine.py's budget-inputs gate lists, for each certified cut, the model inputs its data leave at their defaults that its predecessor's didn't (`newly_missing_inputs` in the certification's `budget-inputs.json`, which is in neither the bundle nor this repository: the UK hub posts it, Monday's on #124).
  - **Copy the list** into `NEWLY_MISSING_INPUTS` in `src/uk_budget_data/data_limits.py`, keyed on the new bundle's `data_releases.uk.build_id` (an empty tuple if it lists none).
  - **Name the cut it was listed against** in `LISTED_AGAINST`: the previous certified pair in the same evidence (a133's is the 19 October cut, `RECORD_ROOT`). The chain from the installed cut must reach `RECORD_ROOT` through recorded cuts only, so a cut certified in between and never adopted needs its own record too, or the inputs it newly left would be in no list.
  - **Register a data limit for each input it adds,** keyed on the parameters through which the input acts, with a reason that states the default the model uses. An input that the data carry again, or that the model no longer has as an input, goes in `NO_LONGER_MISSING` with why, and its limit is removed (the certified tripwire in `tests/test_data_limits.py` fails for the first).
  - **Why:** `tests/test_data_limits_cuts.py` fails until all three are done, naming the cut, the break in the chain, or each input left uncovered. A cut the dashboard skips still counts: its inputs need limits until a later cut carries them.
  - **Before regenerating:** a new limit, or a change to one's prefixes or reason, changes `data_limits.REGISTRY_SHA256`, which every receipt records and `publish check` compares, so receipts generated before it are stale.
  - **And regenerate `contract.json` and the frontend publication fixture** in the same commit: `uv run python -m uk_budget_data.publication.contract > src/utils/publication/contract.json`, then `PYTHONPATH=. uv run python scripts/make_publication_fixture.py src/test/fixtures/publication`. Every fixture receipt records the registry digest, which `digest.js` compares with the contract's, so otherwise Frontend tests fails.
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
  - **So does whatever the new release's tests demand,** for example removing a lifted data or model limit, as 6.11.1's adoption did (PR 238). `UC_REBALANCED_YEARS` needs no change: it follows the engine's export.
- **Merge, then redeploy the household API by hand.** The deploy builds only a commit on `main` ("Choose the commit" in `deploy-api.yml`, and the ancestry check in `cloudbuild.yaml`), and merging doesn't start it: deploys on push stay off while the repository variable `API_DEPLOY_ON_PUSH` is unset. So after the merge, run the "Deploy the household API" workflow with action `deploy`, then run the household checks. Until the deploy has run, G0's household check fails on the version mismatch, as designed.
- **Before the page lists a new measure, and whenever a displayed measure's definition changes (`reforms.py`, `budget_measures/`, `measure_templates.py`), every household API it calls must know it, and the examples must be recomputed.** `page_measures_check` compares only the measure ids and the engine versions, so presets computed before a definition changed under the same id pass every check. The page sends every displayable measure in `public/data/manifest.json` to the household API. An API deployed from an older commit refuses the new ones ("Unknown measures: …"), so Household impact shows an error. The example cards don't call the API: they read `public/data/household_presets.json`, so stale presets show the previous measures' answers with no error at all. Drill 5 hit both (#144). So, in this order:
  1. Deploy the household API from the commit that registers the measures: Cloud Run ("Deploy the household API") and, if the page uses it, the Modal app (`modal deploy src/uk_budget_data/modal_household.py`).
  2. Recompute the examples on that commit: `bun scripts/household-preset-requests.mjs > /tmp/requests.json`, then `uv run python scripts/precompute_household_presets.py /tmp/requests.json`. Commit `household_presets.json` with its review row.
  3. Check both before the page publishes. It exits 1, naming each refused measure or stale preset:

     ```sh
     uv run python -m uk_budget_data.page_measures_check --base-url "$HOUSEHOLD_API" --base-url "$HOUSEHOLD_DETAIL_API"
     ```
  - **Check the definitions first.** On the merged `main`, run `uv run uk-budget-data publish definitions`. Every displayed measure should be "same", since each was regenerated on the branch. One that differs was changed after its regeneration: regenerate it before deploying. Once the page compares definitions, it would show that measure as unavailable in Personal impact. The command takes a few seconds and needs no data.
  - **And again on the deployed image, after the household check.** `uv run uk-budget-data publish definitions --api https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` asks the live revision in one household request (about 20 seconds when its answer isn't cached: the smoke household's headline, two runs) and must print "same" for every displayed measure: the image the page asks, not the checkout, computes them as the receipts recorded.
  - **The page follow-up merges only once the rollback target serves definitions too.** The first deploy with #125 makes the live revision report definitions, but the revision it replaced doesn't, and a fast rollback to it would leave every measure unavailable in Personal impact. So merge the page follow-up only after a second deploy with #125 (a re-cut's adoption, at the latest the final cut's), once the revision recorded as the rollback target is one deployed with #125. Check it against that revision's tag URL, on `main` with the manifest the page will serve: `uv run uk-budget-data publish definitions --api '<tag URL>'` must answer with definitions, with no `REFUSED` line. A `DIFFERS` row there is expected for any measure whose definition changed in the deploy since (an engine adoption can change one: `plan_2_unfrozen_thresholds` reads the engine's RPI index), and is what a rollback to that revision would show as unavailable, as designed; it doesn't hold the merge. A row whose problem is "the running code cannot bind it" for a measure that revision registers does: that image can't bind code. If none is published yet, it has nothing to compare; check presence instead: `curl -s -H 'content-type: application/json' -d '{"year": 2027, "policies": ["badr_lifetime_limit_cut"], "household": {"employment_income": 30000}, "include": []}' '<tag URL>/api/household-impact?definition=road_fuel_vat_cut:<its full commit>'` must answer with a `definitions` object whose `road_fuel_vat_cut` entry has `baseline` and `reform` and no `error` (a measure with a modifier, so it also shows the image binds code).
  - **Dispatch it as soon as the merge lands.** Until the deploy finishes, the previous revision serves the Personal impact tab. The dashboard goes live about a minute after the merge. The API goes live only when the deploy promotes its revision, about 6 to 7 minutes after dispatch. On 24 October, #69's merge was live on the dashboard at 23:21:16Z (Vercel), and `00024-lir` had taken traffic by 23:27:13Z (run 40142327478, dispatched at 23:20:24Z; the workflow confirmed the live version at 23:27:15Z).
  - **Then time one breakdown.** No gate asks for one (see "How long one household answer takes"). After the household check, run this. The first number printed must be 200, and the second, the seconds, under 200, the page's limit. Treat anything else like a failed household check. An answer within a few seconds came from the route's cache (`_cached_household_impact`), so change `employment_income` and run it again.

    ```sh
    curl -s -o /dev/null -w '%{http_code} %{time_total}\n' --max-time 300 -H 'content-type: application/json' -d '{"year": 2027, "household": {"employment_income": 31000}, "include": ["by_policy", "sweep"]}' https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact
    ```

  - **What the gap does:** in a model adoption, the national figures come from the new release while the previous revision still serves the API. The page compares the API's policyengine, policyengine-uk and policyengine-core versions with those the selected measures' receipts record, and refuses answers from another model, so Personal impact shows an error naming the packages that differ until the deploy finishes. The same holds after a revert merges, until the API is rolled back or redeployed. In a merge that changes the route the tab calls, as #69 did, the tab fails until the deploy finishes.
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

## Results by constituency on the local-area cut (#115)

`uk-budget-data constituencies` is `geography`'s seats pass (`--dataset-kind microcosm --levels constituency`) on Microcosm's published local-area cut, with each measure simulated in a fresh process, so memory goes back to the machine between measures. By default it runs every measure the manifest approves, in the manifest's order, and the package (`autumn_budget_2026_combined`, whose members are `AUTUMN_BUDGET_2026_COMBINED_COMPONENTS`) only when the manifest approves that package's combined run with exactly those members, over the policy years, and publishes every one of them by constituency, as `geography` chooses its defaults. Regions stay a separate pass, from the national file.

**The package by constituency is eight measures** (27 October 2026, evening): `AUTUMN_BUDGET_2026_COMBINED_COMPONENTS` lists `domestic_electricity_zero_vat`, `employer_nics_secondary_threshold_raise`, `fuel_duty_rise_deferral`, `plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`, `threshold_freeze_2031_32`, `unearned_income_rates_up` and `warm_home_discount_top_up`, so the alias `autumn_budget_2026_combined` stands for `combined--894152ce8c83f1d8`; BADR, employer NI relief, the road fuel VAT cut, the Carer's Allowance taper and the LHA unfreeze are withdrawn and unregistered. The run includes the package only once the manifest approves that combined run with exactly those members and all eight are approved. On Budget day the package is published by constituency only if the announced measures are exactly these eight; otherwise the card offers one measure at a time. Pass `--reforms` to run fewer measures; a measure the manifest doesn't approve still stops the run before anything is fetched. Before G3, with nothing approved, the default run stops at once with "nothing the national page may publish yet". The plan also stops, naming the measure, if an approved measure's supported years don't cover the policy years ("requested years are not approved and supported"): keep `--years` at its default and leave that measure out with `--reforms`.

**It writes `area_provenance.json` beside the table, as `geography` does, so `publish index` accepts it.** Before anything is simulated, each reform's current definition is checked against its approved receipt (`geography.area_provenance`); the record is written after `constituency.csv` passes `validate_public`. If a `regional.csv` from a regional run is already in `--out-dir`, the record carries that run's record of it (checked against its bytes and approvals), so `publish index` binds both tables.

**Order on the day: merge the code before the receipts.** A measure bound to the repository's code (`code_revision` in its receipt) passes the check only while nothing under `src/uk_budget_data/` (or any other calculation path) has been committed since its receipt's commit, and only if that commit is an ancestor of the one you run from. So merge this command's code and #206 before G2 generates the receipts, and merge nothing that touches the package between approval and the area run. A measure refused with "calculation code changed since the approved commit" or "is not an ancestor of HEAD" needs regenerating and approving again, not a workaround.

**Before you start**
- **A quiet machine with 64 GB.** Nothing else heavy runs beside it: no other simulation, no `next build`. Note swap before you start. On the national file, #112 measured 22.5 GB of peak footprint for one measure over six years; this run measures the local file.
- **This branch, with its own environment:** `uv sync --extra dev --frozen` and `bun install`, from the repository root.
- **`HUGGING_FACE_TOKEN`**, which must read `policyengine/populace-uk-private`.
- **`UK_BUDGET_DISCLOSURE_AUDIT_DIR`**, a directory outside any git repository. The private audit and each measure's household arrays go there, readable by you alone. The arrays are record-level data derived from the survey: keep the directory on this machine, out of any synced or shared folder. Once the table is merged, delete the arrays (the run directory's `units/` and `dataset.npz`) and keep the audit.
- **Approvals.** Like `geography`, the command takes approved ids only, from `public/data/manifest.json`. If the manifest is missing, or doesn't approve a measure, it stops before it downloads or simulates anything, and names each refusal. A manifest given with `--manifest` that isn't the publication manifest can't write into any repository: pass an `--out-dir` outside one.
- **Disk:** about 0.7 GB for the cut, in the Hugging Face cache, and a few hundred MB in the private directory.

**The command**

```sh
uv run uk-budget-data constituencies --dry-run   # resolve and check the cut, check the gates, print the plan
uv run uk-budget-data constituencies --fresh     # the run; --fresh simulates every measure again, for the timing table
```

What it does, in order:
1. **Resolves the cut:** the latest tag of `policyengine/populace-uk-private` named `microcosm-uk-2024-25-dense-<YYYYMMDDTHHMMSSZ>-<8 hex digits>` (the local-area release is published as tags only), or `--cut <tag>`.
   - The cut's release manifest names its file and the file's SHA-256. The Hugging Face metadata and the downloaded bytes must match it, and the cut must be built for the installed policyengine-uk.
   - The latest cut must be the one the installed bundle routes constituencies to. If it isn't, the command stops and says which `--cut` to pass.
   - `--dataset <path>` uses a copy you already have, checked against the same SHA-256.
   - The dry run fetches the file too, so the real run starts with it in place.
2. **Plans the run** with `geography`'s own checks (`geography._plan`), and checks a published `public/data/regional.csv`, if there is one, against it: that table is the release's prior. Then, as `geography` does before simulating, it compares each reform's baseline and reform identities with its approved receipt (`geography.area_provenance`) and stops on any mismatch. If a `regional.csv` is already in `--out-dir`, its record in `area_provenance.json` must match its bytes and bind each measure in both tables to the same approved entry; otherwise the command stops and asks for the regional run first.
3. **Simulates each measure, then the package, in a fresh process** under `/usr/bin/time -l`, with `HDF5_USE_FILE_LOCKING=FALSE`. Each builds its two simulations, reads each year's household net income and weights under the data-limit watch, then runs the data-limit and model-limit checks, as `geography` does for each measure. The arrays go to the private run directory, `$UK_BUDGET_DISCLOSURE_AUDIT_DIR/geography/constituencies-<the cut's 8 hex digits>/`.
4. **Stops on a limit.** If any measure touches a data or model limit, the command prints the reasons and writes no table, as `geography` does. It then prints the `--reforms` to run again with: the measures left, without the package. On policyengine-uk 2.132.6, expect the three VAT measures (`fuel_duty_rise_deferral`, `domestic_electricity_zero_vat` and `road_fuel_vat_cut`), and so the package, to be held by the VAT model limit (policyengine-uk #2187; see "The area view is held too" above). Run again with those `--reforms`: the measures already simulated are reused, so only the release runs.
5. **Builds one disclosure release over every measure**, in a fresh process too: the estimates, the layer's checks, resolution and the private audit (`microcosm-<time>/` in the run directory), then `public/data/constituency.csv` through `geography.write_public_tables`, which replaces the file only once `validate_public` finds 0 problems. A demoted run stops it unless you pass `--allow-demotions`.
   - Last, `public/data/area_provenance.json`, which `publish index` reads before it binds the table: each reform's approved entry and identities, and the SHA-256 of `constituency.csv` and of any `regional.csv` beside it. The regional table's reforms are recorded as its own run recorded them, checked again against its bytes. It is written on your machine once the table is back, on either backend (on Modal, not in a container). If the regional table changed during the run, the new `constituency.csv` is removed and the command stops.
6. **Prints** the table's SHA-256, the review row to add, the files the provenance records, and the timing table.

**Resuming.** A run that stops (Ctrl-C, a crash, a measure killed for memory) resumes with the same command. It reuses every measure already simulated for the same cut, years and code (the package's code, `uv.lock` and the two lookups). `--fresh` simulates everything again, and `--run-id` picks another private run directory.

**What to expect:**
- Like every Microcosm area run, it prints the uncertified label at the start and the end, and records `certified: false` in the private audit (see "Results by area" under G4).

**After the run**
1. Review the table and the private summary: `summary.json` in the private audit directory, with tiers, withholdings and demotions. Never copy a figure from either into a pull request, commit message or comment.
2. Bind the table, as at G4 ("Bind the results by area last"): `uv run uk-budget-data publish index`, then `uv run uk-budget-data publish check`. `publish index` reads `area_provenance.json`, and refuses the tables if an entry the run used has changed since.
3. Add the review row the command printed to `data_inputs/public_data_review.csv`: kind `disclosure_table`, the table's SHA-256 (check it with `shasum -a 256 public/data/constituency.csv`), your name as reviewer, today's date and the basis. Then `uv run uk-budget-data publish review-rows --reviewer <name>`, as at G4, writes the rows for `area_provenance.json` (`publication_provenance`), the manifest and `release-index.json`.
4. Run both checks. Each must report 0 problems:

   ```sh
   uv run python scripts/check_public_data.py
   bun scripts/check-public-files.mjs
   ```

5. Commit `public/data/constituency.csv`, `public/data/area_provenance.json`, the manifest and `release-index.json` that `publish index` wrote, and `data_inputs/public_data_review.csv` to this branch, and nothing else from the run: the private directory stays outside the repository. Name the cut and the measures in the commit message, never a figure.
6. Paste the timing table into a comment on the pull request. It is printed at the end, and kept as `timings-<time>.md` in the private run directory. It holds times and memory only. Posting it on #115 waits for María's go.

**If a regional table is published after this one,** run the command again: it takes `public/data/regional.csv` as its prior when the file is there, and reuses every measure, so only the release runs. The release then keeps that table's withheld cells withheld, and checks the seats against its published cells. A regions-only `geography` run (`--levels region`) writes an `area_provenance.json` that records only `regional.csv`, so `publish index` refuses `constituency.csv` until this second run records both. Then bind them again with `publish index`.

**What the page shows.** Each measure on its own, by constituency, and the package when every measure is selected: the catalogue's combined run of exactly the measures the page can display (`combinedId`), which `publish index` names for the table's package alias.
- A measure the run left out reads "Results by constituency are not yet published for this measure."
- With the package left out, all measures together read "Results by constituency are not yet published for the full package."
- While `public/data/constituency.csv` is absent, the view reads "Results by constituency are not yet published." On a release that routes no results by area, it reads "Results by constituency are not available on this release.", and the command refuses to run.

### Results by constituency on Modal

The same run, with each measure in its own Modal container and the release in one more (`--backend modal`). The plan is made here as above. Each container downloads and checks the cut itself; no dataset file is sent. The units' arrays and the disclosure audit stay on the private Modal Volume `uk-budget-2026-constituencies-private`; only `constituency.csv` and the timings come back, and the table is checked with `validate_public` here. The receipt check runs here before the app starts, and `area_provenance.json` is written here after the table comes back.

Uses the workspace's existing Modal secret `pe-uk-private-hf-read-token` (key `HUGGING_FACE_TOKEN`, a fine-grained read-only token for `policyengine/populace-uk-private`; created by Anthony). It was checked on Modal on 25 October: it reads the local-area cut. Decisions to run the data on Modal and to use this secret: issue #119.

```
UK_BUDGET_DISCLOSURE_AUDIT_DIR=~/ab2026-private-audit \
  uv run --with modal==1.6.2 python -m uk_budget_data.cli constituencies --backend modal
```

- **Containers:** 4 CPU and 64 GiB each (sized from #138's laptop target; lower once a real run has measured the peaks), at most 16 at once, so 15 measures and their package run in one wave, no retries, a 90-minute timeout, no warm containers. The app stops when the command ends. Modal still restarts a container it preempts, with the same input (seen once in drill 5).
- **Cost:** about $0.70 per container-hour at 4 CPU and 64 GiB. Ten measures of about 20 minutes each plus the release come to roughly $3; the worst case, all 16 units hitting their timeout, about $17. The cap changes how many run at once, not how much is simulated. Check with `uvx --from modal modal billing report --for today` before and after.
- **Build the image before the day, after every pin change.** A new `uv.lock` (a new policyengine wheel, say) means a new image, built the first time the command runs: 12 minutes in drill 5 (#144), before any container starts. Run both smoke tests once after the pin is set; they need no secret and no data, and leave the images built:

  ```sh
  uv run --with modal==1.6.2 python scripts/budget_day/modal_smoke.py --root /tmp/modal-smoke threshold_freeze_2031_32
  uv run --with modal==1.6.2 python scripts/budget_day/modal_constituencies_smoke.py
  ```

- **Where the time goes** (drill 5, 26 October, 10 measures on policyengine-uk 2.132.6): 3:36–5:22 per measure, all at once, then **15:25 for the release in one container**, 21:18 in all. The release is serial, so more containers don't shorten it. On policyengine-uk 2.151.0 each simulation takes about twice as long (#144).
- **No reuse:** every Modal run simulates every measure again. The refusal message's "run again … the measures already simulated are reused" holds for a local run only: on Modal the units' records stay on the Volume, so the rerun simulates them again (about 5 min).
- **Smoke test (no secret, no data):** `uv run --with modal==1.6.2 python scripts/budget_day/modal_constituencies_smoke.py`. On 25 October: ten units fanned out in 23 s end to end (1–2 s in each container), the release read them all back in 8 s, 53 s in all including the image build.
- **Measured on the real cut, 25 October** (`main` at 63c61a1 with #138 merged in; cut `…-ee5c2dbe`; a timing-only scratch manifest and a scratch `--out-dir`, nothing published):
  - **All ten units at once (`--fresh`): 7:05 end to end**, 3:28–6:35 per container, peak resident 33.5–42.2 GB. Four were refused by the model-limit gate (`fuel_duty_rise_deferral`, `domestic_electricity_zero_vat`, `road_fuel_vat_cut` and the package), so no table was written. That is the gate working, not Modal.
  - **The six admissible measures, then the release: 13:53 end to end**, 3:40–5:16 per measure, then 8:07 for the release in one container (7.5 min of it estimating). `validate_public` found 0 problems in `constituency.csv`.
  - **Before:** 2–3.5 h on the 64 GB laptop (#138, #115).
  - **Cost** (Modal's billing report): $0.70 for the ten-unit run, $0.51 for the six-plus-release run.
  - **Peaks are under 43 GB,** so 48 GiB containers would do. That would cut the memory part of the cost by a quarter; not changed here.
  - **Main publishes no `constituency.csv`,** so there is no published table to compare with.
- **Measured again from `main`, 26 October** (`main` at 9305d80 with #142 merged in, no #104; a timing-only scratch manifest built from `main`'s measures, marked "TIMING ONLY, not an approval"; scratch `--out-dir` and audit directory; nothing published): the six admissible measures, then the release, **14:32 end to end**, 3:48–6:32 per measure, 7:32 for the release, peak resident 33.3–39.5 GB. `validate_public` found 0 problems in `constituency.csv`. The laptop's process stayed under 0.4 GB.

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

**State Pension measures from 2027-28, in a pair with #2336 but without #2557** (coordinator on #90, 22 October): no longer needed. 6.11.1's pair has both, so the 2027-28 baseline's add-on uses the published September 2026 outturn.

**Where they go:** the data limitations describe the national results, not the household calculator, which uses the visitor's own ages and incomes; whatever is placed should say so. The model gaps can also reach a household answer wherever the household has the circumstance, for example a full-time student claiming UC. The dashboard has no methodology section today. The only data notes are in two measures' descriptions in `App.jsx`, which #3 rewrites. The briefing has no template yet; #22 exports its tables. Where the text sits is your call.

## Briefing (overnight, by 07:00)

**Before it goes, the same comparables review as the first cut:** dated within 7 days for each analysis featured, with an unexplained gap of more than 25% pulled or explained.

Exports are built only from approved entries of one manifest revision. A measure held at the first cut joins the briefing once it is approved. Each chart is stamped with the model, the data and the manifest revision (#22, a draft). Use no figure that is not in that revision.

## Team test link

The team's live test link is https://ab2026-local-preview.vercel.app/uk/autumn-budget-2026 (Vercel `ab2026-local-preview`, public, no login). It shows the local checkout's untracked data in `public/data`. Redeploy it after each local load: the G2 measures, the package, then the area run.

```sh
tools/deploy-test-link.sh [household-api-url]   # default: the Modal test app; or set HOUSEHOLD_API_URL
```

- It refuses unless `public/data/manifest.json` exists, has at least one provisional measure (so the page shows the "Provisional" banner), and isn't the manifest production serves.
- It links the checkout, builds with `next build` (skipping `check-public-files`, which refuses unsigned rehearsal data while sign-off is on), deploys, and checks the link returns 200. `vercel.json`, `.env.local`, `.gitignore` and `.vercel/` are restored on exit, and nothing is committed.
- **Rule:** this is a team link, not publication. Real publication is still the gated path: #207, then `main` (signed while sign-off is on), then the production Vercel deploy.

## Rollback

- **Dashboard.**
  1. Use Vercel Instant Rollback to the recorded previous production deployment (dashboard, or `vercel rollback <deployment> --scope policy-engine`).
  2. Revert the bad merge through a pull request, and wait for its deployment to build. This repository merges with merge commits, so use GitHub's Revert button or `git revert -m 1 <merge>`; a plain `git revert` of a merge commit fails.
  3. Run `vercel promote <fixed deployment> --scope policy-engine`. After a rollback, Vercel stops assigning the production domain to new deployments, so the fix does not go live until it is promoted. Promoting also turns automatic assignment back on.
- **Don't roll the household API back past `00024-lir`.** An older revision can't serve the live page's Personal impact tab, and a dashboard deployment from before #69 has no working Personal impact tab at all (see "Live and rollback target" above).
  - **Once the page compares definitions (the follow-up to #104), the floor moves up** to the first revision deployed with #125. An older revision reports no definitions, so the page would show every measure as unavailable in Personal impact. That fails closed, but it leaves the tab empty. That is why the follow-up merges only once the recorded rollback target is at or above this floor ("Adopting a release").
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
