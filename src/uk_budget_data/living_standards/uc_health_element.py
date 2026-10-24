"""Keep the protected UC health element in 2030-31 and 2031-32 (pe-uk #2428).

policyengine-uk before 2.134.4 sets the Universal Credit LCWRA (health)
element only for 2026-27 to 2029-30: ``universal_credit_july_2025_reform``
in ``policyengine_uk/scenarios/uc_reform.py`` loops over
``range(2026, 2030)`` and its new-claimant share (``post_2025_claimant_share``)
stops at 2029. From 2030-31 the ``uc_LCWRA_element`` formula then pays every
claimant the new-claimant amount, so pre-2026, severe conditions criteria and
terminally ill claimants lose the protected amount in one step (issue
PolicyEngine/policyengine-uk#2282): UC falls by about £2.4bn and child poverty
rises in 2030-31.

PolicyEngine/policyengine-uk#2428 ("Keep the protected UC LCWRA amount from
2030-31", merged 16 October 2026, first released in 2.134.4) fixed it. For
every year after 2029-30 the scenario now:

- draws new claimants against ``rebalancing.new_claimant_share``, which holds
  the 2029-30 share (22%) from 2030-31, with the same seeded draw
  (``np.random.default_rng(43)`` over benefit units), so a benefit unit keeps
  its status from one year to the next;
- pays a protected claimant the year before's protected amount times the
  growth of ``gov.economic_assumptions.indices.uc_health_element``;
- pays a new claimant ``new_claimant_health_element``, uprated by the same
  index.

That index (#2284, ``create_health_element_uprating.py``) is the benefit
uprating index ``gov.benefit_uprating_cpi`` read at 30 April of each tax
year, held flat in the frozen years 2026-27 to 2029-30 and never falling. For
2030-31 and 2031-32, which are not frozen, its growth is therefore
``max(1, B(y) / B(y - 1))`` with ``B`` the benefit uprating index; and the
new-claimant amount enters 2030-31 at £217.26 a month, as it is in this
engine's 2029-30.

:func:`apply_uc_health_element_extension` applies that rule to a simulation
built on an engine without the fix, for 2030-31 and 2031-32 only. It reads the
2029-30 protected amount from the installed scenario, so 2026-27 to 2029-30
are untouched. It runs only when the installed policyengine-uk is below
2.134.4 (:func:`needs_uc_health_element_extension`); from that release the
engine does this itself.
"""

from importlib.metadata import version

import numpy as np

from uk_budget_data.bundle_adoption import version_tuple

UPSTREAM_FIX = "PolicyEngine/policyengine-uk#2428"
UPSTREAM_FIX_URL = "https://github.com/PolicyEngine/policyengine-uk/pull/2428"
# The first policyengine-uk release with #2428.
FIXED_IN = (2, 134, 4)
EXTENSION_YEARS = (2030, 2031)
# The last year the unfixed scenario sets the element.
LAST_SCENARIO_YEAR = 2029
# rebalancing/new_claimant_share.yaml in #2428: the 2029-30 share, held.
NEW_CLAIMANT_SHARE_AFTER_2029 = 0.22
# The scenario's seeded draw (uc_reform.add_universal_credit_reform).
DRAW_SEED = 43
FISCAL_YEAR_SAMPLE_DATE = "04-30"


def needs_uc_health_element_extension(
    policyengine_uk: str | None = None,
) -> bool:
    """Whether the installed (or named) policyengine-uk predates #2428."""
    installed = policyengine_uk or version("policyengine-uk")
    return version_tuple(installed) < FIXED_IN


def health_element_index_growth(parameters, year: int) -> float:
    """Growth of #2428's uc_health_element index into ``year`` (not frozen).

    The index moves with ``gov.benefit_uprating_cpi`` at 30 April of each
    tax year and never falls; the freeze holds it only in 2026 to 2029.
    """
    if year <= LAST_SCENARIO_YEAR:
        raise ValueError(f"{year} is a frozen year; the engine sets it.")
    index = parameters.gov.benefit_uprating_cpi
    current = float(index(f"{year}-{FISCAL_YEAR_SAMPLE_DATE}"))
    previous = float(index(f"{year - 1}-{FISCAL_YEAR_SAMPLE_DATE}"))
    return max(1.0, current / previous)


def extended_amounts(sim, years=EXTENSION_YEARS) -> dict:
    """Monthly protected and new-claimant amounts for each extension year."""
    from policyengine_uk.scenarios import uc_reform

    parameters = sim.tax_benefit_system.parameters
    rebalancing = parameters.gov.dwp.universal_credit.rebalancing
    protected = uc_reform._protected_existing_health_element_monthly(
        sim, LAST_SCENARIO_YEAR
    )
    new = float(rebalancing.new_claimant_health_element(LAST_SCENARIO_YEAR))
    out = {}
    for year in range(LAST_SCENARIO_YEAR + 1, max(years) + 1):
        growth = health_element_index_growth(parameters, year)
        protected *= growth
        new *= growth
        if year in years:
            out[year] = {
                "protected_monthly": protected,
                "new_claimant_monthly": new,
                "index_growth": growth,
            }
    return out


def apply_uc_health_element_extension(sim, years=EXTENSION_YEARS) -> dict:
    """Set the UC health element for ``years`` as policyengine-uk 2.134.4 does.

    Call it on a freshly built simulation, before anything is calculated for
    those years. Returns the amounts and shares it used.
    """
    from policyengine_uk.scenarios import uc_reform
    from policyengine_uk.utils.supplied_inputs import set_model_value

    if not years:
        return {"applied": False}
    if any(year <= LAST_SCENARIO_YEAR for year in years):
        raise ValueError("The engine's own scenario sets 2026-27 to 2029-30.")
    rebalancing = (
        sim.tax_benefit_system.parameters.gov.dwp.universal_credit.rebalancing
    )
    built_from_data = getattr(sim, "built_from_dataset", False)
    # The same draw the scenario made: one uniform per benefit unit.
    uc_seed = np.random.default_rng(DRAW_SEED).random(
        len(sim.calculate("benunit_id"))
    )
    amounts = extended_amounts(sim, years)
    applied = {}
    for year in years:
        if not rebalancing.active(year):
            continue
        is_new_claimant = uc_reform._new_claimant_health_element_status(
            sim, year, uc_seed < NEW_CLAIMANT_SHARE_AFTER_2029, built_from_data
        )
        element = np.array(sim.calculate("uc_LCWRA_element", year))
        has_element = element > 0
        element[has_element & ~is_new_claimant] = (
            amounts[year]["protected_monthly"] * 12
        )
        element[has_element & is_new_claimant] = (
            amounts[year]["new_claimant_monthly"] * 12
        )
        set_model_value(sim, "uc_LCWRA_element", year, element)
        applied[year] = amounts[year]
    return {
        "applied": bool(applied),
        "years": sorted(applied),
        "upstream_fix": UPSTREAM_FIX,
        "upstream_fix_url": UPSTREAM_FIX_URL,
        "fixed_in": ".".join(str(p) for p in FIXED_IN),
        "new_claimant_share": NEW_CLAIMANT_SHARE_AFTER_2029,
        "amounts": {str(y): a for y, a in applied.items()},
    }
