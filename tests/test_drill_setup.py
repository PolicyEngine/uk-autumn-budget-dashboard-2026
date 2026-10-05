"""Fail-closed pre-start and pinned-engine regression checks."""

import math

import pytest
from policyengine_uk import Simulation

from uk_budget_data import drill_setup
from uk_budget_data.models import Reform

# Latest model native baseline, verified from official 2.120.0 parameters.
# Test expectations only: production code does not override these values.
NATIVE_NIC_THRESHOLDS = {
    "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold": 241.73,
    "gov.hmrc.national_insurance.class_1.thresholds.upper_earnings_limit": 966.73,
    "gov.hmrc.national_insurance.class_4.thresholds.lower_profits_limit": 12_570,
    "gov.hmrc.national_insurance.class_4.thresholds.upper_profits_limit": 50_270,
}


def situation(year, employment=0, self_employment=0):
    return {
        "people": {
            "p": {
                "age": {year: 40},
                "employment_income": {year: employment},
                "ni_class_1_income": {year: employment},
                "self_employment_income": {year: self_employment},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


@pytest.mark.parametrize("year", [2026, 2027, 2028, 2029, 2030])
def test_native_nics_match_frozen_bands_at_all_drill_years(year):
    """Fixed assessable pay isolates the frozen bands from employment dynamics.

    UK 2.120.0 annualises weekly Class 1 thresholds with 52 weeks:
    (£966.73 - £241.73)*52*8% + (£60,000 - £966.73*52)*2%.
    Class 4 uses annual £12,570/£50,270 bands and 6%/2% rates.
    """
    template = Reform(id="fixture", name="Fixture")
    for employment, profits, expected in [
        (
            60000,
            0,
            (966.73 - 241.73) * 52 * 0.08 + (60000 - 966.73 * 52) * 0.02,
        ),
        (0, 60000, 2456.60),
    ]:
        for baseline in (True, False):
            sim = Simulation(
                situation=situation(year, employment, profits),
                scenario=template.to_drill_scenario(baseline=baseline),
            )
            params = sim.tax_benefit_system.parameters
            for path, value in NATIVE_NIC_THRESHOLDS.items():
                assert params.get_child(path)(
                    f"{year}-01-01"
                ) == pytest.approx(value)
            actual = float(sim.calculate("national_insurance", year)[0])
            assert math.isfinite(actual)
            assert actual == pytest.approx(expected, abs=0.1)


def test_dated_measure_does_not_erase_nic_baseline():
    """Combining monthly parameters must retain the annual freeze."""
    reform = Reform(
        id="fixture",
        name="Fixture",
        parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": {
                "2029-04-01.2029-04-30": 0.6
            }
        },
    )
    sim = Simulation(
        situation=situation(2029, 60000), scenario=reform.to_drill_scenario()
    )
    for path, value in NATIVE_NIC_THRESHOLDS.items():
        assert sim.tax_benefit_system.parameters.get_child(path)(
            "2029-01-01"
        ) == pytest.approx(value)
    assert (
        sim.tax_benefit_system.parameters.gov.hmrc.fuel_duty.petrol_and_diesel(
            "2029-04-01"
        )
        == 0.6
    )


def test_dataset_and_runtime_mismatch_fail_closed(tmp_path, monkeypatch):
    wrong = tmp_path / "wrong.h5"
    wrong.write_bytes(b"not the requested release")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        drill_setup.verify_dataset(wrong)
    monkeypatch.delenv("UK_BUDGET_DATASET", raising=False)
    with pytest.raises(ValueError, match="Set UK_BUDGET_DATASET"):
        drill_setup.verify_dataset()
    monkeypatch.setattr(
        drill_setup,
        "runtime_versions",
        lambda: {"policyengine-uk": "2.120.0", "policyengine-core": "3.32.5"},
    )
    with pytest.raises(RuntimeError, match="engine mismatch"):
        drill_setup.verify_runtime()


def test_pre_start_rejects_results_but_publication_rejects_empty(
    tmp_path, monkeypatch
):
    from scripts.validate_published_data import (
        NATIONAL_FIELDS,
        validate,
        validate_pre_start,
    )
    from uk_budget_data import reforms

    for name in NATIONAL_FIELDS:
        (tmp_path / f"{name}.csv").write_text("reform_id,year,value\n")
    # Post-release, registered measures fail the empty-start check.
    assert "Active drill reforms remain before the statement release" in (
        validate_pre_start(tmp_path)
    )
    monkeypatch.setattr(reforms, "get_autumn_budget_2026_reforms", lambda: [])
    assert validate_pre_start(tmp_path) == []
    assert any(
        "at least one" in error
        for error in validate(tmp_path, (), (2027,), False)
    )
    (tmp_path / "stale.csv").write_text("reform_id,value\nold,123\n")
    assert any(
        "generated rows remain" in error
        for error in validate_pre_start(tmp_path)
    )


def test_mock_api_baseline_and_old_policy_rejection(monkeypatch):
    from fastapi.testclient import TestClient

    from uk_budget_data.api import app

    monkeypatch.setenv("NEXT_PUBLIC_MOCK", "1")
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert health["versions"] == {
        "policyengine-uk": "2.120.0",
        "policyengine-core": "3.32.17",
    }
    result = client.post(
        "/api/personal-impact",
        json={"employment_income": 30000, "policy_ids": []},
    )
    assert result.status_code == 200, result.text
    assert result.json()["baseline_only"] is True
    assert result.json()["policies"] == {}
    assert len(result.json()["years"]) == 6
    assert (
        client.post(
            "/api/personal-impact",
            json={
                "employment_income": 30000,
                "policy_ids": ["mock_nics_threshold_rise"],
            },
        ).status_code
        == 422
    )


@pytest.mark.parametrize("baseline", [False, True])
def test_modifier_reads_frozen_baseline_before_caching_nics(baseline):
    """Reading NI inside a modifier must not retain the unfrozen 2029 result."""
    from uk_budget_data.personal_impact import HouseholdInput, build_situation

    household = build_situation(
        HouseholdInput(employment_income=60_000, age_2025=40), 2029
    )
    plain = Simulation(
        situation=household,
        scenario=Reform(
            id="unregistered_plain", name="Plain"
        ).to_drill_scenario(baseline=baseline),
    )
    expected = float(plain.calculate("national_insurance", 2029)[0])
    observed = []

    def read_nics(simulation):
        for path, value in NATIVE_NIC_THRESHOLDS.items():
            assert simulation.tax_benefit_system.parameters.get_child(path)(
                "2029-01-01"
            ) == pytest.approx(value)
        observed.append(
            float(simulation.calculate("national_insurance", 2029)[0])
        )

    modifier_field = (
        "baseline_simulation_modifier" if baseline else "simulation_modifier"
    )
    reform = Reform(
        id="unregistered_reader", name="Reader", **{modifier_field: read_nics}
    )
    composed = Simulation(
        situation=household,
        scenario=reform.to_drill_scenario(baseline=baseline),
    )
    assert observed == pytest.approx([expected], abs=0.001)
    assert float(
        composed.calculate("national_insurance", 2029)[0]
    ) == pytest.approx(expected, abs=0.001)


def test_latest_runtime_is_distinct_from_dataset_build():
    provenance = drill_setup.drill_provenance()
    assert provenance["runtime"] == {
        "policyengine-uk": "2.120.0",
        "policyengine-core": "3.32.17",
    }
    assert provenance["dataset_build"] == {
        "policyengine-uk": "2.100.0",
        "policyengine-core": "3.32.5",
        "python": "3.14.6",
    }
    assert provenance["dataset_model_match"] is False
    assert provenance["publication_ready"] is False
    assert provenance["calibration_validated_for_runtime"] is False
    assert drill_setup.drill_scenario().parameter_changes is None
    assert (
        Reform(id="unregistered", name="Native")
        .to_drill_scenario()
        .parameter_changes
        is None
    )


def test_annual_override_applies_before_modifier_on_native_engine():
    """Preserve the modifier-order repair after removing the local NI freeze."""
    path = "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold"
    observed = []

    def inspect(simulation):
        observed.append(
            simulation.tax_benefit_system.parameters.get_child(path)(
                "2029-01-01"
            )
        )
        simulation.calculate("national_insurance", 2029)

    reform = Reform(
        id="unregistered",
        name="Fixture",
        parameter_changes={path: {"2029": 250}},
        simulation_modifier=inspect,
    )
    sim = Simulation(
        situation=situation(2029, 60000), scenario=reform.to_drill_scenario()
    )
    assert observed == [250]
    assert (
        sim.tax_benefit_system.parameters.get_child(path)("2029-01-01") == 250
    )
