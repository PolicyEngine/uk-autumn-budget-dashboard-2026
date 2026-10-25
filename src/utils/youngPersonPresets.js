/**
 * Example young people for the Household impact form ("Start from an
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
 * The household's other answers (region, home, loan plan, partner,
 * Universal Credit) are filled too. The rents are illustrative round
 * figures, not sourced averages, and each note says so.
 */

// Inputs every example sets the same way: no other income, no salary
// sacrifice, no children. Everything else (region, spending, council tax
// band) stays at the form's sourced defaults (utils/householdDefaults.js).
const COMMON = {
  salary_sacrifice_per_year: 0,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  children_ages: "",
  // Single, claiming any Universal Credit due, renting privately, no
  // childcare
  has_partner: false,
  claims_universal_credit: true,
  tenure: "RENT_PRIVATELY",
  monthly_childcare: 0,
};

export const YOUNG_PERSON_PRESETS = [
  {
    id: "renter-22",
    label: "A 22-year-old renting",
    description: "£25,000, renting at £900 a month, no student loan",
    inputs: {
      ...COMMON,
      current_age: 22,
      // About £25,000: between the ASHE 2025 full-time medians for ages
      // 18-21 (£23,596) and 22-29 (£32,347)
      current_salary: 25000,
      student_loan_plan: "NONE",
      // Illustrative, not a sourced average
      monthly_rent: 900,
    },
    note:
      "Earns £25,000, between the 2025 full-time medians for ages 18 to 21 and 22 to 29 (ONS ASHE). No student loan. Rents privately at £900 a month, an illustrative figure.",
  },
  {
    id: "apprentice-19",
    label: "A 19-year-old apprentice",
    description: "£23,600, renting a room at £600 a month",
    inputs: {
      ...COMMON,
      current_age: 19,
      // ASHE 2025 full-time median for ages 18-21, rounded
      current_salary: 23600,
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
    description: "£32,300 with a Plan 2 student loan",
    inputs: {
      ...COMMON,
      current_age: 23,
      // ASHE 2025 full-time median for ages 22-29, rounded
      current_salary: 32300,
      // Started in England before August 2023
      student_loan_plan: "PLAN_2",
      // Illustrative, not a sourced average
      monthly_rent: 900,
    },
    note:
      "Earns £32,300, the 2025 full-time median for ages 22 to 29 (ONS ASHE), with a Plan 2 student loan. Rents privately at £900 a month, an illustrative figure.",
  },
];
