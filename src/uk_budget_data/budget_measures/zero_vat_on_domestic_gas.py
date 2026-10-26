"""Domestic gas zero-rated for VAT, 1 April 2027 to 31 March 2028
(``domestic_gas_zero_vat``; DRILL 5, MOCK).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change


# DRILL 5 (MOCK, 26 October 2026): domestic gas zero-rated (5% to 0%) for
# 2027-28, 1 April 2027 to 31 March 2028 (12 of 12 months), applied to gas
# spending alone, in Great Britain only, as the temporary zero rate on
# domestic electricity is: Northern Ireland's households keep the 5%.
def zero_vat_on_domestic_gas(sim, rate_change_2027=-0.05, geography="GB"):
    return apply_vat_base_change(
        sim,
        spending_variable="gas_consumption",
        rate_change=rate_change_2027,
        start_year=2027,
        end_year=2027,
        geography=geography,
    )
