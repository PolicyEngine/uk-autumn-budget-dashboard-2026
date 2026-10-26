#!/usr/bin/env python
"""Write data_inputs/local_rents/brma_local_authority_renters.csv.

Private-rented households (Census 2021, TS054) in each part of a Broad
Rental Market Area (BRMA) that lies in a local authority, for England and
Wales: the weights that turn ONS rents by local authority into a rent for
each BRMA (scripts/build_local_rents.py).

Each 2021 LSOA is placed in a BRMA as policyengine-uk-data places it for
brma_private_rented_households.csv: by its population-weighted centroid in
the VOA (May 2020) and Rent Officers Wales BRMA polygons, with that tool's
overrides (``lsoa_geography`` in tools/brma_households/build.py). Its local
authority is from the ONS OA21 to LSOA21 to LAD22 lookup.

    uvx --with pandas --with geopandas --with shapely --with pyogrio \\
        --with openpyxl --with pyyaml python \\
        <policyengine-uk-data>/tools/brma_households/fetch.py <cache> --only \\
        ons_geo_lsoa21_pwc ons_geo_oa21_lsoa21 ons_geo_oa21_region \\
        voa_english_brma_may2020 ons_nomis_ts054 geo_lsoa21_wales_pwc \\
        geo_brma_wales_2014
    uvx (same) python scripts/build_brma_local_authorities.py \\
        <policyengine-uk-data>/tools/brma_households <cache> \\
        > data_inputs/local_rents/brma_local_authority_renters.csv

fetch.py checks every input against its pinned SHA-256.
"""

import io
import sys
import zipfile
from pathlib import Path

import pandas as pd


def main(tools: str, cache_dir: str) -> None:
    sys.path.insert(0, tools)
    from build import lsoa_geography

    cache = Path(cache_dir)
    lsoas = lsoa_geography(cache)
    lookup = pd.read_csv(
        cache / "ons_geo_oa21_lsoa21.csv",
        usecols=["LSOA21CD", "LAD22CD", "LAD22NM"],
        dtype=str,
        encoding="utf-8-sig",
    ).drop_duplicates()
    assert lookup.LSOA21CD.is_unique
    with zipfile.ZipFile(cache / "census_nomis_ts054.zip") as archive:
        census = pd.read_csv(
            io.BytesIO(archive.read("census2021-ts054-lsoa.csv"))
        )
    renters = census.set_index("geography code")[
        "Tenure of household: Private rented"
    ]
    lsoas = lsoas.merge(
        lookup,
        left_on="area_code",
        right_on="LSOA21CD",
        how="left",
        validate="one_to_one",
    )
    assert lsoas.LAD22CD.notna().all()
    lsoas["households"] = lsoas.area_code.map(renters)
    assert lsoas.households.notna().all()
    table = (
        lsoas.groupby(["brma", "LAD22CD", "LAD22NM"], as_index=False)
        .households.sum()
        .rename(columns={"LAD22CD": "lad22_code", "LAD22NM": "lad22_name"})
    )
    table = table[table.households > 0].sort_values(["brma", "lad22_code"])
    table.to_csv(sys.stdout, index=False, lineterminator="\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
