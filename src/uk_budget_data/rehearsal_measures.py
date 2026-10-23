"""Modifiers for the 23 October rehearsal's mock measures (MOCK DATA).

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once
(policyengine.py#571; tests/template_measures.py is the pattern). Keep this
module that shape. Parameter-only measures need nothing here: they are
built in rehearsal_registry.py from the templates' parameter changes.
"""

from uk_budget_data.measure_templates import apply_property_band_surcharge


def hvcts_band_modifier(
    sim,
    lower_bound=1_500_000,
    upper_bound=2_000_000,
    amount_2028=1_500,
    amount_2029=1_530,
    amount_2030=1_560,
):
    """MOCK Table 4.1 line 5: a High Value Council Tax Surcharge band for
    England, £1.5m to £2m at 2026 values, from April 2028: £1,500 a year,
    then £1,530 and £1,560 (CPI)."""
    apply_property_band_surcharge(
        sim,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        amount=amount_2028,
        start_year=2028,
        end_year=2028,
    )
    apply_property_band_surcharge(
        sim,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        amount=amount_2029,
        start_year=2029,
        end_year=2029,
    )
    return apply_property_band_surcharge(
        sim,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        amount=amount_2030,
        start_year=2030,
        end_year=2030,
    )
