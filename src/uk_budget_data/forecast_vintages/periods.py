"""Periods, and each forecast's launch period.

A forecast's launch period is its last period of outturn: the point its
line starts from on the page. Neither the OBR's database nor its Table 1.5
marks it, so it follows from the month the forecast was published:

- quarterly: two quarters before the quarter of publication. The ONS
  publishes household income for a quarter about three months after it
  ends, so a March forecast has outturn to the previous September (Q3),
  and a November forecast to June (Q2);
- calendar years: the year before publication, the last complete year;
- fiscal years: the last complete fiscal year (April to March) before
  publication: a March 2026 forecast's is 2024-25, since 2025-26 is
  still running; a November 2025 forecast's is 2024-25 too.
"""

import re

QUARTER = re.compile(r"^(\d{4})Q([1-4])$")
FISCAL = re.compile(r"^(\d{4})-(\d{2})$")


def fiscal_label(start: int) -> str:
    return f"{start}-{str(start + 1)[-2:]}"


def quarter_label(year: int, quarter: int) -> str:
    return f"{year}Q{quarter}"


def quarter_number(label: str) -> int:
    """ "2024Q2" -> a running count of quarters, so labels can be compared."""
    match = QUARTER.match(label)
    if not match:
        raise ValueError(f"Not a quarter: {label!r}")
    return int(match[1]) * 4 + int(match[2]) - 1


def quarter_from_number(n: int) -> str:
    return quarter_label(n // 4, n % 4 + 1)


def quarterly_launch(year: int, month: int) -> str:
    published = year * 4 + (month - 1) // 3
    return quarter_from_number(published - 2)


def calendar_launch(year: int, month: int) -> int:
    return year - 1


def fiscal_launch(year: int, month: int) -> str:
    running = year if month >= 4 else year - 1
    return fiscal_label(running - 1)


def launch(frequency: str, year: int, month: int):
    if frequency == "quarterly":
        return quarterly_launch(year, month)
    if frequency == "calendar":
        return calendar_launch(year, month)
    if frequency == "fiscal":
        return fiscal_launch(year, month)
    raise ValueError(f"Unknown frequency {frequency!r}")


def sort_key(period):
    """Order periods of one frequency: years, fiscal years or quarters."""
    if isinstance(period, int):
        return period
    if QUARTER.match(period):
        return quarter_number(period)
    match = FISCAL.match(period)
    if match:
        return int(match[1])
    raise ValueError(f"Not a period: {period!r}")


def next_period(period):
    if isinstance(period, int):
        return period + 1
    if QUARTER.match(period):
        return quarter_from_number(quarter_number(period) + 1)
    match = FISCAL.match(period)
    if match:
        return fiscal_label(int(match[1]) + 1)
    raise ValueError(f"Not a period: {period!r}")
