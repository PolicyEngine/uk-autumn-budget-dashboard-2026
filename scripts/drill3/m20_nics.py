"""MOCK drill 3: measure 20 on the costing's basis (gross employee + employer Class 1 NICs)."""
from policyengine_uk import Microsimulation
from uk_budget_data.reforms import get_reform
DS = "/Users/vahid/drill2-data/microcosm_uk_2024_25.h5"
r = get_reform("mock3_salary_sacrifice_cap")
b = Microsimulation(dataset=DS, scenario=r.to_drill_scenario(baseline=True))
f = Microsimulation(dataset=DS, scenario=r.to_drill_scenario())
d = lambda v, y: (float(f.calculate(v, y).sum()) - float(b.calculate(v, y).sum())) / 1e6
for y in (2029, 2030, 2031):
    ee, er, it = d("ni_class_1_employee", y), d("ni_class_1_employer", y), d("income_tax", y)
    print(f"{y},{ee:.1f},{er:.1f},{ee+er:.1f},{it:.1f}")
