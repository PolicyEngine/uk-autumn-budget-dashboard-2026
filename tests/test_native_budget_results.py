"""Inverting the comparison must not itself change a model result.

These tests hold the model, inputs, macro forecast and policy endpoints
fixed. They do not assert equality with estimates made on older bundles,
different data, or the former Treasury-costing references.
"""

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_policy import (
    native_policy_changes,
    policy_record,
    pre_budget_policy_changes,
)
from uk_budget_data.forecast import with_forecast


def situation(income=30_000):
    years = range(2026, 2033)
    return {
        "people": {
            "worker": {
                "age": {year: 40 for year in years},
                "employment_income": {year: income for year in years},
                "savings_interest_income": {year: 3_000 for year in years},
                "property_income": {year: 5_000 for year in years},
            }
        },
        "benunits": {"b": {"members": ["worker"]}},
        "households": {
            "h": {
                "members": ["worker"],
                "region": {year: "LONDON" for year in years},
                "council_tax_band": {year: "D" for year in years},
            }
        },
    }


def native_changes():
    changes = {}
    for measure in policy_record()["measures"]:
        changes.update(native_policy_changes(measure))
    return changes


@pytest.fixture(scope="module")
def endpoints():
    inputs = situation()
    before = Simulation(
        situation=inputs,
        scenario=Scenario(parameter_changes=pre_budget_policy_changes()),
    )
    native = Simulation(situation=inputs)
    forward = Simulation(
        situation=inputs,
        scenario=with_forecast(Scenario(parameter_changes=native_changes())),
    )
    return before, native, forward


@pytest.mark.parametrize("year", range(2026, 2033))
@pytest.mark.parametrize(
    "variable",
    [
        "income_tax",
        "household_benefits",
        "household_tax",
        "household_net_income",
        "hbai_household_net_income",
        "household_energy_payment",
        "savings_income_tax",
        "property_income_tax",
    ],
)
def test_forward_and_native_endpoints_give_identical_changes(
    endpoints, year, variable
):
    before, native, forward = endpoints
    old_direction = forward.calculate(variable, year) - before.calculate(
        variable, year
    )
    inverted_direction = native.calculate(variable, year) - before.calculate(
        variable, year
    )
    np.testing.assert_array_equal(old_direction, inverted_direction)


def test_selected_savings_leaves_unselected_property_and_payment_pre_budget():
    selected = Simulation(
        situation=situation(),
        scenario=with_forecast(
            Scenario(
                parameter_changes=native_policy_changes(
                    "savings_income_rates_up"
                )
            )
        ),
    )
    parameters = selected.tax_benefit_system.parameters
    rates = parameters.gov.hmrc.income_tax.rates
    assert rates.savings.basic("2027") == 0.24
    assert rates.property.basic("2027") == 0.22
    assert selected.calculate("household_energy_payment", 2026)[0] == 0


@settings(max_examples=5, deadline=None)
@given(st.integers(min_value=0, max_value=200_000))
def test_inversion_preserves_income_for_arbitrary_earnings(income):
    inputs = situation(income)
    native = Simulation(situation=inputs)
    restored = Simulation(
        situation=inputs,
        scenario=with_forecast(Scenario(parameter_changes=native_changes())),
    )
    for year in (2026, 2027, 2031):
        np.testing.assert_array_equal(
            restored.calculate("household_net_income", year),
            native.calculate("household_net_income", year),
        )
