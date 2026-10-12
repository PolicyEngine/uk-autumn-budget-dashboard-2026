"""Regressions for the third review of the measure templates (12 Oct).

Each reproduces a case the reviewer executed against the formula wrappers:
two allowance measures composing, a previous formula that takes two
arguments, and a channel whose formula is monthly.
"""

import pytest
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk import Simulation
from policyengine_uk.model_api import Variable
from policyengine_uk.utils.scenario import _apply_reform_class

from uk_budget_data.measure_templates import (
    apply_age_conditioned_allowance,
    apply_property_band_surcharge,
    apply_vat_base_change,
)


def _pensioner():
    return Simulation(
        situation={
            "people": {
                "p": {
                    "age": {2028: 75},
                    "private_pension_income": {2028: 30_000},
                    "is_disabled_for_benefits": {2028: True},
                }
            },
            "benunits": {"b": {"members": ["p"]}},
            "households": {
                "h": {"members": ["p"], "region": {2028: "LONDON"}}
            },
        }
    )


@pytest.mark.parametrize(
    "measures",
    [
        [(20_000, "is_SP_age"), (15_000, "is_disabled_for_benefits")],
        [(15_000, "is_disabled_for_benefits"), (20_000, "is_SP_age")],
    ],
)
def test_two_allowance_measures_keep_the_larger_allowance(measures):
    """A second eligible allowance used to replace the first, whatever
    their sizes: a disabled pensioner lost £5,000 of allowance."""
    sim = _pensioner()
    for amount, eligibility in measures:
        apply_age_conditioned_allowance(
            sim,
            allowance_by_year={2028: amount},
            taper_threshold=24_000,
            taper_rate=0,
            eligibility_variable=eligibility,
        )
    assert sim.calculate("personal_allowance", 2028)[0] == 20_000


def _household(year=2027):
    return Simulation(
        situation={
            "people": {"p": {"age": {year: 40}}},
            "benunits": {"b": {"members": ["p"]}},
            "households": {
                "h": {
                    "members": ["p"],
                    "region": {year: "LONDON"},
                    "tenure_type": {year: "OWNED_OUTRIGHT"},
                    "main_residence_value": {year: 1_200_000},
                    "domestic_energy_consumption": {year: 1_680},
                }
            },
        }
    )


def _two_argument_formula(household, period):
    return household.empty_array() + 100


def _with_two_argument_formula(sim, channel):
    replacement = type(
        channel,
        (Variable,),
        {"formula": _two_argument_formula, "__module__": __name__},
    )

    class Prior(CoreReform):
        def apply(self):
            self.update_variable(replacement)

    _apply_reform_class(Prior, sim)
    assert sim.calculate(channel, 2027)[0] == 100
    return sim


def test_a_two_argument_previous_formula_is_called_as_core_calls_it():
    """policyengine-core runs a two-argument formula without parameters;
    the wrappers passed three arguments and raised."""
    sim = _with_two_argument_formula(_household(), "vat")
    apply_vat_base_change(
        sim,
        spending_variable="domestic_energy_consumption",
        rate_change=-0.025,
        start_year=2027,
        end_year=2027,
    )
    assert sim.calculate("vat", 2027)[0] == pytest.approx(60.0)

    sim = _with_two_argument_formula(
        _household(), "high_value_council_tax_surcharge"
    )
    apply_property_band_surcharge(
        sim,
        lower_bound=0,
        upper_bound=2_000_000,
        amount=900,
        start_year=2027,
        end_year=2027,
    )
    assert sim.calculate("high_value_council_tax_surcharge", 2027)[
        0
    ] == pytest.approx(1_000.0)


def test_a_monthly_channel_is_refused_for_an_annual_surcharge():
    """A monthly channel added the annual amount every month: twelve times
    the surcharge."""
    with pytest.raises(ValueError, match="must be annual"):
        apply_property_band_surcharge(
            _household(),
            lower_bound=0,
            upper_bound=2_000_000,
            amount=900,
            start_year=2027,
            end_year=2027,
            channel="fuel_duty",
        )
