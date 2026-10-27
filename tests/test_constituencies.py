"""Tests for the constituency run on the local-area cut (#115).

Every array is synthetic: invented households and changes, made-up seats
(Z14 codes, which no real seat has) and the real region codes. Hugging Face
is a stand-in, the simulations are stand-ins, and each "fresh process" runs
the step in this process, with a stand-in /usr/bin/time report.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import h5py
import numpy as np
import pandas as pd
import pytest

from tests.publication_support import RATE_PATH
from tests.test_geography import (
    BASE,
    FakeSimulation,
    assert_public_area_output,
    publication_manifest,
    synthetic_inputs,
)
from uk_budget_data import constituencies as c
from uk_budget_data import geography as g
from uk_budget_data.private_outputs import AUDIT_DIR_ENV
from uk_budget_data.runtime_identity import installed_version

REPO = Path(__file__).resolve().parents[1]
OLDER = "microcosm-uk-2024-25-dense-20260101T000000Z-0000000a"
TAG = "microcosm-uk-2024-25-dense-20260201T000000Z-0000000b"
NEWER = "microcosm-uk-2024-25-dense-20260301T000000Z-0000000c"
PKG = "pkg_combined"
MEASURES = ("alpha", "beta", "zero")
YEARS = (2026, 2027)
# A parameter under a data limit in force (pip_daily_living_points), so a
# measure on it is not computable. (These tests used the SDLT surcharge
# until its limit lifted at the a6299504 cut.)
LIMITED_RATE = "gov.dwp.pip.daily_living.points_thresholds.enhanced"
MAC_TIME = (
    "        12.50 real        10.00 user         1.00 sys\n"
    "         7516192768  maximum resident set size\n"
    "                   0  average shared memory size\n"
    "         23622320128  peak memory footprint\n"
)


# -- Hugging Face, and the cut ----------------------------------------------


def release_manifest(tag, sha256, *, model=None, artifacts=None):
    """A cut's release manifest, as Microcosm writes one."""
    model = model or f"=={installed_version('policyengine-uk')}"
    core = f"=={installed_version('policyengine-core')}"
    return {
        "build": {
            "cut_tag": tag,
            "built_with_model_package": {
                "name": "policyengine-uk",
                "version": installed_version("policyengine-uk"),
            },
        },
        "artifacts": artifacts
        or {
            "local": {
                "kind": "microdata",
                "path": "local.h5",
                "repo_id": c.REPOSITORY,
                "revision": tag,
                "sha256": sha256,
            },
            "diagnostics": {
                "kind": "diagnostics",
                "path": "diagnostics.json",
                "revision": tag,
                "sha256": "0" * 64,
            },
        },
        "compatible_model_packages": [
            {"name": "policyengine-uk", "specifier": model}
        ],
        "compatible_core_packages": [
            {"name": "policyengine-core", "specifier": core}
        ],
    }


class FakeHub:
    """The parts of huggingface_hub.HfApi the run uses."""

    def __init__(self, files, tags=None, manifests=None, lfs=None):
        self.files = files
        self.tags = list(tags or files)
        self.manifests = manifests or {
            tag: release_manifest(tag, c.sha256_file(path))
            for tag, path in files.items()
        }
        self.lfs = lfs or {
            tag: c.sha256_file(path) for tag, path in files.items()
        }
        self.downloads = []

    def list_repo_refs(self, repo_id, repo_type=None, token=None):
        assert (repo_id, repo_type) == (c.REPOSITORY, "dataset")
        return SimpleNamespace(
            tags=[SimpleNamespace(name=tag) for tag in self.tags],
            branches=[SimpleNamespace(name="main")],
        )

    def hf_hub_download(
        self, repo_id, filename, revision, repo_type, token, local_dir=None
    ):
        if filename == c.RELEASE_MANIFEST:
            path = Path(local_dir) / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(self.manifests[revision]))
            return str(path)
        self.downloads.append((filename, revision))
        return str(self.files[revision])

    def get_paths_info(self, repo_id, paths, revision, repo_type, token):
        return [
            SimpleNamespace(
                path=path, lfs=SimpleNamespace(sha256=self.lfs[revision])
            )
            for path in paths
        ]


def local_file(path, marker=True):
    """A file standing in for the cut, with Microcosm's export marker."""
    with h5py.File(path, "w") as handle:
        if marker:
            handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
        handle["synthetic"] = np.arange(3)
    return path


def pin(monkeypatch, tag, path):
    monkeypatch.setattr(
        c,
        "bundle_pin",
        lambda: {"revision": tag, "sha256": c.sha256_file(path)},
    )


def test_the_latest_cut_is_the_newest_tag(monkeypatch, tmp_path):
    files = {tag: local_file(tmp_path / f"{tag}.h5") for tag in (NEWER, OLDER)}
    hub = FakeHub(files, tags=[NEWER, "populace-uk-2023-x", OLDER])
    pin(monkeypatch, NEWER, files[NEWER])
    assert c.cut_tags(hub, "token") == [OLDER, NEWER]
    cut = c.resolve_cut(None, api=hub, token="token")
    assert (cut.tag, cut.pinned, cut.short) == (NEWER, True, "0000000c")
    assert cut.sha256 == c.sha256_file(files[NEWER])
    assert hub.downloads == []


def test_a_cut_the_bundle_does_not_pin_runs_only_when_named(
    monkeypatch, tmp_path
):
    files = {tag: local_file(tmp_path / f"{tag}.h5") for tag in (TAG, NEWER)}
    hub = FakeHub(files)
    pin(monkeypatch, TAG, files[TAG])
    with pytest.raises(c.ConstituencyRunError) as refused:
        c.resolve_cut(None, api=hub, token="token")
    assert f"--cut {TAG}" in str(refused.value)
    assert f"--cut {NEWER}" in str(refused.value)
    assert not c.resolve_cut(NEWER, api=hub, token="token").pinned
    assert c.resolve_cut(TAG, api=hub, token="token").pinned


def test_a_newer_cut_for_another_model_names_the_pinned_one(
    monkeypatch, tmp_path
):
    """26 October: a cut for the next pair was published while the
    installed bundle still pinned the earlier one."""
    files = {tag: local_file(tmp_path / f"{tag}.h5") for tag in (TAG, NEWER)}
    manifests = {
        tag: release_manifest(
            tag, c.sha256_file(path), model="==0.0.1" if tag == NEWER else None
        )
        for tag, path in files.items()
    }
    hub = FakeHub(files, manifests=manifests)
    pin(monkeypatch, TAG, files[TAG])
    with pytest.raises(c.ConstituencyRunError) as refused:
        c.resolve_cut(None, api=hub, token="token")
    assert f"The cut {NEWER} was built for" in str(refused.value)
    assert f"Pass --cut {TAG}" in str(refused.value)
    assert c.resolve_cut(TAG, api=hub, token="token").pinned


@pytest.mark.parametrize(
    ("tag", "message"),
    [
        (
            "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71",
            "is not a cut of microcosm-uk-2024-25-dense",
        ),
        (NEWER, "has no tag"),
    ],
)
def test_a_tag_that_is_no_published_cut_is_refused(
    tag, message, monkeypatch, tmp_path
):
    hub = FakeHub({TAG: local_file(tmp_path / "local.h5")})
    with pytest.raises(c.ConstituencyRunError, match=message):
        c.resolve_cut(tag, api=hub, token="token")


@pytest.mark.parametrize(
    "broken",
    ["lfs", "model", "cut_tag", "two files", "repository"],
)
def test_a_cut_whose_manifest_or_metadata_disagree_is_refused(
    broken, monkeypatch, tmp_path
):
    path = local_file(tmp_path / "local.h5")
    sha256 = c.sha256_file(path)
    manifest = release_manifest(TAG, sha256)
    lfs = {TAG: sha256}
    if broken == "lfs":
        lfs = {TAG: "f" * 64}
    elif broken == "model":
        manifest = release_manifest(TAG, sha256, model="==0.0.1")
    elif broken == "cut_tag":
        manifest["build"]["cut_tag"] = OLDER
    elif broken == "two files":
        local = manifest["artifacts"]["local"]
        manifest["artifacts"]["other"] = {**local, "path": "other.h5"}
    else:
        manifest["artifacts"]["local"]["repo_id"] = "someone/else"
    hub = FakeHub({TAG: path}, manifests={TAG: manifest}, lfs=lfs)
    pin(monkeypatch, TAG, path)
    with pytest.raises(c.ConstituencyRunError):
        c.resolve_cut(TAG, api=hub, token="token")


def test_a_file_whose_bytes_are_not_the_cut_is_refused(monkeypatch, tmp_path):
    path = local_file(tmp_path / "local.h5")
    hub = FakeHub({TAG: path})
    pin(monkeypatch, TAG, path)
    cut = c.resolve_cut(TAG, api=hub, token="token")
    assert c.fetch_cut(cut, api=hub, token="token") == path
    other = local_file(tmp_path / "other.h5", marker=False)
    with pytest.raises(c.ConstituencyRunError, match="not the cut's"):
        c.fetch_cut(cut, api=hub, token="token", dataset=other)


def test_the_bundle_pin_is_the_file_it_routes_constituencies_to(monkeypatch):
    bundle = {
        "data_releases": {
            "uk": {
                "region_datasets": {
                    "constituency": {"path_template": "local.h5"},
                    "national": {"path_template": "national.h5"},
                },
                "datasets": {
                    "national": {"path": "national.h5", "revision": "n"},
                    "local": {"path": "local.h5", "revision": TAG},
                },
            }
        }
    }
    monkeypatch.setattr(c, "load_bundle_manifest", lambda: bundle)
    assert c.bundle_pin() == {
        "dataset": "local",
        "path": "local.h5",
        "revision": TAG,
    }
    del bundle["data_releases"]["uk"]["region_datasets"]["constituency"]
    assert c.bundle_pin() is None


# -- the command on synthetic households -------------------------------------


def households(codes):
    """24 synthetic households per region, each in its region's first seat,
    every one its own survey household."""
    n = 24 * len(codes)
    index = np.arange(n)
    region = [codes[i % len(codes)] for i in index]
    seat = {code: f"Z14{i + 1:06d}" for i, code in enumerate(codes)}
    household = pd.DataFrame(
        {
            "household_id": index + 1,
            "household_weight": 50.0 + index % 3,
            "source_household_id": index + 1,
            "region_code_oa": [
                code if code[0] == "E" else code[0] + "99999999"
                for code in region
            ],
            "constituency_code_oa": [seat[code] for code in region],
        }
    )
    changes = {
        "alpha": np.where(index % 2 == 0, 100.0, 0.0),
        "beta": np.where(index % 3 == 0, -50.0, 0.0),
        # Like the employer NI relief: no household's income moves.
        "zero": np.zeros(n),
    }
    changes[PKG] = sum(changes[m] for m in MEASURES)
    return household, changes


class World:
    """A synthetic run: lookups, households, a manifest, a cut and hub."""

    def __init__(self, monkeypatch, tmp_path, changes_of=None):
        from uk_budget_data.models import Reform

        self.tmp = tmp_path
        self.inputs, _, codes = synthetic_inputs(tmp_path)
        self.household, self.changes = households(codes)
        self.simulated = []
        self.reforms = {
            reform: Reform(
                id=reform,
                name=reform,
                parameter_changes=(changes_of or {}).get(reform) or {},
            )
            for reform in (*MEASURES, PKG)
        }
        monkeypatch.setattr(g, "get_reform", self.reforms.get)
        monkeypatch.setattr(g, "PACKAGES", {PKG: MEASURES})
        monkeypatch.setattr(g, "simulate_reform", self.simulate)
        # Approved for every year a test runs: the area run checks that
        self.manifest = publication_manifest(
            tmp_path, self.reforms, packages={PKG: MEASURES}, years=YEARS
        )
        self.cut = local_file(tmp_path / "local.h5")
        self.hub = FakeHub({TAG: self.cut})
        pin(monkeypatch, TAG, self.cut)
        monkeypatch.setattr(
            c.area_routing,
            "installed_routing",
            lambda: {"area_views": "available", "regional_release_kind": "x"},
        )
        monkeypatch.setattr(c, "DEFAULT_PRIOR", tmp_path / "no-regional.csv")
        monkeypatch.setenv(c.TOKEN_ENV, "not-a-real-token")
        monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
        self.audit = tmp_path / "audit" / "geography"
        self.out = tmp_path / "out"
        self.steps = []
        self.fail = set()
        swaps = iter(range(1, 1000))
        monkeypatch.setattr(c, "swap_used", lambda: next(swaps) * c.GB // 10)
        monkeypatch.setattr(c, "run_process", self.run_process)

    def simulate(self, reform, dataset, years):
        assert dataset == str(self.cut)
        self.simulated.append(reform.id)
        person = pd.DataFrame()
        return (
            FakeSimulation(
                self.household,
                person,
                {year: np.full(len(self.household), BASE) for year in years},
            ),
            FakeSimulation(
                self.household,
                person,
                {year: BASE + self.changes[reform.id] for year in years},
            ),
        )

    def run_process(self, command, env):
        """A step's "fresh process", run here: the step, its arguments and
        the environment it would get, with a stand-in time report."""
        assert env["HDF5_USE_FILE_LOCKING"] == "FALSE"
        at = command.index("-m")
        assert command[at + 1] == c.MODULE
        step, spec = command[at + 2], command[at + 4]
        name = json.loads(Path(spec).read_text()).get("reform", "release")
        self.steps.append(name)
        if name in self.fail:
            self.fail.discard(name)
            return 1, "Traceback: a stand-in failure\n"
        return c.main([step, "--spec", spec]), "a warning\n" + MAC_TIME

    def args(self, *extra, years=("2026",)):
        return [
            "constituencies",
            "--manifest",
            str(self.manifest),
            "--out-dir",
            str(self.out),
            "--data-inputs-dir",
            str(self.inputs),
            "--years",
            *years,
            *extra,
        ]

    def run(self, *extra, years=("2026",)):
        from uk_budget_data.cli import parse_args

        self.steps.clear()
        self.simulated.clear()
        return c.run_constituencies(
            parse_args(self.args(*extra, years=years)), api=self.hub
        )


@pytest.fixture
def world(monkeypatch, tmp_path):
    return World(monkeypatch, tmp_path)


def printed(capsys):
    return " ".join(capsys.readouterr().out.split())


def test_constituencies_arguments():
    from uk_budget_data.cli import parse_args

    parsed = parse_args(["constituencies"])
    assert parsed.command == "constituencies"
    assert parsed.cut is None and parsed.dataset is None
    assert parsed.reforms is None and not parsed.dry_run
    assert parsed.manifest == Path("public/data/manifest.json")
    assert parsed.out_dir == Path("public/data")
    assert parsed.prior_regional is None and parsed.run_id is None
    assert not parsed.fresh and not parsed.allow_demotions
    parsed = parse_args(
        ["constituencies", "--cut", TAG, "--dry-run", "--years", "2027"]
    )
    assert (parsed.cut, parsed.dry_run, parsed.years) == (TAG, True, [2027])


def test_one_release_over_every_measure_each_in_its_own_process(world, capsys):
    assert world.run(years=("2026", "2027")) == 0, printed(capsys)
    assert world.steps == [*MEASURES, PKG, "release"]
    assert world.simulated == [*MEASURES, PKG]
    table = world.out / "constituency.csv"
    assert sorted(p.name for p in world.out.iterdir()) == [
        "area_provenance.json",
        "constituency.csv",
    ]
    assert_public_area_output(world.out)
    frame = pd.read_csv(table)
    assert set(frame["reform"]) == {*MEASURES, PKG}
    assert set(frame["level"]) == {"constituency"}
    assert set(frame["year"]) == {2026, 2027}
    assert frame["area_code"].str.startswith("Z14").all()
    # The measure that moves no income is published as no change.
    zero = frame[(frame["reform"] == "zero") & (frame["tier"] != "withheld")]
    assert set(zero["direction"]) == {"no_change"}
    (run,) = world.audit.iterdir()
    assert run.name == "constituencies-0000000b"
    (release,) = [p for p in run.iterdir() if p.name.startswith("microcosm-")]
    assert sorted(p.name for p in release.iterdir()) == [
        "disclosure_audit.csv",
        "summary.json",
    ]
    summary = json.loads((release / "summary.json").read_text())
    assert summary["certified"] is False
    assert summary["seat_reforms"] == sorted([*MEASURES, PKG])
    assert set(summary["timings_s"]) >= {"estimate_s", "resolve_s"}
    # Private files are the owner's alone.
    for path in run.rglob("*"):
        assert path.stat().st_mode & 0o077 == 0, path
    out = printed(capsys)
    assert "validate_public, 0 problems" in out
    assert "records constituency.csv for publish index" in out
    assert out.count(g.MICROCOSM_UNCERTIFIED) == 2


def test_the_timing_table_has_every_step_and_year(world, capsys):
    assert world.run(years=("2026", "2027")) == 0
    (run,) = world.audit.iterdir()
    (path,) = run.glob("timings-*.md")
    text = path.read_text()
    assert text in capsys.readouterr().out
    rows = [line for line in text.splitlines() if line.startswith("|")]
    header = rows[0].split(" | ")
    for column in (
        "build_s",
        "calculate_s",
        "limits_s",
        "simulate_s",
        "estimate_s",
        "resolve_s",
        "Wall",
        "Peak footprint",
        "Max RSS",
        "Swap before → after",
    ):
        assert column in rows[0]
    steps = [row for row in rows if row.count("|") == len(header) + 1]
    named = {row.split(" | ")[0].strip("| `") for row in steps}
    assert named >= {*MEASURES, PKG, f"{PKG}__interaction"}
    assert any(
        r.startswith("| Release (all measures) | written") for r in rows
    )
    assert any(r.startswith("| Total") for r in rows)
    # /usr/bin/time's peak footprint and maximum resident size, in GB.
    assert "| 22.0 | 7.0 |" in text
    assert "| Step | 2026 | 2027 |" in rows
    by_year = [row for row in rows if row.startswith("| `alpha` | ")]
    assert len(by_year) == 2 and by_year[1].count(" / ") == 2


def assert_publish_index_accepts(world):
    """``publish index``'s check passes the run's table: it lies beside the
    provenance the run wrote, under the manifest's data root."""
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.release_index import (
        AREA_PROVENANCE_FILE,
        area_problems,
    )

    root = world.manifest.parent
    for name in (c.TABLE, AREA_PROVENANCE_FILE):
        (root / name).write_bytes((world.out / name).read_bytes())
    manifest = m.parse_manifest(world.manifest.read_bytes(), "manifest")
    files = {c.TABLE: (root / c.TABLE).read_bytes()}
    problems, aliases = area_problems(manifest, files, root)
    assert problems == []
    assert set(aliases) == {PKG}
    provenance = json.loads((root / AREA_PROVENANCE_FILE).read_text())
    assert set(provenance["reforms"]) == {*MEASURES, PKG}
    assert set(provenance["files"]) == {c.TABLE}


def test_the_table_and_its_provenance_pass_publish_index(world, capsys):
    assert world.run(years=("2026", "2027")) == 0, printed(capsys)
    assert_publish_index_accepts(world)
    out = printed(capsys)
    assert "records constituency.csv for publish index" in out


def test_a_changed_definition_is_refused_before_anything_runs(world, capsys):
    """The current definition must be the one the approved receipt records,
    as ``geography`` requires, before any measure is simulated."""
    world.reforms["alpha"] = world.reforms["alpha"].model_copy(
        update={"parameter_changes": {RATE_PATH: {"2026": 0.35}}}
    )
    assert world.run() == 1
    assert "alpha: current reform identity differs" in printed(capsys)
    assert world.steps == [] and world.simulated == []
    assert not world.out.exists()


def test_a_second_run_reuses_every_measure(world, capsys):
    assert world.run() == 0
    first = (world.out / "constituency.csv").read_bytes()
    assert world.run() == 0
    assert world.steps == ["release"] and world.simulated == []
    assert (world.out / "constituency.csv").read_bytes() == first
    assert "Already simulated, reused: alpha, beta, zero, pkg_combined" in (
        printed(capsys)
    )
    assert world.run("--fresh") == 0
    assert world.steps == [*MEASURES, PKG, "release"]


def test_a_failed_process_is_retried_by_the_next_run(world, capsys):
    world.fail = {"beta"}
    assert world.run() == 1
    assert world.steps == [*MEASURES, PKG]
    assert not world.out.exists()
    assert "beta did not finish (failed (exit 1))" in printed(capsys)
    assert world.run() == 0
    assert world.steps == ["beta", "release"]


def test_a_refused_measure_writes_no_table_and_names_the_rest(
    monkeypatch, tmp_path, capsys
):
    world = World(
        monkeypatch,
        tmp_path,
        changes_of={"alpha": {LIMITED_RATE: {"2026": 10}}},
    )
    assert world.run() == 1
    assert world.steps == [*MEASURES, PKG]
    assert not world.out.exists()
    out = printed(capsys)
    assert "Not computable on current data: alpha" in out
    assert f"Not computable on current data: {PKG}" in out
    assert "--reforms beta zero" in out
    # A refused measure keeps its reasons only, no household arrays.
    units = next(world.audit.iterdir()) / "units"
    assert not (units / "alpha.npz").exists()
    assert (units / "beta.npz").exists()
    assert world.run("--reforms", "beta", "zero") == 0
    assert world.steps == ["release"]
    frame = pd.read_csv(world.out / "constituency.csv")
    assert set(frame["reform"]) == {"beta", "zero"}


def test_the_dry_run_checks_everything_and_simulates_nothing(world, capsys):
    assert world.run("--dry-run") == 0
    assert world.steps == [] and world.simulated == []
    assert not world.out.exists()
    out = printed(capsys)
    assert f"Local-area cut: {TAG}" in out
    assert "the cut the installed bundle routes constituencies to" in out
    assert "Measures: alpha, beta, zero; package: pkg_combined" in out
    assert (
        "As: uk-budget-data geography --dataset "
        f"{world.cut} --dataset-kind microcosm --levels constituency"
    ) in out
    assert (
        "Approved receipts: each reform's current definition is the one its "
        "manifest entry approved (4 checked)"
    ) in out
    assert (
        f"Area provenance: {world.out / 'area_provenance.json'}, for "
        "constituency.csv; every reform's baseline and reform match its "
        "approved receipt"
    ) in out
    assert "Dry run: nothing simulated." in out


def test_without_approvals_nothing_is_fetched_or_simulated(
    world, capsys, tmp_path
):
    from uk_budget_data.cli import parse_args

    args = world.args()
    args[args.index("--manifest") + 1] = str(tmp_path / "absent.json")
    assert c.run_constituencies(parse_args(args), api=world.hub) == 1
    assert "No publication manifest" in printed(capsys)
    assert world.hub.downloads == [] and world.steps == []


def test_an_unapproved_reform_is_refused_before_anything_runs(world, capsys):
    from uk_budget_data.cli import parse_args

    args = world.args("--reforms", "alpha", "unknown")
    assert c.run_constituencies(parse_args(args), api=world.hub) == 1
    assert "unknown: absent from the manifest" in printed(capsys)
    assert world.hub.downloads == [] and world.steps == []


def test_a_scratch_manifest_may_not_write_into_a_repository(world, capsys):
    from uk_budget_data.cli import parse_args

    args = world.args()
    args[args.index("--out-dir") + 1] = str(REPO / "public" / "data")
    assert c.run_constituencies(parse_args(args), api=world.hub) == 1
    assert "is not the publication manifest" in printed(capsys)
    assert world.hub.downloads == [] and world.steps == []


def test_a_bundle_that_routes_no_area_results_stops_the_run(
    world, monkeypatch, capsys
):
    monkeypatch.setattr(
        c.area_routing,
        "installed_routing",
        lambda: {"area_views": "not_available", "regional_release_kind": None},
    )
    assert world.run() == 1
    assert "routes no results by area" in printed(capsys)
    assert world.steps == []


def test_a_regional_table_matching_no_run_is_refused_before_simulating(
    world, capsys
):
    prior = world.tmp / "regional.csv"
    pd.DataFrame(
        [
            {
                "level": "region",
                "area_code": "E12000001",
                "reform": "elsewhere",
                "year": "2026",
                "outcome": "average_change",
                "tier": "reported",
                "noise": "False",
            }
        ]
    ).to_csv(prior, index=False)
    assert world.run("--prior-regional", str(prior)) == 1
    assert "match no estimate" in printed(capsys)
    assert world.steps == []


def test_without_a_private_directory_nothing_runs(world, monkeypatch, capsys):
    monkeypatch.delenv(AUDIT_DIR_ENV)
    assert world.run() == 1
    assert AUDIT_DIR_ENV in printed(capsys)
    assert world.steps == [] and world.hub.downloads == []


# -- time reports and the release's timings ----------------------------------


def test_time_reports_from_macos_and_gnu_time():
    report, rest = c.split_time_report("a warning\n" + MAC_TIME)
    assert rest == "a warning\n"
    assert c.time_report(report) == {
        "peak_footprint": 23622320128,
        "max_rss": 7516192768,
    }
    gnu = (
        '\tCommand being timed: "python -m x"\n'
        "\tMaximum resident set size (kbytes): 2048\n"
    )
    report, rest = c.split_time_report("Traceback\n" + gnu)
    assert rest == "Traceback\n"
    assert c.time_report(report) == {
        "peak_footprint": None,
        "max_rss": 2048 * 1024,
    }
    assert c.split_time_report("no report\n") == ("", "no report\n")


def test_a_step_runs_under_time_where_the_machine_has_it(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(c, "TIME", tmp_path / "absent")
    assert c.timed(["python", "-m", "x"]) == ["python", "-m", "x"]
    fake = tmp_path / "time"
    fake.write_text("")
    monkeypatch.setattr(c, "TIME", fake)
    monkeypatch.setattr(c.platform, "system", lambda: "Darwin")
    assert c.timed(["python"]) == [str(fake), "-l", "python"]


def test_build_release_times_each_reform_and_year():
    collector = g.GeographyCollector(
        source_ids=np.arange(40),
        region_codes=np.array(["E12000001"] * 20 + ["E12000002"] * 20),
        national=True,
    )
    for year in (2026, 2027):
        for reform in ("a", "b", "p_combined"):
            collector.add(
                reform,
                year,
                baseline=np.full(40, BASE),
                reformed=np.full(40, BASE + 10.0),
                weight=np.full(40, 100.0),
            )
    timings = {}
    g.build_release(
        collector,
        levels=["region"],
        packages={"p_combined": ("a", "b")},
        settings=g.DisclosureSettings(n_replicates=200),
        run_timings=timings,
    )
    assert set(timings) == {
        (reform, year)
        for reform in ("a", "b", "p_combined", "p_combined__interaction")
        for year in (2026, 2027)
    }
    assert all(seconds >= 0 for seconds in timings.values())


# -- what publish index binds ----------------------------------------------


# -- --backend modal, with a stand-in session -------------------------------


class FakeModalSession:
    """Runs what the Modal containers run, here: each unit through
    ``constituencies_remote.simulate_here`` with its files under a
    stand-in Volume, then the release through ``release_here``."""

    def __init__(self, world, volume):
        from uk_budget_data import constituencies_remote as remote

        self.world, self.volume, self.remote = world, volume, remote
        self.specs = []

    def __call__(self):
        import contextlib

        @contextlib.contextmanager
        def session():
            yield self

        return session()

    def simulate(self, specs):
        for spec in specs:
            self.specs.append(spec)
            assert "dataset" not in spec and "arrays" not in spec
            if spec["reform"] in self.world.fail:
                yield RuntimeError("a stand-in container failure")
                continue
            result = self.remote.simulate_here(
                spec,
                root=str(self.volume),
                dataset=str(self.world.cut),
                data_inputs=str(self.world.inputs),
            )
            yield {**result, "container": {"wall_s": 1.5, "max_rss": 3 * c.GB}}

    def release(self, spec):
        result, files = self.remote.release_here(
            spec, root=str(self.volume), data_inputs=str(self.world.inputs)
        )
        result["container"] = {"wall_s": 2.0, "max_rss": 4 * c.GB}
        return {"result": result, "files": files}


def test_the_modal_backend_writes_the_same_table(
    world, capsys, tmp_path, monkeypatch
):
    from uk_budget_data import modal_constituencies_runner as runner

    assert world.run(years=("2026",)) == 0, printed(capsys)
    local = (world.out / "constituency.csv").read_bytes()
    (world.out / "constituency.csv").unlink()

    volume = tmp_path / "volume"
    fake = FakeModalSession(world, volume)
    real_execute = runner.execute
    monkeypatch.setattr(
        runner,
        "execute",
        lambda *args, **kwargs: real_execute(*args, session=fake, **kwargs),
    )
    assert world.run("--backend", "modal", years=("2026",)) == 0, printed(
        capsys
    )
    # No local process ran: every step ran in the stand-in session.
    assert world.steps == []
    assert [s["reform"] for s in fake.specs] == [*MEASURES, PKG]
    remote = (world.out / "constituency.csv").read_bytes()
    assert remote == local
    # The arrays and the audit stay on the Volume, never in the output.
    assert sorted(p.name for p in world.out.iterdir()) == [
        "area_provenance.json",
        "constituency.csv",
    ]
    assert_publish_index_accepts(world)
    assert any(volume.rglob("disclosure_audit.csv"))
    out = printed(capsys)
    assert "validate_public, 0 problems" in out


def test_a_failed_modal_unit_writes_no_table(
    world, capsys, tmp_path, monkeypatch
):
    from uk_budget_data import modal_constituencies_runner as runner

    fake = FakeModalSession(world, tmp_path / "volume")
    world.fail.add(MEASURES[0])
    real_execute = runner.execute
    monkeypatch.setattr(
        runner,
        "execute",
        lambda *args, **kwargs: real_execute(*args, session=fake, **kwargs),
    )
    assert world.run("--backend", "modal", years=("2026",)) == 1
    assert not (world.out / "constituency.csv").exists()
    assert "failed on Modal" in printed(capsys)


def published(world, *extra):
    """The run, into the directory of the manifest it was approved under,
    where publish index reads the approved receipts."""
    return world.run("--out-dir", str(world.tmp), *extra)


def index_reads(world):
    """What publish index finds of the area tables beside the manifest: its
    problems, and the manifest key it gives the page for each alias."""
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.release_index import (
        AREA_FILES,
        area_problems,
    )

    files = {
        name: (world.tmp / name).read_bytes()
        for name in AREA_FILES
        if (world.tmp / name).is_file()
    }
    manifest = m.parse_manifest(world.manifest.read_bytes(), "manifest")
    return area_problems(manifest, files, world.tmp)


def regional_run(world, monkeypatch):
    """geography's regional pass on the route that publishes regions (the
    enhanced FRS), over the same changes and approvals: regional.csv and
    the area_provenance.json that records it, beside the manifest."""
    from tests.test_geography import FLAGS, REGIONS_CSV, enhanced_frs_bundle
    from uk_budget_data import cli

    frs_regions = list(pd.read_csv(REGIONS_CSV, dtype=str)["frs_region"])
    n = len(world.household)
    household = world.household.drop(
        columns=["region_code_oa", "constituency_code_oa"]
    ).assign(
        region=[frs_regions[i % len(frs_regions)] for i in range(n)],
        tenure_type="OWNED_OUTRIGHT",
        accommodation_type="HOUSE_DETACHED",
        **{flag: False for flag in FLAGS},
    )
    person = pd.DataFrame(
        {
            "person_household_id": household["household_id"],
            "age": 40,
            "gender": "FEMALE",
        }
    )

    def simulate(reform, dataset, years):
        baseline = np.full(n, BASE)
        changed = baseline + world.changes[reform.id]
        return (
            FakeSimulation(household, person, dict.fromkeys(years, baseline)),
            FakeSimulation(household, person, dict.fromkeys(years, changed)),
        )

    with monkeypatch.context() as patch:
        patch.setattr(g, "simulate_reform", simulate)
        enhanced_frs_bundle(patch)
        argv = [
            "geography",
            "--levels",
            g.REGION,
            "--years",
            "2026",
            "--manifest",
            str(world.manifest),
            "--out-dir",
            str(world.tmp),
            "--data-inputs-dir",
            str(world.inputs),
        ]
        assert cli.main(argv) == 0
    return world.tmp / "regional.csv"


def test_publish_index_binds_the_table_and_names_the_package(world, capsys):
    """The page shows the package as the catalogue's combined run of
    exactly the displayable measures (combinedId). The table names it by its
    alias in geography.PACKAGES, and area_provenance.json records the
    manifest key each reform stands for, so publish index binds the table
    and gives the page that combined run for the alias."""
    from uk_budget_data.publication.combine import combined_key

    assert published(world) == 0, printed(capsys)
    assert index_reads(world) == ([], {PKG: combined_key(sorted(MEASURES))})


def test_a_regional_table_beside_the_seats_keeps_its_record(
    world, monkeypatch, capsys
):
    """publish index needs one record of every area table present, so the
    run records regional.csv too, as its own run recorded it."""
    from uk_budget_data.publication.combine import combined_key

    regional = regional_run(world, monkeypatch)
    before = regional.read_bytes()
    code = published(world, "--prior-regional", str(regional))
    assert code == 0, printed(capsys)
    assert regional.read_bytes() == before
    # Both tables' SHA-256, and a record of every reform in either
    assert_public_area_output(world.tmp)
    assert index_reads(world) == ([], {PKG: combined_key(sorted(MEASURES))})
    out = printed(capsys)
    assert (
        "for constituency.csv and regional.csv (its record carried from its "
        "own run)"
    ) in out
    assert "records constituency.csv and regional.csv for publish index" in out


@pytest.mark.parametrize(
    ("broken", "message"),
    [
        ("no record", "regional.csv is in {} with no readable"),
        ("other bytes", "does not record regional.csv as it is"),
        (
            "another approval",
            "regional.csv was made for an approval of alpha other than the "
            "one this run binds",
        ),
    ],
)
def test_a_regional_table_not_on_record_is_refused_before_simulating(
    broken, message, world, monkeypatch, capsys
):
    regional = regional_run(world, monkeypatch)
    record = world.tmp / "area_provenance.json"
    if broken == "no record":
        record.unlink()
    elif broken == "other bytes":
        regional.write_bytes(regional.read_bytes() + b"\n")
    else:
        # As if made under an earlier approval of alpha
        document = json.loads(record.read_text())
        document["reforms"]["alpha"]["outputs_sha256"] = "f" * 64
        record.write_text(json.dumps(document))
    assert published(world) == 1
    assert world.steps == [] and world.simulated == []
    assert not (world.tmp / "constituency.csv").exists()
    out = printed(capsys)
    assert message.format(world.tmp) in out
    assert "run its area run again first" in out


def test_a_regional_table_replaced_during_the_run_stops_the_release(
    world, monkeypatch, capsys
):
    regional = regional_run(world, monkeypatch)
    run_process = world.run_process

    def replacing(command, env):
        if "release" in command:
            regional.write_bytes(regional.read_bytes() + b"\n")
        return run_process(command, env)

    monkeypatch.setattr(c, "run_process", replacing)
    assert published(world) == 1
    assert world.steps == [*MEASURES, PKG, "release"]
    assert not (world.tmp / "constituency.csv").exists()
    assert "does not record regional.csv as it is" in printed(capsys)


def test_a_reform_unlike_its_approved_receipt_is_refused_before_simulating(
    world, capsys
):
    from uk_budget_data.models import Reform

    # alpha, changed since it was approved
    world.reforms["alpha"] = Reform(
        id="alpha",
        name="alpha",
        parameter_changes={LIMITED_RATE: {"2026": 10}},
    )
    assert world.run() == 1
    assert world.steps == [] and world.simulated == []
    assert (
        "alpha: current reform identity differs from the approved receipt"
    ) in printed(capsys)


def test_on_modal_a_regional_table_beside_the_seats_keeps_its_record(
    world, monkeypatch, tmp_path, capsys
):
    """The Modal route writes area_provenance.json on this machine too,
    carrying the regional run's record: the release's container is never
    sent the provenance."""
    from uk_budget_data import modal_constituencies_runner as runner
    from uk_budget_data.publication.combine import combined_key

    regional = regional_run(world, monkeypatch)
    before = regional.read_bytes()
    fake = FakeModalSession(world, tmp_path / "volume")
    real_execute = runner.execute
    monkeypatch.setattr(
        runner,
        "execute",
        lambda *args, **kwargs: real_execute(*args, session=fake, **kwargs),
    )
    code = published(
        world, "--backend", "modal", "--prior-regional", str(regional)
    )
    assert code == 0, printed(capsys)
    assert world.steps == []
    assert regional.read_bytes() == before
    assert_public_area_output(world.tmp)
    assert index_reads(world) == ([], {PKG: combined_key(sorted(MEASURES))})
    assert "records constituency.csv and regional.csv for publish index" in (
        printed(capsys)
    )
