"""The lifecycle model's inputs describe this dashboard's year, 2026."""

from uk_budget_data.lifecycle_calculator import (
    INPUT_YEAR,
    LifecycleInputs,
    run_lifecycle_model,
)


def _inputs(**overrides):
    values = dict(
        current_age=30,
        current_salary=40_000,
        retirement_age=67,
        life_expectancy=85,
        student_loan_debt=0,
        salary_sacrifice_per_year=0,
        rail_spending_per_year=0,
        petrol_spending_per_year=0,
        dividends_per_year=0,
        savings_interest_per_year=0,
        property_income_per_year=0,
        children_ages=[],
        additional_income_growth_rate=0.0,
    )
    values.update(overrides)
    return LifecycleInputs(**values)


def test_inputs_describe_2026():
    assert INPUT_YEAR == 2026


def test_first_year_is_2026_at_the_given_age_and_salary():
    rows = run_lifecycle_model(_inputs())
    first = rows[0]
    assert first["year"] == 2026
    assert first["age"] == 30
    # The salary entered is this year's salary: in 2026 it is paid as entered
    assert round(first["employment_income"]) == 40_000


def test_one_row_per_year_to_life_expectancy():
    rows = run_lifecycle_model(_inputs())
    assert [row["age"] for row in rows] == list(range(30, 86))
    assert [row["year"] for row in rows] == list(range(2026, 2082))


def test_under_22_salary_does_not_fall_at_22():
    """Review finding (under-25s, 23 Oct 2026): ages below 22 took the peak
    multiplier, so a 19-year-old's salary was divided by 2.2 from age 22."""
    rows = run_lifecycle_model(_inputs(current_age=19, current_salary=23_600))
    income = {row["age"]: row["employment_income"] for row in rows}
    assert round(income[19]) == 23_600
    # Flat to 22, then the age trajectory: 1.05 times at 23
    assert round(income[22]) == 23_600
    assert round(income[23]) == round(23_600 * 1.05)
