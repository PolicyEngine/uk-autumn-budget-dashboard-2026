"""Saved projection reuse must preserve its actual policy reference."""

import copy
import json

import pytest
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.forecast import with_forecast
from uk_budget_data.living_standards import build, engine
from uk_budget_data.publication.receipt import receipt_api


@pytest.fixture(scope="module")
def basis():
    return engine.projection_policy_basis()


def test_basis_records_the_actual_before_data_reference_as_strict_json(basis):
    before, after = with_forecast(None).parts_by_data_load()
    api, _ = receipt_api()
    assert before is not None and after is None
    assert basis["applied_before_data_load"] is True
    assert basis["policy_record"]["native_model_version"] == "2.174.1"
    assert basis["forecast"]["mode"] == "native"
    assert json.loads(json.dumps(basis, allow_nan=False)) == basis
    payload = {key: value for key, value in basis.items() if key != "sha256"}
    assert api.content_sha256(payload) == basis["sha256"]
    assert engine.projection_policy_basis(with_forecast(None)) == basis


def test_native_law_without_the_rollback_cannot_claim_the_outlook_basis():
    with pytest.raises(ValueError, match="before-data policy reference"):
        engine.projection_policy_basis(Scenario())


@pytest.mark.parametrize(
    "change", ["missing", "parameters", "record", "forecast", "hash"]
)
def test_same_version_and_dataset_do_not_allow_a_different_saved_basis(
    basis, change
):
    saved = copy.deepcopy(basis)
    if change == "parameters":
        path = "gov.hmrc.income_tax.rates.savings.basic"
        first = next(iter(saved["parameter_changes"][path]))
        saved["parameter_changes"][path][first] += 0.01
    elif change == "record":
        saved["policy_record"]["native_model_commit"] = "0" * 40
    elif change == "forecast":
        saved["forecast"]["mode"] = "overlay"
    elif change == "hash":
        saved["sha256"] = "0" * 64
    meta = {
        **engine.engine_versions(),
        "dataset_sha256": engine.certified_dataset()["sha256"],
    }
    if change != "missing":
        meta["policy_basis"] = saved
    # Validation precedes reading aggregates. No population calculation or
    # synthetic estimate needs to stand in for a real saved projection.
    with pytest.raises(ValueError, match="Regenerate them; do not relabel"):
        build.build_outlook({"meta": meta}, {}, {})
