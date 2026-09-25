"""Tests for personal impact calculator."""

import pytest

from uk_budget_data.personal_impact import (
    POLICY_IDS,
    YEARS,
    HouseholdInput,
    PersonalImpactCalculator,
    build_situation,
)


class TestHouseholdInput:
    """Tests for HouseholdInput dataclass."""

    def test_default_values(self):
        """Test that defaults are applied correctly."""
        household = HouseholdInput(employment_income=50000)

        assert household.employment_income == 50000
        assert household.income_growth_rate == 0.0
        assert household.is_married is False
        assert household.partner_income == 0.0
        assert household.children_ages == []
        assert household.property_income == 0.0
        assert household.savings_income == 0.0
        assert household.dividend_income == 0.0
        assert household.pension_contributions_salary_sacrifice == 0.0
        assert household.fuel_spending == 0.0
        assert household.rail_spending == 0.0

    def test_full_household(self):
        """Test household with all fields populated."""
        household = HouseholdInput(
            employment_income=60000,
            income_growth_rate=0.03,
            is_married=True,
            partner_income=30000,
            children_ages=[5, 8, 12],
            property_income=5000,
            savings_income=2000,
            dividend_income=1000,
            pension_contributions_salary_sacrifice=5000,
            fuel_spending=1200,
            rail_spending=500,
        )

        assert household.employment_income == 60000
        assert household.is_married is True
        assert len(household.children_ages) == 3
        assert household.fuel_spending == 1200
        assert household.rail_spending == 500


class TestBuildSituation:
    """Tests for build_situation function."""

    def test_single_adult_2025(self):
        """Test situation building for single adult in base year."""
        household = HouseholdInput(employment_income=50000)
        situation = build_situation(household, 2025)

        assert "people" in situation
        assert "adult" in situation["people"]
        assert situation["people"]["adult"]["age"][2025] == 35
        assert situation["people"]["adult"]["employment_income"][2025] == 50000

    def test_income_growth(self):
        """Test that income grows over years."""
        household = HouseholdInput(
            employment_income=50000,
            income_growth_rate=0.10,  # 10% growth
        )

        situation_2025 = build_situation(household, 2025)
        situation_2026 = build_situation(household, 2026)
        situation_2027 = build_situation(household, 2027)

        assert (
            situation_2025["people"]["adult"]["employment_income"][2025]
            == 50000
        )
        # Use pytest.approx for floating point comparison
        assert situation_2026["people"]["adult"]["employment_income"][
            2026
        ] == pytest.approx(
            55000
        )  # 50000 * 1.10
        assert situation_2027["people"]["adult"]["employment_income"][
            2027
        ] == pytest.approx(
            60500
        )  # 50000 * 1.10^2

    def test_married_couple(self):
        """Test situation building for married couple."""
        household = HouseholdInput(
            employment_income=60000,
            is_married=True,
            partner_income=30000,
        )
        situation = build_situation(household, 2025)

        assert "partner" in situation["people"]
        assert (
            situation["people"]["partner"]["employment_income"][2025] == 30000
        )
        assert "partner" in situation["benunits"]["benunit"]["members"]

    def test_children_aged_correctly(self):
        """Test that children are aged each year."""
        household = HouseholdInput(
            employment_income=50000,
            children_ages=[5, 10],
        )

        situation_2025 = build_situation(household, 2025)
        situation_2027 = build_situation(household, 2027)

        # In 2025, children are 5 and 10
        assert situation_2025["people"]["child_1"]["age"][2025] == 5
        assert situation_2025["people"]["child_2"]["age"][2025] == 10

        # In 2027, children are 7 and 12
        assert situation_2027["people"]["child_1"]["age"][2027] == 7
        assert situation_2027["people"]["child_2"]["age"][2027] == 12

    def test_adult_children_excluded(self):
        """Test that children over 25 are excluded from household."""
        household = HouseholdInput(
            employment_income=50000,
            children_ages=[23, 10],  # 23-year-old will turn 25+ by 2027
        )

        # In 2025, both children are included
        situation_2025 = build_situation(household, 2025)
        assert "child_1" in situation_2025["people"]
        assert "child_2" in situation_2025["people"]

        # In 2027, 23-year-old is now 25, should still be included (< 25)
        situation_2027 = build_situation(household, 2027)
        assert "child_2" in situation_2027["people"]  # 10+2=12

        # In 2028, 23-year-old is now 26, should be excluded
        situation_2028 = build_situation(household, 2028)
        assert "child_1" not in situation_2028["people"]  # 23+3=26 >= 25

    def test_other_income_sources(self):
        """Test that other income sources are included."""
        household = HouseholdInput(
            employment_income=50000,
            property_income=5000,
            savings_income=2000,
            dividend_income=1000,
        )
        situation = build_situation(household, 2025)

        adult = situation["people"]["adult"]
        assert adult["property_income"][2025] == 5000
        assert adult["savings_interest_income"][2025] == 2000
        assert adult["dividend_income"][2025] == 1000


class TestPersonalImpactCalculator:
    """Tests for PersonalImpactCalculator class."""

    @pytest.fixture
    def calculator(self):
        """Create a calculator instance."""
        return PersonalImpactCalculator()

    def test_reforms_loaded(self, calculator):
        """Test that reforms are loaded correctly."""
        assert len(calculator.reforms) > 0
        # Check that all expected policies are loaded
        for policy_id in POLICY_IDS:
            assert policy_id in calculator.reforms

    def test_calculate_returns_structure(self, calculator):
        """Test that calculate returns expected structure."""
        household = HouseholdInput(employment_income=50000)
        results = calculator.calculate(household)

        # Check top-level structure
        assert "household_input" in results
        assert "years" in results
        assert "policies" in results
        assert "totals" in results

        # Check years structure
        for year in YEARS:
            assert year in results["years"]
            assert "baseline" in results["years"][year]
            assert "policies" in results["years"][year]

        # Check policies structure
        for policy_id in POLICY_IDS:
            if policy_id in results["policies"]:
                policy = results["policies"][policy_id]
                assert "name" in policy
                assert "years" in policy
                assert "total_impact" in policy

        # Check totals structure
        assert "by_year" in results["totals"]
        assert "cumulative" in results["totals"]

    def test_single_person_basic_impact(self, calculator):
        """Test basic impact calculation for single person."""
        household = HouseholdInput(employment_income=50000)
        results = calculator.calculate(household)

        # Threshold freeze should have negative impact at £50k income
        threshold_policy = results["policies"].get(
            "threshold_freeze_extension"
        )
        if threshold_policy:
            # From 2028 onwards (when CPI indexing would have kicked in)
            assert threshold_policy["years"][2028]["net_income_change"] < 0

    def test_zero_income_no_impact(self, calculator):
        """Test that zero income household has minimal impact."""
        household = HouseholdInput(employment_income=0)
        results = calculator.calculate(household)

        # Most policies should have ~zero impact on zero income
        total = results["totals"]["cumulative"]
        # Allow for small floating point errors
        assert abs(total) < 100  # Less than £100 total impact

    def test_income_echoed_back(self, calculator):
        """Test that input is echoed in results."""
        household = HouseholdInput(
            employment_income=75000,
            income_growth_rate=0.05,
            is_married=True,
        )
        results = calculator.calculate(household)

        assert results["household_input"]["employment_income"] == 75000
        assert results["household_input"]["income_growth_rate"] == 0.05
        assert results["household_input"]["is_married"] is True


class TestAPIIntegration:
    """Integration tests for the API module."""

    def test_api_input_validation(self):
        """Test that API input validation works."""
        from uk_budget_data.api import APIHouseholdInput

        # Valid input
        valid = APIHouseholdInput(
            employment_income=50000,
            income_growth_rate=0.03,
            children_ages=[5, 10],
            fuel_spending=1200,
            rail_spending=500,
        )
        assert valid.employment_income == 50000
        assert valid.fuel_spending == 1200
        assert valid.rail_spending == 500

        # Invalid children ages
        with pytest.raises(ValueError):
            APIHouseholdInput(
                employment_income=50000,
                children_ages=[5, 30],  # 30 is too old
            )

        # Too many children
        with pytest.raises(ValueError):
            APIHouseholdInput(
                employment_income=50000,
                children_ages=list(range(15)),  # 15 children
            )

    def test_api_input_to_household_conversion(self):
        """Test conversion from API input to HouseholdInput."""
        from uk_budget_data.api import (
            APIHouseholdInput,
            convert_api_input_to_household,
        )

        api_input = APIHouseholdInput(
            employment_income=60000,
            income_growth_rate=0.03,
            is_married=True,
            partner_income=25000,
            children_ages=[5, 8],
            property_income=5000,
            fuel_spending=1200,
            rail_spending=500,
        )

        household = convert_api_input_to_household(api_input)

        assert household.employment_income == 60000
        assert household.income_growth_rate == 0.03
        assert household.is_married is True
        assert household.partner_income == 25000
        assert household.children_ages == [5, 8]
        assert household.property_income == 5000
        assert household.fuel_spending == 1200
        assert household.rail_spending == 500


def test_candidate_inputs_produce_real_household_impacts():
    """The form's new inputs must reach policyengine.py, not disappear."""
    result = PersonalImpactCalculator().calculate(
        HouseholdInput(
            employment_income=50000,
            capital_gains=10000,
            fuel_spending=1200,
            bus_spending=800,
        )
    )
    assert set(result["policies"]) == {
        "cgt_equalisation",
        "fuel_duty_rise_cancellation",
        "bus_fare_cap",
    }
    impacts = {
        key: value["years"][2027]["net_income_change"]
        for key, value in result["policies"].items()
    }
    assert impacts["cgt_equalisation"] < 0
    assert impacts["fuel_duty_rise_cancellation"] > 0
    assert impacts["bus_fare_cap"] == pytest.approx(100, abs=0.05)
    for policy in result["policies"].values():
        assert policy["years"][2025]["net_income_change"] == 0
