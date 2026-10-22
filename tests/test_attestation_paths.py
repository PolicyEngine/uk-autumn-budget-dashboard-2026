"""Attestation paths must name the same regular file in Git and on disk."""

import os
import subprocess
from types import SimpleNamespace

import pytest

from tests.test_publication_hardening_unit import modules as modules


@pytest.fixture
def committed_review(modules, tmp_path, monkeypatch):  # noqa: F811
    repository = tmp_path / "repository"
    repository.mkdir()
    monkeypatch.setattr(
        modules.attestation, "ATTESTATION_REPOSITORY", repository
    )
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("GIT_")
    }

    def git(*arguments):
        subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "-c",
                "user.name=Attestation paths",
                "-c",
                "user.email=attestation-paths@example.invalid",
                "-c",
                "commit.gpgSign=false",
                "-c",
                "core.hooksPath=/dev/null",
                *arguments,
            ],
            check=True,
            capture_output=True,
            env=environment,
        )

    path = repository / "review.json"
    contents = b'{"measure_id":"alpha"}'
    path.write_bytes(contents)
    git("init")
    git("add", "--", path.name)
    git("commit", "-m", "Commit review input")
    return SimpleNamespace(
        module=modules.attestation, path=path, contents=contents, git=git
    )


def test_the_exact_regular_committed_file_is_accepted(committed_review):
    review = committed_review
    review.module._committed_bytes(review.path, review.contents)


def test_an_untracked_leaf_alias_cannot_substitute_a_committed_file(
    committed_review,
):
    review = committed_review
    alias = review.path.with_name("alpha.json")
    alias.symlink_to(review.path.name)
    with pytest.raises(ValueError, match="not committed in local Git HEAD"):
        review.module._committed_bytes(alias, alias.read_bytes())


def test_a_symlink_ancestor_cannot_substitute_a_committed_path(
    committed_review,
):
    review = committed_review
    alias = review.path.parent / "alias"
    alias.symlink_to(".", target_is_directory=True)
    with pytest.raises(ValueError, match="not committed in local Git HEAD"):
        review.module._committed_bytes(
            alias / review.path.name, review.contents
        )


def test_matching_bytes_do_not_make_a_committed_symlink_a_regular_file(
    committed_review,
):
    review = committed_review
    path = review.path.with_name("alpha.json")
    path.symlink_to(review.contents.decode())
    review.git("add", "--", path.name)
    review.git("commit", "-m", "Commit a symlink input")
    path.unlink()
    path.write_bytes(review.contents)
    with pytest.raises(ValueError, match="not committed in local Git HEAD"):
        review.module._committed_bytes(path, path.read_bytes())


@pytest.mark.parametrize("ancestor", [False, True])
def test_a_working_symlink_cannot_replace_the_exact_committed_path(
    committed_review, ancestor
):
    review = committed_review
    directory = review.path.parent
    if ancestor:
        directory = directory / "reviews"
        directory.mkdir()
    path = directory / "alpha.json"
    path.write_bytes(review.contents)
    relative = path.relative_to(review.path.parent).as_posix()
    review.git("add", "--", relative)
    review.git("commit", "-m", "Commit exact attestation path")
    if ancestor:
        directory.rename(directory.with_name("moved"))
        directory.symlink_to("moved", target_is_directory=True)
    else:
        path.unlink()
        path.symlink_to(review.path.name)
    with pytest.raises(ValueError, match="not committed in local Git HEAD"):
        review.module._committed_bytes(path, path.read_bytes())
