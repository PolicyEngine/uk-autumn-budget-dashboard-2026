"""Area runs across the commits that follow an approval (#104 round 4).

A code-bound measure's identity includes the commit its receipt was made at,
as well as its modifier's module source. Committing the measure's
attestation, or the published artifacts, moves HEAD. So the area guard
recomputes identities at the approved commit, but only when HEAD descends
from it and nothing committed since could change a calculation.
"""

import json
import os
import re
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
        "src/uk_budget_data/budget_measures.py",
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
    "path", ["src/uk_budget_data/budget_measures.py", "uv.lock"]
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
    st.builds("data_inputs/treasury/{}.csv".format, NAME),
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
