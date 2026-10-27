"""Releases as a dimension: this Budget and past fiscal events.

Invariants (docs/historical-releases.md):

- The data root decides the release. public/data serves this Budget; a root
  public/data/releases/<id> serves that registered historical release; any
  other root inside a releases/ directory is refused, never read as this
  Budget.
- A manifest authorises figures only for the release its root serves, and
  only when it names that release's id and date, in Python and in the
  build's Node check alike.
- No artifact path enters releases/, so no release reads another's files.
- Only a release's own manifest and artifacts are publication outputs for
  the dirty-tree check.
- This Budget's paths, file sets and messages are unchanged.
"""

import csv
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tests.data_limit_stand_ins import STAND_IN_DATA_LIMITS
from tests.publication_support import World
from uk_budget_data import releases
from uk_budget_data.data_limits import record
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.publish import approve, check, stage
from uk_budget_data.publication.receipt import is_publication_path
from uk_budget_data.publication.release_index import (
    FLAT_VIEW_FILES,
    HISTORICAL_FLAT_VIEW_FILES,
    HISTORICAL_OBR_COMPARISON_HEADER,
    INDEX_FILE,
    METADATA_HEADERS,
    _flat_problems,
    identity_problems,
    manifest_identity_problems,
    release_index_problems,
    view_files,
    write_release_index,
)

REPO = Path(__file__).resolve().parents[1]
# A data limit that makes a measure not computable: a lifted one, registered
# by the stand_in_data_limits fixture (tests/data_limit_stand_ins.py)
SURCHARGE = record(
    next(
        limit
        for limit in STAND_IN_DATA_LIMITS
        if limit.key == "additional_dwelling_purchases"
    ),
    ["gov.hmrc.stamp_duty.residential.purchase.additional.rate[1].rate"],
)
BUILD_CHECK = REPO / "scripts" / "check-public-files.mjs"
CI_CHECK = REPO / "scripts" / "check_public_data.py"
HISTORICAL = [r for r in releases.RELEASES.values() if r.historical]
EVENT = HISTORICAL[0]
KEY = "ab2026_mock_alpha"

spec = importlib.util.spec_from_file_location("check_public_data", CI_CHECK)
check_public_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_public_data)

release_strategy = st.sampled_from(list(releases.RELEASES.values()))
identity_strategy = st.one_of(
    release_strategy.map(lambda r: r.budget),
    st.fixed_dictionaries(
        {
            "id": st.sampled_from(
                [*releases.RELEASES, "uk-autumn-budget-2027"]
            ),
            "date": st.sampled_from(
                [r.date for r in releases.RELEASES.values()] + ["2026-10-29"]
            ),
        }
    ),
)
segment = st.from_regex(r"[a-z0-9][a-z0-9_.-]{0,11}", fullmatch=True)


def registry_document():
    return json.loads(
        (REPO / "src" / "uk_budget_data" / "releases.json").read_text()
    )


def test_the_registry_keeps_this_budget_as_the_default_at_the_old_root():
    assert releases.DEFAULT_RELEASE.id == "uk-autumn-budget-2026"
    assert releases.DEFAULT_RELEASE.budget == {
        "id": "uk-autumn-budget-2026",
        "date": "2026-10-28",
    }
    assert releases.DEFAULT_RELEASE.data_root == ""
    assert m.CURRENT_RELEASE == releases.DEFAULT_RELEASE.id
    assert m.CURRENT_BUDGET == releases.DEFAULT_RELEASE.budget
    assert view_files(releases.DEFAULT_RELEASE) == FLAT_VIEW_FILES
    assert HISTORICAL, "the registry lists past events"
    for release in HISTORICAL:
        assert release.data_root == f"releases/{release.id}"
        assert view_files(release) == HISTORICAL_FLAT_VIEW_FILES


def test_the_registry_ships_with_the_package():
    pyproject = (REPO / "pyproject.toml").read_text()
    assert '"releases.json"' in pyproject


@pytest.mark.parametrize(
    "change,message",
    [
        (lambda d: d.update(schema="other"), "unknown schema"),
        (lambda d: d.update(default="uk-autumn-budget-2025"), "exactly one"),
        (
            lambda d: d["releases"][1].update(kind="current", event=None),
            "keeps the default",
        ),
        (
            lambda d: d["releases"][1].update(data_root="releases/elsewhere"),
            "must live in",
        ),
        (lambda d: d["releases"][1].pop("event"), "names no replayed event"),
        (
            lambda d: d["releases"][2].update(event=d["releases"][1]["event"]),
            "same event",
        ),
        (lambda d: d["releases"].append(d["releases"][1]), "listed twice"),
        (lambda d: d["releases"][1].update(date="2025-13-01"), "not a date"),
        (lambda d: d["releases"][1].update(id="UK 2025"), "not a valid id"),
        (lambda d: d["releases"][1].update(extra=1), "wrong fields"),
    ],
)
def test_a_malformed_registry_is_refused(change, message):
    document = registry_document()
    change(document)
    with pytest.raises(releases.ReleaseError, match=message):
        releases.parse_registry(document)


@given(st.permutations(registry_document()["releases"]))
def test_the_registry_does_not_depend_on_its_order(listed):
    document = {**registry_document(), "releases": list(listed)}
    default, parsed = releases.parse_registry(document)
    assert default == releases.DEFAULT_RELEASE
    assert parsed == releases.RELEASES


# A root's last segment: any name, or a registered release's id, which the
# segment pattern is too short to reach
root_name = st.one_of(segment, st.sampled_from(sorted(releases.RELEASES)))


@given(st.lists(segment, min_size=0, max_size=4), root_name)
def test_the_data_root_decides_the_release(parents, name):
    base = Path("/", *parents)
    if base.name == releases.RELEASES_DIR:
        return
    assert releases.release_for_root(base / name) == (releases.DEFAULT_RELEASE)
    inside = base / releases.RELEASES_DIR / name
    registered = releases.RELEASES.get(name)
    if registered is not None and registered.historical:
        assert releases.release_for_root(inside) is registered
    else:
        with pytest.raises(releases.ReleaseError):
            releases.release_for_root(inside)


def test_each_release_root_round_trips():
    public = Path("/repo/public/data")
    for release in releases.RELEASES.values():
        root = releases.data_root_for(release, public)
        assert releases.release_for_root(root) is release


@given(release_strategy, identity_strategy)
def test_a_manifest_is_for_a_release_exactly_when_it_names_it(
    release, identity
):
    raw = {"release": identity["id"], "budget": identity}
    problems = identity_problems(raw, release)
    assert (problems == []) == (identity == release.budget)
    if problems and release is releases.DEFAULT_RELEASE:
        assert problems == [
            "manifest is not explicitly for the current 2026 Budget release"
        ]


def test_an_empty_manifest_carries_its_roots_release(tmp_path):
    root = tmp_path / "public" / "data"
    assert m.load_manifest(root).budget == releases.DEFAULT_RELEASE.budget
    historical = releases.data_root_for(EVENT, root)
    loaded = m.load_manifest(historical)
    assert (loaded.release, loaded.budget) == (EVENT.id, EVENT.budget)
    with pytest.raises(releases.ReleaseError):
        m.load_manifest(root / releases.RELEASES_DIR / "uk-not-registered")


@given(st.lists(segment, min_size=1, max_size=4))
def test_no_artifact_path_enters_the_releases_directory(parts):
    assert releases.enters_releases_dir("/".join(["releases", *parts]))
    assert not releases.enters_releases_dir("/".join(["artifacts", *parts]))


def _entry(artifact: str) -> dict:
    return {
        "name": "Alpha",
        "status": m.STAGED,
        "artifact": artifact,
        "outputs_sha256": "0" * 64,
        "receipt_sha256": "0" * 64,
        "execution_identity_sha256": "0" * 64,
        "artifact_sha256": "0" * 64,
        "years": [2027],
    }


def test_a_manifest_entry_into_releases_is_refused():
    with pytest.raises(ValueError, match="enters releases/"):
        m.Entry.model_validate(
            _entry(f"releases/{EVENT.id}/artifacts/alpha/x")
        )
    # An encoded way in, which a browser would resolve into that root
    with pytest.raises(ValueError, match="must be relative to the data root"):
        m.Entry.model_validate(
            _entry(f"artifacts/%2e%2e/releases/{EVENT.id}/artifacts/alpha/x")
        )


ARTIFACT_PATHS = json.loads(
    (REPO / "src" / "test" / "fixtures" / "artifact_paths.json").read_text()
)["cases"]


@pytest.mark.parametrize("path,safe", ARTIFACT_PATHS)
def test_python_and_the_page_agree_on_each_artifact_path(path, safe):
    # src/utils/publication/release.test.js checks the page on these cases
    try:
        m.Entry.model_validate(_entry(path))
    except ValueError:
        accepted = False
    else:
        accepted = True
    assert accepted is safe


@given(release_strategy, st.lists(segment, min_size=1, max_size=3))
def test_only_each_releases_own_outputs_are_publication_paths(release, tail):
    root = "public/data/" + (
        f"{release.data_root}/" if release.data_root else ""
    )
    assert is_publication_path(f"{root}manifest.json")
    assert is_publication_path(root + "artifacts/" + "/".join(tail))
    name = "/".join(tail)
    if name != "manifest.json" and not name.startswith("artifacts/"):
        assert not is_publication_path(root + name)
    assert not is_publication_path(
        "public/data/releases/uk-not-registered/manifest.json"
    )


def test_the_build_check_lists_the_same_historical_view_files():
    script = BUILD_CHECK.read_text()
    match = re.search(r"HISTORICAL_FLAT_VIEW_FILES = \[([^\]]*)\]", script)
    assert match is not None
    assert (
        tuple(re.findall(r'"([^"]+)"', match.group(1)))
        == HISTORICAL_FLAT_VIEW_FILES
    )


# A historical root end to end: synthetic figures from World's dummy
# dataset, never real ones.


@pytest.fixture
def event_world():
    instance = World(release=EVENT)
    yield instance
    instance.close()


def _write_csv(path: Path, header, rows) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def _event_snapshot(world):
    reference = world.ready(KEY, {2027: -1.0})
    manifest = m.load_manifest(world.data_root)
    assert manifest.release == EVENT.id
    args = {"data_root": world.data_root, "inputs": world.inputs}
    stage(manifest, reference.path, **args)
    approve(manifest, KEY, "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    _write_csv(
        world.data_root / "obr_comparison.csv",
        HISTORICAL_OBR_COMPARISON_HEADER,
        [[KEY, "Alpha", 2027, -1.1, -1.1, -1.2, "synthetic pair"]],
    )
    _write_csv(
        world.data_root / "coverage.csv",
        METADATA_HEADERS["coverage.csv"],
        [["modelled", "", 1, 1, "-1.1", "1.1", "1", "1"]],
    )
    _write_csv(
        world.data_root / "not_modelled.csv",
        METADATA_HEADERS["not_modelled.csv"],
        [],
    )
    return manifest, args


def _node_problems(world):
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
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def _ci_problems(world):
    public = world.root / "public" / "data"
    problems = []
    for release in releases.RELEASES.values():
        root = releases.data_root_for(release, public)
        if root.exists():
            problems += manifest_identity_problems(root)
            problems += release_index_problems(root)
    return problems


def test_a_past_event_publishes_from_its_own_root(event_world):
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    index = json.loads((event_world.data_root / INDEX_FILE).read_bytes())
    assert index["release"] == EVENT.id
    assert index["budget"] == EVENT.budget
    assert set(index["files"]) == set(HISTORICAL_FLAT_VIEW_FILES)
    assert check(manifest, **args) == []
    assert _ci_problems(event_world) == []
    assert _node_problems(event_world) == []
    # Nothing was written to this Budget's root
    public = event_world.root / "public" / "data"
    assert sorted(p.name for p in public.iterdir()) == ["releases"]


@pytest.mark.parametrize("where", ["manifest", "index", "both"])
def test_a_past_event_binds_no_area_provenance(event_world, where):
    """Area provenance is this Budget's: a past event has no results by
    area, so publish index binds none, and both gates refuse an index or
    manifest that binds one, even a matching pair."""
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    path = m.manifest_path(event_world.data_root)
    index_path = event_world.data_root / INDEX_FILE
    raw = json.loads(path.read_bytes())
    index = json.loads(index_path.read_bytes())
    assert manifest.flat_provenance_sha256 is None
    assert "flat_provenance_sha256" not in raw
    assert "flat_provenance_sha256" not in index
    digest = "0" * 64
    if where in ("manifest", "both"):
        raw["flat_provenance_sha256"] = digest
        path.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n")
    if where in ("index", "both"):
        index["flat_provenance_sha256"] = digest
    # Rebind the manifest's bytes, so only the provenance binding differs
    index["manifest_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    index_path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")
    expected = "release index: a past event binds no area provenance"
    assert _ci_problems(event_world) == [expected]
    assert _node_problems(event_world) == [f"{EVENT.id}: {expected}"]


@pytest.mark.parametrize(
    "mutation", ["this_budgets_identity", "other_event", "unknown_dir"]
)
def test_both_checks_refuse_a_root_holding_another_releases_files(
    event_world, mutation
):
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    path = m.manifest_path(event_world.data_root)
    if mutation == "unknown_dir":
        stray = event_world.data_root.parent / "uk-not-registered"
        stray.mkdir()
        (stray / "manifest.json").write_text("{}")
        node = _node_problems(event_world)
        assert node == [
            "public/data/releases/uk-not-registered: not a registered "
            "historical release"
        ]
        return
    other = (
        releases.DEFAULT_RELEASE
        if mutation == "this_budgets_identity"
        else HISTORICAL[1]
    )
    raw = json.loads(path.read_bytes())
    raw.update(release=other.id, budget=other.budget)
    path.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n")
    expected = f"manifest is not explicitly for the {EVENT.name} release"
    assert expected in _ci_problems(event_world)
    assert f"{EVENT.id}: release index: {expected}" in _node_problems(
        event_world
    )
    assert expected in check(m.parse_manifest(path.read_bytes()), **args)


def test_the_ci_check_names_the_release_and_flags_unknown_dirs(event_world):
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    stray = event_world.root / "public" / "data" / "releases" / "uk-nope"
    stray.mkdir()
    # The release-root part of the CI check, which needs no Git
    public = event_world.root / "public" / "data"
    assert check_public_data.release_root_problems(public) == [
        "public/data/releases/uk-nope: not a registered historical release"
    ]
    path = m.manifest_path(event_world.data_root)
    raw = json.loads(path.read_bytes())
    raw.update(budget={"id": EVENT.id, "date": "2000-01-01"})
    path.write_text(json.dumps(raw))
    problems = check_public_data.release_root_problems(public)
    assert (
        f"{EVENT.id}: manifest is not explicitly for the {EVENT.name} release"
        in problems
    )


@pytest.mark.parametrize(
    "filename,header",
    [
        (
            "obr_comparison.csv",
            (
                "reform_id",
                "reform_name",
                "year",
                "policyengine_value",
                "obr_static_value",
                "obr_post_behavioural_value",
            ),
        ),
        ("coverage.csv", ("class", "measures")),
        ("not_modelled.csv", ("reform_id", "reason")),
    ],
)
def test_a_historical_flat_file_needs_its_exact_header(
    event_world, filename, header
):
    manifest, args = _event_snapshot(event_world)
    _write_csv(event_world.data_root / filename, header, [])
    with pytest.raises(Exception, match="header is not"):
        write_release_index(manifest, **args)


def _rebind(world, filename: str, content: bytes) -> None:
    """Replace a bound view file and bind its new bytes in both the manifest
    and the index, as a hand edit that skips the index writer would."""
    root = world.data_root
    (root / filename).write_bytes(content)
    path = m.manifest_path(root)
    raw = json.loads(path.read_bytes())
    raw["flat_files"][filename] = hashlib.sha256(content).hexdigest()
    manifest_bytes = (
        json.dumps(raw, indent=2, sort_keys=True) + "\n"
    ).encode()
    path.write_bytes(manifest_bytes)
    index_path = root / INDEX_FILE
    index = json.loads(index_path.read_bytes())
    index["files"][filename] = raw["flat_files"][filename]
    index["manifest_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    index_path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")


@pytest.mark.parametrize("filename", HISTORICAL_FLAT_VIEW_FILES)
def test_both_public_gates_refuse_a_bound_view_with_another_header(
    event_world, filename
):
    # Review's probe: a correctly bound file holding "wrong,header"
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    _rebind(event_world, filename, b"wrong,header\n1,2\n")
    expected = f"{filename}: header is not"
    assert any(expected in problem for problem in _ci_problems(event_world))
    assert any(
        problem.startswith(f"{EVENT.id}: release index: {expected}")
        for problem in _node_problems(event_world)
    )
    # The binding itself is intact: the header is the only problem
    assert not any(
        "differ" in problem for problem in _ci_problems(event_world)
    )


def test_both_public_gates_refuse_a_bound_view_row_missing_a_field(
    event_world,
):
    manifest, args = _event_snapshot(event_world)
    write_release_index(manifest, **args)
    header = ",".join(METADATA_HEADERS["coverage.csv"])
    _rebind(event_world, "coverage.csv", f"{header}\nmodelled,\n".encode())
    assert "release index: coverage.csv: a row does not have every field" in (
        _ci_problems(event_world)
    )
    assert (
        f"{EVENT.id}: release index: coverage.csv: a row does not have every field"
        in _node_problems(event_world)
    )


@pytest.mark.usefixtures("stand_in_data_limits")
def test_a_held_measure_keeps_its_obr_comparison_row(event_world):
    # Review's probe: Autumn Budget 2024's SDLT measure is not computable on
    # this dashboard's data, and its OBR comparison row (the OBR's and the
    # replay's figures, not this page's) blocked the whole release index
    manifest, args = _event_snapshot(event_world)
    held = "ab2026_mock_held"
    reference = event_world.write(held, {2027: 0.0}, data_limits=[SURCHARGE])
    stage(manifest, reference.path, **args)
    assert manifest.measures[held].status == m.NOT_COMPUTABLE
    m.save_manifest(manifest, event_world.data_root)
    with (event_world.data_root / "obr_comparison.csv").open("a") as handle:
        handle.write(f"{held},Held,2027,-0.4,-0.3,-0.2,synthetic pair\n")
    write_release_index(manifest, **args)
    assert _ci_problems(event_world) == []
    assert _node_problems(event_world) == []
    # A bad year is still refused
    _rebind(
        event_world,
        "obr_comparison.csv",
        (event_world.data_root / "obr_comparison.csv")
        .read_bytes()
        .replace(b",2027,-0.4", b",20x7,-0.4"),
    )
    assert (
        "release index: obr_comparison.csv: not a readable CSV with integer years"
        in _ci_problems(event_world)
    )


def test_this_budgets_flat_files_still_refuse_a_held_entry_s_figures():
    # The allowance is the past event's OBR comparison's alone
    manifest = m.Manifest(
        measures={
            "held": m.Entry(
                name="Held",
                status=m.STAGED,
                artifact="artifacts/held/0123456789abcdef",
                outputs_sha256="0" * 64,
                receipt_sha256="0" * 64,
                execution_identity_sha256="0" * 64,
                artifact_sha256="0" * 64,
                years=[2027],
            )
        }
    )
    row = b"reform_id,year,value\nheld,2027,1.0\n"
    assert _flat_problems(manifest, {"regional.csv": row}, {}) == [
        "regional.csv: has figures for held, which is staged"
    ]
    assert _flat_problems(
        manifest, {"regional.csv": row}, {}, releases.DEFAULT_RELEASE
    ) == ["regional.csv: has figures for held, which is staged"]


def test_the_page_and_the_build_check_use_python_s_historical_headers():
    expected = {
        **{name: list(header) for name, header in METADATA_HEADERS.items()},
        "obr_comparison.csv": list(HISTORICAL_OBR_COMPARISON_HEADER),
    }
    page = (REPO / "src" / "utils" / "historical.js").read_text()
    for constant, filename in [
        ("COVERAGE_HEADER", "coverage.csv"),
        ("NOT_MODELLED_HEADER", "not_modelled.csv"),
        ("OBR_HEADER", "obr_comparison.csv"),
    ]:
        match = re.search(rf"export const {constant} = \[([^\]]*)\]", page)
        assert match is not None
        assert re.findall(r'"([^"]+)"', match.group(1)) == expected[filename]
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed (CI has it)")
    result = subprocess.run(
        [
            node,
            "--input-type=module",
            "-e",
            'import { HISTORICAL_HEADERS } from "./scripts/check-public-files.mjs"; console.log(JSON.stringify(HISTORICAL_HEADERS));',
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(result.stdout) == expected


def test_this_budgets_root_does_not_bind_historical_files(tmp_path):
    world = World()
    try:
        reference = world.ready(KEY, {2027: -1.0})
        manifest = m.Manifest()
        args = {"data_root": world.data_root, "inputs": world.inputs}
        stage(manifest, reference.path, **args)
        approve(manifest, KEY, "Reviewer", **args)
        m.save_manifest(manifest, world.data_root)
        _write_csv(
            world.data_root / "coverage.csv",
            METADATA_HEADERS["coverage.csv"],
            [],
        )
        with pytest.raises(Exception, match="no flat view file to bind"):
            write_release_index(manifest, **args)
    finally:
        world.close()
