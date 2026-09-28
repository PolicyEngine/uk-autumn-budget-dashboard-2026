# UK Autumn Budget 2026 Dashboard

A web application for analysing the impact of UK Autumn Budget 2026 policies on households and public finances, powered by [PolicyEngine UK](https://policyengine.org/uk).

## Features

- **Interactive policy selection**: Combine three 2026 candidates and four carried-over measures
- **Population preview**: See checked-in fiscal and distributional CSV estimates by year
- **Personal impact**: Compare household outcomes under selected reforms through the PolicyEngine UK API
- **URL sharing**: Share selections, including links to retained 2025 measures
- **Charts and exports**: Inspect income, budget and distributional results and export charts

## Getting started

### Prerequisites

- Node.js 20.x or higher
- Bun 1.x or higher
- Python 3.13+ (for data generation or the optional local household backend)

### Installation

```bash
# Install frontend dependencies
bun install --frozen-lockfile

# Install Python package for data generation
uv sync --extra dev --frozen
```

### Development

Start the frontend:

```bash
NEXT_PUBLIC_BASE_PATH="" bun run dev --hostname 127.0.0.1 --port 3001
```

Open `http://localhost:3001`. Personal impact calls the live PolicyEngine UK
household API from the server-side Next.js route. The adapter checks that the
API model is 2.90.2, matching the dashboard's pinned model, and computes the
selected measures against their respective baselines.

To use the repository's Python FastAPI calculator instead, start it separately:

```bash
.venv/bin/python -m uvicorn uk_budget_data.api:app --host 127.0.0.1 --port 8001
```

Then set server-side `BUDGET_API_URL=http://127.0.0.1:8001` for the Next.js
process. `POLICYENGINE_UK_API_URL` can override the default
`https://api.policyengine.org` host when using the adapter.

The dashboard offers three candidate measures and four carried-over measures.
The checked-in national CSVs are a provisional local rerun of all seven featured
measures against the current code. The source dataset's certified release and
aligned constituency weights remain unverified. See
[the data notes](public/data/README.md) for generation details and the missing
constituency weights. Personal impact computes the featured policies currently
selected in the dashboard. The API adapter works without a separately deployed
backend; a calculation can take a few minutes. For a dedicated backend, deploy
the FastAPI service from `cloudbuild.yaml` and set server-side `BUDGET_API_URL`
to its reachable URL. Verify the deployed service and its model version before
relying on personal results.

### Building for production

```bash
bun run build
```

Preview the production build:

```bash
bun run start
```

## Project structure

```
src/
├── app/                  # Next.js page and personal-impact proxy
├── App.jsx               # Dashboard controller
├── components/           # React charts and forms
├── utils/                # Shared policy configuration
└── uk_budget_data/       # Python reforms, pipeline and FastAPI service

tests/                   # Python tests for data generation
public/data/             # Generated CSV data files
data_inputs/             # Reference data (OBR estimates, constituencies)
```

## Data generation

The dashboard displays pre-calculated data from CSV files. The `uk_budget_data` Python package generates this data using PolicyEngine UK microsimulation.

### CLI usage

```bash
# List available reforms
uv run uk-budget-data generate --list-reforms

# Generate all data
uv run uk-budget-data generate --dataset /path/to/certified/enhanced_frs_2024_25.h5 --output-dir /tmp/budget-stage

# Generate for specific reforms
uv run uk-budget-data generate --dataset /path/to/certified/enhanced_frs_2024_25.h5 --output-dir /tmp/budget-stage --reforms cgt_equalisation bus_fare_cap

# Custom years
uv run uk-budget-data generate --dataset /path/to/certified/enhanced_frs_2024_25.h5 --output-dir /tmp/budget-stage --years 2026 2027
```

Use constituency weights from the same certified data release. Run
`uv run python scripts/validate_published_data.py /tmp/budget-stage --require-constituency`
before replacing checked-in data. See [data provenance and merge gates](public/data/README.md).

### Custom baseline scenarios

Some reforms compare two custom scenarios. The fuel cancellation overrides
the older model's duty schedule on both sides of the comparison using HMRC's
published 2026–27 rates. The threshold and source-income tax measures use
pre-policy baselines while the reformed model already contains the changed
rates. The exact parameter paths and periods are in
[`src/uk_budget_data/reforms.py`](src/uk_budget_data/reforms.py).

### Running tests

```bash
# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov=uk_budget_data
```

## Available reforms

The 2026 selector includes these three candidates and four carried-over measures:

| Reform | Description |
|--------|-------------|
| `cgt_equalisation` | Simplified CGT rate-alignment scenario |
| `fuel_duty_rise_cancellation` | Hold the 52.95p/L rate from 2027 |
| `bus_fare_cap` | £2 cap proxy from 2027 in England outside London |
| `threshold_freeze_extension` | Extension of income tax threshold freeze |
| `dividend_tax_increase_2pp` | +2pp on dividend tax rates |
| `savings_tax_increase_2pp` | +2pp on savings income tax |
| `property_tax_increase_2pp` | +2pp on property income tax |

The five enacted or superseded 2025 measures remain in the data and URL
lookup for old shared links.

## Technology stack

- **Frontend**: Next.js 16 and React 19
- **Charts**: Recharts 2.15 (built on D3)
- **Data generation**: Python 3.13+, policyengine.py with PolicyEngine UK
- **State management**: React hooks (useState, useEffect, useMemo)
- **Styling**: Custom CSS inspired by PolicyEngine UK
- **Build tool**: Next.js with Bun

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
3. Run `bun run lint` and `bun run test` for frontend changes
4. Run `uv run pytest` and `uv run ruff check .` for Python changes

## Licence

This project is for policy analysis purposes. Data and analysis powered by PolicyEngine UK.
