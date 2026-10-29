"""Hand-written modifiers stay held until two people attest this receipt.

Only while sign-off is on (``uk_budget_data.sign_off``), so ``world`` turns
it on; the tests at the end turn it off.
"""

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from tests.attestation_measures import template_helper_modifier
from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import World
from tests.template_measures import property_modifier
from uk_budget_data import data_limits, model_limits, sign_off
from uk_budget_data.publication import attestations as a
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import (
    PublishError,
    approve,
    check,
    gate_problems,
    stage,
)
from uk_budget_data.publication.receipt import scenario_identity

VALUES = {2027: -1.0, 2028: -2.0}


@pytest.fixture
def world(monkeypatch, sign_off_required):
    instance = World()
    monkeypatch.setattr(a, "ATTESTATIONS_ROOT", instance.root / "attestations")
    monkeypatch.setattr(
        a, "ATTESTATION_REPOSITORY", instance.root / "attestations"
    )
    yield instance
    instance.close()


def args(world):
    return dict(data_root=world.data_root, inputs=world.inputs)


def modifier_artifact(world, modifier=module_level_modifier, **kwargs):
    identity = scenario_identity(
        Scenario(simulation_modifier=modifier),
        name="alpha",
        revision=world.revision(),
    )
    # World supplies table bytes and a certified stand-in simulation. Its
    # modifier proof is passed explicitly, as the real generator does.
    proof = (
        ["apply_property_band_surcharge"]
        if modifier is property_modifier
        else None
    )
    return world.ready(
        "alpha",
        VALUES,
        reform_identity=identity,
        modifier_templates={"baseline": [], "reform": [proof]},
        **kwargs,
    )


def combined_artifact(world, manifest, references):
    records = []
    for reference in references:
        execution = read_receipt(reference.path)["execution_receipt"]
        records.append(
            {
                "id": reference.key,
                "baseline": execution["baseline"],
                "reform": execution["reform"],
            }
        )
    return world.write(
        "combined--alpha+beta",
        {2027: -2, 2028: -4},
        members=records,
        measure_ids=["alpha", "beta"],
        member_outputs={
            key: entry.outputs_sha256
            for key, entry in manifest.measures.items()
        },
        modifier_templates={"baseline": [], "reform": [None]},
    )


def record_for(document, **updates):
    record = {
        "measure_id": document["dashboard"]["key"],
        "receipt_sha256": a.receipt_document_sha256(document),
        "reason": "The modifier changes income tax only; it does not price purchases.",
        "checker": "María",
        "second": "Vahid",
        "released_at": "2026-10-22T10:30:00Z",
    }
    return {**record, **updates}


def attest(reference, **updates):
    document = read_receipt(reference.path)
    record = record_for(document, **updates)
    a.ATTESTATIONS_ROOT.mkdir(parents=True, exist_ok=True)
    path = a.ATTESTATIONS_ROOT / f"{reference.key}.json"
    path.write_text(json.dumps(record))
    World.commit_attestation(path)
    return a.Attestation.model_validate(record)


@pytest.mark.parametrize("level", [m.STAGED, m.PROVISIONAL, m.APPROVED])
def test_each_figure_level_holds_a_handwritten_modifier(world, level):
    reference = modifier_artifact(world)
    problems, _ = gate_problems(
        "alpha", reference.path, m.Manifest(), level=level, **args(world)
    )
    assert any(a.hold_reason("alpha") in problem for problem in problems)
    with pytest.raises(PublishError, match="held: a hand-written modifier"):
        stage(
            m.Manifest(),
            reference.path,
            provisional=level != m.STAGED,
            **args(world),
        )


def test_a_not_computable_handwritten_artifact_lists_without_a_release(world):
    """Option (d) meets the hold: a hand-written modifier's artifact that
    records a data limit is receipt-only and is staged as not computable
    without a release, since it publishes no figure. A release never lifts
    the data limit to any figure level."""
    identity = scenario_identity(
        Scenario(simulation_modifier=module_level_modifier),
        name="alpha",
        revision=world.revision(),
    )
    limit = data_limits.DATA_LIMITS[0]
    reference = world.write(
        "alpha",
        {2027: 0.0, 2028: 0.0},
        reform_identity=identity,
        modifier_templates={"baseline": [], "reform": [None]},
        data_limits=[data_limits.record(limit, [limit.parameters[0]])],
    )
    assert sorted(path.name for path in reference.path.iterdir()) == [
        "receipt.json"
    ]
    assert a.requires_attestation(read_receipt(reference.path))
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    entry = manifest.measures["alpha"]
    assert (entry.status, entry.attestation) == (m.NOT_COMPUTABLE, None)
    assert check(manifest, **args(world)) == []
    attest(reference)
    for level in (m.STAGED, m.PROVISIONAL, m.APPROVED):
        problems, _ = gate_problems(
            "alpha", reference.path, m.Manifest(), level=level, **args(world)
        )
        assert any(
            f"not computable on current data, so it cannot be {level}"
            in problem
            for problem in problems
        )


@pytest.mark.parametrize(
    "updates",
    [
        {"receipt_sha256": "f" * 64},
        {"measure_id": "beta"},
        {"measure_id": " alpha "},
        {"checker": "same", "second": " SAME "},
        {"checker": "Straße", "second": "STRASSE"},
        {"checker": " "},
        {"second": ""},
        {"reason": "\t"},
        {"released_at": "2026-10-22"},
        {"released_at": "2026-10-22T10:30:00"},
        {"released_at": "not a timestamp"},
    ],
)
def test_invalid_attestation_never_releases(world, updates):
    reference = modifier_artifact(world)
    a.ATTESTATIONS_ROOT.mkdir()
    path = a.ATTESTATIONS_ROOT / "alpha.json"
    path.write_text(
        json.dumps(record_for(read_receipt(reference.path), **updates))
    )
    # Exercise record validation after the committed-input check, so that
    # an uncommitted draft cannot mask a broken field validator.
    World.commit_attestation(path)
    with pytest.raises(PublishError, match="held: a hand-written modifier"):
        stage(m.Manifest(), reference.path, provisional=True, **args(world))


@pytest.mark.parametrize("contents", ["{", "null", "[]", '"release"'])
def test_malformed_attestation_stays_held(world, contents):
    reference = modifier_artifact(world)
    a.ATTESTATIONS_ROOT.mkdir()
    path = a.ATTESTATIONS_ROOT / "alpha.json"
    path.write_text(contents)
    World.commit_attestation(path)
    with pytest.raises(PublishError, match="held: a hand-written modifier"):
        stage(m.Manifest(), reference.path, **args(world))


def test_valid_release_is_copied_and_allows_provisional_and_approval(world):
    reference = modifier_artifact(world)
    release = attest(reference, checker=" María ", second=" Vahid ")
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    entry = manifest.measures["alpha"]
    assert entry.status == m.PROVISIONAL
    assert entry.attestation == release
    assert entry.attestation.checker == "María"
    approve(manifest, "alpha", "Approver", **args(world))
    assert manifest.measures["alpha"].status == m.APPROVED
    assert check(manifest, **args(world)) == []
    m.save_manifest(manifest, world.data_root)
    assert (
        m.load_manifest(world.data_root).measures["alpha"].attestation
        == release
    )


def test_identical_regeneration_voids_the_previous_attestation(world):
    original = modifier_artifact(world)
    attest(original)
    regenerated = modifier_artifact(world)
    assert regenerated.path != original.path
    assert regenerated.outputs_sha256 == original.outputs_sha256
    old = read_receipt(original.path)
    new = read_receipt(regenerated.path)
    assert a.receipt_document_sha256(old) != a.receipt_document_sha256(new)
    with pytest.raises(PublishError, match="current receipt"):
        stage(m.Manifest(), regenerated.path, **args(world))
    attest(regenerated)
    stage(m.Manifest(), regenerated.path, **args(world))


def test_release_never_waives_model_limit_or_reconciliation(world):
    limited = model_limits.record(
        next(
            limit
            for limit in model_limits.MODEL_LIMITS
            if limit.key == "pc_minimum_guarantee_uprating"
        ),
        ["gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE"],
    )
    reference = modifier_artifact(world, model_limits=[limited])
    attest(reference)
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    with pytest.raises(PublishError, match="held at provisional"):
        approve(manifest, "alpha", "Approver", **args(world))
    world.costing("alpha", {2027: 30, 2028: 40})
    # Provisional permits a failed costing; approval still refuses it.
    with pytest.raises(PublishError, match="reconciliation is failed"):
        approve(manifest, "alpha", "Approver", **args(world))


def test_pure_template_and_parameters_only_are_not_held(world):
    template = modifier_artifact(world, property_modifier)
    assert not a.requires_attestation(read_receipt(template.path))
    stage(m.Manifest(), template.path, **args(world))
    parameters = world.ready("beta", VALUES)
    stage(m.Manifest(), parameters.path, **args(world))
    assert not a.requires_attestation(read_receipt(parameters.path))


def test_a_template_helper_with_an_extra_call_is_held(world):
    reference = modifier_artifact(world, template_helper_modifier)
    with pytest.raises(PublishError, match="held: a hand-written modifier"):
        stage(m.Manifest(), reference.path, **args(world))


def test_a_handwritten_baseline_is_also_held(world):
    baseline = scenario_identity(
        Scenario(simulation_modifier=module_level_modifier),
        name="alpha baseline",
        revision=world.revision(),
    )
    reference = world.ready(
        "alpha",
        VALUES,
        baseline_identity=baseline,
        modifier_templates={"baseline": [None], "reform": []},
    )
    document = read_receipt(reference.path)
    assert a.requires_attestation(document)
    with pytest.raises(PublishError, match="held: a hand-written modifier"):
        stage(m.Manifest(), reference.path, **args(world))


def test_an_empty_limit_registry_releases_all_modifiers(world, monkeypatch):
    reference = modifier_artifact(world)
    monkeypatch.setattr(data_limits, "DATA_LIMITS", ())
    assert not a.requires_attestation(read_receipt(reference.path))
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    approve(manifest, "alpha", "Approver", **args(world))


def test_check_rejects_an_unreleased_manifest_receipt_without_a_hold(
    world, monkeypatch
):
    released = modifier_artifact(world)
    release = attest(released)
    current = modifier_artifact(world)
    monkeypatch.setattr(data_limits, "DATA_LIMITS", ())
    assert not a.requires_attestation(read_receipt(current.path))
    assert release.receipt_sha256 != a.receipt_document_sha256(
        read_receipt(current.path)
    )
    manifest = m.Manifest()
    stage(manifest, current.path, provisional=True, **args(world))
    assert check(manifest, **args(world)) == []
    m.save_manifest(manifest, world.data_root)

    # Hand-editing the manifest must not claim these two people released
    # the current generation when they only released its predecessor.
    path = world.data_root / m.MANIFEST_FILE
    document = json.loads(path.read_text())
    document["measures"]["alpha"]["attestation"] = release.model_dump()
    path.write_text(json.dumps(document))
    edited = m.load_manifest(world.data_root)
    assert check(edited, **args(world)) == [
        "alpha: the entry's attestation is invalid: "
        "attestation does not match the current receipt"
    ]


def test_revoking_or_changing_a_release_invalidates_the_manifest(world):
    reference = modifier_artifact(world)
    attest(reference)
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    attest(reference, second="Another reviewer")
    assert any("restage" in p for p in check(manifest, **args(world)))
    stage(manifest, reference.path, provisional=True, **args(world))
    (a.ATTESTATIONS_ROOT / "alpha.json").unlink()
    assert any(
        "held: a hand-written modifier" in p
        for p in check(manifest, **args(world))
    )


def test_a_combined_run_with_a_handwritten_member_is_held(world):
    alpha = modifier_artifact(world)
    attest(alpha)
    beta = world.ready("beta", VALUES)
    manifest = m.Manifest()
    for reference in (alpha, beta):
        stage(manifest, reference.path, **args(world))
    combined = combined_artifact(world, manifest, (alpha, beta))
    with pytest.raises(PublishError, match="attestations/combined--alpha"):
        stage(manifest, combined.path, **args(world))
    attest(combined)
    stage(manifest, combined.path, **args(world))
    (a.ATTESTATIONS_ROOT / "alpha.json").unlink()
    with pytest.raises(PublishError, match="member alpha: held"):
        stage(manifest, combined.path, **args(world))


def test_a_combined_run_rechecks_members_current_committed_attestations(world):
    alpha = modifier_artifact(world)
    original_release = attest(alpha)
    beta = world.ready("beta", VALUES)
    manifest = m.Manifest()
    for reference in (alpha, beta):
        stage(manifest, reference.path, **args(world))
    combined = combined_artifact(world, manifest, (alpha, beta))
    attest(combined)
    stage(manifest, combined.path, **args(world))

    updated_release = attest(alpha, second="Another reviewer")
    assert updated_release != original_release
    assert manifest.measures["alpha"].attestation == original_release
    with pytest.raises(
        PublishError, match="member alpha's attestation changed; restage it"
    ):
        stage(manifest, combined.path, **args(world))

    stage(manifest, alpha.path, **args(world))
    assert manifest.measures["alpha"].attestation == updated_release
    stage(manifest, combined.path, **args(world))


names = st.text(alphabet="aAbB ßSΣςéÉ", min_size=1, max_size=15).filter(
    lambda s: bool(s.strip())
)


@settings(max_examples=80)
@given(checker=names, second=names, matching=st.booleans())
def test_attestations_require_distinct_names_and_the_matching_digest(
    checker, second, matching
):
    document = {"dashboard": {"key": "alpha", "generation_id": "generation"}}
    record = record_for(
        document,
        checker=checker,
        second=second,
        **({} if matching else {"receipt_sha256": "f" * 64}),
    )
    expected = (
        matching and checker.strip().casefold() != second.strip().casefold()
    )
    if expected:
        assert a.validate_attestation(document, record)
    else:
        with pytest.raises(ValueError):
            a.validate_attestation(document, record)


# --- Sign-off off -------------------------------------------------------------


def test_with_sign_off_off_a_handwritten_modifier_is_not_held(
    world, monkeypatch
):
    """No attestation is read or needed; every other gate still runs."""
    monkeypatch.setattr(sign_off, "REQUIRED", False)
    reference = modifier_artifact(world)
    assert not a.requires_attestation(read_receipt(reference.path))
    for level in (m.STAGED, m.PROVISIONAL, m.APPROVED):
        problems, _ = gate_problems(
            "alpha", reference.path, m.Manifest(), level=level, **args(world)
        )
        assert not any("held" in problem for problem in problems)
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    assert manifest.measures["alpha"].attestation is None
    approve(manifest, "alpha", "Approver", **args(world))
    assert manifest.measures["alpha"].status == m.APPROVED
    assert check(manifest, **args(world)) == []


def test_with_sign_off_off_a_recorded_attestation_is_kept_but_not_checked(
    world, monkeypatch
):
    reference = modifier_artifact(world)
    release = attest(reference)
    manifest = m.Manifest()
    stage(manifest, reference.path, provisional=True, **args(world))
    (a.ATTESTATIONS_ROOT / "alpha.json").unlink()
    manifest.measures["alpha"].attestation = release.model_copy(
        update={"receipt_sha256": "f" * 64}
    )
    problems = check(manifest, **args(world))
    assert any("held: a hand-written modifier" in p for p in problems)
    assert any("the entry's attestation is invalid" in p for p in problems)
    monkeypatch.setattr(sign_off, "REQUIRED", False)
    assert check(manifest, **args(world)) == []


def test_with_sign_off_off_a_combined_run_with_a_handwritten_member_stages(
    world, monkeypatch
):
    monkeypatch.setattr(sign_off, "REQUIRED", False)
    alpha = modifier_artifact(world)
    beta = world.ready("beta", VALUES)
    manifest = m.Manifest()
    for reference in (alpha, beta):
        stage(manifest, reference.path, provisional=True, **args(world))
    combined = combined_artifact(world, manifest, (alpha, beta))
    stage(manifest, combined.path, provisional=True, **args(world))
    assert manifest.combined["combined--alpha+beta"].attestation is None
    assert check(manifest, **args(world)) == []
