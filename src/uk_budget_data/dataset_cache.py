"""The pinned Microcosm files, cached by SHA-256 for the national Modal run.

``generate --national --backend modal`` keeps the files the installed
policyengine.py bundle pins (the UK dataset and its metadata) on a Modal
Volume, each under its own SHA-256 (``<cache>/sha256/<digest>``). One
container fills the cache before the measures start (``ensure_cached``):
it reuses a cached file whose bytes hash to the pinned digest, and
otherwise downloads it from Hugging Face, retrying a 5xx, a 429, a dropped
connection or a timeout with backoff, and keeps it only if its bytes hash
to the pinned digest. Every measure's container then copies the files to
where policyengine looks for them (``seed``: ``./data/<release path>``
under the container's working directory), checking each digest again.

Nothing a receipt binds changes. The simulations still load the bundle's
dataset by name (``dataset_path`` stays None), and policyengine's own
materializer still hashes the file before each build and records the same
URI, revision and digest it records after a download: it finds the file
already there and skips the download. A cache keyed by digest cannot serve
another release's file under the same name, and a file whose digest is
wrong is never used (it is removed and fetched again, or the run stops).

Plain Python, no ``modal``: the tests run it on a temporary directory with
a fake HTTP client.
"""

import hashlib
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

# Where policyengine's materializer looks for bundle files, relative to the
# working directory (``dataset_materialization.DEFAULT_DATA_DIR``).
DATA_DIR = Path("data")
# Attempts per file, and the first wait; each wait doubles, up to the cap:
# 2 + 4 + 8 + 16 + 30 s = 60 s of waiting at most over six attempts.
ATTEMPTS = 6
BASE_DELAY_S = 2.0
MAX_DELAY_S = 30.0
# Hugging Face's own read timeout per request, as policyengine sets it.
TIMEOUT_S = 60
CHUNK = 1024 * 1024


class DatasetCacheError(RuntimeError):
    """A pinned file could not be made available with its pinned digest."""


class Retryable(Exception):
    """A failure worth another attempt (5xx, 429, no connection, timeout)."""


@dataclass(frozen=True)
class PinnedFile:
    """One file the bundle pins: where policyengine wants it, and its
    digest and download URL."""

    description: str
    destination: Path
    sha256: str
    url: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pinned_files(data_dir: Path = DATA_DIR) -> list[PinnedFile]:
    """The UK dataset (and its metadata) the installed policyengine.py
    bundle pins, as its materializer resolves them."""
    from policyengine.provenance import dataset_materialization as dm
    from policyengine.provenance.manifest import https_dataset_uri

    spec = dm._resolve_bundle_dataset("uk", data_dir=Path(data_dir))
    files = [
        PinnedFile(
            description=f"UK dataset {spec.dataset!r}",
            destination=spec.destination,
            sha256=spec.sha256,
            url=https_dataset_uri(
                spec.repo_id,
                spec.path,
                spec.revision,
                repo_type=spec.repo_type,
            ),
        )
    ]
    if spec.metadata_sha256 is not None:
        files.append(
            PinnedFile(
                description=f"metadata for {spec.dataset!r}",
                destination=spec.metadata_destination,
                sha256=spec.metadata_sha256,
                url=https_dataset_uri(
                    spec.repo_id,
                    f"{spec.path}.metadata.json",
                    spec.revision,
                    repo_type=spec.repo_type,
                ),
            )
        )
    return files


def cache_path(cache_root: Path, sha256: str) -> Path:
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise DatasetCacheError(f"not a SHA-256 digest: {sha256!r}")
    return Path(cache_root) / "sha256" / sha256


def _auth_headers() -> dict:
    from policyengine.provenance.manifest import hugging_face_auth_headers

    return hugging_face_auth_headers()


def _requests_get(url, headers, timeout):
    import requests

    return requests.get(url, headers=headers, stream=True, timeout=timeout)


def download_once(
    pinned: PinnedFile,
    target: Path,
    *,
    get: Callable = _requests_get,
    headers: Optional[dict] = None,
) -> None:
    """One attempt: stream ``pinned.url`` into ``target``. Raises
    ``Retryable`` for a failure worth another attempt, and
    ``DatasetCacheError`` for one that is not (401, 403, 404, other 4xx)."""
    import requests

    try:
        with get(
            pinned.url,
            headers if headers is not None else _auth_headers(),
            TIMEOUT_S,
        ) as response:
            status = response.status_code
            if status >= 500 or status == 429:
                raise Retryable(f"Hugging Face answered {status}")
            if status in (401, 403):
                raise DatasetCacheError(
                    f"Could not download {pinned.description}: Hugging Face "
                    f"rejected the token ({status}). The Modal secret needs "
                    "a token that reads the repository."
                )
            if status >= 400:
                raise DatasetCacheError(
                    f"Could not download {pinned.description}: {status} "
                    f"from {pinned.url}"
                )
            with Path(target).open("wb") as output:
                for chunk in response.iter_content(chunk_size=CHUNK):
                    if chunk:
                        output.write(chunk)
    except (requests.ConnectionError, requests.Timeout) as error:
        raise Retryable(f"{type(error).__name__}: {error}") from error
    except requests.exceptions.ChunkedEncodingError as error:
        raise Retryable(f"{type(error).__name__}: {error}") from error


def download_with_retry(
    pinned: PinnedFile,
    target: Path,
    *,
    get: Callable = _requests_get,
    headers: Optional[dict] = None,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = ATTEMPTS,
    base_delay: float = BASE_DELAY_S,
    say: Callable[[str], None] = print,
) -> int:
    """Download ``pinned`` into ``target``, retrying a ``Retryable``
    failure with doubling waits. Returns the attempts it took."""
    for attempt in range(1, attempts + 1):
        try:
            download_once(pinned, target, get=get, headers=headers)
            return attempt
        except Retryable as error:
            if attempt == attempts:
                raise DatasetCacheError(
                    f"Could not download {pinned.description} after "
                    f"{attempts} attempts: {error}"
                ) from error
            delay = min(base_delay * 2 ** (attempt - 1), MAX_DELAY_S)
            say(
                f"{pinned.description}: {error}; attempt {attempt} of "
                f"{attempts}, retrying in {delay:.0f} s"
            )
            sleep(delay)
    raise AssertionError("unreachable")


def ensure_cached(
    files: list[PinnedFile],
    cache_root: Path,
    *,
    download: Callable = download_with_retry,
    say: Callable[[str], None] = print,
) -> dict[str, str]:
    """Each pinned file in the cache under its digest: reused when its
    bytes hash to it, else downloaded, checked and moved in atomically.
    Returns ``{digest: "reused" | "downloaded"}``. A cached file whose
    bytes no longer hash to its name is removed and fetched again; a
    download whose bytes hash to anything else is refused."""
    done = {}
    for pinned in files:
        path = cache_path(cache_root, pinned.sha256)
        if path.is_file():
            if sha256_file(path) == pinned.sha256:
                done[pinned.sha256] = "reused"
                say(f"{pinned.description}: reused from the cache")
                continue
            say(f"{pinned.description}: cached bytes are wrong; fetching")
            path.unlink()
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, name = tempfile.mkstemp(prefix=".download-", dir=path.parent)
        os.close(handle)
        partial = Path(name)
        try:
            started = time.perf_counter()
            download(pinned, partial)
            actual = sha256_file(partial)
            if actual != pinned.sha256:
                raise DatasetCacheError(
                    f"Downloaded {pinned.description} has sha256 {actual}, "
                    f"expected {pinned.sha256}"
                )
            os.replace(partial, path)
            say(
                f"{pinned.description}: downloaded and checked in "
                f"{time.perf_counter() - started:.0f} s"
            )
        finally:
            partial.unlink(missing_ok=True)
        done[pinned.sha256] = "downloaded"
    return done


def seed(
    files: list[PinnedFile],
    cache_root: Path,
    workdir: Path = Path("."),
) -> list[Path]:
    """Copy each cached file to where policyengine looks for it, checking
    its digest first. Raises when a file is not cached or its bytes are
    wrong: then the materializer would download it again, which is what
    the cache is for avoiding."""
    seeded = []
    for pinned in files:
        source = cache_path(cache_root, pinned.sha256)
        if not source.is_file():
            raise DatasetCacheError(
                f"{pinned.description} ({pinned.sha256[:12]}) is not in the "
                "cache: prime it first"
            )
        if sha256_file(source) != pinned.sha256:
            raise DatasetCacheError(
                f"cached {pinned.description} does not hash to "
                f"{pinned.sha256[:12]}"
            )
        target = Path(workdir) / pinned.destination
        if target.is_file() and sha256_file(target) == pinned.sha256:
            seeded.append(target)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".seeding")
        shutil.copyfile(source, partial)
        os.replace(partial, target)
        seeded.append(target)
    return seeded
