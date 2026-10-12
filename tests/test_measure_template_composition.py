"""Native regressions for additive VAT and property formula wrappers."""

import numpy as np
import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.measure_templates import (
    apply_property_band_surcharge,
    apply_vat_base_change,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    check_consistency,
    combine_measures,
)


def energy_cut(sim):
    return apply_vat_base_change(
        sim,
        spending_variable="domestic_energy_consumption",
        rate_change=-0.025,
        start_year=2027,
        end_year=2027,
    )


def review_household():
    return {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "consumption": {2027: 10_000},
                "domestic_energy_consumption": {2027: 1680},
                "electricity_consumption": {2028: 1000},
            }
        },
    }


@pytest.mark.parametrize(
    "parameter, new_rate, old_rate",
    [("standard_rate", 0.3, 0.05), ("reduced_rate", 0.1, 0.1)],
)
def test_vat_helper_composes_with_scenario_parameter_changes(
    parameter, new_rate, old_rate
):
    changes = {f"gov.hmrc.vat.{parameter}": {2027: new_rate}}
    rate_only = Simulation(
        situation=review_household(),
        scenario=Scenario(parameter_changes=changes),
    )
    both = Simulation(
        situation=review_household(),
        scenario=Scenario(
            parameter_changes=changes, simulation_modifier=energy_cut
        ),
    )
    adjustment = 1680 * -0.025 / (1 + old_rate)
    np.testing.assert_allclose(
        both.calculate("vat", 2027),
        rate_only.calculate("vat", 2027) + adjustment,
        atol=0.001,
        rtol=0,
    )
    if parameter == "standard_rate":
        assert both.calculate("vat_change", 2027)[0] == pytest.approx(
            1275.79, abs=0.01
        )


def test_two_vat_helpers_compose_across_spending_variables_and_years():
    sim = Simulation(situation=review_household())
    before = {year: sim.calculate("vat", year).copy() for year in (2027, 2028)}
    energy_cut(sim)
    # Warm the first wrapped formula before installing the second one.
    sim.calculate("vat", 2027)
    apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=-0.025,
        start_year=2028,
        end_year=2028,
    )
    for year, spending in [(2027, 1680), (2028, 1000)]:
        np.testing.assert_allclose(
            sim.calculate("vat", year) - before[year],
            spending * -0.025 / 1.05,
            atol=0.001,
            rtol=0,
        )
    assert not sim.get_holder("vat").get_input_periods(sim.branch_name)


def test_vat_helper_measure_and_parameter_measure_pass_consistency():
    members = [
        Reform(
            id="energy_cut", name="Energy cut", simulation_modifier=energy_cut
        ),
        Reform(
            id="standard_rate_rise",
            name="Standard rate rise",
            parameter_changes={"gov.hmrc.vat.standard_rate": {2027: 0.3}},
        ),
    ]
    config = DataConfig(years=[2027])
    combined = combine_measures(members, config)
    # The production probe has no spending inputs.
    check_consistency(combined, members, config, [2027])
    sim = Simulation(
        situation=review_household(), scenario=combined.to_scenario()
    )
    assert sim.calculate("vat_change", 2027)[0] == pytest.approx(
        1275.79, abs=0.01
    )


@pytest.mark.parametrize(
    "baseline_rate, delta, expected", [(0, 0.2, 336), (0.2, -0.05, -70)]
)
def test_vat_wrapper_preserves_explicit_baseline_rates(
    baseline_rate, delta, expected
):
    sim = Simulation(situation=review_household())
    before = sim.calculate("vat", 2027).copy()
    apply_vat_base_change(
        sim,
        spending_variable="domestic_energy_consumption",
        rate_change=delta,
        start_year=2027,
        end_year=2027,
        baseline_rate=baseline_rate,
    )
    np.testing.assert_allclose(
        sim.calculate("vat", 2027) - before,
        expected,
        atol=0.001,
        rtol=0,
    )


def test_vat_spending_variable_must_exist_and_belong_to_household():
    sim = Simulation(situation=review_household())
    with pytest.raises(Exception, match="no_such_spending"):
        apply_vat_base_change(
            sim,
            spending_variable="no_such_spending",
            rate_change=-0.025,
            start_year=2027,
            end_year=2027,
        )
    with pytest.raises(ValueError, match="household entity"):
        apply_vat_base_change(
            sim,
            spending_variable="employment_income",
            rate_change=-0.025,
            start_year=2027,
            end_year=2027,
        )


def test_two_property_bands_compose_and_preserve_native_surcharge():
    from policyengine_uk.system import system

    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    situation = {"people": {}, "benunits": {}, "households": {}}
    for i, value in enumerate([1_200_000, 1_700_000, 2_500_000]):
        name = str(i)
        situation["people"][name] = {"age": {2028: 40}}
        situation["benunits"][name] = {"members": [name]}
        situation["households"][name] = {
            "members": [name],
            "region": {2028: "LONDON"},
            "tenure_type": {2028: "OWNED_OUTRIGHT"},
            "main_residence_value": {2028: value * gdp("2028") / gdp("2026")},
        }
    sim = Simulation(situation=situation)
    channel = "high_value_council_tax_surcharge"
    before = sim.calculate(channel, 2028).copy()
    for lower, upper, amount in [
        (1_000_000, 1_500_000, 900),
        (1_500_000, 2_000_000, 1200),
    ]:
        apply_property_band_surcharge(
            sim,
            lower_bound=lower,
            upper_bound=upper,
            amount=amount,
            start_year=2028,
            end_year=2028,
        )
        sim.calculate(channel, 2028)
    np.testing.assert_allclose(
        sim.calculate(channel, 2028) - before, [900, 1200, 0]
    )
    assert not sim.get_holder(channel).get_input_periods(sim.branch_name)
