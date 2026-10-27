"""CI runs the Python suite in shards; together they must run every test once.

Each matrix entry of `python-test-parts` in .github/workflows/ci.yml is a
shard number. Every shard runs `tests/` and keeps the tests
tests/ci_shards.py assigns it (`--ci-shard K/N`), so a test belongs to
exactly one shard by construction. These tests hold the workflow to that
shape and the assignment to being a partition: a shard list with a gap, a
run line with its own paths or a split that dropped or doubled a test would
skip or double-run tests without failing anything else.
"""

import json
import random
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from tests import ci_shards

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = yaml.safe_load(
    (REPO / ".github" / "workflows" / "ci.yml").read_text()
)
JOB = WORKFLOW["jobs"]["python-test-parts"]
SHARDS = JOB["strategy"]["matrix"]["shard"]
RUN = next(
    step["run"]
    for step in JOB["steps"]
    if "pytest" in str(step.get("run", ""))
)


def test_the_shards_are_numbered_one_to_n():
    assert JOB["strategy"]["matrix"].keys() == {"shard"}
    assert SHARDS == list(range(1, len(SHARDS) + 1))
    assert len(SHARDS) >= 2


def test_the_run_line_runs_the_whole_suite_split_by_shard():
    """The test step runs `tests/` and narrows it only by shard and by the
    certified-data marker, which the Certified data job runs instead."""
    words = RUN.split()
    assert words[:3] == ["uv", "run", "pytest"]
    assert [word for word in words if "tests" in word] == ["tests/"]
    assert "--ci-shard ${{ matrix.shard }}/${{ strategy.job-total }}" in RUN
    assert '-m "not certified_data"' in RUN
    for narrowing in ("--ignore", "--deselect", " -k ", "--lf", "-x "):
        assert narrowing not in RUN, narrowing


def test_the_run_line_is_one_line_of_arguments():
    """Written with `>-`: newlines would become separate shell commands."""
    assert "\n" not in RUN.strip()


def test_the_required_check_waits_for_every_shard():
    aggregate = WORKFLOW["jobs"]["python-tests"]
    assert aggregate["name"] == "Python tests"
    assert aggregate["needs"] == "python-test-parts"
    assert aggregate["if"] == "always()"
    assert 'test "$PARTS" = success' in aggregate["steps"][0]["run"]


def _tests(count=400, groups=3):
    tests = [
        (f"tests/test_m{i % 17}.py::test_{i}", None) for i in range(count)
    ]
    for g in range(groups):
        for i in range(4):
            tests.append((f"tests/test_g.py::test_{g}_{i}@grp{g}", f"grp{g}"))
    return tests


def _durations(tests):
    rng = random.Random(7)
    return {
        ci_shards.base_node_id(node): rng.choice([0.1, 0.5, 2, 30, 300])
        for node, _ in tests
    }


@pytest.mark.parametrize("count", [1, 2, 10, 13])
def test_every_test_is_in_exactly_one_shard(count):
    tests = _tests()
    shards = ci_shards.assign(tests, count, _durations(tests))
    assert set(shards) == {node for node, _ in tests}
    assert set(shards.values()) <= set(range(1, count + 1))


def test_a_group_stays_in_one_shard():
    tests = _tests()
    shards = ci_shards.assign(tests, 10, _durations(tests))
    for group in ("grp0", "grp1", "grp2"):
        assert len({shards[n] for n, g in tests if g == group}) == 1


def test_every_runner_computes_the_same_split():
    """Each shard's runner and each xdist worker compute the split on their
    own; collection order must not change it."""
    tests = _tests()
    durations = _durations(tests)
    shuffled = tests[:]
    random.Random(1).shuffle(shuffled)
    assert ci_shards.assign(tests, 10, durations) == ci_shards.assign(
        shuffled, 10, durations
    )


def test_the_recorded_times_split_into_even_shards():
    """With the recorded times, no shard carries much more than its share,
    unless one test alone is longer than the share."""
    durations = ci_shards.load_durations()
    tests = [(node, None) for node in durations]
    shards = ci_shards.assign(tests, len(SHARDS), durations)
    loads = [0.0] * len(SHARDS)
    for node, shard in shards.items():
        loads[shard - 1] += durations[node]
    share = sum(loads) / len(loads)
    assert max(loads) <= max(1.1 * share, max(durations.values()) * 1.01)


def test_the_durations_file_records_seconds_by_node_id():
    recorded = json.loads(ci_shards.DURATIONS_FILE.read_text())
    assert recorded
    for node, seconds in recorded.items():
        assert node.startswith("tests/test_") and ".py::" in node, node
        assert "@" not in node, node
        assert isinstance(seconds, (int, float)) and seconds >= 0, node


@pytest.mark.parametrize("bad", ["0/3", "4/3", "3", "a/b"])
def test_a_shard_outside_one_to_n_is_refused(bad):
    with pytest.raises(ValueError):
        ci_shards.parse_shard(bad)


def _collect(*args):
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "--collect-only",
            "-o",
            "addopts=",
            "-q",
            "-p",
            "no:cacheprovider",
            "tests/test_ci_parts.py",
            *args,
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return {line for line in result.stdout.splitlines() if "::" in line}


def test_the_shard_option_partitions_a_real_collection():
    """Through pytest itself: three shards of this file collect every test
    of it once between them."""
    everything = _collect()
    parts = [_collect("--ci-shard", f"{k}/3") for k in (1, 2, 3)]
    assert sum(len(part) for part in parts) == len(everything)
    assert set().union(*parts) == everything
