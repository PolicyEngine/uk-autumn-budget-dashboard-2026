"""Tests for scripts/check-public-files.mjs, the check the build runs."""

import csv
import hashlib
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
    review(
        tree,
        [
            ("public/data/national.csv", "national_table", ""),
            ("public/data/old.csv", "pending", "2020-01-10"),
            ("public/data/fake.csv", "disclosure_table", ""),
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
        "public/sample.json: record-level identifiers",
        "public/sample.json: not reviewed",
    ]


@needs_node
def test_this_repository_passes_the_build_check():
    result = subprocess.run(
        [node, str(SCRIPT), str(REPO)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout.splitlines()[:-1]
