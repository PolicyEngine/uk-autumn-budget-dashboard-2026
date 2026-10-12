"""MOCK drill 3 measure 5: employer NI relief extended to employees aged 21.

Everything here is invented for a PolicyEngine rehearsal (MOCK DATA).

Engine finding (policyengine-uk 2.125.1): there is no under-21 (or
apprentice under-25) employer NI relief. ``ni_class_1_employer`` charges the
employer rate on all earnings above the Secondary Threshold for anyone
``ni_class_1_secondary_liable`` (over 16); there is no upper secondary
threshold parameter and no age condition. So the native baseline
over-charges employers of under-21s relative to current law.

Per the drill brief, the reform does NOT add the missing under-21 relief:
both baseline and reform keep the engine's charge for under-21s, and the
baseline/reform difference is only the increment the measure adds relative
to the real-world baseline, i.e. employees aged exactly 21.

Incidence: the engine's pass-through of employer NI to pay
(``employer_ni_fixed_employer_cost_change``) fires only on changes to the
employer rate, Secondary Threshold or pension-contribution exemption
parameters. A ``set_input`` on ``ni_class_1_employer`` changes none of those,
so employment income and household net income do not move; the measure
shows up as a fall in employer NI (gov_tax / gov_balance) and in
``employer_cost``. The national figure to report is the gross change in
``ni_employer``.
"""

import numpy as np
from policyengine_uk import Simulation

from uk_budget_data.models import Reform

MOCK3_EMPLOYER_NI_YEARS = range(2027, 2032)
MOCK3_EMPLOYER_NI_AGE = 21  # under-21s already relieved in law
WEEKS_IN_YEAR = 52
# Annex A: Upper Secondary Threshold £50,270 (constant) and Secondary
# Threshold £5,000 to 2030-31, £5,100 in 2031-32 (engine native matches ST).
# baseline_mismatch: Annex A baseline already zero-rates under-21s; the
# engine does not. No effect on the age-21 increment scored here.
MOCK3_UPPER_SECONDARY_THRESHOLD = 50_270
MOCK3_ANNEX_A_SECONDARY_THRESHOLD = {y: (5_100 if y == 2031 else 5_000) for y in range(2027, 2032)}


def _mock3_age_21_relief(sim: Simulation, year: int) -> np.ndarray:
    """Employer NI relief for employees aged 21: earnings from ST up to UEL.

    The engine's charge is rate x max(0, earnings - ST). The relief zeroes
    the band from ST to UEL, leaving rate x max(0, earnings - UEL); the relief
    is therefore min(charge, rate x (UEL - ST)).
    """
    class_1 = sim.tax_benefit_system.parameters(
        f"{year}-04-30"
    ).gov.hmrc.national_insurance.class_1
    rate = class_1.rates.employer
    st = MOCK3_ANNEX_A_SECONDARY_THRESHOLD[year]
    uel = MOCK3_UPPER_SECONDARY_THRESHOLD  # Annex A constant, not engine UEL
    charge = np.asarray(sim.calculate("ni_class_1_employer", period=year))
    age = np.asarray(sim.calculate("age", period=year))
    cap = rate * max(uel - st, 0)
    is_21 = (age >= MOCK3_EMPLOYER_NI_AGE) & (age < MOCK3_EMPLOYER_NI_AGE + 1)
    return np.where(is_21, np.minimum(charge, cap), 0)


def _mock3_employer_ni_under_22_modifier(sim: Simulation) -> Simulation:
    for year in MOCK3_EMPLOYER_NI_YEARS:
        relief = _mock3_age_21_relief(sim, year)
        charge = np.asarray(sim.calculate("ni_class_1_employer", period=year))
        sim.set_input("ni_class_1_employer", year, charge - relief)
    return sim


def _create_mock3_employer_ni_under_22() -> Reform:
    """Mock 3 measure 5: no employer NI up to the UEL for employees under 22."""
    return Reform(
        id="mock3_employer_ni_under_22",
        name="Employer National Insurance relief for under-22s",
        description=(
            "MOCK. From April 2027 employers pay no National Insurance on "
            "the earnings of employees aged under 22 up to the upper earnings "
            "limit (standard 15% above it), extending the existing under-21 "
            "relief to 21-year-olds. The engine does not model the under-21 "
            "relief, so the costing is the age-21 increment only. Gross "
            "employer NI change; no pass-through to pay is modelled."
        ),
        simulation_modifier=_mock3_employer_ni_under_22_modifier,
    )
