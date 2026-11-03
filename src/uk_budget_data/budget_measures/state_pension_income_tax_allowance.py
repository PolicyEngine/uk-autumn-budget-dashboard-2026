"""An income tax allowance of the full new State Pension, withdrawn against
other income (``state_pension_income_tax_protection``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_age_conditioned_allowance


# An income tax allowance for people over State Pension age of the full new
# State Pension, withdrawn against their other income.
#
# Each year's allowance is the engine's full new State Pension (weekly rate
# x 52) rounded up to the next £10, so a person whose only income is the
# full new State Pension has no taxable income. It is withdrawn £1 for every
# £1 of adjusted net income above the allowance itself, down to the standard
# personal allowance, before the native taper above £100,000. The template
# takes one taper threshold, while the State Pension rises each year, so
# each year is its own call, with its allowance as its threshold; each call
# changes only its year.
def state_pension_income_tax_allowance(
    sim,
    allowance_2027={"2027": 13040},
    allowance_2028={"2028": 13490},
    allowance_2029={"2029": 13820},
    allowance_2030={"2030": 14170},
    allowance_2031={"2031": 14520},
    threshold_2027=13040,
    threshold_2028=13490,
    threshold_2029=13820,
    threshold_2030=14170,
    threshold_2031=14520,
    taper_rate=1.0,
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
