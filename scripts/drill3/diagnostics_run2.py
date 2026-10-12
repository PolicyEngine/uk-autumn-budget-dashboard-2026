"""MOCK drill 3 run 2 diagnostics for the reconciler: measure 1 cash decomposition,
Class 4 reconciliation, Pensioner Allowance counts. Static, pinned data aa31bdf6."""
import numpy as np
from policyengine_uk import Microsimulation
from uk_budget_data.reforms import get_reform

DS = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"

def pair(rid):
    r = get_reform(rid)
    return (Microsimulation(dataset=DS, scenario=r.to_drill_scenario(baseline=True)),
            Microsimulation(dataset=DS, scenario=r.to_drill_scenario()))

def tot(s, v, y):
    return float(s.calculate(v, y).sum()) / 1e6

import sys
if "--skip-m1" not in sys.argv:
  b, f = pair("mock3_threshold_freeze_2032")
  y = 2031
  it = tot(f, "income_tax", y) - tot(b, "income_tax", y)
  c1 = tot(f, "ni_class_1_employee", y) - tot(b, "ni_class_1_employee", y)
  c4 = tot(f, "ni_class_4", y) - tot(b, "ni_class_4", y)
  print(f"M1 2031-32 liabilities £m: income_tax {it:.1f}, class1_employee {c1:.1f}, class4 {c4:.1f}, total {it+c1+c4:.1f}")
  print(f"M1 2031-32 cash £m (90% IT + 100% C1 + 25% C4): {0.9*it + c1 + 0.25*c4:.1f}")

b, f = pair("mock3_class4_main_rate")
for y in (2027, 2028):
    c4 = tot(f, "ni_class_4", y) - tot(b, "ni_class_4", y)
    gb = tot(f, "gov_balance", y) - tot(b, "gov_balance", y)
    prof = np.asarray(b.calculate("self_employment_income", y))
    w = np.asarray(b.calculate("person_weight", y)) if "person_weight" in b.tax_benefit_system.variables else np.asarray(b.calculate("household_weight", y, map_to="person"))
    lpl, upl = 12570, 50270
    band = np.clip(prof, lpl, upl) - lpl
    print(f"Class 4 {y}: ni_class_4 change £{c4:.1f}m; gov_balance change £{gb:.1f}m; main-band profit base £{(band*w).sum()/1e9:.1f}bn; contributors (profit > LPL) {(w*(prof>lpl)).sum()/1e6:.2f}m")

b, f = pair("mock3_pensioner_allowance")
for y in (2027, 2031):
    pab = np.asarray(b.calculate("personal_allowance", y)); paf = np.asarray(f.calculate("personal_allowance", y))
    itb = np.asarray(b.calculate("income_tax", y)); itf = np.asarray(f.calculate("income_tax", y))
    w = np.asarray(b.calculate("household_weight", y, map_to="person"))
    gain = (paf > pab + 0.5); relief = itb - itf
    n = (w * gain).sum(); avg = (w * relief * gain).sum() / max(n, 1)
    payers = (w * gain * (relief > 0.5)).sum()
    print(f"PA {y}: higher allowance {n/1e6:.2f}m people; with tax cut {payers/1e6:.2f}m; average relief among gainers £{avg:.0f}; total £{(w*relief).sum()/1e6:.1f}m")
