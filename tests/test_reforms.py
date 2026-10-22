"""Tests for reform definitions."""

import pytest
from policyengine_uk.system import system

from uk_budget_data.budget_years import POLICY_YEARS


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

    @pytest.mark.certified_data
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

        for year in POLICY_YEARS:
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

        for year in POLICY_YEARS:
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
        assert math.isinf(reform.baseline_parameter_changes[cap_key]["2031"])
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


class TestPolicyYearRange:
    """Every measure states its pre-Budget values through the last policy
    year in budget_years.json (2031, fiscal year 2031-32)."""

    LAST = str(max(POLICY_YEARS))

    def test_default_years_are_the_policy_years(self):
        from uk_budget_data.reforms import DEFAULT_YEARS

        assert DEFAULT_YEARS == POLICY_YEARS
        assert 2031 in DEFAULT_YEARS

    def test_pre_autumn_budget_baseline_reaches_the_last_policy_year(self):
        from uk_budget_data.reforms import get_pre_autumn_budget_baseline

        baseline = get_pre_autumn_budget_baseline()
        pa_key = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
        threshold_key = "gov.hmrc.income_tax.rates.uk[1].threshold"
        fuel_key = "gov.hmrc.fuel_duty.petrol_and_diesel"
        assert self.LAST in baseline[pa_key]
        assert self.LAST in baseline[threshold_key]
        assert f"{self.LAST}-04-01" in baseline[fuel_key]
        # Thresholds keep rising with CPI after the freeze would have ended
        assert baseline[pa_key][self.LAST] > baseline[pa_key]["2030"]

    def test_fuel_duty_freeze_baseline_keeps_rising(self):
        from uk_budget_data.reforms import get_reform

        baseline = get_reform("fuel_duty_freeze").baseline_parameter_changes
        rates = baseline["gov.hmrc.fuel_duty.petrol_and_diesel"]
        assert rates[self.LAST] > rates["2030"] > rates["2029"]

    @pytest.mark.parametrize(
        "reform_id, key",
        [
            (
                "savings_tax_increase_2pp",
                "gov.hmrc.income_tax.rates.savings.basic",
            ),
            (
                "property_tax_increase_2pp",
                "gov.hmrc.income_tax.rates.property.basic",
            ),
        ],
    )
    def test_pre_budget_rates_hold_in_the_last_policy_year(
        self, reform_id, key
    ):
        from uk_budget_data.reforms import get_reform

        baseline = get_reform(reform_id).baseline_parameter_changes
        assert baseline[key][self.LAST] == 0.20  # Pre-budget rate

    def test_rail_tables_cover_every_policy_year(self):
        from uk_budget_data.reforms import (
            RAIL_FARE_INCREASES,
            RAIL_FREEZE_COSTS,
        )

        assert set(POLICY_YEARS) <= set(RAIL_FARE_INCREASES)
        assert set(POLICY_YEARS) <= set(RAIL_FREEZE_COSTS)
        assert all(RAIL_FREEZE_COSTS[year] > 0 for year in POLICY_YEARS)

    def test_student_loan_baseline_reaches_the_last_policy_year(self):
        from uk_budget_data.reforms import get_reform

        reform = get_reform("freeze_student_loan_thresholds")
        thresholds = reform.baseline_parameter_changes[
            "gov.hmrc.student_loans.thresholds.plan_2"
        ]
        assert thresholds[self.LAST] > thresholds["2030"]

    def test_two_child_limit_applies_in_every_policy_year(self):
        """Annual calculations read bare year keys ("2026"), not dated
        entries like "2026-04-06"."""
        from uk_budget_data.reforms import get_reform

        reform = get_reform("two_child_limit")
        for key in (
            "gov.dwp.tax_credits.child_tax_credit.limit.child_count",
            "gov.dwp.universal_credit.elements.child.limit.child_count",
        ):
            assert reform.baseline_parameter_changes[key] == {
                str(year): 2 for year in POLICY_YEARS
            }

    def test_every_year_table_that_reaches_2030_reaches_the_last_policy_year(
        self,
    ):
        """A measure that states pre-Budget values to 2030-31 states them
        for 2031-32 too, on both sides, the combined measure included."""
        from uk_budget_data.reforms import get_autumn_budget_2026_reforms

        stopping = []
        for reform in get_autumn_budget_2026_reforms():
            for side in ("baseline_parameter_changes", "parameter_changes"):
                for path, values in (getattr(reform, side) or {}).items():
                    if isinstance(values, dict) and "2030" in values:
                        if self.LAST not in values:
                            stopping.append(f"{reform.id} {side} {path}")
        assert stopping == []
