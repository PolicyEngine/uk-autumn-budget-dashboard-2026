"""Identity of the running household API build.

Household checks compare the deployed API's identity with the execution
identity the published national figures were produced on, so a household
answer is never scored against a different model version from the page it
sits beside. The household API builds single-household simulations without a
dataset, so its identity is the installed packages and the build's git SHA.
"""

import hashlib
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


FULL_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")

# What a Modal deploy copies from the checkout into its image
# (``modal_household.build_image``)
DEPLOYED_PATHS = (
    ".python-version",
    "pyproject.toml",
    "uv.lock",
    "data_inputs",
    "src/uk_budget_data",
)

# Folders the image leaves out of a copied directory (``build_image``'s
# ``ignore``), by the directory they are left out of
IMAGE_LEAVES_OUT = {"src/uk_budget_data": "__pycache__"}

_OBJECT_HASH = {"sha1": hashlib.sha1, "sha256": hashlib.sha256}


def _git(root: Path, *args: str) -> bytes:
    # A replacement (``git replace``) would make one command read another
    # object than the id another command names, so none follow them
    return subprocess.run(
        ["git", "--no-replace-objects", "-C", str(root), *args],
        capture_output=True,
        check=True,
    ).stdout


def _blob_id(data: bytes, object_format: str) -> str:
    """The id git gives a blob of exactly these bytes."""
    digest = _OBJECT_HASH[object_format]()
    digest.update(b"blob %d\0" % len(data))
    digest.update(data)
    return digest.hexdigest()


def _copied_files(root: Path, paths: tuple[str, ...]):
    """Every file under ``paths`` the image would copy, as repository paths,
    and every symbolic link among them (which the comparison refuses: git
    records a link, the upload its target's bytes)."""
    files, links = [], []
    for top in paths:
        start = root / top
        if start.is_symlink():
            links.append(top)
        elif start.is_file():
            files.append(top)
        elif start.is_dir():
            skip = IMAGE_LEAVES_OUT.get(top)
            for folder, dirs, names in os.walk(start):
                here = Path(folder).relative_to(root).as_posix()
                for name in list(dirs):
                    if (Path(folder) / name).is_symlink():
                        links.append(f"{here}/{name}")
                        dirs.remove(name)
                    elif name == skip:
                        dirs.remove(name)
                for name in names:
                    path = f"{here}/{name}"
                    (
                        links if (Path(folder) / name).is_symlink() else files
                    ).append(path)
    return files, links


def _checkout_state(
    root: Path, paths: tuple[str, ...]
) -> tuple[Optional[str], Optional[list[str]]]:
    """HEAD's commit, and the files under ``paths`` whose bytes are not that
    commit's tree's (``checkout_differences``). Both None when git can't
    say.

    The commit is read once and its tree listed by that id, so the files
    are compared with the very commit returned, even if HEAD moves. Only a
    checkout whose work tree is ``root`` itself counts: git run in a folder
    inside a larger work tree (or told by ``GIT_DIR`` and ``GIT_WORK_TREE``
    that one is) would list that folder's files under the names the
    commit's own top-level files have.
    """
    try:
        top = _git(root, "rev-parse", "--show-toplevel").rstrip(b"\n")
        if not os.path.samefile(os.fsdecode(top), root):
            return None, None
        object_format = (
            _git(root, "rev-parse", "--show-object-format").decode().strip()
        )
        commit = (
            _git(root, "rev-parse", "--verify", "HEAD^{commit}")
            .decode()
            .strip()
        )
        if object_format not in _OBJECT_HASH or not FULL_COMMIT.fullmatch(
            commit
        ):
            return None, None
        tree = _git(
            root, "ls-tree", "-r", "-z", "--full-tree", commit, "--", *paths
        )
    except (OSError, subprocess.CalledProcessError):
        return None, None
    committed = {}
    for entry in tree.split(b"\0"):
        if not entry:
            continue
        meta, _, name = entry.partition(b"\t")
        mode, kind, object_id = meta.decode().split()
        # A link or submodule in the tree never equals uploaded bytes. Names
        # are decoded as os.walk decodes the files', so any bytes compare.
        committed[os.fsdecode(name)] = (
            object_id
            if kind == "blob" and mode in ("100644", "100755")
            else None
        )
    files, links = _copied_files(root, paths)
    differ = set(links)
    for path in files:
        expected = committed.get(path)
        if (
            expected is None
            or _blob_id((root / path).read_bytes(), object_format) != expected
        ):
            differ.add(path)
    differ.update(path for path in committed if path not in files)
    return commit, sorted(differ)


def checkout_differences(
    root: Path, paths: tuple[str, ...] = DEPLOYED_PATHS
) -> Optional[list[str]]:
    """The files a deploy from ``root`` would copy whose bytes are not
    HEAD's: edited, added (untracked or ignored alike), missing, or a
    symbolic link. An empty list means the copy is exactly HEAD's tree.
    None when git can't say (no repository, no HEAD).

    It reads the files themselves and HEAD's own tree, never git's index,
    status or replacement objects, so a file git has been told not to check
    (``assume-unchanged``, ``skip-worktree``) is compared like any other,
    and HEAD means the commit its id names.
    """
    return _checkout_state(root, paths)[1]


def printable_paths(paths: list[str]) -> str:
    """``paths`` as one line print can write: a name that isn't UTF-8
    comes back from the file system with escapes it would refuse."""
    return ", ".join(
        path.encode("utf-8", "backslashreplace").decode() for path in paths
    )


def checkout_commit(
    root: Path, paths: tuple[str, ...] = DEPLOYED_PATHS
) -> Optional[str]:
    """The commit a deploy from the checkout at ``root`` builds: HEAD, if
    every file it copies (``paths``) has exactly HEAD's bytes and nothing
    else is copied (``checkout_differences``).

    Otherwise None. A build from such a checkout is no commit, so it reports
    none rather than one it doesn't match, and the page then never uses its
    answers beside another build's. The check reads the files once, before
    the upload: they must not change while the deploy runs.
    """
    commit, differ = _checkout_state(root, paths)
    return commit if differ == [] else None
