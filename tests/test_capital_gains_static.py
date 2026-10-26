"""The capital gains measures are scored static: no realisation response.

No measure sets ``gov.simulation.capital_gains_responses``, so a capital
gains figure (Business Asset Disposal Relief restricted, today) is static
only while the installed engine's defaults are. They are on
policyengine-uk 2.132.6: every elasticity is 0, so
``utils/capital_gains.realisation_factors`` leaves gains as they are.
Newer engines default the main elasticity to 1 (from 2.134.0, per the
review on #114; 2.153.4's elasticity.yaml has 1.0), which would turn the
static column into a post-response one without any change here (CGT
equalisation moves from £19.0bn to £6.9bn on 2.153.0, #120).

So this fails when the pin moves to such an engine. Then pin the responses
on both sides of every capital gains measure for the static column, as
2.153.4's parameter description says: ``elasticity`` and
``mtr_elasticity`` at 0, ``separate_badr_elasticity`` false. Show the
response as a sensitivity.
"""

import pytest
from policyengine_uk.system import system

from uk_budget_data.budget_years import POLICY_YEARS

RESPONSES = "gov.simulation.capital_gains_responses"


@pytest.mark.parametrize("year", POLICY_YEARS)
def test_installed_engine_has_no_capital_gains_response(year):
    p = system.parameters.get_child(RESPONSES)
    instant = f"{year}-04-06"
    elasticities = {"elasticity": p.elasticity(instant)}
    if hasattr(p, "mtr_elasticity"):
        elasticities["mtr_elasticity"] = p.mtr_elasticity(instant)
    if hasattr(p, "separate_badr_elasticity") and p.separate_badr_elasticity(
        instant
    ):
        elasticities["badr_elasticity"] = p.badr_elasticity(instant)
    assert elasticities == {name: 0 for name in elasticities}, (
        f"The installed engine responds to capital gains tax changes in "
        f"{year}: {elasticities}. Pin {RESPONSES} to 0 on both sides of "
        "every capital gains measure for the static column (see this "
        "module's docstring)."
    )
