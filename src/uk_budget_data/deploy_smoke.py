"""Smoke-test a household API revision before it takes traffic.

Cloud Build deploys each new revision with no traffic and a ``candidate``
tag, runs this against the tagged URL from inside the image it just built,
and moves traffic only if it passes. It checks that:

- ``/api/health`` answers;
- ``/api/version`` names the commit being deployed and the same package
  versions as this image, so the tagged URL really serves this build;
- ``/api/personal-impact`` answers a plain household with finite numbers.

It does not check that the answers are right; the household fixtures do
that (``household_route``), once the team has written them.

Usage::

    python -m uk_budget_data.deploy_smoke --base-url <tagged URL> \\
        --expect-git-sha <commit>
"""

import argparse
import json
import math
import sys
import time
from typing import Any, Optional

from uk_budget_data.runtime_identity import runtime_identity

SMOKE_HOUSEHOLD = {"employment_income": 30_000}


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
    client, expected_git_sha: str, expected: Optional[dict] = None
) -> dict:
    """Run every check. Returns ``{"pass": bool, "problems": [...]}``."""
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
        problems += impact_problems(impact.json())

    return {"pass": not problems, "problems": problems, "version": reported}


def main(argv: Optional[list[str]] = None) -> int:
    import httpx

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--expect-git-sha", required=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args(argv)
    if not args.expect_git_sha.strip():
        parser.error("--expect-git-sha must name the commit being deployed")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"), timeout=args.timeout
    ) as client:
        result = run_smoke(client, args.expect_git_sha.strip())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
