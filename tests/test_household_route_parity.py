"""A template's change moves households as it moves the national figure.

The household calculator (``personal_impact.create_simulation``) builds its
simulations with the national run's ``Scenario`` (#32), so a change reaches
a household whichever dates its formulas read the parameter on
(``tests/test_household_calculator_route.py`` checks the registered
measures and raw changes). Before #32 it wrote each value on 1 January
afterwards, and the templates refused the duties kept on their statutory
dates because no household would have seen them.

This is the same differential for changes the templates build, one for
each way a formula reads a parameter. #3's household route,
``calculate_personal_net_income``, showed the fuel and beer gaps in W5's
15 October probe; point these tests at it if it replaces this one.
"""

import pytest

from tests.test_household_calculator_route import (
    LCWRA_CLAIMANT,
    _impact,
    _national,
    same,
    situation,
)
from uk_budget_data import personal_impact
from uk_budget_data.measure_templates import rate_change, threshold_change
from uk_budget_data.models import Reform

ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
BEER_DRINKER = {
    "people": {"p": {"age": {2027: 40}}},
    "benunits": {"b": {"members": ["p"]}},
    "households": {
        "h": {
            "members": ["p"],
            "beer_litres": {2027: 100},
            "beer_abv": {2027: 0.05},
            "beer_draught_share": {2027: 0},
        }
    },
}


@pytest.mark.parametrize(
    "build, path, value, year, variable, probe",
    [
        # Monthly: fuel_duty reads the 1st of each month.
        (
            rate_change,
            "gov.hmrc.fuel_duty.petrol_and_diesel",
            0.90,
            2027,
            "household_net_income",
            None,
        ),
        # Monthly, and denominated weekly.
        (
            rate_change,
            "gov.hmrc.child_benefit.amount.eldest",
            50,
            2027,
            "child_benefit",
            None,
        ),
        # Monthly: employee Class 1 NICs.
        (
            rate_change,
            "gov.hmrc.national_insurance.class_1.rates.employee.main",
            0.10,
            2027,
            "national_insurance",
            None,
        ),
        # Yearly: read on the model year's first day.
        (threshold_change, ALLOWANCE, 20_000, 2027, "income_tax", None),
        # Derived: the NIC thresholds follow the allowance after the freeze.
        (
            threshold_change,
            ALLOWANCE,
            20_000,
            2031,
            "national_insurance",
            None,
        ),
        # Read while the simulation is built (UC rebalancing).
        (
            threshold_change,
            "gov.dwp.universal_credit.rebalancing.new_claimant_health_element",
            500,
            2027,
            "uc_LCWRA_element",
            LCWRA_CLAIMANT,
        ),
        # Kept on its statutory dates; the templates refused it before #32.
        (
            rate_change,
            "gov.hmrc.alcohol_duty.rates.beer",
            30,
            2027,
            "beer_duty",
            BEER_DRINKER,
        ),
    ],
    ids=[
        "monthly fuel duty",
        "monthly child benefit",
        "monthly employee NICs",
        "yearly allowance",
        "post-freeze NICs",
        "UC health element",
        "beer duty on its statutory dates",
    ],
)
def test_a_built_change_moves_households_as_the_national_figure(
    build, path, value, year, variable, probe
):
    """Differential: the household calculator's impact equals the national
    route's for a change the template built, and some household moves, so
    the comparison is not of two zeros."""
    measure = Reform(
        id="template",
        name="Template",
        parameter_changes=build(path, {year: value}),
    )
    probe = probe or situation(year)
    household = _impact(
        lambda changes, modifier: personal_impact.create_simulation(
            probe,
            year,
            reform_param_changes=changes,
            simulation_modifier=modifier,
        ),
        measure,
        year,
        variable,
    )
    national = _impact(
        lambda changes, modifier: _national(probe, changes, modifier),
        measure,
        year,
        variable,
    )
    assert same(household, national)
    assert any(abs(change) > 1 for change in household)


def test_a_duty_kept_on_its_statutory_dates_is_built():
    """The templates accept the alcohol duties now that households see
    them (review round 8 of #23 found a beer template moved the national
    figure and no household's)."""
    built = rate_change("gov.hmrc.alcohol_duty.rates.beer", {2027: 30})
    assert built == {"gov.hmrc.alcohol_duty.rates.beer": {"2027": 30.0}}
