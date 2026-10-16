"""read-api-memory.yml and scripts/read_api_memory.py.

The workflow's shell steps run against stand-in gcloud and curl that record
every call and answer from a scripted state, as tests/test_deploy_workflow.py
does for the deploy workflow.
"""

import importlib.util
import json
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from hypothesis import given
from hypothesis import strategies as st

REPO = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO / ".github" / "workflows" / "read-api-memory.yml"
WORKFLOW = yaml.safe_load(WORKFLOW_PATH.read_text())
DEPLOY = yaml.safe_load(
    (REPO / ".github" / "workflows" / "deploy-api.yml").read_text()
)
SCRIPT = REPO / "scripts" / "read_api_memory.py"
spec = importlib.util.spec_from_file_location("read_api_memory", SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

REVISION = "uk-budget-api-2026-00016-tes"
START = "2026-10-16T07:30:00Z"
END = "2026-10-16T07:50:00Z"
TOKEN = "ya29.TOKEN-NOT-TO-PRINT"

needs_bash = pytest.mark.skipif(
    shutil.which("bash") is None, reason="needs bash"
)

FAKE = r"""#!/usr/bin/env python3
import json, os, sys
name = os.path.basename(sys.argv[0])
args = sys.argv[1:]
path = os.environ["FAKE_STATE"]
state = json.load(open(path))
state.setdefault("calls", []).append([name, *args])
out, err, code = "", "", 0
if name == "curl":
    target = args[args.index("-o") + 1]
    pages = state.get("monitoring_pages") or [state.get("monitoring_body", {})]
    token = next(
        (a.split("=", 1)[1] for a in args if a.startswith("pageToken=")), ""
    )
    index = int(token[1:]) if token else 0
    with open(target, "w") as body:
        body.write(json.dumps(pages[index]))
    out = str(state.get("monitoring_code", 200))
elif args[:3] == ["run", "revisions", "describe"]:
    revision = state.get("revisions", {}).get(args[3])
    if revision is None:
        code, err = 1, "NOT_FOUND"
    else:
        out = json.dumps(revision)
elif args[:2] == ["logging", "read"]:
    if state.get("logging_denied"):
        code, err = 1, "PERMISSION_DENIED: logging.logEntries.list"
    else:
        out = json.dumps(state.get("entries", []))
elif args[:2] == ["auth", "print-access-token"]:
    out = state["token"]
json.dump(state, open(path, "w"))
if out:
    print(out, end="" if name == "curl" else "\n")
if err:
    print(err, file=sys.stderr)
sys.exit(code)
"""


def step(name: str) -> dict:
    return next(
        s for s in WORKFLOW["jobs"]["read"]["steps"] if s.get("name") == name
    )


def run(tmp_path: Path, name: str, state: dict | None = None, **env):
    """Run one step's script as the workflow would, in a checkout-like
    directory holding the reader script."""
    state = {"token": TOKEN, **(state or {})}
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for tool in ("gcloud", "curl"):
        fake = bin_dir / tool
        fake.write_text(FAKE)
        fake.chmod(0o755)
    (tmp_path / "scripts").mkdir(exist_ok=True)
    shutil.copy(SCRIPT, tmp_path / "scripts" / SCRIPT.name)
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps(state))
    output = tmp_path / "output"
    output.write_text("")
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", step(name)["run"]],
        cwd=tmp_path,
        env={
            "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "FAKE_STATE": str(state_file),
            "GITHUB_OUTPUT": str(output),
            "GITHUB_REF": "refs/heads/main",
            "WIF_PROVIDER": "projects/1/locations/global/workloadIdentityPools/p/providers/q",
            "DEPLOY_SERVICE_ACCOUNT": "deployer@policyengine-apps.iam.gserviceaccount.com",
            "INPUT_REVISION": REVISION,
            "INPUT_START": START,
            "INPUT_END": END,
            "END": END,
            "LIMIT_MIB": "2048",
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


def test_it_runs_only_when_asked_and_reads_the_deployed_service():
    triggers = WORKFLOW.get("on", WORKFLOW.get(True))
    assert list(triggers) == ["workflow_dispatch"]
    assert set(triggers["workflow_dispatch"]["inputs"]) == {
        "revision",
        "start",
        "end",
    }
    for key in ("PROJECT", "REGION", "SERVICE"):
        assert WORKFLOW["env"][key] == DEPLOY["env"][key]


def test_it_authenticates_as_the_deploy_workflow_does():
    """The same keyless identity, an OIDC token for its one job, and a
    checkout that keeps no credentials."""
    text = WORKFLOW_PATH.read_text()
    assert "secrets." not in text and "credentials_json" not in text
    assert WORKFLOW["permissions"] == {"contents": "read"}
    [job] = WORKFLOW["jobs"].values()
    assert job["permissions"] == {"contents": "read", "id-token": "write"}
    auth = [
        s
        for s in job["steps"]
        if s.get("uses", "").startswith("google-github-actions/auth@")
    ]
    deploy_auth = next(
        s
        for s in DEPLOY["jobs"]["deploy"]["steps"]
        if s.get("uses", "").startswith("google-github-actions/auth@")
    )
    assert len(auth) == 1 and auth[0] == deploy_auth
    checkout = job["steps"][0]
    assert checkout["uses"].startswith("actions/checkout@")
    assert checkout["with"]["persist-credentials"] is False


def test_each_step_reads_the_outputs_it_needs():
    """Review of #54: broken output wiring went unseen."""
    ids = {s.get("id") for s in WORKFLOW["jobs"]["read"]["steps"]}
    assert {"inputs", "limit", "oom", "utilisation"} <= ids
    end = "${{ steps.inputs.outputs.end }}"
    assert step("Out-of-memory lines")["env"] == {"END": end}
    assert step("Memory utilisation")["env"] == {
        "END": end,
        "LIMIT_MIB": "${{ steps.limit.outputs.mib }}",
    }
    assert step("Report")["env"] == {
        "LOGGING": "${{ steps.oom.outputs.problem }}",
        "MONITORING": "${{ steps.utilisation.outputs.problem }}",
    }


def test_no_input_reaches_a_script_except_through_the_environment():
    for s in WORKFLOW["jobs"]["read"]["steps"]:
        assert "${{" not in s.get("run", ""), s.get("name")


@pytest.mark.parametrize(
    "command",
    [
        "builds submit",
        "run deploy",
        "update-traffic",
        "services update",
        "set-iam-policy",
        "add-iam-policy-binding",
        " delete",
    ],
)
def test_it_never_changes_anything(command):
    for s in WORKFLOW["jobs"]["read"]["steps"]:
        assert command not in s.get("run", ""), s.get("name")


# --- the inputs -----------------------------------------------------------


@needs_bash
def test_good_inputs_give_the_window(tmp_path):
    result, _, outputs = run(tmp_path, "Check the inputs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs["end"] == END


@needs_bash
def test_an_empty_end_means_now(tmp_path):
    before = datetime.now(timezone.utc).replace(microsecond=0)
    start = (before - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    result, _, outputs = run(
        tmp_path, "Check the inputs", INPUT_START=start, INPUT_END=""
    )
    assert result.returncode == 0, result.stdout + result.stderr
    end = datetime.strptime(outputs["end"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )
    assert before <= end <= datetime.now(timezone.utc)


@needs_bash
@pytest.mark.parametrize(
    "env, message",
    [
        ({"GITHUB_REF": "refs/heads/feature"}, "run from main"),
        ({"WIF_PROVIDER": ""}, "repository variables"),
        ({"INPUT_REVISION": "other-service-00016-tes"}, "Name a revision"),
        (
            {"INPUT_REVISION": f'{REVISION}" OR textPayload:"x'},
            "Name a revision",
        ),
        (
            {"INPUT_REVISION": "uk-budget-api-2026-00016-TES"},
            "Name a revision",
        ),
        ({"INPUT_START": "2026-10-16 07:30"}, "start must look like"),
        ({"INPUT_START": "2026-02-30T07:30:00Z"}, "not a real time"),
        ({"INPUT_END": "2026-10-16T07:00:00Z"}, "before end"),
        ({"INPUT_END": "2026-10-30T07:30:00Z"}, "at most 7 days"),
    ],
)
def test_bad_inputs_stop_before_any_read(tmp_path, env, message):
    result, state, _ = run(tmp_path, "Check the inputs", **env)
    assert result.returncode != 0
    assert message in result.stdout
    assert "::error::" in result.stdout
    assert state.get("calls", []) == []


# --- the reads ------------------------------------------------------------

REVISION_JSON = {
    "spec": {"containers": [{"resources": {"limits": {"memory": "2Gi"}}}]}
}


@needs_bash
def test_the_limit_is_read_from_the_revision(tmp_path):
    result, state, outputs = run(
        tmp_path, "Memory limit", {"revisions": {REVISION: REVISION_JSON}}
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs["mib"] == "2048"
    assert calls(state, "gcloud", "run", "revisions", "describe")[0][4] == (
        REVISION
    )


@needs_bash
@pytest.mark.parametrize(
    "revisions, message",
    [
        ({}, "Could not read"),
        ({REVISION: {"spec": {"containers": [{}]}}}, "no memory limit"),
    ],
)
def test_an_unreadable_limit_stops(tmp_path, revisions, message):
    result, _, _ = run(tmp_path, "Memory limit", {"revisions": revisions})
    assert result.returncode != 0
    assert message in result.stdout


ENTRIES = [
    {
        "timestamp": "2026-10-16T07:41:00Z",
        "textPayload": "Memory limit of 2048 MiB exceeded with 2051 MiB "
        "used. Consider increasing the memory limit, see "
        "https://cloud.google.com/run/docs/configuring/memory-limits",
    },
    {
        "timestamp": "2026-10-16T07:35:00Z",
        "textPayload": "Memory limit of 2048 MiB exceeded with 2049 MiB used.",
    },
]
HOUSEHOLD_LINE = {
    "timestamp": "2026-10-16T07:37:00Z",
    "textPayload": "employment_income=30000 net=24123.45 Memory limit of",
}
# The message itself inside a line carrying figures: only its two numbers
# are printed.
HOUSEHOLD_WRAPPED = {
    "timestamp": "2026-10-16T07:38:00Z",
    "textPayload": "income 31000 net 25111.11 Memory limit of 2048 MiB "
    "exceeded with 2050 MiB used",
}
FILTER = [
    'resource.type="cloud_run_revision"',
    'logName="projects/policyengine-apps/logs/'
    'run.googleapis.com%2Fvarlog%2Fsystem"',
    'resource.labels.location="europe-west1"',
    'resource.labels.service_name="uk-budget-api-2026"',
    f'resource.labels.revision_name="{REVISION}"',
    f'timestamp>="{START}"',
    f'timestamp<="{END}"',
    'textPayload:"Memory limit of"',
]


@needs_bash
def test_out_of_memory_lines_come_from_the_system_log_of_the_revision(
    tmp_path,
):
    """Every clause, and nothing else: a filter widened with OR, or missing
    the system log, the region, the revision or the window, fails."""
    result, state, outputs = run(
        tmp_path, "Out-of-memory lines", {"entries": ENTRIES}
    )
    assert result.returncode == 0, result.stdout + result.stderr
    [read] = calls(state, "gcloud", "logging", "read")
    clauses = [line.strip() for line in read[3].splitlines() if line.strip()]
    assert clauses == FILTER
    assert "--limit=1000" in read
    assert "Out-of-memory lines: 2" in result.stdout
    assert "2026-10-16T07:35:00Z: 2049 MiB used of a 2048 MiB limit" in (
        result.stdout
    )
    assert result.stdout.index("07:35") < result.stdout.index("07:41")
    assert "problem" not in outputs


@needs_bash
def test_only_the_memory_message_is_printed_from_a_matching_line(tmp_path):
    """Review of #54: an application line matching the text printed whole,
    household figures and all."""
    result, _, _ = run(
        tmp_path,
        "Out-of-memory lines",
        {"entries": [*ENTRIES, HOUSEHOLD_LINE, HOUSEHOLD_WRAPPED]},
    )
    assert result.returncode == 0
    for figure in ("30000", "24123", "31000", "25111"):
        assert figure not in result.stdout
    assert "2026-10-16T07:38:00Z: 2050 MiB used of a 2048 MiB limit" in (
        result.stdout
    )
    assert "1 other matching lines" in result.stdout


@needs_bash
def test_a_read_that_reaches_its_limit_is_called_incomplete(tmp_path):
    """Review of #54: 100 of 101 lines came back with no warning."""
    result, _, outputs = run(
        tmp_path,
        "Out-of-memory lines",
        {"entries": ENTRIES},
        OOM_READ_LIMIT="2",
    )
    assert result.returncode == 0
    assert "may be cut short" in result.stdout
    assert outputs["problem"] == "out-of-memory lines cut short"


@needs_bash
def test_a_refused_log_read_is_named_and_the_run_goes_on(tmp_path):
    result, _, outputs = run(
        tmp_path, "Out-of-memory lines", {"logging_denied": True}
    )
    assert result.returncode == 0
    assert "roles/logging.viewer" in result.stdout
    assert outputs["problem"] == "logging.viewer"


def series(*points, labels=None):
    return {
        "resource": {"labels": labels or {"revision_name": REVISION}},
        "metric": {"labels": {}},
        "points": [
            {
                "interval": {"endTime": f"2026-10-16T07:{minute:02d}:00Z"},
                "value": {"doubleValue": value},
            }
            for value, minute in points
        ],
    }


SERIES = {"timeSeries": [series((0.41, 36), (0.58, 39))]}


@needs_bash
def test_utilisation_reports_the_peak_minute(tmp_path):
    result, state, outputs = run(
        tmp_path,
        "Memory utilisation",
        {"monitoring_code": 200, "monitoring_body": SERIES},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "Peak p99 utilisation 0.58 of 2048 MiB (about 1188 MiB) "
        "at 2026-10-16T07:39:00Z, over 2 minutes" in result.stdout
    )
    [request] = calls(state, "curl")
    assert (
        'filter=metric.type="run.googleapis.com/container/memory/'
        'utilizations" AND resource.labels.location="europe-west1" AND '
        'resource.labels.service_name="uk-budget-api-2026" AND '
        f'resource.labels.revision_name="{REVISION}"'
    ) in request
    for part in (
        f"interval.startTime={START}",
        f"interval.endTime={END}",
        "aggregation.alignmentPeriod=60s",
        "aggregation.perSeriesAligner=ALIGN_PERCENTILE_99",
    ):
        assert part in request
    assert "problem" not in outputs


@needs_bash
def test_every_page_is_read(tmp_path):
    """Review of #54: a second page's 0.98 peak went unread."""
    pages = [
        {"timeSeries": [series((0.41, 36))], "nextPageToken": "p1"},
        {"timeSeries": [series((0.98, 44))], "nextPageToken": "p2"},
        {"timeSeries": [series((0.50, 47))]},
    ]
    result, state, outputs = run(
        tmp_path,
        "Memory utilisation",
        {"monitoring_code": 200, "monitoring_pages": pages},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Peak p99 utilisation 0.98" in result.stdout
    assert "at 2026-10-16T07:44:00Z, over 3 minutes" in result.stdout
    requests = calls(state, "curl")
    assert len(requests) == 3
    assert "pageToken=p1" in requests[1] and "pageToken=p2" in requests[2]
    assert "problem" not in outputs


@needs_bash
def test_too_many_pages_is_called_incomplete(tmp_path):
    pages = [
        {"timeSeries": [series((0.4, n))], "nextPageToken": f"p{n + 1}"}
        for n in range(3)
    ]
    result, _, outputs = run(
        tmp_path,
        "Memory utilisation",
        {"monitoring_code": 200, "monitoring_pages": pages},
        MAX_PAGES="2",
    )
    assert result.returncode == 0
    assert outputs["problem"] == "utilisation cut short"


@needs_bash
@pytest.mark.parametrize(
    "field",
    [
        {"executionErrors": [{"code": 13, "message": "internal"}]},
        {"unreachable": ["projects/policyengine-apps/locations/x"]},
    ],
    ids=["execution-errors", "unreachable"],
)
def test_an_incomplete_answer_is_not_reported_as_the_peak(tmp_path, field):
    """Review of #54: an HTTP 200 carrying errors read as no points."""
    result, _, outputs = run(
        tmp_path,
        "Memory utilisation",
        {"monitoring_code": 200, "monitoring_body": {**SERIES, **field}},
    )
    assert result.returncode == 0
    assert "Peak p99" not in result.stdout
    assert outputs["problem"] == "utilisation incomplete"


@needs_bash
def test_the_token_is_masked_and_never_printed(tmp_path):
    result, _, _ = run(
        tmp_path,
        "Memory utilisation",
        {"monitoring_code": 200, "monitoring_body": SERIES},
    )
    lines = (result.stdout + result.stderr).splitlines()
    assert lines[0] == f"::add-mask::{TOKEN}"
    assert not any(TOKEN in line for line in lines[1:])


@needs_bash
@pytest.mark.parametrize(
    "code, problem, message",
    [
        (403, "monitoring.viewer", "roles/monitoring.viewer"),
        (500, "monitoring (HTTP 500)", "HTTP 500"),
    ],
)
def test_a_refused_metric_read_is_named(tmp_path, code, problem, message):
    result, _, outputs = run(
        tmp_path, "Memory utilisation", {"monitoring_code": code}
    )
    assert result.returncode == 0
    assert message in result.stdout
    assert outputs["problem"] == problem


@needs_bash
@pytest.mark.parametrize(
    "logging, monitoring, ok",
    [
        ("", "", True),
        ("logging.viewer", "", False),
        ("", "monitoring.viewer", False),
        ("out-of-memory lines cut short", "utilisation incomplete", False),
    ],
)
def test_the_run_fails_when_any_read_was_refused_or_incomplete(
    tmp_path, logging, monitoring, ok
):
    result, _, _ = run(
        tmp_path, "Report", LOGGING=logging, MONITORING=monitoring
    )
    assert (result.returncode == 0) is ok
    for problem in (logging, monitoring):
        if problem:
            assert problem in result.stdout


# --- the reader script ----------------------------------------------------


@pytest.mark.parametrize(
    "text, mib",
    [("2Gi", 2048), ("512Mi", 512), ("1.5Gi", 1536), ("4G", 4e9 / 2**20)],
)
def test_limits_in_mib(text, mib):
    revision = {
        "spec": {"containers": [{"resources": {"limits": {"memory": text}}}]}
    }
    assert reader.limit_mib(revision) == pytest.approx(mib)


@given(st.integers(min_value=1, max_value=10**6))
def test_a_limit_in_mi_is_that_many_mib(n):
    revision = {
        "spec": {
            "containers": [{"resources": {"limits": {"memory": f"{n}Mi"}}}]
        }
    }
    assert reader.limit_mib(revision) == n


POINTS = st.lists(
    st.tuples(
        st.floats(min_value=0, max_value=2, allow_nan=False),
        st.integers(min_value=0, max_value=59),
    ),
    min_size=1,
    max_size=30,
)


@given(st.lists(POINTS, min_size=1, max_size=4))
def test_each_series_peak_is_its_highest_point(series_points):
    series = [
        {
            "points": [
                {
                    "interval": {"endTime": f"2026-10-16T07:{minute:02d}:00Z"},
                    "value": {"doubleValue": value},
                }
                for value, minute in points
            ]
        }
        for points in series_points
    ]
    found = reader.peaks(series)
    assert len(found) == len(series)
    for one, points in zip(found, series_points):
        peak = max(value for value, _ in points)
        assert one["peak"] == peak
        assert one["points"] == len(points)
        # The latest minute at the peak (review of #54: a wrong minute
        # went unseen).
        latest = max(minute for value, minute in points if value == peak)
        assert one["at"] == f"2026-10-16T07:{latest:02d}:00Z"


def test_pages_join_a_series_split_across_them():
    pages = [
        {"timeSeries": [series((0.4, 1)), series((0.2, 1), labels={"a": 1})]},
        {"timeSeries": [series((0.9, 2))]},
    ]
    merged = reader.merge_pages(pages)
    assert len(merged) == 2
    assert [len(one["points"]) for one in merged] == [2, 1]


def test_a_series_without_points_is_skipped():
    assert reader.peaks([{"points": []}]) == []
