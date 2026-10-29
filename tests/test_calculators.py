"""Tests for metric calculators.

These tests verify the calculator functions work correctly with mock data.
Full integration tests require PolicyEngine UK and microdata.
"""

import numpy as np
import pandas as pd
import pytest


class TestBudgetaryImpactCalculator:
    """Tests for budgetary impact calculation."""

    def test_calculator_returns_list_of_dicts(self):
        """Calculator returns list of dicts with expected keys."""
        from uk_budget_data.calculators import BudgetaryImpactCalculator

        calc = BudgetaryImpactCalculator(years=[2026, 2027])

        # Create mock data
        mock_result = calc.calculate_from_values(
            reform_id="test",
            reform_name="Test Reform",
            baseline_balances={2026: 100e9, 2027: 105e9},
            reformed_balances={2026: 98e9, 2027: 102e9},
        )

        assert isinstance(mock_result, list)
        assert len(mock_result) == 2

        for item in mock_result:
            assert "reform_id" in item
            assert "reform_name" in item
            assert "year" in item
            assert "value" in item

    def test_calculator_computes_difference_in_billions(self):
        """Calculator reports impact in billions."""
        from uk_budget_data.calculators import BudgetaryImpactCalculator

        calc = BudgetaryImpactCalculator(years=[2026])

        result = calc.calculate_from_values(
            reform_id="test",
            reform_name="Test",
            baseline_balances={2026: 100e9},
            reformed_balances={2026: 98e9},
        )

        # Reformed - baseline = 98 - 100 = -2 billion
        assert result[0]["value"] == pytest.approx(-2.0)


class _Sim:
    """A stand-in simulation: each variable's values by year."""

    def __init__(self, values):
        self.values = values

    def calculate(self, name, period):
        return np.asarray(self.values[name][period], dtype=float)


class TestOfficialBasisCalculator:
    """The change in just the taxes and benefits an official costing covers
    (#297), with the Exchequer's sign."""

    def test_signs_follow_gov_tax_and_gov_spending(self):
        from uk_budget_data.calculators import exchequer_signs

        assert exchequer_signs(
            ["income_tax", "carers_allowance", "universal_credit"]
        ) == {"income_tax": 1, "carers_allowance": -1, "universal_credit": -1}
        with pytest.raises(ValueError, match="in neither"):
            exchequer_signs(["household_net_income"])

    def test_sums_each_change_with_its_sign_in_billions(self):
        from uk_budget_data.calculators import OfficialBasisCalculator

        baseline = _Sim(
            {
                "carers_allowance": {2030: [1e9, 2e9]},
                "universal_credit": {2030: [5e9]},
            }
        )
        reformed = _Sim(
            {
                "carers_allowance": {2030: [1.5e9, 2.5e9]},
                "universal_credit": {2030: [4.5e9]},
            }
        )
        (row,) = OfficialBasisCalculator(years=[2030]).calculate(
            baseline,
            reformed,
            "m",
            "M",
            ("carers_allowance", "universal_credit"),
        )
        # £1bn more Carer's Allowance, £0.5bn less Universal Credit: a cost
        # of £0.5bn to the Exchequer
        assert row == {
            "reform_id": "m",
            "reform_name": "M",
            "year": 2030,
            "value": pytest.approx(-0.5),
        }

    def test_more_universal_credit_is_a_cost(self):
        """Spending's sign end to end, through policyengine-uk's own
        lists: Universal Credit rising is a negative figure, a cost to the
        Exchequer."""
        from uk_budget_data.calculators import OfficialBasisCalculator

        (row,) = OfficialBasisCalculator(years=[2030]).calculate(
            _Sim({"universal_credit": {2030: [5e9]}}),
            _Sim({"universal_credit": {2030: [5.2e9]}}),
            "m",
            "M",
            ("universal_credit",),
        )
        assert row["value"] < 0
        assert row["value"] == pytest.approx(-0.2)

    def test_a_tax_cut_is_a_cost(self):
        from uk_budget_data.calculators import OfficialBasisCalculator

        (row,) = OfficialBasisCalculator(years=[2028]).calculate(
            _Sim({"income_tax": {2028: [10e9]}}),
            _Sim({"income_tax": {2028: [9.9e9]}}),
            "m",
            "M",
            ("income_tax",),
        )
        assert row["value"] == pytest.approx(-0.1)

    def test_no_rows_without_an_official_basis(self):
        from uk_budget_data.calculators import OfficialBasisCalculator

        assert (
            OfficialBasisCalculator(years=[2030]).calculate(
                _Sim({}), _Sim({}), "m", "M", ()
            )
            == []
        )

    def test_the_official_bases(self):
        """The Carer's Allowance taper's costing is Carer's Allowance and
        Universal Credit spending (policy costings p. 16), the Pension Tax
        Allowance's income tax only (p. 63); no other measure has one. Each
        names a registered measure and distinct variables with an Exchequer
        sign."""
        from uk_budget_data.calculators import OFFICIAL_BASES, exchequer_signs
        from uk_budget_data.reforms import get_all_reforms

        assert OFFICIAL_BASES == {
            "carers_allowance_earnings_taper": (
                "carers_allowance",
                "universal_credit",
            ),
            "state_pension_income_tax_protection": ("income_tax",),
        }
        assert set(OFFICIAL_BASES) <= {r.id for r in get_all_reforms()}
        for variables in OFFICIAL_BASES.values():
            assert len(set(variables)) == len(variables)
            assert set(exchequer_signs(variables)) == set(variables)


class TestDistributionalImpactCalculator:
    """Tests for distributional impact calculation."""

    def test_calculator_returns_decile_data(self):
        """Calculator returns data for all 10 deciles."""
        from uk_budget_data.calculators import DistributionalImpactCalculator

        calc = DistributionalImpactCalculator()

        # Create mock decile data
        decile_df = pd.DataFrame(
            {
                "household_income_decile": [1, 1, 2, 2, 3, 3],
                "baseline_income": [10000, 12000, 20000, 22000, 30000, 32000],
                "reform_income": [10500, 12500, 20100, 22100, 30050, 32050],
                "income_change": [500, 500, 100, 100, 50, 50],
                "household_weight": [1000, 1000, 1000, 1000, 1000, 1000],
            }
        )

        result = calc.calculate_from_dataframe(
            reform_id="test",
            reform_name="Test",
            year=2026,
            decile_df=decile_df,
        )

        assert isinstance(result, list)
        # Should have 3 deciles (1, 2, 3 in our mock data)
        assert len(result) == 3

    def test_calculator_computes_relative_change(self):
        """Calculator computes change as percentage of baseline."""
        from uk_budget_data.calculators import DistributionalImpactCalculator

        calc = DistributionalImpactCalculator()

        decile_df = pd.DataFrame(
            {
                "household_income_decile": [1, 1],
                "baseline_income": [10000, 10000],
                "reform_income": [11000, 11000],
                "income_change": [1000, 1000],
                "household_weight": [1.0, 1.0],
            }
        )

        result = calc.calculate_from_dataframe(
            reform_id="test",
            reform_name="Test",
            year=2026,
            decile_df=decile_df,
        )

        # 1000/10000 = 10%
        assert result[0]["value"] == pytest.approx(10.0)


class TestWinnersLosersCalculator:
    """Tests for winners/losers calculation."""

    def test_calculator_includes_all_deciles_plus_overall(self):
        """Calculator includes all deciles plus 'all' category."""
        from uk_budget_data.calculators import WinnersLosersCalculator

        calc = WinnersLosersCalculator()

        decile_df = pd.DataFrame(
            {
                "household_income_decile": list(range(1, 11)) * 2,
                "income_change": [100] * 20,
                "household_weight": [1.0] * 20,
            }
        )

        result = calc.calculate_from_dataframe(
            reform_id="test",
            reform_name="Test",
            year=2026,
            decile_df=decile_df,
        )

        # 10 deciles + 1 "all"
        assert len(result) == 11

        # Check "all" category exists
        all_result = [r for r in result if r["decile"] == "all"]
        assert len(all_result) == 1

    def test_calculator_computes_weighted_average(self):
        """Calculator computes weighted average change per household."""
        from uk_budget_data.calculators import WinnersLosersCalculator

        calc = WinnersLosersCalculator()

        # Two households: one gains 100, one gains 200
        # Weights: 1 and 3, so weighted avg = (100*1 + 200*3)/(1+3) = 175
        decile_df = pd.DataFrame(
            {
                "household_income_decile": [1, 1],
                "income_change": [100, 200],
                "household_weight": [1.0, 3.0],
            }
        )

        result = calc.calculate_from_dataframe(
            reform_id="test",
            reform_name="Test",
            year=2026,
            decile_df=decile_df,
        )

        decile_1 = [r for r in result if r["decile"] == "1"][0]
        assert decile_1["avg_change"] == pytest.approx(175.0)


class TestMetricsCalculator:
    """Tests for summary metrics calculation."""

    def test_calculator_returns_required_metrics(self):
        """Calculator returns people_affected, gini_change, poverty metrics."""
        from uk_budget_data.calculators import MetricsCalculator

        calc = MetricsCalculator()

        result = calc.calculate_from_values(
            reform_id="test",
            reform_name="Test",
            year=2026,
            percent_affected=25.5,
            gini_change=-0.02,
            poverty_change_pp=-1.5,
            poverty_change_pct=-10.0,
        )

        assert len(result) == 1
        metrics = result[0]
        assert metrics["people_affected"] == 25.5
        assert metrics["gini_change"] == pytest.approx(-0.02)
        assert metrics["poverty_change_pp"] == -1.5
        assert metrics["poverty_change_pct"] == -10.0


class TestIncomeCurveCalculator:
    """Tests for income curve calculation."""

    def test_calculator_takes_the_points_per_household(self):
        """Calculator holds the number of points on each income grid."""
        from uk_budget_data.calculators import IncomeCurveCalculator

        assert IncomeCurveCalculator(num_points=101).num_points == 101

    def test_rows_name_the_household_and_its_axis(self):
        """Each row carries the household, its x variable and the income."""
        import numpy as np

        from uk_budget_data.calculators import IncomeCurveCalculator
        from uk_budget_data.example_households import get_household

        calc = IncomeCurveCalculator(num_points=3)
        household = get_household("pensioner_couple")
        rows = calc.rows(
            household,
            {2027: np.array([1.0, 2.0, 3.0])},
            {2027: np.array([1.5, 2.5, 3.5])},
            "m",
            "M",
            [2027],
        )
        assert [row["income"] for row in rows] == [0.0, 30_000.0, 60_000.0]
        assert {row["x_variable"] for row in rows} == {
            "private_pension_income"
        }
        assert {row["household"] for row in rows} == {"pensioner_couple"}
        assert rows[1]["reform_net_income"] == 2.5


class TestHouseholdScatterCalculator:
    """Tests for household scatter plot calculation."""

    def test_calculator_filters_by_income_range(self):
        """Calculator filters households by baseline income range."""
        from uk_budget_data.calculators import HouseholdScatterCalculator

        calc = HouseholdScatterCalculator(max_income=50_000)

        result = calc.calculate_from_arrays(
            reform_id="test",
            reform_name="Test",
            year=2026,
            baseline_incomes=np.array([20_000, 40_000, 60_000, 80_000]),
            income_changes=np.array([100, 200, 300, 400]),
            weights=np.array([1.0, 1.0, 1.0, 1.0]),
        )

        # Only first two should be included (< 50k)
        assert len(result) == 2


class TestConstituencyCalculator:
    """Tests for constituency-level calculation."""

    def test_calculator_returns_constituency_data(self):
        """Calculator returns data with constituency codes and names."""
        from uk_budget_data.calculators import ConstituencyCalculator

        calc = ConstituencyCalculator()

        # Mock constituency data
        result = calc.calculate_from_values(
            reform_id="test",
            year=2026,
            constituency_code="E14000530",
            constituency_name="Cities of London and Westminster",
            average_gain=150.0,
            relative_change=0.5,
        )

        assert result["reform_id"] == "test"
        assert result["constituency_code"] == "E14000530"
        assert result["average_gain"] == 150.0


class TestCalculatorFactory:
    """Tests for calculator factory pattern."""

    def test_get_all_calculators(self):
        """Can retrieve all standard calculators."""
        from uk_budget_data.calculators import get_standard_calculators

        calculators = get_standard_calculators(years=[2026, 2027])

        assert "budgetary" in calculators
        assert "distributional" in calculators
        assert "winners_losers" in calculators
        assert "metrics" in calculators
        assert "income_curve" in calculators
        assert "household_scatter" in calculators
        assert "constituency" in calculators
