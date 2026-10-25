"""``uk-budget-data publish definitions``: each displayed measure's
definition in this code, compared with its approved receipt.

Run before a deploy, it lists the measures Personal impact would show as
unavailable once the household API runs this code.
"""

import json

import pytest

from uk_budget_data import definitions, household_impact
from uk_budget_data.cli import main
from uk_budget_data.publication import manifest as m

MEASURES = household_impact.measure_ids()
COMMIT = "0123456789abcdef" * 2 + "01234567"
DIGEST = "0" * 64


@pytest.fixture(autouse=True)
def _fresh_cache():
    definitions._definition.cache_clear()
    yield
    definitions._definition.cache_clear()


def _receipt(measure_id, git_sha=COMMIT):
    definition = definitions.measure_definition(measure_id, git_sha)
    return {
        "execution_receipt": {
            "baseline": {**definition["baseline"], "name": "b"},
            "reform": {**definition["reform"], "name": "r"},
        },
        "dashboard": {"key": measure_id, "git_sha": git_sha},
    }


def _entry(key, status=m.APPROVED):
    return m.Entry(
        name=key,
        status=status,
        artifact=f"artifacts/{key}/{DIGEST[:16]}",
        outputs_sha256=DIGEST,
        receipt_sha256=DIGEST,
        execution_identity_sha256=DIGEST,
        artifact_sha256=DIGEST,
        years=[2027],
    )


def _publish(data_root, receipts, statuses=None, combined=()):
    statuses = statuses or {}
    manifest = m.Manifest()
    for key, document in receipts.items():
        entry = _entry(key, statuses.get(key, m.APPROVED))
        directory = data_root / entry.artifact
        directory.mkdir(parents=True)
        if document is not None:
            (directory / "receipt.json").write_text(json.dumps(document))
        manifest.measures[key] = entry
    for key in combined:
        manifest.combined[key] = _entry(key)
    m.save_manifest(manifest, data_root)


def _run(data_root):
    lines = []
    code = definitions.run_check(data_root, lines.append)
    return code, lines


def test_with_no_manifest_there_is_nothing_to_compare(tmp_path):
    assert _run(tmp_path) == (
        0,
        ["no manifest yet: no published measure to compare"],
    )


def test_receipts_made_from_this_code_are_the_same(tmp_path):
    _publish(tmp_path, {key: _receipt(key) for key in MEASURES})
    code, lines = _run(tmp_path)
    assert code == 0, lines
    assert lines[-1] == (
        f"{len(MEASURES)} of {len(MEASURES)} displayed measures have the "
        "approved definition in this code"
    )


def test_a_changed_definition_is_listed_and_fails(tmp_path):
    changed = _receipt(MEASURES[0])
    changed["execution_receipt"]["reform"]["reform_sha256"] = "1" * 64
    _publish(
        tmp_path, {MEASURES[0]: changed, MEASURES[1]: _receipt(MEASURES[1])}
    )
    code, lines = _run(tmp_path)
    assert code == 1
    assert f"DIFFERS {MEASURES[0]} (approved, receipt {COMMIT[:12]}):" in lines
    assert "  - its reform reform_sha256 differs" in lines
    assert f"same    {MEASURES[1]} (approved, receipt {COMMIT[:12]})" in lines


def test_only_displayed_single_measures_are_compared(tmp_path):
    changed = _receipt(MEASURES[0])
    changed["execution_receipt"]["reform"]["reform_sha256"] = "1" * 64
    _publish(
        tmp_path,
        {MEASURES[0]: changed, MEASURES[1]: _receipt(MEASURES[1])},
        statuses={MEASURES[0]: m.WITHDRAWN, MEASURES[1]: m.PROVISIONAL},
        combined=["combined--x+y"],
    )
    code, lines = _run(tmp_path)
    assert code == 0, lines
    assert lines == [
        f"same    {MEASURES[1]} (provisional, receipt {COMMIT[:12]})",
        "1 of 1 displayed measures have the approved definition in this code",
    ]


@pytest.mark.parametrize(
    "key, document, problem",
    [
        ("not_registered", {"dashboard": {"git_sha": COMMIT}}, "registers"),
        (MEASURES[0], None, "no receipt"),
        (MEASURES[0], {"dashboard": {"git_sha": "abc"}}, "no full commit"),
        (MEASURES[0], {"dashboard": {}}, "no full commit"),
    ],
)
def test_a_measure_that_cannot_be_compared_fails(
    tmp_path, key, document, problem
):
    _publish(tmp_path, {key: document})
    code, lines = _run(tmp_path)
    assert code == 1
    assert any(problem in line for line in lines), lines


def test_the_command_line_runs_it(tmp_path, capsys):
    _publish(tmp_path, {MEASURES[0]: _receipt(MEASURES[0])})
    assert main(["publish", "--data-root", str(tmp_path), "definitions"]) == 0
    assert "1 of 1 displayed measures" in capsys.readouterr().out
