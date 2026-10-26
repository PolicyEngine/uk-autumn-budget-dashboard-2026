#!/usr/bin/env python
"""Write data_inputs/local_rents/ons_private_rents.csv from an ONS PIPR workbook.

The ONS "Price Index of Private Rents, UK: monthly price statistics"
workbook (Table 1) gives the average private rent a month by area and
bedrooms. This keeps, for each area, the latest month with all four
bedroom rents:

- England's and Wales's local authorities (E06 to E09, W06) and England's
  regions (E12), Scotland's Broad Rental Market Areas (S33) and the four
  nations;
- Northern Ireland's Broad Rental Market Areas, which have no area code in
  the workbook and lag Great Britain by two months (note 3).

    uv run python scripts/extract_ons_private_rents.py <workbook.xlsx> \\
        > data_inputs/local_rents/ons_private_rents.csv

The workbook's name, release and SHA-256 are in
data_inputs/local_rents/README.md.
"""

import csv
import sys

import openpyxl

BEDROOMS = {
    "Rental price one bed": "one_bed",
    "Rental price two bed": "two_bed",
    "Rental price three bed": "three_bed",
    "Rental price four or more bed": "four_or_more_bed",
}
KEPT_PREFIXES = (
    "E06",
    "E07",
    "E08",
    "E09",
    "E12",
    "E92",
    "W06",
    "W92",
    "S33",
    "S92",
    "N92",
)


def kept(code: str, name: str) -> bool:
    return code.startswith(KEPT_PREFIXES) or (
        code == "[z]" and name.endswith(" BRMA")
    )


def main(path: str) -> None:
    sheet = openpyxl.load_workbook(path, read_only=True)["Table 1"]
    rows = sheet.iter_rows(values_only=True)
    next(rows), next(rows)
    header = next(rows)
    index = {
        name: header.index(name)
        for name in ("Time period", "Area code", "Area name", *BEDROOMS)
    }
    latest = {}
    for row in rows:
        code, name = row[index["Area code"]], row[index["Area name"]]
        if not kept(code, name):
            continue
        rents = [row[index[column]] for column in BEDROOMS]
        if not all(isinstance(rent, (int, float)) for rent in rents):
            continue
        period = row[index["Time period"]]
        if name not in latest or period > latest[name][0]:
            latest[name] = (period, code, rents)
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["area_code", "area_name", "month", *BEDROOMS.values()])
    for name, (period, code, rents) in sorted(
        latest.items(), key=lambda item: (item[1][1], item[0])
    ):
        writer.writerow(
            [
                code,
                name,
                period.strftime("%Y-%m"),
                *(int(rent) for rent in rents),
            ]
        )


if __name__ == "__main__":
    main(sys.argv[1])
