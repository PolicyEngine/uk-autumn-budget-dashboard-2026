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

- Node.js 20.x or higher
- npm 11.x or higher
- Python 3.10+ (for data generation)

### Installation

```bash
# Install frontend dependencies
npm install

# Install Python package for data generation
pip install -e ".[dev]"
```

### Development

Run the development server:

```bash
npm run dev
```

The dashboard will be available at `http://localhost:5173`

### Building for production

```bash
npm run build
```

Preview the production build:

```bash
npm preview
```

## Project structure

```
src/
├── App.jsx              # Main application controller
├── App.css              # App-level styles
├── main.jsx             # Entry point
├── index.css            # Global styles
├── components/          # React components
│   ├── Sidebar.jsx      # Policy selection & parameter controls
│   ├── Results.jsx      # Charts & analysis display
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

```bash
# List available reforms
uk-budget-data --list-reforms

# Generate all data
uk-budget-data

# Generate for specific reforms
uk-budget-data --reforms two_child_limit fuel_duty_freeze

# Custom years
uk-budget-data --years 2026 2027
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

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=uk_budget_data
```

## Available reforms

The dashboard analyses these November 2025 Autumn Budget policies:

| Reform | Description |
|--------|-------------|
| `two_child_limit` | Repeal of the two-child limit on benefits |
| `fuel_duty_freeze` | Extension of the fuel duty freeze |
| `threshold_freeze_extension` | Extension of income tax threshold freeze |
| `dividend_tax_increase_2pp` | +2pp on dividend tax rates |
| `savings_tax_increase_2pp` | +2pp on savings income tax |
| `property_tax_increase_2pp` | +2pp on property income tax |
| `rail_fares_freeze` | One-year freeze on regulated rail fares |
| `freeze_student_loan_thresholds` | Freeze Plan 2 repayment thresholds |
| `salary_sacrifice_cap` | Cap NI-free salary sacrifice at £2,000 |

## Technology stack

- **Frontend**: React 18.3 with Vite
- **Charts**: Recharts 2.15 (built on D3)
- **Data generation**: Python 3.10+, PolicyEngine UK
- **State management**: React hooks (useState, useEffect, useMemo)
- **Styling**: Custom CSS inspired by PolicyEngine UK
- **Build tool**: Vite 5.4

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
3. Run `npm run lint -- --fix` before committing JavaScript
4. Ensure tests pass with `pytest`

## Licence

This project is for policy analysis purposes. Data and analysis powered by PolicyEngine UK.
