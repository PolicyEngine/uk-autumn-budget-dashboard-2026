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

The Personal impact tab POSTs to `${NEXT_PUBLIC_HOUSEHOLD_API_URL}` itself, so set `NEXT_PUBLIC_HOUSEHOLD_API_URL` to the API's URL followed by `/api/household-impact` (locally, `http://localhost:8010/api/household-impact`; see `.env.example`). The build fails on a value in any other form, and a Vercel production build fails without one (`scripts/household-api-env.mjs`); other builds warn.

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
reforms = [get_reform("fuel_duty_rise_deferral"), get_reform("threshold_freeze_2031_32")]
generate_all_data(reforms=reforms)
```

### CLI usage

- List the available reforms: `uv run uk-budget-data generate --list-reforms`
- Generate all data: `uv run uk-budget-data generate`
- Generate for specific reforms: `uv run uk-budget-data generate --reforms fuel_duty_rise_deferral threshold_freeze_2031_32`
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

Most measures compare against current law. A reform can instead bring a custom baseline, for example to compare a policy against what would have happened without it.

```python
from uk_budget_data.models import Reform

# Reform with custom baseline
fuel_duty = Reform(
    id="example_fuel_duty",
    name="Example fuel duty change",
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

## Available reforms

The dashboard analyses ten candidate measures for the Autumn Budget on 28 October 2026, modelled before the Budget from reporting up to 24 October; none is announced policy. Each is compared against current law in policyengine-uk (`src/uk_budget_data/reforms.py`; modifiers in `budget_measures.py`). `autumn_budget_2026_combined` simulates all ten together.

| Reform | Description |
|--------|-------------|
| `fuel_duty_rise_deferral` | 52.95p held through winter 2026-27, the 5p restored in autumn 2027, with the VAT on the pump price |
| `state_pension_income_tax_protection` | An allowance of the full new State Pension for people over State Pension age, from April 2027 |
| `warm_home_discount_top_up` | Warm Home Discount from £150 to £250, winter 2026-27 |
| `domestic_electricity_zero_vat` | 0% VAT on domestic electricity, October 2026 to March 2028 |
| `employer_ni_relief_under_25s` | No employer NI up to the upper earnings limit for employees under 25, from April 2027 |
| `threshold_freeze_2031_32` | Personal allowance and basic rate band frozen in 2031-32 |
| `badr_lifetime_limit_cut` | Business Asset Disposal Relief lifetime limit from £1m to £500,000, from April 2027 |
| `salary_sacrifice_cap_2028` | The £2,000 salary sacrifice cap from April 2028 |
| `road_fuel_vat_cut` | VAT on petrol and diesel at 15%, December 2026 to May 2027 |
| `plan_2_threshold_unfreeze` | Plan 2 repayment threshold uprated by RPI from April 2027 |

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
