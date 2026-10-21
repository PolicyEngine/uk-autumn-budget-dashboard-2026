"""Check that the configured Hugging Face token can read the certified data.

The dashboard builds microsimulations through policyengine.py, which pins a
certified UK dataset in its release bundle and downloads it from a private
Hugging Face repository. CI runs this check before the certified-data tests,
so a missing or rejected credential fails at once with an actionable message
instead of surfacing as a download error ten minutes into the test run, or as
a silent skip.

For every UK artifact pinned in the installed bundle, and every overlay
dataset named with ``--also``, it confirms that the token can see the file at
the pinned revision and that the file's SHA-256 equals the hash in the bundle
manifest. A file stored in LFS is checked from its metadata, which carries the
SHA-256, so no dataset is downloaded. A small file stored in plain git (a
release's certification or diagnostics JSON) has no SHA-256 in its metadata,
so it is downloaded to a temporary directory and hashed, up to
``MAX_GIT_FILE_BYTES``.

Usage::

    HUGGING_FACE_TOKEN=... uv run python -m uk_budget_data.certified_data

``--also DATASET``, which may be repeated, checks an overlay dataset as well.
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Optional

TOKEN_ENV = "HUGGING_FACE_TOKEN"

ACCESS_HINT = (
    "CI reads the token from the organisation secret "
    "PE_UK_PRIVATE_HF_READ_TOKEN. It must be able to read every Hugging Face "
    "repository this check lists: the one the installed bundle's certified "
    "data comes from (policyengine/populace-uk-private for Microcosm, from "
    "policyengine 6.10.0; policyengine/policyengine-uk-data-private before), "
    "and that of any dataset named with --also (CI names policyengine-uk-"
    "data's tiny enhanced FRS, which stays in "
    "policyengine/policyengine-uk-data-private). This repository must be "
    "among that secret's selected repositories. Changing either is an "
    "organisation admin's call."
)


# The largest file stored in plain git, not LFS, that the check downloads
# to hash. policyengine 6.10.0's largest is 9.9 MB (Microcosm's calibration
# diagnostics); anything bigger belongs in LFS.
MAX_GIT_FILE_BYTES = 32 * 1024 * 1024


class CertifiedDataAccessError(RuntimeError):
    """Raised when the certified data cannot be read with the token."""


@dataclass(frozen=True)
class Artifact:
    """One file pinned by the policyengine.py release bundle."""

    name: str
    repo_id: str
    repo_type: str
    path: str
    revision: str
    sha256: str


def load_bundle_manifest() -> dict:
    """Load the release manifest shipped inside the installed policyengine."""
    manifest = (
        resources.files("policyengine") / "data" / "bundle" / "manifest.json"
    )
    return json.loads(manifest.read_text())


def _artifact(name: str, entry: dict, package: dict) -> Artifact:
    """One pinned dataset, located as policyengine locates it.

    Where the entry names no repository, repository type or revision, the
    release's data package supplies it, as in policyengine's
    ``resolve_dataset_reference``; that holds for overlays too, which
    policyengine merges into the release's datasets.
    """
    located = {
        "repo_id": entry.get("repo_id") or package.get("repo_id"),
        "path": entry.get("path"),
        "revision": entry.get("revision")
        or package.get("release_manifest_revision")
        or package.get("version"),
        "sha256": entry.get("sha256"),
    }
    missing = [field for field, value in located.items() if not value]
    if missing:
        raise CertifiedDataAccessError(
            f"The bundle's UK dataset {name!r} pins no {', '.join(missing)}."
        )
    return Artifact(
        name=name,
        repo_type=entry.get("repo_type")
        or package.get("repo_type")
        or "model",
        **located,
    )


def uk_artifacts(manifest: dict, also: tuple[str, ...] = ()) -> list[Artifact]:
    """List every UK data artifact pinned in a bundle manifest.

    ``also`` names further datasets to check: each must be one of the
    release's datasets (already listed) or one of the bundle's UK dataset
    overlays, which pin a dataset outside the release, usually in its own
    repository.
    """
    release = manifest["data_releases"]["uk"]
    package = release.get("data_package", {})
    artifacts = [
        _artifact(name, entry, package)
        for name, entry in sorted(release["datasets"].items())
    ]
    if not any(a.name == release["default_dataset"] for a in artifacts):
        raise CertifiedDataAccessError(
            f"Bundle default dataset {release['default_dataset']!r} is not "
            "listed among the bundle's UK datasets."
        )
    overlays = manifest.get("dataset_overlays", {}).get("uk", {})
    for name in sorted(set(also) - set(release["datasets"])):
        entry = overlays.get(name)
        if entry is None:
            raise CertifiedDataAccessError(
                f"The bundle pins no UK dataset or overlay {name!r}."
            )
        artifacts.append(_artifact(name, entry, package))
    return artifacts


def _reason(error: Exception) -> str:
    """First line of an HTTP error, without its trailing full stop."""
    return str(error).strip().splitlines()[0].rstrip(".")


def token_fingerprint(token: str) -> str:
    """Return a short, non-reversible fingerprint safe to print in logs."""
    return hashlib.sha256(token.encode()).hexdigest()[:12]


def check_access(
    token: Optional[str],
    artifacts: list[Artifact],
    api=None,
) -> list[str]:
    """Confirm the token can read every artifact at its pinned hash.

    Args:
        token: The Hugging Face token, or None/empty if unset.
        artifacts: Artifacts pinned by the bundle.
        api: A ``huggingface_hub.HfApi``-compatible client (for tests).

    Returns:
        Log lines describing what was checked. They never contain the token.

    Raises:
        CertifiedDataAccessError: If the token is missing, rejected, cannot
            see an artifact, or an artifact's hash differs from the bundle.
    """
    if not token:
        raise CertifiedDataAccessError(
            f"{TOKEN_ENV} is not set, so the certified dataset cannot be "
            f"downloaded. {ACCESS_HINT}"
        )
    if api is None:
        from huggingface_hub import HfApi

        api = HfApi()

    from huggingface_hub.errors import HfHubHTTPError

    try:
        identity = api.whoami(token=token)
    except HfHubHTTPError as error:
        raise CertifiedDataAccessError(
            f"Hugging Face rejected the token (fingerprint "
            f"{token_fingerprint(token)}): {_reason(error)}. {ACCESS_HINT}"
        ) from error

    lines = [
        f"Hugging Face account {identity.get('name', '?')}, token "
        f"fingerprint {token_fingerprint(token)}"
    ]

    groups: dict[tuple[str, str, str], list[Artifact]] = {}
    for artifact in artifacts:
        key = (artifact.repo_id, artifact.repo_type, artifact.revision)
        groups.setdefault(key, []).append(artifact)

    for (repo_id, repo_type, revision), group in sorted(groups.items()):
        try:
            infos = api.get_paths_info(
                repo_id,
                [a.path for a in group],
                revision=revision,
                repo_type=repo_type,
                token=token,
            )
        except HfHubHTTPError as error:
            raise CertifiedDataAccessError(
                f"The token cannot read {repo_type} repository {repo_id} at "
                f"revision {revision}: {_reason(error)}. {ACCESS_HINT}"
            ) from error
        by_path = {info.path: info for info in infos}
        for artifact in group:
            info = by_path.get(artifact.path)
            if info is None:
                raise CertifiedDataAccessError(
                    f"{repo_id}@{revision} has no file {artifact.path} "
                    f"(bundle dataset {artifact.name})."
                )
            lfs = getattr(info, "lfs", None)
            if lfs is not None:
                remote_sha, how = getattr(lfs, "sha256", None), ""
            else:
                remote_sha = _git_file_sha256(api, artifact, info, token)
                how = " (git file, downloaded and hashed)"
            if remote_sha != artifact.sha256:
                raise CertifiedDataAccessError(
                    f"{repo_id}@{revision}/{artifact.path} has SHA-256 "
                    f"{remote_sha}, but the bundle pins {artifact.sha256} "
                    f"(dataset {artifact.name})."
                )
            lines.append(
                f"OK {artifact.name}: {repo_id}@{revision}/{artifact.path} "
                f"sha256={artifact.sha256[:12]}{how}"
            )
    return lines


def _git_file_sha256(api, artifact: Artifact, info, token: str) -> str:
    """The SHA-256 of a file stored in plain git, whose metadata carry none:
    downloaded to a temporary directory and hashed. A refused or failed
    download is an access error, never a hash."""
    from huggingface_hub.errors import HfHubHTTPError, LocalEntryNotFoundError

    where = f"{artifact.repo_id}@{artifact.revision}/{artifact.path}"
    size = getattr(info, "size", None)
    if (
        not isinstance(size, int)
        or isinstance(size, bool)
        or size > MAX_GIT_FILE_BYTES
    ):
        raise CertifiedDataAccessError(
            f"{where} is stored in plain git, not LFS, so its metadata carry "
            f"no SHA-256, and at {size} bytes it is not downloaded to check "
            f"it (the limit is {MAX_GIT_FILE_BYTES}; dataset "
            f"{artifact.name})."
        )
    with tempfile.TemporaryDirectory() as directory:
        try:
            path = api.hf_hub_download(
                repo_id=artifact.repo_id,
                filename=artifact.path,
                revision=artifact.revision,
                repo_type=artifact.repo_type,
                token=token,
                local_dir=directory,
                # A copy already in the cache is not what the pin names.
                force_download=True,
            )
        except (HfHubHTTPError, LocalEntryNotFoundError) as error:
            # huggingface_hub reports a plain 403, a server error or a
            # network failure as LocalEntryNotFoundError, with the HTTP
            # error as its cause.
            cause = error.__cause__ if error.__cause__ is not None else error
            raise CertifiedDataAccessError(
                f"The token cannot download {where}: {_reason(cause)}. "
                f"{ACCESS_HINT}"
            ) from error
        digest = hashlib.sha256()
        with open(Path(path), "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest()


def main(argv: Optional[list[str]] = None) -> int:
    """Run the check against the installed bundle and the environment."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--also",
        action="append",
        default=[],
        metavar="DATASET",
        help="also check this release dataset or bundle overlay",
    )
    args = parser.parse_args(argv)
    try:
        artifacts = uk_artifacts(load_bundle_manifest(), tuple(args.also))
        for line in check_access(os.environ.get(TOKEN_ENV), artifacts):
            print(line)
    except CertifiedDataAccessError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
