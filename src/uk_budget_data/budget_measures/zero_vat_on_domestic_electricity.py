"""Domestic electricity zero-rated for VAT, 1 October 2026 to 31 March 2028,
Great Britain only (``domestic_electricity_zero_vat``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change

# The October to March share of a financial year's domestic electricity
# use: DESNZ Energy Trends Table 5.5 (September 2026), domestic sales by
# quarter, pooled over 2022-23 to 2025-26 (Q4 plus the next Q1, over Q2 to
# the next Q1: 208.0072 of 366.9466 TWh; 56.1%, 56.5%, 57.2% and 57.0% by
# year). It is a share of use, not of spending: the price cap moves by
# quarter too. A literal, 208.0072 / 366.9466, since a receipt binds this
# module only if each assignment in it is a literal.
WINTER_SHARE = 0.5668595921041373


# Domestic electricity zero-rated (5% to 0%) from 1 October 2026 to
# 31 March 2028, in Great Britain only: the zero rate is for domestic
# electricity in Great Britain (GOV.UK, "Temporary zero rate of VAT in Great
# Britain for domestic electricity"), so Northern Ireland's households keep
# the 5%.
#
# The model has one reduced rate for every reduced-rate good, so the change
# is applied to electricity spending alone. 2026-27 carries the October to
# March share of the year's use (-0.05 x WINTER_SHARE), not its 182 days of
# 365: the zero-rated months are the higher-use half of the year. 2027-28 is
# zero-rated throughout. policyengine-uk 2.153.5 and later zero-rate
# October 2026 to March 2027 in current law, so on those engines the 2026
# leg would count that half-year twice: a test fails if the installed engine
# has it.
def zero_vat_on_domestic_electricity(
    sim,
    rate_change_2026=-0.028342979605206865,  # -0.05 x WINTER_SHARE
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
