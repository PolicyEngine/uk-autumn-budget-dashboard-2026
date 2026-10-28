"""Tests for scripts/check_public_data.py, on synthetic files only."""

import csv
import hashlib
import importlib.util
import json
import subprocess
from datetime import date
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

TODAY = date(2026, 10, 15)
SEAT_CODES = [f"E14{n:06d}" for n in range(1, 41)]


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def sha(root: Path, name: str) -> str:
    return hashlib.sha256((root / name).read_bytes()).hexdigest()


def entry(
    root: Path,
    name: str,
    kind: str = "national_table",
    reviewed_on: str = "2026-10-14",
    expires_on: str = "",
) -> list[str]:
    return [
        name,
        kind,
        sha(root, name),
        "reviewer",
        reviewed_on,
        expires_on,
        "B.",
    ]


def write_review(root: Path, rows: list[list[str]]) -> None:
    path = root / check_public_data.REVIEW_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(check_public_data.REVIEW_COLUMNS)
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


def run(root: Path, today: date = TODAY) -> "check_public_data.Report":
    return check_public_data.check(root, today=today)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    write_review(tmp_path, [])
    return tmp_path


def test_a_reviewed_disclosure_table_passes(repo):
    name = "public/data/regional.csv"
    disclosure_table(repo / name)
    write_review(repo, [entry(repo, name, "disclosure_table")])
    track(repo)
    assert run(repo).problems == []


def test_an_unreviewed_disclosure_table_fails(repo):
    # Neither check can tell a resolved release from a file written any
    # other way, so a person signs off the bytes.
    disclosure_table(repo / "public/data/regional.csv")
    track(repo)
    assert run(repo).problems == [
        "public/data/regional.csv: a disclosure table, not reviewed"
    ]


def test_a_review_must_say_whether_a_file_is_a_disclosure_table(repo):
    disclosure_table(repo / "public/data/regional.csv")
    write(repo, "public/data/national.csv", "reform_id,value\nx,1\n")
    write_review(
        repo,
        [
            entry(repo, "public/data/regional.csv"),
            entry(repo, "public/data/national.csv", "disclosure_table"),
        ],
    )
    track(repo)
    assert run(repo).problems == [
        "public/data/national.csv: reviewed as disclosure_table, but it is "
        "not a disclosure table",
        "public/data/regional.csv: reviewed as national_table, but it is a "
        "disclosure table",
    ]


def test_a_disclosure_table_is_validated_even_when_reviewed(repo):
    name = "public/data/constituency.csv"
    path = repo / name
    disclosure_table(path)
    lines = path.read_text().splitlines()
    # A withheld row that still shows a value.
    fields = lines[1].split(",")
    fields[9] = "withheld"
    fields[10] = "disclosure_control"
    lines[1] = ",".join(fields)
    path.write_text("\n".join(lines) + "\n")
    write_review(repo, [entry(repo, name, "disclosure_table")])
    track(repo)
    problems = run(repo).problems
    assert problems
    assert all(p.startswith(f"{name}: ") for p in problems)


@pytest.mark.parametrize(
    "name", ["public/data/new.csv", "public/extra/notes.json", "public/a.txt"]
)
def test_an_unreviewed_public_file_fails(repo, name):
    write(repo, name, "reform_id,year,value\nx,2026,1\n")
    track(repo)
    assert run(repo).problems == [
        f"{name}: not a disclosure table and not reviewed"
    ]


def test_a_reviewed_file_fails_once_it_changes(repo):
    name = "public/data/national.csv"
    write(repo, name, "reform_id,year,value\nx,2026,1\n")
    write_review(repo, [entry(repo, name)])
    track(repo)
    assert run(repo).problems == []

    # The same header, one more row.
    write(repo, name, "reform_id,year,value\nx,2026,1\ny,2026,2\n")
    assert run(repo).problems == [f"{name}: changed since its review"]


@pytest.mark.parametrize(
    "name, text",
    [
        (
            "public/data/sample.csv",
            "reform_id,household_id,household_weight\n",
        ),
        ("public/data/sample.json", '{"rows": [{"person_weight": 1}]}'),
        ("public/notes.txt", "benunit_id is in the second column\n"),
    ],
)
def test_record_level_identifiers_always_fail(repo, name, text):
    write(repo, name, text)
    write_review(repo, [entry(repo, name)])
    track(repo)
    assert run(repo).problems == [f"{name}: record-level identifiers"]


@pytest.mark.parametrize("in_tables", [True, False])
def test_a_receipt_with_thin_cells_in_its_tables_always_fails(repo, in_tables):
    """#208 review, finding 4: an artifact written under
    UK_BUDGET_THIN_DECILES=warn says so in its receipt, and no review entry
    lets it be published."""
    name = "public/data/artifacts/m/0123456789abcdef/receipt.json"
    floor = {
        "survey_households": 10,
        "checked": True,
        "thin_cells": [
            {"table": "winners_losers", "year": 2027, "groups": ["1"]}
        ],
        "thin_cells_in_tables": in_tables,
    }
    write(repo, name, json.dumps({"dashboard": {"disclosure_floor": floor}}))
    write_review(repo, [entry(repo, name)])
    track(repo)
    expected = (
        [f"{name}: its tables hold cells under the floor of survey households"]
        if in_tables
        else []
    )
    assert run(repo).problems == expected


@pytest.mark.parametrize("suffix", ["csv", "json"])
@pytest.mark.parametrize("published", [True, False])
def test_a_review_cannot_publish_a_receipted_withheld_cell(
    repo, suffix, published
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
        repo, names[0], json.dumps({"dashboard": {"disclosure_floor": floor}})
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
        write(repo, name, text)
        names.append(name)
    write_review(repo, [entry(repo, name) for name in names])
    track(repo)
    problems = run(repo).problems
    assert problems == (
        [
            f"{base}/receipt.json: distributional_impact 2027 1 publishes a value in a withheld cell"
        ]
        if published
        else []
    )


def test_record_level_identifiers_fail_in_a_pending_file(repo):
    name = "public/data/scatter.csv"
    write(repo, name, "reform_id,household_id\nx,1\n")
    write_review(repo, [entry(repo, name, "pending", expires_on="2026-10-20")])
    track(repo)
    report = run(repo)
    assert report.problems == [f"{name}: record-level identifiers"]


def test_a_pending_file_passes_until_its_expiry(repo):
    name = "public/data/old_seats.csv"
    write(repo, name, "code,value\n" + "\n".join(SEAT_CODES) + "\n")
    write_review(repo, [entry(repo, name, "pending", expires_on="2026-10-26")])
    track(repo)
    report = run(repo, today=date(2026, 10, 26))
    assert report.problems == []
    assert report.pending == [
        f"{name}: pending until 2026-10-26 (reviewer): B."
    ]

    report = run(repo, today=date(2026, 10, 27))
    assert report.problems == [
        f"{name}: pending past its expiry date (2026-10-26)",
        f"{name}: carries more than 20 area codes",
    ]


@pytest.mark.parametrize(
    "reviewed_on, expires_on",
    [
        ("2026-10-14", ""),
        ("2026-10-14", "2026-10-29"),
        ("2026-10-14", "2026-10-13"),
    ],
)
def test_a_pending_entry_needs_a_near_expiry_date(
    repo, reviewed_on, expires_on
):
    name = "public/data/old.csv"
    write(repo, name, "x\n1\n")
    write_review(repo, [entry(repo, name, "pending", reviewed_on, expires_on)])
    track(repo)
    problems = run(repo).problems
    assert problems[0].startswith(
        f"{check_public_data.REVIEW_FILE}: row 2: a pending entry needs"
    )


def test_many_area_codes_fail_anywhere_but_where_allowed(repo):
    page = "".join(f"<path id='{code}'/>" for code in SEAT_CODES)
    write(repo, "public/briefing/map.html", page)
    write(repo, "scripts/report.txt", "\n".join(SEAT_CODES))
    write(repo, "data_inputs/lookup.csv", "code\n" + "\n".join(SEAT_CODES))
    write(repo, "tests/test_example.py", f"CODE = '{SEAT_CODES[0]}'\n")
    write_review(repo, [entry(repo, "public/briefing/map.html")])
    track(repo)
    assert run(repo).problems == [
        "public/briefing/map.html: carries more than 20 area codes",
        "scripts/report.txt: carries more than 20 area codes",
    ]


def test_reviewed_reference_geography_may_carry_area_codes(repo):
    name = "public/data/boundaries.geojson"
    boundaries = '{"features": [%s]}' % ",".join(
        f'{{"GSScode": "{code}"}}' for code in SEAT_CODES
    )
    write(repo, name, boundaries)
    write_review(repo, [entry(repo, name, "reference_geography")])
    track(repo)
    assert run(repo).problems == []


@pytest.mark.parametrize(
    "change, message",
    [
        (lambda row: row.__setitem__(1, "other"), "unknown kind"),
        (lambda row: row.__setitem__(0, "data_inputs/a.csv"), "only files"),
        (lambda row: row.__setitem__(2, "abc"), "sha256"),
        (lambda row: row.__setitem__(3, ""), "a reviewer and a basis"),
        (lambda row: row.__setitem__(4, "soon"), "review date"),
        (lambda row: row.__setitem__(5, "2026-10-20"), "only a pending"),
    ],
)
def test_an_invalid_review_entry_fails(repo, change, message):
    name = "public/data/a.csv"
    write(repo, name, "x\n1\n")
    row = entry(repo, name)
    change(row)
    write_review(repo, [row])
    track(repo)
    problems = run(repo).problems
    assert any(
        p.startswith(f"{check_public_data.REVIEW_FILE}: row 2")
        and message in p
        for p in problems
    )


ROUTING = (
    '{\n  "area_views": "not_available",\n'
    '  "regional_release_kind": null\n}\n'
)


def test_the_area_routing_status_needs_no_review(repo):
    write(repo, check_public_data.AREA_ROUTING_FILE, ROUTING)
    track(repo)
    assert run(repo).problems == []


@pytest.mark.parametrize(
    "text",
    [
        ROUTING.replace("not_available", "unknown"),
        ROUTING.replace("not_available", "available"),
        ROUTING.replace("null", '"national"'),
        ROUTING.replace("}", '  "value": 1.5\n}'),
        ROUTING.replace("  ", "    "),
        ROUTING.rstrip("\n"),
        "{}\n",
    ],
)
def test_any_other_area_routing_text_fails(repo, text):
    # A review entry doesn't make another text acceptable.
    name = check_public_data.AREA_ROUTING_FILE
    write(repo, name, text)
    write_review(repo, [entry(repo, name, "static_asset")])
    track(repo)
    assert run(repo).problems == [
        f"{name}: not an area routing status",
        f"{name}: needs no review entry",
    ]


def test_a_review_entry_for_the_area_routing_status_fails(repo):
    # Nothing reads it, so it would only look like a review.
    name = check_public_data.AREA_ROUTING_FILE
    write(repo, name, ROUTING)
    write_review(repo, [entry(repo, name, "static_asset")])
    track(repo)
    assert run(repo).problems == [f"{name}: needs no review entry"]


def test_a_routing_text_anywhere_else_needs_a_review(repo):
    name = "public/data/blog_charts/area-routing.json"
    write(repo, name, ROUTING)
    track(repo)
    assert run(repo).problems == [
        f"{name}: not a disclosure table and not reviewed"
    ]


def test_a_review_entry_for_a_missing_file_fails(repo):
    name = "public/data/gone.csv"
    write(repo, name, "x\n")
    write_review(repo, [entry(repo, name)])
    (repo / name).unlink()
    track(repo)
    assert run(repo).problems == [f"{name}: reviewed, but not tracked"]


def test_untracked_files_are_not_checked(repo):
    track(repo)
    write(repo, "public/data/scratch.csv", "household_id\n")
    assert run(repo).problems == []


def test_a_symbolic_link_fails(repo, tmp_path_factory):
    target = tmp_path_factory.mktemp("outside") / "private.csv"
    target.write_text("x\n")
    (repo / "public/data").mkdir(parents=True)
    (repo / "public/data/linked.csv").symlink_to(target)
    track(repo)
    assert run(repo).problems == ["public/data/linked.csv: symbolic link"]


def test_this_repository_passes():
    assert run(REPO, today=date.today()).problems == []


# Budget week: the Budget is on 28 October and the briefing is due by 07:00
# on the 29th. A pending row that lapses inside this window stops every
# build, so the repository must pass on each day of it, not only today.
BUDGET_WEEK = [date(2026, 10, day) for day in range(23, 31)]


@pytest.mark.parametrize("day", BUDGET_WEEK, ids=lambda d: d.isoformat())
def test_this_repository_passes_through_budget_week(day):
    assert run(REPO, today=day).problems == []


def test_area_provenance_has_a_declared_review_kind(repo):
    import json

    from uk_budget_data.publication.release_index import PROVENANCE_KIND

    name = "public/data/area_provenance.json"
    law = {
        "kind": "current_law",
        "representation": None,
        "reform_sha256": None,
        "binding": "content",
    }
    document = {
        "schema": "uk-budget-area-provenance/v1",
        "manifest_revision": 1,
        "manifest_sha256": "a" * 64,
        "files": {"regional.csv": "b" * 64},
        "reforms": {
            "alpha": {
                "key": "alpha",
                "artifact": "artifacts/alpha/approved",
                "artifact_sha256": "c" * 64,
                "receipt_sha256": "d" * 64,
                "outputs_sha256": "e" * 64,
                "execution_identity_sha256": "f" * 64,
                "baseline": law,
                "reform": law,
            }
        },
    }
    write(repo, name, json.dumps(document))
    track(repo)
    assert any("not reviewed" in problem for problem in run(repo).problems)
    write_review(repo, [entry(repo, name, PROVENANCE_KIND)])
    track(repo)
    assert run(repo).problems == []
    # A review cannot authorise figures or extra values in provenance.
    document["survey_value"] = 12
    write(repo, name, json.dumps(document))
    write_review(repo, [entry(repo, name, PROVENANCE_KIND)])
    track(repo)
    assert any(
        "unexpected fields" in problem for problem in run(repo).problems
    )


def test_a_receipt_with_withheld_summary_figures_passes(repo):
    """A summary figure the floor withheld is an empty cell its receipt
    names (disclosure_floor.thin_metrics): the intended outcome, so the
    check refuses neither the receipt nor the table."""
    directory = "public/data/artifacts/m/0123456789abcdef"
    floor = {
        "survey_households": 3,
        "checked": True,
        "thin_cells": [
            {"table": "metrics", "year": 2027, "groups": ["people_affected"]}
        ],
        "thin_cells_in_tables": False,
    }
    receipt = write(
        repo,
        f"{directory}/receipt.json",
        json.dumps({"dashboard": {"disclosure_floor": floor}}),
    )
    metrics = write(
        repo,
        f"{directory}/metrics.csv",
        "reform_id,reform_name,year,people_affected,gini_change,"
        "poverty_change_pp,poverty_change_pct\nm,M,2027,,0.1,0.2,0.3\n",
    )
    names = [str(p.relative_to(repo)) for p in (receipt, metrics)]
    write_review(repo, [entry(repo, name) for name in names])
    track(repo)
    assert run(repo).problems == []
