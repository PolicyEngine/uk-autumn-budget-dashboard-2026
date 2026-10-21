"""Check household answers through the deployed household route.

Each fixture is a household request plus answers computed independently of
the API (by hand, or from a statutory key). The checker posts every fixture
to the deployed route, compares the answers within a tolerance (default
£0.01, the drills' scoring rule), checks that the API runs the model and
core versions the published national figures were produced on, and writes a
household receipt. It exits non-zero on any mismatch.

Usage::

    uv run python -m uk_budget_data.household_route \\
        --base-url https://<deployed-api> \\
        --fixtures data_inputs/household_fixtures \\
        --manifest public/data/manifest.json \\
        --out household-receipt.json

A fixture file is JSON::

    {
      "name": "single earner, basic-rate change",
      "route": "/api/personal-impact",
      "request": {...},
      "expect": [{"path": "policies.x.years.2027.net_income_change", "value": 123.45}],
      "source": "hand calculation, M. Juaristi, 28 Oct"
    }

``expect[].tolerance`` overrides the default. A fixture with
``"draft": true`` is skipped unless ``--include-drafts`` is passed; drafts
document request shapes whose expected answers are not yet independent.
"""

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

RECEIPT_SCHEMA = "uk-budget-dashboard/household-receipt/v1"
DEFAULT_TOLERANCE = 0.01
# A fixture may loosen the tolerance, but never beyond £1: a looser check
# would let a wrong answer through.
MAX_TOLERANCE = 1.0
# The packages whose versions a household check must pin.
REQUIRED_PACKAGES = ("policyengine-uk", "policyengine-core")
VERSION_ROUTE = "/api/version"

# Manifest execution-identity block -> API package name.
IDENTITY_PACKAGES = {
    "wrapper": "policyengine",
    "model": "policyengine-uk",
    "core": "policyengine-core",
}

_PATH_STEP = re.compile(r"([^\[\]]+)((?:\[-?\d+\])*)")
_PATH_INDEX = re.compile(r"\[(-?\d+)\]")


class FixtureError(ValueError):
    """Raised for a malformed fixture file."""


@dataclass
class FixtureResult:
    """Outcome of one fixture."""

    name: str
    file: str
    sha256: str
    status: str
    mismatches: list[dict] = field(default_factory=list)
    error: Optional[str] = None


def path_tokens(path: str) -> list:
    """Split ``a.b[2].c`` into ``["a", "b", 2, "c"]``.

    Raises KeyError for an empty step or stray brackets.
    """
    tokens = []
    for part in path.split("."):
        match = _PATH_STEP.fullmatch(part)
        if not match:
            raise KeyError(f"malformed path {path!r}")
        tokens.append(match.group(1))
        tokens.extend(int(i) for i in _PATH_INDEX.findall(match.group(2)))
    return tokens


def resolve_path(document: Any, path: str) -> Any:
    """Follow a dotted path with ``[index]`` steps through parsed JSON.

    Raises KeyError naming the first step that does not exist.
    """
    current = document
    for token in path_tokens(path):
        try:
            current = current[token]
        except (KeyError, IndexError, TypeError) as error:
            raise KeyError(f"{path!r}: no {token!r}") from error
    return current


def within_tolerance(actual: Any, expected: float, tolerance: float) -> bool:
    """Whether a finite number lies within ``tolerance`` of ``expected``.

    The bound is inclusive. Non-numbers and non-finite values never match.
    """
    if isinstance(actual, bool) or not isinstance(actual, (int, float)):
        return False
    if not math.isfinite(actual):
        return False
    return abs(actual - expected) <= tolerance + 1e-12


def load_fixture(path: Path) -> tuple[dict, str]:
    """Read and validate one fixture, returning it and its SHA-256."""
    raw = path.read_bytes()
    try:
        fixture = json.loads(raw)
    except json.JSONDecodeError as error:
        raise FixtureError(f"{path}: not JSON: {error}") from error
    for key in ("name", "route", "request", "expect", "source"):
        if key not in fixture:
            raise FixtureError(f"{path}: missing {key!r}")
    route = fixture["route"]
    try:
        parts = urlsplit(route) if isinstance(route, str) else None
    except ValueError:
        parts = None
    if (
        parts is None
        or parts.scheme
        or parts.netloc
        or not route.startswith("/")
        or route.startswith("//")
        or "\\" in route
    ):
        # A full URL would send the request to another host, while the
        # receipt records the deployment's identity.
        raise FixtureError(
            f"{path}: route must be a path on the deployment, like "
            "/api/personal-impact"
        )
    if not fixture["expect"]:
        raise FixtureError(f"{path}: 'expect' is empty")
    for check in fixture["expect"]:
        if "path" not in check or "value" not in check:
            raise FixtureError(f"{path}: each expect needs path and value")
        try:
            value = float(check["value"])
            tolerance = float(check.get("tolerance", DEFAULT_TOLERANCE))
        except (TypeError, ValueError) as error:
            raise FixtureError(f"{path}: {error}") from error
        if not math.isfinite(value):
            raise FixtureError(f"{path}: expected values must be finite")
        if not (math.isfinite(tolerance) and 0 <= tolerance <= MAX_TOLERANCE):
            raise FixtureError(
                f"{path}: tolerance must be between 0 and {MAX_TOLERANCE}"
            )
    return fixture, hashlib.sha256(raw).hexdigest()


def compare(response: Any, fixture: dict) -> list[dict]:
    """List every expectation the response fails."""
    mismatches = []
    for check in fixture["expect"]:
        tolerance = float(check.get("tolerance", DEFAULT_TOLERANCE))
        expected = float(check["value"])
        try:
            actual = resolve_path(response, check["path"])
        except KeyError as error:
            mismatches.append({"path": check["path"], "error": str(error)})
            continue
        if not within_tolerance(actual, expected, tolerance):
            mismatches.append(
                {
                    "path": check["path"],
                    "expected": expected,
                    "actual": actual,
                    "tolerance": tolerance,
                }
            )
    return mismatches


def expected_versions(manifest: Optional[dict], overrides: dict) -> dict:
    """Package versions the API must run, from the manifest and overrides."""
    expected = {}
    identity = (manifest or {}).get("execution", {}).get("identity", {})
    for block, package in IDENTITY_PACKAGES.items():
        version = (identity.get(block) or {}).get("version")
        if version:
            expected[package] = version
    expected.update({k: v for k, v in overrides.items() if v})
    return expected


def identity_mismatches(api_identity: Optional[dict], expected: dict) -> list:
    """List packages whose deployed version differs from the expected one.

    A check with no expected model and core versions, or an API that
    reports no identity, is a problem in itself: a household answer cannot
    be scored against an unknown model.
    """
    problems = [
        {"error": f"no expected version for {name}"}
        for name in REQUIRED_PACKAGES
        if not expected.get(name)
    ]
    if not api_identity or "packages" not in api_identity:
        return problems + [{"error": "the API reported no identity"}]
    packages = api_identity.get("packages") or {}
    return problems + [
        {"package": name, "expected": version, "actual": packages.get(name)}
        for name, version in sorted(expected.items())
        if packages.get(name) != version
    ]


def run_checks(
    client,
    fixture_paths: list[Path],
    expected: dict,
    include_drafts: bool = False,
) -> dict:
    """Run every fixture through ``client`` and build the receipt.

    ``client`` needs ``get(url)`` and ``post(url, json=...)`` returning
    objects with ``status_code`` and ``json()``: an ``httpx.Client`` with a
    base URL, or FastAPI's TestClient.
    """
    api_identity = None
    try:
        response = client.get(VERSION_ROUTE)
        if response.status_code == 200:
            api_identity = response.json()
    except Exception as error:  # noqa: BLE001 - recorded in the receipt
        api_identity = {"error": str(error)}

    results = []
    for path in sorted(fixture_paths):
        try:
            fixture, digest = load_fixture(path)
        except FixtureError as error:
            results.append(
                FixtureResult(
                    path.stem, str(path), "", "invalid", [], str(error)
                )
            )
            continue
        if fixture.get("draft") and not include_drafts:
            results.append(
                FixtureResult(
                    fixture["name"], str(path), digest, "skipped-draft"
                )
            )
            continue
        try:
            response = client.post(fixture["route"], json=fixture["request"])
        except Exception as error:  # noqa: BLE001 - recorded in the receipt
            results.append(
                FixtureResult(
                    fixture["name"], str(path), digest, "error", [], str(error)
                )
            )
            continue
        if response.status_code != 200:
            results.append(
                FixtureResult(
                    fixture["name"],
                    str(path),
                    digest,
                    "error",
                    [],
                    f"HTTP {response.status_code}",
                )
            )
            continue
        mismatches = compare(response.json(), fixture)
        results.append(
            FixtureResult(
                fixture["name"],
                str(path),
                digest,
                "pass" if not mismatches else "fail",
                mismatches,
            )
        )

    identity_problems = identity_mismatches(api_identity, expected)
    checked = [r for r in results if r.status != "skipped-draft"]
    passed = (
        bool(checked)
        and all(r.status == "pass" for r in checked)
        and not identity_problems
    )
    return {
        "schema": RECEIPT_SCHEMA,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "api_identity": api_identity,
        "expected_versions": expected,
        "identity_mismatches": identity_problems,
        "fixtures": [r.__dict__ for r in results],
        "pass": passed,
    }


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.household_route",
        description="Check household answers through the deployed route.",
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--expect-model-version", default=None)
    parser.add_argument("--expect-core-version", default=None)
    parser.add_argument("--expect-wrapper-version", default=None)
    parser.add_argument("--include-drafts", action="store_true")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--out", type=Path, default=None)
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    import httpx

    args = parse_args(argv)
    if args.manifest and not args.manifest.exists():
        print(f"error: {args.manifest} does not exist", file=sys.stderr)
        return 2
    manifest = json.loads(args.manifest.read_text()) if args.manifest else None
    expected = expected_versions(
        manifest,
        {
            "policyengine-uk": args.expect_model_version,
            "policyengine-core": args.expect_core_version,
            "policyengine": args.expect_wrapper_version,
        },
    )
    paths = (
        sorted(args.fixtures.glob("*.json"))
        if args.fixtures.is_dir()
        else [args.fixtures]
    )
    with httpx.Client(
        base_url=args.base_url.rstrip("/"), timeout=args.timeout
    ) as client:
        receipt = run_checks(client, paths, expected, args.include_drafts)
    receipt["base_url"] = args.base_url
    text = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(text)
    print(text)
    return 0 if receipt["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
