"""Changed-measure detection for the publish-measure workflow (#105)."""

import shutil
import subprocess
from pathlib import Path

import pytest

from uk_budget_data import registry_diff as rd

FIXTURES = Path(__file__).parent / "fixtures" / "registry"
COMBINED = "autumn_budget_2026_combined"


@pytest.fixture(scope="module")
def prints():
    return {
        name: rd.fingerprints_in_subprocess(FIXTURES / f"{name}.py")
        for name in ("before", "after")
    }


def test_changed_ids_lists_added_and_changed_measures_in_registry_order(
    prints,
):
    changed = rd.changed_ids(prints["before"], prints["after"], COMBINED)
    # kept moved but did not change; the combined run is never a measure
    assert changed == ["rate_change", "fares", "added"]


def test_a_constant_the_modifier_reads_changes_its_measure(prints):
    assert prints["before"]["fares"] != prints["after"]["fares"]
    assert prints["before"]["kept"] == prints["after"]["kept"]


def test_removed_measures_are_named_not_published(prints):
    assert rd.removed_ids(prints["before"], prints["after"]) == ["dropped"]


def test_fingerprints_are_stable_across_processes():
    first = rd.fingerprints_in_subprocess(FIXTURES / "before.py")
    second = rd.fingerprints_in_subprocess(FIXTURES / "before.py")
    assert first == second


def test_changed_between_compares_head_with_its_parent(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("needs git")
    repo = tmp_path / "repo"
    registry = repo / rd.REGISTRY_PATH
    registry.parent.mkdir(parents=True)

    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
            + list(args),
            cwd=repo,
            check=True,
            capture_output=True,
        )

    git("init", "-q")
    shutil.copy(FIXTURES / "before.py", registry)
    git("add", ".")
    git("commit", "-q", "-m", "before")
    shutil.copy(FIXTURES / "after.py", registry)
    git("commit", "-q", "-am", "after")

    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result == {
        "changed": ["rate_change", "fares", "added"],
        "removed": ["dropped"],
    }


def test_a_registry_new_at_head_publishes_every_measure(tmp_path):
    repo = tmp_path / "repo"
    registry = repo / rd.REGISTRY_PATH
    registry.parent.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    shutil.copy(FIXTURES / "after.py", registry)
    # HEAD^ does not exist, and HEAD is the working file's commit: both are
    # read through git, so an unborn base counts as an empty registry.
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "commit",
            "-q",
            "-m",
            "first",
        ],
        cwd=repo,
        check=True,
    )
    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result["changed"] == ["rate_change", "kept", "fares", "added"]
