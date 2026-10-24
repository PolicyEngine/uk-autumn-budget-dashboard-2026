# UK Autumn Budget 2026 Dashboard

A web application for analysing the impact of UK Autumn Budget 2026 policies on households and public finances, powered by [PolicyEngine UK](https://policyengine.org/uk).

## Features

- **Interactive policy selection**: Choose from various budget policy options
- **Configurable parameters**: Adjust policy parameters (rates, thresholds, years)
- **Real-time analysis**: Automatic calculations when policies are selected or modified
- **Rich visualisations**: Charts showing budgetary impact, poverty effects, and distributional analysis
- **URL sharing**: Share specific policy configurations via URL parameters
- **Data export**: Download analysis results in TXT format

## Getting started

### Prerequisites

- [Bun](https://bun.sh), which CI uses for the frontend (`bun.lock` is the lockfile), and Node.js 20.9 or later, which Next.js 16 needs to run
- [uv](https://docs.astral.sh/uv/) and Python 3.13 or later (`requires-python` in `pyproject.toml`), for data generation

### Installation

- Install the frontend dependencies: `bun install --frozen-lockfile`
- Install the Python package for data generation: `uv sync --locked --extra dev`

### Development

Run the development server:

```bash
bun run dev
```

The dashboard is a Next.js app, served at `http://localhost:3000/uk/autumn-budget-2026` by default: `next.config.ts` sets that base path unless `NEXT_PUBLIC_BASE_PATH` is defined. Set `NEXT_PUBLIC_BASE_PATH=` (empty) to serve it at the root.

The Personal impact tab calls the lifecycle API at `${NEXT_PUBLIC_LIFECYCLE_API_URL}/calculate`, so set `NEXT_PUBLIC_LIFECYCLE_API_URL` to the API's URL followed by `/api/lifecycle` (locally, `http://localhost:5001/api/lifecycle`; see `.env.example`). The build fails on a value in any other form, and a Vercel production build fails without one (`scripts/lifecycle-api-env.mjs`); other builds warn.

### Building for production

```bash
bun run build
```

The build first checks every file under `public/` against its review list (`scripts/check-public-files.mjs`). Serve the production build:

```bash
bun run start
```

## Project structure

```
src/
├── app/                 # Next.js app router: layout.tsx, page.tsx, globals.css
├── App.jsx              # Main application controller
├── components/          # React components
│   ├── PolicySelector.jsx        # Policy selection
│   ├── BudgetaryImpactChart.jsx  # Budgetary impact chart
│   └── ...
└── uk_budget_data/      # Python data generation package
    ├── __init__.py      # Public API exports
    ├── models.py        # Pydantic data models
    ├── reforms.py       # Autumn Budget 2026 reform definitions
    ├── calculators.py   # Metric calculators
    ├── pipeline.py      # Data generation pipeline
    └── cli.py           # Command-line interface

tests/                   # Python tests for data generation
public/data/             # Generated CSV data files
data_inputs/             # Reference data (OBR estimates, constituencies)
```

## Data generation

The dashboard displays pre-calculated data from CSV files. The `uk_budget_data` Python package generates this data using PolicyEngine UK microsimulation.

### Quick start

```python
from pathlib import Path

from uk_budget_data import generate_all_data, get_reform, DataConfig

# Generate data for all Autumn Budget 2026 reforms
generate_all_data()

# Or with custom configuration
config = DataConfig(
    years=[2026, 2027, 2028, 2029],
    output_dir=Path("./public/data"),
)
generate_all_data(config=config)

# Generate for specific reforms only
reforms = [get_reform("two_child_limit"), get_reform("fuel_duty_freeze")]
generate_all_data(reforms=reforms)
```

### CLI usage

- List the available reforms: `uv run uk-budget-data generate --list-reforms`
- Generate all data: `uv run uk-budget-data generate`
- Generate for specific reforms: `uv run uk-budget-data generate --reforms two_child_limit fuel_duty_freeze`
- Choose the years: `uv run uk-budget-data generate --years 2026 2027`
- See every command: `uv run uk-budget-data --help`

### Disclosure control

The figures derive from UKDS-licensed survey microdata, and this repository and the site are public, so every file under `public/` is a publication. A check runs on every pull request:

```bash
uv run python scripts/check_public_data.py
```

Each file under `public/` must be listed in `data_inputs/public_data_review.csv` with the sha256 of the bytes a person reviewed; any change fails until it is reviewed again. The one exception is the page's area routing status, `public/data/area-routing.json`, written from the installed bundle by `uk_budget_data.area_routing`: it takes no review entry, and both checks refuse one, but it may hold only one of the few texts that module writes. A table written by `policyengine.disclosure` (`regional.csv`, `constituency.csv`) is reviewed as kind `disclosure_table` and must also pass the layer's `validate_public`. A `pending` entry passes only until its expiry date, at most 14 days after it was added. No public file may carry household, benefit unit or person ids or weights. The check prints file paths and rule names, never values. The build runs a smaller check of the same list (`scripts/check-public-files.mjs`), so a deploy fails too.

To review a changed file, record its new sha256 in the review list:

```bash
shasum -a 256 public/data/budgetary_impact.csv
```

Results by area go through the disclosure layer only. The legacy constituency calculators take direct means with no disclosure control. They run only with `--legacy-geography`, and write to the private directory named by `UK_BUDGET_DISCLOSURE_AUDIT_DIR`, which must be outside any git repository:

```bash
UK_BUDGET_DISCLOSURE_AUDIT_DIR=~/private/uk-budget-2026 uv run uk-budget-data generate --legacy-geography
```

### Custom baseline scenarios

Some reforms compare against a custom baseline rather than current law. For example, the fuel duty freeze compares the announced policy (freeze extension) against what would happen if the 5p cut ended.

```python
from uk_budget_data.models import Reform

# Reform with custom baseline
fuel_duty = Reform(
    id="fuel_duty_freeze",
    name="Fuel duty freeze",
    # Baseline: higher rates (no freeze)
    baseline_parameter_changes={
        "gov.hmrc.fuel_duty.petrol_and_diesel": {"2026": 0.58},
    },
    # Reform: lower rates (with freeze)
    parameter_changes={
        "gov.hmrc.fuel_duty.petrol_and_diesel": {"2026": 0.54},
    },
)
```

You can also set a global baseline for all reforms (e.g., pre-Autumn Budget baseline):

```python
config = DataConfig(
    baseline_parameter_changes={
        # Pre-Autumn Budget parameter values
        "gov.hmrc.income_tax.rates.uk[1].threshold": {"2026": 37700},
    }
)
generate_all_data(config=config)
```

### Running tests

- Run all tests: `uv run pytest`
- Run on four worker processes, as CI does: `uv run pytest -n 4 --dist loadgroup --no-loadscope-reorder`
- Run with coverage: `uv run pytest --cov=uk_budget_data`

Mark any test that takes minutes with `@pytest.mark.slow`; under xdist
such tests are collected first. With the command above, the first four slow
units start on separate workers, and the rest follow as each worker's next
unit (tests that share one household, through an `xdist_group`, count as one
unit). Each slow unit added lengthens the run.

## Published measures

The page builds one measure catalogue from the publication manifest
(`public/data/manifest.json`) and shows no figure without one. The file itself
must name this Budget (`release: uk-autumn-budget-2026`, and `budget` with that
id and the date 2026-10-28). With no manifest the page says that no Budget
results are published yet; an unreadable, invalid or other-Budget manifest shows
that published results are unavailable. Neither ever falls back to the flat CSVs.

The frontend contains no measure list. Labels, descriptions, selection, legends,
ordering and chart colours all come from the catalogue. Colours depend only on
the measure id and the sign of its supported budgetary impact; the order is
revenue, cost, then other measures, with ids sorted within each group. Chart
series are keyed `measure:<id>`, never by a published label.

Where each view's figures come from:

| View | Route |
|---|---|
| Public finances, deciles, winners and losers, headline metrics, household scatter | Receipt-verified artifacts (`loadDashboard`, #20's `loadPublication`) |
| Example households, young people | The same artifacts, each table re-read through its receipt (`loadVerifiedTable`) |
| OBR comparison | Unavailable: `obr_comparison.csv` is built from the November 2025 costings (`data_inputs/obr_estimates.csv`), so nothing binds it. It needs a 2026 OBR source. |
| Results by area | `regional.csv` and `constituency.csv` through the release index, which `publish index` writes only for tables the area run made from the entries now approved (`area_provenance.json`) |
| Personal impact (lifetime and single year) | The household API. Every measure is listed as not modelled, with no total, unless a reviewed mapping says the calculation implements its published parameters and years. There are none today. |

A row is shown only when its measure or combined run is displayable (approved or
provisional), the year is supported, and its artifact verified in the browser
against its receipt and the manifest. Package figures come from the combined run
of exactly the displayable measures. `uk-budget-data publish index` binds the
area files to the manifest's revision and bytes (`release-index.json`); the page
checks each file's SHA-256 before using it, and asks a reader to reload when the
manifest has changed since the page loaded (runbook, G4).

Frontend tests cover unfamiliar measure ids, held and stale entries, tampered
artifacts and flat files, mismatched index revisions, today's real
`public/data` without a manifest, and fast-check properties for the row gate,
catalogue membership, colours and series keys. Run `bun run test` (Vitest uses
at most two workers) and `bun run build`. The legacy-name guard covers frontend
source; Python reform definitions are unchanged.

## Technology stack

- **Frontend**: Next.js 16 with React 19
- **Charts**: Recharts 2.15 (built on D3)
- **Data generation**: Python 3.13+, PolicyEngine UK through policyengine.py
- **State management**: React hooks (useState, useEffect, useMemo)
- **Styling**: Tailwind CSS 4 with `@policyengine/ui-kit`'s theme, plus component CSS
- **Tests**: Vitest for the frontend, pytest for the Python package
- **Build tool**: Next.js, run with Bun

## Design system

The dashboard uses PolicyEngine UK's design system:

- **Colour palette**:
  - Primary teal: `#319795`
  - Teal light: `#4db3b1`
  - Teal dark: `#277674`
  - Grey scale: `#f9fafb` to `#111827`

- **Typography**: Roboto font with multiple weights for clear hierarchy

- **Responsive**: Mobile-friendly design with breakpoints at 768px

## Style guide

See `.claude/CLAUDE.md` for comprehensive style and architecture guidelines including:

- Colour palette and typography
- Component patterns and React conventions
- Chart configuration best practices
- British English formatting rules
- Accessibility requirements

## Contributing

When contributing to this project:

1. Follow the guidelines in `.claude/CLAUDE.md`
2. Run `make format` before committing Python code
3. Run `bun run lint --fix` before committing JavaScript
4. Ensure tests pass with `uv run pytest`

## Licence

This project is for policy analysis purposes. Data and analysis powered by PolicyEngine UK.
