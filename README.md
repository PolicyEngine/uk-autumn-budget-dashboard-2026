# UK Autumn Budget 2026 Dashboard

For the 5 October rehearsal, use the exact [drill 2 dataset/engine setup](docs/drill2-setup.md). The active policy list and result CSVs start empty; [DRILL2.md](DRILL2.md) governs timed release and publication gates.

A web application for analysing the impact of UK Autumn Budget 2026 policies on households and public finances, powered by [PolicyEngine UK](https://policyengine.org/uk).

## Features

- **Interactive policy selection**: Register statement-derived measures after the drill starts
- **Population preview**: Show fiscal and distributional CSV estimates after validation
- **Personal impact**: Compare household outcomes under selected reforms through the matching pinned Python backend
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

Start the pinned backend and frontend in separate terminals:

```bash
NEXT_PUBLIC_MOCK=1 PORT=8000 uv run uk-budget-api
NEXT_PUBLIC_MOCK=1 BUDGET_API_URL=http://127.0.0.1:8000 NEXT_PUBLIC_BASE_PATH="" bun run dev --hostname 127.0.0.1 --port 3001
```

Open `http://localhost:3001`. The drill starts empty. The Next.js route checks the Python backend's actual UK 2.100.0/core 3.32.5 versions before forwarding household requests. The shared public API currently runs 2.90.2 and cannot provide this drill's estimates. A hosted preview requires its own reachable matching backend; localhost is only suitable for local development.

See [the setup record](docs/drill2-setup.md) for the immutable private dataset, accepted limitations and G0 checks, and [the data notes](public/data/README.md) for publication status. The full household route can be smoke-tested with an empty selection before measures are registered, producing baseline-only results.

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
uv run uk-budget-data generate --dataset /path/to/microcosm_uk_2024_25.h5 --output-dir /tmp/budget-stage

# Generate for specific reforms
uv run uk-budget-data generate --dataset /path/to/microcosm_uk_2024_25.h5 --output-dir /tmp/budget-stage --reforms cgt_equalisation bus_fare_cap

# Custom years
uv run uk-budget-data generate --dataset /path/to/microcosm_uk_2024_25.h5 --output-dir /tmp/budget-stage --years 2026 2027
```

This national release has no constituency identifiers or aligned local weights, so local outputs are disabled. After measures exist, run `uv run python scripts/validate_published_data.py /tmp/budget-stage --policies <locked IDs>` before replacing result files. Before release use `--pre-start` against the schema-only `public/data` directory.

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

The drill selector is empty until the 12:30 statement release. Register only the locked statement-derived measures. Legacy definitions remain available in code for historical use outside the drill, but their generated result rows have been removed. [Measure templates](docs/drill2-measure-templates.md) describe the shared scenario path and file checklist.

## Technology stack

- **Frontend**: Next.js 16 and React 19
- **Charts**: Recharts 2.15 (built on D3)
- **Data generation**: Python 3.13+, the explicitly pinned PolicyEngine UK custom release
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
