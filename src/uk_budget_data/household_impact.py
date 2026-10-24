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

Every figure comes from policyengine.py's household calculation
(``pe.uk.calculate_household``), on the policyengine-uk version the release
bundle pins, with no dataset. The sweep is one call per side, using the
calculation's ``axes``.

policyengine.py takes a measure as parameter changes keyed by dates. Each
measure's changes are read as the national run reads them
(policyengine-uk's ``read_parameter_changes``: a bare year is the fiscal
year from 6 April, or the calendar year on a calendar-year series) and
written as inclusive ``start.stop`` intervals, so the household sees the
national run's changes on the national run's dates. The measures and their
merge are the population pipeline's own (``reforms`` and
``publication.combine.merged_changes``).

A measure that needs a simulation modifier can't be written as parameter
changes. It is reported as not modelled, never left out silently, unless
its modifier only touches dataset values (``HOUSEHOLD_INERT_MODIFIERS``),
which a household calculation has none of.
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import policyengine as pe
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

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    CombineConflict,
    member_order,
    merged_changes,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    _connect_student_loan_variables,
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

# The age from which a child's education decides whether they are a
# dependant (policyengine-uk's Child Benefit and Universal Credit child age
# Where a household with no local authority given is placed: a local
# authority inside its region's default BRMA, so the area the answer shows
# is one place. policyengine-uk's own default is Maidstone whatever the
# region (``local_authority`` has no formula), and it has no "none". The
# model reads the local authority only to choose the working-age Council
# Tax Reduction schemes it simulates (Kingston upon Thames, Merton, Newham,
# Oxford and Westminster), and none of these is one of them, so the
# default changes no result.
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

# limit: under 16 is a child whatever their education), and the oldest age
# the form takes (policyengine-uk's qualifying young person age limit is
# under 20).
YOUNG_PERSON_AGE = 16
OLDEST_CHILD_AGE = 19
# The age a young person in non-advanced education is taken to have
# started it: the rules count a 19-year-old only if they started before 19.
EDUCATION_START_AGE = 16

# Modifiers that only replace values a dataset supplies. A household
# calculation has no dataset, so they change nothing there, and the
# measure's parameter changes are the whole measure.
HOUSEHOLD_INERT_MODIFIERS = frozenset({_connect_student_loan_variables})

NOT_MODELLED_REASON = (
    "This measure changes the simulation in code, which policyengine.py's "
    "household calculation can't apply."
)
NOT_MODELLED_REASONS = {
    "rail_fares_freeze": (
        "This measure spreads a national cost over households by how much "
        "they use rail, which one household's answers can't show. It is in "
        "the national figures only."
    ),
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
            "As entered, not modelled: policyengine-uk takes Council Tax as "
            "an input (the band does not set it), so no measure changes it."
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
        "universal_credit",
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
        ),
        note="Elements are before the earnings taper and any benefit cap.",
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
        "housing_benefit",
        "benunit",
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
                "Salary sacrifice cap: broad-base pay cut",
                "salary_sacrifice_broad_base_haircut",
                "person",
            ),
        ),
        note=(
            "policyengine-uk assumes employers recover the salary sacrifice "
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


NOT_IN_BREAKDOWN = (
    {
        "id": "rail_fares_freeze",
        "note": NOT_MODELLED_REASONS["rail_fares_freeze"],
    },
)

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


def measure_ids() -> list[str]:
    """The measures the household calculation accepts: every registered
    single measure (the combined measure is the sum of these)."""
    return [
        reform.id
        for reform in get_autumn_budget_2026_reforms()
        if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID
    ]


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
    council_tax: float = 0
    council_tax_band: str = "D"
    monthly_childcare: float = 0
    salary_year: int = SALARY_YEAR
    dividend_income: float = 0
    savings_interest_income: float = 0
    property_income: float = 0
    petrol_spending: float = 0
    diesel_spending: float = 0
    salary_sacrifice_pension_contributions: float = 0


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
    people = [
        {
            "age": answers.age,
            "employment_income": salary,
            "dividend_income": answers.dividend_income,
            "savings_interest_income": answers.savings_interest_income,
            "property_income": answers.property_income,
            "pension_contributions_via_salary_sacrifice": (
                answers.salary_sacrifice_pension_contributions
            ),
            "student_loan_plan": answers.student_loan_plan,
            "is_claimant_or_partner": True,
        }
    ]
    if answers.has_partner:
        people.append(
            {
                "age": answers.partner_age,
                "employment_income": partner_salary,
                "student_loan_plan": answers.partner_student_loan_plan,
                "is_claimant_or_partner": True,
            }
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
        "council_tax": answers.council_tax,
        "council_tax_band": answers.council_tax_band,
        "petrol_spending": answers.petrol_spending,
        "diesel_spending": answers.diesel_spending,
    }
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


def household_modelled(measure: Reform) -> bool:
    """Whether a household calculation can apply the whole measure: it has
    no modifier, or only ones that touch dataset values alone."""
    return all(
        modifier is None or modifier in HOUSEHOLD_INERT_MODIFIERS
        for modifier in (
            measure.baseline_simulation_modifier,
            measure.simulation_modifier,
        )
    )


@dataclass(frozen=True)
class MeasureSides:
    """The selected measures as policyengine.py reform dicts: the
    pre-Budget ("before") and Budget ("after") sides of them all, and for
    each measure the before side with that one measure switched to its
    Budget setting."""

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
    included, not_modelled = [], []
    for measure in measures:
        if household_modelled(measure):
            included.append(measure)
        else:
            not_modelled.append(
                {
                    "id": measure.id,
                    "name": measure.name,
                    "reason": NOT_MODELLED_REASONS.get(
                        measure.id, NOT_MODELLED_REASON
                    ),
                }
            )
    if not included:
        return MeasureSides({}, {}, [], not_modelled)
    sides = merged_changes(included, config)
    before = py_reform_dict(sides["baseline"]["parameter_changes"])
    after = py_reform_dict(sides["reform"]["parameter_changes"])
    singles = {}
    for measure in included:
        others = [other for other in included if other is not measure]
        singles[measure.id] = (
            after
            if not others
            else py_reform_dict(_single_changes(measure, others, config))
        )
    return MeasureSides(
        before=before,
        after=after,
        included=[measure.id for measure in included],
        not_modelled=not_modelled,
        singles=singles,
    )


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
    reform: dict,
    axes: Optional[list] = None,
    net_income_only: bool = False,
) -> dict:
    """One policyengine.py household calculation, reduced to what the
    answer reads: net income, and unless ``net_income_only``, each
    programme row summed over the household, each person's dependant
    status and the household's area. With ``axes``, net income is a list
    over the sweep. Module level and plain data in and out, so it can run
    in a worker process."""
    result = pe.uk.calculate_household(
        people=people,
        benunit=benunit,
        household=household,
        year=year,
        reform=reform or None,
        extra_variables=None if net_income_only else EXTRA_VARIABLES,
        axes=axes,
    )
    net = result.household.household_net_income
    if axes is not None:
        return {"household_net_income": [float(v) for v in net]}
    out = {"household_net_income": float(net)}
    if net_income_only:
        return out
    entities = {
        "person": result.person,
        "benunit": [result.benunit],
        "household": [result.household],
    }
    out["rows"] = _programme_rows(entities)
    out["dependants"] = [
        {name: bool(person[name]) for name in DEPENDANT_VARIABLES}
        for person in result.person
    ]
    out["brma"] = result.household.brma
    out["local_authority"] = result.household.local_authority
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
        if programme.variable is None:
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


def _own_rate(grid: list[float], rates: list[float], income: float):
    """The rate over the sweep interval holding the head's own income."""
    for i in range(len(grid) - 1):
        if grid[i] <= income < grid[i + 1]:
            return rates[i]
    return rates[-1]


def _run_all(jobs: list, workers: int) -> list:
    """Every calculation, in worker processes when there are several
    workers (``personal_impact.run_in_workers``), else here, in turn."""
    if workers > 1 and len(jobs) > 1:
        from uk_budget_data.personal_impact import (
            CALCULATION_TIMEOUT_SECONDS,
            run_in_workers,
        )

        return run_in_workers(
            workers,
            [(run_scenario, job) for job in jobs],
            CALCULATION_TIMEOUT_SECONDS,
        )
    return [run_scenario(*job) for job in jobs]


def _money(value: float) -> float:
    return round(float(value), 2)


def fiscal_year(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


# What a request can ask for beyond the headline and the programmes
PARTS = ("by_policy", "sweep")


def _programme_entry(row: Programme, before: dict, after: dict) -> dict:
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
            _programme_entry(child, before, after) for child in row.children
        ]
    return entry


def calculate_household_impact(
    answers: HouseholdAnswers,
    reform_ids: list[str],
    year: int,
    include: tuple = PARTS,
    workers: int = 1,
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

    def job(reform, axes=None, net_income_only=False):
        return (
            people,
            benunit,
            household,
            year,
            reform,
            axes,
            net_income_only,
        )

    jobs = [job(sides.before), job(sides.after)]
    by_policy = "by_policy" in include
    many = len(sides.included) > 1
    if by_policy and many:
        jobs += [
            job(sides.singles[id_], net_income_only=True)
            for id_ in sides.included
        ]
    sweep = "sweep" in include
    if sweep:
        axes, grid = sweep_axes(salary)
        jobs += [
            job(sides.before, axes, True),
            job(sides.after, axes, True),
        ]
    outputs = _run_all(jobs, workers)
    before, after = outputs[0], outputs[1]
    base_net = before["household_net_income"]
    reform_net = after["household_net_income"]
    combined = reform_net - base_net

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
        "net_income": {
            "baseline": _money(base_net),
            "reform": _money(reform_net),
            "change": _money(combined),
        },
        "included": sides.included,
        "not_modelled": sides.not_modelled,
        "by_policy": None,
        "programmes": [
            _programme_entry(row, before, after)
            for row in (*PROGRAMMES, *OTHER_ROWS)
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
        "engine": runtime_identity()["packages"],
    }
    if by_policy:
        singles = (
            outputs[2 : 2 + len(sides.included)]
            if many
            else ([after] if sides.included else [])
        )
        result["by_policy"] = _by_policy(
            sides.included, singles, base_net, combined
        )
    if sweep:
        result["sweep"] = _sweep(
            grid,
            outputs[-2]["household_net_income"],
            outputs[-1]["household_net_income"],
            salary,
            base_net,
            reform_net,
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
    return {
        "measures": measures,
        "combined": _money(combined),
        "sum_of_singles": _money(total),
        "residual": _money(combined - total),
        "method": INTERACTION_METHOD,
    }


def _sweep(grid, base_line, reform_line, salary, base_net, reform_net):
    base_rates = marginal_rates(grid, base_line)
    reform_rates = marginal_rates(grid, reform_line)
    return {
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
            "baseline_marginal_rate": round(
                _own_rate(grid, base_rates, salary), 4
            ),
            "reform_marginal_rate": round(
                _own_rate(grid, reform_rates, salary), 4
            ),
        },
        "note": (
            "Only the head's employment income varies; everything else is "
            "held as entered. A marginal rate is over the interval between "
            "two neighbouring points: one minus the change in household net "
            "income over the change in the head's employment income."
        ),
    }
