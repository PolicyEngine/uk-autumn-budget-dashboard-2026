"""The workflow that deploys the household impact app to Modal.

As deploy-api.yml does for Cloud Run: it runs by hand only, from main,
deploys only a full commit on main, and passes inputs to scripts only
through the environment. The Modal credentials reach the deploy step and
no other. After deploying, it checks the deployed URL.
"""

import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO / ".github" / "workflows" / "deploy-household-impact.yml"
COMMIT = "a" * 40
MODULE = "src/uk_budget_data/modal_household.py"


@pytest.fixture(scope="module")
def workflow():
    return yaml.safe_load(WORKFLOW_PATH.read_text())


def steps(workflow):
    return [step for job in workflow["jobs"].values() for step in job["steps"]]


def step(workflow, name):
    (found,) = [s for s in steps(workflow) if s.get("name") == name]
    return found


def test_it_runs_by_hand_only(workflow):
    # PyYAML reads the "on" key as True
    triggers = workflow.get("on", workflow.get(True))
    assert set(triggers) == {"workflow_dispatch"}


def test_no_input_reaches_a_script_except_through_the_environment(workflow):
    for s in steps(workflow):
        assert "${{" not in s.get("run", ""), s.get("name")


def test_the_modal_credentials_reach_the_deploy_step_only(workflow):
    deploy = step(workflow, "Deploy to Modal")
    assert deploy["env"]["MODAL_TOKEN_ID"] == "${{ secrets.MODAL_TOKEN_ID }}"
    assert (
        deploy["env"]["MODAL_TOKEN_SECRET"]
        == "${{ secrets.MODAL_TOKEN_SECRET }}"
    )
    text = yaml.safe_dump(workflow)
    assert text.count("secrets.MODAL_TOKEN_ID") == 1
    assert text.count("secrets.MODAL_TOKEN_SECRET") == 1
    for job in workflow["jobs"].values():
        assert "MODAL_TOKEN_ID" not in job.get("env", {})


def test_it_deploys_the_modal_module_and_then_checks_the_url(workflow):
    deploy = step(workflow, "Deploy to Modal")
    assert "modal deploy" in deploy["run"] and MODULE in deploy["run"]
    assert (REPO / MODULE).exists()
    check = step(workflow, "Check the deployed app")
    assert "uk_budget_data.household_impact_smoke" in check["run"]
    assert check["env"]["BASE_URL"] == "${{ steps.deploy.outputs.url }}"
    names = [s.get("name") for s in steps(workflow)]
    assert names.index("Choose the commit") < names.index("Deploy to Modal")
    assert names.index("Deploy to Modal") < names.index(
        "Check the deployed app"
    )


# --- the commit check, run with a stand-in git -----------------------------

FAKE_GIT = """#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
on_main = os.environ.get("FAKE_ON_MAIN", "").split()
if args[:2] == ["merge-base", "--is-ancestor"]:
    sys.exit(0 if args[2] in on_main else 1)
sys.exit(0)
"""


def run_commit_check(workflow, tmp_path, env):
    script = step(workflow, "Choose the commit")["run"]
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    git = bin_dir / "git"
    git.write_text(FAKE_GIT)
    git.chmod(0o755)
    output = tmp_path / "output"
    output.write_text("")
    environment = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "GITHUB_OUTPUT": str(output),
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": COMMIT,
        "INPUT_COMMIT": "",
        "FAKE_ON_MAIN": COMMIT,
        **env,
    }
    result = subprocess.run(
        ["bash", "-c", script],
        env=environment,
        capture_output=True,
        text=True,
    )
    return result, output.read_text()


needs_bash = pytest.mark.skipif(
    shutil.which("bash") is None, reason="needs bash"
)


@needs_bash
def test_mains_head_is_deployed_by_default(workflow, tmp_path):
    result, output = run_commit_check(workflow, tmp_path, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"commit={COMMIT}" in output


@needs_bash
@pytest.mark.parametrize(
    "env, message",
    [
        ({"GITHUB_REF": "refs/heads/feature"}, "run from main"),
        ({"INPUT_COMMIT": "abc123"}, "full 40-character"),
        ({"INPUT_COMMIT": "b" * 40}, "is not on main"),
    ],
)
def test_only_a_commit_on_main_is_deployed(workflow, tmp_path, env, message):
    result, output = run_commit_check(workflow, tmp_path, env)
    assert result.returncode != 0
    assert message in result.stdout + result.stderr
    assert "commit=" not in output
