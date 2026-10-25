"""The Budget-day workflows' shape (#105, on #104): triggers, runner,
schedule, and the receipted-artifact path (generate, stage, never approve)."""

from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"


def load(name):
    document = yaml.safe_load((WORKFLOWS / name).read_text())
    # PyYAML reads the `on` key as True
    document["on"] = document.pop(True)
    return document


def expand(field: str, low: int, high: int) -> list[int]:
    values = []
    for part in field.split(","):
        if part == "*":
            values.extend(range(low, high + 1))
        elif "-" in part:
            start, end = part.split("-")
            values.extend(range(int(start), int(end) + 1))
        else:
            values.append(int(part))
    return values


def test_publish_measure_runs_on_a_registry_push_and_on_dispatch():
    workflow = load("publish-measure.yml")
    assert workflow["on"]["push"] == {
        "branches": ["main"],
        "paths": ["src/uk_budget_data/reforms.py"],
    }
    assert "measures" in workflow["on"]["workflow_dispatch"]["inputs"]
    assert workflow["permissions"] == {}
    assert workflow["concurrency"]["cancel-in-progress"] is False


def test_publish_measure_runs_each_measure_on_the_configured_runner():
    jobs = load("publish-measure.yml")["jobs"]
    compute = jobs["compute"]
    assert compute["strategy"]["matrix"]["measure"] == (
        "${{ fromJSON(needs.detect.outputs.measures) }}"
    )
    assert compute["runs-on"] == (
        "${{ needs.detect.outputs.backend == 'modal' && 'ubuntu-latest' || "
        "(inputs.runner || vars.PUBLISH_MEASURE_RUNNER || 'larger-runner') }}"
    )
    assert "max-parallel" not in compute["strategy"]
    assert compute["env"]["HUGGING_FACE_TOKEN"] == (
        "${{ secrets.PE_UK_PRIVATE_HF_READ_TOKEN }}"
    )
    assert compute["permissions"] == {"contents": "read"}
    detect = "\n".join(step.get("run", "") for step in jobs["detect"]["steps"])
    assert "uk-budget-data changed-measures --base HEAD^ --head HEAD" in detect


def test_one_data_pr_for_all_measures_never_approved_or_merged():
    for name in ("publish-measure.yml", "refresh-combined.yml"):
        job = load(name)["jobs"]["data-pr"]
        runs = [step.get("run", "") for step in job["steps"]]
        assert any("uk-budget-data stage-artifacts" in r for r in runs)
        assert any(
            r == "bash scripts/budget_day/open_data_pr.sh" for r in runs
        )
        text = (WORKFLOWS / name).read_text()
        body = text.split("jobs:")[1]
        for forbidden in (
            "gh pr merge",
            "publish approve",
            "sign-measures --by",
            "review-rows",
            "apply-rows",
            "budgetary_impact.csv",
        ):
            assert forbidden not in body, (name, forbidden)
    script = (
        WORKFLOWS.parent.parent / "scripts" / "budget_day" / "open_data_pr.sh"
    ).read_text()
    assert "gh pr create --draft --base main" in script
    assert "git status --porcelain" in script
    assert "reconciliation.json" in script and "-delete" in script
    assert "merge" not in script.split("gh pr create")[1]


def test_measures_are_generated_as_receipted_artifacts_one_per_job():
    workflow = load("publish-measure.yml")
    steps = workflow["jobs"]["compute"]["steps"]
    local = next(
        s
        for s in steps
        if s.get("name") == "Generate the measure's receipted artifact"
    )
    assert local["if"] == "env.BACKEND == 'runner'"
    assert 'publish-measure "${MEASURE}" --no-stage' in local["run"]
    # Every policy year: a narrower run drops a scored year
    runs = "\n".join(
        step.get("run", "")
        for job in workflow["jobs"].values()
        for step in job["steps"]
    )
    assert "--years" not in runs
    upload = next(s for s in steps if "upload-artifact" in s.get("uses", ""))
    assert upload["with"]["path"] == "public/data/artifacts/"


def test_only_new_artifacts_are_staged():
    for name in ("publish-measure.yml", "refresh-combined.yml"):
        job = load(name)["jobs"]["data-pr"]
        stage = next(s for s in job["steps"] if s.get("id") == "stage")
        assert 'if [ -e "${dest}" ]' in stage["run"]
        assert '"${placed[@]}"' in stage["run"]
        assert "--private-dir" in stage["run"]
    checkout = next(
        s
        for s in load("refresh-combined.yml")["jobs"]["data-pr"]["steps"]
        if "checkout" in s.get("uses", "")
    )
    assert checkout["with"]["ref"] == "${{ needs.compute.outputs.sha }}"


def test_timing_runs_one_measure_end_to_end_without_a_pr():
    workflow = load("publish-measure.yml")
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert inputs["timing"]["type"] == "boolean"
    assert inputs["timing"]["default"] is False
    jobs = workflow["jobs"]
    timing = jobs["timing"]
    assert timing["runs-on"] == (
        "${{ inputs.runner || vars.PUBLISH_MEASURE_RUNNER || 'larger-runner' }}"
    )
    run = "\n".join(s.get("run", "") for s in timing["steps"])
    assert "publish-measure" in run and "stage-artifacts" in run
    assert "GITHUB_STEP_SUMMARY" in run and "/usr/bin/time -v" in run
    assert "open_data_pr" not in run
    assert "!inputs.timing" in jobs["compute"]["if"]
    assert "!inputs.timing" in jobs["data-pr"]["if"]


def test_provisional_staging_is_a_dispatch_choice():
    workflow = load("publish-measure.yml")
    provisional = workflow["on"]["workflow_dispatch"]["inputs"]["provisional"]
    assert provisional["default"] is False
    stage = next(
        s
        for s in workflow["jobs"]["data-pr"]["steps"]
        if s.get("id") == "stage"
    )
    assert "--provisional" in stage["run"]


def test_refresh_combined_runs_every_half_hour_on_budget_day():
    workflow = load("refresh-combined.yml")
    times = set()
    for entry in workflow["on"]["schedule"]:
        minute, hour, day, month, weekday = entry["cron"].split()
        assert (day, month, weekday) == ("28", "10", "*")
        for h in expand(hour, 0, 23):
            for m in expand(minute, 0, 59):
                times.add((h, m))
    # London is on GMT on 28 October 2026, so 12:30 to 18:00 London is the
    # same in UTC
    expected = (
        {(12, 30)}
        | {(h, m) for h in range(13, 18) for m in (0, 30)}
        | {(18, 0)}
    )
    assert times == expected
    assert "workflow_dispatch" in workflow["on"]
    gate = "\n".join(
        step.get("run", "") for step in workflow["jobs"]["gate"]["steps"]
    )
    assert "2026-10-28" in gate
    assert workflow["jobs"]["compute"]["if"] == (
        "needs.gate.outputs.run == 'true'"
    )
    assert workflow["concurrency"] == {
        "group": "refresh-combined",
        "cancel-in-progress": False,
    }


def test_both_workflows_default_to_the_org_larger_runner():
    for name in ("publish-measure.yml", "refresh-combined.yml"):
        text = (WORKFLOWS / name).read_text()
        assert "ubuntu-latest-16-cores" not in text
        assert "'larger-runner'" in text
    combined = load("refresh-combined.yml")["jobs"]["compute"]
    assert combined["runs-on"] == (
        "${{ inputs.runner || vars.PUBLISH_MEASURE_RUNNER || 'larger-runner' }}"
    )


def test_dispatches_for_different_measures_do_not_share_a_group():
    group = load("publish-measure.yml")["concurrency"]["group"]
    assert "github.sha" in group and "inputs.measures" in group


def test_modal_backend_is_opt_in_and_guarded():
    workflow = load("publish-measure.yml")
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert inputs["backend"]["default"] == ""
    detect = workflow["jobs"]["detect"]
    backend = next(s for s in detect["steps"] if s.get("id") == "backend")
    assert backend["env"]["BACKEND"] == (
        "${{ inputs.backend || vars.PUBLISH_MEASURE_BACKEND || 'runner' }}"
    )
    assert "runner|modal)" in backend["run"] and "exit 1" in backend["run"]

    steps = workflow["jobs"]["compute"]["steps"]
    by_name = {step.get("name"): step for step in steps}
    local = by_name["Generate the measure's receipted artifact"]
    assert local["if"] == "env.BACKEND == 'runner'"
    assert "--backend" not in local["run"]
    guard = by_name["Check the Modal backend is available"]
    assert guard["if"] == "env.BACKEND == 'modal'"
    assert "generate --help | grep -q -- '--backend'" in guard["run"]
    assert "exit 1" in guard["run"]
    modal = by_name["Generate the measure's receipted artifact on Modal"]
    assert modal["if"] == "env.BACKEND == 'modal'"
    assert steps.index(guard) < steps.index(modal)
    assert "--backend modal" in modal["run"]
    assert "generate --artifacts" in modal["run"]
    assert "uv run --with modal==1.6.2" in modal["run"]
    # The Modal token reaches only the step that calls Modal
    assert modal["env"] == {
        "MODAL_TOKEN_ID": "${{ secrets.MODAL_TOKEN_ID }}",
        "MODAL_TOKEN_SECRET": "${{ secrets.MODAL_TOKEN_SECRET }}",
    }
    for step in steps:
        if step is not modal:
            assert "MODAL_TOKEN_ID" not in step.get("env", {})
    assert "MODAL_TOKEN_ID" not in workflow["jobs"]["compute"]["env"]
