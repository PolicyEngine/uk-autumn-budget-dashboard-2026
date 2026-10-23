"""Lifecycle calculator for lifetime policy impact.

Standalone implementation based on uk-autumn-budget-lifecycle backend,
calculating lifetime impacts of UK Autumn Budget policies.
"""

from pydantic import BaseModel

# Inflation forecasts (OBR EFO November 2025)
CPI_FORECASTS = {
    2024: 0.0233,
    2025: 0.0318,
    2026: 0.0193,
    2027: 0.0200,
    2028: 0.0200,
    2029: 0.0200,
}
CPI_LONG_TERM = 0.0200

RPI_FORECASTS = {
    2024: 0.0331,
    2025: 0.0416,
    2026: 0.0308,
    2027: 0.0300,
    2028: 0.0283,
    2029: 0.0283,
}
RPI_LONG_TERM = 0.0239

# Policy parameters
PERSONAL_ALLOWANCE = 12_570
BASIC_RATE_THRESHOLD = 50_270
HIGHER_RATE_THRESHOLD = 125_140
BASIC_RATE = 0.20
HIGHER_RATE = 0.40
ADDITIONAL_RATE = 0.45
PA_TAPER_THRESHOLD = 100_000
PA_TAPER_RATE = 0.50

NI_PRIMARY_THRESHOLD = 12_570
NI_UPPER_EARNINGS_LIMIT = 50_270
NI_MAIN_RATE = 0.08
NI_HIGHER_RATE = 0.02
EMPLOYER_NI_RATE = 0.15

STUDENT_LOAN_THRESHOLD_PLAN2 = 27_295
STUDENT_LOAN_RATE = 0.09
STUDENT_LOAN_FORGIVENESS_YEARS = 30

# Plan 2 interest rate parameters (income-contingent)
STUDENT_LOAN_INTEREST_LOWER_THRESHOLD_2024 = 28_470
STUDENT_LOAN_INTEREST_UPPER_THRESHOLD_2024 = 51_245
STUDENT_LOAN_INTEREST_ADDITIONAL_RATE = 0.03

# Fuel duty rates
FUEL_DUTY_BASELINE = {
    2025: 0.5295,
    2026: (0.5295 * 91 + 0.6033 * 275) / 366,
    2027: (0.6033 * 90 + 0.6226 * 275) / 365,
    2028: (0.6226 * 91 + 0.6406 * 275) / 366,
    2029: (0.6406 * 90 + 0.6592 * 275) / 365,
}

FUEL_DUTY_REFORM = {
    2025: 0.5295,
    2026: 0.5345,
    2027: 0.5902,
    2028: 0.6111,
    2029: 0.6290,
}

FUEL_DUTY_RPI_LONG_TERM = 0.029
AVG_PETROL_PRICE_PER_LITRE = 1.40

SALARY_SACRIFICE_CAP = 2_000

DIVIDEND_ALLOWANCE = 500
SAVINGS_ALLOWANCE_BASIC = 1_000
SAVINGS_ALLOWANCE_HIGHER = 500

# State pension forecasts
STATE_PENSION_FORECASTS = {
    2024: 11541.90,
    2025: 12016.75,
    2026: 12569.85,
    2027: 12885.50,
}
STATE_PENSION_LONG_TERM_GROWTH = 0.04
STATE_PENSION_AGE = 67

# Universal Credit parameters
UC_CHILD_ELEMENT_ANNUAL_2025 = 3513.72
UC_CHILD_ELEMENT_MAX_AGE = 18
UC_TWO_CHILD_LIMIT_END_YEAR = 2026
UC_TWO_CHILD_LIMIT = 2
UC_STANDARD_ALLOWANCE_SINGLE_PARENT_2025 = 400.14 * 12
UC_TAPER_RATE = 0.55
UC_WORK_ALLOWANCE_WITH_HOUSING_2025 = 404 * 12
UC_WORK_ALLOWANCE_NO_HOUSING_2025 = 673 * 12

# Earnings growth by age
EARNINGS_GROWTH_BY_AGE = {
    22: 1.00,
    23: 1.05,
    24: 1.10,
    25: 1.16,
    26: 1.22,
    27: 1.28,
    28: 1.35,
    29: 1.42,
    30: 1.50,
    31: 1.55,
    32: 1.60,
    33: 1.65,
    34: 1.70,
    35: 1.75,
    36: 1.80,
    37: 1.84,
    38: 1.88,
    39: 1.92,
    40: 1.96,
    41: 2.00,
    42: 2.03,
    43: 2.06,
    44: 2.09,
    45: 2.12,
    46: 2.14,
    47: 2.16,
    48: 2.18,
    49: 2.19,
    50: 2.20,
}
PEAK_EARNINGS_MULTIPLIER = 2.20
YOUNGEST_TRAJECTORY_AGE = min(EARNINGS_GROWTH_BY_AGE)


def earnings_multiplier(age: int) -> float:
    """Earnings at ``age`` relative to age 22, on the age trajectory.

    Ages below the trajectory's first age (22) stay at its first value, so
    a 19-year-old's salary is carried flat to 22 and then grows; ages past
    its last value (50) stay at the peak.
    """
    if age < YOUNGEST_TRAJECTORY_AGE:
        return EARNINGS_GROWTH_BY_AGE[YOUNGEST_TRAJECTORY_AGE]
    return EARNINGS_GROWTH_BY_AGE.get(age, PEAK_EARNINGS_MULTIPLIER)


class LifecycleInputs(BaseModel):
    """Input model for lifecycle calculations."""

    current_age: int = 30
    current_salary: float = 40_000
    retirement_age: int = 67
    life_expectancy: int = 85
    student_loan_debt: float = 50_000
    salary_sacrifice_per_year: float = 5_000
    rail_spending_per_year: float = 2_000
    dividends_per_year: float = 2_000
    savings_interest_per_year: float = 1_500
    property_income_per_year: float = 3_000
    petrol_spending_per_year: float = 1_500
    additional_income_growth_rate: float = 0.01
    children_ages: list[int] = []


def get_cpi(year: int) -> float:
    return CPI_FORECASTS.get(year, CPI_LONG_TERM)


def get_rpi(year: int) -> float:
    return RPI_FORECASTS.get(year, RPI_LONG_TERM)


def get_cumulative_inflation(
    base_year: int, target_year: int, use_rpi: bool = False
) -> float:
    factor = 1.0
    for y in range(base_year, target_year):
        rate = get_rpi(y) if use_rpi else get_cpi(y)
        factor *= 1 + rate
    return factor


def get_state_pension(year: int) -> float:
    if year in STATE_PENSION_FORECASTS:
        return STATE_PENSION_FORECASTS[year]
    last_forecast_year = max(STATE_PENSION_FORECASTS.keys())
    pension = STATE_PENSION_FORECASTS[last_forecast_year]
    for _ in range(last_forecast_year, year):
        pension *= 1 + STATE_PENSION_LONG_TERM_GROWTH
    return pension


def calculate_uc_child_element_impact(
    num_children: int,
    children_ages: list[int],
    year: int,
    net_earnings: float = 0.0,
    has_housing_element: bool = True,
) -> float:
    """Calculate impact of removing the two-child limit on UC child element."""
    if num_children == 0 or len(children_ages) == 0:
        return 0.0

    eligible_children = sum(
        1 for age in children_ages if age < UC_CHILD_ELEMENT_MAX_AGE + 1
    )

    if eligible_children <= UC_TWO_CHILD_LIMIT:
        return 0.0

    if year <= 2025:
        child_element = UC_CHILD_ELEMENT_ANNUAL_2025
        standard_allowance = UC_STANDARD_ALLOWANCE_SINGLE_PARENT_2025
        work_allowance = (
            UC_WORK_ALLOWANCE_WITH_HOUSING_2025
            if has_housing_element
            else UC_WORK_ALLOWANCE_NO_HOUSING_2025
        )
    else:
        cpi_factor = get_cumulative_inflation(2025, year, use_rpi=False)
        child_element = UC_CHILD_ELEMENT_ANNUAL_2025 * cpi_factor
        standard_allowance = (
            UC_STANDARD_ALLOWANCE_SINGLE_PARENT_2025 * cpi_factor
        )
        base_allowance = (
            UC_WORK_ALLOWANCE_WITH_HOUSING_2025
            if has_housing_element
            else UC_WORK_ALLOWANCE_NO_HOUSING_2025
        )
        work_allowance = base_allowance * cpi_factor

    children_with_limit = min(eligible_children, UC_TWO_CHILD_LIMIT)
    max_uc_with_limit = standard_allowance + (
        children_with_limit * child_element
    )
    max_uc_without_limit = standard_allowance + (
        eligible_children * child_element
    )

    if net_earnings > work_allowance:
        income_reduction = (net_earnings - work_allowance) * UC_TAPER_RATE
    else:
        income_reduction = 0.0

    actual_uc_with_limit = max(0.0, max_uc_with_limit - income_reduction)
    actual_uc_without_limit = max(0.0, max_uc_without_limit - income_reduction)

    return actual_uc_without_limit - actual_uc_with_limit


def calculate_ni(gross_income: float) -> float:
    if gross_income <= NI_PRIMARY_THRESHOLD:
        return 0
    ni = 0
    if gross_income > NI_PRIMARY_THRESHOLD:
        main_band = min(
            gross_income - NI_PRIMARY_THRESHOLD,
            NI_UPPER_EARNINGS_LIMIT - NI_PRIMARY_THRESHOLD,
        )
        ni += main_band * NI_MAIN_RATE
    if gross_income > NI_UPPER_EARNINGS_LIMIT:
        ni += (gross_income - NI_UPPER_EARNINGS_LIMIT) * NI_HIGHER_RATE
    return ni


def get_student_loan_interest_rate(gross_income: float, year: int) -> float:
    """Calculate Plan 2 student loan interest rate based on income."""
    rpi = get_rpi(year)

    if year <= 2024:
        lower_threshold = STUDENT_LOAN_INTEREST_LOWER_THRESHOLD_2024
        upper_threshold = STUDENT_LOAN_INTEREST_UPPER_THRESHOLD_2024
    else:
        rpi_factor = get_cumulative_inflation(2024, year, use_rpi=True)
        lower_threshold = (
            STUDENT_LOAN_INTEREST_LOWER_THRESHOLD_2024 * rpi_factor
        )
        upper_threshold = (
            STUDENT_LOAN_INTEREST_UPPER_THRESHOLD_2024 * rpi_factor
        )

    if gross_income <= lower_threshold:
        return rpi
    elif gross_income >= upper_threshold:
        return rpi + STUDENT_LOAN_INTEREST_ADDITIONAL_RATE
    else:
        taper_fraction = (gross_income - lower_threshold) / (
            upper_threshold - lower_threshold
        )
        additional_rate = (
            STUDENT_LOAN_INTEREST_ADDITIONAL_RATE * taper_fraction
        )
        return rpi + additional_rate


def calculate_student_loan(
    gross_income: float,
    remaining_debt: float,
    year: int,
    years_since_graduation: int,
    threshold: float = None,
) -> tuple[float, float]:
    """Calculate student loan repayment and new debt balance."""
    if years_since_graduation >= STUDENT_LOAN_FORGIVENESS_YEARS:
        return 0, 0
    if remaining_debt <= 0:
        return 0, 0
    if threshold is None:
        threshold = STUDENT_LOAN_THRESHOLD_PLAN2

    interest_rate = get_student_loan_interest_rate(gross_income, year)

    if gross_income <= threshold:
        new_debt = remaining_debt * (1 + interest_rate)
        return 0, new_debt
    repayment = (gross_income - threshold) * STUDENT_LOAN_RATE
    repayment = min(repayment, remaining_debt)
    remaining_after_payment = remaining_debt - repayment
    new_debt = remaining_after_payment * (1 + interest_rate)
    return repayment, max(0, new_debt)


def get_fuel_duty_rate(year: int, is_reform: bool) -> float:
    """Get fuel duty rate for a given year."""
    rates = FUEL_DUTY_REFORM if is_reform else FUEL_DUTY_BASELINE
    if year in rates:
        return rates[year]
    last_year = max(rates.keys())
    last_rate = rates[last_year]
    years_ahead = year - last_year
    return last_rate * ((1 + FUEL_DUTY_RPI_LONG_TERM) ** years_ahead)


def calculate_fuel_duty_impact(petrol_spending: float, year: int) -> float:
    """Calculate savings from fuel duty freeze/reform vs baseline."""
    if year < 2026:
        return 0

    baseline_rate = get_fuel_duty_rate(year, is_reform=False)
    reform_rate = get_fuel_duty_rate(year, is_reform=True)
    litres = petrol_spending / AVG_PETROL_PRICE_PER_LITRE

    return (baseline_rate - reform_rate) * litres


def calculate_rail_impact(
    rail_spending_base: float, current_year: int, base_year: int = 2024
) -> float:
    """Calculate savings from rail fare freeze in 2026."""
    if current_year < 2026:
        return 0

    RAIL_MARKUP = 0.01

    def get_fare_index(target_year: int, freeze_2026: bool) -> float:
        index = 1.0
        for y in range(base_year, target_year):
            if freeze_2026 and y == 2025:
                continue
            rpi = get_rpi(y)
            index *= 1 + rpi + RAIL_MARKUP
        return index

    preAB_index = get_fare_index(current_year, freeze_2026=False)
    postAB_index = get_fare_index(current_year, freeze_2026=True)

    preAB_spending = rail_spending_base * preAB_index
    postAB_spending = rail_spending_base * postAB_index

    return preAB_spending - postAB_spending


def calculate_salary_sacrifice_impact(
    salary_sacrifice: float, gross_income: float
) -> float:
    """Calculate impact of salary sacrifice cap."""
    excess = max(0, salary_sacrifice - SALARY_SACRIFICE_CAP)
    if excess == 0:
        return 0
    employee_ni_rate = (
        NI_MAIN_RATE
        if gross_income <= NI_UPPER_EARNINGS_LIMIT
        else NI_HIGHER_RATE
    )
    return excess * (employee_ni_rate + EMPLOYER_NI_RATE)


def calculate_unearned_income_tax(
    dividends: float,
    savings_interest: float,
    property_income: float,
    gross_income: float,
    increased_tax: bool = False,
) -> float:
    """Calculate tax on unearned income."""
    remaining_pa = max(0, PERSONAL_ALLOWANCE - gross_income)
    total_unearned = dividends + savings_interest + property_income

    if remaining_pa >= total_unearned:
        return 0.0

    total_income = gross_income + total_unearned
    if total_income > BASIC_RATE_THRESHOLD:
        savings_allowance = SAVINGS_ALLOWANCE_HIGHER
        dividend_rate = 0.3375
        savings_rate = HIGHER_RATE
    else:
        savings_allowance = SAVINGS_ALLOWANCE_BASIC
        dividend_rate = 0.0875
        savings_rate = BASIC_RATE

    pa_used = 0

    savings_after_pa = max(
        0, savings_interest - max(0, remaining_pa - pa_used)
    )
    pa_used += min(savings_interest, max(0, remaining_pa - pa_used))
    taxable_savings = max(0, savings_after_pa - savings_allowance)

    dividends_after_pa = max(0, dividends - max(0, remaining_pa - pa_used))
    pa_used += min(dividends, max(0, remaining_pa - pa_used))
    taxable_dividends = max(0, dividends_after_pa - DIVIDEND_ALLOWANCE)

    property_after_pa = max(
        0, property_income - max(0, remaining_pa - pa_used)
    )
    taxable_property = property_after_pa

    tax = (
        taxable_dividends * dividend_rate
        + taxable_savings * savings_rate
        + taxable_property * savings_rate
    )
    if increased_tax:
        tax *= 1.05
    return tax


def calculate_scenario(
    gross_income: float,
    current_year: int,
    years_since_graduation: int,
    remaining_debt: float,
    freeze_end_year: int,
) -> dict:
    """Calculate all tax/benefit values for a single policy scenario."""
    if current_year < 2028:
        pa = PERSONAL_ALLOWANCE
        basic_threshold = BASIC_RATE_THRESHOLD
        additional_threshold = HIGHER_RATE_THRESHOLD
    elif current_year < freeze_end_year:
        pa = PERSONAL_ALLOWANCE
        basic_threshold = BASIC_RATE_THRESHOLD
        additional_threshold = HIGHER_RATE_THRESHOLD
    else:
        cpi_factor = get_cumulative_inflation(freeze_end_year, current_year)
        pa = PERSONAL_ALLOWANCE * cpi_factor
        basic_threshold = BASIC_RATE_THRESHOLD * cpi_factor
        additional_threshold = HIGHER_RATE_THRESHOLD * cpi_factor

    taper_threshold = PA_TAPER_THRESHOLD

    if gross_income > taper_threshold:
        effective_pa = max(
            0, pa - (gross_income - taper_threshold) * PA_TAPER_RATE
        )
    else:
        effective_pa = pa

    taxable = max(0, gross_income - effective_pa)
    income_tax = 0
    if taxable > 0:
        basic_band = min(taxable, basic_threshold - pa)
        income_tax += basic_band * BASIC_RATE
        taxable -= basic_band
    if taxable > 0:
        higher_band = min(taxable, additional_threshold - basic_threshold)
        income_tax += higher_band * HIGHER_RATE
        taxable -= higher_band
    if taxable > 0:
        income_tax += taxable * ADDITIONAL_RATE

    sl_freeze_end = 2027 if freeze_end_year == 2028 else 2030
    if current_year < 2027:
        sl_threshold = STUDENT_LOAN_THRESHOLD_PLAN2
    elif current_year < sl_freeze_end:
        sl_threshold = STUDENT_LOAN_THRESHOLD_PLAN2
    else:
        sl_threshold = STUDENT_LOAN_THRESHOLD_PLAN2 * get_cumulative_inflation(
            sl_freeze_end, current_year, use_rpi=True
        )

    sl_payment, new_debt = calculate_student_loan(
        gross_income,
        remaining_debt,
        current_year,
        years_since_graduation,
        sl_threshold,
    )

    return {
        "pa": pa,
        "basic_threshold": basic_threshold,
        "taper_threshold": taper_threshold,
        "additional_threshold": additional_threshold,
        "effective_pa": effective_pa,
        "income_tax": income_tax,
        "sl_threshold": sl_threshold,
        "sl_payment": sl_payment,
        "sl_debt": new_debt,
    }


# The year the inputs describe (age, salary, children's ages): this
# dashboard's year. The first projected year is this year.
INPUT_YEAR = 2026


def run_lifecycle_model(inputs: LifecycleInputs) -> list[dict]:
    """Run the lifecycle model and return year-by-year results.

    The inputs describe INPUT_YEAR; results start in that year at the
    given age, in cash terms.
    """
    current_salary = inputs.current_salary
    current_age = inputs.current_age
    input_year = INPUT_YEAR

    current_age_multiplier = earnings_multiplier(current_age)
    base_multiplier_22 = EARNINGS_GROWTH_BY_AGE.get(22, 1.0)
    starting_salary = (
        current_salary / current_age_multiplier * base_multiplier_22
    )

    graduation_age = 22
    graduation_year = input_year - (current_age - graduation_age)

    base_year = INPUT_YEAR
    end_year = input_year + (inputs.life_expectancy - current_age)
    results = []

    baseline_debt = inputs.student_loan_debt
    reform_debt = inputs.student_loan_debt

    for current_year in range(base_year, end_year + 1):
        years_since_graduation = current_year - graduation_year
        age = graduation_age + years_since_graduation

        if age < current_age or age > inputs.life_expectancy:
            continue

        is_retired = age > inputs.retirement_age

        if is_retired:
            employment_income = 0
            state_pension = get_state_pension(current_year)
            gross_income = state_pension
        else:
            base_multiplier = earnings_multiplier(age)
            additional_growth = (
                1 + inputs.additional_income_growth_rate
            ) ** years_since_graduation
            employment_income = (
                starting_salary * base_multiplier * additional_growth
            )
            state_pension = 0
            gross_income = employment_income

        baseline = calculate_scenario(
            gross_income,
            current_year,
            years_since_graduation,
            baseline_debt,
            freeze_end_year=2028,
        )
        reform = calculate_scenario(
            gross_income,
            current_year,
            years_since_graduation,
            reform_debt,
            freeze_end_year=2031,
        )

        baseline_debt = baseline["sl_debt"]
        reform_debt = reform["sl_debt"]

        ni = calculate_ni(gross_income)

        unearned_cpi_factor = get_cumulative_inflation(base_year, current_year)
        dividends = inputs.dividends_per_year * unearned_cpi_factor
        savings_interest = (
            inputs.savings_interest_per_year * unearned_cpi_factor
        )
        property_income = inputs.property_income_per_year * unearned_cpi_factor

        unearned_tax = calculate_unearned_income_tax(
            dividends, savings_interest, property_income, gross_income
        )

        baseline_net = (
            gross_income
            - reform["income_tax"]
            - ni
            - reform["sl_payment"]
            - unearned_tax
            - inputs.rail_spending_per_year
            - inputs.petrol_spending_per_year
        )

        impact_rail_freeze = calculate_rail_impact(
            inputs.rail_spending_per_year, current_year
        )
        impact_fuel_freeze = calculate_fuel_duty_impact(
            inputs.petrol_spending_per_year, current_year
        )

        impact_threshold_freeze = (
            round(baseline["income_tax"] - reform["income_tax"])
            if current_year >= 2028
            else 0
        )

        if current_year >= 2027 and (baseline_debt > 0 or reform_debt > 0):
            impact_sl_freeze = baseline["sl_payment"] - reform["sl_payment"]
        else:
            impact_sl_freeze = 0

        unearned_tax_increased = calculate_unearned_income_tax(
            dividends,
            savings_interest,
            property_income,
            gross_income,
            increased_tax=True,
        )
        impact_unearned_tax = -(unearned_tax_increased - unearned_tax)

        salary_sacrifice = (
            inputs.salary_sacrifice_per_year * unearned_cpi_factor
        )
        if current_year >= 2029 and not is_retired:
            impact_salary_sacrifice_cap = -calculate_salary_sacrifice_impact(
                salary_sacrifice, gross_income
            )
        else:
            impact_salary_sacrifice_cap = 0

        years_from_input = current_year - input_year
        children_ages_this_year = [
            age_2025 + years_from_input for age_2025 in inputs.children_ages
        ]
        num_children = len(children_ages_this_year)

        if num_children > 0 and current_year >= UC_TWO_CHILD_LIMIT_END_YEAR:
            net_earnings_for_uc = max(
                0, employment_income - reform["income_tax"] - ni
            )
            impact_two_child_limit = calculate_uc_child_element_impact(
                num_children,
                children_ages_this_year,
                current_year,
                net_earnings=net_earnings_for_uc,
                has_housing_element=True,
            )
        else:
            impact_two_child_limit = 0

        results.append(
            {
                "age": age,
                "year": current_year,
                "gross_income": round(gross_income),
                "employment_income": round(employment_income),
                "state_pension": round(state_pension),
                "income_tax": round(reform["income_tax"]),
                "national_insurance": round(ni),
                "student_loan_payment": round(reform["sl_payment"]),
                "student_loan_debt_remaining": round(reform_debt),
                "num_children": num_children,
                "baseline_net_income": round(baseline_net),
                "impact_rail_fare_freeze": round(impact_rail_freeze),
                "impact_fuel_duty_freeze": round(impact_fuel_freeze),
                "impact_threshold_freeze": round(impact_threshold_freeze),
                "impact_unearned_income_tax": round(impact_unearned_tax),
                "impact_salary_sacrifice_cap": round(
                    impact_salary_sacrifice_cap
                ),
                "impact_sl_threshold_freeze": round(impact_sl_freeze),
                "impact_two_child_limit": round(impact_two_child_limit),
                "baseline_pa": round(baseline["pa"]),
                "baseline_basic_threshold": round(baseline["basic_threshold"]),
                "baseline_taper_threshold": round(baseline["taper_threshold"]),
                "baseline_additional_threshold": round(
                    baseline["additional_threshold"]
                ),
                "reform_pa": round(reform["pa"]),
                "reform_basic_threshold": round(reform["basic_threshold"]),
                "reform_taper_threshold": round(reform["taper_threshold"]),
                "reform_additional_threshold": round(
                    reform["additional_threshold"]
                ),
                "baseline_sl_debt": round(baseline["sl_debt"]),
                "reform_sl_debt": round(reform_debt),
                "baseline_sl_payment": round(baseline["sl_payment"]),
                "reform_sl_payment": round(reform["sl_payment"]),
                "baseline_sl_threshold": round(baseline["sl_threshold"]),
                "reform_sl_threshold": round(reform["sl_threshold"]),
            }
        )

    return results
