"""Personal-impact API contract tests."""

from fastapi.testclient import TestClient

from uk_budget_data import api


def test_personal_api_passes_region_and_fuel_choice(monkeypatch):
    """The mounted form's transport inputs reach the household calculator."""
    captured = {}

    class Calculator:
        def calculate(self, household, policy_ids=None):
            captured["household"] = household
            captured["policy_ids"] = policy_ids
            return {"years": {}, "policies": {}, "totals": {"cumulative": 0}}

    monkeypatch.setattr(api, "get_calculator", lambda: Calculator())
    response = TestClient(api.app).post(
        "/api/personal-impact",
        json={
            "employment_income": 50000,
            "region": "NORTH_EAST",
            "fuel_type": "DIESEL",
            "fuel_spending": 1200,
            "bus_spending": 800,
            "capital_gains": 10000,
            "policy_ids": ["cgt_equalisation", "bus_fare_cap"],
        },
    )
    assert response.status_code == 200
    assert captured["household"].region == "NORTH_EAST"
    assert captured["household"].fuel_type == "DIESEL"
    assert captured["household"].bus_spending == 800
    assert captured["household"].capital_gains == 10000
    assert captured["policy_ids"] == ["cgt_equalisation", "bus_fare_cap"]


def test_personal_api_rejects_unknown_region_and_fuel():
    """Unknown geography or fuel must not produce a misleading estimate."""
    client = TestClient(api.app)
    for invalid in ({"region": "UNKNOWN"}, {"fuel_type": "KEROSENE"}):
        response = client.post(
            "/api/personal-impact",
            json={"employment_income": 50000, **invalid},
        )
        assert response.status_code == 422


def test_personal_api_rejects_invalid_policy_selection():
    """Only nonempty unique featured policy IDs are accepted."""
    client = TestClient(api.app)
    for invalid in ([], ["two_child_limit"], ["bus_fare_cap", "bus_fare_cap"]):
        response = client.post(
            "/api/personal-impact",
            json={"employment_income": 50000, "policy_ids": invalid},
        )
        assert response.status_code == 422
