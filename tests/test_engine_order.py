"""The engine applies a scenario's parameter changes before its modifier.

policyengine-uk 2.126.12 (policyengine-uk#2305, in the policyengine 6.3.3
bundle) applies a Scenario's parameter changes and then its simulation
modifier, in both phases (``simulation.py``: "A scenario's parameter
changes rebuild the parameters from the statutory tree, so they come before
its modifier, whose edits a rebuild would discard"). On 2.125.1 the modifier
ran first and the rebuild discarded its edits, which is why
``publication.combine`` composes changes and modifiers into one modifier.

The dividend measure's baseline sets the pre-Budget dividend rates with a
modifier (``reforms._set_pre_budget_dividend_rates``), because those rates
sit in a parameter scale. Here the engine alone keeps them beside other
parameter changes.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.reforms import _set_pre_budget_dividend_rates

ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


def _situation():
    return {
        "people": {
            "p": {"age": {2027: 50}, "dividend_income": {2027: 60_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2027: "LONDON"}}},
    }


@pytest.mark.parametrize("before_data_load", [False, True])
def test_the_engine_keeps_the_dividend_baseline_beside_parameter_changes(
    before_data_load,
):
    scenario = Scenario(
        simulation_modifier=_set_pre_budget_dividend_rates,
        parameter_changes={ALLOWANCE: {"2027": 13_000}},
    )
    scenario.applied_before_data_load = before_data_load
    sim = Simulation(situation=_situation(), scenario=scenario)
    parameters = sim.tax_benefit_system.parameters("2027-06-01")
    dividends = parameters.gov.hmrc.income_tax.rates.dividends
    # The modifier's pre-Budget rates survive the parameter changes...
    assert dividends.rates[0] == pytest.approx(0.0875)
    assert dividends.rates[1] == pytest.approx(0.3375)
    # ...and the parameter change is applied too.
    allowance = parameters.gov.hmrc.income_tax.allowances.personal_allowance
    assert allowance.amount == 13_000


def test_the_modifier_changes_the_tax_the_engine_computes():
    with_rates = Simulation(
        situation=_situation(),
        scenario=Scenario(
            simulation_modifier=_set_pre_budget_dividend_rates,
            parameter_changes={ALLOWANCE: {"2027": 13_000}},
        ),
    )
    without = Simulation(
        situation=_situation(),
        scenario=Scenario(parameter_changes={ALLOWANCE: {"2027": 13_000}}),
    )
    # Lower pre-Budget dividend rates mean less tax on £60,000 of dividends.
    assert (
        with_rates.calculate("income_tax", 2027)[0]
        < without.calculate("income_tax", 2027)[0]
    )
