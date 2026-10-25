"""Every source the forecast vintages are built from, with its SHA-256.

obr.uk refuses scripted downloads (docs/budget-day-runbook.md), so the OBR
files come from Internet Archive captures of their obr.uk addresses, read
through the archive's ``id_`` route, which returns the captured bytes
unaltered. Each is committed unedited under ``data_inputs/forecast_vintages``
and checked against the SHA-256 recorded here before it is read; a file
whose bytes differ is refused. The March 2026 economy tables are the copy
the Living standards inputs already hold.

ONS series and the UK House Price Index are fetched from their publishers
(``uk-budget-data forecast-vintages --fetch``), since they are revised and
extended every month or quarter; each fetch records what it got, and when,
in ``retrieved.json``, and the build checks the files against that record.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

INPUTS_DIR = Path("data_inputs/forecast_vintages")
ARCHIVE = "https://web.archive.org/web/{timestamp}id_/{url}"


@dataclass(frozen=True)
class ArchivedFile:
    """An OBR file, pinned to the bytes of one capture."""

    id: str
    title: str
    url: str  # the obr.uk address the capture is of
    timestamp: Optional[str]  # Internet Archive capture; None: not archived
    sha256: str
    path: Path  # relative to the repository
    member: Optional[str] = None  # the workbook, when the file is a zip
    vintage: Optional[str] = None  # "March 2026", for an EFO's own tables

    @property
    def archive_url(self) -> Optional[str]:
        if self.timestamp is None:
            return None
        return ARCHIVE.format(timestamp=self.timestamp, url=self.url)


def _efo(vintage, timestamp, url, sha256, name, member=None):
    month, year = vintage.split()
    return ArchivedFile(
        id=f"efo_{month.lower()}_{year}",
        title=(
            f"OBR, Economic and fiscal outlook, {vintage}: economy "
            "tables (Table 1.5)"
        ),
        url=url,
        timestamp=timestamp,
        sha256=sha256,
        path=INPUTS_DIR / "obr" / name,
        member=member,
        vintage=vintage,
    )


HOFD = ArchivedFile(
    id="hofd_spring_2026",
    title="OBR, Historical official forecasts database, Spring 2026",
    url=(
        "https://obr.uk/docs/dlm_uploads/"
        "Historical_official_forecasts_database_Spring_2026.xlsx"
    ),
    timestamp="20260328182841",
    sha256="e00b17cb7ec8dfddc4bfd4d212c1e93362147fff81d74a10480e599b26e634db",
    path=INPUTS_DIR
    / "obr"
    / "historical-official-forecasts-database-spring-2026.xlsx",
)

DLM = "https://obr.uk/docs/dlm_uploads/"

# Each forecast's economy tables, for Table 1.5 (quarterly RHDI per person).
# March 2016 and earlier have no per-person block by total population; the
# March 2018, November 2020 and October 2021 tables have no capture found.
EFO_TABLES = (
    _efo(
        "November 2016",
        "20190916205059",
        DLM + "Supplementary_Economy_Tables-2.xlsx",
        "369861f1d9e8b85333d067dadd9d33344336eb4734f6884d5906fa06dd54a4e3",
        "efo-november-2016-economy-tables.xlsx",
    ),
    _efo(
        "March 2017",
        "20220516082559",
        "https://obr.uk//docs/dlm_uploads/SupplementaryEconomytablesMarch2017.xlsx",
        "9b1162ac2a8d2ea3c7dcab39ac906c65f0f7dab18a59c76c59271ae8c34637c9",
        "efo-march-2017-economy-tables.xlsx",
    ),
    _efo(
        "November 2017",
        "20230129124833",
        DLM + "November_2017_EFO_Supplementary_economy_tables-1.xlsx",
        "55fe1eb88dae0492ab296c17a4ee21e4588ac31af856c213ef668255ecb39d4a",
        "efo-november-2017-economy-tables.xlsx",
    ),
    _efo(
        "October 2018",
        "20191023140751",
        DLM + "Supplementary_economy_tables_October_2018-3.xlsx",
        "895d83acea27b78a8e12ac0b6b0bc0e5229762f24d3bea21959e7e36787c181e",
        "efo-october-2018-economy-tables.xlsx",
    ),
    _efo(
        "March 2019",
        "20190723141118",
        DLM + "Economy_supplementary_tables_March_2019.xlsx",
        "0372cbbcb79d546f2768bf6187e39003f57eb3f2c8c05c46406b91bee4e94113",
        "efo-march-2019-economy-tables.xlsx",
    ),
    _efo(
        "March 2020",
        "20220519013811",
        "https://obr.uk//docs/dlm_uploads/Economy_supplementary_tables_March_2020_EFO.xlsx",
        "7aff9506d1752dcdf232580514570178dd15d2b87ed4f583a71284156f94577b",
        "efo-march-2020-economy-tables.xlsx",
    ),
    _efo(
        "March 2021",
        "20230129123015",
        DLM + "EFO_March_2021_Supplementary_tables.zip",
        "3836109e626bc20734b60979b6390276b043af6d9400466b517eade7d9dac568",
        "efo-march-2021-supplementary-tables.zip",
        member=(
            "EFO_March_2021_Supplementary_tables/"
            "Economy_supplementary_tables_EFO_March_2021.xlsx"
        ),
    ),
    _efo(
        "March 2022",
        "20220519024139",
        "https://obr.uk//docs/dlm_uploads/Economy_Supplementary_Tables_March_2022.xlsx",
        "768d65a73db9a197993c14e9d03b463b457235ad47a9b9cf4a05f2e3e82ce17d",
        "efo-march-2022-economy-tables.xlsx",
    ),
    _efo(
        "November 2022",
        "20221117122504",
        DLM + "Economy_supplementary_tables_November_2022.xlsx",
        "279db66221080e0e1050c98b26f14b2a1f5248598da3ef2a8f0f6974fbd4d3c3",
        "efo-november-2022-economy-tables.xlsx",
    ),
    _efo(
        "March 2023",
        "20230315133847",
        DLM + "Economy_supplementary_tables_March_2023.xlsx",
        "04f55d49a89573eb5f89d3fbf7f4e262b10da53bed9f65ccf5d84ff695fda764",
        "efo-march-2023-economy-tables.xlsx",
    ),
    _efo(
        "November 2023",
        "20231122205250",
        DLM + "Economy_supplementary_tables_November_2023.xlsx",
        "fe1273a3fcbfa63144a503513132a5cbce223dedd6befd98a06515c881c63a84",
        "efo-november-2023-economy-tables.xlsx",
    ),
    _efo(
        "March 2024",
        "20240306134030",
        DLM + "Detailed_forecast_tables_Economy_March_2024.xlsx",
        "c787d8777c9d84e66e854e293a1d0c50c87c5986a869d2b9c0f24ed2302b1e7d",
        "efo-march-2024-economy-tables.xlsx",
    ),
    _efo(
        "October 2024",
        "20241030143907",
        DLM + "Economy_Detailed_forecast_tables_October_2024.xlsx",
        "6d55f6195a9c95688b02fe13890542e20a8b98c4a8ed5eaddc6550996e781149",
        "efo-october-2024-economy-tables.xlsx",
    ),
    _efo(
        "March 2025",
        "20250326135827",
        DLM + "Economy_Detailed_forecast_tables_March_2025.xlsx",
        "b9009c5e2a28e5b6979e4ecdce0599b10778493db00de66d1c5b3209e7162f44",
        "efo-march-2025-economy-tables.xlsx",
    ),
    _efo(
        "November 2025",
        "20251126134517",
        DLM + "Economy_Detailed_forecast_tables_November_2025.xlsx",
        "bf2ad1bd633d73efa484b260b62aa4c6d2c0f3b2e4c64fa15e5f7204612e88d6",
        "efo-november-2025-economy-tables.xlsx",
    ),
    ArchivedFile(
        id="efo_march_2026",
        title=(
            "OBR, Economic and fiscal outlook, March 2026: economy tables "
            "(Table 1.5)"
        ),
        url=(
            "https://obr.uk/download/march-2026-economic-and-fiscal-outlook-"
            "detailed-forecast-tables-economy/"
        ),
        timestamp=None,
        sha256="fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510",
        path=Path(
            "data_inputs/living_standards/"
            "efo-march-2026-detailed-forecast-tables-economy.xlsx"
        ),
        vintage="March 2026",
    ),
)


@dataclass(frozen=True)
class OnsSource:
    """An ONS time series: its id, dataset and page."""

    cdid: str
    dataset: str
    topic: str  # the ONS website path the series sits under

    @property
    def uri(self) -> str:
        return f"{self.topic}/timeseries/{self.cdid.lower()}/{self.dataset.lower()}"

    @property
    def url(self) -> str:
        return f"https://www.ons.gov.uk/{self.uri}/data"

    @property
    def page(self) -> str:
        return f"https://www.ons.gov.uk/{self.uri}"

    @property
    def path(self) -> Path:
        return (
            INPUTS_DIR
            / "ons"
            / f"{self.cdid.lower()}-{self.dataset.lower()}.json"
        )


GDP = "economy/grossdomesticproductgdp"
PRICES = "economy/inflationandpriceindices"
LABOUR = "employmentandlabourmarket/peopleinwork/employmentandemployeetypes"
UNEMPLOYMENT = "employmentandlabourmarket/peoplenotinwork/unemployment"
PSF = "economy/governmentpublicsectorandtaxes/publicsectorfinance"

ONS = {
    s.cdid: s
    for s in (
        OnsSource("ABMI", "QNA", GDP),  # GDP, chained volume, £m
        OnsSource("BKTL", "UKEA", GDP),  # GDP at market prices, £m, NSA
        OnsSource("CRXX", "UKEA", GDP),  # households' RHDI per head, £
        OnsSource("NRJR", "UKEA", GDP),  # households' and NPISH RHDI, £m
        OnsSource("ROYJ", "UKEA", GDP),  # wages and salaries, £m
        OnsSource("D7BT", "MM23", PRICES),  # CPI index, 2015=100
        OnsSource("CHAW", "MM23", PRICES),  # RPI index, Jan 1987=100
        OnsSource("MGSX", "LMS", UNEMPLOYMENT),  # ILO unemployment rate, 16+
        OnsSource("MGRZ", "LMS", LABOUR),  # employment, 16+, thousands
        OnsSource("MGRN", "LMS", LABOUR),  # employees, thousands
        OnsSource(
            "J5II", "PUSF", PSF
        ),  # PSNB ex PSB, £m (negative = borrowing)
        OnsSource("ANBT", "PUSF", PSF),  # public sector current receipts, £m
        OnsSource("IL65", "PUSF", PSF),  # of which public sector banks, £m
        OnsSource("KX5Q", "PUSF", PSF),  # TME ex PSB, £m
        OnsSource("JW2T", "PUSF", PSF),  # current budget deficit ex PSB, £m
        OnsSource("JW2Z", "PUSF", PSF),  # net investment ex PSB, £m
        OnsSource("HF6X", "PUSF", PSF),  # PSND ex PSB, % of GDP
    )
}

# HM Land Registry's UK House Price Index (with the ONS): average price,
# all property types, United Kingdom, monthly.
HPI_URL = (
    "https://landregistry.data.gov.uk/app/ukhpi/download/new.csv"
    "?from=1995-01-01&to={to}&location="
    "http%3A%2F%2Flandregistry.data.gov.uk%2Fid%2Fregion%2Funited-kingdom"
    "&thm%5B%5D=property_type&in%5B%5D=avg"
)
HPI_PAGE = "https://landregistry.data.gov.uk/app/ukhpi"
HPI_PATH = INPUTS_DIR / "hpi" / "ukhpi-united-kingdom-average-price.csv"
RETRIEVED_PATH = INPUTS_DIR / "retrieved.json"
