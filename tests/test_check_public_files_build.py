"""Tests for scripts/check-public-files.mjs, the check the build runs."""

import csv
import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from policyengine.disclosure.schema import (
    OPTIONAL_LABEL_COLUMNS,
    PUBLIC_COLUMNS,
)

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "check-public-files.mjs"
CI_SCRIPT = REPO / "scripts" / "check_public_data.py"

spec = importlib.util.spec_from_file_location("check_public_data", CI_SCRIPT)
check_public_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_public_data)
COLUMNS = REPO / "scripts" / "disclosure_public_columns.json"
REVIEW_COLUMNS = [
    "path",
    "kind",
    "sha256",
    "reviewer",
    "reviewed_on",
    "expires_on",
    "basis",
]

node = shutil.which("node")
needs_node = pytest.mark.skipif(node is None, reason="node is not installed")


def test_the_build_check_knows_the_layer_columns():
    columns = json.loads(COLUMNS.read_text())
    assert columns == {
        "required": list(PUBLIC_COLUMNS),
        "optional": list(OPTIONAL_LABEL_COLUMNS),
    }


def run(root: Path) -> list[str]:
    output = subprocess.run(
        [node, str(SCRIPT), str(root)],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    return output[:-1]


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    (tmp_path / "scripts").mkdir()
    shutil.copy(COLUMNS, tmp_path / "scripts" / COLUMNS.name)
    (tmp_path / "public").mkdir()
    return tmp_path


def write(root: Path, name: str, text: str) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def review(root: Path, rows: list[tuple[str, str, str]]) -> None:
    """Rows of (path, kind, expires_on), pinned to the bytes on disk."""
    path = root / "data_inputs" / "public_data_review.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(REVIEW_COLUMNS)
        for name, kind, expires_on in rows:
            digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
            writer.writerow(
                [name, kind, digest, "r", "2026-10-14", expires_on, "b, c"]
            )


@needs_node
def test_the_build_check_accepts_layer_tables_and_reviewed_files(tree):
    header = ",".join(PUBLIC_COLUMNS[:2] + ("area_name",) + PUBLIC_COLUMNS[2:])
    write(tree, "public/data/regional.csv", header + "\n")
    write(tree, "public/data/national.csv", "reform_id,value\nx,1\n")
    review(
        tree,
        [
            ("public/data/regional.csv", "disclosure_table", ""),
            ("public/data/national.csv", "national_table", ""),
        ],
    )
    assert run(tree) == []


@needs_node
def test_the_build_check_refuses_what_ci_refuses(tree):
    write(tree, "public/data/new.csv", "reform_id,value\nx,1\n")
    write(tree, "public/data/national.csv", "reform_id,value\nx,1\n")
    write(tree, "public/data/old.csv", "reform_id,value\nx,1\n")
    write(tree, "public/sample.json", '{"household_id": 1}')
    header = ",".join(PUBLIC_COLUMNS)
    write(tree, "public/data/regional.csv", header + "\n")
    write(tree, "public/data/fake.csv", "reform_id,value\nx,1\n")
    write(tree, "public/data/shaped.csv", header + "\n")
    review(
        tree,
        [
            ("public/data/national.csv", "national_table", ""),
            ("public/data/old.csv", "pending", "2020-01-10"),
            ("public/data/fake.csv", "disclosure_table", ""),
            ("public/data/shaped.csv", "national_table", ""),
        ],
    )
    write(tree, "public/data/national.csv", "reform_id,value\nx,2\n")
    assert run(tree) == [
        "public/data/fake.csv: reviewed as a disclosure table, but it is "
        "not one",
        "public/data/national.csv: changed since its review",
        "public/data/new.csv: not reviewed",
        "public/data/old.csv: pending past its expiry date (2020-01-10)",
        "public/data/regional.csv: not reviewed",
        "public/data/shaped.csv: reviewed as national_table, but it is a "
        "disclosure table",
        "public/sample.json: record-level identifiers",
        "public/sample.json: not reviewed",
    ]


@needs_node
@pytest.mark.parametrize(
    "text", sorted(check_public_data.AREA_ROUTING_CONTENTS)
)
def test_the_build_check_accepts_what_ci_accepts_as_area_routing(tree, text):
    path = tree / check_public_data.AREA_ROUTING_FILE
    path.parent.mkdir(parents=True)
    path.write_bytes(text)
    review(tree, [])
    assert run(tree) == []


@needs_node
@pytest.mark.parametrize(
    "text",
    [
        '{"area_views": "not_available", "regional_release_kind": null}\n',
        '{\n  "area_views": "unknown",\n  "regional_release_kind": null\n}\n',
        '{\n  "area_views": "available",\n  "regional_release_kind": null\n}\n',
    ],
)
def test_the_build_check_refuses_any_other_area_routing_text(tree, text):
    # A review entry doesn't make another text acceptable.
    name = check_public_data.AREA_ROUTING_FILE
    write(tree, name, text)
    review(tree, [(name, "static_asset", "")])
    assert run(tree) == [
        f"{name}: not an area routing status",
        f"{name}: needs no review entry",
    ]


@needs_node
def test_the_build_check_refuses_a_review_entry_for_the_routing(tree):
    # Nothing reads it, so it would only look like a review.
    name = check_public_data.AREA_ROUTING_FILE
    (tree / name).parent.mkdir(parents=True)
    (tree / name).write_bytes(min(check_public_data.AREA_ROUTING_CONTENTS))
    review(tree, [(name, "static_asset", "")])
    assert run(tree) == [f"{name}: needs no review entry"]


@needs_node
@pytest.mark.parametrize(
    "name",
    [
        "public/area-routing.json",
        "public/data/blog_charts/area-routing.json",
        "public/data/artifacts/area-routing.json",
        "public/data/Area-routing.json",
    ],
)
def test_only_the_routing_file_itself_goes_without_review(tree, name):
    (tree / name).parent.mkdir(parents=True, exist_ok=True)
    (tree / name).write_bytes(min(check_public_data.AREA_ROUTING_CONTENTS))
    review(tree, [])
    assert run(tree) == [f"{name}: not reviewed"]


@needs_node
def test_the_build_check_knows_the_same_area_routing_texts_as_ci():
    source = (
        "import { AREA_ROUTING_CONTENTS } from "
        f"{json.dumps(SCRIPT.as_uri())};\n"
        "console.log(JSON.stringify([...AREA_ROUTING_CONTENTS]));\n"
    )
    output = subprocess.run(
        [node, "--input-type=module", "-e", source],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    texts = json.loads(output)
    assert len(texts) == len(set(texts))
    assert {text.encode() for text in texts} == (
        check_public_data.AREA_ROUTING_CONTENTS
    )


@needs_node
def test_this_repository_passes_the_build_check():
    result = subprocess.run(
        [node, str(SCRIPT), str(REPO)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout.splitlines()[:-1]


@needs_node
@pytest.mark.parametrize("area_id", ["alpha", "beta"])
def test_build_requires_every_area_csv_id_in_verified_provenance(
    tree, area_id
):
    """An approved national key cannot stand in for a missing area proof."""
    fixture = REPO / "src/test/fixtures/publication"
    manifest = json.loads((fixture / "manifest.json").read_text())
    entry = manifest["measures"]["alpha"]
    receipt_text = (fixture / entry["artifact"] / "receipt.json").read_text()
    receipt = json.loads(receipt_text)
    fields = (
        "artifact",
        "artifact_sha256",
        "receipt_sha256",
        "outputs_sha256",
        "execution_identity_sha256",
    )
    record = {field: entry[field] for field in fields}
    record["key"] = "alpha"
    for side in ("baseline", "reform"):
        record[side] = {
            field: receipt["execution_receipt"][side].get(field)
            for field in ("kind", "representation", "reform_sha256", "binding")
        }
    table = f"level,area_code,reform,year,value\nregion,E12000001,{area_id},2032,12\n"
    table_digest = hashlib.sha256(table.encode()).hexdigest()
    files = {"regional.csv": table_digest}
    provenance = {
        "schema": "uk-budget-area-provenance/v1",
        "manifest_revision": manifest["revision"],
        "manifest_sha256": "a" * 64,
        "files": files,
        "reforms": {"alpha": record},
    }
    provenance_text = json.dumps(provenance)
    provenance_digest = hashlib.sha256(provenance_text.encode()).hexdigest()
    manifest.update(
        flat_files=files,
        flat_aliases={},
        flat_provenance_sha256=provenance_digest,
    )
    manifest_text = json.dumps(manifest)
    index = {
        "schema": "uk-budget-release-index/v1",
        "release": manifest["release"],
        "budget": manifest["budget"],
        "manifest_revision": manifest["revision"],
        "manifest_sha256": hashlib.sha256(manifest_text.encode()).hexdigest(),
        "files": files,
        "aliases": {},
        "flat_provenance_sha256": provenance_digest,
    }
    for name, text in {
        "manifest.json": manifest_text,
        "release-index.json": json.dumps(index),
        "area_provenance.json": provenance_text,
        "regional.csv": table,
        f"{entry['artifact']}/receipt.json": receipt_text,
    }.items():
        write(tree, f"public/data/{name}", text)
    source = (
        f"import {{ checkReleaseIndex }} from {json.dumps(SCRIPT.as_uri())};\n"
        f"console.log(JSON.stringify(checkReleaseIndex({json.dumps(str(tree))})));\n"
    )
    result = subprocess.run(
        [node, "--input-type=module", "-e", source],
        capture_output=True,
        text=True,
        check=True,
    )
    problems = json.loads(result.stdout)
    assert problems == (
        []
        if area_id == "alpha"
        else [
            "release index: regional.csv: Area CSV reform has no verified provenance"
        ]
    )


@needs_node
@pytest.mark.parametrize("in_tables", [True, False])
def test_the_build_check_refuses_a_receipt_with_thin_cells(tree, in_tables):
    """#208 review, finding 4: as CI does, whatever the review says."""
    name = "public/data/artifacts/m/0123456789abcdef/receipt.json"
    floor = {"thin_cells_in_tables": in_tables, "thin_cells": []}
    write(tree, name, json.dumps({"dashboard": {"disclosure_floor": floor}}))
    review(tree, [(name, "national_table", "")])
    expected = (
        [f"{name}: its tables hold cells under the floor of survey households"]
        if in_tables
        else []
    )
    assert run(tree) == expected


@needs_node
@pytest.mark.parametrize("suffix", ["csv", "json"])
@pytest.mark.parametrize("published", [True, False])
def test_the_build_check_checks_withheld_cells_even_after_review(
    tree, suffix, published
):
    base = "public/data/artifacts/m/0123456789abcdef"
    floor = {
        "thin_cells_in_tables": False,
        "withheld_cells": [
            {"table": "distributional_impact", "year": 2027, "groups": ["1"]},
            {"table": "winners_losers", "year": 2027, "groups": ["1", "all"]},
        ],
    }
    names = [f"{base}/receipt.json"]
    write(
        tree, names[0], json.dumps({"dashboard": {"disclosure_floor": floor}})
    )
    for table, column, labels in (
        ("distributional_impact", "value", ["1st"]),
        ("winners_losers", "avg_change", ["1", "all"]),
    ):
        rows = [
            dict(
                reform_id="m",
                reform_name="M",
                year=2027,
                decile=label,
                **{
                    column: (
                        0.0
                        if published and table == "distributional_impact"
                        else None
                    )
                },
            )
            for label in labels
        ]
        name = f"{base}/{table}.{suffix}"
        if suffix == "json":
            text = json.dumps(rows)
        else:
            from uk_budget_data.publication.tables import canonical_csv

            text = canonical_csv(table, rows).decode()
        write(tree, name, text)
        names.append(name)
    review(tree, [(name, "national_table", "") for name in names])
    assert run(tree) == (
        [
            f"{base}/receipt.json: distributional_impact 2027 1 publishes a value in a withheld cell"
        ]
        if published
        else []
    )
