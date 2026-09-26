"""Tests for reform definitions."""

import os

import numpy as np
import pytest
from policyengine_uk.system import system

# Skip tests that require HuggingFace token (for microsimulation data)
requires_hf_token = pytest.mark.skipif(
    not os.environ.get("HUGGING_FACE_TOKEN"),
    reason="Requires HUGGING_FACE_TOKEN for microsimulation data",
)


class TestPreAutumnBudgetBaseline:
    """Tests for pre-Autumn Budget baseline calculation."""

    def test_income_tax_thresholds_use_cpi_uprating(self):
        """Pre-AB baseline thresholds should use CPI uprating from 2028."""
        from uk_budget_data.reforms import get_pre_autumn_budget_baseline

        PRE_AUTUMN_BUDGET_BASELINE = get_pre_autumn_budget_baseline()

        cpi_index = system.parameters.gov.economic_assumptions.indices.obr.cpih

        # Personal allowance was £12,570 in April 2027 (end of previous freeze)
        # Should be uprated by CPI from April 2028 onwards
        pa_2027 = 12570
        cpi_2027 = cpi_index("2027-04-01")
        cpi_2028 = cpi_index("2028-04-01")
        cpi_2029 = cpi_index("2029-04-01")

        expected_pa_2028 = round(pa_2027 * cpi_2028 / cpi_2027)
        expected_pa_2029 = round(pa_2027 * cpi_2029 / cpi_2027)

        pa_key = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
        assert PRE_AUTUMN_BUDGET_BASELINE[pa_key]["2028"] == expected_pa_2028
        assert PRE_AUTUMN_BUDGET_BASELINE[pa_key]["2029"] == expected_pa_2029

        # Basic rate threshold was £37,700 in April 2027
        threshold_2027 = 37700
        expected_threshold_2028 = round(threshold_2027 * cpi_2028 / cpi_2027)
        expected_threshold_2029 = round(threshold_2027 * cpi_2029 / cpi_2027)

        threshold_key = "gov.hmrc.income_tax.rates.uk[1].threshold"
        assert (
            PRE_AUTUMN_BUDGET_BASELINE[threshold_key]["2028"]
            == expected_threshold_2028
        )
        assert (
            PRE_AUTUMN_BUDGET_BASELINE[threshold_key]["2029"]
            == expected_threshold_2029
        )

    def test_fuel_duty_uses_rpi_uprating(self):
        """Pre-AB baseline fuel duty should use RPI uprating after Mar 2026."""
        from uk_budget_data.reforms import get_pre_autumn_budget_baseline

        PRE_AUTUMN_BUDGET_BASELINE = get_pre_autumn_budget_baseline()

        rpi_index = system.parameters.gov.economic_assumptions.indices.obr.rpi

        # Per Spring Budget 2025, 5p cut would end March 2026 -> 57.95p
        # Then RPI uprating from April 2027
        base_rate = 0.5795  # Rate after 5p cut ends
        rpi_2026 = rpi_index("2026-04-01")
        rpi_2027 = rpi_index("2027-04-01")
        rpi_2028 = rpi_index("2028-04-01")
        rpi_2029 = rpi_index("2029-04-01")

        expected_2027 = round(base_rate * rpi_2027 / rpi_2026, 4)
        expected_2028 = round(base_rate * rpi_2028 / rpi_2026, 4)
        expected_2029 = round(base_rate * rpi_2029 / rpi_2026, 4)

        fuel_key = "gov.hmrc.fuel_duty.petrol_and_diesel"
        # March 2026: 5p cut ends
        assert PRE_AUTUMN_BUDGET_BASELINE[fuel_key]["2026-03-22"] == 0.5795
        # April 2027+: RPI uprating
        assert (
            PRE_AUTUMN_BUDGET_BASELINE[fuel_key]["2027-04-01"] == expected_2027
        )
        assert (
            PRE_AUTUMN_BUDGET_BASELINE[fuel_key]["2028-04-01"] == expected_2028
        )
        assert (
            PRE_AUTUMN_BUDGET_BASELINE[fuel_key]["2029-04-01"] == expected_2029
        )


class TestReformDefinitions:
    """Tests for the predefined reforms."""

    def test_autumn_budget_reforms_exist(self):
        """Autumn Budget 2025 reforms are defined."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        reforms = get_autumn_budget_2026_reforms()
        assert len(reforms) > 0

    def test_all_reforms_have_required_fields(self):
        """All reforms have id and name."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        for reform in get_autumn_budget_2026_reforms():
            assert reform.id, f"Reform missing id: {reform}"
            assert reform.name, f"Reform missing name: {reform}"

    def test_all_reforms_convertible_to_scenario(self):
        """All reforms can be converted to PolicyEngine Scenario."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        for reform in get_autumn_budget_2026_reforms():
            scenario = reform.to_scenario()
            assert (
                scenario is not None
            ), f"Reform {reform.id} failed to_scenario"


class TestTwoChildLimitRepeal:
    """Tests for two-child limit repeal reform."""

    def test_reform_exists(self):
        """Two child limit reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("two_child_limit")
        assert reform is not None
        assert reform.id == "two_child_limit"

    def test_reform_removes_child_limit(self):
        """Reform uses baseline with limit of 2, reform with infinity.

        Since annual calculations use Jan 1 reference dates, we explicitly
        set both baseline (limit=2) and reform (limit=infinity) parameters
        to capture the impact.
        """

        from uk_budget_data.reforms import get_reform

        reform = get_reform("two_child_limit")
        assert reform.baseline_parameter_changes is not None
        assert reform.parameter_changes is not None

        # Check that both UC and tax credits limits are set to 2 in baseline
        tc_key = "gov.dwp.tax_credits.child_tax_credit.limit.child_count"
        uc_key = "gov.dwp.universal_credit.elements.child.limit.child_count"

        assert tc_key in reform.baseline_parameter_changes
        assert uc_key in reform.baseline_parameter_changes

        # Baseline values should be 2 (pre-budget)
        for year_val in reform.baseline_parameter_changes[tc_key].values():
            assert year_val == 2
        for year_val in reform.baseline_parameter_changes[uc_key].values():
            assert year_val == 2

        # Reform uses current law (policyengine-uk v2.65.0+ has repeal baked in)
        # With fiscal year conversion, annual queries return April 30 value (inf)
        assert reform.parameter_changes == {}


class TestFuelDutyFreeze:
    """Tests for fuel duty freeze reform."""

    def test_reform_exists(self):
        """Fuel duty freeze reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("fuel_duty_freeze")
        assert reform is not None

    def test_reform_maintains_reduced_rate(self):
        """Reform uses custom baseline and current law for reform."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("fuel_duty_freeze")

        # Reform uses custom baseline (pre-Autumn Budget values)
        assert reform.has_custom_baseline()
        assert reform.baseline_parameter_changes is not None

        param_key = "gov.hmrc.fuel_duty.petrol_and_diesel"
        assert param_key in reform.baseline_parameter_changes

        # Baseline has pre-AB values (5p cut ending March 2026, then RPI)
        # Hardcoded because policyengine-uk 2.60.0+ has post-budget values
        assert reform.baseline_parameter_changes[param_key]["2026"] == 0.58
        assert reform.baseline_parameter_changes[param_key]["2027"] == 0.61
        assert reform.baseline_parameter_changes[param_key]["2029"] == 0.64

        # Reform uses current law (policyengine-uk 2.60.0+ has correct rates)
        assert reform.parameter_changes == {}


class TestThresholdFreeze:
    """Tests for threshold freeze extension reform."""

    def test_reform_exists(self):
        """Threshold freeze reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("threshold_freeze_extension")
        assert reform is not None

    def test_reform_uses_pre_ab_baseline(self):
        """Reform compares frozen thresholds against pre-AB baseline (CPI-indexed).

        policyengine-uk 2.60.0+ has frozen thresholds (Autumn Budget policy).
        This reform sets CPI-indexed values as baseline to show impact.
        - Baseline: CPI-indexed from 2028 (pre-budget)
        - Reform: Frozen at £12,570 PA and £37,700 threshold (policyengine-uk default)
        """
        from uk_budget_data.reforms import (
            get_pre_autumn_budget_baseline,
            get_reform,
        )

        reform = get_reform("threshold_freeze_extension")
        pre_ab_baseline = get_pre_autumn_budget_baseline()

        pa_key = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
        threshold_key = "gov.hmrc.income_tax.rates.uk[1].threshold"

        # Baseline has CPI-indexed values (pre-Autumn Budget)
        assert pa_key in reform.baseline_parameter_changes
        assert threshold_key in reform.baseline_parameter_changes

        assert (
            reform.baseline_parameter_changes[pa_key]["2028"]
            == pre_ab_baseline[pa_key]["2028"]
        )
        assert (
            reform.baseline_parameter_changes[threshold_key]["2028"]
            == pre_ab_baseline[threshold_key]["2028"]
        )

        # Reform parameter_changes is empty (uses policyengine-uk frozen values)
        assert reform.parameter_changes == {}


class TestDividendTaxIncrease:
    """Tests for dividend tax increase reform."""

    def test_reform_exists(self):
        """Dividend tax increase reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("dividend_tax_increase_2pp")
        assert reform is not None
        assert reform.id == "dividend_tax_increase_2pp"

    def test_reform_uses_custom_baseline(self):
        """Reform uses pre-budget baseline rates via simulation modifier."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("dividend_tax_increase_2pp")

        # Reform uses custom baseline (simulation_modifier for ParameterScale)
        assert reform.has_custom_baseline()
        assert reform.baseline_simulation_modifier is not None

        # Reform parameter_changes is empty (uses new rates from policyengine-uk)
        assert reform.parameter_changes == {}

    @requires_hf_token
    def test_baseline_modifier_sets_pre_budget_rates(self):
        """Baseline simulation modifier correctly sets pre-budget rates."""
        from uk_budget_data.pipeline import build_microsimulation
        from uk_budget_data.reforms import get_reform

        reform = get_reform("dividend_tax_increase_2pp")

        # Build through policyengine.py so the dataset comes from the pinned
        # release bundle; policyengine-uk no longer has an implicit default.
        sim = build_microsimulation(None)
        reform.baseline_simulation_modifier(sim)

        div = sim.tax_benefit_system.parameters.gov.hmrc.income_tax.rates
        div = div.dividends

        # Check pre-budget rates are set for 2027 (8.75% basic, 33.75% higher)
        # The modifier replaces the 2026-04-06 entry so rates persist
        assert div.brackets[0].rate("2027-04-06") == 0.0875
        assert div.brackets[1].rate("2027-04-06") == 0.3375


class TestSavingsTaxIncrease:
    """Tests for savings income tax increase reform."""

    def test_reform_exists(self):
        """Savings tax increase reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("savings_tax_increase_2pp")
        assert reform is not None
        assert reform.id == "savings_tax_increase_2pp"

    def test_reform_uses_custom_baseline(self):
        """Reform uses pre-budget baseline rates."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("savings_tax_increase_2pp")

        # Reform uses custom baseline (pre-budget rates)
        assert reform.has_custom_baseline()
        assert reform.baseline_parameter_changes is not None

        # Check baseline has pre-budget savings rates
        basic_key = "gov.hmrc.income_tax.rates.savings.basic"
        higher_key = "gov.hmrc.income_tax.rates.savings.higher"
        additional_key = "gov.hmrc.income_tax.rates.savings.additional"

        assert basic_key in reform.baseline_parameter_changes
        assert higher_key in reform.baseline_parameter_changes
        assert additional_key in reform.baseline_parameter_changes

        # Pre-budget rates: 20% basic, 40% higher, 45% additional
        # Starts from 2028 to match OBR fiscal year timing (policy starts April 2027)
        assert reform.baseline_parameter_changes[basic_key]["2028"] == 0.20
        assert reform.baseline_parameter_changes[higher_key]["2028"] == 0.40
        assert (
            reform.baseline_parameter_changes[additional_key]["2028"] == 0.45
        )

        # Reform parameter_changes is empty (uses new rates from policyengine-uk)
        assert reform.parameter_changes == {}


class TestPropertyTaxIncrease:
    """Tests for property income tax increase reform."""

    def test_reform_exists(self):
        """Property tax increase reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("property_tax_increase_2pp")
        assert reform is not None
        assert reform.id == "property_tax_increase_2pp"

    def test_reform_uses_custom_baseline(self):
        """Reform uses pre-budget baseline rates."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("property_tax_increase_2pp")

        # Reform uses custom baseline (pre-budget rates)
        assert reform.has_custom_baseline()
        assert reform.baseline_parameter_changes is not None

        # Check baseline has pre-budget property rates
        basic_key = "gov.hmrc.income_tax.rates.property.basic"
        higher_key = "gov.hmrc.income_tax.rates.property.higher"
        additional_key = "gov.hmrc.income_tax.rates.property.additional"

        assert basic_key in reform.baseline_parameter_changes
        assert higher_key in reform.baseline_parameter_changes
        assert additional_key in reform.baseline_parameter_changes

        # Pre-budget rates: 20% basic, 40% higher, 45% additional
        # Starts from 2028 to match OBR fiscal year timing (policy starts April 2027)
        assert reform.baseline_parameter_changes[basic_key]["2028"] == 0.20
        assert reform.baseline_parameter_changes[higher_key]["2028"] == 0.40
        assert (
            reform.baseline_parameter_changes[additional_key]["2028"] == 0.45
        )

        # Reform parameter_changes is empty (uses new rates from policyengine-uk)
        assert reform.parameter_changes == {}


class TestRailFaresFreeze:
    """Tests for rail fares freeze reform."""

    def test_reform_exists(self):
        """Rail fares freeze reform is defined."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("rail_fares_freeze")
        assert reform is not None
        assert reform.id == "rail_fares_freeze"

    def test_reform_uses_simulation_modifier(self):
        """Reform uses simulation modifier for structural change."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("rail_fares_freeze")
        assert reform.simulation_modifier is not None

    def test_rail_fare_increase_rates_defined(self):
        """Rail fare increase rates are defined for all budget years."""
        from uk_budget_data.reforms import RAIL_FARE_INCREASES

        expected_years = [2026, 2027, 2028, 2029, 2030]
        for year in expected_years:
            assert year in RAIL_FARE_INCREASES, f"Missing rate for {year}"
            assert (
                RAIL_FARE_INCREASES[year] > 0
            ), f"Rate for {year} should be positive"
            assert (
                RAIL_FARE_INCREASES[year] < 0.10
            ), f"Rate for {year} seems too high"

        # 2026 rate should be 5.8% (the rate that was frozen)
        assert RAIL_FARE_INCREASES[2026] == 0.058

    def test_rail_freeze_costs_defined(self):
        """Rail freeze costs match Treasury estimates."""
        from uk_budget_data.reforms import RAIL_FREEZE_COSTS

        expected_years = [2026, 2027, 2028, 2029, 2030]
        for year in expected_years:
            assert year in RAIL_FREEZE_COSTS, f"Missing cost for {year}"
            assert (
                RAIL_FREEZE_COSTS[year] > 0
            ), f"Cost for {year} should be positive"

        # 2026 cost should be £0.145bn (Treasury estimate)
        assert RAIL_FREEZE_COSTS[2026] == 0.145


class TestStructuralReforms:
    """Tests for structural reforms using simulation modifiers."""

    def test_salary_sacrifice_cap_factory(self):
        """Salary sacrifice cap reform factory works.

        Reads cap and haircut values from policyengine-uk. Baseline has no cap
        (infinity), reform uses pe-uk current law (£2,000 cap from April 2029).
        """
        import math

        from uk_budget_data.reforms import create_salary_sacrifice_cap_reform

        reform = create_salary_sacrifice_cap_reform()
        assert reform is not None
        assert reform.id == "salary_sacrifice_cap"
        # Uses baseline_parameter_changes only; reform uses policyengine-uk default
        assert reform.baseline_parameter_changes is not None

        cap_key = "gov.hmrc.national_insurance.salary_sacrifice_pension_cap"
        # Baseline has infinity (no cap)
        assert math.isinf(reform.baseline_parameter_changes[cap_key]["2029"])
        assert math.isinf(reform.baseline_parameter_changes[cap_key]["2030"])
        # Reform uses current law (pe-uk with cap baked in)
        assert reform.parameter_changes == {}


class TestGetReform:
    """Tests for get_reform helper function."""

    def test_get_existing_reform(self):
        """Can retrieve existing reform by id."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("two_child_limit")
        assert reform is not None
        assert reform.id == "two_child_limit"

    def test_get_nonexistent_reform_returns_none(self):
        """Returns None for unknown reform id."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("nonexistent_reform_xyz")
        assert reform is None


class TestForecastYearRange:
    """Tests for 2026-2030 forecast year range (5 years to 2030-31)."""

    def test_default_years_includes_2030(self):
        """DEFAULT_YEARS should include 2030 for 2030-31 fiscal year."""
        from uk_budget_data.reforms import DEFAULT_YEARS

        assert 2030 in DEFAULT_YEARS
        assert DEFAULT_YEARS == [2026, 2027, 2028, 2029, 2030]

    def test_pre_autumn_budget_baseline_includes_2030(self):
        """Pre-AB baseline should have values for 2030."""
        from uk_budget_data.reforms import get_pre_autumn_budget_baseline

        baseline = get_pre_autumn_budget_baseline()

        # Income tax thresholds should have 2030 value
        pa_key = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
        assert "2030" in baseline[pa_key]

        threshold_key = "gov.hmrc.income_tax.rates.uk[1].threshold"
        assert "2030" in baseline[threshold_key]

        # Fuel duty should have 2030 value
        fuel_key = "gov.hmrc.fuel_duty.petrol_and_diesel"
        assert "2030-04-01" in baseline[fuel_key]

    def test_fuel_duty_freeze_baseline_includes_2030(self):
        """Fuel duty freeze baseline should have 2030 rate."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("fuel_duty_freeze")
        baseline = reform.baseline_parameter_changes

        fuel_key = "gov.hmrc.fuel_duty.petrol_and_diesel"
        assert "2030" in baseline[fuel_key]
        # 2030 should be higher than 2029 (continued RPI uprating)
        assert baseline[fuel_key]["2030"] > baseline[fuel_key]["2029"]

    def test_savings_tax_baseline_includes_2030(self):
        """Savings tax baseline should have 2030 rates."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("savings_tax_increase_2pp")
        baseline = reform.baseline_parameter_changes

        basic_key = "gov.hmrc.income_tax.rates.savings.basic"
        assert "2030" in baseline[basic_key]
        assert baseline[basic_key]["2030"] == 0.20  # Pre-budget rate

    def test_property_tax_baseline_includes_2030(self):
        """Property tax baseline should have 2030 rates."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("property_tax_increase_2pp")
        baseline = reform.baseline_parameter_changes

        basic_key = "gov.hmrc.income_tax.rates.property.basic"
        assert "2030" in baseline[basic_key]
        assert baseline[basic_key]["2030"] == 0.20  # Pre-budget rate

    def test_rail_fare_costs_includes_2030(self):
        """Rail fare freeze costs should include 2030."""
        from uk_budget_data.reforms import (
            RAIL_FARE_INCREASES,
            RAIL_FREEZE_COSTS,
        )

        assert 2030 in RAIL_FARE_INCREASES
        assert 2030 in RAIL_FREEZE_COSTS
        assert RAIL_FREEZE_COSTS[2030] > 0

    def test_student_loan_baseline_includes_2030(self):
        """Student loan threshold baseline should include 2030."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("freeze_student_loan_thresholds")
        baseline = reform.baseline_parameter_changes

        slr_key = "gov.hmrc.student_loans.thresholds.plan_2"
        assert "2030" in baseline[slr_key]

    def test_two_child_limit_applies_to_2030(self):
        """Two child limit reform baseline should apply to 2030.

        Since annual calculations use Jan 1 reference dates, we use year keys
        like "2026" instead of dated entries like "2026-04-06".
        """
        from uk_budget_data.reforms import get_reform

        reform = get_reform("two_child_limit")

        tc_key = "gov.dwp.tax_credits.child_tax_credit.limit.child_count"
        uc_key = "gov.dwp.universal_credit.elements.child.limit.child_count"

        # Should have all years 2026-2030 in baseline with limit=2
        assert "2030" in reform.baseline_parameter_changes[tc_key]
        assert "2030" in reform.baseline_parameter_changes[uc_key]
        assert "2026" in reform.baseline_parameter_changes[tc_key]
        assert reform.baseline_parameter_changes[tc_key]["2030"] == 2
        assert reform.baseline_parameter_changes[uc_key]["2030"] == 2


class TestAutumnBudget2026Reforms:
    """Tests for the Autumn Budget 2026 candidate measures."""

    def test_all_seven_measures_on_dashboard_list(self):
        """The dashboard offers three candidates and four carried-over measures."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        ids = {r.id for r in get_autumn_budget_2026_reforms()}
        assert {
            "cgt_equalisation",
            "fuel_duty_rise_cancellation",
            "bus_fare_cap",
            "threshold_freeze_extension",
            "dividend_tax_increase_2pp",
            "savings_tax_increase_2pp",
            "property_tax_increase_2pp",
        } == ids

    def test_enacted_2025_measures_still_resolve_by_id(self):
        """Shared URLs from the 2025 dashboard keep working."""
        from uk_budget_data.reforms import get_reform

        for old_id in [
            "two_child_limit",
            "rail_fares_freeze",
            "salary_sacrifice_cap",
            "fuel_duty_freeze",
            "freeze_student_loan_thresholds",
        ]:
            assert get_reform(old_id) is not None, old_id

    def test_cgt_equalisation_sets_income_tax_rates(self):
        """CGT rates become the income tax rates, elasticity is CenTax's."""
        from uk_budget_data.reforms import get_reform

        changes = get_reform("cgt_equalisation").parameter_changes
        assert set(changes["gov.hmrc.cgt.basic_rate"].values()) == {0.20}
        assert set(changes["gov.hmrc.cgt.higher_rate"].values()) == {0.40}
        assert set(changes["gov.hmrc.cgt.additional_rate"].values()) == {0.45}
        elasticity = changes[
            "gov.simulation.capital_gains_responses.elasticity"
        ]
        assert set(elasticity.values()) == {1.0}

    def test_cgt_equalisation_avoids_unavailable_parameters(self):
        """Schedules and mtr_elasticity need policyengine-uk 2.99.0.

        policyengine.py 6.x pins 2.90.2, where those parameters do not exist;
        naming them would raise rather than be inert.
        """
        from uk_budget_data.reforms import get_reform

        changes = get_reform("cgt_equalisation").parameter_changes
        for absent in [
            "residential_property",
            "carried_interest",
            "badr",
            "mtr_elasticity",
        ]:
            assert not any(absent in key for key in changes), absent

    def test_fuel_duty_rise_cancellation_uses_hmrc_schedule(self):
        """Both scenarios override every month, including the stale April 2027 interval."""
        from uk_budget_data.reforms import get_reform

        changes = get_reform("fuel_duty_rise_cancellation").parameter_changes
        rates = changes["gov.hmrc.fuel_duty.petrol_and_diesel"]
        assert len(rates) == 60
        assert set(rates.values()) == {0.5295}
        baseline = get_reform(
            "fuel_duty_rise_cancellation"
        ).baseline_parameter_changes["gov.hmrc.fuel_duty.petrol_and_diesel"]
        assert baseline["2026-01-01"] == 0.5295
        assert baseline["2027-01-01"] == 0.5595
        assert baseline["2027-02-01"] == 0.5595
        assert baseline["2027-03-01"] == 0.5795
        assert baseline["2027-04-01"] == 0.5795
        assert baseline["2027-12-01"] == 0.5795
        assert baseline["2028-01-01"] == 0.5795

    def test_source_income_tax_baselines_start_in_first_effective_year(self):
        """Annual tax outputs sample the tax year beginning in the model year."""
        from uk_budget_data.reforms import get_reform

        for policy_id, path in (
            ("savings_tax_increase_2pp", "savings"),
            ("property_tax_increase_2pp", "property"),
        ):
            changes = get_reform(policy_id).baseline_parameter_changes
            assert (
                changes[f"gov.hmrc.income_tax.rates.{path}.basic"]["2027"]
                == 0.20
            )
        assert (
            get_reform(
                "dividend_tax_increase_2pp"
            ).baseline_simulation_modifier
            is not None
        )

    @pytest.mark.parametrize(
        "policy_id, year, income_variable",
        [
            ("dividend_tax_increase_2pp", 2026, "dividend_income"),
            ("savings_tax_increase_2pp", 2027, "savings_interest_income"),
            ("property_tax_increase_2pp", 2027, "property_income"),
        ],
    )
    def test_source_income_tax_population_scenario_has_first_year_effect(
        self, policy_id, year, income_variable
    ):
        """The pipeline scenario must apply a tax change in its first model year."""
        from policyengine_uk import Simulation

        from uk_budget_data.reforms import get_reform

        situation = {
            "people": {
                "adult": {
                    "age": {year: 35},
                    "employment_income": {year: 60_000},
                    income_variable: {year: 10_000},
                }
            },
            "benunits": {"benunit": {"members": ["adult"]}},
            "households": {"household": {"members": ["adult"]}},
        }
        reform = get_reform(policy_id)
        baseline = Simulation(
            situation=situation, scenario=reform.to_baseline_scenario()
        )
        changed = Simulation(
            situation=situation, scenario=reform.to_scenario()
        )
        assert (
            changed.calculate("household_net_income", year)[0]
            - baseline.calculate("household_net_income", year)[0]
            < 0
        )

    def test_bus_fare_cap_uses_a_simulation_modifier(self):
        """The cap is a spend reduction, not a parameter change."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("bus_fare_cap")
        assert reform.simulation_modifier is not None
        assert not reform.parameter_changes

    def test_bus_fare_cap_starts_in_2027_outside_london(self):
        """Only English households outside London receive the 2027 proxy."""
        from uk_budget_data.reforms import _bus_fare_cap_modifier

        class FareSimulation:
            def __init__(self):
                self.inputs = {}

            def calculate(self, variable, period):
                if variable == "region":
                    return np.array(["NORTH_EAST", "LONDON", "WALES"])
                if variable == "bus_fare_spending":
                    return np.array([800.0, 800.0, 800.0])
                return np.zeros(3)

            def set_input(self, variable, period, values):
                self.inputs[(variable, period)] = values

        sim = FareSimulation()
        _bus_fare_cap_modifier(sim)
        assert not any(year == 2026 for _, year in sim.inputs)
        np.testing.assert_allclose(
            sim.inputs[("bus_fare_spending", 2027)], [700, 800, 800]
        )
        np.testing.assert_allclose(
            sim.inputs[("bus_subsidy_spending", 2027)], [100, 0, 0]
        )

    def test_personal_impact_ids_are_all_on_the_dashboard(self):
        """POLICY_IDS must stay a subset of the dashboard reform list.

        The calculator filters the reform list by these ids, so an id that
        drifts out of that list disappears from the calculator silently.
        """
        from uk_budget_data.personal_impact import POLICY_IDS
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        available = {r.id for r in get_autumn_budget_2026_reforms()}
        assert set(POLICY_IDS) <= available, set(POLICY_IDS) - available
