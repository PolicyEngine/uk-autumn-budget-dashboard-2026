"""The Personal impact tab asks the household impact route, not the
lifecycle calculator."""

from pathlib import Path

TAB = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "components"
    / "PersonalImpactTab.jsx"
)


def test_the_tab_asks_the_household_impact_route():
    content = TAB.read_text()
    assert "/api/household-impact" in content
    assert "LifecycleCalculator" not in content
    assert "<iframe" not in content
