"""Single bus fares capped at £2 outside London from 1 January to
31 December 2027, against the £3 cap they would otherwise keep
(``bus_fare_cap_2027``). Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula

# The cap's dates (Budget 2026 Table 6.1 row 4; GOV.UK, 22 July 2026). The
# modifier does not read them: its day shares below are worked out from
# them. The policy table shows them.
CAP_FROM = "2027-01-01"
CAP_TO = "2027-12-31"


def bus_fare_cap_2027(
    sim,
    fall=0.10,
    capped_2026=95 / 365,
    capped_2027=270 / 366,
    country="ENGLAND",
    excluded_region="LONDON",
):
    """Credit each household in England outside London with the Treasury's
    costing of the cap (Table 6.1), shared out across households by their
    bus fare spending: ``fall`` (10.0%) of what that spending would be at
    £3 fares, for the days the cap runs in each fiscal year. Hand-written:
    no template credits a share of a spending variable as income.

    Where 10.0% comes from: £230m, the Treasury's full-year cost of the
    cap in 2027 (Budget 2026, Table 6.1 row 4: -£50m in 2026-27 and
    -£180m in 2027-28), divided by 0.9 for operator participation (the
    grant pays participating operators, about 90% of the market by
    patronage in DfT's evaluation of the first £2 bus fare cap), divided by £2,557m, households'
    bus fare spending in England outside London at £3 fares over the cap
    period (policyengine-uk 2.151.0 on the certified data, run 29 October
    2026; issue #329). It is the Treasury's figure shared out, not our own
    estimate of the national cost.

    Timing: the cap runs from 1 January to 31 December 2027. Fiscal year
    2026-27 (6 April to 5 April) carries 1 January to 5 April 2027, 95 of
    its 365 days; 2027-28 carries 6 April to 31 December 2027, 270 of its
    366 days. These are the day counts policyengine-uk's own fare model
    weights the cap by (``fiscal_year_segments``). No other year moves.

    Why it is grossed up: current law in policyengine-uk already holds the
    £2 cap through 2027, so its ``bus_fare_spending`` is spending at £2
    fares. With ``step = fall × share`` of the year capped, spending at
    £3 would be spending / (1 − step), and the saving is that times
    ``step``: ``spending × step / (1 − step)``.

    Who gets it: households whose ``country`` is England and whose
    ``region`` is not London. London residents get £0, as do households in
    Wales, Scotland and Northern Ireland. The modifier reads only
    ``bus_fare_spending``, ``country`` and ``region``, and no
    ``gov.dft.bus`` parameter, so it does not reach the data limit on
    policyengine-uk's uncapped single fare bands
    (``bus_uncapped_single_fares``). Static: spending and journeys are
    fixed.

    Income-equivalent treatment, a methodological choice: the cap is a
    grant to bus operators, but its incidence is lower fares, so the saving
    is counted as household income, the way a price subsidy would be. It is
    added to ``epg_subsidy`` (the Energy Price Guarantee's bill subsidy,
    nil in these years), which policyengine-uk 2.151.0 counts in
    ``household_benefits`` and so in ``household_net_income`` (not in the
    HBAI income poverty is measured on, like the household energy payment).
    Bus fare spending itself is consumption, outside net income, so nothing
    is counted twice.

    Sources: HM Treasury, Budget 2026, Table 6.1 row 4; DfT, Evaluation of
    the £2 bus fare cap (operator participation); issue #329 (the method,
    decided by Vahid on 29 October 2026).
    """
    system = sim.tax_benefit_system
    native = system.get_variable("epg_subsidy")
    country_enum = system.get_variable("country").possible_values
    region_enum = system.get_variable("region").possible_values
    capped = {2026: capped_2026, 2027: capped_2027}

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        share = capped.get(period.start.year, 0)
        if share == 0:
            return current
        eligible = (household("country", period) == country_enum[country]) & (
            household("region", period) != region_enum[excluded_region]
        )
        spending = np.maximum(household("bus_fare_spending", period), 0)
        # Current law's spending is already at £2 for the capped days:
        # gross the saving up from that base
        step = fall * share
        return current + eligible * spending * step / (1 - step)

    _replace_formula(sim, "epg_subsidy", formula)
    return sim
