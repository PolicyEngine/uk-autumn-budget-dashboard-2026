"""Domestic electricity zero-rated for VAT, 1 October 2026 to 31 March 2028,
Great Britain only (``domestic_electricity_zero_vat``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change


# Domestic electricity zero-rated (5% to 0%) from 1 October 2026 to
# 31 March 2028, in Great Britain only: the zero rate is for domestic
# electricity in Great Britain (GOV.UK, "Temporary zero rate of VAT in Great
# Britain for domestic electricity"), so Northern Ireland's households keep
# the 5%.
#
# The model has one reduced rate for every reduced-rate good, so the change
# is applied to electricity spending alone. 2026-27 is weighted by its 182
# zero-rated days from 1 October (-0.05 x 182 / 365); 2027-28 is zero-rated
# throughout.
def zero_vat_on_domestic_electricity(
    sim,
    rate_change_2026=-0.02493150684931507,
    rate_change_2027=-0.05,
    geography="GB",
):
    sim = apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=rate_change_2026,
        start_year=2026,
        end_year=2026,
        geography=geography,
    )
    return apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=rate_change_2027,
        start_year=2027,
        end_year=2027,
        geography=geography,
    )
