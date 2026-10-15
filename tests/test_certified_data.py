"""Tests for the certified-data credential check and fail-not-skip policy."""

import hashlib
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from huggingface_hub.errors import HfHubHTTPError
from hypothesis import assume, example, given
from hypothesis import strategies as st

from uk_budget_data.certified_data import (
    Artifact,
    CertifiedDataAccessError,
    check_access,
    load_bundle_manifest,
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
