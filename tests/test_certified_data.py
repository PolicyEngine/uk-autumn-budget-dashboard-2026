"""Tests for the certified-data credential check and fail-not-skip policy."""

import hashlib
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import yaml
from huggingface_hub.errors import HfHubHTTPError
from hypothesis import assume, example, given
from hypothesis import strategies as st

from tests.publication_support import SMALL_DATASET_NAME
from uk_budget_data.certified_data import (
    Artifact,
    CertifiedDataAccessError,
    check_access,
    load_bundle_manifest,
    main,
    token_fingerprint,
    uk_artifacts,
)

pytest_plugins = ["pytester"]

SHA_A = "a" * 64
SHA_B = "b" * 64

MANIFEST = {
    "data_releases": {
        "uk": {
            "default_dataset": "enhanced",
            "data_package": {"repo_type": "model"},
            "datasets": {
                "enhanced": {
                    "repo_id": "org/private",
                    "path": "enhanced.h5",
                    "revision": "1.0.0",
                    "sha256": SHA_A,
                },
                "weights": {
                    "repo_id": "org/private",
                    "path": "weights.h5",
                    "revision": "1.0.0",
                    "sha256": SHA_B,
                },
            },
        }
    }
}


def http_error(message, status=401):
    request = httpx.Request("GET", "https://huggingface.co/api/whoami-v2")
    return HfHubHTTPError(
        message, response=httpx.Response(status, request=request)
    )


class FakeApi:
    """Records calls and serves canned Hugging Face metadata."""

    def __init__(self, files=None, reject_token=False, deny_repo=False):
        self.files = files or {}
        self.reject_token = reject_token
        self.deny_repo = deny_repo
        self.tokens_seen = []

    def whoami(self, token):
        self.tokens_seen.append(token)
        if self.reject_token:
            raise http_error("Invalid user token.")
        return {"name": "ci-bot"}

    def get_paths_info(self, repo_id, paths, revision, repo_type, token):
        self.tokens_seen.append(token)
        if self.deny_repo:
            raise http_error("401 Client Error: gated repo")
        return [
            SimpleNamespace(path=p, lfs=SimpleNamespace(sha256=self.files[p]))
            for p in paths
            if p in self.files
        ]


def artifacts():
    return uk_artifacts(MANIFEST)


def test_uk_artifacts_lists_every_pinned_dataset():
    assert artifacts() == [
        Artifact(
            "enhanced", "org/private", "model", "enhanced.h5", "1.0.0", SHA_A
        ),
        Artifact(
            "weights", "org/private", "model", "weights.h5", "1.0.0", SHA_B
        ),
    ]


def test_uk_artifacts_rejects_missing_default():
    manifest = {
        "data_releases": {
            "uk": {**MANIFEST["data_releases"]["uk"], "default_dataset": "x"}
        }
    }
    with pytest.raises(CertifiedDataAccessError, match="default dataset"):
        uk_artifacts(manifest)


def test_installed_bundle_pins_a_uk_default_dataset():
    pinned = uk_artifacts(load_bundle_manifest())
    assert pinned
    assert all(len(a.sha256) == 64 for a in pinned)


# A data package of type dataset, so an entry that names no type can't pass
# for one that defaults to model.
PACKAGE = {
    "repo_id": "org/private",
    "repo_type": "dataset",
    "version": "1.0.0",
    "release_manifest_revision": "cut-1",
}
OVERLAYS = {
    "tiny": {
        "repo_id": "org/old",
        "repo_type": "model",
        "path": "tiny.h5",
        "revision": "2.0.0",
        "sha256": SHA_A,
    },
    # Only a path and a hash: the data package supplies the rest.
    "bare": {"path": "bare.h5", "sha256": SHA_B},
}
WITH_OVERLAYS = {
    "data_releases": {
        "uk": {**MANIFEST["data_releases"]["uk"], "data_package": PACKAGE}
    },
    "dataset_overlays": {"uk": OVERLAYS},
}


def release():
    return uk_artifacts(WITH_OVERLAYS)


def test_also_adds_a_named_overlay_located_as_policyengine_locates_it():
    assert uk_artifacts(WITH_OVERLAYS, ("tiny", "bare"))[2:] == [
        Artifact("bare", "org/private", "dataset", "bare.h5", "cut-1", SHA_B),
        Artifact("tiny", "org/old", "model", "tiny.h5", "2.0.0", SHA_A),
    ]


def test_the_package_version_stands_in_for_a_missing_release_cut():
    package = {**PACKAGE, "release_manifest_revision": None}
    manifest = {
        **WITH_OVERLAYS,
        "data_releases": {
            "uk": {
                **WITH_OVERLAYS["data_releases"]["uk"],
                "data_package": package,
            }
        },
    }
    (bare,) = uk_artifacts(manifest, ("bare",))[2:]
    assert bare.revision == "1.0.0"


@pytest.mark.parametrize("field", ["path", "sha256"])
def test_an_entry_missing_what_no_package_supplies_is_refused(field):
    entry = {**OVERLAYS["tiny"], field: None}
    manifest = {**WITH_OVERLAYS, "dataset_overlays": {"uk": {"tiny": entry}}}
    with pytest.raises(
        CertifiedDataAccessError, match=f"'tiny' pins no {field}"
    ):
        uk_artifacts(manifest, ("tiny",))


def test_a_repository_neither_the_entry_nor_the_package_names_is_refused():
    with pytest.raises(
        CertifiedDataAccessError, match="'bare' pins no repo_id"
    ):
        uk_artifacts(
            {**MANIFEST, "dataset_overlays": {"uk": OVERLAYS}}, ("bare",)
        )


def test_also_lists_a_release_dataset_once():
    assert uk_artifacts(WITH_OVERLAYS, ("weights",)) == release()


@pytest.mark.parametrize("manifest", [MANIFEST, WITH_OVERLAYS])
def test_also_refuses_a_dataset_the_bundle_does_not_pin(manifest):
    with pytest.raises(CertifiedDataAccessError, match="'nope'"):
        uk_artifacts(manifest, ("nope",))


@given(st.lists(st.sampled_from(["enhanced", "weights", "tiny", "bare"])))
def test_also_adds_each_named_overlay_once_after_the_release(names):
    listed = uk_artifacts(WITH_OVERLAYS, tuple(names))
    assert listed[:2] == release()
    assert [a.name for a in listed[2:]] == sorted(set(names) & set(OVERLAYS))


def test_every_installed_dataset_is_located_as_policyengine_locates_it():
    """Differential: on the installed bundle, every release dataset and
    overlay names the repository, type, file, revision and hash that
    policyengine itself downloads and checks."""
    from policyengine.provenance.manifest import (
        get_release_manifest,
        resolve_dataset_reference,
    )

    country = get_release_manifest("uk")
    names = tuple(country.datasets)
    located = {a.name: a for a in uk_artifacts(load_bundle_manifest(), names)}
    assert set(located) == set(names)
    for name, reference in country.datasets.items():
        artifact = located[name]
        assert resolve_dataset_reference("uk", name) == (
            f"hf://{artifact.repo_id}/{artifact.path}@{artifact.revision}"
        )
        assert artifact.repo_type == (
            reference.repo_type or country.data_package.repo_type
        )
        assert artifact.sha256 == reference.sha256


def test_the_command_refuses_an_unpinned_dataset_before_any_request(
    monkeypatch, capsys
):
    monkeypatch.delenv("HUGGING_FACE_TOKEN", raising=False)
    assert main(["--also", "nope"]) == 1
    assert "pins no UK dataset or overlay 'nope'" in capsys.readouterr().err


def test_ci_checks_the_small_dataset_the_certified_tests_read():
    """The access step names the small dataset the certified-data tests
    download (SMALL_DATASET_NAME, an overlay from 6.10.0), so a token that
    cannot read its repository fails there, with the hint, not mid-run."""
    workflow = (
        Path(__file__).resolve().parent.parent / ".github/workflows/ci.yml"
    )
    steps = yaml.safe_load(workflow.read_text())["jobs"]["certified-data"][
        "steps"
    ]
    (check,) = [
        step
        for step in steps
        if "uk_budget_data.certified_data" in step.get("run", "")
    ]
    assert f"--also {SMALL_DATASET_NAME}" in check["run"]
    pinned = uk_artifacts(load_bundle_manifest(), (SMALL_DATASET_NAME,))
    assert SMALL_DATASET_NAME in [a.name for a in pinned]


@pytest.mark.parametrize("token", [None, ""])
def test_missing_token_fails_with_hint(token):
    with pytest.raises(CertifiedDataAccessError, match="not set") as error:
        check_access(token, artifacts(), api=FakeApi())
    assert "PE_UK_PRIVATE_HF_READ_TOKEN" in str(error.value)


def test_rejected_token_fails_without_leaking_it():
    token = "hf_secret_value"
    with pytest.raises(CertifiedDataAccessError, match="rejected") as error:
        check_access(token, artifacts(), api=FakeApi(reject_token=True))
    assert token not in str(error.value)
    assert token_fingerprint(token) in str(error.value)


def test_repo_access_denied_fails():
    with pytest.raises(CertifiedDataAccessError, match="cannot read"):
        check_access("hf_x", artifacts(), api=FakeApi(deny_repo=True))


def test_missing_file_fails():
    api = FakeApi(files={"enhanced.h5": SHA_A})
    with pytest.raises(CertifiedDataAccessError, match="no file weights.h5"):
        check_access("hf_x", artifacts(), api=api)


def test_hash_mismatch_fails():
    api = FakeApi(files={"enhanced.h5": SHA_A, "weights.h5": SHA_A})
    with pytest.raises(CertifiedDataAccessError, match="bundle pins"):
        check_access("hf_x", artifacts(), api=api)


def test_success_logs_each_artifact_and_never_the_token():
    token = "hf_secret_value"
    api = FakeApi(files={"enhanced.h5": SHA_A, "weights.h5": SHA_B})
    lines = check_access(token, artifacts(), api=api)
    assert len(lines) == 3
    assert all(token not in line for line in lines)
    assert set(api.tokens_seen) == {token}


tokens = st.text(
    alphabet=st.characters(min_codepoint=33, max_codepoint=126),
    min_size=8,
    max_size=64,
)


# Every way check_access ends: the API each meets, by name.
OUTCOMES = {
    "success": {"files": {"enhanced.h5": SHA_A, "weights.h5": SHA_B}},
    "rejected token": {
        "files": {"enhanced.h5": SHA_A, "weights.h5": SHA_B},
        "reject_token": True,
    },
    "denied repository": {
        "files": {"enhanced.h5": SHA_A, "weights.h5": SHA_B},
        "deny_repo": True,
    },
    "missing file": {"files": {"enhanced.h5": SHA_A}},
    "hash mismatch": {"files": {"enhanced.h5": SHA_A, "weights.h5": SHA_A}},
}


def outcome(token, case):
    """The log lines, or the error, that ``check_access`` gives."""
    try:
        return "\n".join(
            check_access(token, artifacts(), api=FakeApi(**OUTCOMES[case]))
        )
    except CertifiedDataAccessError as error:
        return str(error)


def masked(text, token):
    """The text with the token's fingerprint blanked out by a character no
    token holds, so a token cannot run on into or out of the blank."""
    return text.replace(token_fingerprint(token), "\0")


@given(token=tokens, other=tokens, case=st.sampled_from(sorted(OUTCOMES)))
# A token that is part of the fixed wording ("token fingerprint"): it is in
# every token's text, so it says nothing about the token.
@example(token="fingerpr", other="hf_another_token", case="success")
def test_no_outcome_ever_contains_the_token(token, other, case):
    """Whatever happens, logs and errors depend on the token only through
    its fingerprint, the first 12 hex digits of its SHA-256: blank the
    fingerprint out and two tokens' texts are the same. So nothing in the
    text comes from the token but its fingerprint."""
    assume(other != token)
    assert token_fingerprint(token) == (
        hashlib.sha256(token.encode()).hexdigest()[:12]
    )
    assert masked(outcome(token, case), token) == masked(
        outcome(other, case), other
    )


CONFTEST = Path(__file__).with_name("conftest.py").read_text()

MARKED_TESTS = """
import pytest

@pytest.mark.certified_data
def test_needs_data():
    assert True

def test_plain():
    assert True
"""

SELF_SKIPPING_TEST = """
import pytest

@pytest.mark.certified_data
def test_skips_itself():
    pytest.skip("dataset year not available")
"""


@pytest.fixture(params=[(), ("-n", "2")], ids=["serial", "xdist"])
def workers(request):
    """Run each isolated session serially and on pytest-xdist workers, whose
    main process sees the test reports but never the test items."""
    return request.param


def run_isolated(pytester, monkeypatch, body, token, required, workers):
    pytester.makeconftest(CONFTEST)
    pytester.makepyfile(body)
    for name, value in (
        ("HUGGING_FACE_TOKEN", token),
        ("REQUIRE_CERTIFIED_DATA", "1" if required else None),
    ):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    return pytester.runpytest_subprocess("-p", "no:cacheprovider", *workers)


def test_missing_token_skips_locally(pytester, monkeypatch, workers):
    result = run_isolated(
        pytester, monkeypatch, MARKED_TESTS, None, False, workers
    )
    result.assert_outcomes(passed=1, skipped=1)
    assert result.ret == 0


def test_missing_token_fails_when_required(pytester, monkeypatch, workers):
    result = run_isolated(
        pytester, monkeypatch, MARKED_TESTS, None, True, workers
    )
    # pytest.fail during setup is reported as an error; either fails CI.
    result.assert_outcomes(passed=1, errors=1)
    assert result.ret != 0


def test_token_runs_marked_tests(pytester, monkeypatch, workers):
    result = run_isolated(
        pytester, monkeypatch, MARKED_TESTS, "hf_x", True, workers
    )
    result.assert_outcomes(passed=2)
    assert result.ret == 0


def test_any_certified_skip_fails_session_when_required(
    pytester, monkeypatch, workers
):
    result = run_isolated(
        pytester, monkeypatch, SELF_SKIPPING_TEST, "hf_x", True, workers
    )
    result.assert_outcomes(skipped=1)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*certified-data tests skipped*"])


def test_certified_skip_allowed_locally(pytester, monkeypatch, workers):
    result = run_isolated(
        pytester, monkeypatch, SELF_SKIPPING_TEST, "hf_x", False, workers
    )
    result.assert_outcomes(skipped=1)
    assert result.ret == 0


MODULE_SKIPPED_WHILE_COLLECTING = """
import pytest

pytest.skip("cannot import the dataset helpers", allow_module_level=True)

@pytest.mark.certified_data
def test_never_collected():
    assert True
"""


def test_a_module_skipped_while_collecting_fails_when_required(
    pytester, monkeypatch, workers
):
    result = run_isolated(
        pytester,
        monkeypatch,
        MODULE_SKIPPED_WHILE_COLLECTING,
        "hf_x",
        True,
        workers,
    )
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*skipped while collecting*"])


def test_a_module_skipped_while_collecting_is_allowed_locally(
    pytester, monkeypatch, workers
):
    result = run_isolated(
        pytester,
        monkeypatch,
        MODULE_SKIPPED_WHILE_COLLECTING,
        "hf_x",
        False,
        workers,
    )
    assert result.ret in (0, pytest.ExitCode.NO_TESTS_COLLECTED)
