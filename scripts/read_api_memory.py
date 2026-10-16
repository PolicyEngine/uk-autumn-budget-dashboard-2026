"""Read a household API revision's memory, for read-api-memory.yml.

Standard library only: the workflow runs it before (and without)
installing the package. Each subcommand reads what gcloud or the Cloud
Monitoring API returned and prints a plain summary. Nothing it prints can
carry a household's figures: from log lines it prints only the two
numbers of Cloud Run's own out-of-memory message, and the metric is an
aggregate.

    window <service> <revision> <start> [<end>]   check the inputs, print end
    limit <revision.json>                          the memory limit, in MiB
    oom <entries.json> <read limit>                out-of-memory lines
    next-page <page.json>                          a Monitoring page's token
    utilisation <limit MiB> <page.json>...         peak p99 per series

A failure prints its reason on stderr and exits 1.
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
# Cloud Run's message when it stops an instance for its memory.
OOM = re.compile(
    r"Memory limit of (\d+(?:\.\d+)?) MiB exceeded with "
    r"(\d+(?:\.\d+)?) MiB used"
)


class ReadError(ValueError):
    """An input refused, or a read that can't be trusted, with the reason."""


def parse_time(text: str, name: str) -> datetime:
    if not TIMESTAMP.match(text):
        raise ReadError(f"{name} must look like 2026-10-16T07:30:00Z")
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError as error:
        raise ReadError(f"{name} is not a real time: {text}") from error


def window(service, revision, start, end="", now=None) -> str:
    """Check the inputs; return the window's end (now, if none was given).

    A revision is named as Cloud Run names them, ``<service>-NNNNN-xxx``,
    which also keeps anything else out of the filters it goes into.
    """
    pattern = rf"{re.escape(service)}-\d{{5}}-[a-z0-9]{{3}}"
    if not re.fullmatch(pattern, revision):
        raise ReadError(
            f"Name a revision of {service}, like {service}-00016-tes"
        )
    begin = parse_time(start, "start")
    now = now or datetime.now(timezone.utc).replace(microsecond=0)
    finish = parse_time(end, "end") if end else now
    if not begin < finish:
        raise ReadError("start must come before end")
    if finish - begin > MAX_WINDOW:
        raise ReadError("The window is at most 7 days")
    return finish.strftime("%Y-%m-%dT%H:%M:%SZ")


def limit_mib(revision: dict) -> float:
    """The revision's memory limit, in MiB, from ``run revisions describe``."""
    containers = revision.get("spec", {}).get("containers") or [{}]
    text = containers[0].get("resources", {}).get("limits", {}).get("memory")
    if not text:
        raise ReadError("The revision has no memory limit")
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Ki|Mi|Gi|M|G)", text)
    if not match:
        raise ReadError(f"Unrecognised memory limit: {text}")
    return float(match.group(1)) * UNITS[match.group(2)]


def oom_lines(entries: list) -> tuple[list[str], int]:
    """Each recognised out-of-memory line, oldest first, as its time and
    two numbers; and how many matched lines were not Cloud Run's message
    (counted, never printed: their text could be anything)."""
    found, other = [], 0
    for entry in entries:
        match = OOM.search(str(entry.get("textPayload", "")))
        if match is None:
            other += 1
            continue
        found.append(
            f"{entry.get('timestamp', '?')}: {match.group(2)} MiB used "
            f"of a {match.group(1)} MiB limit"
        )
    return sorted(found), other


def merge_pages(pages: list) -> list:
    """The time series of every page, a series split across pages joined
    by its labels. A page reporting errors or unreachable data is refused:
    a peak read from part of the data is not the peak."""
    merged: dict = {}
    for page in pages:
        if page.get("executionErrors"):
            raise ReadError(
                "Cloud Monitoring reported errors: "
                + json.dumps(page["executionErrors"])[:300]
            )
        if page.get("unreachable"):
            raise ReadError(
                "Cloud Monitoring could not reach: "
                + json.dumps(page["unreachable"])[:300]
            )
        for one in page.get("timeSeries", []):
            key = json.dumps(
                [
                    one.get("resource", {}).get("labels", {}),
                    one.get("metric", {}).get("labels", {}),
                ],
                sort_keys=True,
            )
            entry = merged.setdefault(key, {**one, "points": []})
            entry["points"] = entry["points"] + list(one.get("points", []))
    return list(merged.values())


def peaks(series: list) -> list[dict]:
    """Per time series, its highest point, when, and how many points.

    The workflow asks for each minute's 99th percentile, so the peak is the
    highest minute (the latest, if minutes tie); a spike shorter than a
    minute can still be missed.
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
        value, at = max(points)
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


def load(path):
    with open(path) as source:
        return json.load(source)


def main(argv: list[str]) -> int:
    command, args = argv[0], argv[1:]
    try:
        if command == "window":
            print(window(*args))
        elif command == "limit":
            print(f"{limit_mib(load(args[0])):g}")
        elif command == "oom":
            entries = load(args[0]) or []
            lines, other = oom_lines(entries)
            print(f"Out-of-memory lines: {len(lines)}")
            for line in lines:
                print(f"  {line}")
            if other:
                print(
                    f"{other} other matching lines, not Cloud Run's "
                    "message (not printed)"
                )
            if len(entries) >= int(args[1]):
                raise ReadError(
                    f"The read returned its limit of {args[1]} lines, so "
                    "it may be cut short: narrow the window"
                )
        elif command == "next-page":
            print(load(args[0]).get("nextPageToken", ""))
        elif command == "utilisation":
            limit = float(args[0])
            found = peaks(merge_pages([load(path) for path in args[1:]]))
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
    except ReadError as error:
        # On stderr: the workflow shows it as an error.
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
