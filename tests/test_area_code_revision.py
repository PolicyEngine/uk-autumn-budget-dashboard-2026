"""Area runs across the commits that follow an approval (#104 round 4).

A code-bound measure's identity includes the commit its receipt was made at,
as well as its modifier's module source. Committing the measure's
attestation, or the published artifacts, moves HEAD. So the area guard
recomputes identities at the approved commit, but only when HEAD descends
from it and nothing committed since could change a calculation.
"""

import functools
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests import fixed_shape_measures
from tests.publication_support import (
    BASIS,
    RATE_PATH,
    World,
    make_household_rows,
    make_tables,
)
from uk_budget_data import constituencies, sign_off
from uk_budget_data import geography as g
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import attestations as a
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import receipt as r
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.combine import combined_key
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import approve, stage

YEARS = [2027]
PACKAGES = {"pkg": ("alpha", "beta")}
DEFINITIONS = {
    # Hand-written and code-bound, so it needs a two-person attestation.
    "alpha": Reform(
        id="alpha",
        name="Alpha",
        simulation_modifier=fixed_shape_measures.module_level_modifier,
    ),
    "beta": Reform(
        id="beta",
        name="Beta",
        parameter_changes={RATE_PATH: {"2027": 0.22}},
    ),
}


def git(repo: Path, *arguments: str) -> str:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("GIT_")
    }
    return subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Area tests",
            "-c",
            "user.email=area@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.hooksPath=/dev/null",
            *arguments,
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    ).stdout.strip()


def new_repository(root: Path) -> Path:
    root.mkdir(parents=True)
    git(root, "init", "-q")
    return root


def commit(repo: Path, files: dict[str, str], message="Change") -> str:
    for name, text in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    git(repo, "add", "--", *files)
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def attestation_record(document: dict) -> dict:
    return {
        "measure_id": document["dashboard"]["key"],
        "receipt_sha256": a.receipt_document_sha256(document),
        "reason": "The modifier changes nothing the data limit covers.",
        "checker": "First reviewer",
        "second": "Second reviewer",
        "released_at": "2026-10-25T09:00:00Z",
    }


@pytest.fixture(scope="module")
def approved(tmp_path_factory):
    """alpha, beta and their package: generated at commit A, attested at
    commit B, then staged and approved, as on Budget day."""
    repo = new_repository(tmp_path_factory.mktemp("area") / "repo")
    generated = commit(
        repo,
        {
            "README.md": "Dashboard\n",
            "uv.lock": "lock\n",
            "pyproject.toml": "[project]\n",
            "src/uk_budget_data/reforms.py": "MEASURES = {}\n",
            "src/App.jsx": "export default function App() {}\n",
            "data_inputs/regions.csv": "region\n",
        },
        "Generate",
    )
    world = World()
    patch = pytest.MonkeyPatch()
    # The attestation commits are the commits after an approval that this
    # module is about, so sign-off is on, as on Budget day.
    patch.setattr(sign_off, "REQUIRED", True)
    attestations = repo / "data_inputs" / "publication" / "attestations"
    patch.setattr(a, "ATTESTATIONS_ROOT", attestations)
    patch.setattr(a, "ATTESTATION_REPOSITORY", repo)
    try:
        revision = r.code_revision(repo)
        assert revision == r.CodeRevision(generated, True)
        config = DataConfig(years=YEARS)
        references, records = {}, {}
        for key, definition in DEFINITIONS.items():
            baseline, reform = r.measure_identities(
                definition, config, revision
            )
            references[key] = world.ready(
                key,
                {2027: -1.0},
                git_sha=generated,
                baseline_identity=baseline,
                reform_identity=reform,
                modifier_templates=r.template_proof.measure_templates_proof(
                    definition, config, revision
                ),
            )
            receipt = read_receipt(references[key].path)
            records[key] = {
                "id": key,
                "baseline": receipt["execution_receipt"]["baseline"],
                "reform": receipt["execution_receipt"]["reform"],
                "outputs_sha256": receipt["dashboard"]["digests"][
                    "outputs_sha256"
                ],
            }
        members = sorted(PACKAGES["pkg"])
        package = combined_key(members)
        references[package] = world.write(
            package,
            {2027: -2.0},
            git_sha=generated,
            members=[
                {
                    field: records[member][field]
                    for field in ("id", "baseline", "reform")
                }
                for member in members
            ],
            measure_ids=members,
            member_outputs={
                member: records[member]["outputs_sha256"] for member in members
            },
        )
        world.reconcile(references[package])
        attested = {}
        for key, reference in references.items():
            document = read_receipt(reference.path)
            if a.requires_attestation(document):
                attested[f"{attestations.relative_to(repo)}/{key}.json"] = (
                    json.dumps(attestation_record(document))
                )
        assert sorted(attested) == [
            "data_inputs/publication/attestations/alpha.json",
            f"data_inputs/publication/attestations/{package}.json",
        ]
        head = commit(repo, attested, "Attest alpha and its package")
        manifest = m.Manifest()
        args = dict(data_root=world.data_root, inputs=world.inputs)
        for key, reference in references.items():
            stage(manifest, reference.path, **args)
            approve(manifest, key, "Reviewer", **args)
        yield SimpleNamespace(
            repo=repo,
            branch=git(repo, "symbolic-ref", "--short", "HEAD"),
            generated=generated,
            head=head,
            manifest=manifest,
            manifest_bytes=manifest.model_dump_json(by_alias=True).encode(),
            world=world,
        )
    finally:
        patch.undo()
        world.close()


@pytest.fixture
def state(approved):
    """The approved world, with its repository put back after each test."""
    yield approved
    git(approved.repo, "checkout", "-q", "-f", approved.branch)
    git(approved.repo, "reset", "-q", "--hard", approved.head)
    git(approved.repo, "clean", "-q", "-fdx")


def run_area(state, monkeypatch, reform_ids=("alpha", "beta", "pkg")):
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    monkeypatch.setattr(
        g,
        "simulate_reform",
        Mock(side_effect=AssertionError("simulation must not start")),
    )
    return g.area_provenance(
        state.manifest,
        state.manifest_bytes,
        list(reform_ids),
        data_root=state.world.data_root,
        years=YEARS,
    )


def test_attested_measures_and_packages_run_after_the_attestation_commit(
    state, monkeypatch
):
    """Review of 62febdd, finding 1: staging needs the attestation committed,
    which moves HEAD past the commit the receipt was made at."""
    assert state.head != state.generated
    provenance = run_area(state, monkeypatch)
    assert sorted(provenance["reforms"]) == ["alpha", "beta", "pkg"]
    for reform_id in ("alpha", "pkg"):
        record = provenance["reforms"][reform_id]
        assert record["reform"]["binding"] == "code_revision"


@pytest.mark.parametrize(
    "path",
    [
        "docs/budget-day-runbook.md",
        "README.md",
        "src/components/MeasureCard.jsx",
        "src/test/fixtures/flat/metrics.csv",
        "public/data/manifest.json",
        "public/data/artifacts/alpha/receipt.json",
        "data_inputs/public_data_review.csv",
        "data_inputs/treasury/sources/AB2026-T4.1.csv",
        "data_inputs/treasury/mapping.csv",
        "data_inputs/treasury/exceptions.yaml",
    ],
)
def test_later_page_docs_and_publication_commits_do_not_block(
    state, monkeypatch, path
):
    commit(state.repo, {path: f"changed {path}\n"})
    run_area(state, monkeypatch)


@pytest.mark.parametrize(
    "path",
    [
        "src/uk_budget_data/reforms.py",
        "src/uk_budget_data/budget_measures/road_fuel_vat_cut.py",
        "uv.lock",
        "pyproject.toml",
        "data_inputs/regions.csv",
        "tests/conftest.py",
        "scripts/generate.sh",
        ".github/workflows/ci.yml",
    ],
)
@pytest.mark.parametrize("reform_id", ["alpha", "pkg"])
def test_a_later_calculation_commit_refuses_code_bound_scenarios(
    state, monkeypatch, path, reform_id
):
    commit(state.repo, {path: f"changed {path}\n"})
    with pytest.raises(ValueError, match=re.escape(path)) as refused:
        run_area(state, monkeypatch, [reform_id])
    assert str(refused.value).startswith(f"{reform_id}: ")
    assert "regenerate and approve" in str(refused.value)


def test_a_content_bound_measure_does_not_depend_on_the_commit(
    state, monkeypatch
):
    """Intended: a parameter-only measure's identity is its content, so a
    later code commit leaves its approval in force, as before."""
    commit(state.repo, {"src/uk_budget_data/reforms.py": "MEASURES = {1}\n"})
    run_area(state, monkeypatch, ["beta"])


def test_a_deleted_calculation_file_refuses(state, monkeypatch):
    (state.repo / "docs").mkdir()
    git(state.repo, "mv", "src/uk_budget_data/reforms.py", "docs/reforms.py")
    git(state.repo, "commit", "-q", "-m", "Move code into docs")
    with pytest.raises(ValueError, match="src/uk_budget_data/reforms.py"):
        run_area(state, monkeypatch, ["alpha"])


def test_an_approval_from_another_history_is_refused(state, monkeypatch):
    git(state.repo, "checkout", "-q", "--orphan", "elsewhere")
    git(state.repo, "commit", "-q", "-m", "The same files, unrelated")
    with pytest.raises(ValueError, match="alpha: .*not an ancestor of HEAD"):
        run_area(state, monkeypatch, ["alpha"])


def test_uncommitted_calculation_code_is_still_refused(state, monkeypatch):
    (state.repo / "src" / "uk_budget_data" / "new.py").write_text("x = 1\n")
    with pytest.raises(ValueError, match="alpha: current .* not committed"):
        run_area(state, monkeypatch, ["alpha"])


# --- the documented order: G2, attestation, G4 (review of 428d209, 1) ---

PACKAGE = combined_key(sorted(PACKAGES["pkg"]))
VALUES = {"alpha": {2027: -1.0}, "beta": {2027: -0.5}, PACKAGE: {2027: -1.5}}


def fake_process(reform, config, baseline, reformed, baseline_scenario):
    """The tables the calculators would return, without simulating."""
    values = VALUES[reform.id]
    tables = make_tables(reform.id, values, reform.name)
    tables.pop("household_scatter_binned")
    return ReformResult(
        household_scatter=make_household_rows(reform.id, values, reform.name),
        reform_id=reform.id,
        reform_name=reform.name,
        constituency=[],
        demographic_constituency=[],
        **tables,
    )


def generate(world, repo, reforms=(), combined=None):
    """``uk-budget-data generate --artifacts``, at the repository's HEAD."""
    return generate_artifacts(
        list(reforms),
        DataConfig(years=YEARS),
        combined_sets=combined,
        artifacts_root=world.artifacts,
        repo_root=repo,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process,
    )


def written(world, report, key):
    assert key not in report.refused, report.refused
    (reference,) = [ref for ref in report.written if ref.key == key]
    world.costing(key, VALUES[key])
    world.reconcile(reference)
    return reference


@pytest.fixture(scope="module")
def documented(tmp_path_factory):
    """The runbook's order: each measure generated alone (G2), the
    hand-written one's attestation committed, both staged, a docs commit,
    then the package generated (G4), attested, staged and every entry
    approved."""
    repo = new_repository(tmp_path_factory.mktemp("documented") / "repo")
    generated = commit(
        repo,
        {
            "README.md": "Dashboard\n",
            "uv.lock": "lock\n",
            "src/uk_budget_data/reforms.py": "MEASURES = {}\n",
            "data_inputs/publication_basis.json": json.dumps(BASIS),
        },
        "Code the measures",
    )
    world = World()
    patch = pytest.MonkeyPatch()
    # The attestation commits are the commits after an approval that this
    # module is about, so sign-off is on, as on Budget day.
    patch.setattr(sign_off, "REQUIRED", True)
    attestations = repo / "data_inputs" / "publication" / "attestations"
    patch.setattr(a, "ATTESTATIONS_ROOT", attestations)
    patch.setattr(a, "ATTESTATION_REPOSITORY", repo)
    folder = attestations.relative_to(repo)
    args = dict(data_root=world.data_root, inputs=world.inputs)
    try:
        # G2: a hand-written modifier is generated alone, in its own call.
        alpha = written(
            world, generate(world, repo, [DEFINITIONS["alpha"]]), "alpha"
        )
        beta = written(
            world, generate(world, repo, [DEFINITIONS["beta"]]), "beta"
        )
        alpha_document = read_receipt(alpha.path)
        assert a.requires_attestation(alpha_document)
        assert alpha_document["dashboard"]["git_sha"] == generated
        attested = commit(
            repo,
            {
                f"{folder}/alpha.json": json.dumps(
                    attestation_record(alpha_document)
                )
            },
            "Attest alpha",
        )
        manifest = m.Manifest()
        stage(manifest, alpha.path, **args)
        stage(manifest, beta.path, **args)
        m.save_manifest(manifest, world.data_root)
        later = commit(
            repo, {"docs/budget-day-runbook.md": "Notes\n"}, "Runbook"
        )
        # G4: the package, generated after every member is staged.
        report = generate(
            world,
            repo,
            combined=[[DEFINITIONS["alpha"], DEFINITIONS["beta"]]],
        )
        package = written(world, report, PACKAGE)
        package_document = read_receipt(package.path)
        assert package_document["dashboard"]["git_sha"] == later
        head = commit(
            repo,
            {
                f"{folder}/{PACKAGE}.json": json.dumps(
                    attestation_record(package_document)
                )
            },
            "Attest the package",
        )
        stage(manifest, package.path, **args)
        for key in ("alpha", "beta", PACKAGE):
            approve(manifest, key, "Reviewer", **args)
        m.save_manifest(manifest, world.data_root)
        yield SimpleNamespace(
            repo=repo,
            branch=git(repo, "symbolic-ref", "--short", "HEAD"),
            generated=generated,
            attested=attested,
            head=head,
            manifest=manifest,
            manifest_bytes=manifest.model_dump_json(by_alias=True).encode(),
            world=world,
            alpha=alpha_document,
            package=package_document,
        )
    finally:
        patch.undo()
        world.close()


@pytest.fixture
def documented_state(documented):
    yield documented
    git(documented.repo, "checkout", "-q", "-f", documented.branch)
    git(documented.repo, "reset", "-q", "--hard", documented.head)
    git(documented.repo, "clean", "-q", "-fdx")


def test_a_package_generated_after_the_attestation_commit_stages(documented):
    """Generated at a later commit than its hand-written member, the package
    records that member exactly as the member's own receipt binds it, so
    staging and approval accept it (the fixture approved every entry)."""
    (member,) = [
        record
        for record in documented.package["dashboard"]["members"]
        if record["id"] == "alpha"
    ]
    own = documented.alpha["execution_receipt"]["reform"]
    assert member["reform"]["binding"] == "code_revision"
    for field in ("kind", "representation", "reform_sha256", "binding"):
        assert member["reform"][field] == own[field]
    statuses = {
        key: entry.status
        for key, entry in documented.manifest.entries().items()
    }
    assert statuses == {key: m.APPROVED for key in ("alpha", "beta", PACKAGE)}


@pytest.mark.slow
def test_a_package_whose_member_is_bound_earlier_runs_in_worker_processes(
    documented_state, tmp_path
):
    """``--jobs 2`` (#173) on the forkserver process runner, at a later
    commit than alpha's receipt. The package's run carries the commit each
    staged member is bound at to the worker, which recomputes its
    identities there: without them it would refuse the run. The worker's
    package binds alpha as alpha's own receipt does, so staging's member
    check accepts it, and its artifact is a serial run's."""
    from tests import parallel_helpers
    from tests.test_parallel import _artifacts, _worker_runner
    from uk_budget_data.parallel import SerialRunner
    from uk_budget_data.publication.publish import _members_problems

    world = documented_state.world
    values = {PACKAGE: VALUES[PACKAGE]}

    def run(name, runner, build):
        # A copy of the data root each, so the fixture's stays as it was.
        data_root = tmp_path / name / "data"
        shutil.copytree(world.data_root, data_root)
        report = generate_artifacts(
            [],
            DataConfig(years=YEARS),
            combined_sets=[[DEFINITIONS["alpha"], DEFINITIONS["beta"]]],
            artifacts_root=data_root
            / world.artifacts.relative_to(world.data_root),
            repo_root=documented_state.repo,
            generator_argv=["test"],
            build=build,
            process=functools.partial(parallel_helpers.fake_process, values),
            runner=runner,
        )
        assert report.refused == {}, report.refused
        assert [reference.key for reference in report.written] == [PACKAGE]
        return report, data_root

    serial, _ = run(
        "serial", SerialRunner(), lambda dataset, scenario=None: world.sim()
    )
    workers, data_root = run(
        "workers",
        _worker_runner(),
        functools.partial(parallel_helpers.world_sim, str(world.root)),
    )
    document = read_receipt(workers.written[0].path)
    assert document["dashboard"]["git_sha"] == documented_state.head
    assert documented_state.alpha["dashboard"]["git_sha"] == (
        documented_state.generated
    )
    (member,) = [
        record
        for record in document["dashboard"]["members"]
        if record["id"] == "alpha"
    ]
    own = documented_state.alpha["execution_receipt"]["reform"]
    assert member["reform"]["binding"] == "code_revision"
    for field in ("kind", "representation", "reform_sha256", "binding"):
        assert member["reform"][field] == own[field]
    assert (
        _members_problems(
            document, documented_state.manifest, data_root, (m.APPROVED,)
        )
        == []
    )
    assert _artifacts(workers.written) == _artifacts(serial.written)


def test_the_documented_order_reaches_results_by_area(
    documented_state, monkeypatch
):
    provenance = run_area(documented_state, monkeypatch)
    assert sorted(provenance["reforms"]) == ["alpha", "beta", "pkg"]


def test_a_package_whose_code_bound_member_has_no_entry_is_refused(
    documented_state, monkeypatch
):
    """The member's own receipt names the commit to bind it at, so without
    its manifest entry the package cannot be checked."""
    manifest = documented_state.manifest.model_copy(deep=True)
    del manifest.measures["alpha"]
    state = SimpleNamespace(**{**vars(documented_state), "manifest": manifest})
    with pytest.raises(
        ValueError, match="pkg member alpha: no manifest entry"
    ):
        run_area(state, monkeypatch, ["pkg"])


@pytest.mark.parametrize(
    "path",
    ["src/uk_budget_data/budget_measures/road_fuel_vat_cut.py", "uv.lock"],
)
def test_a_package_is_refused_when_its_member_s_code_changed(
    documented_state, path
):
    """A calculation commit after the member's receipt: the package cannot
    bind that member, so generation refuses it, naming the member and the
    path, before simulating."""
    commit(documented_state.repo, {path: f"changed {path}\n"})
    report = generate(
        documented_state.world,
        documented_state.repo,
        combined=[[DEFINITIONS["alpha"], DEFINITIONS["beta"]]],
    )
    assert report.written == []
    assert "alpha" in report.refused[PACKAGE]
    assert path in report.refused[PACKAGE]


@pytest.mark.parametrize(
    "path",
    [
        "data_inputs/treasury/sources/AB2026-T4.1.csv",
        "data_inputs/treasury/mapping.csv",
        "data_inputs/treasury/exceptions.yaml",
    ],
)
def test_a_package_generated_after_the_treasury_entry_binds_its_member(
    documented_state, path
):
    """Budget day's order: the members are generated at G2, the Treasury
    entry, mapping and exceptions are committed at G3, and the package is
    generated at G4. Reconciliation inputs change no calculation, so the
    package binds its hand-written member at the member's own commit, as
    staging requires (rehearsal of 26 October)."""
    commit(documented_state.repo, {path: f"changed {path}\n"})
    report = generate(
        documented_state.world,
        documented_state.repo,
        combined=[[DEFINITIONS["alpha"], DEFINITIONS["beta"]]],
    )
    assert PACKAGE not in report.refused, report.refused
    (package,) = [ref for ref in report.written if ref.key == PACKAGE]
    (member,) = [
        record
        for record in read_receipt(package.path)["dashboard"]["members"]
        if record["id"] == "alpha"
    ]
    own = documented_state.alpha["execution_receipt"]["reform"]
    assert member["reform"]["binding"] == "code_revision"
    for field in ("kind", "representation", "reform_sha256", "binding"):
        assert member["reform"][field] == own[field]


def test_a_package_is_refused_when_its_member_s_receipt_is_not_its_entry_s(
    documented_state,
):
    """Review of 15439f4, finding 5: generation read a member's receipt
    without checking it against the member's manifest entry, as the area
    run does. A receipt edited to name a later commit with no calculation
    change since would be bound there; now it is refused before
    simulating."""
    world = documented_state.world
    entry = documented_state.manifest.measures["alpha"]
    path = world.data_root / entry.artifact / "receipt.json"
    original = path.read_bytes()
    edited = json.loads(original)
    edited["dashboard"]["git_sha"] = documented_state.attested
    try:
        path.write_text(json.dumps(edited))
        report = generate(
            world,
            documented_state.repo,
            combined=[[DEFINITIONS["alpha"], DEFINITIONS["beta"]]],
        )
    finally:
        path.write_bytes(original)
    assert report.written == []
    assert "member alpha" in report.refused[PACKAGE]
    assert "artifact identity differs" in report.refused[PACKAGE]


# --- the allowlist, over generated commits ----------------------------

NAME = st.from_regex(r"[a-z0-9é][a-z0-9_ é-]{0,9}", fullmatch=True)
FRONTEND = st.sampled_from(r.FRONTEND_SUFFIXES)
ALLOWED = st.one_of(
    NAME.map("data_inputs/publication/attestations/{}.json".format),
    st.builds("public/data/{}.csv".format, NAME),
    st.builds("public/assets/{}/{}.png".format, NAME, NAME),
    st.just("data_inputs/public_data_review.csv"),
    st.builds(
        "data_inputs/treasury/{}{}".format,
        st.sampled_from(["", "sources/"]),
        st.builds("{}{}".format, NAME, st.sampled_from(r.TREASURY_SUFFIXES)),
    ),
    st.builds("docs/{}/{}.md".format, NAME, NAME),
    NAME.map("{}.md".format),
    st.builds(
        "src/{}{}{}".format,
        st.sampled_from(["", "components/", "hooks/", "test/fixtures/"]),
        NAME,
        FRONTEND,
    ),
)
REFUSED = st.one_of(
    st.builds("src/uk_budget_data/{}{}".format, NAME, st.just(".py")),
    st.builds("src/uk_budget_data/{}/{}.json".format, NAME, NAME),
    st.sampled_from(
        ["pyproject.toml", "uv.lock", "Dockerfile", "Makefile", "bun.lock"]
    ),
    # Only the Treasury inputs' own formats: code there is still code.
    st.builds(
        "data_inputs/treasury/{}{}".format,
        NAME,
        st.sampled_from([".py", ".json", ".txt", ".CSV"]),
    ),
    NAME.filter(lambda name: name != "public_data_review").map(
        "data_inputs/{}.csv".format
    ),
    st.builds(
        "data_inputs/publication/attestations/{}/{}.json".format, NAME, NAME
    ),
    NAME.map("data_inputs/publication/attestations/{}.yaml".format),
    st.builds("tests/{}.py".format, NAME),
    st.builds("scripts/{}.sh".format, NAME),
    st.builds(".github/workflows/{}.yml".format, NAME),
    st.builds("src/{}.py".format, NAME),
    NAME.map("{}.txt".format),
    # Review of 428d209: Python is code even under public/ and docs/
    st.builds(
        "{}/{}/{}{}".format,
        st.sampled_from(["public", "docs"]),
        NAME,
        NAME,
        st.sampled_from([".py", ".pyc", ".PY"]),
    ),
)


def tagged(allowed, refused):
    return st.one_of(
        allowed.map(lambda path: (path, True)),
        refused.map(lambda path: (path, False)),
    )


def no_nesting(items):
    """Paths a filesystem can hold at once: none is a directory of another,
    even ignoring case (macOS)."""
    folded = [path.casefold() for path, _ in items]
    return not any(
        other.startswith(path + "/") for path in folded for other in folded
    )


@given(path=tagged(ALLOWED, REFUSED))
@settings(max_examples=300, deadline=None)
def test_only_listed_non_calculation_paths_are_allowed(path):
    path, allowed = path
    assert r.is_non_calculation_path(path) is allowed


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/docs/notes.md",
        "docs/../src/uk_budget_data/reforms.py",
        "public/./data/x.csv",
        "docs//notes.md",
        "src/UK_Budget_Data/rates.json",
        "src/uk_budget_data",
        "public",
        "data_inputs/publication/attestations/.json/x",
        "data_inputs/treasury",
        "data_inputs/treasury/sources",
        "data_inputs/treasury/../regions.csv",
        "data_inputs/Treasury/mapping.csv",
    ],
)
def test_odd_paths_are_calculation_paths(path):
    assert not r.is_non_calculation_path(path)


@given(
    items=st.lists(
        tagged(ALLOWED, REFUSED),
        min_size=1,
        max_size=6,
        unique_by=lambda item: item[0].casefold(),
    ).filter(no_nesting)
)
@settings(max_examples=25, deadline=None)
def test_the_guard_accepts_exactly_commits_that_change_no_calculation(items):
    with tempfile.TemporaryDirectory() as directory:
        repo = new_repository(Path(directory) / "repo")
        approved_sha = commit(repo, {"base": "base\n"})
        commit(repo, {path: f"changed {path}\n" for path, _ in items})
        expected = sorted(path for path, allowed in items if not allowed)
        changes = r.calculation_changes_since(approved_sha, repo)
        assert changes == expected
        assert (changes == []) is all(allowed for _, allowed in items)


@given(sha=st.from_regex(r"[0-9a-f]{40}", fullmatch=True))
@settings(max_examples=10, deadline=None)
def test_a_commit_head_does_not_descend_from_is_refused(sha):
    with tempfile.TemporaryDirectory() as directory:
        repo = new_repository(Path(directory) / "repo")
        base = commit(repo, {"base": "base\n"})
        git(repo, "checkout", "-q", "-b", "side")
        sibling = commit(repo, {"docs/side.md": "side\n"})
        git(repo, "checkout", "-q", "-")
        commit(repo, {"docs/main.md": "main\n"})
        assert r.calculation_changes_since(base, repo) == []
        for unrelated in {sha, sibling} - {base}:
            with pytest.raises(ValueError, match="not an ancestor of HEAD"):
                r.calculation_changes_since(unrelated, repo)


@pytest.mark.parametrize(
    "sha", [None, "", "abc123", "A" * 40, "--all", "HEAD", "a" * 39]
)
def test_a_receipt_without_a_full_commit_sha_is_refused(sha, tmp_path):
    repo = new_repository(tmp_path / "repo")
    commit(repo, {"base": "base\n"})
    with pytest.raises(ValueError, match="full commit sha"):
        r.calculation_changes_since(sha, repo)


# --- results by area survive a national rerun (area_provenance v2) ---------

from uk_budget_data.publication import area_code  # noqa: E402
from uk_budget_data.publication import release_index as ri  # noqa: E402

AREA_HEADER = (
    "level,area_code,area_name,reform,year,outcome,value,lo,hi,direction,"
    "tier,reason,support_band,noise,estimator\n"
)


@pytest.fixture
def bound(state, monkeypatch):
    """An area run over alpha (code-bound) and beta (content-bound) at the
    attestation commit, its table and v2 record beside the manifest, and
    a copy of the manifest to rerun nationally."""
    # Another module fixture (documented) may have pointed these elsewhere
    monkeypatch.setattr(sign_off, "REQUIRED", True)
    monkeypatch.setattr(
        a,
        "ATTESTATIONS_ROOT",
        state.repo / "data_inputs" / "publication" / "attestations",
    )
    monkeypatch.setattr(a, "ATTESTATION_REPOSITORY", state.repo)
    provenance = run_area(state, monkeypatch, ["alpha", "beta"])
    # The module's manifest is never saved, so its revision is 0
    provenance["manifest_revision"] = 1
    provenance["run"]["dataset"] = {
        "kind": "local_area_cut",
        "name": "synthetic-cut",
        "sha256": "9" * 64,
    }
    # The installed bundle routes constituencies to that cut
    monkeypatch.setattr(
        constituencies,
        "bundle_pin",
        lambda: {"revision": "synthetic-cut", "sha256": "9" * 64},
    )
    root = state.world.data_root
    table = root / "regional.csv"
    table.write_text(
        AREA_HEADER
        + "".join(
            f"region,E12000001,Area,{reform},2027,relative_change,0.01,"
            "0.005,0.015,gain,reported,,30+,False,direct\n"
            for reform in ("alpha", "beta")
        )
    )
    ri.write_area_provenance(root, provenance, [table])
    manifest = state.manifest.model_copy(deep=True)
    yield SimpleNamespace(
        manifest=manifest, files={"regional.csv": table.read_bytes()}
    )
    for name in ("regional.csv", ri.AREA_PROVENANCE_FILE):
        (root / name).unlink(missing_ok=True)


def gate(state, bound):
    return ri.area_problems(
        bound.manifest,
        bound.files,
        state.world.data_root,
        code_root=state.repo,
    )[0]


def rerun_nationally(state, manifest, key, values=None, definition=None):
    """Generate ``key`` again at HEAD, attest it if it needs it, and stage
    and approve it: a national rerun, as #320's was."""
    definition = definition or DEFINITIONS[key]
    revision = r.code_revision(state.repo)
    config = DataConfig(years=YEARS)
    baseline, reform = r.measure_identities(definition, config, revision)
    reference = state.world.ready(
        key,
        values or {2027: -3.0},
        git_sha=revision.git_sha,
        baseline_identity=baseline,
        reform_identity=reform,
        modifier_templates=r.template_proof.measure_templates_proof(
            definition, config, revision
        ),
    )
    document = read_receipt(reference.path)
    if a.requires_attestation(document):
        commit(
            state.repo,
            {
                f"data_inputs/publication/attestations/{key}.json": json.dumps(
                    attestation_record(document)
                )
            },
            f"Attest {key} again",
        )
    args = dict(data_root=state.world.data_root, inputs=state.world.inputs)
    stage(manifest, reference.path, **args)
    approve(manifest, key, "Reviewer", **args)
    return document


def test_the_area_record_binds_definitions_not_commits(state, bound):
    document = json.loads(
        (state.world.data_root / ri.AREA_PROVENANCE_FILE).read_bytes()
    )
    assert document["schema"] == ri.AREA_PROVENANCE_SCHEMA
    assert document["runs"]["regional.csv"]["git_sha"] == state.head
    alpha, beta = document["reforms"]["alpha"], document["reforms"]["beta"]
    # Content-bound: the definition is the identity's own digest
    assert beta["definition"]["reform"] == beta["reform"]["reform_sha256"]
    # Code-bound: the identity includes the commit, the definition doesn't
    assert alpha["reform"]["binding"] == "code_revision"
    assert alpha["definition"]["reform"] != alpha["reform"]["reform_sha256"]
    assert gate(state, bound) == []


@pytest.mark.parametrize("key", ["alpha", "beta"])
def test_a_national_rerun_with_the_same_definitions_keeps_the_map(
    state, bound, monkeypatch, key
):
    """#320: a national rerun added a table and changed no area figure. The
    artifact, receipt, outputs and (for a code-bound measure) the reform
    digest all change; the definitions and the area code don't."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    before = bound.manifest.measures[key].model_copy()
    # The national pipeline changes, outside the area code
    commit(
        state.repo,
        {
            "src/uk_budget_data/calculators.py": "OFFICIAL_BASES = {}\n",
            "src/uk_budget_data/publication/tables.py": "TABLES = ()\n",
        },
        "Add the official-basis table",
    )
    document = rerun_nationally(state, bound.manifest, key)
    after = bound.manifest.measures[key]
    assert after.artifact_sha256 != before.artifact_sha256
    assert after.outputs_sha256 != before.outputs_sha256
    assert document["dashboard"]["git_sha"] != state.head
    assert gate(state, bound) == []


def test_a_changed_reform_definition_refuses_the_map(
    state, bound, monkeypatch
):
    """beta's rate changes and it is rerun and approved nationally: the
    current receipt's definition is no longer the area run's."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    changed = DEFINITIONS["beta"].model_copy(
        update={"parameter_changes": {RATE_PATH: {"2027": 0.25}}}
    )
    definitions = {**DEFINITIONS, "beta": changed}
    monkeypatch.setattr(g, "get_reform", definitions.get)
    rerun_nationally(state, bound.manifest, "beta", definition=changed)
    problems = gate(state, bound)
    assert any(
        "beta approved receipt identity differs" in problem
        for problem in problems
    ), problems


def test_a_changed_definition_in_the_code_refuses_the_map(
    state, bound, monkeypatch
):
    """The code at HEAD defines beta otherwise than the area run did, even
    before a national rerun."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    changed = DEFINITIONS["beta"].model_copy(
        update={"parameter_changes": {RATE_PATH: {"2027": 0.25}}}
    )
    monkeypatch.setattr(g, "get_reform", {**DEFINITIONS, "beta": changed}.get)
    problems = gate(state, bound)
    assert any("beta's definition changed" in p for p in problems), problems


@pytest.mark.parametrize(
    "path",
    [
        "src/uk_budget_data/geography.py",
        "src/uk_budget_data/budget_measures/road_fuel_vat_cut.py",
        "src/uk_budget_data/reforms.py",
        "src/uk_budget_data/forecast/__init__.py",
        "src/uk_budget_data/publication/combine.py",
        "data_inputs/regions.csv",
        "uv.lock",
    ],
)
def test_a_changed_area_relevant_file_refuses_the_map(
    state, bound, monkeypatch, path
):
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    commit(state.repo, {path: f"changed {path}\n"})
    problems = gate(state, bound)
    assert any(
        "changed since its area run's commit" in p and path in p
        for p in problems
    ), problems


def test_an_uncommitted_area_change_refuses_the_map(state, bound, monkeypatch):
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    (state.repo / "src" / "uk_budget_data" / "geography.py").write_text("x\n")
    assert any("geography.py" in p for p in gate(state, bound))


def test_area_code_between_the_area_run_and_the_approved_receipt_counts(
    state, bound, monkeypatch
):
    """The area code changed, beta was rerun nationally on it, and the
    change was reverted: HEAD matches the area run, but the national
    figures were made with other area code."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    path = "src/uk_budget_data/measure_templates.py"
    commit(state.repo, {path: "TEMPLATES = 1\n"}, "Change a template")
    rerun_nationally(state, bound.manifest, "beta")
    git(state.repo, "rm", "-q", path)
    git(state.repo, "commit", "-q", "-m", "Revert it")
    problems = gate(state, bound)
    assert any(
        "made with other area code" in p and path in p for p in problems
    ), problems


def test_a_cut_the_bundle_does_not_route_to_refuses_the_map(
    state, bound, monkeypatch
):
    """María, #362: the constituency run accepts --cut for a cut the bundle
    does not route to; publish index must compare the recorded dataset with
    what the bundle routes now."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    assert gate(state, bound) == []
    monkeypatch.setattr(
        constituencies,
        "bundle_pin",
        lambda: {"revision": "another-cut", "sha256": "8" * 64},
    )
    problems = gate(state, bound)
    assert any(
        "synthetic-cut" in p and "routes constituencies to another-cut" in p
        for p in problems
    ), problems
    monkeypatch.setattr(constituencies, "bundle_pin", lambda: None)
    assert any("no cut" in p for p in gate(state, bound))


@pytest.mark.parametrize(
    "dataset, refused",
    [
        # A bundle dataset, by name, with the bundle's SHA-256
        ({"name": "repo/microcosm", "sha256": "1" * 64}, False),
        # A local copy of a certified dataset, by SHA-256
        ({"name": "microcosm.h5", "sha256": "1" * 64}, False),
        # The bundle's name, other bytes
        ({"name": "repo/microcosm", "sha256": "2" * 64}, True),
        # A file the bundle does not certify
        ({"name": "export.h5", "sha256": "3" * 64}, True),
        ({"name": "export.h5", "sha256": None}, True),
    ],
)
def test_an_area_run_s_dataset_must_be_one_the_bundle_certifies(
    monkeypatch, dataset, refused
):
    monkeypatch.setattr(
        g, "certified_datasets", lambda: {"repo/microcosm": "1" * 64}
    )
    problem = ri._dataset_problem(
        "regional.csv", {"kind": "microcosm", **dataset}
    )
    assert bool(problem) is refused, problem


def test_a_v1_record_still_binds_under_the_old_rule(state, bound, monkeypatch):
    """The record published before v2: accepted while every entry is the
    one it was made beside, and refused by the first national rerun."""
    monkeypatch.chdir(state.repo)
    monkeypatch.setattr(g, "get_reform", DEFINITIONS.get)
    monkeypatch.setattr(g, "PACKAGES", PACKAGES)
    path = state.world.data_root / ri.AREA_PROVENANCE_FILE
    document = json.loads(path.read_bytes())
    document["schema"] = ri.AREA_PROVENANCE_SCHEMA_V1
    del document["runs"]
    for record in document["reforms"].values():
        del record["definition"]
    path.write_text(json.dumps(document))
    assert gate(state, bound) == []
    rerun_nationally(state, bound.manifest, "beta")
    problems = gate(state, bound)
    assert any("made for an earlier" in p for p in problems), problems


PIPELINE = '''"""The pipeline."""
import policyengine as pe
from uk_budget_data.calculators import {imports}


def build_microsimulation(dataset_path, scenario=None):
    from uk_budget_data.forecast import with_forecast

    return pe.uk.managed_microsimulation(
        dataset=dataset_path, scenario=with_forecast(scenario){extra}
    )


class ReformProcessor:
    def process(self):
        return {processor}
'''


@pytest.mark.parametrize(
    "change, counts",
    [
        # #320: a new calculator in the national pipeline
        (dict(imports="A, OFFICIAL_BASES", processor="OFFICIAL_BASES"), False),
        (dict(extra=", allow_unmanaged=True"), True),
    ],
)
def test_only_what_build_microsimulation_uses_in_pipeline_counts(
    tmp_path, change, counts
):
    repo = new_repository(tmp_path / "repo")
    fields = dict(imports="A", extra="", processor="A")
    path = "src/uk_budget_data/pipeline.py"
    first = commit(repo, {path: PIPELINE.format(**fields)})
    second = commit(repo, {path: PIPELINE.format(**{**fields, **change})})
    found = area_code.area_changes_between(first, second, repo)
    assert bool(found) is counts, found


@pytest.mark.parametrize(
    "imports, addition",
    [
        # A module-level write to the environment the engine reads
        ("import os\n", 'os.environ["POLICYENGINE_FLAG"] = "1"\n'),
        # A module-level change to another module's attribute
        ("import policyengine_uk as p\n", "p.X = 1\n"),
        # A new import kept only for its side effects
        ("", "import uk_budget_data.side_effects  # noqa: F401\n"),
    ],
    ids=["environment", "attribute", "side-effect import"],
)
def test_module_level_side_effects_in_a_sliced_file_count(
    tmp_path, imports, addition
):
    """María, #362: each of these runs when geography.py imports
    build_microsimulation, though build_microsimulation uses none of it.
    The modules imported are the same before and after, except for the
    side-effect import itself."""
    repo = new_repository(tmp_path / "repo")
    fields = dict(imports="A", extra="", processor="A")
    path = "src/uk_budget_data/pipeline.py"
    head, rest = PIPELINE.format(**fields).split("\n\n\n", 1)
    first = commit(repo, {path: head + "\n" + imports + "\n\n" + rest})
    second = commit(
        repo, {path: head + "\n" + imports + addition + "\n\n" + rest}
    )
    found = area_code.area_changes_between(first, second, repo)
    assert found == [f"{path} (build_microsimulation)"], found


def test_dropping_an_import_or_naming_another_name_from_it(tmp_path):
    """Dropping a module counts, as adding one does; another name from a
    module already imported does not (#320's OFFICIAL_BASES)."""
    repo = new_repository(tmp_path / "repo")
    path = "src/uk_budget_data/pipeline.py"
    fields = dict(imports="A", extra="", processor="A")
    source = PIPELINE.format(**fields)
    first = commit(repo, {path: "import json\n" + source})
    second = commit(repo, {path: source})
    assert area_code.area_changes_between(first, second, repo) != []
    third = commit(
        repo, {path: PIPELINE.format(**{**fields, "imports": "A, B"})}
    )
    assert area_code.area_changes_between(second, third, repo) == []


def test_a_change_to_reform_result_alone_does_not_count(tmp_path):
    """#320 added ``official_basis`` to ReformResult in models.py."""
    repo = new_repository(tmp_path / "repo")
    path = "src/uk_budget_data/models.py"
    source = (
        "from pydantic import BaseModel\n\n"
        "class DataConfig(BaseModel):\n    years: list = []\n\n"
        "class Reform(BaseModel):\n    id: str\n\n"
        "class ReformResult(BaseModel):\n    reform_id: str\n"
    )
    first = commit(repo, {path: source})
    second = commit(repo, {path: source + "    official_basis: list = []\n"})
    assert area_code.area_changes_between(first, second, repo) == []
    third = commit(repo, {path: source.replace("id: str", "id: int", 1)})
    assert area_code.area_changes_between(second, third, repo) == [
        f"{path} (DataConfig, Reform)"
    ]


def test_320_changed_no_area_code():
    """The commits #320 merged changed no area figure (run against this
    repository's own history when it has it)."""
    repo = Path(__file__).resolve().parents[1]
    before, after = (
        "b22f3651cbb868479c6835ccf6a7e945ebc97b05",
        "42ab8edb6a035f795677f49d8d19802d153ff9f6",
    )
    for sha in (before, after):
        if (
            subprocess.run(
                ["git", "cat-file", "-e", f"{sha}^{{commit}}"],
                cwd=repo,
                capture_output=True,
            ).returncode
            != 0
        ):
            pytest.skip("this checkout does not have #320's history")
    assert area_code._area_paths(before, after, repo) == []


@pytest.mark.parametrize(
    "path, listed",
    [
        ("src/uk_budget_data/geography.py", True),
        ("src/uk_budget_data/budget_measures/new_measure.py", True),
        ("src/uk_budget_data/forecast/obr_october_2026.json", True),
        ("uv.lock", True),
        ("data_inputs/constituencies_2024.csv", True),
        ("src/uk_budget_data/calculators.py", False),
        ("src/uk_budget_data/publication/tables.py", False),
        ("src/uk_budget_data/publication/generate.py", False),
        ("src/uk_budget_data/pipeline.py", False),  # sliced instead
        ("public/data/manifest.json", False),
        ("src/uk_budget_data/budget_measures", False),
        ("src/uk_budget_data/../uv.lock", False),
    ],
)
def test_the_area_path_list(path, listed):
    assert area_code.is_area_path(path) is listed


def test_every_listed_path_exists():
    """A renamed module must not drop out of the list unnoticed."""
    root = Path(__file__).resolve().parents[1]
    for path in (*area_code.AREA_CODE_PATHS, *area_code.AREA_CODE_SYMBOLS):
        assert (root / path).exists(), path


def test_what_the_sliced_definitions_use_is_area_code():
    """Every uk_budget_data module the sliced definitions import is on the
    list (or sliced), so the slice cannot hide a dependency."""
    root = Path(__file__).resolve().parents[1]
    for path, names in area_code.AREA_CODE_SYMBOLS.items():
        sliced = area_code._slice((root / path).read_text(), names)
        for module in re.findall(r"uk_budget_data[\w.]*", sliced):
            parts = module.split(".")
            candidates = [
                "src/" + "/".join(parts) + ".py",
                "src/" + "/".join(parts) + "/__init__.py",
                "src/" + "/".join(parts[:-1]) + ".py",
                "src/" + "/".join(parts[:-1]) + "/__init__.py",
            ]
            existing = [c for c in candidates if (root / c).exists()]
            assert existing, module
            assert any(
                area_code.is_area_path(c) or c in area_code.AREA_CODE_SYMBOLS
                for c in existing
            ), module


def _imported_modules(source: str, root: Path) -> set[str]:
    """The repository paths of the uk_budget_data modules a source imports,
    at module level or inside functions."""
    import ast

    def path_of(module):
        base = "src/" + module.replace(".", "/")
        for candidate in (base + ".py", base + "/__init__.py"):
            if (root / candidate).exists():
                return candidate
        return None

    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
            "uk_budget_data"
        ):
            found.add(path_of(node.module))
            found |= {
                path_of(f"{node.module}.{alias.name}") for alias in node.names
            }
        elif isinstance(node, ast.Import):
            found |= {
                path_of(alias.name)
                for alias in node.names
                if alias.name.startswith("uk_budget_data")
            }
    return found - {None}


def test_every_module_the_area_code_imports_is_listed_or_exempt():
    """From each listed Python file, follow its uk_budget_data imports: each
    one must be listed, sliced (whose own test checks its slice) or exempt
    with a reason. A new import into area code is then a reviewed choice."""
    root = Path(__file__).resolve().parents[1]
    listed = [
        path
        for path in area_code.AREA_CODE_PATHS
        if path.startswith("src/") and path.endswith(".py")
    ] + [
        str(path.relative_to(root))
        for directory in area_code.AREA_CODE_PATHS
        if directory.endswith("/")
        for path in sorted((root / directory).rglob("*.py"))
    ]
    seen, pending, unlisted = set(), list(listed), {}
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        for module in _imported_modules((root / path).read_text(), root):
            if area_code.is_area_path(module):
                pending.append(module)
            elif not (
                module in area_code.AREA_CODE_SYMBOLS
                or module in area_code.AREA_CODE_EXEMPT
            ):
                unlisted.setdefault(module, []).append(path)
    assert unlisted == {}


def test_exempt_paths_exist_and_are_not_listed():
    root = Path(__file__).resolve().parents[1]
    for path in area_code.AREA_CODE_EXEMPT:
        assert (root / path).exists(), path
        assert not area_code.is_area_path(path), path
        assert path not in area_code.AREA_CODE_SYMBOLS, path


def test_the_area_run_never_uses_the_national_modal_runner():
    """modal_runner.py is exempt because geography's one make_runner call
    passes no backend, so it is always the local runner."""
    import ast

    root = Path(__file__).resolve().parents[1]
    tree = ast.parse((root / "src/uk_budget_data/geography.py").read_text())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and getattr(node.func, "id", getattr(node.func, "attr", None))
        in ("make_runner", "ModalRunner")
    ]
    assert calls
    for call in calls:
        assert getattr(call.func, "id", None) == "make_runner"
        assert all(keyword.arg != "backend" for keyword in call.keywords)
        assert len(call.args) <= 3  # jobs, units, years: backend is a keyword
    for path in (
        "src/uk_budget_data/constituencies.py",
        "src/uk_budget_data/constituencies_remote.py",
        "src/uk_budget_data/modal_constituencies.py",
        "src/uk_budget_data/modal_constituencies_runner.py",
    ):
        source = (root / path).read_text()
        assert "make_runner" not in source and "modal_runner" not in source
