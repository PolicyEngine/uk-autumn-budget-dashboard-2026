"""Check that the household APIs and the precomputed examples cover the
measures the page lists, before the page is published.

The page shows the manifest's displayable measures (approved or
provisional, ``public/data/manifest.json``) and sends them to the household
API it calls. An API deployed from an older commit
refuses a measure it doesn't register ("Unknown measures: …"), so the
Household impact tab shows an error. The example cards read
``public/data/household_presets.json`` instead, so stale presets show the
previous measures' answers without any error. Drill 5 hit both (#144).

Run it against every household API the build will call, Cloud Run's and
Modal's, after they are deployed and ``publish index`` has written the
manifest, before the page is published:

    uv run python -m uk_budget_data.page_measures_check \\
        --base-url "$HOUSEHOLD_API" --base-url "$HOUSEHOLD_DETAIL_API"

It exits 1, listing each problem, when an API refuses any of the page's
measures, or when the presets were computed for other measures or another
engine than the APIs report.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from uk_budget_data.publication import manifest as m

PRESETS_FILE = Path("public/data/household_presets.json")
HOUSEHOLD_IMPACT_ROUTE = "/api/household-impact"
VERSION_ROUTE = "/api/version"
# The packages whose versions decide a household's answer
ENGINE_PACKAGES = ("policyengine", "policyengine-uk", "policyengine-core")
TIMEOUT_S = 120


def page_measure_ids(data_root: Path = m.DATA_ROOT) -> list[str]:
    """The manifest's displayable measure ids, sorted: what the page shows."""
    measures = m.load_manifest(Path(data_root)).measures
    return sorted(
        key for key, entry in measures.items() if entry.status in m.DISPLAYABLE
    )


def probe(year: int, ids: list[str]) -> dict:
    """A plain household's headline with every one of the page's measures."""
    return {
        "year": year,
        "policies": ids,
        "household": {"employment_income": 30_000, "salary_year": year},
        "include": [],
    }


def _request(
    url: str, body: Optional[dict] = None, timeout: float = TIMEOUT_S
):
    """(status, parsed JSON or text); a failure to answer is (None, reason)."""
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    except Exception as error:  # noqa: BLE001 - reported as a problem
        return None, f"{type(error).__name__}: {error}"
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw.decode(errors="replace")


def api_problems(
    base_url: str, ids: list[str], year: int = 2027, timeout: float = TIMEOUT_S
) -> tuple[list[str], Optional[dict]]:
    """How one API falls short of the page's measures; and its packages."""
    base_url = base_url.rstrip("/")
    if base_url.endswith(HOUSEHOLD_IMPACT_ROUTE):
        base_url = base_url[: -len(HOUSEHOLD_IMPACT_ROUTE)]
    problems = []
    status, version = _request(base_url + VERSION_ROUTE, timeout=timeout)
    packages = (
        version.get("packages")
        if status == 200 and isinstance(version, dict)
        else None
    )
    if packages is None:
        problems.append(
            f"{base_url}{VERSION_ROUTE}: no package versions ({status})"
        )
    status, answer = _request(
        base_url + HOUSEHOLD_IMPACT_ROUTE, probe(year, ids), timeout=timeout
    )
    if status != 200:
        detail = (
            json.dumps(answer)
            if isinstance(answer, (dict, list))
            else str(answer)
        )
        unknown = re.search(r"Unknown measures: ([a-z0-9_, ]+)", detail)
        if unknown:
            problems.append(
                f"{base_url}: refuses the page's measures "
                f"{unknown.group(1).strip()}; deploy it from the commit "
                "that registers them"
            )
        else:
            problems.append(
                f"{base_url}{HOUSEHOLD_IMPACT_ROUTE} returned {status}: {detail[:300]}"
            )
    return problems, packages


def preset_problems(
    presets_file: Path, ids: list[str], packages: Optional[dict]
) -> list[str]:
    """How the precomputed examples differ from the page's measures and the
    API's engine."""
    presets_file = Path(presets_file)
    if not presets_file.exists():
        return []
    presets = json.loads(presets_file.read_text())
    problems = []
    if set(presets.get("policies") or []) != set(ids):
        missing = sorted(set(ids) - set(presets.get("policies") or []))
        extra = sorted(set(presets.get("policies") or []) - set(ids))
        problems.append(
            f"{presets_file} was computed for other measures"
            + (f"; missing {', '.join(missing)}" if missing else "")
            + (f"; not on the page {', '.join(extra)}" if extra else "")
            + "; rerun scripts/precompute_household_presets.py"
        )
    if packages:
        engine = presets.get("engine") or {}
        for name in ENGINE_PACKAGES:
            if name in packages and engine.get(name) != packages[name]:
                problems.append(
                    f"{presets_file} was computed on {name} "
                    f"{engine.get(name)!r}, but the API runs {packages[name]!r}; "
                    "rerun scripts/precompute_household_presets.py"
                )
    return problems


def check(
    base_urls: list[str],
    data_root: Path = m.DATA_ROOT,
    presets_file: Path = PRESETS_FILE,
    year: int = 2027,
    timeout: float = TIMEOUT_S,
) -> list[str]:
    """Every problem across the APIs and the presets."""
    ids = page_measure_ids(data_root)
    if not ids:
        return [
            f"{Path(data_root) / m.MANIFEST_FILE} has no displayable measure; "
            "run it after publish index"
        ]
    problems: list[str] = []
    packages = None
    for url in base_urls:
        found, reported = api_problems(url, ids, year, timeout)
        problems += found
        packages = packages or reported
    problems += preset_problems(presets_file, ids, packages)
    return problems


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--base-url",
        action="append",
        required=True,
        help="A household API the page calls (repeat for each)",
    )
    parser.add_argument("--data-root", type=Path, default=m.DATA_ROOT)
    parser.add_argument("--presets", type=Path, default=PRESETS_FILE)
    parser.add_argument("--year", type=int, default=2027)
    args = parser.parse_args(argv)
    problems = check(args.base_url, args.data_root, args.presets, args.year)
    ids = page_measure_ids(args.data_root)
    if problems:
        for problem in problems:
            print(f"FAIL {problem}")
        return 1
    print(
        f"OK: {len(args.base_url)} API(s) and the presets cover the page's {len(ids)} measures"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
