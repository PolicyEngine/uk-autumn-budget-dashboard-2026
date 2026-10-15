"""The vendored receipt code is exactly policyengine's schema v1."""

import json
from pathlib import Path

from uk_budget_data.publication._vendor_w4 import receipt as vendored
from uk_budget_data.publication.receipt import _REQUIRED_API, receipt_api

SCHEMA = Path("tests/fixtures/w4/execution_receipt.v1.schema.json")
VENDORED = Path("src/uk_budget_data/publication/_vendor_w4")


def test_vendored_model_matches_the_vendored_schema():
    assert vendored.ExecutionReceipt.json_schema() == json.loads(
        SCHEMA.read_text()
    )


def test_vendored_modules_import_nothing_else_from_this_package():
    for name in ("receipt.py", "canonical.py", "wheels.py"):
        text = (VENDORED / name).read_text()
        assert text.startswith("# VENDORED, do not edit.")
        imports = [
            line
            for line in text.splitlines()
            if "uk_budget_data" in line and "import" in line
        ]
        assert all("_vendor_w4" in line for line in imports)


def test_the_adapter_uses_a_module_with_everything_it_needs():
    api, source = receipt_api()
    assert all(hasattr(api, name) for name in _REQUIRED_API)
    assert source.startswith(("vendored-w4-", "policyengine=="))
