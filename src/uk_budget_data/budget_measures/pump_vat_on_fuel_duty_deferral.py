"""The VAT on the pump price that follows the fuel duty deferral
(``fuel_duty_rise_deferral``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change

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
def pump_vat_on_fuel_duty_deferral(
    sim,
    petrol_2026=-0.001614030517759974,
    diesel_2026=-0.0014271508532695523,
    petrol_2027=-0.002856737419901369,
    diesel_2027=-0.002525971598131577,
    petrol_2028=0.0,
    diesel_2028=0.0,
    petrol_2029=0.0,
    diesel_2029=0.0,
    petrol_2030=0.0,
    diesel_2030=0.0,
    petrol_2031=0.0,
    diesel_2031=0.0,
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
