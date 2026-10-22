"""Regressions for the independent review of the publication gates (12 Oct).

Each test reproduces a way the reviewer published a wrong or unreceipted
number, or a way a check passed vacuously, and shows it is now refused.
"""

import json
import shutil
from importlib import metadata
from pathlib import Path

import numpy as np
import pytest
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import PROJECTION_END, World, make_tables
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
from uk_budget_data.publication.reconcile import ReconciliationInputError
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
    assert any(
        f"projects to {PROJECTION_END}" in problem for problem in problems
    )


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
        data_limits=[],
        model_limits=[],
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
    # A year beyond the dataset's projection is reported unsupported:
    # clearing that in the manifest would show its row.
    beyond = PROJECTION_END + 1
    manifest = m.Manifest()
    approved(world, manifest, "alpha", {**VALUES, beyond: -3.0})
    assert manifest.measures["alpha"].unsupported_years == [beyond]
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
    # Reconciliation refuses them first (#17), and staging still does.
    with pytest.raises(ReconciliationInputError, match="does not report"):
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


# --- round 4 (publication review) ------------------------------------------


def _member_records(world, manifest, members=("alpha", "beta")):
    records = []
    for member in members:
        own = read_receipt(
            world.data_root / manifest.measures[member].artifact
        )["execution_receipt"]
        records.append(
            {
                "id": member,
                "baseline": dict(own["baseline"]),
                "reform": dict(own["reform"]),
            }
        )
    return records


def _claim(world, manifest, records):
    ids = [record["id"] for record in records]
    return world.write(
        "combined--" + "+".join(ids),
        {2027: -2.0, 2028: -4.0},
        members=records,
        measure_ids=ids,
        member_outputs={
            member: manifest.measures[member].outputs_sha256 for member in ids
        },
    )


def test_a_members_own_baseline_cannot_be_left_out(world):
    """Review round 4 (blocker): two members with the same baseline of
    their own each have it applied; marking one unapplied was accepted."""
    from uk_budget_data.publication.receipt import composition_problems

    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    # Any identity other than the configured baseline is a member's own.
    own_baseline = _member_records(world, manifest)[0]["reform"]

    def records(flags):
        made = _member_records(world, manifest)
        for record, flag in zip(made, flags):
            record["baseline"] = dict(own_baseline)
            record["baseline_bound"] = flag
        return made

    honest = read_receipt(_claim(world, manifest, records([True, True])).path)
    assert composition_problems(honest) == []
    forged = read_receipt(_claim(world, manifest, records([True, False])).path)
    assert any(
        "beta has its own baseline" in p for p in composition_problems(forged)
    )


@pytest.mark.parametrize(
    "field, value",
    [
        ("representation", "policyengine.reform_dict/v1"),
        ("binding", "code_revision"),
    ],
)
def test_a_member_record_must_be_its_published_identity(world, field, value):
    """Review round 4: only kind and digest were compared with the member's
    own receipt, so a record could restate its representation or binding."""
    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    records = _member_records(world, manifest)
    assert records[1]["reform"][field] != value
    records[1]["reform"][field] = value
    claim = _claim(world, manifest, records)
    with pytest.raises(PublishError, match="different reform definition"):
        stage(manifest, claim.path, **args(world))


def test_an_invalid_unapplied_baseline_is_a_problem_not_a_crash(world):
    """Review round 4: an unapplied baseline was never validated, and a
    malformed one crashed staging."""
    from uk_budget_data.publication.receipt import composition_problems

    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    reference = _claim(world, manifest, _member_records(world, manifest))
    document = read_receipt(reference.path)
    document["dashboard"]["members"][1]["baseline_bound"] = False
    document["dashboard"]["members"][1]["baseline"]["binding"] = []
    problems = composition_problems(document)
    assert problems and "cannot be composed" in problems[0]


# --- round 5 (publication review) ------------------------------------------


def test_a_structural_baseline_cannot_pass_as_the_configured_one(world):
    """Review round 5 (blocker): copying a member's structural baseline
    into the configured-baseline field let one of its applications be
    left out. Only a configured baseline of current law or parameter
    changes may be shared."""
    from tests.fixed_shape_measures import module_level_modifier
    from uk_budget_data.publication.receipt import (
        composition_problems,
        scenario_identity,
    )

    manifest = m.Manifest()
    approved(world, manifest, "alpha")
    approved(world, manifest, "beta")
    structural = json.loads(
        scenario_identity(
            Scenario(simulation_modifier=module_level_modifier),
            name="structural baseline",
            revision=world.revision(),
        ).model_dump_json()
    )
    assert structural["binding"] == "code_revision"
    records = _member_records(world, manifest)
    for record, flag in zip(records, (True, False)):
        record["baseline"] = dict(structural)
        record["baseline_bound"] = flag
    ids = [record["id"] for record in records]
    forged = world.write(
        "combined--" + "+".join(ids),
        {2027: -2.0},
        members=records,
        measure_ids=ids,
        member_outputs={
            member: manifest.measures[member].outputs_sha256 for member in ids
        },
        config_baseline=structural,
    )
    assert any(
        "beta has its own baseline" in p
        for p in composition_problems(read_receipt(forged.path))
    )


def test_an_honest_configured_parameter_baseline_is_shared(world):
    """Review round 5: the configured baseline was bound as a reform
    dictionary and its members' as a scenario, so honest sharing of a
    configured parameter baseline was refused."""
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication.generate import _config_baseline_identity
    from uk_budget_data.publication.receipt import (
        combined_identities,
        composition_problems,
    )

    members = [
        Reform(
            id=name,
            name=name.title(),
            parameter_changes={
                f"gov.hmrc.income_tax.rates.uk[{index}].rate": {"2027": rate}
            },
        )
        for index, name, rate in ((0, "alpha", 0.21), (1, "beta", 0.41))
    ]
    config = DataConfig(
        years=[2027],
        baseline_parameter_changes={
            "gov.hmrc.income_tax.allowances.personal_allowance.amount": {
                "2027": 13000
            }
        },
    )
    revision = world.revision()
    baseline, reform, records, composition = combined_identities(
        members,
        config,
        revision,
        reform_applied_before_data_load=False,
        baseline_applied_before_data_load=False,
    )
    assert [r["baseline_bound"] for r in records] == [True, False]
    document = {
        "dashboard": {
            "members": records,
            "composition": composition,
            "config_baseline": json.loads(
                _config_baseline_identity(config, revision).model_dump_json()
            ),
        },
        "execution_receipt": {
            "baseline": json.loads(baseline.model_dump_json()),
            "reform": json.loads(reform.model_dump_json()),
        },
    }
    assert composition_problems(document) == []


def test_only_a_receipt_module_with_the_current_rules_is_adopted(
    world, monkeypatch
):
    """Review round 5: any module with the right names was adopted as the
    released one, including an older copy without supported_years or the
    module-shape rules."""
    import sys
    import types

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate
    from uk_budget_data.publication import receipt as adapter

    released, source = adapter.receipt_api()
    assert source == f"policyengine=={metadata.version('policyengine')}"
    assert adapter._has_what_we_need(released)

    class OldReceipt:
        model_fields = {"years": None}

    older = types.ModuleType("policyengine.provenance.receipt")
    for name in (*adapter._REQUIRED_API, "NONFINITE_KEY", "loaded_versions"):
        setattr(older, name, getattr(released, name))
    older.ExecutionReceipt = OldReceipt
    package = types.ModuleType("policyengine.provenance")
    package.receipt = older
    monkeypatch.setitem(sys.modules, "policyengine.provenance", package)
    monkeypatch.setitem(sys.modules, "policyengine.provenance.receipt", older)
    assert not adapter._has_what_we_need(older)
    with pytest.raises(RuntimeError) as failure:
        adapter.receipt_api()
    assert not isinstance(failure.value, adapter.ReceiptUnavailable)
    assert source in str(failure.value)
    assert "packaging defect" in str(failure.value).lower()

    # A defective installation stops generation instead of becoming a
    # measure refusal that allows the rest of publication to continue.
    monkeypatch.setattr(
        generate, "code_revision", lambda root: world.revision()
    )
    with pytest.raises(RuntimeError, match="packaging defect"):
        generate.generate_artifacts(
            [_measure("alpha", 0, False)],
            DataConfig(years=[2027, 2028]),
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=fake_process({"alpha": VALUES}),
        )


def test_a_missing_released_receipt_module_is_a_packaging_defect(monkeypatch):
    import sys
    import types

    from uk_budget_data.publication import receipt as adapter

    monkeypatch.setitem(
        sys.modules, "policyengine.provenance", types.ModuleType("provenance")
    )
    monkeypatch.setitem(sys.modules, "policyengine.provenance.receipt", None)
    with pytest.raises(RuntimeError) as failure:
        adapter.receipt_api()
    assert not isinstance(failure.value, adapter.ReceiptUnavailable)
    assert f"policyengine=={metadata.version('policyengine')}" in str(
        failure.value
    )
    assert "packaging defect" in str(failure.value).lower()
    assert isinstance(failure.value.__cause__, ImportError)


# --- round 6 (publication review) ------------------------------------------


def test_an_unused_configured_baseline_cannot_stop_a_measure(world):
    """Review round 6: the configured baseline was bound before any run,
    so a malformed one stopped a measure that brings its own baseline."""
    from unittest.mock import patch

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication import generate

    path = "gov.hmrc.income_tax.rates.uk[0].rate"
    values = {2027: -1.0, 2028: -2.0}
    config = DataConfig(
        years=[2027, 2028],
        baseline_parameter_changes={path: {"2027": None}},
    )
    member = Reform(
        id="alpha",
        name="Alpha",
        parameter_changes={path: {"2027": 0.21}},
        baseline_parameter_changes={path: {"2027": 0.19}},
    )
    with patch.object(
        generate, "code_revision", lambda root: world.revision()
    ):
        report = generate.generate_artifacts(
            [member],
            config,
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=fake_process({"alpha": values}),
        )
    assert [r.key for r in report.written] == ["alpha"]
    assert report.refused == {}


def test_a_package_upgraded_after_loading_cannot_be_receipted(
    world, monkeypatch
):
    """policyengine.py#571 (round 9): a receipt names the installed
    versions, so a package upgraded after it was loaded would be named as
    code that did not run. Importing the dashboard records the versions
    before any simulation, and the receipt refuses a mismatch."""
    from policyengine.provenance import loaded

    monkeypatch.setitem(loaded._LOADED, "policyengine-uk", "0.0.0")
    with pytest.raises(Exception, match="installed now"):
        world.write("alpha", VALUES)


# --- round 7 (publication review) ------------------------------------------


def _bad_config_runs(world, measures, combined_sets=None):
    from unittest.mock import patch

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate

    path = "gov.hmrc.income_tax.rates.uk[0].rate"
    config = DataConfig(
        years=[2027, 2028],
        baseline_parameter_changes={path: {"2027": None}},
    )
    values = {2027: -1.0, 2028: -2.0}
    keys = [m.id for m in measures] + [
        "combined--" + "+".join(sorted(x.id for x in members))
        for members in combined_sets or []
    ]
    with patch.object(
        generate, "code_revision", lambda root: world.revision()
    ):
        return generate.generate_artifacts(
            measures,
            config,
            combined_sets=combined_sets,
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=fake_process(dict.fromkeys(keys, values)),
        )


def _measure(name, index, own_baseline):
    from uk_budget_data.models import Reform

    path = f"gov.hmrc.income_tax.rates.uk[{index}].rate"
    return Reform(
        id=name,
        name=name.title(),
        parameter_changes={path: {"2027": 0.21 + index / 100}},
        baseline_parameter_changes=(
            {path: {"2027": 0.19 + index / 100}} if own_baseline else None
        ),
    )


def test_a_run_using_a_malformed_configured_baseline_refuses_only_itself(
    world,
):
    """Review round 7: a run that used the malformed configured baseline
    raised out of generation, so later measures were never written."""
    report = _bad_config_runs(
        world, [_measure("beta", 1, False), _measure("alpha", 0, True)]
    )
    assert [r.key for r in report.written] == ["alpha"]
    assert "invalid scenario" in report.refused["beta"]


def test_a_combined_set_of_own_baselines_ignores_the_configured_one(world):
    """Review round 7: a combined set whose members all bring their own
    baselines still bound the configured baseline, and was refused."""
    alpha, gamma = _measure("alpha", 0, True), _measure("gamma", 1, True)
    report = _bad_config_runs(world, [alpha, gamma], [[alpha, gamma]])
    assert report.refused == {}
    assert sorted(r.key for r in report.written) == [
        "alpha",
        "combined--alpha+gamma",
        "gamma",
    ]


@pytest.mark.parametrize("skip_country_imports", [False, True])
def test_versions_are_recorded_before_the_model_and_dashboard_pipeline_load(
    skip_country_imports,
):
    """The shared recorder runs while importing the dashboard, before the
    UK model and dashboard pipeline load, and keeps its first versions.

    Normally policyengine's UK wrapper records them as it is imported,
    with core loaded. With POLICYENGINE_SKIP_COUNTRY_IMPORTS=1 it is not
    imported, and the dashboard's own call records them first. The
    environment is set explicitly: scripts/check_public_data.py sets that
    variable when imported, and a test importing it leaks it to this
    worker's subprocesses."""
    import os
    import subprocess
    import sys
    from textwrap import dedent

    probe = dedent(
        """\
        import json
        import sys
        from importlib import metadata

        real = metadata.version
        seen = {}
        tracked = (
            'policyengine_uk', 'policyengine_core',
            'uk_budget_data.models', 'uk_budget_data.pipeline',
        )
        def spy(name):
            caller = sys._getframe(1).f_globals.get('__name__')
            if caller == 'policyengine.provenance.loaded':
                seen.setdefault(name, [m in sys.modules for m in tracked])
            return real(name)
        metadata.version = spy
        import uk_budget_data
        from policyengine.provenance.loaded import (
            loaded_versions, record_loaded_versions,
        )
        names = ('policyengine', 'policyengine-uk', 'policyengine-core')
        original = loaded_versions()
        metadata.version = lambda name: 'changed-after-import'
        record_loaded_versions(names)
        print(json.dumps({
            'seen': seen,
            'recorded': original,
            'installed': {name: real(name) for name in names},
            'after': loaded_versions(),
        }))
        """
    )
    env = {
        name: value
        for name, value in os.environ.items()
        if name != "POLICYENGINE_SKIP_COUNTRY_IMPORTS"
    }
    if skip_country_imports:
        env["POLICYENGINE_SKIP_COUNTRY_IMPORTS"] = "1"
    output = json.loads(
        subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            check=True,
            env=env,
        ).stdout.splitlines()[-1]
    )
    assert output["recorded"] == output["installed"]
    assert output["after"] == output["recorded"]
    # Before the UK model and before dashboard code that can build a
    # simulation; the wrapper has imported core when it records.
    core_loaded = not skip_country_imports
    assert output["seen"] == {
        name: [False, core_loaded, False, False]
        for name in ("policyengine", "policyengine-uk", "policyengine-core")
    }


def test_a_receipt_module_without_the_version_recorder_is_not_adopted():
    """Review round 7: the capability check did not require the recorder."""
    import types

    from uk_budget_data.publication import receipt as adapter

    released, _ = adapter.receipt_api()
    without = types.ModuleType("receipt_without_recorder")
    for name in (*adapter._REQUIRED_API, "NONFINITE_KEY"):
        setattr(without, name, getattr(released, name))
    assert not adapter._has_what_we_need(without)
    without.loaded_versions = released.loaded_versions
    assert adapter._has_what_we_need(without)


# --- round 8 (publication review) ------------------------------------------


def test_a_calculator_failure_is_raised_not_called_an_invalid_scenario(
    world,
):
    """Review round 8: the catch for scenarios a configuration cannot build
    covered the whole run, so a calculator bug became a quiet refusal."""
    from unittest.mock import patch

    from pydantic import ValidationError

    from uk_budget_data.models import DataConfig, ReformResult
    from uk_budget_data.publication import generate

    def broken_process(reform, config, baseline, reformed, baseline_scenario):
        return ReformResult(
            reform_id=reform.id, reform_name=reform.name, constituency="x"
        )

    with patch.object(
        generate, "code_revision", lambda root: world.revision()
    ):
        with pytest.raises(ValidationError):
            generate.generate_artifacts(
                [_measure("alpha", 0, False)],
                DataConfig(years=[2027, 2028]),
                artifacts_root=world.artifacts,
                build=lambda dataset, scenario=None: world.sim(),
                process=broken_process,
            )


def test_members_with_empty_own_baselines_never_use_the_configured_one(world):
    """Review round 8: members whose own baselines were empty made the
    combined baseline empty, and the run fell back to the configured
    baseline while its receipt said current law."""
    from unittest.mock import patch

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication import generate

    configured = "gov.hmrc.income_tax.rates.uk[2].rate"
    config = DataConfig(
        years=[2027, 2028],
        baseline_parameter_changes={configured: {"2027": 0.5}},
    )
    members = [
        Reform(
            id=name,
            name=name.title(),
            parameter_changes={
                f"gov.hmrc.income_tax.rates.uk[{index}].rate": {"2027": rate}
            },
            baseline_parameter_changes={},
        )
        for index, name, rate in ((0, "alpha", 0.21), (1, "beta", 0.41))
    ]
    scenarios = []

    def build(dataset, scenario=None):
        scenarios.append(scenario)
        return world.sim()

    values = {2027: -1.0, 2028: -2.0}
    with patch.object(
        generate, "code_revision", lambda root: world.revision()
    ):
        report = generate.generate_artifacts(
            members,
            config,
            combined_sets=[members],
            artifacts_root=world.artifacts,
            build=build,
            process=fake_process(
                {
                    "alpha": values,
                    "beta": values,
                    "combined--alpha+beta": values,
                }
            ),
        )
    assert report.refused == {}
    assert not any(
        scenario is not None
        and configured in (scenario.parameter_changes or {})
        for scenario in scenarios
    )


def test_the_income_curve_uses_the_run_baseline_through_the_processor(world):
    """Review round 9: the processor worked out the income curve's baseline
    again with its own rule, so members with empty own baselines got the
    configured baseline for the curve while every other table, the receipt
    and the gate used current law. The real processor now takes the run's
    baseline scenario."""
    from unittest.mock import patch

    from tests.test_pipeline import _processor_with_spies
    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication import generate

    configured = "gov.hmrc.income_tax.rates.uk[2].rate"
    config = DataConfig(
        years=[2027, 2028],
        baseline_parameter_changes={configured: {"2027": 0.5}},
    )
    members = [
        Reform(
            id=name,
            name=name.title(),
            parameter_changes={
                f"gov.hmrc.income_tax.rates.uk[{index}].rate": {"2027": rate}
            },
            baseline_parameter_changes={},
        )
        for index, name, rate in ((0, "alpha", 0.21), (1, "beta", 0.41))
    ]
    values = {2027: -1.0, 2028: -2.0}
    tables = fake_process(
        dict.fromkeys(["alpha", "beta", "combined--alpha+beta"], values)
    )
    built = {}
    curves = {}

    def build(dataset, scenario=None):
        sim = world.sim()
        built[id(sim)] = scenario
        return sim

    def process(reform, config, baseline, reformed, baseline_scenario):
        processor = _processor_with_spies(reform, config)
        processor.process(baseline, reformed, baseline_scenario)
        calls = processor.income_curve_calc.calls
        assert len(calls) == len(config.years)
        curves[reform.id] = (
            [call[0] for call in calls],
            built[id(baseline)],
        )
        return tables(reform, config, baseline, reformed, baseline_scenario)

    with patch.object(
        generate, "code_revision", lambda root: world.revision()
    ):
        report = generate.generate_artifacts(
            members,
            config,
            combined_sets=[members],
            artifacts_root=world.artifacts,
            build=build,
            process=process,
        )
    assert report.refused == {}
    assert set(curves) == {"alpha", "beta", "combined--alpha+beta"}
    for curve_scenarios, population in curves.values():
        for curve in curve_scenarios:
            # The curve's baseline is the population's, object for object...
            assert curve is population
            # ...and neither falls back to the configured baseline.
            assert curve is None or configured not in (
                curve.parameter_changes or {}
            )


def test_the_default_process_hands_the_baseline_scenario_on():
    from unittest.mock import patch

    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.pipeline import ReformProcessor
    from uk_budget_data.publication.generate import _default_process

    seen = []
    scenario = object()

    def record(self, baseline, reformed, baseline_scenario):
        seen.append(baseline_scenario)

    with patch.object(ReformProcessor, "process", record):
        _default_process(
            Reform(id="m", name="M"),
            DataConfig(years=[2027]),
            object(),
            object(),
            scenario,
        )
    assert seen == [scenario]


def test_a_receipt_model_failing_validation_is_raised_not_refused(world):
    """Review round 9: a receipt model's ValidationError while the
    current-law side was bound was reported as an invalid scenario."""
    from unittest.mock import patch

    from pydantic import BaseModel, ValidationError

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate, receipt

    class ReformIdentity(BaseModel):
        name: int

    api, _ = receipt.receipt_api()

    def broken(*args, **kwargs):
        ReformIdentity(name="not a number")

    with (
        patch.object(generate, "code_revision", lambda root: world.revision()),
        patch.object(api, "reform_identity", broken),
    ):
        with pytest.raises(ValidationError, match="ReformIdentity"):
            generate.generate_artifacts(
                [_measure("alpha", 0, False)],
                DataConfig(years=[2027, 2028]),
                artifacts_root=world.artifacts,
                build=lambda dataset, scenario=None: world.sim(),
                process=fake_process({"alpha": {2027: -1.0, 2028: -2.0}}),
            )


class _BrokenIdentity:
    """A receipt function that fails a receipt model's own validation, for
    the call whose ``name`` matches (or every call)."""

    def __init__(self, real, only_name=None):
        self.real = real
        self.only_name = only_name

    def __call__(self, *args, **kwargs):
        from pydantic import BaseModel

        class ReformIdentity(BaseModel):
            name: int

        if self.only_name is None or kwargs.get("name") == self.only_name:
            ReformIdentity(name="not a number")
        return self.real(*args, **kwargs)


@pytest.mark.parametrize(
    "function, only_name, combined, configured",
    [
        # A measure's own side, bound from its Scenario.
        ("scenario_reform_identity", None, False, False),
        # The configured baseline, bound when a run first records it.
        ("scenario_reform_identity", "configured baseline", False, True),
        # A combined run's composed identities.
        ("composed_reform_identity", None, True, False),
    ],
    ids=["measure", "configured baseline", "combined"],
)
def test_no_adapter_reports_a_receipt_model_defect_as_a_refusal(
    world, function, only_name, combined, configured
):
    """Review round 10: pydantic's ValidationError is a ValueError, so the
    adapters that turn a measure's ValueError into a refusal also swallowed
    a receipt model failing its own validation, on every path but the
    current-law one fixed in round 9."""
    from unittest.mock import patch

    from pydantic import ValidationError

    from tests.test_publication_flow import fake_process
    from uk_budget_data.models import DataConfig
    from uk_budget_data.publication import generate, receipt

    api, _ = receipt.receipt_api()
    members = [_measure("alpha", 0, True), _measure("beta", 1, True)]
    reforms = members if combined else [_measure("alpha", 0, not configured)]
    config = DataConfig(
        years=[2027, 2028],
        baseline_parameter_changes=(
            {"gov.hmrc.income_tax.rates.uk[2].rate": {"2027": 0.46}}
            if configured
            else None
        ),
    )
    values = {2027: -1.0, 2028: -2.0}
    broken = _BrokenIdentity(getattr(api, function), only_name)
    with (
        patch.object(generate, "code_revision", lambda root: world.revision()),
        patch.object(api, function, broken),
    ):
        with pytest.raises(ValidationError, match="ReformIdentity"):
            generate.generate_artifacts(
                reforms,
                config,
                combined_sets=[members] if combined else None,
                artifacts_root=world.artifacts,
                build=lambda dataset, scenario=None: world.sim(),
                process=fake_process(
                    dict.fromkeys(
                        ["alpha", "beta", "combined--alpha+beta"], values
                    )
                ),
            )


def test_a_code_defect_is_any_model_but_a_scenario_or_a_reform():
    from pydantic import BaseModel, ValidationError

    from uk_budget_data.models import Reform
    from uk_budget_data.publication.receipt import is_code_defect

    class ReformIdentity(BaseModel):
        name: int

    def error_of(build):
        with pytest.raises(ValidationError) as caught:
            build()
        return caught.value

    assert is_code_defect(error_of(lambda: ReformIdentity(name="x")))
    assert not is_code_defect(
        error_of(lambda: Scenario(parameter_changes={"a": "x"}))
    )
    assert not is_code_defect(
        error_of(lambda: Reform(id="a", name="A", parameter_changes="x"))
    )
    assert not is_code_defect(ValueError("an ordinary refusal"))
