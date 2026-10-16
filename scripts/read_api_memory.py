"""Read a household API revision's memory, for read-api-memory.yml.

Standard library only: the workflow runs it before (and without)
installing the package. Each subcommand reads what gcloud or the Cloud
Monitoring API returned and prints a plain summary; none of it carries a
household's figures (Cloud Run's out-of-memory lines and an aggregate
utilisation metric).

    window <service> <revision> <start> [<end>]   check the inputs, print end
    limit <revision.json>                          the memory limit, in MiB
    oom <entries.json>                             out-of-memory lines
    utilisation <timeseries.json> <limit MiB>      peak p99 per series
"""

import json
import re
import sys
from datetime import datetime, timedelta, timezone

# Cloud Logging keeps 30 days by default, but a measurement is minutes:
# a week is room enough and keeps a mistyped year from a huge read.
MAX_WINDOW = timedelta(days=7)
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
UNITS = {
    "Ki": 1 / 1024,
    "Mi": 1,
    "Gi": 1024,
    "M": 1e6 / 2**20,
    "G": 1e9 / 2**20,
}


class InputError(ValueError):
    """An input the workflow refuses, with the message to show."""


def parse_time(text: str, name: str) -> datetime:
    if not TIMESTAMP.match(text):
        raise InputError(f"{name} must look like 2026-10-16T07:30:00Z")
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError as error:
        raise InputError(f"{name} is not a real time: {text}") from error


def window(service, revision, start, end="", now=None) -> str:
    """Check the inputs; return the window's end (now, if none was given).

    A revision is named as Cloud Run names them, ``<service>-NNNNN-xxx``,
    which also keeps anything else out of the log filter it goes into.
    """
    if not re.fullmatch(
        rf"{re.escape(service)}-\d{{5}}-[a-z0-9]{{3}}", revision
    ):
        raise InputError(
            f"Name a revision of {service}, like {service}-00016-tes"
        )
    begin = parse_time(start, "start")
    now = now or datetime.now(timezone.utc).replace(microsecond=0)
    finish = parse_time(end, "end") if end else now
    if not begin < finish:
        raise InputError("start must come before end")
    if finish - begin > MAX_WINDOW:
        raise InputError("The window is at most 7 days")
    return finish.strftime("%Y-%m-%dT%H:%M:%SZ")


def limit_mib(revision: dict) -> float:
    """The revision's memory limit, in MiB, from ``run revisions describe``."""
    containers = revision.get("spec", {}).get("containers") or [{}]
    text = containers[0].get("resources", {}).get("limits", {}).get("memory")
    if not text:
        raise InputError("The revision has no memory limit")
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Ki|Mi|Gi|M|G)", text)
    if not match:
        raise InputError(f"Unrecognised memory limit: {text}")
    return float(match.group(1)) * UNITS[match.group(2)]


def oom_lines(entries: list) -> list[str]:
    """Each out-of-memory line, oldest first, as ``timestamp message``."""
    lines = [
        f"{entry.get('timestamp', '?')} {entry.get('textPayload', '').strip()}"
        for entry in entries
    ]
    return sorted(lines)


def peaks(series: list) -> list[dict]:
    """Per time series, its highest point, when, and how many points.

    The workflow asks for each minute's 99th percentile, so the peak is the
    highest minute; a spike shorter than a minute can still be missed.
    """
    found = []
    for one in series:
        points = [
            (
                point["value"].get("doubleValue", 0.0),
                point["interval"]["endTime"],
            )
            for point in one.get("points", [])
        ]
        if not points:
            continue
        value, at = max(points, key=lambda pair: (pair[0], pair[1]))
        found.append(
            {
                "labels": {
                    **one.get("resource", {}).get("labels", {}),
                    **one.get("metric", {}).get("labels", {}),
                },
                "peak": value,
                "at": at,
                "points": len(points),
            }
        )
    return found


def main(argv: list[str]) -> int:
    command, args = argv[0], argv[1:]
    try:
        if command == "window":
            print(window(*args))
        elif command == "limit":
            with open(args[0]) as source:
                print(f"{limit_mib(json.load(source)):g}")
        elif command == "oom":
            with open(args[0]) as source:
                lines = oom_lines(json.load(source) or [])
            print(f"Out-of-memory lines: {len(lines)}")
            for line in lines:
                print(f"  {line}")
        elif command == "utilisation":
            with open(args[0]) as source:
                series = json.load(source).get("timeSeries", [])
            limit = float(args[1])
            found = peaks(series)
            if not found:
                print("No utilisation points in the window")
            for one in found:
                print(
                    f"Peak p99 utilisation {one['peak']:.2f} of "
                    f"{limit:g} MiB (about {one['peak'] * limit:.0f} MiB) "
                    f"at {one['at']}, over {one['points']} minutes; "
                    f"{json.dumps(one['labels'], sort_keys=True)}"
                )
        else:
            print(f"Unknown command: {command}", file=sys.stderr)
            return 2
    except InputError as error:
        # On stderr: the workflow captures stdout and shows this as an error.
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
