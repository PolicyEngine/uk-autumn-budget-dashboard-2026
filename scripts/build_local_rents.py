#!/usr/bin/env python
"""Write src/utils/localRents.json: the Household impact form's local rents.

For each Broad Rental Market Area (BRMA), its name, the regions it lies in
and its Local Housing Allowance rates for 2026-27 (Universal Credit monthly
rates, by LHA category: A shared accommodation, B to E one to four
bedrooms), from the tables shipped with the installed policyengine-uk:

- rates: parameters/gov/dwp/LHA/lha_published_rates.csv.gz, column uc_rate
  (DWP, "Universal Credit Local Housing Allowance monthly rates 2026 to
  2027", and the Scottish, Welsh and Northern Ireland equivalents; the
  sources are in lha_published_rates_sources.csv);
- regions: parameters/gov/dwp/LHA/brma_private_rented_households.csv.gz
  (private-rented households by region and BRMA, 2021 and 2022 censuses);
- names: the BRMAName enum, the names the household API accepts as brma;
- each region's default BRMA (REGION_DEFAULT_BRMA), the API's when none is
  sent.

and each BRMA's average private rent a month for one to four or more
bedrooms (``market``, the form's starting rent), from the ONS Price Index
of Private Rents (data_inputs/local_rents/, sources in its README):

- Scotland and Northern Ireland: ONS publishes rents by BRMA, taken as they
  are (Northern Ireland's latest month is two months behind);
- England and Wales: ONS publishes rents by local authority; a BRMA's rent
  is the mean of its local authorities' rents, weighted by the Census 2021
  private-rented households in the part of the BRMA each one holds
  (brma_local_authority_renters.csv).

    uv run python scripts/build_local_rents.py > src/utils/localRents.json

Re-run after a bundle upgrade that changes the rates, or a new ONS month.
"""

import csv
import gzip
import io
import json
import re
import sys
from collections import defaultdict
from importlib.resources import files
from pathlib import Path

YEAR = 2026
CATEGORIES = ("A", "B", "C", "D", "E")
INPUTS = Path(__file__).resolve().parent.parent / "data_inputs" / "local_rents"
BEDROOMS = ("one_bed", "two_bed", "three_bed", "four_or_more_bed")
MARKET_SOURCE = (
    "ONS, Price Index of Private Rents, UK: monthly price statistics "
    "(21 October 2026), average private rents a month"
)
# Local authorities in the 2022 lookup that ONS now publishes under a
# successor's code: the April 2023 Cumbria, North Yorkshire and Somerset
# unitaries, and Barnsley and Sheffield's 2024 codes
SUCCESSORS = {
    **dict.fromkeys(["E07000026", "E07000028", "E07000029"], "E06000063"),
    **dict.fromkeys(["E07000027", "E07000030", "E07000031"], "E06000064"),
    **dict.fromkeys([f"E0700016{i}" for i in range(3, 10)], "E06000065"),
    **dict.fromkeys(
        ["E07000187", "E07000188", "E07000189", "E07000246"], "E06000066"
    ),
    "E08000016": "E08000038",
    "E08000019": "E08000039",
}
# Local authorities ONS publishes no rent for (their renters are left out
# of their BRMA's mean): the City of London and the Isles of Scilly
UNPUBLISHED = {"E09000001", "E06000053"}
# ONS's names for BRMAs whose key differs from the model's
BRMA_ALIASES = {
    "RENFREWSHIRE_INVERCLYDE": "RENFREWSHIRE_AND_INVERCLYDE",
    "NORTH_NORTHERN_IRELAND": "NORTH_NI",
    "NORTH_WEST_NORTHERN_IRELAND": "NORTH_WEST_NI",
    "SOUTH_EAST_NORTHERN_IRELAND": "SOUTH_EAST_NI",
    "SOUTH_NORTHERN_IRELAND": "SOUTH_NI",
    "SOUTH_WEST_NORTHERN_IRELAND": "SOUTH_WEST_NI",
}


def _rows(name: str):
    path = files("policyengine_uk").joinpath(f"parameters/gov/dwp/LHA/{name}")
    with gzip.open(io.BytesIO(path.read_bytes()), "rt") as handle:
        yield from csv.DictReader(handle)


def _brma_key(name: str) -> str:
    key = re.sub(
        r"\W+", "_", name.removesuffix(" BRMA").replace("&", "").upper()
    ).strip("_")
    return BRMA_ALIASES.get(key, key)


def market_rents() -> dict:
    """Each BRMA's average rent a month by bedrooms, and its month."""
    with open(INPUTS / "ons_private_rents.csv", newline="") as handle:
        ons = list(csv.DictReader(handle))
    by_code = {
        row["area_code"]: row for row in ons if row["area_code"] != "[z]"
    }
    rents = {}
    # Scotland (S33) and Northern Ireland: by BRMA already
    for row in ons:
        if row["area_code"].startswith("S33") or row["area_code"] == "[z]":
            rents[_brma_key(row["area_name"])] = {
                "rents": [int(row[column]) for column in BEDROOMS],
                "month": row["month"],
            }
    # England and Wales: local authorities weighted by renters in the BRMA
    parts = defaultdict(list)
    with open(
        INPUTS / "brma_local_authority_renters.csv", newline=""
    ) as handle:
        for row in csv.DictReader(handle):
            code = SUCCESSORS.get(row["lad22_code"], row["lad22_code"])
            if code in UNPUBLISHED:
                continue
            assert code in by_code, (
                f"No ONS rent for {code} ({row['lad22_name']})"
            )
            parts[row["brma"]].append(
                (by_code[code], float(row["households"]))
            )
    for brma, shares in parts.items():
        total = sum(weight for _, weight in shares)
        months = {row["month"] for row, _ in shares}
        assert len(months) == 1, brma
        rents[brma] = {
            "rents": [
                round(
                    sum(float(row[column]) * weight for row, weight in shares)
                    / total
                )
                for column in BEDROOMS
            ],
            "month": months.pop(),
        }
    return rents


def main() -> None:
    from policyengine_uk.variables.household.BRMA import REGION_DEFAULT_BRMA
    from policyengine_uk.variables.household.demographic.locations import (
        BRMAName,
    )

    rates = defaultdict(dict)
    for row in _rows("lha_published_rates.csv.gz"):
        if int(row["year"]) == YEAR and row["uc_rate"]:
            rates[row["brma"]][row["lha_category"]] = round(
                float(row["uc_rate"]), 2
            )
    market = market_rents()
    regions = defaultdict(set)
    for row in _rows("brma_private_rented_households.csv.gz"):
        regions[row["brma"]].add(row["region"])
    areas = {}
    for brma in BRMAName:
        rate = rates.get(brma.name, {})
        if not all(category in rate for category in CATEGORIES):
            continue
        assert brma.name in market, f"No ONS rent for {brma.name}"
        areas[brma.name] = {
            "name": brma.value,
            "regions": sorted(regions.get(brma.name, ())),
            "rates": [rate[category] for category in CATEGORIES],
            "market": market[brma.name]["rents"],
            "market_month": market[brma.name]["month"],
        }
    json.dump(
        {
            "year": YEAR,
            "source": (
                "Local Housing Allowance rates for 2026-27 (DWP, Universal "
                "Credit monthly rates), from policyengine-uk"
            ),
            "categories": list(CATEGORIES),
            "market_source": MARKET_SOURCE,
            "market_bedrooms": [1, 2, 3, 4],
            # The area the API assumes when none is sent
            "region_defaults": {
                region.name: brma.name
                for region, brma in REGION_DEFAULT_BRMA.items()
            },
            "areas": dict(sorted(areas.items())),
        },
        sys.stdout,
        indent=1,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
