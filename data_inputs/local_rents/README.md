# Local rents inputs

Household impact's form starts a renter's rent at the average private rent in their Broad Rental Market Area (BRMA), for the bedrooms their household points to. `scripts/build_local_rents.py` reads the two files here and writes the averages into `src/utils/localRents.json` (`market`, `market_month`), beside each BRMA's Local Housing Allowance rates from policyengine-uk. `localRents.json` sits under `src/`, not `public/`, so it takes no review row; neither do these files.

## Files

| File | What | Written by |
|---|---|---|
| `ons_private_rents.csv` | Average private rent a month for one, two, three and four or more bedrooms, for each area's latest month with all four: England's and Wales's local authorities, England's regions, Scotland's and Northern Ireland's BRMAs, and the four nations | `scripts/extract_ons_private_rents.py <workbook>` |
| `brma_local_authority_renters.csv` | Census 2021 private-rented households in each part of an English or Welsh BRMA that lies in a local authority (2022 codes) | `scripts/build_brma_local_authorities.py` |

## Sources

- **ONS rents.** ONS, [Price Index of Private Rents, UK: monthly price statistics](https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics), edition of 21 October 2026, Table 1 ([file](https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics/21october2026/priceindexofprivaterentsukmonthlypricestatistics.xlsx), 18.8 MB, not committed; SHA-256 `0d79a0b23041b200748edc84526aff286379f59e2367aeeb57ebb8813517a73c`). The latest month is September 2026, and July 2026 for Northern Ireland, whose data lag two months (the workbook's note 3). Official statistics in development; Open Government Licence.
- **BRMA parts.** Built with policyengine-uk-data's `tools/brma_households` (commit `e1acdf9`), the same placement behind policyengine-uk's `brma_private_rented_households.csv.gz`. Each 2021 LSOA is placed by its population-weighted centroid in the VOA's English BRMA boundaries (May 2020) or Rent Officers Wales's (2014 release), with that tool's overrides. Its local authority comes from the ONS OA21 to LSOA21 to LAD22 lookup, and its private-rented households from Census 2021 TS054. The tool's `fetch.py` checks every input against a pinned SHA-256: `ons_geo_lsoa21_pwc`, `ons_geo_oa21_lsoa21`, `ons_geo_oa21_region`, `voa_english_brma_may2020`, `ons_nomis_ts054`, `geo_lsoa21_wales_pwc`, `geo_brma_wales_2014`.

## Method

- **Scotland and Northern Ireland:** ONS publishes rents by BRMA, so they are used as published.
- **England and Wales:** ONS publishes rents by local authority. A BRMA's rent is the mean of its local authorities' rents, weighted by the private-rented households in the part of the BRMA each one holds. The same weights apply to every bedroom size.
- **Successor codes:** the 2022 lookup's Cumbria, North Yorkshire and Somerset districts, and Barnsley and Sheffield, take ONS's current codes (`SUCCESSORS` in the build script).
- **Not published by ONS:** the City of London and the Isles of Scilly have no ONS rent, so their renters are left out of their BRMAs' means.
- **Bedrooms:** one bedroom with no children, two with one or two, three with three or four, four with five or more (`lhaCategory` in `src/utils/localRents.js`).

## Rebuild

```sh
uv run --with openpyxl python scripts/extract_ons_private_rents.py <workbook.xlsx> > data_inputs/local_rents/ons_private_rents.csv
# Only when the BRMA parts change (see the script's docstring for the fetch step)
uvx --with pandas --with geopandas --with shapely --with pyogrio --with openpyxl --with pyyaml \
  python scripts/build_brma_local_authorities.py <policyengine-uk-data>/tools/brma_households <cache> \
  > data_inputs/local_rents/brma_local_authority_renters.csv
uv run python scripts/build_local_rents.py > src/utils/localRents.json
```

| File | SHA-256 |
|---|---|
| `ons_private_rents.csv` | `31b85858400cfe9779770934959c8f78bf8496345279c00762f84f5ba3b22061` |
| `brma_local_authority_renters.csv` | `56527ba10011da3baa4ff0fb71cab3f15d71898aa676cea9e7af1fdef90d6491` |
