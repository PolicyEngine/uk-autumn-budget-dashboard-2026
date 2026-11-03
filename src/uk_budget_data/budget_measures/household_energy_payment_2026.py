"""£100 household energy payment, winter 2026-27, to households in council
tax bands A to D in England (``household_energy_payment_2026``).
Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def household_energy_payment_2026(
    sim,
    amount=100,
    year=2026,
    country="ENGLAND",
    bands=("A", "B", "C", "D"),
):
    """A one-off payment of ``amount`` in fiscal year ``year`` to each
    household in ``country`` (a country enum name, or "UK" for all) whose
    council tax band is one of ``bands``. Hand-written: no template pays by
    council tax band.

    Announced in the Budget speech (28 October 2026, 12:53): "£100 to
    around 20 million households in council tax bands A to D this winter",
    paid into bank accounts, costed at £2.6bn; "the Scottish, Welsh and
    Northern Ireland governments will receive a share of this funding", so
    the payment itself is England's.

    It is paid through ``ebr_council_tax_rebate``, the 2022 Energy Bills
    Rebate's £150 for bands A to D, which policyengine-uk 2.151.0 counts in
    ``energy_bills_rebate``, so in household benefits and net income. That
    rebate's own parameter (``gov.treasury.energy_bills_rebate.
    council_tax_rebate.amount``) would give a parametric route, but it pays
    every country, Northern Ireland included (no bands there; the engine's
    default band is D), so the payment is restricted to ``country`` here.
    """
    native = sim.tax_benefit_system.get_variable("ebr_council_tax_rebate")
    country_enum = sim.tax_benefit_system.get_variable(
        "country"
    ).possible_values
    band_enum = sim.tax_benefit_system.get_variable(
        "council_tax_band"
    ).possible_values

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        if period.start.year != year:
            return current
        band = household("council_tax_band", period)
        eligible = np.zeros(household.count, dtype=bool)
        for name in bands:
            eligible = eligible | (band == band_enum[name])
        if country != "UK":
            eligible = eligible & (
                household("country", period) == country_enum[country]
            )
        return current + eligible * amount

    _replace_formula(sim, "ebr_council_tax_rebate", formula)
    return sim
