"""MOCK drill 3: statement measures #8 (CGT) and #10 (HVCTS top bands).

Every measure here is invented for a PolicyEngine rehearsal (MOCK DATA).
Policy years are engine fiscal years (policyengine-uk 2.125.1): a bare-year
key such as "2027" is the year starting 6 April 2027.
"""

import numpy as np
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import Reform

# ---------------------------------------------------------------------------
# #8 Capital gains: higher rate 24% -> 28%, AEA £3,000 -> £2,000, April 2027
# ---------------------------------------------------------------------------

MOCK3_CGT_FIRST_YEAR = 2027
MOCK3_CGT_HIGHER_RATE = 0.28
MOCK3_CGT_AEA = 2_000

# Assumption (Annex A): "the higher rate" is the single 24% upper CGT rate.
# The engine's additional_rate exists only to mirror higher_rate (CGT has no
# separate additional rate in law) and charges gains above the income tax
# higher rate limit, so it moves too; leaving it at 24% would cut tax on very
# large gains. Residential property gains share the 24% rate since April
# 2024, so they rise too, as in drill 2's _create_mock2_cgt_rates. Basic
# rates (18%), BADR and carried interest are unchanged.
MOCK3_CGT_RATE_PATHS = (
    "gov.hmrc.cgt.higher_rate",
    "gov.hmrc.cgt.additional_rate",
    "gov.hmrc.cgt.residential_property.higher_rate",
    "gov.hmrc.cgt.residential_property.additional_rate",
)
MOCK3_CGT_AEA_PATH = "gov.hmrc.cgt.annual_exempt_amount"


def _mock3_cgt_years() -> list[int]:
    return [year for year in POLICY_YEARS if year >= MOCK3_CGT_FIRST_YEAR]


def _create_mock3_cgt_higher_rate_aea() -> Reform:
    """Statement #8: CGT higher rate 24% -> 28% and AEA £3,000 -> £2,000.

    From 6 April 2027 (fiscal year 2027). Static: the engine's realisation
    elasticity is 0 by default. The native AEA is a flat £3,000 with no
    uprating, so £2,000 is set flat for every year to 2031.
    """
    years = _mock3_cgt_years()
    changes = {
        path: {str(year): MOCK3_CGT_HIGHER_RATE for year in years}
        for path in MOCK3_CGT_RATE_PATHS
    }
    changes[MOCK3_CGT_AEA_PATH] = {str(year): MOCK3_CGT_AEA for year in years}
    return Reform(
        id="mock3_cgt_higher_rate_aea",
        name="Capital Gains Tax higher rate and annual exempt amount",
        description=(
            "MOCK. From 6 April 2027 the higher rate of Capital Gains Tax "
            "rises from 24% to 28% (including residential property gains) "
            "and the annual exempt amount falls from £3,000 to £2,000. "
            "Basic rate, Business Asset Disposal Relief and carried interest "
            "unchanged; no behavioural response."
        ),
        parameter_changes=changes,
    )


# ---------------------------------------------------------------------------
# #10 HVCTS: £10,000 at £5m-£10m, £15,000 at £10m+, April 2028
# ---------------------------------------------------------------------------

MOCK3_HVCTS_FIRST_YEAR = 2028
MOCK3_HVCTS_SCALE = "gov.hmrc.council_tax.high_value_surcharge.amount"
MOCK3_HVCTS_5M_BRACKET = 4  # native bracket: £5m+ (2026 prices), £7,500
MOCK3_HVCTS_5M_AMOUNT = 10_000
MOCK3_HVCTS_10M_FLOOR = 10_000_000
MOCK3_HVCTS_10M_AMOUNT = 15_000


def _mock3_hvcts_years() -> list[int]:
    return [year for year in POLICY_YEARS if year >= MOCK3_HVCTS_FIRST_YEAR]


def _mock3_hvcts_uprating(parameters, year: int) -> float:
    """Native CPI uprating factor of the surcharge amounts relative to 2028.

    Read from the £2m bracket, which this reform never changes, so the
    factor is the same in baseline and reform simulations.
    """
    band = parameters.gov.hmrc.council_tax.high_value_surcharge.amount
    return band.brackets[1].amount(str(year)) / band.brackets[1].amount(
        str(MOCK3_HVCTS_FIRST_YEAR)
    )


def _mock3_hvcts_10m_modifier(sim: Simulation) -> Simulation:
    """Add the £5,000 top-up that takes homes worth £10m+ to £15,000.

    The native scale has five brackets (0, £2m, £2.5m, £3.5m, £5m) and
    parameter changes cannot add a sixth. The £5m bracket is already set to
    £10,000 by the reform's parameter changes, which _build_scenario applies
    before this modifier, so the native surcharge read here includes it.
    This replicates the native formula's conditions exactly: England only,
    owners only (owned outright or with a mortgage), value deflated to 2026
    prices by OBR GDP per capita, threshold inclusive (>=).
    """
    params = sim.tax_benefit_system.parameters
    gdp = params.gov.economic_assumptions.indices.obr.per_capita.gdp
    top_up = MOCK3_HVCTS_10M_AMOUNT - MOCK3_HVCTS_5M_AMOUNT
    for year in _mock3_hvcts_years():
        value = np.asarray(sim.calculate("main_residence_value", period=year))
        value_2026 = value / (gdp(str(year)) / gdp("2026"))
        country = np.asarray(sim.calculate("country", period=year))
        tenure = np.asarray(sim.calculate("tenure_type", period=year))
        owner = np.isin(tenure, ["OWNED_OUTRIGHT", "OWNED_WITH_MORTGAGE"])
        in_band = (
            (country == "ENGLAND")
            & owner
            & (value_2026 >= MOCK3_HVCTS_10M_FLOOR)
        )
        native = np.asarray(
            sim.calculate("high_value_council_tax_surcharge", period=year)
        )
        sim.set_input(
            "high_value_council_tax_surcharge",
            year,
            native + in_band * top_up * _mock3_hvcts_uprating(params, year),
        )
    return sim


def _create_mock3_hvcts_top_bands() -> Reform:
    """Statement #10: £10,000 at £5m-£10m, £15,000 at £10m+, April 2028.

    Two mechanisms, one assumption set:
    - £5m-£10m: the native £5m bracket's amount (£7,500) becomes £10,000,
      set explicitly for every year 2028-2031 (setting 2028 alone would leave
      the native uprated value in force from 2029).
    - £10m+: _mock3_hvcts_10m_modifier adds £5,000 so the band pays £15,000
      (replacing, not stacking on, the £10,000).
    Provisional assumptions (statement silent; Annex A): valuation thresholds
    are 2026 prices like the native bands; the £10,000/£15,000 are 2028-29
    cash amounts, CPI-uprated from 2029-30 like the native bands.
    """
    path = f"{MOCK3_HVCTS_SCALE}[{MOCK3_HVCTS_5M_BRACKET}].amount"
    return Reform(
        id="mock3_hvcts_top_bands",
        name="Council tax surcharge top bands",
        description=(
            "MOCK. From April 2028 homes in England worth £5 million to "
            "£10 million (2026 values) pay a £10,000 High Value Council Tax "
            "Surcharge, and homes worth £10 million or more pay £15,000; "
            "both amounts rise with CPI from April 2029 like the existing "
            "bands, which are unchanged below £5 million."
        ),
        parameter_changes={
            path: {
                str(year): MOCK3_HVCTS_5M_AMOUNT
                * _mock3_hvcts_uprating(system.parameters, year)
                for year in _mock3_hvcts_years()
            }
        },
        simulation_modifier=_mock3_hvcts_10m_modifier,
    )
