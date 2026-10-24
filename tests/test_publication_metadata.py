"""Public registry text follows the existing publication and review gates."""

import csv
import json
import os
import re
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
    AREA_FILES,
    AREA_PROVENANCE_FILE,
    FLAT_VIEW_FILES,
    INDEX_FILE,
    area_problems,
    manifest_identity_problems,
    release_index_problems,
    write_area_provenance,
    write_release_index,
)
from uk_budget_data.publication.review_rows import REVIEW_COLUMNS, review_rows
from uk_budget_data.publication.tables import sha256_bytes
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
    if bun is None:
        # CI's Python job has no bun; the fixture pair below covers it there
        pytest.skip("bun is not installed")
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


# The tables _save_all writes, and the fixture they must equal byte for
# byte. src/utils/publication/savedFlat.test.js parses the same fixture
# with the page's real CSV parser, so together the two tests carry the
# regenerated files to the parser without bun in the Python job.
SAVED_FLAT_FIXTURE = (
    Path(__file__).resolve().parents[1] / "src" / "test" / "fixtures" / "flat"
)
SAVED_TABLES = (
    "budgetary_impact",
    "distributional_impact",
    "winners_losers",
    "metrics",
    "income_curve",
    "age_impact",
)
OBR_COLUMNS = (
    ("reform_id", "str"),
    ("reform_name", "str"),
    ("year", "int"),
    ("policyengine_value", "float"),
    ("obr_static_value", "float"),
    ("obr_post_behavioural_value", "float"),
)
# TEST DATA ONLY: one synthetic row per table, with the cells a regenerated
# file can carry that need quoting
TEXT = {
    "reform_id": "ab2026_mock_alpha",
    "reform_name": 'Mock, "alpha"\nwith a second line, \u00a3 and \u00e9',
    "decile": "1st",
    "household": "single_renter",
    "x_variable": "employment_income",
    "age_band": "16-24",
}


def _saved_frames():
    from uk_budget_data.publication.tables import TABLES

    def row(columns):
        values = {"str": None, "int": 2026, "float": -1.25, "bool": True}
        return {
            name: TEXT.get(name, "text") if kind == "str" else values[kind]
            for name, kind in columns
        }

    frames = {
        name: pd.DataFrame([row(TABLES[name].columns)])
        for name in SAVED_TABLES
    }
    frames["obr_comparison"] = pd.DataFrame([row(OBR_COLUMNS)])
    return frames


def test_save_all_output_is_the_fixture_the_js_parser_reads(tmp_path):
    measure = Reform(
        id=TEXT["reform_id"], name=TEXT["reform_name"], description=DESCRIPTION
    )
    DataPipeline(
        reforms=[measure], config=DataConfig(output_dir=tmp_path)
    )._save_all(_saved_frames())
    written = sorted(path.name for path in tmp_path.glob("*.csv"))
    assert written == sorted(
        [f"{name}.csv" for name in SAVED_TABLES] + ["obr_comparison.csv"]
    )
    if os.environ.get("REGENERATE_FLAT_FIXTURE") == "1":
        SAVED_FLAT_FIXTURE.mkdir(parents=True, exist_ok=True)
        for name in written:
            shutil.copyfile(tmp_path / name, SAVED_FLAT_FIXTURE / name)
    for name in written:
        assert (tmp_path / name).read_bytes() == (
            SAVED_FLAT_FIXTURE / name
        ).read_bytes(), (
            f"{name} differs from src/test/fixtures/flat; regenerate with "
            "REGENERATE_FLAT_FIXTURE=1 uv run pytest "
            "tests/test_publication_metadata.py -k fixture_the_js_parser"
        )


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


KEY = "ab2026_mock_alpha"
# TEST DATA ONLY: the area run's alias for a package (geography.PACKAGES)
ALIAS = "synthetic_area_package"
AREA_HEADER = (
    "level,area_code,area_name,reform,year,outcome,value,lo,hi,direction,"
    "tier,reason,support_band,noise,estimator\n"
)


def _area_rows(*reforms):
    return AREA_HEADER + "".join(
        f"region,E12000001,Synthetic area,{reform},2027,relative_change,"
        "0.01,0.005,0.015,gain,reported,,30+,False,direct\n"
        for reform in reforms
    )


def _area_run(world, manifest, reforms):
    """What the area run writes: regional.csv and its provenance.

    ``reforms`` maps each id the table uses to the manifest key it stands
    for, as geography.area_provenance records it.
    """
    path = world.data_root / "regional.csv"
    path.write_text(_area_rows(*reforms))
    raw = m.manifest_path(world.data_root).read_bytes()
    provenance = {
        "manifest_revision": manifest.revision,
        "manifest_sha256": sha256_bytes(raw),
        "reforms": {
            reform: {
                "key": key,
                "outputs_sha256": manifest.entries()[key].outputs_sha256,
            }
            for reform, key in reforms.items()
        },
    }
    return write_area_provenance(world.data_root, provenance, [path])


def _flat_snapshot(world):
    """An approved measure, its saved manifest, and an area run to bind.

    The flat pipeline's files are copied to the root as well: no view reads
    budgetary_impact.csv, and obr_comparison.csv is never bindable, so the
    index binds neither.
    """
    reference = world.ready(KEY, {2027: -1.0})
    manifest = m.Manifest()
    args = {"data_root": world.data_root, "inputs": world.inputs}
    stage(manifest, reference.path, **args)
    approve(manifest, KEY, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    shutil.copyfile(
        reference.path / "budgetary_impact.csv",
        world.data_root / "budgetary_impact.csv",
    )
    (world.data_root / "obr_comparison.csv").write_text(
        "reform_id,reform_name,year,policyengine_value,"
        "obr_static_value,obr_post_behavioural_value\n"
        f"{KEY},Alpha,2027,-1.0,-1.1,-1.2\n"
    )
    _area_run(world, manifest, {KEY: KEY})
    return manifest, args


def _build_index_problems(world):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed (CI has it)")
    result = subprocess.run(
        [
            node,
            "--input-type=module",
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


def test_flat_view_files_are_the_same_in_python_and_the_build_check():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "check-public-files.mjs"
    ).read_text()
    match = re.search(r"FLAT_VIEW_FILES = \[([^\]]*)\]", script)
    assert match is not None
    assert tuple(re.findall(r'"([^"]+)"', match.group(1))) == FLAT_VIEW_FILES
    # Results by area only: the OBR file holds the November 2025 costings
    assert FLAT_VIEW_FILES == AREA_FILES
    assert "obr_comparison.csv" not in FLAT_VIEW_FILES


def test_release_index_binds_the_manifest_and_only_the_area_files(world):
    manifest, args = _flat_snapshot(world)
    revision = manifest.revision
    write_release_index(manifest, **args)
    index = json.loads((world.data_root / INDEX_FILE).read_bytes())
    assert index["manifest_revision"] == revision + 1 == manifest.revision
    assert index["release"] == m.CURRENT_RELEASE
    assert index["budget"] == m.CURRENT_BUDGET
    assert index["files"] == manifest.flat_files
    assert set(index["files"]) == {"regional.csv"}
    assert index["aliases"] == {}
    saved = m.manifest_path(world.data_root).read_bytes()
    assert index["manifest_sha256"] == sha256_bytes(saved)
    assert json.loads(saved)["flat_files"] == index["files"]
    assert check(manifest, **args) == []
    assert _build_index_problems(world) == []


def test_an_area_alias_maps_to_the_combined_run_it_stands_for(world):
    """The area run labels a package by its alias (geography.PACKAGES);
    publish index records which manifest key that is, for the page."""
    manifest, _ = _flat_snapshot(world)
    package = "combined--" + KEY
    manifest.combined[package] = manifest.measures[KEY].model_copy(deep=True)
    _area_run(world, manifest, {KEY: KEY, ALIAS: package})
    files = {"regional.csv": (world.data_root / "regional.csv").read_bytes()}
    problems, aliases = area_problems(manifest, files, world.data_root)
    assert problems == []
    assert aliases == {ALIAS: package}
    # A package held back is refused through its alias
    manifest.combined[package].status = m.STALE
    problems, _ = area_problems(manifest, files, world.data_root)
    assert any("which is stale" in problem for problem in problems)


@pytest.mark.parametrize(
    "aliases",
    [{ALIAS: "combined--not-listed"}, {KEY: KEY}, None],
)
def test_the_gates_refuse_index_aliases_that_name_no_manifest_key(
    world, aliases
):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    index_path = world.data_root / INDEX_FILE
    index = json.loads(index_path.read_bytes())
    index["aliases"] = aliases
    index_path.write_text(json.dumps(index))
    assert any(
        "aliases" in problem
        for problem in release_index_problems(world.data_root, manifest)
    )
    assert any(
        "aliases" in problem for problem in _build_index_problems(world)
    )


def test_review_rows_sign_the_bound_index_and_the_area_provenance(world):
    manifest, args = _flat_snapshot(world)
    (world.data_root / "budgetary_impact.csv").unlink()
    (world.data_root / "obr_comparison.csv").unlink()
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
    assert f"public/data/{AREA_PROVENANCE_FILE}" in report.added
    # Disclosure tables keep their own review process
    assert {path for path, _ in report.unreviewed} <= {
        "public/data/regional.csv"
    }


@pytest.mark.parametrize(
    "mutation",
    ["csv", "revision", "output_digest", "unbound_view_file", "unread_file"],
)
def test_publication_and_public_file_gates_refuse_mixed_snapshots(
    world, mutation
):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    path = m.manifest_path(world.data_root)
    raw = json.loads(path.read_bytes())
    if mutation == "csv":
        area = world.data_root / "regional.csv"
        area.write_text(area.read_text().replace("0.01,", "0.02,"))
    elif mutation == "unbound_view_file":
        (world.data_root / "constituency.csv").write_text(_area_rows(KEY))
    elif mutation == "unread_file":
        index_path = world.data_root / INDEX_FILE
        index = json.loads(index_path.read_bytes())
        digest = sha256_bytes(
            (world.data_root / "obr_comparison.csv").read_bytes()
        )
        index["files"]["obr_comparison.csv"] = digest
        raw["flat_files"]["obr_comparison.csv"] = digest
        path.write_text(json.dumps(raw))
        index["manifest_sha256"] = sha256_bytes(path.read_bytes())
        index_path.write_text(json.dumps(index))
    else:
        if mutation == "revision":
            raw["revision"] += 1
        else:
            raw["measures"][KEY]["outputs_sha256"] = "f" * 64
        path.write_text(json.dumps(raw))
    reloaded = m.load_manifest(world.data_root)
    assert release_index_problems(world.data_root, reloaded)
    assert check(reloaded, **args)
    assert _build_index_problems(world)


def test_a_later_approval_makes_the_index_stale_until_reindexed(world):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    m.save_manifest(manifest, world.data_root)  # e.g. a later stage or approve
    assert "release index: manifest revision differs" in check(
        manifest, **args
    )
    assert _build_index_problems(world)
    write_release_index(manifest, **args)
    assert check(manifest, **args) == []
    assert _build_index_problems(world) == []


def test_index_refuses_area_results_made_for_an_earlier_version(world):
    """Round-2 review: a correction restages and reapproves a measure; the
    area run is not rerun; publish index must not bind the old tables."""
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    corrected = world.ready(KEY, {2027: -3.0})
    stage(manifest, corrected.path, **args)
    approve(manifest, KEY, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    with pytest.raises(PublishError, match="made for an earlier"):
        write_release_index(manifest, **args)
    assert not (world.data_root / INDEX_FILE).exists()
    # The area run again, for the corrected entry: now it binds
    _area_run(world, manifest, {KEY: KEY})
    write_release_index(manifest, **args)
    assert check(manifest, **args) == []


@pytest.mark.parametrize(
    "change", ["no provenance", "edited table", "unrecorded reform"]
)
def test_index_refuses_area_tables_the_area_run_did_not_write(world, change):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    if change == "no provenance":
        (world.data_root / AREA_PROVENANCE_FILE).unlink()
    elif change == "edited table":
        area = world.data_root / "regional.csv"
        area.write_text(area.read_text().replace("0.01,", "0.02,"))
    else:
        area = world.data_root / "regional.csv"
        area.write_text(_area_rows(KEY, "unrecorded_measure"))
    with pytest.raises(PublishError, match="area"):
        write_release_index(manifest, **args)
    assert not (world.data_root / INDEX_FILE).exists()


@pytest.mark.parametrize("status", [m.STAGED, m.WITHDRAWN, m.STALE])
def test_index_writer_refuses_area_figures_for_a_held_entry(world, status):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    before = m.manifest_path(world.data_root).read_bytes()
    manifest.measures[KEY].status = status
    with pytest.raises(PublishError, match=f"which is {status}"):
        write_release_index(manifest, **args)
    assert m.manifest_path(world.data_root).read_bytes() == before
    assert not (world.data_root / INDEX_FILE).exists()


def test_index_writer_needs_an_area_file_and_a_saved_current_manifest(world):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    (world.data_root / "regional.csv").unlink()
    with pytest.raises(PublishError, match="no flat view file to bind"):
        write_release_index(manifest, **args)
    manifest, args = _flat_snapshot(world)
    path = m.manifest_path(world.data_root)
    raw = json.loads(path.read_bytes())
    del raw["release"]
    path.write_text(json.dumps(raw))
    with pytest.raises(PublishError, match="current 2026 Budget"):
        write_release_index(manifest, **args)
    assert not (world.data_root / INDEX_FILE).exists()


@pytest.mark.parametrize(
    "identity",
    [
        {"release": None},
        {"budget": None},
        {"release": "uk-autumn-budget-2025"},
        {"budget": {"id": "uk-autumn-budget-2026", "date": "2025-11-26"}},
    ],
)
def test_every_gate_reads_the_manifest_files_own_identity(world, identity):
    """The model fills a missing identity; the page reads the file."""
    manifest, args = _flat_snapshot(world)
    path = m.manifest_path(world.data_root)
    raw = json.loads(path.read_bytes())
    for field, value in identity.items():
        if value is None:
            del raw[field]
        else:
            raw[field] = value
    path.write_text(json.dumps(raw))
    assert manifest_identity_problems(world.data_root)
    assert check(manifest, **args)
    assert _build_index_problems(world)
