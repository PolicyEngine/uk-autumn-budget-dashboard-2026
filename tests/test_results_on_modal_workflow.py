"""results-on-modal.yml: what it may touch, when it runs, and its guards.

The workflow regenerates the flat CSVs on Modal and uploads them. It must
never write to the branch or sign a review row, never run for forks or on
pull_request_target, and must stop with a clear message when a credential
is missing. Its shell steps run here against stand-ins, so no Modal call is
made.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
PATH = REPO / ".github" / "workflows" / "results-on-modal.yml"
TEXT = PATH.read_text()
WORKFLOW = yaml.safe_load(TEXT)
# PyYAML reads the key "on" as True.
TRIGGERS = WORKFLOW.get("on", WORKFLOW.get(True))
JOB = WORKFLOW["jobs"]["generate"]


def step(name):
    return next(s for s in JOB["steps"] if s.get("name") == name)


def test_it_runs_on_measure_changes_and_by_hand_only():
    assert set(TRIGGERS) == {"pull_request", "workflow_dispatch"}
    paths = TRIGGERS["pull_request"]["paths"]
    assert "src/uk_budget_data/reforms.py" in paths
    assert "src/uk_budget_data/budget_measures/**" in paths
    assert "pull_request_target" not in TRIGGERS


def test_it_reads_only_and_skips_forks():
    assert WORKFLOW["permissions"] == {"contents": "read"}
    assert "permissions" not in JOB
    assert "head.repo.full_name == github.repository" in JOB["if"]


def test_it_never_writes_the_branch_or_signs_a_review_row():
    scripts = "\n".join(s.get("run", "") for s in JOB["steps"])
    assert "git push" not in scripts and "git commit" not in scripts
    # The review CSV is only read (grep) or named in the summary's text,
    # never written.
    for line in scripts.splitlines():
        if "public_data_review.csv" in line:
            line = line.strip()
            assert line.startswith(("if grep -q", 'echo "')), line
            assert "> data_inputs" not in line and "tee" not in line
    assert '--output-dir "$OUT"' in scripts
    # Outside the checkout. Set in a step: a job's env has no runner context.
    assert "runner." not in str(JOB["env"])
    assert step("Output directory")["run"] == (
        'echo "OUT=$RUNNER_TEMP/modal-results" >> "$GITHUB_ENV"'
    )


def test_its_guards():
    assert JOB["timeout-minutes"] <= 60
    group = WORKFLOW["concurrency"]["group"]
    assert "github.event.pull_request.number" in group
    assert WORKFLOW["concurrency"]["cancel-in-progress"] is True
    # The dispatch input reaches the shell through a variable only.
    assert (
        "${{ inputs.reforms }}"
        not in step("Generate the flat CSVs on Modal")["run"]
    )
    # No Hugging Face token is given to this workflow.
    assert "HUGGING_FACE_TOKEN:" not in TEXT
    assert "PE_UK_PRIVATE_HF_READ_TOKEN" not in TEXT


def run_step(name, env):
    return subprocess.run(
        ["bash", "-e", "-c", step(name)["run"]],
        env={"PATH": os.environ["PATH"], **env},
        capture_output=True,
        text=True,
    )


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_missing_modal_credentials_stop_the_run_and_say_who_adds_them():
    done = run_step(
        "Modal credentials present",
        {"MODAL_TOKEN_ID": "", "MODAL_TOKEN_SECRET": ""},
    )
    assert done.returncode == 1
    assert "MODAL_TOKEN_ID MODAL_TOKEN_SECRET" in done.stdout
    assert "organisation admin" in done.stdout
    present = run_step(
        "Modal credentials present",
        {"MODAL_TOKEN_ID": "id", "MODAL_TOKEN_SECRET": "secret"},
    )
    assert present.returncode == 0, present.stdout
    assert "secret" not in present.stdout


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_a_bad_measure_id_is_refused_before_modal(tmp_path):
    done = subprocess.run(
        ["bash", "-c", step("Generate the flat CSVs on Modal")["run"]],
        env={
            "PATH": os.environ["PATH"],
            "REFORMS": "ok_id $(touch pwned)",
            "OUT": str(tmp_path / "out"),
            "GITHUB_ENV": str(tmp_path / "env"),
        },
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert done.returncode == 1
    assert "Not a measure id" in done.stdout
    assert not (tmp_path / "pwned").exists()
