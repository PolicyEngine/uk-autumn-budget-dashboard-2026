"""The engine applies a scenario's parameter changes before its modifier.

policyengine-uk 2.126.12 (policyengine-uk#2305, in the policyengine 6.3.3
bundle) applies a Scenario's parameter changes and then its simulation
modifier, in both phases (``simulation.py``: "A scenario's parameter
changes rebuild the parameters from the statutory tree, so they come before
its modifier, whose edits a rebuild would discard"). On 2.125.1 the modifier
ran first and the rebuild discarded its edits. ``publication.combine``
relies on the new order: a combined scenario carries its members' merged
parameter changes itself, and its modifier runs only their modifiers.

The dividend measure's baseline used to set the pre-Budget dividend rates
with a modifier, because those rates sit in a parameter scale. It now
states them as parameter changes, which policyengine.py's household
calculation and the receipts can take; a copy of the modifier stays here
as the reference they are checked against.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.reforms import get_reform

ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


def _reference_pre_budget_dividend_rates(sim):
    """The modifier the dividend measure's baseline used before it stated
    its pre-Budget rates as parameter changes: every annualised dividend
    rate from 2027 set to its pre-Budget value. Kept as the reference the
    parameter changes are checked against."""
    dividends = sim.tax_benefit_system.parameters.gov.hmrc.income_tax.rates.dividends
    for entry in dividends.brackets[0].rate.values_list:
        if entry.instant_str >= "2027":
            entry.value = 0.0875
    for entry in dividends.brackets[1].rate.values_list:
        if entry.instant_str >= "2027":
            entry.value = 0.3375
    return sim


def _situation(year=2027):
    return {
        "people": {
            "p": {"age": {year: 50}, "dividend_income": {year: 60_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }


@pytest.mark.parametrize("before_data_load", [False, True])
def test_the_engine_keeps_the_dividend_baseline_beside_parameter_changes(
    before_data_load,
):
    scenario = Scenario(
        simulation_modifier=_reference_pre_budget_dividend_rates,
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


DIVIDENDS = "gov.hmrc.income_tax.rates.dividends"
PRE_BUDGET_RATES = {
    f"{DIVIDENDS}[0].rate": {"2027": 0.0875},
    f"{DIVIDENDS}[1].rate": {"2027": 0.3375},
}


def test_the_modifier_gives_exactly_the_tax_of_the_same_rates_as_changes():
    """Differential: the modifier's pre-Budget rates, beside a parameter
    change, give to the penny the tax that the same rates entered as plain
    parameter changes give."""
    by_modifier = Simulation(
        situation=_situation(),
        scenario=Scenario(
            simulation_modifier=_reference_pre_budget_dividend_rates,
            parameter_changes={ALLOWANCE: {"2027": 13_000}},
        ),
    )
    by_changes = Simulation(
        situation=_situation(),
        scenario=Scenario(
            parameter_changes={ALLOWANCE: {"2027": 13_000}, **PRE_BUDGET_RATES}
        ),
    )
    assert by_modifier.calculate("income_tax", 2027)[0] == pytest.approx(
        by_changes.calculate("income_tax", 2027)[0], abs=0.01
    )


def test_the_combined_measure_baseline_keeps_the_pre_budget_dividend_rates():
    """The combined Autumn Budget measure's baseline has both parameter
    changes and the dividend modifier. On 2.125.1 the parameter rebuild
    discarded the modifier, so the combined baseline already had the
    post-Budget rates and the combined figure left out the dividend rise."""
    scenario = get_reform("autumn_budget_2026_combined").to_baseline_scenario()
    assert scenario.parameter_changes and scenario.simulation_modifier
    sim = Simulation(situation=_situation(), scenario=scenario)
    dividends = sim.tax_benefit_system.parameters(
        "2027-06-01"
    ).gov.hmrc.income_tax.rates.dividends
    assert dividends.rates[0] == pytest.approx(0.0875)
    assert dividends.rates[1] == pytest.approx(0.3375)


def test_the_modifier_changes_the_tax_the_engine_computes():
    with_rates = Simulation(
        situation=_situation(),
        scenario=Scenario(
            simulation_modifier=_reference_pre_budget_dividend_rates,
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


@pytest.mark.parametrize(
    "year", [year for year in POLICY_YEARS if year >= 2027]
)
def test_the_dividend_measure_gives_the_tax_the_old_modifier_gave(year):
    """Differential: the measure's pre-Budget rates, now parameter changes,
    give to the penny the income tax the modifier they replace gave, in
    every scored year from 2027-28."""
    measure = get_reform("dividend_tax_increase_2pp")
    assert measure.baseline_simulation_modifier is None
    by_modifier = Simulation(
        situation=_situation(year),
        scenario=Scenario(
            simulation_modifier=_reference_pre_budget_dividend_rates
        ),
    )
    by_measure = Simulation(
        situation=_situation(year), scenario=measure.to_baseline_scenario()
    )
    assert by_measure.calculate("income_tax", year)[0] == pytest.approx(
        by_modifier.calculate("income_tax", year)[0], abs=0.01
    )
