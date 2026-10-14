"""Run deploy-api.yml's shell steps against stand-in gcloud, git and curl.

Each step's script is taken from the real workflow and run by bash with
fakes on the PATH that record every call and answer from a scripted state,
as tests/test_cloudbuild.py does for cloudbuild.yaml.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO / ".github" / "workflows" / "deploy-api.yml"
WORKFLOW = yaml.safe_load(WORKFLOW_PATH.read_text())
CLOUDBUILD = yaml.safe_load((REPO / "cloudbuild.yaml").read_text())
COMMIT = "a" * 40
BUILD_ID = "0123abcd-4567-89ef-0123-456789abcdef"
URL = "https://uk-budget-api-2026-example.a.run.app"
REVISION = "uk-budget-api-2026-00002-abc"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None, reason="needs bash"
)

FAKE = r"""#!/usr/bin/env python3
import io, json, os, sys, tarfile
name = os.path.basename(sys.argv[0])
args = sys.argv[1:]
path = os.environ["FAKE_STATE"]
state = json.load(open(path))
state.setdefault("calls", []).append([name, *args])

def save():
    json.dump(state, open(path, "w"))

def flag(prefix):
    for a in args:
        if a.startswith(prefix):
            return a[len(prefix):]
    return None

out, code = "", 0
if name == "git":
    if args[:2] == ["merge-base", "--is-ancestor"]:
        code = 0 if args[2] in state.get("on_main", []) else 1
    elif args[0] == "archive":
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            data = b"steps: []\n"
            info = tarfile.TarInfo("cloudbuild.yaml")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        save()
        sys.stdout.buffer.write(buffer.getvalue())
        sys.exit(0)
elif name == "curl":
    out = json.dumps({"git_sha": state["live_sha"]})
elif args[:2] == ["builds", "submit"]:
    state["submitted_dir"] = args[2]
    state["submitted_files"] = sorted(os.listdir(args[2]))
    out = state.get("build_id", "")
elif args[:2] == ["builds", "describe"]:
    statuses = state["statuses"]
    out = statuses.pop(0) if len(statuses) > 1 else statuses[0]
elif args[:2] == ["builds", "log"]:
    if state.get("log_denied"):
        code = 1
    else:
        out = "Roll back with: gcloud run services update-traffic ..."
elif args[:2] == ["builds", "list"]:
    out = state.get("ongoing", "")
elif args[:3] == ["run", "services", "describe"]:
    if flag("--format=") == "json":
        out = json.dumps({"status": {"traffic": state.get("traffic", [])}})
    else:
        out = state["url"]
elif args[:3] == ["run", "revisions", "describe"]:
    revision = state.get("revisions", {}).get(args[3])
    if revision is None:
        code = 1
    else:
        out = json.dumps(revision)
elif args[:3] == ["run", "services", "update-traffic"]:
    state["moved_to"] = args[args.index("--to-revisions") + 1]
save()
if out:
    print(out)
sys.exit(code)
"""


def step(job: str, name: str) -> str:
    """The run script of one step, by its name or id."""
    steps = WORKFLOW["jobs"][job]["steps"]
    return next(
        s["run"] for s in steps if name in (s.get("name"), s.get("id"))
    )


def run(tmp_path: Path, script: str, state: dict, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for tool in ("gcloud", "git", "curl"):
        fake = bin_dir / tool
        fake.write_text(FAKE)
        fake.chmod(0o755)
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps(state))
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", script],
        cwd=tmp_path,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "FAKE_STATE": str(state_file),
            "GITHUB_OUTPUT": str(output),
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_SHA": COMMIT,
            "WIF_PROVIDER": "projects/1/locations/global/workloadIdentityPools/p/providers/q",
            "DEPLOY_SERVICE_ACCOUNT": "deployer@policyengine-apps.iam.gserviceaccount.com",
            "POLL_SECONDS": "0",
            **WORKFLOW["env"],
            **env,
        },
        capture_output=True,
        text=True,
    )
    outputs = dict(
        line.split("=", 1) for line in output.read_text().splitlines()
    )
    return result, json.loads(state_file.read_text()), outputs


def calls(state: dict, *prefix: str) -> list:
    return [
        c for c in state.get("calls", []) if c[: len(prefix)] == list(prefix)
    ]


# --- the workflow's shape -------------------------------------------------


def test_it_deploys_the_service_cloudbuild_yaml_deploys():
    substitutions = CLOUDBUILD["substitutions"]
    assert WORKFLOW["env"]["SERVICE"] == substitutions["_SERVICE"]
    assert WORKFLOW["env"]["REGION"] == substitutions["_REGION"]
    assert WORKFLOW["env"]["PROJECT"] == "policyengine-apps"


def test_push_deploys_wait_for_a_switch_and_rollbacks_are_manual():
    triggers = WORKFLOW.get("on", WORKFLOW.get(True))
    assert triggers["push"]["branches"] == ["main"]
    assert "src/uk_budget_data/**" in triggers["push"]["paths"]
    assert "cloudbuild.yaml" in triggers["push"]["paths"]
    deploy_if = WORKFLOW["jobs"]["deploy"]["if"]
    assert "vars.API_DEPLOY_ON_PUSH == 'true'" in deploy_if
    assert "inputs.action == 'deploy'" in deploy_if
    rollback_if = WORKFLOW["jobs"]["rollback"]["if"]
    assert "workflow_dispatch" in rollback_if and "'rollback'" in rollback_if
    assert WORKFLOW["concurrency"]["cancel-in-progress"] is False


def test_it_authenticates_without_a_key_and_with_least_privilege():
    """Workload Identity Federation only: no key, no secret, and an OIDC
    token only for the jobs that deploy."""
    text = WORKFLOW_PATH.read_text()
    assert "secrets." not in text
    assert "credentials_json" not in text
    assert WORKFLOW["permissions"] == {"contents": "read"}
    for job in WORKFLOW["jobs"].values():
        assert job["permissions"] == {"contents": "read", "id-token": "write"}
        auth = [
            s
            for s in job["steps"]
            if s.get("uses", "").startswith("google-github-actions/auth@")
        ]
        assert len(auth) == 1
        assert auth[0]["with"] == {
            "workload_identity_provider": "${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
            "service_account": "${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}",
        }


def test_no_input_reaches_a_script_except_through_the_environment():
    for job in WORKFLOW["jobs"].values():
        for s in job["steps"]:
            assert "${{" not in s.get("run", ""), s.get("name")


# --- deploy ---------------------------------------------------------------


@pytest.mark.parametrize(
    "env, state, message",
    [
        ({"GITHUB_REF": "refs/heads/feature"}, {}, "run from main"),
        ({"WIF_PROVIDER": ""}, {}, "repository variables"),
        ({"INPUT_COMMIT": "abc123"}, {}, "full 40-character"),
        ({}, {"on_main": []}, "is not on main"),
    ],
)
def test_only_a_commit_on_main_is_deployed(tmp_path, env, state, message):
    result, _, outputs = run(
        tmp_path,
        step("deploy", "commit"),
        {"on_main": [COMMIT], **state},
        **env,
    )
    assert result.returncode != 0
    assert message in result.stdout
    assert "commit" not in outputs


def test_the_default_commit_is_mains_head_and_an_older_one_may_be_named(
    tmp_path,
):
    result, _, outputs = run(
        tmp_path, step("deploy", "commit"), {"on_main": [COMMIT]}
    )
    assert result.returncode == 0 and outputs["commit"] == COMMIT
    older = "b" * 40
    (tmp_path / "again").mkdir()
    result, _, outputs = run(
        tmp_path / "again",
        step("deploy", "commit"),
        {"on_main": [COMMIT, older]},
        INPUT_COMMIT=older,
    )
    assert result.returncode == 0 and outputs["commit"] == older


def test_the_build_is_submitted_like_a_manual_deploy(tmp_path):
    """An exact archive of the commit, to europe-west1 (cloudbuild.yaml
    stops a build anywhere else), with the commit as _GIT_SHA."""
    result, state, outputs = run(
        tmp_path,
        step("deploy", "build"),
        {"build_id": BUILD_ID},
        COMMIT=COMMIT,
    )
    assert result.returncode == 0, result.stderr
    assert outputs["build"] == BUILD_ID
    (submit,) = calls(state, "gcloud", "builds", "submit")
    directory = state["submitted_dir"]
    assert state["submitted_files"] == ["cloudbuild.yaml"]
    assert calls(state, "git", "archive") == [["git", "archive", COMMIT]]
    for flag, value in [
        ("--project", "policyengine-apps"),
        ("--region", "europe-west1"),
        ("--config", f"{directory}/cloudbuild.yaml"),
        ("--substitutions", f"_GIT_SHA={COMMIT}"),
    ]:
        assert submit[submit.index(flag) + 1] == value
    assert "--async" in submit


def test_a_submission_without_a_build_id_stops(tmp_path):
    result, _, outputs = run(
        tmp_path, step("deploy", "build"), {"build_id": ""}, COMMIT=COMMIT
    )
    assert result.returncode != 0 and "build" not in outputs


@pytest.mark.parametrize("log_denied", [False, True])
def test_the_deploy_waits_for_the_build_to_succeed(tmp_path, log_denied):
    """It waits on the build's status, so a service account that may not
    read the build log still deploys."""
    result, state, _ = run(
        tmp_path,
        step("deploy", "Wait for the build"),
        {
            "statuses": ["QUEUED", "WORKING", "SUCCESS"],
            "log_denied": log_denied,
        },
        BUILD=BUILD_ID,
    )
    assert result.returncode == 0, result.stderr
    assert len(calls(state, "gcloud", "builds", "describe")) == 3


@pytest.mark.parametrize(
    "status", ["FAILURE", "TIMEOUT", "CANCELLED", "INTERNAL_ERROR", ""]
)
def test_a_build_that_does_not_succeed_fails_the_deploy(tmp_path, status):
    result, state, _ = run(
        tmp_path,
        step("deploy", "Wait for the build"),
        {"statuses": ["WORKING", status]},
        BUILD=BUILD_ID,
    )
    assert result.returncode != 0
    assert f"ended {status}" in result.stdout
    assert calls(state, "gcloud", "builds", "log")


@pytest.mark.parametrize("live, ok", [(COMMIT, True), ("c" * 40, False)])
def test_the_live_service_must_serve_the_commit(tmp_path, live, ok):
    result, _, _ = run(
        tmp_path,
        step("deploy", "Check the live service"),
        {"url": URL, "live_sha": live},
        COMMIT=COMMIT,
    )
    assert (result.returncode == 0) is ok


# --- rollback -------------------------------------------------------------


@pytest.mark.parametrize(
    "revision",
    [
        "",
        "uk-budget-api-2026",
        "uk-budget-api-2026-2-abc",
        "other-service-00002-abc",
        "uk-budget-api-2026-00002-abc; rm -rf /",
        "uk-budget-api-2026-00002-ABC",
    ],
)
def test_a_rollback_names_a_revision_of_this_service(tmp_path, revision):
    result, _, _ = run(
        tmp_path, step("rollback", "Check the request"), {}, REVISION=revision
    )
    assert result.returncode != 0


def test_a_rollback_runs_from_main(tmp_path):
    result, _, _ = run(
        tmp_path,
        step("rollback", "Check the request"),
        {},
        REVISION=REVISION,
        GITHUB_REF="refs/heads/feature",
    )
    assert result.returncode != 0
    (tmp_path / "main").mkdir()
    result, _, _ = run(
        tmp_path / "main",
        step("rollback", "Check the request"),
        {},
        REVISION=REVISION,
    )
    assert result.returncode == 0


def revision(service="uk-budget-api-2026", ready="True", commit=COMMIT):
    return {
        "metadata": {
            "labels": {
                "serving.knative.dev/service": service,
                "commit-sha": commit,
            }
        },
        "status": {"conditions": [{"type": "Ready", "status": ready}]},
    }


LIVE = [
    {"revisionName": "uk-budget-api-2026-00003-xyz", "percent": 100},
    {"revisionName": REVISION, "tag": "old"},
]


def test_a_rollback_moves_all_traffic_and_says_how_to_undo_it(tmp_path):
    result, state, outputs = run(
        tmp_path,
        step("rollback", "move"),
        {"revisions": {REVISION: revision()}, "traffic": LIVE},
        REVISION=REVISION,
    )
    assert result.returncode == 0, result.stderr
    assert state["moved_to"] == f"{REVISION}=100"
    assert outputs["commit"] == COMMIT
    assert "--to-revisions uk-budget-api-2026-00003-xyz=100" in result.stdout


@pytest.mark.parametrize(
    "revisions, ongoing, message",
    [
        ({}, "", ""),
        ({REVISION: revision(service="other")}, "", "belongs to other"),
        ({REVISION: revision(ready="False")}, "", "is not ready"),
        ({REVISION: revision()}, BUILD_ID, "A deploy is running"),
    ],
)
def test_a_rollback_that_cannot_be_trusted_moves_nothing(
    tmp_path, revisions, ongoing, message
):
    result, state, _ = run(
        tmp_path,
        step("rollback", "move"),
        {"revisions": revisions, "ongoing": ongoing, "traffic": LIVE},
        REVISION=REVISION,
    )
    assert result.returncode != 0
    assert "moved_to" not in state
    assert message in result.stdout + result.stderr


@pytest.mark.parametrize("live, ok", [(COMMIT, True), ("c" * 40, False)])
def test_after_a_rollback_the_live_service_serves_its_commit(
    tmp_path, live, ok
):
    result, _, _ = run(
        tmp_path,
        step("rollback", "Check the live service"),
        {"url": URL, "live_sha": live},
        COMMIT=COMMIT,
        REVISION=REVISION,
    )
    assert (result.returncode == 0) is ok
