"""Invented single-person households for the Pension Tax Allowance's property
and differential tests, and the Budget's rule to check them against.

Examples run on branches of one simulation, which take a hundredth of the time
a new simulation does. Amounts in the model are float32, so comparisons allow
a penny.
"""

import math
from types import SimpleNamespace

import numpy as np
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from policyengine_uk.system import system

YEARS = (2027, 2028, 2029)
REGIONS = (
    "LONDON",
    "SCOTLAND",
    "WALES",
    "NORTHERN_IRELAND",
    "NORTH_WEST",
    "SCOTLAND",
    "SOUTH_EAST",
    "LONDON",
)
SLOTS = len(REGIONS)
SOURCES = (
    "state_pension",
    "private_pension_income",
    "employment_income",
    "self_employment_income",
    "savings_interest_income",
    "dividend_income",
    "property_income",
)
PENNY = 0.01

examples = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
years = st.sampled_from(YEARS)
# Where each slot's total income sits: 0 is the bottom of the band (the full
# new State Pension) and 1 its top.
band_positions = st.lists(
    st.one_of(
        st.sampled_from((0.0, 1.0)),
        st.floats(min_value=-1, max_value=2),
    ),
    min_size=SLOTS,
    max_size=SLOTS,
)
mixes = st.lists(
    st.lists(
        st.floats(min_value=0, max_value=1),
        min_size=len(SOURCES),
        max_size=len(SOURCES),
    ),
    min_size=SLOTS,
    max_size=SLOTS,
)


def rule_for(year):
    """The Budget's amounts, in whole pence so no float rounding enters: the
    weekly rate down to 5p x 52 (F), and 20% of F above the personal
    allowance, up to the pound (A)."""
    on = system.parameters(f"{year}-04-06").gov
    weekly = float(on.dwp.state_pension.new_state_pension.amount)
    pence = math.floor(round(weekly * 100, 6) / 5) * 5 * 52
    personal_allowance = float(
        on.hmrc.income_tax.allowances.personal_allowance.amount
    )
    full_state_pension = pence / 100
    allowance = math.ceil(
        round(0.2 * (full_state_pension - personal_allowance), 6)
    )
    return SimpleNamespace(
        full_state_pension=full_state_pension,
        personal_allowance=personal_allowance,
        allowance=allowance,
        top=full_state_pension + 3 * allowance,
    )


def situation_for(age=70):
    return {
        "people": {
            f"p{i}": {"age": {year: age for year in YEARS}}
            for i in range(SLOTS)
        },
        "benunits": {f"b{i}": {"members": [f"p{i}"]} for i in range(SLOTS)},
        "households": {
            f"h{i}": {
                "members": [f"p{i}"],
                "region": {year: REGIONS[i] for year in YEARS},
            }
            for i in range(SLOTS)
        },
    }


def calculate(simulation, year, inputs, outputs=("income_tax",)):
    """The outputs for these inputs, on a branch dropped afterwards."""
    branch = simulation.get_branch("example")
    try:
        branch.drop_computed_arrays()
        for variable, values in inputs.items():
            branch.set_input(variable, year, np.asarray(values, dtype=float))
        return [
            np.asarray(branch.calculate(variable, year), dtype=float)
            for variable in outputs
        ]
    finally:
        del simulation.branches["example"]


def split(totals, mix):
    """Each slot's total shared across the sources in the given proportions;
    all of it State Pension where every share is nil."""
    totals = np.asarray(totals, dtype=float)
    mix = np.array(mix, dtype=float)
    mix[mix.sum(axis=1) == 0, 0] = 1
    mix = mix / mix.sum(axis=1, keepdims=True)
    return {source: totals * mix[:, i] for i, source in enumerate(SOURCES)}


def in_band(rule, positions):
    return np.maximum(
        0,
        rule.full_state_pension
        + np.asarray(positions) * (rule.top - rule.full_state_pension),
    )
