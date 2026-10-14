"""Tests for verifying a policyengine release against its dispatch."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data.bundle_adoption import (
    QUALIFIED_EXACT_PAIR,
    REQUIRED_FIELDS,
    check_release,
    installed_identity,
    main,
    version_tuple,
)

CERTIFICATE = "c" * 64

MANIFEST = {
    "bundle_version": "6.3.0",
    "packages": {
        "policyengine-uk": {"version": "2.130.0"},
        "policyengine-core": {"version": "3.34.0"},
    },
    "data_releases": {
        "uk": {
            "default_dataset": "enhanced_frs_2024_25",
            "data_package": {"version": "1.60.0"},
            "certified_data_artifact": {"sha256": "d" * 64},
            "certification": {
                "compatibility_basis": "built_with_model",
                "certified_for_model_version": "2.130.0",
            },
        }
    },
}

INSTALLED = {
    "policyengine": "6.3.0",
    "policyengine-uk": "2.130.0",
    "policyengine-core": "3.34.0",
}


def dispatch(**changes) -> dict:
    payload = {
        **installed_identity(MANIFEST),
        "certificate_sha256": CERTIFICATE,
    }
    payload.update(changes)
    return payload


def check(
    version="6.3.0",
    bundle=None,
    installed=INSTALLED,
    digest=CERTIFICATE,
    current="6.2.6",
    qualification=None,
    manifest=MANIFEST,
):
    return check_release(
        version,
        bundle if bundle is not None else dispatch(),
        current_version=current,
        qualification=qualification,
        manifest=manifest,
        installed_version=installed.__getitem__,
        certificate_digest=(lambda record: digest) if digest else None,
    )


def test_a_matching_release_has_no_problems():
    assert check() == []


@pytest.mark.parametrize(
    "field, value",
    [
        ("model_version", "2.129.0"),
        ("core_version", "3.33.0"),
        ("data_release_version", "1.59.0"),
        ("dataset", "frs_2024_25"),
        ("dataset_sha256", "e" * 64),
        ("certificate_sha256", "f" * 64),
        ("compatibility_basis", "legacy_compatible_model_package"),
    ],
)
def test_each_announced_field_is_checked(field, value):
    problems = check(bundle=dispatch(**{field: value}))
    assert len(problems) == 1
    assert field in problems[0]


def test_wrong_installed_wrapper_is_refused():
    problems = check(installed={**INSTALLED, "policyengine": "6.2.6"})
    assert any("installed policyengine is 6.2.6" in p for p in problems)


def test_installed_model_must_be_the_one_the_bundle_names():
    problems = check(installed={**INSTALLED, "policyengine-uk": "2.125.1"})
    assert problems == [
        "installed policyengine-uk is 2.125.1, but the bundle names 2.130.0"
    ]


def test_packaged_bundle_must_be_the_announced_version():
    problems = check(
        version="6.3.1", installed={**INSTALLED, "policyengine": "6.3.1"}
    )
    assert problems == ["the packaged bundle is 6.3.0, not 6.3.1"]


@pytest.mark.parametrize(
    "version", ["", "6.3", "6.3.0rc1", "main", "6.3.0; rm -rf /"]
)
def test_only_plain_release_versions_are_accepted(version):
    assert "not a plain release version" in check(version=version)[0]


@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_a_dispatch_missing_a_field_is_refused(field):
    bundle = dispatch()
    del bundle[field]
    assert check(bundle=bundle) == [f"the dispatch omits {field}"]


def test_a_malformed_digest_is_refused():
    problems = check(bundle=dispatch(dataset_sha256="abc"))
    assert "dataset_sha256 is not a SHA-256" in problems


def test_release_without_a_receipt_module_cannot_be_verified(monkeypatch):
    # Review round 3: without this, an installed release that has a
    # receipt module would recompute the digest and fail the test.
    monkeypatch.setattr(
        "uk_budget_data.bundle_adoption.receipt_certificate_sha256",
        lambda: None,
    )
    problems = check(digest=None)
    # The installed 6.2.6 has no receipt module, so nothing recomputes it.
    assert problems == [
        "this policyengine release has no receipt module, so the "
        "certificate digest cannot be recomputed"
    ]


@given(
    field=st.sampled_from(sorted(installed_identity(MANIFEST))),
    value=st.text(min_size=1, max_size=20),
)
def test_any_disagreement_with_the_packaged_bundle_is_reported(field, value):
    truth = str(installed_identity(MANIFEST)[field])
    problems = check(bundle=dispatch(**{field: value}))
    if value == truth:
        assert problems == []
    else:
        assert problems


def test_cli_reports_every_problem(capsys):
    bundle = dispatch(model_version="0.0.1")
    base = ["--version", "6.3.0", "--current-version", "6.2.6"]
    code = main([*base, "--bundle-uk-json", json.dumps(bundle)])
    assert code == 1
    assert "::error::" in capsys.readouterr().err
    assert main([*base, "--bundle-uk-json", "not json"]) == 1
    assert main([*base, "--bundle-uk-json", "[]"]) == 1
    for qualification in ("[]", "1", "not json"):
        assert (
            main(
                [
                    *base,
                    "--bundle-uk-json",
                    "{}",
                    "--qualification-json",
                    qualification,
                ]
            )
            == 1
        )


# --- the workflow's bundle export (review finding, 12 October) ------------

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "adopt-policyengine-release.yml"
SCRIPTS = REPO / "scripts" / "adopt_release"


def _export_filter() -> str:
    match = re.search(
        r"jq -cse '([^']+)'", (SCRIPTS / "identity.sh").read_text()
    )
    assert match, "the workflow must parse the bundle with jq -cse"
    return match.group(1)


def _export(text: str):
    """What the workflow would append to GITHUB_ENV, or None if refused."""
    result = subprocess.run(
        ["jq", "-cse", _export_filter()],
        input=text,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return f"bundle={result.stdout.strip()}\n"


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
@pytest.mark.parametrize(
    "text",
    [
        "{}\n__BUNDLE__\nUV_INDEX_URL=https://example.invalid/simple",
        '{} "UV_INDEX_URL=evil"',
        '{} {"a": 1}',
        "[1, 2]",
        "not json",
        "",
    ],
)
def test_the_export_refuses_anything_but_one_json_object(text):
    assert _export(text) is None


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
# Each example runs jq in a subprocess; its time is not what is tested.
@settings(deadline=None)
@given(
    st.dictionaries(
        st.text(max_size=8),
        st.one_of(st.text(), st.integers(), st.none()),
        max_size=4,
    )
)
def test_one_object_is_exported_on_exactly_one_line(bundle):
    exported = _export(json.dumps(bundle, indent=2))
    assert exported is not None
    assert exported.count("\n") == 1
    assert json.loads(exported.removeprefix("bundle=")) == bundle


# --- the workflow's version check (review round 3) ------------------------


def _release_step(tmp_path, version: str, bundle: str = "{}"):
    """Run identity.sh as the workflow does; return its exit, its outputs,
    and its log."""
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", str(SCRIPTS / "identity.sh")],
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "PAYLOAD_VERSION": version,
            "INPUT_BUNDLE_UK_JSON": bundle,
            "GITHUB_OUTPUT": str(output),
        },
        capture_output=True,
        text=True,
    )
    return result.returncode, output.read_text(), result.stdout


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
@pytest.mark.parametrize(
    "version",
    [
        "6.3.0\nversion=6.2.6\nbranch=main",
        "version=6.2.6\n6.3.0",
        "6.3.0\n",
        "6.3.0\r",
        "6.3.0 ",
        "",
    ],
)
def test_a_version_with_more_than_one_line_writes_no_output(tmp_path, version):
    code, output, _ = _release_step(tmp_path, version)
    assert code != 0
    assert output == ""


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
def test_a_bad_bundle_writes_no_output_at_all(tmp_path):
    """Not even the version: nothing is written until everything passes."""
    code, output, _ = _release_step(tmp_path, "6.3.0", bundle="[1]")
    assert code != 0
    assert output == ""


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
def test_a_plain_version_writes_exactly_its_outputs(tmp_path):
    code, output, _ = _release_step(tmp_path, "6.3.0")
    assert code == 0
    assert output == (
        "version=6.3.0\nbranch=adopt/policyengine-6.3.0\n"
        "bundle={}\nqualification=null\n"
    )


# --- confirmation review of #18 -------------------------------------------


@pytest.mark.parametrize("version", ["6.2.6", "6.2.5", "6.1.9", "5.99.99"])
def test_a_release_that_is_not_newer_than_the_lock_is_refused(version):
    """Review finding 1: an older certified release would have opened a
    downgrade pull request."""
    problems = check(
        version=version, installed={**INSTALLED, "policyengine": version}
    )
    assert problems == [
        f"policyengine {version} is not newer than the pinned 6.2.6"
    ]


@given(
    version=st.tuples(*[st.integers(0, 20)] * 3),
    current=st.tuples(*[st.integers(0, 20)] * 3),
)
def test_only_a_newer_release_is_proposed(version, current):
    """Property: a release is refused as not newer exactly when its version
    is not after the pinned one, compared as numbers (6.10.0 is after
    6.9.0)."""
    text = ".".join(map(str, version))
    problems = check(
        version=text,
        current=".".join(map(str, current)),
        installed={**INSTALLED, "policyengine": text},
    )
    refused = any("is not newer" in problem for problem in problems)
    assert refused == (version <= current)


def test_versions_compare_as_numbers():
    assert version_tuple("6.10.0") > version_tuple("6.9.0")
    with pytest.raises(ValueError):
        version_tuple("6.10")


def test_a_malformed_pinned_version_is_refused():
    assert check(current="6.2")[0].startswith("current version '6.2'")


PAIR = "uk-2.130.0+data-1.60.0"
QUALIFIED_MANIFEST = {
    **MANIFEST,
    "data_releases": {
        "uk": {
            **MANIFEST["data_releases"]["uk"],
            "certification": {
                "compatibility_basis": QUALIFIED_EXACT_PAIR,
                "qualification_pair_id": PAIR,
                "certified_for_model_version": "2.130.0",
                "certified_for_core_version": "3.34.0",
            },
        }
    },
}


def qualified(**uk) -> dict:
    return {
        "uk": {
            "pair_id": PAIR,
            "verdict": "qualified",
            "promotable": True,
            "receipt_sha256": "e" * 64,
            **uk,
        }
    }


def check_pair(qualification):
    return check(
        bundle=dispatch(compatibility_basis=QUALIFIED_EXACT_PAIR),
        qualification=qualification,
        manifest=QUALIFIED_MANIFEST,
    )


def test_a_promotable_qualified_pair_is_adopted():
    assert check_pair(qualified()) == []


@pytest.mark.parametrize(
    "qualification, problem",
    [
        (None, "reports none"),
        ({}, "reports none"),
        (qualified(promotable=False), "not promotable"),
        (qualified(promotable=None), "not promotable"),
        (qualified(promotable="true"), "not promotable"),
        (qualified(pair_id="uk-2.129.0+data-1.60.0"), "packaged bundle"),
        (qualified(receipt_sha256="abc"), "receipt_sha256"),
        ({"uk": []}, "not an object"),
    ],
)
def test_a_qualified_pair_needs_a_promotable_receipt_for_its_pair(
    qualification, problem
):
    """Review finding 2: a qualified exact pair whose qualification said
    promotable=false, or nothing, matched its certificate and was
    proposed."""
    problems = check_pair(qualification)
    assert problems and any(problem in p for p in problems), problems


def test_an_ordinary_bundle_needs_no_qualification_but_refuses_a_failed_one():
    assert check(qualification=None) == []
    assert check(qualification={"uk": None}) == []
    problems = check(qualification=qualified(promotable=False))
    assert any("not promotable" in p for p in problems)


# --- review round 3 of #18: what the certificate covers -------------------


def with_certification(manifest: dict, **certification) -> dict:
    uk = manifest["data_releases"]["uk"]
    return {
        **manifest,
        "data_releases": {
            "uk": {
                **uk,
                "certification": {**uk["certification"], **certification},
            }
        },
    }


@pytest.mark.parametrize(
    "certification, problem",
    [
        ({"certified_for_model_version": "2.126.12"}, "covers model 2.126.12"),
        ({"certified_for_model_version": None}, "covers model None"),
        ({"certified_for_core_version": "3.33.0"}, "covers core 3.33.0"),
    ],
)
def test_a_certificate_must_cover_the_packages_the_bundle_installs(
    certification, problem
):
    """Review R2: a certificate for model 2.126.12 and core 3.33.0, in a
    bundle that installs 2.130.0 and 3.34.0, passed: its digest recomputed
    from the same inconsistent record."""
    problems = check(manifest=with_certification(MANIFEST, **certification))
    assert any(problem in p for p in problems), problems


def test_the_reviewers_stale_certificate_is_refused():
    manifest = with_certification(
        QUALIFIED_MANIFEST,
        certified_for_model_version="2.126.12",
        certified_for_core_version="3.33.0",
    )
    problems = check(
        bundle=dispatch(compatibility_basis=QUALIFIED_EXACT_PAIR),
        qualification=qualified(),
        manifest=manifest,
    )
    assert any("covers model 2.126.12" in p for p in problems)
    assert any("covers core 3.33.0" in p for p in problems)


def test_a_certificate_naming_no_core_covers_the_bundles_own():
    """policyengine.py's receipt reads a certificate with no core version
    as covering the bundle's core (as 6.3.3's legacy certificate does), but
    a qualified exact pair holds only for the core it names."""
    assert check() == []
    problems = check(
        bundle=dispatch(compatibility_basis=QUALIFIED_EXACT_PAIR),
        qualification=qualified(),
        manifest=with_certification(
            QUALIFIED_MANIFEST, certified_for_core_version=None
        ),
    )
    assert any("covers core None" in p for p in problems)


# --- the workflow's shape (review R1: released code and the write token) --


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def _steps(job: str) -> list[dict]:
    return _workflow()["jobs"][job]["steps"]


def _index(steps: list[dict], predicate) -> int:
    return next(i for i, step in enumerate(steps) if predicate(step))


def _runs(script: str):
    return lambda step: f"scripts/adopt_release/{script}" in step.get(
        "run", ""
    )


def test_workflow_never_interpolates_the_dispatch_into_a_script():
    """Dispatch values reach the shell only through environment variables."""
    for job in _workflow()["jobs"].values():
        for step in job["steps"]:
            script = step.get("run", "")
            assert "${{" not in script, step.get("name")
    for script in SCRIPTS.glob("*.sh"):
        assert "${{" not in script.read_text(), script.name


def test_workflow_opens_a_draft_and_never_merges():
    text = WORKFLOW.read_text() + "".join(
        script.read_text() for script in SCRIPTS.glob("*.sh")
    )
    assert "gh pr create --draft" in (SCRIPTS / "open_pr.sh").read_text()
    assert "gh pr merge" not in text
    assert "--auto" not in text
    assert "pull_request_target" not in text
    # PyYAML reads the bare key `on` as the boolean True.
    triggers = _workflow().get("on", _workflow().get(True))
    assert set(triggers) == {"repository_dispatch", "workflow_dispatch"}
    assert triggers["repository_dispatch"]["types"] == ["policyengine-release"]


def test_the_released_package_runs_only_where_nothing_can_write():
    """Review R1: the checker imported the release in the job that later
    pushed with a write token, so the release could plant a git hook or
    core.fsmonitor and have the push run it with the token."""
    workflow = _workflow()
    assert workflow["permissions"] == {}
    validate = workflow["jobs"]["validate"]
    assert validate["permissions"] == {
        "contents": "read",
        "pull-requests": "read",
    }
    text = yaml.safe_dump(validate)
    assert "secrets." not in text
    assert "create-github-app-token" not in text
    install = _index(
        validate["steps"], lambda s: "uv sync" in s.get("run", "")
    )
    check = _index(
        validate["steps"], lambda s: "bundle_adoption" in s.get("run", "")
    )
    lock = _index(validate["steps"], _runs("lock.sh"))
    # The files are hashed before the release is installed or run.
    assert lock < install < check


def test_the_job_that_writes_installs_and_runs_nothing():
    propose = _workflow()["jobs"]["propose"]
    assert propose["needs"] == "validate"
    assert propose["if"] == "needs.validate.outputs.skip == 'false'"
    for step in propose["steps"]:
        script = step.get("run", "")
        for runs_a_package in (
            "uv sync",
            "uv run",
            "uv pip",
            "pip ",
            "python",
        ):
            assert runs_a_package not in script, step.get("name")
    assert "--no-build" in (SCRIPTS / "lock.sh").read_text()
    assert "uv sync" not in (SCRIPTS / "lock.sh").read_text()


def test_the_write_token_is_minted_last_and_used_once():
    steps = _steps("propose")
    token = _index(
        steps,
        lambda s: s.get("uses", "").startswith(
            "actions/create-github-app-token@"
        ),
    )
    checks = [
        _index(steps, _runs(script))
        for script in ("identity.sh", "dedupe.sh", "lock.sh")
    ]
    assert all(index < token for index in checks)
    after = steps[token + 1 :]
    assert [s.get("run") for s in after] == [
        "bash scripts/adopt_release/open_pr.sh"
    ]
    for step in steps[:token]:
        assert "steps.app" not in yaml.safe_dump(step), step.get("name")


def test_the_propose_job_rebuilds_exactly_what_validate_checked():
    step = _steps("propose")[_index(_steps("propose"), _runs("lock.sh"))]
    assert step["env"]["EXPECT_LOCK_SHA256"] == (
        "${{ needs.validate.outputs.lock_sha256 }}"
    )
    assert step["env"]["EXPECT_PYPROJECT_SHA256"] == (
        "${{ needs.validate.outputs.pyproject_sha256 }}"
    )
    outputs = _workflow()["jobs"]["validate"]["outputs"]
    assert outputs["lock_sha256"] == "${{ steps.lock.outputs.lock_sha256 }}"


def test_the_propose_job_checks_again_against_main_as_it_is_now():
    """Review R4: a newer release could be adopted while validate ran, and
    the older run still proposed a downgrade against the main it had read."""
    steps = _steps("propose")
    checkout = _index(
        steps, lambda s: s.get("uses", "").startswith("actions/checkout@")
    )
    assert steps[checkout]["with"]["ref"] == "main"
    assert checkout < _index(steps, _runs("identity.sh"))
    assert _index(steps, _runs("identity.sh")) < _index(
        steps, _runs("dedupe.sh")
    )
    env = _workflow()["jobs"]["propose"]["env"]
    assert env["PAYLOAD_VERSION"] == "${{ needs.validate.outputs.version }}"


@pytest.mark.parametrize("job", ["validate", "propose"])
def test_no_checkout_keeps_a_token(job):
    checkout = next(
        s
        for s in _steps(job)
        if s.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"]["persist-credentials"] is False
    assert "token" not in checkout["with"]


def test_each_version_has_its_own_queue():
    """Review N3: one concurrency group for every version let a third
    dispatch cancel a different release's queued run."""
    group = _workflow()["concurrency"]["group"]
    assert "client_payload.version" in group and "inputs.version" in group


# --- dedupe.sh (review findings 1, 3, N1, N2, R3) -------------------------


def _stub(bin_dir: Path, name: str, script: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/bash\n" + script)
    path.chmod(0o755)


LOCK = (
    "[[package]]\n"
    'name = "policyengine"\n'
    'version = "{version}"\n'
    'source = {{ registry = "https://pypi.org/simple" }}\n'
)


REPOSITORY = "PolicyEngine/uk-autumn-budget-dashboard-2026"


def _pr(number, state="open", repo=REPOSITORY, merged=False):
    """One pull request as the REST API lists it."""
    return {
        "number": number,
        "state": state,
        "merged_at": "2026-10-14T00:00:00Z" if merged else None,
        "head": {"repo": {"full_name": repo} if repo else None},
    }


def _dedupe(tmp_path, version, *, locked="6.2.6", refs=(), pages=((),)):
    """Run dedupe.sh with stub git and gh; return its exit, outputs, log and
    the commands it ran. ``refs`` are the (sha, ref) lines ls-remote lists;
    ``pages`` the pages of pull requests the API returns."""
    work, bin_dir = tmp_path / "work", tmp_path / "bin"
    work.mkdir()
    bin_dir.mkdir()
    (work / "uv.lock").write_text(LOCK.format(version=locked))
    calls = tmp_path / "calls"
    listing = "".join(f"{sha}\t{ref}\n" for sha, ref in refs)
    (tmp_path / "listing").write_text(listing)
    _stub(
        bin_dir,
        "git",
        f'echo "git $* auth=${{GIT_CONFIG_COUNT:-none}}" >> "{calls}"\n'
        f'cat "{tmp_path / "listing"}"\n',
    )
    # gh --paginate prints one JSON array per page, back to back.
    (tmp_path / "pages").write_text(
        "".join(json.dumps(list(page)) for page in pages)
    )
    _stub(
        bin_dir,
        "gh",
        f'echo "gh $*" >> "{calls}"\ncat "{tmp_path / "pages"}"\n',
    )
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", str(SCRIPTS / "dedupe.sh")],
        cwd=work,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "VERSION": version,
            "BRANCH": f"adopt/policyengine-{version}",
            "GITHUB_OUTPUT": str(output),
            "GITHUB_REPOSITORY": REPOSITORY,
            "GH_TOKEN": "token",
        },
        capture_output=True,
        text=True,
    )
    outputs = dict(
        line.split("=", 1) for line in output.read_text().splitlines()
    )
    ran = calls.read_text().splitlines() if calls.exists() else []
    return result.returncode, outputs, result.stdout + result.stderr, ran


def _branch(version="6.3.0", sha="a" * 40):
    return [(sha, f"refs/heads/adopt/policyengine-{version}")]


@pytest.mark.parametrize(
    "locked, version",
    [
        ("6.2.6", "6.2.6"),
        ("6.2.6", "6.2.5"),
        ("6.10.0", "6.9.9"),
        ("6.2.6", "5.9.9"),
    ],
)
def test_the_workflow_skips_a_release_that_is_not_newer(
    tmp_path, locked, version
):
    """Review finding 1, in the workflow itself: the step only skipped the
    pinned version, so an older one went on to a downgrade."""
    code, outputs, log, _ = _dedupe(tmp_path, version, locked=locked)
    assert code == 0
    assert outputs["skip"] == "true"
    assert "is not newer" in log


@pytest.mark.parametrize(
    "locked, version",
    [
        ("6.2.6", "6.2.7"),
        ("6.2.6", "6.3.0"),
        ("6.9.9", "6.10.0"),
        ("6.2.6", "7.0.0"),
    ],
)
def test_the_workflow_proposes_a_newer_release(tmp_path, locked, version):
    code, outputs, _, _ = _dedupe(tmp_path, version, locked=locked)
    assert code == 0
    assert outputs == {"current": locked, "skip": "false", "orphan": ""}


def test_the_workflow_refuses_a_lock_without_a_plain_version(tmp_path):
    code, outputs, _, _ = _dedupe(tmp_path, "6.3.0", locked="6.3.0rc1")
    assert code != 0
    assert "skip" not in outputs


@pytest.mark.parametrize(
    "pr, shown",
    [
        (_pr(42, "open"), "#42 (open)"),
        (_pr(42, "closed"), "#42 (closed)"),
        (_pr(42, "closed", merged=True), "#42 (merged)"),
    ],
)
@pytest.mark.parametrize("branch_exists", [True, False])
def test_a_release_ever_proposed_is_left_alone(
    tmp_path, pr, shown, branch_exists
):
    """A closed one counts too: closing the bot's draft rejects the release.
    Review R3: deleting the branch as well made the next run propose it
    again, because pull requests were looked up only for an existing
    branch."""
    code, outputs, log, _ = _dedupe(
        tmp_path,
        "6.3.0",
        refs=_branch() if branch_exists else (),
        pages=[[pr]],
    )
    assert code == 0
    assert outputs["skip"] == "true"
    assert shown in log


def test_every_page_of_pull_requests_is_read(tmp_path):
    """Review R3: the bot's closed draft, behind 30 newer pull requests of
    the same head name, fell outside gh pr list's default 30."""
    others = [
        _pr(n, repo="someone/uk-autumn-budget-dashboard-2026")
        for n in range(100, 200)
    ]
    code, outputs, log, ran = _dedupe(
        tmp_path,
        "6.3.0",
        refs=_branch(),
        pages=[others, [_pr(42, "closed")]],
    )
    assert code == 0
    assert outputs["skip"] == "true"
    assert "#42 (closed)" in log
    (query,) = [line for line in ran if line.startswith("gh ")]
    assert "--paginate" in query
    assert "state=all" in query
    assert "head=PolicyEngine:adopt/policyengine-6.3.0" in query


def test_a_branch_left_without_a_pull_request_is_rebuilt(tmp_path):
    """Review finding 3: a run that pushed and then failed to open its pull
    request left a branch that every later run took for a proposal."""
    code, outputs, log, _ = _dedupe(tmp_path, "6.3.0", refs=_branch())
    assert code == 0
    assert outputs["skip"] == "false"
    assert outputs["orphan"] == "a" * 40
    assert "rebuilding it" in log


def test_another_repositorys_pull_request_does_not_hide_an_orphan(tmp_path):
    """Review N1: a fork's pull request named like the bot's branch hid the
    orphan forever. A deleted fork lists its head repository as null."""
    code, outputs, _, _ = _dedupe(
        tmp_path,
        "6.3.0",
        refs=_branch(),
        pages=[
            [
                _pr(
                    7, "closed", repo="someone/uk-autumn-budget-dashboard-2026"
                ),
                _pr(8, repo="PolicyEngine/another-repository"),
                _pr(9, "closed", repo=None),
            ]
        ],
    )
    assert code == 0
    assert outputs["skip"] == "false"
    assert outputs["orphan"] == "a" * 40


def test_a_lookalike_branch_is_not_the_bot_branch(tmp_path):
    """Review N2: ls-remote matched refs/heads/zz/adopt/policyengine-6.3.0,
    so its sha became the lease and every run failed."""
    lookalike = [("b" * 40, "refs/heads/zz/adopt/policyengine-6.3.0")]
    code, outputs, _, _ = _dedupe(tmp_path, "6.3.0", refs=lookalike)
    assert code == 0
    assert outputs == {"current": "6.2.6", "skip": "false", "orphan": ""}
    (tmp_path / "both").mkdir()
    code, outputs, _, _ = _dedupe(
        tmp_path / "both", "6.3.0", refs=lookalike + _branch()
    )
    assert outputs["orphan"] == "a" * 40


def test_a_ref_listed_twice_stops_the_run(tmp_path):
    code, outputs, _, _ = _dedupe(
        tmp_path, "6.3.0", refs=_branch() + _branch(sha="c" * 40)
    )
    assert code != 0
    assert "skip" not in outputs


def test_the_public_branch_is_listed_without_a_token(tmp_path):
    """Review round 3: the repository is public, so ls-remote needs no
    token, and none reaches git in the dedupe step."""
    _, _, _, ran = _dedupe(tmp_path, "6.3.0", refs=_branch())
    (listing,) = [line for line in ran if line.startswith("git ")]
    assert listing.endswith("auth=none")
    assert "GIT_CONFIG" not in (SCRIPTS / "dedupe.sh").read_text()


@pytest.mark.parametrize(
    "version", ["6.03.0", "06.3.0", "6.3.00", "６.3.0", "6.3.0\n"]
)
def test_versions_have_no_leading_zeros_or_other_digits(tmp_path, version):
    """Review N5: 6.03.0 passed the pattern and named a branch, and Python's
    \\d and $ accepted other digits and a trailing newline."""
    code, output, _ = _release_step(tmp_path, version)
    assert code != 0 and output == ""
    assert "not a plain release version" in check(version=version)[0]


# --- lock.sh (review R1: the propose job rebuilds what validate checked) --


PYPROJECT = 'dependencies = [\n    "policyengine[uk]>=6.2.6",\n]\n'


def _lock(tmp_path, version="6.3.0", resolves_to=None, **expect):
    """Run lock.sh with a stub uv that writes the lock it resolves; return
    its exit, outputs, log and uv's arguments."""
    tmp_path.mkdir(exist_ok=True)
    work, bin_dir = tmp_path / "work", tmp_path / "bin"
    work.mkdir()
    bin_dir.mkdir()
    (work / "pyproject.toml").write_text(PYPROJECT)
    (work / "uv.lock").write_text(LOCK.format(version="6.2.6"))
    calls = tmp_path / "calls"
    lock = LOCK.format(version=resolves_to or version)
    (tmp_path / "resolved").write_text(lock)
    _stub(
        bin_dir,
        "uv",
        f'echo "uv $*" >> "{calls}"\ncp "{tmp_path / "resolved"}" uv.lock\n',
    )
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", str(SCRIPTS / "lock.sh")],
        cwd=work,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "VERSION": version,
            "GITHUB_OUTPUT": str(output),
            **expect,
        },
        capture_output=True,
        text=True,
    )
    outputs = dict(
        line.split("=", 1) for line in output.read_text().splitlines()
    )
    return (
        result.returncode,
        outputs,
        result.stdout + result.stderr,
        calls.read_text().splitlines() if calls.exists() else [],
        work,
    )


def test_the_release_is_pinned_without_building_anything(tmp_path):
    code, outputs, _, uv, work = _lock(tmp_path)
    assert code == 0
    assert uv == ["uv lock --no-build --upgrade-package policyengine==6.3.0"]
    assert '"policyengine[uk]>=6.3.0"' in (work / "pyproject.toml").read_text()
    assert set(outputs) == {"lock_sha256", "pyproject_sha256"}
    assert all(re.fullmatch(r"[0-9a-f]{64}", v) for v in outputs.values())


def test_the_same_files_rebuilt_pass(tmp_path):
    _, checked, _, _, _ = _lock(tmp_path / "validate")
    code, _, _, _, _ = _lock(
        tmp_path / "propose",
        EXPECT_LOCK_SHA256=checked["lock_sha256"],
        EXPECT_PYPROJECT_SHA256=checked["pyproject_sha256"],
    )
    assert code == 0


@pytest.mark.parametrize("which", ["lock", "pyproject", "empty", "both empty"])
def test_files_other_than_those_checked_stop_the_proposal(tmp_path, which):
    _, checked, _, _, _ = _lock(tmp_path / "validate")
    expect = {
        "EXPECT_LOCK_SHA256": checked["lock_sha256"],
        "EXPECT_PYPROJECT_SHA256": checked["pyproject_sha256"],
    }
    resolves_to = None
    if which == "lock":
        # Something resolved differently between the two jobs.
        resolves_to = "6.3.1"
    elif which == "pyproject":
        expect["EXPECT_PYPROJECT_SHA256"] = "0" * 64
    elif which == "empty":
        # A missing output never matches.
        expect["EXPECT_LOCK_SHA256"] = ""
    else:
        expect = {"EXPECT_LOCK_SHA256": "", "EXPECT_PYPROJECT_SHA256": ""}
    code, outputs, log, _, _ = _lock(
        tmp_path / "propose", resolves_to=resolves_to, **expect
    )
    assert code != 0
    assert "not the files the validate job checked" in log
    assert outputs == {}


# --- open_pr.sh (review findings 3 and 4) ---------------------------------


def _open_pr(tmp_path, *, orphan="", bundle='{"a":1}'):
    """Run open_pr.sh with stub git and gh; return its exit, the push
    commands and the body."""
    bin_dir, runner = tmp_path / "bin", tmp_path / "runner"
    bin_dir.mkdir()
    runner.mkdir()
    log, body = tmp_path / "git.log", tmp_path / "body.md"
    _stub(
        bin_dir,
        "git",
        f'echo "git $*" >> "{log}"\n'
        'if [ "$1" = push ]; then '
        f'echo "auth ${{GIT_CONFIG_KEY_0:-none}}" >> "{log}"; fi\n',
    )
    _stub(
        bin_dir,
        "gh",
        "while [ $# -gt 0 ]; do\n"
        f'  if [ "$1" = --body-file ]; then cp "$2" "{body}"; fi\n'
        "  shift\n"
        "done\n",
    )
    result = subprocess.run(
        ["bash", str(SCRIPTS / "open_pr.sh")],
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "VERSION": "6.3.0",
            "BRANCH": "adopt/policyengine-6.3.0",
            "ORPHAN": orphan,
            "BUNDLE_UK_JSON": bundle,
            "QUALIFICATION_JSON": "null",
            # What the dispatch's release_url could carry; never used.
            "PAYLOAD_RELEASE_URL": "\n\n[Verify release](https://bad)\n<!--",
            "RUNNER_TEMP": str(runner),
            "GH_TOKEN": "token",
        },
        capture_output=True,
        text=True,
    )
    lines = log.read_text().splitlines()
    pushes = [line for line in lines if " push " in line]
    # The token reaches git push in its environment, never its config.
    assert all("extraheader" not in line for line in lines if "config" in line)
    assert lines.count("auth http.https://github.com/.extraheader") == len(
        pushes
    )
    return result.returncode, pushes, body.read_text() if body.exists() else ""


def test_the_release_link_is_built_from_the_version(tmp_path):
    """Review finding 4: the dispatch's release URL went into the pull
    request as Markdown, so it could add a link of its own."""
    code, _, body = _open_pr(tmp_path)
    assert code == 0
    assert (
        "(https://github.com/PolicyEngine/policyengine.py/releases/tag/6.3.0)"
        in body
    )
    assert "Verify release" not in body and "<!--" not in body
    assert "PAYLOAD_RELEASE_URL" not in WORKFLOW.read_text()


def test_json_evidence_cannot_end_its_fence(tmp_path):
    """A backtick in the dispatch's JSON is written escaped (the same JSON),
    so it cannot close the code fence and add Markdown of its own."""
    code, _, body = _open_pr(
        tmp_path, bundle=json.dumps({"a": "``` [x](https://bad)"})
    )
    assert code == 0
    fences = [line for line in body.splitlines() if line.startswith("```")]
    assert fences == ["```json", "```", "```json", "```"]
    assert "\\u0060\\u0060\\u0060" in body
    evidence = body.split("```json\n")[1].split("\n```")[0]
    assert json.loads(evidence) == {"a": "``` [x](https://bad)"}


def test_a_new_branch_is_pushed_plainly(tmp_path):
    code, pushes, _ = _open_pr(tmp_path)
    assert code == 0
    assert pushes == ["git push origin adopt/policyengine-6.3.0"]


def test_an_orphan_branch_is_replaced_only_as_it_was_seen(tmp_path):
    code, pushes, _ = _open_pr(tmp_path, orphan="a" * 40)
    assert code == 0
    assert pushes == [
        "git push --force-with-lease=refs/heads/adopt/policyengine-6.3.0:"
        + "a" * 40
        + " origin adopt/policyengine-6.3.0"
    ]
