"""Probe: do the drills' month-dated fuel duty changes reach the engine?

Run from a drill worktree (d1 or d2/d3), e.g.
    cd <work-dir>/d2 && .venv/bin/python <repo>/docs/drill-reruns/2026-10-24/probe_monthly_fuel_duty.py mock2_fuel_duty_hold

Builds a one-household simulation under the measure's baseline and reform
scenarios and prints the fuel duty each year. If the two columns match, the
duty part of the measure is lost and only the pump-VAT modifier is scored.
"""

import sys

from policyengine_uk import Simulation

from uk_budget_data import reforms

measure = sys.argv[1]
reform = next(
    r for r in reforms.get_autumn_budget_2026_reforms() if r.id == measure
)
years = ["2027", "2028", "2029"]
situation = {
    "people": {"a": {"age": {"2027": 40}}},
    "benunits": {"b": {"members": ["a"]}},
    "households": {
        "h": {"members": ["a"], "petrol_spending": {y: 1500 for y in years}}
    },
}
if hasattr(reform, "to_drill_scenario"):
    scenarios = {
        "baseline": reform.to_drill_scenario(baseline=True),
        "reform": reform.to_drill_scenario(),
    }
else:
    scenarios = {
        "baseline": reform.to_baseline_scenario(),
        "reform": reform.to_scenario(),
    }
out = {}
for label, scenario in scenarios.items():
    # Keep the scenario's simulation_modifier: _build_scenario puts the dated
    # fuel duty keys there, next to the pump-VAT modifier. The pump-VAT
    # modifier changes vat, not fuel_duty, so fuel_duty shows the duty alone.
    # (The first version set the modifier to None, which removed the dated
    # keys as well and printed current law on both sides for drills 1-3.)
    sim = Simulation(situation=situation, scenario=scenario)
    out[label] = [
        float(sim.calculate("fuel_duty", int(y)).sum()) for y in years
    ]
for i, y in enumerate(years):
    print(
        f"{measure} {y}: baseline fuel duty {out['baseline'][i]:.2f}, reform {out['reform'][i]:.2f}"
    )
