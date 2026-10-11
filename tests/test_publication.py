"""Tests for canonical tables, artifacts, receipts and the manifest gates."""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import (
    DATASET_YEARS,
    RATE_PATH,
    YEARS,
    World,
    make_tables,
    module_level_modifier,
)
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import receipt as receipt_module
from uk_budget_data.publication.artifacts import (
    ArtifactError,
    file_problems,
    read_receipt,
    read_tables,
    write_artifact,
)
from uk_budget_data.publication.exports import load_approved
from uk_budget_data.publication.publish import (
    PublishError,
    approve,
    check,
    stage,
    withdraw,
)
from uk_budget_data.publication.receipt import ReceiptUnavailable
from uk_budget_data.publication.tables import (
    TableError,
    canonical_csv,
    in_scatter_sample,
    parse_csv,
    sample_scatter,
)
from uk_budget_data.publication.validate import table_problems

VALUES = {2027: -1.0, 2028: -2.0}


@pytest.fixture
def world():
    instance = World()
    yield instance
    instance.close()


def snapshot(directory: Path) -> dict[str, str]:
    """Digest of every immutable file under an artifacts directory."""
    return {
        str(path.relative_to(directory)): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name != "reconciliation.json"
    }


# --- canonical tables -----------------------------------------------------

budget_rows = st.lists(
    st.tuples(
        st.integers(2026, 2031),
        st.floats(-1e3, 1e3, allow_nan=False, allow_infinity=False),
    ),
    min_size=1,
    max_size=6,
    unique_by=lambda row: row[0],
).map(
    lambda rows: [
        {"reform_id": "m", "reform_name": "M", "year": y, "value": v}
        for y, v in rows
    ]
)


@given(rows=budget_rows, data=st.data())
def test_canonical_bytes_ignore_row_order_and_round_trip(rows, data):
    shuffled = data.draw(st.permutations(rows))
    canonical = canonical_csv("budgetary_impact", rows)
    assert canonical_csv("budgetary_impact", shuffled) == canonical
    parsed = parse_csv("budgetary_impact", canonical)
    assert canonical_csv("budgetary_impact", parsed) == canonical
    assert [row["value"] for row in parsed] == [
        row["value"] for row in sorted(rows, key=lambda r: r["year"])
    ]
    assert canonical.endswith(b"\n") and b"\r" not in canonical


@given(rows=budget_rows, bump=st.floats(1e-6, 10))
def test_any_changed_value_changes_the_bytes(rows, bump):
    changed = [dict(row) for row in rows]
    changed[0]["value"] = changed[0]["value"] + bump
    if changed[0]["value"] != rows[0]["value"]:
        assert canonical_csv("budgetary_impact", changed) != canonical_csv(
            "budgetary_impact", rows
        )


@pytest.mark.parametrize(
    "row, message",
    [
        (
            {"reform_id": "m", "reform_name": "M", "year": 2027},
            "missing columns",
        ),
        (
            {
                "reform_id": "m",
                "reform_name": "M",
                "year": 2027,
                "value": 1,
                "x": 2,
            },
            "unexpected columns",
        ),
        (
            {
                "reform_id": "m",
                "reform_name": "M",
                "year": 2027,
                "value": math.nan,
            },
            "missing value",
        ),
        (
            {
                "reform_id": "m",
                "reform_name": "M",
                "year": 2027,
                "value": math.inf,
            },
            "not finite",
        ),
        (
            {"reform_id": "m", "reform_name": "M", "year": 2027.5, "value": 1},
            "whole number",
        ),
    ],
)
def test_untrustworthy_rows_are_refused(row, message):
    with pytest.raises(TableError, match=message):
        canonical_csv("budgetary_impact", [row])


def test_duplicate_keys_are_refused():
    row = {"reform_id": "m", "reform_name": "M", "year": 2027, "value": 1.0}
    with pytest.raises(TableError, match="duplicate key"):
        canonical_csv("budgetary_impact", [row, dict(row)])


def test_float32_is_written_as_its_own_shortest_decimal():
    row = {
        "reform_id": "m",
        "reform_name": "M",
        "year": np.int64(2027),
        "value": np.float32(1.6612566),
    }
    assert b"1.6612566\n" in canonical_csv("budgetary_impact", [row])


@given(st.integers(0, 10**9))
def test_scatter_sample_depends_only_on_the_household(household_id):
    chosen = in_scatter_sample(household_id, 25)
    rows = [
        {"household_id": household_id, "year": year, "reform_id": measure}
        for year in (2027, 2028)
        for measure in ("a", "b")
    ]
    assert len(sample_scatter(rows, 25)) == (len(rows) if chosen else 0)


# --- artifacts ------------------------------------------------------------


def test_generating_one_measure_never_touches_another(world):
    first = world.write("alpha", VALUES)
    before = snapshot(world.artifacts)
    world.write("beta", {2027: 3.0, 2028: 4.0})
    world.write("alpha", {2027: -1.5, 2028: -2.5})  # a correction
    after = snapshot(world.artifacts)
    assert {k: v for k, v in after.items() if k in before} == before
    assert first.path.exists()
    assert len(list((world.artifacts / "alpha").iterdir())) == 2


def test_rewriting_identical_outputs_is_a_no_op(world):
    first = world.write("alpha", VALUES)
    again = world.write("alpha", VALUES)
    assert first.created and not again.created
    assert again.path == first.path


def test_artifact_refuses_other_measures_rows_and_bad_keys(world):
    tables = make_tables("alpha", VALUES)
    tables["metrics"][0]["reform_id"] = "beta"
    with pytest.raises(ArtifactError, match="rows for"):
        world.write("alpha", VALUES, tables=tables)
    with pytest.raises(ArtifactError, match="invalid artifact key"):
        write_artifact({}, "../escape", lambda digests: {}, world.artifacts)
    incomplete = make_tables("alpha", VALUES)
    incomplete["metrics"] = []
    with pytest.raises(ArtifactError, match="required table metrics"):
        world.write("alpha", VALUES, tables=incomplete)


def test_tampering_with_a_file_is_detected(world):
    reference = world.write("alpha", VALUES)
    document = read_receipt(reference.path)
    assert file_problems(reference.path, document) == []
    target = reference.path / "budgetary_impact.csv"
    target.write_bytes(target.read_bytes().replace(b"-1.0", b"-9.0"))
    assert file_problems(reference.path, document) == [
        "budgetary_impact.csv does not match its recorded digest"
    ]


def test_tables_read_back_complete(world):
    reference = world.write("alpha", VALUES)
    tables = read_tables(reference.path)
    assert table_problems(tables, key="alpha", years=YEARS) == []
    tables["distributional_impact"] = tables["distributional_impact"][1:]
    tables["winners_losers"] = [
        row for row in tables["winners_losers"] if row["year"] != 2028
    ]
    problems = table_problems(tables, key="alpha", years=YEARS)
    assert "distributional_impact: 2027 has 9 rows, expected 10" in problems
    assert "winners_losers: missing 2028" in problems


def test_an_effect_before_the_start_year_is_a_problem(world):
    tables = read_tables(world.write("alpha", VALUES).path)
    problems = table_problems(
        tables, key="alpha", years=YEARS, effective_from_year=2028
    )
    assert any("before the measure starts in 2028" in p for p in problems)


# --- receipts -------------------------------------------------------------


def test_receipt_is_certified_and_consistent(world):
    document = read_receipt(world.write("alpha", VALUES).path)
    assert document["execution_receipt"]["certification_status"] == "certified"
    assert document["dashboard"]["publishable"] is True
    assert receipt_module.document_problems(document) == []
    assert document["dashboard"]["receipt_source"].startswith(
        ("vendored-w4", "policyengine==")
    )


def test_different_dataset_bytes_are_never_certified(world):
    other = world.root / "other.h5"
    other.write_bytes(b"some other dataset")
    document = read_receipt(world.write("alpha", VALUES, dataset=other).path)
    assert (
        document["execution_receipt"]["certification_status"] == "uncertified"
    )
    assert document["dashboard"]["publishable"] is False
    assert document["dashboard"]["reasons"] == [
        "the model and data pair is not certified"
    ]


def test_dirty_tree_is_not_publishable(world):
    document = read_receipt(world.write("alpha", VALUES, clean=False).path)
    assert document["dashboard"]["publishable"] is False
    assert "uncommitted changes" in document["dashboard"]["reasons"][0]


def test_years_beyond_the_dataset_are_unsupported(world):
    document = read_receipt(
        world.write("alpha", {2030: -1.0, 2031: -1.0}).path
    )
    assert document["dashboard"]["dataset_years"] == DATASET_YEARS
    assert document["dashboard"]["unsupported_years"] == [2031]


def test_a_tampered_receipt_is_detected(world):
    document = read_receipt(world.write("alpha", VALUES).path)
    document["execution_receipt"]["model"]["version"] = "0.0.1"
    assert receipt_module.document_problems(document)


def test_only_module_level_modifiers_can_be_bound(world):
    revision = world.revision()
    bound = receipt_module.scenario_identity(
        Scenario(simulation_modifier=module_level_modifier),
        name="structural",
        revision=revision,
    )
    assert bound.binding == "code_revision"

    def closure(sim):
        return sim

    with pytest.raises(ReceiptUnavailable, match="closure"):
        receipt_module.scenario_identity(
            Scenario(simulation_modifier=closure),
            name="closure",
            revision=revision,
        )


def test_non_finite_parameter_values_cannot_be_bound(world):
    scenario = Scenario(parameter_changes={RATE_PATH: {"2027": math.inf}})
    with pytest.raises(ReceiptUnavailable):
        receipt_module.scenario_identity(
            scenario, name="no cap", revision=world.revision()
        )


def test_current_law_is_bound_as_current_law(world):
    identity = receipt_module.scenario_identity(
        Scenario(), name="x", revision=world.revision()
    )
    assert identity.kind == "current_law"
    assert (
        receipt_module.scenario_identity(
            None, name="x", revision=world.revision()
        ).kind
        == "current_law"
    )


# --- staging and approval -------------------------------------------------


def staged(world, key="alpha", values=VALUES, **kwargs):
    manifest = m.Manifest()
    reference = world.ready(key, values)
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
        **kwargs,
    )
    return manifest, reference


def test_stage_then_approve(world):
    manifest, reference = staged(world)
    entry = manifest.measures["alpha"]
    assert entry.status == m.STAGED
    assert entry.artifact == f"artifacts/alpha/{reference.path.name}"
    assert manifest.execution.execution_identity_sha256 == (
        reference.execution_identity_sha256
    )
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    entry = manifest.measures["alpha"]
    assert entry.status == m.APPROVED
    assert entry.approval.outputs_sha256 == reference.outputs_sha256
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )


def test_unreconciled_artifact_cannot_be_staged(world):
    reference = world.write("alpha", VALUES)
    with pytest.raises(PublishError, match="no reconciliation.json"):
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )


def test_inert_measure_is_never_staged_even_provisionally(world):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", {2027: 0.0, 2028: 0.0})
    world.exception("alpha", 2027, 1.0, reference.outputs_sha256)
    world.exception("alpha", 2028, 2.0, reference.outputs_sha256)
    assert world.reconcile(reference)["summary"]["status"] == "accepted"
    manifest = m.Manifest()
    for provisional in (False, True):
        with pytest.raises(PublishError, match="responsiveness is inert"):
            stage(
                manifest,
                reference.path,
                data_root=world.data_root,
                inputs=world.inputs,
                provisional=provisional,
            )
    assert manifest.measures == {}


def test_failed_reconciliation_blocks_approval_until_excepted(world):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", {2027: -1.0, 2028: -3.0})
    world.reconcile(reference)
    manifest = m.Manifest()
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    with pytest.raises(PublishError, match="reconciliation is failed"):
        approve(
            manifest,
            "alpha",
            "María",
            data_root=world.data_root,
            inputs=world.inputs,
        )
    world.exception("alpha", 2028, -1.0, reference.outputs_sha256)
    world.reconcile(reference)
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert (
        manifest.measures["alpha"].reconciliation.summary_status == "accepted"
    )


def test_provisional_tolerates_awaiting_source_but_approval_does_not(world):
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES)
    world.reconcile(reference)
    manifest = m.Manifest()
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
        provisional=True,
    )
    assert manifest.measures["alpha"].status == m.PROVISIONAL
    with pytest.raises(PublishError, match="awaiting_source"):
        approve(
            manifest,
            "alpha",
            "María",
            data_root=world.data_root,
            inputs=world.inputs,
        )


def test_uncertified_artifact_cannot_be_provisional_or_approved(world):
    other = world.root / "other.h5"
    other.write_bytes(b"uncertified")
    world.costing("alpha", VALUES)
    reference = world.write("alpha", VALUES, dataset=other)
    world.reconcile(reference)
    manifest = m.Manifest()
    with pytest.raises(PublishError, match="not certified"):
        stage(
            manifest,
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
            provisional=True,
        )
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    with pytest.raises(PublishError, match="not certified"):
        approve(
            manifest,
            "alpha",
            "María",
            data_root=world.data_root,
            inputs=world.inputs,
        )


def test_changed_outputs_drop_the_approval_and_identical_ones_keep_it(world):
    manifest, reference = staged(world)
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )

    # Regenerating the same numbers at a new commit keeps the approval.
    same = world.write("alpha", VALUES)
    stage(manifest, same.path, data_root=world.data_root, inputs=world.inputs)
    assert manifest.measures["alpha"].status == m.APPROVED

    # A correction changes the numbers: the approval lapses.
    corrected = world.ready("alpha", {2027: -1.05, 2028: -2.05})
    world.costing("alpha", {2027: -1.05, 2028: -2.05})
    world.reconcile(corrected)
    stage(
        manifest,
        corrected.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    entry = manifest.measures["alpha"]
    assert entry.status == m.STAGED and entry.approval is None
    assert [s.entry.outputs_sha256 for s in manifest.superseded] == [
        reference.outputs_sha256
    ]


def combined_reference(world, members, values):
    key = "combined--" + "+".join(sorted(members))
    records = []
    for member in sorted(members):
        receipt = read_receipt(
            world.data_root / world_manifest_entry(world, member).artifact
        )["execution_receipt"]
        records.append(
            {
                "id": member,
                "reform": receipt["reform"],
                "baseline": receipt["baseline"],
            }
        )
    return world.write(
        key, values, members=records, measure_ids=sorted(members)
    )


def world_manifest_entry(world, member):
    return world.current.measures[member]


def test_combined_run_goes_stale_when_a_member_changes(world):
    manifest = m.Manifest()
    world.current = manifest
    for key in ("alpha", "beta"):
        reference = world.ready(key, VALUES)
        stage(
            manifest,
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
        approve(
            manifest,
            key,
            "María",
            data_root=world.data_root,
            inputs=world.inputs,
        )
    combined = combined_reference(
        world, ["alpha", "beta"], {2027: -1.9, 2028: -3.8}
    )
    key = stage(
        manifest, combined.path, data_root=world.data_root, inputs=world.inputs
    )
    assert manifest.combined[key].member_outputs_sha256 == {
        "alpha": manifest.measures["alpha"].outputs_sha256,
        "beta": manifest.measures["beta"].outputs_sha256,
    }
    approve(
        manifest, key, "María", data_root=world.data_root, inputs=world.inputs
    )
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )

    world.costing("alpha", {2027: -1.2, 2028: -2.2})
    corrected = world.write("alpha", {2027: -1.2, 2028: -2.2})
    world.reconcile(corrected)
    stage(
        manifest,
        corrected.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert manifest.combined[key].status == m.STALE
    assert manifest.combined[key].approval is None
    with pytest.raises(PublishError, match="stale"):
        approve(
            manifest,
            key,
            "María",
            data_root=world.data_root,
            inputs=world.inputs,
        )


def test_combined_run_needs_its_members_in_the_manifest(world):
    manifest = m.Manifest()
    world.current = manifest
    reference = world.ready("alpha", VALUES)
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    records = [
        {
            "id": "alpha",
            "reform": {"kind": "current_law"},
            "baseline": {"kind": "current_law"},
        },
        {
            "id": "ghost",
            "reform": {"kind": "current_law"},
            "baseline": {"kind": "current_law"},
        },
    ]
    combined = world.write(
        "combined--alpha+ghost",
        VALUES,
        members=records,
        measure_ids=["alpha", "ghost"],
    )
    with pytest.raises(PublishError) as error:
        stage(
            manifest,
            combined.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
    assert "member ghost is not" in str(error.value)
    assert "different reform definition" in str(error.value)


def test_a_different_execution_identity_needs_adoption(world):
    manifest, _ = staged(world)
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )

    # A new certified dataset: a different execution identity.
    new_dataset = world.root / "new" / "enhanced_frs_2024_25.h5"
    new_dataset.parent.mkdir()
    new_dataset.write_bytes(b"next certified dataset")
    world.bundle = world._bundle_for(new_dataset)
    (world.root / "manifest.json").write_text(json.dumps(world.bundle))
    upgraded = world.ready("beta", VALUES, dataset=new_dataset)

    with pytest.raises(PublishError, match="--adopt-execution"):
        stage(
            manifest,
            upgraded.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
    assert manifest.measures["alpha"].status == m.APPROVED

    stage(
        manifest,
        upgraded.path,
        data_root=world.data_root,
        inputs=world.inputs,
        adopt_execution=True,
    )
    assert manifest.measures["alpha"].status == m.STALE
    assert manifest.execution.execution_identity_sha256 == (
        upgraded.execution_identity_sha256
    )


def test_withdraw_and_check(world):
    manifest, _ = staged(world)
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    with pytest.raises(PublishError, match="reason"):
        withdraw(manifest, "alpha", " ")
    withdraw(manifest, "alpha", "Announced measure was changed")
    assert manifest.measures["alpha"].status == m.WITHDRAWN
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )


def test_check_catches_inputs_that_changed_after_approval(world):
    manifest, reference = staged(world)
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    # The costing is corrected and reconciliation re-run: now it fails.
    world.costing("alpha", {2027: -5.0, 2028: -2.0})
    world.reconcile(reference)
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert failures == ["alpha: reconciliation is failed"]


def test_manifest_round_trips_and_raises_its_revision(world):
    manifest, _ = staged(world)
    m.save_manifest(manifest, world.data_root)
    m.save_manifest(manifest, world.data_root)
    loaded = m.load_manifest(world.data_root)
    assert loaded.revision == 2
    assert loaded.measures["alpha"].status == m.STAGED
    raw = json.loads(m.manifest_path(world.data_root).read_text())
    assert raw["schema"] == m.SCHEMA
    raw["surprise"] = 1
    m.manifest_path(world.data_root).write_text(json.dumps(raw))
    with pytest.raises(ValueError):
        m.load_manifest(world.data_root)


def test_exports_load_only_approved_entries(world):
    manifest, _ = staged(world)
    m.save_manifest(manifest, world.data_root)
    with pytest.raises(PublishError, match="staged, not approved"):
        load_approved(
            ["alpha"], data_root=world.data_root, inputs=world.inputs
        )
    approve(
        manifest,
        "alpha",
        "María",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    m.save_manifest(manifest, world.data_root)
    loaded = load_approved(
        ["alpha"], data_root=world.data_root, inputs=world.inputs
    )
    assert loaded["stamp"]["manifest_revision"] == 2
    assert len(loaded["stamp"]["manifest_sha256"]) == 64
    assert (
        loaded["entries"]["alpha"]["tables"]["budgetary_impact"][0]["value"]
        == -1.0
    )
    with pytest.raises(PublishError, match="not in the manifest"):
        load_approved(
            ["ghost"], data_root=world.data_root, inputs=world.inputs
        )


@settings(max_examples=1, deadline=None)
@given(st.just(None))
def test_world_restores_policyengine_state(_):
    import policyengine.provenance.certification as certification

    original = certification.default_bundle_source_path
    world = World()
    assert certification.default_bundle_source_path is not original
    world.close()
    assert certification.default_bundle_source_path is original
