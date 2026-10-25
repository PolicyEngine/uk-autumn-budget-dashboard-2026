"""The build commit a deploy reports.

Cloud Run's comes from the deploy (``_GIT_SHA``, checked against the
uploaded source). A Modal deploy copies files from the checkout it runs in,
so its commit is that checkout's HEAD, and only when the copied files are
exactly HEAD's (``checkout_commit``).
"""

import subprocess

import pytest

from uk_budget_data.runtime_identity import DEPLOYED_PATHS, checkout_commit


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
