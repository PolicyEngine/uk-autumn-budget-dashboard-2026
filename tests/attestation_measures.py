"""Receipt-bindable wrappers that still need the human data-limits check."""

from uk_budget_data.measure_templates import (
    allowance_uprating,
    apply_age_conditioned_allowance,
    apply_property_band_surcharge,
)

ALLOWANCE_PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


def template_helper_modifier(sim, amount=900):
    amount = abs(amount)
    return apply_property_band_surcharge(
        sim,
        lower_bound=1_000_000,
        upper_bound=2_000_000,
        amount=amount,
        start_year=2027,
        end_year=2028,
    )


def allowance_path(sim):
    return sim.allowance_path


def subscript_call_modifier(sim):
    values = allowance_uprating(ALLOWANCE_PATH, 15_000, {2027: 0})[
        allowance_path(sim)
    ]
    return apply_age_conditioned_allowance(
        sim, allowance_by_year=values, taper_threshold=24_000, taper_rate=0.5
    )


def subscript_attribute_modifier(sim):
    values = allowance_uprating(ALLOWANCE_PATH, 15_000, {2027: 0})[
        sim.allowance_path
    ]
    return apply_age_conditioned_allowance(
        sim, allowance_by_year=values, taper_threshold=24_000, taper_rate=0.5
    )
