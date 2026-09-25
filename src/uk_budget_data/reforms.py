"""Reform definitions for UK Autumn Budget 2026.

This module contains all policy reforms announced in the November 2025 Budget,
implemented as Reform objects that can be processed by the data pipeline.

Reforms are organised into:
- Spending measures (costs to treasury)
- Tax measures (revenue raisers)
- Structural reforms (using simulation modifiers)

policyengine-uk v2.65.0+ includes the Autumn Budget parameter updates
(including two-child limit repeal from April 2026 and salary sacrifice pension
cap of £2,000 from April 2029) with proper fiscal year conversion that ensures
annual queries return April 30 values. We use a pre-Autumn Budget baseline to
show the impact of budget policies.
"""

from typing import Optional

import numpy as np
from policyengine_uk import Simulation

from uk_budget_data.models import Reform

# Default years for parameter changes
DEFAULT_YEARS = [2026, 2027, 2028, 2029, 2030]


def _years_dict(value, years: list[int] = None) -> dict[str, any]:
    """Create a {year: value} dict for parameter changes."""
    years = years or DEFAULT_YEARS
    return {str(y): value for y in years}


# =============================================================================
# PRE-AUTUMN BUDGET BASELINE
# =============================================================================
# These values represent what parameters would have been WITHOUT the November
# 2026 Autumn Budget. Used as baseline for comparing budget policy impacts.
#
# Income tax thresholds: Would have unfrozen after April 2028
# Personal allowance and basic rate threshold uprated by CPI from April 2028
#
# Fuel duty: 5p cut would have ended March 2026 per Spring Budget 2025
# Would return to 57.95p then RPI uprating from April 2027


def _calculate_pre_autumn_budget_baseline() -> dict:
    """Calculate pre-Autumn Budget baseline values programmatically.

    Uses OBR inflation forecasts from policyengine-uk to calculate what
    income tax thresholds and fuel duty rates would have been without
    the November 2025 Autumn Budget.
    """
    from policyengine_uk.system import system

    params = system.parameters

    # Get OBR inflation indices
    cpi_index = params.gov.economic_assumptions.indices.obr.cpih
    rpi_index = params.gov.economic_assumptions.indices.obr.rpi

    # Income tax thresholds - CPI uprating from April 2028
    # (Previous freeze was until April 2028)
    pa_2027 = 12570  # Personal allowance frozen at this level until Apr 2028
    threshold_2027 = 37700  # Basic rate threshold frozen until Apr 2028

    cpi_2027 = cpi_index("2027-04-01")
    cpi_2028 = cpi_index("2028-04-01")
    cpi_2029 = cpi_index("2029-04-01")
    cpi_2030 = cpi_index("2030-04-01")

    # Fuel duty - 5p cut would end March 2026, then RPI uprating
    fuel_duty_base = 0.5795  # Rate after 5p cut ends (per Spring Budget 2025)
    rpi_2026 = rpi_index("2026-04-01")
    rpi_2027 = rpi_index("2027-04-01")
    rpi_2028 = rpi_index("2028-04-01")
    rpi_2029 = rpi_index("2029-04-01")
    rpi_2030 = rpi_index("2030-04-01")

    return {
        # Income tax thresholds - CPI indexed from April 2028
        "gov.hmrc.income_tax.allowances.personal_allowance.amount": {
            "2028": round(pa_2027 * cpi_2028 / cpi_2027),
            "2029": round(pa_2027 * cpi_2029 / cpi_2027),
            "2030": round(pa_2027 * cpi_2030 / cpi_2027),
        },
        "gov.hmrc.income_tax.rates.uk[1].threshold": {
            "2028": round(threshold_2027 * cpi_2028 / cpi_2027),
            "2029": round(threshold_2027 * cpi_2029 / cpi_2027),
            "2030": round(threshold_2027 * cpi_2030 / cpi_2027),
        },
        # Fuel duty - 5p cut ends March 2026, then RPI uprating
        "gov.hmrc.fuel_duty.petrol_and_diesel": {
            "2026-03-22": fuel_duty_base,  # 5p cut ends
            "2027-04-01": round(fuel_duty_base * rpi_2027 / rpi_2026, 4),
            "2028-04-01": round(fuel_duty_base * rpi_2028 / rpi_2026, 4),
            "2029-04-01": round(fuel_duty_base * rpi_2029 / rpi_2026, 4),
            "2030-04-01": round(fuel_duty_base * rpi_2030 / rpi_2026, 4),
        },
    }


# Cache for lazy-loaded baseline
_PRE_AUTUMN_BUDGET_BASELINE_CACHE: dict | None = None


def get_pre_autumn_budget_baseline() -> dict:
    """Get the pre-Autumn Budget baseline values (lazy-loaded).

    Returns cached values on subsequent calls to avoid repeated
    Microsimulation initialization.
    """
    global _PRE_AUTUMN_BUDGET_BASELINE_CACHE
    if _PRE_AUTUMN_BUDGET_BASELINE_CACHE is None:
        _PRE_AUTUMN_BUDGET_BASELINE_CACHE = (
            _calculate_pre_autumn_budget_baseline()
        )
    return _PRE_AUTUMN_BUDGET_BASELINE_CACHE


# Alias for backwards compatibility (lazy-loaded)
PRE_AUTUMN_BUDGET_BASELINE = None  # Set lazily below


def _get_pre_ab_baseline_key(key: str) -> dict:
    """Get a specific key from the pre-AB baseline (lazy-loaded)."""
    return get_pre_autumn_budget_baseline()[key]


# =============================================================================
# SPENDING MEASURES (costs to treasury)
# =============================================================================


def _create_two_child_limit_repeal() -> Reform:
    """Create the two-child limit repeal reform.

    Since policyengine-uk v2.63.0+, the two-child limit repeal is in current law
    (child_count = infinity from April 2026). This reform compares against
    the pre-budget baseline where the limit was 2.

    policyengine-uk handles the repeal calculation internally.

    Returns:
        Reform object for the two-child limit repeal.
    """
    return Reform(
        id="two_child_limit",
        name="2 child limit repeal",
        description=(
            "Removes the two-child limit on benefits from April 2026. The limit "
            "restricts child-related payments in Universal Credit and Tax Credits "
            "to the first two children in a family. Compares Autumn Budget policy "
            "(limit removed) against pre-budget baseline (limit of 2)."
        ),
        # Baseline: Pre-budget (limit of 2)
        baseline_parameter_changes={
            "gov.dwp.tax_credits.child_tax_credit.limit.child_count": (
                _years_dict(2)
            ),
            "gov.dwp.universal_credit.elements.child.limit.child_count": (
                _years_dict(2)
            ),
        },
        # Reform: Use current law (pe-uk with repeal/infinity)
        parameter_changes={},
    )


def _create_fuel_duty_freeze() -> Reform:
    """Create the fuel duty freeze extension reform.

    Compares Autumn Budget policy against pre-budget baseline:
    - Baseline: 5p cut ends March 2026, then RPI uprating
    - Reform: Current law (policyengine-uk 2.60.0+) with freeze until Sept 2026,
      staggered reversal (+1p Sep, +2p Dec, +2p Mar), then RPI uprating

    Note: We hardcode the baseline because policyengine-uk 2.60.0+ has
    post-budget values baked in. The baseline represents what would have
    happened without the Autumn Budget (5p cut ending, then RPI).

    See https://policyengine.org/uk/research/fuel-duty-freeze-2025
    """
    # Baseline: What would have happened without Autumn Budget
    # 5p cut ends March 2026 → 57.95p, then RPI uprating
    # Uses same methodology as blog post policy 95147
    baseline_rates = {
        "2026": 0.58,  # 5p cut ends, returns to 57.95p rounded
        "2027": 0.61,  # RPI uprating
        "2028": 0.63,
        "2029": 0.64,
        "2030": 0.66,  # Continued RPI uprating
    }

    return Reform(
        id="fuel_duty_freeze",
        name="Fuel duty freeze extension",
        description=(
            "Extends the 5p fuel duty cut until September 2026, then "
            "implements a staggered reversal. Compares Autumn Budget policy "
            "(freeze) against pre-budget baseline (5p cut ending March 2026). "
            "See https://policyengine.org/uk/research/fuel-duty-freeze-2025"
        ),
        baseline_parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": baseline_rates
        },
        parameter_changes={},  # Use current law (policyengine-uk 2.60.0+)
    )


# =============================================================================
# TAX MEASURES (revenue raisers)
# =============================================================================


def _create_threshold_freeze_extension() -> Reform:
    """Create the threshold freeze extension reform.

    policyengine-uk 2.60.0+ has frozen thresholds (Autumn Budget policy).
    This reform compares against the pre-budget baseline (CPI uprating).
    - Baseline: CPI-indexed from 2028 (pre-budget)
    - Reform: Frozen at £12,570 PA and £37,700 threshold (policyengine-uk default)
    """
    baseline = get_pre_autumn_budget_baseline()
    return Reform(
        id="threshold_freeze_extension",
        name="Threshold freeze extension",
        description=(
            "Extends the freeze on income tax thresholds from April 2028 to "
            "April 2031. Personal allowance remains at £12,570 and the higher "
            "rate threshold at £37,700. Compares Autumn Budget policy (freeze) "
            "against pre-budget baseline (inflation uprating from 2028)."
        ),
        baseline_parameter_changes={
            "gov.hmrc.income_tax.allowances.personal_allowance.amount": (
                baseline[
                    "gov.hmrc.income_tax.allowances.personal_allowance.amount"
                ]
            ),
            "gov.hmrc.income_tax.rates.uk[1].threshold": (
                baseline["gov.hmrc.income_tax.rates.uk[1].threshold"]
            ),
        },
        parameter_changes={},
    )


# =============================================================================
# INCOME SOURCE TAX RATE INCREASES (from policyengine-uk PR #1395)
# =============================================================================
# These reforms compare the new Autumn Budget rates (baked into policyengine-uk)
# against the pre-budget baseline rates.
#
# Dividends: +2pp from April 2026 (basic 8.75%->10.75%, higher 33.75%->35.75%)
# Savings: +2pp from April 2027 (basic 20%->22%, higher 40%->42%, add 45%->47%)
# Property: +2pp from April 2027 (basic 20%->22%, higher 40%->42%, add 45%->47%)


def _set_pre_budget_dividend_rates(sim):
    """Set pre-budget dividend rates in the baseline simulation.

    Reverts the Autumn Budget 2026 changes:
    - Basic rate: 10.75% -> 8.75%
    - Higher rate: 35.75% -> 33.75%

    Uses simulation_modifier because dividend rates are stored in a
    ParameterScale which requires direct bracket access. Modifies
    values_list entries for 2026+ to revert to pre-budget rates.
    """
    div = sim.tax_benefit_system.parameters.gov.hmrc.income_tax.rates.dividends

    # Find and modify all entries from 2027 onwards to pre-budget rates
    # values_list is ordered most recent first, so iterate through all
    # OBR fiscal year timing: 2026-27 starts April 2026, so first full year is 2027
    for val_entry in div.brackets[0].rate.values_list:
        if val_entry.instant_str >= "2027":
            val_entry.value = 0.0875  # Pre-budget basic rate

    for val_entry in div.brackets[1].rate.values_list:
        if val_entry.instant_str >= "2027":
            val_entry.value = 0.3375  # Pre-budget higher rate

    return sim


def _create_dividend_tax_increase() -> Reform:
    """Create the dividend tax increase reform.

    Increases dividend tax rates by 2pp from April 2026:
    - Basic rate: 8.75% -> 10.75%
    - Higher rate: 33.75% -> 35.75%
    - Additional rate: unchanged at 39.35%

    OBR fiscal impact (Table 3.5):
    - 2026-27: £0.3bn
    - 2027-28: £1.0bn
    - 2028-29: £1.0bn
    - 2029-30: £1.0bn
    """
    # Uses baseline_simulation_modifier because dividend rates are stored
    # in a ParameterScale which requires direct bracket modification
    return Reform(
        id="dividend_tax_increase_2pp",
        name="Dividend tax increase (+2pp)",
        description=(
            "Increases dividend tax rates by 2 percentage points from April "
            "2026. Basic rate: 8.75% → 10.75%, Higher rate: 33.75% → 35.75%. "
            "OBR estimates £1.0-1.1bn annual yield from 2027-28."
        ),
        baseline_simulation_modifier=_set_pre_budget_dividend_rates,
        parameter_changes={},  # Uses new rates from policyengine-uk
    )


def _create_savings_tax_increase() -> Reform:
    """Create the savings income tax increase reform.

    Increases savings income tax rates by 2pp from April 2027:
    - Basic rate: 20% -> 22%
    - Higher rate: 40% -> 42%
    - Additional rate: 45% -> 47%

    OBR fiscal impact (Table 3.5):
    - 2027-28: £0.0bn (starts April 2027)
    - 2028-29: £0.5bn
    - 2029-30: £0.5bn
    """
    return Reform(
        id="savings_tax_increase_2pp",
        name="Savings income tax increase (+2pp)",
        description=(
            "Increases savings income tax rates by 2 percentage points from "
            "April 2027. Basic: 20% → 22%, Higher: 40% → 42%, Additional: "
            "45% → 47%. OBR estimates £0.5bn annual yield from 2028-29."
        ),
        baseline_parameter_changes={
            # Pre-budget rates (20% basic, 40% higher, 45% additional)
            # Start from 2028 to match OBR fiscal year timing (policy starts April 2027)
            "gov.hmrc.income_tax.rates.savings.basic": {
                "2028": 0.20,
                "2029": 0.20,
                "2030": 0.20,
            },
            "gov.hmrc.income_tax.rates.savings.higher": {
                "2028": 0.40,
                "2029": 0.40,
                "2030": 0.40,
            },
            "gov.hmrc.income_tax.rates.savings.additional": {
                "2028": 0.45,
                "2029": 0.45,
                "2030": 0.45,
            },
        },
        parameter_changes={},  # Uses new rates from policyengine-uk v2.60+
    )


def _create_property_tax_increase() -> Reform:
    """Create the property income tax increase reform.

    Increases property income tax rates by 2pp from April 2027:
    - Basic rate: 20% -> 22%
    - Higher rate: 40% -> 42%
    - Additional rate: 45% -> 47%

    OBR fiscal impact (Table 3.5):
    - 2027-28: £0.0bn (starts April 2027)
    - 2028-29: £0.6bn
    - 2029-30: £0.4bn
    """
    return Reform(
        id="property_tax_increase_2pp",
        name="Property income tax increase (+2pp)",
        description=(
            "Increases property income tax rates by 2 percentage points from "
            "April 2027. Basic: 20% → 22%, Higher: 40% → 42%, Additional: "
            "45% → 47%. OBR estimates £0.4-0.6bn annual yield from 2028-29."
        ),
        baseline_parameter_changes={
            # Pre-budget rates (20% basic, 40% higher, 45% additional)
            # Start from 2028 to match OBR fiscal year timing (policy starts April 2027)
            "gov.hmrc.income_tax.rates.property.basic": {
                "2028": 0.20,
                "2029": 0.20,
                "2030": 0.20,
            },
            "gov.hmrc.income_tax.rates.property.higher": {
                "2028": 0.40,
                "2029": 0.40,
                "2030": 0.40,
            },
            "gov.hmrc.income_tax.rates.property.additional": {
                "2028": 0.45,
                "2029": 0.45,
                "2030": 0.45,
            },
        },
        parameter_changes={},  # Uses new rates from policyengine-uk v2.60+
    )


# =============================================================================
# STRUCTURAL REFORMS (using simulation modifiers)
# =============================================================================


def _connect_student_loan_variables(sim: Simulation) -> Simulation:
    """Connect policyengine-uk's modelled student loan repayments to revenue.

    The microdata (policyengine-uk-data) now includes student_loan_plan imputed
    based on age and reported repayments. This modifier just connects the
    policyengine-uk student_loan_repayment variable to the tax/revenue totals.

    Note: Requires policyengine-uk-data with student_loan_plan imputation.
    """
    # Connect policyengine-uk's modelled repayments to government revenue
    # Replace reported repayments with modelled repayments
    sim.tax_benefit_system.variables["gov_tax"].adds.remove(
        "student_loan_repayments"
    )
    sim.tax_benefit_system.variables["gov_tax"].adds.append(
        "student_loan_repayment"
    )

    sim.tax_benefit_system.variables["household_tax"].adds.remove(
        "student_loan_repayments"
    )
    sim.tax_benefit_system.variables["household_tax"].adds.append(
        "student_loan_repayment"
    )

    # Update HBAI household income
    sim.tax_benefit_system.variables[
        "hbai_household_net_income"
    ].subtracts.append("student_loan_repayment")
    sim.tax_benefit_system.variables["hbai_household_net_income"].adds.append(
        "student_loan_repayments"
    )
    return sim


def _calculate_pre_freeze_thresholds() -> dict:
    """Calculate what Plan 2 thresholds would be without the freeze.

    Returns baseline (counterfactual) thresholds assuming RPI uprating
    continued from 2027 instead of the Autumn Budget freeze.

    Current law (policyengine-uk):
    - 2026: £29,385
    - 2027-2029: £29,385 (frozen)
    - 2030+: RPI uprating

    Baseline counterfactual:
    - 2026: £29,385
    - 2027-2029: RPI uprating (not frozen)
    - 2030+: RPI uprating
    """
    from policyengine_uk.system import system

    params = system.parameters
    rpi_index = params.gov.economic_assumptions.indices.obr.rpi

    # Base threshold for 2026 is £29,385 (uprated from £28,470)
    base_2026 = 29385

    rpi_2026 = rpi_index("2026-04-06")
    rpi_2027 = rpi_index("2027-04-06")
    rpi_2028 = rpi_index("2028-04-06")
    rpi_2029 = rpi_index("2029-04-06")
    rpi_2030 = rpi_index("2030-04-06")

    return {
        # Baseline: Continue RPI uprating from 2027 (no freeze)
        # Use year-only format for parameter changes
        "gov.hmrc.student_loans.thresholds.plan_2": {
            "2027": round(base_2026 * rpi_2027 / rpi_2026),
            "2028": round(base_2026 * rpi_2028 / rpi_2026),
            "2029": round(base_2026 * rpi_2029 / rpi_2026),
            "2030": round(base_2026 * rpi_2030 / rpi_2026),
        },
    }


def _create_student_loan_freeze() -> Reform:
    """Create the student loan threshold freeze reform.

    Uses policyengine-uk's student_loan_repayment variable with:
    - Reform: Current law (frozen thresholds from policyengine-uk)
    - Baseline: RPI uprating counterfactual

    The freeze saves the government money (more repayments) as graduates
    pay back more when thresholds don't rise with inflation.

    HMT fiscal impact:
    - 2026-27: +£5.9bn (one-off revaluation of student loan book)
    - 2027-28: +£0.3bn
    - 2028-29: +£0.3bn
    - 2029-30: +£0.4bn
    """
    baseline_thresholds = _calculate_pre_freeze_thresholds()

    return Reform(
        id="freeze_student_loan_thresholds",
        name="Freeze student loan repayment thresholds",
        description=(
            "Freezes Plan 2 student loan repayment thresholds for 3 years "
            "from 6 April 2027 through April 2029. Threshold is £29,385 in "
            "2026, then frozen at that level for 3 years, resuming RPI "
            "uprating from 2030. In 2026, the government revalued the student "
            "loan book resulting in a one-off £5.9bn fiscal impact. Ongoing "
            "annual revenue of ~£0.3bn/year from 2027-2029 as graduates repay "
            "more when thresholds don't rise with inflation. Reform uses "
            "current law (frozen thresholds); baseline assumes RPI uprating "
            "would have continued. HMT costing: +£5.9bn (2026), +£0.3bn/year "
            "thereafter."
        ),
        # Reform: Current law (frozen) - use policyengine-uk default
        simulation_modifier=_connect_student_loan_variables,
        # Baseline: RPI uprating counterfactual
        baseline_parameter_changes=baseline_thresholds,
        baseline_simulation_modifier=_connect_student_loan_variables,
    )


# Lazy-loaded reform instance
_FREEZE_STUDENT_LOAN_THRESHOLDS_CACHE: Reform | None = None


def get_freeze_student_loan_thresholds() -> Reform:
    """Get the student loan threshold freeze reform (lazy-loaded)."""
    global _FREEZE_STUDENT_LOAN_THRESHOLDS_CACHE
    if _FREEZE_STUDENT_LOAN_THRESHOLDS_CACHE is None:
        _FREEZE_STUDENT_LOAN_THRESHOLDS_CACHE = _create_student_loan_freeze()
    return _FREEZE_STUDENT_LOAN_THRESHOLDS_CACHE


# Backwards-compatible alias
FREEZE_STUDENT_LOAN_THRESHOLDS = None  # Set lazily via get function


# Rail fare increase rates (per OBR forecasts)
# Baseline: fares increase by RPI formula each year
RAIL_FARE_INCREASES = {
    2026: 0.058,  # 5.8% baseline increase
    2027: 0.042,  # 4.2%
    2028: 0.039,  # 3.9%
    2029: 0.039,  # 3.9%
    2030: 0.039,  # Assumed same as 2029
}

# Treasury cost estimates for rail fare freeze (£bn)
# Source: Treasury estimate of £145m in 2026-27, £775m total by 2030-31
RAIL_FREEZE_COSTS = {
    2026: 0.145,  # £145m
    2027: 0.155,  # Estimated from total
    2028: 0.160,  # Estimated from total
    2029: 0.165,  # Estimated from total
    2030: 0.150,  # Remaining from £775m total
}


def _rail_fares_freeze_modifier(sim: Simulation) -> Simulation:
    """Structural reform: Rail fares freeze for 2026.

    The government announced a one-year freeze on regulated rail fares from
    March 2026 - the first freeze in 30 years. Without the freeze, fares would
    have increased by 5.8% under the RPI formula.

    This reform increases rail_subsidy_spending to compensate for the foregone
    fare revenue. The cost is based on Treasury estimates (£145m in 2026-27,
    £775m total by 2030-31) and distributed proportionally based on household
    rail usage.

    Implementation:
    - Get current rail subsidy values from the model
    - Add Treasury-estimated cost distributed proportionally by rail usage
    - Adjust for household weights when setting sample values
    """
    for year in [2026, 2027, 2028, 2029, 2030]:
        # Get current rail subsidy values and weights
        current_rail = sim.calculate(
            "rail_subsidy_spending", year, map_to="household"
        )
        weights = sim.calculate("household_weight", year)

        # Convert to numpy arrays for manipulation
        current_array = np.array(current_rail)
        weights_array = np.array(weights)

        # Treasury cost estimate for this year (in £)
        treasury_cost = RAIL_FREEZE_COSTS[year] * 1e9

        # Calculate weighted shares of rail usage
        weighted_rail = current_array * weights_array
        total_weighted_rail = weighted_rail.sum()

        # Distribute cost proportionally by rail usage
        # Need to divide by weight since set_input takes sample values
        # that will later be weighted
        share = np.where(
            total_weighted_rail > 0, weighted_rail / total_weighted_rail, 0
        )
        sample_gain = np.where(
            weights_array > 0, share * treasury_cost / weights_array, 0
        )

        # Set the reformed rail subsidy
        reformed_values = current_array + sample_gain
        sim.set_input("rail_subsidy_spending", year, reformed_values)

    return sim


def _create_rail_fares_freeze() -> Reform:
    """Create the rail fares freeze reform.

    Freezes regulated rail fares for one year from March 2026 - the first
    freeze in 30 years. Saves passengers an estimated £600 million in
    2026-27 (per government estimates).

    OBR fiscal impact (Table 3.5):
    - 2026-27: -£0.2bn (cost)
    - 2027-28: -£0.2bn (cost)
    - 2028-29: -£0.2bn (cost)
    - 2029-30: -£0.2bn (cost)

    Note: Government estimates £600m passenger savings in 2026-27 alone.
    The ongoing cost reflects the permanent base effect of the freeze.
    """
    return Reform(
        id="rail_fares_freeze",
        name="Rail fares freeze",
        description=(
            "Freezes regulated rail fares for one year from March 2026. "
            "Without the freeze, fares would have increased by 5.8% under the "
            "RPI formula. Saves commuters on expensive routes over £300/year. "
            "See https://policyengine.org/uk/research/rail-fares-freeze-2025"
        ),
        simulation_modifier=_rail_fares_freeze_modifier,
    )


def create_salary_sacrifice_cap_reform() -> Reform:
    """Create a salary sacrifice cap reform.

    Since policyengine-uk v2.65.0+, the salary sacrifice pension cap of £2,000
    from April 2029 is in current law. This reform compares against the pre-budget
    baseline where there was no cap (infinity).

    policyengine-uk handles the cap calculation internally including:
    - Excess above cap returned to employment income
    - Broad-base haircut (employers spread NI costs across all workers)

    Returns:
        Reform object configured with the specified parameters.

    OBR costing: £4.9bn in 2029-30 (static), £4.7bn (post-behavioural)
    """
    from policyengine_uk.system import system

    params = system.parameters
    cap_param = params.gov.hmrc.national_insurance.salary_sacrifice_pension_cap
    haircut_param = (
        params.gov.contrib.behavioral_responses.salary_sacrifice_broad_base_haircut_rate
    )

    # Read values from pe-uk for description
    cap_amount = cap_param("2029-04-06")
    haircut_rate = haircut_param("2029-04-06")

    return Reform(
        id="salary_sacrifice_cap",
        name="Salary sacrifice cap",
        description=(
            f"Caps salary sacrifice pension contributions at £{cap_amount:,.0f} "
            f"per year from April 2029. Contributions above the cap become "
            f"employment income subject to income tax and NICs. Includes "
            f"broad-base haircut ({haircut_rate:.2%}) where employers spread "
            f"increased NI costs across all workers."
        ),
        # Baseline: Pre-budget (no cap)
        baseline_parameter_changes={
            "gov.hmrc.national_insurance.salary_sacrifice_pension_cap": {
                "2029": float("inf"),
                "2030": float("inf"),
            },
        },
        # Reform: Use current law (pe-uk with cap)
        parameter_changes={},
    )


# =============================================================================
# COMBINED AUTUMN BUDGET REFORM
# =============================================================================


def _create_combined_autumn_budget_reform() -> Reform:
    """Create a combined reform with all Autumn Budget 2026 provisions.

    This reform combines:
    - Two-child limit repeal (spending)
    - Salary sacrifice pension cap (revenue)
    - Fuel duty freeze extension (spending)
    - Rail fares freeze (spending)
    - Threshold freeze extension (revenue)
    - Student loan threshold freeze (revenue)
    - Dividend tax increase +2pp (revenue)
    - Savings tax increase +2pp (revenue)
    - Property tax increase +2pp (revenue)

    Baseline: Pre-budget parameter values
    Reform: pe-uk current law (Autumn Budget baked in)

    Note: Zero-rate VAT on energy is NOT included as it was not in the budget.
    """
    baseline = get_pre_autumn_budget_baseline()

    # Fuel duty baseline: 5p cut ends March 2026, then RPI uprating
    # (hardcoded because policyengine-uk 2.60.0+ has post-budget values)
    fuel_duty_baseline = {
        "2026": 0.58,
        "2027": 0.61,
        "2028": 0.63,
        "2029": 0.64,
        "2030": 0.66,
    }

    # Combine all baseline parameter changes
    combined_baseline_params = {
        # Fuel duty baseline (pre-budget rates - hardcoded)
        "gov.hmrc.fuel_duty.petrol_and_diesel": fuel_duty_baseline,
        # Threshold baseline (CPI-indexed from 2028)
        "gov.hmrc.income_tax.allowances.personal_allowance.amount": baseline[
            "gov.hmrc.income_tax.allowances.personal_allowance.amount"
        ],
        "gov.hmrc.income_tax.rates.uk[1].threshold": baseline[
            "gov.hmrc.income_tax.rates.uk[1].threshold"
        ],
        # Two-child limit baseline (pre-budget: limit of 2)
        "gov.dwp.tax_credits.child_tax_credit.limit.child_count": _years_dict(
            2
        ),
        "gov.dwp.universal_credit.elements.child.limit.child_count": _years_dict(
            2
        ),
        # Salary sacrifice pension cap baseline (pre-budget: no cap)
        "gov.hmrc.national_insurance.salary_sacrifice_pension_cap": {
            "2029": float("inf"),
            "2030": float("inf"),
        },
        # Savings tax baseline (pre-budget rates)
        # Start from 2028 to match OBR fiscal year timing (policy starts April 2027)
        "gov.hmrc.income_tax.rates.savings.basic": {
            "2028": 0.20,
            "2029": 0.20,
            "2030": 0.20,
        },
        "gov.hmrc.income_tax.rates.savings.higher": {
            "2028": 0.40,
            "2029": 0.40,
            "2030": 0.40,
        },
        "gov.hmrc.income_tax.rates.savings.additional": {
            "2028": 0.45,
            "2029": 0.45,
            "2030": 0.45,
        },
        # Property tax baseline (pre-budget rates)
        # Start from 2028 to match OBR fiscal year timing (policy starts April 2027)
        "gov.hmrc.income_tax.rates.property.basic": {
            "2028": 0.20,
            "2029": 0.20,
            "2030": 0.20,
        },
        "gov.hmrc.income_tax.rates.property.higher": {
            "2028": 0.40,
            "2029": 0.40,
            "2030": 0.40,
        },
        "gov.hmrc.income_tax.rates.property.additional": {
            "2028": 0.45,
            "2029": 0.45,
            "2030": 0.45,
        },
    }

    # Combined baseline simulation modifier for dividend rates and student loans
    def combined_baseline_modifier(sim):
        """Apply pre-budget dividend rates and connect student loan variables."""
        _set_pre_budget_dividend_rates(sim)
        _connect_student_loan_variables(sim)
        return sim

    # Combined reform simulation modifier (rail fares freeze + student loans)
    def combined_reform_modifier(sim):
        """Apply rail fares freeze and connect student loan variables."""
        _rail_fares_freeze_modifier(sim)
        _connect_student_loan_variables(sim)
        return sim

    # Add student loan baseline thresholds (RPI uprating counterfactual)
    slr_baseline = _calculate_pre_freeze_thresholds()
    combined_baseline_params.update(slr_baseline)

    return Reform(
        id="autumn_budget_2026_combined",
        name="Autumn Budget 2026 (combined)",
        description=(
            "All Autumn Budget 2026 provisions combined: two-child limit "
            "repeal, salary sacrifice pension cap, fuel duty freeze extension, "
            "rail fares freeze, threshold freeze extension, student loan "
            "threshold freeze, and tax rate increases on dividends (+2pp), "
            "savings (+2pp), and property income (+2pp). Shows full budget "
            "impact with interactions."
        ),
        baseline_parameter_changes=combined_baseline_params,
        baseline_simulation_modifier=combined_baseline_modifier,
        simulation_modifier=combined_reform_modifier,
        # Reform: Use current law (pe-uk with all Autumn Budget changes)
        parameter_changes={},
    )


# =============================================================================
# REFORM COLLECTIONS (lazy-loaded to avoid import-time Microsimulation)
# =============================================================================

# Cache for lazy-loaded reforms

# =============================================================================
# AUTUMN BUDGET 2026 CANDIDATE MEASURES
# =============================================================================
# Three measures the 2026 Budget is most likely to touch, ported from the
# standalone PolicyEngine analyses that model each one in depth:
#   CGT       -> PolicyEngine/uk-cgt-reform
#   Fuel duty -> PolicyEngine/cancelling-fuel-duty-rise
#   Bus fares -> PolicyEngine/bus-fare-cap
# Each docstring records where the numbers come from and where this
# implementation is narrower than its source repo.


# CGT equalisation with income tax.
#
# Reformed rates, equal to the income tax rates for each band (uk-cgt-reform's
# BURNHAM_RATES). Named for Andy Burnham, who championed the policy in the
# Labour leadership contest and is now Prime Minister.
CGT_EQUALISED_RATES = {
    "basic_rate": 0.20,  # from 18%
    "higher_rate": 0.40,  # from 24%
    "additional_rate": 0.45,  # from 24%
}

# Realisation elasticity with respect to the RETENTION rate (1 - t), positive.
# Advani, Lonsdale & Summers (CenTax, Oct 2024, "Reforming Capital Gains Tax")
# use a central medium-term value of 1.0, sensitivity range 0.5-2.0.
#
# uk-cgt-reform sets the marginal-tax-rate convention instead
# (mtr_elasticity = -0.7, converted from this same CenTax central value). That
# parameter does not exist in the policyengine-uk pinned by policyengine.py
# 6.x, so we set the retention convention the engine does carry, at CenTax's
# own central value. The two conventions express the same evidence; they must
# never both be set.
CGT_RETENTION_ELASTICITY = 1.0


def _create_cgt_equalisation() -> Reform:
    """Equalise capital gains tax rates with income tax rates.

    Ported from PolicyEngine/uk-cgt-reform, which models this in full.

    Baseline (current law): 18% basic, 24% higher, 24% additional.
    Reform: 20% / 40% / 45%, matching the income tax rates, from April 2026.
    The £3,000 annual exempt amount is unchanged.

    Narrower than the source repo in two ways, both forced by the
    policyengine-uk version policyengine.py 6.x pins (2.90.2):

    1. Main schedule only. uk-cgt-reform also sets the residential property
       and carried interest schedules and withdraws the BADR lifetime limit,
       which is what "tax every gain at income tax rates" requires. Those
       parameters arrive in policyengine-uk 2.99.0; they do not exist here, so
       gains on those schedules stay at current law and revenue is
       UNDERSTATED relative to a full equalisation.
    2. Retention-rate elasticity convention rather than the MTR convention
       the source repo reports, because mtr_elasticity does not exist here.

    CenTax's elasticity assumes accompanying base broadening (death-uplift
    removal, exit charges) that is not modelled, so behavioural loss may be
    understated for a rate-only reform. It is also a medium-term elasticity,
    abstracting from short-run forestalling.
    """
    return Reform(
        id="cgt_equalisation",
        name="CGT equalisation with income tax",
        description=(
            "Raises capital gains tax rates to match income tax rates "
            "(20%/40%/45%, from 18%/24%/24%) from April 2026, keeping the "
            "£3,000 annual exempt amount. Applies a CenTax central "
            "realisation elasticity of 1.0 with respect to the retention "
            "rate. Main schedule only: residential property, carried "
            "interest and BADR gains need policyengine-uk 2.99.0 and stay at "
            "current law here, so revenue is understated. Modelled in full "
            "at https://github.com/PolicyEngine/uk-cgt-reform"
        ),
        parameter_changes={
            f"gov.hmrc.cgt.{band}": _years_dict(rate)
            for band, rate in CGT_EQUALISED_RATES.items()
        }
        | {
            "gov.simulation.capital_gains_responses.elasticity": _years_dict(
                CGT_RETENTION_ELASTICITY
            )
        },
    )


# Fuel duty. Current law in policyengine-uk 2.90.2 holds the rate at 53.45p/L
# through 2026 and steps it to 59.25p from January 2027. Cancelling that rise
# means holding the 2026 rate flat across the forecast.
FUEL_DUTY_FROZEN_RATE = 0.5345


def _create_fuel_duty_rise_cancellation() -> Reform:
    """Cancel the scheduled January 2027 fuel duty rise.

    Ported from PolicyEngine/cancelling-fuel-duty-rise.

    Baseline (current law): 53.45p/L through 2026, rising to 59.25p from
    January 2027 and uprated thereafter.
    Reform: the 2026 rate holds across the forecast.

    Fuel duty has been held at 52.95p since March 2022 by successively
    extending a 5p cut, and the rises scheduled for September and December
    2026 were already cancelled. The open question for this Budget is the
    January 2027 step, which HMRC has said will be confirmed at the Budget.

    The source repo benchmarks fiscal totals to HMRC/OBR road-fuel clearances
    and receipts; this reform is the microsimulation side only, so its revenue
    figure will not match the repo's headline.
    """
    return Reform(
        id="fuel_duty_rise_cancellation",
        name="Fuel duty rise cancellation",
        description=(
            "Cancels the fuel duty rise scheduled for January 2027, holding "
            "the rate at its 2026 level of 53.45p per litre across the "
            "forecast instead of stepping up to 59.25p. Modelled against "
            "HMRC/OBR clearance controls at "
            "https://github.com/PolicyEngine/cancelling-fuel-duty-rise"
        ),
        parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": _years_dict(
                FUEL_DUTY_FROZEN_RATE
            )
        },
    )


# Bus fare cap. The England-wide cap sits at £3 and returns to £2 for 2027,
# backed by £400m of funding. The dataset records annual fare spend, not
# per-trip fares, so the cap is modelled as a proportional reduction in fare
# spending drawn from external evidence rather than as a rate parameter.
#
# Central 12.5% (range 10-15%) is bus-fare-cap's FARE_CAP_REDUCTION_CENTRAL,
# derived from the DfT £2 cap evaluation and covering the whole ticket market.
BUS_FARE_CAP_REDUCTION = 0.125


def _bus_fare_cap_modifier(sim: Simulation) -> Simulation:
    """Cut household bus fare spending and fund the gap through subsidy.

    Applied as a simulation modifier because the saving is a proportional
    reduction in recorded spend, not a change to any engine parameter: the
    LCFS records annual fare spend rather than per-trip fares, so there is no
    per-journey price for a £2 cap to bind against.

    Two variables move, for the reason the rail fares freeze moves
    rail_subsidy_spending:

    - bus_fare_spending falls by the cap's saving. This is the economically
      correct household effect, but bus_fare_spending feeds `consumption`,
      NOT household_net_income, so on its own it leaves every distributional
      chart in this dashboard reading exactly zero.
    - bus_subsidy_spending rises by the same amount, representing the
      government funding that pays for the cap (£400m was announced for
      2027). That variable does reach household net income, so the saving
      becomes visible and comparable with the other reforms.

    The two are equal and opposite by construction: the fare revenue
    households no longer pay is the subsidy the government puts in. Setting
    only the first would understate the reform to zero; setting only the
    second would leave consumption overstated.
    """
    for year in DEFAULT_YEARS:
        fares = sim.calculate("bus_fare_spending", period=year).values
        saving = fares * BUS_FARE_CAP_REDUCTION

        sim.set_input("bus_fare_spending", year, fares - saving)

        subsidy = sim.calculate("bus_subsidy_spending", period=year).values
        sim.set_input("bus_subsidy_spending", year, subsidy + saving)

    return sim


def _create_bus_fare_cap() -> Reform:
    """Restore the £2 England-wide bus fare cap, from £3.

    Ported from PolicyEngine/bus-fare-cap.

    Baseline: the £3 cap.
    Reform: a £2 cap, modelled as a 12.5% reduction in household bus and
    coach fare spending.

    The reduction fraction is external evidence, not an engine calculation:
    the dataset holds annual fare spend (COICOP 7.3.2), so there is no
    per-trip fare for a cap to bind against. bus-fare-cap derives 12.5%
    (range 10-15%) from the DfT evaluation of the £2 cap, across the whole
    ticket market rather than capped journeys alone.

    Distributionally this is the mirror image of the rail fares freeze the
    2025 dashboard modelled: bus use skews towards lower-income households.

    Fare spending is split across household members upstream by
    person_bus_fare_spending and gov.dft.bus.fare_allocation_weight_by_age,
    so no allocation is done here.
    """
    return Reform(
        id="bus_fare_cap",
        name="£2 bus fare cap",
        description=(
            "Restores the England-wide bus fare cap to £2 from £3, modelled "
            "as a 12.5% reduction in household bus and coach fare spending "
            "(range 10-15%, from the DfT evaluation of the £2 cap). The "
            "£400m announced for 2027 funds the cap for that year; whether "
            "it is funded beyond 2027 is the open Budget question. Modelled "
            "in full at https://github.com/PolicyEngine/bus-fare-cap"
        ),
        simulation_modifier=_bus_fare_cap_modifier,
    )


_AUTUMN_BUDGET_2026_REFORMS_CACHE: list[Reform] | None = None
_ALL_REFORMS_CACHE: list[Reform] | None = None
_REFORM_LOOKUP_CACHE: dict[str, Reform] | None = None


def _get_autumn_budget_2026_reforms() -> list[Reform]:
    """Get the main Autumn Budget 2026 reforms (lazy-loaded)."""
    global _AUTUMN_BUDGET_2026_REFORMS_CACHE
    if _AUTUMN_BUDGET_2026_REFORMS_CACHE is None:
        _AUTUMN_BUDGET_2026_REFORMS_CACHE = [
            _create_combined_autumn_budget_reform(),  # Combined first
            # Autumn Budget 2026 candidate measures
            _create_cgt_equalisation(),
            _create_fuel_duty_rise_cancellation(),
            _create_bus_fare_cap(),
            # Carried over: still live questions for 2026
            _create_threshold_freeze_extension(),
            _create_dividend_tax_increase(),
            _create_savings_tax_increase(),
            _create_property_tax_increase(),
        ]
    return _AUTUMN_BUDGET_2026_REFORMS_CACHE


def _get_all_reforms() -> list[Reform]:
    """Get all available reforms (lazy-loaded)."""
    global _ALL_REFORMS_CACHE
    if _ALL_REFORMS_CACHE is None:
        # Enacted or superseded 2025 measures stay reachable by id so old
        # shared URLs keep resolving, but are off the 2026 dashboard list.
        _ALL_REFORMS_CACHE = _get_autumn_budget_2026_reforms() + [
            _create_two_child_limit_repeal(),
            _create_fuel_duty_freeze(),
            _create_rail_fares_freeze(),
            get_freeze_student_loan_thresholds(),
            create_salary_sacrifice_cap_reform(),
        ]
    return _ALL_REFORMS_CACHE


def _get_reform_lookup() -> dict[str, Reform]:
    """Get the reform lookup dictionary (lazy-loaded)."""
    global _REFORM_LOOKUP_CACHE
    if _REFORM_LOOKUP_CACHE is None:
        _REFORM_LOOKUP_CACHE = {r.id: r for r in _get_all_reforms()}
    return _REFORM_LOOKUP_CACHE


# Public getter functions for backwards compatibility
def get_autumn_budget_2026_reforms() -> list[Reform]:
    """Get the main Autumn Budget 2026 reforms.

    Returns the measures the 2026 Budget is most likely to touch. Lazy-loaded
    to avoid import-time initialization.
    """
    return _get_autumn_budget_2026_reforms()


def get_all_reforms() -> list[Reform]:
    """Get all available reforms including experimental ones.

    Returns a list of all Reform objects, including both Autumn Budget
    reforms and experimental reforms like salary sacrifice cap.
    """
    return _get_all_reforms()


# Module-level aliases that are lazy-loaded on first access
# Note: These are initially None and populated on first use via get_reform()
# For most use cases, prefer using get_reform(id) or get_autumn_budget_2026_reforms()
AUTUMN_BUDGET_2026_REFORMS: list[Reform] | None = None
ALL_REFORMS: list[Reform] | None = None


def get_reform(reform_id: str) -> Optional[Reform]:
    """Get a reform by its ID.

    Args:
        reform_id: The unique identifier of the reform.

    Returns:
        The Reform object, or None if not found.
    """
    return _get_reform_lookup().get(reform_id)


def list_reform_ids() -> list[str]:
    """Get a list of all available reform IDs."""
    return list(_get_reform_lookup().keys())
