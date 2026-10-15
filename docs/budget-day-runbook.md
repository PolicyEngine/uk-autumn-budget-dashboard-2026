# Budget-day runbook (draft)

**Status: draft for Vahid and María, who own this document and the workflow it describes.** It follows the drill 3 structure (G0 to G5). Commands marked with a PR number exist once that PR merges. Times are the drill's, to be replaced by the real release times. The design behind it is in [`budget-day-publication.md`](budget-day-publication.md).

Wednesday 28 October 2026. Briefing by 07:00 on Thursday 29 October.

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | Every commit, generation, `publish stage`, the pull request that deploys | Approve his own reconciliation exceptions |
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
  - Serving revision and image: record after the last deploy before the day. On 12 October the first revision, `uk-budget-api-2026-00001-gow`, answered `/api/version` but not `/api/personal-impact` within 300 s, so the household route is not yet usable.
  - **How long one household answer takes.** One full `/api/personal-impact` request covers six years and eight measures. Timed locally on 15 October for a £50,000 earner, with the same result each time:
    - 193.6 s on `main` before #37;
    - 253.6 s after it;
    - 194.5 s with #39.

    Cloud Run serves it on 2 CPUs with a 300 s request timeout, and the deploy's smoke test makes the same request. So every visitor waits minutes for a household answer on the day, and a route that gets slower fails the smoke test and never takes traffic. Don't loosen the smoke test or raise the timeout to get a deploy through. Time #3's route against these figures (#33).
  - **Deploy through GitHub Actions**, not from a laptop: the "Deploy the household API" workflow (#28), action `deploy`, on `main`. It needs no one's gcloud login: it authenticates through Workload Identity Federation once the grants in #28 are made (Max, d1538). It runs the same Cloud Build pipeline as the command below, waits for it, and checks that the live `/api/version` names the commit. Push deploys stay off until the repository variable `API_DEPLOY_ON_PUSH` is `true` (your call, once #3 makes the household route fast enough for the smoke test).
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

  Force-push and deletion are blocked. Org admins can bypass through a pull request, and the policyengine App always. Add Publication gate once it runs on every pull request; it didn't run on older heads.
- [ ] **Household fixtures.** María's specimen households, with independently computed answers, are in `data_inputs/household_fixtures/` (#15).
- [ ] **Nothing published says 2025.** The repository began as a copy of last year's dashboard. Checked on 13 October against `main` (93d0609) and #3:

  | Where | What it says | Shown today? | Who fixes it |
  |---|---|---|---|
  | `public/combined_reforms/*.html` (five pages) | Four titled "Combined Autumn Budget 2025", and an untitled `revenue.html`, all with last year's figures. Served at `uk-autumn-budget-2026.vercel.app/combined_reforms/…`; nothing links to them | **Yes** | W5: removed in a pull request of its own. The briefing export (#22) writes this year's from an approved manifest |
  | `public/data/budgetary_impact.csv`, `distributional_impact.csv`, `winners_losers.csv`, `metrics.csv`, `household_scatter.csv` | Last year's results: all five last changed on 8 December 2025 and are byte-identical to `ec29ebd` | **Yes**: `main`'s main route (`App.jsx`) fetches them and charts them under the 2026 heading once a policy is selected. For example, `?policies=two_child_limit` shows −£2.95bn for 2026 and −£3.72bn for 2030 (#26 review, 15 October). Served at `uk-autumn-budget-2026.vercel.app`, which deploys `main` | #3 regenerates all five. Until it merges, the production URL shows last year's numbers; whether to hide them meanwhile is your call |
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
  - **The rollback target is `00004-fur`.** It is the only revision that passes `main`'s smoke test. A rollback runs that test against its target before moving traffic, and `00001-gow` (12 October's) doesn't answer within 300 s, so a rollback to it would be refused before traffic moves.
  - **15 October, rollback rehearsal, through the workflow each time:**

    | Step | Run | What happened | Live afterwards |
    |---|---|---|---|
    | 1. Deploy `main` (1ce4984) | 38734841265 | `00006-qih` passed the smoke test and replaced `00004-fur` | `00006-qih`, 1ce4984 |
    | 2. Roll back to `00004-fur` | 38735958536 | **Refused, no traffic moved.** Provenance and tagging passed. The smoke test's `/api/personal-impact` got HTTP 503 after 98.8 s: Cloud Run killed the instance for exceeding its memory ("Memory limit of 2048 MiB exceeded with 2050 MiB used", 12:40:03Z, from the coordinator's read of the logs). A retry minutes later answered HTTP 200 in 130 s | `00006-qih` |
    | 2, again | 38736878049 | Rolled back to `00004-fur`, replacing `00006-qih`; `/api/version` named `00004-fur` (1ce4984) | `00004-fur`, 1ce4984 |
    | 3. Deploy `main` (d488145) | 38737646035 | `00012-ruy` passed the smoke test and replaced `00004-fur` | `00012-ruy`, d488145 |

    `/api/version` after step 3: d488145, with policyengine 6.4.1, policyengine-uk 2.130.1 and core 3.33.0. The revision numbers jumped from 00006 to 00012; W5 didn't create 00007 to 00011.
  - **Rollback targets now:** `00012-ruy` (live) and `00004-fur`, both of which have passed `main`'s smoke test.
  - **The household route can exceed 2 GiB.** Cloud Run killed two instances for exceeding the 2 GiB limit. Those are the only two such kills since 12 October, from the coordinator's read of the logs:
    - `00004-fur` at 12:40:03Z (2050 MiB), which gave step 2's 503;
    - `00003-jic` at 10:09:59Z (2054 MiB), during the first deploy's smoke test, so that 504 may have been memory as well as the 300 s limit.

    One full request, or a later request on an instance that has already run some (policyengine-core keeps what each build registers), can pass 2 GiB. A smoke test or a rollback can therefore fail on memory, and retrying is not a fix. The memory setting is in the capacity decision going to Max.
  - **Cold start:** 32.6 s to the first response from an idle revision (`/api/version`).
  - **How long one household answer takes on Cloud Run (`00004-fur`), 15 October:**

    | Request | Time |
    |---|---|
    | £30,000 earner, first | 142.5 s |
    | £30,000 earner, again | 148.0 s |
    | £30,000 earner, children 17, 10 and 2 | 145.5 s |
    | £40,000 earner, children 19, 22, 24 and 13 | 504 after 300 s |

    The last household has two children who turn 25 within 2025-30, so it is built three times over. Any household entering a child aged 20 to 24 fails this way today. A Cloud Run vCPU runs this single-threaded calculation about 5 times slower than a developer laptop (about 30 s locally).
  - **One answer at a time per instance.** The household route ran on the server's event loop, so while one household was calculated, nothing else on that instance answered (`/api/version` didn't, within 30 s). Cloud Run sends up to 80 requests to an instance at once, so a second visitor waits about 290 s and a third gets a 504. #45 moves the calculation off the event loop. How many calculations an instance takes at once (Cloud Run `--concurrency`, and the cost of more instances) is Max's call, through the coordinator.
- [ ] **Rehearsal.** Intake, dashboard and briefing on the deployed routes, including one model upgrade and regeneration. Record the receipt here. Repeat after any material change.

## How a measure must be written

Every published measure is receipted, and the receipt can only bind a measure written in one of these forms:

- **`parameter_changes`**, wherever the measure can be expressed that way.
- **A module-level function** as `simulation_modifier`, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. The tested templates (#23) are helpers to call from such a function.
- **In a module of fixed shape**: only imports, literal constants and undecorated functions, each name bound once. Not in `reforms.py`, whose run-time caches make every modifier in it unbindable (question 6 in `budget-day-publication.md`). `tests/template_measures.py` is the pattern.

**Dated changes: key every year by its bare fiscal year.**

| Key | What it means | Use it? |
|---|---|---|
| `"2027": 0.21` | The whole UK fiscal year 2027-28, 6 April 2027 to 5 April 2028. The national run and the household calculator both read it. | **Yes.** List every year the change applies, through 2030. |
| `"2027-04-06": 0.21` | That one day only. Depending on the parameter, the year's figure either does not move at all (the personal allowance; tested in #23) or moves by about one day's share of the change. Fuel duty, for example, moved by 0.27% of the change in 2027-28 (probe, 14 October, policyengine-uk 2.126.12). | **Never.** |
| `"2027-04-06.2100-12-31": 0.21` | In the national run, on policyengine-uk 2.126.12: every year from 2027-28 on, held flat. In the household calculator: nothing on `main`, which applies a change only where the key is the year itself (`personal_impact.create_simulation`); in #3, 2027 only, because it keeps a key for the year its first four characters name (`annual_reform_parameters`). | **No.** The national figure would move in years where the household calculator showed no change. |

**The household calculator moves less than the national figure for some measures** (probed 15 October on the bundle on `main`). Both `main`'s calculator (`personal_impact.create_simulation`) and #3's (`calculate_personal_net_income`) write a change on 1 January only, while the national run applies it to the whole fiscal year before policyengine-uk derives its other parameters. One earner on £50,000, 2027:

| Change | Household calculator | National |
|---|---|---|
| Fuel duty to 90p (monthly `fuel_duty` sees January only) | −£25.05 (#3) | −£300.62 |
| Beer duty to £30 (a calendar-preserved duty) | £0.00 (#3) | −£37.10 |
| Personal allowance to £20,000 (read on 1 January) | +£1,486.00 | +£1,486.00 |

The registered `fuel_duty_freeze` shows exactly 1/12 of its national effect for every household and year. Building the household reform through `Scenario(parameter_changes=…)` with the measure's bare-year keys, as the national run does, closes every gap found. It was checked against `tests/test_household_route_parity.py` (#23). **Your call**, for #3. The templates (#23) refuse calendar-preserved parameters meanwhile, and the parity test marks each known gap as a strict expected failure.

**#3 keys the pre-Budget fuel duty baseline by lone dates** (`"2026-03-22"`, `"2027-04-01"`, and so on, through `Reform._build_scenario`). On the bundle now on `main` (policyengine-uk 2.126.12; probed 14 October), a lone date moves fuel duty only in the fiscal year that contains it (6 April to 5 April), and only by about one day's share of the change. `"2027-04-01"` falls in 2026-27, so 2027-28 stays at current law, and 2026-27 moves by a sliver: the #23 review measured 2026's rate moving from £0.539527 to £0.539526 a litre.

An earlier version of this runbook said these keys have no effect at all. That was wrong: the effect is small, not zero. Either way, the baseline is not the one the measure intends. The same values keyed by bare year, as `main`'s `fuel_duty_freeze` keys them, change every year. This needs changing in #3 when it merges `main`.

The templates' `rate_change` and `threshold_change` build bare-year keys and refuse the other two, and a test checks that every registered measure uses only bare-year keys (#23). That test will fail on #3's lone-date keys once both are on `main`: **your call** whether it stays. A measure that still scores £0 is refused at staging by the responsiveness gate, but it is better caught when it is written.

Three things are refused:
- closures, lambdas, nested functions and `functools.partial`;
- `float("inf")` and other non-finite values;
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
  --manifest public/data/manifest.json --out receipts/g0-households.json
uv run uk-budget-data publish check                        # (#19)
uv run uk-budget-data publish status
```

Record in the clock table:
- the start SHA;
- the manifest revision and its execution identity;
- the dataset SHA-256;
- the household API identity;
- the basis in `data_inputs/publication_basis.json` (expected `pre_budget`).

**The gate fails** if any command fails, or the API's versions differ from the bundle's.

## G1: coverage (12:30 to 12:45)

María classifies every statement measure as `coded` or `ledger`, with a reason, in the coverage ledger.

## Construction (from G1)

For each coded measure:
1. **Write it** in `reforms.py` in one of the bindable forms above, and register it in `reforms.py` and `policyConfig.js`.
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
- **Supported years.** Years the dataset does not cover (2031 onwards on the current bundle) are recorded as unsupported. The page shows them as unavailable (frontend PR, in progress).
- **What "provisional" needs.** The measure must move in the declared direction. A measure that returns zero, or the wrong sign, is refused.
- **Household check.** One hand-checked household per measure, through the deployed route: add its fixture to `data_inputs/household_fixtures/` and run the `household_route` command from G0, writing `receipts/<id>-households.json`.
- **Publish.** Open a pull request, wait for the checks, then merge, which deploys. The page labels these "Provisional: statement figures, awaiting Treasury costing" (frontend PR, in progress).

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
  - her name;
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
- **Before simulating**, the combined run is checked: every parameter each member sets alone must hold in the combination. Conflicting measures are refused, naming both.
- **Approval** needs every member approved.
- **Publish.** Open a pull request. The required checks must pass, including the Publication gate. Merge, and production deploys.
- **Verify on the live route:**

  ```sh
  curl -s https://policyengine.org/uk/autumn-budget-2026/data/manifest.json | head -5
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" \
    --fixtures data_inputs/household_fixtures --manifest public/data/manifest.json
  ```

## First cut for media and the webinar (proposed: 15:45)

**Proposed, not agreed.** Max is asking Vahid and María to confirm the time, and who sends ITV the figures.

- **Why 15:45.** ITV's evening segment needs our analysis by 16:00 UK time on 28 October (18:00 at a stretch), and the webinar starts at 16:30.
- **What goes.** Whatever is approved in the manifest at 15:45: each measure approved at G3, and the combined run if it was approved at G4. Use one manifest revision, and record it in the clock.
- **What is held.** A measure that has not been approved by the cut is held for the 07:00 briefing. It is not given to media as provisional, and it is left out of the webinar slides. This is the rule from the call with Nuffield on 13 October: publish only what the team is fully confident in, and drop anything not nailed down. The export commands already enforce it, because they refuse any entry that is not approved (#22).
- **No totals by addition.** If the combined run is not approved by the cut, the first cut carries per-measure figures only.
- **How.** Export from that revision, to a directory of your choosing:

  ```sh
  uv run python scripts/generate_blog_charts.py --manifest public/data/manifest.json \
    --keys <approved ids> --out-dir <dir>
  uv run python scripts/generate_combined_charts.py --manifest public/data/manifest.json \
    --key combined--<ids> --out-dir <dir>
  ```

  The ITV figures and the webinar slides come from that export and nothing else.
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

- **Upgrade PR.** When policyengine.py releases a qualified bundle, a draft upgrade pull request opens automatically (#18). The workflow opens draft PRs only; merging an upgrade on the day stays your call (decision 8).
- **Regenerate before merging.** Regenerate every published measure and the combined run on the new release, then stage the first with `--adopt-execution`. Every other entry becomes stale until it is re-staged. Reconcile, approve, redeploy the household API and re-run the household checks.
- **Fallback.** If that cannot finish before a deadline, stay on the current release. `publish check` refuses a manifest that mixes releases.

## Data limitations: say these wherever a measure depends on them

Two limitations of the data, measured by the UK hub on uk-data 1.58.1 (`enhanced_frs_2024_25.h5`, SHA-256 `056e80fd…`). State them wherever a measure's figures depend on very old ages or the highest incomes: in the dashboard's methodology, and in the 07:00 briefing's limitations section. You may reword them for the briefing.

- **Ages:** "The Family Resources Survey records adult ages only up to 80, so the 3.6 million people aged 80 or over in our data (7,718 survey records) all appear as exactly 80, and results that depend on ages above 80 rely on that grouping."
- **£1m+ incomes:** "Fewer than 10 survey records have a total income of £1 million or more, all from self-employment alone, so the data cannot represent the £35.5bn of employment income and £11.1bn of dividends that HMRC's Survey of Personal Incomes records for people on £1 million or more in 2023-24, and estimates for measures aimed at the highest incomes rest on very little data."

W5 re-measured on the same file for 2025:
- **Ages:** the oldest age is 80, nobody is above it, and 7,718 records are aged exactly 80, weighing 3.62 million people.
- **Incomes:** fewer than 10 records have `total_income` of £1 million or more, all with self-employment income and no other income type, so no employment income or dividends.

**Source of the £1m+ figures:** HMRC's Survey of Personal Incomes, 2023-24: £35.5bn of employment income for 21,000 people, and £11.1bn of dividends for 19,000. An earlier draft called these a 2025 HMRC projection. The 2025 calibration targets are PolicyEngine's own uprating of them: £37.4bn and £11.6bn on 1.58.1 (`storage/incomes_projection.csv`; corrected by the UK hub, uk-data#593).

**Where they go:** they describe the national results, not the household calculator, which uses the visitor's own ages and incomes; whatever is placed should say so. The dashboard has no methodology section today. The only data notes are in two measures' descriptions in `App.jsx`, which #3 rewrites. The briefing has no template yet; #22 exports its tables. Where the text sits is your call.

## Briefing (overnight, by 07:00)

Exports are built only from approved entries of one manifest revision. A measure held at the first cut joins the briefing once it is approved. Each chart is stamped with the model, the data and the manifest revision (briefing PR, in progress). Use no figure that is not in that revision.

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
