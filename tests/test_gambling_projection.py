"""The gambling duty bases on the OBR's October 2026 forecast
(``forecast.gambling``, ported from policyengine-uk#2761).

The indices are checked against #2761's own tables (its PR body, "Indices
by year"), and the projection on four invented households built as survey
data: each duty, weighted, grows with its national base, on the installed
engine's population path, and one household's answers are not projected.
"""

import numpy as np
import pandas as pd
import pytest
from policyengine_uk import Simulation

from uk_budget_data.forecast import forecast_scenario, gambling, with_forecast
from uk_budget_data.pipeline import build_microsimulation

YEARS = range(2024, 2032)

# policyengine-uk#2761, "Indices by year": the per-person index of each
# duty's base, 2024-25 to 2031-32.
PER_PERSON = {
    "remote_gaming": [
        1,
        1.13254,
        1.23625,
        1.24777,
        1.27271,
        1.29851,
        1.31280,
        1.31789,
    ],
    "lottery": [
        1,
        1.04831,
        0.88652,
        0.90577,
        0.93200,
        0.95953,
        0.98476,
        1.01122,
    ],
    "general_betting": [
        1,
        0.95572,
        0.91355,
        0.93703,
        0.97755,
        1.00921,
        1.03623,
        1.06308,
    ],
    "machine_games": [
        1,
        1.04868,
        1.10546,
        1.10146,
        1.13952,
        1.14813,
        1.15885,
        1.18355,
    ],
    "gaming": [
        1,
        1.04796,
        1.04784,
        1.11045,
        1.11069,
        1.10984,
        1.11321,
        1.10561,
    ],
    "bingo": [
        1,
        1.02989,
        1.02783,
        1.02650,
        1.02476,
        1.02261,
        1.02006,
        1.01762,
    ],
    "pool_betting": [
        1,
        0.48701,
        0.34633,
        0.32771,
        0.34890,
        0.34558,
        0.36401,
        0.37889,
    ],
}
# The same table's national base index (per person times population).
BASE = {
    "remote_gaming": [
        1,
        1.13628,
        1.24280,
        1.25601,
        1.28330,
        1.31206,
        1.32981,
        1.33817,
    ],
    "lottery": [
        1,
        1.05177,
        0.89122,
        0.91175,
        0.93975,
        0.96954,
        0.99752,
        1.02678,
    ],
    "general_betting": [
        1,
        0.95887,
        0.91839,
        0.94322,
        0.98568,
        1.01974,
        1.04966,
        1.07944,
    ],
    "machine_games": [
        1,
        1.05214,
        1.11132,
        1.10874,
        1.14900,
        1.16011,
        1.17387,
        1.20176,
    ],
    "gaming": [
        1,
        1.05142,
        1.05339,
        1.11779,
        1.11993,
        1.12142,
        1.12764,
        1.12262,
    ],
    "bingo": [
        1,
        1.03329,
        1.03328,
        1.03328,
        1.03328,
        1.03328,
        1.03328,
        1.03328,
    ],
    "pool_betting": [
        1,
        0.48862,
        0.34817,
        0.32987,
        0.35180,
        0.34919,
        0.36873,
        0.38472,
    ],
}

# One input of each duty, £ a year in 2024-25, on two of four households
INPUTS = {
    "remote_gaming_net_losses": [500.0, 0, 0, 200.0],
    "national_lottery_ticket_spending": [0, 300.0, 0, 0],
    "land_based_fixed_odds_betting_net_losses": [0, 0, 400.0, 0],
    "machine_games_standard_rate_net_takings": [1_000.0, 0, 0, 0],
    "machine_games_lower_rate_net_takings": [100.0, 0, 0, 0],
    "land_based_casino_net_losses": [0, 0, 0, 250.0],
    "bingo_net_receipts": [0, 0, 80.0, 0],
    "pool_betting_net_receipts": [0, 60.0, 0, 0],
}
POPULATION = "gov.economic_assumptions.indices.ons.population"


def write_survey(path, inputs=INPUTS):
    """Four invented households, saved as a 2024-25 survey file."""
    from policyengine_uk.data.dataset_schema import UKSingleYearDataset

    ids = np.array([1, 2, 3, 4], dtype=np.int64)
    household = pd.DataFrame(
        {
            "household_id": ids,
            "household_weight": [100.0, 50.0, 80.0, 70.0],
            "region": ["LONDON", "WALES", "NORTH_WEST", "SCOTLAND"],
            "tenure_type": ["RENT_PRIVATELY", "OWNED_OUTRIGHT"] * 2,
            "accommodation_type": ["FLAT"] * 4,
            "council_tax": [1_000.0] * 4,
            "rent": [10_000.0, 0.0, 10_000.0, 0.0],
            **inputs,
        }
    )
    person = pd.DataFrame(
        {
            "person_id": [1, 2, 3, 4],
            "person_household_id": ids,
            "person_benunit_id": [1, 2, 3, 4],
            "age": [40, 50, 30, 60],
            "gender": ["FEMALE", "MALE", "FEMALE", "MALE"],
            "employment_income": [30_000.0, 20_000.0, 25_000.0, 0.0],
        }
    )
    benunit = pd.DataFrame({"benunit_id": [1, 2, 3, 4]})
    UKSingleYearDataset(
        person=person, benunit=benunit, household=household, fiscal_year=2024
    ).save(str(path))
    return str(path)


@pytest.fixture(scope="module")
def survey(tmp_path_factory):
    path = write_survey(tmp_path_factory.mktemp("gambling") / "survey.h5")
    return build_microsimulation(path)


def weighted(sim, variable, year):
    return float(
        (
            sim.calculate(variable, year).values
            * sim.calculate("household_weight", year).values
        ).sum()
    )


@pytest.mark.parametrize("duty", sorted(PER_PERSON))
def test_the_indices_are_2761s(duty):
    """Compounded as the engine compounds a yoy_growth series, the stored
    growth gives #2761's per-person index, and with #2761's population its
    national base index, in every year."""
    for year, person, base in zip(YEARS, PER_PERSON[duty], BASE[duty]):
        assert gambling.per_person_index(duty, year) == pytest.approx(
            person, abs=1e-9
        ), year
        assert gambling.base_index(duty, year) == pytest.approx(
            base, abs=1.5e-5
        ), year


def test_every_duty_and_input_is_covered():
    """Seven duties, each with a series to 2031-32, and every gambling input
    of the installed engine taken by one of them."""
    from policyengine_uk.system import system

    record = gambling.bases_record()
    assert set(record["per_person_growth"]) == set(gambling.DUTIES)
    for series in record["per_person_growth"].values():
        assert sorted(map(int, series)) == list(YEARS)
    covered = {
        name for _, inputs in gambling.DUTIES.values() for name in inputs
    }
    engine_inputs = {
        name
        for name, variable in system.variables.items()
        if "/consumption/gambling/"
        in (variable.__module__ or "").replace(".", "/")
    }
    assert engine_inputs <= covered
    for variable, _ in gambling.DUTIES.values():
        assert not system.variables[variable].adds


def test_a_later_year_holds_the_last_base():
    assert gambling.base_index("machine_games", 2035) == gambling.base_index(
        "machine_games", 2031
    )
    with pytest.raises(ValueError, match="before 2024"):
        gambling.base_index("machine_games", 2023)


def test_the_installed_engine_does_not_grow_the_gambling_bases():
    """Tripwire: once the bundle's policyengine-uk carries #2761 (2.169.0),
    the inputs declare an uprating and the projection here stands down by
    itself (``projects``). Then delete forecast/gambling.py and
    gambling_duty_bases.json in that PR rather than keep a dead copy."""
    from policyengine_uk.system import system

    assert not gambling.engine_projects_gambling(system), (
        "the installed policyengine-uk grows the gambling bases itself "
        "(policyengine-uk#2761): remove the dashboard's projection"
    )


def test_survey_data_are_projected(survey):
    assert gambling.projects(survey)
    assert gambling.data_first_year(survey) == 2024


@pytest.mark.parametrize("duty", sorted(gambling.DUTIES))
def test_each_weighted_duty_grows_with_its_national_base(survey, duty):
    """The weighted duty, over 2024-25's, is the national base index in
    every year its rates stand still; the factor is that index over the
    engine's own population growth, which grows the weights."""
    variable, _ = gambling.DUTIES[duty]
    population = survey.tax_benefit_system.parameters.get_child(POPULATION)
    first = weighted(survey, variable, 2024)
    assert first > 0
    for year in YEARS:
        weights = population(f"{year}-01-01") / population("2024-01-01")
        factor = gambling.projection_factor(survey, duty, year)
        assert factor == pytest.approx(
            gambling.base_index(duty, year) / weights, rel=1e-12
        )
    # Machine Games Duty's rates do not change in current law: its weighted
    # duty follows the base, to the rounding of the weights' growth (within
    # 0.002% on 2.165.1)
    if duty == "machine_games":
        for year in YEARS:
            assert weighted(survey, variable, year) / first == pytest.approx(
                gambling.base_index(duty, year), rel=5e-5
            ), year


def test_machine_games_duty_by_hand(survey):
    """£1,000 of standard-rate and £100 of lower-rate takings in 2024-25:
    £205 of duty then, and in 2029-30 £205 times the factor."""
    duty = survey.calculate("machine_games_duty", 2024).values
    assert duty[0] == pytest.approx(205, abs=0.01)
    factor = gambling.projection_factor(survey, "machine_games", 2029)
    later = survey.calculate("machine_games_duty", 2029).values
    assert later[0] == pytest.approx(205 * factor, abs=0.01)
    assert factor > 1.1


def test_the_stored_inputs_are_left_as_they_are(survey):
    """Only the duties move: the inputs stay at 2024-25's cash level, as
    the engine projects them, so a build reads none of them."""
    for year in (2024, 2027, 2031):
        takings = survey.calculate(
            "machine_games_standard_rate_net_takings", year
        ).values
        assert takings[0] == pytest.approx(1_000)


def test_one_household_is_not_projected():
    """The Household calculator's answers are the household's amounts for
    the year asked: 20% of £1,000 of standard-rate takings in 2029-30."""
    year = 2029
    situation = {
        "people": {"p": {"age": {year: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "machine_games_standard_rate_net_takings": {year: 1_000},
                "remote_gaming_net_losses": {year: 100},
            }
        },
    }
    sim = Simulation(situation=situation, scenario=forecast_scenario())
    assert not gambling.projects(sim)
    assert gambling.projection_factor(sim, "machine_games", year) == 1.0
    assert sim.calculate("machine_games_duty", year)[0] == pytest.approx(200)
    assert sim.calculate("remote_gaming_duty", year)[0] == pytest.approx(40)


def test_an_engine_that_grows_the_bases_is_left_alone(survey, monkeypatch):
    """Where the engine has #2761's series (its gambling inputs are
    uprated by them), the factor is 1."""
    system = survey.tax_benefit_system
    real = type(system.parameters).get_child

    def get_child(node, path):
        if path == gambling.ENGINE_SERIES:
            return object()
        return real(node, path)

    monkeypatch.setattr(type(system.parameters), "get_child", get_child)
    assert gambling.engine_projects_gambling(system)
    assert not gambling.projects(survey)
    assert gambling.projection_factor(survey, "machine_games", 2029) == 1


def test_the_engine_with_2761_is_recognised():
    """The parameter the check asks for is where #2761 puts its series
    (gov.economic_assumptions.indices.obr.per_capita.gambling_duty_bases,
    one child per duty, as its inputs' uprating names them)."""
    assert gambling.ENGINE_SERIES == (
        "gov.economic_assumptions.indices.obr.per_capita.gambling_duty_bases"
    )
    assert set(gambling.DUTIES) == {
        "remote_gaming",
        "lottery",
        "general_betting",
        "machine_games",
        "gaming",
        "bingo",
        "pool_betting",
    }


def test_the_forecast_scenario_carries_the_projection():
    """Every simulation the dashboard builds has it: the forecast's part
    after data load, with or without a measure."""
    before, after = forecast_scenario().parts_by_data_load()
    assert before.parameter_changes
    assert after.simulation_modifier is gambling.project_gambling_bases
    _, after = with_forecast(None).parts_by_data_load()
    assert after.simulation_modifier is gambling.project_gambling_bases
