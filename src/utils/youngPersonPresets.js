/**
 * Example young people for the Personal impact form ("Start from an
 * example"). A preset fills the form; every value stays editable.
 *
 * Earnings: ONS, Annual Survey of Hours and Earnings (ASHE) 2025
 * provisional, Table 6.7a "Annual pay - Gross", full-time employees,
 * median by age group (employees on adult rates in the same job for more
 * than a year):
 *   18-21: £23,596
 *   22-29: £32,347
 * https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6
 *
 * The household answers the Single-year effect also uses (region, home,
 * loan plan, partner, Universal Credit) are filled too. The rents are
 * illustrative round figures, not sourced averages, and each note says so.
 *
 * What the lifetime model (Multi-year effect) cannot take, said in each
 * note rather than approximated:
 * - Rent. The lifetime model has no housing costs or housing support, so
 *   renting and owning give the same lifetime result.
 * - Student loan plans other than Plan 2. It models Plan 2 only (the £27,295
 *   threshold); Plan 5, for courses starting from August 2023, is not
 *   modelled there. The single-year calculation takes the plan as given.
 * - Ages under 18: the API takes ages 18 to 80.
 */

// Inputs every example sets the same way: no other income, no salary
// sacrifice, no children, and the form's default spending.
const COMMON = {
  retirement_age: 67,
  life_expectancy: 85,
  salary_sacrifice_per_year: 0,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  rail_spending_per_year: 2000,
  petrol_spending_per_year: 500,
  children_ages: "",
  // Single-year answers: single, no Universal Credit claim, renting
  // privately, council tax band D, no diesel or childcare
  has_partner: false,
  claims_universal_credit: false,
  tenure: "RENT_PRIVATELY",
  council_tax_band: "D",
  diesel_spending_per_year: 0,
  monthly_childcare: 0,
};

export const YOUNG_PERSON_PRESETS = [
  {
    id: "renter-22",
    label: "A 22-year-old renting",
    inputs: {
      ...COMMON,
      current_age: 22,
      // About £25,000: between the ASHE 2025 full-time medians for ages
      // 18-21 (£23,596) and 22-29 (£32,347)
      current_salary: 25000,
      student_loan_debt: 0,
      student_loan_plan: "NONE",
      // Illustrative, not a sourced average
      monthly_rent: 900,
    },
    note:
      "Earns £25,000, between the 2025 full-time medians for ages 18 to 21 and 22 to 29 (ONS ASHE). No student loan. Rents privately at £900 a month, an illustrative figure. Only the single-year effect uses rent: the lifetime model has no housing costs or housing support.",
  },
  {
    id: "apprentice-19",
    label: "A 19-year-old apprentice",
    inputs: {
      ...COMMON,
      current_age: 19,
      // ASHE 2025 full-time median for ages 18-21, rounded
      current_salary: 23600,
      student_loan_debt: 0,
      student_loan_plan: "NONE",
      // A room in a shared house; illustrative, not a sourced average
      monthly_rent: 600,
    },
    note:
      "Earns £23,600, the 2025 full-time median for ages 18 to 21 (ONS ASHE). That median covers all full-time employees of that age, not apprentices only, many of whom earn less. No student loan. Rents a room privately at £600 a month, an illustrative figure.",
  },
  {
    id: "graduate-23",
    label: "A 23-year-old graduate",
    inputs: {
      ...COMMON,
      current_age: 23,
      // ASHE 2025 full-time median for ages 22-29, rounded
      current_salary: 32300,
      // The form's default balance, not a sourced average
      student_loan_debt: 45000,
      // Started in England before August 2023
      student_loan_plan: "PLAN_2",
      // Illustrative, not a sourced average
      monthly_rent: 900,
    },
    note:
      "Earns £32,300, the 2025 full-time median for ages 22 to 29 (ONS ASHE), with a £45,000 Plan 2 student loan. Rents privately at £900 a month, an illustrative figure. The lifetime model covers Plan 2 only: Plan 5, for courses starting from August 2023, is not modelled there.",
  },
];
