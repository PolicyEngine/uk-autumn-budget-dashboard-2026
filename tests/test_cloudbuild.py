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
TAG = "b-0123abcd4567"
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
        **substitutions,
    }
    values["_IMAGE"] = values["_IMAGE"].replace("${PROJECT_ID}", "p")
    for name, value in values.items():
        script = script.replace("${" + name + "}", value)
    script = script.replace("${PROJECT_ID}", "p").replace(
        "${BUILD_ID}", BUILD_ID
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
if args[:3] == ["run", "services", "list"]:
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
    bin_dir.mkdir(exist_ok=True)
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
    log = (tmp_path / "gcloud.log").read_text().splitlines()
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
