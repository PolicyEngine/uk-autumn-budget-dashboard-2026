"""Gas standing charges abolished: one household's change in its gas bill.

The government has asked Ofgem to abolish gas standing charges on domestic
energy bills in Great Britain, "aiming for delivery by the end of 2027 or as
soon as possible after then", and suppliers are to recover these costs
through gas unit rates instead (Budget 2026, paragraphs 3.9 and 6.25; the
measures list in the HTML version, "Abolish gas standing charges"; HM
Treasury and DESNZ, release of 28 October 2026). Table 6.1 has no row for
it: no money goes to or from the Exchequer. Targeted mitigations are to
follow, with no design yet, and are not included.

This is a household-only measure (#355). policyengine-uk has no standing
charge, and the survey data no mains-gas connection or gas use in kWh, so
no national figure includes it. The household calculation
(``household_impact``) adds the change this module works out to the
household's net income after its policyengine-uk runs, so no tax, benefit
or government total moves.

The household gives one answer: its gas use in kWh a year. 0 kWh is a
home with no mains gas, which pays no standing charge and sees no change.
Whether the home is in Great Britain comes from its region.

The rule. Suppliers recover the same revenue from all domestic gas
customers, so the unit rate rises by S / Ū: S is a year's standing charge
and Ū the mean gas use per domestic meter. A home using U kWh a year then
pays

    S × (U / Ū − 1)

more over a full year: less when it uses less than the mean, more when it
uses more, and exactly the same at the mean. This is the dashboard
tracker's S × ((B − S) / (B̄ − S) − 1) (#287), with the bill B written as
the standing charge plus use times the unit rate.

In a year the abolition covers only in part, the standing charge comes off
for the days it covers, and the higher unit rate falls on the gas used in
them: S × (use share × U / Ū − day share). Ofgem's price cap converts
annual costs to one unit rate for the whole year, so a winter quarter
carries more of the rise than its share of days.

One standing charge for every home: Ofgem's Great Britain average for
Direct Debit, the Budget's "£108 a year on average". Prepayment pays the
same; standard credit (paying on receipt of the bill, 37.49p a day, £136.84
a year) pays 26% more, so for a home paying that way every change here is
26% too small. Prices are Ofgem's for 1 October to 31 December 2026, in
every year, as the Treasury's estimate used them; they are not uprated.
"""

from dataclasses import dataclass
from datetime import date
from typing import Optional

GAS_STANDING_CHARGES_ID = "gas_standing_charges_abolition"
NAME = "Gas standing charges abolished"

# Ofgem's price cap for 1 October to 31 December 2026: the Great Britain
# average Direct Debit standing charge, including 5% VAT, in pence a day.
# The Budget's "£108 a year on average" (footnote 89) is this for 365 days.
# https://www.ofgem.gov.uk/information-consumers/energy-advice-households/get-energy-price-cap-standing-charges-and-unit-rates-region
PRICE_PERIOD = "1 October to 31 December 2026"
STANDING_CHARGE_PENCE_A_DAY = 29.68
# Ofgem states a year's standing charge as 365 days of the daily charge
DAYS_IN_A_PRICE_YEAR = 365

# Mean domestic gas use per meter in Great Britain, kWh a year: DESNZ,
# Subnational electricity and gas consumption summary report 2024 (19
# December 2025), the text after Chart 15. The median is 9,859 kWh.
# https://www.gov.uk/government/statistics/subnational-electricity-and-gas-consumption-summary-report-2024
MEAN_GAS_USE_KWH = 11_359
# Ofgem's typical gas use from 1 July 2026 (the medium Typical Domestic
# Consumption Value), which the form starts at
TYPICAL_GAS_USE_KWH = 9_500

# The start date is not set. Assumed: 1 January 2028, the first price cap
# period after the end of 2027.
ABOLISHED_FROM = date(2028, 1, 1)

# The share of a year's gas use in each quarter of a policy year (April to
# March): 75% of gas is used from October to March, split equally between
# its two quarters, and the rest equally between April to June and July to
# September (Ofgem, price cap methodology, appendix 4, wholesale costs,
# 2018, as PolicyEngine/uk-energy-autumn-budget uses it). Each entry is the
# quarter's first month and its share.
QUARTER_USE_SHARES = ((4, 0.125), (7, 0.125), (10, 0.375), (1, 0.375))

# Ofgem's price cap, and the abolition, cover Great Britain only
REGIONS_NOT_COVERED = frozenset({"NORTHERN_IRELAND"})

NO_MAINS_GAS = "0 kWh, no mains gas: no gas standing charge to remove."
# Each reason reads after a dash with its first letter in lower case
# (the page's list of measures with no effect), so none starts with a
# proper noun
NOT_GREAT_BRITAIN = (
    "Outside Great Britain: Ofgem's price cap, and the abolition, do not "
    "cover Northern Ireland."
)
BEFORE_START = (
    "Not yet in force: the start is assumed to be "
    f"{ABOLISHED_FROM.day} January {ABOLISHED_FROM.year}."
)

# The split by policy's note on the change
HOUSEHOLD_NOTE = (
    "A change in the gas bill, not in a tax or benefit: the standing charge "
    "is recovered through the unit rate, so homes using less gas than the "
    f"average ({MEAN_GAS_USE_KWH:,} kWh a year) pay less and those using "
    "more pay more; at the average the change is £0. It is counted in net "
    "income because it changes what the household has left to spend; no "
    "money goes to or from the government. Start assumed 1 January 2028, "
    f"at Ofgem's Direct Debit prices for {PRICE_PERIOD}."
)


def annual_standing_charge() -> float:
    """A year's gas standing charge, £, at the price cap for
    ``PRICE_PERIOD``."""
    return STANDING_CHARGE_PENCE_A_DAY * DAYS_IN_A_PRICE_YEAR / 100


@dataclass(frozen=True)
class InForce:
    """How much of policy year ``year`` (1 April to 31 March) the abolition
    covers: its days in force, the year's days, and the share of the
    year's gas use in those days."""

    days: int
    year_days: int
    use: float

    @property
    def day_share(self) -> float:
        return self.days / self.year_days


def _quarter_starts(year: int) -> list[tuple[date, float]]:
    """The policy year's quarters, in order, with each one's share of use:
    April, July and October of ``year``, then January of the next."""
    return [
        (date(year if month >= 4 else year + 1, month, 1), share)
        for month, share in QUARTER_USE_SHARES
    ]


def in_force(year: int) -> InForce:
    """The part of policy year ``year`` from ``ABOLISHED_FROM`` on. Within
    a quarter, use is spread evenly over its days."""
    start, end = date(year, 4, 1), date(year + 1, 4, 1)
    quarters = _quarter_starts(year)
    use = 0.0
    for index, (first, share) in enumerate(quarters):
        last = quarters[index + 1][0] if index + 1 < len(quarters) else end
        covered = (last - max(first, ABOLISHED_FROM)).days
        if covered > 0:
            use += share * covered / (last - first).days
    days = max(0, (end - max(start, ABOLISHED_FROM)).days)
    return InForce(days=days, year_days=(end - start).days, use=use)


@dataclass(frozen=True)
class GasBillChange:
    """One household's change in its gas bill in one policy year, £ (a
    positive change is a higher bill), with what it was worked from.
    ``applies`` is false, with a ``reason``, when the measure does not
    reach the household; a change of £0 that applies (use at the mean) is
    a calculated £0."""

    change: float
    applies: bool
    reason: Optional[str]
    gas_use_kwh: float
    standing_charge: float
    unit_rate_rise_pence: float
    day_share: float
    use_share: float


def bill_change(
    *, gas_use_kwh: float, region: str, year: int
) -> GasBillChange:
    """The household's change in its gas bill in policy year ``year``, £:
    S × (use share × U / Ū − day share), or nothing with no gas use (no
    mains gas), in Northern Ireland or before the start.

    Raises:
        ValueError: for a negative use.
    """
    if gas_use_kwh < 0:
        raise ValueError("Gas use can't be negative.")
    standing = annual_standing_charge()
    covered = in_force(year)
    if region in REGIONS_NOT_COVERED:
        reason = NOT_GREAT_BRITAIN
    elif gas_use_kwh == 0:
        reason = NO_MAINS_GAS
    elif covered.days == 0:
        reason = BEFORE_START
    else:
        reason = None
    change = (
        0.0
        if reason
        else standing
        * (covered.use * gas_use_kwh / MEAN_GAS_USE_KWH - covered.day_share)
    )
    return GasBillChange(
        change=change,
        applies=reason is None,
        reason=reason,
        gas_use_kwh=gas_use_kwh,
        standing_charge=standing,
        unit_rate_rise_pence=standing / MEAN_GAS_USE_KWH * 100,
        day_share=covered.day_share,
        use_share=covered.use,
    )
