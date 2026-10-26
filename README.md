# UK Autumn Budget 2026 dashboard

PolicyEngine's dashboard for the UK Autumn Budget 2026 (Wednesday 28 October 2026). It shows how the Autumn Budget 2026 measures change public finances and household incomes, by income decile, area and age, and for a household you describe, alongside a living standards outlook to 2031-32. Budget figures appear only after verified publication. Figures come from [PolicyEngine UK](https://policyengine.org/uk) microsimulation on the certified Microcosm dataset.

| Link | |
|---|---|
| Live dashboard | <https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026> |
| Household API | <https://uk-budget-api-2026-qevs5bboca-ew.a.run.app/api/household-impact> (`POST`; see [Architecture](#architecture)) |
| Budget-day runbook | [`docs/budget-day-runbook.md`](docs/budget-day-runbook.md) |
| Decision log | [Issue #119](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/119) |
| Drill reruns (the four mock Budgets on today's engine) | <https://uk-ab2026-drill-reruns.vercel.app> |

## Tabs

The tab list is `VIEWS` in [`src/App.jsx`](src/App.jsx); the open tab and sub-tab, the selected measures and the household answers are kept in the address (`?tab=`, `?sub=`, `?policies=`, `?personal=`), so a link reopens the same view.

| Tab | What it shows |
|---|---|
| Population impact | The selected measures' effects, for each fiscal year from 2026-27 to 2031-32. Sub-tabs: **All households** (results by constituency, the change by income decile, the household scatter, example households), **Young people** (results by age), **Pensioners** (people at or over State Pension age, from the same results by age), **Living standards** (growth across the distribution, and inequality), **Poverty** (change in the poverty rate) and **Public finances** (revenue impact, and the OBR comparison once published). Living standards and Poverty each link to their twin without the measures on the Pre-measures forecast. |
| Household impact | One household, one year: net income before and after the selected measures, each measure's own change, and an earnings sweep. Calculated live by the household API (`POST /api/household-impact`). |
| Pre-measures forecast | The outlook without the Budget's measures, under current law (`?tab=outlook`; old `?tab=living` and `?sub=baseline` links still open it). Sub-tabs: **Living standards** (incomes over time, growth across the distribution, inequality over time; the default), **Poverty** (poverty over time, who is in poverty) and **Forecast changes** (the OBR forecast the baseline uses, and the Budget forecast once it is loaded with verified provenance), as `?sub=poverty` and `?sub=forecast`. Projections run from 2027-28 to 2031-32, with HBAI outturn and OBR series. Living standards and Poverty mirror Population impact's sub-tabs of the same names, which show the selected measures' effect; each links to its twin. |
| Policies | Every published measure in one place: its published name and description, and, where [`src/utils/policyDetails.js`](src/utils/policyDetails.js) has an entry for its id, when it starts and is in force, its type, and its main modelling assumption and source behind "Details". Population impact links here rather than repeating it. |
| Methodology | Data, model, measures and limitations. The replication line at the foot of every page names the code and engine version. |

Every chart downloads as CSV, PNG, SVG or plain text.

## Measures

The measures on the page, each compared against current law in policyengine-uk. On Budget day this list becomes the measures the Chancellor announces, published one by one (see [Budget day](#budget-day)). They are defined in [`src/uk_budget_data/reforms.py`](src/uk_budget_data/reforms.py) (ids, names, full descriptions and parameter changes), with the measures that need more than a parameter change implemented as simulation modifiers in [`src/uk_budget_data/budget_measures/`](src/uk_budget_data/budget_measures/), one module per modifier. `autumn_budget_2026_combined` simulates them all together, with their interactions.

The list on `main` today:

| Id | Measure |
|---|---|
| `fuel_duty_rise_deferral` | Fuel duty rises deferred: 52.95p held through winter 2026-27, the 5p restored in 2027-28 |
| `state_pension_income_tax_protection` | State Pension income tax protection: an allowance of the full new State Pension over State Pension age, from April 2027 |
| `warm_home_discount_top_up` | Warm Home Discount top-up: £150 to £250 for winter 2026-27 |
| `domestic_electricity_zero_vat` | Zero VAT on domestic electricity, October 2026 to March 2028 |
| `employer_ni_relief_under_25s` | Employer NI relief for employees aged 21 to 24 (extending the under-21 relief): none up to the upper earnings limit, from April 2027 |
| `threshold_freeze_2031_32` | Threshold freeze to 2031-32: personal allowance and basic rate band frozen one more year |
| `badr_lifetime_limit_cut` | Business Asset Disposal Relief lifetime limit cut from £1m to £500,000, from April 2027 |
| `road_fuel_vat_cut` | VAT on petrol and diesel at 15%, December 2026 to May 2027 |
| `plan_2_threshold_unfreeze` | Plan 2 student loan threshold uprated by RPI from April 2027 |

List them from the command line with `uv run uk-budget-data generate --list-reforms`.

## Architecture

- **Web app** (`src/app/`, `src/App.jsx`, `src/components/`): Next.js 16 and React 19, built and run with Bun, served under the base path `/uk/autumn-budget-2026` (`next.config.ts`). Tailwind CSS 4 on `@policyengine/ui-kit`'s theme; charts in Recharts. Population impact and Pre-measures forecast read precomputed files from `public/data/`; Household impact calls the household API.
- **Data package** (`src/uk_budget_data/`, CLI `uk-budget-data`): Python 3.13. Runs the measures through [policyengine.py](https://github.com/PolicyEngine/policyengine.py) and writes `public/data/`.
- **Household API** (`uk-budget-api`, `src/uk_budget_data/api.py`): FastAPI on Cloud Run (`uk-budget-api-2026`, `europe-west1`). Its `POST /api/household-impact` route is documented in [`docs/budget-day-publication.md`](docs/budget-day-publication.md#household-route-post-apihousehold-impact).

**Engine.** The project depends on `policyengine[uk]` 6.10.2 (`pyproject.toml`, `uv.lock`), which pins policyengine-uk 2.132.6 and the certified Microcosm national dataset that goes with it. Population results are built with `pe.uk.managed_microsimulation()`, which downloads that dataset from a private Hugging Face repository and so needs `HUGGING_FACE_TOKEN`. Household calculations need no dataset. Upgrade the bundle, never policyengine-uk alone (see [`.claude/CLAUDE.md`](.claude/CLAUDE.md)).

## Publication and verified routes

Measure definitions do not authorise publication. The page builds its measure catalogue from `public/data/manifest.json`, which must identify the 28 October 2026 Budget (`release: uk-autumn-budget-2026` and the matching `budget` id and date). Labels, descriptions, selection, chart series and colours come from that catalogue. A Budget row requires an approved or provisional entry, a supported year and an artifact verified against its receipt and manifest. Package figures require the combined run of exactly the displayable measures. Chart series use `measure:<id>` keys; ordering and colours depend on the measure id and supported budgetary direction.

| Figures | Verified route |
|---|---|
| Public finances, deciles, winners and losers, metrics and household scatter | Receipt-verified artifacts through `loadDashboard` and `loadPublication` |
| Example households and young people | Artifact tables rechecked against their receipts with `loadVerifiedTable` |
| Regional and constituency results | SHA-256-bound release index plus `area_provenance.json`, with approved artifact, receipt and actual baseline/reform identities |
| Household impact | Live single-year household API after the same catalogue and year gate; held, unpublished or failed selections are unavailable, never zero. Each request waits for a check of the live manifest and is dropped if the snapshot changed; an answer from other policyengine, policyengine-uk or policyengine-core versions than the selected measures' receipts record is refused |
| OBR comparison | Unavailable until a 2026 source is verified; the existing CSV contains November 2025 costings |

The page shell, Methodology, Living standards baseline and March 2026 forecast remain available without a Budget manifest. The Budget-day forecast remains unavailable until verified provenance exists; `post_published` alone does not authorise it. Missing, invalid, unreachable or other-Budget manifests remove Budget figures, with no fallback to unverified flat files. Focus and five-minute checks replace changed snapshots or restore verified results after recovery; Household impact caches are bound to the publication snapshot.

Before simulation, the area run compares its actual baseline and reform identities with approved receipts. `uk-budget-data publish index` binds exactly the CSV files the run wrote, their aliases and the provenance sidecar to the manifest revision and bytes; the page verifies those digests before showing figures. A changed or incomplete area snapshot stays unavailable until its matching index is published.

Frontend tests include unfamiliar measure ids, held and stale entries, tampered artifacts and flat files, mismatched revisions and the real unreceipted `public/data`. Fast-check properties cover the publication gates, catalogue membership, colours and series keys; Hypothesis tests pin area identity and provenance invariants. The legacy-name guard covers frontend source; Python owns the measure definitions.

## Local development

Prerequisites: [Bun](https://bun.sh) (`bun.lock` is the lockfile), Node.js 20.9 or later, [uv](https://docs.astral.sh/uv/) and Python 3.13 or later.

```bash
uv sync --locked --extra dev          # Python package and API
bun install --frozen-lockfile         # web app
cp .env.example .env.local            # then fill in HUGGING_FACE_TOKEN if you will generate data
```

Run the household API and the web app in two terminals:

```bash
HOUSEHOLD_WORKERS=2 PORT=8010 uv run uk-budget-api
bun run dev
```

The page is at <http://localhost:3000/uk/autumn-budget-2026>.

| Variable | Used by | Purpose |
|---|---|---|
| `NEXT_PUBLIC_HOUSEHOLD_API_URL` | web app, at build time | The API's URL followed by `/api/household-impact`, no trailing slash (locally `http://localhost:8010/api/household-impact`). The build fails on a value in any other form, and a Vercel production build fails without one (`scripts/household-api-env.mjs`). |
| `NEXT_PUBLIC_BASE_PATH` | web app | Overrides the base path; set it empty to serve at the root. |
| `HUGGING_FACE_TOKEN` | data package | Read access to the certified dataset. |
| `PORT`, `HOUSEHOLD_WORKERS` | API | Port (default 5001) and worker processes for household calculations. |

`make dev` runs the API in Docker instead (`docker-compose.yml`, on port 5001), so point `NEXT_PUBLIC_HOUSEHOLD_API_URL` at `http://localhost:5001/api/household-impact` if you use it.

### Tests and lint

| | Command |
|---|---|
| Python tests, as CI runs them | `uv run pytest -m "not certified_data" -n 4 --dist loadgroup --no-loadscope-reorder` |
| Tests on the certified data (needs `HUGGING_FACE_TOKEN`) | `uv run pytest -m certified_data` |
| Python lint | `uv run black --check src/ tests/` and `uv run ruff check src/ tests/` (`make format` fixes) |
| Frontend tests and lint | `bun run test`, `bun run lint` |
| Production build | `bun run build`, then `bun run start` |

Mark any test that takes minutes with `@pytest.mark.slow`; under xdist such tests are collected first, so each one added lengthens the run.

## Data generation

The web app's population figures are files in `public/data/`, written by the `uk-budget-data` CLI (`uv run uk-budget-data --help` lists every command):

| Command | Writes |
|---|---|
| `generate` | The national results for every measure and year (`--reforms`, `--years` narrow it; `--artifacts` writes one receipted artifact per measure for the publication manifest) |
| `geography` | Disclosure-controlled results by region and constituency |
| `income-curve` | `income_curve.csv`, the example households' net income across their income grids (no dataset needed) |
| `living-standards` | `living_standards_outlook.json`, the Pre-measures forecast tab ([data contract](docs/DATA_CONTRACT.md); inputs and sources in [`data_inputs/living_standards/`](data_inputs/living_standards/README.md)) |
| `obr-forecast --efo <economy tables .xlsx>` | Loads a new OBR forecast (the EFO detailed forecast tables, economy) into the Pre-measures forecast tab's Forecast changes series |
| `scripts/precompute_household_presets.py` (not the CLI; reads `bun scripts/household-preset-requests.mjs`) | `household_presets.json`, the Household impact examples' answers with every measure selected, 2027-28 to 2031-32, shown at once when an example is chosen (no dataset needed; about ten minutes locally) |
| `publish …` | Reconciles, stages, approves and checks entries in the publication manifest |

The same pipeline is importable: `from uk_budget_data import generate_all_data, get_reform, DataConfig`. A `Reform` can carry `baseline_parameter_changes` to compare against something other than current law (`src/uk_budget_data/models.py`).

## Budget day

The full sequence, roles and timings are in the [runbook](docs/budget-day-runbook.md); the design behind it is in [`docs/budget-day-publication.md`](docs/budget-day-publication.md). In order:

| Step | What happens | Runbook |
|---|---|---|
| Start | Pull `main`, sync, run the certified-data tests and the household route check | [G0](docs/budget-day-runbook.md#g0-start-receipt-by-1130) |
| OBR tables | Download the OBR workbooks **in a browser** (obr.uk refuses scripts) and import them | [Documents arrive](docs/budget-day-runbook.md#documents-arrive-1340), [OBR forecast](docs/budget-day-runbook.md#budget-day-obr-forecast-living-standards-tab-from-1340) |
| Generate | `generate --artifacts`, one receipted artifact per measure, locally or on Modal | [G2](docs/budget-day-runbook.md#g2-provisional-numbers-1315) |
| Stage | `publish reconcile` and `publish stage`; each measure needs a signed expected-effects row (in #140, after #104) | [G2](docs/budget-day-runbook.md#g2-provisional-numbers-1315), [G3](docs/budget-day-runbook.md#g3-rebase-and-reconcile-1340-to-1410) |
| Attest | Hand-written modifiers (`employer_ni_relief_under_25s`, `plan_2_threshold_unfreeze`) are held until **two different people** sign an attestation for that exact receipt | [How a measure must be written](docs/budget-day-runbook.md#how-a-measure-must-be-written) |
| Approve | The Reconciler runs `publish approve`, then `publish review-rows` | [G3](docs/budget-day-runbook.md#g3-rebase-and-reconcile-1340-to-1410) |
| Combined | `generate --combined` over the approved measures, staged and approved | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Results by area | `geography` over the approved ids, locally or on Modal | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Publish | `publish index`, `publish check`, then the pull request whose merge deploys | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Sources | Point the page's OBR and Budget-document links at the day's publications (config keys `obr_efo_current` and `budget_documents`, in #128 and #127) | — |
| Corrections | Withdraw, fix, regenerate | [G5](docs/budget-day-runbook.md#g5-corrections-whenever-one-arrives), [Rollback](docs/budget-day-runbook.md#rollback) |

**Who signs what.** The expected-effects rows (`data_inputs/treasury/expected_effects.csv`, in #140) carry a reviewer's name. Each attestation needs two distinct people. Approval and review rows are the Reconciler's. See [Roles](docs/budget-day-runbook.md#roles).

### Running it

- **Locally.** `uv run uk-budget-data generate --artifacts …` runs one measure at a time. A receipted measure peaks at about 14–17 GB, so run in parallel (`--jobs`, in #112) only with more than about 40 GB free. Results by area need up to about 64 GB (#115, #138).
- **On Modal.** The flat CSVs: `uv run --with modal==1.6.2 uk-budget-data generate --backend modal`, and on a pull request that changes a measure, the "Results on Modal" workflow, which uploads them for review and never commits or signs. Receipted artifacts in #139, results by area in #142. All read the certified data with the `policyengine` workspace's existing `pe-uk-private-hf-read-token` secret. One container per measure. Cost guards: no warm containers, a timeout on every function, no retries, a cap on parallel containers, and the app stopped after each run; check spend with `modal billing report --for today`. The decision and its reasons are on [#119](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/119).
- **Household API.** Deployed by the "Deploy the household API" workflow (below). Budget-week capacity (8 vCPU, 8 GiB, eight workers, one instance kept warm) is in #141; set it back after the Budget.

## Review and sign-off

The figures derive from UKDS-licensed survey microdata, and this repository and the site are public, so every file under `public/` is a publication.

- Each file under `public/` must be listed in [`data_inputs/public_data_review.csv`](data_inputs/public_data_review.csv) with the sha256 of the bytes a person reviewed (`shasum -a 256 <file>`). Any change fails until it is reviewed again. A `pending` entry passes only until its expiry date, at most 14 days after it was added. No public file may carry household, benefit unit or person ids or weights.
- The one exception is `public/data/area-routing.json`, written from the installed bundle by `uk_budget_data.area_routing`: it takes no review entry, and may hold only one of the few texts that module writes.
- Tables written by `policyengine.disclosure` (`regional.csv`, `constituency.csv`) are reviewed as kind `disclosure_table` and must also pass its `validate_public`. Results by area go through that layer only; the legacy constituency calculators (`generate --legacy-geography`) write only to the private directory named by `UK_BUDGET_DISCLOSURE_AUDIT_DIR`, outside any git repository.
- `area_provenance.json` is reviewed as `publication_provenance` under its closed metadata schema; each area CSV still passes disclosure validation.
- Two checks enforce the list: `uv run python scripts/check_public_data.py` (CI's Public data check) and `bun scripts/check-public-files.mjs` (run by `bun run build`, so a deploy fails too). They print file paths and rule names, never values.
- `uv run uk-budget-data publish check` re-runs every publication gate on the manifest (CI's Publication gate).
- `main` requires a pull request and six checks: Python tests, Python lint, Certified data, Frontend build, Frontend tests and Frontend lint.

## Deployment

- **Web app:** the Vercel project `uk-autumn-budget-2026` builds `main` with `bun run build` (`vercel.json`); a merge to `main` publishes. Set `NEXT_PUBLIC_HOUSEHOLD_API_URL` for Production and Preview.
- **Household API:** the "Deploy the household API" workflow ([`.github/workflows/deploy-api.yml`](.github/workflows/deploy-api.yml)) submits [`cloudbuild.yaml`](cloudbuild.yaml), which deploys only a commit on `main`, smoke-tests the new revision before moving traffic, and rolls back through [`cloudbuild-rollback.yaml`](cloudbuild-rollback.yaml). Deploys on push stay off until the repository variable `API_DEPLOY_ON_PUSH` is `true`; until then, run the workflow by hand.

Settings, service limits and fallbacks are under "Production setup" in [`docs/budget-day-publication.md`](docs/budget-day-publication.md#production-setup-as-created).

## Contributing

Follow [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for code and writing conventions: British English, sentence case, and colours from the design tokens ([`docs/COLOURS.md`](docs/COLOURS.md), enforced by `src/colourGuard.test.js` and ESLint). Run `make format` before committing Python and `bun run lint --fix` before committing JavaScript.

## Licence

This project is for policy analysis. Data and analysis powered by PolicyEngine UK.

The constituency hex map's layout (`src/utils/geography/constituencyHexes.json`) is the Open Innovations HexJSON of the 2024 Westminster constituencies (open-innovations/constituencies, `src/_data/hexjson/uk-constituencies-2024.hexjson`), © Open Innovations, CC BY 4.0. Its drawing follows PolicyEngine's uk-mansion-tax hex map.
