"""The browser's copy of the publication format must match the Python one."""

import json
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.contract import contract, contract_json
from uk_budget_data.publication.tables import TABLES

REPO = Path(__file__).resolve().parent.parent
COMMITTED = REPO / "src" / "utils" / "publication" / "contract.json"


def test_committed_contract_is_the_generated_one():
    """Differential: regenerate the file if this fails (see contract.py)."""
    assert COMMITTED.read_text() == contract_json()


def test_contract_covers_every_table_and_status():
    exported = contract()
    assert set(exported["tables"]) == set(TABLES)
    assert set(exported["statuses"]) == set(m.Status.__args__)
    assert set(exported["displayable"]) == set(m.DISPLAYABLE)
    assert set(exported["displayable"]) <= set(exported["statuses"])
    for name, table in exported["tables"].items():
        assert [c for c, _ in table["columns"]] == list(
            TABLES[name].column_names
        )
        assert set(table["key"]) <= {c for c, _ in table["columns"]}


def test_decile_labels_are_in_order():
    exported = contract()
    assert exported["deciles"][0] == "1st"
    assert exported["deciles"][-1] == "10th"
    assert len(exported["deciles"]) == 10
    assert exported["winners_groups"] == [str(n) for n in range(1, 11)] + [
        "all"
    ]


def test_contract_is_plain_json():
    assert json.loads(contract_json()) == contract()
