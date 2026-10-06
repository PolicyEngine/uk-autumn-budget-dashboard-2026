"""Reform definitions for UK Autumn Budget 2026.

This module contains three 2026 candidate measures, four carried-over tax
measures, and historical 2025 measures retained for shared links. Each is a
Reform object that can be processed by the data pipeline.

Reforms are organised into:
- Spending measures (costs to treasury)
- Tax measures (revenue raisers)
- Structural reforms (using simulation modifiers)

policyengine-uk v2.65.0+ includes the 2025 Autumn Budget parameter updates
(including two-child limit repeal from April 2026 and salary sacrifice pension
cap of £2,000 from April 2029) with proper fiscal year conversion that ensures
annual queries return April 30 values. We use a pre-Autumn Budget baseline to
show the impact of budget policies.
"""

from functools import lru_cache
from typing import Optional

import numpy as np
from policyengine_uk import Simulation
from policyengine_uk.variables.household.demographic.geography import Region

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


DIVIDEND_PRE_BUDGET_BASIC_RATE = 0.0875
DIVIDEND_PRE_BUDGET_HIGHER_RATE = 0.3375


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

    # UK annual income-tax output for 2026 samples the 2026-27 tax year.
    # values_list is ordered most recent first, so iterate through all
    # effective model years rather than delaying to the next calendar year.
    for val_entry in div.brackets[0].rate.values_list:
        if val_entry.instant_str >= "2026":
            val_entry.value = DIVIDEND_PRE_BUDGET_BASIC_RATE

    for val_entry in div.brackets[1].rate.values_list:
        if val_entry.instant_str >= "2026":
            val_entry.value = DIVIDEND_PRE_BUDGET_HIGHER_RATE

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
            # Model year 2027 is tax year 2027-28 (policy starts April 2027).
            "gov.hmrc.income_tax.rates.savings.basic": {
                "2027": 0.20,
                "2028": 0.20,
                "2029": 0.20,
                "2030": 0.20,
            },
            "gov.hmrc.income_tax.rates.savings.higher": {
                "2027": 0.40,
                "2028": 0.40,
                "2029": 0.40,
                "2030": 0.40,
            },
            "gov.hmrc.income_tax.rates.savings.additional": {
                "2027": 0.45,
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
            # Model year 2027 is tax year 2027-28 (policy starts April 2027).
            "gov.hmrc.income_tax.rates.property.basic": {
                "2027": 0.20,
                "2028": 0.20,
                "2029": 0.20,
                "2030": 0.20,
            },
            "gov.hmrc.income_tax.rates.property.higher": {
                "2027": 0.40,
                "2028": 0.40,
                "2029": 0.40,
                "2030": 0.40,
            },
            "gov.hmrc.income_tax.rates.property.additional": {
                "2027": 0.45,
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
# Three candidate measures plus four carried-over measures. The candidates
# standalone PolicyEngine analyses that model each one in depth:
#   CGT       -> PolicyEngine/uk-cgt-reform
#   Fuel duty -> PolicyEngine/cancelling-fuel-duty-rise
#   Bus fares -> PolicyEngine/bus-fare-cap
# Each docstring records where the numbers come from and where this
# implementation is narrower than its source repo.


# CGT equalisation with income tax.
#
# Reformed rates for the model's undifferentiated capital-gains input.
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
# (mtr_elasticity = -0.7). That
# parameter does not exist in the policyengine-uk pinned by policyengine.py
# 6.x, so we set the retention convention the engine does carry, at CenTax's
# own central value. These are distinct response assumptions; they must not
# be treated as interchangeable or set together.
CGT_RETENTION_ELASTICITY = 1.0


def _create_cgt_equalisation() -> Reform:
    """Apply income-tax-like rates to the pinned model's capital-gains input.

    Baseline (current law): 18% basic, 24% higher, 24% additional.
    Reform: 20% / 40% / 45%, matching the income tax rates, from April 2026.
    The £3,000 annual exempt amount is unchanged.

    policyengine-uk 2.90.2 has one undifferentiated capital-gains input. It
    cannot preserve separate residential property or BADR schedules, nor
    model the carried-interest income-tax/NIC treatment. This is a simplified
    scenario, not a costing of a complete schedule reform or a revenue floor.
    Its retention-rate elasticity of 1.0 is distinct from the MTR elasticity
    of -0.7 used in the standalone analysis.

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
            "rate. The pinned model has an undifferentiated gains input, so "
            "this is a simplified scenario, not a full-schedule costing or "
            "a revenue floor. See the separately modelled analysis at "
            "https://github.com/PolicyEngine/uk-cgt-reform"
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


# HMRC's amended 2026-27 schedule holds petrol/diesel at 52.95p/L through
# December 2026, then sets 55.95p/L in January and 57.95p/L in March 2027.
# The pinned model has older monthly entries, so override every month in BOTH
# scenarios to prevent a later old entry from superseding one dated update.
FUEL_DUTY_FROZEN_RATE = 0.5295
FUEL_DUTY_JAN_FEB_2027_RATE = 0.5595
FUEL_DUTY_POST_MARCH_2027_RATE = 0.5795
FUEL_DUTY_CURRENT_LAW = {
    f"{year}-{month:02d}-01": (
        FUEL_DUTY_FROZEN_RATE
        if year == 2026
        else (
            FUEL_DUTY_JAN_FEB_2027_RATE
            if year == 2027 and month <= 2
            else FUEL_DUTY_POST_MARCH_2027_RATE
        )
    )
    for year in range(2026, 2031)
    for month in range(1, 13)
}
FUEL_DUTY_FROZEN_SCHEDULE = {
    date: FUEL_DUTY_FROZEN_RATE for date in FUEL_DUTY_CURRENT_LAW
}


def _create_fuel_duty_rise_cancellation() -> Reform:
    """Cancel the scheduled January 2027 fuel duty rise.

    Ported from PolicyEngine/cancelling-fuel-duty-rise.

    Baseline: HMRC's amended schedule through March 2027, then the last
    published rate held flat for illustrative later years.
    Reform: the December 2026 rate holds from 2027 onward.

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
            "the December 2026 rate of 52.95p per litre from 2027. The "
            "baseline uses 55.95p/L in January–February 2027 and 57.95p/L "
            "from March 2027. The March rate is held from 2028 as an "
            "illustrative assumption. This dashboard "
            "does not benchmark fuel clearances to HMRC/OBR totals."
        ),
        baseline_parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": FUEL_DUTY_CURRENT_LAW
        },
        parameter_changes={
            "gov.hmrc.fuel_duty.petrol_and_diesel": FUEL_DUTY_FROZEN_SCHEDULE
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
BUS_CAP_ELIGIBLE_REGIONS = frozenset(
    {
        Region.NORTH_EAST,
        Region.NORTH_WEST,
        Region.YORKSHIRE,
        Region.EAST_MIDLANDS,
        Region.WEST_MIDLANDS,
        Region.EAST_OF_ENGLAND,
        Region.SOUTH_EAST,
        Region.SOUTH_WEST,
    }
)


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
    for year in [2027, 2028, 2029, 2030]:
        # np.asarray, not .values: a Microsimulation returns a MicroSeries but
        # a single-household Simulation (the personal impact calculator)
        # returns a bare ndarray, and this modifier runs under both.
        fares = np.asarray(sim.calculate("bus_fare_spending", period=year))
        regions = sim.calculate("region", period=year)
        eligible = np.isin(
            regions,
            tuple(region.name for region in BUS_CAP_ELIGIBLE_REGIONS),
        )
        saving = fares * BUS_FARE_CAP_REDUCTION * eligible

        sim.set_input("bus_fare_spending", year, fares - saving)

        subsidy = np.asarray(
            sim.calculate("bus_subsidy_spending", period=year)
        )
        sim.set_input("bus_subsidy_spending", year, subsidy + saving)

    return sim


def _create_bus_fare_cap() -> Reform:
    """Restore the £2 bus fare cap in participating areas outside London.

    Ported from PolicyEngine/bus-fare-cap.

    Baseline: the £3 cap.
    Reform: a £2 cap from 2027, modelled as a 12.5% reduction in household
    bus and coach fare spending in English regions outside London.

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
            "Restores the bus fare cap to £2 from £3 in 2027 on participating "
            "English services outside London. The 12.5% reduction in all bus "
            "and coach spending (range 10-15%) is a regional proxy for "
            "eligible journeys, not route-level eligibility. The matching "
            "imputed subsidy is a service benefit, not cash income. The "
            "£400m announced for 2027 funds the cap for that year; whether "
            "it is funded beyond 2027 is the open Budget question. Modelled "
            "in full at https://github.com/PolicyEngine/bus-fare-cap"
        ),
        simulation_modifier=_bus_fare_cap_modifier,
    )


# ---------------------------------------------------------------------------
# MOCK drill 2 (5 October 2026): statement measures coded from
# data_inputs/mock_drill2/packet/MOCK-statement.md only. Every value below is
# invented for a PolicyEngine rehearsal. Baselines are the latest engine's
# native rules (policyengine-uk 2.120.0) unless a measure states otherwise.
# The two structural measures (State Pension personal allowance, energy
# payment) live in mock_drill2_structural.py.
# ---------------------------------------------------------------------------

MOCK2_YEARS = range(2026, 2031)
FUEL_DUTY_PATH = "gov.hmrc.fuel_duty.petrol_and_diesel"
MOCK2_FUEL_FIRST_YEAR = 2027  # 2026 is identical in both scenarios.
MOCK2_FUEL_HELD_RATE = 0.5295
MOCK2_FUEL_SEPTEMBER_2027_RATE = 0.5595
MOCK2_PUMP_VAT_RATE = 0.20


def _month_range(year: int, month: int) -> str:
    """Full-month ISO range, e.g. 2027-02-01.2027-02-28 (both ends inclusive)."""
    import calendar

    last = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-01.{year}-{month:02d}-{last:02d}"


@lru_cache(maxsize=1)
def _native_fuel_duty_schedule() -> tuple[tuple[str, float], ...]:
    """The engine's dated petrol/diesel schedule as written in its YAML.

    The loaded parameter tree has already been converted to fiscal-year
    blends (every instant in model year 2027 reads the FY2027-28 average), so
    the dated steps are read from the source file instead.
    """
    from pathlib import Path

    import policyengine_uk
    import yaml

    path = (
        Path(policyengine_uk.__file__).parent
        / "parameters/gov/hmrc/fuel_duty/petrol_and_diesel.yaml"
    )
    values = yaml.safe_load(path.read_text())["values"]
    return tuple(
        sorted(
            (str(date), float(v["value"] if isinstance(v, dict) else v))
            for date, v in values.items()
        )
    )


# Annex A (13:40 costings): pre-measure baseline, dated steps (rate in £/L).
MOCK2_FUEL_ANNEX_A_BASELINE = (
    ("2026-01-01", 0.5295),
    ("2027-01-01", 0.5595),
    ("2027-03-01", 0.5795),
    ("2027-04-01", 0.5992),
    ("2028-04-01", 0.6178),
    ("2029-04-01", 0.6357),
    ("2030-04-01", 0.6535),
)
# Costing note 1: post-measure path, RPI-uprated from April 2028.
MOCK2_FUEL_COSTING_REFORM = (
    ("2026-01-01", 0.5295),
    ("2027-09-01", 0.5595),
    ("2028-04-01", 0.5768),
    ("2029-04-01", 0.5935),
    ("2030-04-01", 0.6101),
)


def _dated_rate(schedule, year: int, month: int) -> float:
    first_of_month = f"{year}-{month:02d}-01"
    rate = None
    for date, value in schedule:
        if date <= first_of_month:
            rate = value
    return rate


def _mock2_fuel_baseline_rate(year: int, month: int) -> float:
    """Annex A baseline: 55.95p Jan 2027, 57.95p Mar 2027, then RPI each April."""
    return _dated_rate(MOCK2_FUEL_ANNEX_A_BASELINE, year, month)


def _mock2_fuel_reform_rate(year: int, month: int) -> float:
    """52.95p to 31 Aug 2027, 55.95p from 1 Sep 2027, costing's RPI path from Apr 2028."""
    return _dated_rate(MOCK2_FUEL_COSTING_REFORM, year, month)


def _mock2_fuel_schedule(rate_for) -> dict[str, float]:
    return {
        _month_range(year, month): rate_for(year, month)
        for year in MOCK2_YEARS
        if year >= MOCK2_FUEL_FIRST_YEAR
        for month in range(1, 13)
    }


def _mock2_fuel_duty_saving_per_litre(year: int) -> float:
    """Calendar-year average duty saving per litre (litres spread evenly)."""
    return (
        sum(
            _mock2_fuel_baseline_rate(year, month)
            - _mock2_fuel_reform_rate(year, month)
            for month in range(1, 13)
        )
        / 12
    )


def _mock2_fuel_pump_vat_modifier(sim: Simulation) -> Simulation:
    """Pass the duty saving through to the 20% VAT charged at the pump.

    Duty-only effect = the fuel_duty parameter change; this modifier adds the
    VAT on the duty change, subtracted once from vat (never from vat_change).
    """
    for year in MOCK2_YEARS:
        if year < MOCK2_FUEL_FIRST_YEAR:
            continue
        saving = _mock2_fuel_duty_saving_per_litre(year)
        litres = np.asarray(
            sim.calculate("petrol_litres", period=year)
        ) + np.asarray(sim.calculate("diesel_litres", period=year))
        current_vat = np.asarray(sim.calculate("vat", period=year))
        sim.set_input(
            "vat", year, current_vat - litres * saving * MOCK2_PUMP_VAT_RATE
        )
    return sim


def _create_mock2_fuel_duty_hold() -> Reform:
    """Mock 2 measure 1: cancel the January and March 2027 fuel duty rises.

    Basis: both scenarios carry explicit full-calendar-month rates for
    January 2027 to December 2030, so model-year totals are calendar years
    (the declared even-month proration exception), not the engine's native
    fiscal-year blend. The baseline months reproduce the engine's own dated
    schedule. Duty-only = parameter change; VAT-inclusive adds the modifier.
    """
    return Reform(
        id="mock2_fuel_duty_hold",
        name="Fuel duty held until September 2027",
        description=(
            "MOCK. The 3p rise on 1 January 2027 and the 2p rise on 1 March "
            "2027 do not go ahead: main rates stay at 52.95p per litre until "
            "31 August 2027, rise to 55.95p on 1 September 2027, and RPI "
            "uprating resumes in April 2028. Baseline: the engine's native "
            "schedule in Annex A (55.95p Jan 2027, 57.95p Mar 2027, 59.92p Apr 2027). "
            "Calendar-month basis; includes 20% VAT on the duty change."
        ),
        baseline_parameter_changes={
            FUEL_DUTY_PATH: _mock2_fuel_schedule(_mock2_fuel_baseline_rate)
        },
        parameter_changes={
            FUEL_DUTY_PATH: _mock2_fuel_schedule(_mock2_fuel_reform_rate)
        },
        simulation_modifier=_mock2_fuel_pump_vat_modifier,
    )


# Calendar-year shares of the April 2027 to March 2028 extension.
MOCK2_ELECTRICITY_VAT_YEAR_FRACTIONS = {2027: 9 / 12, 2028: 3 / 12}
MOCK2_ENERGY_REDUCED_VAT_RATE = 0.05


def _mock2_electricity_vat_modifier(sim: Simulation) -> Simulation:
    """Remove the 5% VAT inside GB domestic electricity bills, Apr 27-Mar 28.

    Bills include VAT, so the VAT is 5/105 of electricity_consumption. Gas is
    untouched. The engine has no domestic-energy VAT parameter, so neither
    the native baseline's October 2026-March 2027 zero rate nor this
    extension exists natively; only the extension is the measure. Northern
    Ireland is excluded. Subtracted once from vat; the engine derives
    vat_change from it.
    """
    for year, fraction in MOCK2_ELECTRICITY_VAT_YEAR_FRACTIONS.items():
        electricity = np.asarray(
            sim.calculate("electricity_consumption", period=year)
        )
        if getattr(sim, "built_from_dataset", False) and not electricity.any():
            raise ValueError(
                "electricity_consumption is zero for every household: the "
                "dataset does not carry it, so mock2_electricity_vat_zero "
                "would silently cost nothing."
            )
        country = np.asarray(sim.calculate("country", period=year))
        in_gb = country != "NORTHERN_IRELAND"
        saving = (
            electricity
            * MOCK2_ENERGY_REDUCED_VAT_RATE
            / (1 + MOCK2_ENERGY_REDUCED_VAT_RATE)
            * in_gb
            * fraction
        )
        current_vat = np.asarray(sim.calculate("vat", period=year))
        sim.set_input("vat", year, current_vat - saving)
    return sim


def _create_mock2_electricity_vat_zero() -> Reform:
    """Mock 2 measure 2: GB domestic electricity zero rate to 31 March 2028."""
    return Reform(
        id="mock2_electricity_vat_zero",
        name="No VAT on household electricity to March 2028",
        description=(
            "MOCK. The zero VAT rate on domestic electricity in Great Britain "
            "continues from 1 April 2027 to 31 March 2028; gas stays at 5%. "
            "Modelled as removing 5/105 of recorded electricity spending with "
            "full pass-through, prorated 9/12 to 2027 and 3/12 to 2028 "
            "(calendar years). Northern Ireland is excluded."
        ),
        simulation_modifier=_mock2_electricity_vat_modifier,
    )


SECONDARY_THRESHOLD_PATH = (
    "gov.hmrc.national_insurance.class_1.thresholds.secondary_threshold"
)
MOCK2_ST_RISE_PER_YEAR = 500


MOCK2_ST_BASELINE_ANNUAL = 5_000  # Annex A: fixed until April 2031
MOCK2_ST_REFORM_ANNUAL = 5_500


def _mock2_secondary_threshold_path(annual: float) -> dict[str, float]:
    """Weekly Secondary Threshold for 2027-2030; the engine annualises by 52."""
    return {str(year): annual / 52 for year in MOCK2_YEARS if year >= 2027}


def _create_mock2_employer_ni_threshold() -> Reform:
    """Mock 2 measure 3: employer NI Secondary Threshold £5,000 -> £5,500."""
    return Reform(
        id="mock2_employer_ni_threshold",
        name="Employer National Insurance threshold rise",
        description=(
            "MOCK. Raises the employer National Insurance Secondary Threshold "
            "from £5,000 to £5,500 a year from April 2027, held flat to "
            "2030-31. Baseline is Annex A's £5,000 (the engine's own is "
            "£96 × 52 = £4,992); the engine passes employer NI changes "
            "through to pay in full."
        ),
        baseline_parameter_changes={
            SECONDARY_THRESHOLD_PATH: _mock2_secondary_threshold_path(
                MOCK2_ST_BASELINE_ANNUAL
            )
        },
        parameter_changes={
            SECONDARY_THRESHOLD_PATH: _mock2_secondary_threshold_path(
                MOCK2_ST_REFORM_ANNUAL
            )
        },
    )


MOCK2_CGT_RATES = {
    "gov.hmrc.cgt.basic_rate": 0.20,
    "gov.hmrc.cgt.higher_rate": 0.28,
    "gov.hmrc.cgt.additional_rate": 0.28,
    "gov.hmrc.cgt.residential_property.basic_rate": 0.20,
    "gov.hmrc.cgt.residential_property.higher_rate": 0.28,
    "gov.hmrc.cgt.residential_property.additional_rate": 0.28,
}


def _create_mock2_cgt_rates() -> Reform:
    """Mock 2 measure 4: CGT 18% -> 20% and 24% -> 28% from 6 April 2027.

    Bare-year keys are UK fiscal years in 2.120.0, so "2027" starts on 6 April
    2027. Residential property shares the 18%/24% rates, so it rises too;
    BADR and carried interest are separate regimes and are unchanged. The
    engine's realisation elasticity is 0 by default (static).
    """
    return Reform(
        id="mock2_cgt_rates",
        name="Capital Gains Tax rate rise",
        description=(
            "MOCK. From 6 April 2027 Capital Gains Tax rates rise from 18% to "
            "20% and from 24% to 28%, including residential property gains. "
            "Business Asset Disposal Relief and carried interest unchanged."
        ),
        parameter_changes={
            path: {str(year): rate for year in MOCK2_YEARS if year >= 2027}
            for path, rate in MOCK2_CGT_RATES.items()
        },
    )


MOCK2_HVCTS_BAND_FLOOR = 1_500_000
MOCK2_HVCTS_BAND_AMOUNT = 1_500
MOCK2_HVCTS_FIRST_YEAR = 2028


def _mock2_hvcts_band_modifier(sim: Simulation) -> Simulation:
    """Add a £1,500 band for English homes worth £1.5m to under £2m (2026 prices).

    The engine's surcharge scale has five fixed brackets, so a band cannot be
    inserted by parameter changes without dropping the top one. This adds
    the band to the native surcharge, replicating the formula exactly:
    England only, value deflated to 2026 prices by GDP per capita, owners
    only (costing note 7; the native bands have no owner test), the band's ceiling is the
    native £2m threshold and its amount is uprated in line with the native
    £2,500 band.
    """
    params = sim.tax_benefit_system.parameters
    gdp = params.gov.economic_assumptions.indices.obr.per_capita.gdp
    for year in MOCK2_YEARS:
        if year < MOCK2_HVCTS_FIRST_YEAR:
            continue
        scale = params.gov.hmrc.council_tax.high_value_surcharge.amount
        ceiling = scale.brackets[1].threshold(str(year))
        amount = (
            MOCK2_HVCTS_BAND_AMOUNT
            * scale.brackets[1].amount(str(year))
            / scale.brackets[1].amount(str(MOCK2_HVCTS_FIRST_YEAR))
        )
        value = np.asarray(sim.calculate("main_residence_value", period=year))
        value_2026 = value / (gdp(str(year)) / gdp("2026"))
        country = np.asarray(sim.calculate("country", period=year))
        tenure = np.asarray(sim.calculate("tenure_type", period=year))
        # Costing note 7: the surcharge is the owner's liability.
        owner = np.isin(tenure, ["OWNED_OUTRIGHT", "OWNED_WITH_MORTGAGE"])
        in_band = (
            (country == "ENGLAND")
            & owner
            & (value_2026 >= MOCK2_HVCTS_BAND_FLOOR)
            & (value_2026 < ceiling)
        )
        native = np.asarray(
            sim.calculate("high_value_council_tax_surcharge", period=year)
        )
        sim.set_input(
            "high_value_council_tax_surcharge",
            year,
            native + in_band * amount,
        )
    return sim


def _create_mock2_hvcts_band() -> Reform:
    """Mock 2 measure 5: new £1,500 surcharge band from £1.5m, April 2028."""
    return Reform(
        id="mock2_hvcts_band",
        name="Council tax surcharge band from £1.5m",
        description=(
            "MOCK. From April 2028 homes in England valued between £1.5 "
            "million and £2 million (2026 values) pay a new £1,500 band of "
            "the High Value Council Tax Surcharge; the existing bands from "
            "£2 million are unchanged."
        ),
        simulation_modifier=_mock2_hvcts_band_modifier,
    )


TRIPLE_LOCK_EARNINGS_PATH = (
    "gov.dwp.state_pension.triple_lock.include_earnings"
)


NEW_SP_PATH = "gov.dwp.state_pension.new_state_pension.amount"
BASIC_SP_PATH = "gov.dwp.state_pension.basic_state_pension.amount"
# Annex A: full new State Pension a week under the triple lock.
MOCK2_ANNEX_A_NEW_SP = {2027: 250.70, 2028: 259.75, 2029: 268.85, 2030: 278.00}
# Costing note 8: OBR earnings 3.4%, CPI 2.0%, so April 2030 is 2.5% not 3.4%.
MOCK2_SP_APRIL_2030_UPRATING = 0.025
MOCK2_NATIVE_SP_2026 = {"new": 241.30, "basic": 184.90}


PC_GUARANTEE_PATH = "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee"
# Annex A: the standard minimum guarantee rises at least with earnings.
# OBR Table 1.6, May-July AWE growth uprating the following April.
MOCK2_OBR_EARNINGS = {2027: 0.039, 2028: 0.036, 2029: 0.035, 2030: 0.034}
MOCK2_NATIVE_PC_2026 = {"SINGLE": 238.00, "COUPLE": 363.25}


def _mock2_pc_guarantee_path() -> dict[str, dict[str, float]]:
    """Weekly guarantee uprated by OBR earnings each April (Annex A)."""
    paths = {}
    for unit, amount in MOCK2_NATIVE_PC_2026.items():
        values = {}
        for year, growth in MOCK2_OBR_EARNINGS.items():
            amount = round(amount * (1 + growth), 2)
            values[str(year)] = amount
        paths[f"{PC_GUARANTEE_PATH}.{unit}"] = values
    return paths


def _mock2_sp_paths(new_sp: dict[int, float]) -> dict[str, dict[str, float]]:
    """New SP from the given path; basic SP moves by the same ratios.

    Also pins the Pension Credit guarantee to Annex A's earnings path, which
    is the same in both scenarios of every measure that uses it.
    """
    basic_ratio = MOCK2_NATIVE_SP_2026["basic"] / MOCK2_NATIVE_SP_2026["new"]
    return {
        NEW_SP_PATH: {str(y): v for y, v in new_sp.items()},
        BASIC_SP_PATH: {str(y): v * basic_ratio for y, v in new_sp.items()},
        **_mock2_pc_guarantee_path(),
    }


def _mock2_sp_reform_path() -> dict[int, float]:
    path = dict(MOCK2_ANNEX_A_NEW_SP)
    # DWP rounds uprated State Pension rates to the nearest 5p (SSAA 1992
    # s.150A(4) allows rounding): 268.85 x 1.025 = 275.57 -> £275.55.
    raw = MOCK2_ANNEX_A_NEW_SP[2029] * (1 + MOCK2_SP_APRIL_2030_UPRATING)
    path[2030] = round(round(raw / 0.05) * 0.05, 2)
    return path


def _mock2_sp_household_modifier(sim: Simulation) -> Simulation:
    """Household calculator only: scale entered State Pension by the reform ratio.

    With a situation (no dataset) the engine takes the reported amount as
    given: the part above the reformed flat rate moves to
    additional_state_pension, so the total never changes. The specimen basis
    says the State Pension follows Annex A, so scale it by 275.57/278.00 from
    2030. National runs (Microsimulation) already respond through the rates.
    """
    from policyengine_uk import Microsimulation

    if isinstance(sim, Microsimulation):
        return sim
    reform = _mock2_sp_reform_path()
    for year in MOCK2_YEARS:
        if year < 2030:
            continue
        ratio = reform[year] / MOCK2_ANNEX_A_NEW_SP[year]
        pension = np.asarray(sim.calculate("state_pension", period=year))
        sim.set_input("state_pension", year, pension * ratio)
    return sim


def _create_mock2_state_pension_uprating() -> Reform:
    """Mock 2 measure 6: from April 2030, SP rises by max(CPI, 2.5%).

    Both scenarios set the State Pension explicitly: the baseline is Annex A's
    triple-lock path (£278.00 a week in 2030-31, a 3.4% earnings rise) and the
    reform applies 2.5% to £268.85 in April 2030 (£275.57). Pension Credit is
    on Annex A's earnings path in both scenarios.
    """
    return Reform(
        id="mock2_state_pension_uprating",
        name="State Pension uprating: higher of CPI and 2.5%",
        description=(
            "MOCK. From April 2030 the State Pension rises each year by the "
            "higher of CPI inflation and 2.5%; average earnings leave the "
            "triple lock. On the OBR forecast (earnings 3.4%, CPI 2.0%) the "
            "April 2030 rise is 2.5% instead of 3.4%. Baseline: Annex A path."
        ),
        baseline_parameter_changes=_mock2_sp_paths(MOCK2_ANNEX_A_NEW_SP),
        parameter_changes=_mock2_sp_paths(_mock2_sp_reform_path()),
        simulation_modifier=_mock2_sp_household_modifier,
    )


def _with_annex_a_state_pension(reform: Reform) -> Reform:
    """Pin the new State Pension to Annex A in both scenarios.

    The allowance rises with the full new State Pension, so its path must be
    Annex A's (£259.75 in 2028-29, not the engine's £256.98). The pension
    itself is identical in both scenarios, so it does not score.
    """
    paths = _mock2_sp_paths(MOCK2_ANNEX_A_NEW_SP)
    reform.baseline_parameter_changes = {
        **(reform.baseline_parameter_changes or {}),
        **paths,
    }
    reform.parameter_changes = {**(reform.parameter_changes or {}), **paths}
    return reform


# ---------------------------------------------------------------------------
# End of MOCK drill 2 parameter measures.
# ---------------------------------------------------------------------------


_AUTUMN_BUDGET_2026_REFORMS_CACHE: list[Reform] | None = None
_ALL_REFORMS_CACHE: list[Reform] | None = None
_REFORM_LOOKUP_CACHE: dict[str, Reform] | None = None


def _get_autumn_budget_2026_reforms() -> list[Reform]:
    """Get the candidate and carried-over 2026 reforms (lazy-loaded)."""
    global _AUTUMN_BUDGET_2026_REFORMS_CACHE
    if _AUTUMN_BUDGET_2026_REFORMS_CACHE is None:
        from uk_budget_data import mock_drill2_structural as mock2

        _AUTUMN_BUDGET_2026_REFORMS_CACHE = [
            # MOCK drill 2 parameter measures (statement order).
            _create_mock2_fuel_duty_hold(),
            _create_mock2_electricity_vat_zero(),
            _create_mock2_employer_ni_threshold(),
            _create_mock2_cgt_rates(),
            _create_mock2_hvcts_band(),
            _create_mock2_state_pension_uprating(),
            _with_annex_a_state_pension(
                mock2.create_mock2_state_pension_personal_allowance()
            ),
            _with_annex_a_state_pension(
                mock2.create_mock2_energy_price_payment()
            ),
        ]
    return _AUTUMN_BUDGET_2026_REFORMS_CACHE


def _get_all_reforms() -> list[Reform]:
    """Get all available reforms (lazy-loaded)."""
    global _ALL_REFORMS_CACHE
    if _ALL_REFORMS_CACHE is None:
        # Enacted or superseded 2025 measures stay reachable by id so old
        # shared URLs keep resolving, but are off the 2026 dashboard list.
        _ALL_REFORMS_CACHE = _get_autumn_budget_2026_reforms() + [
            _create_cgt_equalisation(),
            _create_fuel_duty_rise_cancellation(),
            _create_bus_fare_cap(),
            _create_threshold_freeze_extension(),
            _create_dividend_tax_increase(),
            _create_savings_tax_increase(),
            _create_property_tax_increase(),
            _create_combined_autumn_budget_reform(),
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

    Empty until the drill statement is released and measures are registered.
    Lazy-loaded to avoid import-time initialization.
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
