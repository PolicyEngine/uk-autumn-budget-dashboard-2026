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
 * What the lifetime model cannot take, said in each note rather than
 * approximated:
 * - Rent. The model has no housing costs or housing support, so renting
 *   and owning give the same result.
 * - Student loan plans other than Plan 2. It models Plan 2 only (the £27,295
 *   threshold); Plan 5, for courses starting from August 2023, is not
 *   modelled.
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
    },
    note:
      "Earns £25,000, between the 2025 full-time medians for ages 18 to 21 and 22 to 29 (ONS ASHE). No student loan. Rent is not an input: the lifetime model has no housing costs or housing support, so renting gives the same result as owning.",
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
    },
    note:
      "Earns £23,600, the 2025 full-time median for ages 18 to 21 (ONS ASHE). That median covers all full-time employees of that age, not apprentices only, many of whom earn less. No student loan.",
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
    },
    note:
      "Earns £32,300, the 2025 full-time median for ages 22 to 29 (ONS ASHE), with a £45,000 Plan 2 student loan. The model covers Plan 2 only: Plan 5, for courses starting from August 2023, is not modelled.",
  },
];
