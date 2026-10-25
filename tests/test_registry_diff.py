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
    assert result["changed"] == ["rate_change", "fares", "added"]
    assert result["removed"] == ["dropped"]
    assert result["combined"] is True
    assert result["core"] == []


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


# A package-shaped repository: a measure's definition spread over
# reforms.py, budget_measures.py and measure_templates.py, as on main.
PACKAGE_FILES = {
    "__init__.py": "",
    "measure_templates.py": """
def apply_payment(sim, amount):
    return sim + amount


def apply_rate(sim, rate):
    return sim * rate
""",
    "budget_measures.py": """
from uk_budget_data.measure_templates import apply_payment, apply_rate


def warm_home_discount_top_up(sim):
    return apply_payment(sim, 100)


def winter_fuel_top_up(sim):
    return apply_payment(sim, 200)


def electricity_vat(sim):
    return apply_rate(sim, 0.95)
""",
    "reforms.py": """
from uk_budget_data import budget_measures
from uk_budget_data.models import Reform


def get_autumn_budget_2026_reforms():
    return [
        Reform(
            id="warm_home_discount_top_up",
            name="WHD",
            simulation_modifier=budget_measures.warm_home_discount_top_up,
        ),
        Reform(
            id="winter_fuel_top_up",
            name="Winter fuel",
            simulation_modifier=budget_measures.winter_fuel_top_up,
        ),
        Reform(
            id="electricity_vat",
            name="Electricity VAT",
            simulation_modifier=budget_measures.electricity_vat,
        ),
        Reform(
            id="threshold_freeze",
            name="Freeze",
            parameter_changes={"gov.a": {"2031": 1}},
        ),
    ]
""",
    "pipeline.py": "STEPS = 1\n",
    "household_impact.py": "ROUTE = 'a'\n",
}
ALL = [
    "warm_home_discount_top_up",
    "winter_fuel_top_up",
    "electricity_vat",
    "threshold_freeze",
]


def _package_repo(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("needs git")
    repo = tmp_path / "repo"
    package = repo / rd.PACKAGE_PATH
    package.mkdir(parents=True)
    for name, text in PACKAGE_FILES.items():
        (package / name).write_text(text)

    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
            + list(args),
            cwd=repo,
            check=True,
            capture_output=True,
        )

    git("init", "-q")
    git("add", ".")
    git("commit", "-q", "-m", "base")
    return repo, package, git


def _edit(package, name, old, new):
    path = package / name
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


def test_a_change_only_in_a_modifier_runs_just_its_measure(tmp_path):
    repo, package, git = _package_repo(tmp_path)
    _edit(package, "budget_measures.py", "sim, 100)", "sim, 150)")
    git("commit", "-q", "-am", "WHD top-up to 150")
    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result["changed"] == ["warm_home_discount_top_up"]
    assert result["core"] == []
    assert result["combined"] is True
    assert result["files"]["warm_home_discount_top_up"] == [
        "src/uk_budget_data/budget_measures.py",
        "src/uk_budget_data/measure_templates.py",
        "src/uk_budget_data/reforms.py",
    ]


def test_a_change_to_a_shared_template_runs_every_measure_using_it(tmp_path):
    repo, package, git = _package_repo(tmp_path)
    _edit(package, "measure_templates.py", "sim + amount", "sim + 2 * amount")
    git("commit", "-q", "-am", "payment template")
    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result["changed"] == [
        "warm_home_discount_top_up",
        "winter_fuel_top_up",
    ]


def test_a_core_change_runs_every_measure_and_the_combined_run(tmp_path):
    repo, package, git = _package_repo(tmp_path)
    _edit(package, "pipeline.py", "STEPS = 1", "STEPS = 2")
    git("commit", "-q", "-am", "pipeline")
    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result["changed"] == ALL
    assert result["core"] == ["src/uk_budget_data/pipeline.py"]
    assert result["combined"] is True


def test_a_change_no_measure_reaches_runs_nothing(tmp_path):
    repo, package, git = _package_repo(tmp_path)
    _edit(package, "household_impact.py", "'a'", "'b'")
    git("commit", "-q", "-am", "household route")
    result = rd.changed_between("HEAD^", "HEAD", repo)
    assert result["changed"] == []
    assert result["combined"] is False


def test_core_paths_match_files_and_folders():
    assert rd.core_changes(
        [
            "uv.lock",
            "src/uk_budget_data/publication/generate.py",
            "src/uk_budget_data/budget_measures.py",
            "docs/budget-day-runbook.md",
        ]
    ) == ["uv.lock", "src/uk_budget_data/publication/generate.py"]
