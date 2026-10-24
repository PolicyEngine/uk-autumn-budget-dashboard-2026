"""The Personal impact tab runs on the household route, not on a
hand-typed model."""

from pathlib import Path

COMPONENTS = Path("src/components")


def test_personal_impact_uses_the_household_calculator():
    content = (COMPONENTS / "PersonalImpactTab.jsx").read_text()
    assert "HouseholdCalculator" in content
    assert "<iframe" not in content


def test_the_household_calculator_calls_the_household_route():
    content = (COMPONENTS / "HouseholdCalculator.jsx").read_text()
    assert "useHouseholdImpact" in content
    api = Path("src/utils/householdImpactApi.js").read_text()
    assert "NEXT_PUBLIC_HOUSEHOLD_API_URL" in api


def test_the_hand_typed_model_is_gone():
    assert not Path("src/uk_budget_data/lifecycle_calculator.py").exists()
    assert not (COMPONENTS / "LifecycleCalculator.jsx").exists()
