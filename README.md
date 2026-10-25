# UK Autumn Budget 2026 dashboard

PolicyEngine's dashboard for the UK Autumn Budget on 28 October 2026. It models how nine candidate Budget measures would change public finances and household incomes, by income decile, area and age, and for a household you describe, alongside a living standards outlook to 2031-32. The measures are candidates modelled before the Budget, not announced policy, and the page says so on every tab that shows them. Budget figures appear only after verified publication. Figures come from [PolicyEngine UK](https://policyengine.org/uk) microsimulation on the certified Microcosm dataset.

Live: <https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026>

## Tabs

The tab list is `VIEWS` in [`src/App.jsx`](src/App.jsx); the open tab and sub-tab, the selected measures and the Personal impact answers are kept in the address (`?tab=`, `?sub=`, `?policies=`, `?personal=`), so a link reopens the same view.

| Tab | What it shows |
|---|---|
| Population impact | Budgetary impact, distributional impact, winners and losers, and results by region and constituency, for each fiscal year from 2026-27 to 2031-32. Sub-tabs: **All households** and **Young people**. |
| Personal impact | One household, one year: net income before and after the selected measures, each measure's own change, and an earnings sweep. Calculated live by the household API (`POST /api/household-impact`). |
| Living standards | Baseline outlook (income, poverty and inequality projections from 2027-28 to 2031-32, with HBAI outturn and OBR series) and Forecast changes (the OBR's pre-Budget forecast against the Budget forecast). Sub-tabs: **Baseline outlook** and **Forecast changes**. The latter currently shows the pre-Budget forecast; the Budget-day comparison awaits verified provenance. |
| Methodology | Data, model, measures, limitations, and the versions needed to replicate the figures. |

Every chart downloads as CSV, PNG, SVG or plain text.

## Measures

Nine candidate measures, each compared against current law in policyengine-uk. They are defined in [`src/uk_budget_data/reforms.py`](src/uk_budget_data/reforms.py) (ids, names, full descriptions and parameter changes), with the measures that need more than a parameter change implemented as simulation modifiers in [`src/uk_budget_data/budget_measures.py`](src/uk_budget_data/budget_measures.py). `autumn_budget_2026_combined` simulates all nine together, with their interactions.

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

A tenth candidate, the £2,000 salary sacrifice cap brought forward to April 2028, was dropped on 24 October: on policyengine-uk 2.132.6 its revenue included spurious income tax, because adjusted net income does not deduct the excess redirected into the pension.

List them from the command line with `uv run uk-budget-data generate --list-reforms`.

## Architecture

- **Web app** (`src/app/`, `src/App.jsx`, `src/components/`): Next.js 16 and React 19, built and run with Bun, served under the base path `/uk/autumn-budget-2026` (`next.config.ts`). Tailwind CSS 4 on `@policyengine/ui-kit`'s theme; charts in Recharts. Population impact and Living standards read precomputed files from `public/data/`; Personal impact calls the household API.
- **Data package** (`src/uk_budget_data/`, CLI `uk-budget-data`): Python 3.13. Runs the measures through [policyengine.py](https://github.com/PolicyEngine/policyengine.py) and writes `public/data/`.
- **Household API** (`uk-budget-api`, `src/uk_budget_data/api.py`): FastAPI on Cloud Run (`uk-budget-api-2026`, `europe-west1`). Its `POST /api/household-impact` route is documented in [`docs/budget-day-publication.md`](docs/budget-day-publication.md#household-route-post-apihousehold-impact).

**Engine.** The project depends on `policyengine[uk]` 6.10.2 (`pyproject.toml`, `uv.lock`), which pins policyengine-uk 2.132.6 and the certified Microcosm national dataset that goes with it. Population results are built with `pe.uk.managed_microsimulation()`, which downloads that dataset from a private Hugging Face repository and so needs `HUGGING_FACE_TOKEN`. Household calculations need no dataset. Upgrade the bundle, never policyengine-uk alone (see [`.claude/CLAUDE.md`](.claude/CLAUDE.md)).

## Publication and verified routes

Candidate definitions do not authorise publication. The page builds its measure catalogue from `public/data/manifest.json`, which must identify the 28 October 2026 Budget (`release: uk-autumn-budget-2026` and the matching `budget` id and date). Labels, descriptions, selection, chart series and colours come from that catalogue. A Budget row requires an approved or provisional entry, a supported year and an artifact verified against its receipt and manifest. Package figures require the combined run of exactly the displayable measures. Chart series use `measure:<id>` keys; ordering and colours depend on the measure id and supported budgetary direction.

| Figures | Verified route |
|---|---|
| Public finances, deciles, winners and losers, metrics and household scatter | Receipt-verified artifacts through `loadDashboard` and `loadPublication` |
| Example households and young people | Artifact tables rechecked against their receipts with `loadVerifiedTable` |
| Regional and constituency results | SHA-256-bound release index plus `area_provenance.json`, with approved artifact, receipt and actual baseline/reform identities |
| Personal impact | Live single-year household API after the same catalogue and year gate; held, unpublished or failed selections are unavailable, never zero. Each request waits for a check of the live manifest and is dropped if the snapshot changed; an answer from other policyengine, policyengine-uk or policyengine-core versions than the selected measures' receipts record is refused |
| OBR comparison | Unavailable until a 2026 source is verified; the existing CSV contains November 2025 costings |

The page shell, Methodology, Living standards baseline and March 2026 forecast remain available without a Budget manifest. The Budget-day forecast remains unavailable until verified provenance exists; `post_published` alone does not authorise it. Missing, invalid, unreachable or other-Budget manifests remove Budget figures, with no fallback to unverified flat files. Focus and five-minute checks replace changed snapshots or restore verified results after recovery; Personal impact caches are bound to the publication snapshot.

Before simulation, the area run compares its actual baseline and reform identities with approved receipts. `uk-budget-data publish index` binds exactly the CSV files the run wrote, their aliases and the provenance sidecar to the manifest revision and bytes; the page verifies those digests before showing figures. A changed or incomplete area snapshot stays unavailable until its matching index is published.

Frontend tests include unfamiliar measure ids, held and stale entries, tampered artifacts and flat files, mismatched revisions and the real unreceipted `public/data`. Fast-check properties cover the publication gates, catalogue membership, colours and series keys; Hypothesis tests pin area identity and provenance invariants. The legacy-name guard covers frontend source; Python owns the candidate definitions.

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
| `living-standards` | `living_standards_outlook.json`, the Living standards tab ([data contract](docs/DATA_CONTRACT.md); inputs and sources in [`data_inputs/living_standards/`](data_inputs/living_standards/README.md)) |
| `obr-forecast --efo <economy tables .xlsx>` | Loads a new OBR forecast (the EFO detailed forecast tables, economy) into the Living standards Forecast changes series |
| `publish …` | Reconciles, stages, approves and checks entries in the publication manifest |

The same pipeline is importable: `from uk_budget_data import generate_all_data, get_reform, DataConfig`. A `Reform` can carry `baseline_parameter_changes` to compare against something other than current law (`src/uk_budget_data/models.py`).

### Budget day

The Budget-day sequence (receipts, coverage, provisional numbers, reconciliation against the Treasury's figures, the combined run, the OBR forecast load and rollback) is in [`docs/budget-day-runbook.md`](docs/budget-day-runbook.md). The design behind it, the production setup and the household route are in [`docs/budget-day-publication.md`](docs/budget-day-publication.md).

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

Follow [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for code and writing conventions: British English, sentence case, and colours from the design tokens. Run `make format` before committing Python and `bun run lint --fix` before committing JavaScript.

## Licence

This project is for policy analysis. Data and analysis powered by PolicyEngine UK.
