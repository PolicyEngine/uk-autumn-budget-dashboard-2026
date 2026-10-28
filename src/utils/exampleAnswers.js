/**
 * Every answer the Household calculator form sends, at a fixed value, for the
 * example households (householdExamples.js) to
 * start from.
 *
 * The examples do not take the form's defaults (WIZARD_DEFAULTS) or any
 * prefill: their results are precomputed (public/data/household_presets.json,
 * keyed by the exact request), so an example whose request moved with a
 * default, or with a prefill such as the rent, would no longer match its
 * precomputed answer and its card would fall back to "Calculated when
 * chosen". With every answer fixed here, a change to the defaults or the
 * prefills changes no example; a test (householdPresets.test.js) checks
 * that each example's request is the same with or without the defaults
 * under it.
 *
 * The values are the form's defaults as they were on 26 October 2026 (their
 * sources: householdDefaults.js), written out, not imported. The rent is a
 * fixed £975 a month, the North West's average private rent (ONS Price
 * Index of Private Rents, September 2026), never "use the local rate": no
 * rental area (brma) is set, so the API takes the region's default area.
 */
export const EXAMPLE_ANSWERS = Object.freeze({
  current_age: 30,
  current_salary: 34200,
  region: "NORTH_WEST",
  tenure: "RENT_PRIVATELY",
  monthly_rent: 975,
  student_loan_plan: "NONE",
  has_partner: false,
  partner_age: 30,
  partner_salary: 34200,
  children_ages: "",
  children_in_education: [],
  claims_universal_credit: true,
  // Not a carer (nothing sent); a carer's hours start at the minimum, 35
  is_carer: false,
  care_hours_per_week: 35,
  council_tax_band: "D",
  salary_sacrifice_per_year: 0,
  // ONS Family Spending FYE 2025 averages, as the form's defaults
  petrol_spending_per_year: 620,
  diesel_spending_per_year: 340,
  electricity_spending_per_year: 1040,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  // No self-employment (nothing sent)
  self_employment_receipts_per_year: 0,
  self_employment_expenses_per_year: 0,
  private_pension_per_year: 0,
  partner_private_pension_per_year: 0,
  monthly_childcare: 0,
  // At State Pension age: null is the full new State Pension for the year
  // (not sent; the API reads the model)
  state_pension_per_year: null,
  partner_state_pension_per_year: null,
});
