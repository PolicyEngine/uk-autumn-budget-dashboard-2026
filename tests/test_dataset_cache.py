"""The national run's dataset cache (``uk_budget_data.dataset_cache``).

No network and no Modal: a fake HTTP client answers, and the cache is a
temporary directory standing in for the Modal Volume.
"""

import hashlib
from pathlib import Path

import pytest
import requests

from uk_budget_data import dataset_cache as dc

BODY = b"microcosm bytes " * 1000
SHA = hashlib.sha256(BODY).hexdigest()


def pinned(sha=SHA, name="microcosm_uk_2024_25.h5") -> dc.PinnedFile:
    return dc.PinnedFile(
        description="UK dataset 'microcosm_uk_2024_25'",
        destination=Path("data") / name,
        sha256=sha,
        url=f"https://huggingface.co/datasets/x/resolve/r/{name}",
    )


class Response:
    def __init__(self, status, body=b""):
        self.status_code = status
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def iter_content(self, chunk_size):
        for start in range(0, len(self.body), chunk_size):
            yield self.body[start : start + chunk_size]


class Server:
    """Answers each request with the next of ``answers``: a status code
    (200 sends ``body``) or an exception to raise."""

    def __init__(self, *answers, body=BODY):
        self.answers = list(answers)
        self.body = body
        self.calls = 0

    def __call__(self, url, headers, timeout):
        self.calls += 1
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return Response(answer, self.body if answer == 200 else b"")


def download_with(server, sleeps, **extra):
    def download(item, target):
        return dc.download_with_retry(
            item,
            target,
            get=server,
            headers={},
            sleep=sleeps.append,
            say=lambda line: None,
            **extra,
        )

    return download


def test_a_missing_file_is_downloaded_checked_and_cached_by_digest(tmp_path):
    server = Server(200)
    done = dc.ensure_cached(
        [pinned()],
        tmp_path,
        download=download_with(server, []),
        say=lambda line: None,
    )
    assert done == {SHA: "downloaded"}
    assert (tmp_path / "sha256" / SHA).read_bytes() == BODY
    # Nothing half-written is left beside it.
    assert [p.name for p in (tmp_path / "sha256").iterdir()] == [SHA]


def test_a_cached_file_with_the_pinned_digest_is_reused_without_a_request(
    tmp_path,
):
    (tmp_path / "sha256").mkdir()
    (tmp_path / "sha256" / SHA).write_bytes(BODY)
    server = Server()
    done = dc.ensure_cached(
        [pinned()],
        tmp_path,
        download=download_with(server, []),
        say=lambda line: None,
    )
    assert done == {SHA: "reused"} and server.calls == 0


def test_a_cached_file_with_wrong_bytes_is_fetched_again(tmp_path):
    (tmp_path / "sha256").mkdir()
    (tmp_path / "sha256" / SHA).write_bytes(b"truncated")
    server = Server(200)
    done = dc.ensure_cached(
        [pinned()],
        tmp_path,
        download=download_with(server, []),
        say=lambda line: None,
    )
    assert done == {SHA: "downloaded"} and server.calls == 1
    assert (tmp_path / "sha256" / SHA).read_bytes() == BODY


def test_a_download_with_other_bytes_is_refused_and_not_cached(tmp_path):
    server = Server(200, body=b"another release")
    with pytest.raises(dc.DatasetCacheError, match="expected " + SHA):
        dc.ensure_cached(
            [pinned()],
            tmp_path,
            download=download_with(server, []),
            say=lambda line: None,
        )
    assert list((tmp_path / "sha256").iterdir()) == []


def test_a_hugging_face_5xx_is_retried_with_backoff(tmp_path):
    """The 503 that broke a run on 27 October: two 503s, then the file."""
    server = Server(503, 502, 200)
    sleeps = []
    target = tmp_path / "file"
    attempts = download_with(server, sleeps)(pinned(), target)
    assert attempts == 3 and server.calls == 3
    assert sleeps == [2.0, 4.0]
    assert target.read_bytes() == BODY


def test_a_dropped_connection_a_timeout_and_a_429_are_retried(tmp_path):
    server = Server(
        requests.ConnectionError("reset"),
        requests.Timeout("slow"),
        429,
        200,
    )
    sleeps = []
    assert download_with(server, sleeps)(pinned(), tmp_path / "f") == 4
    assert sleeps == [2.0, 4.0, 8.0]


@pytest.mark.parametrize("status", [401, 403, 404])
def test_a_refused_token_or_missing_file_is_not_retried(tmp_path, status):
    server = Server(status, 200)
    sleeps = []
    with pytest.raises(dc.DatasetCacheError):
        download_with(server, sleeps)(pinned(), tmp_path / "f")
    assert server.calls == 1 and sleeps == []


def test_retries_stop_after_the_last_attempt(tmp_path):
    server = Server(*([503] * dc.ATTEMPTS))
    sleeps = []
    with pytest.raises(dc.DatasetCacheError, match="after 6 attempts"):
        download_with(server, sleeps)(pinned(), tmp_path / "f")
    assert server.calls == dc.ATTEMPTS
    # Doubling, capped: 2 + 4 + 8 + 16 + 30 s at most.
    assert sleeps == [2.0, 4.0, 8.0, 16.0, 30.0]


def test_seed_puts_the_cached_file_where_policyengine_looks(tmp_path):
    cache = tmp_path / "cache"
    (cache / "sha256").mkdir(parents=True)
    (cache / "sha256" / SHA).write_bytes(BODY)
    workdir = tmp_path / "root"
    [target] = dc.seed([pinned()], cache, workdir)
    assert target == workdir / "data" / "microcosm_uk_2024_25.h5"
    assert target.read_bytes() == BODY
    # policyengine's materializer reuses a file at its destination whose
    # bytes hash to the pinned digest: no download.
    assert dc.sha256_file(target) == SHA
    # Seeding again is a no-op.
    assert dc.seed([pinned()], cache, workdir) == [target]


def test_seed_refuses_a_file_not_cached_or_with_wrong_bytes(tmp_path):
    with pytest.raises(dc.DatasetCacheError, match="prime it first"):
        dc.seed([pinned()], tmp_path, tmp_path / "root")
    (tmp_path / "sha256").mkdir()
    (tmp_path / "sha256" / SHA).write_bytes(b"wrong")
    with pytest.raises(dc.DatasetCacheError, match="does not hash"):
        dc.seed([pinned()], tmp_path, tmp_path / "root")


def test_a_digest_that_is_not_sha256_never_names_a_cache_path(tmp_path):
    for bad in ("../x", "ABC", SHA[:-1]):
        with pytest.raises(dc.DatasetCacheError):
            dc.cache_path(tmp_path, bad)


def test_the_pinned_files_are_the_bundles_and_land_under_data():
    """Read offline from the installed policyengine.py bundle: the same
    destination, digest and URL its materializer uses."""
    from policyengine.provenance import dataset_materialization as dm

    spec = dm._resolve_bundle_dataset("uk", data_dir=Path("data"))
    files = dc.pinned_files()
    assert files[0].destination == spec.destination
    assert files[0].destination.parts[0] == "data"
    assert files[0].sha256 == spec.sha256
    assert spec.path in files[0].url and spec.revision in files[0].url
