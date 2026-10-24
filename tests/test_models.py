"""Tests for data models."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
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

        config = DataConfig(income_curve_points=101)
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


RATE = "gov.hmrc.income_tax.rates.uk[{}].rate"


def _modifier(sim):
    return sim


_baseline_sides = st.sampled_from([None, {}, {RATE.format(1): {"2027": 0.41}}])


@settings(max_examples=60, deadline=None)
@given(
    own_changes=_baseline_sides,
    own_modifier=st.booleans(),
    configured=_baseline_sides,
)
def test_a_single_measure_keeps_the_old_baseline_precedence(
    own_changes, own_modifier, configured
):
    """Property: for a single measure the one rule is the precedence every
    caller used before it: its own baseline, else the configured one, else
    current law."""
    from uk_budget_data.models import DataConfig, Reform

    reform = Reform(
        id="m",
        name="M",
        parameter_changes={RATE.format(0): {"2027": 0.21}},
        baseline_parameter_changes=own_changes,
        baseline_simulation_modifier=_modifier if own_modifier else None,
    )
    config = DataConfig(years=[2027], baseline_parameter_changes=configured)
    old = reform.to_baseline_scenario() or config.get_baseline_scenario()
    new = reform.baseline_scenario_for(config)
    assert (new is None) == (old is None)
    if new is not None:
        assert new.parameter_changes == old.parameter_changes
        assert new.simulation_modifier is old.simulation_modifier


@settings(max_examples=60, deadline=None)
@given(own_changes=_baseline_sides, configured=_baseline_sides)
def test_a_combined_measure_without_config_never_falls_back(
    own_changes, configured
):
    """Property: a run that does not use the configured baseline never gets
    it, whatever its own baseline is, even none at all."""
    from uk_budget_data.models import DataConfig, Reform

    reform = Reform(
        id="c",
        name="C",
        baseline_parameter_changes=own_changes,
    )
    config = DataConfig(years=[2027], baseline_parameter_changes=configured)
    scenario = reform.baseline_scenario_for(config, uses_config=False)
    if own_changes is None:
        assert scenario is None
    else:
        assert scenario.parameter_changes == own_changes
