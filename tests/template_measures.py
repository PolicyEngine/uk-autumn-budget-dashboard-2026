"""Measures written with the Budget-day templates, the way receipts bind them.

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once
(policyengine.py#571). Budget-day measure modules must keep this shape;
this one does, so the template tests bind real modifiers. It is not a test
module, because pytest rewrites test modules on import and the receipt
refuses code that no longer matches its source file.
"""

from uk_budget_data.measure_templates import (
    allowance_uprating,
    apply_age_conditioned_allowance,
    apply_benefit_receipt_payment,
    apply_property_band_surcharge,
    apply_vat_base_change,
)

ALLOWANCE_PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


def vat_modifier(sim, rate_change=-0.025, start_year=2027, end_year=2028):
    return apply_vat_base_change(
        sim,
        spending_variable="domestic_energy_consumption",
        rate_change=rate_change,
        start_year=start_year,
        end_year=end_year,
    )


def payment_modifier(sim, amount=120, geography="GB", year=2027):
    return apply_benefit_receipt_payment(
        sim,
        amount=amount,
        eligible_benefits=["universal_credit", "guarantee_credit"],
        geography=geography,
        channel="cost_of_living_support_payment",
        year=year,
    )


def allowance_modifier(
    sim,
    base_value=15_000,
    taper_threshold=24_000,
    taper_rate=0.5,
    growth_by_year={"2027": 0, "2028": 0.0301, "2029": 0.02},
):
    values = allowance_uprating(ALLOWANCE_PATH, base_value, growth_by_year)[
        ALLOWANCE_PATH
    ]
    return apply_age_conditioned_allowance(
        sim,
        allowance_by_year=values,
        taper_threshold=taper_threshold,
        taper_rate=taper_rate,
    )


def property_modifier(
    sim,
    lower_bound=1_000_000,
    upper_bound=2_000_000,
    amount=900,
    start_year=2028,
    end_year=2029,
):
    return apply_property_band_surcharge(
        sim,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        amount=amount,
        start_year=start_year,
        end_year=end_year,
    )
