"""The Budget-day workflows' shape (#105): triggers, runner, schedule."""

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
        "${{ inputs.runner || vars.PUBLISH_MEASURE_RUNNER || "
        "'ubuntu-latest-16-cores' }}"
    )
    assert compute["env"]["HUGGING_FACE_TOKEN"] == (
        "${{ secrets.PE_UK_PRIVATE_HF_READ_TOKEN }}"
    )
    assert compute["permissions"] == {"contents": "read"}
    detect = "\n".join(step.get("run", "") for step in jobs["detect"]["steps"])
    assert "uk-budget-data changed-measures --base HEAD^ --head HEAD" in detect


def test_one_data_pr_for_all_measures_never_merged():
    for name in ("publish-measure.yml", "refresh-combined.yml"):
        job = load(name)["jobs"]["data-pr"]
        runs = [step.get("run", "") for step in job["steps"]]
        assert any("uk-budget-data apply-rows fragments" in r for r in runs)
        assert runs[-1] == "bash scripts/budget_day/open_data_pr.sh"
        text = (WORKFLOWS / name).read_text()
        assert (
            "gh pr merge" not in text
            and "sign-pending" not in text.split("jobs:")[1]
        )
    script = (
        WORKFLOWS.parent.parent / "scripts" / "budget_day" / "open_data_pr.sh"
    ).read_text()
    assert "gh pr create --draft --base main" in script
    assert "Review rows are pending; the Reconciler signs before merge." in (
        script
    )
    assert "merge" not in script.split("gh pr create")[1]


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
