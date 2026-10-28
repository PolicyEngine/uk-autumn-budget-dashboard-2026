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

The list on `budget-day-measures` (PR #290), the measures announced in Budget 2026 on 28 October 2026:

| Id | Measure |
|---|---|
| `fuel_duty_rise_deferral` | Fuel duty cut extended: 52.95p to 1 July 2027, then current law, RPI from April 2028 |
| `state_pension_income_tax_protection` | Pension Tax Allowance: a non-refundable income tax reduction for people over State Pension age, withdrawn £1 per £3 of income above the full new State Pension, 2027-28 to 2029-30 (hand-written) |
| `domestic_electricity_zero_vat` | Zero VAT on domestic electricity, 1 October 2026 to 1 July 2027: Great Britain, UK-wide from April 2027 (hand-written) |
| `property_income_rates_up` | Property income tax rates up 2 points from 6 April 2027, in England, Wales and Northern Ireland; finance cost relief follows the basic rate UK-wide (Table 6.1 row 61) |
| `savings_income_rates_up` | Savings income tax rates up 2 points from 6 April 2027, UK-wide (Table 6.1 row 62) |
| `carers_allowance_earnings_taper` | Carer's Allowance earnings taper: 100% above 16 x the National Living Wage, England and Wales, from within 2030-31 (hand-written) |
| `household_energy_payment_2026` | Household Energy Payment: £100 to households in bands A to D in England, winter 2026-27 (hand-written) |
| `trading_allowance_raise` | Trading allowance raised to £3,000 from 6 April 2027 |

Seven of these are the combined package (`autumn_budget_2026_combined`, key `combined--f91fe847275730cb`): `savings_income_rates_up` is held back from the release (Vahid, 28 October 2026), registered but not combined. With it the package was eight (key `combined--92701a68cf080aa8`); before the savings and property rates were split into one measure per Table 6.1 row (`unearned_income_rates_up`, withdrawn with its factory kept), the package was seven (key `combined--4e3e325c74977848`). Withdrawn on Budget day, not in the Budget 2026 document, with their factories kept but unregistered: the Warm Home Discount top-up, the threshold freeze to 2031-32, the Plan 2 threshold unfreeze and the employer NI secondary threshold raise. Earlier the pre-Budget package was eight measures (key `combined--894152ce8c83f1d8`, chosen on the evening of 27 October 2026).

List them from the command line with `uv run uk-budget-data generate --list-reforms`.

## Architecture

- **Web app** (`src/app/`, `src/App.jsx`, `src/components/`): Next.js 16 and React 19, built and run with Bun, served under the base path `/uk/autumn-budget-2026` (`next.config.ts`). Tailwind CSS 4 on `@policyengine/ui-kit`'s theme; charts in Recharts. Population impact and Pre-measures forecast read precomputed files from `public/data/`; Household impact calls the household API.
- **Data package** (`src/uk_budget_data/`, CLI `uk-budget-data`): Python 3.13. Runs the measures through [policyengine.py](https://github.com/PolicyEngine/policyengine.py) and writes `public/data/`.
- **Household API** (`uk-budget-api`, `src/uk_budget_data/api.py`): FastAPI on Cloud Run (`uk-budget-api-2026`, `europe-west1`). Its `POST /api/household-impact` route is documented in [`docs/budget-day-publication.md`](docs/budget-day-publication.md#household-route-post-apihousehold-impact).

**Engine.** The project depends on `policyengine[uk]` 6.11.1 or later (`pyproject.toml`), locked at 6.11.1 (`uv.lock`), which pins policyengine-uk 2.151.0 and the certified Microcosm national dataset that goes with it. Population results are built with `pe.uk.managed_microsimulation()`, which downloads that dataset from a private Hugging Face repository and so needs `HUGGING_FACE_TOKEN`. Household calculations need no dataset. Upgrade the bundle, never policyengine-uk alone (see [`.claude/CLAUDE.md`](.claude/CLAUDE.md)).

## Publication and verified routes

Measure definitions do not authorise publication. The page builds its measure catalogue from `public/data/manifest.json`, which must identify the 28 October 2026 Budget (`release: uk-autumn-budget-2026` and the matching `budget` id and date). Labels, descriptions, selection, chart series and colours come from that catalogue. A Budget row requires an approved or provisional entry, a supported year and an artifact verified against its receipt and manifest. Package figures require the combined run of exactly the displayable measures. Chart series use `measure:<id>` keys; ordering and colours depend on the measure id and supported budgetary direction.

| Figures | Verified route |
|---|---|
| Public finances, deciles, winners and losers, metrics and household scatter | Receipt-verified artifacts through `loadDashboard` and `loadPublication` |
| Example households and young people | Artifact tables rechecked against their receipts with `loadVerifiedTable` |
| Regional and constituency results | SHA-256-bound release index plus `area_provenance.json`, with approved artifact, receipt and actual baseline/reform identities |
| Household impact | Live single-year household API after the same catalogue and year gate; held, unpublished or failed selections are unavailable, never zero. Each request waits for a check of the live manifest and is dropped if the snapshot changed; an answer from other policyengine, policyengine-uk or policyengine-core versions than the selected measures' receipts record is refused |
| OBR comparison | Unavailable until a 2026 source is verified; the existing CSV contains November 2025 costings |

The first row's figures are verified twice. The build runs `public/data` through the same loader (`loadDashboardParts`: manifest checks, every receipt check, every file's SHA-256 against its receipt) and bakes the verified tables into the static HTML (`src/app/publicationBoot.ts`), so the page paints them with no request. Once the opened view's code has loaded, the page loads the live manifest and every artifact through the same checks and compares: identical figures stay, different ones replace them, and a failed check withdraws them as a failed load always has. `data-publication-check` on `.app` reads `build` until then, `page` after. A deploy whose manifest the build cannot verify bakes nothing in, and the page loads and checks before it shows, as before.

The page shell, Methodology, Living standards baseline and the OBR forecasts remain available without a Budget manifest. Once `obr-forecast` loads the Budget's OBR forecast (its file and SHA-256 in the outlook, the file's review row pending), the Forecast changes sub-tab draws it beside the March 2026 forecast, for comparison (decided 28 October 2026). Missing, invalid, unreachable or other-Budget manifests remove Budget figures, with no fallback to unverified flat files. Focus and five-minute checks replace changed snapshots or restore verified results after recovery; Household impact caches are bound to the publication snapshot.

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
| `constituencies` | `constituency.csv` from Microcosm's published local-area cut: `geography`'s seats pass with each measure in a fresh process, resumable, with a timing and memory table (`--dry-run` checks the cut and the gates only; see the runbook's "Results by constituency on the local-area cut") |
| `income-curve` | `income_curve.csv`, the example households' net income across their income grids (no dataset needed) |
| `living-standards` | `living_standards_outlook.json`, the Pre-measures forecast tab ([data contract](docs/DATA_CONTRACT.md); inputs and sources in [`data_inputs/living_standards/`](data_inputs/living_standards/README.md)) |
| `obr-forecast --efo <economy tables .xlsx>` | Loads a new OBR forecast (the EFO detailed forecast tables, economy) into the Pre-measures forecast tab's Forecast changes series; before those tables are out, `--efo-pdf <pdf> --efo-text <txt>` reads the EFO PDF's Table A.1 (CPI, RPI, earnings, house prices) |
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
| Attest | Only while sign-off is on (it is off; see [Review and sign-off](#review-and-sign-off)): hand-written modifiers (`plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`) and any package holding them are held until **two different people** sign an attestation for that exact receipt | [How a measure must be written](docs/budget-day-runbook.md#how-a-measure-must-be-written) |
| Approve | `publish approve --by <name>`; `publish review-rows` writes the review rows sign-off needs, and deletes the artifacts no entry names | [G3](docs/budget-day-runbook.md#g3-rebase-and-reconcile-1340-to-1410) |
| Combined | `generate --combined` over the approved measures, staged and approved | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Results by area | `geography` over the approved ids locally, or `constituencies --backend modal` for seats on Microcosm's local-area cut; both write `area_provenance.json` for `publish index` | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Publish | `publish index`, `publish check`, then the pull request whose merge deploys | [G4](docs/budget-day-runbook.md#g4-combined-run-and-publish-1450) |
| Sources | Point the page's OBR and Budget-document links at the day's publications (config keys `obr_efo_current` and `budget_documents`, in #128 and #127) | — |
| Corrections | Withdraw, fix, regenerate | [G5](docs/budget-day-runbook.md#g5-corrections-whenever-one-arrives), [Rollback](docs/budget-day-runbook.md#rollback) |

**Who signs what.** Nobody, from Budget day evening (28 October 2026): sign-off is off, and a pull request merges on GitHub's review alone, with no review rows, no attestations and no second signer. The expected-effects rows (`data_inputs/treasury/expected_effects.csv`, in #140) still name whoever declared them, and the manifest records who approved each entry. With sign-off on, each attestation needs two distinct people, and approval and review rows are the Reconciler's. See [Roles](docs/budget-day-runbook.md#roles).

### Running it

- **Locally.** `uv run uk-budget-data generate --artifacts …` runs one measure at a time. A receipted measure peaks at about 14–17 GB, so run in parallel (`--jobs`, in #112) only with more than about 40 GB free. Results by area need up to about 64 GB (#115, #138).
- **On Modal.** The flat CSVs: `uv run --with modal==1.6.2 python -m uk_budget_data.cli generate --backend modal`, and on a pull request that changes a measure, the "Results on Modal" workflow, which uploads them for review and never commits or signs. Receipted artifacts in #139. Results by constituency: `uk-budget-data constituencies` (runbook, "Results by constituency on the local-area cut"). All read the certified data with the `policyengine` workspace's existing `pe-uk-private-hf-read-token` secret. One container per measure. Cost guards: no warm containers, a timeout on every function, no retries, a cap on parallel containers, and the app stopped after each run; check spend with `modal billing report --for today`. The decision and its reasons are on [#119](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/issues/119).
- **Household API.** Deployed by the "Deploy the household API" workflow (below). Budget-week capacity (8 vCPU, 8 GiB, eight workers, one instance kept warm) is in #141; set it back after the Budget.

## Review and sign-off

The figures derive from UKDS-licensed survey microdata, and this repository and the site are public, so every file under `public/` is a publication.

**Sign-off is off** from Budget day, 28 October 2026: `REQUIRED = False` in [`src/uk_budget_data/sign_off.py`](src/uk_budget_data/sign_off.py), the one switch. A pull request merges on GitHub's review alone. No public file needs a review row, no hand-written modifier is held for a two-person attestation, and there is no second signer. Every automated check still blocks:

- No public file may carry household, benefit unit or person ids or weights.
- No artifact may keep a cell resting on fewer survey households than the floor in its tables (`uk_budget_data.publication.disclosure_floor`), and every cell its receipt withholds must stay blank.
- Tables written by `policyengine.disclosure` (`regional.csv`, `constituency.csv`) must pass its `validate_public`. Results by area go through that layer only; the legacy constituency calculators (`generate --legacy-geography`) write only to the private directory named by `UK_BUDGET_DISCLOSURE_AUDIT_DIR`, outside any git repository.
- No file may carry more than 20 constituency, local-authority or small-area codes, unless it is a validated table, a reference input under `data_inputs/`, or reference geography whose exact bytes have a `reference_geography` row in [`data_inputs/public_data_review.csv`](data_inputs/public_data_review.csv) (or a `pending` row, until its expiry date). That row is the area-code guard's record that the file holds no survey figures, not a sign-off, so a changed boundary file needs a new one.
- `public/data/area-routing.json`, written from the installed bundle by `uk_budget_data.area_routing`, may hold only one of the few texts that module writes, and `area_provenance.json` must keep to its closed metadata schema.
- Two checks enforce these rules: `uv run python scripts/check_public_data.py` (CI's Public data check, and a Python test on this repository) and `bun scripts/check-public-files.mjs` (run by `bun run build`, so a deploy fails too). They print file paths and rule names, never values.
- `uv run uk-budget-data publish check` re-runs every publication gate on the manifest (CI's Publication gate): receipts, file digests, certification, responsiveness, the floor, completeness, reconciliation and combined-run membership.
- `main` requires a pull request and six checks: Python tests, Python lint, Certified data, Frontend build, Frontend tests and Frontend lint. It requires no approving review; requiring one is a change to the repository's ruleset, which only an admin can make.

**To turn sign-off back on**, set `REQUIRED = True` in `src/uk_budget_data/sign_off.py` and regenerate the page's contract, which carries the switch to the page and to the build's check (a test fails until the two agree): `uv run python -m uk_budget_data.publication.contract > src/utils/publication/contract.json`. Then add what the checks ask for:

- each file under `public/` needs a row in the review list with the sha256 of the bytes a person reviewed (`shasum -a 256 <file>`; `uv run uk-budget-data publish review-rows --reviewer NAME` writes the publication's), and any change fails until it is reviewed again. A `pending` row passes only until its expiry date, at most 14 days after it was added. The area routing status takes no row; disclosure tables are reviewed as `disclosure_table`, and `area_provenance.json` as `publication_provenance`;
- while a data limit is active, a hand-written modifier, and any package holding one, is held until two different people attest its exact receipt (`scripts/draft_attestation.py`); restage any entry staged without its attestation.

## Deployment

- **Web app:** the Vercel project `uk-autumn-budget-2026` builds `main` with `bun run build` (`vercel.json`); a merge to `main` publishes. Set `NEXT_PUBLIC_HOUSEHOLD_API_URL` for Production and Preview.
- **Household API:** the "Deploy the household API" workflow ([`.github/workflows/deploy-api.yml`](.github/workflows/deploy-api.yml)) submits [`cloudbuild.yaml`](cloudbuild.yaml), which deploys only a commit on `main`, smoke-tests the new revision before moving traffic, and rolls back through [`cloudbuild-rollback.yaml`](cloudbuild-rollback.yaml). Deploys on push stay off until the repository variable `API_DEPLOY_ON_PUSH` is `true`; until then, run the workflow by hand.

Settings, service limits and fallbacks are under "Production setup" in [`docs/budget-day-publication.md`](docs/budget-day-publication.md#production-setup-as-created).

## Contributing

Follow [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for code and writing conventions: British English, sentence case, and colours from the design tokens ([`docs/COLOURS.md`](docs/COLOURS.md), enforced by `src/colourGuard.test.js` and ESLint). Run `make format` before committing Python and `bun run lint --fix` before committing JavaScript.

## Licence

This project is for policy analysis. Data and analysis powered by PolicyEngine UK.

The constituency hex map's layout (`data_inputs/constituency_hexes.json`) is the Open Innovations HexJSON of the 2024 Westminster constituencies (open-innovations/constituencies, `src/_data/hexjson/uk-constituencies-2024.hexjson`), © Open Innovations, CC BY 4.0. Its drawing follows PolicyEngine's uk-mansion-tax hex map.
