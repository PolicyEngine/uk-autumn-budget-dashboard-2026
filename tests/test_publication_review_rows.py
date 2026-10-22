"""Tests for ``publish review-rows``: review rows for the gated publication.

The artifacts and manifest are real, built by World and the publish
commands. Each property runs on a copy, with entry statuses, names and the
review list's other rows drawn by Hypothesis: the helper reads only digests
and statuses, so any status can be set on a real artifact.
"""

import csv
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

import hypothesis.strategies as st
import pytest
from hypothesis import HealthCheck, assume, given, settings

from tests.publication_support import World
from uk_budget_data.cli import main
from uk_budget_data.data_limits import DATA_LIMITS, record
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import review_rows as rr
from uk_budget_data.publication.artifacts import (
    RECONCILIATION_FILE,
    read_receipt,
)
from uk_budget_data.publication.publish import approve, stage

REPO = Path(__file__).resolve().parents[1]
BUILD_CHECK = REPO / "scripts" / "check-public-files.mjs"
COLUMNS_FILE = REPO / "scripts" / "disclosure_public_columns.json"
_spec = importlib.util.spec_from_file_location(
    "check_public_data", REPO / "scripts" / "check_public_data.py"
)
check_public_data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_public_data)

node = shutil.which("node")
needs_node = pytest.mark.skipif(
    node is None, reason="node is not installed (CI has it)"
)

HEADER = ",".join(rr.REVIEW_COLUMNS) + "\n"
DATA = "public/data"
ARTIFACTS = f"{DATA}/artifacts/"
MANIFEST = f"{DATA}/manifest.json"
FIGURE_KEYS = ("alpha", "beta", "gamma", "delta", "combined--alpha+beta")
LIMITED_KEY = "epsilon"
FIGURE_STATUSES = (m.STAGED, m.PROVISIONAL, m.APPROVED, m.STALE, m.WITHDRAWN)
LIMITED_STATUSES = (m.NOT_COMPUTABLE, m.STALE, m.WITHDRAWN)
# The review kinds the disclosure rules call for (see review_rows).
KINDS = {
    "budgetary_impact.csv": "national_table",
    "distributional_impact.csv": "national_table",
    "winners_losers.csv": "national_table",
    "metrics.csv": "national_table",
    "household_scatter_binned.csv": "national_table",
    "income_curve.csv": "synthetic_household",
    "receipt.json": "static_asset",
    "manifest.json": "static_asset",
}
PROPERTY = settings(
    max_examples=30,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    """A data root from World with an entry at each status, real receipts.

    alpha, beta and their combined run approved, gamma provisional, delta
    staged and epsilon not computable. The reconciliation records are left
    out, as the Reconciler moves them out of public/.
    """
    world = World()
    try:
        manifest = m.Manifest()
        args = dict(data_root=world.data_root, inputs=world.inputs)
        refs = {}
        for index, key in enumerate(("alpha", "beta", "delta")):
            refs[key] = world.ready(
                key, {2027: -1.0 - index, 2028: -2.0}, rate=0.2 + 0.01 * index
            )
            stage(manifest, refs[key].path, **args)
        for key in ("alpha", "beta"):
            approve(manifest, key, "Reviewer", **args)
        world.expect("gamma", "positive", 2027)
        refs["gamma"] = world.write("gamma", {2027: 0.5, 2028: 0.6}, rate=0.25)
        world.reconcile(refs["gamma"])
        stage(manifest, refs["gamma"].path, provisional=True, **args)
        surcharge = record(
            DATA_LIMITS[0],
            [
                "gov.hmrc.stamp_duty.residential.purchase.additional"
                ".rate[1].rate"
            ],
        )
        refs[LIMITED_KEY] = world.write(
            LIMITED_KEY,
            {2027: 0.0, 2028: 0.0},
            rate=0.26,
            data_limits=[surcharge],
        )
        stage(manifest, refs[LIMITED_KEY].path, **args)
        members = []
        for member in ("alpha", "beta"):
            receipt = read_receipt(refs[member].path)["execution_receipt"]
            members.append(
                {
                    "id": member,
                    "reform": receipt["reform"],
                    "baseline": receipt["baseline"],
                }
            )
        combined = world.write(
            "combined--alpha+beta",
            {2027: -3.0, 2028: -4.0},
            members=members,
            measure_ids=["alpha", "beta"],
            rate=0.3,
            member_outputs={
                member: manifest.measures[member].outputs_sha256
                for member in ("alpha", "beta")
            },
        )
        stage(manifest, combined.path, **args)
        approve(manifest, "combined--alpha+beta", "Reviewer", **args)
        m.save_manifest(manifest, world.data_root)
        assert {k: e.status for k, e in manifest.entries().items()} == {
            "alpha": m.APPROVED,
            "beta": m.APPROVED,
            "gamma": m.PROVISIONAL,
            "delta": m.STAGED,
            LIMITED_KEY: m.NOT_COMPUTABLE,
            "combined--alpha+beta": m.APPROVED,
        }
        target = tmp_path_factory.mktemp("published") / "data"
        shutil.copytree(world.data_root, target)
    finally:
        world.close()
    for path in target.rglob(RECONCILIATION_FILE):
        path.unlink()
    before = snapshot(target)
    yield target
    # Examples hard-link these files: none may have been written through.
    assert snapshot(target) == before


def snapshot(directory: Path) -> dict[str, str]:
    return {
        path.relative_to(directory)
        .as_posix(): hashlib.sha256(path.read_bytes())
        .hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


# --- building a repository layout -----------------------------------------


def entry_files(data_root: Path, entry: m.Entry) -> dict[str, Path]:
    """An entry's files by repository path, from its receipt on disk."""
    directory = data_root / entry.artifact
    receipt = json.loads((directory / "receipt.json").read_bytes())
    names = ["receipt.json", *receipt["dashboard"]["files"]]
    return {
        f"{DATA}/{entry.artifact}/{name}": directory / name for name in names
    }


def set_status(entry: m.Entry, status: str, approver: str) -> None:
    entry.status = status
    entry.approval = (
        m.Approval(
            by=approver,
            at="2026-10-23T12:00:00+00:00",
            outputs_sha256=entry.outputs_sha256,
            artifact_sha256=entry.artifact_sha256,
        )
        if status == m.APPROVED
        else None
    )
    if status in (m.STALE, m.WITHDRAWN):
        entry.reason = "test"
    elif status != m.NOT_COMPUTABLE:
        entry.reason = None


def link_or_copy(source, target) -> None:
    """Hard-link a base file into a test repository (copying across
    volumes), so each example costs no data copy. A test that changes a file
    replaces it (``replace``), never writing through the link."""
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def replace(path: Path, data: bytes) -> None:
    path.unlink()
    path.write_bytes(data)


def make_repo(
    root: Path,
    base: Path,
    statuses: dict[str, str] = None,
    approvers: dict[str, str] = None,
    review: str = HEADER,
) -> m.Manifest:
    """A repository layout holding a copy of ``base`` and a review list."""
    data_root = root / DATA
    shutil.copytree(base, data_root, copy_function=link_or_copy)
    manifest = m.parse_manifest((data_root / "manifest.json").read_bytes())
    entries = manifest.entries()
    for key, status in (statuses or {}).items():
        set_status(entries[key], status, (approvers or {}).get(key, "María"))
    m.save_manifest(manifest, data_root)
    (root / "data_inputs").mkdir()
    (root / "data_inputs" / "public_data_review.csv").write_bytes(
        review.encode()
    )
    (root / "scripts").mkdir()
    shutil.copy(COLUMNS_FILE, root / "scripts" / COLUMNS_FILE.name)
    return manifest


@contextmanager
def repository(base: Path, **kwargs):
    with tempfile.TemporaryDirectory(prefix="review-rows-") as directory:
        root = Path(directory)
        manifest = make_repo(root, base, **kwargs)
        yield root, manifest


def run(root: Path, **kwargs) -> rr.Report:
    kwargs.setdefault("reviewer", "María")
    kwargs.setdefault("staged_by", "Vahid")
    return rr.review_rows(
        data_root=root / DATA,
        review_csv=root / "data_inputs" / "public_data_review.csv",
        **kwargs,
    )


def review_bytes(root: Path) -> bytes:
    return (root / "data_inputs" / "public_data_review.csv").read_bytes()


def split_records(text: str) -> list[tuple[str, list[str]]]:
    """Each record's exact text and fields, header first."""
    lines = io.StringIO(text, newline="").readlines()
    reader = csv.reader(iter(lines))
    records, consumed = [], 0
    for values in reader:
        records.append(("".join(lines[consumed : reader.line_num]), values))
        consumed = reader.line_num
    return records


def one_line(name: str) -> str:
    return " ".join(name.split())


def expected_rows(
    root: Path, manifest: m.Manifest, staged_by: str
) -> dict[str, tuple[str, str, str]]:
    """The rows the brief calls for: path -> (kind, sha256, basis)."""
    data_root = root / DATA
    raw = (data_root / "manifest.json").read_bytes()
    revision = m.parse_manifest(raw).revision
    rows = {
        MANIFEST: (
            KINDS["manifest.json"],
            hashlib.sha256(raw).hexdigest(),
            f"Gated publication: manifest revision {revision}, the index "
            "the page reads",
        )
    }
    for entry in manifest.entries().values():
        if entry.status == m.APPROVED:
            phrase = f"approved by {one_line(entry.approval.by)}"
        elif entry.status == m.PROVISIONAL:
            phrase = f"provisional, staged by {one_line(staged_by)}"
        else:
            continue
        for path, file in entry_files(data_root, entry).items():
            bound = (
                "receipt bound by the entry's artifact digest"
                if file.name == "receipt.json"
                else "bytes bound by the receipt"
            )
            rows[path] = (
                KINDS[file.name],
                hashlib.sha256(file.read_bytes()).hexdigest(),
                f"Gated publication: {phrase} (manifest revision "
                f"{revision}); {bound}",
            )
    return rows


# --- strategies -----------------------------------------------------------

KINDS_TABLES = [name for name in KINDS if name.endswith(".csv")]


def entry_files_paths(entry: m.Entry) -> list[str]:
    names = ["receipt.json", *KINDS_TABLES]
    return [f"{DATA}/{entry.artifact}/{name}" for name in names]


# Names with commas, quotes, line breaks and non-ASCII letters, but no
# underscore, so a name never spells a record-level identifier.
NAMES = st.text(
    alphabet=st.characters(
        blacklist_categories=("Cs", "Cc"),
        blacklist_characters="_",
    )
    | st.sampled_from([",", '"', "\n", " ", "é", "í"]),
    min_size=1,
    max_size=12,
).filter(lambda name: name.strip())
CELL = st.text(
    alphabet=st.characters(
        blacklist_categories=("Cs",), blacklist_characters="\x00\r"
    ),
    max_size=16,
)
STYLES = st.sampled_from(
    [
        (csv.QUOTE_MINIMAL, "\n"),
        (csv.QUOTE_ALL, "\n"),
        (csv.QUOTE_MINIMAL, "\r\n"),
    ]
)
DATES = st.dates(date(2026, 1, 1), date(2027, 12, 31)).map(date.isoformat)


@st.composite
def scenarios(draw, base_entries):
    """Statuses, names, and a review list holding other rows to keep."""
    statuses = {
        key: draw(st.sampled_from(FIGURE_STATUSES)) for key in FIGURE_KEYS
    }
    statuses[LIMITED_KEY] = draw(st.sampled_from(LIMITED_STATUSES))
    approvers = {key: draw(NAMES) for key in FIGURE_KEYS}
    all_files = sorted(
        path
        for entry in base_entries.values()
        for path in entry_files_paths(entry)
    )
    paths = draw(
        st.lists(
            st.sampled_from([*all_files, MANIFEST]), unique=True, max_size=8
        )
    )
    paths += [
        f"public/{folder}/other-{i}.{suffix}"
        for i, (folder, suffix) in enumerate(
            draw(
                st.lists(
                    st.tuples(
                        st.sampled_from(["assets", "data", "data/blog"]),
                        st.sampled_from(["csv", "json", "png"]),
                    ),
                    max_size=4,
                )
            )
        )
    ]
    # Rows under artifacts/ for files that are no longer on disk.
    paths += [
        f"{ARTIFACTS}gone/{i:016x}/budgetary_impact.csv"
        for i in range(draw(st.integers(0, 3)))
    ]
    if draw(st.booleans()):
        paths = sorted(paths)
    else:
        paths = draw(st.permutations(paths))
    lines = []
    for path in paths:
        quoting, terminator = draw(STYLES)
        buffer = io.StringIO()
        csv.writer(
            buffer, quoting=quoting, lineterminator=terminator
        ).writerow(
            [
                path,
                draw(st.sampled_from(check_public_data.KINDS)),
                draw(st.text("0123456789abcdef", min_size=64, max_size=64)),
                draw(CELL),
                draw(DATES),
                draw(st.sampled_from(["", "2026-11-01"])),
                draw(CELL),
            ]
        )
        lines.append(buffer.getvalue())
    review = HEADER + "".join(lines)
    return dict(
        statuses=statuses,
        approvers=approvers,
        review=review,
        staged_by=draw(NAMES),
        reviewer=draw(NAMES),
        on=draw(DATES),
    )


def base_entries(base: Path) -> dict[str, m.Entry]:
    return m.parse_manifest((base / "manifest.json").read_bytes()).entries()


def apply(base: Path, scenario: dict):
    return repository(
        base,
        statuses=scenario["statuses"],
        approvers=scenario["approvers"],
        review=scenario["review"],
    )


def drawn(base: Path):
    return scenarios(base_entries(base))


# --- properties -----------------------------------------------------------


def test_every_artifact_lists_the_six_published_tables(base):
    for entry in base_entries(base).values():
        listed = json.loads(
            (base / entry.artifact / "receipt.json").read_bytes()
        )["dashboard"]["files"]
        assert sorted(listed) == sorted(KINDS_TABLES)
        assert sorted(os.listdir(base / entry.artifact)) == sorted(
            [*KINDS_TABLES, "receipt.json"]
        )


@PROPERTY
@given(data=st.data())
def test_rows_are_exactly_the_displayed_files_and_the_manifest(base, data):
    scenario = data.draw(drawn(base))
    with apply(base, scenario) as (root, manifest):
        before = split_records(scenario["review"])
        run(
            root,
            reviewer=scenario["reviewer"],
            staged_by=scenario["staged_by"],
            on=scenario["on"],
        )
        after = split_records(review_bytes(root).decode())
        expected = expected_rows(root, manifest, scenario["staged_by"])

        assert after[0] == before[0]
        before_paths = [values[0] for _, values in before[1:]]
        after_paths = [values[0] for _, values in after[1:]]
        assert len(after_paths) == len(set(after_paths))
        removed = {
            path
            for path in before_paths
            if path.startswith(ARTIFACTS)
            and not (root / path).exists()
            and path not in expected
        }
        assert set(after_paths) == (set(before_paths) - removed) | set(
            expected
        )
        for _, values in after[1:]:
            if values[0] in expected:
                kind, sha256, basis = expected[values[0]]
                assert values == [
                    values[0],
                    kind,
                    sha256,
                    one_line(scenario["reviewer"]),
                    scenario["on"],
                    "",
                    basis,
                ]
        # Untouched rows survive byte for byte, in their order.
        kept_before = [
            raw
            for raw, values in before[1:]
            if values[0] not in expected and values[0] not in removed
        ]
        kept_after = [
            raw for raw, values in after[1:] if values[0] not in expected
        ]
        assert kept_after == kept_before
        # Replaced rows stay where they were among the kept ones.
        order = [p for p in before_paths if p not in removed]
        assert [p for p in after_paths if p in set(order)] == order
        if order == sorted(order):
            assert after_paths == sorted(after_paths)


@PROPERTY
@given(data=st.data())
def test_no_row_is_written_for_an_entry_the_page_does_not_display(base, data):
    scenario = data.draw(drawn(base))
    with apply(base, scenario) as (root, manifest):
        before = {
            values[0]: raw
            for raw, values in split_records(scenario["review"])[1:]
        }
        run(root, staged_by=scenario["staged_by"])
        after = {
            values[0]: raw
            for raw, values in split_records(review_bytes(root).decode())[1:]
        }
        for entry in manifest.entries().values():
            if entry.status in m.DISPLAYABLE:
                continue
            for path in entry_files(root / DATA, entry):
                assert after.get(path) == before.get(path)


@PROPERTY
@given(data=st.data())
def test_a_displayed_provisional_entry_needs_its_stager(base, data):
    scenario = data.draw(drawn(base))
    provisional = sorted(
        key
        for key, status in scenario["statuses"].items()
        if status == m.PROVISIONAL
    )
    assume(provisional)
    stager = data.draw(st.sampled_from([None, "", "  \n "]))
    with apply(base, scenario) as (root, _):
        before = review_bytes(root)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root, staged_by=stager)
        assert refused.value.problems == [
            "provisional entries are displayed ("
            + ", ".join(provisional)
            + "); name who staged them with --staged-by (the manifest does "
            "not record it)"
        ]
        assert review_bytes(root) == before


@PROPERTY
@given(data=st.data())
def test_running_twice_gives_the_same_bytes(base, data):
    scenario = data.draw(drawn(base))
    with apply(base, scenario) as (root, _):
        first = run(root, staged_by=scenario["staged_by"], on=scenario["on"])
        once = review_bytes(root)
        second = run(root, staged_by=scenario["staged_by"], on=scenario["on"])
        assert review_bytes(root) == once
        assert second.added == [] and second.removed == []
        assert second.unchanged == len(second.replaced)
        assert sorted(second.replaced) == sorted(first.added + first.replaced)


def volatile_spans(text: str) -> list[range]:
    """Bytes of the receipt fields the artifact digest leaves out."""
    spans = []
    for pattern in (
        r'"generated_at": "([^"]*)"',
        r'"generator_argv": (\[[^\]]*\])',
    ):
        match = re.search(pattern, text)
        spans.append(range(match.start(1), match.end(1)))
    return spans


@PROPERTY
@given(data=st.data())
def test_a_tampered_file_refuses_and_writes_nothing(base, data):
    scenario = data.draw(drawn(base))
    key = data.draw(st.sampled_from(FIGURE_KEYS))
    scenario["statuses"][key] = data.draw(st.sampled_from(m.DISPLAYABLE))
    with apply(base, scenario) as (root, manifest):
        files = entry_files(root / DATA, manifest.entries()[key])
        path = data.draw(st.sampled_from(sorted(files)))
        content = bytearray(files[path].read_bytes())
        skip = (
            volatile_spans(content.decode())
            if path.endswith("receipt.json")
            else []
        )
        offset = data.draw(
            st.integers(0, len(content) - 1).filter(
                lambda i: not any(i in span for span in skip)
            )
        )
        content[offset] = data.draw(
            st.integers(0, 255).filter(lambda b: b != content[offset])
        )
        replace(files[path], bytes(content))
        before = review_bytes(root)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
        assert any(path in problem for problem in refused.value.problems)
        assert review_bytes(root) == before


# --- the guards against rows no kind can make pass -------------------------

FRAGMENTS = st.lists(
    st.sampled_from(
        [
            *check_public_data.PUBLIC_COLUMNS,
            "area_name",
            "reform_id",
            "household_id",
            "person_weight",
            "household_ids",
            "E14000001",
            "S12000033",
            "x",
            "\n",
            ",",
            '"',
            "\0",
        ]
    )
    | st.from_regex(r"E14\d{6}", fullmatch=True),
    max_size=60,
)


def rejected_by_the_checks(name: str, data: bytes) -> bool:
    """Whether CI's check rejects a row of a kind the helper writes."""
    if check_public_data.is_binary(data):
        return check_public_data.is_layer_table(name, data)
    return bool(
        check_public_data.RECORD_LEVEL.search(data)
        or check_public_data.is_layer_table(name, data)
        or len(set(check_public_data.AREA_CODE.findall(data)))
        > check_public_data.MAX_AREA_CODES
    )


@settings(max_examples=200, deadline=None)
@given(
    fragments=FRAGMENTS,
    name=st.sampled_from(["public/data/x.csv", "public/data/x.json"]),
)
def test_the_guards_agree_with_the_ci_check(fragments, name):
    data = ",".join(fragments).encode()
    assert bool(rr._no_kind_problems(name, data)) == rejected_by_the_checks(
        name, data
    )


def test_the_guards_use_the_ci_checks_rules():
    assert rr.RECORD_LEVEL.pattern == check_public_data.RECORD_LEVEL.pattern
    assert rr.AREA_CODE.pattern == check_public_data.AREA_CODE.pattern
    assert rr.MAX_AREA_CODES == check_public_data.MAX_AREA_CODES
    assert rr.REVIEW_COLUMNS == check_public_data.REVIEW_COLUMNS
    assert set(KINDS.values()) <= set(check_public_data.KINDS)


# --- examples -------------------------------------------------------------


def all_displayed(base: Path) -> dict[str, str]:
    return {key: m.APPROVED for key in FIGURE_KEYS} | {"gamma": m.PROVISIONAL}


def rows_by_path(root: Path) -> dict[str, list[str]]:
    return {
        values[0]: values
        for _, values in split_records(review_bytes(root).decode())[1:]
    }


def test_each_file_is_reviewed_as_its_kind(base):
    with repository(base, statuses=all_displayed(base)) as (root, _):
        run(root)
        rows = rows_by_path(root)
    kinds = {path.rsplit("/", 1)[1]: row[1] for path, row in rows.items()}
    assert kinds == KINDS
    assert len(rows) == 1 + 5 * 7


def test_a_receipt_unbound_file_in_a_displayed_artifact_refuses(base):
    with repository(base, statuses=all_displayed(base)) as (root, manifest):
        artifact = root / DATA / manifest.measures["alpha"].artifact
        (artifact / "reconciliation.json").write_text("{}\n")
        before = review_bytes(root)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
        assert refused.value.problems == [
            f"{DATA}/{manifest.measures['alpha'].artifact}/"
            "reconciliation.json: in a displayed artifact, but its receipt "
            "does not bind it; move it out of public/ (the gates never read "
            "it)"
        ]
        assert review_bytes(root) == before


def test_the_same_file_beside_an_entry_not_displayed_is_not_a_refusal(base):
    with repository(base) as (root, manifest):
        artifact = root / DATA / manifest.measures["delta"].artifact
        (artifact / "reconciliation.json").write_text("{}\n")
        report = run(root)
    assert (
        f"{DATA}/{manifest.measures['delta'].artifact}/reconciliation.json",
        "delta is staged",
    ) in report.unreviewed


def test_a_not_computable_entry_gets_no_rows_and_is_reported(base):
    with repository(base) as (root, manifest):
        report = run(root)
        rows = rows_by_path(root)
        epsilon = entry_files(root / DATA, manifest.measures[LIMITED_KEY])
    assert not set(epsilon) & set(rows)
    assert {
        (path, f"{LIMITED_KEY} is not_computable") for path in epsilon
    } <= set(report.unreviewed)


def test_an_approval_for_another_artifact_refuses(base):
    with repository(base) as (root, manifest):
        manifest.measures["alpha"].approval.artifact_sha256 = "0" * 64
        m.save_manifest(manifest, root / DATA)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        "alpha: its approval is not for this artifact"
    ]


def test_an_approval_naming_no_one_refuses(base):
    with repository(base) as (root, manifest):
        manifest.measures["alpha"].approval.by = " "
        m.save_manifest(manifest, root / DATA)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        "alpha: approved, but no approver is named"
    ]


def test_an_entry_naming_another_measures_artifact_refuses(base):
    with repository(base, statuses={"gamma": m.PROVISIONAL}) as (
        root,
        manifest,
    ):
        beta = manifest.measures["beta"]
        manifest.measures["gamma"] = manifest.measures["gamma"].model_copy(
            update={
                "artifact": beta.artifact,
                "artifact_sha256": beta.artifact_sha256,
                "outputs_sha256": beta.outputs_sha256,
            }
        )
        m.save_manifest(manifest, root / DATA)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{DATA}/{beta.artifact}/receipt.json: is not gamma's receipt"
    ]


def test_an_entry_naming_other_outputs_refuses(base):
    with repository(base) as (root, manifest):
        manifest.measures["gamma"].outputs_sha256 = "0" * 64
        m.save_manifest(manifest, root / DATA)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    artifact = manifest.measures["gamma"].artifact
    assert refused.value.problems == [
        f"{DATA}/{artifact}/receipt.json: does not list the files gamma's "
        "entry names"
    ]


def edit_receipt(root: Path, manifest: m.Manifest, key: str, change) -> str:
    path = root / DATA / manifest.entries()[key].artifact / "receipt.json"
    replace(path, change(path.read_bytes()))
    return f"{DATA}/{manifest.entries()[key].artifact}/receipt.json"


def test_a_receipt_with_another_value_refuses(base):
    with repository(base) as (root, manifest):
        where = edit_receipt(
            root,
            manifest,
            "alpha",
            lambda data: data.replace(
                b'"tree_clean": true', b'"tree_clean": false'
            ),
        )
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{where}: not the receipt alpha's entry names (its artifact digest "
        "differs)"
    ]


def test_a_receipt_written_in_another_form_refuses(base):
    def reformat(data: bytes) -> bytes:
        return json.dumps(json.loads(data), indent=1, sort_keys=True).encode()

    with repository(base) as (root, manifest):
        where = edit_receipt(root, manifest, "alpha", reformat)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{where}: not in the form publication writes"
    ]


def test_a_receipts_generation_time_is_not_bound_intended(base):
    """Intended: the gate binds a receipt without the fields describing its
    generation run (receipt.VOLATILE_DASHBOARD_FIELDS), so a changed time is
    not refused. The row then names the bytes on disk."""
    with repository(base) as (root, manifest):
        where = edit_receipt(
            root,
            manifest,
            "alpha",
            lambda data: re.sub(
                rb'"generated_at": "\d', b'"generated_at": "1', data
            ),
        )
        run(root)
        data = (root / where).read_bytes()
        assert rows_by_path(root)[where][2] == hashlib.sha256(data).hexdigest()


def test_a_missing_listed_file_refuses(base):
    with repository(base) as (root, manifest):
        artifact = manifest.measures["alpha"].artifact
        (root / DATA / artifact / "metrics.csv").unlink()
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{DATA}/{artifact}/metrics.csv: missing"
    ]


def test_a_missing_artifact_refuses(base):
    with repository(base) as (root, manifest):
        artifact = manifest.measures["alpha"].artifact
        shutil.rmtree(root / DATA / artifact)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{DATA}/{artifact}: alpha's artifact directory is missing"
    ]


def test_a_symbolic_link_refuses(base, tmp_path):
    with repository(base) as (root, manifest):
        file = (
            root / DATA / manifest.measures["alpha"].artifact / "metrics.csv"
        )
        copy = tmp_path / "metrics.csv"
        shutil.copy(file, copy)
        file.unlink()
        file.symlink_to(copy)
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{file.relative_to(root).as_posix()}: a symbolic link"
    ]


def test_record_level_identifiers_in_the_manifest_refuse(base):
    with repository(
        base,
        statuses={"alpha": m.APPROVED},
        approvers={"alpha": "household_id"},
    ) as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{MANIFEST}: carries record-level identifiers"
    ]


def test_the_guards_name_each_rule():
    layer = ",".join(check_public_data.PUBLIC_COLUMNS).encode() + b"\n"
    codes = b",".join(f"E14{n:06d}".encode() for n in range(21))
    assert rr._no_kind_problems("public/a.csv", layer) == [
        "public/a.csv: shaped as a disclosure-layer table, which is reviewed "
        "through the layer, not by this helper"
    ]
    assert rr._no_kind_problems("public/a.json", codes) == [
        "public/a.json: carries more than 20 area codes"
    ]
    # At most 20 codes is allowed, as in the CI check.
    assert rr._no_kind_problems("public/a.json", codes[:-10]) == []
    assert rr._no_kind_problems("public/a.json", b"person_weight") == [
        "public/a.json: carries record-level identifiers"
    ]
    assert rr._no_kind_problems("public/a.png", b"\0household_id") == []


def test_rows_already_listed_twice_refuse(base):
    row = f"{MANIFEST},static_asset,{'0' * 64},R,2026-10-14,,B\n"
    with repository(base, review=HEADER + row + row) as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [
        f"{root / 'data_inputs' / 'public_data_review.csv'}: {MANIFEST} is "
        "listed twice"
    ]


def test_a_review_list_with_other_columns_refuses(base):
    with repository(base, review="path,kind,sha256\n") as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert "columns must be" in refused.value.problems[0]


@pytest.mark.parametrize("path", ["public/aa.png", "public/zz.png"])
def test_a_last_row_without_a_line_end_keeps_its_bytes(base, path):
    row = f'{path},static_asset,{"0" * 64},R,2026-10-14,,"B, c"'
    with repository(base, review=HEADER + row) as (root, _):
        run(root)
        text = review_bytes(root).decode()
    records = split_records(text)
    assert [values[0] for _, values in records[1:]].count(path) == 1
    assert len(records) == 1 + 1 + 29
    if path == "public/zz.png":
        # Still last: its bytes are untouched, with no line end added.
        assert text.endswith("\n" + row)
    else:
        # Rows follow it, so a line end separates them.
        assert text.startswith(HEADER + row + "\n")


def test_a_data_root_outside_public_refuses(base, tmp_path):
    with repository(base) as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            rr.review_rows(
                reviewer="María",
                data_root=tmp_path,
                review_csv=root / "data_inputs" / "public_data_review.csv",
            )
    assert "is not under" in refused.value.problems[0]


def test_no_manifest_refuses(base):
    with repository(base) as (root, _):
        (root / MANIFEST).unlink()
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root)
    assert refused.value.problems == [f"{MANIFEST}: missing"]


@pytest.mark.parametrize(
    "on", ["23/10/2026", "20261023", "2026-W43-5", "2026-02-30", ""]
)
def test_a_review_date_must_be_a_date(base, on):
    with repository(base) as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root, on=on)
    assert refused.value.problems == [
        f"--on {on!r} is not a date (YYYY-MM-DD)"
    ]


def test_the_review_date_defaults_to_today_in_utc(base):
    with repository(base) as (root, _):
        run(root)
        rows = rows_by_path(root)
    today = datetime.now(timezone.utc).date().isoformat()
    assert {row[4] for row in rows.values()} == {today}


def test_a_reviewer_must_be_named(base):
    with repository(base) as (root, _):
        with pytest.raises(rr.ReviewRowsError) as refused:
            run(root, reviewer=" \n")
    assert refused.value.problems == ["--reviewer must name a person"]


def test_the_review_list_keeps_its_permissions(base):
    with repository(base) as (root, _):
        path = root / "data_inputs" / "public_data_review.csv"
        os.chmod(path, 0o644)
        run(root)
        assert path.stat().st_mode & 0o777 == 0o644


# --- the command line -----------------------------------------------------


def test_the_command_prints_paths_and_counts_never_values(base, capsys):
    with repository(base) as (root, _):
        csv_path = str(root / "data_inputs" / "public_data_review.csv")
        code = main(
            [
                "publish",
                "--data-root",
                str(root / DATA),
                "review-rows",
                "--reviewer",
                "María Juaristi",
                "--staged-by",
                "Vahid",
                "--on",
                "2026-10-23",
                "--review-csv",
                csv_path,
            ]
        )
        output = capsys.readouterr().out
        rows = rows_by_path(root)
    assert code == 0
    assert re.search(
        r"^review rows for manifest revision \d+: 29 added, 0 replaced "
        r"\(0 unchanged\), 0 removed, in \d+\.\d\d s$",
        output,
        re.MULTILINE,
    )
    assert f"added {MANIFEST}" in output.splitlines()
    assert not re.search(r"[0-9a-f]{64}", output)
    for value in ("María", "Vahid", "Gated publication", "2026-10-23"):
        assert value not in output
    assert {row[3] for row in rows.values()} == {"María Juaristi"}


def test_the_data_root_may_follow_the_action(base, capsys, monkeypatch):
    with repository(base) as (root, _):
        monkeypatch.chdir(root)
        code = main(
            [
                "publish",
                "review-rows",
                "--reviewer",
                "María",
                "--staged-by",
                "Vahid",
                "--data-root",
                DATA,
            ]
        )
        monkeypatch.undo()
        assert code == 0
        assert MANIFEST in rows_by_path(root)


def test_the_command_refuses_with_a_reason(base, capsys):
    with repository(base) as (root, _):
        code = main(
            [
                "publish",
                "--data-root",
                str(root / DATA),
                "review-rows",
                "--reviewer",
                "María",
                "--review-csv",
                str(root / "data_inputs" / "public_data_review.csv"),
            ]
        )
    output = capsys.readouterr().out
    assert code == 1
    assert output.splitlines() == [
        "REFUSED review rows (nothing written):",
        "  - provisional entries are displayed (gamma); name who staged "
        "them with --staged-by (the manifest does not record it)",
    ]


# --- both disclosure checks pass on the helper's rows -----------------------


def displayed_only(root: Path, manifest: m.Manifest) -> None:
    """Remove the artifacts of entries the page does not display."""
    for entry in manifest.entries().values():
        if entry.status not in m.DISPLAYABLE:
            shutil.rmtree(root / DATA / entry.artifact)


def build_check(root: Path) -> list[str]:
    result = subprocess.run(
        [node, str(BUILD_CHECK), str(root)], capture_output=True, text=True
    )
    return result.stdout.splitlines()[:-1]


LEGACY = (
    "public/white.png,static_asset,{sha},juaristi22,2026-10-15,,"
    "Image used by the page. No data.\n"
)


def with_legacy_file(root: Path) -> str:
    shutil.copy(REPO / "public" / "white.png", root / "public" / "white.png")
    sha = hashlib.sha256((root / "public" / "white.png").read_bytes())
    return LEGACY.format(sha=sha.hexdigest())


@needs_node
def test_the_build_check_passes_on_the_helpers_rows(base):
    with repository(base) as (root, manifest):
        displayed_only(root, manifest)
        legacy = with_legacy_file(root)
        csv_path = root / "data_inputs" / "public_data_review.csv"
        csv_path.write_text(HEADER + legacy)
        assert build_check(root)
        run(root)
        assert build_check(root) == []
        assert legacy in review_bytes(root).decode()


def test_the_ci_check_passes_on_the_helpers_rows(base):
    with repository(base) as (root, manifest):
        displayed_only(root, manifest)
        legacy = with_legacy_file(root)
        (root / "data_inputs" / "public_data_review.csv").write_text(
            HEADER + legacy
        )
        run(root, on="2026-10-23")
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "add", "-A"], cwd=root, check=True)
        report = check_public_data.check(root, today=date(2026, 10, 23))
    assert report.problems == []


@needs_node
def test_the_build_check_still_fails_on_undisplayed_artifacts(base):
    """The open question for the coordinator: a not-computable (or staged)
    entry's artifact gets no row under the ruling, yet `publish check`
    needs it on disk, so the build check fails on its files. The helper
    names each one."""
    with repository(base) as (root, _):
        report = run(root)
        problems = build_check(root)
    assert sorted(problems) == sorted(
        f"{path}: not reviewed" for path, _ in report.unreviewed
    )
    assert {why for _, why in report.unreviewed} == {
        "delta is staged",
        f"{LIMITED_KEY} is not_computable",
    }
