"""Tests for canonical tables, artifacts, receipts and the manifest gates."""

import hashlib
import json
import math
from importlib import metadata
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import (
    DATASET_YEARS,
    PROJECTION_END,
    RATE_PATH,
    YEARS,
    World,
    make_tables,
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
    SCATTER_BINS,
    SCATTER_MIN_HOUSEHOLDS,
    SCATTER_ROUND_TO,
    TABLES,
    TableError,
    band,
    bin_scatter,
    canonical_csv,
    parse_csv,
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


scatter_rows = st.lists(
    st.fixed_dictionaries(
        {
            "reform_id": st.sampled_from(["a", "b"]),
            "reform_name": st.just("A"),
            "year": st.sampled_from([2027, 2028]),
            "baseline_income": st.floats(-5_000, 300_000),
            "income_change": st.floats(-10_000, 10_000),
            "household_weight": st.floats(0, 5_000),
            "household_id": st.integers(1, 10**6),
        }
    ),
    max_size=200,
)


@given(scatter_rows)
def test_binned_scatter_holds_no_household_level_data(rows):
    binned = bin_scatter(rows)
    columns = TABLES["household_scatter_binned"].column_names
    assert "household_id" not in columns
    assert "household_weight" not in columns
    for cell in binned:
        assert set(cell) == set(columns)
        group = [
            r
            for r in rows
            if (r["reform_id"], r["year"]) == (cell["reform_id"], cell["year"])
            and band(
                r["baseline_income"],
                SCATTER_BINS["income_band_width"],
                SCATTER_BINS["income_min"],
                SCATTER_BINS["income_max"],
            )
            == cell["income_band"]
            and band(
                round(r["income_change"], 2),
                SCATTER_BINS["change_band_width"],
                SCATTER_BINS["change_min"],
                SCATTER_BINS["change_max"],
            )
            == cell["change_band"]
        ]
        # Every published cell pools at least the minimum of households,
        # and its count is their weight, rounded.
        assert len(group) >= SCATTER_MIN_HOUSEHOLDS
        total = sum(r["household_weight"] for r in group)
        assert abs(cell["households"] - total) <= SCATTER_ROUND_TO / 2 + 1e-6
        assert cell["households"] % SCATTER_ROUND_TO == 0


@given(scatter_rows, st.randoms())
def test_binned_scatter_ignores_row_order(rows, random):
    shuffled = list(rows)
    random.shuffle(shuffled)
    assert bin_scatter(shuffled) == bin_scatter(rows)


@given(
    st.floats(-1e7, 1e7),
    st.sampled_from([(5_000.0, 0.0, 150_000.0), (100.0, -2_000.0, 2_000.0)]),
)
def test_bands_hold_their_values_and_outer_bands_are_open(value, spec):
    width, low, high = spec
    edge = band(value, width, low, high)
    assert low <= edge <= high - width
    if low <= value < high:
        assert edge <= value < edge + width
    elif value < low:
        assert edge == low
    else:
        assert edge == high - width


def test_float_noise_around_zero_is_not_a_loss():
    rows = [
        {
            "reform_id": "a",
            "reform_name": "A",
            "year": 2027,
            "baseline_income": 20_100.0,
            "income_change": -1e-12,
            "household_weight": 100.0,
        }
    ] * SCATTER_MIN_HOUSEHOLDS
    (cell,) = bin_scatter(rows)
    assert cell["change_band"] == 0.0


def test_small_cells_are_left_out():
    row = {
        "reform_id": "a",
        "reform_name": "A",
        "year": 2027,
        "baseline_income": 20_100.0,
        "income_change": -50.0,
        "household_weight": 100.0,
    }
    few = [row] * (SCATTER_MIN_HOUSEHOLDS - 1)
    assert bin_scatter(few) == []
    enough = bin_scatter([row] * SCATTER_MIN_HOUSEHOLDS)
    assert enough == [
        {
            "reform_id": "a",
            "reform_name": "A",
            "year": 2027,
            "income_band": 20_000.0,
            "change_band": -100.0,
            "households": 100.0 * SCATTER_MIN_HOUSEHOLDS,
        }
    ]
    canonical_csv("household_scatter_binned", enough)


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
    assert document["dashboard"]["receipt_source"] == (
        f"policyengine=={metadata.version('policyengine')}"
    )


def test_different_dataset_bytes_cannot_be_receipted(world):
    """Bytes that are not the named dataset never get a receipt at all."""
    other = world.root / "other.h5"
    other.write_bytes(b"some other dataset")
    with pytest.raises(ReceiptUnavailable, match="not the bundle's"):
        world.write("alpha", VALUES, dataset=other)


def test_a_dataset_other_than_the_certified_default_is_uncertified(world):
    tiny = world.root / "enhanced_frs_2024_25_tiny.h5"
    tiny.write_bytes(b"a smaller dataset")
    world.register("enhanced_frs_2024_25_tiny", tiny)
    document = read_receipt(
        world.write(
            "alpha",
            VALUES,
            dataset=tiny,
            dataset_name="enhanced_frs_2024_25_tiny",
        ).path
    )
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
    last, beyond = PROJECTION_END, PROJECTION_END + 1
    document = read_receipt(
        world.write("alpha", {last: -1.0, beyond: -1.0}).path
    )
    assert document["dashboard"]["dataset_years"] == DATASET_YEARS
    assert document["dashboard"]["unsupported_years"] == [beyond]


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


def test_infinity_binds_and_nan_does_not(world):
    """policyengine.py#588 digests an infinite value (an uncapped
    threshold) as a marked non-finite value; NaN has no one value to bind."""

    def bind(value):
        return receipt_module.scenario_identity(
            Scenario(parameter_changes={RATE_PATH: {"2027": value}}),
            name="no cap",
            revision=world.revision(),
        )

    uncapped = bind(math.inf)
    assert uncapped.binding == "content"
    assert uncapped.reform_sha256 not in {
        bind(-math.inf).reform_sha256,
        bind(1e308).reform_sha256,
    }
    with pytest.raises(ReceiptUnavailable):
        bind(math.nan)


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


def test_a_measure_with_no_expectation_cannot_be_staged(world):
    """Reconciliation is recomputed; no file needs to exist."""
    reference = world.write("alpha", VALUES)
    with pytest.raises(PublishError, match="undeclared"):
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
    other = world.root / "enhanced_frs_2024_25_tiny.h5"
    other.write_bytes(b"uncertified")
    world.register("enhanced_frs_2024_25_tiny", other)
    world.costing("alpha", VALUES)
    reference = world.write(
        "alpha",
        VALUES,
        dataset=other,
        dataset_name="enhanced_frs_2024_25_tiny",
    )
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
        key,
        values,
        members=records,
        measure_ids=sorted(members),
        member_outputs={
            member: world_manifest_entry(world, member).outputs_sha256
            for member in sorted(members)
        },
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


def test_an_artifact_outside_the_data_root_is_refused(world):
    reference = world.ready("alpha", VALUES)
    elsewhere = world.root / "elsewhere"
    with pytest.raises(PublishError, match="not under the data root"):
        stage(
            m.Manifest(),
            reference.path,
            data_root=elsewhere,
            inputs=world.inputs,
        )


def test_a_manifest_entry_cannot_point_outside_the_data_root(world):
    manifest, _ = staged(world)
    m.save_manifest(manifest, world.data_root)
    raw = json.loads(m.manifest_path(world.data_root).read_text())
    for escape in ("../../etc", "/etc/passwd"):
        raw["measures"]["alpha"]["artifact"] = escape
        m.manifest_path(world.data_root).write_text(json.dumps(raw))
        with pytest.raises(ValueError, match="relative to the data root"):
            m.load_manifest(world.data_root)


def test_a_measure_cannot_use_a_combined_key(world):
    world.costing("combined--alpha", VALUES)
    reference = world.write("combined--alpha", VALUES)
    world.reconcile(reference)
    with pytest.raises(PublishError, match="combined key needs"):
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
