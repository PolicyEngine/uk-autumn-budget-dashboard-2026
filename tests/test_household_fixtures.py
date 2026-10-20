"""The household fixtures the Budget-day runbook checks the deployed route
against (``uk_budget_data.household_route``): each loads, at least one is
not a draft, and each non-draft one passes against the calculator the
route serves, run here, so a model change that moves an answer fails in
CI before it fails at G0."""

import json
from pathlib import Path

import pytest

from uk_budget_data import household_route

FIXTURES = Path(__file__).resolve().parents[1] / (
    "data_inputs/household_fixtures"
)


def fixtures():
    return [
        household_route.load_fixture(path)[0]
        for path in sorted(FIXTURES.glob("*.json"))
    ]


def test_every_fixture_loads_and_one_is_not_a_draft():
    """A run with no non-draft fixture never passes, so G0 would fail."""
    loaded = fixtures()
    assert loaded
    assert any(not fixture.get("draft") for fixture in loaded)


@pytest.mark.slow
@pytest.mark.parametrize(
    "fixture",
    [f for f in fixtures() if not f.get("draft")],
    ids=lambda fixture: fixture["name"],
)
def test_a_fixture_passes_against_the_calculator_the_route_serves(fixture):
    """The route's answer, computed here as the API computes it and
    serialised as JSON (year keys become strings), meets every expectation
    within its tolerance."""
    from uk_budget_data.api import (
        APIHouseholdInput,
        convert_api_input_to_household,
        convert_to_native,
    )
    from uk_budget_data.personal_impact import PersonalImpactCalculator

    assert fixture["route"] == "/api/personal-impact"
    household = convert_api_input_to_household(
        APIHouseholdInput(**fixture["request"])
    )
    results = PersonalImpactCalculator().calculate(household)
    response = json.loads(json.dumps(convert_to_native(results)))
    assert household_route.compare(response, fixture) == []
