"""The candidate Autumn Budget 2026 measures: registry, parameters, receipt
binding, and one hand-checked household for each measure.

Each household value is worked out by hand in its test, from the rates
and thresholds of the installed policyengine-uk (2.132.6), and the model
must agree to the penny (it computes in float32).
"""

import math
from importlib import import_module

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.receipt import (
    CodeRevision,
    measure_identities,
)
from uk_budget_data.publication.template_proof import pure_templates
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    DEFAULT_YEARS,
    FUEL_DUTY,
    FUEL_DUTY_CURRENT_LAW,
    fiscal_year_means,
    fuel_duty_deferral_rates,
    get_all_reforms,
    get_autumn_budget_2026_reforms,
    get_reform,
    list_reform_ids,
    plan_2_unfrozen_thresholds,
)


def modifier(name):
    """A measure's modifier, from its own module in ``budget_measures``."""
    return getattr(
        import_module(f"uk_budget_data.budget_measures.{name}"), name
    )


PENNY = 0.01
PARAMETERS = system.parameters
CANDIDATES = (
    "fuel_duty_rise_deferral",
    "state_pension_income_tax_protection",
    "warm_home_discount_top_up",
    "domestic_electricity_zero_vat",
    "employer_ni_relief_under_25s",
    "threshold_freeze_2031_32",
    "badr_lifetime_limit_cut",
    "road_fuel_vat_cut",
    "plan_2_threshold_unfreeze",
)
OLD_PLACEHOLDERS = (
    "two_child_limit",
    "fuel_duty_freeze",
    "rail_fares_freeze",
    "threshold_freeze_extension",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
    "freeze_student_loan_thresholds",
    "salary_sacrifice_cap",
)


def situation(people: dict, household: dict | None = None) -> dict:
    names = list(people)
    return {
        "people": people,
        "benunits": {"benunit": {"members": names}},
        "households": {"household": {"members": names, **(household or {})}},
    }


def change(measure_id: str, sit: dict, variable: str, year: int):
    """(baseline, reformed) totals of a variable for one household."""
    measure = get_reform(measure_id)
    baseline = Simulation(
        situation=sit, scenario=measure.to_baseline_scenario()
    )
    reformed = Simulation(situation=sit, scenario=measure.to_scenario())
    return (
        float(baseline.calculate(variable, year).sum()),
        float(reformed.calculate(variable, year).sum()),
    )


# --- Registry ---------------------------------------------------------------


def test_the_registry_is_the_combined_package_then_the_ten_candidates():
    assert list_reform_ids() == [AUTUMN_BUDGET_2026_COMBINED_ID, *CANDIDATES]
    assert get_all_reforms() == get_autumn_budget_2026_reforms()
    assert set(AUTUMN_BUDGET_2026_COMBINED_COMPONENTS) == set(CANDIDATES)


def test_the_2025_placeholders_are_gone():
    for old in OLD_PLACEHOLDERS:
        assert get_reform(old) is None, old


def test_every_measure_says_it_is_a_candidate():
    for measure_id in CANDIDATES:
        assert get_reform(measure_id).description.startswith(
            "Candidate measure."
        ), measure_id


def test_get_reform_returns_none_for_an_unknown_id():
    assert get_reform("not_a_measure") is None


def test_default_years_are_the_policy_years():
    assert DEFAULT_YEARS == list(POLICY_YEARS)


def test_the_combined_package_merges_every_members_changes():
    combined = get_reform(AUTUMN_BUDGET_2026_COMBINED_ID)
    for measure_id in CANDIDATES:
        for path, values in (
            get_reform(measure_id).parameter_changes or {}
        ).items():
            assert combined.parameter_changes[path] == values, path
    assert combined.simulation_modifier is not None
    # The Plan 2 measure counts modelled repayments on both sides
    assert combined.baseline_simulation_modifier is not None


# --- Receipts ---------------------------------------------------------------

REVISION = CodeRevision("a" * 40, True)


@pytest.mark.parametrize("measure_id", CANDIDATES)
def test_each_measure_binds_to_a_receipt(measure_id):
    """Drill 4's gate refused closures and unbindable modules: every
    candidate binds, its modifiers module-level with literal defaults."""
    baseline, reform = measure_identities(
        get_reform(measure_id), DataConfig(), REVISION
    )
    assert reform is not None and baseline is not None


def test_the_template_modifiers_are_proved_pure_and_two_are_hand_written():
    pure = {
        "pump_vat_on_fuel_duty_deferral": ["apply_vat_base_change"],
        "state_pension_income_tax_allowance": [
            "apply_age_conditioned_allowance"
        ],
        "warm_home_discount_top_up": ["apply_benefit_receipt_payment"],
        "zero_vat_on_domestic_electricity": ["apply_vat_base_change"],
        "road_fuel_vat_cut": ["apply_vat_base_change"],
    }
    for name, templates in pure.items():
        assert pure_templates(modifier(name), REVISION) == templates, name
    # These need the two-person attestation before approval
    for name in (
        "employer_ni_relief_ages_21_to_24",
        "connect_student_loan_repayments",
    ):
        assert pure_templates(modifier(name), REVISION) is None


# --- 1. Fuel duty -----------------------------------------------------------


def test_current_law_fuel_duty_blends_as_the_engine_does():
    """The schedule the deferral is measured against is the engine's own:
    blended from 6 April, it gives the engine's annual rates."""
    blended = fiscal_year_means(FUEL_DUTY_CURRENT_LAW)
    for year in POLICY_YEARS:
        engine = PARAMETERS.get_child(FUEL_DUTY)(f"{year}-04-30")
        assert blended[str(year)] == pytest.approx(engine, abs=1e-6), year


def test_the_fuel_duty_path_by_hand():
    rates = fuel_duty_deferral_rates()
    # 2026-27: 52.95p all year
    assert rates["2026"] == 0.5295
    # 2027-28 (6 April 2027 to 5 April 2028, 366 days): 52.95p to
    # 31 August (148 days), 55.95p to 30 November (91), 57.95p to 31 March
    # (122), then 57.95p uprated by 2027 RPI, 59.69p, from 1 April (5)
    assert rates["2027"] == pytest.approx(
        (148 * 0.5295 + 91 * 0.5595 + 122 * 0.5795 + 5 * 0.5969) / 366,
        abs=1e-6,
    )
    # 2028-29: 59.69p to 31 March 2029 (360 days), then 61.35p (5)
    assert rates["2028"] == pytest.approx(
        (360 * 0.5969 + 5 * 0.6135) / 365, abs=1e-6
    )
    assert set(rates) == {str(year) for year in POLICY_YEARS}


def test_the_pump_vat_defaults_are_20_percent_of_the_duty_change():
    rates = fuel_duty_deferral_rates()
    current = fiscal_year_means(FUEL_DUTY_CURRENT_LAW)
    defaults = modifier("pump_vat_on_fuel_duty_deferral").__defaults__
    names = modifier("pump_vat_on_fuel_duty_deferral").__code__.co_varnames[
        1 : 1 + len(defaults)
    ]
    for name, value in zip(names, defaults):
        fuel, year = name.split("_")
        price = getattr(PARAMETERS.household.consumption.fuel.prices, fuel)(
            f"{year}-04-30"
        )
        duty_change = rates[year] - current[year]
        assert value == pytest.approx(0.24 * duty_change / price, rel=1e-6)


def test_a_driver_buying_1000_litres_of_petrol():
    """£1,508.14 of petrol at the model's £1.508 a litre is 1,000 litres.
    2026-27: duty 53.95p (current law, blended) -> 52.95p, so £539.53 ->
    £529.50, and VAT falls by 20% of the £10.03, £2.01."""
    year = 2026
    sit = situation(
        {"driver": {"age": {year: 40}, "employment_income": {year: 30_000}}},
        {"petrol_spending": {year: 1_508.14483}},
    )
    baseline, reformed = change(
        "fuel_duty_rise_deferral", sit, "fuel_duty", year
    )
    assert baseline == pytest.approx(539.53, abs=PENNY)
    assert reformed == pytest.approx(529.50, abs=PENNY)
    vat_before, vat_after = change("fuel_duty_rise_deferral", sit, "vat", year)
    assert vat_after - vat_before == pytest.approx(-2.01, abs=PENNY)


# --- 2. State Pension income tax protection ---------------------------------


def nsp(year: int) -> float:
    weekly = PARAMETERS.gov.dwp.state_pension.new_state_pension.amount
    return weekly(f"{year}-04-30") * 52


def test_the_allowances_are_the_full_new_state_pension_rounded_up_to_10():
    defaults = dict(
        zip(
            modifier(
                "state_pension_income_tax_allowance"
            ).__code__.co_varnames[1:12],
            modifier("state_pension_income_tax_allowance").__defaults__,
        )
    )
    for year in range(2027, 2032):
        expected = math.ceil(nsp(year) / 10) * 10
        assert defaults[f"allowance_{year}"] == {str(year): expected}
        assert defaults[f"threshold_{year}"] == expected


@pytest.mark.parametrize("year", [2027, 2031])
def test_a_pensioner_on_the_full_new_state_pension_alone_pays_none(year):
    """2027-28: £13,036.97 - £12,570 = £466.97 taxed at 20%, £93.39.
    2031-32: £14,390.39 - £12,830 = £1,560.39 at 20%, £312.08."""
    sit = situation(
        {"pensioner": {"age": {year: 70}, "state_pension": {year: nsp(year)}}}
    )
    baseline, reformed = change(
        "state_pension_income_tax_protection", sit, "income_tax", year
    )
    expected = {2027: 93.39, 2031: 312.08}[year]
    assert baseline == pytest.approx(expected, abs=PENNY)
    assert reformed == pytest.approx(0, abs=PENNY)


def test_the_allowance_is_withdrawn_against_other_income():
    """2031-32, State Pension £14,390.39 and £1,000 private pension:
    income £15,390.39 is £990.39 over the £14,400 allowance, which falls to
    £13,409.61, rounded up to £13,410. Tax: 20% of £1,980.39, £396.08,
    against 20% of £2,560.39, £512.08."""
    year = 2031
    sit = situation(
        {
            "pensioner": {
                "age": {year: 70},
                "state_pension": {year: nsp(year)},
                "private_pension_income": {year: 1_000},
            }
        }
    )
    baseline, reformed = change(
        "state_pension_income_tax_protection", sit, "income_tax", year
    )
    assert baseline == pytest.approx(512.08, abs=PENNY)
    assert reformed == pytest.approx(396.08, abs=PENNY)


# --- 3. Warm Home Discount --------------------------------------------------


def test_a_pension_credit_household_in_england_gets_100_pounds():
    year = 2026
    sit = situation(
        {"pensioner": {"age": {year: 75}, "state_pension": {year: 8_000}}},
        {"country": {year: "ENGLAND"}},
    )
    pension_credit, _ = change(
        "warm_home_discount_top_up", sit, "pension_credit", year
    )
    assert pension_credit > 0
    baseline, reformed = change(
        "warm_home_discount_top_up", sit, "household_net_income", year
    )
    assert reformed - baseline == pytest.approx(100, abs=PENNY)


def test_northern_ireland_is_outside_the_warm_home_discount():
    year = 2026
    sit = situation(
        {"pensioner": {"age": {year: 75}, "state_pension": {year: 8_000}}},
        {"country": {year: "NORTHERN_IRELAND"}},
    )
    baseline, reformed = change(
        "warm_home_discount_top_up", sit, "household_net_income", year
    )
    assert reformed == pytest.approx(baseline, abs=PENNY)


def test_the_warm_home_discount_top_up_is_for_winter_2026_27_only():
    year = 2027
    sit = situation(
        {"pensioner": {"age": {year: 75}, "state_pension": {year: 8_000}}},
        {"country": {year: "ENGLAND"}},
    )
    pension_credit, _ = change(
        "warm_home_discount_top_up", sit, "pension_credit", year
    )
    assert pension_credit > 0
    baseline, reformed = change(
        "warm_home_discount_top_up", sit, "household_net_income", year
    )
    assert reformed == pytest.approx(baseline, abs=PENNY)


def _universal_credit_data(n):
    """n single adults on Universal Credit with no earnings, in England and
    Wales, as policyengine-uk #2616's receipt test builds them."""
    import numpy as np
    import pandas as pd
    from policyengine_uk.data import UKMultiYearDataset, UKSingleYearDataset

    ids = np.arange(n)
    rng = np.random.default_rng(0)
    tables = dict(
        person=pd.DataFrame(
            {
                "person_id": ids * 10 + 1,
                "person_benunit_id": ids,
                "person_household_id": ids,
                "age": np.full(n, 35),
                "employment_income": np.zeros(n),
            }
        ),
        benunit=pd.DataFrame(
            {
                "benunit_id": ids,
                "would_claim_uc": np.ones(n, dtype=bool),
                "universal_credit_pre_benefit_cap": np.full(n, 5_000.0),
                "uc_benefit_cap_reduction": np.zeros(n),
            }
        ),
        household=pd.DataFrame(
            {
                "household_id": ids,
                "household_weight": 3_500 * rng.lognormal(0, 0.5, n),
                "region": np.array(["LONDON", "NORTH_EAST", "WALES"])[ids % 3],
            }
        ),
    )
    return lambda: UKMultiYearDataset(
        datasets=[
            UKSingleYearDataset(
                **{name: table.copy() for name, table in tables.items()},
                fiscal_year=2026,
            )
        ]
    )


def test_warm_home_discount_receipt_follows_desnz_rates_on_data():
    """In data, 70% of eligible households other than Pension Credit ones
    receive the £100 (DESNZ's rate, pe-uk #2616's draw by household id): the
    total is the rate times the eligible households times £100."""
    import numpy as np
    from policyengine_uk import Microsimulation
    from policyengine_uk.utils.scenario import Scenario
    from policyengine_uk.utils.stochastic import splitmix64_uniform

    year, n = 2026, 4_000
    data = _universal_credit_data(n)
    baseline = Microsimulation(dataset=data())
    reformed = Microsimulation(
        dataset=data(),
        scenario=Scenario(
            simulation_modifier=modifier("warm_home_discount_top_up")
        ),
    )
    variable = "cost_of_living_support_payment"
    paid = np.asarray(reformed.calculate(variable, year)) - np.asarray(
        baseline.calculate(variable, year)
    )
    assert set(np.unique(paid)) == {0, 100}
    draws = splitmix64_uniform(np.arange(n), salt=2).astype(np.float32)
    assert np.array_equal(paid > 0, draws < 0.7)
    weights = np.asarray(baseline.calculate("household_weight", year))
    expected = 0.7 * weights.sum() * 100
    assert (paid * weights).sum() == pytest.approx(expected, rel=0.03)


def test_pension_credit_households_draw_against_85_percent():
    """A household drawing 0.8 receives the top-up if it is on Pension
    Credit (0.8 < 85%) and not otherwise (0.8 >= 70%)."""
    from types import SimpleNamespace

    import numpy as np

    from uk_budget_data import measure_templates

    household_ids = np.arange(200)
    draws = measure_templates.splitmix64_uniform(household_ids, salt=2).astype(
        np.float32
    )
    on_pension_credit = np.arange(200) % 2 == 0

    def household(name, period):
        assert name == "household_id"
        return household_ids

    household.simulation = SimpleNamespace(built_from_dataset=True)
    household.count = 200
    household.members = SimpleNamespace(
        benunit=lambda name, period: np.where(on_pension_credit, 100.0, 0)
    )
    household.any = lambda values: values
    receives = measure_templates._receives(household, 2026, 0.85, 0.7)
    assert np.array_equal(
        receives, draws < np.where(on_pension_credit, 0.85, 0.7)
    )
    # A situation (not data) draws 0, so its household receives it
    household.simulation = SimpleNamespace(built_from_dataset=False)
    assert measure_templates._receives(household, 2026, 0.85, 0.7).all()


def test_receipt_rates_come_in_pairs():
    sim = Simulation(situation=situation({"p": {"age": {2026: 40}}}))
    from uk_budget_data import measure_templates

    with pytest.raises(ValueError, match="both receipt rates"):
        measure_templates.apply_benefit_receipt_payment(
            sim,
            amount=100,
            eligible_benefits=["universal_credit"],
            geography="GB",
            channel="cost_of_living_support_payment",
            year=2026,
            pension_credit_receipt_rate=0.85,
        )


# --- 4. Electricity VAT -----------------------------------------------------


@pytest.mark.parametrize(
    "year, saving",
    # £1,050 a year including 5% VAT holds £50 of VAT. 2026-27: 182 of 365
    # days from 1 October, £24.93; 2027-28: all of it; 2028-29: none.
    [(2026, 24.93), (2027, 50.00), (2028, 0.0)],
)
def test_electricity_vat_on_1050_pounds_a_year(year, saving):
    sit = situation(
        {"adult": {"age": {year: 40}, "employment_income": {year: 20_000}}},
        {"electricity_consumption": {year: 1_050}},
    )
    baseline, reformed = change(
        "domestic_electricity_zero_vat", sit, "household_net_income", year
    )
    assert reformed - baseline == pytest.approx(saving, abs=PENNY)


# --- 5. Employer NI ---------------------------------------------------------


@pytest.mark.parametrize(
    "age, relieved", [(20, False), (21, True), (24, True), (25, False)]
)
def test_employer_ni_on_30000_pounds_by_age(age, relieved):
    """2027-28: 15% of £30,000 - £5,000, £3,750, unless 21 to 24. Under-21s
    already have the relief in law, so the measure leaves them as the
    model has them."""
    year = 2027
    sit = situation(
        {"worker": {"age": {year: age}, "employment_income": {year: 30_000}}}
    )
    baseline, reformed = change(
        "employer_ni_relief_under_25s", sit, "ni_class_1_employer", year
    )
    assert baseline == pytest.approx(3_750, abs=PENNY)
    assert reformed == pytest.approx(0 if relieved else 3_750, abs=PENNY)
    # Wages are fixed, so the household's income does not move
    income = change(
        "employer_ni_relief_under_25s", sit, "household_net_income", year
    )
    assert income[1] == pytest.approx(income[0], abs=PENNY)


@pytest.mark.parametrize("age, relief", [(22, 3_000), (30, 0)])
def test_employer_ni_relief_on_25000_pounds_by_hand(age, relief):
    """2027-28, checked by hand: a 22-year-old on £25,000 saves their
    employer 15% x (£25,000 - £5,000) = £3,000 a year; a 30-year-old
    saves nothing. Employer NI before the measure is £3,000 for both."""
    year = 2027
    sit = situation(
        {"worker": {"age": {year: age}, "employment_income": {year: 25_000}}}
    )
    baseline, reformed = change(
        "employer_ni_relief_under_25s", sit, "ni_class_1_employer", year
    )
    assert baseline == pytest.approx(3_000, abs=PENNY)
    assert baseline - reformed == pytest.approx(relief, abs=PENNY)


def test_employer_ni_relief_starts_in_2027_28():
    """2026-27 is before the measure: a 22-year-old on £25,000 is charged
    £3,000 in both runs."""
    year = 2026
    sit = situation(
        {"worker": {"age": {year: 22}, "employment_income": {year: 25_000}}}
    )
    baseline, reformed = change(
        "employer_ni_relief_under_25s", sit, "ni_class_1_employer", year
    )
    assert reformed == pytest.approx(baseline, abs=PENNY)


def test_employer_ni_relief_leaves_apprentices_as_the_model_has_them():
    """A 23-year-old apprentice has the s.9B zero rate in law, so the
    measure does not relieve them again. On £60,000 the charge above the
    upper threshold, 15% x (£60,000 - £50,270) = £1,459.50 once the
    engine applies s.9B, must survive; relieving twice and flooring at
    zero would remove it. Under policyengine-uk 2.132.6 the engine still
    charges the full £8,250, and the measure leaves it there."""
    year = 2027
    sit = situation(
        {
            "worker": {
                "age": {year: 23},
                "employment_income": {year: 60_000},
                "is_apprentice": {year: True},
            }
        }
    )
    baseline, reformed = change(
        "employer_ni_relief_under_25s", sit, "ni_class_1_employer", year
    )
    assert reformed == pytest.approx(baseline, abs=PENNY)


def test_employer_ni_above_the_upper_threshold_is_still_charged():
    """£60,000 at 23: 15% of £55,000, £8,250, less the relief of 15% of
    £50,270 - £5,000, £6,790.50, leaves £1,459.50."""
    year = 2027
    sit = situation(
        {"worker": {"age": {year: 23}, "employment_income": {year: 60_000}}}
    )
    baseline, reformed = change(
        "employer_ni_relief_under_25s", sit, "ni_class_1_employer", year
    )
    assert baseline == pytest.approx(8_250, abs=PENNY)
    assert reformed == pytest.approx(1_459.50, abs=PENNY)


def test_the_upper_thresholds_are_the_engines_upper_earnings_limit():
    defaults = dict(
        zip(
            modifier("employer_ni_relief_ages_21_to_24").__code__.co_varnames[
                1:9
            ],
            modifier("employer_ni_relief_ages_21_to_24").__defaults__,
        )
    )
    uel = PARAMETERS.gov.hmrc.national_insurance.class_1.thresholds
    for year in range(2027, 2032):
        assert defaults[f"upper_secondary_threshold_{year}"] == round(
            uel.upper_earnings_limit(f"{year}-04-30") * 52
        )


# --- 6. Threshold freeze ----------------------------------------------------


def test_a_single_person_on_30000_pounds_in_2031_pays_52_pounds_more():
    """2031-32: the allowance stays at £12,570 instead of £12,830, so £260
    more is taxed at 20%: £52.00."""
    year = 2031
    sit = situation(
        {"adult": {"age": {year: 40}, "employment_income": {year: 30_000}}}
    )
    baseline, reformed = change(
        "threshold_freeze_2031_32", sit, "income_tax", year
    )
    assert reformed - baseline == pytest.approx(52.00, abs=PENNY)


def test_the_freeze_changes_only_2031():
    changes = get_reform("threshold_freeze_2031_32").parameter_changes
    assert all(set(values) == {"2031"} for values in changes.values())


# --- 7. Business Asset Disposal Relief --------------------------------------


def test_an_800000_pound_qualifying_gain():
    """2027-28, £100,000 salary and an £800,000 qualifying gain. Before:
    £797,000 after the £3,000 exempt amount at 18%, £143,460. After: £500,000
    at 18% (£90,000) and £300,000 at 24% less the exempt amount, set first
    against the higher rate (£297,000 at 24%, £71,280): £161,280."""
    year = 2027
    sit = situation(
        {
            "founder": {
                "age": {year: 55},
                "employment_income": {year: 100_000},
                "capital_gains": {year: 800_000},
                "capital_gains_badr": {year: 800_000},
            }
        }
    )
    baseline, reformed = change(
        "badr_lifetime_limit_cut", sit, "capital_gains_tax", year
    )
    assert baseline == pytest.approx(143_460, abs=PENNY)
    assert reformed == pytest.approx(161_280, abs=PENNY)


# --- 8. Road fuel VAT -------------------------------------------------------


@pytest.mark.parametrize(
    "year, saving",
    # £1,508.14 of petrol holds £251.36 of 20% VAT; 5 of those 20 points is
    # £62.84 a full year. 121 of 365 days in 2026-27: £20.83; 61 of 366 in
    # 2027-28: £10.47; none in 2028-29.
    [(2026, 20.83), (2027, 10.47), (2028, 0.0)],
)
def test_vat_on_1508_pounds_of_petrol(year, saving):
    sit = situation(
        {"driver": {"age": {year: 40}, "employment_income": {year: 30_000}}},
        {"petrol_spending": {year: 1_508.14483}},
    )
    baseline, reformed = change("road_fuel_vat_cut", sit, "vat", year)
    assert baseline - reformed == pytest.approx(saving, abs=PENNY)


# --- 9. Plan 2 --------------------------------------------------------------


def test_the_unfrozen_thresholds_follow_rpi_from_29385_pounds():
    rpi = PARAMETERS.gov.economic_assumptions.indices.obr.rpi
    thresholds = plan_2_unfrozen_thresholds()
    assert thresholds["2027"] == 30_267
    for year in range(2027, 2032):
        assert thresholds[str(year)] == round(
            29_385 * rpi(f"{year}-04-06") / rpi("2026-04-06")
        )


def test_a_graduate_on_45000_pounds_repays_79_pounds_less():
    """2027-28: 9% of £45,000 - £29,385, £1,405.35, becomes 9% of
    £45,000 - £30,267, £1,325.97."""
    year = 2027
    sit = situation(
        {
            "graduate": {
                "age": {year: 30},
                "employment_income": {year: 45_000},
                "student_loan_plan": {year: "PLAN_2"},
                "student_loan_balance": {year: 60_000},
                "student_loan_repayments": {year: 500},
            }
        }
    )
    baseline, reformed = change(
        "plan_2_threshold_unfreeze", sit, "student_loan_repayment", year
    )
    assert baseline == pytest.approx(1_405.35, abs=PENNY)
    assert reformed == pytest.approx(1_325.97, abs=PENNY)


def test_the_page_keeps_no_measure_list_of_its_own():
    """The page lists, names and describes the measures from the published
    receipts (#104), which generation writes from this registry
    (test_generated_receipts_carry_the_registry_metadata). A second list in
    the page's source could disagree with them, so there is none: no page
    file outside the tests names more than one candidate measure."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "src"
    lists = {}
    for path in sorted(root.rglob("*")):
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        relative = path.relative_to(root)
        if "test" in relative.parts or ".test." in path.name:
            continue
        text = path.read_text()
        named = [m for m in CANDIDATES if f'"{m}"' in text]
        if len(named) > 1:
            lists[relative.as_posix()] = named
    assert lists == {}


def test_the_methodology_note_is_for_a_registered_measure():
    """The one modelling note the page keeps by hand (MODELLING_NOTE in
    measures.js, #113's scope note) names a registered measure, so renaming
    the measure can't leave its note unshown without a failure here."""
    import re
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1]
        / "src/components/methodology/measures.js"
    ).read_text()
    (measure_id,) = re.findall(
        r'export const MODELLING_NOTE = \{\s*id: "([a-z0-9_]+)"', source
    )
    assert get_reform(measure_id) is not None


# --- Every year the policy differs is covered ---------------------------------
# The 2025 placeholders set their pre-Budget side from a year after
# policyengine-uk already applied the new rates, so they showed no effect in
# their first year. Each candidate changes current law directly, in every
# year it differs; here one household per measure moves in the first year
# and not in the year before.


def _person(year, **inputs):
    return {key: {year: value} for key, value in {"age": 40, **inputs}.items()}


FIRST_YEARS = {
    # measure: (first year, variable, person inputs, household inputs)
    "fuel_duty_rise_deferral": (
        2026,
        "household_net_income",
        {"employment_income": 30_000},
        {"petrol_spending": 1_508.14483},
    ),
    "state_pension_income_tax_protection": (
        2027,
        "income_tax",
        {"age": 70, "state_pension": 13_000},
        {},
    ),
    "warm_home_discount_top_up": (
        2026,
        "household_net_income",
        {"age": 75, "state_pension": 8_000},
        {"country": "ENGLAND"},
    ),
    "domestic_electricity_zero_vat": (
        2026,
        "household_net_income",
        {"employment_income": 20_000},
        {"electricity_consumption": 1_050},
    ),
    "employer_ni_relief_under_25s": (
        2027,
        "ni_class_1_employer",
        {"age": 22, "employment_income": 30_000},
        {},
    ),
    "threshold_freeze_2031_32": (
        2031,
        "income_tax",
        {"employment_income": 30_000},
        {},
    ),
    "badr_lifetime_limit_cut": (
        2027,
        "capital_gains_tax",
        {
            "age": 55,
            "employment_income": 100_000,
            "capital_gains": 800_000,
            "capital_gains_badr": 800_000,
        },
        {},
    ),
    "road_fuel_vat_cut": (
        2026,
        "vat",
        {"employment_income": 30_000},
        {"petrol_spending": 1_508.14483},
    ),
    "plan_2_threshold_unfreeze": (
        2027,
        "student_loan_repayment",
        {
            "age": 30,
            "employment_income": 45_000,
            "student_loan_plan": "PLAN_2",
            "student_loan_balance": 60_000,
            "student_loan_repayments": 500,
        },
        {},
    ),
}


def test_every_measure_has_a_first_year_check():
    assert set(FIRST_YEARS) == set(CANDIDATES)


@pytest.mark.parametrize("measure_id", CANDIDATES)
def test_each_measure_moves_from_its_first_year_and_not_before(measure_id):
    first, variable, person, household = FIRST_YEARS[measure_id]
    for year, moves in ((first - 1, False), (first, True)):
        sit = situation(
            {"p": _person(year, **person)},
            {key: {year: value} for key, value in household.items()},
        )
        baseline, reformed = change(measure_id, sit, variable, year)
        if moves:
            assert abs(reformed - baseline) > 1, (measure_id, year)
        else:
            assert reformed == pytest.approx(baseline, abs=PENNY), (
                measure_id,
                year,
            )


def test_the_published_revenue_starts_in_each_measures_first_year():
    """The national figures agree: zero before the first year, not zero
    in it (budgetary_impact.csv)."""
    import csv
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / (
        "public/data/budgetary_impact.csv"
    )
    values = {
        (row["reform_id"], int(row["year"])): float(row["value"])
        for row in csv.DictReader(path.open())
    }
    for measure_id, (first, *_) in FIRST_YEARS.items():
        assert abs(values[(measure_id, first)]) > 0.01, measure_id
        for year in POLICY_YEARS:
            if year < first:
                assert values[(measure_id, year)] == 0, (measure_id, year)
