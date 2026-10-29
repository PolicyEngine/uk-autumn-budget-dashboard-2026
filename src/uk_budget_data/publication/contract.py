"""The parts of the publication format the browser needs to know.

The browser reads the manifest and the artifacts this package writes. So
that the two cannot drift, the names it depends on are exported from here to
``src/utils/publication/contract.json``, and a test fails if the committed
file differs from this module's output. It also carries digest vectors:
values with the SHA-256 policyengine's receipt code gives their canonical
JSON, which the browser's digest code must reproduce exactly.

Regenerate the file with::

    uv run python -m uk_budget_data.publication.contract \\
        > src/utils/publication/contract.json
"""

import json
import sys

from uk_budget_data import (
    data_limits,
    measure_templates,
    model_limits,
    sign_off,
)
from uk_budget_data.calculators import OFFICIAL_BASES
from uk_budget_data.example_households import EXAMPLE_HOUSEHOLDS
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import RECEIPT_FILE
from uk_budget_data.publication.receipt import receipt_api
from uk_budget_data.publication.tables import (
    SCATTER_BINS,
    SCATTER_MIN_HOUSEHOLDS,
    SCATTER_ROUND_TO,
    TABLES,
)
from uk_budget_data.publication.validate import DECILES, WINNERS_GROUPS

# Values that exercise canonical JSON (RFC 8785): key order by UTF-16 code
# unit, escapes, number formatting and dropped null members.
DIGEST_VECTOR_VALUES = [
    {
        "budgetary_impact.csv": "a" * 64,
        "metrics.csv": "b" * 64,
        "distributional_impact.csv": "c" * 64,
    },
    {
        "z": None,
        "a": [1, 2.5, -0.0, 1e21, "\u00e9 "],
        "m": {"b": True, "a": None},
    },
    {"\u20ac": 1, "\U0001f600": 2, "z": 3, "\u00e9": 4, "A": 5, "a": 6},
    {"text": 'quote " backslash \\ tab \t newline \n bell \u0007 \u2028'},
    {"n": [0, -1, 0.1, 1e-7, 1e-6, 1.2345678901234568e20, 5e-324, 1.5e300]},
    {
        "nested": [
            {"keep": [None, 1], "drop": None},
            None,
            {"deep": {"x": None}},
        ]
    },
]


def digest_vectors() -> list[dict]:
    api, _ = receipt_api()
    return [
        {"value": value, "sha256": api.content_sha256(value)}
        for value in DIGEST_VECTOR_VALUES
    ]


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
            m.NOT_COMPUTABLE,
        ],
        "displayable": sorted(m.DISPLAYABLE),
        "data_limits_registry_sha256": data_limits.REGISTRY_SHA256,
        "data_limits_active": bool(data_limits.DATA_LIMITS),
        "model_limits_registry_sha256": model_limits.REGISTRY_SHA256,
        # The sign-off switch (uk_budget_data.sign_off): whether the page
        # holds a hand-written modifier for its attestation, and whether
        # the build's check needs a review row for every public file.
        "sign_off_required": sign_off.REQUIRED,
        "measure_templates": list(measure_templates.TEMPLATES),
        # JavaScript has lowercasing but no Unicode case-fold operation.
        # Export non-identity folds, so checker names follow Python's
        # Unicode version too (for example, Straße equals STRASSE).
        "name_casefold": {
            char: char.casefold()
            for codepoint in range(sys.maxunicode + 1)
            if (char := chr(codepoint)).casefold() != char
        },
        "name_whitespace": "".join(
            char
            for codepoint in range(sys.maxunicode + 1)
            if (char := chr(codepoint)).isspace()
        ),
        "digest_vectors": digest_vectors(),
        "scatter_bins": {
            **SCATTER_BINS,
            "min_households": SCATTER_MIN_HOUSEHOLDS,
            "round_to": SCATTER_ROUND_TO,
        },
        # The households the income curve covers, in display order, with
        # what the page says about each
        "income_curve_households": [
            {
                "id": household.id,
                "label": household.label,
                "definition": household.definition,
                "x_variable": household.x_variable,
                "x_label": household.x_label,
                "x_max": household.x_max,
            }
            for household in EXAMPLE_HOUSEHOLDS
        ],
        "deciles": _in_decile_order(DECILES),
        "winners_groups": _in_decile_order(WINNERS_GROUPS),
        # The engine variables each measure's official_basis table sums
        # (#297), so the page names what the figure counts
        "official_bases": {
            measure: list(variables)
            for measure, variables in OFFICIAL_BASES.items()
        },
        "tables": {
            name: {
                "file": spec.filename,
                "columns": [list(column) for column in spec.columns],
                "key": list(spec.key),
                "required": spec.required,
                **({"nullable": list(spec.nullable)} if spec.nullable else {}),
            }
            for name, spec in TABLES.items()
        },
    }


def contract_json() -> str:
    return json.dumps(contract(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    sys.stdout.write(contract_json())
