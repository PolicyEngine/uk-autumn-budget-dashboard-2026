"""Public registry text follows the existing publication and review gates."""

import csv
import json
from pathlib import Path

import pandas as pd
import pytest

from tests.publication_support import World
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import DataPipeline
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, check, stage
from uk_budget_data.publication.review_rows import REVIEW_COLUMNS, review_rows
from uk_budget_data.reforms import PUBLIC_PERSONAL_SERIES, get_reform

DESCRIPTION = 'A public explanation, including punctuation and "quotes".'


@pytest.fixture
def world():
    instance = World()
    yield instance
    instance.close()


def test_flat_budgetary_rows_publish_the_registry_description(tmp_path):
    measure = Reform(
        id="ab2026_mock_alpha",
        name="Mock alpha",
        description=DESCRIPTION,
    )
    frame = pd.DataFrame(
        [{"reform_id": measure.id, "reform_name": measure.name, "value": -1}]
    )
    DataPipeline(
        reforms=[measure], config=DataConfig(output_dir=tmp_path)
    )._save_all({"budgetary_impact": frame})

    published = pd.read_csv(tmp_path / "budgetary_impact.csv")
    assert published.iloc[0]["reform_description"] == DESCRIPTION
    assert published.iloc[0]["reform_name"] == measure.name
    assert "reform_description" not in frame


def test_description_is_bound_through_staging_approval_and_review(world):
    key = "ab2026_mock_alpha"
    personal = {"key": "impact_mock_alpha"}
    reference = world.ready(
        key, {2027: -1.0}, description=DESCRIPTION, personal=personal
    )
    document = read_receipt(reference.path)
    assert document["dashboard"]["description"] == DESCRIPTION
    assert document["dashboard"]["personal"] == personal
    manifest = m.Manifest()
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert manifest.measures[key].description == DESCRIPTION
    assert (
        manifest.measures[key].personal.model_dump(exclude_none=True)
        == personal
    )
    approve(
        manifest,
        key,
        "Reviewer",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )

    # The manifest and receipt carry the description inside the same
    # digest-based public-file review as the tables.
    (reference.path / "reconciliation.json").unlink()
    m.save_manifest(manifest, world.data_root)
    review_csv = world.root / "data_inputs" / "public_data_review.csv"
    review_csv.parent.mkdir()
    with review_csv.open("w", newline="") as handle:
        csv.writer(handle).writerow(REVIEW_COLUMNS)
    report = review_rows(
        reviewer="Reviewer",
        data_root=world.data_root,
        review_csv=review_csv,
    )
    assert "public/data/manifest.json" in report.added
    assert any(path.endswith("/receipt.json") for path in report.added)

    manifest.measures[key].description = "Unreviewed replacement"
    assert any(
        "description is not the artifact's" in problem
        for problem in check(
            manifest, data_root=world.data_root, inputs=world.inputs
        )
    )
    manifest.measures[key].description = DESCRIPTION
    manifest.measures[key].personal.key = "unreviewed_response_column"
    assert any(
        "personal mapping is not the artifact's" in problem
        for problem in check(
            manifest, data_root=world.data_root, inputs=world.inputs
        )
    )


def test_description_changes_artifact_identity_without_changing_figures(world):
    first = world.write("ab2026_mock_alpha", {2027: -1.0}, description="First")
    second = world.write(
        "ab2026_mock_alpha", {2027: -1.0}, description="Second"
    )
    assert first.outputs_sha256 == second.outputs_sha256
    assert first.artifact_sha256 != second.artifact_sha256


def test_older_manifest_entries_keep_an_empty_description(world):
    reference = world.ready("ab2026_mock_alpha", {2027: -1.0})
    manifest = m.Manifest()
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    raw = manifest.model_dump(by_alias=True)
    del raw["measures"]["ab2026_mock_alpha"]["description"]
    restored = m.parse_manifest(json.dumps(raw).encode())
    assert restored.measures["ab2026_mock_alpha"].description == ""


def test_flat_route_keeps_existing_lifetime_response_columns(tmp_path):
    reforms = [get_reform(key) for key in PUBLIC_PERSONAL_SERIES]
    frame = pd.DataFrame(
        [
            {"reform_id": reform.id, "reform_name": reform.name, "value": -1.0}
            for reform in reforms
        ]
    )
    DataPipeline(
        reforms=reforms, config=DataConfig(output_dir=tmp_path)
    )._save_all({"budgetary_impact": frame})
    published = pd.read_csv(tmp_path / "budgetary_impact.csv")
    mappings = {
        row.reform_id: json.loads(row.reform_personal)
        for row in published.itertuples()
    }
    assert mappings == PUBLIC_PERSONAL_SERIES
    assert len({mapping["key"] for mapping in mappings.values()}) == 7
    for mapping in mappings.values():
        assert set(mapping.get("policies", [])) <= set(mappings)


def test_generated_lifetime_fixture_matches_the_public_registry():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/test/fixtures/lifecycle/published-measures.json"
    )
    fixture = json.loads(path.read_text())
    assert fixture == [
        {
            "id": key,
            "name": get_reform(key).name,
            "description": get_reform(key).description,
            "personal": mapping,
        }
        for key, mapping in sorted(PUBLIC_PERSONAL_SERIES.items())
    ]


def test_personal_metadata_changes_identity_without_changing_figures(world):
    first = world.write(
        "ab2026_mock_alpha", {2027: -1.0}, personal={"key": "impact_first"}
    )
    second = world.write(
        "ab2026_mock_alpha", {2027: -1.0}, personal={"key": "impact_second"}
    )
    assert first.outputs_sha256 == second.outputs_sha256
    assert first.artifact_sha256 != second.artifact_sha256


@pytest.mark.parametrize(
    "personal",
    [
        {"key": 7},
        {"key": "impact_alpha", "policies": []},
        {"key": "impact_alpha", "extra": True},
    ],
)
def test_personal_metadata_shape_is_checked_by_publication_gate(personal):
    from uk_budget_data.publication.publish import _name_problems

    assert "its receipt's personal mapping is invalid" in _name_problems(
        {"name": "Mock alpha", "personal": personal}, {}
    )
