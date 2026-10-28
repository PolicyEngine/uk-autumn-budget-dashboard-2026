/**
 * The Household calculator form's defaults, with their sources. Every field has
 * one, so the results show before anything is changed.
 *
 * Salary: ONS, Annual Survey of Hours and Earnings (ASHE) 2026 provisional,
 * Table 6.7a "Annual pay - Gross", all employee jobs, UK: median £34,229
 * (April 2026; employees on adult rates in the same job for more than a
 * year), rounded to £34,200. The form asks for salary in 2026, so the
 * year matches.
 * https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6
 *
 * Rent: ONS, Price Index of Private Rents (PIPR), average monthly private
 * rent by region, September 2026 (Northern Ireland: July 2026, its latest),
 * published 21 October 2026.
 * https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics
 *
 * Spending: ONS, Family Spending in the UK, FYE 2025, Workbook 1, Table A1,
 * average weekly household spending × 52, rounded to £10: petrol £11.90
 * (£620 a year), diesel £6.50 (£340), electricity (line 4.4.1) £20.00
 * (£1,040; the API's own default, ELECTRICITY_SPENDING).
 * https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends
 */

/** ASHE 2026 provisional median, all employee jobs, rounded. */
export const DEFAULT_SALARY = 34200;
export const SALARY_SOURCE =
  "£34,200 is the UK median salary in April 2026 (Source: ONS Annual Survey of Hours and Earnings, provisional).";

/** Average monthly private rent by region (ONS PIPR, September 2026). */
export const REGIONAL_RENT = {
  NORTH_EAST: 790,
  NORTH_WEST: 975,
  YORKSHIRE: 869,
  EAST_MIDLANDS: 928,
  WEST_MIDLANDS: 983,
  EAST_OF_ENGLAND: 1298,
  LONDON: 2338,
  SOUTH_EAST: 1438,
  SOUTH_WEST: 1251,
  WALES: 848,
  SCOTLAND: 1011,
  // July 2026, Northern Ireland's latest month
  NORTHERN_IRELAND: 879,
};

/** The region's average private rent; the UK's (£1,406) for an unknown region. */
export const regionalRent = (region) => REGIONAL_RENT[region] ?? 1406;

/** Average household spending a year (ONS Family Spending, FYE 2025). */
export const DEFAULT_SPENDING = {
  petrol: 620,
  diesel: 340,
  electricity: 1040,
};

// The form's answers, each at a typical value until changed. Sources:
// above
export const WIZARD_DEFAULTS = {
  current_age: 30,
  current_salary: DEFAULT_SALARY,
  region: "NORTH_WEST",
  // The constituency picked (its name, 2024 boundaries), which sets the
  // region; null until picked. Not sent: the API reads the region
  constituency: null,
  tenure: "RENT_PRIVATELY",
  // null: the region's average private rent (ONS), until changed
  monthly_rent: null,
  // policyengine-uk's repayment depends on the plan and income alone: the
  // balance only caps a year's repayment, and is not asked for
  student_loan_plan: "NONE",
  has_partner: false,
  partner_age: 30,
  partner_salary: DEFAULT_SALARY,
  children_ages: "",
  // Per child, in the order of children_ages: whether a 16- to 19-year-old
  // is in full-time non-advanced education (school or college); yes until
  // answered
  children_in_education: [],
  // Entitlement: the household claims what it is due
  claims_universal_credit: true,
  // Not a carer until answered; a carer's hours of care a week start at
  // 35, the Carer's Allowance minimum
  is_carer: false,
  care_hours_per_week: 35,
  council_tax_band: "D",
  salary_sacrifice_per_year: 0,
  petrol_spending_per_year: DEFAULT_SPENDING.petrol,
  diesel_spending_per_year: DEFAULT_SPENDING.diesel,
  electricity_spending_per_year: DEFAULT_SPENDING.electricity,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  // Self-employment or side income: receipts (turnover) and allowable
  // expenses, £ a year; none until answered
  self_employment_receipts_per_year: 0,
  self_employment_expenses_per_year: 0,
  // Private and workplace pensions in payment, £ a year
  private_pension_per_year: 0,
  partner_private_pension_per_year: 0,
  monthly_childcare: 0,
  // At State Pension age; null is the full new State Pension for the year
  state_pension_per_year: null,
  partner_state_pension_per_year: null,
};
