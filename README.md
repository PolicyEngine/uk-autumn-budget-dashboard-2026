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

Each file under `public/` must be listed in `data_inputs/public_data_review.csv` with the sha256 of the bytes a person reviewed; any change fails until it is reviewed again. A table written by `policyengine.disclosure` (`regional.csv`, `constituency.csv`) is reviewed as kind `disclosure_table` and must also pass the layer's `validate_public`. A `pending` entry passes only until its expiry date, at most 14 days after it was added. No public file may carry household, benefit unit or person ids or weights. The check prints file paths and rule names, never values. The build runs a smaller check of the same list (`scripts/check-public-files.mjs`), so a deploy fails too.

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

The page builds one measure catalogue from the publication manifest, or from
`reform_id` and `reform_name` in the reviewed flat CSVs when the manifest is
absent (HTTP 404). The frontend contains no measure list. Labels, descriptions,
selection, legends and chart colours all use the catalogue. Colours depend only
on the measure id and the sign of its supported budgetary impact; the order is
revenue, cost, then other measures, with ids sorted within each group.

This change keeps the rehearsed flat CSV figure route. When present, the manifest
gates every view by status and supported year; combined results also require
current member fingerprints. An invalid or unreachable manifest fails closed.
This route does not verify flat-file bytes against artifact receipts: the public
file review and build checks remain required. Complete receipt-verified artifact
loading is a separate integration.

Generation publishes public descriptions in the budgetary CSV and in receipts
and staged manifest entries. It also publishes personal API response mappings,
including inseparable shared series, so the old household API keeps working
without frontend aliases. Regenerate and review outputs to add this metadata to
existing flat files; older files show an explicit missing-description fallback
and list unmatched personal series as not modelled. Missing selected figures
never become zero or a partial total. Held measures are listed with an
unavailable notice and excluded from the figures.

Frontend tests include unfamiliar measures, publication gates, legacy household
compatibility and fast-check properties for catalogue membership and colours.
Run `bun run test` (Vitest is capped at four workers) and `bun run build`. The
legacy-name guard covers frontend source; Python reform definitions remain
unchanged apart from publication metadata.

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
