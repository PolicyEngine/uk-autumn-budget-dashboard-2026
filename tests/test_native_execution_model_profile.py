"""Native comparison classification is data-only, not publication approval."""

import copy

import pytest

from tests.test_native_budget_identities import _combined_document
from uk_budget_data import reforms
from uk_budget_data.models import DataConfig
from uk_budget_data.publication import receipt
from uk_budget_data.publication.contract import (
    native_policy_comparison_contract,
)

REVISION = receipt.CodeRevision("a" * 40, True)  # Synthetic metadata only.


def model(version):
    api, _ = receipt.receipt_api()
    return api.ModelIdentity(
        name="policyengine-uk", version=version
    ).model_dump(mode="json")


def single(version="2.174.1"):
    reform = reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID)
    baseline, changed = receipt.measure_identities(
        reform, DataConfig(), REVISION
    )
    return {
        "dashboard": {
            "policy_comparison": receipt.comparison_metadata(
                reform, DataConfig(), REVISION
            )
        },
        "execution_receipt": {
            "model": model(version),
            "baseline": baseline.model_dump(mode="json"),
            "reform": changed.model_dump(mode="json"),
        },
    }


@pytest.mark.parametrize(
    "version",
    [
        "2.174.1",
        "2.175.0",
        "2.999",
        "2.174.1rc1",
        "2.174.1.dev1",
        "2.174.1+fixture",
        "1!2.151.0",
    ],
)
def test_native_floor_requires_the_comparison_after_recipe_erasure(version):
    document = single(version)
    del document["dashboard"]["policy_comparison"]
    assert receipt._comparison_metadata_problems(document)


@pytest.mark.parametrize("version", ["2.151.0", "2.165.1"])
def test_known_historical_versions_keep_their_legacy_identity_contract(
    version,
):
    document = {
        "dashboard": {},
        "execution_receipt": {"model": model(version)},
    }
    assert receipt._comparison_metadata_problems(document) == []


@pytest.mark.parametrize("version", ["2.999", "2.173.0", "1.0"])
def test_native_recipe_cannot_relabel_its_execution_model(version):
    assert receipt._comparison_metadata_problems(single(version))
    combined, _, _ = _combined_document()
    combined["execution_receipt"]["model"] = model(version)
    assert receipt.composition_problems(combined)


@pytest.mark.parametrize("version", [None, "", "not-a-version", True])
def test_missing_or_unparseable_model_version_never_selects_legacy(version):
    document = {
        "dashboard": {},
        "execution_receipt": {"model": {"version": version}},
    }
    assert receipt._comparison_metadata_problems(document)


def test_native_contract_exports_floor_and_matches_the_actual_model(
    monkeypatch,
):
    contract = native_policy_comparison_contract()
    assert contract["required_model_version_floor"] == "2.174.1"
    expected = contract["common_policy_reference"]["policy_record"][
        "native_model_version"
    ]
    assert expected in contract["required_model_versions"]
    original = receipt.metadata.version
    monkeypatch.setattr(
        receipt.metadata,
        "version",
        lambda name: "2.999" if name == "policyengine-uk" else original(name),
    )
    with pytest.raises(ValueError, match="model|Model"):
        native_policy_comparison_contract()


def test_ordered_recipe_uses_the_same_exact_model_profile():
    from uk_budget_data.publication.phase_recipe import ordered_api

    try:
        ordered_api()
    except receipt.ReceiptUnavailable:
        # The release capability guard is exercised directly, not skipped.
        with pytest.raises(receipt.ReceiptUnavailable):
            from tests.test_ordered_native_comparison import document

            document()
        return
    from tests.test_ordered_native_comparison import document

    original, _ = document()
    original["execution_receipt"]["model"] = model("2.174.1")
    assert receipt.composition_problems(original) == []
    for version in ("2.999", "1.0"):
        changed = copy.deepcopy(original)
        changed["execution_receipt"]["model"] = model(version)
        assert receipt.composition_problems(changed)
