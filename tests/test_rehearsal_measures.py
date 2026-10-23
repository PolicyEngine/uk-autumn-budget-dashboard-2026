"""The rehearsal's mock measures (MOCK DATA): what each one writes."""

import pytest

from uk_budget_data.rehearsal_registry import (
    FUEL_DUTY_2027_28,
    rehearsal_reforms,
)

MEASURES = {reform.id: reform for reform in rehearsal_reforms()}


def test_nine_coded_lines_are_registered():
    assert len(MEASURES) == 9


@pytest.mark.parametrize(
    "measure, path, year, value",
    [
        (
            "mock_additional_rate_threshold",
            "gov.hmrc.income_tax.rates.uk[2].threshold",
            "2027",
            100_000,
        ),
        (
            "mock_cgt_aea_and_higher_rate",
            "gov.hmrc.cgt.higher_rate",
            "2027",
            0.26,
        ),
        (
            "mock_cgt_aea_and_higher_rate",
            "gov.hmrc.cgt.annual_exempt_amount",
            "2030",
            1_500,
        ),
        (
            "mock_salary_sacrifice_cap_2028",
            "gov.hmrc.national_insurance.salary_sacrifice_pension_cap",
            "2028",
            2_000,
        ),
        (
            "mock_employer_nics_threshold",
            "gov.hmrc.national_insurance.class_1.thresholds.secondary_threshold",
            "2027",
            5_500 / 52,
        ),
        (
            "mock_fuel_duty_cut_extended",
            "gov.hmrc.fuel_duty.petrol_and_diesel",
            "2026",
            0.5295,
        ),
        (
            "mock_state_pension_4_5pc",
            "gov.dwp.state_pension.new_state_pension.amount",
            "2027",
            252.15,
        ),
        (
            "mock_uc_taper_50pc",
            "gov.dwp.universal_credit.means_test.reduction_rate",
            "2028",
            0.50,
        ),
    ],
)
def test_each_measure_writes_the_package_value(measure, path, year, value):
    assert MEASURES[measure].parameter_changes[path][year] == pytest.approx(
        value
    )


def test_fuel_duty_2027_28_is_the_day_weighted_average():
    """153 days at 52.95p and 213 at 57.95p, of 366 (2027-28 includes 29
    February 2028)."""
    assert FUEL_DUTY_2027_28 == pytest.approx(0.558598, abs=1e-6)
    assert 0.5295 < FUEL_DUTY_2027_28 < 0.5795
