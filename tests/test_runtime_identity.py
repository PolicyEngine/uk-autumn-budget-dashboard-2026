"""The build commit a deploy reports.

Cloud Run's comes from the deploy (``_GIT_SHA``, checked against the
uploaded source). A Modal deploy copies files from the checkout it runs in,
so its commit is that checkout's HEAD, and only when every copied file has
exactly HEAD's bytes and nothing else is copied (``checkout_commit``). The
comparison reads the files and HEAD's tree, never git's index or status:
review of e78fbf4, finding 1.
"""

import os
import subprocess

import pytest

from uk_budget_data.runtime_identity import (
    DEPLOYED_PATHS,
    IMAGE_LEAVES_OUT,
    checkout_commit,
    checkout_differences,
)


def _git(root, *args):
    return subprocess.run(
        [
            "git",
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-C",
            str(root),
            *args,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


@pytest.fixture
def checkout(tmp_path):
    """A repository with each deployed path committed, an ignore rule like
    the project's, and a file outside the deployed paths."""
    root = tmp_path / "repo"
    (root / "src" / "uk_budget_data").mkdir(parents=True)
    (root / "data_inputs").mkdir()
    (root / "docs").mkdir()
    (root / ".python-version").write_text("3.13\n")
    (root / "pyproject.toml").write_text("[project]\nname = 'x'\n")
    (root / "uv.lock").write_text("version = 1\n")
    (root / "data_inputs" / "rates.csv").write_text("a,b\n")
    (root / "src" / "uk_budget_data" / "reforms.py").write_text("X = 1\n")
    (root / "docs" / "runbook.md").write_text("# Runbook\n")
    (root / ".gitignore").write_text("__pycache__/\n**/*.h5\n")
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


def test_a_clean_checkout_reports_its_head(checkout):
    assert checkout_commit(checkout) == _git(checkout, "rev-parse", "HEAD")


@pytest.mark.parametrize(
    "change",
    [
        "edited",
        "untracked",
        "ignored",
        "staged",
        "deleted",
    ],
)
@pytest.mark.parametrize("path", ["src/uk_budget_data", "data_inputs"])
def test_a_deployed_file_unlike_head_reports_no_commit(checkout, change, path):
    folder = checkout / path
    if change == "edited":
        next(folder.iterdir()).write_text("changed\n")
    elif change == "untracked":
        (folder / "new.py").write_text("Y = 2\n")
    elif change == "ignored":
        # Copied into the image like any other file, but in no commit
        (folder / "inputs.h5").write_bytes(b"\0")
    elif change == "staged":
        target = next(folder.iterdir())
        target.write_text("changed\n")
        _git(checkout, "add", str(target))
    else:
        next(folder.iterdir()).unlink()
    assert checkout_commit(checkout) is None


@pytest.mark.parametrize(
    "name", [".python-version", "pyproject.toml", "uv.lock"]
)
def test_each_top_level_deployed_file_counts(checkout, name):
    (checkout / name).write_text("changed\n")
    assert checkout_commit(checkout) is None


def test_files_the_image_leaves_out_do_not_count(checkout):
    head = _git(checkout, "rev-parse", "HEAD")
    cache = checkout / "src" / "uk_budget_data" / "__pycache__"
    cache.mkdir()
    (cache / "reforms.cpython-313.pyc").write_bytes(b"\0")
    (checkout / "docs" / "runbook.md").write_text("edited\n")
    (checkout / "notes.txt").write_text("untracked, not deployed\n")
    assert checkout_commit(checkout) == head


def test_no_repository_reports_no_commit(tmp_path):
    assert checkout_commit(tmp_path) is None
    assert checkout_differences(tmp_path) is None


# Review of e78fbf4, finding 1: git status can be told not to look at a
# tracked file, but Modal uploads the file's bytes all the same
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_an_edit_git_has_been_told_to_ignore_still_counts(checkout, flag):
    target = "src/uk_budget_data/reforms.py"
    _git(checkout, "update-index", flag, target)
    (checkout / target).write_text("X = 2\n")
    # git itself no longer sees the edit
    assert _git(checkout, "status", "--porcelain", "--", target) == ""
    assert checkout_differences(checkout) == [target]
    assert checkout_commit(checkout) is None


def test_a_cache_folder_counts_where_the_image_copies_it(checkout):
    # The image leaves __pycache__ out of src/uk_budget_data only; under
    # data_inputs it is uploaded like any other folder
    cache = checkout / "data_inputs" / "__pycache__"
    cache.mkdir()
    (cache / "x.pyc").write_bytes(b"\0")
    assert checkout_differences(checkout) == ["data_inputs/__pycache__/x.pyc"]
    assert checkout_commit(checkout) is None


def test_a_rename_counts_both_ways(checkout):
    old = checkout / "data_inputs" / "rates.csv"
    old.rename(checkout / "data_inputs" / "__pycache__rates.csv")
    assert checkout_differences(checkout) == [
        "data_inputs/__pycache__rates.csv",
        "data_inputs/rates.csv",
    ]


@pytest.mark.parametrize("kind", ["file", "folder"])
def test_a_symbolic_link_counts(checkout, kind):
    # git records a link; the upload carries what it points at
    target = checkout / "docs"
    link = checkout / "src" / "uk_budget_data" / "linked"
    if kind == "file":
        os.symlink(target / "runbook.md", link)
    else:
        os.symlink(target, link)
    assert checkout_differences(checkout) == ["src/uk_budget_data/linked"]
    assert checkout_commit(checkout) is None


def test_a_committed_symbolic_link_counts(checkout):
    os.symlink("reforms.py", checkout / "src" / "uk_budget_data" / "alias.py")
    _git(checkout, "add", "-A")
    _git(checkout, "commit", "-q", "-m", "link")
    assert checkout_differences(checkout) == ["src/uk_budget_data/alias.py"]
    assert checkout_commit(checkout) is None


def test_a_mode_change_alone_does_not_count(checkout):
    # The upload carries bytes, which a mode change leaves alone
    head = _git(checkout, "rev-parse", "HEAD")
    os.chmod(checkout / "src" / "uk_budget_data" / "reforms.py", 0o755)
    assert checkout_commit(checkout) == head


def test_an_identical_rewrite_does_not_count(checkout):
    # Same bytes, new timestamp: still HEAD's
    head = _git(checkout, "rev-parse", "HEAD")
    target = checkout / "data_inputs" / "rates.csv"
    target.write_bytes(target.read_bytes())
    assert checkout_commit(checkout) == head


def test_only_head_s_tree_matters_not_the_index(
    checkout,
):
    # A committed file the image copies is now ignored and removed from the
    # index: status shows it as deleted, the copy still has it. Compared
    # with HEAD's tree it is the same file, so it doesn't count
    head = _git(checkout, "rev-parse", "HEAD")
    _git(checkout, "rm", "-q", "--cached", "data_inputs/rates.csv")
    assert checkout_commit(checkout) == head


def test_the_deployed_paths_are_what_the_modal_image_copies():
    # modal_household.build_image needs modal, which the tests don't
    # install: read what it copies from its source instead
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "uk_budget_data"
        / "modal_household.py"
    ).read_text()
    for copied in (
        'root / ".python-version"',
        "uv_sync(str(root)",
        'root / "data_inputs"',
        'root / "src" / "uk_budget_data"',
    ):
        assert copied in source
    assert set(DEPLOYED_PATHS) == {
        ".python-version",
        "pyproject.toml",
        "uv.lock",
        "data_inputs",
        "src/uk_budget_data",
    }
    assert '"GIT_SHA": commit or ""' in source
    assert "checkout_commit(root)" in source
    # The folders the image leaves out are the ones the comparison skips
    assert IMAGE_LEAVES_OUT == {"src/uk_budget_data": "__pycache__"}
    assert source.count("ignore=") == 1
    assert 'ignore=["**/__pycache__/**"]' in source
