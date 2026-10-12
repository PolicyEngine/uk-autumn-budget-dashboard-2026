"""Regressions for the independent review of the publication gates (12 Oct).

Each test reproduces a way the reviewer published a wrong or unreceipted
number, or a way a check passed vacuously, and shows it is now refused.
"""

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from tests.publication_support import World, make_tables
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


def combined(world, manifest, members, values, **kwargs):
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
        **kwargs,
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


# --- W4: the dataset hash is taken at load, never at receipt time ---------


def test_a_simulation_with_no_load_time_hash_cannot_be_receipted(world):
    from uk_budget_data.publication import receipt as receipt_module
    from uk_budget_data.publication.receipt import ReceiptUnavailable

    sim = world.sim()
    del sim.policyengine_bundle["runtime_dataset_sha256"]
    revision = world.revision()
    inputs = receipt_module.ReceiptInputs(
        key="alpha",
        measure_ids=["alpha"],
        years=[2027],
        baseline_identity=receipt_module.scenario_identity(
            None, name="baseline", revision=revision
        ),
        reform_identity=receipt_module.scenario_identity(
            None, name="alpha", revision=revision
        ),
        file_digests={"budgetary_impact.csv": "a" * 64},
        basis={},
        revision=revision,
    )
    with pytest.raises(ReceiptUnavailable, match="without verifying"):
        receipt_module.build_receipt_document(sim, sim, inputs)


def test_a_local_dataset_is_hashed_before_the_simulation_reads_it(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from uk_budget_data import pipeline
    from uk_budget_data.publication.generate import _default_build

    dataset = tmp_path / "data.h5"
    dataset.write_bytes(b"bytes that ran")
    expected = __import__("hashlib").sha256(b"bytes that ran").hexdigest()

    def build(path, scenario):
        # Anything that changes the file after the simulation was built
        # must not change the recorded hash.
        sim = SimpleNamespace(policyengine_bundle={})
        dataset.write_bytes(b"bytes swapped in later")
        return sim

    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    sim = _default_build(str(dataset))
    assert sim.policyengine_bundle["runtime_dataset_sha256"] == expected


def test_a_materializer_hash_is_never_overwritten(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from uk_budget_data import pipeline
    from uk_budget_data.publication.generate import _default_build

    dataset = tmp_path / "data.h5"
    dataset.write_bytes(b"x")
    monkeypatch.setattr(
        pipeline,
        "build_microsimulation",
        lambda path, scenario: SimpleNamespace(
            policyengine_bundle={"runtime_dataset_sha256": "f" * 64}
        ),
    )
    assert _default_build(str(dataset)).policyengine_bundle[
        "runtime_dataset_sha256"
    ] == ("f" * 64)


# --- round 2 (partial report): three more gate bypasses -------------------


def test_an_unpublishable_artifact_with_no_reasons_is_refused(world):
    from uk_budget_data.publication.publish import gate_problems

    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES, clean=False)
    document = read_receipt(reference.path)
    document["dashboard"]["reasons"] = []
    (reference.path / "receipt.json").write_text(json.dumps(document))
    problems, _ = gate_problems(
        "alpha",
        reference.path,
        m.Manifest(),
        level=m.PROVISIONAL,
        **args(world),
    )
    assert any("not publishable" in p for p in problems)


def test_a_truncated_dataset_range_cannot_hide_a_year(world):
    reference = world.write("alpha", VALUES)
    document = read_receipt(reference.path)
    document["dashboard"]["dataset_years"] = [2028, 2029, 2030]
    document["dashboard"]["unsupported_years"] = [2027]
    problems = dashboard_problems(document)
    assert any("not exactly the reported years" in p for p in problems)
    assert any("leave out [2027]" in p for p in problems)


def test_a_combined_receipt_must_record_every_member(world):
    from uk_budget_data.publication.publish import _members_problems

    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    reference = combined(world, manifest, ["alpha", "beta"], {2027: -2.0})
    document = read_receipt(reference.path)
    document["dashboard"]["members"] = [
        r for r in document["dashboard"]["members"] if r["id"] == "alpha"
    ]
    problems = _members_problems(
        document, manifest, world.data_root, (m.APPROVED,)
    )
    assert any("member records do not match" in p for p in problems)


def test_exports_consume_exactly_the_bytes_they_checked(world, monkeypatch):
    from uk_budget_data.publication import exports

    manifest = m.Manifest()
    reference = approved(world, manifest, "alpha")
    m.save_manifest(manifest, world.data_root)
    real_check = exports.check

    def check_then_tamper(*a, **k):
        failures = real_check(*a, **k)
        table = reference.path / "budgetary_impact.csv"
        table.write_bytes(table.read_bytes().replace(b"-1.0", b"-9.0"))
        return failures

    monkeypatch.setattr(exports, "check", check_then_tamper)
    with pytest.raises(PublishError, match="does not match its receipt"):
        exports.load_approved(["alpha"], **args(world))


# --- round 2 (#20 review): copied entry fields stay bound to the receipt ---


def test_relabelling_a_combined_entry_with_other_members_is_caught(world):
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    approved(world, manifest, "gamma")
    old = combined(world, manifest, ["alpha", "beta"], {2027: -2.0})
    key = stage(manifest, old.path, **args(world))
    approve(manifest, key, "María", **args(world))
    assert check(manifest, **args(world)) == []

    # The reviewer's case: the manifest now claims Alpha and Gamma, with
    # their current outputs, while the receipt and approval are unchanged.
    entry = manifest.combined[key]
    entry.measures = ["alpha", "gamma"]
    entry.member_outputs_sha256 = {
        id: manifest.measures[id].outputs_sha256 for id in entry.measures
    }
    failures = check(manifest, **args(world))
    assert any("members are not the artifact's" in f for f in failures)
    assert any("member snapshot is not the artifact's" in f for f in failures)


@pytest.mark.parametrize(
    "field, value, message",
    [
        ("unsupported_years", [], "unsupported years are not"),
        ("years", [2027], "years are not the artifact's"),
        ("name", "Something else", "name is not the artifact's"),
        ("measures", ["alpha"], "names combined-run members"),
    ],
)
def test_a_measure_entry_cannot_restate_what_its_receipt_says(
    world, field, value, message
):
    # 2031 is beyond the dataset's projection, so the receipt reports it
    # unsupported: clearing that in the manifest would show its row.
    manifest = m.Manifest()
    approved(world, manifest, "alpha", {**VALUES, 2031: -3.0})
    assert manifest.measures["alpha"].unsupported_years == [2031]
    assert check(manifest, **args(world)) == []
    setattr(manifest.measures["alpha"], field, value)
    failures = check(manifest, **args(world))
    assert any(message in f for f in failures), failures


# --- round 3 (publication review) ------------------------------------------


def test_a_combined_receipt_must_be_its_members_composition(world):
    """Review round 3 (blocker): a combined artifact claiming Alpha and
    Beta, whose execution receipt bound Alpha alone, was approved."""
    from uk_budget_data.publication.receipt import receipt_api

    api, _ = receipt_api()
    manifest = m.Manifest()
    alpha = approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    alone = api.ReformIdentity.model_validate(
        read_receipt(alpha.path)["execution_receipt"]["reform"]
    )
    composed_alone = api.composed_reform_identity(
        [alone], applied_before_data_load=False, name="alpha+beta"
    )
    for identity in (alone, composed_alone):
        claim = combined(
            world,
            manifest,
            ["alpha", "beta"],
            {2027: -2.0},
            reform_identity=identity,
        )
        with pytest.raises(PublishError, match="not the composition"):
            stage(manifest, claim.path, **args(world))
    honest = combined(world, manifest, ["alpha", "beta"], {2027: -2.0})
    stage(manifest, honest.path, **args(world))


def test_a_combined_receipt_must_record_its_composition():
    from uk_budget_data.publication.receipt import composition_problems

    document = {
        "dashboard": {"members": [{"id": "alpha"}], "composition": None},
        "execution_receipt": {},
    }
    assert composition_problems(document) == [
        "it does not record how its members were composed"
    ]


def test_a_manifest_without_its_basis_or_with_another_identity_fails(world):
    """Review round 3: deleting the manifest's basis let a measure on
    another forecast be approved beside it, and an edited identity with
    its old digest checked clean."""
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    assert check(manifest, **args(world)) == []

    no_basis = manifest.model_copy(deep=True)
    no_basis.basis = None
    assert any(
        "no forecast and calibration basis" in f
        for f in check(no_basis, **args(world))
    )

    edited = manifest.model_copy(deep=True)
    edited.execution.identity["wrapper"]["version"] = "0.0.0"
    assert any(
        "execution identity is not the one it ran on" in f
        for f in check(edited, **args(world))
    )

    no_execution = manifest.model_copy(deep=True)
    no_execution.execution = None
    assert any(
        "records no execution identity" in f
        for f in check(no_execution, **args(world))
    )


def test_rows_for_years_the_receipt_does_not_report_are_refused(world):
    """Review round 3: rows for an undeclared 2028 were filtered out of the
    approval checks but still exported."""
    world.costing("alpha", {2027: -1.0, 2028: -9.0})
    reference = world.write(
        "alpha",
        {2027: -1.0},
        tables=make_tables("alpha", {2027: -1.0, 2028: -9.0}),
    )
    world.reconcile(reference)
    with pytest.raises(PublishError, match="does not report: \\[2028\\]"):
        stage(m.Manifest(), reference.path, **args(world))


def test_the_gate_reconciles_the_bytes_it_verified(world, monkeypatch):
    """Review round 3: a table replaced between the integrity check and
    reconciliation was reconciled unverified."""
    from uk_budget_data.publication import publish

    manifest = m.Manifest()
    reference = approved(world, manifest, "alpha")
    world.costing("alpha", {2027: -9.0, 2028: -2.0})
    assert any(
        "reconciliation is failed" in f for f in check(manifest, **args(world))
    )

    real = publish.captured_file_problems
    table = reference.path / "budgetary_impact.csv"
    original = table.read_bytes()

    def check_then_replace(captured):
        problems = real(captured)
        table.write_bytes(original.replace(b"-1.0", b"-9.0"))
        return problems

    monkeypatch.setattr(publish, "captured_file_problems", check_then_replace)
    try:
        failures = check(manifest, **args(world))
    finally:
        table.write_bytes(original)
    assert any("reconciliation is failed" in f for f in failures)


def test_the_simulation_loads_exactly_the_bytes_that_were_hashed(
    tmp_path, monkeypatch
):
    """Review round 3: a dataset swapped in while the simulation loaded it,
    and restored afterwards, ran without its hash describing it."""
    import hashlib
    from types import SimpleNamespace

    from uk_budget_data import pipeline
    from uk_budget_data.publication.generate import _default_build

    dataset = tmp_path / "enhanced_frs_2024_25.h5"
    dataset.write_bytes(b"certified bytes")
    loaded = []

    def build(path, scenario):
        dataset.write_bytes(b"other bytes")
        loaded.append(Path(path).read_bytes())
        dataset.write_bytes(b"certified bytes")
        return SimpleNamespace(policyengine_bundle={})

    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    sim = _default_build(str(dataset))
    assert loaded == [b"certified bytes"]
    assert (
        sim.policyengine_bundle["runtime_dataset_sha256"]
        == hashlib.sha256(loaded[0]).hexdigest()
    )
