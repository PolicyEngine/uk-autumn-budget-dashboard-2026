"""The Pension Tax Allowance (``pension_tax_allowance``): HM Treasury's
explainer cases for 2027-28 (Budget 2026), and the Scottish rule."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data import reforms
from uk_budget_data.budget_measures.pension_tax_allowance import (
    pension_tax_allowance,
)

YEAR = 2027


def _pensioner(income, region="LONDON", age=70):
    return {
        "people": {"p": {"age": {YEAR: age}, "state_pension": {YEAR: income}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {YEAR: region}}},
    }


def _income_tax(situation, year=YEAR):
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation)
    pension_tax_allowance(reformed)
    return (
        float(baseline.calculate("income_tax", year)[0]),
        float(reformed.calculate("income_tax", year)[0]),
    )


@pytest.mark.parametrize(
    "income, before, after",
    [
        # Steph: £93.28 cancelled by the £94 allowance
        (13_036.40, 93.28, 0.0),
        # Anne: £80 cancelled
        (12_970, 80.0, 0.0),
        # Jonathan: £150 over, so £94 - £50 = £44 off £123.28
        (13_186.40, 123.28, 79.28),
        # Nadia: £363.60 over, so nothing left; pays £166
        (13_400, 166.0, 166.0),
    ],
)
def test_the_explainers_cases(income, before, after):
    baseline, reformed = _income_tax(_pensioner(income))
    assert baseline == pytest.approx(before, abs=0.01)
    assert reformed == pytest.approx(after, abs=0.01)


def test_a_scottish_taxpayer_gets_the_same_reduction():
    """The reduction is worked out at the 20% basic rate in Scotland too:
    a fixed £94 at the full new State Pension, whatever the Scottish
    rates make the tax."""
    baseline, reformed = _income_tax(_pensioner(13_036.40, "SCOTLAND"))
    assert baseline > 0
    assert reformed == pytest.approx(max(0.0, baseline - 94), abs=0.01)


def test_under_state_pension_age_nothing_changes():
    baseline, reformed = _income_tax(_pensioner(13_036.40, age=60))
    assert reformed == pytest.approx(baseline, abs=0.01)


@pytest.mark.parametrize("year", [2026, 2030])
def test_outside_2027_to_2029_nothing_changes(year):
    situation = _pensioner(13_036.40)
    for person in situation["people"].values():
        for key in person:
            person[key] = {year: list(person[key].values())[0]}
    situation["households"]["h"]["region"] = {year: "LONDON"}
    baseline, reformed = _income_tax(situation, year)
    assert reformed == pytest.approx(baseline, abs=0.01)


def test_the_measure_is_the_tax_reduction():
    measure = reforms.get_reform(reforms.STATE_PENSION_ALLOWANCE_ID)
    assert measure.simulation_modifier is pension_tax_allowance


def test_isa_interest_is_left_out_of_total_income():
    """Total income counts savings, dividends and property income, not
    ISA interest (Max's brief): £5,000 of ISA interest on top of the full
    new State Pension leaves the whole reduction."""
    situation = _pensioner(13_036.40)
    situation["people"]["p"]["individual_savings_account_interest_income"] = {
        YEAR: 5_000
    }
    baseline, reformed = _income_tax(situation)
    assert baseline == pytest.approx(93.28, abs=0.01)
    assert reformed == pytest.approx(0, abs=0.01)


@pytest.mark.parametrize(
    "income", ["savings_interest_income", "dividend_income", "property_income"]
)
def test_savings_dividends_and_property_count_in_total_income(income):
    """£2,000 of other income on a £12,000 State Pension is £963.60 above
    the full new State Pension: the reduction is gone."""
    situation = _pensioner(12_000)
    situation["people"]["p"][income] = {YEAR: 2_000}
    baseline, reformed = _income_tax(situation)
    assert reformed == pytest.approx(baseline, abs=0.01)
