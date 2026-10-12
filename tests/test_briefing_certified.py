"""Real tiny simulations through publication and both briefing generators.

The locked bundle currently certifies the full enhanced FRS, not its tiny
overlay. The test first checks the real receipt without changing that rule.
For the export round trip only, a scoped bundle fixture certifies the actual
tiny bytes, just as publication_support.World certifies its dummy bytes.
Production certification and publication gates are never patched or bypassed.
"""

import copy
import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import policyengine.provenance.certification as certification
import pytest
from policyengine.provenance.manifest import _apply_dataset_overlays

from tests.publication_support import SOURCE_HEADER
from uk_budget_data.certified_data import load_bundle_manifest
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import build_microsimulation
from uk_budget_data.publication import generate as generation
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import receipt as receipts
from uk_budget_data.publication.artifacts import read_receipt, read_tables
from uk_budget_data.publication.combine import combined_key
from uk_budget_data.publication.publish import approve, check, stage
from uk_budget_data.publication.reconcile import reconcile_artifact
from uk_budget_data.publication.validate import table_problems

TINY_DATASET = "enhanced_frs_2024_25_tiny"
BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
HIGHER_RATE = "gov.hmrc.income_tax.rates.uk[1].rate"
REPO_ROOT = Path(__file__).resolve().parents[1]


def _generator(name):
    path = REPO_ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _assert_export_binding(directory, manifest_path, references, keys):
    receipt = json.loads(
        (directory / "briefing-export-receipt.json").read_text()
    )
    manifest = json.loads(manifest_path.read_text())
    assert receipt["manifest_revision"] == manifest["revision"]
    assert receipt["manifest_sha256"] == _sha256(manifest_path)
    assert set(receipt["keys"]) == set(keys)
    assert len(receipt["generator_git_sha"]) == 40
    assert (
        datetime.fromisoformat(receipt["generated_at"]).tzinfo == timezone.utc
    )
    assert receipt["files"]
    for filename, digest in receipt["files"].items():
        assert _sha256(directory / filename) == digest
    for key in keys:
        digests = read_receipt(references[key].path)["dashboard"]["digests"]
        binding = receipt["artifacts"][key]
        for field in ("outputs_sha256", "execution_identity_sha256"):
            assert binding[field] == digests[field]
    return receipt


@pytest.mark.certified_data
def test_tiny_simulations_publish_and_export_briefing(tmp_path, monkeypatch):
    """Two real parameter measures, their combined run, and bound exports.

    Both members need standalone approval before the combined artifact can
    be approved, so the test writes three artifacts for one model year.
    Baseline reuse avoids loading the same tiny dataset three times.
    """
    baseline = build_microsimulation(TINY_DATASET)
    bundle = load_bundle_manifest()
    release = bundle["data_releases"]["uk"]
    resolved = _apply_dataset_overlays("uk", dict(release), dict(bundle))
    tiny_reference = resolved["datasets"][TINY_DATASET]
    dataset_path = Path(baseline.policyengine_bundle["runtime_dataset_source"])
    dataset_sha256 = _sha256(dataset_path)
    assert dataset_sha256 == tiny_reference["sha256"]
    assert baseline.policyengine_bundle["runtime_dataset"] == TINY_DATASET

    # The synthetic test measures are content-bound. A clean revision fixture
    # makes this test independent of edits elsewhere in a developer's tree.
    revision = receipts.CodeRevision(receipts.code_revision().git_sha, True)
    current_law = receipts.scenario_identity(
        None, name="tiny current law", revision=revision
    )
    unmodified = receipts.build_receipt_document(
        baseline,
        baseline,
        receipts.ReceiptInputs(
            key="current_law",
            measure_ids=["current_law"],
            years=[2027],
            baseline_identity=current_law,
            reform_identity=current_law,
            file_digests={"probe.csv": "0" * 64},
            basis=receipts.load_basis(),
            revision=revision,
        ),
    )
    certified = release["certified_data_artifact"]
    tiny_is_certified = (
        certified["dataset"] == TINY_DATASET
        and certified["sha256"] == dataset_sha256
    )
    assert unmodified["execution_receipt"]["certification_status"] == (
        "certified" if tiny_is_certified else "uncertified"
    )
    if not tiny_is_certified:
        assert unmodified["dashboard"]["publishable"] is False
        assert (
            "the model and data pair is not certified"
            in unmodified["dashboard"]["reasons"]
        )
        fixture_bundle = copy.deepcopy(bundle)
        fixture_release = fixture_bundle["data_releases"]["uk"]
        fixture_release["datasets"][TINY_DATASET] = copy.deepcopy(
            tiny_reference
        )
        fixture_release["certified_data_artifact"].update(
            dataset=TINY_DATASET, sha256=dataset_sha256
        )
        bundle_path = tmp_path / "test-only-tiny-bundle.json"
        bundle_path.write_text(json.dumps(fixture_bundle))
        monkeypatch.setattr(
            certification, "default_bundle_source_path", lambda: bundle_path
        )
        monkeypatch.setattr(
            receipts, "load_bundle_manifest", lambda: fixture_bundle
        )
    monkeypatch.setattr(generation, "code_revision", lambda root: revision)

    measures = [
        Reform(
            id="briefing_basic_rate",
            name="Basic rate 21p",
            parameter_changes={BASIC_RATE: {"2027": 0.21}},
        ),
        Reform(
            id="briefing_higher_rate",
            name="Higher rate 41p",
            parameter_changes={HIGHER_RATE: {"2027": 0.41}},
        ),
    ]
    keys = [measure.id for measure in measures]
    package_key = combined_key(keys)
    data_root = tmp_path / "public" / "data"
    config = DataConfig(
        years=[2027],
        dataset_path=TINY_DATASET,
        data_dir=tmp_path / "no-constituency-weights",
    )

    def build(dataset, scenario):
        return (
            baseline
            if scenario is None
            else build_microsimulation(dataset, scenario)
        )

    report = generation.generate_artifacts(
        measures,
        config,
        combined_sets=[measures],
        artifacts_root=data_root / "artifacts",
        repo_root=REPO_ROOT,
        generator_argv=["test_tiny_simulations_publish_and_export_briefing"],
        build=build,
    )
    assert report.refused == {}
    references = {
        read_receipt(reference.path)["dashboard"]["key"]: reference
        for reference in report.written
    }
    assert set(references) == {*keys, package_key}

    # The model's own fiscal impacts supply synthetic Treasury source rows.
    # Reconciliation and responsiveness still use the real production code.
    inputs = tmp_path / "treasury"
    (inputs / "sources").mkdir(parents=True)
    source_rows = []
    for key in keys:
        tables = read_tables(references[key].path)
        assert table_problems(tables, key=key, years=[2027]) == []
        assert all(
            tables[name]
            for name in (
                "briefing_deciles",
                "briefing_winners_losers",
                "briefing_poverty",
            )
        )
        impact = tables["budgetary_impact"][0]["value"]
        assert impact > 0
        source_rows.append(
            f"S,Test,costings,{key},{key},2027-28,{impact},static_costing,"
            "exchequer_positive,tax,\n"
        )
    (inputs / "sources" / "S.csv").write_text(
        SOURCE_HEADER + "".join(source_rows)
    )
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer\n"
        + "".join(f"{key},S,{key},,,,,\n" for key in keys)
    )
    manifest = m.Manifest()
    for key in keys:
        reference = references[key]
        reconciliation = reconcile_artifact(reference.path, inputs)
        assert reconciliation["summary"]["status"] == "pass"
        assert reconciliation["responsiveness"]["status"] == "responsive"
        (reference.path / "reconciliation.json").write_text(
            json.dumps(reconciliation)
        )
        stage(manifest, reference.path, data_root=data_root, inputs=inputs)
        approve(
            manifest, key, "Test reviewer", data_root=data_root, inputs=inputs
        )
    stage(
        manifest,
        references[package_key].path,
        data_root=data_root,
        inputs=inputs,
    )
    approve(
        manifest,
        package_key,
        "Test reviewer",
        data_root=data_root,
        inputs=inputs,
    )
    assert check(manifest, data_root=data_root, inputs=inputs) == []
    m.save_manifest(manifest, data_root)
    manifest_path = m.manifest_path(data_root)

    blog_dir = tmp_path / "briefing" / str(manifest.revision) / "measures"
    combined_dir = tmp_path / "briefing" / str(manifest.revision) / "combined"
    common = ["--manifest", str(manifest_path), "--inputs", str(inputs)]
    assert (
        _generator("generate_blog_charts").main(
            [*common, "--keys", *keys, "--out-dir", str(blog_dir)]
        )
        == 0
    )
    assert (
        _generator("generate_combined_charts").main(
            [*common, "--key", package_key, "--out-dir", str(combined_dir)]
        )
        == 0
    )
    blog_receipt = _assert_export_binding(
        blog_dir, manifest_path, references, keys
    )
    assert len(blog_receipt["files"]) == 3 * len(keys)
    combined_receipt = _assert_export_binding(
        combined_dir, manifest_path, references, [package_key]
    )
    assert set(combined_receipt["files"]) == {
        "distributional.html",
        "winners_losers.html",
        "constituency_map.html",
        "poverty_inequality.html",
    }
    for name in combined_receipt["files"]:
        html = (combined_dir / name).read_text()
        assert f"publication manifest rev {manifest.revision}" in html
        assert combined_receipt["manifest_sha256"][:12] in html
