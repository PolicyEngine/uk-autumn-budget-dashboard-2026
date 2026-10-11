"""Verify a policyengine release against the dispatch that announced it.

When policyengine.py releases a newly qualified UK bundle it dispatches a
``policyengine-release`` event naming the version and the bundle's identity:
the model and core versions, the data release, the default dataset and its
SHA-256, the certificate digest and the compatibility basis. Before the
dashboard opens a bundle-upgrade pull request it installs that version and
checks, here, that the installed wheel's own bundle manifest says the same.
A mismatch means the dispatch and the published package disagree, so the
upgrade is refused rather than adopted on the dispatch's word.

Usage (the payload's ``bundle.uk`` object as JSON)::

    uv run python -m uk_budget_data.bundle_adoption \\
        --version 6.2.7 --bundle-uk-json "$BUNDLE_UK_JSON"
"""

import argparse
import json
import re
import sys
from importlib import metadata
from typing import Callable, Optional

from uk_budget_data.certified_data import load_bundle_manifest

VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")

REQUIRED_FIELDS = (
    "model_version",
    "core_version",
    "data_release_version",
    "dataset",
    "dataset_sha256",
    "certificate_sha256",
    "compatibility_basis",
)


def installed_identity(manifest: dict) -> dict:
    """The UK bundle identity the installed wheel's manifest declares."""
    release = manifest["data_releases"]["uk"]
    packages = manifest["packages"]
    return {
        "model_version": packages["policyengine-uk"]["version"],
        "core_version": packages["policyengine-core"]["version"],
        "data_release_version": release["data_package"]["version"],
        "dataset": release["default_dataset"],
        "dataset_sha256": release["certified_data_artifact"]["sha256"],
        "compatibility_basis": release["certification"]["compatibility_basis"],
    }


def receipt_certificate_sha256() -> Optional[Callable[[dict], str]]:
    """policyengine's certificate digest function, if this release has it."""
    try:
        from policyengine.provenance.receipt import certificate_sha256
    except ImportError:
        return None
    return certificate_sha256


def check_release(
    version: str,
    bundle_uk: dict,
    *,
    manifest: Optional[dict] = None,
    installed_version: Optional[Callable[[str], str]] = None,
    certificate_digest: Optional[Callable[[dict], str]] = None,
) -> list[str]:
    """List every way the installed release differs from the dispatch.

    An empty list means the installed wheel is the announced version, its
    packaged bundle matches every announced field, the installed model and
    core packages are the ones the bundle names, and the certificate digest
    recomputed from the packaged record equals the announced one.
    """
    problems = []
    if not VERSION_PATTERN.match(version or ""):
        return [f"version {version!r} is not a plain release version"]
    missing = [name for name in REQUIRED_FIELDS if not bundle_uk.get(name)]
    if missing:
        return [f"the dispatch omits {', '.join(missing)}"]
    for name in ("dataset_sha256", "certificate_sha256"):
        if not SHA256_PATTERN.match(str(bundle_uk[name])):
            problems.append(f"{name} is not a SHA-256")

    manifest = manifest if manifest is not None else load_bundle_manifest()
    installed_version = installed_version or metadata.version

    if installed_version("policyengine") != version:
        problems.append(
            f"installed policyengine is {installed_version('policyengine')}, "
            f"not {version}"
        )
    if manifest.get("bundle_version") != version:
        problems.append(
            f"the packaged bundle is {manifest.get('bundle_version')}, "
            f"not {version}"
        )

    declared = installed_identity(manifest)
    for name, value in declared.items():
        if str(bundle_uk[name]) != str(value):
            problems.append(
                f"{name}: dispatch says {bundle_uk[name]}, the packaged "
                f"bundle says {value}"
            )

    for package, field in (
        ("policyengine-uk", "model_version"),
        ("policyengine-core", "core_version"),
    ):
        actual = installed_version(package)
        if actual != declared[field]:
            problems.append(
                f"installed {package} is {actual}, but the bundle names "
                f"{declared[field]}"
            )

    certificate_digest = certificate_digest or receipt_certificate_sha256()
    if certificate_digest is None:
        problems.append(
            "this policyengine release has no receipt module, so the "
            "certificate digest cannot be recomputed"
        )
    else:
        recomputed = certificate_digest(manifest["data_releases"]["uk"])
        if recomputed != bundle_uk["certificate_sha256"]:
            problems.append(
                f"certificate_sha256: dispatch says "
                f"{bundle_uk['certificate_sha256']}, recomputed {recomputed}"
            )
    return problems


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.bundle_adoption",
        description="Verify an installed policyengine release against its "
        "release dispatch.",
    )
    parser.add_argument("--version", required=True)
    parser.add_argument("--bundle-uk-json", required=True)
    args = parser.parse_args(argv)
    try:
        bundle_uk = json.loads(args.bundle_uk_json)
    except json.JSONDecodeError as error:
        print(f"::error::bundle.uk is not JSON: {error}", file=sys.stderr)
        return 1
    if not isinstance(bundle_uk, dict):
        print("::error::bundle.uk must be an object", file=sys.stderr)
        return 1
    problems = check_release(args.version, bundle_uk)
    for problem in problems:
        print(f"::error::{problem}", file=sys.stderr)
    if not problems:
        print(
            f"policyengine {args.version} matches its dispatch: UK "
            f"{bundle_uk['model_version']}, core {bundle_uk['core_version']}, "
            f"data {bundle_uk['data_release_version']}"
        )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
