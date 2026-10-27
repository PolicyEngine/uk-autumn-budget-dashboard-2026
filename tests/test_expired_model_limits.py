"""The installed model has the fixes three model limits waited for.

policyengine-uk 2.151.0 (PR 238) has #2336, #2533 and #2187, so their
limits were removed from ``MODEL_LIMITS`` (their stand-ins are in
tests/model_limit_stand_ins.py). A measure they held is now approved like
any other, so the removal is safe only while the installed model behaves as
each fix requires. These tests read that behaviour. A pair without one (an
adoption that reverts only the lock, say) fails here, and the limit comes
back with it; a revert of the adoption's merge restores them together.
"""

import math

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system as installed_system
from policyengine_uk.tax_benefit_system import statutory_parameters
from policyengine_uk.utils.scenario import Scenario

NEW_PENSION = "gov.dwp.state_pension.new_state_pension.amount"
BASIC_PENSION = "gov.dwp.state_pension.basic_state_pension.amount"
CPI_INPUT = "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"
# Indices are stored to five decimal places.
INDEX_TOLERANCE = 1e-5


def pensioner(year, age):
    return {
        "people": {
            "p": {"age": {year: age}, "state_pension_reported": {year: 20_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


@pytest.mark.parametrize(
    "age, pension, rate, raised_to",
    [(70, "NEW", NEW_PENSION, 260.0), (85, "BASIC", BASIC_PENSION, 200.0)],
    ids=["new State Pension", "basic State Pension"],
)
def test_a_full_rate_rise_leaves_the_add_on_alone(
    age, pension, rate, raised_to
):
    """#2336 (state_pension_add_on_uprating): the add-on above the full
    rate rises by September CPI, so raising the full rate doesn't move it.
    Before #2336 it rose with the full rate, and a measure on the full rates
    or the triple lock overstated its cost."""
    year = 2028
    baseline = Simulation(situation=pensioner(year, age))
    raised = Simulation(
        situation=pensioner(year, age),
        scenario=Scenario(parameter_changes={rate: {str(year): raised_to}}),
    )
    assert baseline.calculate("state_pension_type", year)[0] == pension
    before = baseline.calculate("additional_state_pension", year)[0]
    assert before > 0
    assert raised.calculate("additional_state_pension", year)[0] == before


@pytest.mark.parametrize(
    "parameter",
    [
        "gov.dwp.attendance_allowance.lower",
        "gov.dwp.pip.daily_living.standard",
        "gov.hmrc.child_benefit.amount.eldest",
    ],
)
def test_benefits_rise_by_the_published_september_outturn(parameter):
    """#2533 (benefit_uprating_september_cpi): CPI-linked benefits rise in
    April 2027 by the September 2026 outturn, read from the published input
    in the raw tree, not by a forecast or lagged calendar-year CPI."""
    published = statutory_parameters().get_child(CPI_INPUT)("2026-09-01")
    assert published is not None
    amount = installed_system.parameters.get_child(parameter)
    rise = amount("2027-04-01") / amount("2026-04-01") - 1
    assert rise == pytest.approx(published, abs=INDEX_TOLERANCE)


def shopper(year):
    """One household with known consumption, a third of it full-rated."""
    return {
        "people": {"p": {"age": {year: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "food_and_non_alcoholic_beverages_consumption": {year: 6000},
                "transport_consumption": {year: 3000},
                "recreation_consumption": {year: 1000},
                "full_rate_vat_expenditure_rate": {year: 1 / 3},
            }
        },
    }


@pytest.mark.parametrize("variable", ["vat", "baseline_vat"])
def test_household_vat_is_grossed_by_coverage_and_household_share(variable):
    """#2187 (vat_consumption_coverage): household VAT is what its recorded
    consumption owes at the statutory rates, divided by survey consumption
    coverage times the household share of receipts (0.67 × 0.7). Before
    #2187 it was divided by 0.38, about 23% higher."""
    year = 2027
    sim = Simulation(situation=shopper(year))
    rates = sim.tax_benefit_system.parameters(f"{year}-01-01").gov.hmrc.vat
    raw = (
        sim.calculate("full_rate_vat_consumption", year)[0]
        * rates.standard_rate
        + sim.calculate("reduced_rate_vat_consumption", year)[0]
        * rates.reduced_rate
    )
    assert raw > 0
    ratio = sim.calculate(variable, year)[0] / raw
    assert math.isclose(ratio, 1 / (0.67 * 0.7), rel_tol=1e-6)
