"""Company car tax rates 1 point higher from 2030-31 (Budget 2026 6.207,
Table 6.1 row 86).

policyengine-uk taxes company cars from 2.165.0 (#2750). On the engine the
dashboard pins (2.151.0) the measure has no parameter changes and changes
nothing; the tests of the rates themselves run on an engine with company
cars and are skipped on one without (run them on 2.165.1).
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data import reforms
from uk_budget_data.forecast import forecast_parameters, with_forecast
from uk_budget_data.reforms import (
    APPROPRIATE_PERCENTAGE,
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    COMPANY_CAR_RATES_2030,
    COMPANY_CAR_TAX_ID,
    get_reform,
    list_reform_ids,
)

PENNY = 0.01
MODELS_CARS = reforms.models_company_cars()
needs_cars = pytest.mark.skipif(
    not MODELS_CARS,
    reason="the installed policyengine-uk has no company cars (2.165.0 on)",
)


def test_registered_and_held_back_from_the_package():
    assert COMPANY_CAR_TAX_ID in list_reform_ids()
    assert COMPANY_CAR_TAX_ID not in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS


def test_the_page_does_not_add_it_to_household_requests():
    """The Household calculator asks about no company car, so the measure
    is not one of the calculator-only ones either."""
    from pathlib import Path

    from uk_budget_data.page_measures_check import calculator_only_ids

    root = Path(__file__).resolve().parents[1]
    path = root / "src/utils/calculatorOnlyMeasures.js"
    assert COMPANY_CAR_TAX_ID not in calculator_only_ids(path)


def test_without_company_cars_in_the_engine_it_changes_nothing():
    measure = get_reform(COMPANY_CAR_TAX_ID)
    if MODELS_CARS:
        assert set(measure.parameter_changes) == set(COMPANY_CAR_RATES_2030)
    else:
        assert measure.parameter_changes is None
    assert measure.simulation_modifier is None
    assert measure.baseline_parameter_changes is None


def test_the_rates_are_the_budgets():
    """6.207: zero-emission 9% to 10%, 1 to 50 g/km 19% to 20%, every
    other band 1 point up, the maximum 40%."""
    assert COMPANY_CAR_RATES_2030[f"{APPROPRIATE_PERCENTAGE}.zero_emission"] == 0.10
    for band in range(5):
        path = f"{APPROPRIATE_PERCENTAGE}.electric_range[{band}].amount"
        assert COMPANY_CAR_RATES_2030[path] == 0.20
    assert [
        COMPANY_CAR_RATES_2030[f"{APPROPRIATE_PERCENTAGE}.co2_band[{band}].amount"]
        for band in range(5)
    ] == [0.21, 0.22, 0.23, 0.24, 0.24]
    assert COMPANY_CAR_RATES_2030[f"{APPROPRIATE_PERCENTAGE}.graduated.base_rate"] == 0.24
    assert COMPANY_CAR_RATES_2030[f"{APPROPRIATE_PERCENTAGE}.maximum"] == 0.40
    assert len(COMPANY_CAR_RATES_2030) == 13


@needs_cars
def test_each_rate_is_the_engines_2029_30_rate_plus_a_point():
    """And current law has no 2030-31 step of its own: if the engine gains
    one (the Budget in current law, say), this fails, and the measure's
    rates need re-deriving or the measure retiring."""
    tree = forecast_parameters()
    for path, value in COMPANY_CAR_RATES_2030.items():
        node = tree.get_child(path)
        assert node("2030-04-06") == pytest.approx(node("2029-04-06")), path
        assert node("2031-04-06") == pytest.approx(node("2029-04-06")), path
        assert value == pytest.approx(node("2029-04-06") + 0.01), path


@needs_cars
def test_every_band_of_both_scales_is_raised():
    tree = forecast_parameters()
    for scale in ("electric_range", "co2_band"):
        brackets = tree.get_child(f"{APPROPRIATE_PERCENTAGE}.{scale}").brackets
        assert len(brackets) == 5, scale
        for band in range(len(brackets)):
            assert (
                f"{APPROPRIATE_PERCENTAGE}.{scale}[{band}].amount"
                in COMPANY_CAR_RATES_2030
            )


@needs_cars
def test_the_changes_run_from_2030_only():
    changes = get_reform(COMPANY_CAR_TAX_ID).parameter_changes
    for path, values in changes.items():
        assert set(values) == {"2030", "2031"}, path


def _car(year, **car):
    people = {
        "p": {
            key: {year: value}
            for key, value in {
                "age": 40,
                "employment_income": 60_000,
                **car,
            }.items()
        }
    }
    return {
        "people": people,
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def _both(sit, year, variables):
    measure = get_reform(COMPANY_CAR_TAX_ID)
    sims = (
        Simulation(situation=sit, scenario=with_forecast(None)),
        Simulation(situation=sit, scenario=with_forecast(measure.to_scenario())),
    )
    return {
        variable: tuple(float(sim.calculate(variable, year).sum()) for sim in sims)
        for variable in variables
    }


VARIABLES = (
    "company_car_appropriate_percentage",
    "company_car_benefit",
    "income_tax",
    "ni_class_1a",
)

# Each car on £60,000 of pay in 2030-31, so every extra pound of benefit is
# taxed at 40%, and Class 1A is 15% of it.
# (list price, fuel, CO2 g/km, percentage before, after)
CARS = {
    # 23% at 75 g/km plus floor(45 / 5) = 9 points
    "petrol at 120 g/km": (30_000, "PETROL", 120, 0.32, 0.33),
    "electric": (40_000, "ELECTRIC", 0, 0.09, 0.10),
    "petrol at 62 g/km": (30_000, "PETROL", 62, 0.22, 0.23),
    # 23% + 25 points = 48%, capped at the maximum
    "petrol at 200 g/km": (50_000, "PETROL", 200, 0.39, 0.40),
    # 23% + 5 points + the 4-point diesel supplement
    "diesel without RDE2 at 100 g/km": (25_000, "DIESEL_NON_RDE2", 100, 0.32, 0.33),
    # 23% + 17 + 4 = 44%, capped: the rise reaches it through the maximum
    "diesel without RDE2 at 160 g/km": (25_000, "DIESEL_NON_RDE2", 160, 0.39, 0.40),
}


@needs_cars
@pytest.mark.parametrize("name", CARS)
def test_hand_computed_cars_in_2030_31(name):
    price, fuel, co2, before, after = CARS[name]
    sit = _car(
        2030,
        company_car_list_price=price,
        company_car_fuel_type=fuel,
        company_car_co2_emissions=co2,
    )
    got = _both(sit, 2030, VARIABLES)
    assert got["company_car_appropriate_percentage"] == (
        pytest.approx(before, abs=1e-6),
        pytest.approx(after, abs=1e-6),
    )
    benefit = (price * before, price * after)
    assert got["company_car_benefit"] == (
        pytest.approx(benefit[0], abs=PENNY),
        pytest.approx(benefit[1], abs=PENNY),
    )
    extra = price * 0.01
    tax_before, tax_after = got["income_tax"]
    assert tax_after - tax_before == pytest.approx(0.40 * extra, abs=PENNY)
    ni_before, ni_after = got["ni_class_1a"]
    assert ni_before == pytest.approx(0.15 * benefit[0], abs=PENNY)
    assert ni_after - ni_before == pytest.approx(0.15 * extra, abs=PENNY)


@needs_cars
def test_the_30000_petrol_car_pays_120_more_in_2030_31():
    """The worked case: £9,600 to £9,900 of benefit, £120 more income tax
    and £45 more Class 1A for the employer."""
    sit = _car(
        2030,
        company_car_list_price=30_000,
        company_car_fuel_type="PETROL",
        company_car_co2_emissions=120,
    )
    got = _both(sit, 2030, VARIABLES)
    assert got["company_car_benefit"] == (
        pytest.approx(9_600, abs=PENNY),
        pytest.approx(9_900, abs=PENNY),
    )
    assert got["income_tax"][1] - got["income_tax"][0] == pytest.approx(
        120, abs=PENNY
    )
    assert got["ni_class_1a"][1] - got["ni_class_1a"][0] == pytest.approx(
        45, abs=PENNY
    )


@needs_cars
@pytest.mark.parametrize("year", [2026, 2027, 2028, 2029])
def test_nothing_changes_before_2030_31(year):
    sit = _car(
        year,
        company_car_list_price=30_000,
        company_car_fuel_type="PETROL",
        company_car_co2_emissions=120,
        company_car_private_fuel_provided=True,
    )
    got = _both(sit, year, (*VARIABLES, "car_fuel_benefit"))
    for variable, (before, after) in got.items():
        assert after == pytest.approx(before, abs=PENNY), (variable, year)


@needs_cars
def test_the_car_fuel_benefit_rises_with_the_percentage():
    """s. 150: the fuel multiplier times the appropriate percentage, so 1
    point more is 1% of the multiplier more."""
    sit = _car(
        2030,
        company_car_list_price=30_000,
        company_car_fuel_type="PETROL",
        company_car_co2_emissions=120,
        company_car_private_fuel_provided=True,
    )
    multiplier = forecast_parameters().get_child(
        "gov.hmrc.income_tax.benefits_in_kind.car_fuel.multiplier"
    )("2030-04-06")
    before, after = _both(sit, 2030, ("car_fuel_benefit",))["car_fuel_benefit"]
    assert before == pytest.approx(0.32 * multiplier, abs=1)
    assert after - before == pytest.approx(0.01 * multiplier, abs=1)
