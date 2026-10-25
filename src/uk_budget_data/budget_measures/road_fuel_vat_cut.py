"""VAT on petrol and diesel cut to 15%, 1 December 2026 to 31 May 2027
(``road_fuel_vat_cut``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change

# VAT on road fuel, the base for the fuel measures' VAT changes.
ROAD_FUEL_VAT_RATE = 0.2


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
