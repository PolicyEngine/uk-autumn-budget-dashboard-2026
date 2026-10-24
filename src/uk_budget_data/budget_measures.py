"""Simulation modifiers for the candidate Autumn Budget 2026 measures.

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once, and
nothing that changes module state at run time (policyengine.py#571;
``docs/budget-day-publication.md``, "What the receipt asks of measure
code"). ``reforms.py`` fills caches at run time, so its modifiers cannot be
receipted; every modifier lives here instead, with its numbers as literal
default arguments, and ``reforms.py`` imports them.

Most modifiers are made only of the registered measure templates
(``measure_templates.TEMPLATES``), so ``template_proof.pure_templates``
proves them. Two are hand-written, and need the two-person attestation
before an artifact of theirs can be approved: the employer National
Insurance relief for 21 to 24 year olds (no template changes employer NI)
and the student loan connection (it deletes the survey's reported
repayments so the model's own are used).

Fiscal years: year Y is Y-(Y+1). The VAT measures weight a part year by
its days from 1 April, the public finances' year; fuel duty is set as
parameter values in ``reforms.py``, weighted from 6 April as the engine
blends that parameter.
"""

import numpy as np

from uk_budget_data.measure_templates import (
    _call_formula,
    _replace_formula,
    apply_age_conditioned_allowance,
    apply_benefit_receipt_payment,
    apply_vat_base_change,
)

# VAT on road fuel, the base for the fuel measures' VAT changes.
ROAD_FUEL_VAT_RATE = 0.2


# The VAT on the pump price that follows the fuel duty deferral.
#
# VAT is charged on the duty-inclusive price, so a duty change of d a litre
# moves VAT by 20% of d on each litre. The model holds pump spending and
# prices fixed, with litres = spending / price, so this is
# spending x 0.2 x d / price, written as a VAT rate change on VAT-inclusive
# spending at 20%: spending x r / 1.2, with r = 0.24 x d / price. Each
# default is that r for one fuel and year, from the duty change in
# reforms.fuel_duty_deferral_rates and the engine's fixed pump prices
# (tests/test_reforms.py checks them against both).
#
# Template-pure modifiers (this and the four below) keep to the shape
# template_proof.pure_templates proves: no docstring, only assignments of
# template calls on parameters and literals, then a returned template call.
def pump_vat_on_fuel_duty_deferral(
    sim,
    petrol_2026=-0.001595718988385064,
    diesel_2026=-0.0014109595145776778,
    petrol_2027=-0.006874438262398305,
    diesel_2027=-0.006078485086853602,
    petrol_2028=-0.002945385520570655,
    diesel_2028=-0.0026043556256445627,
    petrol_2029=-0.003040559694496754,
    diesel_2029=-0.0026885101084955843,
    petrol_2030=-0.003120094950359069,
    diesel_2030=-0.0027588364170875977,
    petrol_2031=-0.0031994300802173185,
    diesel_2031=-0.0028289857711584166,
):
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2026,
        start_year=2026,
        end_year=2026,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2026,
        start_year=2026,
        end_year=2026,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2027,
        start_year=2027,
        end_year=2027,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2027,
        start_year=2027,
        end_year=2027,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2028,
        start_year=2028,
        end_year=2028,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2028,
        start_year=2028,
        end_year=2028,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2029,
        start_year=2029,
        end_year=2029,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2029,
        start_year=2029,
        end_year=2029,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2030,
        start_year=2030,
        end_year=2030,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2030,
        start_year=2030,
        end_year=2030,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=petrol_2031,
        start_year=2031,
        end_year=2031,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    return apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=diesel_2031,
        start_year=2031,
        end_year=2031,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )


# An income tax allowance for people over State Pension age of the full new
# State Pension, withdrawn against their other income.
#
# Each year's allowance is the engine's full new State Pension (weekly rate
# x 52) rounded up to the next £10, so a person whose only income is the
# full new State Pension has no taxable income. It is withdrawn £1 for every
# £1 of adjusted net income above the allowance itself, down to the standard
# personal allowance, before the native taper above £100,000. The template
# takes one taper threshold, while the State Pension rises each year, so
# each year is its own call, with its allowance as its threshold; each call
# changes only its year.
def state_pension_income_tax_allowance(
    sim,
    allowance_2027={"2027": 13040},
    allowance_2028={"2028": 13370},
    allowance_2029={"2029": 13700},
    allowance_2030={"2030": 14040},
    allowance_2031={"2031": 14400},
    threshold_2027=13040,
    threshold_2028=13370,
    threshold_2029=13700,
    threshold_2030=14040,
    threshold_2031=14400,
    taper_rate=1.0,
):
    sim = apply_age_conditioned_allowance(
        sim,
        allowance_by_year=allowance_2027,
        taper_threshold=threshold_2027,
        taper_rate=taper_rate,
    )
    sim = apply_age_conditioned_allowance(
        sim,
        allowance_by_year=allowance_2028,
        taper_threshold=threshold_2028,
        taper_rate=taper_rate,
    )
    sim = apply_age_conditioned_allowance(
        sim,
        allowance_by_year=allowance_2029,
        taper_threshold=threshold_2029,
        taper_rate=taper_rate,
    )
    sim = apply_age_conditioned_allowance(
        sim,
        allowance_by_year=allowance_2030,
        taper_threshold=threshold_2030,
        taper_rate=taper_rate,
    )
    return apply_age_conditioned_allowance(
        sim,
        allowance_by_year=allowance_2031,
        taper_threshold=threshold_2031,
        taper_rate=taper_rate,
    )


# £100 more Warm Home Discount (£150 to £250), winter 2026-27.
#
# Paid once per household in Great Britain receiving Universal Credit or
# Pension Credit (guarantee or savings credit), through the cost-of-living
# payment channel, as a benefit. The model has no Warm Home Discount and no
# high-cost-to-heat test, and the template cannot select the legacy benefits
# (Housing Benefit, income-related ESA and JSA, tax credits), so eligibility
# is approximate.
#
# Receipt follows DESNZ's rates (Continuing the Warm Home Discount
# 2026-2031, final stage impact assessment, para. 40): 85% of Pension Credit
# households and 70% of other eligible households receive the rebate (about
# 6m recipients of 7.8m eligible), drawn by household as policyengine-uk's
# would_receive_warm_home_discount draws it. This mirrors pe-uk #2616 until
# the bundle includes it; then the top-up can follow the model's own
# receipt.
def warm_home_discount_top_up(
    sim,
    amount=100,
    geography="GB",
    year=2026,
    pension_credit_receipt_rate=0.85,
    other_receipt_rate=0.7,
):
    return apply_benefit_receipt_payment(
        sim,
        amount=amount,
        eligible_benefits=[
            "universal_credit",
            "guarantee_credit",
            "savings_credit",
        ],
        geography=geography,
        channel="cost_of_living_support_payment",
        year=year,
        pension_credit_receipt_rate=pension_credit_receipt_rate,
        other_receipt_rate=other_receipt_rate,
    )


# Domestic electricity zero-rated (5% to 0%) from 1 October 2026 to
# 31 March 2028.
#
# The model has one reduced rate for every reduced-rate good, so the change
# is applied to electricity spending alone. 2026-27 is weighted by its 182
# zero-rated days from 1 October (-0.05 x 182 / 365); 2027-28 is zero-rated
# throughout.
def zero_vat_on_domestic_electricity(
    sim, rate_change_2026=-0.02493150684931507, rate_change_2027=-0.05
):
    sim = apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=rate_change_2026,
        start_year=2026,
        end_year=2026,
    )
    return apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=rate_change_2027,
        start_year=2027,
        end_year=2027,
    )


# VAT on petrol and diesel from 20% to 15%, 1 December 2026 to 31 May 2027,
# fully passed through to pump prices.
#
# Weighted by days: 121 of 2026-27's 365 (-0.05 x 121 / 365) and 61 of
# 2027-28's 366 (-0.05 x 61 / 366).
def road_fuel_vat_cut(
    sim,
    rate_change_2026=-0.016575342465753425,
    rate_change_2027=-0.008333333333333333,
):
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=rate_change_2026,
        start_year=2026,
        end_year=2026,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=rate_change_2026,
        start_year=2026,
        end_year=2026,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    sim = apply_vat_base_change(
        sim,
        spending_variable="petrol_spending",
        rate_change=rate_change_2027,
        start_year=2027,
        end_year=2027,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )
    return apply_vat_base_change(
        sim,
        spending_variable="diesel_spending",
        rate_change=rate_change_2027,
        start_year=2027,
        end_year=2027,
        baseline_rate=ROAD_FUEL_VAT_RATE,
    )


def employer_ni_relief_ages_21_to_24(
    sim,
    start_year=2027,
    lowest_age=21,
    age_limit=25,
    upper_secondary_threshold_2027=50270,
    upper_secondary_threshold_2028=50270,
    upper_secondary_threshold_2029=50270,
    upper_secondary_threshold_2030=50270,
    upper_secondary_threshold_2031=51330,
):
    """A zero employer (secondary Class 1) rate for employees aged 21 to 24,
    up to an upper secondary threshold, from April 2027. Hand-written: no
    template changes employer National Insurance.

    Under-21s already have this zero rate in law, so the measure extends
    it to ages 21 to 24. policyengine-uk 2.132.6 charges every employee
    over 16 the full rate (the under-21 relief is in the open
    policyengine-uk #2505), so the relief is taken off for ages 21 to 24
    only: employer rate x (min(NI earnings, threshold) - secondary
    threshold), with NI earnings as the native formula has them. The
    threshold is the upper earnings limit, as the upper secondary
    thresholds are set in law, at the engine's annual values.

    Only ``ni_class_1_employer`` changes. The engine's employer cost and
    wage pass-through read the NI parameters, which do not change, so
    earnings and household incomes are fixed: the measure moves revenue
    alone.
    """
    native = sim.tax_benefit_system.get_variable("ni_class_1_employer")
    thresholds = {
        2027: upper_secondary_threshold_2027,
        2028: upper_secondary_threshold_2028,
        2029: upper_secondary_threshold_2029,
        2030: upper_secondary_threshold_2030,
        2031: upper_secondary_threshold_2031,
    }

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year < start_year or year not in thresholds:
            return current
        national_insurance = parameters(period).gov.hmrc.national_insurance
        class_1 = national_insurance.class_1
        earnings = person("ni_class_1_income", period)
        if not parameters(
            period
        ).gov.contrib.policyengine.employer_ni.exempt_employer_pension_contributions:
            earnings = earnings + person(
                "employer_pension_contributions", period
            )
        secondary_threshold = class_1.thresholds.secondary_threshold * 52
        relieved = np.maximum(
            0, np.minimum(earnings, thresholds[year]) - secondary_threshold
        )
        age = person("age", period)
        in_ages = (age >= lowest_age) & (age < age_limit)
        relief = np.where(in_ages, class_1.rates.employer * relieved, 0)
        return np.maximum(current - relief, 0)

    _replace_formula(sim, "ni_class_1_employer", formula)
    return sim


def connect_student_loan_repayments(sim):
    """Use policyengine-uk's modelled student loan repayments.

    In policyengine-uk 2.125.1 and later, ``gov_tax``, ``household_tax``
    and ``hbai_household_net_income`` count ``student_loan_repayments``,
    whose formula returns the modelled ``student_loan_repayment``. The
    dataset supplies its own ``student_loan_repayments`` values, which mask
    that formula, so they are deleted here.
    """
    variable = sim.tax_benefit_system.variables["student_loan_repayments"]
    if not variable.formulas:
        raise RuntimeError(
            "student_loan_repayments has no formula in this policyengine-uk "
            "version, so modelled repayments cannot replace the reported ones"
        )
    sim.delete_arrays("student_loan_repayments")
    return sim
