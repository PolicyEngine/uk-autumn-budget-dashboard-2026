# Budget-day runbook (draft)

**Status: draft for Vahid and María, who own this document and the workflow it describes.** It follows the drill 3 structure (G0 to G5). Commands marked with a PR number exist once that PR merges. Times are the drill's, to be replaced by the real release times. The design behind it is in [`budget-day-publication.md`](budget-day-publication.md).

Wednesday 28 October 2026. Briefing by 07:00 on Thursday 29 October.

## Roles

| Role | Owns | Does not |
|---|---|---|
| **Integrator** (Vahid) | Every commit, generation, `publish stage`, the pull request that deploys | Approve his own reconciliation exceptions |
| **Reconciler, then scorer** (María) | Coverage ledger, Treasury entry, reconciliation, exception review, `publish approve`, household fixtures | Push measure code |
| **Deploy and rollback** (Vahid, W5 on standby) | The merge that publishes; Vercel and Cloud Run rollback | |
| **Briefing** (to be agreed) | Export from an approved manifest revision; the article | Use any number not in the manifest |

## Before the day: the deployed-route rehearsal, by Friday 23 October

- [ ] **Production route live.** The dashboard serves at `https://policyengine.org/uk/autumn-budget-2026` (policyengine-app-v2#1249, still a draft) from the production Vercel project, which tracks `main`.
  - Project: `uk-autumn-budget-2026`, team `policy-engine`, ID `prj_SelxVbakBqqSLdsoS74Qw36wp2E8` (created 12 October).
  - Domain: `uk-autumn-budget-2026.vercel.app`.
  - Last production deployment ID, the rollback target: record before every merge on the day.
- [ ] **Household API live.**
  - URL, **the household URL for the day**: `https://uk-budget-api-2026-qevs5bboca-ew.a.run.app` (Cloud Run `uk-budget-api-2026`, project `policyengine-apps`, `europe-west1`).
  - Serving revision and image: record after the last deploy before the day. On 12 October the first revision, `uk-budget-api-2026-00001-gow`, answered `/api/version` but not `/api/personal-impact` within 300 s, so the household route is not yet usable.
  - Deploy (no trigger), from a clean checkout of `main`:

    ```sh
    gcloud builds submit --project policyengine-apps --config cloudbuild.yaml \
      --substitutions _GIT_SHA=$(git rev-parse HEAD)
    ```

    The new revision takes traffic only after its smoke test passes. The log ends with the revision it promoted and the one it replaced.

  `curl -s "$HOUSEHOLD_API/api/version"` must report the bundle's model and core versions (#15).
- [ ] **Required checks on `main`:**
  - Python tests;
  - Certified data;
  - Python lint;
  - Frontend build, tests and lint;
  - Publication gate.
- [ ] **Household fixtures.** María's specimen households, with independently computed answers, are in `data_inputs/household_fixtures/` (#15).
- [ ] **Rehearsal.** Intake, dashboard and briefing on the deployed routes, including one model upgrade and regeneration. Record the receipt here. Repeat after any material change.

## How a measure must be written

Every published measure is receipted, and the receipt can only bind a measure written in one of these forms:

- **`parameter_changes`**, wherever the measure can be expressed that way.
- **A module-level function** as `simulation_modifier`, with its numbers as default arguments: `def energy_vat_cut(sim, rate_change=-0.05, start_year=2027): ...`. The tested templates (templates PR, in progress) are helpers to call from such a function.

**Dated changes: key every year by its bare fiscal year.**

| Key | What it means | Use it? |
|---|---|---|
| `"2027": 0.21` | The whole UK fiscal year 2027-28, 6 April 2027 to 5 April 2028, on policyengine-uk 2.125.1 and on 2.126.12 | **Yes.** List every year the change applies, through 2030. |
| `"2027-04-06": 0.21` | That one day only. It scores £0. | **Never.** |
| `"2027-04-06.2100-12-31": 0.21` | From 6 April 2027 on, but only on policyengine-uk 2.126.12 or later. On the installed 2.125.1 it scores £0 (W4's certification evidence). | Not until the bundle moves to 2.126.12; the upgrade PR will say so. |

The templates' `rate_change` and `threshold_change` build bare-year keys and refuse the other two. A measure that still scores £0 is refused at staging by the responsiveness gate, but it is better caught when it is written.

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

```sh
uv run python -m uk_budget_data.treasury_import <Table 4.1 xlsx> \
  --source-id AB2026-T4.1 --document "Autumn Budget 2026" \
  --out data_inputs/treasury/sources/AB2026-T4.1.csv \
  --static-template data_inputs/treasury/sources/AB2026-static.csv      # (#16)
```

- **Totals check.** The importer checks the rows against Table 4.1's printed totals and stops on a mis-keyed row.
- **Static costings.** María fills `AB2026-static.csv` from the policy costings document. These static costings are the gated comparator.
- **Mapping.** María fills `data_inputs/treasury/mapping.csv` (measure to row). A row outside scope or on a different basis is marked `not_comparable`, with a reason and reviewer.

## G3: rebase and reconcile (13:40 to 14:10)

- **If the forecast is rebased** on the Budget's OBR tables: update `data_inputs/publication_basis.json` (`forecast.status: updated`, with source and vintage), regenerate every measure, and stage with `--adopt-basis`. Every entry on the old basis becomes stale.
- **Reconcile** each measure: `uv run uk-budget-data publish reconcile <artifact>`. A year passes within 10% or £50m of the static costing, whichever is larger. *The numbers are still to be agreed.*
- **A failed year** is fixed, or María adds an exception to `data_inputs/treasury/exceptions.yaml`:
  - one of the closed explanation classes;
  - a quantified explanation;
  - her name;
  - the artifact's `outputs_sha256`.

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

## G5: corrections (whenever one arrives)

1. **Fix the measure and commit.**
2. **Regenerate it.** This writes a new artifact; the old one is untouched.
3. **Reconcile and stage it.** The previous entry moves to `superseded`. Any combined run that included it becomes **stale** automatically.
4. **Regenerate the combined run**, stage it, and approve both.
5. **Publish through a pull request.**

An approval or an exception carries over only where the outputs are byte-identical.

## A model upgrade during the day (no freeze)

- **Upgrade PR.** When policyengine.py releases a qualified bundle, a draft upgrade pull request opens automatically (#18).
- **Regenerate before merging.** Regenerate every published measure and the combined run on the new release, then stage the first with `--adopt-execution`. Every other entry becomes stale until it is re-staged. Reconcile, approve, redeploy the household API and re-run the household checks.
- **Fallback.** If that cannot finish before a deadline, stay on the current release. `publish check` refuses a manifest that mixes releases.

## Briefing (overnight, by 07:00)

Exports are built only from approved entries of one manifest revision. Each chart is stamped with the model, the data and the manifest revision (briefing PR, in progress). Use no figure that is not in that revision.

## Rollback

- **Dashboard.**
  1. Use Vercel Instant Rollback to the recorded previous production deployment (dashboard, or `vercel rollback <deployment> --scope policy-engine`).
  2. `git revert` the bad merge through a pull request, and wait for its deployment to build.
  3. Run `vercel promote <fixed deployment> --scope policy-engine`. After a rollback, Vercel stops assigning the production domain to new deployments, so the fix does not go live until it is promoted. Promoting also turns automatic assignment back on.
- **Household API.** Use the revision the deploy's log says it replaced:

  ```sh
  gcloud run services update-traffic uk-budget-api-2026 \
    --project policyengine-apps --region europe-west1 \
    --to-revisions <replaced revision>=100
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
| G5 corrections | | | | |
| Briefing exported | | | | |
