"""The Warm Home Discount top-up's national reach on the certified data.

DESNZ's final-stage impact assessment (Continuing the Warm Home Discount
2026-2031, para. 40) puts receipt at about 6m households of 7.8m eligible.
The model sits below it, because its own benefit take-up is below
caseloads: on Microcosm UK 2024-25 (policyengine 6.10.2) about 7.4m
households in Great Britain receive a 2026-27 core-group benefit and 5.2m
are drawn to receive the £100. The bounds allow that gap and catch a
change in the eligible benefits (Universal Credit and Pension Credit alone
reach 4.8m).
"""

import numpy as np
import pytest

from uk_budget_data.budget_measures.warm_home_discount_top_up import (
    warm_home_discount_top_up,
)

YEAR = 2026


@pytest.mark.certified_data
def test_the_top_up_reaches_about_desnz_recipients():
    from policyengine_uk.utils.scenario import Scenario

    from uk_budget_data.pipeline import build_microsimulation

    baseline = build_microsimulation(None)
    reform = build_microsimulation(
        None,
        Scenario(simulation_modifier=warm_home_discount_top_up),
    )
    weight = baseline.calculate("household_weight", YEAR).values
    paid = (
        reform.calculate("cost_of_living_support_payment", YEAR).values
        - baseline.calculate("cost_of_living_support_payment", YEAR).values
    )
    assert np.all(np.isclose(paid, 0) | np.isclose(paid, 100))
    recipients = (weight * np.isclose(paid, 100)).sum()
    assert 5.0e6 < recipients < 6.3e6, f"{recipients / 1e6:.2f}m recipients"
