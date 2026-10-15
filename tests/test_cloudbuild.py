"""Run cloudbuild.yaml's shell steps against a stand-in gcloud.

Each step is taken from the real file, with Cloud Build's substitutions
applied as Cloud Build applies them, and run by bash with a fake ``gcloud``
on the PATH that records every call and answers from a scripted service.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
CONFIG = yaml.safe_load((REPO / "cloudbuild.yaml").read_text())
BUILD_ID = "0123abcd-4567-89ef-0123-456789abcdef"


def _base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


TAG = "b" + _base36(__import__("uuid").UUID(BUILD_ID).int)
IMAGE = "europe-west1-docker.pkg.dev/p/r/uk-budget-api-2026@sha256:" + "d" * 64

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None, reason="needs bash"
)


def step_script(step_id: str, workspace: Path, **substitutions) -> str:
    step = next(s for s in CONFIG["steps"] if s["id"] == step_id)
    script = step["args"][-1]
    values = {
        **CONFIG["substitutions"],
        "_GIT_SHA": "a" * 40,
        **{k: v for k, v in substitutions.items() if k.startswith("_")},
    }
    values["_IMAGE"] = values["_IMAGE"].replace("${PROJECT_ID}", "p")
    for name, value in values.items():
        script = script.replace("${" + name + "}", value)
    script = (
        script.replace("${PROJECT_ID}", "p")
        .replace("${BUILD_ID}", BUILD_ID)
        .replace("${LOCATION}", substitutions.get("LOCATION", "europe-west1"))
    )
    assert "${" not in script.replace("$${", ""), "unsubstituted variable"
    return script.replace("$$", "$").replace("/workspace", str(workspace))


FAKE_GCLOUD = r"""#!/usr/bin/env python3
import json, os, sys
state_path = os.environ["FAKE_STATE"]
state = json.load(open(state_path))
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(" ".join(args) + "\n")
def save():
    json.dump(state, open(state_path, "w"))
if args[:3] == ["builds", "list", "--ongoing"]:
    # Like Cloud Build, list only the builds in the location asked for
    # (global when no --region is given). Ongoing builds are "id" or
    # "id@location"; a bare id is in europe-west1.
    region = (
        args[args.index("--region") + 1] if "--region" in args else "global"
    )
    for build in state.get("ongoing", []):
        name, _, location = build.partition("@")
        if (location or "europe-west1") == region:
            print(name)
elif args[:3] == ["run", "services", "list"]:
    if state.get("list_fails"):
        sys.exit("ERROR: the API is unavailable")
    print(state["name"] if state.get("exists") else "")
elif args[:3] == ["run", "services", "describe"]:
    print(json.dumps({"status": {"traffic": state["traffic"]}}))
elif args[:2] == ["run", "deploy"]:
    tag = args[args.index("--tag") + 1]
    revision = "rev-new"
    state["revisions"][revision] = {
        "metadata": {"labels": {"gcb-build-id": state["build_id"]}},
        "status": {"imageDigest": state["image"]},
    }
    for t in state["traffic"]:
        if t.get("tag") == tag:
            t.pop("tag")
    entry = {"revisionName": revision, "tag": tag, "url": "https://" + tag}
    if "--no-traffic" not in args:
        entry["percent"] = 100
        state["exists"] = True
    state["traffic"].append(entry)
    save()
elif args[:3] == ["run", "revisions", "describe"]:
    print(json.dumps(state["revisions"][args[3]]))
elif args[:3] == ["run", "services", "update-traffic"]:
    target = args[args.index("--to-revisions") + 1].split("=")[0]
    for t in state["traffic"]:
        t.pop("percent", None)
    for t in state["traffic"]:
        if t["revisionName"] == target:
            t["percent"] = 100
    save()
else:
    sys.exit("unexpected gcloud call: " + " ".join(args))
"""


def run(script: str, tmp_path: Path, state: dict):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    gcloud = bin_dir / "gcloud"
    gcloud.write_text(FAKE_GCLOUD)
    gcloud.chmod(0o755)
    (tmp_path / "state.json").write_text(json.dumps(state))
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_STATE": str(tmp_path / "state.json"),
        "FAKE_LOG": str(tmp_path / "gcloud.log"),
    }
    result = subprocess.run(
        ["bash", "-c", script], env=env, capture_output=True, text=True
    )
    log_file = tmp_path / "gcloud.log"
    log = log_file.read_text().splitlines() if log_file.exists() else []
    return result, log, json.loads((tmp_path / "state.json").read_text())


def service(**overrides) -> dict:
    return {
        "name": "uk-budget-api-2026",
        "exists": True,
        "build_id": BUILD_ID,
        "image": IMAGE,
        "revisions": {},
        "traffic": [
            {"revisionName": "rev-old", "percent": 100, "latestRevision": True}
        ],
        **overrides,
    }


@pytest.fixture
def workspace(tmp_path):
    space = tmp_path / "workspace"
    space.mkdir()
    (space / "image_ref").write_text(IMAGE + "\n")
    return space


def test_every_step_parses_after_substitution(workspace):
    for step in CONFIG["steps"]:
        if step.get("entrypoint") == "bash":
            script = step_script(step["id"], workspace)
            check = subprocess.run(
                ["bash", "-n", "-c", script], capture_output=True, text=True
            )
            assert check.returncode == 0, (step["id"], check.stderr)


def test_an_existing_service_gets_a_no_traffic_revision_under_its_own_tag(
    tmp_path, workspace
):
    result, log, state = run(
        step_script("deploy-candidate", workspace), tmp_path, service()
    )
    assert result.returncode == 0, result.stderr
    deploy = next(line for line in log if line.startswith("run deploy"))
    assert "--no-traffic" in deploy and f"--tag {TAG}" in deploy
    assert f"--image {IMAGE}" in deploy
    assert (workspace / "candidate_revision").read_text().strip() == "rev-new"
    assert json.loads((workspace / "previous_traffic").read_text()) == [
        ["rev-old", 100]
    ]
    assert state["traffic"][0]["percent"] == 100


def test_the_candidate_runs_as_the_services_own_account(tmp_path, workspace):
    """The revision's identity is a role-less account of its own: a
    revision deployed without one runs as the Compute Engine default
    account, which holds roles/editor on the project."""
    result, log, _ = run(
        step_script("deploy-candidate", workspace), tmp_path, service()
    )
    assert result.returncode == 0, result.stderr
    deploy = next(line for line in log if line.startswith("run deploy"))
    assert (
        "--service-account uk-budget-api-runtime@p.iam.gserviceaccount.com"
        in deploy
    )


BUILDER = (
    "projects/policyengine-apps/serviceAccounts/"
    "uk-budget-api-builder@policyengine-apps.iam.gserviceaccount.com"
)


@pytest.mark.parametrize(
    "name", ["cloudbuild.yaml", "cloudbuild-rollback.yaml"]
)
def test_deploys_and_rollbacks_run_as_the_dedicated_builder(name):
    """Not the Compute Engine default account, so whatever is merged to
    main runs with only the builder's grants. A build run as a chosen
    account must log to Cloud Logging (or a bucket of its own)."""
    config = yaml.safe_load((REPO / name).read_text())
    assert config["serviceAccount"] == BUILDER
    assert config["options"]["logging"] == "CLOUD_LOGGING_ONLY"


def test_a_failed_lookup_stops_the_build_before_any_deploy(
    tmp_path, workspace
):
    """Review finding: a lookup error was treated as an absent service."""
    result, log, _ = run(
        step_script("deploy-candidate", workspace),
        tmp_path,
        service(list_fails=True),
    )
    assert result.returncode != 0
    assert not any(line.startswith("run deploy") for line in log)


def test_creating_the_service_needs_explicit_permission(tmp_path, workspace):
    result, log, _ = run(
        step_script("deploy-candidate", workspace),
        tmp_path,
        service(exists=False, traffic=[]),
    )
    assert result.returncode != 0
    assert "_ALLOW_CREATE" in result.stderr
    assert not any(line.startswith("run deploy") for line in log)


def test_a_revision_from_another_build_is_refused(tmp_path, workspace):
    result, _, _ = run(
        step_script("deploy-candidate", workspace),
        tmp_path,
        service(build_id="someone-else"),
    )
    assert result.returncode != 0
    assert "belongs to another build" in result.stderr


def test_a_revision_running_another_image_is_refused(tmp_path, workspace):
    result, _, _ = run(
        step_script("deploy-candidate", workspace),
        tmp_path,
        service(image=IMAGE.replace("d" * 64, "e" * 64)),
    )
    assert result.returncode != 0
    assert "different image" in result.stderr


def promote(tmp_path, workspace, traffic, previous):
    (workspace / "candidate_revision").write_text("rev-new\n")
    (workspace / "candidate_tag").write_text(TAG + "\n")
    (workspace / "previous_traffic").write_text(json.dumps(previous) + "\n")
    return run(
        step_script("promote", workspace),
        tmp_path,
        service(traffic=traffic),
    )


SPLIT = [
    {"revisionName": "rev-a", "percent": 90},
    {"revisionName": "rev-b", "percent": 10},
    {"revisionName": "rev-new", "tag": TAG, "url": "https://x"},
]


def test_promotion_records_a_split_allocation_for_rollback(
    tmp_path, workspace
):
    """Review finding: a 90/10 split was logged as 'nothing'."""
    result, _, state = promote(
        tmp_path, workspace, SPLIT, [["rev-a", 90], ["rev-b", 10]]
    )
    assert result.returncode == 0, result.stderr
    assert "--to-revisions rev-a=90,rev-b=10" in result.stdout
    assert [t for t in state["traffic"] if t.get("percent")] == [
        {
            "revisionName": "rev-new",
            "tag": TAG,
            "url": "https://x",
            "percent": 100,
        }
    ]


def test_promotion_stops_if_traffic_moved_during_the_build(
    tmp_path, workspace
):
    """Review finding: a racing build's promotion was misrecorded."""
    moved = [
        {"revisionName": "rev-other-build", "percent": 100},
        {"revisionName": "rev-new", "tag": TAG, "url": "https://x"},
    ]
    result, log, state = promote(
        tmp_path, workspace, moved, [["rev-old", 100]]
    )
    assert result.returncode != 0
    assert "Traffic changed" in result.stderr
    assert not any(
        line.startswith("run services update-traffic") for line in log
    )


def verify_source(tmp_path, commit_files: dict, uploaded_files: dict):
    """Run verify-source with a fake curl serving ``commit_files``."""
    import io
    import tarfile

    tmp_path.mkdir(parents=True, exist_ok=True)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for name, text in commit_files.items():
            data = text.encode()
            info = tarfile.TarInfo(f"repo-sha/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    (tmp_path / "commit.tar.gz").write_bytes(archive.getvalue())
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    curl = bin_dir / "curl"
    curl.write_text(f"#!/bin/sh\ncat {tmp_path / 'commit.tar.gz'}\n")
    curl.chmod(0o755)
    workspace = tmp_path / "upload"
    workspace.mkdir()
    for name, text in uploaded_files.items():
        (workspace / name).write_text(text)
    script = step_script("verify-source", workspace).replace(
        "/tmp/commit", str(tmp_path / "commit")
    )
    return subprocess.run(
        ["bash", "-c", script],
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
    )


def test_the_uploaded_source_must_be_the_named_commit(tmp_path):
    """Review finding: _GIT_SHA was only an assertion by the caller."""
    files = {"Dockerfile": "FROM x\n", "app.py": "print(1)\n"}
    assert verify_source(tmp_path / "same", files, files).returncode == 0
    changed = {**files, "app.py": "print(2)\n"}
    result = verify_source(tmp_path / "changed", files, changed)
    assert result.returncode != 0
    assert "is not commit" in result.stderr
    extra = {**files, "local.py": "x\n"}
    assert verify_source(tmp_path / "extra", files, extra).returncode != 0


def test_the_tag_names_the_whole_build_and_fits_a_hostname(
    workspace, tmp_path
):
    result, _, _ = run(
        step_script("deploy-candidate", workspace), tmp_path, service()
    )
    assert result.returncode == 0, result.stderr
    tag = (workspace / "candidate_tag").read_text().strip()
    assert tag == TAG and tag[0].isalpha()
    host_label = f"{tag}---uk-budget-api-2026-qevs5bboca-ew"
    assert len(host_label) <= 63


def test_a_deploy_stops_while_another_is_running(tmp_path, workspace):
    """Review round 2: concurrent deploys and bootstraps raced."""
    result, log, _ = run(
        step_script("exclusive", workspace),
        tmp_path,
        service(ongoing=["another-build"]),
    )
    assert result.returncode != 0
    assert "Another deploy is running" in result.stderr
    alone, _, _ = run(step_script("exclusive", workspace), tmp_path, service())
    assert alone.returncode == 0, alone.stderr


def test_a_deploy_submitted_outside_the_region_stops_first(
    tmp_path, workspace
):
    """Review round 3: builds are listed per location, so a deploy in
    another location could not see one in europe-west1, or be seen."""
    for location in ("global", "us-central1"):
        result, log, _ = run(
            step_script("exclusive", workspace, LOCATION=location),
            tmp_path / location,
            service(),
        )
        assert result.returncode != 0
        assert "--region europe-west1" in result.stderr
        assert log == []


def test_another_deploy_in_the_region_is_seen(tmp_path, workspace):
    """The listing asks for the deploy region, not the default global one."""
    result, log, _ = run(
        step_script("exclusive", workspace),
        tmp_path,
        service(ongoing=["another-build@europe-west1"]),
    )
    assert result.returncode != 0
    assert all("--region europe-west1" in line for line in log)
    (workspace / "candidate_revision").write_text("rev-new\n")
    (workspace / "previous_traffic").write_text('[["rev-old", 100]]\n')
    result, log, _ = run(
        step_script("promote", workspace),
        tmp_path / "promote",
        service(ongoing=["another-build@europe-west1"]),
    )
    assert result.returncode != 0
    assert not any(
        line.startswith("run services update-traffic") for line in log
    )


def test_promotion_stops_while_another_deploy_is_running(tmp_path, workspace):
    (workspace / "candidate_revision").write_text("rev-new\n")
    (workspace / "candidate_tag").write_text(TAG + "\n")
    (workspace / "previous_traffic").write_text('[["rev-old", 100]]\n')
    result, log, _ = run(
        step_script("promote", workspace),
        tmp_path,
        service(ongoing=["another-build"]),
    )
    assert result.returncode != 0
    assert not any(
        line.startswith("run services update-traffic") for line in log
    )


def test_a_new_service_is_promoted_only_if_it_is_this_builds(
    tmp_path, workspace
):
    """Review round 2: a bootstrap accepted any current traffic."""
    someone_else = [{"revisionName": "rev-old", "percent": 100}]
    result, log, _ = promote(tmp_path, workspace, someone_else, [])
    assert result.returncode != 0
    assert "not this build's new service" in result.stderr
    ours = [
        {"revisionName": "rev-new", "percent": 100, "tag": TAG, "url": "x"}
    ]
    result, _, _ = promote(tmp_path / "ours", workspace, ours, [])
    assert result.returncode == 0, result.stderr


def test_gcloud_would_upload_every_tracked_file():
    """Review round 2: without .gcloudignore, .gitignore files were left out
    of the upload, so the source check refused a correct commit."""
    sdk = Path.home() / "google-cloud-sdk" / "lib"
    if not (sdk / "googlecloudsdk").is_dir():
        pytest.skip("needs the Google Cloud SDK")
    import sys

    sys.path[:0] = [str(sdk), str(sdk / "third_party")]
    try:
        from googlecloudsdk.command_lib.util import gcloudignore
    finally:
        del sys.path[:2]
    chooser = gcloudignore.GetFileChooserForDir(str(REPO), write_on_disk=False)
    tracked = subprocess.check_output(
        ["git", "ls-files"], cwd=REPO, text=True
    ).splitlines()
    assert [path for path in tracked if not chooser.IsIncluded(path)] == []


# --- review round 2 of #28: main's checker in the deploy too --------------


ROLLBACK = yaml.safe_load((REPO / "cloudbuild-rollback.yaml").read_text())


def _script(config: dict, step_id: str) -> str:
    return next(s for s in config["steps"] if s["id"] == step_id)["args"][-1]


def test_the_deploy_smoke_tests_with_mains_checker_after_deploying():
    """Review A: the deploy ran the candidate image's own checker, so a
    deploy of an older commit brought that commit's weaker checker."""
    order = [s["id"] for s in CONFIG["steps"]]
    assert (
        order.index("deploy-candidate")
        < order.index("trusted-checker")
        < order.index("expectations")
        < order.index("smoke")
        < order.index("promote")
    )
    checker = _script(CONFIG, "trusted-checker")
    assert "--filter=blob:none" in checker and "--branch main" in checker
    assert "archive main" in checker
    smoke = next(s for s in CONFIG["steps"] if s["id"] == "smoke")
    assert "docker" not in smoke["name"] and "docker" not in smoke["args"][-1]
    assert "--expectations /workspace/expectations.json" in smoke["args"][-1]


def test_deploy_and_rollback_judge_by_the_same_checker_and_data():
    """Differential: both pipelines extract the same modules from main,
    collect the same expectations and run the same checker command."""
    deploy_checker = _script(CONFIG, "trusted-checker")
    rollback_checker = _script(ROLLBACK, "on-main")
    extract = deploy_checker[
        deploy_checker.index("mkdir -p /workspace/checker") :
    ]
    assert extract in rollback_checker
    assert _script(CONFIG, "expectations") == _script(ROLLBACK, "expectations")
    deploy_smoke = (
        _script(CONFIG, "smoke")
        .replace('"$$(cat /workspace/candidate_url)"', "URL")
        .replace("${_GIT_SHA}", "COMMIT")
    )
    rollback_smoke = (
        _script(ROLLBACK, "smoke")
        .replace('"$$(cat /workspace/tagged_url)"', "URL")
        .replace('"$$(cat /workspace/commit)"', "COMMIT")
    )
    assert deploy_smoke == rollback_smoke


def test_manual_submissions_use_mains_config_not_the_archives():
    """Review B: the instructions submitted <dir>/cloudbuild.yaml, the
    archived commit's own copy, which for an older commit lacks the lock
    and the traffic check."""
    header = (REPO / "cloudbuild.yaml").read_text().split("substitutions:")[0]
    assert "--config cloudbuild.yaml" in header
    assert "<dir>/cloudbuild.yaml" not in header
    assert "checkout of main" in header


def _run_on_main(tmp_path, on_main: bool):
    """Run the deploy's on-main step with a fake git; return the result,
    the workspace and git's calls."""
    workspace, bin_dir = tmp_path / "workspace", tmp_path / "bin"
    workspace.mkdir()
    bin_dir.mkdir()
    log = tmp_path / "git.log"
    fake = bin_dir / "git"
    fake.write_text(
        "#!/bin/bash\n"
        f'echo "$*" >> "{log}"\n'
        'if [ "$1" = clone ]; then mkdir -p "${@: -1}"; fi\n'
        'if [[ " $* " == *" merge-base "* ]]; then '
        f"exit {0 if on_main else 1}; fi\n"
    )
    fake.chmod(0o755)
    result = subprocess.run(
        ["bash", "-c", step_script("on-main", workspace)],
        cwd=tmp_path,
        env={"PATH": f"{bin_dir}:/usr/bin:/bin"},
        capture_output=True,
        text=True,
    )
    return result, workspace, log.read_text().splitlines()


@pytest.mark.parametrize("on_main", [True, False])
def test_only_a_commit_on_main_is_deployed(tmp_path, on_main):
    """Review round 3 of #28 (D): verify-source proved the upload was the
    named commit, not that the commit was on main, so a manual submission
    of a PR branch's commit deployed unreviewed code that a rollback would
    then refuse."""
    result, workspace, calls = _run_on_main(tmp_path, on_main)
    assert (result.returncode == 0) is on_main
    if not on_main:
        assert "is not on main" in result.stderr
    (ancestry,) = [c for c in calls if "merge-base" in c]
    assert ancestry.endswith(f"--is-ancestor {'a' * 40} main")
    assert any(
        "--filter=blob:none" in c and "--branch main" in c for c in calls
    )
    # The clone never reaches the image's build context.
    if on_main:
        assert not (workspace / "history").exists()


def test_the_main_check_runs_before_anything_is_built():
    order = [s["id"] for s in CONFIG["steps"]]
    assert (
        order.index("verify-source")
        < order.index("on-main")
        < order.index("build")
    )
