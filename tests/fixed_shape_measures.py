"""Structural measures written the way receipts can bind them.

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once, and
nothing that changes module state at run time (policyengine.py#571). This
module keeps that shape, so the tests bind real modifiers the way Budget-day
measures must be written. It is not a test module either: pytest rewrites
test modules on import, and the receipt refuses a function whose loaded
code no longer matches its source file.
"""

import numpy as np

PURCHASED = "non_residential_property_purchased"
NON_RESIDENTIAL_SDLT = "sdlt_on_non_residential_property_transactions"


def module_level_modifier(sim, rate=0.21):
    """A structural measure that binds by code revision."""
    return sim


def broken_modifier(sim, message="this measure cannot run"):
    """A structural measure that fails whenever it is applied."""
    raise RuntimeError(message)


def raise_additional_dwelling_rates(sim, year=2027, rate=0.07):
    """A structural SDLT higher-rates change: a measure the certified data
    cannot cost, made by a modifier rather than parameter changes."""
    sim.tax_benefit_system.parameters.get_child(
        "gov.hmrc.stamp_duty.residential.purchase.additional.rate"
    ).brackets[1].rate.update(period=f"year:{year}:1", value=rate)
    return sim


def sdlt_from_purchases_read_at_build(
    sim, rate=0.1, start_year=2025, end_year=2031
):
    """Non-residential SDLT set as an input, priced on purchases read while
    the simulation is built, so before any watch of the run (review of #51
    round 17)."""
    for year in range(start_year, end_year + 1):
        purchases = np.asarray(sim.calculate(PURCHASED, year))
        sim.set_input(NON_RESIDENTIAL_SDLT, year, purchases * rate)
    return sim
