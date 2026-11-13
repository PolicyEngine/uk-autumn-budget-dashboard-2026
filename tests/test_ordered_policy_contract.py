"""Common-reference contract metadata uses real definitions, no model runs."""

import json

import pytest

from uk_budget_data import budget_policy
from uk_budget_data.publication import receipt
from uk_budget_data.publication.contract import (
    native_policy_comparison_contract,
)


def test_native_contract_exports_the_exact_running_content_reference():
    exported = native_policy_comparison_contract()
    common = exported["common_policy_reference"]
    receipt._validate_common_reference(common)
    assert common["policy_record"] == budget_policy.policy_record()
    assert common["parameter_changes"] == receipt._encoded_parameters(
        budget_policy.pre_budget_policy_changes()
    )
    assert common["identity"]["binding"] == "content"
    assert "code_revision" not in common["identity"]
    assert receipt.DEFINITION_REVISION.git_sha not in json.dumps(common)
    assert exported["required_model_versions"] == ["2.174.1"]
    assert exported["composition_methods"] == [
        "resolved_common_policy/v1",
        "resolved_common_policy_phases/v1",
    ]


def test_native_contract_carries_source_record_changes_instead_of_accepting_arbitrary_records(
    monkeypatch,
):
    before = native_policy_comparison_contract()["common_policy_reference"]
    record = budget_policy.policy_record()
    record["notes"] = "Synthetic source-record change for this contract test"
    monkeypatch.setattr(budget_policy, "policy_record", lambda: record)
    after = native_policy_comparison_contract()["common_policy_reference"]
    assert after["policy_record"] == record
    assert after["policy_record_sha256"] != before["policy_record_sha256"]
    try:
        receipt._validate_common_reference(before)
    except ValueError as error:
        assert "running definitions" in str(error)
    else:
        raise AssertionError(
            "a self-consistent old source record must be refused"
        )


def test_source_record_rejects_boolean_number_substitution_even_with_a_matching_hash():
    from tests.test_ordered_native_comparison import (
        replace_one_boolean_with_number,
    )

    common = native_policy_comparison_contract()["common_policy_reference"]
    assert replace_one_boolean_with_number(common["policy_record"])
    common["policy_record_sha256"] = receipt.receipt_api()[0].content_sha256(
        common["policy_record"]
    )
    with pytest.raises(ValueError, match="running definitions"):
        receipt._validate_common_reference(common)
