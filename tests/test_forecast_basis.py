"""The OBR October 2026 forecast every simulation is built on.

Checks the stored values against the EFO tables they cite, and that the
forecast reaches the baseline and the reform alike. Household simulations
only: no microsimulation.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.forecast import (
    forecast_parameter_changes,
    forecast_record,
    with_forecast,
)

OBR = "gov.economic_assumptions.yoy_growth.obr."
INPUTS = "gov.economic_assumptions.statutory_uprating_inputs."
YEARS = range(2026, 2032)

# EFO October 2026, Table A.1 (page 180), calendar years 2026 to 2031.
TABLE_A1 = {
    "consumer_price_index": [3.1, 3.4, 2.1, 2.1, 2.0, 2.0],
    "rpi": [3.6, 4.3, 3.0, 3.0, 2.3, 2.2],
    "average_earnings": [3.7, 3.0, 2.2, 2.3, 2.5, 2.6],
    "house_prices": [2.1, 2.4, 2.8, 2.8, 2.7, 2.7],
}
# Table A.2 (page 182): change since March, 2026 to 2030.
TABLE_A2 = {
    "consumer_price_index": [0.8, 1.5, 0.1, 0.1, 0.0],
    "rpi": [0.5, 1.3, 0.3, 0.1, 0.0],
    "average_earnings": [0.4, 0.6, 0.1, 0.1, 0.1],
    "house_prices": [-0.3, -0.5, 0.1, 0.2, 0.3],
}
# Table A.3 (page 182): the triple-lock guarantee, 2026-27 to 2031-32,
# the highest of Q2 earnings growth, Q3 CPI and 2.5%, in that calendar year.
TRIPLE_LOCK = {
    2026: 3.9,
    2027: 3.4,
    2028: 2.5,
    2029: 2.5,
    2030: 2.5,
    2031: 2.6,
}

H = {
    "people": {"p": {"age": {2026: 70}}},
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}


@pytest.fixture(scope="module")
def current_law():
    return Simulation(situation=H).tax_benefit_system.parameters


@pytest.fixture(scope="module")
def october():
    return Simulation(
        situation=H, scenario=with_forecast(None)
    ).tax_benefit_system.parameters


def test_stored_values_are_table_a1_to_one_decimal():
    """Tables 1.6 and 1.7 at four decimals round to Table A.1; house prices
    are Table A.1 itself."""
    changes = forecast_parameter_changes()
    for series, row in TABLE_A1.items():
        stored = changes[OBR + series]
        exact = series == "house_prices"
        assert [
            stored[f"{y}-01-01.{y}-12-31"] for y in YEARS
        ] == pytest.approx(
            [v / 100 for v in row], abs=1e-9 if exact else 0.00051
        ), series


def test_engine_march_values_are_the_same_rows(current_law):
    """October minus the change since March gives the engine's value: the
    rows chosen are the rows the engine stores (to 0.1pp rounding)."""
    for series, change in TABLE_A2.items():
        engine = current_law.get_child(OBR + series)
        for i, year in enumerate(range(2026, 2031)):
            march = TABLE_A1[series][i] - change[i]
            assert engine(f"{year}-01-01") * 100 == pytest.approx(
                march, abs=0.11
            ), (series, year)


def test_the_forecast_reaches_the_growth_rates(october):
    for series, row in TABLE_A1.items():
        for year, value in zip(YEARS, row):
            assert october.get_child(OBR + series)(
                f"{year}-01-01"
            ) == pytest.approx(value / 100, abs=0.00051), (series, year)


def test_published_statutory_inputs_are_kept(october, current_law):
    for name, instant in (
        ("cpi_september", "2026-09-01"),
        ("awe_total_pay_may_july", "2026-07-01"),
    ):
        assert october.get_child(INPUTS + name)(
            instant
        ) == current_law.get_child(INPUTS + name)(instant)
    assert october.get_child(INPUTS + "cpi_september")("2026-09-01") == 0.035
    assert (
        october.get_child(INPUTS + "awe_total_pay_may_july")("2026-07-01")
        == 0.039
    )


def test_triple_lock_matches_table_a3(october):
    def published(rate):
        return round(rate * 1000) / 10

    for year, guarantee in TRIPLE_LOCK.items():
        cpi = published(
            october.get_child(INPUTS + "cpi_september")(f"{year}-09-01")
        )
        awe = published(
            october.get_child(INPUTS + "awe_total_pay_may_july")(
                f"{year}-07-01"
            )
        )
        assert max(cpi, awe, 2.5) == pytest.approx(guarantee), year


def test_state_pension_follows_the_triple_lock(october):
    amount = october.gov.dwp.state_pension.new_state_pension.amount
    for year in range(2027, 2032):
        ratio = amount(f"{year + 1}-06-01") / amount(f"{year}-06-01")
        assert ratio == pytest.approx(
            1 + TRIPLE_LOCK[year] / 100, abs=1e-4
        ), year


def test_baseline_and_reform_get_the_same_forecast():
    """A measure that changes nothing gives the same parameters on both
    sides, and both are October's, not the engine's March."""
    baseline = Simulation(situation=H, scenario=with_forecast(None))
    reform = Simulation(
        situation=H, scenario=with_forecast(Scenario(parameter_changes={}))
    )
    path = INPUTS + "cpi_september"
    for year in range(2027, 2031):
        instant = f"{year}-09-01"
        assert baseline.tax_benefit_system.parameters.get_child(path)(
            instant
        ) == reform.tax_benefit_system.parameters.get_child(path)(instant)
    for year in (2027, 2028, 2029):
        assert baseline.calculate(
            "state_pension", year
        ).sum() == pytest.approx(reform.calculate("state_pension", year).sum())


def test_a_measure_wins_over_the_forecast():
    changed = with_forecast(
        Scenario(
            parameter_changes={OBR + "rpi": {"2030-01-01.2030-12-31": 0.05}}
        )
    )
    assert (
        changed.parameter_changes[OBR + "rpi"]["2030-01-01.2030-12-31"] == 0.05
    )
    assert (
        changed.parameter_changes[OBR + "rpi"]["2027-01-01.2027-12-31"]
        == 0.0432
    )


def test_every_simulation_route_uses_the_forecast(monkeypatch):
    """The national builder passes the forecast on every side, current law
    included."""
    from uk_budget_data import pipeline

    seen = []
    monkeypatch.setattr(
        pipeline.pe.uk,
        "managed_microsimulation",
        lambda **kwargs: seen.append(kwargs["scenario"]),
    )
    pipeline.build_microsimulation(None, None)
    pipeline.build_microsimulation(None, Scenario(parameter_changes={}))
    for scenario in seen:
        assert scenario.parameter_changes[OBR + "consumer_price_index"] == (
            forecast_parameter_changes()[OBR + "consumer_price_index"]
        )
        assert scenario.applied_before_data_load


def test_record_names_its_source():
    record = forecast_record()
    assert record["vintage"] == "OBR EFO October 2026"
    for entry in record["parameter_changes"].values():
        assert entry["source"], entry


def test_fuel_duty_path_is_the_obr_rate_then_october_rpi():
    """60.59p from April 2027 (EFO October 2026, paragraph 3.19), then each
    April the previous calendar year's October RPI, to 0.01p; the baseline
    and the fuel duty measure share it."""
    from uk_budget_data.forecast import FUEL_DUTY, fuel_duty_rpi_steps
    from uk_budget_data.reforms import FUEL_DUTY_CURRENT_LAW

    steps = dict(fuel_duty_rpi_steps())
    assert steps["2027-04-01"] == 0.6059
    rpi = forecast_parameter_changes()[OBR + "rpi"]
    for year in range(2028, 2033):
        growth = rpi[f"{year - 1}-01-01.{year - 1}-12-31"]
        expected = steps[f"{year - 1}-04-01"] * (1 + growth)
        assert steps[f"{year}-04-01"] == pytest.approx(expected, abs=5e-5)
    assert {
        day: rate for day, rate in FUEL_DUTY_CURRENT_LAW if day in steps
    } == (steps)
    changes = forecast_parameter_changes()[FUEL_DUTY]
    assert changes["2027-04-01.2028-03-31"] == 0.6059


def test_derived_series_follow_october_cpi():
    """CPI after housing costs: policyengine-uk's own derivation on the
    October CPI and rents; social rent: September CPI + 1% (England's cap),
    the published 3.5% for 2027, then the previous year's CPI to 1 d.p."""
    from policyengine_uk.utils import create_ahc_deflator as ahc

    from uk_budget_data.forecast import forecast_parameters

    changes = forecast_parameter_changes()
    indices = forecast_parameters().gov.economic_assumptions.indices
    derived = ahc.create_modified_cpi_forecast(
        indices.obr.consumer_price_index,
        indices.ofwat.water_bills,
        indices.obr.rent,
        ahc.historical_modified_cpi,
        ahc.initial_weights,
        2026,
        2031,
    )
    by_period = dict(zip(derived.period, derived.modified_cpi_yoy))
    cpi = changes[OBR + "consumer_price_index"]
    for year in YEARS:
        key = f"{year}-01-01.{year}-12-31"
        assert changes[OBR + "consumer_price_index_ahc"][key] == pytest.approx(
            by_period[f"{year}-01-01"], abs=5e-5
        ), year
        if year == 2027:
            assert changes[OBR + "social_rent"][key] == 0.045
        elif year > 2027:
            previous = cpi[f"{year - 1}-01-01.{year - 1}-12-31"]
            assert changes[OBR + "social_rent"][key] == pytest.approx(
                round(previous * 100, 1) / 100 + 0.01
            ), year


def test_council_tax_is_expenditure_table_5_1(october):
    """England's receipts: £46.806bn in 2026-27 on £44.117bn in 2025-26,
    then £49.257bn (expenditure Table 5.1)."""
    council_tax = october.gov.economic_assumptions.yoy_growth.obr.council_tax
    assert council_tax.england("2026-01-01") == pytest.approx(
        46.806 / 44.117 - 1, abs=5e-5
    )
    assert council_tax.england("2027-01-01") == pytest.approx(
        49.256614 / 46.806 - 1, abs=5e-5
    )


def test_the_installed_engine_does_not_yet_carry_the_october_forecast():
    """Tripwire (María, #290): once policyengine-uk carries the OBR October
    2026 forecast itself (PolicyEngine/policyengine-uk#2711) and the bundle
    moves to that release, this fails. Then remove the override
    (forecast/obr_october_2026.json and with_forecast) in that PR rather
    than applying the October values twice over the engine's own."""
    from policyengine_uk.system import system

    headline = ("consumer_price_index", "rpi", "average_earnings")
    stored = forecast_record()["parameter_changes"]
    matches = []
    for name in headline:
        node = system.parameters.get_child(OBR + name)
        for period, value in stored[OBR + name]["values"].items():
            day = period.split(".")[0]
            matches.append(abs(node(day) - value) < 5e-5)
    assert not all(matches), (
        "the installed policyengine-uk already carries the OBR October 2026 "
        "CPI, RPI and earnings forecast: remove the forecast override "
        "(policyengine-uk#2711)"
    )


def test_carers_allowance_earnings_limit_is_16_hours_at_the_wage(october):
    """From April 2027, 16 hours at that April's National Living Wage,
    rounded up to the pound (EM to SI 2025/352, paragraph 5.6): £212 from
    £13.21, then the OBR's wage forecast, as the taper reads it. 2026-27
    keeps the engine's £204."""
    limit = october.gov.dwp.carers_allowance.earnings_limit
    assert limit("2026-04-30") == 204
    assert {year: limit(f"{year}-04-30") for year in range(2027, 2032)} == {
        2027: 212,
        2028: 217,
        2029: 222,
        2030: 228,
        2031: 234,
    }
