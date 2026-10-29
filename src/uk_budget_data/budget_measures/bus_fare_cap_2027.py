"""Single bus fares capped at £2 outside London from 1 January to
31 December 2027, against the £3 cap they would otherwise keep
(``bus_fare_cap_2027``). Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def bus_fare_cap_2027(
    sim,
    reduction=0.125,
    share_2026=0.25,
    share_2027=0.75,
    country="ENGLAND",
    excluded_region="LONDON",
):
    """Credit each household in ``country`` outside ``excluded_region``
    with its fare saving, ``bus_fare_spending x reduction``, for the share
    of each fiscal year the £2 cap runs. Hand-written: no template credits
    a share of a spending variable as income.

    Method: PolicyEngine's own bus fare cap analysis
    (github.com/PolicyEngine/bus-fare-cap, src/bus_fare_cap/formulas.py,
    ``fare_cap_relief = fare_spending x reduction_fraction``). Household
    fares are policyengine-uk's ``bus_fare_spending``, the sum of its
    members' ``person_bus_fare_spending``.

    ``reduction``: the all-ticket fall in fares from a £3 to a £2 cap,
    12.5% (``sources.FARE_CAP_REDUCTION_CENTRAL``, range 10% to 15%;
    ``sources.DERIVED_FARE_REDUCTION``). Derived from DfT's evaluation of
    the first £2 cap (Table 6): affected single fares fell about 27%, and
    weighting that by a cap-era single-ticket share of trips of 0.35 to
    0.50 gives 10% to 15% of all-ticket spending. The evaluation's headline
    6.3% is not used: it measures uncapped 2022 fares to £2 on a pre-cap
    ticket mix.
    https://www.gov.uk/government/publications/evaluation-of-the-2-bus-fare-cap

    Timing: the cap runs from 1 January to 31 December 2027, against a £3
    cap for the whole of 2027 (the Budget's counterfactual). Fiscal year Y
    is Y-(Y+1), so 2026-27 carries January to March (``share_2026``, 3 of
    12 months) and 2027-28 April to December (``share_2027``, 9 of 12),
    by months, with no seasonal weighting of bus use. Static: no extra
    journeys.

    Geography: England outside London, as announced. Every household there
    with fare spending is credited; the cap applies only on participating
    services, which the data cannot identify (DfT's ~90% operator
    participation is inside the derived fraction's evidence, not applied
    again).

    Income-equivalent treatment, a methodological choice: the cap is a
    grant to bus operators, but its incidence is lower fares, so the saving
    is counted as household income, the way a price subsidy would be. It is
    added to ``epg_subsidy`` (the Energy Price Guarantee's bill subsidy,
    nil in these years), which policyengine-uk 2.151.0 counts in
    ``household_benefits`` and so in ``household_net_income`` (not in the
    HBAI income poverty is measured on, like the household energy payment).
    Bus fare spending itself is consumption, outside net income, so nothing
    is counted twice.

    The base: policyengine-uk 2.151.0's current law already schedules the
    £2 cap for calendar 2027 (``gov.dft.bus.fares.cap``, from the
    July 2026 announcement), so the baseline's fare spending outside London
    is already the post-cap amount for January to December 2027. The 12.5%
    was derived against £3-cap spending, so it applies here to a base about
    3% (2026-27) and 7% (2027-28) lower, and the credit is understated by
    about that much.
    """
    native = sim.tax_benefit_system.get_variable("epg_subsidy")
    country_enum = sim.tax_benefit_system.get_variable(
        "country"
    ).possible_values
    region_enum = sim.tax_benefit_system.get_variable("region").possible_values
    shares = {2026: share_2026, 2027: share_2027}

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        share = shares.get(period.start.year, 0)
        if share == 0:
            return current
        eligible = (household("country", period) == country_enum[country]) & (
            household("region", period) != region_enum[excluded_region]
        )
        spending = np.maximum(household("bus_fare_spending", period), 0)
        return current + eligible * spending * reduction * share

    _replace_formula(sim, "epg_subsidy", formula)
    return sim
