"""The example households and the income-curve generator."""

import re

import numpy as np
import pandas as pd
import pytest

from uk_budget_data.example_households import (
    CURVE_POINTS,
    EMPLOYMENT_INCOME,
    EXAMPLE_HOUSEHOLDS,
    HOUSEHOLD_IDS,
    PRIVATE_PENSION_INCOME,
    build_situation,
    get_household,
)

YEARS = [2026, 2027]


def test_there_are_five_households_with_distinct_ids():
    assert len(EXAMPLE_HOUSEHOLDS) == 5
    assert len(set(HOUSEHOLD_IDS)) == 5
    for household in EXAMPLE_HOUSEHOLDS:
        # Not a record-level column name (scripts/check_public_data.py)
        assert not re.search(
            r"(household|benunit|person)_(id|weight)", household.id
        )


@pytest.mark.parametrize("household", EXAMPLE_HOUSEHOLDS, ids=HOUSEHOLD_IDS)
def test_each_definition_is_one_sentence_in_house_style(household):
    text = household.definition
    assert "\n" not in text and text.endswith(".")
    assert text[0].isupper()
    # Sentence case
    assert household.label[0].isupper()
    assert household.label[1:] == household.label[1:].lower()
    for word in ("poor", "rich"):
        assert not re.search(rf"\b{word}\b", text.lower())


def test_the_pensioners_are_on_private_pension_income_and_the_rest_on_pay():
    for household in EXAMPLE_HOUSEHOLDS:
        expected = (
            PRIVATE_PENSION_INCOME
            if household.id == "pensioner_couple"
            else EMPLOYMENT_INCOME
        )
        assert household.x_variable == expected


def test_the_grid_runs_from_zero_to_the_households_top():
    household = get_household("higher_income_saver")
    grid = household.grid()
    assert len(grid) == CURVE_POINTS
    assert grid[0] == 0 and grid[-1] == household.x_max


def test_the_situation_sets_the_grid_in_every_year_together():
    household = get_household("single_renter")
    situation = build_situation(household, YEARS)
    (group,) = situation["axes"]
    assert [axis["period"] for axis in group] == ["2026", "2027"]
    assert {axis["name"] for axis in group} == {EMPLOYMENT_INCOME}
    assert all(axis["count"] == CURVE_POINTS for axis in group)
    adult = situation["people"]["adult"]
    assert adult["age"] == {"2026": 30, "2027": 30}
    assert adult["student_loan_plan"] == {"2026": "PLAN_2", "2027": "PLAN_2"}
    home = situation["households"]["household"]
    assert home["rent"] == {"2026": 1_007 * 12, "2027": 1_007 * 12}
    assert home["brma"]["2026"] == "CENTRAL_GREATER_MANCHESTER"
    assert situation["benunits"]["benunit"]["would_claim_uc"]["2026"] is True


def test_the_pensioners_need_the_state_pension_rate():
    household = get_household("pensioner_couple")
    with pytest.raises(ValueError):
        build_situation(household, YEARS)
    situation = build_situation(household, YEARS, {2026: 241.3, 2027: 250.0})
    for person in situation["people"].values():
        assert person["state_pension_type"]["2026"] == "NEW"
        assert person["state_pension_reported"] == {
            "2026": 241.3 * 52,
            "2027": 250.0 * 52,
        }


def test_the_pensioners_get_exactly_the_full_new_state_pension():
    """Reported above the full rate, the excess would count as a protected
    payment; below it, as a partial record."""
    from uk_budget_data.calculators import (
        IncomeCurveCalculator,
        full_new_state_pension,
    )

    calculator = IncomeCurveCalculator(num_points=3)
    household = get_household("pensioner_couple")
    rates = full_new_state_pension(YEARS)
    assert rates[2026] == pytest.approx(241.30)
    from policyengine_uk import Simulation

    sim = Simulation(
        situation=build_situation(household, YEARS, rates, points=3)
    )
    for year in YEARS:
        pension = sim.calculate("state_pension", year)
        assert pension == pytest.approx(rates[year] * 52, rel=1e-5)
    curves = calculator.simulate(household, None, YEARS)
    assert set(curves) == set(YEARS)
    # Net income rises with private pension income
    assert np.all(np.diff(curves[2026]) > 0)


class _Reform:
    def __init__(self, id, baseline, reform):
        self.id = id
        self.name = id.title()
        self._baseline = baseline
        self._reform = reform

    def baseline_scenario_for(self, config):
        return self._baseline

    def to_scenario(self):
        return self._reform


def test_the_generator_simulates_each_distinct_scenario_once(
    tmp_path, monkeypatch
):
    from policyengine_uk.utils.scenario import Scenario

    from uk_budget_data import pipeline
    from uk_budget_data.calculators import IncomeCurveCalculator
    from uk_budget_data.models import DataConfig

    cut = Scenario(
        parameter_changes={"gov.hmrc.income_tax.rates.uk[0].rate": 0.19}
    )
    rise = Scenario(
        parameter_changes={"gov.hmrc.income_tax.rates.uk[0].rate": 0.21}
    )
    # Both measures keep current law on their reform side
    reforms = [_Reform("b", cut, None), _Reform("a", rise, None)]
    calls = []

    def simulate(self, household, scenario, years):
        calls.append((household.id, scenario))
        level = {None: 100.0, id(cut): 90.0, id(rise): 110.0}[
            None if scenario is None else id(scenario)
        ]
        return {year: np.full(self.num_points, level) for year in years}

    monkeypatch.setattr(IncomeCurveCalculator, "simulate", simulate)
    config = DataConfig(
        output_dir=tmp_path, years=YEARS, income_curve_points=3
    )
    frame = pipeline.generate_income_curve(reforms=reforms, config=config)

    # Per household: current law, the cut and the rise, once each
    assert len(calls) == 3 * len(EXAMPLE_HOUSEHOLDS)
    assert len(frame) == len(reforms) * len(YEARS) * 5 * 3
    # Registry order, then year, then the households in their own order
    assert list(frame["reform_id"].unique()) == ["b", "a"]
    first = frame[(frame.reform_id == "b") & (frame.year == 2026)]
    assert list(first["household"].unique()) == list(HOUSEHOLD_IDS)
    assert set(first["baseline_net_income"]) == {90.0}
    assert set(first["reform_net_income"]) == {100.0}
    written = pd.read_csv(tmp_path / "income_curve.csv")
    assert list(written.columns) == [
        "reform_id",
        "reform_name",
        "year",
        "household",
        "x_variable",
        "income",
        "baseline_net_income",
        "reform_net_income",
    ]


def test_the_cli_has_an_income_curve_command():
    from uk_budget_data.cli import parse_args

    parsed = parse_args(["income-curve", "--years", "2026", "--reforms", "x"])
    assert parsed.command == "income-curve"
    assert parsed.years == [2026]
    assert parsed.reforms == ["x"]


def _curve_tables(households=HOUSEHOLD_IDS, x_variable=None, points=3):
    from tests.publication_support import make_tables

    tables = make_tables("alpha", {2027: -1.0})
    rows = []
    for household in EXAMPLE_HOUSEHOLDS:
        if household.id not in households:
            continue
        for income in household.grid(points):
            rows.append(
                {
                    "reform_id": "alpha",
                    "reform_name": "Alpha",
                    "year": 2027,
                    "household": household.id,
                    "x_variable": x_variable or household.x_variable,
                    "income": income,
                    "baseline_net_income": 1.0,
                    "reform_net_income": 0.0,
                }
            )
    tables["income_curve"] = rows
    return tables


def _curve_problems(tables, points=3):
    from uk_budget_data.publication.validate import table_problems

    return [
        problem
        for problem in table_problems(
            tables, key="alpha", years=[2027], income_curve_points=points
        )
        if problem.startswith("income_curve")
    ]


def test_the_validator_accepts_every_household_on_its_own_axis():
    assert _curve_problems(_curve_tables()) == []


def test_the_validator_wants_every_household():
    problems = _curve_problems(_curve_tables(households=HOUSEHOLD_IDS[:4]))
    assert any("households for 2027" in problem for problem in problems)


def test_the_validator_wants_each_household_on_its_own_axis():
    problems = _curve_problems(_curve_tables(x_variable=EMPLOYMENT_INCOME))
    assert problems == [
        "income_curve: pensioner_couple in 2027 is not on "
        "private_pension_income"
    ]


def test_income_curve_defaults_to_every_policy_year():
    from uk_budget_data.budget_years import POLICY_YEARS
    from uk_budget_data.cli import parse_args

    assert parse_args(["income-curve"]).years == list(POLICY_YEARS)


def test_one_simulation_for_every_year_gives_the_per_year_rows():
    """The flat run asks for every year at once; the rows must be those of
    one call per year, value for value and in the same order."""
    from policyengine_uk.utils.scenario import Scenario

    from uk_budget_data.calculators import IncomeCurveCalculator

    calculator = IncomeCurveCalculator(num_points=3)
    reform = Scenario(
        parameter_changes={
            "gov.hmrc.income_tax.rates.uk[0].rate": {
                "2026": 0.21,
                "2027": 0.22,
            }
        }
    )
    per_year = [
        row
        for year in YEARS
        for row in calculator.calculate(None, reform, "m", "M", year)
    ]
    together = calculator.calculate(None, reform, "m", "M", list(YEARS))
    assert [repr(row) for row in together] == [repr(row) for row in per_year]
