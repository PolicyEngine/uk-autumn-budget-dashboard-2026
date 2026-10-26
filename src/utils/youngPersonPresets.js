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
 *
 * The graduate is in householdExamples.js ("A graduate on £35,000"): a
 * 23-year-old graduate on £32,300 gave the same result in every year, so
 * the cards keep the one that names the Plan 2 measure.
 * https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6
 *
 * The household's other answers (region, home, loan plan, partner,
 * Universal Credit) are filled too. The rents are illustrative round
 * figures, not sourced averages, and each note says so.
 */

import { EXAMPLE_ANSWERS } from "./exampleAnswers";

// Inputs every example sets the same way: every answer fixed
// (exampleAnswers.js: region, spending and council tax band at fixed
// values, never the form's defaults, so the precomputed results keep
// matching), no other income, no salary sacrifice, no children; single,
// claiming any Universal Credit due, renting privately, no childcare
const COMMON = {
  ...EXAMPLE_ANSWERS,
  has_partner: false,
  claims_universal_credit: true,
  tenure: "RENT_PRIVATELY",
};

export const YOUNG_PERSON_PRESETS = [
  {
    id: "renter-22",
    label: "A 22-year-old renting",
    // On its chip once the cards fold into a strip
    short: "Renter, 22",
    description: "£25,000, renting at £900 a month, no student loan",
    icon: "key",
    measure: "domestic_electricity_zero_vat",
    tag: "Zero VAT on electricity",
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
    // The salary's source, in the result's "Based on"
    salarySource:
      "£25,000 in 2026, between the 2025 full-time medians for ages 18 to 21 and 22 to 29 (ONS ASHE)",
  },
  {
    id: "apprentice-19",
    label: "A 19-year-old apprentice",
    // On its chip once the cards fold into a strip
    short: "Apprentice",
    description: "£23,600, renting a room at £600 a month",
    icon: "hardHat",
    measure: "employer_ni_relief_under_25s",
    tag: "Employer NI relief",
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
    // The salary's source, in the result's "Based on"
    salarySource:
      "£23,600 in 2026, the 2025 full-time median for ages 18 to 21 (ONS ASHE), for all full-time employees of that age, not apprentices only",
  },
];
