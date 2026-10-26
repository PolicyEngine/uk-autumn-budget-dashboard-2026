"""Rebuild tests/ci_durations.json from a CI run's JUnit reports.

The Python test shards in .github/workflows/ci.yml each upload a JUnit
report (``pytest-shard-*``). This reads them and writes, for every test, the
seconds it took (setup, call and teardown), which tests/ci_shards.py uses to
balance the shards. Refresh it when a shard's time drifts well above the
others:

    uv run python scripts/ci_durations.py <run-id>
    uv run python scripts/ci_durations.py --from-dir <directory of reports>

Only test times change; which tests run does not depend on this file.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "tests" / "ci_durations.json"
REPOSITORY = "PolicyEngine/uk-autumn-budget-dashboard-2026"


def node_id(case: ET.Element) -> str:
    """pytest's node id from an xunit1 test case.

    The module comes from the class name where a test file matches it: a
    Hypothesis state machine's ``runTest`` records hypothesis's own file.
    """
    names = case.attrib.get("classname", "").split(".")
    for end in range(len(names), 0, -1):
        path = "/".join(names[:end]) + ".py"
        if (REPO / path).is_file():
            return "::".join([path, *names[end:], case.attrib["name"]])
    return "::".join([case.attrib["file"], case.attrib["name"]])


def read_reports(directory: Path) -> dict[str, float]:
    durations: dict[str, float] = {}
    for report in sorted(directory.rglob("*.xml")):
        for case in ET.parse(report).getroot().iter("testcase"):
            node = node_id(case).split("@", 1)[0]
            seconds = float(case.attrib.get("time", 0.0))
            durations[node] = round(durations.get(node, 0.0) + seconds, 2)
    return durations


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("run_id", nargs="?", help="a CI run's id")
    source.add_argument("--from-dir", type=Path, help="JUnit reports")
    args = parser.parse_args()
    if args.from_dir:
        durations = read_reports(args.from_dir)
    else:
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(
                [
                    "gh",
                    "run",
                    "download",
                    args.run_id,
                    "--repo",
                    REPOSITORY,
                    "--pattern",
                    "pytest-shard-*",
                    "--dir",
                    directory,
                ],
                check=True,
            )
            durations = read_reports(Path(directory))
    if not durations:
        raise SystemExit("no test cases found in the reports")
    OUT.write_text(
        json.dumps(dict(sorted(durations.items())), indent=0) + "\n"
    )
    total = sum(durations.values())
    print(f"{len(durations)} tests, {total:,.0f} worker-seconds -> {OUT}")


if __name__ == "__main__":
    main()
