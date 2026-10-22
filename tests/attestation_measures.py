"""Receipt-bindable wrappers that still need the human data-limits check."""

from uk_budget_data.measure_templates import apply_property_band_surcharge


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
