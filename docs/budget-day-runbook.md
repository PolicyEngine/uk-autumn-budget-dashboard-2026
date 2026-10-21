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
  - Serving revision and image: record after the last deploy before the day. On 19 October it is `uk-budget-api-2026-00018-xuv` (git `5324080`; policyengine 6.6.0, policyengine-uk 2.130.1, core 3.33.0), deployed on 16 October.
  - **How long one household answer takes.** One full `/api/personal-impact` request covers six years and eight measures. Cloud Run serves it on 2 CPUs with a 300 s request timeout, and the deploy's smoke test makes the same request. Timings on Cloud Run are under "Deploy and roll back once" below: 77 to 177 s on `00018-xuv`. So every visitor waits more than a minute for a household answer on the day, and a route that gets slower fails the smoke test and never takes traffic. Don't loosen the smoke test or raise the timeout to get a deploy through. Time #3's route against these figures.
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
- [ ] **Household fixtures: add at least one before the rehearsal.** On `main`, `data_inputs/household_fixtures/` (#15) holds only its README and a draft example (`example-zero-income.json`, marked `"draft": true`), which the checker skips. The check passes only when it has checked at least one fixture, so until one exists the household check exits 1 at G0, G2 and G4. Each fixture needs answers computed independently of the API; the README says how. Proposed: María's specimen households.
- [ ] **Nothing published says 2025.** The repository began as a copy of last year's dashboard. Checked on 13 October against `main` (93d0609) and #3; the first two rows re-checked on 19 October against `main` (5324080):

  | Where | What it says | Shown today? | Who fixes it |
  |---|---|---|---|
  | `public/combined_reforms/*.html` (five pages) | Four titled "Combined Autumn Budget 2025", and an untitled `revenue.html`, all with last year's figures | **No.** Removed by #26 (15 October), which also tests that no static page names another year's Budget | Done. The briefing export (#22) writes this year's from an approved manifest |
  | `public/data/budgetary_impact.csv`, `distributional_impact.csv`, `winners_losers.csv`, `metrics.csv` | Last year's results: all four last changed on 8 December 2025 and are byte-identical to `ec29ebd`. (`household_scatter.csv` was withdrawn from every public path by #30, 15 October.) | **Yes**: `main`'s main route (`App.jsx`) fetches them and charts them under the 2026 heading once a policy is selected. For example, `?policies=two_child_limit` shows −£2.95bn for 2026 and −£3.72bn for 2030 (#26 review, 15 October). Served at `uk-autumn-budget-2026.vercel.app`, which deploys `main` | #3 regenerates them. Until it merges, the production URL shows last year's numbers; whether to hide them meanwhile is your call |
  | `OBRComparisonTable.jsx` | "November 2025 Economic and Fiscal Outlook", with a link to it | **Yes**, on the Population impact tab, when its OBR comparison panel is opened | #3, which changes the file and stops showing the table |
  | `LifecycleCalculator.jsx` | "Household inputs (2025)", "Ages of children in 2025", "2025 £" | **Yes**, on the Personal impact tab (it calculates only if `NEXT_PUBLIC_LIFECYCLE_API_URL` is set) | #3 replaces the tab. The file is unused afterwards and can be deleted |
  | `PersonalImpactForm.jsx` | "Your annual employment income (2025)", "Children (ages in 2025)" | Not on `main`. **Yes once #3 merges** | #3. Its `build_situation` grows income and ages from a 2025 base, so this is a choice of base year, not only a label |
  | `policyConfig.js` in #3, and the flat `public/data/*.csv` | A policy named "Autumn Budget 2025 (combined)" (id `autumn_budget_2025_combined`), with last year's rows | In #3, only through an old shared URL | #3 keeps it for old links: **your call** whether a 2026 page should still answer them |
  | `Results.jsx`, `HouseholdImpactChart.jsx` | "2025 to 2030"; a hardcoded "in 2025" figure | No: nothing imports them, on `main`, in #3 or in the drills | Left alone. Delete them, or fix them before wiring them back |
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

  - **Live and rollback target, 19 October:** `00018-xuv` is live. The rollback target is `00016-tes`, the revision it replaced, which passed the smoke test when it was deployed.
  - **The household route can exceed 2 GiB.** Cloud Run killed two instances for exceeding the 2 GiB limit. Those are the only two such kills since 12 October, from the coordinator's read of the logs:
    - `00004-fur` at 12:40:03Z (2050 MiB), which gave step 2's 503;
    - `00003-jic` at 10:09:59Z (2054 MiB), during the first deploy's smoke test, so that 504 may have been memory as well as the 300 s limit.

    One full request, or a later request on an instance that has already run some (policyengine-core keeps what each build registers), could pass 2 GiB then. A smoke test or a rollback can therefore fail on memory, and retrying is not a fix. The memory setting is in the capacity decision going to Max.
  - **Memory since #49:** the `read-api-memory.yml` workflow (#54) read a peak of 0.62 of 2 GiB on `00016-tes` and 0.65 on `00018-xuv` (p99 per minute, over the timing runs below), with no out-of-memory kills.
  - **Cold start:** 32.6 s to the first response from an idle revision (`/api/version`).
  - **How long one household answer takes on Cloud Run, one request at a time:**

    | Request | `00004-fur`, 15 October | `00016-tes`, 16 October | `00018-xuv`, 16 October |
    |---|---|---|---|
    | £30,000 earner | 142.5 s | 85.0 s | 77.5 s |
    | Couple on £40,000 and £20,000, children 3, 6, 9 and 12 | not timed | 94.4 s | 87.1 s |
    | £40,000 earner, children 19, 22, 24 and 13 | 504 after 300 s | 187.6 s, then 195.8 s | 176.7 s, then 171.7 s |

    The last household has two children who turn 25 within 2025-30, so it is built three times over, and it is the slowest answer found. It failed on `00004-fur` (which had #42); it answered on `00016-tes` and `00018-xuv`, after #46. The 16 October timings are sequential `curl` requests to the live URL; each answer's `Server-Timing` header gives the calculation's own time, which was within 0.3 s of the total.
  - **One calculation at a time per instance.** Since #45 the calculation runs off the event loop, so `/api/version` answers meanwhile. But calculations still run one at a time per instance, in arrival order (`CALCULATIONS` in `api.py`): several at once share the CPU and all finish later. The deploy doesn't set Cloud Run's `--concurrency`, so its default of 80 applies. A second visitor to the same instance waits for the first, and a visitor whose wait plus calculation passes 300 s gets a 504. How many visitors an instance takes, and the cost of more instances, is Max's call, through the coordinator.
- [ ] **Rehearsal.** Intake, dashboard and briefing on the deployed routes, including one model upgrade and regeneration. Record the receipt here. Repeat after any material change.

## How a measure must be written

Every published measure is receipted, and the receipt can only bind a measure written in one of these forms:

- **`parameter_changes`**, wherever the measure can be expressed that way.
- **A module-level function** as `simulation_modifier`, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. The tested templates (#23) are helpers to call from such a function.
- **In a module of fixed shape**: only imports, literal constants and undecorated functions, each name bound once. Not in `reforms.py`, whose run-time caches make every modifier in it unbindable (question 6 in `budget-day-publication.md`). `tests/template_measures.py` is the pattern.

**A measure on pension tax relief, the annual allowance, its taper or the MPAA is expected to fail the Treasury reconciliation. By default it is held for the 07:00 briefing pending review** (Vahid and María to confirm).
- **Why:** the UK hub's rebuild of policyengine-uk #2240 replays the Spring Budget 2023 pension changes at about −£12.9bn over four years against the OBR's −£1.55bn, roughly 8 times over. The remaining causes are mostly data: the imputation of pension inputs, defined-benefit accrual, the taper's income measure and carry-forward. A pensions decomposition is queued; revisit this row when it reports.
- **The limitation sentence** (final; from the UK hub, 16 Oct, for the dashboard methodology and wherever such a measure is listed):

  > "The model overstates the pension annual allowance charge: for 2024-25 it finds 262,000 people with pension savings above their allowance, against 30,440 in HMRC's provisional self-assessment statistics for the same year, and £2.7 billion of annual allowance charge against HMRC's provisional estimate of £0.3 billion, so pension tax relief and annual allowance measures are not published on Budget day without review."

  - **Sources, all tax year 2024-25:** HMRC private pension statistics (July 2026), Table 7, row "2024 to 2025 [provisional]": 30,440 individuals reporting contributions above their allowance through self assessment. Table 6, column "2024 to 2025 tax year [provisional]": £300m of annual allowance charges. The model's 262,304 people and £2.699bn are model year 2024 (tax year 2024-25), from uk-data 1.58.1 with policyengine-uk #2240's charge formulas: counts and aggregates only.
  - **Cause:** the hub's research report (`~/reviews/uk-hub/jobs/research-sb2023-aa-gap/REPORT-full.md`) attributes it mostly to the imputation of employer pension contributions, tracked as uk-data#606, which lands after the Budget.
- **What the gate does:** approval needs the reconciliation to pass or carry an accepted exception, and the briefing exports take approved entries only. So such a measure stays out of the briefing unless someone approves an exception. The default is to hold it, not to approve a named-reviewer exception on the day.
- **Still open, for Vahid and María:**
  - whether it is shown on the page meanwhile: staging it as provisional does not need the reconciliation, and the page labels it provisional;
  - who may approve an exception for it, if anyone;
  - where the limitation sentence appears on the page (the methodology section, the measure's own entry, or both).

**A measure on the SDLT higher rates, or on non-residential purchases, is published as not computable on current data, never as a figure** (#51).
- **Once #51 merges.** #51 is a draft, to merge before the rehearsal. Nothing below is on `main` until then, and nothing stops such a measure: hold it by hand.
- **Why:** policyengine-uk #2241 (merged 15 Oct, fixing issue #2238) makes `additional_residential_property_purchased` and `non_residential_property_purchased` inputs, nil unless a dataset imputes them. The certified dataset (uk-data 1.58.1, sha256 `056e80fd…`) holds only the property stocks, not those columns. So these rates apply to nothing; before #2241, to a buyer's whole stock of other property.
- **Which parameters:** `uk_budget_data.data_limits` lists them:
  - SDLT `gov.hmrc.stamp_duty.residential.purchase.additional` (the higher rates for additional dwellings) and `gov.hmrc.stamp_duty.non_residential.purchase`;
  - the LBTT additional dwelling supplement and non-residential rates;
  - the LTT higher residential and non-residential rates.

  Main-home rates are computable.
- **What happens:**
  - generation records the limit in the measure's receipt, whether the change is in `parameter_changes` or a modifier, on either side;
  - `publish stage` lists it as `not_computable`, with the reason, whatever level was asked for;
  - every level that shows a figure refuses it, and so does approval;
  - the page shows "Not computable on current data" and the reason, never a number;
  - a combined package that includes such a measure is not computable too, since its total would leave that measure out;
  - building one with the templates warns (`DataLimitedWarning`).
- **What to say:** the measure is in the Budget, but the survey data can't cost it yet. Where to place that wording, and whether a package total excluding it should be shown separately, is Vahid and María's call.
- **When it lifts:** once certified data impute the purchases (policyengine-uk-data #573, with #569; Max's decision d1354). `tests/test_data_limits.py`'s certified-data tripwire then fails, and the limit is removed in that bundle's adoption PR.
- **Before #2241 is in a certified bundle,** a higher-rates figure from the engine charges whole stocks, so it is wrong as well as uncertain. The limit applies from now.
- **Every measure published on the day comes from the templates, unless it passes the human check below** (`uk_budget_data.measure_templates`, bound from a fixed-shape module like `tests/template_measures.py`; coordinator's ruling on d1625, 16 Oct). The detector watches what changed formulas read as the run calculates, but no check of this kind can be proven against arbitrary code. Issue #55 lists what it can't see.
  - **A hand-written modifier needs a named human check of its data limits before it publishes.** The reviewer confirms whether it changes how additional-dwelling or non-residential purchases are priced. They record their name and finding in the measure's PR. If the detector marks it not computable, either convert it to a template or accept that it's withheld; don't try to defeat the probe (coordinator, 18 Oct).
    - **Reject the modifier if its own code uses any of these** (coordinator's ruling on #51, 19 Oct). The detector isn't required to see through them, so #55 lists what they can hide:
      1. **another simulation or system:** building or holding a simulation or tax-benefit system other than the one it's given (a clone, or a branch with a cloned system), or that simulation's parameters, entities, populations or holders;
      2. **state changed mid-run:** changing state its formulas hold (a dict, a list, an object's fields) while the simulations run;
      3. **a metaclass:** any class whose metaclass isn't plain `type`. That includes `ABC` bases and other `abc.ABCMeta` classes, and virtual subclasses registered with `register()`, which change what `isinstance` and `issubclass` return (coordinator, 21 October).
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
  - (The source forms listed here until #51's round 13 are no longer false positives, since reads are now watched as the run calculates: lambdas and callable wrappers, results in containers, annotation-only statements, unreadable state, and names built at run time.)
  - **To clear one:** there is no override. Rewrite the measure in a form whose reads the watch sees: a template, or a call to the original used for its result. Make sure nothing calculates the changed variable before the run, and don't write a limited input's name in code that runs. Then regenerate, and record the reason in the measure's PR.

**A UC health (LCWRA) measure: change the rebalancing amounts, not the element's amount.** In 2026 to 2029 the engine's UC rebalancing overwrites every claimant's health element:
- pre-2026 claimants get `gov.dwp.universal_credit.rebalancing.protected_health_element` (or the UC Act 2025 s. 4 floor where that is null);
- new claimants get `gov.dwp.universal_credit.rebalancing.new_claimant_health_element`.

These are monthly amounts. A change to `gov.dwp.universal_credit.elements.disabled.amount` in those years therefore scores £0: on policyengine-uk 2.130.1, £600 a month on it moved no claimant's element in 2026 or 2029, while £600 on the claimant's rebalancing amount gave £7,200 a year. In 2025 and 2030 it is the other way round: only the element's own amount moves the element.
- **Switching `rebalancing.active` off is not the law before the Universal Credit Act 2025 either:** the 2026 element amount is already the new claimants' rate, so every claimant would get it.
- **Build the measure with `uc_health_element_change(protected=..., new_claimant=...)`** (#47), for 2026-29. The templates refuse the element's amount in 2026-29, and `rebalancing.active` in any year.
- **From 2030, change the element's own amount** with `rate_change(UC_LCWRA_AMOUNT, ...)`. The rebalancing has stopped, so every claimant, protected or not, gets that amount (next bullet).
- **Found by the UK hub.** It is drafting an engine-side fix for a certified release before the 28th. If that changes how these parameters work, re-check this row.
- **2030-31 UC will move up when a fix for policyengine-uk issue #2282 is certified.** The rebalancing runs for 2026 to 2029 only (`range(2026, 2030)` in `uc_reform.py`, policyengine-uk 2.130.1). So in 2030 every protected claimant's element falls to the formula's amount, the new claimants' rate, and the 2030-31 baseline understates UC (UK hub). The fix extends the rebalancing. Once a certified bundle with it is adopted:
  - the dashboard's 2030-31 UC figures rise, and so does any measure's 2030-31 effect that runs through UC. That is a correct change to the baseline, not a regression: say so wherever those figures were shown before.
  - #47's engine table (`tests/test_uc_health_template.py`) fails at 2030 until `UC_REBALANCED_YEARS` follows, so a 2030 measure on the element's amount can't quietly start scoring £0. The fix is policyengine-uk #2428 (approved, not yet released; UK hub, 15 Oct). It extends the rebalancing to 2032 and exports the years as `policyengine_uk.scenarios.uc_reform.REBALANCING_YEARS`. In the adoption PR for the first certified bundle with it, set `UC_REBALANCED_YEARS` from that export, so UC health measures for 2026–2032 go through `uc_health_element_change`.
  - policyengine-uk #2284 (merged 15 Oct, UC Act 2025 s. 3) freezes the element's amount through 2029-30, so 2030-31's baseline amount falls from £235.86 to £221.60 a month. It changes no template rule.

**Dated changes: key every year by its bare fiscal year.**

| Key | What it means | Use it? |
|---|---|---|
| `"2027": 0.21` | The whole UK fiscal year 2027-28, 6 April 2027 to 5 April 2028. The national run and the household calculator both read it. | **Yes.** List every year the change applies, through 2030. |
| `"2027-04-06": 0.21` | That one day only. Depending on the parameter, the year's figure either does not move at all (the personal allowance; tested in #23) or moves by about one day's share of the change. Fuel duty, for example, moved by 0.27% of the change in 2027-28 (probe, 14 October, policyengine-uk 2.126.12). | **Never.** |
| `"2027-04-06.2100-12-31": 0.21` | In the national run, on policyengine-uk 2.126.12: every year from 2027-28 on, held flat. In the household calculator: on `main` since #32 (15 October), as the national run reads it; in #3, 2027 only, because it keeps a key for the year its first four characters name (`annual_reform_parameters`). | **No.** The national figure would move in years where #3's household calculator showed no change. |

**#3's household calculator moves less than the national figure for some measures** (probed 15 October). #3's calculator (`calculate_personal_net_income`) writes a change on 1 January only, while the national run applies it to the whole fiscal year before policyengine-uk derives its other parameters. `main`'s did the same until #32 (15 October; issue #33). One earner on £50,000, 2027:

| Change | Household calculator | National |
|---|---|---|
| Fuel duty to 90p (monthly `fuel_duty` sees January only) | −£25.05 (#3) | −£300.62 |
| Beer duty to £30 (a calendar-preserved duty) | £0.00 (#3) | −£37.10 |
| Personal allowance to £20,000 (read on 1 January) | +£1,486.00 | +£1,486.00 |

On 1 January only, the registered `fuel_duty_freeze` showed exactly 1/12 of its national effect for every household and year. Building the household reform through `Scenario(parameter_changes=…, simulation_modifier=…)` with the measure's bare-year keys, as the national run does, closes every gap found. #32 did that for `main`'s calculator, checked by `tests/test_household_route_parity.py`, which no longer expects any gap. **Your call**, for #3.

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
uv run python -m uk_budget_data.certified_data             # the bundle's data, by hash (#12)
REQUIRE_CERTIFIED_DATA=1 uv run pytest tests/ -m certified_data
curl -s "$HOUSEHOLD_API/api/version"                       # must match the bundle (#15)
uv run python -m uk_budget_data.household_route \
  --base-url "$HOUSEHOLD_API" --fixtures data_inputs/household_fixtures \
  --expect-model-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine-uk"))')" \
  --expect-core-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine-core"))')" \
  --expect-wrapper-version "$(uv run python -c 'import importlib.metadata as m; print(m.version("policyengine"))')" \
  --out receipts/g0-households.json
uv run uk-budget-data publish check                        # (#19)
uv run uk-budget-data publish status
```

Record in the clock table:
- the start SHA;
- the manifest revision and its execution identity;
- the dataset SHA-256;
- the household API identity;
- the basis in `data_inputs/publication_basis.json` (expected `pre_budget`).

**The gate fails** if any command fails, or the API's versions differ from the bundle's. Until a non-draft household fixture exists, the household check exits 1 (see "Household fixtures" above). The household check takes the bundle's versions from the installed packages here, because `main` has no `public/data/manifest.json` until the first entry is published (`--manifest` on a missing file exits 2). Once a manifest is published, pass `--manifest public/data/manifest.json` instead, as at G4.

## G1: coverage (12:30 to 12:45)

María classifies every statement measure as `coded` or `ledger`, with a reason, in the coverage ledger.

## Construction (from G1)

For each coded measure:
1. **Write it** in one of the bindable forms above: a template called from a module-level function, in a fixed-shape module, not in `reforms.py` itself (question 6 in `budget-day-publication.md`). Register it in `reforms.py`, which imports it, and in `policyConfig.js`.
2. **Declare what it should do** in `data_inputs/treasury/expected_effects.csv`. The columns are `measure_id,direction,from_year,to_year,reviewer,note`; `to_year` and `note` may be blank. `positive` improves the government balance and `negative` worsens it. Without this, and before any Treasury figure exists, the measure is "undeclared" and cannot be published.
3. **Add one numerical test.**
4. **Commit.** A receipt from a dirty tree is not publishable.

## G2: provisional numbers (13:15)

```sh
uv run uk-budget-data generate --artifacts --reforms <ids> \
  --years 2026 2027 2028 2029 2030
uv run uk-budget-data publish reconcile public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish stage --provisional public/data/artifacts/<id>/<digest>/
uv run uk-budget-data publish check
```

- **One artifact per measure.** `generate --artifacts` writes one new directory per measure and never touches another measure's. It prints each directory it wrote; use that path in the commands that follow.
- **Supported years.** Years the dataset does not cover (2031 onwards on the current bundle) are recorded as unsupported. The page shows them as unavailable once #20's modules are wired in after #3.
- **What "provisional" needs.** The measure must move in the declared direction. A measure that returns zero, or the wrong sign, is refused.
- **Household check.** One hand-checked household per measure, through the deployed route: add its fixture to `data_inputs/household_fixtures/` and run the `household_route` command from G0, writing `receipts/<id>-households.json`.
- **Publish.** Open a pull request, wait for the checks, then merge, which deploys. The page labels these "Provisional: statement figures, awaiting Treasury costing" once #20's modules are wired in after #3.

## Documents arrive (13:40)

**Download the OBR's workbooks in a browser, by hand.**
- **Who:** María, with Vahid as backup. *Proposed; yours to confirm.*
- **When:** as soon as the documents publish, about 13:40 in the drill timetable.
- **Why by hand:** obr.uk refuses scripted downloads, and not always the same way.
  - W3 saw HTTP 403.
  - uk-data #536 records a 200 answer that is an HTML page titled "No Access - Office for Budget Responsibility" instead of the workbook.
  - On 15 October, from W5's machine, the March 2026 EFO receipts workbook downloaded by script, but the expenditure workbook got that "No Access" page.

  A browser download works.
- **What:** the EFO's detailed forecast tables, at least receipts and expenditure. W3 lists the full set.
- **Where the files go:** to W3's Budget-day ingest in policyengine-uk-data, which records each file's SHA-256, vintage, units, geography and year coverage. Today the OBR loader's fallback reads committed workbooks from `storage/obr_efo/` (uk-data #536). W3 to confirm the path for the Budget-day files.
- **Record:** each file's name and SHA-256 (`shasum -a 256 <file>`) in the coverage ledger as it lands, so the ingest's record can be checked against what was downloaded.

**Treasury tables come from gov.uk by script.** On 15 October `assets.publishing.service.gov.uk` served a spreadsheet to both curl's and python-requests' user agents (HTTP 200, the right content type), so gov.uk does not refuse scripted downloads. The importer below reads a workbook from a local path and fetches nothing itself. If gov.uk does refuse on the day, download Table 4.1 in a browser the same way and pass its path.

```sh
uv run python -m uk_budget_data.treasury_import <Table 4.1 xlsx> \
  --source-id AB2026-T4.1 --document "Autumn Budget 2026" \
  --out data_inputs/treasury/sources/AB2026-T4.1.csv \
  --static-template data_inputs/treasury/sources/AB2026-static.csv      # (#16)
```

- **Totals check.** The importer checks the rows against Table 4.1's printed totals and stops on a mis-keyed row.
- **Static costings.** María fills `AB2026-static.csv` from the policy costings document. These static costings are the gated comparator.
- **Mapping.** María fills `data_inputs/treasury/mapping.csv` (measure to row). A row outside scope or on a different basis is marked `not_comparable`, with a reason and reviewer. A `scale` other than 1 also needs a reason and reviewer, and must be above zero (#17).

## G3: rebase and reconcile (13:40 to 14:10)

- **If the forecast is rebased** on the Budget's OBR tables: update `data_inputs/publication_basis.json` (`forecast.status: updated`, with source and vintage), regenerate every measure, and stage with `--adopt-basis`. Every entry on the old basis becomes stale.
- **Reconcile** each measure: `uv run uk-budget-data publish reconcile <artifact>`. A year passes within 10% or £50m of the static costing, whichever is larger. *The numbers are still to be agreed.* Every year the artifact reports must have one model output; a missing year fails and no exception can accept it (#17).
- **A failed year** is fixed, or María adds an exception to `data_inputs/treasury/exceptions.yaml`:
  - one of the closed explanation classes;
  - a quantified explanation;
  - the reviewer's name;
  - the artifact's `outputs_sha256`;
  - the failed row's `comparator.sha256` from `reconciliation.json`, as `comparator_sha256`. The exception then lapses if any Treasury figure, mapping or the basis behind that comparison changes (#17).

  Then reconcile again.
- **Approve:**

  ```sh
  uv run uk-budget-data publish stage public/data/artifacts/<id>/<digest>/
  uv run uk-budget-data publish approve <id> --by "María Juaristi" \
    --household-receipt receipts/<id>-households.json
  ```

  Approval is refused until every gate passes. It names the exact outputs approved and stores the household receipt in the manifest. *The household receipt is optional in the code today; it becomes required once the fixtures exist.*

## G4: combined run and publish (14:50)

```sh
uv run uk-budget-data generate --combined <all coded ids> --years 2026 2027 2028 2029 2030
uv run uk-budget-data publish stage public/data/artifacts/combined--<ids>/<digest>/
uv run uk-budget-data publish approve combined--<ids> --by "María Juaristi"
uv run uk-budget-data publish check
```

- **Combined only.** `--combined` without `--reforms` generates only the combined run. It prints the directory it wrote.
- **Which ids.** If a CGT measure that depends on taxpayer numbers is held provisional, and the call is to leave it out of the combined run (see "Data limitations"), list every coded id but that one, and say so wherever the package total appears.
- **Before simulating**, the combined run is checked: every parameter each member sets alone must hold in the combination. Conflicting measures are refused, naming both.
- **Approval** needs every member approved.
- **Publish.** Open a pull request. The six required checks must pass. Publication gate runs too: it isn't required (question 3), but don't merge if it fails. Merge, and production deploys.
- **Verify on the live route:**

  ```sh
  curl -s https://policyengine.org/uk/autumn-budget-2026/data/manifest.json | head -5
  # Until policyengine-app-v2#1249 is live (and at the rehearsal):
  curl -s https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026/data/manifest.json | head -5
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" \
    --fixtures data_inputs/household_fixtures --manifest public/data/manifest.json
  ```

## First cut for media and the webinar (proposed: 15:45)

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
2. **Regenerate it.** This writes a new artifact; the old one is untouched.
3. **Reconcile and stage it.** The previous entry moves to `superseded`. Any combined run that included it becomes **stale** automatically.
4. **Regenerate the combined run**, stage it, and approve both.
5. **Publish through a pull request.**

An approval or an exception carries over only where the outputs are byte-identical.

## A model upgrade during the day (no freeze)

- **Upgrade PR.** When policyengine.py releases a qualified bundle, a draft upgrade pull request opens automatically (#18). The workflow opens draft PRs only; merging an upgrade on the day stays your call.
- **Regenerate before merging.** Regenerate every published measure and the combined run on the new release, then stage the first with `--adopt-execution`. Every other entry becomes stale until it is re-staged. Reconcile, approve, redeploy the household API and re-run the household checks.
- **Fallback.** If that cannot finish before a deadline, stay on the current release. `publish check` refuses a manifest that mixes releases.

## Data limitations: say these wherever a measure depends on them

The UK hub measured two limitations of the data on uk-data 1.58.1 (`enhanced_frs_2024_25.h5`, SHA-256 `056e80fd…`); a third, on capital gains tax, comes with the Budget pair's data (below). State the first two wherever a measure's figures depend on very old ages or the highest incomes: in the dashboard's methodology, and in the 07:00 briefing's limitations section. You may reword them for the briefing.

- **Ages:** "The Family Resources Survey records adult ages only up to 80, so the 3.6 million people aged 80 or over in our data (7,718 survey records) all appear as exactly 80, and results that depend on ages above 80 rely on that grouping."
- **£1m+ incomes:** "Fewer than 10 survey records have a total income of £1 million or more, all from self-employment alone, so the data cannot represent the £35.5bn of employment income and £11.1bn of dividends that HMRC's Survey of Personal Incomes records for people on £1 million or more in 2023-24, and estimates for measures aimed at the highest incomes rest on very little data."

W5 re-measured on the same file for 2025:
- **Ages:** the oldest age is 80, nobody is above it, and 7,718 records are aged exactly 80, weighing 3.62 million people.
- **Incomes:** fewer than 10 records have `total_income` of £1 million or more, all with self-employment income and no other income type, so no employment income or dividends.

**Source of the £1m+ figures:** HMRC's Survey of Personal Incomes, 2023-24: £35.5bn of employment income for 21,000 people, and £11.1bn of dividends for 19,000. An earlier draft called these a 2025 HMRC projection. The 2025 calibration targets are PolicyEngine's own uprating of them: £37.4bn and £11.6bn on 1.58.1 (`storage/incomes_projection.csv`; corrected by the UK hub, uk-data#593).

**Capital gains tax: taxpayer counts (from the Budget pair's data).** Batch 3 of uk-data (policyengine-uk-data #608, with #571, which starts capital gains on HMRC's 2024-25 size-of-gain table) is merged as 1.59.0 but not yet published. It publishes as 1.59.1, with a reviewed widening of the CGT taxpayer-count test's bound (policyengine-uk-data #631; Max's decision d1735, 20 October). The dashboard adopts it with the Budget pair, once that is certified and promoted. Its built count of CGT taxpayers is about a third below HMRC's: 375,000 weighted against 548,000.
- **A measure that depends on the number of taxpayers** (a change to the annual exempt amount, or to a threshold) is staged provisional on the day, not approved. The 07:00 briefing takes approved entries only, so it stays out of the briefing too, unless someone approves an exception for it.
  - **This also holds up G4.** A combined run is approved only when every member is, so a combined run that includes such a measure can't be approved, and the first cut then carries per-measure figures only. **Your call, before the day:** leave such a measure out of the combined run (and say so wherever the package total appears), or accept per-measure figures only.
- **A CGT rate change** goes through G3 as any measure does: reconciled, then approved. It depends mainly on total gains. On 1.59.1 these are 10% to 25% off the calibration target, the OBR's March 2026 capital gains tax receipts forecast (`obr/capital_gains_tax` in uk-data's `obr_march_2026.yaml`), against 25% to 50% before.

**Where they go:** they describe the national results, not the household calculator, which uses the visitor's own ages and incomes; whatever is placed should say so. The dashboard has no methodology section today. The only data notes are in two measures' descriptions in `App.jsx`, which #3 rewrites. The briefing has no template yet; #22 exports its tables. Where the text sits is your call.

## Briefing (overnight, by 07:00)

Exports are built only from approved entries of one manifest revision. A measure held at the first cut joins the briefing once it is approved. Each chart is stamped with the model, the data and the manifest revision (#22, a draft). Use no figure that is not in that revision.

## Rollback

- **Dashboard.**
  1. Use Vercel Instant Rollback to the recorded previous production deployment (dashboard, or `vercel rollback <deployment> --scope policy-engine`).
  2. `git revert` the bad merge through a pull request, and wait for its deployment to build.
  3. Run `vercel promote <fixed deployment> --scope policy-engine`. After a rollback, Vercel stops assigning the production domain to new deployments, so the fix does not go live until it is promoted. Promoting also turns automatic assignment back on.
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

  Then re-run the household check against the live route.

## Clock

| Event | Time | SHA | Manifest revision | Notes |
|---|---|---|---|---|
| G0 | | | | |
| G1 | | | | |
| G2 published | | | | |
| Documents | | | | |
| G3 approved | | | | |
| G4 published | | | | |
| First cut (proposed 15:45) | | | | Sent to ITV by; in the webinar slides |
| G5 corrections | | | | |
| Briefing exported | | | | |
