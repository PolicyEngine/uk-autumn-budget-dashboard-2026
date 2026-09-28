"""Tests for data models."""

import pytest
from pydantic import ValidationError


class TestReform:
    """Tests for Reform model."""

    def test_reform_requires_id(self):
        """Reform must have an id."""
        from uk_budget_data.models import Reform

        with pytest.raises(ValidationError):
            Reform(name="Test Reform")

    def test_reform_requires_name(self):
        """Reform must have a name."""
        from uk_budget_data.models import Reform

        with pytest.raises(ValidationError):
            Reform(id="test_reform")

    def test_reform_with_parameter_changes(self):
        """Reform can specify parameter changes."""
        from uk_budget_data.models import Reform

        reform = Reform(
            id="test_reform",
            name="Test Reform",
            parameter_changes={
                "gov.test.param": {"2026": 100, "2027": 200},
            },
        )

        assert reform.id == "test_reform"
        assert reform.name == "Test Reform"
        assert reform.parameter_changes is not None
        assert reform.simulation_modifier is None

    def test_reform_with_simulation_modifier(self):
        """Reform can specify a simulation modifier function."""
        from uk_budget_data.models import Reform

        def my_modifier(sim):
            return sim

        reform = Reform(
            id="test_reform",
            name="Test Reform",
            simulation_modifier=my_modifier,
        )

        assert reform.simulation_modifier is my_modifier
        assert reform.parameter_changes is None

    def test_reform_to_scenario_with_params(self):
        """Reform can be converted to a PolicyEngine Scenario."""
        from uk_budget_data.models import Reform

        reform = Reform(
            id="test_reform",
            name="Test Reform",
            parameter_changes={
                "gov.test.param": {"2026": 100},
            },
        )

        scenario = reform.to_scenario()
        assert scenario is not None

    def test_reform_to_scenario_with_modifier(self):
        """Reform with modifier can be converted to Scenario."""
        from uk_budget_data.models import Reform

        def my_modifier(sim):
            return sim

        reform = Reform(
            id="test_reform",
            name="Test Reform",
            simulation_modifier=my_modifier,
        )

        scenario = reform.to_scenario()
        assert scenario is not None

    def test_reform_with_custom_baseline(self):
        """Reform can specify a custom baseline scenario."""
        from uk_budget_data.models import Reform

        reform = Reform(
            id="fuel_duty",
            name="Fuel duty freeze",
            baseline_parameter_changes={
                "gov.hmrc.fuel_duty.petrol_and_diesel": {"2026": 0.58},
            },
            parameter_changes={
                "gov.hmrc.fuel_duty.petrol_and_diesel": {"2026": 0.54},
            },
        )

        assert reform.has_custom_baseline() is True
        baseline_scenario = reform.to_baseline_scenario()
        assert baseline_scenario is not None

    def test_reform_without_custom_baseline(self):
        """Reform without baseline_parameter_changes returns None."""
        from uk_budget_data.models import Reform

        reform = Reform(
            id="test_reform",
            name="Test Reform",
            parameter_changes={"gov.test.param": {"2026": 100}},
        )

        assert reform.has_custom_baseline() is False
        assert reform.to_baseline_scenario() is None


def test_dated_parameter_and_simulation_modifier_run_once_together():
    """Fuel schedules and VAT modifiers must compose for the specimen bundle."""
    from policyengine_uk import Simulation

    from uk_budget_data.models import Reform

    calls = []

    def modifier(simulation):
        calls.append(simulation)

    reform = Reform(
        id="combined_mock_test",
        name="Combined mock test",
        parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": {"2027-04-01": 0.5595},
            "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold": {
                "2027": 250
            },
        },
        simulation_modifier=modifier,
    )
    situation = {
        "people": {"adult": {"age": {2027: 35}}},
        "benunits": {"benunit": {"members": ["adult"]}},
        "households": {"household": {"members": ["adult"]}},
    }
    simulation = Simulation(situation=situation, scenario=reform.to_scenario())
    assert calls == [simulation]
    assert (
        simulation.tax_benefit_system.parameters.gov.hmrc.fuel_duty.petrol_and_diesel(
            "2027-04-01"
        )
        == 0.5595
    )
    assert (
        simulation.tax_benefit_system.parameters.gov.hmrc.national_insurance.class_1.thresholds.primary_threshold(
            "2027-04-06"
        )
        == 250
    )


class TestReformResult:
    """Tests for ReformResult model."""

    def test_reform_result_stores_all_metrics(self):
        """ReformResult stores all calculated metrics."""
        from uk_budget_data.models import ReformResult

        result = ReformResult(
            reform_id="test",
            reform_name="Test",
            budgetary_impact=[{"year": 2026, "value": 1.5}],
            distributional_impact=[{"decile": "1st", "value": 0.1}],
            winners_losers=[{"decile": "1", "avg_change": 100}],
            metrics=[{"people_affected": 50.0}],
            income_curve=[{"employment_income": 0, "baseline": 1000}],
            household_scatter=[{"baseline_income": 30000}],
            constituency=[{"code": "E14000530"}],
            demographic_constituency=[{"num_children": "0"}],
        )

        assert result.reform_id == "test"
        assert len(result.budgetary_impact) == 1
        assert len(result.distributional_impact) == 1

    def test_reform_result_allows_empty_lists(self):
        """ReformResult can have empty lists for optional data."""
        from uk_budget_data.models import ReformResult

        result = ReformResult(
            reform_id="test",
            reform_name="Test",
            budgetary_impact=[],
            distributional_impact=[],
            winners_losers=[],
            metrics=[],
            income_curve=[],
            household_scatter=[],
            constituency=[],
            demographic_constituency=[],
        )

        assert result.constituency == []


class TestDataConfig:
    """Tests for DataConfig model."""

    def test_default_years(self):
        """DataConfig has sensible default years."""
        from uk_budget_data.models import DataConfig

        config = DataConfig()
        assert 2026 in config.years
        assert 2029 in config.years

    def test_custom_output_dir(self):
        """DataConfig accepts custom output directory."""
        from pathlib import Path

        from uk_budget_data.models import DataConfig

        config = DataConfig(output_dir=Path("/tmp/output"))
        assert config.output_dir == Path("/tmp/output")

    def test_income_curve_settings(self):
        """DataConfig has income curve settings."""
        from uk_budget_data.models import DataConfig

        config = DataConfig(
            income_curve_max=200_000,
            income_curve_points=101,
        )
        assert config.income_curve_max == 200_000
        assert config.income_curve_points == 101

    def test_global_baseline_parameter_changes(self):
        """DataConfig can specify global baseline parameter changes."""
        from uk_budget_data.models import DataConfig

        config = DataConfig(
            baseline_parameter_changes={
                "gov.hmrc.income_tax.rates.uk[1].threshold": {"2026": 37700},
            }
        )
        baseline_scenario = config.get_baseline_scenario()
        assert baseline_scenario is not None

    def test_no_global_baseline_returns_none(self):
        """DataConfig without baseline returns None."""
        from uk_budget_data.models import DataConfig

        config = DataConfig()
        assert config.get_baseline_scenario() is None
