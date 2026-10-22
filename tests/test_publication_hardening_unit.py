"""Publication invariants isolated from the UK model's initialisation.

Load the real publication modules and substitute only their external
dependencies. The World-based tests separately exercise complete receipts,
artifacts and publication gates against the installed receipt API.
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

DIGEST = "a" * 64
DIRECTORY = Path(__file__).resolve().parents[1] / "src" / "uk_budget_data"


def template(*args, **kwargs):
    """A registered callable whose body is irrelevant to source proofs."""


def load_source(name, path, monkeypatch):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    monkeypatch.setitem(sys.modules, name, module)
    specification.loader.exec_module(module)
    return module


@pytest.fixture
def modules(monkeypatch):
    package_specification = importlib.util.spec_from_file_location(
        "uk_budget_data",
        DIRECTORY / "__init__.py",
        submodule_search_locations=[str(DIRECTORY)],
    )
    package = importlib.util.module_from_spec(package_specification)
    monkeypatch.setitem(sys.modules, "uk_budget_data", package)
    publication = ModuleType("uk_budget_data.publication")
    publication.__path__ = [str(DIRECTORY / "publication")]
    monkeypatch.setitem(sys.modules, "uk_budget_data.publication", publication)
    package.data_limits = SimpleNamespace(
        DATA_LIMITS=(object(),), REGISTRY_SHA256=DIGEST
    )
    package.model_limits = SimpleNamespace(REGISTRY_SHA256=DIGEST)
    builders = ModuleType("uk_budget_data.measure_templates")
    builders.TEMPLATES = ("template",)
    builders.template = template
    package.measure_templates = builders
    monkeypatch.setitem(
        sys.modules, "uk_budget_data.measure_templates", builders
    )
    monkeypatch.setitem(
        sys.modules,
        "uk_budget_data.certified_data",
        SimpleNamespace(load_bundle_manifest=lambda: {}),
    )
    proof = load_source(
        "_w5_template_proof_under_test",
        DIRECTORY / "publication" / "template_proof.py",
        monkeypatch,
    )
    publication.template_proof = proof
    receipt = load_source(
        "_w5_receipt_under_test",
        DIRECTORY / "publication" / "receipt.py",
        monkeypatch,
    )
    api = SimpleNamespace(
        ReceiptError=ValueError,
        scenario_reform_identity=Mock(),
        content_sha256=Mock(return_value=DIGEST),
    )
    monkeypatch.setattr(receipt, "receipt_api", lambda: (api, "test"))
    monkeypatch.setitem(
        sys.modules, "uk_budget_data.publication.receipt", receipt
    )
    attestation = load_source(
        "_w5_attestations_under_test",
        DIRECTORY / "publication" / "attestations.py",
        monkeypatch,
    )
    return SimpleNamespace(
        package=package,
        proof=proof,
        receipt=receipt,
        api=api,
        attestation=attestation,
        revision=receipt.CodeRevision("a" * 40, True),
    )


def document(side="reform", proof=None):
    proofs = {"baseline": [], "reform": []}
    proofs[side] = [proof]
    return {
        "execution_receipt": {"opaque": "execution identity"},
        "dashboard": {
            "key": "alpha",
            "modifier_templates": proofs,
            "generation_id": "f" * 32,
        },
    }


def review(**updates):
    return {
        "measure_id": "alpha",
        "receipt_sha256": DIGEST,
        "reason": "The modifier changes income tax only.",
        "checker": "María",
        "second": "Vahid",
        "released_at": "2026-10-22T10:30:00Z",
        **updates,
    }


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_handwritten_modifiers_on_either_side_need_attestation(modules, side):
    assert modules.attestation.requires_attestation(document(side))


def test_registered_proofs_and_parameters_do_not_need_attestation(modules):
    assert not modules.attestation.requires_attestation(
        document(proof=["template"])
    )
    assert not modules.attestation.requires_attestation(
        {"dashboard": {"modifier_templates": {"baseline": [], "reform": []}}}
    )


def test_no_active_limit_means_no_hold(modules):
    modules.package.data_limits.DATA_LIMITS = ()
    assert not modules.attestation.requires_attestation(document())


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
        {"released_at": "0001-01-01T00:00:00+23:59"},
        {"released_at": "9999-12-31T23:59:59-23:59"},
    ],
)
def test_invalid_review_never_releases_the_receipt(modules, updates):
    with pytest.raises(ValueError):
        modules.attestation.validate_attestation(document(), review(**updates))


def test_valid_review_strips_names_and_retains_the_reason(modules):
    release = modules.attestation.validate_attestation(
        document(), review(checker=" María ", second=" Vahid ")
    )
    assert release.checker == "María"
    assert release.second == "Vahid"
    assert release.reason == review()["reason"]


def test_review_digest_binds_the_whole_receipt_document(modules):
    original = document()
    assert modules.attestation.receipt_document_sha256(original) == DIGEST
    modules.api.content_sha256.assert_called_once_with(original)


def test_an_uncommitted_review_cannot_release_the_receipt(
    modules, tmp_path, monkeypatch
):
    monkeypatch.setattr(modules.attestation, "ATTESTATIONS_ROOT", tmp_path)
    monkeypatch.setattr(
        modules.attestation, "ATTESTATION_REPOSITORY", tmp_path
    )
    monkeypatch.setitem(
        sys.modules,
        "uk_budget_data.publication.artifacts",
        SimpleNamespace(check_key=lambda key: None),
    )
    (tmp_path / "alpha.json").write_text(json.dumps(review()))
    release, problems = modules.attestation.load_attestation(document())
    assert release is None
    assert any("not committed in local Git HEAD" in p for p in problems)


def modifier(modules, tmp_path, monkeypatch, statements=""):
    path = tmp_path / "pure_proof_under_test.py"
    path.write_text(
        "from uk_budget_data.measure_templates import template\n"
        "RATE = 0.5\n\n"
        "def modifier(sim):\n"
        "    values = template(RATE)\n"
        + statements
        + "    return template(sim, values)\n"
    )
    return load_source(path.stem, path, monkeypatch).modifier


def test_pure_source_calls_the_receipt_binding_check(
    modules, tmp_path, monkeypatch
):
    function = modifier(modules, tmp_path, monkeypatch)
    assert modules.proof.pure_templates(function, modules.revision) == [
        "template"
    ]
    modules.api.scenario_reform_identity.assert_called_once()


@pytest.mark.parametrize(
    "statement",
    [
        "    pass\n",
        "    unused = 1\n",
        "    unused = abs(-1)\n",
        "    unused = template(sim.value)\n",
        "    unused = template(abs(-1))\n",
        "    print(sim)\n",
        "    import math\n",
    ],
)
def test_extra_statements_or_arbitrary_arguments_are_handwritten(
    modules, tmp_path, monkeypatch, statement
):
    function = modifier(modules, tmp_path, monkeypatch, statement)
    assert modules.proof.pure_templates(function, modules.revision) is None


def test_registered_template_members_must_exist(modules):
    modules.package.measure_templates.TEMPLATES = ("missing",)
    with pytest.raises(RuntimeError, match="Invalid registered"):
        modules.proof.registered_templates()


def test_proof_count_covers_every_bound_modifier(modules):
    receipt = {
        "execution_receipt": {"reform": {"binding": "code_revision"}},
        "dashboard": {"modifier_templates": {"baseline": [], "reform": []}},
    }
    assert modules.proof.record_problems(receipt)


def test_handwritten_proof_needs_a_generation_identity(modules):
    receipt = document()
    receipt["execution_receipt"] = {"reform": {"binding": "code_revision"}}
    assert modules.proof.record_problems(receipt) == []
    del receipt["dashboard"]["generation_id"]
    assert modules.proof.record_problems(receipt)


def receipt_inputs(modules, **updates):
    return modules.receipt.ReceiptInputs(
        key="alpha",
        measure_ids=["alpha"],
        years=[2027],
        baseline_identity=None,
        reform_identity=None,
        file_digests={},
        basis={},
        revision=modules.revision,
        data_limits=[],
        model_limits=[],
        **updates,
    )


def test_modifier_proofs_cannot_be_omitted(modules):
    with pytest.raises(TypeError, match="modifier_templates"):
        receipt_inputs(modules)


def test_dashboard_validation_checks_template_proofs(modules):
    problems = modules.receipt.dashboard_problems({})
    assert any("modifier templates" in problem for problem in problems)


def test_each_handwritten_generation_gets_a_new_identity(modules, monkeypatch):
    execution = SimpleNamespace(
        execution_identity_sha256=DIGEST,
        receipt_sha256=DIGEST,
        outputs_sha256=DIGEST,
        to_canonical_json=lambda: json.dumps({}),
    )
    modules.api.build_execution_receipt_for_microsimulation = Mock(
        return_value=execution
    )
    monkeypatch.setattr(modules.receipt, "dataset_years", lambda sim: [2027])
    monkeypatch.setattr(
        modules.receipt, "certificate_problems", lambda receipt: []
    )
    inputs = receipt_inputs(
        modules, modifier_templates={"baseline": [], "reform": [None]}
    )
    first = modules.receipt.build_receipt_document(None, None, inputs)
    second = modules.receipt.build_receipt_document(None, None, inputs)
    assert first["dashboard"]["generation_id"] != (
        second["dashboard"]["generation_id"]
    )


@pytest.fixture
def publisher(modules, monkeypatch):
    """Use the real manifest and publisher with controlled artifact inputs."""
    monkeypatch.setitem(
        sys.modules,
        "uk_budget_data.publication.attestations",
        modules.attestation,
    )
    manifest = load_source(
        "_w5_manifest_under_test",
        DIRECTORY / "publication" / "manifest.py",
        monkeypatch,
    )
    sys.modules["uk_budget_data.publication"].manifest = manifest
    dependencies = {
        "artifacts": {
            "COMBINED_PREFIX": "combined--",
            **{
                name: Mock()
                for name in (
                    "capture",
                    "captured_file_problems",
                    "captured_tables",
                    "read_receipt",
                )
            },
        },
        "combine": {
            "combined_key": lambda ids: "combined--" + "+".join(sorted(ids))
        },
        "reconcile": {
            "ACCEPTED": "accepted",
            "PASS": "pass",
            "ReconciliationInputError": ValueError,
            **{
                name: Mock()
                for name in (
                    "budgetary_from_rows",
                    "load_expected",
                    "reconcile_receipted",
                )
            },
        },
        "responsiveness": {"RESPONSIVE": "responsive"},
        "validate": {"table_problems": Mock()},
    }
    for name, attributes in dependencies.items():
        monkeypatch.setitem(
            sys.modules,
            f"uk_budget_data.publication.{name}",
            SimpleNamespace(**attributes),
        )
    publish = load_source(
        "_w5_publish_under_test",
        DIRECTORY / "publication" / "publish.py",
        monkeypatch,
    )
    return SimpleNamespace(publish=publish, manifest=manifest)


def test_staging_copies_the_review_into_the_manifest(
    modules, publisher, monkeypatch, tmp_path
):
    publish, manifest_module = publisher.publish, publisher.manifest
    release = modules.attestation.Attestation.model_validate(review())
    receipt = document()
    receipt["execution_receipt"] = {"years": [2027]}
    receipt["dashboard"].update(
        digests={
            name: DIGEST
            for name in (
                "outputs_sha256",
                "receipt_sha256",
                "execution_identity_sha256",
            )
        },
        basis={},
        unsupported_years=[],
    )
    monkeypatch.setattr(publish, "read_receipt", lambda path: receipt)
    monkeypatch.setattr(
        publish,
        "load_execution_receipt",
        lambda document: SimpleNamespace(execution_identity=lambda: {}),
    )
    monkeypatch.setattr(publish, "artifact_sha256", lambda document: DIGEST)
    monkeypatch.setattr(
        publish,
        "gate_problems",
        lambda *args, **kwargs: ([], {"tables": {}, "attestation": release}),
    )
    manifest = manifest_module.Manifest()
    publish.stage(manifest, tmp_path / "artifact", data_root=tmp_path)
    assert manifest.measures["alpha"].attestation == release


def test_combined_members_must_keep_their_current_release(
    publisher, monkeypatch, tmp_path
):
    publish, manifest_module = publisher.publish, publisher.manifest
    identity = {
        "kind": "scenario",
        "representation": "handwritten",
        "reform_sha256": DIGEST,
        "binding": "code_revision",
    }
    own = {"execution_receipt": {"baseline": identity, "reform": identity}}
    combined = {
        "dashboard": {
            "key": "combined--alpha",
            "measure_ids": ["alpha"],
            "member_outputs_sha256": {"alpha": DIGEST},
            "members": [
                {"id": "alpha", "baseline": identity, "reform": identity}
            ],
        }
    }
    entry = SimpleNamespace(
        status=manifest_module.STAGED,
        outputs_sha256=DIGEST,
        artifact="artifact",
        attestation=None,
    )
    monkeypatch.setattr(publish, "composition_problems", lambda doc: [])
    monkeypatch.setattr(publish, "read_receipt", lambda path: own)
    monkeypatch.setattr(publish, "requires_attestation", lambda doc: True)
    monkeypatch.setattr(
        publish,
        "load_attestation",
        lambda doc: (None, ["held: the current release is missing"]),
    )
    problems = publish._members_problems(
        combined,
        SimpleNamespace(measures={"alpha": entry}),
        tmp_path,
        (manifest_module.STAGED,),
    )
    assert "member alpha: held: the current release is missing" in problems
