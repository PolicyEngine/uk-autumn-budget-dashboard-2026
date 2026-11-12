"""Company car tax and the Machine Games Duty rise stay out of the national
results (11 November 2026).

From policyengine 6.16.2 the national data hold company cars and machine
takings, so neither is held for want of data any more: each is held while
we check our own estimate. The page lists exactly the measures the
publication manifest names (``buildMeasureCatalogue`` in
``src/utils/measureCatalogue.jsx``), and ``generate --national`` without
``--reforms`` regenerates exactly those, so the manifest is what keeps a
held measure off the page. These tests pin it, with the lists around it:

- Company car tax (Table 6.1 row 86): no measure is registered, so no
  command can generate, stage or approve one.
- The Machine Games Duty rise (row 56): registered for the Household
  calculator only. Its parameter change raises the standard rate, which on
  survey data charges every standard-rate machine (an upper bound; see
  ``reforms.py``). Once the data hold machine takings no data limit stops
  that figure, so only the manifest does.

To publish one: take it out of ``HELD`` here and in
``src/utils/heldMeasures.test.js``, out of ``HELD_FOR_CHECKS`` and
``UNMODELLED_MEASURES`` in ``src/utils/unmodelledMeasures.js``, and, for
the duty, out of both calculator-only lists, in the change that stages its
figures.
"""

import json
import re
from pathlib import Path

import pytest

from uk_budget_data import definitions, reforms

REPO = Path(__file__).resolve().parents[1]
PUBLIC_DATA = REPO / "public" / "data"

# What any id for each held measure would contain.
HELD = {
    "company car tax": re.compile(r"company_car"),
    "the Machine Games Duty rise": re.compile(r"machine_games"),
}
HELD_CASES = [
    pytest.param(pattern, id=name.replace(" ", "-"))
    for name, pattern in HELD.items()
]


def test_no_company_car_measure_is_registered():
    pattern = HELD["company car tax"]
    registered = reforms.get_all_reforms()
    assert [r.id for r in registered if pattern.search(r.id)] == []
    assert [
        r.name for r in registered if "company car" in r.name.lower()
    ] == []
    assert [
        name
        for name, value in vars(reforms).items()
        if name.endswith("_ID") and pattern.search(str(value))
    ] == []


def test_the_machine_games_duty_rise_is_registered_for_the_calculator_only():
    measure_id = reforms.MACHINE_GAMES_DUTY_ID
    assert HELD["the Machine Games Duty rise"].search(measure_id)
    assert reforms.get_reform(measure_id) is not None
    assert measure_id not in reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    assert measure_id in definitions.CALCULATOR_ONLY_MEASURES
    # The package leaves the duty's rate alone
    package = reforms.get_reform(reforms.AUTUMN_BUDGET_2026_COMBINED_ID)
    assert reforms.MACHINE_GAMES_STANDARD_RATE not in (
        package.parameter_changes or {}
    )


@pytest.mark.parametrize("pattern", HELD_CASES)
def test_the_publication_names_no_held_measure(pattern):
    """Not as a measure, a package member, a superseded entry or an
    artifact, and not in the official costings the page compares with."""
    manifest = json.loads((PUBLIC_DATA / "manifest.json").read_text())
    measures = manifest.get("measures", {})
    named = [
        *measures,
        *(entry.get("artifact", "") for entry in measures.values()),
        *(
            member
            for entry in manifest.get("combined", {}).values()
            for member in entry.get("measures") or []
        ),
        *(entry.get("key", "") for entry in manifest.get("superseded", [])),
    ]
    assert [name for name in named if pattern.search(name)] == []
    artifacts = PUBLIC_DATA / "artifacts"
    folders = (
        [path.name for path in artifacts.iterdir()]
        if artifacts.is_dir()
        else []
    )
    assert [name for name in folders if pattern.search(name)] == []
    costings = json.loads((PUBLIC_DATA / "official_costings.json").read_text())
    assert [
        name for name in costings.get("measures", {}) if pattern.search(name)
    ] == []


def test_no_public_table_holds_a_held_measures_rows():
    """Every file under public/ is a publication: no flat table carries a
    row for a held measure, whatever the manifest says."""
    tables = sorted(PUBLIC_DATA.rglob("*.csv"))
    assert tables, "public/data holds no tables to check"
    carrying = []
    for path in tables:
        text = path.read_text()
        carrying += [
            (path.relative_to(PUBLIC_DATA).as_posix(), name)
            for name, pattern in HELD.items()
            if pattern.search(text)
        ]
    assert carrying == []
