"""Machine Games Duty at the higher rate on higher-stake machines from
April 2027 (``machine_games_duty_rise``, policyengine-uk#2731's rule).

Hand-computed: the higher-stake part of standard-rate takings pays 25%
instead of 20% from model year 2027 (6 April 2027), the rest of the base
as before. That part is all of one household's takings (the Household
calculator asks only for losses on higher-stake machines) and 75.7% of
survey takings (the Category B share), grown with the OBR's base
(``forecast.gambling``).
"""

import functools
from types import SimpleNamespace

import numpy as np
import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from tests.test_gambling_projection import write_survey
from uk_budget_data.budget_measures.machine_games_higher_stake_rate import (
    ENGINE_SWITCH,
    machine_games_higher_stake_rate,
)
from uk_budget_data.forecast import gambling, with_forecast
from uk_budget_data.pipeline import build_microsimulation
from uk_budget_data.reforms import (
    MACHINE_GAMES_DUTY_FROM,
    MACHINE_GAMES_DUTY_ID,
    get_reform,
)

SHARE = 0.757
# Standard-rate, lower-rate and higher-rate takings on survey household 1
INPUTS = {
    "machine_games_standard_rate_net_takings": [1_000.0, 0.0, 400.0, -50.0],
    "machine_games_lower_rate_net_takings": [100.0, 0.0, 0.0, 0.0],
    "machine_games_higher_rate_net_takings": [0.0, 0.0, 200.0, 0.0],
}


def household_duty(year, scenario, **takings):
    """One household's Machine Games Duty, as the Household calculator
    builds it: on the forecast, with ``takings`` for ``year``."""
    situation = {
        "people": {"p": {"age": {year: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                **{name: {year: value} for name, value in takings.items()},
            }
        },
    }
    sim = Simulation(situation=situation, scenario=with_forecast(scenario))
    return float(sim.calculate("machine_games_duty", year)[0])


MEASURE = Scenario(simulation_modifier=machine_games_higher_stake_rate)


@pytest.mark.parametrize(
    "year, before, after",
    [
        # Before 6 April 2027: 20% either way
        (2025, 200, 200),
        (2026, 200, 200),
        # From 2027-28: all of the household's takings at 25%
        (2027, 200, 250),
        (2029, 200, 250),
        (2031, 200, 250),
    ],
)
def test_one_household_pays_25_percent_on_all_its_takings(year, before, after):
    takings = {"machine_games_standard_rate_net_takings": 1_000}
    assert household_duty(year, None, **takings) == pytest.approx(before)
    assert household_duty(year, MEASURE, **takings) == pytest.approx(after)


def test_the_other_bands_keep_their_rates():
    """Lower-rate (5%) and higher-rate (25%) takings pay as before."""
    takings = {
        "machine_games_lower_rate_net_takings": 1_000,
        "machine_games_higher_rate_net_takings": 1_000,
    }
    assert household_duty(2029, None, **takings) == pytest.approx(300)
    assert household_duty(2029, MEASURE, **takings) == pytest.approx(300)


def test_negative_takings_pay_nothing_more():
    """As #2731 floors the base at zero."""
    takings = {"machine_games_standard_rate_net_takings": -500}
    assert household_duty(2029, MEASURE, **takings) == pytest.approx(
        household_duty(2029, None, **takings)
    )


@pytest.fixture(scope="module")
def survey_pair(tmp_path_factory):
    path = write_survey(
        tmp_path_factory.mktemp("mgd") / "survey.h5", inputs=INPUTS
    )
    return (
        build_microsimulation(path),
        build_microsimulation(path, MEASURE),
        path,
    )


@pytest.mark.parametrize("year", [2024, 2025, 2026])
def test_survey_data_before_april_2027_change_nothing(survey_pair, year):
    base, reform, _ = survey_pair
    assert np.allclose(
        reform.calculate("machine_games_duty", year).values,
        base.calculate("machine_games_duty", year).values,
    )


@pytest.mark.parametrize("year", [2027, 2028, 2029, 2030, 2031])
def test_survey_data_pay_25_percent_on_the_share(survey_pair, year):
    """By hand, per household, on the projected base (factor f):

    - £1,000 standard, £100 lower: before 20% × 1,000 + 5% × 100 = £205;
      after (1 − 75.7%) × 1,000 × 20% + 75.7% × 1,000 × 25% + £5 =
      48.6 + 189.25 + 5 = £242.85; both times f.
    - nothing: £0 either way.
    - £400 standard, £200 higher-rate: £80 + £50 = £130, then
      £400 × (24.3% × 20% + 75.7% × 25%) + £50 = £145.14; times f.
    - −£50 standard: £0 either way (floored).
    """
    base, reform, _ = survey_pair
    f = gambling.projection_factor(base, "machine_games", year)
    assert f > 1.09
    before = base.calculate("machine_games_duty", year).values
    after = reform.calculate("machine_games_duty", year).values
    assert before == pytest.approx([205 * f, 0, 130 * f, 0], abs=1e-3)
    assert after == pytest.approx([242.85 * f, 0, 145.14 * f, 0], abs=1e-3)
    # The change: 5 points on 75.7% of the standard-rate takings
    assert after - before == pytest.approx(
        [0.05 * SHARE * 1_000 * f, 0, 0.05 * SHARE * 400 * f, 0], abs=1e-3
    )


def test_a_share_of_one_charges_every_standard_rate_machine(survey_pair):
    """The upper bound the dashboard scored before (the standard rate at
    25%): the same rule with the share at 1."""
    base, _, path = survey_pair
    bound = build_microsimulation(
        path,
        Scenario(
            simulation_modifier=functools.partial(
                machine_games_higher_stake_rate, higher_stake_share=1.0
            )
        ),
    )
    f = gambling.projection_factor(base, "machine_games", 2029)
    change = (
        bound.calculate("machine_games_duty", 2029).values
        - base.calculate("machine_games_duty", 2029).values
    )
    assert change == pytest.approx([50 * f, 0, 20 * f, 0], abs=1e-3)


def test_the_registered_measure_is_this_modifier():
    measure = get_reform(MACHINE_GAMES_DUTY_ID)
    assert measure.simulation_modifier is machine_games_higher_stake_rate
    assert not measure.parameter_changes
    assert measure.baseline_simulation_modifier is None
    assert MACHINE_GAMES_DUTY_FROM == 2027


def test_the_share_is_the_category_b_floor():
    """75.7%: the Gambling Commission's 2024-25 Category B gaming machine
    yield (£2,289.85m) over HMRC's 2024-25 standard-rate base (£604.748m of
    liabilities at 20%), to one decimal of a per cent."""
    import inspect

    share = (
        inspect.signature(machine_games_higher_stake_rate)
        .parameters["higher_stake_share"]
        .default
    )
    assert share == SHARE
    assert round(2_289.84969448829 / (604_748e3 / 0.20 / 1e6), 3) == share


@pytest.mark.parametrize("year", [2027, 2029, 2031])
def test_the_written_rates_are_the_engines(year):
    """The modifier writes the standard and higher rates (so it reads no
    rate parameter): they are policyengine-uk's in every year it charges."""
    import inspect

    from policyengine_uk.system import system

    defaults = {
        name: parameter.default
        for name, parameter in inspect.signature(
            machine_games_higher_stake_rate
        ).parameters.items()
    }
    rates = system.parameters.gov.hmrc.gambling_duty.machine_games.rates
    for day in (f"{year}-04-06", f"{year + 1}-04-05"):
        assert rates.standard(day) == defaults["standard_rate"]
        assert rates.higher(day) == defaults["higher_rate"]


def test_an_engine_with_2731s_switch_is_refused():
    """There current law already charges the higher rate: this would
    charge it twice."""

    class Parameters:
        def get_child(self, path):
            assert path == ENGINE_SWITCH
            return object()

    sim = SimpleNamespace(
        tax_benefit_system=SimpleNamespace(parameters=Parameters())
    )
    with pytest.raises(ValueError, match="higher-stake switch"):
        machine_games_higher_stake_rate(sim)
