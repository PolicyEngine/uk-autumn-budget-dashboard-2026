"""The lifecycle (lifetime) calculator is removed for this Budget, back end
included. The Personal impact view calculates one household's net income
before and after the Budget instead (``household_impact``)."""

import importlib.util

import pytest
from fastapi.testclient import TestClient

from uk_budget_data.api import app
from uk_budget_data.cli import parse_args


def test_the_lifecycle_route_is_gone():
    response = TestClient(app).post("/api/lifecycle/calculate", json={})
    assert response.status_code == 404


@pytest.mark.parametrize(
    "module",
    ["uk_budget_data.lifecycle_calculator", "uk_budget_data.lifetime_impact"],
)
def test_the_lifecycle_modules_are_gone(module):
    assert importlib.util.find_spec(module) is None


def test_the_cli_has_no_lifetime_command():
    with pytest.raises(SystemExit):
        parse_args(["lifetime"])
