"""Private outputs: exact figures that must never be published.

The legacy constituency calculators take direct means with no disclosure
control, and the disclosure layer's audit holds exact values and counts. Both
come from UKDS-licensed survey microdata. They go to a directory outside any
git repository, named by ``UK_BUDGET_DISCLOSURE_AUDIT_DIR``, so they cannot
be committed with the dashboard or served from public/.
"""

import os
from pathlib import Path
from typing import Optional

import pandas as pd

AUDIT_DIR_ENV = "UK_BUDGET_DISCLOSURE_AUDIT_DIR"


class PrivateOutputError(RuntimeError):
    """A private output has no safe place to go."""


def private_directory(
    path: Optional[Path] = None, *, subdirectory: str = ""
) -> Path:
    """Return a private directory, created with owner-only access.

    Args:
        path: The directory, or None to use ``$UK_BUDGET_DISCLOSURE_AUDIT_DIR``.
        subdirectory: A directory inside it.

    Raises:
        PrivateOutputError: If no directory is given, or if it lies inside a
            git repository.
    """
    if path is None:
        value = os.environ.get(AUDIT_DIR_ENV)
        if not value:
            raise PrivateOutputError(
                f"Set {AUDIT_DIR_ENV} to a private directory outside any git "
                "repository."
            )
        path = Path(value)
    base = Path(path).expanduser().resolve()
    directory = base / subdirectory
    for folder in (directory, *directory.parents):
        if (folder / ".git").exists():
            raise PrivateOutputError(
                f"{directory} is inside a git repository. Private outputs "
                "need a directory outside any repository."
            )
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # mkdir's mode reaches only the directories it creates, and the umask
    # can widen it, so set owner-only access on every level from the base
    # down, existing ones included.
    folder = directory
    while True:
        os.chmod(folder, 0o700)
        if folder == base:
            break
        folder = folder.parent
    return directory


def save_private_csv(frame: pd.DataFrame, path: Path) -> Path:
    """Write a CSV that only its owner can read."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", newline="") as handle:
        frame.to_csv(handle, index=False)
    os.chmod(path, 0o600)
    return path
