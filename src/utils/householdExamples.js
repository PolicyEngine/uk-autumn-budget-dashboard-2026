/**
 * The example households in the Household impact form's Examples menu, in
 * two groups: the young people (youngPersonPresets.js) and other
 * households, each chosen to show one measure clearly. An example fills
 * the form (on top of its defaults); every value stays editable, and
 * nothing is calculated until Calculate.
 *
 * Each "Other households" example was checked against the live household
 * API on 25 October 2026 with every measure selected; the measure it is for
 * changes its net income in the year named:
 *   pensioner: State Pension income tax protection +£93 in 2027-28
 *   family: zero VAT on domestic electricity +£62 in 2027-28 (the Warm
 *     Home Discount top-up is 2026-27 only, a year the form does not offer)
 *   graduate: Plan 2 threshold unfrozen +£79 in 2027-28
 *   driver: fuel duty rises deferred +£89, VAT cut on road fuel +£18, 2027-28
 *   higher earner: threshold freeze to 2031-32 −£221 in 2031-32
 * No example shows Business Asset Disposal Relief: the form asks no capital
 * gains.
 */
import { YOUNG_PERSON_PRESETS } from "./youngPersonPresets";

// Every example starts from no other income, no salary sacrifice, no
// childcare and no children, so an earlier example's answers never linger
const RESET = {
  salary_sacrifice_per_year: 0,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  private_pension_per_year: 0,
  monthly_childcare: 0,
  children_ages: "",
  has_partner: false,
  student_loan_plan: "NONE",
  claims_universal_credit: true,
};

export const OTHER_HOUSEHOLD_EXAMPLES = [
  {
    id: "pensioner-70",
    label: "A pensioner on the State Pension",
    description: "70, State Pension only; income tax protection",
    inputs: {
      ...RESET,
      current_age: 70,
      current_salary: 0,
      tenure: "OWNED_OUTRIGHT",
      // null: the full new State Pension for the year
      state_pension_per_year: null,
      petrol_spending_per_year: 300,
      diesel_spending_per_year: 0,
    },
    note: "Aged 70 with the full new State Pension and no other income; owns their home outright. Drives a little (£300 of petrol a year).",
  },
  {
    id: "family-uc",
    label: "A family on Universal Credit",
    description: "Two children, renting; zero VAT on electricity",
    inputs: {
      ...RESET,
      current_age: 34,
      current_salary: 21000,
      has_partner: true,
      partner_age: 33,
      partner_salary: 0,
      children_ages: "7, 4",
      tenure: "RENT_PRIVATELY",
      monthly_rent: null,
      electricity_spending_per_year: 1300,
    },
    note: "A couple renting privately with children aged 7 and 4; one earns £21,000, the other has no earnings. Claims the Universal Credit they are due. Spends £1,300 a year on electricity, above the average household. The Warm Home Discount top-up is for winter 2026-27 only, before the years offered here.",
  },
  {
    id: "graduate-35k",
    label: "A graduate on £35,000",
    description: "27, Plan 2 student loan; threshold unfrozen",
    inputs: {
      ...RESET,
      current_age: 27,
      current_salary: 35000,
      student_loan_plan: "PLAN_2",
      tenure: "RENT_PRIVATELY",
      monthly_rent: null,
    },
    note: "Aged 27, earns £35,000 and repays a Plan 2 student loan; rents privately at the regional average.",
  },
  {
    id: "driver",
    label: "A driver with a long commute",
    description: "£2,600 a year on petrol; fuel duty and VAT",
    inputs: {
      ...RESET,
      current_age: 40,
      current_salary: 38000,
      tenure: "OWNED_WITH_MORTGAGE",
      petrol_spending_per_year: 2600,
      diesel_spending_per_year: 0,
    },
    note: "Aged 40, earns £38,000 and spends £2,600 a year on petrol, about four times the average household; owns with a mortgage.",
  },
  {
    id: "higher-earner",
    label: "A higher earner on £110,000",
    description: "Threshold freeze bites from 2031-32",
    inputs: {
      ...RESET,
      current_age: 45,
      current_salary: 110000,
      tenure: "OWNED_WITH_MORTGAGE",
    },
    note: "Aged 45, earns £110,000 and owns with a mortgage. The threshold freeze extension changes their income tax from 2031-32: choose that year to see it.",
  },
];

export const EXAMPLE_GROUPS = [
  { title: "Young people", examples: YOUNG_PERSON_PRESETS },
  { title: "Other households", examples: OTHER_HOUSEHOLD_EXAMPLES },
];

/** Every example, in menu order. */
export const HOUSEHOLD_EXAMPLES = EXAMPLE_GROUPS.flatMap((group) => group.examples);
