"""The State Pension income tax allowance, never withdrawn against other
income (``state_pension_income_tax_protection_extended``; DRILL 5, MOCK).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_age_conditioned_allowance


# DRILL 5 (MOCK, 26 October 2026): the allowance of
# ``state_pension_income_tax_allowance``, with the same literal values, but
# never withdrawn above it (taper rate 0), so other income or State Pension
# increments do not take it away.
def state_pension_income_tax_allowance_untapered(
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
    taper_rate=0.0,
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
