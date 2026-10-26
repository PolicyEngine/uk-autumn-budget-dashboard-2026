#!/usr/bin/env python
"""The Household impact form's constituency picker: each Westminster
constituency (July 2024 boundaries) and the region it lies in.

Two steps, standard library only:

    python scripts/build_constituency_regions.py fetch \
        > data_inputs/constituency_regions/pcon24_region.csv
    python scripts/build_constituency_regions.py build \
        > src/utils/constituencies.json

``fetch`` reads two ONS Open Geography Portal lookups (Open Government
Licence):

- Ward to Westminster Parliamentary Constituency to Local Authority District
  to Upper Tier Local Authority (July 2024) Lookup in the UK
  (WD24_PCON24_LAD24_UTLA24_UK_LU), for each constituency's local
  authorities;
- Local Authority District to Region (December 2024) Lookup in England
  (LAD24_RGN24_EN_LU), for an English local authority's region.

A Welsh, Scottish or Northern Irish constituency takes its nation (its code's
first letter). It fails if any constituency's local authorities lie in more
than one region, or if there are not 650.

``build`` writes the picker's table from that CSV and data_inputs/regions.csv:
the constituency names by policyengine-uk region (the household API's
``region``). It carries names only, no area codes, so the file under src/
stays clear of scripts/check_public_data.py's area-code guard.
"""

import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOKUP_CSV = (
    ROOT / "data_inputs" / "constituency_regions" / "pcon24_region.csv"
)
REGIONS_CSV = ROOT / "data_inputs" / "regions.csv"

SERVICES = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
WARD_LOOKUP = "WD24_PCON24_LAD24_UTLA24_UK_LU"
REGION_LOOKUP = "LAD24_RGN24_EN_LU"
PAGE = 1000
NATIONS = {"W": "W92000004", "S": "S92000003", "N": "N92000002"}
SEATS = 650


def _query(service, fields):
    """Every row of an ONS lookup, a page at a time."""
    rows, offset = [], 0
    while True:
        params = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": ",".join(fields),
                "orderByFields": "ObjectId",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "json",
            }
        )
        url = f"{SERVICES}/{service}/FeatureServer/0/query?{params}"
        with urllib.request.urlopen(url, timeout=60) as response:
            page = json.load(response)
        features = page.get("features", [])
        rows += [feature["attributes"] for feature in features]
        if not page.get("exceededTransferLimit"):
            return rows
        offset += len(features)


def fetch():
    wards = _query(WARD_LOOKUP, ["PCON24CD", "PCON24NM", "LAD24CD"])
    regions = {
        row["LAD24CD"]: row["RGN24CD"]
        for row in _query(REGION_LOOKUP, ["LAD24CD", "RGN24CD"])
    }
    names, seat_regions = {}, defaultdict(set)
    for row in wards:
        code, lad = row["PCON24CD"], row["LAD24CD"]
        names[code] = row["PCON24NM"]
        seat_regions[code].add(NATIONS.get(lad[0]) or regions[lad])
    split = sorted(
        code for code, found in seat_regions.items() if len(found) > 1
    )
    if split:
        raise SystemExit(f"constituencies in more than one region: {split}")
    if len(names) != SEATS:
        raise SystemExit(f"{len(names)} constituencies, not {SEATS}")
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["pcon24_code", "pcon24_name", "region_code"])
    for code in sorted(names):
        writer.writerow([code, names[code], next(iter(seat_regions[code]))])
    sys.stdout.write(out.getvalue())


def build():
    with REGIONS_CSV.open(newline="") as f:
        enum = {row["code"]: row["frs_region"] for row in csv.DictReader(f)}
    with LOOKUP_CSV.open(newline="", encoding="utf-8") as f:
        seats = list(csv.DictReader(f))
    if len(seats) != SEATS:
        raise SystemExit(f"{len(seats)} constituencies, not {SEATS}")
    by_region = {region: [] for region in enum.values()}
    for seat in seats:
        by_region[enum[seat["region_code"]]].append(seat["pcon24_name"])
    table = {
        "source": (
            "ONS Open Geography Portal: WD24_PCON24_LAD24_UTLA24_UK_LU and "
            "LAD24_RGN24_EN_LU (data_inputs/constituency_regions/README.md)"
        ),
        "regions": {
            region: sorted(names, key=str.casefold)
            for region, names in by_region.items()
        },
    }
    sys.stdout.write(json.dumps(table, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    steps = {"fetch": fetch, "build": build}
    if len(sys.argv) != 2 or sys.argv[1] not in steps:
        raise SystemExit("usage: build_constituency_regions.py fetch|build")
    steps[sys.argv[1]]()
