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
    PROVENANCE_KIND,
    area_problems,
    identity_core,
    manifest_identity_problems,
    release_index_problems,
    unbind_area_results,
    write_area_provenance,
    write_release_index,
)
from uk_budget_data.publication.review_rows import REVIEW_COLUMNS, review_rows
from uk_budget_data.publication.tables import sha256_bytes
from uk_budget_data.reforms import PUBLIC_PERSONAL_SERIES

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
        values = {
            "str": None,
            "int": 2026,
            "float": -1.25,
            # A figure the floor may withhold, here published
            "float_or_withheld": -1.25,
            "bool": True,
        }
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
                "artifact": manifest.entries()[key].artifact,
                "execution_identity_sha256": manifest.entries()[
                    key
                ].execution_identity_sha256,
                **{
                    side: identity_core(
                        read_receipt(
                            world.data_root / manifest.entries()[key].artifact
                        )["execution_receipt"][side]
                    )
                    for side in ("baseline", "reform")
                },
                "artifact_sha256": manifest.entries()[key].artifact_sha256,
                "receipt_sha256": manifest.entries()[key].receipt_sha256,
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
    # The last: round-2 review, relabelling a package as a measure
    [{ALIAS: "combined--not-listed"}, {KEY: KEY}, None, {ALIAS: KEY}],
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
    with review_csv.open() as handle:
        provenance_row = next(
            row
            for row in csv.DictReader(handle)
            if row["path"] == f"public/data/{AREA_PROVENANCE_FILE}"
        )
    assert provenance_row["kind"] == PROVENANCE_KIND
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


SECOND = "ab2026_mock_beta"


def _package_snapshot(world):
    """Two approved measures and their approved package, an area run over
    all three (the package by its alias) and the index binding it: results
    by area as G4 leaves them."""
    references, records = {}, {}
    for key, value in ((KEY, -1.0), (SECOND, -0.5)):
        references[key] = world.ready(key, {2027: value})
        receipt = read_receipt(references[key].path)
        records[key] = {
            "id": key,
            "baseline": receipt["execution_receipt"]["baseline"],
            "reform": receipt["execution_receipt"]["reform"],
        }
    members = sorted(records)
    package = "combined--" + "+".join(members)
    references[package] = world.write(
        package,
        {2027: -1.5},
        members=[records[member] for member in members],
        measure_ids=members,
        member_outputs={
            member: references[member].outputs_sha256 for member in members
        },
    )
    world.reconcile(references[package])
    manifest = m.Manifest()
    args = {"data_root": world.data_root, "inputs": world.inputs}
    for key, reference in references.items():
        stage(manifest, reference.path, **args)
        approve(manifest, key, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    _area_run(world, manifest, {KEY: KEY, SECOND: SECOND, ALIAS: package})
    write_release_index(manifest, **args)
    assert check(manifest, **args) == []
    return manifest, args, package


def _withdraw(world, manifest, key):
    """``publish withdraw``, as the command saves it."""
    from uk_budget_data.publication.publish import withdraw

    withdraw(manifest, key, "A correction changes its definition")
    m.save_manifest(manifest, world.data_root)


def test_a_g5_withdrawal_is_refused_by_the_index_while_areas_hold_its_rows(
    world,
):
    """Review of 428d209, finding 4: withdraw, then re-index, stops here."""
    from uk_budget_data.publication.publish import PublishError

    manifest, args, package = _package_snapshot(world)
    _withdraw(world, manifest, KEY)
    assert manifest.combined[package].status == m.STALE
    with pytest.raises(PublishError) as refused:
        write_release_index(manifest, **args)
    problems = " ".join(refused.value.problems)
    assert f"{KEY} stands for {KEY}, which is withdrawn" in problems
    assert f"{ALIAS} stands for {package}, which is stale" in problems
    assert "release index: manifest revision differs" in check(
        manifest, **args
    )


def test_g5_without_area_takes_the_area_views_down_and_passes_check(world):
    manifest, args, _ = _package_snapshot(world)
    _withdraw(world, manifest, KEY)
    revision = manifest.revision
    unbind_area_results(manifest, data_root=world.data_root)
    assert manifest.revision == revision + 1
    assert manifest.flat_files == manifest.flat_aliases == {}
    assert manifest.flat_provenance_sha256 is None
    assert m.load_manifest(world.data_root) == manifest
    for name in (*AREA_FILES, AREA_PROVENANCE_FILE, INDEX_FILE):
        assert not (world.data_root / name).exists()
    assert check(manifest, **args) == []
    assert _build_index_problems(world) == []
    # Rerunning it changes nothing but the revision
    unbind_area_results(manifest, data_root=world.data_root)
    assert check(manifest, **args) == []


@pytest.mark.parametrize("stop_at", ["area file", "manifest save"])
def test_g5_without_area_stopped_part_way_fails_check_until_rerun(
    world, monkeypatch, stop_at
):
    """Review of 15439f4, finding 6: stopped after saving the manifest, the
    old order left the withdrawn rows in area files that publish check
    accepted. Now no area file outlives the binding, and every state part
    way fails check until the command is rerun."""
    from pathlib import Path

    from uk_budget_data.publication import release_index

    manifest, args, _ = _package_snapshot(world)
    _withdraw(world, manifest, KEY)
    unlink, save = Path.unlink, release_index.m.save_manifest

    def stopped(*_args, **_kwargs):
        raise OSError("interrupted")

    if stop_at == "area file":
        monkeypatch.setattr(
            Path,
            "unlink",
            lambda path, *a, **k: (
                stopped()
                if path.name == AREA_FILES[0]
                else unlink(path, *a, **k)
            ),
        )
    else:
        monkeypatch.setattr(release_index.m, "save_manifest", stopped)
    with pytest.raises(OSError, match="interrupted"):
        unbind_area_results(manifest, data_root=world.data_root)
    monkeypatch.setattr(Path, "unlink", unlink)
    monkeypatch.setattr(release_index.m, "save_manifest", save)
    saved = m.load_manifest(world.data_root)
    assert saved.flat_files, "the saved manifest still binds the area files"
    assert not (world.data_root / INDEX_FILE).exists()
    assert check(saved, **args) != []
    unbind_area_results(saved, data_root=world.data_root)
    for name in (*AREA_FILES, AREA_PROVENANCE_FILE, INDEX_FILE):
        assert not (world.data_root / name).exists()
    assert check(saved, **args) == []


def test_g5_area_rerun_over_the_approved_subset_binds_again(world):
    """With the package stale, the area run covers what is still approved:
    here regions only, for the other measure."""
    manifest, args, _ = _package_snapshot(world)
    _withdraw(world, manifest, KEY)
    _area_run(world, manifest, {SECOND: SECOND})
    write_release_index(manifest, **args)
    assert manifest.flat_aliases == {}
    assert check(manifest, **args) == []
    assert _build_index_problems(world) == []


def test_g5_review_rows_drop_the_rows_of_the_area_files_taken_down(world):
    manifest, args, _ = _package_snapshot(world)
    for name in ("budgetary_impact.csv", "obr_comparison.csv"):
        (world.data_root / name).unlink(missing_ok=True)
    for entry in manifest.entries().values():
        (world.data_root / entry.artifact / "reconciliation.json").unlink(
            missing_ok=True
        )
    review_csv = world.root / "data_inputs" / "public_data_review.csv"
    review_csv.parent.mkdir(exist_ok=True)
    with review_csv.open("w", newline="") as handle:
        csv.writer(handle).writerow(REVIEW_COLUMNS)
    review_rows(
        reviewer="Reviewer", data_root=world.data_root, review_csv=review_csv
    )
    _withdraw(world, manifest, KEY)
    unbind_area_results(manifest, data_root=world.data_root)
    report = review_rows(
        reviewer="Reviewer", data_root=world.data_root, review_csv=review_csv
    )
    assert {
        "public/data/release-index.json",
        f"public/data/{AREA_PROVENANCE_FILE}",
    } <= set(report.removed)
    with review_csv.open() as handle:
        paths = {row["path"] for row in csv.DictReader(handle)}
    for name in (*AREA_FILES, AREA_PROVENANCE_FILE, INDEX_FILE):
        assert f"public/data/{name}" not in paths


def test_publish_index_without_area_runs_from_the_command_line(world):
    from argparse import Namespace

    from uk_budget_data.publication.commands import run_publish

    manifest, args, _ = _package_snapshot(world)
    _withdraw(world, manifest, KEY)
    said = []
    code = run_publish(
        Namespace(
            action="index",
            without_area=True,
            data_root=world.data_root,
            inputs=world.inputs,
        ),
        out=said.append,
    )
    assert code == 0, said
    assert "taken off the page" in said[0]
    assert check(m.load_manifest(world.data_root), **args) == []


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


def test_publish_check_recomputes_aliases_from_the_area_runs_record(world):
    """Round-2 review: an alias written into both the index and the
    manifest still has to be the one the area run recorded."""
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    path = m.manifest_path(world.data_root)
    raw = json.loads(path.read_bytes())
    raw["flat_aliases"] = {ALIAS: KEY}
    path.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n")
    index_path = world.data_root / INDEX_FILE
    index = json.loads(index_path.read_bytes())
    index["aliases"] = {ALIAS: KEY}
    index["manifest_sha256"] = sha256_bytes(path.read_bytes())
    index_path.write_text(json.dumps(index))
    problems = release_index_problems(
        world.data_root, m.load_manifest(world.data_root)
    )
    assert (
        "release index: aliases differ from the area run's record" in problems
    )


@pytest.mark.parametrize(
    "field", ["artifact_sha256", "receipt_sha256", "execution_identity_sha256"]
)
def test_same_output_digests_do_not_authorise_changed_area_identities(
    world, field
):
    """Review2 finding1: outputs alone never identify an approved run."""
    manifest, args = _flat_snapshot(world)
    entry = manifest.measures[KEY]
    entry.__dict__[field] = "f" * 64
    files = {"regional.csv": (world.data_root / "regional.csv").read_bytes()}
    problems, _ = area_problems(manifest, files, world.data_root)
    assert any(
        "earlier" in problem or "receipt identity differs" in problem
        for problem in problems
    )


@pytest.mark.parametrize("field", ["artifact", "baseline", "reform"])
def test_index_checks_the_area_record_against_the_approved_receipt(
    world, field
):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    path = world.data_root / AREA_PROVENANCE_FILE
    provenance = json.loads(path.read_bytes())
    record = provenance["reforms"][KEY]
    if field == "artifact":
        record[field] = "artifacts/another-approved-run"
    else:
        record[field] = {
            "kind": "reform",
            "representation": "policyengine-uk.scenario/v1",
            "reform_sha256": "f" * 64,
            "binding": "content",
        }
    path.write_text(json.dumps(provenance))
    with pytest.raises(PublishError, match="area"):
        write_release_index(manifest, **args)


def test_area_provenance_is_part_of_the_verified_flat_snapshot(world):
    manifest, args = _flat_snapshot(world)
    write_release_index(manifest, **args)
    path = world.data_root / AREA_PROVENANCE_FILE
    index = json.loads((world.data_root / INDEX_FILE).read_bytes())
    assert (
        manifest.flat_provenance_sha256
        == index["flat_provenance_sha256"]
        == sha256_bytes(path.read_bytes())
    )
    # Even a semantically unchanged sidecar must be the reviewed bytes.
    path.write_bytes(path.read_bytes() + b" ")
    assert any("provenance" in problem for problem in check(manifest, **args))
    assert any(
        "provenance" in problem for problem in _build_index_problems(world)
    )


def test_reapproval_with_identical_outputs_still_invalidates_area_provenance(
    world,
):
    from uk_budget_data.publication.publish import PublishError

    manifest, args = _flat_snapshot(world)
    original_outputs = manifest.measures[KEY].outputs_sha256
    corrected = world.ready(KEY, {2027: -1.0}, rate=0.31)
    assert corrected.outputs_sha256 == original_outputs
    stage(manifest, corrected.path, **args)
    approve(manifest, KEY, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    with pytest.raises(PublishError, match="made for an earlier"):
        write_release_index(manifest, **args)
