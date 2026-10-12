"""Household regressions for the pinned native engine, without reforms."""

import math

import pytest
from policyengine_uk import Simulation

# Native weekly Class 1 and annual Class 4 bands; never install local fixes.
NATIVE_NIC_THRESHOLDS = {
    (
        "gov.hmrc.national_insurance.class_1.thresholds." "primary_threshold"
    ): 241.73,
    (
        "gov.hmrc.national_insurance.class_1.thresholds."
        "upper_earnings_limit"
    ): 966.73,
    (
        "gov.hmrc.national_insurance.class_4.thresholds." "lower_profits_limit"
    ): 12_570,
    (
        "gov.hmrc.national_insurance.class_4.thresholds." "upper_profits_limit"
    ): 50_270,
}


def earnings_situation(year, *, employment=0, self_employment=0):
    """Hold assessable income fixed to isolate the four NIC bands."""
    return {
        "people": {
            "person": {
                "age": {year: 40},
                "employment_income": {year: employment},
                "ni_class_1_income": {year: employment},
                "self_employment_income": {year: self_employment},
            }
        },
        "benunits": {"benunit": {"members": ["person"]}},
        "households": {"household": {"members": ["person"]}},
    }


@pytest.mark.parametrize("year", range(2026, 2031))
@pytest.mark.parametrize("income_source", ["employee", "self_employed"])
def test_native_nics_match_all_four_frozen_bands(year, income_source):
    """The native freeze includes both lower and upper contribution bands.

    Class 1 annualises its weekly bands with 52 weeks. Class 4 uses annual
    bands. Testing income above both upper bands catches a lower-only fix.
    """
    employee = income_source == "employee"
    sim = Simulation(
        situation=earnings_situation(
            year,
            employment=60_000 if employee else 0,
            self_employment=0 if employee else 60_000,
        )
    )
    parameters = sim.tax_benefit_system.parameters
    for path, expected in NATIVE_NIC_THRESHOLDS.items():
        assert parameters.get_child(path)(f"{year}-01-01") == (
            pytest.approx(expected)
        )
    expected = (
        (966.73 - 241.73) * 52 * 0.08 + (60_000 - 966.73 * 52) * 0.02
        if employee
        else (50_270 - 12_570) * 0.06 + (60_000 - 50_270) * 0.02
    )
    actual = float(sim.calculate("national_insurance", year)[0])
    assert math.isfinite(actual)
    assert actual == pytest.approx(expected, abs=0.01)


@pytest.mark.parametrize("income_source", ["employee", "self_employed"])
def test_native_nics_resume_uprating_in_2031(income_source):
    """UK 2.125.1 resumes CPI uprating in FY 2031-32, after the freeze.

    Model 2031 is a policy year in this dashboard, but its native NIC bands
    are no longer frozen. Keep this boundary explicit instead of silently
    extending the old regression or installing a local threshold override.
    """
    employee = income_source == "employee"
    sim = Simulation(
        situation=earnings_situation(
            2031,
            employment=60_000 if employee else 0,
            self_employment=0 if employee else 60_000,
        )
    )
    parameters = sim.tax_benefit_system.parameters
    thresholds = {
        path: parameters.get_child(path)("2031-01-01")
        for path in NATIVE_NIC_THRESHOLDS
    }
    cpi = parameters.gov.economic_assumptions.indices.obr.consumer_price_index
    uprating_factor = cpi("2031-01-01") / cpi("2030-01-01")
    assert uprating_factor > 1
    for path, frozen in NATIVE_NIC_THRESHOLDS.items():
        assert thresholds[path] == pytest.approx(frozen * uprating_factor)
    primary, upper, lower_profits, upper_profits = thresholds.values()
    expected = (
        (upper - primary) * 52 * 0.08 + (60_000 - upper * 52) * 0.02
        if employee
        else (upper_profits - lower_profits) * 0.06
        + (60_000 - upper_profits) * 0.02
    )
    actual = float(sim.calculate("national_insurance", 2031)[0])
    assert math.isfinite(actual)
    assert actual == pytest.approx(expected, abs=0.01)


def pensioner_situation(year, *, claims_pension_credit):
    """Express the household claim choice through the engine's native flag."""
    return {
        "people": {
            "person": {
                "age": {year: 75},
                "state_pension_type": {year: "NEW"},
                "state_pension_reported": {year: 5_000},
            }
        },
        "benunits": {
            "benunit": {
                "members": ["person"],
                "would_claim_pc": {year: claims_pension_credit},
            }
        },
        "households": {"household": {"members": ["person"]}},
    }


@pytest.mark.parametrize("year", [2026, 2031])
def test_false_pension_credit_claim_flag_stops_payment(year):
    """An otherwise entitled pensioner receives nothing when not claiming.

    The household field ``claims_pension_credit`` maps to the benefit-unit
    input ``would_claim_pc``. Entitlement stays positive, so the zero receipt
    cannot pass just because the synthetic household is ineligible.
    """
    claimant = Simulation(
        situation=pensioner_situation(year, claims_pension_credit=True)
    )
    nonclaimant = Simulation(
        situation=pensioner_situation(year, claims_pension_credit=False)
    )
    entitlement = float(
        nonclaimant.calculate("pension_credit_entitlement", year)[0]
    )
    assert entitlement > 0
    assert float(claimant.calculate("pension_credit", year)[0]) > 0
    assert claimant.calculate("in_receipt_of_guarantee_credit", year)[0]
    assert not nonclaimant.calculate("would_claim_pc", year)[0]
    assert float(nonclaimant.calculate("pension_credit", year)[0]) == 0
    assert not nonclaimant.calculate("in_receipt_of_guarantee_credit", year)[0]
    # TODO(household-route): regress False through the HTTP request and an
    # unchecked form checkbox, preserving its mapping to would_claim_pc.
