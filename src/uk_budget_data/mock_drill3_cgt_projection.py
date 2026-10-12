"""MOCK drill 3, measure 4 data work: EXPERIMENTAL CGT-specific projection.

In policyengine-uk 2.125.1, ``capital_gains_before_response`` (Person) is
uprated from the 2024-25 observed year by
``gov.economic_assumptions.indices.obr.per_capita.gdp``, which carries the
synthetic observed-year spike forward. This opt-in modifier replaces that
path for 2025-2031 with the packet's ``gross_realised_gains_bn`` path,
normalised to its 2024-25 anchor (118.0):

    factor(y) = [path(y) / 118.0] / [engine_uprating(y)]

applied to the engine's own uprated values, so each person's amount becomes
``gains_2024 * path(y) / 118``. The engine uprating is measured from the
simulation itself (unweighted ratio of uprated to observed amounts), so the
engine's GDP-per-capita uprating is cancelled exactly.

Scope and limitations (MOCK, unvalidated under this engine):
- Amount multiplier only. Weights are NOT changed. The packet's taxpayer
  determinants (551 -> 540 ... 620 thousand) are therefore not applied:
  incidence across people is held at the observed year and the dataset's
  taxpayer count vs the path is reported as a residual, not reconciled.
- 2024-25 observed amounts and weights are untouched (factor = 1).
- No additional level adjustment: the dataset's own 2024-25 level is kept
  and only the path's growth relative to the anchor is applied.
- No forestalling or behavioural response is embedded in the baseline.
- The dataset file is never modified; the change is a simulation modifier.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from uk_budget_data.models import Reform

MOCK3_CGT_PROJECTION_VARIABLE = "capital_gains_before_response"
MOCK3_CGT_ANCHOR_YEAR = 2024
MOCK3_CGT_PROJECTION_YEARS = tuple(range(2025, 2032))
MOCK3_CGT_INPUTS_CSV = (
    Path(__file__).resolve().parents[2]
    / "data_inputs"
    / "mock_drill3"
    / "packet"
    / "MOCK-cgt-projection-inputs.csv"
)


def load_cgt_projection_inputs(path: Path = MOCK3_CGT_INPUTS_CSV) -> dict:
    """Read the packet CSV (skipping the MOCK first line), keyed by start year."""
    with open(path, newline="") as f:
        lines = f.read().splitlines()[1:]
    rows = {}
    for row in csv.DictReader(lines):
        year = int(row["tax_year"][:4])
        rows[year] = {
            k: (v if k in ("tax_year", "stage") else float(v))
            for k, v in row.items()
        }
    return rows


def gains_path_index(year: int, inputs: Optional[dict] = None) -> float:
    """path(y) / path(2024): the packet gross-gains path normalised to 118.0."""
    inputs = inputs or load_cgt_projection_inputs()
    anchor = inputs[MOCK3_CGT_ANCHOR_YEAR]["gross_realised_gains_bn"]
    return inputs[year]["gross_realised_gains_bn"] / anchor


def gdp_per_capita_index(parameters, year: int) -> float:
    """Engine GDP-per-capita index ratio, year vs anchor (diagnostic)."""
    gdp = parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    return float(gdp(f"{year}-01-01") / gdp(f"{MOCK3_CGT_ANCHOR_YEAR}-01-01"))


def _engine_uprating(anchor: np.ndarray, uprated: np.ndarray) -> float:
    """Uniform engine uprating factor uprated/anchor, measured on the data."""
    total = float(np.abs(anchor).sum())
    if total == 0:
        return 1.0
    return float(np.abs(uprated).sum() / total)


def cgt_projection_factors(sim, inputs: Optional[dict] = None) -> dict:
    """factor(y) for 2024 and projection years, measured on ``sim``."""
    inputs = inputs or load_cgt_projection_inputs()
    anchor = np.asarray(
        sim.calculate(MOCK3_CGT_PROJECTION_VARIABLE, MOCK3_CGT_ANCHOR_YEAR)
    )
    factors = {MOCK3_CGT_ANCHOR_YEAR: 1.0}
    for year in MOCK3_CGT_PROJECTION_YEARS:
        uprated = np.asarray(sim.calculate(MOCK3_CGT_PROJECTION_VARIABLE, year))
        factors[year] = gains_path_index(year, inputs) / _engine_uprating(
            anchor, uprated
        )
    return factors


def apply_cgt_projection(sim, inputs: Optional[dict] = None) -> dict:
    """Simulation modifier: rescale gains amounts for 2025-2031 in place.

    Returns the factors applied (also stored on ``sim.mock3_cgt_factors``).
    Weights and the 2024-25 observed amounts are left unchanged.
    """
    inputs = inputs or load_cgt_projection_inputs()
    factors = cgt_projection_factors(sim, inputs)
    for year in MOCK3_CGT_PROJECTION_YEARS:
        uprated = np.asarray(sim.calculate(MOCK3_CGT_PROJECTION_VARIABLE, year))
        sim.set_input(
            MOCK3_CGT_PROJECTION_VARIABLE, year, uprated * factors[year]
        )
    sim.mock3_cgt_factors = factors
    return factors


def _compose(first: Optional[Callable], second: Callable) -> Callable:
    def modifier(sim):
        if first is not None:
            first(sim)
        second(sim)

    return modifier


def with_cgt_projection(reform: Reform) -> Reform:
    """Copy of ``reform`` with the projection in baseline and reform sims.

    Existing modifiers run first; the projection runs last. Parameter changes
    are preserved unchanged.
    """
    return reform.model_copy(
        update={
            "id": f"{reform.id}__cgt_projection",
            "baseline_simulation_modifier": _compose(
                reform.baseline_simulation_modifier, apply_cgt_projection
            ),
            "simulation_modifier": _compose(
                reform.simulation_modifier, apply_cgt_projection
            ),
        }
    )
