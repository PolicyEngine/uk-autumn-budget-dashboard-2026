"""MOCK drill 3: fuel duty phasing on a fiscal-year (April-March) basis.

The registered measure runs on calendar-month schedules, so the pipeline's
annual figure is a calendar year, VAT-inclusive. Costings are usually fiscal
and duty-only. This recomputes from the same schedules:

  fiscal FY Y = sum over Apr Y .. Mar Y+1 of (baseline - reform rate)
                x household litres in that month's calendar year / 12

Litres are the engine's weighted petrol + diesel litres (baseline), assumed
even across months. Duty-only and VAT-inclusive (x 1.2) are both printed.
Usage: uv run python scripts/drill3/fuel_fiscal.py [dataset.h5]
"""
import sys

import numpy as np
from policyengine_uk import Microsimulation

from uk_budget_data.mock_drill3_fuel import (
    MOCK3_PUMP_VAT_RATE,
    _mock3_fuel_baseline_rate,
    _mock3_fuel_reform_rate,
)
from uk_budget_data.reforms import get_reform

DATASET = sys.argv[1] if len(sys.argv) > 1 else (
    "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
)
YEARS = range(2026, 2033)

reform = get_reform("mock3_fuel_duty_phasing")
sim = Microsimulation(dataset=DATASET, scenario=reform.to_drill_scenario(baseline=True))
litres = {}
for y in YEARS:
    w = np.asarray(sim.calculate("household_weight", y))
    lit = np.asarray(sim.calculate("petrol_litres", y, map_to="household")) + np.asarray(
        sim.calculate("diesel_litres", y, map_to="household")
    )
    litres[y] = float((w * lit).sum())


def gap(y, m):
    return _mock3_fuel_baseline_rate(y, m) - _mock3_fuel_reform_rate(y, m)


print("calendar_year,household_litres_bn")
for y in YEARS:
    print(f"{y},{litres[y] / 1e9:.3f}")
print("fiscal_year,duty_only_bn,vat_inclusive_bn")
for y in range(2026, 2032):
    months = [(y, m) for m in range(4, 13)] + [(y + 1, m) for m in range(1, 4)]
    duty = -sum(gap(yy, m) * litres[yy] / 12 for yy, m in months) / 1e9
    print(f"{y}-{str(y + 1)[2:]},{duty:.4f},{duty * (1 + MOCK3_PUMP_VAT_RATE):.4f}")
