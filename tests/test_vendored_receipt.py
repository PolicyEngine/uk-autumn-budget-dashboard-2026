"""The adapter uses policyengine's released receipt implementation."""

import json
from importlib import metadata
from pathlib import Path

from policyengine.provenance import receipt as released

from uk_budget_data.publication.receipt import _has_what_we_need, receipt_api

SCHEMA = Path("tests/fixtures/w4/execution_receipt.v1.schema.json")


def test_released_model_matches_the_receipt_schema():
    assert released.ExecutionReceipt.json_schema() == json.loads(
        SCHEMA.read_text()
    )


def test_the_adapter_uses_the_released_receipt_module():
    api, source = receipt_api()
    assert api is released
    assert _has_what_we_need(api)
    assert source == f"policyengine=={metadata.version('policyengine')}"
