"""The variables the Forecast vintages view shows, and where each comes from.

Each variable has a ``level`` measure (and, for the public finances, a
``share`` of GDP): the outturn, built from ONS series (or the UK House Price
Index), and the OBR's forecasts of it. How a forecast relates to the
outturn is its ``kind``:

- ``growth``: the OBR forecast the percentage change on a year earlier
  (the database's economy sheets); the page carries it forward from the
  outturn at the forecast's launch;
- ``index``: an index whose ratios are the forecast (Table 1.5's RHDI per
  person, 2008Q1=100), carried forward the same way;
- ``level``: the forecast is in the outturn's own units (£ billion, per cent
  of GDP, a rate) and is drawn as published.

``units`` says which of the page's unit pills apply, and how each reads the
measures. Outturn functions take the loaded ONS series by id.
"""

from dataclasses import dataclass, field
from typing import Callable, Optional

from uk_budget_data.forecast_vintages import ons as O


@dataclass(frozen=True)
class Measure:
    unit: str  # what one value is, e.g. "£ billion"
    kind: str  # growth, index or level
    outturn: Callable  # (series by id, hpi) -> {period: value}
    outturn_source: str
    sheet: Optional[str] = None  # the database sheet; None: Table 1.5
    tolerance: float = 1.0  # largest gap from the database's own outturn
    relative: bool = False  # tolerance as a share of the value
    decimals: int = 1


@dataclass(frozen=True)
class Variable:
    id: str
    label: str
    group: str
    frequency: str  # calendar, fiscal or quarterly
    level: Measure
    units: dict  # pill -> {"label", "axis", "from", "transform"?}
    default_unit: str
    share: Optional[Measure] = None
    notes: tuple = field(default_factory=tuple)


def _years(cdid, scale=1.0):
    return lambda s, hpi: {y: v * scale for y, v in s[cdid].years.items()}


def _fiscal(cdid, sign=1.0, scale=1 / 1000):
    return lambda s, hpi: {
        k: v * sign * scale for k, v in O.fiscal_sum(s[cdid].quarters).items()
    }


def _fiscal_share(numerator, sign=1.0):
    def outturn(s, hpi):
        gdp = O.fiscal_sum(s["BKTL"].quarters)
        values = numerator(s, hpi)
        return {
            k: v / (gdp[k] / 1000) * 100 for k, v in values.items() if k in gdp
        }

    return outturn


def _receipts(s, hpi):
    total = O.fiscal_sum(s["ANBT"].quarters)
    banks = O.fiscal_sum(s["IL65"].quarters)
    return {k: (v - banks[k]) / 1000 for k, v in total.items() if k in banks}


def _earnings(s, hpi):
    wages, employees = s["ROYJ"].years, s["MGRN"].years
    # £m of wages and salaries over thousands of employees: £ a year each
    return {
        y: wages[y] * 1e6 / (employees[y] * 1e3)
        for y in employees
        if y in wages
    }


def _house_prices(s, hpi):
    by_year = {}
    for month, price in hpi.items():
        by_year.setdefault(int(month[:4]), []).append(price)
    return {y: sum(p) / 12 for y, p in by_year.items() if len(p) == 12}


GROWTH_PCT = {
    "label": "%",
    "axis": "% change on a year earlier",
    "from": "level",
    "transform": "growth",
}
INDEX = {"label": "Index", "axis": "Index (start = 100)", "from": "level"}


def _level(label, axis):
    return {"label": label, "axis": axis, "from": "level"}


SHARE_PCT = {"label": "%", "axis": "% of GDP", "from": "share"}

ECONOMY = "Economy"
LABOUR = "Labour market"
PRICES = "Prices"
HOUSEHOLDS = "Households"
PUBLIC = "Public finances"

VARIABLES = (
    Variable(
        id="real_gdp",
        label="Real GDP",
        group=ECONOMY,
        frequency="calendar",
        level=Measure(
            unit="£ billion (chained volume measure)",
            kind="growth",
            sheet="UKGDP",
            outturn=_years("ABMI", 1 / 1000),
            outturn_source="ONS ABMI (QNA): GDP, chained volume measure, calendar-year total",
        ),
        units={
            "level": _level("£", "£ billion a year (chained volume measure)"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="pct",
    ),
    Variable(
        id="cpi",
        label="CPI inflation",
        group=PRICES,
        frequency="calendar",
        level=Measure(
            unit="Index (2015 = 100)",
            kind="growth",
            sheet="CPI",
            outturn=_years("D7BT"),
            outturn_source="ONS D7BT (MM23): CPI index, 2015 = 100, calendar-year average",
        ),
        units={"index": INDEX, "pct": GROWTH_PCT},
        default_unit="pct",
    ),
    Variable(
        id="rpi",
        label="RPI inflation",
        group=PRICES,
        frequency="calendar",
        level=Measure(
            unit="Index (January 1987 = 100)",
            kind="growth",
            sheet="RPI",
            outturn=_years("CHAW"),
            outturn_source="ONS CHAW (MM23): RPI index, January 1987 = 100, calendar-year average",
        ),
        units={"index": INDEX, "pct": GROWTH_PCT},
        default_unit="pct",
    ),
    Variable(
        id="unemployment",
        label="Unemployment rate",
        group=LABOUR,
        frequency="calendar",
        level=Measure(
            unit="% of the economically active",
            kind="level",
            sheet="Unemplrate",
            outturn=_years("MGSX"),
            outturn_source="ONS MGSX (LMS): ILO unemployment rate, aged 16 and over, calendar-year average",
            decimals=1,
        ),
        units={
            "pct": {
                "label": "%",
                "axis": "Unemployment rate (%)",
                "from": "level",
            }
        },
        default_unit="pct",
    ),
    Variable(
        id="employment",
        label="Employment",
        group=LABOUR,
        frequency="calendar",
        level=Measure(
            unit="million people",
            kind="level",
            sheet="Empl",
            outturn=_years("MGRZ", 1 / 1000),
            outturn_source="ONS MGRZ (LMS): people in employment, aged 16 and over, calendar-year average",
            tolerance=0.02,
            relative=True,
            decimals=2,
        ),
        units={
            "level": _level("Level", "Million people"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="level",
    ),
    Variable(
        id="average_earnings",
        label="Average earnings",
        group=LABOUR,
        frequency="calendar",
        level=Measure(
            unit="£ a year per employee",
            kind="growth",
            sheet="Earnings",
            outturn=_earnings,
            outturn_source=(
                "ONS ROYJ (UKEA): wages and salaries, divided by ONS MGRN "
                "(LMS): employees; calendar years"
            ),
            decimals=0,
        ),
        units={
            "level": _level("£", "£ a year per employee"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="pct",
        notes=(
            "The OBR's average earnings are wages and salaries divided by "
            "employees, from the national accounts; they are not the ONS's "
            "average weekly earnings.",
        ),
    ),
    Variable(
        id="rhdi_per_person",
        label="Real household disposable income per head",
        group=HOUSEHOLDS,
        frequency="quarterly",
        level=Measure(
            unit="£ per head a quarter (chained volume measure)",
            kind="index",
            outturn=lambda s, hpi: dict(s["CRXX"].quarters),
            outturn_source=(
                "ONS CRXX (UKEA): households' real disposable income per "
                "head, chained volume measure, seasonally adjusted"
            ),
            decimals=0,
        ),
        units={
            "level": {
                "label": "£",
                "axis": "£ per head a year (chained volume measure)",
                "from": "level",
                # quarterly values are a quarter's income: x4 for a year's
                "annualise": True,
            },
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="level",
        notes=(
            "Forecasts from each Economic and fiscal outlook's Table 1.5: "
            "households' and non-profit institutions' real disposable income "
            "divided by the whole population. The outturn is the ONS's "
            "measure for households alone; each forecast is carried forward "
            "from it by the forecast's own growth.",
        ),
    ),
    Variable(
        id="rhdi",
        label="Real household disposable income",
        group=HOUSEHOLDS,
        frequency="calendar",
        level=Measure(
            unit="£ billion (chained volume measure)",
            kind="growth",
            sheet="RHHDI",
            outturn=_years("NRJR", 1 / 1000),
            outturn_source=(
                "ONS NRJR (UKEA): households' and non-profit institutions' "
                "real disposable income, chained volume measure, calendar-year total"
            ),
        ),
        units={
            "level": _level("£", "£ billion a year (chained volume measure)"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="pct",
    ),
    Variable(
        id="house_prices",
        label="House prices",
        group=HOUSEHOLDS,
        frequency="calendar",
        level=Measure(
            unit="£ average price",
            kind="growth",
            sheet="Houseprices",
            outturn=_house_prices,
            outturn_source=(
                "HM Land Registry and ONS, UK House Price Index: average "
                "price, all property types, United Kingdom, calendar-year average"
            ),
            decimals=0,
        ),
        units={
            "level": _level("£", "£ average price"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="pct",
        notes=(
            "Forecasts before November 2016 are of the ONS's earlier house "
            "price index; from then on, of the UK House Price Index.",
        ),
    ),
    Variable(
        id="nominal_gdp",
        label="Nominal GDP",
        group=ECONOMY,
        frequency="fiscal",
        level=Measure(
            unit="£ billion",
            kind="level",
            sheet="NGDP",
            outturn=_fiscal("BKTL"),
            outturn_source="ONS BKTL (UKEA): GDP at market prices, current prices, fiscal-year total",
            tolerance=0.025,
            relative=True,
            decimals=0,
        ),
        units={
            "level": _level("£", "£ billion"),
            "index": INDEX,
            "pct": GROWTH_PCT,
        },
        default_unit="level",
    ),
    Variable(
        id="psnb",
        label="Public sector net borrowing",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="£ billion",
            kind="level",
            sheet="£PSNB",
            outturn=_fiscal("J5II", sign=-1),
            outturn_source=(
                "ONS J5II (PUSF): public sector net borrowing excluding "
                "public sector banks, fiscal-year total (sign reversed: the "
                "ONS records borrowing as negative)"
            ),
            tolerance=0.05,
            relative=True,
        ),
        share=Measure(
            unit="% of GDP",
            kind="level",
            sheet="PSNB",
            outturn=_fiscal_share(_fiscal("J5II", sign=-1)),
            outturn_source="ONS J5II (sign reversed) over ONS BKTL, fiscal years",
        ),
        units={"level": _level("£", "£ billion"), "pct": SHARE_PCT},
        default_unit="level",
    ),
    Variable(
        id="psnd",
        label="Public sector net debt",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="% of GDP",
            kind="level",
            sheet="PSND",
            outturn=lambda s, hpi: O.fiscal_end_march(s["HF6X"].months),
            outturn_source=(
                "ONS HF6X (PUSF): public sector net debt excluding public "
                "sector banks, % of GDP, at the end of March"
            ),
        ),
        units={"pct": {"label": "%", "axis": "% of GDP", "from": "level"}},
        default_unit="pct",
    ),
    Variable(
        id="receipts",
        label="Public sector current receipts",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="£ billion",
            kind="level",
            sheet="£PSCR",
            outturn=_receipts,
            outturn_source=(
                "ONS ANBT less IL65 (PUSF): public sector current receipts "
                "excluding public sector banks, fiscal-year total"
            ),
            tolerance=0.025,
            relative=True,
            decimals=0,
        ),
        share=Measure(
            unit="% of GDP",
            kind="level",
            sheet="PSCR",
            outturn=_fiscal_share(_receipts),
            outturn_source="ONS ANBT less IL65 over ONS BKTL, fiscal years",
        ),
        units={
            "level": _level("£", "£ billion"),
            "index": INDEX,
            "pct": SHARE_PCT,
        },
        default_unit="level",
    ),
    Variable(
        id="spending",
        label="Total managed expenditure",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="£ billion",
            kind="level",
            sheet="£TME",
            outturn=_fiscal("KX5Q"),
            outturn_source=(
                "ONS KX5Q (PUSF): total managed expenditure excluding public "
                "sector banks, fiscal-year total"
            ),
            tolerance=0.025,
            relative=True,
            decimals=0,
        ),
        share=Measure(
            unit="% of GDP",
            kind="level",
            sheet="TME",
            outturn=_fiscal_share(_fiscal("KX5Q")),
            outturn_source="ONS KX5Q over ONS BKTL, fiscal years",
        ),
        units={
            "level": _level("£", "£ billion"),
            "index": INDEX,
            "pct": SHARE_PCT,
        },
        default_unit="level",
    ),
    Variable(
        id="current_budget",
        label="Current budget deficit",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="£ billion",
            kind="level",
            sheet="£CB",
            outturn=_fiscal("JW2T", sign=-1),
            outturn_source=(
                "ONS JW2T (PUSF): public sector current budget deficit "
                "excluding public sector banks, fiscal-year total (sign "
                "reversed: the ONS records a deficit as negative)"
            ),
            tolerance=5.0,
        ),
        share=Measure(
            unit="% of GDP",
            kind="level",
            sheet="CB",
            outturn=_fiscal_share(_fiscal("JW2T", sign=-1)),
            outturn_source="ONS JW2T (sign reversed) over ONS BKTL, fiscal years",
        ),
        units={"level": _level("£", "£ billion"), "pct": SHARE_PCT},
        default_unit="level",
    ),
    Variable(
        id="psni",
        label="Public sector net investment",
        group=PUBLIC,
        frequency="fiscal",
        level=Measure(
            unit="% of GDP",
            kind="level",
            sheet="PSNI",
            outturn=_fiscal_share(_fiscal("JW2Z", sign=-1)),
            outturn_source=(
                "ONS JW2Z (PUSF): public sector net investment excluding "
                "public sector banks (sign reversed), over ONS BKTL, fiscal years"
            ),
        ),
        units={"pct": {"label": "%", "axis": "% of GDP", "from": "level"}},
        default_unit="pct",
    ),
)

# What the database holds that the view leaves out, and why.
LEFT_OUT = (
    (
        "HM Treasury forecasts (before June 2010)",
        "Not the OBR's: this view shows the OBR's own forecasts.",
    ),
    (
        "Restated March 2019 and supplementary March 2020 forecasts (memo rows)",
        "Restatements of forecasts already shown, not separate forecasts.",
    ),
    (
        "Individual taxes and spending lines (income tax, NICs, VAT, onshore "
        "corporation tax and some 50 others)",
        "Not headline outcomes; each needs its own ONS outturn and the "
        "database warns that classifications change between forecasts.",
    ),
    (
        "Expenditure components of GDP (consumption, investment, trade, "
        "inventories), productivity, wages and salaries, GDP deflator, "
        "saving ratio, household net worth, current account, claimant count",
        "Not headline outcomes in this pass.",
    ),
    (
        "Cyclically adjusted borrowing and current budget, output gap",
        "Estimates of an unobserved cycle: there is no ONS outturn to set "
        "them against.",
    ),
    (
        "Public sector net financial liabilities",
        "Forecast only since November 2016; its outturn as a share of GDP "
        "was not set up in this pass.",
    ),
    (
        "World and euro area GDP, world trade, UK export markets",
        "Not UK outcomes.",
    ),
    (
        "Oil and gas prices, equity prices, Bank Rate, gilt rates, the "
        "exchange rate",
        "Assumptions the OBR takes from market prices, not its own forecasts.",
    ),
)
