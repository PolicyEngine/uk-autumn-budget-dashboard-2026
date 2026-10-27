"""Every candidate measure on the household route (POST /api/household-impact).

The household route runs each side as a ``policyengine_uk.Simulation`` with
the side's ``Scenario`` (parameter changes and simulation modifiers), so all
nine measures apply to a household, the six with formula modifiers included.

- Hand checks: each modifier measure's change is recomputed from the
  parameters and the spending entered.
- Parity: for three households and every measure in 2026-27, 2027-28 and
  2031-32, the route's net incomes equal the national route's household
  simulations (``personal_impact.household_simulations``, the path
  ``/api/personal-impact`` takes) to the penny, measure by measure and
  combined.
"""

import dataclasses
import math

import pytest
from policyengine_uk.system import system

from uk_budget_data import household_impact, personal_impact
from uk_budget_data.budget_measures.road_fuel_vat_cut import road_fuel_vat_cut
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    WINTER_SHARE,
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.combine import combine_measures
from uk_budget_data.reforms import (
    FUEL_DUTY,
    fuel_duty_deferral_rates,
    get_reform,
)

Child = household_impact.Child
PARAMETERS = system.parameters
ALL = household_impact.measure_ids()
PENNY = 0.006  # the route rounds to the penny


@pytest.fixture(autouse=True)
def _fresh_runs():
    household_impact.clear_runs()
    yield
    household_impact.clear_runs()


def Answers(year, **values):
    values.setdefault("salary_year", year)
    return household_impact.HouseholdAnswers(**values)


def calculate(answers, year, measures=ALL):
    return household_impact.calculate_household_impact(
        answers, measures, year, include=("by_policy",)
    )


def by_measure(result):
    return {m["id"]: m for m in result["by_policy"]["measures"]}


def programme(result, id_):
    for row in result["programmes"]:
        if row["id"] == id_:
            return row
    raise KeyError(id_)


def test_every_measure_is_applied_and_none_is_not_modelled():
    sides = household_impact.measure_sides(ALL)
    assert sorted(sides.included) == sorted(ALL)
    assert sides.not_modelled == []
    # Each modifier measure carries its modifier, by name, on its single
    for id_ in ALL:
        modifier = get_reform(id_).simulation_modifier
        if modifier is not None:
            assert household_impact.modifier_name(modifier) in (
                sides.singles[id_]["modifiers"]
            )


# --- fuel duty deferral -------------------------------------------------------


@pytest.mark.parametrize("year", [2026, 2027])
def test_fuel_duty_deferral_is_the_duty_cut_plus_vat_on_the_litres(year):
    """Litres are spending over the model's pump price
    (``petrol_litres = petrol_spending / petrol_price``), with spending and
    prices held fixed. policyengine-uk holds the duty rate at its fiscal-year
    mean through each model year (the parameter is blended, so it reads the
    same on every month's first day), and the measure sets that mean
    (``fuel_duty_deferral_rates``). The household pays the duty difference
    on each litre, and VAT at 20% on it: the change is 1.2 x duty
    difference x litres."""
    petrol, diesel = 1_500, 500
    prices = PARAMETERS.household.consumption.fuel.prices
    litres = petrol / prices.petrol(f"{year}-01-01") + diesel / prices.diesel(
        f"{year}-01-01"
    )
    current_law = PARAMETERS.get_child(FUEL_DUTY)
    assert {current_law(f"{year}-{m:02d}-01") for m in range(1, 13)} == {
        current_law(f"{year}-01-01")
    }
    difference = current_law(f"{year}-01-01") - (
        fuel_duty_deferral_rates()[str(year)]
    )
    duty_cut = difference * litres
    assert duty_cut > 1
    result = calculate(
        Answers(year, petrol_spending=petrol, diesel_spending=diesel),
        year,
        ["fuel_duty_rise_deferral"],
    )
    assert -programme(result, "fuel_duty")["change"] == pytest.approx(
        duty_cut, abs=0.02
    )
    assert -programme(result, "vat_change")["change"] == pytest.approx(
        0.2 * duty_cut, abs=0.02
    )
    assert result["net_income"]["change"] == pytest.approx(
        1.2 * duty_cut, abs=0.03
    )


# --- State Pension income tax protection ----------------------------------------


def _pensioner(year, **values):
    return Answers(
        year, age=75, employment_income=0, tenure="OWNED_OUTRIGHT", **values
    )


def test_state_pension_only_pays_no_income_tax_from_2027():
    measure = ["state_pension_income_tax_protection"]
    full = household_impact.full_new_state_pension(2027)
    assert full > 12_570  # so it is taxed today
    result = calculate(_pensioner(2027), 2027, measure)
    tax = programme(result, "income_tax")
    assert tax["baseline"] == pytest.approx(0.2 * (full - 12_570), abs=0.02)
    assert tax["reform"] == 0
    assert result["net_income"]["change"] == pytest.approx(
        tax["baseline"], abs=0.01
    )
    # It starts in 2027-28
    result = calculate(_pensioner(2026), 2026, measure)
    assert result["net_income"]["change"] == 0


@pytest.mark.parametrize("other", [260, 400, 2_000])
def test_the_allowance_is_withdrawn_pound_for_pound(other):
    """Allowance £13,040 in 2027-28, less £1 for each £1 of income above
    it, down to the standard £12,570."""
    full = household_impact.full_new_state_pension(2027)
    income = full + other
    # Whole pounds: policyengine-uk rounds the allowance up
    allowance = max(12_570, math.ceil(13_040 - max(0, income - 13_040)))
    expected_tax = 0.2 * max(0, income - allowance)
    result = calculate(
        _pensioner(2027, private_pension_income=other),
        2027,
        ["state_pension_income_tax_protection"],
    )
    tax = programme(result, "income_tax")
    assert tax["reform"] == pytest.approx(expected_tax, abs=0.02)
    assert tax["baseline"] == pytest.approx(0.2 * (income - 12_570), abs=0.02)
    if income - 13_040 >= 13_040 - 12_570:
        assert result["net_income"]["change"] == 0


# --- Warm Home Discount top-up ----------------------------------------------------

UC_FAMILY = dict(
    age=35,
    employment_income=12_000,
    has_partner=True,
    partner_age=33,
    children=(Child(5), Child(8)),
    claims_universal_credit=True,
    tenure="RENT_PRIVATELY",
    monthly_rent=900,
)
PENSION_CREDIT = dict(
    age=75,
    employment_income=0,
    state_pension=6_000,
    tenure="RENT_FROM_COUNCIL",
    monthly_rent=500,
)


@pytest.mark.parametrize(
    "answers, region, expected",
    [
        (UC_FAMILY, "NORTH_WEST", 100),
        (PENSION_CREDIT, "LONDON", 100),
        # Great Britain only
        (UC_FAMILY, "NORTHERN_IRELAND", 0),
        # Neither benefit
        (dict(employment_income=30_000), "LONDON", 0),
    ],
)
def test_the_warm_home_discount_top_up_if_received(answers, region, expected):
    """£100 in 2026-27 for a household in Great Britain on Universal Credit
    or Pension Credit: the household view shows the eligible amount, as if
    received, and says so."""
    result = calculate(
        Answers(2026, region=region, **answers),
        2026,
        ["warm_home_discount_top_up"],
    )
    assert result["net_income"]["change"] == expected
    assert programme(result, "warm_home_discount_top_up")["change"] == (
        expected
    )
    [measure] = result["by_policy"]["measures"]
    assert measure["note_kind"] == "if_received"
    assert measure["note"].startswith("If received")
    # Winter 2026-27 only
    result = calculate(
        Answers(2027, region=region, **answers),
        2027,
        ["warm_home_discount_top_up"],
    )
    assert result["net_income"]["change"] == 0


# --- gas spending ------------------------------------------------------------------


def test_the_route_passes_gas_spending_to_gas_consumption():
    """A measure on the VAT of domestic gas reads ``gas_consumption``; the
    route sets it from the answer, the ONS average unless given (the
    drill's gas measure gave every household £0 without it: review on
    #145; a £0 default did the same: #208 review, finding 7)."""
    assert household_impact.GAS_SPENDING == 733
    _, _, household = household_impact.household_entities(Answers(2027))
    assert household["gas_consumption"] == 733
    _, _, household = household_impact.household_entities(
        Answers(2027, gas_spending=1_050)
    )
    assert household["gas_consumption"] == 1_050


# --- zero VAT on domestic electricity --------------------------------------------


def test_electricity_spending_defaults_to_the_ons_average():
    assert household_impact.ELECTRICITY_SPENDING == 1_040
    _, _, household = household_impact.household_entities(Answers(2026))
    assert household["electricity_consumption"] == 1_040


@pytest.mark.parametrize(
    "year, spending, weight",
    [(2026, 1_040, WINTER_SHARE), (2027, 1_040, 1), (2027, 2_000, 1)],
)
def test_electricity_vat_is_5_percent_of_the_bill_for_its_period(
    year, spending, weight
):
    """5% VAT on VAT-inclusive spending is spending x 0.05 / 1.05; zero
    rated from 1 October 2026 (the October to March share of 2026-27's
    use) to 31 March 2028."""
    assert zero_vat_on_domestic_electricity.__defaults__[0] == (
        pytest.approx(-0.05 * WINTER_SHARE)
    )
    result = calculate(
        Answers(year, electricity_spending=spending),
        year,
        ["domestic_electricity_zero_vat"],
    )
    expected = spending * 0.05 * weight / 1.05
    assert result["net_income"]["change"] == pytest.approx(expected, abs=0.01)
    assert -programme(result, "vat_change")["change"] == pytest.approx(
        expected, abs=0.01
    )


def test_the_installed_engine_has_no_electricity_zero_rate():
    """policyengine-uk 2.153.5 and later zero-rate Great Britain's domestic
    electricity from 1 October 2026 to 31 March 2027 in current law
    (gov.hmrc.vat.domestic_electricity_rate). On such an engine the
    measure's 2026 leg counts that half-year twice: set rate_change_2026 to
    0 before moving the pin."""
    with pytest.raises(ValueError, match="Could not find the parameter"):
        system.parameters.get_child("gov.hmrc.vat.domestic_electricity_rate")


def test_northern_ireland_keeps_the_electricity_vat():
    """The temporary zero rate is for domestic electricity in Great
    Britain only."""
    result = calculate(
        Answers(2027, region="NORTHERN_IRELAND", electricity_spending=1_040),
        2027,
        ["domestic_electricity_zero_vat"],
    )
    assert result["net_income"]["change"] == 0


def test_no_electricity_spending_no_electricity_vat_change():
    result = calculate(
        Answers(2027, electricity_spending=0),
        2027,
        ["domestic_electricity_zero_vat"],
    )
    assert result["net_income"]["change"] == 0


# --- employer National Insurance for under-25s -----------------------------------


def test_employer_ni_relief_has_no_household_effect():
    """Employers pay less for a 23-year-old from 2027-28, but wages are
    fixed: £0, reported as an employer cost, not as not modelled."""
    result = calculate(
        Answers(2027, age=23, employment_income=30_000),
        2027,
        ["employer_ni_relief_under_25s"],
    )
    [measure] = result["by_policy"]["measures"]
    assert measure["change"] == 0
    assert measure["note_kind"] == "employer_cost"
    assert measure["note"].startswith("No household effect (employer cost)")
    assert result["not_modelled"] == []


# --- VAT cut on road fuel ---------------------------------------------------------


@pytest.mark.parametrize("year, weight", [(2026, 121 / 365), (2027, 61 / 366)])
def test_road_fuel_vat_cut_on_the_fuel_entered(year, weight):
    """20% to 15% from 1 December 2026 to 31 May 2027: the VAT in
    VAT-inclusive fuel spending falls by spending x 0.05 / 1.2 over the
    days of the year in the period."""
    assert road_fuel_vat_cut.__defaults__[0] == pytest.approx(
        -0.05 * 121 / 365
    )
    assert road_fuel_vat_cut.__defaults__[1] == pytest.approx(-0.05 * 61 / 366)
    petrol, diesel = 1_500, 500
    result = calculate(
        Answers(year, petrol_spending=petrol, diesel_spending=diesel),
        year,
        ["road_fuel_vat_cut"],
    )
    expected = (petrol + diesel) * 0.05 * weight / 1.2
    assert result["net_income"]["change"] == pytest.approx(expected, abs=0.01)


# --- parity with the national route's household simulations ---------------------

PARITY_HOUSEHOLDS = {
    "single_renter": dict(
        age=30,
        employment_income=28_000,
        tenure="RENT_PRIVATELY",
        monthly_rent=1_100,
        region="NORTH_WEST",
        petrol_spending=957,
        student_loan_plan="PLAN_2",
    ),
    "uc_couple_two_children": dict(
        age=35,
        employment_income=18_000,
        has_partner=True,
        partner_age=24,
        partner_employment_income=9_000,
        children=(Child(4), Child(9)),
        claims_universal_credit=True,
        tenure="RENT_FROM_COUNCIL",
        monthly_rent=650,
        region="NORTH_WEST",
        petrol_spending=600,
        diesel_spending=400,
        salary_sacrifice_pension_contributions=1_000,
    ),
    "pensioner": dict(
        age=72,
        employment_income=0,
        tenure="OWNED_OUTRIGHT",
        region="WALES",
        private_pension_income=3_000,
        savings_interest_income=1_500,
        petrol_spending=700,
    ),
}


def _national(answers, year, reforms):
    """Each measure's net incomes before and after, as
    ``personal_impact.household_simulations`` builds them (the baseline
    from ``baseline_scenario_for``, the reform from ``to_scenario``, each
    through ``effective``), one simulation per distinct scenario, as the
    personal impact calculator shares them (``scenario_key``)."""
    from policyengine_uk import Simulation

    people, benunit, household = household_impact.household_entities(
        answers, year
    )
    situation = household_impact.household_situation(
        people, benunit, household, year
    )
    config = DataConfig()
    nets: dict = {}

    def net(scenario):
        key = personal_impact.scenario_key(scenario)
        if key not in nets:
            simulation = Simulation(
                situation=situation,
                scenario=personal_impact.effective(scenario),
            )
            nets[key] = float(
                simulation.calculate("household_net_income", year)[0]
            )
        return nets[key]

    return {
        id_: (
            net(reform.baseline_scenario_for(config, uses_config)),
            net(reform.to_scenario()),
        )
        for id_, (reform, uses_config) in reforms.items()
    }


def test_the_parity_helper_is_household_simulations():
    """The helper's sharing changes nothing: for one measure it gives what
    ``personal_impact.household_simulations`` gives."""
    answers = Answers(2027, **PARITY_HOUSEHOLDS["pensioner"])
    reform = get_reform("state_pension_income_tax_protection")
    people, benunit, household = household_impact.household_entities(
        answers, 2027
    )
    baseline, reformed = personal_impact.household_simulations(
        household_impact.household_situation(people, benunit, household, 2027),
        reform,
        DataConfig(),
    )
    assert _national(answers, 2027, {"x": (reform, None)})["x"] == (
        float(baseline.calculate("household_net_income", 2027)[0]),
        float(reformed.calculate("household_net_income", 2027)[0]),
    )


@pytest.mark.parametrize("year", [2026, 2027, 2031])
@pytest.mark.parametrize("name", sorted(PARITY_HOUSEHOLDS))
def test_every_measure_matches_the_national_route_to_the_penny(name, year):
    """Each measure's single (every other measure at its pre-Budget side,
    which for these measures is current law) and the combined run, against
    ``personal_impact.household_simulations`` of the same situation."""
    answers = Answers(year, **PARITY_HOUSEHOLDS[name])
    result = calculate(answers, year)
    base = result["net_income"]["baseline"]
    singles = by_measure(result)
    assert sorted(singles) == sorted(ALL)
    combined = combine_measures([get_reform(id_) for id_ in ALL], DataConfig())
    national = _national(
        answers,
        year,
        {
            **{id_: (get_reform(id_), None) for id_ in ALL},
            "combined": (combined, True),
        },
    )
    for id_ in ALL:
        before, after = national[id_]
        assert base == pytest.approx(before, abs=PENNY), id_
        assert base + singles[id_]["change"] == pytest.approx(
            after, abs=2 * PENNY
        ), id_
    before, after = national["combined"]
    assert base == pytest.approx(before, abs=PENNY)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=PENNY)


def test_the_sweep_applies_the_modifiers_at_every_point():
    """The sweep runs the sides with the situation's axes: the Warm Home
    Discount top-up reaches every point where the family gets Universal
    Credit, and the household's own point matches the headline."""
    answers = Answers(2026, **UC_FAMILY)
    result = household_impact.calculate_household_impact(
        answers, ["warm_home_discount_top_up"], 2026, include=("sweep",)
    )
    points = result["sweep"]["points"]
    assert len(points) == household_impact.SWEEP_POINTS
    assert points[0]["change"] == 100
    assert {p["change"] for p in points} <= {0, 100}
    own = dataclasses.replace(answers)
    assert result["sweep"]["own_point"]["reform"] == (
        calculate(own, 2026, ["warm_home_discount_top_up"])["net_income"][
            "reform"
        ]
    )
