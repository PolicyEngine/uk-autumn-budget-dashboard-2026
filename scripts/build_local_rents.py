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

    uv run python scripts/build_local_rents.py > src/utils/localRents.json

Re-run after a bundle upgrade that changes the rates.
"""

import csv
import gzip
import io
import json
import sys
from collections import defaultdict
from importlib.resources import files

YEAR = 2026
CATEGORIES = ("A", "B", "C", "D", "E")


def _rows(name: str):
    path = files("policyengine_uk").joinpath(f"parameters/gov/dwp/LHA/{name}")
    with gzip.open(io.BytesIO(path.read_bytes()), "rt") as handle:
        yield from csv.DictReader(handle)


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
    regions = defaultdict(set)
    for row in _rows("brma_private_rented_households.csv.gz"):
        regions[row["brma"]].add(row["region"])
    areas = {}
    for brma in BRMAName:
        rate = rates.get(brma.name, {})
        if not all(category in rate for category in CATEGORIES):
            continue
        areas[brma.name] = {
            "name": brma.value,
            "regions": sorted(regions.get(brma.name, ())),
            "rates": [rate[category] for category in CATEGORIES],
        }
    json.dump(
        {
            "year": YEAR,
            "source": (
                "Local Housing Allowance rates for 2026-27 (DWP, Universal "
                "Credit monthly rates), from policyengine-uk"
            ),
            "categories": list(CATEGORIES),
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
