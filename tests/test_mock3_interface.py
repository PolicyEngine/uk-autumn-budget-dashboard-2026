"""MOCK drill 3: personal-impact API inputs (BRMA and salary sacrifice).

Invented measures for a PolicyEngine rehearsal (policyengine-uk 2.125.1).
"""

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api
from uk_budget_data.personal_impact import HouseholdInput, build_situation

# Mirrors tests/test_mock3_housing_energy.py::_renter: single 40-year-old in
# 2027 (35 in 2025), £8,000 earnings, £15,000 private rent, category B.
RENTER = {
    "employment_income": 8_000,
    "age_2025": 38,
    "rent": 15_000,
    "tenure_type": "RENT_PRIVATELY",
    "region": "NORTH_WEST",
    "policy_ids": ["mock3_lha_30th_percentile"],
    "years": [2027],
}


def _change(response, policy_id, year):
    assert response.status_code == 200, response.text
    return response.json()["policies"][policy_id]["years"][str(year)][
        "net_income_change"
    ]


def test_build_situation_puts_brma_on_household():
    household = HouseholdInput(
        employment_income=0, brma="CENTRAL_GREATER_MANCHESTER"
    )
    entity = build_situation(household, 2027)["households"]["household"]
    assert entity["brma"] == {2027: "CENTRAL_GREATER_MANCHESTER"}
    default = build_situation(HouseholdInput(employment_income=0), 2027)
    assert "brma" not in default["households"]["household"]


def test_api_rejects_unknown_brma():
    response = TestClient(api.app).post(
        "/api/personal-impact",
        json={"employment_income": 8_000, "brma": "ATLANTIS"},
    )
    assert response.status_code == 422


def test_api_brma_drives_lha_gain(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_MOCK", "1")
    client = TestClient(api.app)
    with_brma = _change(
        client.post(
            "/api/personal-impact",
            json={**RENTER, "brma": "CENTRAL_GREATER_MANCHESTER"},
        ),
        "mock3_lha_30th_percentile",
        2027,
    )
    # Annex A anchor: 12 x (£925.43 x 1,095/1,079.67 - £775.00 x 985/875)
    # = 12 x (£938.57 - £872.43) = £793.70.
    assert with_brma == pytest.approx(793.70, abs=0.02)
    default = _change(
        client.post("/api/personal-impact", json=RENTER),
        "mock3_lha_30th_percentile",
        2027,
    )
    # Without a BRMA the engine falls back to Maidstone.
    # Engine regression value after the Annex A scaling (not hand-checked).
    assert default == pytest.approx(818.75, abs=0.02)
    assert default != pytest.approx(with_brma, abs=1)


def test_api_salary_sacrifice_cap(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_MOCK", "1")
    response = TestClient(api.app).post(
        "/api/personal-impact",
        json={
            "employment_income": 40_000,
            "pension_contributions_salary_sacrifice": 3_000,
            "policy_ids": ["mock3_salary_sacrifice_cap"],
            "years": [2029],
        },
    )
    assert _change(response, "mock3_salary_sacrifice_cap", 2029) == (
        pytest.approx(-80.0, abs=0.01)
    )
