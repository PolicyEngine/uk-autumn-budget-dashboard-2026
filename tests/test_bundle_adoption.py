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
            "certification": {"compatibility_basis": "built_with_model"},
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


WORKFLOW = Path(".github/workflows/adopt-policyengine-release.yml")


def test_workflow_never_interpolates_the_dispatch_into_a_script():
    """Dispatch values reach the shell only through environment variables."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    job = workflow["jobs"]["open-upgrade-pr"]
    for step in job["steps"]:
        script = step.get("run", "")
        assert "github.event" not in script, step.get("name")
        assert "inputs." not in script, step.get("name")


def test_workflow_opens_a_draft_and_never_merges():
    text = WORKFLOW.read_text()
    assert "gh pr create --draft" in text
    assert "gh pr merge" not in text
    assert "--auto" not in text
    assert "pull_request_target" not in text
    workflow = yaml.safe_load(text)
    # PyYAML reads the bare key `on` as the boolean True.
    triggers = workflow.get("on", workflow.get(True))
    assert set(triggers) == {"repository_dispatch", "workflow_dispatch"}
    assert triggers["repository_dispatch"]["types"] == ["policyengine-release"]


# --- the workflow's bundle export (review finding, 12 October) ------------

WORKFLOW = (
    Path(__file__).resolve().parent.parent
    / ".github"
    / "workflows"
    / "adopt-policyengine-release.yml"
)


def _export_filter() -> str:
    match = re.search(r"jq -cse '([^']+)'", WORKFLOW.read_text())
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
    return f"BUNDLE_UK_JSON={result.stdout.strip()}\n"


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
    assert json.loads(exported.removeprefix("BUNDLE_UK_JSON=")) == bundle


# --- the workflow's version check (review round 3) ------------------------


def _release_step(tmp_path, version: str, bundle: str = "{}"):
    """Run the workflow's own release step; return its exit and outputs."""
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["open-upgrade-pr"][
        "steps"
    ]
    script = next(s for s in steps if s.get("id") == "release")["run"]
    output, env_file = tmp_path / "output", tmp_path / "env"
    output.write_text("")
    env_file.write_text("")
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", script],
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "PAYLOAD_VERSION": version,
            "INPUT_BUNDLE_UK_JSON": bundle,
            "GITHUB_OUTPUT": str(output),
            "GITHUB_ENV": str(env_file),
        },
        capture_output=True,
        text=True,
    )
    return result.returncode, output.read_text(), env_file.read_text()


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
    code, output, env = _release_step(tmp_path, version)
    assert code != 0
    assert output == "" and env == ""


@pytest.mark.skipif(shutil.which("jq") is None, reason="needs jq")
def test_a_plain_version_writes_exactly_its_outputs(tmp_path):
    code, output, env = _release_step(tmp_path, "6.3.0")
    assert code == 0
    assert output == "version=6.3.0\nbranch=adopt/policyengine-6.3.0\n"
    assert env == "BUNDLE_UK_JSON={}\nQUALIFICATION_JSON=null\n"


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


# --- the workflow's dedupe and pull request steps (review findings 1, 3, 4)


def _step(name_or_id: str) -> str:
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["open-upgrade-pr"][
        "steps"
    ]
    return next(
        step["run"]
        for step in steps
        if step.get("id") == name_or_id or step.get("name") == name_or_id
    )


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


def _dedupe(tmp_path, version, *, locked="6.2.6", branch=None, prs="0"):
    """Run the workflow's dedupe step with stub git and gh; return its exit,
    outputs and log. ``branch`` is the remote branch's sha, if it exists."""
    work, bin_dir = tmp_path / "work", tmp_path / "bin"
    work.mkdir()
    bin_dir.mkdir()
    (work / "uv.lock").write_text(LOCK.format(version=locked))
    if branch:
        _stub(
            bin_dir, "git", f'printf "%s\\trefs/heads/%s\\n" {branch} "$5"\n'
        )
    else:
        _stub(bin_dir, "git", "exit 2\n")
    _stub(bin_dir, "gh", f"echo {prs}\n")
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", _step("dedupe")],
        cwd=work,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "VERSION": version,
            "BRANCH": f"adopt/policyengine-{version}",
            "GITHUB_OUTPUT": str(output),
        },
        capture_output=True,
        text=True,
    )
    outputs = dict(
        line.split("=", 1) for line in output.read_text().splitlines()
    )
    return result.returncode, outputs, result.stdout + result.stderr


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
    code, outputs, log = _dedupe(tmp_path, version, locked=locked)
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
    code, outputs, _ = _dedupe(tmp_path, version, locked=locked)
    assert code == 0
    assert outputs == {"current": locked, "skip": "false", "orphan": ""}


def test_the_workflow_refuses_a_lock_without_a_plain_version(tmp_path):
    code, outputs, _ = _dedupe(tmp_path, "6.3.0", locked="6.3.0rc1")
    assert code != 0
    assert "skip" not in outputs


def test_a_branch_with_a_pull_request_is_left_alone(tmp_path):
    code, outputs, _ = _dedupe(tmp_path, "6.3.0", branch="a" * 40, prs="1")
    assert code == 0
    assert outputs["skip"] == "true"


def test_a_branch_left_without_a_pull_request_is_rebuilt(tmp_path):
    """Review finding 3: a run that pushed and then failed to open its pull
    request left a branch that every later run took for a proposal."""
    code, outputs, log = _dedupe(tmp_path, "6.3.0", branch="a" * 40, prs="0")
    assert code == 0
    assert outputs["skip"] == "false"
    assert outputs["orphan"] == "a" * 40
    assert "rebuilding it" in log


def _open_pr(tmp_path, *, orphan="", bundle='{"a":1}'):
    """Run the pull request step with stub git and gh; return its exit, the
    push commands and the body."""
    bin_dir, runner = tmp_path / "bin", tmp_path / "runner"
    bin_dir.mkdir()
    runner.mkdir()
    log, body = tmp_path / "git.log", tmp_path / "body.md"
    _stub(bin_dir, "git", f'echo "git $*" >> "{log}"\n')
    _stub(
        bin_dir,
        "gh",
        "while [ $# -gt 0 ]; do\n"
        f'  if [ "$1" = --body-file ]; then cp "$2" "{body}"; fi\n'
        "  shift\n"
        "done\n",
    )
    result = subprocess.run(
        [
            "bash",
            "-e",
            "-o",
            "pipefail",
            "-c",
            _step("Open the draft pull request"),
        ],
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
        },
        capture_output=True,
        text=True,
    )
    pushes = [
        line for line in log.read_text().splitlines() if " push " in line
    ]
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
