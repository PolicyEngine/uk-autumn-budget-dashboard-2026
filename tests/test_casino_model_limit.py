"""Preserve the native statutory-casino gap after the input limit retires."""

from types import SimpleNamespace

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import model_limits

KEY = "casino_statutory_gaming_bands"
BANDS = "gov.hmrc.gambling_duty.gaming.normal_six_month_bands[2].threshold"
EFFECTIVE = "household.consumption.gambling.casino_effective_rate"


def one(changes=None, stored=False):
    household = {
        "members": ["p"],
        "land_based_casino_net_losses": {2027: 1_000},
    }
    if stored:
        household["gaming_duty"] = {2027: 1}
    return Simulation(
        situation={
            "people": {"p": {"age": {2027: 40}}},
            "benunits": {"b": {"members": ["p"]}},
            "households": {"h": household},
        },
        scenario=Scenario(parameter_changes=changes) if changes else None,
    )


def test_the_review_hold_has_no_positive_native_evidence():
    assert model_limits._CASINO_REVIEWED_NATIVE_SUPPORT == ()
    assert not model_limits._casino_statutory_bands_reviewed(system)
    limit = next(item for item in model_limits.MODEL_LIMITS if item.key == KEY)
    assert limit.variables == ("gaming_duty",)
    assert limit.stored_inputs_only is True
    assert limit.parameters == ("gov.hmrc.gambling_duty.gaming",)


def test_native_source_change_requires_explicit_expiry_review():
    assert model_limits._casino_native_source_digest(system) == (
        model_limits._CASINO_KNOWN_UNSUPPORTED_SOURCE
    ), "Native casino source changed: review real statutory-band support before changing the hold"


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_statutory_bands_are_held_on_both_sides(side):
    plain, changed = one(), one({BANDS: {2027: 1}})
    calculate_casino_and_net_income(plain, changed)
    args = (changed, plain) if side == "baseline" else (plain, changed)
    assert KEY in {item["key"] for item in model_limits.limits_touched(*args)}


def calculate_casino_and_net_income(*simulations):
    """The production detector runs after figures have populated caches."""
    for simulation in simulations:
        simulation.calculate("gaming_duty", 2027)
        simulation.calculate("household_net_income", 2027)


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_a_supported_effective_rate_change_is_not_a_statutory_band_hold(side):
    value = system.parameters.get_child(EFFECTIVE)("2027-04-30")
    baseline, reformed = one(), one({EFFECTIVE: {2027: value + 0.01}})
    calculate_casino_and_net_income(baseline, reformed)
    assert baseline.calculate("gaming_duty", 2027)[0] > 0
    assert (
        reformed.calculate("gaming_duty", 2027)[0]
        != baseline.calculate("gaming_duty", 2027)[0]
    )
    pair = (reformed, baseline) if side == "baseline" else (baseline, reformed)
    touched = model_limits.limits_touched(*pair)
    assert KEY not in {item["key"] for item in touched}


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_effective_rate_does_not_waive_an_unsupported_band_change(side):
    value = system.parameters.get_child(EFFECTIVE)("2027-04-30")
    baseline = one()
    reformed = one(
        {
            EFFECTIVE: {2027: value + 0.01},
            BANDS: {2027: 1},
        }
    )
    calculate_casino_and_net_income(baseline, reformed)
    pair = (reformed, baseline) if side == "baseline" else (baseline, reformed)
    assert KEY in {item["key"] for item in model_limits.limits_touched(*pair)}


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_a_stored_casino_result_cannot_bypass_the_model_hold(side):
    plain, changed = one(), one(stored=True)
    calculate_casino_and_net_income(plain, changed)
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    assert KEY in {item["key"] for item in model_limits.limits_touched(*pair)}


def zero_casino(household, period, parameters):
    return household.filled_array(0)


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_a_changed_casino_formula_stays_held_after_calculation(side):
    from uk_budget_data.measure_templates import _replace_formula

    plain, changed = one(), one()
    _replace_formula(changed, "gaming_duty", zero_casino)
    calculate_casino_and_net_income(plain, changed)
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    assert KEY in {item["key"] for item in model_limits.limits_touched(*pair)}


def test_unknown_and_forged_support_do_not_expire_the_hold():
    unknown = SimpleNamespace()
    forged = SimpleNamespace(
        get_variable=system.get_variable,
        casino_statutory_bands_supported=True,
        reviewed_native_support=True,
        policyengine_uk_version="reviewed",
    )
    assert not model_limits._casino_statutory_bands_reviewed(unknown)
    assert not model_limits._casino_statutory_bands_reviewed(forged)


def test_model_parameter_presence_is_not_capability_evidence():
    assert system.parameters.get_child(BANDS.split("[")[0]) is not None
    assert not model_limits._installed_casino_statutory_bands_reviewed()
