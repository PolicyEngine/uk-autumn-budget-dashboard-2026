"""Native PTA against the runtime's actual pre-Budget comparison.

HM Treasury's 2027-28 examples use a full new State Pension of £13,036.40.
The installed native forecast has that rate too. Separate cases derive the
later years' thresholds from the native weekly rate, without installing
the retained historical formula wrapper on top of current law.
"""

import math

import pytest
from policyengine_uk import Simulation

from uk_budget_data import reforms
from uk_budget_data.budget_policy import native_policy_changes
from uk_budget_data.forecast import forecast_parameters, with_forecast

YEAR = 2027


def _pensioner(income, region="LONDON", age=70, year=YEAR):
    return {
        "people": {"p": {"age": {year: age}, "state_pension": {year: income}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: region}}},
    }


def _simulations(situation):
    """The same factory and policy basis used by the household runtime."""
    measure = reforms._create_state_pension_income_tax_protection()
    baseline = Simulation(
        situation=situation,
        scenario=with_forecast(measure.to_baseline_scenario()),
    )
    reformed = Simulation(
        situation=situation, scenario=with_forecast(measure.to_scenario())
    )
    return baseline, reformed


def _income_tax(situation, year=YEAR):
    baseline, reformed = _simulations(situation)
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
    # HM Treasury's published threshold is a source assertion, rather than
    # an old model's unrounded forecast silently standing in for the rule.
    weekly = forecast_parameters().gov.dwp.state_pension.new_state_pension
    assert weekly.amount(str(YEAR)) * 52 == pytest.approx(13_036.40)
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
    situation = _pensioner(13_036.40, year=year)
    baseline, reformed = _income_tax(situation, year)
    assert reformed == pytest.approx(baseline, abs=0.01)


def test_the_measure_is_the_tax_reduction():
    measure = reforms.get_reform(reforms.STATE_PENSION_ALLOWANCE_ID)
    assert measure.parameter_changes == native_policy_changes(
        reforms.STATE_PENSION_ALLOWANCE_ID
    )
    assert measure.simulation_modifier is None
    assert measure.baseline_simulation_modifier is None
    assert measure.baseline_parameter_changes is None


@pytest.mark.parametrize("year", [2027, 2028, 2029])
def test_native_allowance_follows_the_forecast_and_is_applied_once(year):
    """£150 over the native full pension withdraws £50 of relief.

    The explainer specifies 20% of the full pension above the Personal
    Allowance, rounded up to pounds, then £1 withdrawn for each £3 of total
    income above the full pension. Native uprated thresholds supply the
    later years; the historical wrapper supplies none of these values.
    """
    parameters = forecast_parameters()(str(year)).gov
    full_pension = 52 * parameters.dwp.state_pension.new_state_pension.amount
    personal_allowance = (
        parameters.hmrc.income_tax.allowances.personal_allowance.amount
    )
    full_relief = math.ceil(
        round(0.2 * (full_pension - personal_allowance), 6)
    )
    before_tax = 0.2 * (full_pension + 150 - personal_allowance)
    relief = full_relief - 50
    baseline, reformed = _simulations(
        _pensioner(full_pension + 150, year=year)
    )
    assert float(baseline.calculate("pension_tax_allowance", year)[0]) == 0
    assert float(reformed.calculate("pension_tax_allowance", year)[0]) == (
        pytest.approx(relief, abs=0.01)
    )
    assert float(baseline.calculate("income_tax", year)[0]) == pytest.approx(
        before_tax, abs=0.01
    )
    assert float(reformed.calculate("income_tax", year)[0]) == pytest.approx(
        before_tax - relief, abs=0.01
    )


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


def test_gift_aid_leaves_total_income_alone():
    """The taper reads total income (Income Tax Act 2007 s. 23, Step 1),
    not adjusted net income, which Gift Aid lowers: Jonathan gives £800 to
    charity and still gets £44 off."""
    situation = _pensioner(13_186.40)
    situation["people"]["p"]["gift_aid"] = {YEAR: 800}
    baseline, reformed = _income_tax(situation)
    assert baseline == pytest.approx(123.28, abs=0.01)
    assert reformed == pytest.approx(79.28, abs=0.01)


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


def _mixed_age_couple_on_uc(income_variable):
    """A couple on Universal Credit in the North West, renting: the older
    partner (70) has £13,036.40 of earnings or trading profit and no State
    Pension (deferred); the younger (60) earns £13,000, so no marriage
    allowance is transferred."""
    return {
        "people": {
            "old": {"age": {YEAR: 70}, income_variable: {YEAR: 13_036.40}},
            "young": {"age": {YEAR: 60}, "employment_income": {YEAR: 13_000}},
        },
        "benunits": {
            "b": {"members": ["old", "young"], "would_claim_uc": {YEAR: True}}
        },
        "households": {
            "h": {
                "members": ["old", "young"],
                "region": {YEAR: "NORTH_WEST"},
                "tenure_type": {YEAR: "RENT_PRIVATELY"},
                "rent": {YEAR: 6_000},
            }
        },
    }


@pytest.mark.parametrize(
    "income_variable", ["employment_income", "self_employment_income"]
)
def test_universal_credit_deducts_the_tax_after_the_pta(income_variable):
    """UC deducts the income tax paid on earnings (UC Regs 2013 reg.
    55(5)(b), reg. 57(2) step 3), which policyengine-uk recomputes outside
    income_tax. The £93.28 PTA lowers that deduction too, so earned income
    rises by £93.28 and UC takes back 55% of it (£51.30): +£41.97 net."""
    situation = _mixed_age_couple_on_uc(income_variable)
    baseline, reformed = _simulations(situation)

    def get(sim, variable):
        return sim.calculate(variable, YEAR)

    pta = float(
        get(baseline, "income_tax")[0] - get(reformed, "income_tax")[0]
    )
    assert pta == pytest.approx(93.28, abs=0.01)
    assert float(
        get(reformed, "uc_income_tax_on_earnings")[0]
    ) == pytest.approx(0, abs=0.01)
    on_trade = float(get(reformed, "uc_income_tax_on_trade")[0])
    assert on_trade == pytest.approx(0, abs=0.01)
    # The younger partner, under State Pension age, is unchanged
    assert float(get(reformed, "uc_income_tax_on_earnings")[1]) == (
        pytest.approx(float(get(baseline, "uc_income_tax_on_earnings")[1]))
    )
    uc_change = float(
        get(reformed, "universal_credit")[0]
        - get(baseline, "universal_credit")[0]
    )
    assert uc_change == pytest.approx(-0.55 * 93.28, abs=0.01)
    net_change = float(
        get(reformed, "household_net_income")[0]
        - get(baseline, "household_net_income")[0]
    )
    assert net_change == pytest.approx(93.28 * 0.45, abs=0.02)
