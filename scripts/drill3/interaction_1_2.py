"""MOCK drill 3: national interaction of measures 1 (freeze) and 2 (Pensioner Allowance), 2031-32.

Static liability change (£m): combined minus measure 1 alone minus measure 2 alone, each against
its own Annex A baseline (both pin PA 2031 = 12,830 and the Annex A State Pension in the combined
baseline). Uses the engine's gov_balance-free income tax + NI totals via gov_tax.
"""
import numpy as np
from policyengine_uk import Microsimulation
from uk_budget_data.models import Reform
from uk_budget_data.reforms import get_reform

DS = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
Y = 2031
import sys
VAR = sys.argv[1] if len(sys.argv) > 1 else "gov_tax"
m1, m2 = get_reform("mock3_threshold_freeze_2032"), get_reform("mock3_pensioner_allowance")
both = Reform(
    id="mock3_m1_m2", name="m1+m2",
    baseline_parameter_changes={**(m2.baseline_parameter_changes or {}), **(m1.baseline_parameter_changes or {})},
    parameter_changes={**(m2.parameter_changes or {}), **(m1.parameter_changes or {})},
    baseline_simulation_modifier=m2.baseline_simulation_modifier,
    simulation_modifier=m2.simulation_modifier,
)

def tax(r, baseline):
    s = Microsimulation(dataset=DS, scenario=r.to_drill_scenario(baseline=baseline))
    return float((s.calculate(VAR, Y)).sum()) / 1e6

out = {}
for name, r in (("m1", m1), ("m2", m2), ("m1+m2", both)):
    out[name] = tax(r, False) - tax(r, True)
    print(name, round(out[name], 1))
print("interaction", round(out["m1+m2"] - out["m1"] - out["m2"], 1))
