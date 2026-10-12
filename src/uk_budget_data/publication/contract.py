"""The parts of the publication format the browser needs to know.

The browser reads the manifest and the artifacts this package writes. So
that the two cannot drift, the names it depends on are exported from here to
``src/utils/publication/contract.json``, and a test fails if the committed
file differs from this module's output.

Regenerate the file with::

    uv run python -m uk_budget_data.publication.contract \\
        > src/utils/publication/contract.json
"""

import json
import sys

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import RECEIPT_FILE
from uk_budget_data.publication.tables import TABLES
from uk_budget_data.publication.validate import DECILES, WINNERS_GROUPS


def _in_decile_order(labels) -> list[str]:
    """Order decile labels 1 to 10, with any non-numeric label last."""

    def position(label: str) -> tuple[int, str]:
        digits = "".join(c for c in label if c.isdigit())
        return (int(digits), label) if digits else (11, label)

    return sorted(labels, key=position)


def contract() -> dict:
    """Return the browser's view of the publication format."""
    return {
        "manifest_schema": m.SCHEMA,
        "manifest_file": m.MANIFEST_FILE,
        "receipt_file": RECEIPT_FILE,
        "statuses": [
            m.STAGED,
            m.PROVISIONAL,
            m.APPROVED,
            m.STALE,
            m.WITHDRAWN,
        ],
        "displayable": sorted(m.DISPLAYABLE),
        "deciles": _in_decile_order(DECILES),
        "winners_groups": _in_decile_order(WINNERS_GROUPS),
        "tables": {
            name: {
                "file": spec.filename,
                "columns": [list(column) for column in spec.columns],
                "key": list(spec.key),
                "required": spec.required,
            }
            for name, spec in TABLES.items()
        },
    }


def contract_json() -> str:
    return json.dumps(contract(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    sys.stdout.write(contract_json())
