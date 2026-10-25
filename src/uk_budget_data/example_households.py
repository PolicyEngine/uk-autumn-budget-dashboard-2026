"""The five example households on the dashboard's household charts.

Each household is held fixed except for one income, which runs over a grid
(the chart's x-axis): employment income for four of them, private pension
income for the pensioner couple. Ages, rents and other amounts are the same
in every year, in 2026-27 prices; only the policy changes from year to year.

Sources for the fixed amounts:

- Rents: ONS, Price Index of Private Rents, UK: monthly price statistics,
  21 October 2026 release, Table 1, Manchester (E08000003), September 2026
  average monthly rent by number of bedrooms: one bedroom £1,007, two
  bedrooms £1,239, three bedrooms £1,441.
  https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics
  The renting households live in Manchester, so Universal Credit's housing
  element follows the Central Greater Manchester local housing allowance.
- Petrol and diesel: ONS, Family spending in the UK, April 2024 to March
  2025, Workbook 1, Table A1: petrol £11.90 a week (£620 a year) and diesel
  £6.50 (£340), the household calculator's defaults
  (src/utils/householdDefaults.js). Every household has them, so the fuel
  duty and road fuel VAT measures reach each one, as they reach the
  calculator's household and the population figures.
  https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends
- Electricity: ONS, Family spending in the UK, April 2024 to March 2025,
  Workbook 1, Table A1, line 4.4.1 (Electricity): £20.00 a week per
  household, £1,040 a year, the household calculator's default too. Every
  household has it, so the zero VAT on domestic electricity reaches each
  one; policyengine-uk reads it only for that measure.
- State Pension: the full new State Pension, read from the model's own
  parameter (gov.dwp.state_pension.new_state_pension.amount) for each year,
  £241.30 a week in 2026-27 (DWP, Benefit and pension rates 2026 to 2027).
- Savings interest and dividends of the higher-income household: £3,000 and
  £5,000 a year, illustrative amounts set above the Personal Savings
  Allowance (£500 for a higher-rate taxpayer) and the £500 dividend
  allowance, so the measures on savings and dividend income reach them
  (https://www.gov.uk/apply-tax-free-interest-on-savings,
  https://www.gov.uk/tax-on-dividends).

Children's ages are chosen to keep the curves readable: no child is 2 (the
targeted free childcare for 2-year-olds ends at an earnings limit, a step of
about £5,000 in net income), and the lone parent's children are of school
age (the 30 hours of free childcare for working parents of 3- and
4-year-olds start at an earnings floor). The steps that remain are the
benefit cap's: below about £10,000 of earnings the cap limits the couple's
and the lone parent's benefits, and above it they are exempt. All three
children of the couple were born after April 2017, so the two-child limit
reaches the third.

This module imports nothing from policyengine, so the publication validator
can read the households without loading the model.
"""

from dataclasses import dataclass, field
from typing import Optional

EMPLOYMENT_INCOME = "employment_income"
PRIVATE_PENSION_INCOME = "private_pension_income"

# Points on each household's income grid, from 0 to its x_max.
CURVE_POINTS = 201

# ONS PIPR, Manchester, September 2026 (see the module docstring), £/month.
MANCHESTER_RENT_ONE_BED = 1_007
MANCHESTER_RENT_TWO_BED = 1_239
MANCHESTER_RENT_THREE_BED = 1_441
# ONS Family Spending FYE 2025, Table A1: petrol £11.90 and diesel £6.50 a
# week, rounded to £10 a year (the household calculator's defaults).
PETROL_SPENDING = 620
DIESEL_SPENDING = 340
# ONS Family Spending FYE 2025, Table A1, 4.4.1: £20.00 a week.
ELECTRICITY_SPENDING = round(20.00 * 52)

MANCHESTER = {
    "region": "NORTH_WEST",
    "brma": "CENTRAL_GREATER_MANCHESTER",
    "local_authority": "MANCHESTER",
}

# The spending every example household has: the average household's, as
# the household calculator's defaults, so each VAT and fuel duty measure
# changes every chart's net income alike.
AVERAGE_SPENDING = {
    "electricity_consumption": ELECTRICITY_SPENDING,
    "petrol_spending": PETROL_SPENDING,
    "diesel_spending": DIESEL_SPENDING,
}


@dataclass(frozen=True)
class Person:
    name: str
    age: int
    inputs: dict = field(default_factory=dict)
    full_new_state_pension: bool = False


@dataclass(frozen=True)
class ExampleHousehold:
    """One example household.

    Attributes:
        id: The key in income_curve.csv's ``household`` column.
        label: The household's name in the chooser.
        definition: Its exact definition, in one line.
        x_variable: The income on the x-axis, set on ``earner``.
        x_label: That income's name on the chart's axis.
        x_max: The top of the income grid.
        people: Its members; the first is the earner.
        household_inputs: Inputs on the household (tenure, rent, area).
        measure_id: The candidate measure this household is chosen to show.
        measure_year: The first year that measure changes its net income.
    """

    id: str
    label: str
    definition: str
    x_variable: str
    x_label: str
    x_max: int
    people: tuple
    household_inputs: dict
    measure_id: str = ""
    measure_year: int = 2027

    @property
    def earner(self) -> str:
        return self.people[0].name

    def grid(self, points: int = CURVE_POINTS) -> list[float]:
        step = self.x_max / (points - 1)
        return [i * step for i in range(points)]


EXAMPLE_HOUSEHOLDS: tuple[ExampleHousehold, ...] = (
    ExampleHousehold(
        id="single_renter",
        label="Graduate renting",
        definition=(
            "One adult aged 30 with a Plan 2 student loan, renting a "
            "one-bedroom home privately in Manchester for £1,007 a month; "
            "the unfrozen Plan 2 "
            "threshold lowers their repayments from 2027-28."
        ),
        x_variable=EMPLOYMENT_INCOME,
        x_label="Employment income",
        x_max=100_000,
        people=(Person("adult", 30, {"student_loan_plan": "PLAN_2"}),),
        household_inputs={
            **MANCHESTER,
            "tenure_type": "RENT_PRIVATELY",
            **AVERAGE_SPENDING,
            "rent": MANCHESTER_RENT_ONE_BED * 12,
        },
        measure_id="plan_2_threshold_unfreeze",
        measure_year=2027,
    ),
    ExampleHousehold(
        id="couple_three_children",
        label="Couple with three children and a car",
        definition=(
            "A couple aged 35 and 33 with children aged 3, 6 and 8 and one "
            "earner, renting a three-bedroom home privately in Manchester "
            "for £1,441 a month; the fuel duty and road fuel VAT measures "
            "lower what they pay at the pump."
        ),
        x_variable=EMPLOYMENT_INCOME,
        x_label="Earner's employment income",
        x_max=100_000,
        people=(
            Person("adult1", 35),
            Person("adult2", 33),
            Person("child1", 3),
            Person("child2", 6),
            Person("child3", 8),
        ),
        household_inputs={
            **MANCHESTER,
            "tenure_type": "RENT_PRIVATELY",
            **AVERAGE_SPENDING,
            "rent": MANCHESTER_RENT_THREE_BED * 12,
        },
        measure_id="fuel_duty_rise_deferral",
        measure_year=2027,
    ),
    ExampleHousehold(
        id="lone_parent",
        label="Lone parent with two children",
        definition=(
            "A lone parent aged 32 with children aged 6 and 9, renting a "
            "two-bedroom home privately in Manchester for £1,239 a month; "
            "while they receive "
            "Universal Credit, the Warm Home Discount top-up adds £100 in "
            "2026-27."
        ),
        x_variable=EMPLOYMENT_INCOME,
        x_label="Employment income",
        x_max=100_000,
        people=(
            Person("adult", 32),
            Person("child1", 6),
            Person("child2", 9),
        ),
        household_inputs={
            **MANCHESTER,
            "tenure_type": "RENT_PRIVATELY",
            **AVERAGE_SPENDING,
            "rent": MANCHESTER_RENT_TWO_BED * 12,
        },
        measure_id="warm_home_discount_top_up",
        measure_year=2026,
    ),
    ExampleHousehold(
        id="pensioner_couple",
        label="Pensioner couple",
        definition=(
            "A couple aged 70 and 68 who own their home outright, each on "
            "the full new State Pension (£241.30 a week in 2026-27); the "
            "older partner has the private pension; the State Pension income tax protection "
            "lowers their income tax from 2027-28."
        ),
        x_variable=PRIVATE_PENSION_INCOME,
        x_label="Older partner's private pension income",
        x_max=60_000,
        people=(
            Person("pensioner1", 70, full_new_state_pension=True),
            Person("pensioner2", 68, full_new_state_pension=True),
        ),
        household_inputs={
            **MANCHESTER,
            "tenure_type": "OWNED_OUTRIGHT",
            **AVERAGE_SPENDING,
        },
        measure_id="state_pension_income_tax_protection",
        measure_year=2027,
    ),
    ExampleHousehold(
        id="higher_income_saver",
        label="Higher earner with savings",
        definition=(
            "One adult aged 45 who owns their home with a mortgage, with "
            "£3,000 a year of savings interest and £5,000 of dividends on "
            "top of their pay; the threshold freeze raises their income tax from 2031-32."
        ),
        x_variable=EMPLOYMENT_INCOME,
        x_label="Employment income",
        x_max=150_000,
        people=(
            Person(
                "adult",
                45,
                {
                    "savings_interest_income": 3_000,
                    "dividend_income": 5_000,
                },
            ),
        ),
        household_inputs={
            **MANCHESTER,
            "tenure_type": "OWNED_WITH_MORTGAGE",
            **AVERAGE_SPENDING,
        },
        measure_id="threshold_freeze_2031_32",
        measure_year=2031,
    ),
)

HOUSEHOLD_IDS = tuple(household.id for household in EXAMPLE_HOUSEHOLDS)
X_VARIABLES = {
    household.id: household.x_variable for household in EXAMPLE_HOUSEHOLDS
}


def get_household(household_id: str) -> Optional[ExampleHousehold]:
    for household in EXAMPLE_HOUSEHOLDS:
        if household.id == household_id:
            return household
    return None


def build_situation(
    household: ExampleHousehold,
    years: list[int],
    state_pension_weekly: Optional[dict[int, float]] = None,
    points: int = CURVE_POINTS,
) -> dict:
    """A PolicyEngine situation for ``household`` covering every year.

    The x-axis income runs over the grid on the earner in every year at
    once (one axis per year, all in one group, so they move together), so
    one simulation answers every year.

    Args:
        household: The household.
        years: The years to cover.
        state_pension_weekly: The full new State Pension, £ a week, by year;
            needed when anyone in the household receives it.
        points: Points on the income grid.
    """

    def every_year(value):
        return {str(year): value for year in years}

    people = {}
    for person in household.people:
        inputs = {"age": every_year(person.age)}
        for name, value in person.inputs.items():
            inputs[name] = every_year(value)
        if person.full_new_state_pension:
            if state_pension_weekly is None:
                raise ValueError(
                    f"{household.id} needs the State Pension rate by year"
                )
            inputs["state_pension_type"] = every_year("NEW")
            # Reported at exactly the full rate: new_state_pension pays the
            # reported share of the full rate, and anything reported above
            # it would count as a protected payment.
            inputs["state_pension_reported"] = {
                str(year): state_pension_weekly[year] * 52 for year in years
            }
        people[person.name] = inputs
    members = [person.name for person in household.people]
    household_inputs = {
        name: every_year(value)
        for name, value in household.household_inputs.items()
    }
    top = household.grid(points)[-1]
    return {
        "people": people,
        "benunits": {
            "benunit": {
                "members": members,
                "would_claim_uc": every_year(True),
            }
        },
        "households": {"household": {"members": members, **household_inputs}},
        "axes": [
            [
                {
                    "name": household.x_variable,
                    "min": 0,
                    "max": top,
                    "count": points,
                    "period": str(year),
                }
                for year in years
            ]
        ],
    }
