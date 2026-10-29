"""Single bus fares capped at £2 outside London from 1 January to
31 December 2027, against the £3 cap they would otherwise keep
(``bus_fare_cap_2027``). Hand-written.

One modifier in a module of its own: see the package docstring.
"""

from types import SimpleNamespace

from policyengine_core.periods import instant

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def bus_fare_cap_2027(
    sim,
    counterfactual_cap=3,
    cap_from="2027-01-01",
    cap_to="2027-12-31",
):
    """Credit each household with what its bus fares would cost with the
    single fare cap at ``counterfactual_cap`` from ``cap_from`` to
    ``cap_to``, less what they cost under current law's £2 cap. Hand-written:
    no template credits a difference in a spending variable as income.

    The fare model is policyengine-uk 2.151.0's own
    (``person_bus_fare_spending``): fare-paying journeys priced at DfT's
    published yields and fares index, with a change in the national single
    fare cap applied to single tickets in England outside London through
    ``single_fare_cap_change``, over the uncapped single fare bands
    (``gov.dft.bus.uncapped_single_fares``, fitted to DfT's evaluation of
    the first £2 cap and the cap's funding) and each person's single-ticket
    share. Current law already holds the £2 cap from 1 January 2027 to
    1 January 2028 (``gov.dft.bus.fares.cap``), so the saving is that
    formula run twice: once as the engine runs it, and once with the cap
    schedule held at ``counterfactual_cap`` over ``cap_from`` to ``cap_to``
    and every other date as current law (no cap from 2028). The engine
    weights the cap by days within each fiscal year (6 April to 5 April),
    so 2026-27 carries 1 January to 5 April 2027 and 2027-28 6 April to
    31 December 2027; there is nothing before or after. Only England
    outside London can move: elsewhere, and for people with a bus pass, the
    formula does not read the cap. A household priced from reported
    spending (no journey data) saves nothing, as the engine applies no cap
    there; the national dataset supplies journeys, so only Wales and
    unknown regions take that path.

    Why a second run of the engine's formula, not a parameter change: the
    saving must be income in the same simulation as current law, and a
    parameter change moves both cap schedules in that simulation. The
    counterfactual schedule is a copy, never attached to the simulation's
    parameters, so nothing else reads it. Static: journeys are fixed.

    Income-equivalent treatment, a methodological choice: the cap is a
    grant to bus operators, but its incidence is lower fares, so the saving
    is counted as household income, the way a price subsidy would be. It is
    added to ``epg_subsidy`` (the Energy Price Guarantee's bill subsidy,
    nil in these years), which policyengine-uk 2.151.0 counts in
    ``household_benefits`` and so in ``household_net_income`` (not in the
    HBAI income poverty is measured on, like the household energy payment).
    Bus fare spending itself is consumption, outside net income, so nothing
    is counted twice.
    """
    system = sim.tax_benefit_system
    native = system.get_variable("epg_subsidy")
    fares_formula = system.get_variable("person_bus_fare_spending")
    root = system.parameters
    counterfactual = root.gov.dft.bus.fares.clone()
    counterfactual.children["cap"].update(
        value=counterfactual_cap,
        start=instant(cap_from),
        stop=instant(cap_to),
    )

    def counterfactual_parameters(at):
        return root(at)

    counterfactual_parameters.gov = SimpleNamespace(
        dft=SimpleNamespace(
            bus=SimpleNamespace(
                fares=counterfactual,
                reference_fares=root.gov.dft.bus.reference_fares,
            )
        )
    )
    first, last = instant(cap_from).year, instant(cap_to).year

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        # Fiscal year Y runs 6 April Y to 5 April Y+1: those that overlap
        # the counterfactual's dates
        if not first - 1 <= period.start.year <= last:
            return current
        people = household.members
        without_cap = _call_formula(
            fares_formula, people, period, counterfactual_parameters
        )
        with_cap = people("person_bus_fare_spending", period)
        return current + household.sum(without_cap - with_cap)

    _replace_formula(sim, "epg_subsidy", formula)
    return sim
