"""Drill 1 (MOCK): run the nine specimen households through the five mock
reforms and print the change in household net income (£ a year).

Measures 1-4 in 2027 (fuel duty is monthly, so this is calendar 2027; fiscal
2027-28 gives 4.15p a litre all year), measure 5 in 2028. Specimen homes are
April 2026 valuations; the engine deflates main_residence_value by per-capita
GDP to 2026 prices, so the 2028 input is uprated to 2028 prices.
"""
import warnings

warnings.filterwarnings("ignore")
from policyengine_uk import Simulation
from policyengine_uk.system import system
from uk_budget_data.reforms import get_reform

_GDP = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
UPRATE = {y: _GDP(f"{y}-06-01") / _GDP("2026-06-01") for y in (2026, 2027, 2028)}
Y=["2026","2027","2028"]
def hh(region, people, petrol=0, diesel=0, energy=0, home=0, extra=None):
    ppl={}; 
    for i,(age,emp,se,pen) in enumerate(people):
        d={"age":{y:age+int(y)-2026 for y in Y}}
        if emp: d["employment_income"]={y:emp for y in Y}
        if se: d["self_employment_income"]={y:se for y in Y}
        if pen: d["private_pension_income"]={y:pen for y in Y}
        ppl[f"p{i}"]=d
    ids=list(ppl)
    h={"members":ids,"region":{y:region for y in Y},"petrol_litres":{y:petrol for y in Y},
       "diesel_litres":{y:diesel for y in Y},"domestic_energy_consumption":{y:energy for y in Y},
       "main_residence_value":{y:home*UPRATE[int(y)] for y in Y}}
    return {"people":ppl,"benunits":{"b":{"members":ids}},"households":{"h":h}}
H={
 "H1":hh("YORKSHIRE",[(34,30000,0,0)],petrol=1000,energy=1650),
 "H2":hh("NORTH_EAST",[(36,18000,0,0),(34,0,0,0),(9,0,0,0),(6,0,0,0)],diesel=900,energy=1900),
 "H3":hh("SOUTH_WEST",[(70,0,0,0)],energy=1500,home=420000),
 "H4":hh("SOUTH_EAST",[(40,70000,0,0),(38,0,0,0),(7,0,0,0),(4,0,0,0)],petrol=1300,energy=2300,home=650000),
 "H5":hh("SCOTLAND",[(41,45000,0,0),(39,28000,0,0)],petrol=1400,energy=2600,home=1600000),
 "H6":hh("WEST_MIDLANDS",[(45,0,25000,0)],diesel=1100,energy=1700,home=250000),
 "H7":hh("NORTH_WEST",[(29,12000,0,0),(4,0,0,0)],energy=1400),
 "H8":hh("SOUTH_EAST",[(72,0,0,20000),(72,0,0,6000)],petrol=900,energy=2400,home=1550000),
 "H9":hh("LONDON",[(46,150000,0,0),(44,0,0,0),(12,0,0,0),(9,0,0,0)],petrol=1100,energy=2900,home=2200000),
}
M=[("mock_fuel_duty_freeze",2027),("mock_energy_vat_zero_rate",2027),("mock_child_benefit_increase",2027),("mock_nics_threshold_rise",2027),("mock_hvcts_extension",2028)]
print("hh  "+"  ".join(f"{m[5:16]:>11}" for m,_ in M))
for k,sit in H.items():
    row=[]
    for rid,y in M:
        r=get_reform(rid)
        b=Simulation(situation=sit, scenario=r.to_baseline_scenario()) if r.has_custom_baseline() else Simulation(situation=sit)
        f=Simulation(situation=sit, scenario=r.to_scenario())
        row.append(float(f.calculate("household_net_income",y)[0]-b.calculate("household_net_income",y)[0]))
    print(k,"  ".join(f"{v:11.2f}" for v in row), flush=True)
