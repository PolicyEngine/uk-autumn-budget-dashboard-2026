"""Machine Games Duty at the higher rate on higher-stake machines from
April 2027 (``machine_games_duty_rise``), ported from policyengine-uk#2731.
Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np
from policyengine_uk.utils.data_source import built_from_data

from uk_budget_data.forecast.gambling import projection_factor
from uk_budget_data.measure_templates import _call_formula, _replace_formula

# The switch policyengine-uk#2731 adds (2.167.0): current law there already
# charges higher-stake machines at the higher rate
ENGINE_SWITCH = (
    "gov.hmrc.gambling_duty.machine_games.higher_stake_machines_at_higher_rate"
)


def machine_games_higher_stake_rate(
    sim,
    higher_stake_share=0.757,
    first_year=2027,
    standard_rate=0.20,
    higher_rate=0.25,
):
    """Charge the higher-stake part of standard-rate net takings at Machine
    Games Duty's ``higher_rate`` (25%) instead of its ``standard_rate``
    (20%), from model year ``first_year``. Hand-written: no template moves
    part of a base to another rate. The two rates are Finance Act 2012,
    Schedule 24, paragraph 9's, as policyengine-uk holds them
    (``gov.hmrc.gambling_duty.machine_games.rates``); they are written here
    so that the measure reads no rate parameter, and a test holds them to
    the engine's.

    The law (Budget 2026, paragraphs 2.49 and 6.225; OOTLAR paragraph 1.50;
    Table 6.1 row 56): from 1 April 2027 "gaming machines with a maximum
    charge to play of more than £1 or a maximum prize of more than £100
    will become subject to the higher rate of MGD at 25%, instead of the
    standard rate of 20%". Every other standard-rate machine stays at 20%.
    policyengine-uk#2731 encodes the same rule: duty = duty before +
    min(max(H, 0), max(S, 0)) × (higher rate − standard rate), with S the
    standard-rate takings and H their higher-stake part.

    The higher-stake part. policyengine-uk 2.151.0 and 2.165.1 have no
    input for it (#2731 adds one in 2.167.0), so:

    - On survey data it is ``higher_stake_share`` of S: 75.7%, the Gambling
      Commission's 2024-25 Category B gaming machine yield (£2,289.8m,
      Industry Statistics, April 2025 to March 2026, sheet 4) over HMRC's
      2024-25 standard-rate base (£604.7m of liabilities at 20%, £3,023.7m;
      UK Betting and Gaming Statistics, Table_2_MGD). Category B is the
      class the thresholds move (B1 to B4; C and D stay within them). It is
      a floor: the Commission's figures leave out members' clubs, which may
      hold Category B3A and B4 machines, and Northern Ireland, so some of
      the £501m by which HMRC's base exceeds the Commission's Category B
      and C yield may be higher-stake too
      (María, policyengine.py#731, 2 November 2026; agreed by Vahid, 3
      November). Category B over Categories B and C alone, which
      policyengine-uk#2761 uses, is 90.78%: an upper reading. The base's
      2027-28 step is derived at the same share
      (``forecast.gambling.HIGHER_STAKE_SHARE``; a test holds the two
      equal), so the base and the rate match. Written here, not imported,
      so the receipt can bind the modifier.
    - For one household (the Household calculator), all of S: the form
      asks only for losses on higher-stake machines and sets them as the
      household's standard-rate takings, so H = S, exactly.

    One rule and one share in both, so the calculator and the national
    figure agree. Built from survey data or not is
    ``policyengine_uk.utils.data_source.built_from_data``.

    The base. On survey data S grows with the OBR's October 2026 Machine
    Games Duty base (``forecast.gambling``, policyengine-uk#2761's series
    with its 2027-28 step derived at this share, not #2761's 90.78%), as
    the duty before the change does: the extra duty scales by the same
    ``projection_factor``. One household's S is the amount it gives.

    Timing. Model year Y runs from 6 April Y, so model year 2027 is the
    first with all of it. #2731 also charges 1 to 5 April 2027 in model
    year 2026 (5 of its 365 days, about £2m nationally); the Treasury's
    2026-27 runs April to March and scores £0, as this does.

    Static: the rates move and play does not. The costing's behaviour (an
    elasticity of -0.95, a quarter of lost stakes moving to Remote Gaming
    Duty, lower Corporation Tax) is not modelled, nor the move of the
    liability to machine suppliers from April 2028 (also row 56, +£10m to
    +£20m a year). The duty is counted against the households whose losses
    make up the takings, as policyengine-uk counts it.

    Refused on an engine that has #2731's switch: there current law already
    charges the higher rate, and this would charge it twice.
    """
    system = sim.tax_benefit_system
    try:
        system.parameters.get_child(ENGINE_SWITCH)
    except Exception:
        pass
    else:
        raise ValueError(
            "policyengine-uk has the higher-stake switch (#2731), so its "
            "current law already charges higher-stake machines at the "
            "higher rate: score the measure as that switch off before the "
            "Budget, not with this modifier"
        )
    native = system.get_variable("machine_games_duty")
    share = higher_stake_share if built_from_data(sim) else 1.0

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        year = period.start.year
        if year < first_year:
            return current
        standard = np.maximum(
            household("machine_games_standard_rate_net_takings", period), 0
        )
        factor = projection_factor(household.simulation, "machine_games", year)
        return current + share * standard * factor * (
            higher_rate - standard_rate
        )

    _replace_formula(sim, "machine_games_duty", formula)
    return sim
