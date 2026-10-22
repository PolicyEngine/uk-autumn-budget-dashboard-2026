"""Check a freshly deployed household impact app.

Run by the deploy workflow on the URL ``modal deploy`` prints. It checks
that:

- ``/health`` answers ``{"status": "ok", ...}``;
- ``/household-impact`` answers a plain household with finite net incomes
  before and after, and a change equal to after minus before (to the
  penny), reporting no failure anywhere.

It does not check that the answers are right; the parity tests do that
(``tests/test_household_impact.py``). It runs on plain Python, with the
standard library client ``deploy_smoke`` uses, and reports a route that
fails or never answers as a problem rather than crashing.

Usage::

    python -m uk_budget_data.household_impact_smoke --base-url <URL>
"""

import argparse
import json
import math
import sys
from typing import Any, Optional

from uk_budget_data.deploy_smoke import (
    StdlibClient,
    _finite,
    _request,
    error_markers,
    numbers,
)

# A plain household in a policy year, under every measure (none named)
SMOKE_REQUEST = {"year": 2029, "household": {"employment_income": 30_000}}
ROUTE = "/household-impact"


def _json(response, route: str, problems: list) -> Any:
    try:
        return response.json()
    except ValueError:
        problems.append(f"{route} did not return JSON")
        return None


def household_impact_problems(body: Any) -> list[str]:
    """Ways a household impact answer is not a complete calculation."""
    if not isinstance(body, dict):
        return [f"{ROUTE} did not return an object"]
    markers = error_markers(body)
    if markers:
        return [f"{ROUTE} reported a failure at {', '.join(markers)}"]
    if not all(math.isfinite(n) for n in numbers(body)):
        return [f"{ROUTE} returned a non-finite number"]
    net_income = body.get("net_income")
    if not isinstance(net_income, dict) or not all(
        _finite(net_income.get(key)) for key in ("before", "after", "change")
    ):
        return [f"{ROUTE} has no net income before and after"]
    difference = net_income["after"] - net_income["before"]
    if abs(net_income["change"] - difference) > 0.01:
        return [f"{ROUTE}: the change is not after minus before"]
    return []


def run(client) -> dict:
    """Run every check. Returns ``{"pass", "problems", "versions"}``."""
    problems: list[str] = []
    versions: Optional[dict] = None

    health = _request(client, "GET", "/health", problems)
    if health is not None:
        body = _json(health, "/health", problems)
        if not isinstance(body, dict) or body.get("status") != "ok":
            problems.append("/health is not ok")
        else:
            versions = body.get("versions")

    answer = _request(client, "POST", ROUTE, problems, json=SMOKE_REQUEST)
    if answer is not None:
        body = _json(answer, ROUTE, problems)
        if body is not None:
            problems += household_impact_problems(body)

    return {"pass": not problems, "problems": problems, "versions": versions}


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", required=True)
    # A cold start restores the snapshot, then calculates
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args(argv)
    result = run(StdlibClient(args.base_url, args.timeout))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
