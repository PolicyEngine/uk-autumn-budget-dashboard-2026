"""Run cloudbuild-rollback.yaml's shell steps against stand-ins.

Each step is taken from the real file, with Cloud Build's substitutions
applied as Cloud Build applies them, and run by bash with a fake gcloud (and
git, where a step clones) that records every call and answers from a
scripted service, as tests/test_cloudbuild.py does for cloudbuild.yaml.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
CONFIG = yaml.safe_load((REPO / "cloudbuild-rollback.yaml").read_text())
DEPLOY = yaml.safe_load((REPO / "cloudbuild.yaml").read_text())
BUILD_ID = "0123abcd-4567-89ef-0123-456789abcdef"
REVISION = "uk-budget-api-2026-00002-abc"
COMMIT = "c" * 40
REPOSITORY = "europe-west1-docker.pkg.dev/p/r/uk-budget-api-2026"
DIGEST = REPOSITORY + "@sha256:" + "d" * 64
DEPLOY_BUILD = "fedcba98-7654-3210-fedc-ba9876543210"
MAIN = "e" * 40

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None, reason="needs bash"
)


def step_script(step_id: str, workspace: Path, **substitutions) -> str:
    step = next(s for s in CONFIG["steps"] if s["id"] == step_id)
    script = step["args"][-1]
    values = {**CONFIG["substitutions"], "_REVISION": REVISION}
    values.update(
        {k: v for k, v in substitutions.items() if k.startswith("_")}
    )
    for name, value in values.items():
        script = script.replace("${" + name + "}", value)
    script = (
        script.replace("${PROJECT_ID}", "p")
        .replace("${BUILD_ID}", BUILD_ID)
        .replace("${LOCATION}", substitutions.get("LOCATION", "europe-west1"))
    )
    assert "${" not in script.replace("$${", ""), "unsubstituted variable"
    return script.replace("$$", "$").replace("/workspace", str(workspace))


FAKE = r"""#!/usr/bin/env python3
import json, os, sys
name = os.path.basename(sys.argv[0])
args = sys.argv[1:]
path = os.environ["FAKE_STATE"]
state = json.load(open(path))
state.setdefault("calls", []).append([name, *args])

def save():
    json.dump(state, open(path, "w"))

if name == "git":
    if args[0] == "clone":
        os.makedirs(args[-1], exist_ok=True)
    elif "merge-base" in args:
        save()
        sys.exit(0 if args[-2] in state.get("on_main", []) else 1)
    elif "archive" in args:
        # main's copy of each named file, as git archive writes it.
        import io, tarfile
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            for member in args[args.index("archive") + 2:]:
                source = os.path.join(state["main_tree"], member)
                data = open(source, "rb").read()
                info = tarfile.TarInfo(member)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        save()
        sys.stdout.buffer.write(buffer.getvalue())
        sys.exit(0)
    elif "rev-parse" in args:
        print(state["main_sha"])
elif args[:2] == ["builds", "describe"]:
    build = state.get("builds", {}).get(args[2])
    if build is None:
        save()
        sys.exit("ERROR: build not found")
    print(json.dumps(build))
elif args[:3] == ["builds", "list", "--ongoing"]:
    print("\n".join(state.get("ongoing", [])))
elif args[:3] == ["run", "revisions", "describe"]:
    revision = state["revisions"].get(args[3])
    if revision is None:
        save()
        sys.exit("ERROR: revision not found")
    print(json.dumps(revision))
elif args[:3] == ["run", "services", "describe"]:
    print(json.dumps({"status": {"traffic": state["traffic"]}}))
elif args[:3] == ["run", "services", "update-traffic"]:
    if "--update-tags" in args:
        tag, _, revision = args[args.index("--update-tags") + 1].partition("=")
        state["traffic"].append(
            {"revisionName": revision, "tag": tag, "url": "https://" + tag}
        )
    if "--to-revisions" in args:
        target = args[args.index("--to-revisions") + 1].split("=")[0]
        for t in state["traffic"]:
            t.pop("percent", None)
        for t in state["traffic"]:
            if t["revisionName"] == target and "tag" not in t:
                t["percent"] = 100
                break
        else:
            state["traffic"].append({"revisionName": target, "percent": 100})
    if "--remove-tags" in args:
        tag = args[args.index("--remove-tags") + 1]
        state["traffic"] = [t for t in state["traffic"] if t.get("tag") != tag]
else:
    save()
    sys.exit("unexpected call: " + name + " " + " ".join(args))
save()
"""


def run(script: str, tmp_path: Path, state: dict):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    for tool in ("gcloud", "git"):
        fake = bin_dir / tool
        fake.write_text(FAKE)
        fake.chmod(0o755)
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps(state))
    # In the test's own folder, so nothing a step writes by a relative path
    # can land in the repository.
    result = subprocess.run(
        ["bash", "-c", script],
        cwd=tmp_path,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "FAKE_STATE": str(state_file),
        },
        capture_output=True,
        text=True,
    )
    return result, json.loads(state_file.read_text())


def revision(**labels_and_status) -> dict:
    labels = {
        "serving.knative.dev/service": "uk-budget-api-2026",
        "commit-sha": COMMIT,
        "gcb-build-id": DEPLOY_BUILD,
    }
    ready = labels_and_status.pop("ready", "True")
    image = labels_and_status.pop("image", DIGEST)
    resolved = labels_and_status.pop("resolved", DIGEST)
    labels.update(labels_and_status)
    labels = {k: v for k, v in labels.items() if v is not None}
    return {
        "metadata": {"labels": labels},
        "spec": {"containers": [{"image": image}]},
        "status": {
            "conditions": [{"type": "Ready", "status": ready}],
            "imageDigest": resolved,
        },
    }


def deploy_build(**changes) -> dict:
    """The deploy build's own record, as gcloud builds describe gives it."""
    build = {
        "id": DEPLOY_BUILD,
        "status": "SUCCESS",
        "tags": ["uk-budget-api-2026-deploy"],
        "substitutions": {"_GIT_SHA": COMMIT},
        "steps": [
            {"id": "exclusive", "status": "SUCCESS"},
            {"id": "verify-source", "status": "SUCCESS"},
            {"id": "smoke", "status": "SUCCESS"},
            {"id": "promote", "status": "SUCCESS"},
        ],
        "results": {
            "images": [
                {
                    "name": f"{REPOSITORY}:{COMMIT}",
                    "digest": "sha256:" + "d" * 64,
                }
            ]
        },
    }
    build.update(changes)
    return build


def service(**overrides) -> dict:
    return {
        "revisions": {REVISION: revision()},
        "builds": {DEPLOY_BUILD: deploy_build()},
        "traffic": [
            {"revisionName": "uk-budget-api-2026-00003-xyz", "percent": 100}
        ],
        "on_main": [COMMIT],
        "main_tree": str(REPO),
        "main_sha": MAIN,
        **overrides,
    }


@pytest.fixture
def workspace(tmp_path):
    space = tmp_path / "workspace"
    space.mkdir()
    return space


def test_every_step_parses_after_substitution(workspace):
    for step in CONFIG["steps"]:
        step_script(step["id"], workspace)


def test_it_shares_the_deploy_lock_and_service():
    """A rollback and a deploy see each other as running deploys."""
    assert CONFIG["tags"] == DEPLOY["tags"] == ["uk-budget-api-2026-deploy"]
    for key in ("_SERVICE", "_REGION", "_REPOSITORY"):
        assert CONFIG["substitutions"][key] == DEPLOY["substitutions"][key]


@pytest.mark.parametrize(
    "location, ongoing, ok",
    [
        ("europe-west1", [], True),
        ("global", [], False),
        ("europe-west1", ["another-build"], False),
    ],
)
def test_one_deploy_or_rollback_at_a_time_in_the_region(
    tmp_path, workspace, location, ongoing, ok
):
    result, _ = run(
        step_script("exclusive", workspace, LOCATION=location),
        tmp_path,
        service(ongoing=ongoing),
    )
    assert (result.returncode == 0) is ok


def test_a_revision_built_by_this_pipeline_is_accepted(tmp_path, workspace):
    result, _ = run(
        step_script("check-revision", workspace), tmp_path, service()
    )
    assert result.returncode == 0, result.stderr
    assert (workspace / "commit").read_text() == COMMIT
    assert (workspace / "image_ref").read_text() == DIGEST
    assert json.loads((workspace / "previous_traffic").read_text()) == [
        ["uk-budget-api-2026-00003-xyz", 100]
    ]


@pytest.mark.parametrize(
    "target, message",
    [
        (
            revision(**{"serving.knative.dev/service": "other"}),
            "not a revision",
        ),
        (revision(ready="False"), "not ready"),
        (revision(**{"commit-sha": None}), "names no commit"),
        (revision(**{"commit-sha": "not-a-commit"}), "names no commit"),
        (revision(**{"gcb-build-id": None}), "names no build"),
        (
            revision(**{"gcb-build-id": "THIS-BUILD-DOES-NOT-EXIST"}),
            "names no build",
        ),
        (revision(resolved=""), "no resolved image"),
        (revision(image=""), "no image digest"),
        (
            revision(image=DIGEST.split("@")[0] + ":latest"),
            "no image digest",
        ),
        (
            revision(resolved=DIGEST.split("@")[0] + "@sha256:" + "e" * 64),
            "not the",
        ),
    ],
)
def test_a_revision_this_pipeline_did_not_build_is_refused(
    tmp_path, workspace, target, message
):
    """Review M1: rollback promoted a revision with no commit label, or
    one whose smoke test had failed, on readiness alone."""
    result, _ = run(
        step_script("check-revision", workspace),
        tmp_path,
        service(revisions={REVISION: target}),
    )
    assert result.returncode != 0
    assert message in result.stderr


@pytest.mark.parametrize(
    "name",
    [
        "",
        "other-00002-abc",
        "uk-budget-api-2026",
        "uk-budget-api-2026-00002-ABC",
        "uk-budget-api-2026-00002-abc --region=us-central1",
    ],
)
def test_only_a_revision_name_of_this_service(tmp_path, workspace, name):
    """Refused by name before anything is looked up, even where a
    revision by that name would pass every other check."""
    result, state = run(
        step_script("check-revision", workspace, _REVISION=name),
        tmp_path,
        service(revisions={name: revision()}),
    )
    assert result.returncode != 0
    assert "must name a revision" in result.stderr
    assert not [c for c in state.get("calls", []) if "revisions" in c]


@pytest.mark.parametrize("on_main, ok", [([COMMIT], True), ([], False)])
def test_the_revision_commit_must_be_on_main(tmp_path, workspace, on_main, ok):
    (workspace / "commit").write_text(COMMIT)
    result, state = run(
        step_script("on-main", workspace), tmp_path, service(on_main=on_main)
    )
    assert (result.returncode == 0) is ok
    clone = next(c for c in state["calls"] if c[:2] == ["git", "clone"])
    assert "--filter=blob:none" in clone and "--branch" in clone


def _checked(workspace):
    (workspace / "commit").write_text(COMMIT)
    (workspace / "image_ref").write_text(DIGEST)
    (workspace / "build_id").write_text(DEPLOY_BUILD)


def test_a_revision_its_successful_deploy_build_backs_is_accepted(
    tmp_path, workspace
):
    _checked(workspace)
    result, state = run(
        step_script("provenance", workspace), tmp_path, service()
    )
    assert result.returncode == 0, result.stderr
    assert state["calls"][0][:4] == [
        "gcloud",
        "builds",
        "describe",
        DEPLOY_BUILD,
    ]


def _pushed(name, digest):
    return {"images": [{"name": name, "digest": "sha256:" + digest * 64}]}


@pytest.mark.parametrize(
    "build, message",
    [
        (deploy_build(status="FAILURE"), "ended FAILURE"),
        (deploy_build(tags=["other"]), "not a deploy of this service"),
        (
            deploy_build(substitutions={"_REVISION": REVISION}),
            "was of commit None",
        ),
        (
            deploy_build(substitutions={"_GIT_SHA": "b" * 40}),
            "was of commit 'bbbb",
        ),
        (
            deploy_build(results=_pushed(f"{REPOSITORY}:{COMMIT}", "e")),
            "did not push the image it runs",
        ),
        (
            deploy_build(results=_pushed(f"elsewhere/other:{COMMIT}", "d")),
            "did not push the image it runs",
        ),
        (deploy_build(results={}), "did not push the image it runs"),
        (
            deploy_build(
                steps=[
                    {"id": "verify-source", "status": "SUCCESS"},
                    {"id": "smoke", "status": "FAILURE"},
                ]
            ),
            "did not pass a smoke step",
        ),
        (
            deploy_build(steps=[{"id": "smoke", "status": "SUCCESS"}]),
            "did not pass a verify-source step",
        ),
        (deploy_build(steps=[]), "did not pass a verify-source step"),
    ],
)
def test_a_revision_its_build_record_does_not_back_is_refused(
    tmp_path, workspace, build, message
):
    """Review A: labels are only what a revision says about itself. The
    build they name must be a successful deploy of this service, of that
    commit, that pushed the image the revision runs."""
    _checked(workspace)
    result, _ = run(
        step_script("provenance", workspace),
        tmp_path,
        service(builds={DEPLOY_BUILD: build}),
    )
    assert result.returncode != 0
    assert message in result.stderr


def test_a_revision_naming_an_unknown_build_is_refused(tmp_path, workspace):
    _checked(workspace)
    result, _ = run(
        step_script("provenance", workspace), tmp_path, service(builds={})
    )
    assert result.returncode != 0


def test_the_checker_is_mains_own_copy(tmp_path, workspace):
    """Review A: the smoke checker came from the revision's own image, so an
    older revision brought an older, weaker checker. It now comes from
    main's tip: two standard-library modules under an empty package."""
    (workspace / "commit").write_text(COMMIT)
    result, state = run(step_script("on-main", workspace), tmp_path, service())
    assert result.returncode == 0, result.stderr
    package = workspace / "checker" / "src" / "uk_budget_data"
    for module in ("deploy_smoke.py", "runtime_identity.py"):
        assert (package / module).read_bytes() == (
            REPO / "src" / "uk_budget_data" / module
        ).read_bytes()
    assert (package / "__init__.py").read_text() == ""
    (archive,) = [c for c in state["calls"] if "archive" in c]
    assert archive[archive.index("archive") + 1] == "main"
    assert f"Smoke checker from main at {MAIN}" in result.stdout


def test_the_images_expectations_are_only_data(workspace):
    """The image supplies what it is (identity, routes and definitions) and
    nothing else; nothing of its own decides pass or fail."""
    script = step_script("expectations", workspace)
    assert f'docker run --rm "$(cat {workspace}/image_ref)"' in script
    assert script.rstrip().endswith(f"> {workspace}/expectations.json")
    assert "deploy_smoke" not in script


def _expectations_snippet(workspace) -> str:
    script = step_script("expectations", workspace)
    return script.split("python -c '", 1)[1].rsplit("' >", 1)[0]


def test_the_written_out_expectations_match_print_expectations(
    workspace, monkeypatch
):
    """Differential: the snippet the image runs gives exactly what
    deploy_smoke.print_expectations returns."""
    from uk_budget_data import deploy_smoke

    result = subprocess.run(
        [sys.executable, "-c", _expectations_snippet(workspace)],
        capture_output=True,
        text=True,
        env={**os.environ, "GIT_SHA": COMMIT},
    )
    assert result.returncode == 0, result.stderr
    monkeypatch.setenv("GIT_SHA", COMMIT)
    assert json.loads(result.stdout) == deploy_smoke.print_expectations()


def _smoke(tmp_path, workspace, impact=None):
    """Run the rollback's real smoke step against a local API, with main's
    checker extracted as on-main extracts it."""
    from tests.smoke_server import household_impact_answer, serving
    from tests.test_deploy_smoke import BUILD

    identity = {**BUILD, "git_sha": COMMIT}
    (workspace / "commit").write_text(COMMIT)
    extracted, _ = run(step_script("on-main", workspace), tmp_path, service())
    assert extracted.returncode == 0, extracted.stderr
    (workspace / "expectations.json").write_text(
        json.dumps(
            {"identity": identity, "household_impact": {"declared": True}}
        )
    )
    with serving(
        identity, household_impact=impact or household_impact_answer()
    ) as (url, _):
        (workspace / "tagged_url").write_text(url)
        result, _ = run(
            step_script("smoke", workspace), tmp_path / "smoke", {}
        )
    return result


def test_the_smoke_step_passes_a_good_revision_on_plain_python(
    tmp_path, workspace
):
    result = _smoke(tmp_path, workspace)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"pass": true' in result.stdout


def test_the_smoke_step_refuses_what_todays_checker_refuses(
    tmp_path, workspace
):
    """Review A's reproducer: a nested error that an older checker passed."""
    from tests.smoke_server import household_impact_answer

    body = household_impact_answer()
    body["net_income"]["error"] = "calculation failed"
    result = _smoke(tmp_path, workspace, body)
    assert result.returncode != 0


def test_the_tag_is_this_builds_and_carries_no_traffic(tmp_path, workspace):
    result, state = run(step_script("tag", workspace), tmp_path, service())
    assert result.returncode == 0, result.stderr
    tag = (workspace / "tag").read_text().strip()
    assert tag.startswith("rb") and len(tag) + len("uk-budget-api-2026") <= 46
    tagged = [t for t in state["traffic"] if t.get("tag") == tag]
    assert tagged == [
        {"revisionName": REVISION, "tag": tag, "url": "https://" + tag}
    ]
    assert (workspace / "tagged_url").read_text().strip() == "https://" + tag


def promote(tmp_path, workspace, previous, traffic, ongoing=()):
    (workspace / "previous_traffic").write_text(json.dumps(previous))
    (workspace / "tag").write_text("rbtag")
    return run(
        step_script("promote", workspace),
        tmp_path,
        service(traffic=traffic, ongoing=list(ongoing)),
    )


def test_promotion_moves_all_traffic_drops_the_tag_and_says_how_to_undo(
    tmp_path, workspace
):
    before = [
        {"revisionName": "uk-budget-api-2026-00003-xyz", "percent": 100},
        {"revisionName": REVISION, "tag": "rbtag", "url": "https://rbtag"},
    ]
    result, state = promote(
        tmp_path,
        workspace,
        [["uk-budget-api-2026-00003-xyz", 100]],
        before,
    )
    assert result.returncode == 0, result.stderr
    live = [
        (t["revisionName"], t["percent"])
        for t in state["traffic"]
        if t.get("percent")
    ]
    assert live == [(REVISION, 100)]
    assert not [t for t in state["traffic"] if t.get("tag") == "rbtag"]
    assert "--to-revisions uk-budget-api-2026-00003-xyz=100" in result.stdout


def test_promotion_stops_if_traffic_moved_during_the_rollback(
    tmp_path, workspace
):
    """Review M3: a deploy that promoted B after the rollback looked at
    traffic was overwritten, and the log named the wrong predecessor."""
    moved = [{"revisionName": "uk-budget-api-2026-00004-new", "percent": 100}]
    result, state = promote(
        tmp_path,
        workspace,
        [["uk-budget-api-2026-00003-xyz", 100]],
        moved,
    )
    assert result.returncode != 0
    assert "Traffic changed" in result.stderr
    assert state["traffic"] == moved


def test_promotion_stops_while_a_deploy_is_running(tmp_path, workspace):
    traffic = [
        {"revisionName": "uk-budget-api-2026-00003-xyz", "percent": 100}
    ]
    result, state = promote(
        tmp_path,
        workspace,
        [["uk-budget-api-2026-00003-xyz", 100]],
        traffic,
        ongoing=["deploy-build"],
    )
    assert result.returncode != 0
    assert state["traffic"] == traffic
