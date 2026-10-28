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


# --- Sign-off off -------------------------------------------------------------


def contract(root: Path, required: bool) -> None:
    """The page's contract in the tree, carrying the sign-off switch."""
    path = root / "src" / "utils" / "publication" / "contract.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"sign_off_required": required}))


def listing(root: Path, artifact: str, files=()) -> dict:
    """A manifest for this Budget listing one approved artifact, whose
    receipt binds ``files``: the page lists them, so the check reaches
    the rule under test. Returns the receipt's dashboard to fill in."""
    from uk_budget_data.publication import manifest as m

    manifest = {
        "schema": m.SCHEMA,
        "release": m.CURRENT_RELEASE,
        "budget": m.CURRENT_BUDGET,
        "measures": {"m": {"status": m.APPROVED, "artifact": artifact}},
    }
    write(root, "public/data/manifest.json", json.dumps(manifest))
    return {"files": {name: "0" * 64 for name in files}}


@needs_node
@pytest.mark.parametrize("required", [None, True, False])
def test_the_build_check_reads_the_switch_from_the_tree_contract(
    tree, required
):
    # A tree without the contract is checked with sign-off on.
    write(tree, "public/data/new.csv", "reform_id,value\nx,1\n")
    review(tree, [])
    if required is not None:
        contract(tree, required)
    assert run(tree) == (
        [] if required is False else ["public/data/new.csv: not reviewed"]
    )


@needs_node
def test_the_build_check_reads_this_repository_switch():
    from uk_budget_data import sign_off

    source = (
        f"import {{ signOffRequired }} from {json.dumps(SCRIPT.as_uri())};\n"
        f"console.log(JSON.stringify(signOffRequired({json.dumps(str(REPO))})));\n"
    )
    output = subprocess.run(
        [node, "--input-type=module", "-e", source],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert json.loads(output) is sign_off.REQUIRED


@needs_node
def test_with_sign_off_off_the_build_check_needs_no_review(tree):
    contract(tree, False)
    header = ",".join(PUBLIC_COLUMNS)
    write(tree, "public/data/regional.csv", header + "\n")
    write(tree, "public/data/shaped.csv", header + "\n")
    for name in ("new", "national", "old"):
        write(tree, f"public/data/{name}.csv", "reform_id,value\nx,1\n")
    routing = tree / check_public_data.AREA_ROUTING_FILE
    routing.write_bytes(min(check_public_data.AREA_ROUTING_CONTENTS))
    review(
        tree,
        [
            ("public/data/national.csv", "national_table", ""),
            ("public/data/old.csv", "pending", "2020-01-10"),
            ("public/data/shaped.csv", "national_table", ""),
            (check_public_data.AREA_ROUTING_FILE, "static_asset", ""),
        ],
    )
    write(tree, "public/data/national.csv", "reform_id,value\nx,2\n")
    assert run(tree) == []
    (tree / "data_inputs" / "public_data_review.csv").unlink()
    assert run(tree) == []


@needs_node
def test_with_sign_off_off_the_build_check_still_refuses_what_no_review_allows(
    tree,
):
    contract(tree, False)
    write(tree, "public/sample.json", '{"household_id": 1}')
    header = ",".join(PUBLIC_COLUMNS)
    write(tree, "public/data/extra.csv", header + ",survey_value\n")
    receipt = "public/data/artifacts/m/0123456789abcdef/receipt.json"
    floor = {"thin_cells_in_tables": True, "thin_cells": []}
    dashboard = listing(tree, "artifacts/m/0123456789abcdef")
    dashboard["disclosure_floor"] = floor
    write(tree, receipt, json.dumps({"dashboard": dashboard}))
    write(tree, check_public_data.AREA_ROUTING_FILE, '{"area_views": "x"}\n')
    write(tree, "public/data/area_provenance.json", '{"survey_value": 12}')
    assert run(tree) == [
        f"{check_public_data.AREA_ROUTING_FILE}: not an area routing status",
        "public/data/area_provenance.json: invalid publication provenance",
        f"{receipt}: its tables hold cells under the floor of survey "
        "households",
        "public/data/extra.csv: a disclosure table with columns the layer "
        "does not publish",
        "public/sample.json: record-level identifiers",
    ]


@needs_node
def test_with_sign_off_off_the_build_check_still_checks_withheld_cells(tree):
    from uk_budget_data.publication.tables import canonical_csv

    contract(tree, False)
    base = "public/data/artifacts/m/0123456789abcdef"
    floor = {
        "thin_cells_in_tables": False,
        "withheld_cells": [
            {"table": "distributional_impact", "year": 2027, "groups": ["1"]},
            {"table": "winners_losers", "year": 2027, "groups": ["1", "all"]},
        ],
    }
    dashboard = listing(
        tree,
        "artifacts/m/0123456789abcdef",
        ["distributional_impact.csv", "winners_losers.csv"],
    )
    dashboard["disclosure_floor"] = floor
    write(tree, f"{base}/receipt.json", json.dumps({"dashboard": dashboard}))
    for table, column, labels, value in (
        ("distributional_impact", "value", ["1st"], 0.0),
        ("winners_losers", "avg_change", ["1", "all"], None),
    ):
        rows = [
            {
                "reform_id": "m",
                "reform_name": "M",
                "year": 2027,
                "decile": label,
                column: value,
            }
            for label in labels
        ]
        write(tree, f"{base}/{table}.csv", canonical_csv(table, rows).decode())
    assert run(tree) == [
        f"{base}/receipt.json: distributional_impact 2027 1 publishes a value "
        "in a withheld cell"
    ]


def run_on(root: Path, day: str, sign_off: bool) -> list[str]:
    """The build's check on a given day, with the switch given."""
    source = (
        f"import {{ checkPublicFiles }} from {json.dumps(SCRIPT.as_uri())};\n"
        "console.log(JSON.stringify(checkPublicFiles("
        f"{json.dumps(str(root))}, new Date({json.dumps(day + 'T12:00:00Z')}), "
        f"{json.dumps(sign_off)})));\n"
    )
    output = subprocess.run(
        [node, "--input-type=module", "-e", source],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(output)


@needs_node
def test_the_build_check_knows_the_listed_statuses():
    from uk_budget_data.publication import manifest as m

    source = (
        f"import {{ LISTED_STATUSES }} from {json.dumps(SCRIPT.as_uri())};\n"
        "console.log(JSON.stringify(LISTED_STATUSES));\n"
    )
    output = subprocess.run(
        [node, "--input-type=module", "-e", source],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert json.loads(output) == list(m.LISTED)


@needs_node
def test_with_sign_off_off_the_build_check_publishes_only_listed_files(tree):
    """As scripts/check_public_data.py: every file of the staged entry
    (delta) and of a stray generation, and each reconciliation.json, which
    no receipt binds, is refused; publish review-rows writes no row for
    them."""
    contract(tree, False)
    fixture = REPO / "src" / "test" / "fixtures" / "publication"
    shutil.copytree(fixture, tree / "public" / "data")
    stray = tree / "public/data/artifacts/alpha/aaaaaaaaaaaaaaaa"
    shutil.copytree(stray.parent / "d68eb084c02699c1", stray)
    unlisted = sorted(
        path.relative_to(tree).as_posix()
        for path in (tree / "public/data/artifacts").rglob("*")
        if path.is_file()
        and (
            path.parts[-3] == "delta"
            or path.parts[-2] == stray.name
            or path.name == "reconciliation.json"
        )
    )
    assert sorted(run(tree)) == [
        f"{name}: no listed manifest entry names it" for name in unlisted
    ]


@needs_node
def test_with_sign_off_off_the_build_check_guards_area_codes(tree):
    """A file may carry more than 20 area codes only as reference
    geography whose exact bytes a review row names (a pending one until
    its expiry date), or as a disclosure-layer table the release index
    binds; this repository's constituency.csv is one."""
    contract(tree, False)
    seats = [f"E14{n:06d}" for n in range(1, 31)]
    rows = "\n".join(f"{code},1" for code in seats)
    write(tree, "public/data/seats.csv", f"code,value\n{rows}\n")
    shaped = ",".join(PUBLIC_COLUMNS)
    cells = "\n".join(
        ",".join(code if c == "area_code" else "x" for c in PUBLIC_COLUMNS)
        for code in seats
    )
    write(tree, "public/data/shaped.csv", f"{shaped}\n{cells}\n")
    features = ",".join(f'{{"GSScode": "{code}"}}' for code in seats)
    for name in ("boundaries", "held", "long"):
        write(
            tree,
            f"public/data/{name}.geojson",
            f'{{"features": [{features}]}}',
        )
    review(
        tree,
        [
            ("public/data/boundaries.geojson", "reference_geography", ""),
            ("public/data/held.geojson", "pending", "2026-10-26"),
            ("public/data/long.geojson", "pending", "2026-11-30"),
            ("public/data/seats.csv", "national_table", ""),
        ],
    )
    many = "carries more than 20 area codes"
    assert run_on(tree, "2026-10-26", False) == [
        f"public/data/long.geojson: {many}",
        f"public/data/seats.csv: {many}",
        f"public/data/shaped.csv: {many}",
    ]
    assert run_on(tree, "2026-10-27", False) == [
        f"public/data/held.geojson: {many}",
        f"public/data/long.geojson: {many}",
        f"public/data/seats.csv: {many}",
        f"public/data/shaped.csv: {many}",
    ]
    # Changed bytes are not the bytes reviewed.
    write(
        tree,
        "public/data/boundaries.geojson",
        f'{{"features": [{features}, {{"value": 1.5}}]}}',
    )
    assert f"public/data/boundaries.geojson: {many}" in run_on(
        tree, "2026-10-26", False
    )
