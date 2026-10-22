"""One household's net income before and after the Budget, through
policyengine.py.

The Personal impact view asks a few questions about a household and shows
its net income in one year under pre-Budget law and under the Budget, for
the selected measures. Both figures come from policyengine.py's household
calculation (``pe.uk.calculate_household``), which runs the policyengine-uk
version the release bundle pins.

policyengine.py takes a measure as parameter changes keyed by dates. Each
measure's changes are read as the national run reads them
(policyengine-uk's ``read_parameter_changes``: a bare year is the fiscal
year from 6 April, or the calendar year on a calendar-year series) and
written as inclusive ``start.stop`` intervals, so the household sees the
national run's changes on the national run's dates. A measure that needs a
simulation modifier can't be written that way, and is reported as not
modelled rather than left out silently.
"""

from dataclasses import dataclass, field
from typing import Optional

import policyengine as pe
from policyengine_uk.parameters.gov.simulation.labour_supply_responses.aliases import (  # noqa: E501
    canonicalize_parameter_changes,
)
from policyengine_uk.tax_benefit_system import parameter_reads_calendar_years
from policyengine_uk.utils.dated_reforms import read_parameter_changes

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.combine import member_order, merged_changes
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
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

# The answers a measure acts through, for measures that act only through
# one kind of income or spending: with all of them zero, the measure can't
# change this household's net income.
MEASURE_INPUTS = {
    "dividend_tax_increase_2pp": ("dividend_income",),
    "savings_tax_increase_2pp": ("savings_interest_income",),
    "property_tax_increase_2pp": ("property_income",),
    "fuel_duty_freeze": ("petrol_spending", "diesel_spending"),
    "salary_sacrifice_cap": ("salary_sacrifice_pension_contributions",),
}

NOT_MODELLED_REASON = (
    "This measure changes the simulation in code, which policyengine.py's "
    "household calculation can't apply."
)
NOT_MODELLED_REASONS = {
    "rail_fares_freeze": (
        "This measure spreads a national cost over households by how much "
        "they use rail, which one household's answers can't show."
    ),
}


def measure_ids() -> list[str]:
    """The measures the household calculation accepts: every registered
    single measure (the combined measure is the sum of these)."""
    return [
        reform.id
        for reform in get_autumn_budget_2026_reforms()
        if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID
    ]


@dataclass(frozen=True)
class HouseholdAnswers:
    """The Personal impact view's questions. Amounts are £ a year, except
    ``monthly_rent``."""

    age: int = 40
    employment_income: float = 35_000
    has_partner: bool = False
    partner_age: int = 40
    partner_employment_income: float = 0
    children_ages: tuple[int, ...] = field(default_factory=tuple)
    region: str = "LONDON"
    claims_universal_credit: bool = False
    tenure: str = "OWNED_WITH_MORTGAGE"
    monthly_rent: float = 0
    dividend_income: float = 0
    savings_interest_income: float = 0
    property_income: float = 0
    petrol_spending: float = 0
    diesel_spending: float = 0
    salary_sacrifice_pension_contributions: float = 0


def household_entities(answers: HouseholdAnswers) -> tuple[list, dict, dict]:
    """The household as policyengine.py's ``people``, ``benunit`` and
    ``household`` inputs (policyengine-uk variable names, one year's
    values)."""
    people = [
        {
            "age": answers.age,
            "employment_income": answers.employment_income,
            "dividend_income": answers.dividend_income,
            "savings_interest_income": answers.savings_interest_income,
            "property_income": answers.property_income,
            "pension_contributions_via_salary_sacrifice": (
                answers.salary_sacrifice_pension_contributions
            ),
        }
    ]
    if answers.has_partner:
        people.append(
            {
                "age": answers.partner_age,
                "employment_income": answers.partner_employment_income,
            }
        )
    people += [{"age": age} for age in answers.children_ages]
    benunit = {"would_claim_uc": answers.claims_universal_credit}
    household = {
        "region": answers.region,
        "tenure_type": answers.tenure,
        "rent": answers.monthly_rent * 12 if answers.tenure in RENTING else 0,
        "petrol_spending": answers.petrol_spending,
        "diesel_spending": answers.diesel_spending,
    }
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


@dataclass(frozen=True)
class MeasureSides:
    """The selected measures as two policyengine.py reform dicts."""

    before: dict
    after: dict
    included: list[str]
    not_modelled: list[dict]


def measure_sides(
    reform_ids: list[str], config: Optional[DataConfig] = None
) -> MeasureSides:
    """The pre-Budget ("before") and Budget ("after") sides of the selected
    measures, merged as the publication merges a combined run
    (``publication.combine.merged_changes``).

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
    measures = member_order(
        [get_reform(id_) for id_ in dict.fromkeys(reform_ids)]
    )
    included, not_modelled = [], []
    for measure in measures:
        if measure.baseline_simulation_modifier or measure.simulation_modifier:
            not_modelled.append(
                {
                    "id": measure.id,
                    "reason": NOT_MODELLED_REASONS.get(
                        measure.id, NOT_MODELLED_REASON
                    ),
                }
            )
        else:
            included.append(measure)
    if not included:
        return MeasureSides({}, {}, [], not_modelled)
    sides = merged_changes(included, config or DataConfig())
    return MeasureSides(
        before=py_reform_dict(sides["baseline"]["parameter_changes"]),
        after=py_reform_dict(sides["reform"]["parameter_changes"]),
        included=[measure.id for measure in included],
        not_modelled=not_modelled,
    )


def not_affected(
    answers: HouseholdAnswers, reform_ids: list[str]
) -> list[str]:
    """The measures that act only through answers this household gave as
    zero, in the order given."""
    return [
        id_
        for id_ in reform_ids
        if id_ in MEASURE_INPUTS
        and all(getattr(answers, name) == 0 for name in MEASURE_INPUTS[id_])
    ]


def _net_income(people, benunit, household, year, reform) -> float:
    result = pe.uk.calculate_household(
        people=people,
        benunit=benunit,
        household=household,
        year=year,
        reform=reform or None,
    )
    return float(result.household.household_net_income)


def calculate_household_impact(
    answers: HouseholdAnswers, reform_ids: list[str], year: int
) -> dict:
    """The household's net income in ``year`` before and after the
    selected measures, and which measures the figures include.

    Raises:
        ValueError: for a year outside the Budget's policy years, or
            measures ``measure_sides`` refuses.
    """
    if year not in POLICY_YEARS:
        raise ValueError(f"{year} is not one of the Budget's policy years.")
    sides = measure_sides(reform_ids)
    people, benunit, household = household_entities(answers)
    before = _net_income(people, benunit, household, year, sides.before)
    after = _net_income(people, benunit, household, year, sides.after)
    return {
        "year": year,
        "net_income": {
            "before": round(before, 2),
            "after": round(after, 2),
            "change": round(after - before, 2),
        },
        "measures": {
            "included": sides.included,
            "not_affected": not_affected(answers, sides.included),
            "not_modelled": sides.not_modelled,
        },
        "versions": runtime_identity()["packages"],
    }
