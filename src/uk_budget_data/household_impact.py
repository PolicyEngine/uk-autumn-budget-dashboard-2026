"""One household's net income in one year before and after the Budget,
through policyengine.py.

The Personal impact tab's single-year view asks about a household and
shows, for one policy year and the selected measures:

- its net income under pre-Budget law ("baseline") and under the Budget
  ("reform"), and the change;
- each measure's own effect: that measure switched to its Budget setting
  with every other selected measure held at pre-Budget law, against the
  same baseline. The singles need not add up to the combined change (two
  measures can act on the same income or benefit), so the difference is
  reported as the interaction residual: ``combined - sum of singles``;
- taxes and benefits, programme by programme, under both;
- an earnings sweep: net income and the marginal effective tax rate across
  the head's employment income, with the household's own point marked.

Every figure comes from a policyengine-uk household simulation on the
version the release bundle (policyengine.py) pins, with no dataset: the
household is built as policyengine.py's household calculation
(``pe.uk.calculate_household``) builds it, with its input checks, and each
side runs as a ``policyengine_uk.Simulation`` with a ``Scenario`` holding the
side's parameter changes and its measures' simulation modifiers, the path
the national run and ``personal_impact`` take. policyengine.py's household
calculation takes parameter changes only, so six of the nine measures (those
whose modifiers change a formula) could not be applied through it; on this
path every measure is. The sweep is one simulation per side, with the
situation's ``axes``: the modifiers change formulas, which act on every
point of the sweep at once.

Each side's parameter changes and modifiers are the population pipeline's
own: the measures' changes merged as the combined run merges them
(``publication.combine.merged_changes``), in member order, with each
member's modifier run in that order after them.

A measure whose household effect is £0 by construction (employer National
Insurance: wages are fixed), or that depends on receipt (the Warm Home
Discount), carries a note with its change (``HOUSEHOLD_NOTES``).
"""

import copy
import importlib
import inspect
import json
import os
import threading
from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Optional

import numpy as np
from policyengine.tax_benefit_models.common import (
    normalize_axes,
    validate_annual_household_inputs,
)
from policyengine.tax_benefit_models.uk.household import _build_situation
from policyengine.tax_benefit_models.uk.model import uk_latest
from policyengine.utils.household_validation import validate_household_input
from policyengine_uk.model_api import WEEKS_IN_YEAR
from policyengine_uk.parameters.gov.simulation.labour_supply_responses.aliases import (  # noqa: E501
    canonicalize_parameter_changes,
)
from policyengine_uk.tax_benefit_system import parameter_reads_calendar_years
from policyengine_uk.utils.dated_reforms import read_parameter_changes
from policyengine_uk.variables.gov.hmrc.student_loans.student_loan_plan import (  # noqa: E501
    StudentLoanPlan,
)
from policyengine_uk.variables.household.BRMA import REGION_DEFAULT_BRMA
from policyengine_uk.variables.household.demographic.locations import (
    BRMAName,
    LocalAuthority,
)
from policyengine_uk.variables.input.council_tax_band import CouncilTaxBand

from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    bus_fare_cap_2027,
)
from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
    carers_allowance_earnings_taper,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    CombineConflict,
    member_order,
    merged_changes,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    EMPLOYER_NI_ID,
    TRADING_ALLOWANCE_FROM,
    WARM_HOME_DISCOUNT_ID,
    get_autumn_budget_2026_reforms,
    get_reform,
)
from uk_budget_data.runtime_identity import runtime_identity

# The UK regions and tenures policyengine-uk knows, as the form offers them
REGIONS = (
    "NORTH_EAST",
    "NORTH_WEST",
    "YORKSHIRE",
    "EAST_MIDLANDS",
    "WEST_MIDLANDS",
    "EAST_OF_ENGLAND",
    "LONDON",
    "SOUTH_EAST",
    "SOUTH_WEST",
    "WALES",
    "SCOTLAND",
    "NORTHERN_IRELAND",
)
TENURES = (
    "OWNED_OUTRIGHT",
    "OWNED_WITH_MORTGAGE",
    "RENT_PRIVATELY",
    "RENT_FROM_COUNCIL",
    "RENT_FROM_HA",
)
RENTING = frozenset({"RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA"})
STUDENT_LOAN_PLANS = tuple(plan.name for plan in StudentLoanPlan)
BRMAS = tuple(name.name for name in BRMAName)
LOCAL_AUTHORITIES = tuple(name.name for name in LocalAuthority)
COUNCIL_TAX_BANDS = tuple(band.name for band in CouncilTaxBand)

# Where a household with no Broad Rental Market Area given is placed:
# policyengine-uk's own default, its region's BRMA with the most
# private-rented households (``policyengine_uk ... BRMA.REGION_DEFAULT_BRMA``).
DEFAULT_BRMA = {
    region.name: brma.name for region, brma in REGION_DEFAULT_BRMA.items()
}

# Where a household with no local authority given is placed: a local
# authority inside its region's default BRMA, so the area the answer shows
# is one place. policyengine-uk's own default is Maidstone whatever the
# region (``local_authority`` has no formula), and it has no "none". The
# model reads the local authority only to choose the working-age Council
# Tax Reduction schemes it simulates (Kingston upon Thames, Merton, Newham,
# Oxford and Westminster), and none of these is one of them, so the
# default changes no result. Only a local authority given sets the
# estimated Council Tax (its own Band D, ``estimated_council_tax``); the
# default leaves it at the region's average. Neither sets the BRMA:
# policyengine-uk places a household in a BRMA from its region alone.
DEFAULT_LOCAL_AUTHORITY = {
    "NORTH_EAST": "NEWCASTLE_UPON_TYNE",  # Tyneside
    "NORTH_WEST": "MANCHESTER",  # Central Greater Manchester
    "YORKSHIRE": "LEEDS",  # Leeds
    "EAST_MIDLANDS": "LEICESTER",  # Leicester
    "WEST_MIDLANDS": "BIRMINGHAM",  # Birmingham
    "EAST_OF_ENGLAND": "NORWICH",  # Central Norfolk and Norwich
    "LONDON": "SOUTHWARK",  # Inner South East London
    "SOUTH_EAST": "SOUTHAMPTON",  # Southampton
    "SOUTH_WEST": "BRISTOL_CITY_OF",  # Bristol
    "WALES": "CARDIFF",  # Cardiff
    "SCOTLAND": "CITY_OF_EDINBURGH",  # Lothian
    "NORTHERN_IRELAND": "BELFAST",  # Belfast
}

# The age from which a child's education decides whether they are a
# dependant (policyengine-uk's Child Benefit and Universal Credit child age
# limit: under 16 is a child whatever their education), and the oldest age
# the form takes (policyengine-uk's qualifying young person age limit is
# under 20).
YOUNG_PERSON_AGE = 16
OLDEST_CHILD_AGE = 19
# The age a young person in non-advanced education is taken to have
# started it: the rules count a 19-year-old only if they started before 19.
EDUCATION_START_AGE = 16

# Notes on a measure's household change, where the number alone would
# mislead: £0 by construction, or an amount that depends on receipt.
HOUSEHOLD_NOTES: dict[str, dict] = {
    EMPLOYER_NI_ID: {
        "kind": "employer_cost",
        "text": (
            "No household effect (employer cost): employers pay less "
            "National Insurance, and wages are held fixed, so no household's "
            "net income changes."
        ),
    },
    WARM_HOME_DISCOUNT_ID: {
        "kind": "if_received",
        "text": (
            "If received: the £100 is shown for a household in Great Britain "
            "on Universal Credit, Pension Credit, Housing Benefit or "
            "income-related ESA in 2026-27. Not every "
            "eligible household receives the Warm Home Discount: the "
            "national figures pay it to 85% of Pension Credit households "
            "and 70% of other eligible households (DESNZ receipt rates)."
        ),
    },
}

INTERACTION_METHOD = (
    "Each measure's change is that measure switched to its Budget setting, "
    "with every other selected measure held at pre-Budget law, against the "
    "same baseline. The combined change switches them all at once. The "
    "residual is the combined change minus the sum of the single changes: "
    "what the measures do together beyond what each does alone."
)


@dataclass(frozen=True)
class Programme:
    """A row of the programme table: a policyengine-uk variable summed over
    the household's members of its entity, with its parts as child rows.
    ``group`` is "tax" (an amount the household pays), "benefit" (one it
    receives) or "income" (gross income, before tax). A row with no
    ``variable`` is the sum of its children."""

    id: str
    label: str
    group: str
    variable: Optional[str]
    entity: str
    children: tuple = ()
    note: Optional[str] = None
    # A row that is one variable less another (both summed over
    # ``entity``s members), in place of ``variable``: what one step of a
    # calculation took off, such as the benefit cap.
    difference: Optional[tuple] = None


def _row(id_, label, variable, entity):
    return Programme(id_, label, "", variable, entity)


PROGRAMMES = (
    Programme(
        "income_tax",
        "Income Tax",
        "tax",
        "income_tax",
        "person",
        children=(
            _row(
                "earned_income_tax",
                "On earnings",
                "earned_income_tax",
                "person",
            ),
            _row(
                "savings_income_tax",
                "On savings",
                "savings_income_tax",
                "person",
            ),
            _row(
                "dividend_income_tax",
                "On dividends",
                "dividend_income_tax",
                "person",
            ),
            _row(
                "property_income_tax",
                "On property income",
                "property_income_tax",
                "person",
            ),
            _row(
                "child_benefit_charge",
                "High Income Child Benefit Charge",
                "CB_HITC",
                "person",
            ),
        ),
        note=(
            "Includes the High Income Child Benefit Charge, so Child Benefit "
            "is shown before it."
        ),
    ),
    Programme(
        "national_insurance",
        "Employee National Insurance",
        "tax",
        "ni_employee",
        "person",
    ),
    Programme(
        "student_loan_repayments",
        "Student loan repayments",
        "tax",
        "student_loan_repayment",
        "person",
    ),
    Programme(
        "council_tax",
        "Council Tax",
        "tax",
        "council_tax",
        "household",
        note=(
            "Estimated from the band and the region's average Band D "
            "(COUNCIL_TAX_BAND_D), unless entered. No measure changes it."
        ),
    ),
    Programme(
        "fuel_duty",
        "Fuel duty",
        "tax",
        "fuel_duty",
        "household",
        note="From the petrol and diesel spending entered.",
    ),
    Programme(
        "vat_change",
        "VAT",
        "tax",
        "vat_change",
        "household",
        note=(
            "The change in VAT the measures make on the spending entered "
            "(electricity, petrol and diesel). The form asks about no other "
            "spending, so VAT itself is not shown: £0 before the Budget."
        ),
    ),
    Programme("tv_licence", "TV licence", "tax", "tv_licence", "household"),
    Programme(
        "pension_contributions",
        "Pension contributions from pay",
        "tax",
        "pension_contributions",
        "person",
        note=(
            "Not a tax, but taken off net income. Salary sacrificed above "
            "the salary sacrifice cap is paid into the pension from pay "
            "instead."
        ),
    ),
    Programme(
        "universal_credit",
        "Universal Credit",
        "benefit",
        "universal_credit_pre_benefit_cap",
        "benunit",
        children=(
            _row(
                "uc_standard_allowance",
                "Standard allowance",
                "uc_standard_allowance",
                "benunit",
            ),
            _row(
                "uc_child_element",
                "Child element",
                "uc_child_element",
                "benunit",
            ),
            _row(
                "uc_housing_costs_element",
                "Housing costs element",
                "uc_housing_costs_element",
                "benunit",
            ),
            _row(
                "uc_childcare_element",
                "Childcare element",
                "uc_childcare_element",
                "benunit",
            ),
            _row(
                "uc_carer_element",
                "Carer element",
                "uc_carer_element",
                "benunit",
            ),
        ),
        note=(
            "Before the benefit cap, which is its own row. Elements are "
            "before the earnings taper."
        ),
    ),
    Programme(
        "carers_allowance",
        "Carer's Allowance",
        "benefit",
        "carers_allowance",
        "person",
        note=(
            "As paid, after any overlapping benefit such as the State "
            "Pension. Universal Credit counts it as income, pound for pound."
        ),
    ),
    Programme(
        "child_benefit", "Child Benefit", "benefit", "child_benefit", "benunit"
    ),
    Programme(
        "tax_free_childcare",
        "Tax-Free Childcare",
        "benefit",
        "tax_free_childcare",
        "person",
    ),
    Programme(
        "housing_benefit",
        "Housing Benefit",
        "benefit",
        "housing_benefit_pre_benefit_cap",
        "benunit",
        note="Before the benefit cap, which is its own row.",
    ),
    Programme(
        "benefit_cap",
        "Benefit cap",
        "benefit",
        None,
        "benunit",
        note=(
            "What the benefit cap takes off Universal Credit and Housing "
            "Benefit, shown as a negative amount, so the rows above it are "
            "before the cap and the group adds up to what is paid."
        ),
        difference=(
            ("universal_credit", "universal_credit_pre_benefit_cap"),
            ("housing_benefit", "housing_benefit_pre_benefit_cap"),
        ),
    ),
    Programme(
        "council_tax_reduction",
        "Council Tax Reduction",
        "benefit",
        "council_tax_benefit",
        "benunit",
        note=(
            "Where policyengine-uk simulates the scheme that applies: "
            "England's pension-age scheme, the Scottish and Welsh schemes, "
            "and the working-age schemes of Kingston upon Thames, Merton, "
            "Newham, Oxford and Westminster. Elsewhere none is counted."
        ),
    ),
    Programme(
        "pension_credit",
        "Pension Credit",
        "benefit",
        "pension_credit",
        "benunit",
    ),
    Programme(
        "state_pension", "State Pension", "benefit", "state_pension", "person"
    ),
    Programme(
        "winter_fuel_payment",
        "Winter Fuel Payment",
        "benefit",
        "winter_fuel_allowance",
        "household",
    ),
    Programme(
        "warm_home_discount_top_up",
        "Warm Home Discount top-up",
        "benefit",
        "cost_of_living_support_payment",
        "household",
        note=(
            "The candidate £100 more Warm Home Discount in 2026-27, paid "
            "through policyengine-uk's cost-of-living payment, for a "
            "household in Great Britain on Universal Credit, Pension "
            "Credit, Housing Benefit or income-related ESA, if received."
        ),
    ),
    Programme(
        "scottish_child_payment",
        "Scottish Child Payment",
        "benefit",
        "scottish_child_payment",
        "person",
    ),
    Programme(
        "free_childcare",
        "Free childcare hours",
        "benefit",
        None,
        "person",
        children=(
            _row(
                "universal_childcare_entitlement",
                "Universal hours (3- and 4-year-olds)",
                "universal_childcare_entitlement",
                "person",
            ),
            _row(
                "extended_childcare_entitlement",
                "Working parents' hours",
                "extended_childcare_entitlement",
                "benunit",
            ),
            _row(
                "targeted_childcare_entitlement",
                "Disadvantaged 2-year-olds' hours",
                "targeted_childcare_entitlement",
                "person",
            ),
        ),
        note=(
            "The value of the funded hours, which policyengine-uk counts in "
            "net income."
        ),
    ),
    Programme(
        "employment_income",
        "Employment income",
        "income",
        "employment_income",
        "person",
        children=(
            _row(
                "salary_sacrifice_haircut",
                "Pay cut for the salary sacrifice cap (current law)",
                "salary_sacrifice_broad_base_haircut",
                "person",
            ),
        ),
        note=(
            "The £2,000 salary sacrifice cap from April 2029 is existing law "
            "(Budget 2025), so it is the same before and after the measures. "
            "policyengine-uk assumes employers recover the "
            "cap's extra employer National Insurance by cutting every "
            "employee's pay by a set share, whether or not they use salary "
            "sacrifice: the pay cut row, a negative amount."
        ),
    ),
    Programme(
        "dividend_income", "Dividends", "income", "dividend_income", "person"
    ),
    Programme(
        "savings_interest_income",
        "Savings interest",
        "income",
        "savings_interest_income",
        "person",
    ),
    Programme(
        "property_income",
        "Property income",
        "income",
        "property_income",
        "person",
    ),
    Programme(
        "self_employment_income",
        "Self-employment profit",
        "income",
        "self_employment_income",
        "person",
        note=(
            "Receipts less allowable expenses, before the trading allowance, "
            "which comes off taxable income."
        ),
    ),
    Programme(
        "private_pension_income",
        "Private pension",
        "income",
        "private_pension_income",
        "person",
    ),
)

# Each group's total as policyengine-uk's net income counts it
# (household_net_income = market income + benefits - taxes - pension
# contributions), and the row that takes what the rows above leave out, so
# the table always adds up to net income. They are £0 for the answers the
# form takes; a non-zero one means a programme row is missing.
GROUP_TOTALS = {
    "tax": ("household_tax", "pension_contributions"),
    "benefit": ("household_benefits",),
    "income": ("household_market_income",),
}
OTHER_ROWS = (
    Programme("other_taxes", "Other taxes", "tax", None, "household"),
    Programme(
        "other_benefits", "Other benefits", "benefit", None, "household"
    ),
    Programme("other_income", "Other income", "income", None, "household"),
)


def _all_rows():
    for programme in (*PROGRAMMES, *OTHER_ROWS):
        yield programme
        yield from programme.children


# The rows only a carer can have: shown only for a household with one
# (``HouseholdAnswers.is_carer``), so every other household's answer is
# exactly as it was before the form asked about caring. They are always
# computed, and a non-carer's are £0, so "Other benefits" is unchanged.
CARER_ROWS = frozenset({"carers_allowance", "uc_carer_element"})
# Likewise the self-employment row: shown only for a household that gives
# self-employment receipts or expenses (``HouseholdAnswers``).
TRADING_ROWS = frozenset({"self_employment_income"})


# Measures in the national figures that the household breakdown can't
# show: none of the candidate measures.
NOT_IN_BREAKDOWN: tuple = ()

# Dependant status, per child, as policyengine-uk decides it
DEPENDANT_VARIABLES = (
    "is_claimant_or_partner",
    "is_child_or_qualifying_young_person_for_child_benefit",
    "is_child_or_qualifying_young_person_for_universal_credit",
)
DEPENDANTS_NOTE = (
    "Who counts as a child follows policyengine-uk: everyone under 16, and a "
    "16- to 19-year-old in full-time non-advanced education (school or "
    "college) begun before 19. Child Benefit counts such a young person "
    "until 20; Universal Credit stops at the 1 September after their 19th "
    "birthday, so a 19-year-old counts for Child Benefit but not Universal "
    "Credit."
)
EXTRA_VARIABLES = sorted(
    {row.variable for row in _all_rows() if row.variable}
    | {
        name
        for row in _all_rows()
        for pair in (row.difference or ())
        for name in pair
    }
    | {name for names in GROUP_TOTALS.values() for name in names}
    | set(DEPENDANT_VARIABLES)
    | {"brma", "local_authority"}
)

# Salary is entered for SALARY_YEAR and grown to the chosen year with the
# OBR average earnings index policyengine-uk uprates earnings with.
SALARY_YEAR = 2026
EARNINGS_INDEX = "gov.economic_assumptions.indices.obr.average_earnings"

# The earnings sweep: points from £0 to the larger of SWEEP_MIN_MAX and
# twice the head's employment income.
SWEEP_POINTS = 50
SWEEP_MIN_MAX = 150_000

# The marginal rate at the head's own income: the change in net income when
# the head earns this much more. The sweep's points are several thousand
# pounds apart, so a rate over the sweep interval holding the income can
# average across a kink (the end of the Personal Allowance taper) that the
# head has not reached. £200, not less: from £60,000 to £80,000 the High
# Income Child Benefit Charge rises one percentage point per whole £200 of
# income, so a window under £200 usually sees no rise (a rate of 51% where
# the charge makes it about 67% with three children) or, across a step, a
# doubled one. Any £200 window crosses exactly one step, so it reads the
# charge's true average; at the other kinks it changes nothing.
OWN_RATE_STEP = 200

# The variables read to split the marginal rate into its parts, summed over
# the household. income_tax includes the Child Benefit charge (CB_HITC, one of
# policyengine-uk's income_tax_additions), which is taken out of it as a part
# of its own.
RATE_PART_VARIABLES = (
    "income_tax",
    "CB_HITC",
    "personal_allowance",
    "national_insurance",
    "student_loan_repayments",
    "universal_credit",
    "household_benefits",
)

# The parts of the marginal rate, in stacking order: each the share of an
# extra pound of the head's employment income that a tax takes or a benefit's
# withdrawal removes, and "other" the rest of the rate (pension
# contributions, other taxes and the rounding), so the parts add up to it.
MARGINAL_RATE_PARTS = (
    "income_tax",
    "child_benefit_charge",
    "personal_allowance_taper",
    "national_insurance",
    "student_loan",
    "universal_credit",
    "other_benefits",
    "other",
)


# The further variables the sweep reads to split net income into its parts
# at each point, summed over the household: policyengine-uk's net income is
# market income plus benefits less taxes and pension contributions.
NET_INCOME_LEVEL_VARIABLES = (
    "household_market_income",
    "household_benefits",
    "household_tax",
    "pension_contributions",
    "child_benefit",
    "council_tax",
    "state_pension",
    "cost_of_living_support_payment",
    "fuel_duty",
    "vat_change",
)

# The parts of net income at each sweep point, in stacking order, each in £
# with its sign (taxes negative): the head's employment income, the rest of
# market income, the benefits, then the taxes and deductions; named as the
# programme table's rows, and besides the main programmes, each one a
# measure moves (the Warm Home Discount, fuel duty and VAT). The
# "other" benefits are the rest of household_benefits, and "other_taxes"
# the rest of net income, so the parts add up to it to the penny.
NET_INCOME_PARTS = (
    "employment_income",
    "other_income",
    "universal_credit",
    "child_benefit",
    "state_pension",
    "warm_home_discount",
    "other_benefits",
    "income_tax",
    "national_insurance",
    "student_loan",
    "council_tax",
    "fuel_duty",
    "vat_change",
    "child_benefit_charge",
    "pension_contributions",
    "other_taxes",
)


def measure_ids() -> list[str]:
    """The measures the household calculation accepts: every registered
    single measure (the combined measure is the sum of these)."""
    return [
        reform.id
        for reform in get_autumn_budget_2026_reforms()
        if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID
    ]


# The average UK household's domestic electricity spending, £ a year
# including VAT: ONS, Family spending in the UK, April 2024 to March 2025,
# Workbook 1, Table A1, line 4.4.1 (Electricity): £20.00 a week.
# https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends
# No policyengine-uk formula reads it (``electricity_consumption`` is an
# input): the VAT base template (``measure_templates.apply_vat_base_change``)
# reads it for the zero VAT on domestic electricity, so it changes no
# pre-Budget figure.
ELECTRICITY_SPENDING = round(20.00 * 52)
# Domestic mains gas, from the same table: line 4.4.2 (Gas), £14.10 a week,
# averaged over all households as electricity is. ``gas_consumption`` is an
# input too, which the VAT base template would read for a measure that
# changes the VAT on domestic gas, so it changes no pre-Budget figure.
GAS_SPENDING = round(14.10 * 52)


@dataclass(frozen=True)
class Child:
    """A child in the household. ``in_education`` matters from 16: whether
    they are in full-time non-advanced education (school or college, not
    university or an apprenticeship). None leaves it to policyengine-uk,
    which places a 16- or 17-year-old in school and an 18- or 19-year-old
    at university."""

    age: int
    in_education: Optional[bool] = None


@dataclass(frozen=True)
class HouseholdAnswers:
    """The Personal impact view's questions. Amounts are £ a year, except
    ``monthly_rent``."""

    age: int = 40
    employment_income: float = 35_000
    student_loan_plan: str = "NONE"
    has_partner: bool = False
    partner_age: int = 40
    partner_employment_income: float = 0
    partner_student_loan_plan: str = "NONE"
    children: tuple[Child, ...] = field(default_factory=tuple)
    region: str = "LONDON"
    claims_universal_credit: bool = False
    tenure: str = "OWNED_WITH_MORTGAGE"
    monthly_rent: float = 0
    brma: Optional[str] = None
    local_authority: Optional[str] = None
    # None: estimated from the band and the local authority's own Band D,
    # or the region's average with no local authority (estimated_council_tax)
    council_tax: Optional[float] = None
    council_tax_band: str = "D"
    monthly_childcare: float = 0
    salary_year: int = SALARY_YEAR
    dividend_income: float = 0
    savings_interest_income: float = 0
    property_income: float = 0
    # Private and workplace pensions in payment, £ a year
    private_pension_income: float = 0
    partner_private_pension_income: float = 0
    petrol_spending: float = 0
    diesel_spending: float = 0
    # Domestic electricity, £ a year including VAT (ELECTRICITY_SPENDING)
    electricity_spending: float = ELECTRICITY_SPENDING
    # Domestic mains gas, £ a year including VAT (GAS_SPENDING). The form
    # does not ask for it yet, so every calculator household has the average.
    gas_spending: float = GAS_SPENDING
    # Bus and coach fares paid, £ a year (policyengine-uk's
    # bus_fare_spending), for the £2 bus fare cap. 0 (not asked) sets
    # nothing, so every other household is exactly as before.
    bus_fare_spending: float = 0
    salary_sacrifice_pension_contributions: float = 0
    # State Pension, £ a year in the year calculated, for an adult at State
    # Pension age; None is the full new State Pension (``state_pensions``)
    state_pension: Optional[float] = None
    partner_state_pension: Optional[float] = None
    # Whether the head looks after someone, unpaid, and for how many hours
    # a week (policyengine-uk's ``care_hours``, read only for a carer). At
    # the Carer's Allowance minimum (35 hours) the model pays the allowance
    # to a carer under its earnings limit, and counts them as a carer for
    # Universal Credit's carer element (``is_carer_for_benefits``). The
    # partner is not asked.
    is_carer: bool = False
    care_hours_per_week: float = 35
    # The head's self-employment or side income, £ a year in the year
    # calculated: gross receipts (turnover) and allowable expenses. Given
    # receipts, policyengine-uk's trading_allowance_deduction chooses
    # between the trading allowance and the actual expenses.
    self_employment_receipts: float = 0
    self_employment_expenses: float = 0

    @property
    def self_employed(self) -> bool:
        return bool(
            self.self_employment_receipts or self.self_employment_expenses
        )


# policyengine-uk's age-derived education stage
# (``current_education``'s formula), as (below this age, stage).
EDUCATION_BY_AGE = (
    (4, "PRE_PRIMARY"),
    (7, "NOT_COMPLETED_PRIMARY"),
    (11, "PRIMARY"),
    (14, "LOWER_SECONDARY"),
    (16, "UPPER_SECONDARY"),
    (18, "POST_SECONDARY"),
    (20, "TERTIARY"),
)


def education_by_age(age: int) -> str:
    """The stage policyengine-uk's formula gives a person of ``age``."""
    for limit, stage in EDUCATION_BY_AGE:
        if age < limit:
            return stage
    return "NOT_IN_EDUCATION"


def child_inputs(child: Child) -> dict:
    """A child as policyengine-uk inputs. Never the claimant or partner;
    from 16, their education as entered, so policyengine-uk's own
    qualifying young person rules decide whether they count."""
    person = {"age": child.age, "is_claimant_or_partner": False}
    if child.age >= YOUNG_PERSON_AGE and child.in_education is not None:
        if child.in_education:
            person["current_education"] = "POST_SECONDARY"
            person["age_started_or_accepted_current_education_or_training"] = (
                EDUCATION_START_AGE
            )
        else:
            person["current_education"] = "NOT_IN_EDUCATION"
    return person


def earnings_growth(from_year: int, to_year: int) -> float:
    """How much average earnings grow from one year to another, on the OBR
    average earnings index policyengine-uk uprates earnings with (read at
    the start of each year, as policyengine-core uprates a yearly
    variable)."""
    from policyengine_uk.system import system

    index = system.parameters.get_child(EARNINGS_INDEX)
    return float(index(f"{to_year}-01-01") / index(f"{from_year}-01-01"))


def salaries_in(answers: HouseholdAnswers, year: int) -> tuple[float, float]:
    """The head's and partner's employment income in ``year``: as entered
    for ``salary_year``, grown with average earnings."""
    growth = earnings_growth(answers.salary_year, year)
    return (
        answers.employment_income * growth,
        answers.partner_employment_income * growth,
    )


def full_new_state_pension(year: int) -> float:
    """The full new State Pension, £ a year, in ``year``, as a simulation
    on the October 2026 forecast pays it: the model's weekly rate
    (``gov.dwp.state_pension.new_state_pension.amount``, read as
    ``new_state_pension`` reads it) on that forecast, times its weeks in a
    year."""
    from uk_budget_data.calculators import forecast_full_new_state_pension

    return forecast_full_new_state_pension([year])[year] * WEEKS_IN_YEAR


def reported_state_pension(paid: float, year: int) -> float:
    """The ``state_pension_reported`` input for a State Pension of ``paid``
    (£ a year in ``year``). policyengine-uk splits a reported amount at the
    full rate of the version the bundle pins (the OBR's March 2026
    forecast); on the October 2026 forecast a simulation pays it scaled by
    October's full rate over that one. So the full rate is reported as the
    pinned full rate, exactly, and any other amount scaled down by the
    same ratio, so that what is paid is ``paid``."""
    from uk_budget_data.calculators import (
        full_new_state_pension as pinned_weekly,
    )

    pinned = pinned_weekly([year])[year] * WEEKS_IN_YEAR
    full = full_new_state_pension(year)
    if paid == full:
        return pinned
    return paid * pinned / full


@lru_cache(maxsize=None)
def state_pension_age(year: int) -> int:
    """The youngest whole age policyengine-uk places over State Pension age
    in ``year`` (its ``is_SP_age``: reached by 6 October) for a person
    entered, as the form enters them, by age alone."""
    from policyengine_uk import Simulation

    ages = range(YOUNG_PERSON_AGE, 101)
    names = [f"p{age}" for age in ages]
    simulation = Simulation(
        situation={
            "people": {
                name: {"age": {year: age}} for name, age in zip(names, ages)
            },
            "benunits": {name: {"members": [name]} for name in names},
            "households": {"household": {"members": names}},
        }
    )
    over = simulation.calculate("is_SP_age", year)
    return min(age for age, is_over in zip(ages, over) if is_over)


def state_pensions(
    answers: HouseholdAnswers, year: int
) -> tuple[Optional[float], Optional[float]]:
    """The head's and partner's State Pension, £ a year in ``year``: None
    under State Pension age (or with no partner), else as entered, or the
    full new State Pension when not entered.

    policyengine-uk takes the State Pension as an input
    (``state_pension_reported``): without it, a pensioner has none, and
    Pension Credit makes up the difference. The model splits the amount at
    the year's full rate, so an amount above it is a protected payment.
    """
    age = state_pension_age(year)

    def amount(person_age, entered):
        if person_age < age:
            return None
        return full_new_state_pension(year) if entered is None else entered

    return (
        amount(answers.age, answers.state_pension),
        (
            amount(answers.partner_age, answers.partner_state_pension)
            if answers.has_partner
            else None
        ),
    )


# Average Band D Council Tax in 2026-27, £ a year, for a dwelling of two
# adults, including adult social care, parish/community and police/fire
# precepts:
# - England, by region: MHCLG, "Council Tax levels set by local authorities
#   in England 2026 to 2027", Table 10 (Data_Billing): each billing
#   authority's line 17 (area Band D including all precepts) weighted by its
#   line 7 tax base, by region. Weighted over all of England this gives
#   £2,391.52 and over London £2,068.47, the release's own averages
#   (Tables 3 and 7).
#   https://www.gov.uk/government/statistics/council-tax-levels-set-by-local-authorities-in-england-2026-to-2027
# - Wales: Welsh Government, "Council Tax levels: April 2026 to March 2027",
#   average Band D £2,283 (county, police and community councils).
#   https://www.gov.wales/council-tax-levels-april-2026-march-2027-html
# - Scotland: Scottish Government, Council Tax datasets, "Band D Council Tax
#   1996-97 to 2026-27": £1,653.44 (excluding water and sewerage).
#   https://www.gov.scot/publications/council-tax-datasets/
# Northern Ireland has domestic rates, not Council Tax: none is estimated.
COUNCIL_TAX_BAND_D = {
    "NORTH_EAST": 2_534.67,
    "NORTH_WEST": 2_478.62,
    "YORKSHIRE": 2_389.55,
    "EAST_MIDLANDS": 2_460.34,
    "WEST_MIDLANDS": 2_392.62,
    "EAST_OF_ENGLAND": 2_393.99,
    "LONDON": 2_068.47,
    "SOUTH_EAST": 2_472.41,
    "SOUTH_WEST": 2_550.04,
    "WALES": 2_283.00,
    "SCOTLAND": 1_653.44,
}
COUNCIL_TAX_BASE_YEAR = 2026

# Each band's Council Tax as a share of Band D. England and Wales: the
# Local Government Finance Act 1992 s.5(1) ninths (Wales adds band I,
# 21/9). Scotland since April 2017: A to D the same, E to H 473, 585, 705
# and 882 three-hundred-and-sixtieths (Council Tax (Substitution of
# Proportion) (Scotland) Order 2016).
_NINTHS = {"A": 6, "B": 7, "C": 8, "D": 9, "E": 11, "F": 13, "G": 15}
COUNCIL_TAX_BAND_RATIO = {
    **{band: n / 9 for band, n in _NINTHS.items()},
    "H": 18 / 9,
    "I": 21 / 9,
}
SCOTTISH_BAND_RATIO = {
    **COUNCIL_TAX_BAND_RATIO,
    "E": 473 / 360,
    "F": 585 / 360,
    "G": 705 / 360,
    "H": 882 / 360,
}


def council_tax_growth(region: str, year: int) -> float:
    """Council Tax growth from 2026-27 to ``year``, compounded from
    policyengine-uk's own Council Tax growth series for the nation
    (``gov.economic_assumptions.yoy_growth.obr.council_tax``, the OBR's
    forecast), read for each year as policyengine-uk uprates a dataset's
    Council Tax (``uprate_council_tax``)."""
    from policyengine_uk.data.economic_assumptions import (
        _COUNCIL_TAX_GROWTH_SERIES,
    )
    from policyengine_uk.system import system

    series = _COUNCIL_TAX_GROWTH_SERIES.get(region)
    if series is None:
        return 1.0
    growth = system.parameters.gov.economic_assumptions.yoy_growth.obr
    rates = growth.council_tax.get_child(series)
    factor = 1.0
    for y in range(COUNCIL_TAX_BASE_YEAR + 1, year + 1):
        factor *= 1 + float(rates(f"{y}-01-01"))
    return factor


def _band_ratio(region: str, band: str) -> float:
    """A band's Council Tax as a share of Band D in ``region``'s nation.
    Band I is Welsh only; elsewhere the top band is H."""
    ratios = (
        SCOTTISH_BAND_RATIO
        if region == "SCOTLAND"
        else (COUNCIL_TAX_BAND_RATIO)
    )
    return ratios.get(band if band != "I" or region == "WALES" else "H")


@lru_cache(maxsize=None)
def council_band_d(local_authority: str) -> Optional[float]:
    """A local authority's own Band D Council Tax for 2026-27, £ a year:
    policyengine-uk's ``gov.local_authorities.council_tax.band_d.amounts``,
    the table its ``council_tax_band_d_amount`` reads (the area figure with
    every precept in England and Wales; in Scotland without water and
    waste water). None where policyengine-uk has none: Northern Ireland's
    districts (domestic rates) and English districts abolished in 2023.

    policyengine-uk holds the 2026-27 amounts flat into later years, so
    the estimate grows them with the OBR's Council Tax forecast, as it
    does a region's average (``council_tax_growth``)."""
    from policyengine_uk.system import system

    amounts = system.parameters(
        f"{COUNCIL_TAX_BASE_YEAR}-01-01"
    ).gov.local_authorities.council_tax.band_d.amounts
    amount = amounts._children.get(local_authority)
    return float(amount) if amount else None


def estimated_council_tax(
    region: str,
    band: str,
    year: int,
    local_authority: Optional[str] = None,
) -> float:
    """A household's Council Tax, £ a year, in ``year``: a Band D for
    2026-27 times its band's ratio, grown to ``year``
    (``council_tax_growth``). The Band D is the local authority's own
    (``council_band_d``) when one is given and policyengine-uk has its
    Band D, and otherwise the region's average (``COUNCIL_TAX_BAND_D``).
    Before discounts or Council Tax Reduction (which policyengine-uk works
    out). None in Northern Ireland (domestic rates): 0."""
    band_d = COUNCIL_TAX_BAND_D.get(region)
    if band_d is None:
        return 0.0
    if local_authority is not None:
        band_d = council_band_d(local_authority) or band_d
    ratio = _band_ratio(region, band)
    return round(band_d * ratio * council_tax_growth(region, year), 2)


def council_tax_basis(answers: "HouseholdAnswers") -> str:
    """What an estimated Council Tax starts from: "council" (the local
    authority's own Band D), "region" (the region's average) or "none"
    (Northern Ireland)."""
    if answers.region not in COUNCIL_TAX_BAND_D:
        return "none"
    if answers.local_authority is not None and council_band_d(
        answers.local_authority
    ):
        return "council"
    return "region"


def council_tax_row_note(answers: "HouseholdAnswers") -> str:
    """The Council Tax row's note in the breakdown, from the same basis as
    ``council_tax_used``: entered, the local authority's own Band D, the
    region's average or none (Northern Ireland)."""
    if answers.council_tax is not None:
        return "As entered. No measure changes it."
    return {
        "none": (
            "No Council Tax in Northern Ireland (domestic rates are not "
            "modelled)."
        ),
        "council": (
            "Estimated from the band and the local authority's own Band D, "
            "unless entered. No measure changes it."
        ),
        "region": (
            "Estimated from the band and the region's average Band D "
            "(COUNCIL_TAX_BAND_D), unless entered. No measure changes it."
        ),
    }[council_tax_basis(answers)]


def household_entities(
    answers: HouseholdAnswers, year: Optional[int] = None
) -> tuple[list, dict, dict]:
    """The household as policyengine.py's ``people``, ``benunit`` and
    ``household`` inputs (policyengine-uk variable names, one year's
    values). With ``year``, salaries are grown to it (``salaries_in``);
    without, they are taken as entered.

    The head and any partner are stated to be the benefit unit's claimant
    and partner, and every child not: left to presume it from ages,
    policyengine-uk takes a member under 20 for the claimant's child only
    if at least 16 years younger, so a 19-year-old with a 30-year-old
    parent would be read as the partner.
    """
    if year is None:
        salary = answers.employment_income
        partner_salary = answers.partner_employment_income
    else:
        salary, partner_salary = salaries_in(answers, year)
    pension, partner_pension = state_pensions(
        answers, answers.salary_year if year is None else year
    )
    people = [
        {
            "age": answers.age,
            "employment_income": salary,
            "dividend_income": answers.dividend_income,
            "savings_interest_income": answers.savings_interest_income,
            "property_income": answers.property_income,
            "private_pension_income": answers.private_pension_income,
            "pension_contributions_via_salary_sacrifice": (
                answers.salary_sacrifice_pension_contributions
            ),
            "student_loan_plan": answers.student_loan_plan,
            "is_claimant_or_partner": True,
        }
    ]
    pension_year = answers.salary_year if year is None else year
    if pension is not None:
        people[0]["state_pension_reported"] = reported_state_pension(
            pension, pension_year
        )
    if answers.self_employed:
        # Only with self-employment answers, so every other household is
        # exactly as before: profit, and the receipts the trading allowance
        # election reads
        people[0]["self_employment_income"] = (
            answers.self_employment_receipts - answers.self_employment_expenses
        )
        people[0][
            "self_employment_gross_receipts"
        ] = answers.self_employment_receipts
    if answers.is_carer:
        # Only for a carer, so a non-carer's household is exactly as before
        # (no care_hours: policyengine-uk's default, 0)
        people[0]["care_hours"] = answers.care_hours_per_week
    if answers.has_partner:
        people.append(
            {
                "age": answers.partner_age,
                "employment_income": partner_salary,
                "private_pension_income": (
                    answers.partner_private_pension_income
                ),
                "student_loan_plan": answers.partner_student_loan_plan,
                "is_claimant_or_partner": True,
            }
        )
        if partner_pension is not None:
            people[-1]["state_pension_reported"] = reported_state_pension(
                partner_pension, pension_year
            )
    children = [child_inputs(child) for child in answers.children]
    if children and answers.monthly_childcare:
        # The household's childcare, on its first child, as policyengine-uk
        # reads it for the Universal Credit childcare element and Tax-Free
        # Childcare.
        children[0]["childcare_expenses"] = answers.monthly_childcare * 12
    people += children
    if any("current_education" in person for person in people):
        # Once one person's stage is entered, policyengine-core treats the
        # variable as an input for everyone, and a person left out gets the
        # default (not in education) rather than the formula's stage: a
        # 17-year-old would lose Child Benefit. So everyone else gets the
        # stage the formula would give.
        for person in people:
            person.setdefault(
                "current_education", education_by_age(person["age"])
            )
    benunit = {"would_claim_uc": answers.claims_universal_credit}
    household = {
        "region": answers.region,
        "tenure_type": answers.tenure,
        "rent": answers.monthly_rent * 12 if answers.tenure in RENTING else 0,
        "council_tax": (
            answers.council_tax
            if answers.council_tax is not None
            else estimated_council_tax(
                answers.region,
                answers.council_tax_band,
                answers.salary_year if year is None else year,
                answers.local_authority,
            )
        ),
        "council_tax_band": answers.council_tax_band,
        "petrol_spending": answers.petrol_spending,
        "diesel_spending": answers.diesel_spending,
        "electricity_consumption": answers.electricity_spending,
        "gas_consumption": answers.gas_spending,
    }
    if answers.bus_fare_spending:
        # Only with bus fares, so every other household's inputs (and its
        # run's key) are exactly as before. policyengine-uk moves a
        # household total to bus_fare_spending_reported on loading and
        # gives it back unchanged without journeys
        household["bus_fare_spending"] = answers.bus_fare_spending
    if answers.brma is not None:
        household["brma"] = answers.brma
    household["local_authority"] = (
        answers.local_authority
        if answers.local_authority is not None
        else DEFAULT_LOCAL_AUTHORITY[answers.region]
    )
    return people, benunit, household


def py_reform_dict(changes: Optional[dict]) -> dict:
    """Parameter changes as a policyengine.py reform dict.

    Read as policyengine-uk reads a ``Scenario``'s changes (the dates each
    covers, canonical paths), then keyed by inclusive ``start.stop``
    intervals, which policyengine.py reads back to the same dates. A later
    change for the same dates replaces an earlier one, as in the engine.
    """
    if not changes:
        return {}
    reform: dict = {}
    for assignment in read_parameter_changes(
        canonicalize_parameter_changes(changes),
        calendar_years=parameter_reads_calendar_years(),
    ):
        key = f"{assignment.start}.{assignment.stop}"
        reform.setdefault(assignment.path, {})[key] = assignment.value
    return reform


def modifier_name(modifier) -> str:
    """A module-level modifier as ``module:name``, which a worker process
    resolves (``resolve_modifier``) and a run's key can hold.

    Raises:
        ValueError: for a modifier that isn't a module-level function, which
            no other process could find.
    """
    name = f"{modifier.__module__}:{modifier.__qualname__}"
    if "<" in modifier.__qualname__ or resolve_modifier(name) is not modifier:
        raise ValueError(
            f"{name} is not a module-level function, so a household run "
            "can't apply it"
        )
    return name


def resolve_modifier(name: str):
    """The modifier ``modifier_name`` named."""
    module, _, qualname = name.partition(":")
    target = importlib.import_module(module)
    for part in qualname.split("."):
        target = getattr(target, part)
    return target


def _side(parameter_changes: Optional[dict], modifiers: list) -> dict:
    """One side as a run takes it: the parameter changes as the national
    run's ``Scenario`` reads them, and the modifiers, by name, in the order
    they run."""
    return {
        "parameter_changes": copy.deepcopy(parameter_changes or {}),
        "modifiers": [modifier_name(m) for m in modifiers if m is not None],
    }


@dataclass(frozen=True)
class MeasureSides:
    """The selected measures as runs take them (``_side``): the pre-Budget
    ("before") and Budget ("after") sides of them all, and for each measure
    the before side with that one measure switched to its Budget setting."""

    before: dict
    after: dict
    included: list[str]
    not_modelled: list[dict]
    singles: dict = field(default_factory=dict)


def _single_changes(
    measure: Reform, others: list[Reform], config: DataConfig
) -> dict:
    """The parameter changes of one measure switched on: every other
    measure's pre-Budget side, merged as the combined run merges them,
    with this measure's Budget side.

    Raises:
        CombineConflict: if this measure's Budget side changes a parameter
            another measure's pre-Budget side changes, as
            ``merged_changes`` refuses two members changing one parameter.
    """
    changes: dict = {}
    if others:
        baseline = merged_changes(others, config)["baseline"]
        for path, periods in baseline["parameter_changes"].items():
            changes[path] = dict(periods)
    own = merged_changes([measure], config)["reform"]["parameter_changes"]
    for path, periods in own.items():
        if path in changes:
            raise CombineConflict(
                f"{path} is changed by {measure.id}'s Budget side and "
                "another measure's pre-Budget side; make them one measure"
            )
        changes[path] = dict(periods)
    return changes


def _single_modifiers(
    measure: Reform, members: list[Reform], config: DataConfig
) -> list:
    """The modifiers of one measure switched on, in member order: this
    measure's Budget modifier, and every other member's pre-Budget one, as
    ``merged_changes`` takes them."""
    modifiers = []
    for member in members:
        if member is measure:
            modifiers += merged_changes([member], config)["reform"][
                "modifiers"
            ]
        else:
            modifiers += merged_changes([member], config)["baseline"][
                "modifiers"
            ]
    return modifiers


def measure_sides(
    reform_ids: list[str], config: Optional[DataConfig] = None
) -> MeasureSides:
    """The pre-Budget ("before") and Budget ("after") sides of the selected
    measures, merged as the publication merges a combined run
    (``publication.combine.merged_changes``), and each measure's single.

    Raises:
        ValueError: if no measure is selected, or one isn't a single
            registered measure.
    """
    if not reform_ids:
        raise ValueError("Choose at least one measure.")
    known = set(measure_ids())
    unknown = sorted(set(reform_ids) - known)
    if unknown:
        raise ValueError(
            f"Not a measure the calculation knows: {', '.join(unknown)}"
        )
    config = config or DataConfig()
    measures = member_order(
        [get_reform(id_) for id_ in dict.fromkeys(reform_ids)]
    )
    sides = merged_changes(measures, config)
    before = _side(
        sides["baseline"]["parameter_changes"], sides["baseline"]["modifiers"]
    )
    after = _side(
        sides["reform"]["parameter_changes"], sides["reform"]["modifiers"]
    )
    singles = {}
    for measure in measures:
        others = [other for other in measures if other is not measure]
        singles[measure.id] = (
            after
            if not others
            else _side(
                _single_changes(measure, others, config),
                _single_modifiers(measure, measures, config),
            )
        )
    return MeasureSides(
        before=before,
        after=after,
        included=[measure.id for measure in measures],
        not_modelled=[],
        singles=singles,
    )


def household_situation(
    people: list,
    benunit: dict,
    household: dict,
    year: int,
    axes: Optional[list] = None,
) -> dict:
    """The household as a policyengine-uk situation, checked and built as
    policyengine.py's household calculation builds it (with its axes)."""
    people = [dict(person) for person in people]
    benunit, household = dict(benunit), dict(household)
    year = validate_annual_household_inputs(
        year=year,
        entities={
            "people": people,
            "benunit": [benunit],
            "household": [household],
        },
    )
    validate_household_input(
        model_version=uk_latest,
        entities={
            "person": people,
            "benunit": [benunit],
            "household": [household],
        },
    )
    return _build_situation(
        people=people,
        benunit=benunit,
        household=household,
        year=year,
        axes=normalize_axes(axes=axes, year=year, model_version=uk_latest),
    )


def side_scenario(side: dict):
    """A side as a policyengine-uk ``Scenario``, as ``personal_impact``
    builds one (``create_simulation``, ``effective``): the parameter
    changes, and one modifier running the side's modifiers in order; None
    when the side changes nothing."""
    from policyengine_uk.utils.scenario import Scenario

    from uk_budget_data.personal_impact import effective

    modifiers = [resolve_modifier(name) for name in side["modifiers"]]
    fields: dict = {}
    if side["parameter_changes"]:
        fields["parameter_changes"] = side["parameter_changes"]
    if len(modifiers) == 1:
        fields["simulation_modifier"] = modifiers[0]
    elif modifiers:

        def apply_members(sim):
            for modifier in modifiers:
                modifier(sim)
            return sim

        fields["simulation_modifier"] = apply_members
    return effective(Scenario(**fields)) if fields else None


def _plain(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return str(value) if value is not None else None


def _summed(values, axes_active: bool):
    """A variable's values summed over an entity's members; with axes, one
    sum per sweep point."""
    if not values:
        return [] if axes_active else 0.0
    if axes_active:
        return [float(sum(point)) for point in zip(*values)]
    return float(sum(values))


def run_scenario(
    people: list,
    benunit: dict,
    household: dict,
    year: int,
    side: dict,
    axes: Optional[list] = None,
    net_income_only: bool = False,
    parts: bool = False,
) -> dict:
    """One household simulation of one side (``_side``), reduced to what
    the answer reads: net income, and unless ``net_income_only``, each
    programme row summed over the household, each person's dependant
    status and the household's area. With ``axes``, net income is a list
    over the sweep. The sweep, a full run, and a run asked for ``parts``
    also read ``RATE_PART_VARIABLES`` summed over the household (lists over
    the sweep), to split the marginal rate. Module level and plain data in
    and out, so it can run in a worker process."""
    from policyengine_uk import Simulation

    from uk_budget_data.forecast import with_forecast

    simulation = Simulation(
        situation=household_situation(people, benunit, household, year, axes),
        scenario=with_forecast(side_scenario(side)),
    )

    def rate_part_values():
        return {
            name: [
                float(v)
                for v in simulation.calculate(name, year, map_to="household")
            ]
            for name in RATE_PART_VARIABLES
        }

    net = simulation.calculate("household_net_income", year)
    if axes is not None:
        components = rate_part_values()
        # The levels that split net income into its parts (sweep only)
        components.update(
            {
                name: [
                    float(v)
                    for v in simulation.calculate(
                        name, year, map_to="household"
                    )
                ]
                for name in NET_INCOME_LEVEL_VARIABLES
            }
        )
        return {
            "household_net_income": [float(v) for v in net],
            "components": components,
        }
    out = {"household_net_income": float(net[0])}
    if parts or not net_income_only:
        out["components"] = {
            name: values[0] for name, values in rate_part_values().items()
        }
    if net_income_only:
        return out
    variables = simulation.tax_benefit_system.variables
    entities: dict = {
        "person": [{} for _ in people],
        "benunit": [{}],
        "household": [{}],
    }
    for name in EXTRA_VARIABLES:
        entity = variables[name].entity.key
        values = simulation.calculate(name, year, map_to=entity)
        for member, value in zip(entities[entity], values):
            member[name] = _plain(value)
    out["rows"] = _programme_rows(entities)
    out["dependants"] = [
        {name: bool(person[name]) for name in DEPENDANT_VARIABLES}
        for person in entities["person"]
    ]
    out["brma"] = entities["household"][0]["brma"]
    out["local_authority"] = entities["household"][0]["local_authority"]
    return out


def _programme_rows(entities: dict) -> dict:
    """Each programme row summed over the household; a row with no
    variable as the sum of its children, and each group's "other" row as
    the group's total less its rows."""

    def total(variable):
        for entity in ("household", "benunit", "person"):
            try:
                return _summed(
                    [member[variable] for member in entities[entity]], False
                )
            except (KeyError, AttributeError, TypeError):
                continue
        raise KeyError(variable)

    rows = {}
    for programme in PROGRAMMES:
        for child in programme.children:
            rows[child.id] = _summed(
                [member[child.variable] for member in entities[child.entity]],
                False,
            )
        if programme.difference:
            rows[programme.id] = sum(
                _summed(
                    [member[plus] for member in entities[programme.entity]],
                    False,
                )
                - _summed(
                    [member[minus] for member in entities[programme.entity]],
                    False,
                )
                for plus, minus in programme.difference
            )
        elif programme.variable is None:
            rows[programme.id] = sum(
                rows[child.id] for child in programme.children
            )
        else:
            rows[programme.id] = _summed(
                [
                    member[programme.variable]
                    for member in entities[programme.entity]
                ],
                False,
            )
    for other in OTHER_ROWS:
        listed = sum(
            rows[programme.id]
            for programme in PROGRAMMES
            if programme.group == other.group
        )
        group_total = sum(total(name) for name in GROUP_TOTALS[other.group])
        rows[other.id] = group_total - listed
    return rows


def sweep_axes(employment_income: float) -> tuple[list, list[float]]:
    """The sweep's axes over the head's employment income, and its grid."""
    top = max(SWEEP_MIN_MAX, 2 * employment_income)
    grid = [float(v) for v in np.linspace(0, top, SWEEP_POINTS)]
    axes = [
        {
            "name": "employment_income",
            "min": 0,
            "max": top,
            "count": SWEEP_POINTS,
            "index": 0,
        }
    ]
    return axes, grid


def marginal_rates(grid: list[float], net: list[float]) -> list:
    """The marginal effective tax rate between neighbouring sweep points:
    the share of an extra pound of the head's employment income that does
    not reach household net income."""
    return [
        1 - (net[i + 1] - net[i]) / (grid[i + 1] - grid[i])
        for i in range(len(grid) - 1)
    ]


def rate_parts(step: float, total: float, low: dict, high: dict) -> dict:
    """A marginal rate ``total`` over ``step`` pounds of the head's
    employment income, split into ``MARGINAL_RATE_PARTS`` from the
    ``RATE_PART_VARIABLES`` at the step's two ends (``low`` and ``high``).

    Each part is the change in its variable over the step, per pound: taxes
    as they rise, benefits as they fall. Income tax less the Child Benefit
    charge is split into its rate and the personal allowance taper: with the
    allowance falling by ``t`` per pound, the extra pound and the lost
    allowance are both taxed at the band's rate ``r``, so the tax rises by
    r(1 + t), of which r is the rate and r·t the taper. "other" is the rest
    of ``total``, so the parts add up to it exactly."""

    def rise(name):
        return (high[name] - low[name]) / step

    charge = rise("CB_HITC")
    tax = rise("income_tax") - charge
    taper = max(0.0, -rise("personal_allowance"))
    rate = tax / (1 + taper)
    universal_credit = -rise("universal_credit")
    part = {
        "income_tax": rate,
        "child_benefit_charge": charge,
        "personal_allowance_taper": tax - rate,
        "national_insurance": rise("national_insurance"),
        "student_loan": rise("student_loan_repayments"),
        "universal_credit": universal_credit,
        "other_benefits": -rise("household_benefits") - universal_credit,
    }
    part["other"] = total - sum(part.values())
    return part


def sweep_rate_parts(
    grid: list[float], net: list[float], components: dict
) -> list[dict]:
    """``rate_parts`` on each step of the sweep, adding up to
    ``marginal_rates``."""
    return [
        rate_parts(
            grid[i + 1] - grid[i],
            total,
            {name: values[i] for name, values in components.items()},
            {name: values[i + 1] for name, values in components.items()},
        )
        for i, total in enumerate(marginal_rates(grid, net))
    ]


def net_income_parts(employment_income: float, net: float, levels: dict):
    """Net income at one sweep point split into ``NET_INCOME_PARTS``, in £
    with taxes negative, from the variables read there (``levels``), or
    None when a run did not read them (one kept from before they were
    added). Rounded to the penny, with "other_taxes" taking the rest, so
    the parts add up to net income as the answer reports it."""
    needed = (*RATE_PART_VARIABLES, *NET_INCOME_LEVEL_VARIABLES)
    if any(name not in levels for name in needed):
        return None
    charge = levels["CB_HITC"]
    taxes = (
        levels["income_tax"]
        + levels["national_insurance"]
        + levels["student_loan_repayments"]
        + levels["council_tax"]
        + levels["fuel_duty"]
        + levels["vat_change"]
    )
    named_benefits = (
        levels["universal_credit"]
        + levels["child_benefit"]
        + levels["state_pension"]
        + levels["cost_of_living_support_payment"]
    )
    part = {
        "employment_income": employment_income,
        "other_income": levels["household_market_income"] - employment_income,
        "universal_credit": levels["universal_credit"],
        "child_benefit": levels["child_benefit"],
        "state_pension": levels["state_pension"],
        "warm_home_discount": levels["cost_of_living_support_payment"],
        "other_benefits": levels["household_benefits"] - named_benefits,
        "income_tax": -(levels["income_tax"] - charge),
        "national_insurance": -levels["national_insurance"],
        "student_loan": -levels["student_loan_repayments"],
        "council_tax": -levels["council_tax"],
        "fuel_duty": -levels["fuel_duty"],
        "vat_change": -levels["vat_change"],
        "child_benefit_charge": -charge,
        "pension_contributions": -levels["pension_contributions"],
        "other_taxes": -(levels["household_tax"] - taxes),
    }
    # (+ 0.0: no "-0.0" in the answer)
    out = {k: _money(v) + 0.0 for k, v in part.items() if k != "other_taxes"}
    out["other_taxes"] = _money(_money(net) - sum(out.values())) + 0.0
    return out


def sweep_net_income_parts(
    grid: list[float], net: list[float], components: dict
) -> Optional[list]:
    """``net_income_parts`` at each sweep point, or None when the run did
    not read the variables they need."""
    steps = [
        net_income_parts(
            x, n, {name: values[i] for name, values in components.items()}
        )
        for i, (x, n) in enumerate(zip(grid, net))
    ]
    return None if any(step is None for step in steps) else steps


def _rounded_parts(parts: dict, total: float) -> dict:
    """The parts to four places, with "other" taking the rounding, so they
    add up to the rounded total the answer reports."""
    # (+ 0.0: no "-0.0" in the answer)
    out = {k: round(v, 4) + 0.0 for k, v in parts.items() if k != "other"}
    out["other"] = round(round(total, 4) - sum(out.values()), 4)
    return out


def with_pay_rise(people: list, step: float) -> list:
    """The household's people with the head earning ``step`` more."""
    people = [dict(person) for person in people]
    people[0]["employment_income"] = people[0]["employment_income"] + step
    return people


def own_rate(net: float, net_higher: float, step: float) -> float:
    """The marginal effective tax rate at the head's own income: the share
    of the next ``step`` pounds that does not reach household net income."""
    return 1 - (net_higher - net) / step


# Runs already done, by their inputs: the breakdown stage asks again for the
# headline stage's two runs (before and after), which are then reused. Plain
# data in and out, so a run's inputs are its key.
_RUNS: "OrderedDict[str, dict]" = OrderedDict()
_RUNS_LOCK = threading.Lock()
RUNS_KEPT = 256


def clear_runs() -> None:
    """Forget the runs kept (for tests that stand in for the engine)."""
    with _RUNS_LOCK:
        _RUNS.clear()
        _IN_FLIGHT.clear()


def _run_key(job: tuple) -> str:
    return json.dumps(job, sort_keys=True, default=str)


# Runs being computed now, by key: a request that needs a run another
# request has already started waits for that answer rather than starting
# the same run again (the page asks for its three parts at once, and each
# part's jobs include the before and after runs).
_IN_FLIGHT: "dict[str, Future]" = {}


def _compute(jobs: list, todo: list, workers: int) -> list:
    """The runs ``todo`` (indices into ``jobs``), by the instance's runner."""
    # With workers, even one run goes to a worker: requests run at once, and
    # two runs in this process at the same time would share its engine.
    if os.environ.get("HOUSEHOLD_RUNNER") == "modal":
        # On Modal (modal_household.py): every run in its own container at
        # once, each with the engine already loaded.
        from uk_budget_data.modal_household import fan_out

        return fan_out([jobs[i] for i in todo])
    if workers > 1:
        from uk_budget_data.personal_impact import (
            CALCULATION_TIMEOUT_SECONDS,
            household_slots,
            run_in_workers,
        )

        return run_in_workers(
            workers,
            [(run_scenario, jobs[i]) for i in todo],
            CALCULATION_TIMEOUT_SECONDS,
            slots=household_slots(),
        )
    return [run_scenario(*jobs[i]) for i in todo]


def _run_all(jobs: list, workers: int) -> list:
    """Every calculation, in worker processes when there are several
    workers (``personal_impact.run_in_workers``, taking the instance's
    shared slots, so concurrent requests share the processes fairly), else
    here, in turn. A run already done for the same inputs is reused, and
    one another request is computing now is waited for, not run twice."""
    keys = [_run_key(job) for job in jobs]
    results: list = [None] * len(jobs)
    owned: dict = {}
    waiting: dict = {}
    with _RUNS_LOCK:
        for i, key in enumerate(keys):
            if key in _RUNS:
                _RUNS.move_to_end(key)
                results[i] = copy.deepcopy(_RUNS[key])
            elif key in owned:
                waiting[i] = owned[key]
            elif key in _IN_FLIGHT:
                waiting[i] = _IN_FLIGHT[key]
            else:
                owned[key] = _IN_FLIGHT[key] = Future()
    todo = [
        i
        for i, key in enumerate(keys)
        if results[i] is None and i not in waiting
    ]
    try:
        done = _compute(jobs, todo, workers) if todo else []
    except BaseException as error:
        with _RUNS_LOCK:
            for key, future in owned.items():
                _IN_FLIGHT.pop(key, None)
                future.set_exception(error)
        raise
    with _RUNS_LOCK:
        for i, result in zip(todo, done):
            results[i] = result
            _RUNS[keys[i]] = copy.deepcopy(result)
            _RUNS.move_to_end(keys[i])
            _IN_FLIGHT.pop(keys[i], None)
            owned[keys[i]].set_result(result)
        while len(_RUNS) > RUNS_KEPT:
            _RUNS.popitem(last=False)
    for i, future in waiting.items():
        results[i] = copy.deepcopy(future.result())
    return results


def _money(value: float) -> float:
    return round(float(value), 2)


def fiscal_year(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


# What a request can ask for beyond the headline and the programmes
PARTS = ("by_policy", "sweep")


def _programme_entry(
    row: Programme, before: dict, after: dict, hidden: frozenset = frozenset()
) -> dict:
    base, reform = before["rows"][row.id], after["rows"][row.id]
    entry = {
        "id": row.id,
        "label": row.label,
        "baseline": _money(base),
        "reform": _money(reform),
        "change": _money(reform - base),
    }
    if row.group:
        entry["group"] = row.group
    if row.note:
        entry["note"] = row.note
    if row.children:
        entry["children"] = [
            _programme_entry(child, before, after)
            for child in row.children
            if child.id not in hidden
        ]
    return entry


# The first year the Carer's Allowance taper applies: its modifier's own
# default, as the registered measure runs it
CARERS_ALLOWANCE_TAPER_START = (
    inspect.signature(carers_allowance_earnings_taper)
    .parameters["start_year"]
    .default
)

# The fiscal years the £2 bus fare cap credits anything in: its modifier's
# own capped shares (``capped_2026``, ``capped_2027``), read from its
# signature as the registered measure runs it
BUS_FARE_CAP_YEARS = frozenset(
    int(name.removeprefix("capped_"))
    for name, parameter in inspect.signature(
        bus_fare_cap_2027
    ).parameters.items()
    if name.startswith("capped_") and parameter.default
)
# Where the cap credits anything: England (policyengine-uk's ``country``,
# from the region) outside London, as the modifier reads it. The region is
# the calculator's answer, set from the council picked.
BUS_FARE_CAP_REGIONS = frozenset(REGIONS) - {
    "LONDON",
    "WALES",
    "SCOTLAND",
    "NORTHERN_IRELAND",
}

# Measures that cannot move this household's net income in this year,
# from the household's answers alone, so the split by policy need not run
# them: each shows as "not affected", exactly as its run would. Every rule is
# checked against the full run in tests/test_household_skips.py, over many
# households and every policy year.
SKIP_REASONS = {
    "employer_ni_relief_under_25s": "an employer cost; wages are held fixed",
    "warm_home_discount_top_up": "paid in 2026-27 only",
    "threshold_freeze_2031_32": "changes nothing before 2031-32",
    "plan_2_threshold_unfreeze": "no Plan 2 student loan",
    "state_pension_income_tax_protection": "no one at State Pension age",
    "badr_lifetime_limit_cut": "no capital gains",
    "fuel_duty_rise_deferral": "no petrol or diesel spending",
    "road_fuel_vat_cut": "no petrol or diesel spending, or after 2027-28",
    "domestic_electricity_zero_vat": "no electricity spending, or after 2027-28",
    "carers_allowance_earnings_taper": "not a carer, or before 2030-31",
    "lha_unfreeze_2027": "not renting privately, or before 2027-28",
    "employer_nics_secondary_threshold_raise": (
        "no employment income, or before 2027-28"
    ),
    "unearned_income_rates_up": (
        "no dividend, savings or property income, or before 2027-28"
    ),
    "property_income_rates_up": "no property income, or before 2027-28",
    "savings_income_rates_up": "no savings interest, or before 2027-28",
    "trading_allowance_raise": (
        "no self-employment receipts, or before 2027-28"
    ),
    "bus_fare_cap_2027": (
        "no bus fares, not in England outside London, or outside 2026-27 "
        "to 2027-28"
    ),
}


def provably_unaffected(
    measure_id: str, answers: HouseholdAnswers, year: int
) -> bool:
    """Whether ``measure_id`` cannot change this household's net income in
    ``year``. False whenever it might (and for any measure without a rule)."""
    adults = [(answers.age, answers.student_loan_plan)]
    if answers.has_partner:
        adults.append((answers.partner_age, answers.partner_student_loan_plan))
    no_fuel = not answers.petrol_spending and not answers.diesel_spending
    if measure_id == "employer_ni_relief_under_25s":
        return True
    if measure_id == "warm_home_discount_top_up":
        return year != 2026
    if measure_id == "threshold_freeze_2031_32":
        return year < 2031
    if measure_id == "plan_2_threshold_unfreeze":
        return all(plan != "PLAN_2" for _, plan in adults)
    if measure_id == "state_pension_income_tax_protection":
        return all(age < state_pension_age(year) for age, _ in adults)
    if measure_id == "badr_lifetime_limit_cut":
        # The household's answers carry no capital gains.
        return True
    if measure_id == "fuel_duty_rise_deferral":
        return no_fuel
    if measure_id == "road_fuel_vat_cut":
        return no_fuel or year >= 2028
    if measure_id == "domestic_electricity_zero_vat":
        return not answers.electricity_spending or year >= 2028
    if measure_id == "carers_allowance_earnings_taper":
        # Only the head can be a carer (care_hours); no one reports a
        # Carer's Allowance, so with no carer no one meets its conditions,
        # under current law or the taper. Before its start year it is
        # current law.
        return not answers.is_carer or year < CARERS_ALLOWANCE_TAPER_START
    if measure_id == "lha_unfreeze_2027":
        # Local Housing Allowance caps private rents only.
        return year < 2027 or answers.tenure != "RENT_PRIVATELY"
    if measure_id == "employer_nics_secondary_threshold_raise":
        earnings = answers.employment_income + (
            answers.partner_employment_income if answers.has_partner else 0
        )
        return year < 2027 or not earnings
    if measure_id == "unearned_income_rates_up":
        # Only the head's dividend, savings and property income is asked.
        unearned = (
            answers.dividend_income
            + answers.savings_interest_income
            + answers.property_income
        )
        return year < 2027 or not unearned
    if measure_id == "property_income_rates_up":
        # Only the head's property income is asked; the answers carry no
        # finance costs, the other thing the property basic rate reaches.
        return year < 2027 or not answers.property_income
    if measure_id == "savings_income_rates_up":
        return year < 2027 or not answers.savings_interest_income
    if measure_id == "trading_allowance_raise":
        # The allowance reads trading receipts (and profit), which only
        # the head's self-employment answers give.
        return year < TRADING_ALLOWANCE_FROM or not answers.self_employed
    if measure_id == "bus_fare_cap_2027":
        # The credit is a share of bus_fare_spending, in England outside
        # London, in the years the cap runs.
        return (
            not answers.bus_fare_spending
            or answers.region not in BUS_FARE_CAP_REGIONS
            or year not in BUS_FARE_CAP_YEARS
        )
    return False


def calculate_household_impact(
    answers: HouseholdAnswers,
    reform_ids: list[str],
    year: int,
    include: tuple = PARTS,
    workers: int = 1,
    skip_unaffected: bool = True,
) -> dict:
    """The household's net income in ``year`` before and after the
    selected measures, and the programmes; with "by_policy" in
    ``include``, each measure's own effect and the interaction residual;
    with "sweep", the earnings sweep.

    Raises:
        ValueError: for a year outside the Budget's policy years, a
            salary year after it, or measures ``measure_sides`` refuses.
    """
    if year not in POLICY_YEARS:
        raise ValueError(f"{year} is not one of the Budget's policy years.")
    if answers.salary_year > year:
        raise ValueError(
            f"The salary year {answers.salary_year} is after {year}."
        )
    unknown = sorted(set(include) - set(PARTS))
    if unknown:
        raise ValueError(f"Not a part of the answer: {', '.join(unknown)}")
    sides = measure_sides(reform_ids)
    people, benunit, household = household_entities(answers, year)
    salary, partner_salary = salaries_in(answers, year)
    pension, partner_pension = state_pensions(answers, year)

    def job(
        reform, axes=None, net_income_only=False, members=None, parts=False
    ):
        return (
            members or people,
            benunit,
            household,
            year,
            reform,
            axes,
            net_income_only,
        ) + ((True,) if parts else ())

    jobs = [job(sides.before), job(sides.after)]
    by_policy = "by_policy" in include
    many = len(sides.included) > 1
    # The measures whose own run is needed (provably_unaffected: the rest
    # are exactly £0 for this household and year, so they are not run).
    to_run = [
        id_
        for id_ in sides.included
        if not (skip_unaffected and provably_unaffected(id_, answers, year))
    ]
    if by_policy and many:
        jobs += [
            job(sides.singles[id_], net_income_only=True) for id_ in to_run
        ]
    sweep = "sweep" in include
    if sweep:
        axes, grid = sweep_axes(salary)
        raised = with_pay_rise(people, OWN_RATE_STEP)
        jobs += [
            job(sides.before, axes, True),
            job(sides.after, axes, True),
            job(
                sides.before, net_income_only=True, members=raised, parts=True
            ),
            job(sides.after, net_income_only=True, members=raised, parts=True),
        ]
    outputs = _run_all(jobs, workers)
    before, after = outputs[0], outputs[1]
    base_net = before["household_net_income"]
    reform_net = after["household_net_income"]
    combined = reform_net - base_net

    identity = runtime_identity()
    hidden = (frozenset() if answers.is_carer else CARER_ROWS) | (
        frozenset() if answers.self_employed else TRADING_ROWS
    )
    result = {
        "year": year,
        "fiscal_year": fiscal_year(year),
        "salary_used": {
            "salary_year": answers.salary_year,
            "employment_income": _money(salary),
            "partner_employment_income": (
                _money(partner_salary) if answers.has_partner else None
            ),
            "growth": round(earnings_growth(answers.salary_year, year), 6),
            "note": (
                f"Salary as entered for {answers.salary_year}, grown to "
                f"{fiscal_year(year)} with the OBR average earnings index."
            ),
        },
        "council_tax_used": {
            "band": answers.council_tax_band,
            "council_tax": _money(household["council_tax"]),
            "source": (
                "entered" if answers.council_tax is not None else "estimated"
            ),
            "note": (
                "As entered."
                if answers.council_tax is not None
                else {
                    "none": (
                        "No Council Tax in Northern Ireland (domestic rates "
                        "are not modelled)."
                    ),
                    "council": (
                        f"Band {answers.council_tax_band} at the local "
                        "authority's own Band D for 2026-27 "
                        "(policyengine-uk), grown to "
                        f"{fiscal_year(year)} with the OBR's Council Tax "
                        "forecast."
                    ),
                    "region": (
                        f"Band {answers.council_tax_band} at the region's "
                        "average Band D for 2026-27, grown to "
                        f"{fiscal_year(year)} with the OBR's Council Tax "
                        "forecast."
                    ),
                }[council_tax_basis(answers)]
            ),
        },
        "state_pension_used": {
            "state_pension_age": state_pension_age(year),
            "full_new_state_pension": _money(full_new_state_pension(year)),
            "state_pension": None if pension is None else _money(pension),
            "partner_state_pension": (
                None if partner_pension is None else _money(partner_pension)
            ),
            "note": (
                "At State Pension age, the State Pension as entered, or "
                f"else the full new State Pension for {fiscal_year(year)}."
            ),
        },
        "net_income": {
            "baseline": _money(base_net),
            "reform": _money(reform_net),
            "change": _money(combined),
        },
        "included": sides.included,
        "not_modelled": sides.not_modelled,
        "by_policy": None,
        "programmes": [
            {
                **_programme_entry(row, before, after, hidden),
                # The note says what this household's Council Tax starts
                # from, as council_tax_used does
                **(
                    {"note": council_tax_row_note(answers)}
                    if row.id == "council_tax"
                    else {}
                ),
            }
            for row in (*PROGRAMMES, *OTHER_ROWS)
            if row.id not in hidden
        ],
        "not_in_breakdown": list(NOT_IN_BREAKDOWN),
        "dependants": _dependants(answers, before),
        "dependants_note": DEPENDANTS_NOTE,
        "area": {
            "region": answers.region,
            "brma": before["brma"],
            "brma_source": (
                "entered" if answers.brma is not None else "region default"
            ),
            "local_authority": before["local_authority"],
            "local_authority_source": (
                "entered"
                if answers.local_authority is not None
                else "region default"
            ),
        },
        "sweep": None,
        "engine": identity["packages"],
        # The build's commit: the page uses a breakdown from a second
        # deployment (the Modal detail service) only when it reports the
        # same commit as the headline
        "git_sha": identity["git_sha"],
    }
    if by_policy:
        if many:
            ran = dict(zip(to_run, outputs[2 : 2 + len(to_run)]))
            unaffected = {"household_net_income": base_net}
            singles = [ran.get(id_, unaffected) for id_ in sides.included]
        else:
            singles = [after] if sides.included else []
        result["by_policy"] = _by_policy(
            sides.included, singles, base_net, combined
        )
    if sweep:
        result["sweep"] = _sweep(
            grid,
            outputs[-4]["household_net_income"],
            outputs[-3]["household_net_income"],
            salary,
            base_net,
            reform_net,
            (
                own_rate(
                    base_net,
                    outputs[-2]["household_net_income"],
                    OWN_RATE_STEP,
                ),
                own_rate(
                    reform_net,
                    outputs[-1]["household_net_income"],
                    OWN_RATE_STEP,
                ),
            ),
            components=(
                outputs[-4].get("components"),
                outputs[-3].get("components"),
                before.get("components"),
                after.get("components"),
                outputs[-2].get("components"),
                outputs[-1].get("components"),
            ),
        )
    return result


def _dependants(answers: HouseholdAnswers, before: dict) -> list:
    first_child = 1 + int(answers.has_partner)
    return [
        {
            "age": child.age,
            "in_education": child.in_education,
            "claimant_or_partner": status["is_claimant_or_partner"],
            "counts_for_child_benefit": status[DEPENDANT_VARIABLES[1]],
            "counts_for_universal_credit": status[DEPENDANT_VARIABLES[2]],
        }
        for child, status in zip(
            answers.children, before["dependants"][first_child:]
        )
    ]


def _by_policy(
    included: list[str], singles: list, base_net: float, combined: float
) -> dict:
    measures = []
    total = 0.0
    for id_, single in zip(included, singles):
        change = single["household_net_income"] - base_net
        total += change
        measures.append(
            {
                "id": id_,
                "name": get_reform(id_).name,
                "change": _money(change),
                # Exactly zero, unrounded: a measure that moves the
                # household by a penny is affecting it.
                "status": "not_affected" if change == 0 else "affected",
            }
        )
        if id_ in HOUSEHOLD_NOTES:
            measures[-1]["note"] = HOUSEHOLD_NOTES[id_]["text"]
            measures[-1]["note_kind"] = HOUSEHOLD_NOTES[id_]["kind"]
    return {
        "measures": measures,
        "combined": _money(combined),
        "sum_of_singles": _money(total),
        "residual": _money(combined - total),
        "method": INTERACTION_METHOD,
    }


def _sweep(
    grid,
    base_line,
    reform_line,
    salary,
    base_net,
    reform_net,
    own_rates,
    components=(None,) * 6,
):
    base_rates = marginal_rates(grid, base_line)
    reform_rates = marginal_rates(grid, reform_line)
    sweep = {
        "variable": "employment_income",
        "person": "head",
        "points": [
            {
                "employment_income": _money(x),
                "baseline": _money(b),
                "reform": _money(r),
                "change": _money(r - b),
            }
            for x, b, r in zip(grid, base_line, reform_line)
        ],
        "marginal_rates": [
            {
                "from": _money(grid[i]),
                "to": _money(grid[i + 1]),
                "baseline": round(base_rates[i], 4),
                "reform": round(reform_rates[i], 4),
            }
            for i in range(len(grid) - 1)
        ],
        "own_point": {
            "employment_income": _money(salary),
            "baseline": _money(base_net),
            "reform": _money(reform_net),
            "baseline_marginal_rate": round(own_rates[0], 4),
            "reform_marginal_rate": round(own_rates[1], 4),
        },
        "note": (
            "Only the head's employment income varies; everything else is "
            "held as entered. A marginal rate is over the interval between "
            "two neighbouring points: one minus the change in household net "
            "income over the change in the head's employment income. The "
            f"rate at the head's own income is over the next £{OWN_RATE_STEP} "
            "they earn. net_income_parts splits net income at each point "
            "into its parts, in pounds with taxes negative, adding up to it."
        ),
    }
    # Net income's parts at each point, when both sweep runs read them
    base_sweep, reform_sweep = components[0], components[1]
    if base_sweep and reform_sweep:
        base_parts = sweep_net_income_parts(grid, base_line, base_sweep)
        reform_parts = sweep_net_income_parts(grid, reform_line, reform_sweep)
        if base_parts and reform_parts:
            sweep["net_income_parts"] = {
                "parts": list(NET_INCOME_PARTS),
                "baseline": base_parts,
                "reform": reform_parts,
            }
    # The rates' parts, when every run read them (a run kept from before they
    # were added, or a stand-in engine, has none: the page then draws the
    # totals alone)
    if all(components):
        base_sweep, reform_sweep, base_own, reform_own, base_up, reform_up = (
            components
        )
        sweep["marginal_rate_parts"] = {
            "parts": list(MARGINAL_RATE_PARTS),
            "baseline": [
                _rounded_parts(p, r)
                for p, r in zip(
                    sweep_rate_parts(grid, base_line, base_sweep), base_rates
                )
            ],
            "reform": [
                _rounded_parts(p, r)
                for p, r in zip(
                    sweep_rate_parts(grid, reform_line, reform_sweep),
                    reform_rates,
                )
            ],
            "own_point": {
                "baseline": _rounded_parts(
                    rate_parts(OWN_RATE_STEP, own_rates[0], base_own, base_up),
                    own_rates[0],
                ),
                "reform": _rounded_parts(
                    rate_parts(
                        OWN_RATE_STEP, own_rates[1], reform_own, reform_up
                    ),
                    own_rates[1],
                ),
            },
        }
    return sweep
