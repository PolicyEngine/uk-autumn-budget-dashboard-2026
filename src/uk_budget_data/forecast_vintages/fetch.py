"""Download the forecast vintages' inputs into ``data_inputs/forecast_vintages``.

- ONS series: each from its time series page's JSON route, saved unedited;
- the UK House Price Index: HM Land Registry's CSV download for the United
  Kingdom's average price, saved unedited;
- the OBR files: from their Internet Archive captures, only when the
  committed copy is missing, and kept only if the bytes match the SHA-256
  pinned in :mod:`.sources`. obr.uk itself is never fetched: the client
  refuses any request to it, a redirect's included.

What each ONS and House Price Index download got, and when, goes into
``retrieved.json``; the build checks the saved files against it.
"""

import hashlib
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from uk_budget_data.forecast_vintages import sources
from uk_budget_data.forecast_vintages.ons import read_series

USER_AGENT = (
    "uk-budget-data forecast-vintages "
    "(+https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026)"
)


class FetchError(RuntimeError):
    """A download that failed or did not hold what was expected."""


def _refuse_obr(request: httpx.Request) -> None:
    """Stop any request to obr.uk, which sits behind a human check."""
    host = request.url.host
    if host == "obr.uk" or host.endswith(".obr.uk"):
        raise FetchError(f"{request.url}: obr.uk is never fetched")


def make_client(transport: httpx.BaseTransport = None) -> httpx.Client:
    """The client every download uses: it follows redirects, but never to
    obr.uk."""
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=60.0,
        event_hooks={"request": [_refuse_obr]},
        transport=transport,
    )


def _get(client: httpx.Client, url: str, tries: int = 4) -> bytes:
    delay = 2.0
    for attempt in range(tries):
        try:
            response = client.get(url)
        except httpx.HTTPError as error:
            if attempt == tries - 1:
                raise FetchError(f"{url}: {error}") from error
        else:
            if response.status_code == 200:
                return response.content
            if response.status_code not in (429, 500, 502, 503, 504):
                raise FetchError(f"{url}: HTTP {response.status_code}")
            if attempt == tries - 1:
                raise FetchError(f"{url}: HTTP {response.status_code}")
        time.sleep(delay)
        delay *= 2
    raise FetchError(f"{url}: no response")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_ons(client: httpx.Client, root: Path, log=print) -> dict:
    records = {}
    for cdid, source in sources.ONS.items():
        data = _get(client, source.url)
        path = root / source.path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        # Refuses a file that is not this series
        series = read_series(path, cdid, source.dataset)
        records[cdid] = {
            "dataset": source.dataset,
            "url": source.url,
            "retrieved": _now(),
            "release_date": series.release_date,
            "sha256": _sha256(data),
        }
        log(f"ONS {cdid} ({source.dataset}): released {series.release_date}")
    return records


def fetch_hpi(
    client: httpx.Client, root: Path, today: date, log=print
) -> dict:
    url = sources.HPI_URL.format(to=today.isoformat())
    data = _get(client, url)
    if not data.startswith(b'"Name","URI"'):
        raise FetchError(f"{url}: not the UK House Price Index CSV")
    path = root / sources.HPI_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    log(f"UK House Price Index: {len(data):,} bytes")
    return {"url": url, "retrieved": _now(), "sha256": _sha256(data)}


def fetch_archived(client: httpx.Client, root: Path, log=print) -> None:
    """Download any pinned OBR file that is missing, from its capture."""
    for file in (sources.HOFD,) + sources.EFO_TABLES:
        path = root / file.path
        if path.is_file() and _sha256(path.read_bytes()) == file.sha256:
            continue
        if file.archive_url is None:
            raise FetchError(
                f"{path} is missing or changed, and has no archived "
                "capture: download it from obr.uk in a browser"
            )
        data = _get(client, file.archive_url)
        digest = _sha256(data)
        if digest != file.sha256:
            raise FetchError(
                f"{file.archive_url}: sha256 {digest}, expected {file.sha256}"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        log(f"Saved {path} from {file.archive_url}")


def fetch_all(root: Path = Path("."), today: date = None, log=print) -> dict:
    today = today or date.today()
    with make_client() as http:
        fetch_archived(http, root, log)
        retrieved = {
            "ons": fetch_ons(http, root, log),
            "hpi": fetch_hpi(http, root, today, log),
        }
    path = root / sources.RETRIEVED_PATH
    path.write_text(json.dumps(retrieved, indent=2, sort_keys=True) + "\n")
    log(f"Wrote {path}")
    return retrieved
