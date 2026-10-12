"""MOCK drill 3: experimental CGT projection (measure 4 data work)."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.mock_drill3_cgt_projection import (
    apply_cgt_projection,
    cgt_projection_factors,
    gains_path_index,
    load_cgt_projection_inputs,
    with_cgt_projection,
)
from uk_budget_data.reforms import get_reform

VAR = "capital_gains_before_response"


def _situation():
    return {
        "people": {
            "a": {"age": {2024: 40}, VAR: {2024: 10_000}},
        },
        "benunits": {"b": {"members": ["a"]}},
        "households": {"h": {"members": ["a"]}},
    }


def test_path_index_anchor_and_2027():
    inputs = load_cgt_projection_inputs()
    assert gains_path_index(2024, inputs) == 1.0
    assert gains_path_index(2027, inputs) == pytest.approx(95.0 / 118.0)


def test_factor_2024_is_exactly_one():
    sim = Simulation(situation=_situation())
    assert cgt_projection_factors(sim)[2024] == 1.0


def test_single_person_rescales_to_path_and_cancels_engine_uprating():
    sim = Simulation(situation=_situation())
    engine_2027 = float(sim.calculate(VAR, 2027)[0])
    factors = apply_cgt_projection(sim)
    assert float(sim.calculate(VAR, 2024)[0]) == 10_000
    projected = float(sim.calculate(VAR, 2027)[0])
    assert projected == pytest.approx(10_000 * 95.0 / 118.0, rel=1e-6)
    # float32 storage; factor x engine's uprated value reproduces the path: uprating cancelled
    assert factors[2027] * engine_2027 == pytest.approx(projected, rel=1e-6)


def test_with_cgt_projection_keeps_parameters_and_wraps_both_modifiers():
    reform = get_reform("mock3_cgt_higher_rate_aea")
    wrapped = with_cgt_projection(reform)
    assert wrapped.parameter_changes == reform.parameter_changes
    assert wrapped.baseline_simulation_modifier is not None
    assert wrapped.simulation_modifier is not None
    sim = Simulation(
        situation=_situation(), scenario=wrapped.to_drill_scenario(baseline=True)
    )
    assert float(sim.calculate(VAR, 2027)[0]) == pytest.approx(
        10_000 * 95.0 / 118.0, rel=1e-6
    )
