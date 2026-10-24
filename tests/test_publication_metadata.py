"""Public registry text follows the existing publication and review gates."""

import csv
import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

from tests.publication_support import World
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import DataPipeline
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, check, stage
from uk_budget_data.publication.release_index import (
    INDEX_FILE,
    release_index_problems,
    write_release_index,
)
from uk_budget_data.publication.review_rows import REVIEW_COLUMNS, review_rows
from uk_budget_data.reforms import PUBLIC_PERSONAL_SERIES, get_reform

DESCRIPTION = 'A public explanation, including punctuation and "quotes".'


@pytest.fixture
def world():
    instance = World()
    yield instance
    instance.close()


def test_save_all_keeps_canonical_columns_and_round_trips_through_real_js_parser(
    tmp_path,
):
    measure = Reform(
        id="ab2026_mock_alpha",
        name='Mock, "alpha"\nwith a second line',
        description=DESCRIPTION,
    )
    frame = pd.DataFrame(
        [
            {
                "reform_id": measure.id,
                "reform_name": measure.name,
                "year": 2026,
                "value": -1,
            }
        ]
    )
    DataPipeline(
        reforms=[measure], config=DataConfig(output_dir=tmp_path)
    )._save_all({"budgetary_impact": frame})

    published = pd.read_csv(tmp_path / "budgetary_impact.csv")
    assert list(published.columns) == [
        "reform_id",
        "reform_name",
        "year",
        "value",
    ]
    assert published.iloc[0]["reform_name"] == measure.name
    assert "reform_description" not in frame
    bun = shutil.which("bun")
    assert bun is not None, "The _save_all parser contract requires bun"
    parsed = subprocess.run(
        [
            bun,
            "-e",
            'import { parseTable } from "./src/utils/publication/csv.js"; console.log(JSON.stringify(parseTable("budgetary_impact", await Bun.stdin.text())));',
        ],
        input=(tmp_path / "budgetary_impact.csv").read_text(),
        text=True,
        capture_output=True,
        check=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert json.loads(parsed.stdout) == [
        {
            "reform_id": measure.id,
            "reform_name": measure.name,
            "year": 2026,
            "value": -1,
        }
    ]


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


def test_no_legacy_lifetime_mapping_is_published():
    assert PUBLIC_PERSONAL_SERIES == {}


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


def test_reviewed_personal_year_contract_is_explicit_and_preserved():
    contract = {
        "key": "impact_alpha",
        "model": "lifecycle",
        "reviewed": True,
        "description": "Implements the published alpha parameters",
        "years": [2026, 2029],
        "unsupported_years": [2027],
    }
    assert (
        m.PersonalSeries.model_validate(contract).model_dump(exclude_none=True)
        == contract
    )


@pytest.mark.parametrize(
    "change",
    [
        {"model": "unknown"},
        {"reviewed": "true"},
        {"description": " "},
        {"years": [2026, 2026]},
        {"years": [2026], "unsupported_years": [2026]},
        {"policies": ["alpha", "alpha"]},
    ],
)
def test_personal_contract_rejects_ambiguous_parameters(change):
    contract = {
        "key": "impact_alpha",
        "model": "lifecycle",
        "reviewed": True,
        "description": "Implements the published alpha parameters",
        "years": [2026, 2029],
        "unsupported_years": [2027],
        **change,
    }
    with pytest.raises(ValueError):
        m.PersonalSeries.model_validate(contract)


def _flat_snapshot(world):
    key = "ab2026_mock_alpha"
    reference = world.ready(key, {2027: -1.0})
    manifest = m.Manifest()
    args = {"data_root": world.data_root, "inputs": world.inputs}
    stage(manifest, reference.path, **args)
    approve(manifest, key, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    shutil.copyfile(
        reference.path / "budgetary_impact.csv",
        world.data_root / "budgetary_impact.csv",
    )
    return manifest, args


def _build_index_problems(world):
    result = subprocess.run(
        [
            shutil.which("bun"),
            "-e",
            'import { checkReleaseIndex } from "./scripts/check-public-files.mjs"; console.log(JSON.stringify(checkReleaseIndex(process.argv[1])));',
            str(world.root),
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_release_index_binds_manifest_revision_and_every_csv_byte(world):
    manifest, args = _flat_snapshot(world)
    revision = manifest.revision
    write_release_index(manifest, **args)
    index = json.loads((world.data_root / INDEX_FILE).read_bytes())
    assert index["manifest_revision"] == revision + 1 == manifest.revision
    assert index["release"] == m.CURRENT_RELEASE
    assert index["budget"] == m.CURRENT_BUDGET
    assert index["files"] == manifest.flat_files
    assert set(index["files"]) == {"budgetary_impact.csv"}
    assert check(manifest, **args) == []
    assert _build_index_problems(world) == []


def test_review_rows_signs_the_bound_index_and_national_flat_tables(world):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    for entry in manifest.entries().values():
        (world.data_root / entry.artifact / "reconciliation.json").unlink(
            missing_ok=True
        )
    review_csv = world.root / "data_inputs" / "public_data_review.csv"
    review_csv.parent.mkdir(exist_ok=True)
    with review_csv.open("w", newline="") as handle:
        csv.writer(handle).writerow(REVIEW_COLUMNS)
    report = review_rows(
        reviewer="Reviewer", data_root=world.data_root, review_csv=review_csv
    )
    assert "public/data/release-index.json" in report.added
    assert "public/data/budgetary_impact.csv" in report.added
    assert not report.unreviewed


@pytest.mark.parametrize(
    "mutation", ["csv", "revision", "output_digest", "unbound_csv"]
)
def test_publication_and_public_file_gates_refuse_mixed_snapshots(
    world, mutation
):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    if mutation == "csv":
        path = world.data_root / "budgetary_impact.csv"
        path.write_text(path.read_text().replace("-1.0", "-2.0"))
    elif mutation == "unbound_csv":
        (world.data_root / "age_impact.csv").write_text("reform_id,year\n")
    else:
        path = m.manifest_path(world.data_root)
        raw = json.loads(path.read_bytes())
        if mutation == "revision":
            raw["revision"] += 1
        else:
            raw["measures"]["ab2026_mock_alpha"]["outputs_sha256"] = "f" * 64
        path.write_text(json.dumps(raw))
    assert release_index_problems(world.data_root, manifest)
    assert check(manifest, **args)
    assert _build_index_problems(world)


def test_index_writer_refuses_stale_flat_figures_even_after_new_approval(
    world,
):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    before = m.manifest_path(world.data_root).read_bytes()
    path = world.data_root / "budgetary_impact.csv"
    path.write_text(path.read_text().replace("-1.0", "-2.0"))
    with pytest.raises(
        PublishError, match="rows differ from approved artifact"
    ):
        write_release_index(manifest, **args)
    assert m.manifest_path(world.data_root).read_bytes() == before
    assert not (world.data_root / INDEX_FILE).exists()


@pytest.mark.parametrize("year,held", [(2026, False), (2027, True)])
def test_index_writer_refuses_unsupported_years_and_held_entries(
    world, year, held
):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    if held:
        manifest.measures["ab2026_mock_alpha"].status = m.STAGED
    path = world.data_root / "budgetary_impact.csv"
    path.write_text(path.read_text().replace("2027", str(year)))
    with pytest.raises(
        PublishError,
        match="unsupported year|absent from the displayable manifest",
    ):
        write_release_index(manifest, **args)
    assert not (world.data_root / INDEX_FILE).exists()
