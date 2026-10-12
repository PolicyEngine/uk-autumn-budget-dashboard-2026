"""Regressions for the independent review of the publication gates (12 Oct).

Each test reproduces a way the reviewer published a wrong or unreceipted
number, or a way a check passed vacuously, and shows it is now refused.
"""

import json
import shutil

import numpy as np
import pytest

from tests.publication_support import World
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import (
    PublishError,
    approve,
    check,
    stage,
)
from uk_budget_data.publication.receipt import (
    artifact_sha256,
    dashboard_problems,
    is_publication_path,
    porcelain_paths,
)
from uk_budget_data.publication.tables import (
    MAX_EXACT_INTEGER,
    TableError,
    _coerce,
)

VALUES = {2027: -1.0, 2028: -2.0}


@pytest.fixture
def world():
    instance = World()
    yield instance
    instance.close()


def args(world):
    return dict(data_root=world.data_root, inputs=world.inputs)


def approved(world, manifest, key, values=VALUES, **kwargs):
    reference = world.ready(key, values, **kwargs)
    stage(manifest, reference.path, **args(world))
    approve(manifest, key, "María", **args(world))
    return reference


# --- blocker 1: an entry is bound to the bytes on disk ---------------------


def test_swapping_in_another_valid_artifact_is_caught(world):
    manifest = m.Manifest()
    original = approved(world, manifest, "alpha")
    # Same tables and costing, but a different measure definition: a
    # different, equally valid artifact for the same key.
    other = world.write("alpha", VALUES, rate=0.22)
    assert other.artifact_sha256 != original.artifact_sha256
    for item in original.path.iterdir():
        item.unlink()
    for item in other.path.iterdir():
        shutil.copy(item, original.path / item.name)

    failures = check(manifest, **args(world))
    assert any("not the one this entry names" in f for f in failures)
    with pytest.raises(PublishError, match="not the one this entry names"):
        approve(manifest, "alpha", "María", **args(world))


# --- blocker 2: reconciliation is recomputed, never read back --------------


def test_a_forged_reconciliation_file_cannot_waive_an_inert_measure(world):
    world.costing("alpha", VALUES)
    inert = world.write("alpha", {2027: 0.0, 2028: 0.0})
    (inert.path / "reconciliation.json").write_text(
        json.dumps(
            {
                "schema": "uk-budget-dashboard/reconciliation/v1",
                "outputs_sha256": inert.outputs_sha256,
                "summary": {"status": "pass"},
                "responsiveness": {"status": "responsive"},
                "rows": [],
            }
        )
    )
    with pytest.raises(PublishError, match="inert"):
        stage(m.Manifest(), inert.path, provisional=True, **args(world))


def test_changed_treasury_inputs_reach_an_approved_entry(world):
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    assert check(manifest, **args(world)) == []
    world.costing("alpha", {2027: -5.0, 2028: -6.0})
    failures = check(manifest, **args(world))
    assert any("reconciliation is failed" in f for f in failures)


# --- blocker 3: a combined run is bound to the member outputs it went with -


def combined(world, manifest, members, values):
    records = []
    for member in sorted(members):
        receipt = read_receipt(
            world.data_root / manifest.measures[member].artifact
        )["execution_receipt"]
        records.append(
            {
                "id": member,
                "reform": receipt["reform"],
                "baseline": receipt["baseline"],
            }
        )
    return world.write(
        "combined--" + "+".join(sorted(members)),
        values,
        members=records,
        measure_ids=sorted(members),
        member_outputs={
            member: manifest.measures[member].outputs_sha256
            for member in members
        },
    )


def test_an_old_combined_run_cannot_be_restaged_after_a_correction(world):
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    old = combined(world, manifest, ["alpha", "beta"], {2027: -2.0, 2028: -4})
    key = stage(manifest, old.path, **args(world))
    approve(manifest, key, "María", **args(world))

    corrected = {2027: -1.05, 2028: -2.1}
    world.costing("alpha", corrected)
    fixed = world.write("alpha", corrected)
    stage(manifest, fixed.path, **args(world))
    assert manifest.combined[key].status == m.STALE

    with pytest.raises(PublishError, match="different outputs from when"):
        stage(manifest, old.path, **args(world))


def test_a_combined_run_without_a_member_snapshot_cannot_be_staged(world):
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    unbound = combined(world, manifest, ["alpha", "beta"], {2027: -2.0})
    document = read_receipt(unbound.path)
    assert document["dashboard"]["member_outputs_sha256"]
    bare = world.write(
        "combined--alpha+beta",
        {2027: -2.0},
        members=document["dashboard"]["members"],
        measure_ids=["alpha", "beta"],
    )
    with pytest.raises(PublishError, match="does not record its members"):
        stage(manifest, bare.path, **args(world))


# --- major 4: derived dashboard fields are recomputed ----------------------


def test_a_dirty_artifact_cannot_be_marked_publishable(world):
    reference = world.write("alpha", VALUES, clean=False)
    document = read_receipt(reference.path)
    document["dashboard"]["publishable"] = True
    document["dashboard"]["reasons"] = []
    assert any(
        "publishable flag" in problem
        for problem in dashboard_problems(document)
    )


def test_supported_years_cannot_be_masked(world):
    reference = world.write("alpha", VALUES)
    document = read_receipt(reference.path)
    assert dashboard_problems(document) == []
    document["dashboard"]["dataset_years"] = [2027]
    document["dashboard"]["unsupported_years"] = [2028]
    problems = dashboard_problems(document)
    assert any("projects to 2030" in problem for problem in problems)


def test_an_edited_receipt_no_longer_matches_its_directory(world):
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES)
    receipt = reference.path / "receipt.json"
    document = json.loads(receipt.read_text())
    document["dashboard"]["basis"]["notes"] = "edited"
    receipt.write_text(json.dumps(document))
    with pytest.raises(PublishError, match="not named by its digest"):
        stage(m.Manifest(), reference.path, **args(world))


# --- major 5: identical outputs from a clean tree get their own artifact ---


def test_a_clean_rerun_of_a_dirty_artifact_is_kept(world):
    dirty = world.write("alpha", VALUES, clean=False)
    clean = world.write("alpha", VALUES, clean=True)
    assert clean.outputs_sha256 == dirty.outputs_sha256
    assert clean.path != dirty.path and clean.created
    assert read_receipt(clean.path)["dashboard"]["publishable"] is True
    assert artifact_sha256(read_receipt(clean.path)) == clean.artifact_sha256


# --- major 6: git status is read safely -------------------------------------


def test_both_paths_of_a_rename_count():
    output = (
        "R  public/data/artifacts/stolen.py\0src/uk_budget_data/reforms.py\0"
    )
    paths = porcelain_paths(output)
    assert "src/uk_budget_data/reforms.py" in paths
    assert not all(is_publication_path(path) for path in paths)


@pytest.mark.parametrize(
    "path,exempt",
    [
        ("public/data/manifest.json", True),
        ("public/data/artifacts/alpha/abc/receipt.json", True),
        ("public/data/manifest.json.evil.py", False),
        ("public/data/artifacts/../../src/x.py", False),
        ("src/new_measure.py", False),
    ],
)
def test_only_the_publication_outputs_are_exempt(path, exempt):
    assert is_publication_path(path) is exempt


def test_untracked_and_modified_entries_are_read():
    output = " M src/a.py\0?? src/b.py\0"
    assert porcelain_paths(output) == ["src/a.py", "src/b.py"]


# --- minor 15: integers and booleans are kept exact ------------------------


def test_integers_beyond_exact_float_range_are_refused():
    assert _coerce(MAX_EXACT_INTEGER, "int", "x") == MAX_EXACT_INTEGER
    with pytest.raises(TableError, match="too large"):
        _coerce(MAX_EXACT_INTEGER + 1, "int", "x")
    with pytest.raises(TableError, match="too large"):
        _coerce(str(2**53 + 1), "int", "x")


@pytest.mark.parametrize("value", [2, 0, 1, "true", "1", None])
def test_ambiguous_booleans_are_refused(value):
    with pytest.raises(TableError):
        _coerce(value, "bool", "x")


def test_real_booleans_are_accepted():
    assert _coerce(True, "bool", "x") is True
    assert _coerce(np.bool_(False), "bool", "x") is False
    assert _coerce("True", "bool", "x") is True
