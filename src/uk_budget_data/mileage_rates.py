"""Tax-free mileage rates for business miles in the driver's own car or
van (Budget 2026, Table 6.1 row 5), for the household calculator only
(#357). It is not in the national results: neither the survey data nor
policyengine-uk has business mileage (PolicyEngine/microcosm#1418).

**Current law before the Budget.** The Taxation (Energy and Vehicles) Act
2026, s. 2, put 55p in place of 45p in the tables of ITEPA 2003 s. 230(2)
(the approved amount for mileage allowance payments) and ITTOIA 2005
s. 94F(2) (the self-employed's flat rate deduction), "for the tax year
2026-27 and subsequent tax years", with no end date. The rate above
10,000 miles stayed 25p.
https://www.legislation.gov.uk/ukpga/2026/26

**The Budget.** It keeps 55p, which the government had called temporary,
and raises the rate above 10,000 miles from 25p to 35p from 6 April 2027.
Against current law, that is the one change. The Treasury's examples
(£120 for 6,000 miles, £300 for 15,000; footnote 99) compare 2027-28 with
45p instead, and Table 6.1 also scores the May increase; this dashboard
compares every measure with current law.

**The household's inputs.** policyengine-uk 2.151.0 has no mileage
variable, so the deductions reach the engine through two inputs that go to
exactly the taxes they reduce:

- an employee's Mileage Allowance Relief (ITEPA ss. 231 and 232) as
  ``employment_deductions``, which comes off ``taxable_employment_income``
  only: income tax falls, Class 1 National Insurance (which reads
  ``employment_income``) does not, and Universal Credit, which does not
  deduct the relief (UC Regulations 2013 reg. 55), sees only the lower
  income tax. The employer is taken to pay the current-law approved
  amount and to keep paying it, so before the Budget there is no relief
  and after it the relief is the rise. For any employer rate the income
  tax base falls by the same rise, provided the relief is claimed; the
  Class 1 disregard uses the 55p rate for every mile, before and after.
- a self-employed driver's flat rate deduction (ITTOIA ss. 94D to 94F) in
  two parts. Universal Credit has its own flat rate, unchanged by the
  Budget (reg. 59: 45p for the first 833 miles of an assessment period,
  25p after); that much comes off the profit given to policyengine-uk
  (``self_employment_income``), which Universal Credit reads, and stops at
  a nil profit. The tax rates' excess over it goes in
  ``capital_allowances``, which comes off profit for income tax and
  Class 4 only, and which the trading allowance replaces as it replaces
  expenses.

The miles are the head's, driven all as an employee or all as
self-employed.
"""

from dataclasses import dataclass
from typing import Optional

MILEAGE_RATES_ID = "mileage_rates_raise"
MILEAGE_RATES_NAME = "Tax-free mileage rates raised"

EMPLOYEE = "EMPLOYEE"
SELF_EMPLOYED = "SELF_EMPLOYED"
ROLES = (EMPLOYEE, SELF_EMPLOYED)

# The household calculator accepts up to this many business miles a year
MAX_BUSINESS_MILES = 100_000

# The miles in a tax year at the higher rate (ITEPA s. 230(2), ITTOIA
# s. 94F(2))
FIRST_MILES = 10_000

# Universal Credit's flat rate covers 833 miles of an assessment period at
# the higher rate (reg. 59(2)(a)): 9,996 a year, with the year's miles
# spread evenly over its 12 assessment periods
UNIVERSAL_CREDIT_FIRST_MILES = 833 * 12

# The first tax year of the 35p rate above 10,000 miles (6 April 2027)
BUDGET_FROM = 2027


@dataclass(frozen=True)
class MileageRates:
    """£ a mile for a car or van: the first 10,000 business miles of the
    tax year, and each mile above them."""

    first_miles: float
    further_miles: float


# Current law from 2026-27: Taxation (Energy and Vehicles) Act 2026, s. 2
CURRENT_LAW_RATES = MileageRates(first_miles=0.55, further_miles=0.25)
# The Budget, from 2027-28: 35p above 10,000 miles
BUDGET_RATES = MileageRates(first_miles=0.55, further_miles=0.35)
# Universal Credit Regulations 2013, reg. 59(2)(a)
UNIVERSAL_CREDIT_RATES = MileageRates(first_miles=0.45, further_miles=0.25)


def car_and_van_rates(year: int, budget: bool) -> MileageRates:
    """The approved mileage rates for a car or van in tax year ``year``
    (2027 is 2027-28): under the Budget, or under current law."""
    return (
        BUDGET_RATES if budget and year >= BUDGET_FROM else CURRENT_LAW_RATES
    )


def approved_amount(
    miles: float, rates: MileageRates, first_miles: float = FIRST_MILES
) -> float:
    """The approved amount for a year's business miles: the higher rate on
    the first ``first_miles``, the lower rate on the rest."""
    return rates.first_miles * min(
        miles, first_miles
    ) + rates.further_miles * max(0, miles - first_miles)


def deduction_change(miles: float, year: int) -> float:
    """How much the Budget raises the approved amount for ``miles`` in
    ``year``, against current law."""
    return approved_amount(miles, car_and_van_rates(year, budget=True)) - (
        approved_amount(miles, car_and_van_rates(year, budget=False))
    )


@dataclass(frozen=True)
class MileageInputs:
    """What one side's mileage gives the head in policyengine-uk:
    Mileage Allowance Relief (``employment_deductions``), the flat rate
    deduction Universal Credit also takes (off ``self_employment_income``),
    and the tax rates' excess over it (``capital_allowances``), £ a year."""

    employment_deductions: float = 0.0
    profit_deduction: float = 0.0
    capital_allowances: float = 0.0

    def on(self, person: dict) -> dict:
        """``person`` (policyengine-uk inputs) with these deductions, as a
        new dict; an input that would be nil is left out, so a person with
        no mileage is exactly as given."""
        person = dict(person)
        if self.employment_deductions:
            person["employment_deductions"] = self.employment_deductions
        if self.profit_deduction:
            person["self_employment_income"] = (
                person["self_employment_income"] - self.profit_deduction
            )
        if self.capital_allowances:
            person["capital_allowances"] = self.capital_allowances
        return person


def mileage_inputs(
    miles: float,
    role: str,
    year: int,
    budget: bool,
    profit: Optional[float] = None,
) -> MileageInputs:
    """One side's mileage inputs for the head: ``miles`` business miles a
    year driven as ``role`` in ``year``, at the Budget's rates or current
    law's. ``profit`` is the self-employment profit before the mileage
    (receipts less other expenses); None when there is none to deduct from.

    Raises:
        ValueError: for a role other than EMPLOYEE or SELF_EMPLOYED.
    """
    if role not in ROLES:
        raise ValueError(
            f"The role must be EMPLOYEE or SELF_EMPLOYED, not {role!r}."
        )
    if miles <= 0:
        return MileageInputs()
    if role == EMPLOYEE:
        # The employer pays the current-law approved amount: relief is what
        # this side's approved amount adds to it
        employer_pays = approved_amount(
            miles, car_and_van_rates(year, budget=False)
        )
        relief = (
            approved_amount(miles, car_and_van_rates(year, budget))
            - employer_pays
        )
        return MileageInputs(employment_deductions=max(0.0, relief))
    if profit is None:
        return MileageInputs()
    universal_credit_deduction = approved_amount(
        miles, UNIVERSAL_CREDIT_RATES, UNIVERSAL_CREDIT_FIRST_MILES
    )
    tax_deduction = approved_amount(miles, car_and_van_rates(year, budget))
    return MileageInputs(
        profit_deduction=min(universal_credit_deduction, max(0.0, profit)),
        capital_allowances=max(
            0.0, tax_deduction - universal_credit_deduction
        ),
    )
