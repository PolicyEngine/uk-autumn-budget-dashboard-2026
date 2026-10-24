"""Smoke-test a household API revision before it takes traffic.

Cloud Build deploys each new revision with no traffic under a tag only that
build uses, runs this against the tagged URL, and moves traffic only if it
passes. A rollback runs it again on the revision it restores. It checks
that:

- ``/api/health`` answers;
- ``/api/version`` names the commit being deployed and the same package
  versions as the revision's image, so the tagged URL really serves it;
- ``/api/personal-impact`` answers a plain household with finite numbers
  for every year and policy the image's calculator covers;
- ``/api/lifecycle/calculate``, the route the Personal impact tab calls,
  answers a 19-year-old with one row a year, age and year rising by one,
  starting in 2026 at 19, with no fall in pay before retirement (the
  under-22 bug cut it by more than half at 22). The start year and the pay
  path are checked only on an image whose calculator declares its input
  year (``lifecycle_calculator.INPUT_YEAR``), so a rollback to a revision
  older than that fix is still checked for shape but not refused for it.
- ``/api/household-impact``, the Personal impact tab's single-year view,
  answers one household's headline with finite numbers and a change equal
  to reform minus baseline. Checked only on an image that has the route
  (``expected_household_impact``), so a rollback to a revision older than
  it is not refused for lacking it.

It does not check that the answers are right; the household fixtures do
that (``household_route``), once the team has written them.

The pipelines run main's current copy of this checker, never the
revision's own (an older image would bring an older, weaker checker), on a
plain Python with no third-party package. What only the revision knows (its
package versions and the years and policies it covers) is read from its
image as data, into an expectations file (``print_expectations``).

Usage::

    python -m uk_budget_data.deploy_smoke --base-url <tagged URL> \\
        --expect-git-sha <commit> [--expectations <file>]
"""

import argparse
import importlib.util
import json
import math
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional

from uk_budget_data.runtime_identity import runtime_identity

SMOKE_HOUSEHOLD = {"employment_income": 30_000}

LIFECYCLE_ROUTE = "/api/lifecycle/calculate"
# A 19-year-old: the under-22 bug divided this salary by 2.2 from age 22.
SMOKE_LIFECYCLE_HOUSEHOLD = {
    "current_age": 19,
    "current_salary": 23_600,
    "retirement_age": 67,
    "life_expectancy": 85,
}
# The dashboard's year: the inputs describe it, and the first row is in it.
LIFECYCLE_START_YEAR = 2026
# The largest year-on-year fall in pay allowed before retirement. The
# model's age path never falls; the under-22 bug's fall was 54%.
LIFECYCLE_MAX_PAY_FALL = 0.10


def numbers(value: Any):
    """Every number in a JSON value, booleans excluded."""
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield value
    elif isinstance(value, dict):
        for member in value.values():
            yield from numbers(member)
    elif isinstance(value, list):
        for member in value:
            yield from numbers(member)


# Keys an API uses to report a failure. The household route never uses
# them for a result, so one anywhere in an answer marks it as failed.
ERROR_KEYS = frozenset({"error", "errors", "detail", "exception", "traceback"})


def error_markers(value: Any, path: str = "") -> list[str]:
    """Where in a JSON value a failure is reported, at any depth.

    A key in ``ERROR_KEYS`` counts unless its value is null.
    """
    found = []
    if isinstance(value, dict):
        for key, member in value.items():
            where = f"{path}.{key}" if path else str(key)
            if key in ERROR_KEYS and member is not None:
                found.append(where)
            found += error_markers(member, where)
    elif isinstance(value, list):
        for index, member in enumerate(value):
            found += error_markers(member, f"{path}[{index}]")
    return found


def _has_finite_number(value: Any) -> bool:
    found = list(numbers(value))
    return bool(found) and all(math.isfinite(n) for n in found)


def _finite(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def expected_coverage() -> tuple[list[str], list[str]]:
    """The years and policies this build's household route must answer.

    Read from the image's own calculator, so the expectation is this
    build's, whichever version of it is deployed.
    """
    from uk_budget_data import personal_impact

    return (
        [str(year) for year in personal_impact.YEARS],
        list(personal_impact.POLICY_IDS),
    )


def impact_problems(
    body: Any,
    years: Optional[list[str]] = None,
    policies: Optional[list[str]] = None,
) -> list[str]:
    """Ways a household answer is not a complete calculation.

    A 200 is not enough. The answer must be an object reporting no failure
    anywhere (see ``ERROR_KEYS``), with
    ``household_net_income`` for every expected year, and with every
    expected policy giving a finite ``net_income_change`` in every one of
    those years. Zero effects are allowed: a measure can leave a household
    unchanged. Whether the numbers are right is for the household
    fixtures, not this check.

    Args:
        body: The parsed response.
        years: Expected years (as JSON keys); default the calculator's.
        policies: Expected policy ids; default the calculator's.
    """
    if years is None or policies is None:
        default_years, default_policies = expected_coverage()
        years = default_years if years is None else years
        policies = default_policies if policies is None else policies
    route = "/api/personal-impact"
    if not isinstance(body, dict):
        return [f"{route} did not return an object"]
    markers = error_markers(body)
    if markers:
        return [f"{route} reported a failure at {', '.join(markers)}"]
    if not all(math.isfinite(n) for n in numbers(body)):
        return [f"{route} returned a non-finite number"]
    problems = []
    answered_years = body.get("years")
    if not isinstance(answered_years, dict):
        answered_years = {}
    for year in years:
        entry = answered_years.get(year)
        baseline = entry.get("baseline") if isinstance(entry, dict) else None
        if not isinstance(baseline, dict) or not _finite(
            baseline.get("household_net_income")
        ):
            problems.append(f"{route} has no baseline income for {year}")
    answered = body.get("policies")
    if not isinstance(answered, dict):
        answered = {}
    for name in policies:
        policy = answered.get(name)
        policy_years = (
            policy.get("years") if isinstance(policy, dict) else None
        )
        if not isinstance(policy_years, dict):
            problems.append(f"{route} has no result for {name}")
            continue
        for year in years:
            entry = policy_years.get(year)
            if not isinstance(entry, dict) or not _finite(
                entry.get("net_income_change")
            ):
                problems.append(f"{route}: {name} has no change for {year}")
    return problems


def expected_lifecycle() -> dict:
    """What this build's lifecycle calculator declares: its input year, or
    None for a calculator older than the declaration."""
    from uk_budget_data import lifecycle_calculator

    return {"input_year": getattr(lifecycle_calculator, "INPUT_YEAR", None)}


def lifecycle_problems(body: Any, input_year: Optional[int]) -> list[str]:
    """Ways a lifecycle answer for ``SMOKE_LIFECYCLE_HOUSEHOLD`` is not sane.

    Always: an object reporting no failure, with ``data`` a non-empty list
    of rows, every number finite, each row a numeric ``employment_income``,
    and ``age`` and ``year`` each rising by exactly one from row to row.

    When ``input_year`` is declared (the image's calculator has
    ``INPUT_YEAR``), also: the first row is ``LIFECYCLE_START_YEAR`` at the
    household's age, the rows run to its life expectancy, and pay never
    falls by more than ``LIFECYCLE_MAX_PAY_FALL`` from one working year to
    the next.
    """
    route = LIFECYCLE_ROUTE
    if not isinstance(body, dict):
        return [f"{route} did not return an object"]
    markers = error_markers(body)
    if markers:
        return [f"{route} reported a failure at {', '.join(markers)}"]
    if not all(math.isfinite(n) for n in numbers(body)):
        return [f"{route} returned a non-finite number"]
    rows = body.get("data")
    if (
        not isinstance(rows, list)
        or not rows
        or not all(isinstance(row, dict) for row in rows)
    ):
        return [f"{route} returned no rows"]
    for key in ("age", "year", "employment_income"):
        if not all(_finite(row.get(key)) for row in rows):
            return [f"{route} has a row with no {key}"]
    problems = []
    for key in ("age", "year"):
        values = [row[key] for row in rows]
        if values != list(range(values[0], values[0] + len(values))):
            problems.append(f"{route}: {key} does not rise by one a year")
    if input_year is None or problems:
        return problems

    household = SMOKE_LIFECYCLE_HOUSEHOLD
    first = rows[0]
    if first["year"] != LIFECYCLE_START_YEAR:
        problems.append(
            f"{route} starts in {first['year']}, not {LIFECYCLE_START_YEAR}"
        )
    if first["age"] != household["current_age"]:
        problems.append(
            f"{route} starts at age {first['age']}, not "
            f"{household['current_age']}"
        )
    if rows[-1]["age"] != household["life_expectancy"]:
        problems.append(
            f"{route} ends at age {rows[-1]['age']}, not "
            f"{household['life_expectancy']}"
        )
    working = [
        row for row in rows if row["age"] <= household["retirement_age"]
    ]
    for before, after in zip(working, working[1:]):
        if after["employment_income"] < before["employment_income"] * (
            1 - LIFECYCLE_MAX_PAY_FALL
        ):
            problems.append(
                f"{route}: pay falls from {before['employment_income']:.0f} "
                f"at {before['age']} to {after['employment_income']:.0f} "
                f"at {after['age']}"
            )
    return problems


HOUSEHOLD_IMPACT_ROUTE = "/api/household-impact"
# The headline alone (no per-measure runs, no sweep): two runs, a few
# seconds on a warm instance.
SMOKE_HOUSEHOLD_IMPACT = {
    "year": 2028,
    "policies": ["salary_sacrifice_cap_2028"],
    "household": {"employment_income": 30_000, "salary_year": 2028},
    "include": [],
}


def expected_household_impact() -> dict:
    """Whether this build has the single-year household route: an image
    older than it declares none, and is not checked for it."""
    return {
        "declared": importlib.util.find_spec("uk_budget_data.household_impact")
        is not None
    }


def household_impact_problems(body: Any) -> list[str]:
    """Ways a single-year answer for ``SMOKE_HOUSEHOLD_IMPACT`` is not a
    complete calculation: an object reporting no failure, every number
    finite, a finite baseline, reform and change with the change equal to
    reform minus baseline (to the penny), and the engine's versions named.
    Whether the numbers are right is for the tests, not this check."""
    route = HOUSEHOLD_IMPACT_ROUTE
    if not isinstance(body, dict):
        return [f"{route} did not return an object"]
    markers = error_markers(body)
    if markers:
        return [f"{route} reported a failure at {', '.join(markers)}"]
    if not all(math.isfinite(n) for n in numbers(body)):
        return [f"{route} returned a non-finite number"]
    net = body.get("net_income")
    if not isinstance(net, dict) or not all(
        _finite(net.get(key)) for key in ("baseline", "reform", "change")
    ):
        return [f"{route} has no baseline, reform and change"]
    problems = []
    if abs(net["reform"] - net["baseline"] - net["change"]) > 0.011:
        problems.append(f"{route}: the change is not reform minus baseline")
    engine = body.get("engine")
    if not isinstance(engine, dict) or not engine.get("policyengine-uk"):
        problems.append(f"{route} does not name its policyengine-uk version")
    return problems


def identity_problems(
    reported: Any, expected_git_sha: str, expected: dict
) -> list[str]:
    """How the API's ``/api/version`` differs from this build."""
    if not isinstance(reported, dict):
        return ["/api/version did not return an object"]
    problems = []
    if reported.get("git_sha") != expected_git_sha:
        problems.append(
            f"/api/version reports commit {reported.get('git_sha')!r}, "
            f"not {expected_git_sha!r}"
        )
    if reported.get("service") != expected["service"]:
        problems.append(
            f"/api/version reports service {reported.get('service')!r}"
        )
    packages = reported.get("packages") or {}
    for name, version in expected["packages"].items():
        if packages.get(name) != version:
            problems.append(
                f"/api/version reports {name} {packages.get(name)!r}, "
                f"but this image has {version!r}"
            )
    return problems


def _request(client, method: str, route: str, problems: list, **kwargs):
    """Send one request; a failure to answer is a problem, not a crash."""
    started = time.monotonic()
    try:
        response = client.request(method, route, **kwargs)
    except Exception as error:  # noqa: BLE001 - reported as a problem
        problems.append(
            f"{route} did not answer after "
            f"{time.monotonic() - started:.0f}s: {type(error).__name__}"
        )
        return None
    if response.status_code != 200:
        problems.append(f"{route} returned HTTP {response.status_code}")
        return None
    return response


def run_smoke(
    client,
    expected_git_sha: str,
    expected: Optional[dict] = None,
    years: Optional[list[str]] = None,
    policies: Optional[list[str]] = None,
    lifecycle: Optional[dict] = None,
    household_impact: Optional[dict] = None,
) -> dict:
    """Run every check. Returns ``{"pass": bool, "problems": [...]}``.

    ``expected`` is the image's identity, ``years``/``policies`` its
    calculator's coverage, ``lifecycle`` what its lifecycle calculator
    declares (``expected_lifecycle``) and ``household_impact`` whether it
    has the single-year route (``expected_household_impact``); each
    defaults to this process's own.
    """
    expected = expected or runtime_identity()
    problems: list[str] = []

    _request(client, "GET", "/api/health", problems)

    reported = None
    version = _request(client, "GET", "/api/version", problems)
    if version is not None:
        reported = version.json()
        problems += identity_problems(reported, expected_git_sha, expected)

    impact = _request(
        client, "POST", "/api/personal-impact", problems, json=SMOKE_HOUSEHOLD
    )
    if impact is not None:
        problems += impact_problems(impact.json(), years, policies)

    lifecycle = expected_lifecycle() if lifecycle is None else lifecycle
    answer = _request(
        client,
        "POST",
        LIFECYCLE_ROUTE,
        problems,
        json=SMOKE_LIFECYCLE_HOUSEHOLD,
    )
    if answer is not None:
        problems += lifecycle_problems(
            answer.json(), lifecycle.get("input_year")
        )

    if household_impact is None:
        household_impact = expected_household_impact()
    if household_impact.get("declared"):
        single = _request(
            client,
            "POST",
            HOUSEHOLD_IMPACT_ROUTE,
            problems,
            json=SMOKE_HOUSEHOLD_IMPACT,
        )
        if single is not None:
            problems += household_impact_problems(single.json())

    return {"pass": not problems, "problems": problems, "version": reported}


class _Response:
    def __init__(self, status_code: int, body: bytes):
        self.status_code = status_code
        self._body = body

    def json(self):
        return json.loads(self._body)


class StdlibClient:
    """The few requests the checker makes, with the standard library only,
    so it runs on any Python 3 without the image's packages."""

    def __init__(self, base_url: str, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(self, method: str, route: str, json_body=None, **kwargs):
        body = kwargs.pop("json", json_body)
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            self.base_url + route,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as r:
                return _Response(r.status, r.read())
        except urllib.error.HTTPError as error:
            return _Response(error.code, error.read())


def print_expectations() -> dict:
    """What a revision's image says it is: its identity, the years and
    policies its calculator covers, and its lifecycle calculator's input
    year. The pipelines run the same thing inside the image, written out
    (so an image older than this function answers too); the checker reads
    the result as data."""
    years, policies = expected_coverage()
    return {
        "identity": runtime_identity(),
        "years": years,
        "policies": policies,
        "lifecycle": expected_lifecycle(),
        "household_impact": expected_household_impact(),
    }


def read_expectations(path: str, expected_git_sha: str) -> dict:
    """An expectations file, refused unless it names this commit and some
    years and policies (an empty list would make the checks vacuous)."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    problems = []
    identity = data.get("identity") if isinstance(data, dict) else None
    if not isinstance(identity, dict) or not isinstance(
        identity.get("packages"), dict
    ):
        problems.append("names no identity and packages")
    elif identity.get("git_sha") != expected_git_sha:
        problems.append(
            f"is for commit {identity.get('git_sha')!r}, not "
            f"{expected_git_sha!r}"
        )
    for key in ("years", "policies"):
        values = data.get(key) if isinstance(data, dict) else None
        if (
            not isinstance(values, list)
            or not values
            or not all(isinstance(v, str) and v for v in values)
        ):
            problems.append(f"names no {key}")
    # Optional: a file written before the lifecycle check names none, and
    # its lifecycle answer is then checked for shape only.
    lifecycle = data.get("lifecycle") if isinstance(data, dict) else None
    if lifecycle is not None and not (
        isinstance(lifecycle, dict)
        and (
            lifecycle.get("input_year") is None
            or (
                isinstance(lifecycle.get("input_year"), int)
                and not isinstance(lifecycle.get("input_year"), bool)
            )
        )
    ):
        problems.append("names a lifecycle input year that is not a year")
    # Optional too: a file written before the single-year route names none,
    # and the route is then not checked.
    single = data.get("household_impact") if isinstance(data, dict) else None
    if single is not None and not (
        isinstance(single, dict) and isinstance(single.get("declared"), bool)
    ):
        problems.append("names a household_impact entry that is not declared")
    if problems:
        raise ValueError(
            f"the expectations file {path} " + "; ".join(problems)
        )
    return data


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--expect-git-sha", required=True)
    parser.add_argument(
        "--expectations",
        help="the revision's expectations (print_expectations), read as data",
    )
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args(argv)
    if not args.expect_git_sha.strip():
        parser.error("--expect-git-sha must name the commit being deployed")
    sha = args.expect_git_sha.strip()
    if args.expectations:
        try:
            data = read_expectations(args.expectations, sha)
        except (OSError, ValueError) as error:
            print(f"Refused: {error}", file=sys.stderr)
            return 1
        result = run_smoke(
            StdlibClient(args.base_url, args.timeout),
            sha,
            data["identity"],
            data["years"],
            data["policies"],
            data.get("lifecycle") or {},
            data.get("household_impact") or {},
        )
    else:
        result = run_smoke(StdlibClient(args.base_url, args.timeout), sha)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
