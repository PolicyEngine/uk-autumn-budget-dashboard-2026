"""Split the Python suite into CI shards of about equal work.

CI runs the suite on N runners at once (``--ci-shard K/N``, see
tests/conftest.py and .github/workflows/ci.yml). Each shard collects the
whole suite and keeps the tests :func:`assign` gives it, so every test runs
in exactly one shard whatever files are added, and tests/test_ci_parts.py
checks that the shards partition the suite.

A unit is one test, or every test of one ``xdist_group``, which must share
a worker and so a shard. Units are weighed by the seconds CI took for them
(tests/ci_durations.json: setup, call and teardown, from the shards' JUnit
reports; scripts/ci_durations.py rebuilds it) and handed out heaviest first,
each to the shard with the least work so far (longest-processing-time
bin packing). A test with no recorded time weighs DEFAULT_SECONDS. Ties go
by node id and shard number, so every runner and every pytest-xdist worker
computes the same split.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path

DURATIONS_FILE = Path(__file__).resolve().parent / "ci_durations.json"
# The median test takes well under a second; a new test is assumed a little
# heavier than that until a refresh records its real time.
DEFAULT_SECONDS = 1.0


def base_node_id(node_id: str) -> str:
    """The node id without the ``@group`` suffix ``--dist loadgroup`` adds."""
    return node_id.split("@", 1)[0]


def load_durations(path: Path = DURATIONS_FILE) -> dict[str, float]:
    if not path.is_file():
        return {}
    return {
        base_node_id(node): float(seconds)
        for node, seconds in json.loads(path.read_text()).items()
    }


def parse_shard(text: str) -> tuple[int, int]:
    """``"3/10"`` -> ``(3, 10)``; shards are numbered from 1."""
    index, _, total = text.partition("/")
    shard, count = int(index), int(total)
    if not 1 <= shard <= count:
        raise ValueError(f"shard {text!r} is not K/N with 1 <= K <= N")
    return shard, count


def weight(node_id: str, durations: Mapping[str, float]) -> float:
    return durations.get(base_node_id(node_id), DEFAULT_SECONDS)


def assign(
    tests: Iterable[tuple[str, str | None]],
    count: int,
    durations: Mapping[str, float],
) -> dict[str, int]:
    """Map each test's node id to its shard (1..count).

    ``tests`` gives each test's node id and its ``xdist_group`` name, or
    None. Tests of one group go to one shard.
    """
    units: dict[str, list[str]] = {}
    for node_id, group in tests:
        key = f"group:{group}" if group else f"test:{base_node_id(node_id)}"
        units.setdefault(key, []).append(node_id)
    weighed = sorted(
        (
            (sum(weight(n, durations) for n in members), key, members)
            for key, members in units.items()
        ),
        key=lambda unit: (-unit[0], unit[1]),
    )
    loads = [0.0] * count
    shards: dict[str, int] = {}
    for seconds, _, members in weighed:
        lightest = min(range(count), key=lambda shard: (loads[shard], shard))
        loads[lightest] += seconds
        for node_id in members:
            shards[node_id] = lightest + 1
    return shards
