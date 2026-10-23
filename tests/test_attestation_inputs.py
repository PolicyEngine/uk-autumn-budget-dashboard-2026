"""Release inputs must be committed bytes, rather than a local draft."""

import json
import subprocess

import pytest

from tests.publication_support import World
from uk_budget_data.publication import attestations as a


@pytest.fixture
def review(tmp_path, monkeypatch):
    directory = tmp_path / "attestations"
    directory.mkdir()
    monkeypatch.setattr(a, "ATTESTATIONS_ROOT", directory)
    monkeypatch.setattr(a, "ATTESTATION_REPOSITORY", directory)
    document = {"dashboard": {"key": "alpha"}}
    record = {
        "measure_id": "alpha",
        "receipt_sha256": a.receipt_document_sha256(document),
        "reason": "The change only affects income tax rates.",
        "checker": "María",
        "second": "Vahid",
        "released_at": "2026-10-22T10:30:00Z",
    }
    path = directory / "alpha.json"
    path.write_text(json.dumps(record))
    return document, record, path


def test_a_review_without_a_git_repository_stays_held(review):
    document, _, _ = review
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_an_untracked_review_stays_held(review):
    document, _, path = review
    other = path.with_name("other.json")
    other.write_text("{}")
    World.commit_attestation(other)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_the_exact_committed_review_releases_its_receipt(review):
    document, record, path = review
    World.commit_attestation(path)
    attestation, problems = a.load_attestation(document)
    assert problems == []
    assert attestation == a.Attestation.model_validate(record)


def test_an_untracked_symlink_cannot_borrow_another_files_commit(review):
    document, _, path = review
    other = path.with_name("other.json")
    path.rename(other)
    World.commit_attestation(other)
    path.symlink_to(other.name)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_a_symlink_ancestor_cannot_alias_a_committed_review(
    review, monkeypatch
):
    document, _, path = review
    World.commit_attestation(path)
    alias = path.parent / "alias"
    alias.symlink_to(".", target_is_directory=True)
    monkeypatch.setattr(a, "ATTESTATIONS_ROOT", alias)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_a_committed_symlink_replaced_by_regular_json_stays_held(review):
    document, record, path = review
    World.commit_attestation(path)
    record.update(reason="r", checker="a", second="b")
    contents = json.dumps(record, separators=(",", ":"))
    # A Git symlink blob contains its target's name. Make that name itself
    # valid review JSON, so checking bytes alone cannot prove a regular file.
    path.unlink()
    path.symlink_to(contents)
    for arguments in [
        ["add", "--", path.name],
        [
            "-c",
            "user.name=Attestation tests",
            "-c",
            "user.email=attestations@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-m",
            "Commit symlink test input",
        ],
    ]:
        subprocess.run(
            ["git", "-C", str(path.parent), *arguments],
            check=True,
            capture_output=True,
        )
    path.unlink()
    path.write_text(contents)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_a_nested_repository_cannot_release_an_untracked_dashboard_input(
    review, monkeypatch
):
    document, record, path = review
    tracked = path.with_name("other.json")
    tracked.write_text("{}")
    World.commit_attestation(tracked)
    nested = path.parent / "nested"
    nested.mkdir()
    nested_input = nested / path.name
    nested_input.write_text(json.dumps(record))
    World.commit_attestation(nested_input)
    monkeypatch.setattr(a, "ATTESTATIONS_ROOT", nested)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


def test_the_expected_repository_must_be_the_dashboard_git_root(
    review, monkeypatch
):
    document, _, path = review
    World.commit_attestation(path)
    child = path.parent / "child"
    child.mkdir()
    monkeypatch.setattr(a, "ATTESTATION_REPOSITORY", child)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "not committed in local Git HEAD" in problem for problem in problems
    )


@pytest.mark.parametrize("staged", [False, True])
def test_a_modified_review_stays_held_even_when_staged(review, staged):
    document, record, path = review
    World.commit_attestation(path)
    # Even a formatting-only edit is not the exact input that was committed.
    path.write_text(json.dumps(record, indent=2))
    if staged:
        subprocess.run(
            ["git", "-C", str(path.parent), "add", "--", path.name], check=True
        )
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any("differs from its committed" in problem for problem in problems)


@pytest.mark.parametrize("contents", ["{", "null", "[]", '"release"', "{}"])
def test_committing_malformed_json_never_releases_a_hold(review, contents):
    document, _, path = review
    path.write_text(contents)
    World.commit_attestation(path)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert problems
    assert not any("not committed" in problem for problem in problems)


def test_a_committed_review_for_another_digest_stays_held(review):
    document, record, path = review
    record["receipt_sha256"] = "f" * 64
    path.write_text(json.dumps(record))
    World.commit_attestation(path)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any("current receipt" in problem for problem in problems)


def test_a_committed_review_requires_the_exact_measure_id(review):
    document, record, path = review
    record["measure_id"] = " alpha "
    path.write_text(json.dumps(record))
    World.commit_attestation(path)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any("measure_id does not match" in problem for problem in problems)


@pytest.mark.parametrize(
    "timestamp",
    ["0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"],
)
def test_a_committed_timestamp_that_overflows_utc_stays_held(
    review, timestamp
):
    document, record, path = review
    record["released_at"] = timestamp
    path.write_text(json.dumps(record))
    World.commit_attestation(path)
    attestation, problems = a.load_attestation(document)
    assert attestation is None
    assert any(
        "timestamp cannot be represented in UTC" in problem
        for problem in problems
    )


def test_the_fixture_helper_commits_only_the_requested_input(review):
    _, _, path = review
    dataset = path.with_name("dataset.h5")
    dataset.write_bytes(b"test dataset must stay untracked")
    artifact = path.parent / "artifacts" / "receipt.json"
    artifact.parent.mkdir()
    artifact.write_text("{}")
    World.commit_attestation(path)
    tracked = subprocess.run(
        ["git", "-C", str(path.parent), "ls-tree", "--name-only", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert tracked == [path.name]


def test_the_fixture_helper_never_uses_external_git_metadata(review):
    _, _, path = review
    (path.parent / ".git").write_text("gitdir: /unrelated/repository\n")
    with pytest.raises(ValueError, match="local Git metadata"):
        World.commit_attestation(path)
