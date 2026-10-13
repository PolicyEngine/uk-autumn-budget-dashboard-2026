"""Identity of the running household API build.

Household checks compare the deployed API's identity with the execution
identity the published national figures were produced on, so a household
answer is never scored against a different model version from the page it
sits beside. The household API builds single-household simulations without a
dataset, so its identity is the installed packages and the build's git SHA.
"""

import os
from importlib import metadata

SERVICE_NAME = "uk-budget-api-2026"

PACKAGES = (
    "policyengine",
    "policyengine-uk",
    "policyengine-core",
    "uk_budget_data",
)


def installed_version(name: str):
    """Installed distribution version, or None if it is not installed."""
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def runtime_identity() -> dict:
    """Describe this build: service, git SHA and installed packages.

    ``GIT_SHA`` is set at image build time (see the Dockerfile). It is None
    for a local run, which a deployed-route check treats as unverifiable.
    """
    return {
        "service": SERVICE_NAME,
        "git_sha": os.environ.get("GIT_SHA") or None,
        "packages": {name: installed_version(name) for name in PACKAGES},
    }
