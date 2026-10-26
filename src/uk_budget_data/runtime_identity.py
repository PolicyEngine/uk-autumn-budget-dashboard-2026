"""Identity of the running household API build.

Household checks compare the deployed API's identity with the execution
identity the published national figures were produced on, so a household
answer is never scored against a different model version from the page it
sits beside. The household API builds single-household simulations without a
dataset, so its identity is the installed packages and the build's git SHA.
"""

import os
import re
import subprocess
from importlib import metadata
from pathlib import Path
from typing import Optional

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


FULL_COMMIT = re.compile(r"[0-9a-f]{40}")

# What a Modal deploy copies from the checkout into its image
# (``modal_household.build_image``)
DEPLOYED_PATHS = (
    ".python-version",
    "pyproject.toml",
    "uv.lock",
    "data_inputs",
    "src/uk_budget_data",
)


def checkout_commit(
    root: Path, paths: tuple[str, ...] = DEPLOYED_PATHS
) -> Optional[str]:
    """The commit a deploy from the checkout at ``root`` builds: HEAD, if
    the files it copies (``paths``) are exactly HEAD's.

    None when any of them is edited, untracked or ignored (``__pycache__``
    aside, which the image leaves out), or git can't say. A build from such
    a checkout is no commit, so it reports none rather than one it doesn't
    match, and the page then never uses its answers beside another build's.
    """

    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout

    try:
        commit = git("rev-parse", "--verify", "HEAD").strip()
        status = git(
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignored",
            "--",
            *paths,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    changed = [
        line for line in status.splitlines() if "__pycache__/" not in line
    ]
    if changed or not FULL_COMMIT.fullmatch(commit):
        return None
    return commit
