"""The 23 October rehearsal's registry: the mock measures only (MOCK DATA).

reforms.py returns these instead of last year's measures on the rehearsal
branch, which is never merged. Each measure is a MOCK Table 4.1 line from
package A; keys are fiscal years (2027 is 2027-28).
"""

from uk_budget_data.measure_templates import rate_change, threshold_change
from uk_budget_data.models import Reform
from uk_budget_data.rehearsal_measures import hvcts_band_modifier

FROM_2027 = (2027, 2028, 2029, 2030)

# MOCK line 12: fiscal-year averages of the package's dated main rates
# (pence per litre / 100). 2026-27 keeps 52.95p all year (the January and
# March 2027 rises are cancelled); 2027-28 has 52.95p for 1 April to 31
# August 2027 (153 days) and 57.95p for 1 September 2027 to 31 March 2028
# (213 days of 366); RPI uprating then gives 59.69p, 61.36p and 63.14p.
FUEL_DUTY_2027_28 = (153 * 0.5295 + 213 * 0.5795) / 366


def _merge(*changes: dict) -> dict:
    merged: dict = {}
    for change in changes:
        merged.update(change)
    return merged


def rehearsal_reforms() -> list[Reform]:
    """The mock package's coded measures, in the order the page lists them."""
    return [
        Reform(
            id="mock_additional_rate_threshold",
            name="Additional rate threshold £100,000 (MOCK)",
            parameter_changes=_merge(
                threshold_change(
                    "gov.hmrc.income_tax.rates.uk[2].threshold",
                    {year: 100_000 for year in FROM_2027},
                ),
                threshold_change(
                    "gov.hmrc.income_tax.rates.dividends[2].threshold",
                    {year: 100_000 for year in FROM_2027},
                ),
            ),
        ),
        Reform(
            id="mock_cgt_aea_and_higher_rate",
            name="CGT: exempt amount halved, higher rate 26% (MOCK)",
            parameter_changes=_merge(
                threshold_change(
                    "gov.hmrc.cgt.annual_exempt_amount",
                    {year: 1_500 for year in FROM_2027},
                ),
                *(
                    rate_change(path, {year: 0.26 for year in FROM_2027})
                    for path in (
                        "gov.hmrc.cgt.higher_rate",
                        "gov.hmrc.cgt.additional_rate",
                        "gov.hmrc.cgt.residential_property.higher_rate",
                        "gov.hmrc.cgt.residential_property.additional_rate",
                    )
                ),
            ),
        ),
        Reform(
            id="mock_pensions_annual_allowance",
            name="Pensions annual allowance £40,000 (MOCK)",
            parameter_changes=_merge(
                threshold_change(
                    "gov.hmrc.income_tax.allowances.annual_allowance.default",
                    {year: 40_000 for year in FROM_2027},
                ),
                threshold_change(
                    "gov.hmrc.income_tax.allowances.annual_allowance.taper",
                    {year: 200_000 for year in FROM_2027},
                ),
            ),
        ),
        Reform(
            id="mock_salary_sacrifice_cap_2028",
            name="Salary sacrifice NICs cap from April 2028 (MOCK)",
            parameter_changes=threshold_change(
                "gov.hmrc.national_insurance.salary_sacrifice_pension_cap",
                {2028: 2_000, 2029: 2_000, 2030: 2_000},
            ),
        ),
        Reform(
            id="mock_hvcts_band",
            name="HVCTS band £1.5m to £2m (MOCK)",
            simulation_modifier=hvcts_band_modifier,
        ),
        Reform(
            id="mock_employer_nics_threshold",
            name="Employer NICs threshold £5,500 (MOCK)",
            parameter_changes=threshold_change(
                "gov.hmrc.national_insurance.class_1.thresholds."
                "secondary_threshold",
                {year: 5_500 / 52 for year in FROM_2027},
            ),
        ),
        Reform(
            id="mock_fuel_duty_cut_extended",
            name="Fuel duty 5p cut to August 2027 (MOCK)",
            parameter_changes=rate_change(
                "gov.hmrc.fuel_duty.petrol_and_diesel",
                {
                    2026: 0.5295,
                    2027: FUEL_DUTY_2027_28,
                    2028: 0.5969,
                    2029: 0.6136,
                    2030: 0.6314,
                },
            ),
        ),
        Reform(
            id="mock_state_pension_4_5pc",
            name="State Pension +4.5% in April 2027 (MOCK)",
            parameter_changes=_merge(
                rate_change(
                    "gov.dwp.state_pension.new_state_pension.amount",
                    {2027: 252.15, 2028: 258.45, 2029: 264.90, 2030: 271.50},
                ),
                rate_change(
                    "gov.dwp.state_pension.basic_state_pension.amount",
                    {2027: 193.20, 2028: 198.05, 2029: 203.00, 2030: 208.10},
                ),
            ),
        ),
        Reform(
            id="mock_uc_taper_50pc",
            name="Universal Credit taper 50% (MOCK)",
            parameter_changes=rate_change(
                "gov.dwp.universal_credit.means_test.reduction_rate",
                {year: 0.50 for year in FROM_2027},
            ),
        ),
    ]
