"""Property surcharge bands follow the native formula's valuation index."""

import numpy as np
import pytest
from policyengine_core.parameters import Parameter
from policyengine_core.periods import YEAR
from policyengine_core.variables import Variable
from policyengine_uk import Simulation
from policyengine_uk.entities import Household

from uk_budget_data.measure_templates import apply_property_band_surcharge

CHANNEL = "high_value_council_tax_surcharge"
# This non-round ratio exposes inverse-division error at a float32 boundary.
HOUSE_PRICE_GROWTH = 1.0485928592859286


def gdp_formula(household, period, parameters):
    current = parameters(
        period
    ).gov.economic_assumptions.indices.obr.per_capita.gdp
    base = parameters(
        "2026"
    ).gov.economic_assumptions.indices.obr.per_capita.gdp
    value = household("main_residence_value", period) / (current / base)
    return (value >= 2_000_000) * 1500


def house_price_formula(household, period, parameters):
    current = parameters(
        period
    ).gov.economic_assumptions.indices.obr.house_prices
    base = parameters("2026").gov.economic_assumptions.indices.obr.house_prices
    value = household("main_residence_value", period)
    boundary = np.asarray(2_000_000, dtype=value.dtype) * (current / base)
    return (value >= boundary) * 1500


def neither_formula(household, period, parameters):
    """Naming gdp and house_prices is not reading either index."""
    names = "gdp house_prices"
    return household("main_residence_value", period) * 0 + len(names)


def both_formula(household, period, parameters):
    obr = parameters(period).gov.economic_assumptions.indices.obr
    return household("main_residence_value", period) * 0 + (
        obr.per_capita.gdp + obr.house_prices
    )


def nested_formula(household, period, parameters):
    def index():
        return parameters(
            period
        ).gov.economic_assumptions.indices.obr.house_prices

    return household("main_residence_value", period) * 0 * index()


def with_formulas(**formulas):
    """Install exactly these own formulas, as in ``test_model_limits``.

    Core merges a class with no own formulas with the baseline's formulas;
    such a class cannot stand in for an unrecognised native index.
    """
    variable = type(
        CHANNEL,
        (Variable,),
        {
            "entity": Household,
            "definition_period": YEAR,
            "value_type": float,
            "label": "Property surcharge (a stand-in)",
            **formulas,
        },
    )

    def modifier(sim):
        sim.tax_benefit_system.update_variable(variable)

    return modifier


def simulation(*, year=2028, value=1_500_000, **formulas):
    values = np.atleast_1d(value)
    sim = Simulation(
        situation={
            "people": {
                f"p{i}": {"age": {year: 40}} for i in range(len(values))
            },
            "benunits": {
                f"b{i}": {"members": [f"p{i}"]} for i in range(len(values))
            },
            "households": {
                f"h{i}": {
                    "members": [f"p{i}"],
                    "region": {year: "LONDON"},
                    "tenure_type": {year: "OWNED_OUTRIGHT"},
                    "main_residence_value": {year: float(amount)},
                }
                for i, amount in enumerate(values)
            },
        }
    )
    with_formulas(**formulas)(sim)
    obr = (
        sim.tax_benefit_system.parameters.gov.economic_assumptions.indices.obr
    )
    if "house_prices" not in obr.children:
        obr.add_child(
            "house_prices",
            Parameter(
                "gov.economic_assumptions.indices.obr.house_prices",
                {
                    "values": {
                        "2026-01-01": 1.0,
                        "2028-01-01": HOUSE_PRICE_GROWTH,
                    }
                },
            ),
        )
    obr.house_prices.update(period="2026", value=1.0)
    obr.house_prices.update(period="2028", value=HOUSE_PRICE_GROWTH)
    sim.tax_benefit_system._parameters_at_instant_cache.clear()
    return sim


def add_band(sim, *, start_year=2028, end_year=2028):
    return apply_property_band_surcharge(
        sim,
        lower_bound=1_000_000,
        upper_bound=2_000_000,
        amount=900,
        start_year=start_year,
        end_year=end_year,
    )


@pytest.mark.parametrize(
    "formula, reason", [(neither_formula, "neither"), (both_formula, "both")]
)
def test_unrecognised_or_ambiguous_native_index_is_refused(formula, reason):
    sim = simulation(formula=formula)
    assert list(
        sim.tax_benefit_system.variables[CHANNEL].formulas.values()
    ) == [formula]
    with pytest.raises(ValueError, match=f"exactly one.*{reason}"):
        add_band(sim)


@pytest.mark.parametrize("formula", [gdp_formula, house_price_formula])
def test_band_edges_use_the_native_index(formula):
    from policyengine_uk.system import system

    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    growth = (
        gdp("2028") / gdp("2026")
        if formula is gdp_formula
        else HOUSE_PRICE_GROWTH
    )
    base_boundaries = np.asarray([1_000_000, 2_000_000], dtype=np.float32)
    boundaries = np.asarray(base_boundaries * growth, dtype=np.float32)
    if formula is gdp_formula:
        # Inflation and deflation are not exact inverses in float32. Find
        # the first stored value reaching each native deflated boundary.
        below = boundaries / growth < base_boundaries
        while np.any(below):
            boundaries[below] = np.nextafter(
                boundaries[below], np.float32(np.inf)
            )
            below = boundaries / growth < base_boundaries
        previous = np.nextafter(boundaries, np.float32(-np.inf))
        reaches = previous / growth >= base_boundaries
        while np.any(reaches):
            boundaries[reaches] = previous[reaches]
            previous = np.nextafter(boundaries, np.float32(-np.inf))
            reaches = previous / growth >= base_boundaries
        assert np.all(boundaries / growth >= base_boundaries)
        assert np.all(previous / growth < base_boundaries)
    values = np.stack(
        [
            np.nextafter(boundaries, np.float32(-np.inf)),
            boundaries,
            np.nextafter(boundaries, np.float32(np.inf)),
        ],
        axis=1,
    ).ravel()
    sim = simulation(formula=formula, value=values)
    np.testing.assert_array_equal(
        sim.calculate(CHANNEL, 2028), [0, 0, 0, 0, 1500, 1500]
    )
    add_band(sim)
    np.testing.assert_array_equal(
        sim.calculate(CHANNEL, 2028), [0, 900, 900, 900, 1500, 1500]
    )
    # A second band follows the same native index through our first wrapper.
    add_band(sim)
    np.testing.assert_array_equal(
        sim.calculate(CHANNEL, 2028), [0, 1800, 1800, 1800, 1500, 1500]
    )


def test_nested_compiled_code_reading_the_index_is_recognised():
    sim = simulation(formula=nested_formula)
    add_band(sim)
    assert float(np.asarray(sim.calculate(CHANNEL, 2028)).sum()) == 900


@pytest.mark.parametrize("year", [2027, 2028])
def test_dated_native_formulas_select_the_index_for_each_changed_year(year):
    from policyengine_uk.system import system

    gdp = system.parameters.gov.economic_assumptions.indices.obr.per_capita.gdp
    growth = gdp("2027") / gdp("2026") if year == 2027 else HOUSE_PRICE_GROWTH
    value = 1_900_000 * growth
    sim = simulation(
        year=year,
        value=value,
        formula=gdp_formula,
        formula_2028=house_price_formula,
    )
    add_band(sim, start_year=2027, end_year=2028)
    assert float(np.asarray(sim.calculate(CHANNEL, year)).sum()) == 900


def test_projected_house_price_edges_preserve_the_native_stored_precision():
    boundaries = np.asarray([1_000_000, 2_000_000], dtype=np.float32)
    boundaries *= HOUSE_PRICE_GROWTH
    values = np.stack(
        [
            np.nextafter(boundaries, np.float32(-np.inf)),
            boundaries,
            np.nextafter(boundaries, np.float32(np.inf)),
        ],
        axis=1,
    ).ravel()
    sim = simulation(formula=house_price_formula, value=values)
    add_band(sim)
    np.testing.assert_array_equal(
        sim.calculate(CHANNEL, 2028), [0, 900, 900, 900, 1500, 1500]
    )


def test_an_unrecognised_dated_formula_refuses_the_whole_band():
    sim = simulation(formula=gdp_formula, formula_2029=neither_formula)
    with pytest.raises(ValueError, match="2029.*neither"):
        add_band(sim, start_year=2028, end_year=2029)


def test_a_class_with_no_own_formulas_retains_the_installed_native_index():
    sim = simulation()
    assert sim.tax_benefit_system.variables[CHANNEL].formulas
    add_band(sim)
    assert float(np.asarray(sim.calculate(CHANNEL, 2028)).sum()) == 900
