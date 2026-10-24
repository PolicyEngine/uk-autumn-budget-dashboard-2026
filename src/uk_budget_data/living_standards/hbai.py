"""Extract UK poverty, income and inequality outturn from DWP HBAI.

Source: Households Below Average Income, FYE 1995 to FYE 2025 (DWP,
published 26 March 2026), summary-hbai-1994-95-2024-25-tables.ods,
table 1.2b (equivalised BHC and AHC median and mean income, £pw in 2024/25
prices; Gini; ratio of top to bottom quintile medians = 90:10) and
tables 1.3a (all individuals), 1.4a (children), 1.5a (working-age adults),
1.6a (pensioners). Only 2021/22 onward is kept: that is the admin-linked
series, with the absolute line anchored to FYE 2025 (series break before).

The file is committed in data_inputs/living_standards/ (see its README);
``extract_hbai`` writes hbai_outturn.json beside it. Ported from
PolicyEngine/uk-living-standards-outlook pipeline/extract_hbai.py (6e28822).
"""

import hashlib
import json
from pathlib import Path

import pandas as pd

URL = (
    "https://assets.publishing.service.gov.uk/media/69c28ffcb920af63be1c7767/"
    "summary-hbai-1994-95-2024-25-tables.ods"
)
FILE_NAME = "summary-hbai-1994-95-2024-25-tables.ods"
OUTPUT_NAME = "hbai_outturn.json"

SHEETS = {
    "all": "1_3a",
    "children": "1_4a",
    "working_age": "1_5a",
    "pensioners": "1_6a",
}
# Column positions in each sheet (row 8 header): BHC rel, BHC abs, AHC rel, AHC abs
COLUMNS = {
    "relative_bhc": 2,
    "absolute_bhc": 4,
    "relative_ahc": 7,
    "absolute_ahc": 9,
}
YEARS = ["2021/22", "2022/23", "2023/24", "2024/25"]


def extract_hbai(path: Path) -> dict:
    """Read the HBAI summary tables into the outturn payload."""
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    out = {m: {} for m in COLUMNS}
    for group, sheet in SHEETS.items():
        df = pd.read_excel(path, engine="odf", sheet_name=sheet, header=None)
        # Header sanity: the measure labels sit in rows 7-8.
        assert "Before housing costs" in str(df.iloc[7, 3]), sheet
        assert "After housing costs" in str(df.iloc[7, 8]), sheet
        assert "Relative" in str(df.iloc[8, 2]) and "Absolute" in str(
            df.iloc[8, 4]
        ), sheet
        assert "Relative" in str(df.iloc[8, 7]) and "Absolute" in str(
            df.iloc[8, 9]
        ), sheet
        year_col = df[1].astype(str).str.strip()
        for measure, col in COLUMNS.items():
            series = []
            for y in YEARS:
                row = df[year_col == y]
                assert len(row) == 1, (sheet, y)
                value = float(row.iloc[0, col]) / 100
                series.append(
                    {"year": y.replace("/", "-"), "rate": round(value, 5)}
                )
            out[measure][group] = series
    # Table 1.2b: equivalised income, GBP per week in average 2024/25 prices,
    # person-weighted, in a BHC block then an AHC block. Column 5 = quintile 3
    # median (overall median), 11 = population mean, 13 = Gini (per cent),
    # 15 = ratio of top to bottom quintile medians. The quintile 1 median is
    # the 10th percentile and the quintile 5 median the 90th, so column 15 is
    # HBAI's 90:10 ratio (checked against Chart 1.2 percentile points for
    # 2024/25: P10 366 / P90 1358 BHC, 273 / 1238 AHC).
    df = pd.read_excel(path, engine="odf", sheet_name="1_2b", header=None)
    assert "Quintile 3 (median)" in str(df.iloc[8, 5])
    assert "Population mean" in str(df.iloc[8, 11])
    assert "Gini" in str(df.iloc[8, 13])
    assert "Ratio of top to bottom quintile medians" in str(df.iloc[8, 15])
    labels = df[0].astype(str).str.strip()
    start = labels[labels == "Income Before Housing Costs"].index[0]
    mid = labels[labels == "Income After Housing Costs"].index[0]
    blocks = {"bhc": df.iloc[start:mid], "ahc": df.iloc[mid:]}
    income, inequality = {}, {}
    for basis, block in blocks.items():
        block_years = block[0].astype(str).str.strip()
        suffix = "" if basis == "bhc" else "_ahc"
        med, mean, gini, ratio = [], [], [], []
        for y in YEARS:
            row = block[block_years == y]
            assert len(row) == 1, ("1_2b", basis, y)
            fy = y.replace("/", "-")
            med.append(
                {"year": fy, "weekly_2024_25_prices": float(row.iloc[0, 5])}
            )
            mean.append(
                {"year": fy, "weekly_2024_25_prices": float(row.iloc[0, 11])}
            )
            gini.append(
                {"year": fy, "value": round(float(row.iloc[0, 13]) / 100, 5)}
            )
            ratio.append(
                {"year": fy, "value": round(float(row.iloc[0, 15]), 4)}
            )
        income[f"median_equivalised_income{suffix}"] = med
        income[f"mean_equivalised_income{suffix}"] = mean
        inequality[basis] = {"gini": gini, "p90_p10": ratio}
    payload = {
        "source": {
            "release": "Households Below Average Income: FYE 1995 to FYE 2025 (DWP, 26 March 2026)",
            "url": "https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025",
            "file": URL,
            "file_sha256": sha,
            "tables": "1.2b (BHC and AHC blocks), 1.3a, 1.4a, 1.5a, 1.6a",
        },
        "poverty": out,
        "income": income,
        "inequality": inequality,
    }
    return payload


def write_hbai(path: Path, out: Path) -> dict:
    """Extract and write hbai_outturn.json."""
    payload = extract_hbai(path)
    out.write_text(json.dumps(payload, indent=2))
    return payload
