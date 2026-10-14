"""Tests for scripts/check_public_data.py, on synthetic files only."""

import csv
import importlib.util
import subprocess
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "check_public_data.py"

spec = importlib.util.spec_from_file_location("check_public_data", SCRIPT)
check_public_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_public_data)

from policyengine.disclosure import (  # noqa: E402
    AreaWeights,
    Release,
    estimate_change,
)

REVIEW_HEADER = ["path", "kind", "header", "reviewer", "reviewed_on", "basis"]
SEAT_CODES = [f"E14{n:06d}" for n in range(1, 41)]


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def write_review(root: Path, rows: list[list[str]]) -> None:
    path = root / check_public_data.REVIEW_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(REVIEW_HEADER)
        writer.writerows(rows)


def track(root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)


def disclosure_table(path: Path) -> None:
    """A public table from the layer, built on synthetic records."""
    rng = np.random.default_rng(0)
    regions = np.repeat(["E12000001", "E12000002"], 600)
    baseline = rng.lognormal(10.4, 0.5, len(regions))
    reformed = baseline + rng.uniform(100.0, 900.0, len(regions))
    release = Release()
    release.add(
        estimate_change(
            level="region",
            reform="synthetic",
            year=2026,
            areas=AreaWeights.from_labels(
                regions, rng.uniform(150.0, 450.0, len(regions))
            ),
            source_ids=np.arange(len(regions)),
            baseline=baseline,
            reformed=reformed,
        )
    )
    release.check()
    path.parent.mkdir(parents=True, exist_ok=True)
    release.to_public().to_csv(path)


def run(root: Path) -> "check_public_data.Report":
    return check_public_data.check(root)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    write_review(tmp_path, [])
    return tmp_path


def test_a_disclosure_table_passes(repo):
    disclosure_table(repo / "public/data/regional.csv")
    track(repo)
    report = run(repo)
    assert report.problems == []


def test_an_unreviewed_file_fails(repo):
    write(repo, "public/data/new.csv", "reform_id,year,value\nx,2026,1\n")
    track(repo)
    assert run(repo).problems == [
        "public/data/new.csv: not a disclosure table and not reviewed"
    ]


def test_a_reviewed_file_passes_while_its_header_holds(repo):
    write(repo, "public/data/national.csv", "reform_id,year,value\nx,2026,1\n")
    write_review(
        repo,
        [
            [
                "public/data/national.csv",
                "national_table",
                "reform_id,year,value",
                "reviewer",
                "2026-10-14",
                "UK totals.",
            ]
        ],
    )
    track(repo)
    assert run(repo).problems == []

    write(repo, "public/data/national.csv", "reform_id,year,area,value\n")
    assert run(repo).problems == [
        "public/data/national.csv: header differs from the reviewed one"
    ]


def test_layer_problems_name_the_file(repo):
    path = repo / "public/data/constituency.csv"
    disclosure_table(path)
    lines = path.read_text().splitlines()
    # A withheld row that still shows a value.
    fields = lines[1].split(",")
    fields[9] = "withheld"
    fields[10] = "disclosure_control"
    lines[1] = ",".join(fields)
    path.write_text("\n".join(lines) + "\n")
    track(repo)
    problems = run(repo).problems
    assert problems
    assert all(
        p.startswith("public/data/constituency.csv: ") for p in problems
    )


def test_record_level_columns_fail_even_when_reviewed(repo):
    header = "reform_id,year,household_id,household_weight,income_change"
    write(repo, "public/data/sample.csv", header + "\n")
    write_review(
        repo,
        [
            [
                "public/data/sample.csv",
                "national_table",
                header,
                "reviewer",
                "2026-10-14",
                "A sample.",
            ]
        ],
    )
    track(repo)
    assert run(repo).problems == [
        "public/data/sample.csv: record-level columns"
    ]


def test_many_area_codes_fail_anywhere_but_reference_inputs(repo):
    page = "".join(f"<path id='{code}'/>" for code in SEAT_CODES)
    write(repo, "public/briefing/map.html", page)
    write(repo, "scripts/report.txt", "\n".join(SEAT_CODES))
    write(repo, "data_inputs/lookup.csv", "code\n" + "\n".join(SEAT_CODES))
    write(repo, "tests/test_example.py", f"CODE = '{SEAT_CODES[0]}'\n")
    track(repo)
    assert run(repo).problems == [
        "public/briefing/map.html: carries more than 20 area codes",
        "scripts/report.txt: carries more than 20 area codes",
    ]


def test_reviewed_reference_geography_may_carry_area_codes(repo):
    boundaries = '{"features": [%s]}' % ",".join(
        f'{{"GSScode": "{code}"}}' for code in SEAT_CODES
    )
    write(repo, "public/data/boundaries.geojson", boundaries)
    write_review(
        repo,
        [
            [
                "public/data/boundaries.geojson",
                "reference_geography",
                "",
                "reviewer",
                "2026-10-14",
                "Boundaries.",
            ]
        ],
    )
    track(repo)
    assert run(repo).problems == []


def test_a_pending_file_is_reported_but_does_not_fail(repo):
    header = "reform_id,year,household_id,household_weight"
    write(repo, "public/data/scatter.csv", header + "\n")
    write_review(
        repo,
        [
            [
                "public/data/scatter.csv",
                "pending",
                "",
                "someone decides",
                "",
                "Awaiting a decision.",
            ]
        ],
    )
    track(repo)
    report = run(repo)
    assert report.problems == []
    assert report.pending == [
        "public/data/scatter.csv: pending (someone decides): "
        "Awaiting a decision."
    ]


def test_untracked_files_are_not_checked(repo):
    track(repo)
    write(repo, "public/data/scratch.csv", "household_id\n")
    assert run(repo).problems == []


def test_a_review_entry_for_a_missing_file_fails(repo):
    write_review(
        repo,
        [
            [
                "public/data/gone.csv",
                "national_table",
                "",
                "reviewer",
                "2026-10-14",
                "Removed.",
            ]
        ],
    )
    track(repo)
    assert run(repo).problems == [
        "public/data/gone.csv: reviewed, but not tracked"
    ]


@pytest.mark.parametrize(
    "row, message",
    [
        (
            ["public/data/a.csv", "other", "", "r", "2026-10-14", "b"],
            "unknown",
        ),
        (["public/data/a.csv", "national_table", "", "", "2026", "b"], "need"),
        (["public/data/a.csv", "national_table", "", "r", "", "b"], "date"),
    ],
)
def test_an_incomplete_review_entry_fails(repo, row, message):
    write(repo, "public/data/a.csv", "x\n1\n")
    write_review(repo, [row])
    track(repo)
    problems = run(repo).problems
    assert any(
        p.startswith(f"{check_public_data.REVIEW_FILE}: row 2")
        and message in p
        for p in problems
    )


def test_a_symbolic_link_fails(repo, tmp_path_factory):
    target = tmp_path_factory.mktemp("outside") / "private.csv"
    target.write_text("household_id\n")
    (repo / "public/data").mkdir(parents=True)
    (repo / "public/data/linked.csv").symlink_to(target)
    track(repo)
    assert run(repo).problems == ["public/data/linked.csv: symbolic link"]


def test_this_repository_passes():
    report = run(REPO)
    assert report.problems == []
