# Constituency regions

Household impact's form asks for a Westminster constituency (July 2024 boundaries) and sends the household API the region it lies in. The API takes a region, not a constituency, so a request is the same whichever constituency in a region is picked. `scripts/build_constituency_regions.py` fetches the lookup here and writes the picker's table, `src/utils/constituencies.json`: the 650 constituency names by policyengine-uk region. That file sits under `src/`, not `public/`, so it takes no review row. It carries names only, no area codes, so it stays clear of the area-code guard in `scripts/check_public_data.py`. This directory is under `data_inputs/`, where area codes are allowed.

## Files

| File | What | Written by |
|---|---|---|
| `pcon24_region.csv` | Each constituency's ONS code, name and region code (`E12…` for an English region; `W92000004`, `S92000003`, `N92000002` for Wales, Scotland and Northern Ireland, as in `data_inputs/regions.csv`) | `scripts/build_constituency_regions.py fetch` |

## Sources

Both are from the ONS Open Geography Portal, under the Open Government Licence. They were fetched on 26 October 2026 through the portal's ArcGIS feature services (`services1.arcgis.com/ESMARspQHYMw9BZ9`).

- **Constituencies and local authorities.** [Ward to Westminster Parliamentary Constituency to Local Authority District to Upper Tier Local Authority (July 2024) Lookup in the UK](https://geoportal.statistics.gov.uk/), service `WD24_PCON24_LAD24_UTLA24_UK_LU`. Its data were last edited on 10 February 2025. It has 8,798 rows: 8,396 wards (a ward split between constituencies has a row for each part) in 650 constituencies.
- **Local authorities and regions.** [Local Authority District to Region (December 2024) Lookup in England](https://geoportal.statistics.gov.uk/), service `LAD24_RGN24_EN_LU`. Its data were last edited on 28 November 2024. It has 296 English local authorities.

## Method

- An English constituency takes the region of its local authorities. Every constituency's local authorities lie in one region (the boundary review kept to them), and the script fails if one does not.
- A Welsh, Scottish or Northern Irish constituency takes its nation, from its code's first letter.
- The region codes become policyengine-uk's region names (the API's `region`) through `data_inputs/regions.csv`.
- The result: North East 27, North West 73, Yorkshire and The Humber 54, East Midlands 47, West Midlands 57, East of England 61, London 75, South East 91, South West 58, Wales 32, Scotland 57, Northern Ireland 18 (650 in all).
- **Check against the map's file.** On 26 October 2026 every constituency's region here matched `data_inputs/constituencies_2024.csv`, the constituency map's file, which has no recorded source. Three names differ in their spelling there, and the picker uses ONS's: "Bridlington and the Wolds", "South Holland and the Deepings" and "Montgomeryshire and Glyndŵr".

## What it does not change

- **Council Tax.** It stays estimated from the band and the region's average Band D (`COUNCIL_TAX_BAND_D` in `src/uk_budget_data/household_impact.py`). No table of each council's Band D is among the repository's inputs, so the constituency does not make it more local.
- **Rental area (BRMA).** The constituency does not choose one. ONS publishes no constituency to BRMA lookup.

## Rebuild

```sh
python scripts/build_constituency_regions.py fetch > data_inputs/constituency_regions/pcon24_region.csv
python scripts/build_constituency_regions.py build > src/utils/constituencies.json
```

| File | SHA-256 |
|---|---|
| `pcon24_region.csv` | `328633248266c910a5b05aa0d8b0af60f811ee960b31ba576ca1c253649bf7fb` |
| `src/utils/constituencies.json` | `e3960f79404eea28e382a9e1f5cd06a05ddb9f183e884d1001b4bcea74245dd8` |
