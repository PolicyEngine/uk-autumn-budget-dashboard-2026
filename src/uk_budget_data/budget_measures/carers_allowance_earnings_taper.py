"""Carer's Allowance withdrawn £1 for £1 of weekly earnings above the
earnings limit, in place of the cliff edge
(``carers_allowance_earnings_taper``). Hand-written.

One modifier in a module of its own: see the package docstring.
Registered in ``reforms.py`` and one of the combined package's components
(``AUTUMN_BUDGET_2026_COMBINED_COMPONENTS``).
"""

import math

import numpy as np
from policyengine_uk.utils.data_source import built_from_data
from policyengine_uk.utils.stochastic import splitmix64_uniform

from uk_budget_data.measure_templates import _call_formula, _replace_formula

# The OBR's National Living Wage from each April, £ an hour (Economic and
# fiscal outlook, October 2026, detailed forecast tables: economy, Table
# 1.13), as (year of that April, wage) pairs: set by the Government to
# 2027, OBR estimates after. At 16 hours, rounded up to the next pound, the
# limit is £228 in 2030-31 and £234 in 2031-32.
OBR_NATIONAL_LIVING_WAGE_BY_APRIL = (
    (2027, 13.21),
    (2028, 13.513623297578135),
    (2029, 13.854853379339588),
    (2030, 14.23293930734993),
    (2031, 14.617023376183901),
)


def carers_allowance_earnings_taper(
    sim,
    start_year=2030,
    earnings_limit=None,
    taper_rate=1.0,
    redraw_newly_entitled_take_up=False,
    newly_entitled_take_up=0.6,
    take_up_draw_salt=5,
    limit_hours=16,
    national_living_wage_2027=13.21,
    first_year_share=0.5,
    national_living_wage_by_april=OBR_NATIONAL_LIVING_WAGE_BY_APRIL,
):
    """No cliff edge at the Carer's Allowance earnings limit: from
    ``start_year`` a carer whose weekly net earnings are above the limit
    keeps the allowance less ``taper_rate`` x the excess, floored at 0.
    Hand-written: no template changes an entitlement test.

    Budget 2026 (6.13; costings p. 16): a 100% taper above the Weekly
    Earnings Limit, 16 hours at the National Living Wage (``limit_hours``
    x the wage, below), in England and Wales, beginning
    within 2030-31 (``first_year_share`` of 2030-31's change, 0.5 until
    the start date is confirmed).

    The National Living Wage for a year is the OBR's forecast for that
    April (``national_living_wage_by_april``) where it has one, as the
    Treasury's costing uses "OBR projections for increases in the National
    Living Wage"; other years move ``national_living_wage_2027`` on with
    the run's average earnings index. The limit is rounded up to the next
    pound, as the Government sets it "from April 2025 and in future years"
    (Explanatory Memorandum to SI 2025/352, paragraph 5.6: £196 from
    16 x £12.21, £204 from 16 x £12.71), so £212 at £13.21.

    The announcement (27 October 2026, the eve of the Budget; Brit Brief,
    citing the government's release; nation.cymru): "only £1 of support
    will taper away for every additional £1 earned" above the £204 weekly
    earnings limit, "effective 2030-31", the delay being for DWP's IT. The
    start year, the limit and the rate are arguments.

    In current law (policyengine-uk 2.151.0) ``carers_allowance_pre_overlap``
    pays nothing to a person ``is_gainfully_employed_for_carers_allowance``
    holds gainfully employed: weekly net earnings
    (``carers_allowance_earnings`` / 52, a fraction of a penny
    disregarded) above ``gov.dwp.carers_allowance.earnings_limit``. Here,
    from ``start_year``, such a person meeting every other condition gets

        52 x max(0, weekly rate - taper_rate x (weekly earnings - limit)).

    Everyone at or below the limit, and every year before ``start_year``,
    keeps the native formula's amount. The limit is the Budget's (above)
    unless ``earnings_limit`` gives a weekly amount, which then also sets
    who is below it; ``national_living_wage_2027=None`` gives the engine's
    own (£204 a week, not uprated after 2026-27 in the engine). The overlapping-benefit reduction (``carers_allowance``) and
    everything downstream (taxable income, Universal Credit's unearned
    income, the carer premiums and elements) read the new amount as the
    engine has them.

    Scotland is left as it is: Carer Support Payment replaced the
    allowance there from 2025-26, with its own earnings limit in Scottish
    regulations, so a taper there is the Scottish Government's choice.

    Take-up. A claim needs ``would_claim_carers_allowance``. The bundle's
    Microcosm data (microcosm-uk-2024-25-national-20261025T091414Z,
    microcosm#1319) already draws it for carers of 35 hours or more whom
    the earnings limit kept out at the survey year, at 0.6
    (``carers_allowance_newly_entitled`` in Microcosm's take-up contract),
    so this modifier adds no draw of its own by default: a second draw
    would raise their take-up to 0.6 + 0.4 x 0.6. On data whose flag
    follows reported receipt alone (releases before #1319),
    ``redraw_newly_entitled_take_up`` lets a carer who meets the hours
    condition, reports no allowance, is above the limit and is entitled to
    a positive tapered amount claim when a deterministic uniform of their
    ``person_id`` (``splitmix64_uniform``, salt ``take_up_draw_salt``:
    policyengine-uk uses 0 to 3) is below ``newly_entitled_take_up``. A
    household situation (not built from data) draws 0, so it claims, as
    the flag's default of True already makes it.
    """
    native = sim.tax_benefit_system.get_variable(
        "carers_allowance_pre_overlap"
    )

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year < start_year:
            return current
        ca = parameters(period).gov.dwp.carers_allowance
        if earnings_limit is None and national_living_wage_2027 is None:
            # The engine's own limit (£204, not uprated)
            limit = ca.earnings_limit
        elif earnings_limit is None:
            # The Weekly Earnings Limit is 16 hours at the National Living
            # Wage (Budget 2026, 6.13; costings p. 16), rounded up to the
            # next pound (EM to SI 2025/352, para. 5.6). The wage is the
            # OBR's for that April, or else £13.21 from April 2027 carried
            # forward with the run's average earnings index (the engine has
            # no National Living Wage forecast).
            obr_wages = dict(national_living_wage_by_april)
            if year in obr_wages:
                wage = obr_wages[year]
            else:
                index = parameters(period).gov.economic_assumptions.indices.obr
                base = parameters(
                    "2027-04-06"
                ).gov.economic_assumptions.indices.obr
                wage = (
                    national_living_wage_2027
                    * index.average_earnings
                    / base.average_earnings
                )
            # Rounding to six places first keeps an exact amount from
            # rounding up when the float product sits just above it.
            limit = float(math.ceil(round(limit_hours * wage, 6)))
        else:
            limit = earnings_limit
        weekly = person("carers_allowance_earnings", period) / 52
        # The native test disregards a fraction of a penny; the tolerance
        # keeps an exact number of pence from being knocked down.
        weekly = np.floor(weekly * 100 + 1e-6) / 100
        excess = np.maximum(0, weekly - limit)
        weekly_award = np.maximum(0, ca.rate - taper_rate * excess)

        country = person.household("country", period).decode_to_str()
        csp_replaces_ca = (country == "SCOTLAND") & (year >= 2025)
        # The taper is for England and Wales (Budget 2026, 6.13): Northern
        # Ireland keeps the native amount too.
        csp_replaces_ca = csp_replaces_ca | (country == "NORTHERN_IRELAND")
        reported = person("carers_allowance_reported", period) > 0
        meets_hours = person("care_hours", period) >= ca.min_hours
        would_claim = person("would_claim_carers_allowance", period)
        if redraw_newly_entitled_take_up:
            if built_from_data(person.simulation):
                draw = splitmix64_uniform(
                    person("person_id", period), salt=take_up_draw_salt
                ).astype(np.float32)
            else:
                draw = np.zeros(person.count, dtype=np.float32)
            newly_entitled = (
                ~would_claim
                & ~reported
                & meets_hours
                & (excess > 0)
                & (weekly_award > 0)
            )
            would_claim = would_claim | (
                newly_entitled & (draw < newly_entitled_take_up)
            )
        eligible = (
            ~csp_replaces_ca
            & (meets_hours | reported)
            & would_claim
            & (person("age", period) >= ca.min_age)
        )
        tapered = eligible * weekly_award * 52
        if earnings_limit is None:
            # At or below the limit the native amount stands.
            new = np.where(excess > 0, tapered, current)
        else:
            new = tapered
        if year == start_year:
            # The taper begins "within 2030-31" (Budget 2026; Table 6.1
            # costs -40 then -80): the first year carries a share of a
            # year's change. TODO: the start date, when DWP confirms it.
            return current + first_year_share * (new - current)
        return new

    _replace_formula(sim, "carers_allowance_pre_overlap", formula)
    return sim
